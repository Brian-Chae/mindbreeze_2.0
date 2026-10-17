# Plan
1. explore.mjs: 역할별(내담자·상담사·기관) 화면 순회 + 점검 (데스크톱/모바일)
2. regressions.json + regressions.mjs: 데이터 기반 회귀 점검 실행기, 배포 후 E2E에 편입
3. mb-e2e-nightly.py (크론 02:30): 탐색 실행 → 중복 제거 → 상위 3건 회귀 등록 push → 텔레그램 요약
4. 상태 파일로 신규/기존/해결 추적
