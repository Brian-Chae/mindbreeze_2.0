
- 에이전트가 처리할 기술 사항: 워크플로 의존 관계, 테스트 분류·복구, 산출물 체크섬, 환경 검증, timer 변환, 브랜치 검사, 앱 설정 생성, 복구 절차 자동화.
- Brian의 승인 대상: 비용·일정·서비스 중단·데이터 손실 허용 범위와 구체적 운영 출시 결과. `[확정된 결정: 운영 배포 최종 게이트]`
hook: Stop
hook: Stop Completed
tokens used
65,935
# B. CI/CD·릴리스·테스트·앱 배포 기획 리뷰

- 기준일: 2026-10-10. 저장소 읽기 전용 조사. 코드·인프라 수정, 서버 접속, 테스트 실행, 파일 저장 없음.
- 근거 표기: `파일:라인`은 조사한 작업 사본 기준. `[확정 사실]`은 제공된 실측 브리프 기준.
- 아래 설계·일정·비용은 **제안 또는 추정**. 현재 구현·검증 완료를 의미하지 않음.
- 권장 우선순위: **실사용 dev 자동배포 차단 → 테스트 게이트 복구 → 운영 분리·동일 산출물 승격 → 앱 배포 → 조건부 무중단화**.
- 유지 조건: GitHub Actions, AWS 관리형 서비스와 systemd, 명세 중심 개발(SDD) 7단계, Brian의 운영 배포 최종 승인. `[확정된 결정]`

## 1. 현황 진단

| 위험도 | 확인 사항 | 영향·근거 |
|---|---|---|
| 🔴 | develop 변경이 테스트 결과와 무관하게 배포 | 배포는 프론트 빌드만 선행조건. 에이전트 병렬 변경이 실사용자에게 노출. `.github/workflows/deploy-dev.yml:11,53`; `[확정 사실: 운영]` |
| 🔴 | 프론트 단위 테스트 실패가 비차단 | `continue-on-error`, `--passWithNoTests` 사용. 기존 실패 16건은 브리프 수치이며 이번 조사에서 재실행하지 않음. `.github/workflows/ci-feature.yml:57`; `[확정 사실: CI]` |
| 🔴 | 코드 복원도 불완전 | app·alembic·dist만 백업. 공유 가상환경·서비스 파일·cron·설정 변경 복원 없음. `.github/workflows/deploy-dev.yml:115,126,183,194,239` |
| 🔴 | 외부 점검 실패 시 자동 복구 불가 | 내부 health 성공 직후 백업 삭제, 공개 주소 점검은 이후 별도 단계. `.github/workflows/deploy-dev.yml:275,283` |
| 🔴 | DB 변경에 자동 되돌리기 적용 불가 | 상태 통합 UPDATE의 downgrade가 `pass`. 코드 복귀와 데이터 복구를 분리해야 함. `backend/alembic/versions/e036a0000028_sdd_125_remove_paused_status.py:19` |
| 🔴 | 운영 후보에도 개발 설정이 섞일 위험 | 배포가 역할 시뮬레이션을 프론트·백엔드 양쪽에서 강제 활성화. `.github/workflows/deploy-dev.yml:38,168` |
| 🔴 | 즉시 다중 프로세스 전환 불가 | 실시간 세션 상태가 프로세스 전역 메모리이며 단일 프로세스 전제를 명시. `backend/app/ws/session_live_namespace.py:44` |
| 🟡 | cron이 배포 스크립트에 분산 | 14개 작업을 매번 문자열로 등록하며 환경값 추출 반복. Celery beat 중복 실행 경고도 존재. `.github/workflows/deploy-dev.yml:203,236`; `[확정 사실: 서버]` |
| 🟡 | 실행 가능 상태를 판별하지 못함 | `/health`는 고정 응답. 일부 워커 재시작·상태 실패도 무시. `backend/app/main.py:99`; `.github/workflows/deploy-dev.yml:214,220` |
| 🟡 | 브라우저 테스트 분리가 불완전 | `*.browser.cjs`만 제외하므로 `*-browser.test.cjs`는 단위 테스트에 남음. `frontend/vitest.config.ts:22`; `frontend/tests/org-counselor-management-browser.test.cjs:44` |
| 🟡 | 백엔드 제외 목록 정비 필요 | PDF 한 건 제외. 제외된 `test_sprint4_integration.py`는 조사한 작업 사본에서 미발견하여 이력 확인 필요. `.github/workflows/ci-feature.yml:88` |
| 🟡 | 앱 환경·버전 구분 부족 | 앱 ID 단일, Android 버전 코드 1, 공통 dist 사용. `frontend/capacitor.config.ts:3`; `frontend/android/app/build.gradle:6` |
| 🟢 | 재사용 가능한 기반 존재 | 배포 직렬화·백엔드 테스트 차단·서비스 정의 확보. 완전 재구축보다 기존 흐름 수정 권장. `.github/workflows/deploy-dev.yml:15`; `.github/workflows/ci-feature.yml:88`; `backend/deploy/mindbreeze-worker.service:10` |

