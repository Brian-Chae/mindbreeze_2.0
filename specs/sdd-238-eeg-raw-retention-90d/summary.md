# SDD-238 — 뇌파 원본 90일 보관 적용과 연구 동의자 예외 결과

- 작성일: 2026-10-24
- 상태: 로컬 구현·검증 및 SDD 4종 작성 완료. Stage ⑦ Brian 리뷰 및 배포 후 활성화 승인 대기.
- 기준: 시작 `00390c2a`, origin/develop `c38b8de9`를 merge로 반영. 구현 전 spec·plan·verify 커밋: `523fef80`.

## 영구 보존 판정과 선택지
- **비식별 연구 사본의 무기한 보관**이라는 의미라면 현행 구현·방침과 일치한다. 연구 번들의 `eeg_raw.parquet`에 EEG 원본 바이트(payload)가 들어가므로 연구용 뇌파 내용은 유지한다.
- 서비스 저장소 원본은 미철회 연구 동의 + 미ack이면 삭제 보류, ack 완료 시 90일 경과분을 삭제한다. 미동의·거부·철회에는 연구 게이트가 없어 90일 경과 후 삭제한다. 종료·취소 클래스의 종료일(없으면 created_at) 기준이며 apply_from 이전은 제외된다.
- **서비스 원본 자체를 영구 보존**한다는 의미라면 현행과 다르다. 선택지 A: 현행처럼 비식별 연구 사본만 영구 보존(권장, 방침 제3조/제5조의2와 일치). 선택지 B: 서비스 원본도 영구 보존(별도 정책·방침·보존 로직 설계와 승인 필요). 이번에는 보존 코드를 바꾸지 않았다.
- 실제 외부 연구 저장소 적재·영구 보관 정책은 확인하지 않았다. ack는 현행 내보내기 프로토콜의 확인 신호이며, 이번 로컬 테스트만으로 외부 저장소 보존을 증명하지 않는다.

## 변경 파일과 유지 사항
- `deploy/jobs.tsv`: retention_sweep enabled=1, UTC 매일 03:00(한국 12:00), timeout 3600초. note에 false 기본/dry-run/실삭제 별도 승인 표시.
- `backend/tests/test_sdd210_deploy_templates.py`: 활성 작업 집합, timer 19개, retention 주기/timeout 확인.
- `backend/tests/test_sdd210_install_release.py`: timer 18→19, 기존 timer 활성 서버의 retention 신규 enable 확인.
- `backend/tests/test_sdd209_b12_retention_sweep.py`: false(하한 미설정/설정+dry_run=False), 명시 dry-run, 잘못된 하한 네 경우의 삭제·알림·고아 정리 차단 확인. 연구 보류 110일 사례 포함.
- `specs/sdd-238-eeg-raw-retention-90d/{spec,plan,verify,summary}.md`: Brian 결정, 적용 하한, 검증·활성화 절차 기록.
- 유지: `retention_raw_days=90`, `eeg_raw_retention_days=0`, Settings/환경 매니페스트 `RETENTION_SWEEP_ENABLED=false`, `RETENTION_APPLY_FROM` 미설정, privacy-policy.ts 문구, 연구 내보내기 타이머 비활성.

