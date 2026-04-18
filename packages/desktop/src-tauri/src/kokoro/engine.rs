//! Kokoro TTS ONNX engine.
//! Model: kokoro-v1.0.onnx (~310MB) + voices-v1.0.bin (~26MB)
//! License: Apache-2.0

use ndarray::{Array1, Array2};
use ort::{
    execution_providers::CPUExecutionProvider,
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use opencode_kokoro_shared::{g2p, tokenizer};

const STYLE_DIM: usize = 256;

pub struct KokoroEngine {
    session: Option<Session>,
    voices: HashMap<String, Vec<f32>>,  // voice_name → flat f32 style data
}

impl Default for KokoroEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl KokoroEngine {
    pub fn new() -> Self {
        Self {
            session: None,
            voices: HashMap::new(),
        }
    }

    pub fn load(&mut self, model_path: &Path, voices_path: &Path) -> Result<(), String> {
        tracing::info!("[Kokoro] Loading model...");

        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .with_execution_providers([CPUExecutionProvider::default().build()])
            .map_err(|e| e.to_string())?
            .commit_from_file(model_path)
            .map_err(|e| format!("Load model: {}", e))?;

        // FIX: Log model I/O names for debugging model version mismatches
        let input_names: Vec<&str> = session.inputs.iter().map(|i| i.name.as_str()).collect();
        let output_names: Vec<&str> = session.outputs.iter().map(|o| o.name.as_str()).collect();
        tracing::info!("[Kokoro] Model inputs: {:?}, outputs: {:?}", input_names, output_names);

        self.session = Some(session);

        // Load voices (ZIP of .npy files from kokoro-onnx)
        let voices_data = std::fs::read(voices_path)
            .map_err(|e| format!("Read voices: {}", e))?;
        let cursor = std::io::Cursor::new(voices_data);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("Open voices zip: {}", e))?;

        let mut voices = HashMap::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| format!("Zip entry: {}", e))?;
            let name = file.name().to_string();
            if !name.ends_with(".npy") { continue; }

            let voice_name = name.trim_end_matches(".npy").to_string();
            let mut data = Vec::new();
            file.read_to_end(&mut data).map_err(|e| format!("Read npy: {}", e))?;

            // Parse .npy: skip 128-byte header, rest is float32 data
            // NPY format: magic(6) + version(2) + header_len(2 or 4) + header + data
            if data.len() < 10 || &data[..6] != b"\x93NUMPY" {
                continue;
            }
            let header_len = if data[6] == 1 {
                u16::from_le_bytes([data[8], data[9]]) as usize
            } else {
                u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize
            };
            let data_start = if data[6] == 1 { 10 + header_len } else { 12 + header_len };

            if data_start >= data.len() { continue; }
            let float_data: Vec<f32> = data[data_start..]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();

            voices.insert(voice_name, float_data);
        }

        tracing::info!("[Kokoro] Loaded {} voices", voices.len());
        self.voices = voices;
        Ok(())
    }

    pub fn is_loaded(&self) -> bool {
        self.session.is_some()
    }

    pub fn voice_names(&self) -> Vec<String> {
        self.voices.keys().cloned().collect()
    }

    /// Synthesize text to audio samples (f32, 24kHz)
    pub fn synthesize(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        if !self.is_loaded() {
            return Err("Model not loaded".to_string());
        }

        let start = std::time::Instant::now();

        // 1. Text → IPA phonemes
        let phonemes = g2p::text_to_phonemes(text);
        let preview: String = text.chars().take(20).collect();
        tracing::info!("[Kokoro] Phonemes: {} chars from '{}...'", phonemes.len(), preview);
        if phonemes.is_empty() {
            return Err("No phonemes generated".to_string());
        }

        // 2. Phonemes → token IDs
        let tokens = tokenizer::phonemes_to_tokens(&phonemes);
        tracing::info!("[Kokoro] Tokens: {} ids", tokens.len());
        if tokens.len() <= 2 {
            return Err("No tokens generated".to_string());
        }

        // 3. Get voice style embedding [1, 256]
        // Style is indexed by phoneme CHAR count (kokoro-onnx convention: Python len(ps) = char count)
        // phonemes.len() would give UTF-8 byte count — wrong for multi-byte IPA chars (ˈ=3B, ː=3B, ə=2B...)
        let phoneme_chars = phonemes.chars().count();
        let total_styles = self.voices.get(voice).map(|v| v.len() / STYLE_DIM).unwrap_or(0);
        let style = self.get_style(voice, phoneme_chars)?;
        tracing::info!("[Kokoro] Style: {} floats (style_idx={}, total_styles={})", style.len(), phoneme_chars, total_styles);

        // 4. Run ONNX inference
        let session = self.session.as_mut().ok_or("No session")?;

        let n = tokens.len();
        let tokens_arr = Array1::from_vec(tokens);
        let tokens_2d = tokens_arr.into_shape_with_order((1, n)).map_err(|e| e.to_string())?;
        let style_arr = Array2::from_shape_vec((1, STYLE_DIM), style)
            .map_err(|e| format!("Style shape: {}", e))?;
        let speed_arr = Array1::from_vec(vec![speed]);

        tracing::info!("[Kokoro] Running ONNX inference (tokens={}, style=[1,{}], speed={})...", n, STYLE_DIM, speed);
        let outputs = session
            .run(ort::inputs![
                "tokens" => TensorRef::from_array_view(tokens_2d.view()).map_err(|e| e.to_string())?,
                "style" => TensorRef::from_array_view(style_arr.view()).map_err(|e| e.to_string())?,
                "speed" => TensorRef::from_array_view(speed_arr.view()).map_err(|e| e.to_string())?,
            ])
            .map_err(|e| format!("Inference: {}", e))?;
        tracing::info!("[Kokoro] Inference done in {:?}", start.elapsed());

        // FIX: Access output by index — the output tensor name varies by model version
        let (_, audio) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Extract audio: {}", e))?;

        tracing::info!(
            "[Kokoro] Synthesized {} samples in {:?}",
            audio.len(),
            start.elapsed()
        );

        Ok(audio.to_vec())
    }

    fn get_style(&self, voice: &str, phoneme_len: usize) -> Result<Vec<f32>, String> {
        let voice_data = self.voices.get(voice)
            .ok_or_else(|| format!("Voice '{}' not found", voice))?;

        // Voices are stored as [num_styles, 256] flat arrays.
        // Style is selected by phoneme string length (kokoro-onnx convention).
        let total_styles = voice_data.len() / STYLE_DIM;
        if total_styles == 0 {
            return Err(format!("Voice data too small: {} (need {})", voice_data.len(), STYLE_DIM));
        }
        let style_idx = phoneme_len.min(total_styles - 1);
        let start = style_idx * STYLE_DIM;
        let end = start + STYLE_DIM;

        Ok(voice_data[start..end].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn model_dir() -> PathBuf {
        PathBuf::from(r"C:\Users\barat\AppData\Roaming\ai.opencode.desktop.dev\speech\kokoro")
    }

    #[test]
    fn test_kokoro_load() {
        let mut engine = KokoroEngine::new();
        let dir = model_dir();
        let model = dir.join("kokoro-v1.0.onnx");
        let voices = dir.join("voices-v1.0.bin");
        println!("Model exists: {}", model.exists());
        println!("Voices exists: {}", voices.exists());
        engine.load(&model, &voices).unwrap();
        assert!(engine.is_loaded());
        let names = engine.voice_names();
        println!("Loaded {} voices", names.len());
        assert!(!names.is_empty());
    }

    #[test]
    fn test_kokoro_synthesize_hello() {
        let mut engine = KokoroEngine::new();
        let dir = model_dir();
        engine.load(&dir.join("kokoro-v1.0.onnx"), &dir.join("voices-v1.0.bin")).unwrap();

        println!("Synthesizing 'Hello world'...");
        let result = engine.synthesize("Hello world", "af_heart", 1.0);
        match &result {
            Ok(samples) => println!("OK: {} samples ({:.1}s at 24kHz)", samples.len(), samples.len() as f64 / 24000.0),
            Err(e) => println!("ERROR: {}", e),
        }
        let samples = result.unwrap();
        assert!(!samples.is_empty());
    }
}
