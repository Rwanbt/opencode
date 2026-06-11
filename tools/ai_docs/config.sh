#!/usr/bin/env bash
# config.sh — Machine-specific paths for the AI optimization stack.
# Source this file from run_hook.sh / generate_all.py wrappers.
# Values here override the defaults in STEP 0 of /verify-ai-docs.
# shellcheck disable=SC2034  # Variables exported for sourcing scripts

PROJECT_NAME="OpenCode"

# graphify binary (adjust if installed elsewhere)
GRAPHIFY_BIN="${GRAPHIFY_BIN:-/d/App/graphify/bin/graphify}"

# Obsidian vault
OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/d/Documents/Obsidian/IA_Dev_Brain}"
OBSIDIAN_PROJECT_DIR="OpenCode"
OBSIDIAN_MEMORY_FILE="OpenCode/_memory/memory.md"
OBSIDIAN_LOG_FILE="LOG.md"

# Claude Code memory key (matches ~/.claude/projects/ subfolder)
CLAUDE_MEMORY_ROOT="${CLAUDE_MEMORY_ROOT:-$HOME/.claude/projects}"
CLAUDE_MEMORY_KEY="d--App-OpenCode"
