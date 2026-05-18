#!/bin/bash
# 파일 편집 후 경량 린트 실행. 실패해도 작업 흐름 차단 안 함.
FILE="$1"
case "$FILE" in
  *.py)
    ruff check "$FILE" --fix --quiet 2>/dev/null || true
    ;;
  *.ts|*.tsx)
    npx eslint "$FILE" --fix --quiet 2>/dev/null || true
    ;;
esac
echo "[lint] checked $FILE"
