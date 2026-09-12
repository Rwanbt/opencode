#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:-dev}"
excluded_regex='(^|/)(bun\.lock|package-lock\.json|pnpm-lock\.yaml)$'
generated_regex='(^|/)(dist|build|target|generated)(/|$)'

changed_lines=0

while IFS=$'\t' read -r added deleted path; do
  [[ -z "${path:-}" ]] && continue
  normalized_path="${path//\\//}"
  [[ "$normalized_path" =~ $excluded_regex ]] && continue
  [[ "$normalized_path" =~ $generated_regex ]] && continue
  [[ "$added" =~ ^[0-9]+$ ]] && ((changed_lines += added))
  [[ "$deleted" =~ ^[0-9]+$ ]] && ((changed_lines += deleted))
done < <(git diff --numstat "$base_ref")

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  normalized_path="${path//\\//}"
  [[ "$normalized_path" =~ $excluded_regex ]] && continue
  [[ "$normalized_path" =~ $generated_regex ]] && continue
  [[ -f "$path" ]] && changed_lines=$((changed_lines + $(wc -l < "$path")))
done < <(git ls-files --others --exclude-standard)

echo "Changed lines (excluding generated and lockfiles): $changed_lines"
if (( changed_lines > 400 )); then
  echo "PR size limit exceeded: $changed_lines lines > 400" >&2
  exit 1
fi
