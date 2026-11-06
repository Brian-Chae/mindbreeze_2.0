#!/bin/bash
# 재현성(addendum-9 A9-6): run-ablation2 를 2회 실행해 산출물 sha256 비교
set -e
cd "$(dirname "$0")"
export PYTHONPATH=.
hashit() { (cd results && shasum -a 256 ablation2/* ablation2-summary.md ablation-v2-*.md); }
.venv/bin/python -m ppg_eval.cli run-ablation2 > work/abl2_A.log 2>&1
hashit > work/abl2_hashA.txt
.venv/bin/python -m ppg_eval.cli run-ablation2 > work/abl2_B.log 2>&1
hashit > work/abl2_hashB.txt
if diff work/abl2_hashA.txt work/abl2_hashB.txt > /dev/null; then echo "REPRO-ABL2: IDENTICAL" | tee work/abl2_repro.result; else echo "REPRO-ABL2: DIFFERENT" | tee work/abl2_repro.result; exit 1; fi
cat work/abl2_hashA.txt
