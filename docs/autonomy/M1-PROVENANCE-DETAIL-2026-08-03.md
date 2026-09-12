# M1 Provenance Detail — 2026-08-03

> Path-level provenance inventory for **Open Cowork** skills (`.claude/skills/**`),
> the **skill runtime layer** (`src/main/skills/**`), and the **renderer i18n**
> bundle (`src/renderer/i18n/**`). This report closes the M1 (Inventaire de
> provenance) gap left by the upstream-audit pass; it does **not** import, copy
> or move any file.

- **Audit date:** 2026-08-03
- **Branch (audit working copy):** `recovery/unifia-audit-correction-20260803`
- **Local audit working copy:** `D:\App\OpenCode\unifia-execution-clean`
- **Upstream bare repo inspected:** `D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git`
- **Role:** bounded evidence executor. No commit, no push, no release, no runtime edit.
- **Allowed write target:** this file only.

---

## 1. Reproducible evidence commands

All three path sets and their licence markers were extracted by direct read against
the upstream bare repo at its current `HEAD`. No file was opened in the audit
working copy; only `git --git-dir <bare> …` invocations were used.

```bash
# 1. Pin the exact commit under audit
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git rev-parse HEAD
# -> ec5bd270861fd4531bda44554766b8b5bd009242

# 2. Enumerate the full tree at that commit
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git \
    ls-tree -r --name-only HEAD

# 3. Spot-read the licence markers
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:LICENSE
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:.claude/skills/docx/LICENSE.txt
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:.claude/skills/pdf/LICENSE.txt
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:.claude/skills/pptx/LICENSE.txt
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:.claude/skills/skill-creator/LICENSE.txt
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:.claude/skills/xlsx/LICENSE.txt
```

### 1.1 Pinned commit metadata

| Field | Value |
|---|---|
| `HEAD` (full) | `ec5bd270861fd4531bda44554766b8b5bd009242` |
| `HEAD` (short) | `ec5bd27` |
| Subject | `feat(mcp): support 2026-07-28 protocol (#318)` |
| Author | Qihan \<3045019481@qq.com\> |
| Author date | 2026-07-31 11:46:00 +0800 |
| Committer | GitHub \<noreply@github.com\> |
| Total files in tree at `HEAD` | 596 |

---

## 2. Root-level licence

`LICENSE` (at repo root, `git show HEAD:LICENSE`):

> **MIT License** — Copyright (c) 2026 OpenCoworkAI
>
> Standard MIT terms: grant of rights (use, copy, modify, merge, publish,
> distribute, sublicense, sell) with the condition that the copyright notice
> and permission notice be preserved in substantial copies. No additional
> restrictions, no patent grant, no trademark grant, no source-available
> clause.

This is the **only** licence that applies by default to any file in the
upstream tree that does not carry its own nested licence marker. It is
**compatible** with `LICENSE` files we already ship in this working copy.

---

## 3. Path set A — `.claude/skills/**` (138 files, 5 sub-skills)

This directory is the **built-in skill bundle** that
`src/main/skills/skills-manager.ts` discovers at runtime (it iterates over
`.claude/skills/` to parse each `SKILL.md`).

| Sub-skill | Files | Nested licence path | Licence type |
|---|---:|---|---|
| `.claude/skills/docx/` | 60 | `.claude/skills/docx/LICENSE.txt` | Anthropic-restricted (proprietary) |
| `.claude/skills/pdf/` | 11 | `.claude/skills/pdf/LICENSE.txt` | Anthropic-restricted (proprietary) |
| `.claude/skills/pptx/` | 57 | `.claude/skills/pptx/LICENSE.txt` | Anthropic-restricted (proprietary) |
| `.claude/skills/skill-creator/` | 7 | `.claude/skills/skill-creator/LICENSE.txt` | **Apache License 2.0** |
| `.claude/skills/xlsx/` | 3 | `.claude/skills/xlsx/LICENSE.txt` | Anthropic-restricted (proprietary) |
| **Total** | **138** | — | mixed (4 × restricted + 1 × Apache-2.0) |

Verification: each per-sub-skill count is the count of `git ls-tree -r --name-only
HEAD` entries whose second path segment equals the sub-skill name; the five
counts sum to 138, which matches the global `.claude/skills/*` filter.

### 3.1 Anthropic-restricted licence terms (verbatim, applied to `docx`, `pdf`, `pptx`, `xlsx`)

The four restricted `LICENSE.txt` files are textually identical
(`git show` output verified for all four):

