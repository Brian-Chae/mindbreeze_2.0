# SDD-238 — 뇌파 원본 90일 보관 적용과 연구 동의자 예외 계획

- 작성일: 2026-10-24, 구현 전 문서. 사용자 요청으로 Stage ③~⑥ 연속 진행 승인.
- 목표: 기존 보존 로직을 유지하고 통합 스위프 타이머의 dry-run 보고를 준비한다.
- Spec: [spec.md](spec.md)
- 구조: jobs.tsv → renderer/install-release → retention_sweep_cron → 기존 서비스. 삭제 스위치는 false 유지.

## 제약과 검토 초점
- `retention_raw_days=90`, `eeg_raw_retention_days=0`, `RETENTION_SWEEP_ENABLED=false` 기본값 유지.
- 연구 ack 전 EEG 보류·ack 후 원본 삭제, 거부·미동의·철회 90일 삭제를 재확인한다.
- dry-run은 원본·개인정보·스토리지·고아 정리·알림·내보내기 상태를 변경하지 않아야 한다. 실행 이력 DB 기록은 허용되는 기존 동작이다.
- 원본 외 음성·영상·STT와 비회원 개인정보도 통합 스위프 대상이므로 실제 삭제 승인 시 함께 확인한다.
- 구현자와 읽기 전용 독립 검증자를 분리하고 최종 diff·테스트는 감독이 직접 재확인한다.

## 작업과 파일
- [ ] `spec.md` 결정표, 본 plan, `verify.md`를 구현 전 커밋한다.
- [ ] `backend/tests/test_sdd210_deploy_templates.py`: 활성 집합에 retention_sweep 추가, research_export만 비활성, timer UTC 03:00·3600초 검증.
- [ ] `backend/tests/test_sdd210_install_release.py`: 설치 timer 18→19 및 활성 서버에 신규 retention timer enable 검증. 변경 테스트 RED 확인.
- [ ] `deploy/jobs.tsv`: retention_sweep enabled=1, note에 기본 false·dry-run 명시. 다른 작업은 변경하지 않는다.
- [ ] `backend/tests/test_sdd209_b12_retention_sweep.py`: dry-run 부작용 경계와 보류 보고 검증 강화. 기존 BT56~61 및 B13 연구 내보내기 회귀 확인.
- [ ] 집중 pytest → 전체 백엔드 pytest, 독립 리뷰 → `summary.md` 작성 → 한글 커밋·브랜치 push·develop 대상 PR.

## RETENTION_APPLY_FROM 의미와 권장값
- `parse_apply_from`은 YYYY-MM-DD를 UTC 00:00으로 변환한다. 미설정/잘못된 값이면 실제 삭제를 차단한다.
- `_eligible_sessions`는 종료일(없으면 created_at)이 apply_from 이상이고 실행 시각에서 90일을 뺀 시각 미만인 종료·취소 클래스만 고른다. 숨김 클래스 포함, 템플릿 제외.
- 권장값: **2026-10-24**(Brian 정책 결정일, UTC 기준). 과거 자료를 일괄 삭제하지 않는 보수적 시작이며 이날 이전 종료분은 계속 제외된다. 따라서 기존 자료 전체에 대한 90일 방침 이행값은 아니다.
- 기존 자료에도 적용하기로 Brian이 결정하면 **보존 대상 최초 클래스 종료일 이하의 날짜**를 별도로 선정한다. 현재 날짜에서 90일을 뺀 값을 쓰면 그보다 오래된 자료를 영구 제외하므로 권장하지 않는다.
- 설정은 이번 작업에서 바꾸지 않는다. dev 보고에서 하한 미설정/권장 하한별 대상 범위 차이를 확인한 후 Brian이 적용 범위를 결정한다.

## 활성화 순서와 승인 시점
1. 이번 PR: 타이머 enabled=1 + Settings/환경 매니페스트의 `RETENTION_SWEEP_ENABLED=false` 유지. 타이머 생성과 실삭제는 별개다.
2. 별도 배포 승인 후 dev에 반영. #69와 동일하게 활성 timer가 있는 설치는 새 timer도 enable하며, 컷오버 전 timer 비활성 서버에서는 설치만 한다. dev의 실제 스케줄러 반영 여부는 담당자가 확인한다.
3. dev에서 `retention_sweep_cron.py --dry-run` 또는 타이머 보고를 확인한다. 원본 후보 건수/바이트, 연구 보류·차단·초과 건수, 개인정보 후보, mode=dry_run, 모든 deleted/scrubbed=0, orphan_cleanup=null, 적용 하한을 기록한다. 이력은 retention_sweep_runs에 남는다.
4. **Brian 별도 승인 필수**: 비식별 사본의 영구 보관 의미, 연구 내보내기/ack 정상 여부, 적용 하한과 과거 자료 범위, EEG 외 원본·개인정보 삭제 범위를 검토한 뒤 실제 삭제를 승인한다.
5. 승인된 운영 작업에서만 유효한 `RETENTION_APPLY_FROM`과 `RETENTION_SWEEP_ENABLED=true` 적용. 첫 실행 결과 검토. 이번 PR/작업에서는 수행 금지.
