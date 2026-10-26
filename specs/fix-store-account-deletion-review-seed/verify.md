# [MB261026][FIX] 계정 삭제 공개 페이지·심사 계정 운영 시드 — 구현 전 검증 계획

- 카드: `fix/store-account-deletion-review-seed` (origin/develop `3bf4c75e` 분기)
- 요청: APP 창구 → TASK BOX(73a641c2), Brian 10/26 승인("제출 전 남은 항목 모두 처리"), 추가 범위(명상 클래스 중심 문구·부제) 10/26 확정
- 범위 밖: 심사 제출·출시·운영 배포·운영 DB 접속·운영 스크립트 실행·메일/초대 발송·기능 플래그 변경
- 이 문서는 구현 전에 작성했다. 결과는 `summary.md`에 적는다.

## 1. 원인 분석

| 증상(APP 보고) | 원인 | 근거 |
|---|---|---|
| 운영 `/account-deletion` 404 | 운영(main `addcb7e0`, 10/18)이 SDD-220 머지 전 빌드다. 라우트·페이지 자체가 운영 번들에 없다. nginx는 SPA fallback(`try_files … /index.html`)이라 React NotFound가 뜬다 | `git show origin/main:frontend/src/App.tsx`에 `/account-deletion` 없음, develop `App.tsx:176`에 있음, `deploy/templates/nginx/mindbreeze.conf.tpl:72` |
| 운영 개인정보처리방침 v1.0 | 같은 원인. develop은 v2.2(10/24) | `origin/main:frontend/src/lib/privacy-policy.ts:4` = `1.0`, develop = `2.2` |
| 운영 지원 경로 404 | 공개 `/support` 라우트가 없다(랜딩 `#support` 절만 있음) | `App.tsx` 라우트 목록 |
| 페이지가 Google Play 삭제 URL 요건에 부족 | 현 페이지는 앱 이름만 있고 개발자 이름·앱 안 삭제 단계·삭제/보관 데이터 종류와 기간·지원 메일이 없다 | `frontend/src/pages/account-deletion-page.tsx` |
| 심사 계정 운영 시드 불가 | `seed_store_review.py`는 SQLite 격리 DB 전용(PG URL 거부), 비밀번호는 환경변수 입력, 운영 경로 없음 | `backend/scripts/seed_store_review.py:17-24` |
| 공개 문구가 상담·AI 중심 | 랜딩 문구가 상담센터·상담사 중심이고 메타 description/title에 "상담 기록과 AI 요약"이 있다. AI는 플래그 분기가 있으나 상담은 분기 없음 | `frontend/index.html:8,10`, `components/landing/*` |

→ 운영 404·v1.0은 **코드 결함이 아니라 prod 릴리즈 미반영**이다. 운영 반영은 DEPLOY prod 릴리즈(Brian 승인) 몫. 이 카드는 소스를 요건에 맞게 보강한다.

## 2. 수정 계획

### A. 공개 계정 삭제 페이지 `/account-deletion` 보강 (로그인 불필요)
- 표시 항목: 앱 이름(MIND BREEZE 2.0 · 마인드브리즈), 개발자(룩시드랩스 / Looxid Labs Inc. — 사업자등록번호 등 식별값은 넣지 않는다), 부제 「뇌과학 기반 명상 클래스 서비스」
- 앱 안 삭제 단계: 로그인 → 설정 → 개인정보·약관 → 계정 삭제 → 안내 확인 → 본인 확인(비밀번호/소셜 재인증) → 최종 확인
- 앱 밖 요청: 기존 이메일 접수 폼 유지 + 지원 메일 `admin-mindbreeze@looxidlabs.com`. 접수만으로 삭제되지 않음·본인 확인 후 처리. 비밀번호를 메일로 요구하지 않음. **처리 기한 약속 없음**(코드에 기한 보장 없음)
- 삭제·보관 데이터와 기간(방침 v2.2·코드 동작과 일치하는 것만)
  - 탈퇴 즉시: 로그아웃·로그인 차단, 이름·연락처 비식별(`account_deletion_service.delete_account`)
  - 탈퇴일부터 30일 후 영구 삭제(정해진 주기로 실행되어 직후 즉시가 아닐 수 있음): 프로필·이용 기록·뇌파 데이터·업로드 파일 (`account_deletion_grace_days=30`, sweep `USER_OWNED`)
  - 남는 자료: 다른 참여자 기록·기관 공용 자료·비식별 그룹 집계, 함께한 클래스의 녹음·영상 원본(진행자 자료, 클래스 종료 후 90일 삭제 기준), 이미 발송된 리포트
  - 기록 원본 90일(`RAW_RETENTION_DAYS`, 방침 제3조), 비회원 정보 90일(제6조)
  - 연구 동의자 예외: 영구 삭제 때 연구 동의 철회 처리 + 기존 비식별 사본은 철회 요청 절차, 이미 분석에 쓰인 결과는 되돌릴 수 없음(방침 제5조·5조의2, sweep `_withdraw_research`)
  - 백업: 방침 표의 주기(DB 14일·파일 이전 버전 30일) 안에 소거
  - 법정 보관 항목: 생기면 방침에 공개(현재 `LEGAL_HOLD_ITEMS=()`)
