# AI_SUMMARY — src

> **Auto-generated 2026-06-23 20:26** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Conversion texte→phonèmes IPA + tokenization IPA→IDs pour le moteur Kokoro v1.0.
Consommé par `packages/desktop/src-tauri/src/kokoro/engine.rs` et
`packages/mobile/src-tauri/src/kokoro/engine.rs` via `Engine::synthesize()`.
Existe parce que les deux backends Tauri avaient une copie byte-identique du code (DRY).

## Files & LOC
| File | LOC | |
|------|-----|--|
| `g2p.rs` | 220 | |
| `lib.rs` | 11 | |
| `tokenizer.rs` | 179 | |
| **Total** | **410** | |

## Rust API

## Rust Functions
- `phonemes_to_tokens()`
- `text_to_phonemes()`
