#!/usr/bin/env bash
# release-helper.sh — Automatise le release Unifia
# Usage: bash tools/release-helper.sh <version>

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "  Ex: $0 1.0.0"
    exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9.]+)?$ ]]; then
    echo -e "${RED}[ERROR]${NC} Invalid semver: $VERSION"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "================================================="
echo "  Unifia release-helper v$VERSION"
echo "================================================="

# === 1. Pre-flight checks ===
if [ -n "$(git status --short 2>/dev/null)" ]; then
    echo -e "${RED}[FAIL]${NC} Working tree is dirty"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Working tree clean"

if git tag -l "v$VERSION" | grep -q "v$VERSION"; then
    echo -e "${RED}[FAIL]${NC} Tag v$VERSION already exists"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Tag v$VERSION does not exist"

# === 2. Bump version ===
for f in package.json packages/contracts/package.json; do
    if [ -f "$f" ]; then
        echo "  Updating $f"
        python3 -c "
import json
with open('$f') as fh:
    d = json.load(fh)
if 'version' in d:
    d['version'] = '$VERSION'
with open('$f', 'w') as fh:
    json.dump(d, fh, indent=2)
"
    fi
done
echo -e "${GREEN}[OK]${NC} versions bumped"

# === 3. CHANGELOG ===
python3 << PYEOF
import datetime
with open('CHANGELOG.md') as f:
    content = f.read()
date = datetime.date.today().isoformat()
new_entry = f"## [{VERSION}] - {date}\n\n### Changed\n- Bump version to {VERSION}\n\n"
if '## [Unreleased]' in content:
    content = content.replace('## [Unreleased]\n', f'## [Unreleased]\n\n' + new_entry, 1)
else:
    content = new_entry + content
with open('CHANGELOG.md', 'w') as f:
    f.write(content)
PYEOF
echo -e "${GREEN}[OK]${NC} CHANGELOG updated"

# === 4. Commit + tag ===
git add -A
git commit -m "chore(release): v$VERSION" 2>&1 | tail -2
git tag -a "v$VERSION" -m "Release v$VERSION"
echo -e "${GREEN}[OK]${NC} Tag v$VERSION created"

# === 5. Bundle ===
mkdir -p /opt/data/work/unifia-sandbox/handoff
git bundle create /opt/data/work/unifia-sandbox/handoff/unifia-agent-result.bundle agent/integration 2>&1 | tail -1
echo -e "${GREEN}[OK]${NC} Bundle created"

echo
echo "Release v$VERSION ready"
echo "  Next: git push origin v$VERSION"
