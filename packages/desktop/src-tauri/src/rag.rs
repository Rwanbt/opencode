//! Local RAG (Retrieval-Augmented Generation) system.
//! Stores text chunks as vectors for semantic search.
//! Uses simple TF-IDF for now (no embedding model needed).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MAX_DOCUMENTS: usize = 10_000;
const MAX_RESULTS: usize = 5;

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn rag_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("rag")
}

fn index_path(app: &AppHandle) -> PathBuf {
    rag_dir(app).join("index.json")
}

// ─── Types ─────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub text: String,
    pub source: String, // "session", "file", "manual"
    pub timestamp: u64,
    terms: HashMap<String, f32>, // TF-IDF term weights
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    documents: Vec<Document>,
    idf: HashMap<String, f32>, // inverse document frequency
}

pub struct RagState {
    index: Mutex<Index>,
}

impl RagState {
    pub fn new() -> Self {
        Self {
            index: Mutex::new(Index::default()),
        }
    }
}

// ─── TF-IDF helpers ────────────────────────────────────────────────────

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| w.len() > 2)
        .map(|w| w.to_string())
        .collect()
}

fn compute_tf(tokens: &[String]) -> HashMap<String, f32> {
    let mut tf = HashMap::new();
    let total = tokens.len() as f32;
    for token in tokens {
        *tf.entry(token.clone()).or_insert(0.0) += 1.0;
    }
    for v in tf.values_mut() {
        *v /= total;
    }
    tf
}

fn update_idf(index: &mut Index) {
    let n = index.documents.len() as f32;
    let mut doc_counts: HashMap<String, f32> = HashMap::new();
    for doc in &index.documents {
        for key in doc.terms.keys() {
            *doc_counts.entry(key.clone()).or_insert(0.0) += 1.0;
        }
    }
    index.idf = doc_counts
        .into_iter()
        .map(|(term, count)| (term, (n / count).ln()))
        .collect();
}

fn cosine_similarity(a: &HashMap<String, f32>, b: &HashMap<String, f32>, idf: &HashMap<String, f32>) -> f32 {
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for (term, &tf_a) in a {
        let w = idf.get(term).copied().unwrap_or(1.0);
        let wa = tf_a * w;
        norm_a += wa * wa;
        if let Some(&tf_b) = b.get(term) {
            let wb = tf_b * w;
            dot += wa * wb;
        }
    }
    for (term, &tf_b) in b {
        let w = idf.get(term).copied().unwrap_or(1.0);
        let wb = tf_b * w;
        norm_b += wb * wb;
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

// ─── Tauri commands ────────────────────────────────────────────────────

/// Add a document to the RAG index
#[tauri::command]
#[specta::specta]
pub async fn rag_add(app: AppHandle, text: String, source: String) -> Result<String, String> {
    let state = app.state::<RagState>();
    let mut index = state.index.lock().unwrap();

    let tokens = tokenize(&text);
    if tokens.is_empty() {
        return Err("Empty document".to_string());
    }

    let id = format!("doc_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let terms = compute_tf(&tokens);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let doc = Document {
        id: id.clone(),
        text: text[..text.len().min(2000)].to_string(), // cap stored text
        source,
        timestamp,
        terms,
    };

    index.documents.push(doc);

    // Evict oldest if over limit
    if index.documents.len() > MAX_DOCUMENTS {
        index.documents.sort_by_key(|d| d.timestamp);
        let keep_from = index.documents.len() - MAX_DOCUMENTS;
        index.documents = index.documents.drain(keep_from..).collect();
    }

    update_idf(&mut index);

    // Persist to disk
    let dir = rag_dir(&app);
    let _ = fs::create_dir_all(&dir);
    let json = serde_json::to_string(&*index).unwrap_or_default();
    let _ = fs::write(index_path(&app), json);

    tracing::info!("[RAG] Added doc {}, index size: {}", id, index.documents.len());
    Ok(id)
}

/// Search the RAG index for relevant documents
#[tauri::command]
#[specta::specta]
pub async fn rag_search(app: AppHandle, query: String, max_results: Option<usize>) -> Result<Vec<RagResult>, String> {
    let state = app.state::<RagState>();
    let index = state.index.lock().unwrap();

    if index.documents.is_empty() {
        return Ok(vec![]);
    }

    let query_tokens = tokenize(&query);
    let query_tf = compute_tf(&query_tokens);
    let k = max_results.unwrap_or(MAX_RESULTS);

    let mut scored: Vec<(f32, &Document)> = index
        .documents
        .iter()
        .map(|doc| (cosine_similarity(&query_tf, &doc.terms, &index.idf), doc))
        .filter(|(score, _)| *score > 0.05) // minimum relevance
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    scored.truncate(k);

    Ok(scored
        .into_iter()
        .map(|(score, doc)| RagResult {
            id: doc.id.clone(),
            text: doc.text.clone(),
            source: doc.source.clone(),
            score,
        })
        .collect())
}

/// Load RAG index from disk
#[tauri::command]
#[specta::specta]
pub async fn rag_load(app: AppHandle) -> Result<usize, String> {
    let path = index_path(&app);
    if !path.exists() {
        return Ok(0);
    }

    let json = fs::read_to_string(&path).map_err(|e| format!("Read: {}", e))?;
    let loaded: Index = serde_json::from_str(&json).map_err(|e| format!("Parse: {}", e))?;
    let count = loaded.documents.len();

    let state = app.state::<RagState>();
    *state.index.lock().unwrap() = loaded;

    tracing::info!("[RAG] Loaded {} documents", count);
    Ok(count)
}

/// Get RAG index stats
#[tauri::command]
#[specta::specta]
pub async fn rag_stats(app: AppHandle) -> RagStats {
    let state = app.state::<RagState>();
    let index = state.index.lock().unwrap();
    RagStats {
        document_count: index.documents.len(),
        term_count: index.idf.len(),
    }
}

/// Clear the RAG index
#[tauri::command]
#[specta::specta]
pub async fn rag_clear(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RagState>();
    *state.index.lock().unwrap() = Index::default();
    let _ = fs::remove_file(index_path(&app));
    tracing::info!("[RAG] Index cleared");
    Ok(())
}

#[derive(Serialize, specta::Type)]
pub struct RagResult {
    pub id: String,
    pub text: String,
    pub source: String,
    pub score: f32,
}

#[derive(Serialize, specta::Type)]
pub struct RagStats {
    pub document_count: usize,
    pub term_count: usize,
}
