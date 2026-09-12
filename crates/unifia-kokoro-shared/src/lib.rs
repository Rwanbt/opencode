//! Shared Kokoro TTS helpers.
//!
//! Historically `kokoro/g2p.rs` and `kokoro/tokenizer.rs` were byte-identical
//! copies across `packages/desktop/src-tauri/src/` and
//! `packages/mobile/src-tauri/src/`. That meant any fix landed twice (or
//! worse, once, and drifted) and the audit flagged it as structural debt.
//!
//! This crate hosts the shared sources; the desktop and mobile Tauri crates
//! now consume it as a path dependency.

pub mod g2p;
pub mod tokenizer;