> © 2025 Anthropic, PBC. All rights reserved.
>
> **LICENSE:** Use of these materials (including all code, prompts, assets,
> files, and other components of this Skill) is governed by your agreement
> with Anthropic regarding use of Anthropic's services. If no separate
> agreement exists, use is governed by Anthropic's Consumer Terms of Service
> or Commercial Terms of Service, as applicable:
> <https://www.anthropic.com/legal/consumer-terms>
> <https://www.anthropic.com/legal/commercial-terms>
> Your applicable agreement is referred to as the "Agreement." "Services" are
> as defined in the Agreement.
>
> **ADDITIONAL RESTRICTIONS:** Notwithstanding anything in the Agreement to
> the contrary, users may not:
> - Extract these materials from the Services or retain copies of these
>   materials outside the Services
> - Reproduce or copy these materials, except for temporary copies created
>   automatically during authorized use of the Services
> - Create derivative works based on these materials
> - Distribute, sublicense, or transfer these materials to any third party
> - Make, offer to sell, sell, or import any inventions embodied in these
>   materials
> - Reverse engineer, decompile, or disassemble these materials
>
> The receipt, viewing, or possession of these materials does not convey or
> imply any license or right beyond those expressly granted above.
>
> Anthropic retains all right, title, and interest in these materials,
> including all copyrights, patents, and other intellectual property rights.

### 3.2 Apache 2.0 licence terms (`.claude/skills/skill-creator/LICENSE.txt`)

Verified full Apache License 2.0 text at
`git show HEAD:.claude/skills/skill-creator/LICENSE.txt`. Key obligations
relevant to any downstream distribution:

- **§4(a)** every recipient must receive a copy of the licence.
- **§4(b)** modified files must carry prominent notices.
- **§4(c)** retain copyright / patent / trademark / attribution notices in
  the Source form of any Derivative Works.
- **§4(d)** if a `NOTICE` file exists, propagate it. (No `NOTICE` file is
  shipped in this sub-skill, so §4(d) is vacuous here.)
- **§3** patent retaliation clause — patent licences terminate if the
  licensee files patent litigation alleging the Work is infringing.
- No trademark grant (§6); no warranty (§7); limitation of liability (§8).

### 3.3 No other licence / notice markers inside `.claude/skills/`

A tree-wide scan for filenames matching `LICENSE|NOTICE|COPYING|CREDITS|AUTHORS|THIRD.?PARTY|ATTRIBUTION`
(case-insensitive, full repo) returned exactly:

```
.claude/skills/docx/LICENSE.txt
.claude/skills/pdf/LICENSE.txt
.claude/skills/pptx/LICENSE.txt
.claude/skills/skill-creator/LICENSE.txt
.claude/skills/xlsx/LICENSE.txt
LICENSE                                    # root project licence (MIT) — see §2
src/renderer/components/GlobalNoticeToast.tsx   # false positive: UI component, not a notice file
```

**No `NOTICE`, `AUTHORS`, `CREDITS`, `COPYING`, `THIRD_PARTY` or
`ATTRIBUTION` file is present anywhere in the upstream tree at `ec5bd27`.**
There is no nested notice text inside any of the five `LICENSE.txt` files
beyond the licence text itself.

---

## 4. Path set B — `src/main/skills/**` (5 files)

These files are the **skill runtime layer** of Open Cowork itself (NOT
Anthropic skills). They are loaded into the local TypeScript build and
discover / load the contents of `.claude/skills/` at runtime.

| Path | Role |
|---|---|
| `src/main/skills/skills-manager.ts` | Skill discovery & lifecycle loader (parses `SKILL.md` front-matter, watches `.claude/skills/` via chokidar) |
| `src/main/skills/skills-adapter.ts` | Adapter that bridges runtime ↔ UI |
| `src/main/skills/plugin-catalog-service.ts` | Plugin catalog service |
| `src/main/skills/plugin-registry-store.ts` | Plugin registry persistence |
| `src/main/skills/plugin-runtime-service.ts` | Plugin runtime execution |

**Nested licence markers:** **none.** No `LICENSE` / `NOTICE` / `COPYING` /
`AUTHORS` / `THIRD_PARTY` / `ATTRIBUTION` file is present under
`src/main/skills/`.

**Governing licence:** root `LICENSE` (MIT, §2). Compatible with our own
licence policy.

---

## 5. Path set C — `src/renderer/i18n/**` (4 files)

| Path | Role |
|---|---|
| `src/renderer/i18n/README.md` | Project-internal usage doc (Chinese — `react-i18next` usage guide; not a licence) |
| `src/renderer/i18n/config.ts` | `i18next` / `react-i18next` initialisation (browser language detection, localStorage persistence) |
| `src/renderer/i18n/locales/en.json` | English locale resources |
| `src/renderer/i18n/locales/zh.json` | Chinese locale resources |