## 2. 목표 상태

### 2.1 권장 구성·비용

- 권장: 개발·운영 2환경 상시 유지, 운영 후보 검증 환경은 필요 시 생성. 실사용자가 운영으로 이동하기 전까지 기존 dev를 운영 수준으로 통제. `[확정 사실: 환경·운영]`
- 대안 1개: 후보 검증 환경 상시 유지. 릴리스 빈도·재현 필요성이 증가할 때 선택. `[제안: 위 위험 진단 대응]`
- 초기 운영은 단일 프로세스와 공지된 점검 시간 유지. 무중단은 상태 공유·작업 중복 방지·용량 검증 이후 적용. `backend/app/ws/session_live_namespace.py:44`; `[확정 사실: 서버]`

| 비용 구분 | 개략 예산·조건 |
|---|---|
| 자동 검사·산출물 보관 | 월 0~15만 원 추가 예산 **추정**. 실행 횟수·보관량·macOS 실행 비중에 따라 변동 |
| 임시 후보 검증 환경 | 월 3~15만 원 추가 예산 **추정**. 운영 DB 대신 합성 데이터 사용, 검증 후 제거 |
| 상시 후보 검증 환경 대안 | 월 10~30만 원 추가 예산 **추정**. 최소 앱·DB·Redis 구성 가정, 영상 부하 제외 |
| 별도 산정 | 운영 서버·DB·저장소 비용, GitHub 요금제 변경, 스토어 계정 비용. 현재 계약·리전·사용량 미확인으로 견적 제외 |

### 2.2 브랜치·병렬 개발·승인

- 지속적 통합·배포(CI/CD) 목표: **병합 검사 통과 → 고정 커밋으로 산출물 생성 → 후보 검증 → Brian 승인 → 운영 반영**. 근거: 현재 테스트와 배포 독립. `.github/workflows/deploy-dev.yml:53`

| 브랜치 | 제안 역할·규칙 |
|---|---|
| `feature/NNN-*`, `fix/NNN-*` | 에이전트별 독립 작업 디렉터리·브랜치. 변경 제안(PR)으로 develop 병합. 공유 브랜치 직접 push 금지 |
| `develop` | 통합 개발 기준. 병합 후 **해당 커밋 검사 통과 시에만** 순수 개발 환경 자동배포 |
| `release/x.y.z` | develop에서 분기, 기능 추가 중지·릴리스 수정만 허용. 후보 검증 후 main에 PR |
| `main` | 운영 출시 승인 기준. 병합 자체로 운영 배포하지 않음. 실제 운영 버전은 배포 기록·태그로 식별 |
| `hotfix/x.y.z` | 실제 운영 태그에서 분기. 동일 필수 검사·Brian 배포 승인 적용, main·develop·진행 중 release에 반영 |

