#!/usr/bin/env bash
# unifia-migrate.sh — Migration automatique opencode → unifia
# Usage: bash scripts/unifia-migrate.sh [--dry-run|--apply]
# Auteur: Hermes Agent (MiniMax M3) pour Unifia Workbench V3
# Date: 2026-07-31
#
# Ce script est appelé automatiquement au premier lancement de la v1.0
# de Unifia. Il migre les identifiants persistants de l'ancien fork
# opencode vers les nouveaux identifiants unifia, de manière non-breaking.
#
# Idempotent : peut être exécuté plusieurs fois sans risque.
# Dry-run par défaut : aucune modification, juste rapport.

set -euo pipefail

# === Configuration ===
MODE="${1:-dry-run}"  # dry-run (default) | apply
DRY_RUN=true
if [ "$MODE" = "--apply" ]; then
    DRY_RUN=false
elif [ "$MODE" = "--dry-run" ]; then
    DRY_RUN=true
elif [ "$MODE" = "--help" ] || [ "$MODE" = "-h" ]; then
    echo "Usage: $0 [--dry-run|--apply]"
    echo "  --dry-run: affiche les actions sans les exécuter (défaut)"
    echo "  --apply:   exécute la migration"
    exit 0
else
    echo "Usage: $0 [--dry-run|--apply]" >&2
    exit 1
fi

# === Couleurs ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_action() {
    if $DRY_RUN; then
        echo -e "${YELLOW}[DRY-RUN]${NC} Would: $1"
    else
        echo -e "${GREEN}[APPLY]${NC} $1"
    fi
}

# === Détection OS ===
detect_os() {
    case "$(uname -s)" in
        Darwin) OS="macos" ;;
        Linux) OS="linux" ;;
        CYGWIN*|MINGW*) OS="windows" ;;
        *) OS="unknown" ;;
    esac
    log_info "OS détecté: $OS"
}

# === Chemins XDG ===
get_paths() {
    case "$OS" in
        macos)
            HOME_DIR="${HOME:-/Users/$(whoami)}"
            DATA_DIR="$HOME_DIR/Library/Application Support"
            CONFIG_DIR="$HOME_DIR/Library/Application Support"
            CACHE_DIR="$HOME_DIR/Library/Caches"
            ;;
        linux)
            HOME_DIR="${HOME:-/home/$(whoami)}"
            DATA_DIR="${XDG_DATA_HOME:-$HOME_DIR/.local/share}"
            CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME_DIR/.config}"
            CACHE_DIR="${XDG_CACHE_HOME:-$HOME_DIR/.cache}"
            ;;
        windows)
            HOME_DIR="${USERPROFILE:-$(cygpath -u "$HOMEDRIVE\\$HOMEPATH")}"
            DATA_DIR="${APPDATA:-$HOME_DIR/AppData/Roaming}"
            CONFIG_DIR="${APPDATA:-$HOME_DIR/AppData/Roaming}"
            CACHE_DIR="${LOCALAPPDATA:-$HOME_DIR/AppData/Local}"
            ;;
        *)
            log_error "OS non supporté"
            exit 1
            ;;
    esac

    LEGACY_DIR="$CONFIG_DIR/opencode"
    NEW_DIR="$CONFIG_DIR/unifia"
}

# === Migration DB ===
migrate_db() {
    local legacy_db="$LEGACY_DIR/opencode.db"
    local new_db="$NEW_DIR/unifia.db"

    if [ -f "$new_db" ]; then
        log_info "DB déjà migrée : $new_db existe"
        return 0
    fi

    if [ -f "$legacy_db" ]; then
        log_action "Renommer $legacy_db → $new_db"
        if ! $DRY_RUN; then
            mkdir -p "$NEW_DIR"
            mv "$legacy_db" "$new_db"
        fi
    else
        log_info "Aucune DB legacy à migrer (normal pour nouvelle install)"
    fi
}

# === Migration config ===
migrate_config() {
    local legacy_config="$LEGACY_DIR/opencode.jsonc"
    local new_config="$NEW_DIR/unifia.jsonc"

    if [ -f "$new_config" ]; then
        log_info "Config déjà migrée : $new_config existe"
        return 0
    fi

    if [ -f "$legacy_config" ]; then
        log_action "Renommer $legacy_config → $new_config"
        if ! $DRY_RUN; then
            mkdir -p "$NEW_DIR"
            mv "$legacy_config" "$new_config"
        fi
    else
        log_info "Aucune config legacy à migrer"
    fi
}

# === Migration cache ===
migrate_cache() {
    local legacy_cache_dir="$CACHE_DIR/opencode"
    local new_cache_dir="$CACHE_DIR/unifia"

    if [ -d "$new_cache_dir" ]; then
        log_info "Cache déjà migré : $new_cache_dir existe"
        return 0
    fi

    if [ -d "$legacy_cache_dir" ]; then
        log_action "Renommer $legacy_cache_dir → $new_cache_dir"
        if ! $DRY_RUN; then
            mv "$legacy_cache_dir" "$new_cache_dir"
        fi
    else
        log_info "Aucun cache legacy à migrer"
    fi
}

# === Migration data dir (si différente de config) ===
migrate_data() {
    if [ "$DATA_DIR" != "$CONFIG_DIR" ]; then
        local legacy_data_dir="$DATA_DIR/opencode"
        local new_data_dir="$DATA_DIR/unifia"

        if [ -d "$new_data_dir" ]; then
            log_info "Data dir déjà migré : $new_data_dir existe"
            return 0
        fi

        if [ -d "$legacy_data_dir" ]; then
            log_action "Renommer $legacy_data_dir → $new_data_dir"
            if ! $DRY_RUN; then
                mv "$legacy_data_dir" "$new_data_dir"
            fi
        else
            log_info "Aucun data dir legacy à migrer"
        fi
    fi
}

# === Vérification post-migration ===
verify() {
    if $DRY_RUN; then
        log_info "Mode dry-run : aucune modification effectuée"
    else
        log_info "Migration terminée. Recommandation : redémarrer l'app Unifia."
    fi
}

# === Main ===
main() {
    log_info "=== Unifia migration script v1.0 ==="
    log_info "Mode: $MODE"
    detect_os
    get_paths
    log_info "Legacy dir: $LEGACY_DIR"
    log_info "New dir: $NEW_DIR"

    migrate_data
    migrate_db
    migrate_config
    migrate_cache
    verify
}

main
