# SDD-030 백엔드 구현 결과

요청된 Phase 2 저장·WS 전달과 Phase 3 몸 지표 집계를 구현했다. 프론트 파일은 이 작업에서 수정하지 않았다.

## 변경 사항

- `EEGFeatureWindow.respiratory_rate`: nullable Float 컬럼과 마이그레이션 `8e30b17c920a` 추가(부모 `4235a5871ac6`).
- `HRVMotionFeatures` 확장으로 이를 상속하는 `EEGFeatureItem`의 REST·WS 입력에 호흡수를 포함하고, 공통 `persist_feature_windows`에서 저장한다.
- 현재 WS는 이미 검증된 `item.model_dump()` 전체를 `eeg_feature.feature`에 전송한다. 기존 BPM·HRV 전달 코드를 중복하지 않고 호흡수까지 자동 포함되도록 공통 계약을 확장했다. 실제 핸들러를 호출하는 FakeSio 테스트로 몸 지표 7개와 호스트 룸을 검증했다.
- `HRVMotionSummary` 및 이를 상속하는 `ReportResponse`·롤업 overall에 `respiratory_rate_mean`, `heart_rate_min`, `heart_rate_max`, `lf_power_mean`, `hf_power_mean` 추가. 기존 BPM·SDNN·RMSSD·LF/HF 비율 평균은 유지한다.
- 롤업 버킷/전체 metrics에 호흡수 평균, 리포트 `content.eeg.timeline`에 BPM·호흡수·HRV·motion 원천값을 추가했다.
- 평균은 지표별 비-null 원천 샘플 기준이며, 빈 샘플은 null이다. EEG 품질 게이트와 몸 지표 집계의 기존 독립성을 유지했다.

## 테스트 결과

- RED: 신규 테스트 9개가 호흡수 필드/요약 미구현으로 실패한 것을 확인.
- GREEN: 신규 테스트 9 passed.
- 전체: `cd backend && ./venv/bin/python -m pytest -q` → **337 passed, 1 skipped, 12 warnings**, 31.74초.
- 신규 검증: REST 저장/재전송, WS 저장 및 실제 broadcast payload, 누락/null, 희소 버킷 전역 평균, 참가자 격리, 리포트 생성/조회 요약·추이, 미측정 리포트.
- `git diff --check` 통과.

## 마이그레이션 검증과 한계

격리한 임시 PostgreSQL에서 직전 모델 스키마(현재 metadata에서 신규 컬럼만 제외)를 생성하고 `4235a5871ac6`으로 stamp한 후 실제 Alembic upgrade를 실행했다. 신규 컬럼의 nullable double precision을 확인했으며, 전체 모델 `compare_metadata=[]`, downgrade로 신규 컬럼 제거, 재-upgrade 후 `compare_metadata=[]`를 확인했다. 테스트 PostgreSQL은 종료·정리했으며 서비스 DB에는 적용하지 않았다.

재현: `cd backend && PYTHONPATH=. ./venv/bin/python ../specs/030-biometric-signal-upgrade/verify-be-migration.py` (로컬 PostgreSQL `initdb`, `pg_ctl` 필요).

검증 로그: `be-migration-verification.log`.

별도로 빈 DB부터 전체 이력을 실행하면 기존 `30c1bfbc724f`의 24행에서 `chat_room_participants` 중복 생성으로 실패한다. 앞선 `c8f3a1b5d201`이 같은 테이블을 생성하므로 이번 호흡수 마이그레이션 이전에 발생하는 기존 문제이며, 이번 작업에서는 과거 이력을 변경하지 않았다. 따라서 **이번 증분 마이그레이션 검증은 통과했으나 빈 DB부터의 전체 이력 재생은 통과하지 않았다**.

실제 LINK BAND·브라우저 E2E, 운영 DB 적용, 기존 마이그레이션 이력 복구는 별도 작업이다. 전체 SDD의 프론트/실기기 검증과 최종 승인은 코디네이터가 통합한다.
