# SDD-269 summary

## 구현
- `backend/app/services/gap_derivation.py` 순수 함수(R1 품질0 / R2 결번 / R3 간격>1.5초 / R4 파일 segment 간격, 병합, 최소 2.0초).
- `backend/app/services/data_center_gaps.py` 쿼리 3개 고정 + 상대 µs 변환 + 기록 구간 우선.
- `GapRange.source`(recorded/derived)·`GapSummary` 가산, 파형 응답에 파생 구간 병합, `GET .../measurements/{s}/{p}/gaps` 신설.
- FE: 파형 결측 블록 소수 1자리 + "(저장 데이터로 계산)", 상세 "측정 중 신호가 끊긴 구간 N회, 합계 N초".
- 마이그레이션·앱 변경 없음.

## 테스트 (실제 실행)
- 신규 BE 22개 통과(순수 함수 15 + API 7), 신규 FE 5개 + 기존 data-center 20개 통과, tsc·eslint 0 오류.
- 회귀 BE 316 중 315 통과 / 12 skip / 1 실패: `sdd260/test_features_batch_pg.py::test_V_A9`(300창 저장 2초 제한). **develop 기준선에서도 동일 실패(2.30초)** → 이번 변경과 무관한 타이밍 불안정.
- 대용량 근사(SQLite, 600창×2명): gaps 요청 123ms, 쿼리 3개.

## 계획과 달라진 점
- 40명×600창 실측 대신 600창×2명으로 대체(쿼리가 참여자 단위라 다른 참여자 수와 무관). PG 실측 아님.
- verify V-R02 표의 설명 문장이 어색해 테스트로 확정: 정상 1창 사이는 별개 구간.

## 수정 (감독 재검증 결함)
- 결함: 창(절대 epoch ms)과 측정 기록 파일(세션 상대 ms)을 한 원점으로 빼 창 기반 구간이 1.79e12 위치로 나옴.
- 수정: 소스별 첫 시각을 같은 0 으로 두는 근사(spec §4). 실데이터 모양 fixture(창 절대값, 파일 -55~144238, 간격 100270→115342)로 RED(max end 1.79e15 µs) → GREEN.
- 11.7초(창)·15.1초(파일) 같은 끊김은 15.1초 구간 1개로 병합됨을 시험.
- 오차 상한·요약 정확성은 spec §4 참조.