## 검증
- RED: 배포/설치 기대값 변경 후 4 failed, 50 passed. 원인은 retention 타이머 비활성/누락/18개 설치로 예상과 일치.
- GREEN 집중: retention B12 + research export B13 + deploy_templates + install_release, **98 passed**, 3 dependency deprecation warnings.
- 독립 AST/TSV 검사: timer 19개, 스케줄/timeout, false 삭제 잠금, 90/0 기본값, 빈 apply_from 유지 통과.
- 읽기 전용 독립 검증자 리뷰: 정책·설정 변경 및 범위 이탈 없음. 알림 임계 검증 보강 의견을 반영하여 종료일 110일 전·overdue=1·alerted=0 확인 추가.
- 리뷰 보강 후 최종 retention 재실행: **24 passed**, 2 dependency deprecation warnings.
- 전체 백엔드 회귀: `cd backend && DATABASE_URL=sqlite:// RETENTION_SWEEP_ENABLED=false PG_SMOKE=0 /tmp/mb237-venv/bin/python -m pytest -q` → **3932 passed, 463 skipped, 75 warnings**, 실패 0, 383.82초. PostgreSQL/외부 의존 등 skip 시나리오는 검증하지 않았으며 통과 수에 포함하지 않는다. 경고는 의존성 사용 중단 안내 등이다.
- dry-run은 원본·개인정보·스토리지 삭제·고아 청소·알림·동의 상태를 변경하지 않는다. 단 `retention_sweep_runs` 실행 시작/완료 보고 이력은 쓴다(무변경 트랜잭션은 아님).
- 감독 재확인: `git diff --check` 통과, origin/develop 대비 보존 서비스·config·환경 매니페스트·방침 diff 없음.
- 실제 서버/DB/S3·외부 연구 저장소·dev 스케줄러·배포 후 dry-run은 미검증. 테스트의 SQLite 인메모리 DB와 스텁 외부 경계는 운영 검증을 대체하지 않는다.

## 활성화 절차와 Brian 승인
1. PR 리뷰/머지 및 dev 배포는 별도 승인. 이번 작업은 작업 브랜치 push·PR 제출까지다.
2. 승인 후 dev 반영 시 false 기본 유지. 타이머가 기존 활성 상태인 서버는 새 timer도 활성화, 컷오버 전 서버는 설치만 하므로 스케줄러 반영 확인 필요.
3. dev dry-run 보고에서 원본 후보 건수/바이트, 연구 보류·차단·overdue, 개인정보 후보를 검토하고 삭제·스크럽 0과 orphan_cleanup=null을 확인한다. 원본 외 음성·영상·전사·비회원 개인정보도 통합 스위프에 포함된다.
4. `RETENTION_APPLY_FROM`은 UTC 종료일 하한이다. 전체 기존 자료에 90일 정책을 적용하려면 최초 대상 종료일 이하 권장(후보 `1970-01-01`, 실제 최초일 미조회). `2026-10-24` 선택 시 이전 종료분은 계속 제외된다. dry-run과 실활성에 같은 하한을 쓰고 범위를 비교한다. 이번에는 설정하지 않았다.
5. **Brian이 dev 보고·비식별 사본 영구 보존 의미·외부 연구 적재/ack·적용 하한/과거분 범위·삭제 대상 범위를 승인한 이후에만**, 별도 운영 작업에서 `RETENTION_SWEEP_ENABLED=true`를 적용한다. 연구 내보내기 비활성/미ack 건은 계속 보류되므로 보류 해소를 먼저 확인한다.
6. 첫 실제 실행 결과 확인. false 복귀는 다음 실행을 막지만 이미 삭제한 원본을 복구하지 않는다.

## 수행하지 않은 작업
머지·develop push·배포·서버/DB/.env 접근·실데이터 삭제·메일/알림 발송·실제 삭제 설정 활성화는 수행하지 않았다. 테스트 내 execute 설정은 격리된 fixture에서만 사용했다.

## 10/24 후속 활성화 결정

- Brian 승인: 릴리즈 전 dev 실삭제·기존 자료 소급 적용, 표준 baseline/model/constants 보호, 연구 A안·미ack 보류 유지. dev 크론만 enabled=true + 명시적 --retroactive로 빈 적용 하한 실행을 허용하며 운영 기본 차단은 유지한다. 상세 보호 판정·첫 실행 영향·검증은 [후속 summary](../../fix-notes/dev-retention-enable/summary.md) 참조. 이 결정은 위 최초 dry-run 준비 단계의 승인 대기 기록을 dev 범위에서 대체하며, 서버 배포·크론 실행은 이번 작업에서 하지 않는다.