**Nested licence markers:** **none.** No `LICENSE` / `NOTICE` / `COPYING` /
`AUTHORS` / `THIRD_PARTY` / `ATTRIBUTION` file is present under
`src/renderer/i18n/`. The `README.md` is internal usage documentation, not a
licence or notice.

**Governing licence:** root `LICENSE` (MIT, §2). Compatible with our own
licence policy.

**Third-party runtime dependencies of `config.ts`** (declarative — not
re-exported source):

- `i18next` (MIT)
- `react-i18next` (MIT)
- `i18next-browser-languagedetector` (MIT)

These are npm dependencies declared in `package.json`, not vendored source.
Provenance responsibility for them sits with the package-lock, not in this
report.

---

## 6. Decision matrix

| Path set | Subset | Licence | Decision | Rationale (one-line) |
|---|---|---|---|---|
| A — `.claude/skills/**` | `docx/` | Anthropic restricted | **EXCLUDE** | Licence explicitly forbids extraction, copying, derivative works, distribution, sublicensing, transfer. Importing the bundle = violation. |
| A — `.claude/skills/**` | `pdf/` | Anthropic restricted | **EXCLUDE** | Same terms as `docx/`. |
| A — `.claude/skills/**` | `pptx/` | Anthropic restricted | **EXCLUDE** | Same terms as `docx/`. |
| A — `.claude/skills/**` | `xlsx/` | Anthropic restricted | **EXCLUDE** | Same terms as `docx/`. |
| A — `.claude/skills/**` | `skill-creator/` | Apache 2.0 | **REVIEW_PER_COMPONENT** | Apache 2.0 is permissive but non-trivial: requires licence copy propagation (§4a), file-level modification notices (§4b), attribution preservation (§4c), and patent-retaliation awareness (§3). Per-file review required before any adoption. |
| B — `src/main/skills/**` | (all 5 files) | Root MIT | **ADOPT** | Project-internal runtime code, MIT, no nested restrictions, no third-party obligations. |
| C — `src/renderer/i18n/**` | (all 4 files) | Root MIT | **REVIEW_PER_COMPONENT** | Project-internal i18n configuration + locales, MIT, no nested restrictions. Translations are project-owned strings, not third-party. |

**No path set is rated `BLOCKED`.** A `BLOCKED` rating would mean we cannot
even read the licence text; here every licence is in the public tree and was
read end-to-end. The four Anthropic-restricted sub-skills are `EXCLUDE`, not
`BLOCKED` — they are excluded by their own terms, not by a missing artefact.

---

## 7. Explicit import statement

> **No file from the upstream `open-cowork.git` repo at commit
> `ec5bd270861fd4531bda44554766b8b5bd009242` was imported, copied, vendored,
> copied-into-the-audit-working-copy, or otherwise incorporated into this
> working copy (`D:\App\OpenCode\unifia-execution-clean`) as a result of
> this audit pass.**
>
> All file contents referenced in this report were read **in place** via
> `git --git-dir <bare> show HEAD:<path>` against the upstream bare repo and
> were not extracted to disk in this working copy. The audit working copy's
> working tree was clean before this report was authored and contains only
> the new file `docs/autonomy/M1-PROVENANCE-DETAIL-2026-08-03.md` after this
> report is written.

---

## 8. STOP-condition audit

Per the task card, a STOP report is required if any of the following holds.
Each is checked here against the verified evidence.

| STOP condition | Triggered? | Why |
|---|---|---|
| Commit / path cannot be reproduced | **No** | `git rev-parse HEAD` and `git ls-tree -r --name-only HEAD` both succeeded; all 138 + 5 + 4 = **147** files enumerated and counted. |
| Nested licence is unclear | **No** | All 5 nested `LICENSE.txt` files were read end-to-end. Three licence families identified: MIT (root), Anthropic-restricted proprietary (4 sub-skills), Apache 2.0 (1 sub-skill). Each is a published, well-known licence. |
| Requested source is absent | **No** | The upstream bare repo at `D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git` exists (`Test-Path -PathType Container` → `True`), contains the pinned `HEAD` `ec5bd27`, and exposes all three required path sets (138 + 5 + 4 files). |

No STOP triggered → this report is **GO**.

---

## 9. Expected checks (post-write)

- `git diff --check` — must report no whitespace errors after this file is
  authored.
- `git status --short` — must list exactly one entry:
  `?? docs/autonomy/M1-PROVENANCE-DETAIL-2026-08-03.md` (or the equivalent
  after `git add`).
- No other file in the audit working copy may be created, modified, deleted
  or renamed as a side effect of this pass.

— end of report —
