# SDD-238 — 뇌파 원본 90일 보관 적용과 연구 동의자 예외

- 상태: Stage ① Spec — 조사 완료, 코드 변경 불필요 판정(운영 설정 승인 대기)
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

## 결정
- 코드 변경 없음. 기본값 0 유지(구 스위프는 retention_sweep 활성 시 대체됨).
- 방침 이행은 운영 설정으로 한다: `RETENTION_SWEEP_ENABLED=true` + `RETENTION_APPLY_FROM=YYYY-MM-DD`(이 날짜 이전 종료분은 소급 삭제하지 않는 기준으로 설정).
- 순서: 운영 배포 → dry-run 보고(대상 건수, 연구 보류 건수) 확인 → 대표 승인 → 활성화.

## 미해결
- 방침 이행 전(sweep 비활성 동안)에는 원본이 무기한 남는다. 출시 심사 전에 활성화해야 한다.
- `RETENTION_APPLY_FROM` 날짜 선정은 대표 결정.