- main 복구: 기존 main 보존 태그 → 검증된 develop 기준점 선정 → 차이 검토 PR → 이력 보존 병합. 565커밋을 일괄 승인하거나 강제 덮어쓰기하지 않음. `[확정 사실: 환경]`
- 보호 규칙 제안: 필수 검사, 최신 변경 기준 리뷰, 미해결 의견 해소, 강제 push·삭제 금지. `.github/`, 마이그레이션, 인증·환경 설정은 지정 검토자 승인.
- 병렬 병합 제안: 한 건씩 통합하거나 병합 대기열 적용, 대상 브랜치 갱신 시 검사 재실행. SDD 번호·마이그레이션 번호는 통합 담당이 조정.
- SDD의 사전 검증 승인과 운영 배포 승인은 별도 유지. PR에 spec·plan·verify·summary 및 테스트 근거 연결. `[사용자 제공 AGENTS.md: 7-Stage SDD]`
- GitHub 운영 환경의 필수 승인자는 Brian으로 한정. 요금제·저장소 공개 여부에 따라 승인 기능 제공 범위가 달라 사전 확인 필요. [GitHub 환경 보호 문서](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- 승인 기능 미지원 시 대안: Brian만 쓰기 가능한 배포 전용 저장소에서 고정 산출물을 수동 승격. 단순 `workflow_dispatch` 추가만으로 Brian 전용 승인 보장 불가. `[제안: 승인 게이트 유지]`

### 2.3 검사 게이트·기존 실패 복구

| 검사 | 차단 기준·복구 경로 |
|---|---|
| 공통 | 의존성 고정 설치, 타입·정적 검사·빌드 실패 차단. 단위 테스트 0건 수집도 실패 처리 |
| 프론트 16건 | 정확한 테스트 이름·실패 원인·담당·해제일 목록 작성 → 제품 결함 / 오래된 기대값 / 브라우저 실행환경으로 분류 → 수정 후 차단 복귀 |
| 임시 격리 | 알려진 테스트 이름만 별도 실행, 신규 실패·격리 확대 차단. 출시 핵심 경로 실패는 격리로 통과시키지 않음. 운영 출시 전 16건 각각의 처리 근거 확정 |
| 백엔드 통합 | sprint4 제외 대상의 삭제·이동 이력 확인 → 대체 검사와 연결하거나 복원 → 사용하지 않는 제외 옵션 제거 |
| PDF | Linux 라이브러리·한글 폰트 고정 후 재현. 4페이지 요구 유지 여부를 확인하고 잘림·문구 누락까지 검증. 단순 허용 페이지 수 확대 금지 |
| 전체 흐름 검사(E2E) | CI 내부에서 임시 PostgreSQL·Redis·API·프론트 시작, 합성 데이터 준비, 준비 완료 후 Playwright 실행. 공유 dev 접속 금지 |
| 필수 사용자 경로 | 로그인·기관 간 접근 차단·밴드 없는 세션·합성 녹음→리포트·PDF·이메일/푸시 발송 대기열·실시간 재연결 |
| 비차단 허용 | 실행 시간 추이·넓은 브라우저 조합·비용이 드는 외부 AI 품질 탐색. 단, 출시 필수 시나리오 실패는 비차단 전환 금지 |

- 근거: `.github/workflows/ci-feature.yml:35,57,88`; `frontend/vitest.config.ts:22`; `frontend/vitest.browser.config.ts:19`; `backend/tests/test_sdd070_pdf_metrics.py:77`.
- 브라우저 파일명을 한 규칙으로 통일하고 주소·포트를 주입. 개발 서버 전용 테스트와 완성 빌드 검증을 분리. 현재 5175 하드코딩과 5176 안내 혼재. `frontend/tests/org-counselor-management-browser.test.cjs:44`; `frontend/vitest.browser.config.ts:8`.
- 실제 AI·이메일·푸시는 승인된 시험 계정에서 별도 점검. CI 기본 실행은 대체 응답·시험 수신함 사용. `[확정 사실: 데이터 민감도·3채널]`

### 2.4 배포·환경 주입·버전

- 산출물 제안: 커밋 식별값, 프론트 정적 파일, 백엔드 소스·고정 의존 패키지, 마이그레이션, 서비스·주기 작업 정의, 체크섬, 검사 결과를 한 릴리스 명세에 결합.
- 빌드는 한 번 수행하고 같은 체크섬의 산출물을 후보 환경에서 운영으로 승격. 운영 서버의 `pip install` 재해석과 배포 중 시스템 패키지 갱신 제거. `.github/workflows/deploy-dev.yml:181`
- 프론트 공개 설정은 별도 실행 시점 설정 파일로 주입하고 앱 시작 전에 검증. API·LiveKit·로그인 공개 ID·환경 식별자 포함, 비밀값 제외.
- `.env.prod` 존재만으로 운영 설정 적용을 보장하지 못함. 현재 빌드는 `vite build`이며 Vite 기본 모드는 `production`. 명시적 모드 또는 실행 시점 설정으로 통일. `frontend/package.json:8`; `[확정 사실: 환경]`; [Vite 환경 설정 문서](https://vite.dev/guide/env-and-mode)
- 백엔드는 명시적 환경 파일 경로·systemd 주입으로 통일. 운영 필수값 누락, dev 주소, 역할 시뮬레이션 활성화 시 배포 차단. 현재 `.env`→`.env.dev` 자동 탐색 제거 대상. `backend/app/config.py:8,50,68`; `.github/workflows/deploy-dev.yml:168`
- 브라우저 출처 허용 목록(CORS), Socket.IO 출처, 이메일 링크, LiveKit 주소를 환경별 검증. `backend/app/main.py:53`; `backend/app/ws/__init__.py:80`; `frontend/src/hooks/useLiveKit.ts:8`
- 배포 직렬화는 **환경 단위**로 설정. 실행 중 배포 취소 금지, 수동 재실행도 동일 잠금·검사 적용. `.github/workflows/deploy-dev.yml:15`
- 수동 실행 입력은 승인할 산출물 ID·버전·사유로 제한. 오래된 커밋 재배포는 복구 경로로 분리. 기본 브랜치에도 워크플로가 있어야 수동 실행 가능. [GitHub 수동 실행 문서](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- 배포 후 점검 제안: 외부 접속, 배포 버전, DB 조회·Redis 응답, 워커 왕복 작업, 전용 시험 계정 핵심 경로. 실제 고객에게 알림을 발송하지 않음.
- 공개 점검·관찰 시간 통과 후 성공 확정. 직전 정상 산출물·가상환경·설정 버전·서비스 정의 보관, 복구도 외부 점검까지 수행. `.github/workflows/deploy-dev.yml:278`
- 버전 제안: `v주.부.수정` 태그, 후보는 `-rc.N`. 릴리스 노트에 SDD 번호·사용자 변화·설정/DB 변경·호환 범위·복구 방법·알려진 문제 기록.
- 태그와 산출물 매핑은 변경 금지. main 병합으로 커밋이 달라지면 최종 커밋을 검사·빌드하여 후보 검증부터 재수행. `[제안: 동일 산출물 보장]`

### 2.5 DB·주기 작업·무중단 전환

| 순서 | 기술 처리 제안 |
|---|---|
| 1. 사전 검증 | Alembic 최종 분기 1개 확인, 운영 현재 버전과 예상 버전 대조, 빈 DB 및 이전 버전 데이터에서 업그레이드 검사 |
| 2. 복구 준비 | 백업과 별도 DB 복원 연습, 소요 시간·복구 시점 기록. 파괴적 변경은 별도 승인 릴리스로 분리 |
| 3. 확장 변경 | 구버전 코드가 동작하는 컬럼·테이블 추가 먼저 실행. 배포 잠금 아래 마이그레이션 1회 수행 |
| 4. 코드 전환 | 새 API·워커와 구버전 작업 메시지 호환 확인, 프론트 전환. 기존 긴 작업 종료·재시도·중복 방지 검증 |
| 5. 데이터 이행 | 재시작 가능한 소량 배치, 오류·건수 점검. 구버전 앱 지원 종료와 복구 기간 경과 후 컬럼 제거 |
| 6. 실패 대응 | 호환 스키마는 유지하고 이전 코드로 복귀. 비가역 변경은 수정 배포 우선, 필요 시 쓰기 중단→별도 DB 복원→차이 확인→접속 전환 |

- DB 복원 이후 쓰기를 잃거나 대조해야 할 수 있으므로, 자동 `alembic downgrade`를 운영 복구로 간주하지 않음. `backend/alembic/versions/e036a0000028_sdd_125_remove_paused_status.py:20`
- cron 14개는 작업명·주기·시간대·실행 제한·담당을 가진 단일 목록과 systemd timer/service로 관리하는 안 권장. 공통 환경 주입·실행 잠금·표준 로그 적용. `.github/workflows/deploy-dev.yml:236`
- cron→timer 전환은 기존 항목 중지 확인 후 활성화. 중복 실행 방지·실패 재시도·만료된 알림 처리 기준 검사, 복귀 시 timer 중지 후 이전 cron 복원. `.github/workflows/deploy-dev.yml:203,247`
- 두 서버 교대 전환(blue-green) 전제: 실시간 메모리 상태 공유, 로컬 음성 청크 저장소 전환, 중복 스케줄러 차단, 구·신 워커 메시지 호환. `backend/app/ws/session_live_namespace.py:44`; `backend/deploy/mindbreeze-worker.service:18`
- 전제 충족 후 새 서버 준비→점검→신규 연결 전환→기존 상담 종료 대기→구 서버 종료. LiveKit 방·음성 업로드·WebSocket 연결 유지 여부를 따로 검증.
- 단일 서버 내 두 프로세스 교대는 서버 장애 대비가 아니며, 현재 3.8GB 메모리에서 안전성 미검증. 초기부터 무중단을 약속하지 않음. `[확정 사실: 서버]`

### 2.6 Capacitor 앱 배포

| 항목 | 기술 처리 제안·근거 |
|---|---|
| 앱 구분 | 운영 `com.looxidlabs.mindbreeze`, 개발 `.dev` 접미사. 이름·아이콘도 구분. 현재 ID는 단일. `frontend/capacitor.config.ts:4` |
| 환경별 빌드 | Android flavor, iOS scheme·설정 파일 분리. API·LiveKit·로그인·Firebase 프로젝트를 한 환경 묶음으로 검사. `frontend/android/app/build.gradle:6`; `frontend/ios/App/App.xcodeproj/project.pbxproj:318` |
| Firebase | dev/prod 프로젝트·클라이언트 설정·서버 발송 자격 분리. 운영 빌드에서 설정 누락 시 실패 처리. 현재 Android는 설정 누락을 로그로만 처리. `frontend/android/app/build.gradle:47` |
| 생성 순서 | 환경 지정→웹 빌드→`cap sync`→패키지 내부 주소·ID 검사→서명. 현재 `cap:sync`의 재빌드 때문에 다른 환경 dist 덮어쓰기 방지. `frontend/package.json:16` |
| 동일 산출물 범위 | dev/prod 앱은 ID·주소가 달라 별도 산출물. **운영용으로 만든 동일 서명 빌드**를 내부 검증→스토어 출시로 승격 |
| 출시 트랙 | Android 내부→비공개 테스트→운영, iOS TestFlight→App Store. 개발 앱 검증 외에 운영 앱의 합성 계정 실기기 검증 필수 |
| 버전·키 | 표시 버전과 증가하는 빌드 번호 분리. 서명키·인증서 접근을 배포 권한으로 한정. 현재 Android/iOS 빌드 번호 1. `frontend/android/app/build.gradle:10`; `frontend/ios/App/App.xcodeproj/project.pbxproj:309` |
| 강제 업데이트 | 권장 버전·최소 허용 버전 분리. 호환성 파괴·긴급 보안에만 강제, 스토어 공개 확인 후 적용, 진행 상담 중 차단 금지 |
| 앱 복구 | 배포 중단·서버 기능 비활성화·수정 버전 제출 준비. 이미 설치된 앱의 즉시 하향 복구를 전제하지 않음 |

- Android 환경별 ID 구현 근거: [Android 빌드 변형 문서](https://developer.android.com/build/build-variants).
- iOS 출시 빌드 시험·단계 배포 참고: [Apple 출시 빌드 검사](https://developer.apple.com/documentation/xcode/testing-a-release-build), [단계적 업데이트 배포](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/).
- 앱의 구버전 지원 기간과 강제 업데이트 예외는 D5에서 결정. `[확정 사실: 스토어 심사·서명 미진행]`

## 3. 단계별 로드맵

- 소요는 담당 엔지니어 1명 기준 작업일 **추정**. 승인 대기·AWS 환경 구축·스토어 심사 기간 제외.
- 단계별 SDD 사전 검증 승인 후 구현. 본 리뷰는 구현 승인 또는 verify 산출물을 대체하지 않음. `[사용자 제공 AGENTS.md: 7-Stage SDD]`

| 단계 | 산출물·완료 조건 | `.github/workflows` 변경 목록 | 소요·선행조건 | 롤백 |
|---|---|---|---|---|
| Phase 0 실사용 보호 | 직접 push 제한, 자동배포 임시 중지, 수동 승인·긴급 배포 기록, main 복구 기준점 | `deploy-dev.yml` 수정: 수동 실행·승인·환경 잠금·백업 유지 | 1~2일; D1, 실제 기본 브랜치·권한 확인 | 이전 정상 산출물 수동 배포; 무승인 자동배포는 재개하지 않음 |
| Phase 1 검사 복구 | 16건 처리 목록, 백엔드 제외 정리, 핵심 E2E·DB 변경 검사 차단화 | `ci-feature.yml` 수정; `ci-e2e.yml`, `ci-migrations.yml` 추가 | 4~7일; Phase 0, 시험 데이터 정의 | 검사 변경만 복귀; 필수 검사 실패 시 배포 보류 |
| Phase 2 운영 분리 | 고정 산출물·설정 분리·Brian 승인·공개 점검·timer 관리·복구 연습 | `build-release.yml`, `deploy-prod.yml`, `rollback-prod.yml`, `deploy-staging.yml` 추가; `deploy-dev.yml` 검사 연계 | 5~8일; Phase 1, 별도 운영 환경·복원 검증 완료 | 구코드+호환 DB 유지; 데이터 이관 후 원래 dev로 단순 복귀 금지 |
| Phase 3 앱 출시 | 개발/운영 앱 분리, 서명·실기기 검증·트랙 승격·최소 버전 제어 | `ci-mobile.yml`, `build-mobile.yml`, `release-mobile.yml` 추가 | 4~7일; Phase 2, 스토어 계정·서명 준비 | 트랙 중단·기능 비활성화·수정 빌드; 서버 하위 호환 유지 |
| Phase 4 중단 최소화 | 상태 외부화·파일 공유·연결 종료 대기·장애 복구 검증 | `ci-e2e.yml`, `deploy-prod.yml`, `rollback-prod.yml` 수정; `release-drill.yml` 추가 | 5~10일; D4, Phase 2 안정화·추가 용량 확보 | 트래픽 구서버 복귀·신규 작업 중지·상태 정합 점검 |

- Phase 2 순수 dev 자동배포 재개 조건: 실사용자·실사용 데이터 이동 완료, 외부 발송 격리, CI와 배포 커밋 일치. `[확정 사실: DB·사용자 혼재]`
- `deploy-staging.yml`은 임시 환경 생성·검증·제거와 잔재 점검 포함. 상시 환경 선택 시 생성·제거만 생략. `[제안: D2 대응]`

## 4. 위험·함정

| 함정 | 대응·근거 |
|---|---|
| 운영 인프라를 만들면 코드도 운영 준비가 끝났다고 판단 | 역할 시뮬레이션·링크·WebSocket 출처·앱 주소까지 검증. `.github/workflows/deploy-dev.yml:168`; `backend/app/ws/__init__.py:82` |
| Redis 연결 기능이 있으니 다중 서버 가능하다고 판단 | 실시간 세션 메모리 상태는 별도 외부화 필요. `backend/app/ws/__init__.py:72`; `backend/app/ws/session_live_namespace.py:44` |
| 단위 테스트 성공을 실시간 통합 검증으로 해석 | pytest 실행 중 Redis manager를 비활성화함. 별도 실행 API·워커를 연결하는 검사 필요. `backend/app/ws/__init__.py:63` |
| 서버 교대 후 녹음 처리 누락 | API·워커가 호스트 `/tmp` 음성 청크에 의존. 저장 위치·처리 중 작업 이전 검증 필요. `backend/deploy/mindbreeze-worker.service:18` |
| 롤백 후 신버전 파일·패키지가 남음 | 현재 압축 해제는 기존 디렉터리에 덮어씀. 버전별 새 디렉터리·가상환경과 원자적 경로 전환 필요. `.github/workflows/deploy-dev.yml:140,183` |
| CI 설정만 고쳐 배포 차단됐다고 판단 | 필수 상태 검사·배포 권한·실행 커밋 검증까지 연결해야 함. `.github/workflows/deploy-dev.yml:53` |
| 새 환경에서 기존 알림을 다시 발송 | 이관 시 대기열·발송 이력·cron 실행 주체를 함께 전환. dev 외부 발송 차단. `.github/workflows/deploy-dev.yml:252,254,267` |
| 운영 데이터 이관 후 장애 시 dev 주소로 복귀 | 이관 뒤 신규 쓰기·파일·알림 상태 차이가 생길 수 있음 **추정**. 최종 쓰기 중단·검증·복귀 가능 시점 명시. `[확정 사실: 데이터 혼재]` |

## 5. Brian이 결정할 항목

| 번호 | 선택지 | 추천·근거 |
|---|---|---|
| D1 | 운영 분리 전 수동 승인 / 현행 자동배포 유지 | **수동 승인**. 현재 dev에 실사용자가 있고 CI 실패도 배포됨. `[확정 사실: 배포·운영]` |
| D2 | 임시 후보 검증 환경 / 상시 환경 | **임시 환경부터 시작**. 비용 추정 월 3~15만 원, 출시 빈도 증가 시 상시화. `[비용 추정: §2.1]` |
| D3 | GitHub 승인 기능 지원 요금제 / Brian 전용 배포 저장소 | **현 계약 확인 후 지원 기능 우선**. 추가 계약비와 별도 저장소 관리비 비교. `[공식 문서: §2.2]` |
| D4 | 초기 점검 시간 허용 / 출시 전 무중단 구현 | **점검 시간 허용 후 고도화**. 세션 메모리·음성 파일 의존성 때문에 즉시 교대 배포 위험. `backend/app/ws/session_live_namespace.py:44`; `backend/deploy/mindbreeze-worker.service:18` |
| D5 | 구앱 30일 지원 / 90일 지원 | **30일을 초기 목표로 제안**, 긴급 예외 별도. 지원 기간만큼 파괴적 API·DB 변경 유예. `[제안: 스토어 배포 도입 대응]` |
| D6 | Phase 0~2 우선 / 앱·무중단 동시 추진 | **Phase 0~2 우선, 10~17작업일 추정**. 실사용 노출 차단과 검사·복구 확보가 선행. `[위험 진단·로드맵]` |
| D7 | 데이터 손실 없는 변경 우선 / 복원 시 일부 손실 감수 | **손실 없는 호환 변경 우선**. 불가피한 DB 복원은 허용 손실·중단 시간을 릴리스별 명시 승인. `[확정 사실: 민감 데이터]` |

- 에이전트가 처리할 기술 사항: 워크플로 의존 관계, 테스트 분류·복구, 산출물 체크섬, 환경 검증, timer 변환, 브랜치 검사, 앱 설정 생성, 복구 절차 자동화.
- Brian의 승인 대상: 비용·일정·서비스 중단·데이터 손실 허용 범위와 구체적 운영 출시 결과. `[확정된 결정: 운영 배포 최종 게이트]`
EXIT:0
