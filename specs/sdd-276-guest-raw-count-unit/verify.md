# SDD-276 Verify (구현 전 QA 체크리스트)

| ID | 시나리오 | 기대 | 시험 |
|---|---|---|---|
| V1 | sealed 목록을 읽은 직후 한 청크가 receipt 로 넘어감 | 합계는 실제 청크 수(이중 계산 없음) | tests/sdd276 |
| V2 | 최댓값 병합을 거친 최종 보고 | 서버 업로드 행 수와 신호별 동일 | tests/sdd276 |
| V3 | 비회원 시나리오: ppg 28샘플 다수 segment, acc 300샘플, eeg 가변 청크 + 레거시 v1 eeg 1초 청크, 업로드 중 반복 관측 | final 후 보고 기대량 == 서버 행 수(신호별) | tests/sdd276 |
| V4 | 레거시 청크 재적재(멱등) | 카운터 증가 없음 | tests/sdd276 |
| V5 | superseded 제외·dead_letter 포함 등 기존 계약 | 기존 sdd275 통과 | tests/sdd275 |
| V6 | 회귀 | sdd274/273/264/266/267/260-web/246-web 통과 | vitest |
| V7 | tsc -b, eslint | 오류 0 | CLI |
| V8 | backend·ios·android diff 0 | git diff --stat | git |
