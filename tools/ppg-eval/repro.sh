#!/bin/bash
# 재현성 검증(H1): 같은 입력·시드로 run-dev 2회 → 결과 파일 sha256 비교 (provenance.json 은 커밋마다 달라 제외)
set -e
cd "$(dirname "$0")"
export PYTHONPATH=.
rm -rf work/runA work/runB
.venv/bin/python -m ppg_eval.cli run-dev --out work/runA > work/runA.log 2>&1
.venv/bin/python -m ppg_eval.cli run-dev --out work/runB > work/runB.log 2>&1
(cd work/runA && shasum -a 256 $(ls | grep -v provenance)) > work/hashA.txt
(cd work/runB && shasum -a 256 $(ls | grep -v provenance)) > work/hashB.txt
if diff work/hashA.txt work/hashB.txt > /dev/null; then echo "REPRO: IDENTICAL" | tee work/repro.result; else echo "REPRO: DIFFERENT" | tee work/repro.result; exit 1; fi
cat work/hashA.txt
