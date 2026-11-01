# SDD-269 plan

## 아키텍처
- 순수 함수 `backend/app/services/gap_derivation.py` : 입력(창 목록·segment 목록·기록 구간) → `DerivedGap` 목록. DB·시간 의존 없음.
- 서비스 `backend/app/services/data_center_gaps.py` : DB 에서 창(필요 컬럼만)·eeg 청크(start_ms/end_ms)·`biosignal_gap_events` 를 읽어 순수 함수 호출, 상대 µs 로 변환.
  - 쿼리 3개 고정(창 1, 청크 1, 기록 gap 1). 참여자 1명 단위.
- `data_center_measurement.read_waveform` 은 `manifest.gaps` 뒤에 파생 구간을 가산. 파형 경로의 DB 세션이 없으므로 라우터(`api/v1/data_center.py`)에서 병합해 응답을 보강.
- 스키마: `GapRange.source`, `GapSummary` 가산.

## Task
| T | 내용 | 담당 파일 |
|---|---|---|
| T1 | 순수 함수 + 단위 테스트(R1~R4·병합·최소길이·fixture) | `services/gap_derivation.py`, `tests/sdd269/test_gap_derivation.py` |
| T2 | 서비스·스키마·라우터 병합·요약 API + PG 대조 테스트 | `services/data_center_gaps.py`, `schemas/data_center.py`, `api/v1/data_center.py`, `tests/sdd269/` |
| T3 | FE 타입·파형 표시·요약 문구 + vitest | `lib/api/data-center-measurement.ts`, `signal-waveform.tsx`, `measurement-detail.tsx` |
| T4 | 회귀(sdd260~267, upload_status*, FE 관련), 대용량 실측, summary.md | — |

## 결정·이유
- 원점이 파형(raw 앵커 상대 µs)과 창(기기 ms)에서 달라, 서비스가 **기기 ms → 상대 µs** 변환을 한 곳에서 한다(원점 = eeg 첫 청크 start_ms 우선).
- R2/R3 시작을 "이전 창 시각+1000ms" 로 둔다: 이전 창 자체는 1초 분량의 데이터가 있으므로 결측에 포함하지 않는다(과대 표기 방지).
- 스키마 변경 없음 → 마이그레이션 없음.
