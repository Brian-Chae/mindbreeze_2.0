# SDD-238 — 뇌파 원본 90일 보관 적용과 연구 동의자 예외

- 상태: Stage ③ 준비 — 2026-10-24 Brian 결정 반영, 타이머 dry-run 활성화 준비 승인
- 브랜치: `sdd/238-eeg-raw-retention-90d`
- 작성일: 2026-10-23

## 배경
방침 제3조는 "기록 원본(뇌파·음성·영상·전사)을 클래스 종료 90일 후 삭제", 제5조의2는 "연구 동의자의 비식별 사본은 기한 없이 보관"이라고 약속한다. 대표 결정: 90일 적용, 연구 동의자는 영구 보관.

## 조사 결과 (코드 근거)
1. 90일 삭제 + 연구 예외는 **SDD-209 B12 `retention_sweep_service`에 이미 구현**돼 있다.
   - `retention_raw_days=90` (`config.py:149`).
   - 연구 동의자의 원본은 연구 저장소로 내보내기 ack 전까지 삭제 보류(`_hold_stage`), ack 후에는 원본만 삭제되고 비식별 사본은 연구 저장소에 남는다(`test_BT58`, `test_BT59`).
   - 철회·거부·미동의는 보류 없이 90일 후 삭제.
2. `eeg_raw_retention_days=0`(무기한)은 **구 스위프(`sweep_stale_eeg_raw`)의 값**이며, `retention_sweep_enabled=True`이면 구 스위프는 실행되지 않는다(`eeg_raw_task.py:21`).
3. 따라서 `eeg_raw_retention_days`를 90으로 바꾸면 **연구 보류 없이 삭제**되어 연구 동의자 데이터가 유실될 수 있다. 바꾸지 않는다.

## 결정표 (Brian, 2026-10-24)

| 항목 | 결정 | 현행 구현 판정 |
|---|---|---|
| 연구 목적 동의 EEG | 영구 보존 | 미철회 동의자의 내보내기 ack 전 서비스 원본 보류, ack 후 서비스 원본 삭제·비식별 연구 사본 기한 없이 보관 |
| 미동의·거부·철회 EEG | 90일 보관 | 종료·취소 클래스 종료일(없으면 created_at) 기준 90일 초과 후 삭제, 연구 보류 없음 |
| 영구 보존의 의미 | 비식별 연구 사본 보관이면 현행 방침·구현과 일치 | 서비스 원본 자체 영구 보존이면 불일치. 선택지는 summary에 기록하고 보존 코드는 변경하지 않음 |
| 구 EEG 보존 설정 | `eeg_raw_retention_days=0` 유지 | `retention_raw_days=90`인 통합 스위프가 활성 시 구 스위프 대체 |
| 타이머 | `deploy/jobs.tsv`의 `retention_sweep enabled=1` | #69 account_deletion_sweep와 같은 타이머/삭제 스위치 분리 |
| 실제 삭제 | `RETENTION_SWEEP_ENABLED=false` 기본 유지 | dev dry-run 보고 확인 → Brian 별도 승인 후 실제 삭제 활성화 |
| 적용 하한 | `RETENTION_APPLY_FROM` 설정 변경 없음 | UTC 날짜 하한이며 그 이전 종료분은 소급 삭제에서 제외. 권장값은 plan 참조 |

## 범위와 완료 조건
- spec·plan·verify를 구현 전에 커밋하고 타이머 설정·관련 테스트를 변경한다.
- retention·deploy_templates·install_release 및 전체 백엔드 회귀를 실행하고 summary에 실제 결과를 기록한다.
- SDD 4종과 활성화 준비를 PR로 제출한다. 머지·배포·서버·DB·.env 접근·실데이터 삭제·메일 발송은 하지 않는다.
- dev dry-run·연구 저장소 영구 보관 실증·실제 삭제 승인은 이번 로컬 검증에 포함하지 않는다.
