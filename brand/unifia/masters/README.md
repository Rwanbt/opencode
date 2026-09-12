# Unifia brand masters

The 15 approved logo variants, each as an SVG and a PNG. This directory is the
**only** input the brand generator reads. Nothing under `brand/` resolves a path
outside the repository, so a fresh clone can regenerate every derived asset —
decision A9 of the rebrand plan.

Provenance: imported from `D:\App\rebrand-unifia\Unifia_Brand_Kit_v1_3`
(equivalently `D:\téléchargement\unifia-logo`) on 2026-08-08. All 30 files were
verified byte-for-byte against the SHA-256 hashes already recorded in
`../brand-manifest.json` before being committed, so the import provably carries
the same artwork the manifest was built from. That external kit is now
provenance only: it is not a build input.

## The PNG masters are 400x400

Every PNG master is 400x400. The approved kit's own 512, 1024 and 1600 exports
are LANCZOS upscales of that 400px raster, not re-rasterizations of the SVG —
verified: regenerating 512 from `unifia-app-icon-dark.png` reproduces the kit's
`unifia-app-icon-dark-512.png` byte-for-byte (48 600 bytes,
`d9f926d94d7f...`).

The generator reproduces that approved chain rather than substituting its own
SVG rasterizer, which would change every shipped icon's bytes and pull an SVG
rendering engine into the build. The consequence is real and worth stating: app
icons above 400px are upscaled, so they are softer than a true vector render.

Lifting that ceiling means re-exporting the PNG masters from the SVGs at 1024 or
1600 in the design tool, dropping them here, and regenerating. It is a brand
decision, not a code change.
