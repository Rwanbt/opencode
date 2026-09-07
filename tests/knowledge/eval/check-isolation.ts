#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
/**
 * Script de validation P-1.2 : garantit que les fixtures dev/ et
 * holdout/ ne partagent ni `unifia_id` ni de chaîne normalisée
 * substantielle.
 *
 * Exit 0 = OK.
 * Exit 1 = contamination détectée.
 *
 * Usage : bun tests/knowledge/eval/check-isolation.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Fixture = {
  file: string;
  id: string | null;
  normalized: Set<string>;
};

const ROOT = import.meta.dir;

function collect(side: "dev" | "holdout"): Fixture[] {
  const dir = join(ROOT, side);
  const out: Fixture[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "README.md") continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (!stat.isFile()) continue;
    const text = readFileSync(file, "utf8");
    const idMatch = text.match(/^unifia_id:\s*"?([0-9a-f-]+)"?/m);
    const id = idMatch ? idMatch[1] : null;
    const body = text
      .replace(/^---[\s\S]*?---/m, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 5);
    const ngrams = new Set<string>();
    for (let i = 0; i + 5 <= body.length; i++) {
      ngrams.add(body.slice(i, i + 5).join(" "));
    }
    out.push({ file: relative(ROOT, file), id, normalized: ngrams });
  }
  return out;
}

const dev = collect("dev");
const holdout = collect("holdout");

let contamination = 0;

const devIds = new Map<string, string>();
for (const f of dev) {
  if (!f.id) {
    console.error(`[FAIL] dev fixture without unifia_id: ${f.file}`);
    contamination++;
    continue;
  }
  if (devIds.has(f.id)) {
    console.error(`[FAIL] duplicate dev id ${f.id} in ${f.file} and ${devIds.get(f.id)}`);
    contamination++;
  }
  devIds.set(f.id, f.file);
}

const holdoutIds = new Map<string, string>();
for (const f of holdout) {
  if (!f.id) {
    console.error(`[FAIL] holdout fixture without unifia_id: ${f.file}`);
    contamination++;
    continue;
  }
  if (holdoutIds.has(f.id)) {
    console.error(
      `[FAIL] duplicate holdout id ${f.id} in ${f.file} and ${holdoutIds.get(f.id)}`,
    );
    contamination++;
  }
  holdoutIds.set(f.id, f.file);
}

for (const [id, file] of holdoutIds) {
  if (devIds.has(id)) {
    console.error(`[FAIL] shared unifia_id ${id} between dev (${devIds.get(id)}) and holdout (${file})`);
    contamination++;
  }
}

const debug = process.argv.includes("--debug");

for (const hd of holdout) {
  for (const dv of dev) {
    const common: string[] = [];
    for (const ng of hd.normalized) {
      if (dv.normalized.has(ng)) common.push(ng);
    }
    if (common.length > 0) {
      console.error(
        `[FAIL] shared 5-gram in ${dv.file} <-> ${hd.file}: ${common.length} shared 5-grams`,
      );
      if (debug) {
        for (const c of common) console.error(`        "${c}"`);
      }
      contamination++;
    }
  }
}

if (contamination > 0) {
  console.error(`\n${contamination} contamination issue(s) detected.`);
  process.exit(1);
}

console.log(
  `[OK] dev=${dev.length} fixtures, holdout=${holdout.length} fixtures, no shared ids, no shared 5-grams.`,
);
