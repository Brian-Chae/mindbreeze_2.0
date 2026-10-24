# SDD-244 — 생체신호 원데이터 전체 저장 구현 결과

- 최종 갱신: 2026-10-24 / 브랜치 `sdd/243-platform-data-center`(243과 통합). PR 은 SDD-243과 한 건 `[SDD-243·244] 데이터 센터와 생체신호 원데이터 전체 저장`.
- 범위: **웹 우선** T01~T14 (EEG·PPG·ACC 원문 선수집 → 영속 큐 → 검증 ACK 업로드 → manifest/종료 판정 → 반출·연구·보관). T15(합성 대량 측정)·T16(실기기 60분)·T17/T18(앱)은 미수행.

## 구현 결과

| Task | 커밋 | 내용 |
|---|---|---|
| T01 | `35527cc7` | FIX #89 인수 기록 |
| T02 | `56fbc926` 외 | G1 데이터 계약 동결(raw v2·manifest·feature·indices 스키마/fixture) |
| T03 | `7f654f12` | 원데이터 디코더(v1/v2, 경계·잘림·미지원 버전) |
| T04 | `8fc42276` | 세 신호 raw v2 presign/검증 ACK, capability — **M1 `e036a0244001`** |
| T05 | `dc2babad` | feature/raw_derived/indices/normalization/algorithm 원장·ACK, 1Hz 스냅샷 — **M2 `e036a0244002`** |
| T06 | `b40bca3f` | gap·close intent·manifest revision 판정/조회 — **M3 `e036a0244003`** |
| T07~T11 | `25184890`, `81618841`, `e1f65029`, `fd1f8f07`, `1acaa31a` | 원문 선수집·raw-v2 인코딩, 영속 큐·업로더, 전체 feature emit, PPG 중첩 RR/호흡 게이트, 화면 6지표 1Hz 스냅샷 |
| T12 | `b2de9887`, `31155986` | manifest 기반 반출 어댑터 `biosignal_export_adapter` + 독립 검증 스크립트 |
| T13 | `55cfeb96` | 신호별 연구 반출·범주 ACK·철회 차단 |
| T14 | `b8fa47ee` | 신호별 90일 보관·삭제 outbox 재시도 |
| B 리뷰 수정 | `5b0f34b9`, `1a661508` | High/Medium 수정, H04 gap 부호 반전·시계 역행 방어 |
| **통합 수정(이번)** | `40918696` | 서버 남은 결함 3건(아래) |
| **런타임 연결(이번)** | `e07d1e14` | 243에 실제 어댑터 등록(SDD-243 summary 참고) |

마이그레이션 적용 순서(단일 체인, head `e036a0243003`): `e036a0000061`(develop) → `e036a0244001` → `e036a0244002` → `e036a0244003` → `e036a0243001` → `e036a0243002` → `e036a0243003`.

## 이번 통합에서 닫은 서버 결함 (244 B 리뷰 인계)

`biosignal_manifest_service.py` — 모두 RED(4건 실패) 확인 후 GREEN:

1. **lost feature/indices 순번 구멍**: 회복 불가로 선언한 산출물(`lost_artifacts`)은 순번을 차지한 것으로 본다(행이 있는 경우). 서버가 알려 준 구멍 항목(`FEATMISSING-…`, `IDXMISSING-…`)을 그대로 loss 로 재선언하면 `pending_upload` 에서 `partial` 로 해소된다(RAW 와 동일 규약).
2. **유실 feature 를 참조하는 indices**: `("feature", alias)` 가 loss 로 선언돼 있으면 미해석 참조로 판정하지 않는다.
3. **presign 이전 loss 목록 누락**: 원장 행이 없는 선언 loss 도 공개 manifest 에 `availability=lost`, `ack_state=unavailable`, 선언 사유와 함께 싣는다(hash/size 는 알 수 없음).

- 2번(유실 feature 를 가리키는 indices 참조)은 코드 변경만 있고 전용 테스트는 없다 — indices ACK 색인 fixture 가 필요해 후속 보강 대상이다.

## 반출 연결에서 발견·수정한 것

- manifest `time_range` 가 ms 반올림이라 4샘플(250Hz) 청크의 마지막 샘플이 파형에서 잘렸다 → 청크 구간을 헤더 앵커의 정확한 유리수 시간에서 계산한다.
- indices 만 선택한 반출에서는 증빙(JSONL·display-status)이 빠졌다 → `indices_sidecars` 훅 추가.

## 검증 (통합 기준)

- 백엔드 전체 **4,258 passed / 14 skipped / 0 failed**, PG 전체 **512 passed**, 빈 DB→head 및 develop head→head upgrade OK, alembic head 1개.
- 프론트 전체 2,973 passed / 17 failed(기존 8파일·17건, 파일·테스트 이름 기준선과 동일), tsc 0, build OK.
- 골든 fixture 실제 디코더 결합(`test_real_decoder_binding_with_golden_fixture`)·ZIP 소비 계약(`test_SDD243_B06_실제_ZIP_소비_계약`) 통과. 근거 수치의 상세는 SDD-243 summary 의 검증 표.
- 감독 검증(244 B): FE focused 17파일/261 passed, 실제 FE runtime 이 만든 6종 메타·bytes·close intent 를 서버 DTO 에 통과(서버·DB 비접속, `frontend/tests/sdd244-review-validation.md`).

## 미검증 / 한계 (성공으로 표시하지 않음)

- **실제 S3**: 서명 헤더 불변성, 다른 바이트 재PUT 거절, HEAD 체크섬, 버전 ID. 서버는 모의 저장소로만 검증했다.
- **실기기 LINK BAND 60분(T16)**, **앱 iOS/Android(T17/T18)**, **합성 대량/용량 측정(T15)** 미수행.
- 큰 테이블 마이그레이션 잠금/rewrite 계측 없음(상수 default 컬럼 추가만, `lock_timeout 5s`).
- 신호별 연구 동의 범위 미정의 → PPG/ACC 의 연구 반출은 `unknown` 으로 차단.
- feature 객체 내부 참조(`raw_artifact_id_alias` 등)는 서버가 해석 검증하지 않는다(indices→feature alias 만 검증).
- report 생성이 `faa`/`total_neural_activity` 를 실제로 받게 되어 새 데이터의 리포트 입력이 달라질 수 있다.
- PG 위 API 전 구간(인가 포함) 시험 없음(PG 는 service 레벨).