- 금지: "즉시 삭제", 처리 기한 보장, 코드에 없는 기능, 결제·의료 금지어(`findPublicCopyViolations`)
- 설정 화면과 공유하는 `DELETION_NOTICE_LINES`의 "상담·수업 기록"은 "클래스 등 이용 기록"으로 중립화(삭제 범위 의미는 동일)

### B. 개인정보처리방침
- v2.2가 최신이며 운영 Release Build가 같은 소스(`release-build.yml` → `npm run build`, ref 기본 develop)를 쓰는지 확인만.
- 방침 본문·버전은 바꾸지 않는다(본문 변경 = 동의 버전 영향). `/privacy` 페이지의 "계정 탈퇴와 영구 삭제" 조 아래에 `/account-deletion` 링크를 화면 요소로 추가.
- 상담 관련 조항은 삭제하지 않는다. 바꿀 만한 곳은 summary에 표로 보고만.

### C. 공개 문구 명상 클래스 중심 정리 (문구만, 플래그·코드 경로 무변경)
- `index.html` title/description → 새 부제 「뇌과학 기반 명상 클래스 서비스」 기준, 상담·AI 표현 제거
- 랜딩(Hero·People·Process·FAQ·CTA·Footer): 상담 플래그(`isCounselingEnabled`, 기본 OFF) 기준 분기. OFF면 명상 클래스 중심 문구, ON이면 기존 문구 유지(AI 분기와 같은 패턴)
- 공개 지원 페이지 `/support` 신설: 앱·개발자, 문의 메일, FAQ(랜딩과 같은 데이터), 계정 삭제·방침·약관·긴급 도움 링크
- 변경 전후 표를 summary·PR에 기록

### D. 심사 계정 운영 시드 `backend/scripts/seed_store_review_ops.py` (신규, D6)
- 대상: 앱 설정의 `DATABASE_URL`(PostgreSQL만). SQLite는 거부(기존 `seed_store_review.py` 사용)
- 가드: `ENVIRONMENT=production/prod` 또는 로컬·dev RDS가 아닌 호스트면 `--allow-production` 없이 **접속 전** 거부. URL query 우회(host/hostaddr 등) 거부
- 기본 dry-run: 읽기 전용 트랜잭션(`SET TRANSACTION READ ONLY`)에서 계획만 출력(생성/유지/비밀번호 회전 여부, 행 수). 쓰기 0
- `--apply`: 진행자 1·회원 1(`store-review-{counselor,client}@example.com`, 탈퇴·정지 시 `-N` 새 주소로 대체), 합성 클래스·회차·참여·지표 60창·리포트 2(기존 `seed_store_review.py` 내용 재사용, 실제 개인정보 0)
- 멱등: 재실행 시 행 중복 0, 비밀 파일의 비밀번호가 DB 해시와 맞으면 비밀번호 유지. 비밀 파일이 없거나 불일치면 그 계정만 새 비밀번호로 회전
- 비밀번호: `secrets` 로 실행 시 생성 → `backend/.secrets/store-review-accounts.json`(디렉터리 700, 파일 600, gitignore)에만 기록. stdout·로그·예외 메시지에 비밀번호 0. DB 커밋 전에 파일을 원자적으로 기록(커밋 실패 시 다음 실행이 불일치를 감지해 회전)
- 발송·외부 부수효과 0: DB 직접 삽입만, 서비스 함수(초대·알림·outbox) 호출 없음. `notification_preferences`를 전 채널·전 유형 억제 상태로 설정, device_tokens 없음
- `--deactivate`: 심사 후 비활성(상태 `suspended`), dry-run 기본 동일
- 기존 `seed_store_review.py`(SQLite 격리) 동작·테스트는 유지(코어 함수만 공유)

