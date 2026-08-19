#!/usr/bin/env bash
# recipes/ 안의 .md 파일 목록을 recipes/index.json 매니페스트로 생성한다.
# 사용법 (WSL, Git Bash 등): bash gen-manifest.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECIPES_DIR="$SCRIPT_DIR/recipes"
OUT_FILE="$RECIPES_DIR/index.json"

if [ ! -d "$RECIPES_DIR" ]; then
  echo "오류: recipes 디렉터리를 찾을 수 없습니다: $RECIPES_DIR" >&2
  exit 1
fi

files=()
while IFS= read -r -d '' f; do
  files+=("$(basename "$f")")
done < <(find "$RECIPES_DIR" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

{
  printf '[\n'
  for i in "${!files[@]}"; do
    name=${files[$i]}
    esc=${name//\\/\\\\}
    esc=${esc//\"/\\\"}
    if [ "$i" -lt $((${#files[@]} - 1)) ]; then
      printf '  "%s",\n' "$esc"
    else
      printf '  "%s"\n' "$esc"
    fi
  done
  printf ']\n'
} > "$OUT_FILE"

echo "매니페스트 생성 완료: $OUT_FILE (${#files[@]}개 파일)"
