# AI_CONTEXT — opencode-kokoro-shared

> Moteur TTS Kokoro (grapheme→phoneme + tokenizer) partagé entre desktop et mobile.
> Crate Rust `std`-only, extraction justifiée d'une duplication byte-identique.

## Purpose

Conversion texte→phonèmes IPA + tokenization IPA→IDs pour le moteur Kokoro v1.0.
Consommé par `packages/desktop/src-tauri/src/kokoro/engine.rs` et
`packages/mobile/src-tauri/src/kokoro/engine.rs` via `Engine::synthesize()`.
Existe parce que les deux backends Tauri avaient une copie byte-identique du code (DRY).

## Thread model

| Composant | Thread | Notes |
|---|---|---|
| `load_cmudict` / `load_vocab` (init) | Any | Une fois, via `OnceLock` (lock-free ensuite) |
| `text_to_phonemes` / `phonemes_to_tokens` | Synthesize (UI/latence) | Pas un callback RT, mais chemin de latence utilisateur direct |

Pas de callback audio temps-réel ici — la synthesis produit un buffer complet consommé par ONNX.

## Constraints

- `std`-only : aucune dépendance externe (supply-chain minimaliste, à préserver).
- Dictionnaire CMUDict (3,7 Mo) embarqué via `include_str!` → zéro I/O fichier au runtime.
- Tokens en `i64` : ONNX attend `i64`, ne pas caster côté appelant.

## Forbidden

- Ajouter une dépendance crate (casserait le bénéfice `std`-only).
- Mutex sur le chemin `synthesize` (`OnceLock` est lock-free en lecture, le rester).
- I/O fichier au runtime (le dictionnaire est compile-time).

## Common failure modes

- **Phonème silencieusement supprimé** : `arpa_to_ipa` fait `.unwrap_or("")` (`g2p.rs:33`) et `tokenizer` skip les IPA inconnus (`tokenizer.rs:48`) → audio faux indétectable. À corriger (log + compte).
- **Régression table ARPABET/vocab** : aucune test golden → toute modif régresse sans alerte.
- **Globaux `static`** sans `// WHY:` : `CMUDICT` (`g2p.rs:7`) et `VOCAB` (`tokenizer.rs:7`) — usage légitime (read-only) mais documenter.

## Hot files

- `src/g2p.rs` — chargement CMUDict + conversion texte→IPA (chemin de latence ; hits dict zero-alloc via `Cow<'static, str>`, `current_word` construit minuscule)
- `src/tokenizer.rs` — vocab IPA→token-ID (char inconnus comptés + avertis, plus silencieux)

## See also

- `packages/desktop/src-tauri/src/kokoro/engine.rs` — consommateur desktop
- `packages/mobile/src-tauri/src/kokoro/engine.rs` — consommateur mobile
- Audit qualité 2026-06-23 : 7/10 → 10/10 (bugs swallow fixés, 14 tests golden, leviers perf Cow+split_once)
