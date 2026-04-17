//! Parakeet TDT 0.6B v3 (INT8) inference engine.
//! Uses NVIDIA Parakeet ASR model via ONNX Runtime.
//! Model license: CC-BY-4.0 (NVIDIA)
//!
//! Pipeline: audio → mel spectrogram (nemo128) → encoder → greedy RNN-T decoder → text

use ndarray::{Array1, Array2, Array3, ArrayD, Axis, IxDyn};
use ort::{
    execution_providers::CPUExecutionProvider,
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use std::path::Path;

const MAX_TOKENS_PER_STEP: usize = 10;

pub struct ParakeetEngine {
    preprocessor: Option<Session>,
    encoder: Option<Session>,
    decoder_joint: Option<Session>,
    vocab: Vec<String>,
    vocab_size: usize,
    blank_idx: i32,
}

impl ParakeetEngine {
    pub fn new() -> Self {
        Self {
            preprocessor: None,
            encoder: None,
            decoder_joint: None,
            vocab: Vec::new(),
            vocab_size: 0,
            blank_idx: 0,
        }
    }

    fn make_session(path: &Path) -> Result<Session, String> {
        Session::builder()
            .map_err(|e| e.to_string())?
            .with_config_entry("session.log_severity_level", "3")
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .with_execution_providers([CPUExecutionProvider::default().build()])
            .map_err(|e| e.to_string())?
            .with_memory_pattern(false)
            .map_err(|e| e.to_string())?
            .with_parallel_execution(false)
            .map_err(|e| e.to_string())?
            .commit_from_file(path)
            .map_err(|e| format!("Load {}: {}", path.display(), e))
    }

    pub fn load(&mut self, model_dir: &Path) -> Result<(), String> {
        tracing::info!("[Parakeet] Loading models...");

        self.preprocessor = Some(Self::make_session(&model_dir.join("nemo128.onnx"))?);
        self.encoder = Some(Self::make_session(&model_dir.join("encoder-model.int8.onnx"))?);
        self.decoder_joint = Some(Self::make_session(&model_dir.join("decoder_joint-model.int8.onnx"))?);

        // Load vocab: format "token id" per line
        let vp = model_dir.join("vocab.txt");
        let content = std::fs::read_to_string(&vp).map_err(|e| e.to_string())?;
        let mut max_id = 0usize;
        let mut entries = Vec::new();
        let mut blank_idx: Option<usize> = None;

        for line in content.lines() {
            let parts: Vec<&str> = line.trim().split(' ').collect();
            if parts.len() >= 2
                && let Ok(id) = parts[1].parse::<usize>() {
                    if parts[0] == "<blk>" { blank_idx = Some(id); }
                    max_id = max_id.max(id);
                    entries.push((parts[0].to_string(), id));
                }
        }

        let mut vocab = vec![String::new(); max_id + 1];
        for (token, id) in entries {
            vocab[id] = token.replace('\u{2581}', " ");
        }

        self.vocab_size = vocab.len();
        self.blank_idx = blank_idx.unwrap_or(max_id) as i32;
        self.vocab = vocab;

        tracing::info!("[Parakeet] Ready: {} tokens, blank_idx={}", self.vocab_size, self.blank_idx);
        Ok(())
    }

    pub fn is_loaded(&self) -> bool {
        self.preprocessor.is_some()
    }

    pub fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        if !self.is_loaded() { return Err("Not loaded".to_string()); }

        let start = std::time::Instant::now();
        let vocab_size = self.vocab_size;
        let blank_idx = self.blank_idx;

        // Take sessions out to avoid borrow conflicts
        let mut pp = self.preprocessor.take().unwrap();
        let mut enc = self.encoder.take().unwrap();
        let mut dec = self.decoder_joint.take().unwrap();

        let result = (|| -> Result<String, String> {

        // 1. Preprocess: audio → mel features
        let waveforms = ArrayD::from_shape_vec(IxDyn(&[1, samples.len()]), samples.to_vec())
            .map_err(|e| e.to_string())?;
        let waveforms_lens = ArrayD::from_shape_vec(IxDyn(&[1]), vec![samples.len() as i64])
            .map_err(|e| e.to_string())?;

        let pp_out = pp.run(ort::inputs![
            "waveforms" => TensorRef::from_array_view(waveforms.view()).map_err(|e| e.to_string())?,
            "waveforms_lens" => TensorRef::from_array_view(waveforms_lens.view()).map_err(|e| e.to_string())?,
        ]).map_err(|e| format!("Preprocess: {}", e))?;

        let features: ArrayD<f32> = pp_out["features"].try_extract_array::<f32>().map_err(|e| e.to_string())?.to_owned();
        let features_lens: ArrayD<i64> = pp_out["features_lens"].try_extract_array::<i64>().map_err(|e| e.to_string())?.to_owned();

        // 2. Encode: mel → encoder output
        let t1 = std::time::Instant::now();
        let enc_out = enc.run(ort::inputs![
            "audio_signal" => TensorRef::from_array_view(features.view()).map_err(|e| e.to_string())?,
            "length" => TensorRef::from_array_view(features_lens.view()).map_err(|e| e.to_string())?,
        ]).map_err(|e| format!("Encode: {}", e))?;

        let encoder_output: ArrayD<f32> = enc_out["outputs"].try_extract_array::<f32>().map_err(|e| e.to_string())?.to_owned();
        let encoded_lengths: ArrayD<i64> = enc_out["encoded_lengths"].try_extract_array::<i64>().map_err(|e| e.to_string())?.to_owned();
        // Permute [batch, dim, time] → [batch, time, dim]
        let encoder_output = encoder_output.permuted_axes(IxDyn(&[0, 2, 1])).to_owned();
        let enc_len = encoded_lengths.as_slice().unwrap()[0] as usize;
        tracing::info!("[Parakeet] Encode: {:?}, {} steps", t1.elapsed(), enc_len);

        // 3. Greedy decode (RNN-T style, matching Murmure's decode_sequence)
        let t2 = std::time::Instant::now();

        // Get hidden size from decoder model inputs
        let state_shape = &dec.inputs.iter()
            .find(|i| i.name == "input_states_1").ok_or("Missing input_states_1")?
            .input_type.tensor_shape().ok_or("No shape for states")?;
        let hidden = state_shape[2] as usize;

        let mut state1 = Array3::<f32>::zeros((state_shape[0] as usize, 1, hidden));
        let mut state2 = Array3::<f32>::zeros((state_shape[0] as usize, 1, hidden));
        let mut tokens: Vec<i32> = Vec::new();
        let mut t = 0usize;
        let mut emitted = 0usize;

        // Get single-batch encoder output: [time, dim]
        let encodings = encoder_output.slice(ndarray::s![0, .., ..]).to_owned();

        while t < enc_len {
            let target_token = tokens.last().copied().unwrap_or(blank_idx);

            // encoder_step: slice [t, :] → insert axes → [1, dim, 1]
            let step = encodings.slice(ndarray::s![t, ..]).to_owned().into_dyn();
            let step_3d = step.insert_axis(Axis(0)).insert_axis(Axis(2));

            let targets = Array2::from_shape_vec((1, 1), vec![target_token]).map_err(|e| e.to_string())?;
            let target_length = Array1::from_vec(vec![1i32]);

            let dec_out = dec.run(ort::inputs![
                "encoder_outputs" => TensorRef::from_array_view(step_3d.view()).map_err(|e| e.to_string())?,
                "targets" => TensorRef::from_array_view(targets.view()).map_err(|e| e.to_string())?,
                "target_length" => TensorRef::from_array_view(target_length.view()).map_err(|e| e.to_string())?,
                "input_states_1" => TensorRef::from_array_view(state1.view()).map_err(|e| e.to_string())?,
                "input_states_2" => TensorRef::from_array_view(state2.view()).map_err(|e| e.to_string())?,
            ]).map_err(|e| format!("Decoder step {}: {}", t, e))?;

            if t == 0 {
                tracing::info!("[Parakeet] First decoder step: {:?}", t2.elapsed());
            }

            let logits: ArrayD<f32> = dec_out["outputs"].try_extract_array::<f32>().map_err(|e| e.to_string())?.to_owned();
            let new_s1: ArrayD<f32> = dec_out["output_states_1"].try_extract_array::<f32>().map_err(|e| e.to_string())?.to_owned();
            let new_s2: ArrayD<f32> = dec_out["output_states_2"].try_extract_array::<f32>().map_err(|e| e.to_string())?.to_owned();

            let logits_flat = logits.as_slice().unwrap();
            let vl = vocab_size.min(logits_flat.len());
            let vocab_logits = &logits_flat[..vl];

            let token = vocab_logits.iter().enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
                .map(|(i, _)| i as i32)
                .unwrap_or(blank_idx);

            if token != blank_idx {
                state1 = new_s1.into_dimensionality().map_err(|e| e.to_string())?;
                state2 = new_s2.into_dimensionality().map_err(|e| e.to_string())?;
                tokens.push(token);
                emitted += 1;
            }

            // Advance time step: blank or max tokens per step reached
            if token == blank_idx || emitted >= MAX_TOKENS_PER_STEP {
                t += 1;
                emitted = 0;
            }
        }

        tracing::info!("[Parakeet] Decode: {:?}, {} tokens", t2.elapsed(), tokens.len());

        // 4. Tokens → text
        let text: String = tokens.iter()
            .filter_map(|&id| self.vocab.get(id as usize))
            .cloned()
            .collect::<String>()
            .trim()
            .to_string();

        tracing::info!("[Parakeet] Total: {:?}", start.elapsed());
        Ok(text)

        })();

        self.preprocessor = Some(pp);
        self.encoder = Some(enc);
        self.decoder_joint = Some(dec);
        result
    }
}
