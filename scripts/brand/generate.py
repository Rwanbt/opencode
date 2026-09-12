#!/usr/bin/env python3
"""Regenerate every derived Unifia brand asset from brand/unifia/masters.

Reads brand/unifia/brand.config.json, writes the assets it declares, and
records what it produced in brand/unifia/brand-manifest.json. Running it twice
must leave the tree unchanged: `bun run brand:check` is what enforces that.

Requires Pillow. The check script deliberately does not, so CI can verify the
tree without an image toolchain.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

Entry = str | list  # sha256, or [sha256, width, height] for a PNG

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "brand" / "unifia" / "brand.config.json"
MANIFEST = REPO / "brand" / "unifia" / "brand-manifest.json"

# Every frame is resampled with LANCZOS here rather than left to the format
# plugin. Measured on this master: for ICO that is a no-op (Pillow's writer
# already uses LANCZOS, byte-identical either way), but ICNS output does change,
# so the filter used for the macOS icon would otherwise be a plugin
# implementation detail rather than something this file decides.
RESAMPLE = Image.Resampling.LANCZOS


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def describe(data: bytes) -> Entry:
    """Manifest entry for one asset: its hash, plus pixels for PNGs.

    Recording dimensions makes an icon set reviewable in the diff — the
    128x128@2x.png that shipped at 128x128 was invisible in a hash-only
    manifest. check.mjs re-derives them from the PNG header.
    """
    digest = sha256(data)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return digest
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return [digest, width, height]


def write_if_changed(path: Path, data: bytes) -> bool:
    """Write only on a real change, so reruns don't churn mtimes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


def render_png(master: Path, size: int) -> bytes:
    buf = io.BytesIO()
    with Image.open(master) as im:
        im.convert("RGBA").resize((size, size), RESAMPLE).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def render_multi(master: Path, sizes: list[int], fmt: str) -> bytes:
    buf = io.BytesIO()
    with Image.open(master) as im:
        base = im.convert("RGBA")
        frames = [base.resize((s, s), RESAMPLE) for s in sorted(sizes)]
    frames[-1].save(buf, fmt, sizes=[(s, s) for s in sorted(sizes)], append_images=frames[:-1])
    return buf.getvalue()


def stems_and_aliases(manifest: dict) -> tuple[list[str], dict[str, str]]:
    return [m["stem"] for m in manifest["masters"]], manifest["aliases"]


def generate_svg_sets(cfg: dict, manifest: dict, masters: Path) -> dict[str, Entry]:
    """Copy master SVGs, plus one copy per alias, into every declared set."""
    stems, aliases = stems_and_aliases(manifest)
    produced: dict[str, Entry] = {}
    for target in cfg["svgSets"]:
        out = REPO / target
        for name, stem in [(s, s) for s in stems] + list(aliases.items()):
            data = (masters / f"{stem}.svg").read_bytes()
            write_if_changed(out / f"{name}.svg", data)
            produced[f"{target}/{name}.svg"] = describe(data)
    return produced


def generate_rasters(cfg: dict, masters: Path, icon: str) -> dict[str, Entry]:
    produced: dict[str, Entry] = {}
    master = masters / f"{icon}.png"
    for entry in cfg["rasters"]:
        data = render_png(master, entry["size"])
        write_if_changed(REPO / entry["path"], data)
        produced[entry["path"]] = describe(data)
    for entry in cfg["icos"]:
        data = render_multi(master, entry["sizes"], "ICO")
        write_if_changed(REPO / entry["path"], data)
        produced[entry["path"]] = describe(data)
    return produced


def generate_copies(cfg: dict) -> dict[str, Entry]:
    """Mirror a brand source file verbatim to the packages that consume it.

    packages/app/src/styles/unifia-brand.css was a hand-made duplicate of
    brand/unifia/unifia.css — two copies of the same design tokens, with
    nothing keeping them in step. Deriving it removes the second owner.
    """
    produced: dict[str, Entry] = {}
    for entry in cfg.get("copies", []):
        data = (REPO / entry["from"]).read_bytes()
        write_if_changed(REPO / entry["to"], data)
        produced[entry["to"]] = describe(data)
    return produced


def generate_android_launcher(cfg: dict, masters: Path, icon: str) -> dict[str, Entry]:
    """Android home-screen icons, per density.

    These were still the upstream artwork: sampling them found only greys, while
    every Unifia master carries the brand purple and orange. The launcher icon is
    the most visible surface there is, and it was the one the rebrand missed.

    hdpi is 49px rather than the textbook 48 * 1.5 = 72 because that is the size
    the existing set uses; keeping it avoids a layout change on that density.
    """
    spec = cfg.get("androidLauncher")
    if not spec:
        return {}
    root = REPO / spec["dir"]
    produced: dict[str, Entry] = {}
    plans = [
        (spec["icon"], icon, ["ic_launcher.png", "ic_launcher_round.png"]),
        (spec["foreground"], spec.get("foregroundSource", icon), ["ic_launcher_foreground.png"]),
    ]
    for sizes, stem, names in plans:
        master = masters / f"{stem}.png"
        for density, size in sizes.items():
            data = render_png(master, size)
            for name in names:
                path = root / f"mipmap-{density}" / name
                write_if_changed(path, data)
                produced[f"{spec['dir']}/mipmap-{density}/{name}"] = describe(data)
    return produced


def generate_tauri_icons(cfg: dict, masters: Path, icon: str) -> dict[str, Entry]:
    spec = cfg["tauriIconSpec"]
    master = masters / f"{icon}.png"
    produced: dict[str, Entry] = {}
    for target in cfg["tauriIconSets"]:
        out = REPO / target
        for name, size in spec["png"].items():
            data = render_png(master, size)
            write_if_changed(out / name, data)
            produced[f"{target}/{name}"] = describe(data)
        for name, sizes in spec["ico"].items():
            data = render_multi(master, sizes, "ICO")
            write_if_changed(out / name, data)
            produced[f"{target}/{name}"] = describe(data)
        for name, sizes in spec["icns"].items():
            data = render_multi(master, sizes, "ICNS")
            write_if_changed(out / name, data)
            produced[f"{target}/{name}"] = describe(data)
    return produced


def verify_masters(manifest: dict, masters: Path) -> None:
    """A master whose bytes drifted from the manifest invalidates everything."""
    for entry in manifest["masters"]:
        for ext in ("svg", "png"):
            path = masters / f"{entry['stem']}.{ext}"
            if not path.exists():
                raise SystemExit(f"missing master: {path.relative_to(REPO)}")
            if sha256(path.read_bytes()) != entry[ext]:
                raise SystemExit(
                    f"master {path.relative_to(REPO)} does not match its manifest hash. "
                    "Update brand-manifest.json deliberately if the artwork really changed."
                )


def main() -> int:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    masters = REPO / cfg["masterDir"]
    verify_masters(manifest, masters)

    produced: dict[str, Entry] = {}
    produced.update(generate_svg_sets(cfg, manifest, masters))
    produced.update(generate_rasters(cfg, masters, cfg["primaryIcon"]))
    produced.update(generate_tauri_icons(cfg, masters, cfg["primaryIcon"]))
    produced.update(generate_android_launcher(cfg, masters, cfg["primaryIcon"]))
    produced.update(generate_copies(cfg))

    manifest["generatedBy"] = "scripts/brand/generate.py"
    manifest["generated"] = dict(sorted(produced.items()))
    # newline="" so Windows does not turn these into CRLF: .gitattributes pins
    # the repository to eol=lf, and a CRLF write shows up as a phantom diff.
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline=""
    )
    print(f"brand: {len(produced)} assets generated from {cfg['masterDir']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
