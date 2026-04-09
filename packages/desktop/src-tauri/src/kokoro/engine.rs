//! Kokoro TTS ONNX engine.
//! Model: kokoro-v1.0.onnx (~310MB) + voices-v1.0.bin (~26MB)
//! License: Apache-2.0

use ndarray::{Array1, Array2, Array3};
use ort::{
    execution_providers::CPUExecutionProvider,
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use super::g2p;
use super::tokenizer;

const STYLE_DIM: usize = 256;

pub struct KokoroEngine {
    session: Option<Session>,
    voices: HashMap<String, Vec<f32>>,  // voice_name → flat f32 style data
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

        self.session = Some(
            Session::builder()
                .map_err(|e| e.to_string())?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| e.to_string())?
                .with_execution_providers([CPUExecutionProvider::default().build()])
                .map_err(|e| e.to_string())?
                .commit_from_file(model_path)
                .map_err(|e| format!("Load model: {}", e))?,
        );

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
        if phonemes.is_empty() {
            return Err("No phonemes generated".to_string());
        }

        // 2. Phonemes → token IDs
        let tokens = tokenizer::phonemes_to_tokens(&phonemes);
        if tokens.len() <= 2 {
            return Err("No tokens generated".to_string());
        }

        // 3. Get voice style embedding [1, 256]
        let style = self.get_style(voice)?;

        // 4. Run ONNX inference
        let session = self.session.as_mut().ok_or("No session")?;

        let n = tokens.len();
        let tokens_arr = Array1::from_vec(tokens);
        let tokens_2d = tokens_arr.into_shape_with_order((1, n)).map_err(|e| e.to_string())?;
        let style_arr = Array2::from_shape_vec((1, STYLE_DIM), style)
            .map_err(|e| format!("Style shape: {}", e))?;
        let speed_arr = Array1::from_vec(vec![speed]);

        let outputs = session
            .run(ort::inputs![
                "tokens" => TensorRef::from_array_view(tokens_2d.view()).map_err(|e| e.to_string())?,
                "style" => TensorRef::from_array_view(style_arr.view()).map_err(|e| e.to_string())?,
                "speed" => TensorRef::from_array_view(speed_arr.view()).map_err(|e| e.to_string())?,
            ])
            .map_err(|e| format!("Inference: {}", e))?;

        let (_, audio) = outputs["audio"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Extract audio: {}", e))?;

        tracing::info!(
            "[Kokoro] Synthesized {} samples in {:?}",
            audio.len(),
            start.elapsed()
        );

        Ok(audio.to_vec())
    }

    fn get_style(&self, voice: &str) -> Result<Vec<f32>, String> {
        let voice_data = self.voices.get(voice)
            .ok_or_else(|| format!("Voice '{}' not found", voice))?;

        // Style is [1, 256] — just the first 256 floats from the voice embedding
        if voice_data.len() < STYLE_DIM {
            return Err(format!("Voice data too small: {} (need {})", voice_data.len(), STYLE_DIM));
        }

        Ok(voice_data[..STYLE_DIM].to_vec())
    }
}