## 3. 검증 체크리스트 (QA = 테스트 케이스)

### 프론트 (vitest)
- [x] V1 `/account-deletion`을 실제 App 라우터로 비로그인 렌더 → 로그인 화면으로 이동하지 않고 삭제 페이지 h1 표시
- [x] V2 `/support`도 비로그인으로 표시
- [x] V3 삭제 페이지에 앱 이름·개발자·앱 안 삭제 단계·지원 메일·삭제/보관 항목(30일·90일·연구 동의 예외·백업) 표시
- [x] V4 페이지 수치가 방침 상수와 같다(`DELETION_GRACE_DAYS`=30, `RAW_RETENTION_DAYS`=90, `PRIVACY_CONTACT_EMAIL`)
- [x] V5 삭제 페이지·지원 페이지·랜딩(상담·AI OFF)에 금지어(`findPublicCopyViolations`) 0, "즉시 삭제" 같은 과장 문구 0, 사업자등록번호 패턴 0
- [x] V6 상담·AI OFF 랜딩에 "상담" 출시 기능 안내 없음, 부제 표시. 상담 ON에서는 기존 문구 유지(회귀)
- [x] V7 `/privacy`에 `/account-deletion` 링크가 있고 방침 버전은 2.2 그대로
- [x] V8 `index.html` title/description에 새 부제, "상담"·"AI" 없음
- [x] V9 기존 `sdd220-auth-consents`·`sdd220-public-copy` 등 관련 테스트 회귀 통과
- [x] V10 `npx tsc --noEmit`·`npm run build` 통과

### 프론트 (Playwright 1개)
- [x] V11 빌드 결과(`vite preview`)에서 비로그인 브라우저(폭 390·1440)가 `/account-deletion`·`/support`에 접근 → URL 유지, 페이지 제목·핵심 안내 문구·지원 메일 표시, NotFound 화면 아님을 assert(HTTP 200만으로 판정하지 않음). 스크린샷을 `specs/fix-store-account-deletion-review-seed/evidence/`에 저장

### 백엔드 (PG, `PG_SMOKE=1` 로컬 임시 PG)
- [x] B1 dry-run: 모든 테이블 행 수 변화 0, 비밀 파일 생성 0, 읽기 전용 트랜잭션
- [x] B2 apply: 계정 2·클래스 1·회차 1·참여 1·지표 60·리포트 2 생성, 로그인 해시가 비밀 파일 비밀번호와 일치
- [x] B3 apply 재실행: 행 수 변화 0, 비밀번호 유지
- [x] B4 비밀 파일 삭제 후 재실행: 행 중복 0, 비밀번호 회전되어 새 파일과 일치
- [x] B5 비밀 파일 권한 600, 디렉터리 700
- [x] B6 stdout/stderr·로그에 비밀번호 문자열 0
- [x] B7 발송 0: `_send_email`·`send_report_email`류·httpx·push 발송 mock 호출 0회 + `notification_outbox`·`notifications`·`device_tokens`·`pipeline_outbox`·`data_export*`·`research_export*`·`account_deletion_requests` 행 수 변화 0
- [x] B8 `notification_preferences`가 이메일·푸시 억제 상태(앱의 발송 판정 함수가 False)
- [x] B9 가드: `ENVIRONMENT=production` 또는 비허용 호스트 + 플래그 없음 → 접속 전 거부(엔진 생성 0), SQLite·query 우회 거부, 플래그 있으면 통과
- [x] B10 탈퇴(`deleted`) 계정은 되살리지 않고 `-1` 주소로 대체
- [x] B11 `--deactivate`: dry-run 무변경, apply 시 두 계정 `suspended`, 로그인 불가
- [x] B12 기존 SQLite 테스트 `tests/test_sdd220_review_seed.py` 회귀 통과

## 4. 보고 원칙
- 페이지 문구 ↔ 방침 ↔ 코드 불일치는 summary에 표로 보고(예: 운영 스위프 비활성 상태에서 30일·90일 약속)
- 실행하지 못한 검증은 "미실시"로 명시
