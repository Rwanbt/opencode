//! Small shared helpers for the desktop Rust crate.

use std::sync::{Mutex, MutexGuard};

/// Extension trait: acquire a `MutexGuard` tolerantly. If the mutex is
/// poisoned (a previous holder panicked) we log a warning and recover the
/// inner guard instead of propagating the panic.
///
/// Rationale: panicking in a Tauri command is loud and non-recoverable — one
/// panic in the audio/LLM pipeline would cascade-poison the shared state and
/// permanently break TTS/STT/LLM until the app is restarted. The state we
/// protect here (child processes, model-load flags, engine handles) is
/// idempotent across calls, so recovering after a panic is safer than
/// killing the app.
pub trait MutexSafe<T> {
    fn lock_safe(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexSafe<T> for Mutex<T> {
    fn lock_safe(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|p| {
            tracing::warn!("recovering from poisoned mutex");
            p.into_inner()
        })
    }
}
