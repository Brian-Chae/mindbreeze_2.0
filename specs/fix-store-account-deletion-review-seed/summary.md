# [MB261026][FIX] 계정 삭제 공개 페이지·심사 계정 운영 시드 — 결과 요약

- 브랜치 `fix/store-account-deletion-review-seed` (origin/develop `3bf4c75e` 분기), 구현 전 계획: `verify.md`
- 범위 밖으로 남긴 것: 머지·배포·운영 DB 접속·운영 스크립트 실행·메일/초대 발송·기능 플래그 변경

## 1. 결론

- 운영 `/account-deletion` 404와 방침 v1.0은 **코드 결함이 아니라 prod 릴리즈 미반영**이다. 운영(main `addcb7e0`, 10/18)이 SDD-220 머지 전 빌드다. 운영에 반영하려면 DEPLOY의 prod 릴리즈(Brian 승인)가 필요하다.
- 소스 쪽은 보강했다: 공개 삭제 페이지를 Google Play 삭제 URL 항목에 맞게 채웠고, 공개 `/support` 페이지를 새로 만들었고, 공개 문구를 명상 클래스 중심으로 바꿨고(상담·AI 플래그가 꺼져 있을 때), PostgreSQL 운영용 심사 계정 시드를 만들었다.
- 기존 SQLite 심사 시드는 **PostgreSQL에서 실패하는 결함 2건**이 있었다(PG 시험에서 발견해 수정, §4).

## 2. 공개 페이지

| 경로 | 로그인 | 들어 있는 내용 |
|---|---|---|
| `/account-deletion` | 필요 없음 | 앱 이름(MIND BREEZE 2.0·마인드브리즈)·부제·개발자(룩시드랩스 / Looxid Labs Inc.)·문의 메일 / 앱에서 삭제하는 5단계(설정 → 개인정보 · 약관 → 계정 삭제 → 본인 확인 → 최종 확인) / 앱 밖에서 요청하는 방법(양식 또는 메일, 본인 확인 후 처리, 접수만으로는 삭제되지 않음, 비밀번호를 요구하지 않음, 비회원 자료 삭제 요청) / 탈퇴 안내 / 삭제·보관 데이터와 기간 7행(탈퇴 즉시, 30일 후 영구 삭제, 남는 자료, 기록 원본 90일, 연구 동의 시, 백업, 법령 보관) / 방침 링크 / 기존 이메일 접수 양식 |
| `/support` (신규) | 필요 없음 | 앱·부제·개발자·문의 메일, 자주 묻는 질문 6개(랜딩과 같은 데이터 + "계정은 어떻게 삭제하나요?"), 비의료 고지, 계정 삭제·방침·약관·긴급 도움 링크 |
| `/privacy` | 필요 없음 | 버전 2.2 그대로(본문·버전 무변경). "계정 탈퇴와 영구 삭제" 조 아래에 `/account-deletion` 링크를 화면 요소로 추가 |

- 사업자등록번호 등 회사 식별값은 넣지 않았다(시험으로 패턴 0건 고정).
- 개인정보처리방침 최신본: 코드상 v2.2(시행 2026-10-24). 운영 Release Build(`release-build.yml`)는 같은 소스(ref 기본 develop)를 `npm run build`로 빌드한다 → 릴리즈하면 v2.2가 나간다.

## 3. 삭제 안내 문구 ↔ 방침 ↔ 실제 코드·운영 대조

문구는 방침 v2.2와 코드 동작에 있는 것만 썼다. 처리 기한 보장·즉시 삭제는 쓰지 않았다.

| 안내 항목 | 방침 v2.2 | 코드 | 운영 상태·불일치 |
|---|---|---|---|
| 탈퇴 즉시 로그아웃·로그인 불가, 이름·이메일·전화·사진 비식별, 푸시 연결 해제 | 계정 탈퇴 조 | `account_deletion_service.delete_account` | 일치 |
| 탈퇴일부터 30일 후 영구 삭제(정해진 주기로 실행) | 계정 탈퇴 조 | `account_deletion_sweep_service`, `account_deletion_grace_days=30` | **불일치 위험**: `ACCOUNT_DELETION_SWEEP_ENABLED` 기본 false, 운영 timer 비활성. D2에 따라 출시 시 활성 필요 |
| 기록 원본(뇌파·음성·영상) 90일, 비회원 정보 90일 | 제3조·제6조 | `retention_sweep_service`, `retention_raw_days=90` | **불일치 위험**: `retention_sweep_enabled` 기본 false, `RETENTION_APPLY_FROM` 비면 실삭제 거부. 운영 활성(D2) 필요 |
| Google·Apple 연결 해제(토큰 철회) 요청 | 위탁 표 | 탈퇴 시 `social_revoke_outbox` 적재 → 스위프 cron이 처리 | 운영 timer가 꺼져 있으면 적재만 되고 처리되지 않음 |
| 앱 밖 요청 → 운영팀 본인 확인 후 처리 | 제9조·제11조 | 요청 행 저장 + `deliver_pending_request_notices`가 `signup_notice_email`로 알림, 플랫폼 관리자 화면 목록 | 알림도 같은 cron 경로. 처리는 사람이 한다(코드상 기한 없음 → 페이지도 기한 약속 없음). 운영 수신 주소 확인 필요 |
| 연구 동의 시: 탈퇴 때 동의 철회 처리, 기존 비식별 사본은 철회 요청 절차 | 제5조·제5조의2 | 탈퇴 시 `_withdraw_research`가 철회·철회 요청 생성 | 실제 사본 삭제는 연구 반출 쪽 처리 절차에 달림(운영 증거 미확인) |
| 백업은 방침 주기(DB 14일·파일 이전 버전 30일) 안에 소거 | 위탁 표 | 배포 스크립트 설정 기준 | 실제 운영 백업 설정 증거 미확인(기존 W1 지적과 같음) |
| 법령 보관 항목은 생기면 방침에 공개 | 계정 탈퇴 조 | `LEGAL_HOLD_ITEMS = ()` | 일치 |

- 코드 대조로 기존 문구 1곳을 바로잡았다: 연구 동의 철회는 "영구 삭제 때"가 아니라 **탈퇴 시점**에 처리된다(`delete_account`에서 호출).

## 4. 심사 계정 운영 시드 `backend/scripts/seed_store_review_ops.py`

### 사용법(대상 환경 `.env`가 로드된 `backend/`에서)

```bash
python scripts/seed_store_review_ops.py                               # dry-run: 읽기 전용, 계획만 출력
python scripts/seed_store_review_ops.py --apply                       # dev/로컬 기록
python scripts/seed_store_review_ops.py --apply --allow-production    # 운영 기록(OPS, 승인 후)
python scripts/seed_store_review_ops.py --deactivate                  # 심사 후 비활성 미리보기
python scripts/seed_store_review_ops.py --deactivate --apply --allow-production
```

- 계정: `store-review-counselor@example.com`(진행자), `store-review-client@example.com`(회원). 탈퇴되면 `-1`, `-2` 새 주소로 대체(되살리지 않음). `--deactivate`로 정지한 계정은 다음 `--apply`에서 다시 활성화
- 합성 자료: 진행자 프로필, 명상 클래스 1·회차 1·참여 1·지표 60창·리포트 2(실제 개인정보 0, "합성 예시 데이터" 표기)
- 비밀번호: 실행 시 생성 → `backend/.secrets/store-review-accounts.json`(디렉터리 700·파일 600, gitignore)에만 기록. 화면·로그에는 "keep/new"만 표시. 다른 경로는 `--secrets-file`
- 가드: `ENVIRONMENT=production/prod`이거나 로컬·dev RDS가 아닌 DB면 `--allow-production` 없이 **접속 전** 거부. SQLite·URL query 우회 거부
- 발송 0: 서비스 함수를 거치지 않고 DB에 직접 넣는다. 두 계정의 이메일·푸시 알림 설정을 모든 이벤트 off로 둔다. 기기 토큰 없음

### 기존 시드 결함 수정(`seed_store_review.py` 공용 함수)

| 결함 | 원인 | 수정 |
|---|---|---|
| 진행자 프로필 삽입 실패 | `counselor_code='SR'+8자`(10자)인데 PG 컬럼은 `String(6)`. SQLite는 길이를 검사하지 않아 기존 시험이 통과했다 | 서비스와 같은 6자리 발급기 `code_service.generate_unique_code` 사용 |
| 회차 삽입 실패 | `host_state` 누락 → PG `ck_sessions_one_parent` 위반 | `host_state='assigned'` |

- 합성 자료 생성은 `seed_synthetic_content(..., dry_run=)` 한 곳에서 dry-run 계획과 실제 적용을 같이 처리한다. 기존 SQLite 시드 동작·시험은 유지.

## 5. 공개 문구 변경 전후 (상담·AI 플래그 off = 운영 기본)

플래그·코드 경로는 그대로 두었다. 상담 플래그(`VITE_COUNSELING_ENABLED`)를 켜면 기존 문구가 나온다(시험으로 고정).

| 위치 | 변경 전 | 변경 후 |
|---|---|---|
| `index.html` title | MIND BREEZE 2.0 — 마음을 돌보는 일, 변화가 보이도록 | MIND BREEZE 2.0 — 뇌과학 기반 명상 클래스 서비스 |
| `index.html` description | 상담 기록과 AI 요약부터 LINK BAND 생체신호와 몸·마음 서사형 리포트까지. 상담센터, 상담사, 명상가를 위한 마인드브리즈. | 뇌과학 기반 명상 클래스 서비스. 명상 클래스 참여와 기록, 선택형 LINK BAND 생체신호와 몸·마음 서사형 리포트를 한곳에서 확인하는 마인드브리즈. |
| 랜딩 상단 배지 | 상담과 명상, 사람에게 더 가까이 | 뇌과학 기반 명상 클래스 서비스 |
| 랜딩 소개 2행 | 상담과 명상의 순간을 기록하고, | 명상 클래스의 순간을 기록하고, |
| 랜딩 소개 하단 | 상담센터 · 상담사 · 명상가를 위한 통합 플랫폼 | 명상 지도자 · 기관 · 참여자를 위한 명상 클래스 서비스 |
| 대상 카드 1 | 상담센터 · 기관 / 흩어진 세션 기록과 리포트… / 세션부터 기록·리포트까지… 센터의 돌봄이… / 세션 관리 | 기관 · 센터 / 흩어진 클래스 기록과 리포트… / 클래스 일정부터 참여 기록·리포트까지… 기관의 프로그램이… / 클래스 운영 |
| 대상 카드 2 | 상담사 / 기록하는 시간보다, 마주 보는 시간을. / 상담이 끝난 뒤에도 기록을 작성하느라… / 기록·리포트·전문가 검토 | 참여자 / 오늘의 명상을, 나만의 기록으로. / 수업이 끝나면 느꼈던 변화가 금방 흐려지지 않나요? / 클래스 참여·나의 기록 |
| 진행 단계 1 | 세션을 준비하고 / 상담·명상 일정을 등록하고… | 클래스를 준비하고 / 명상 클래스 일정을 등록하고… |
| LINK BAND 소개 | …상담과 명상 속 변화를 이해하는… | …명상 속 변화를 이해하는… |
| FAQ 2 | 상담센터와 개인 전문가 모두 사용할 수 있나요? / 상담센터의 세션 운영부터 상담사와… 기관 도입에 관한 상담은… | 기관과 개인 지도자 모두 사용할 수 있나요? / 기관의 명상 클래스 운영부터 개인 명상 지도자의… 기관 도입은 아래 문의 이메일로 알려 주세요. |
| FAQ 5 | 세션 기록과… 전문가의 검토와… | 클래스 기록과… 진행자의 안내와… |
| FAQ 6 | (없음) | 계정은 어떻게 삭제하나요? / 설정 > 개인정보 · 약관 > 계정 삭제, 로그인 불가 시 /account-deletion |
| 푸터 링크 | 이용약관·방침·긴급 도움·측정 방법 | + 고객 지원(`/support`)·계정 삭제 안내(`/account-deletion`) |
| 기관 공개 페이지 메뉴(`Nav.tsx`) | 서비스·AI 리포트·상담사·고객센터 / 상담사 로그인 | 서비스·리포트·고객센터 / 진행자 로그인 |
| 탈퇴 안내 2번째 줄(설정·공개 페이지 공용) | …프로필, 상담·수업 기록, 뇌파 데이터… | …프로필, 클래스 등 이용 기록, 뇌파 데이터…(삭제 범위 의미 동일) |

### 개인정보처리방침의 상담 관련 표현 — 보고만(수정하지 않음)

방침은 실제 수집 항목 기준이고 본문을 바꾸면 버전·동의에 영향이 있어 손대지 않았다.

| 위치 | 현재 문구(요지) | 검토 의견 |
|---|---|---|
| 제2조 2항 | 상담·명상 클래스 진행 중 수집하는 정보: 음성, 영상, 채팅… | 서버가 상담 데이터를 처리할 수 있는 한 유지가 맞다. 첫 출시 문구로 바꾸려면 다음 방침 개정 때 "클래스(명상 등)"로 일반화 검토 |
| 제3조 1항 | 클래스·상담 중 수집한 기록 원본… | 위와 같음 |
| 위탁 조 | AI 요약 기능을 사용하는 경우 … Google Gemini로 전송 | AI 비공개 상태와 모순은 아니다("사용하는 경우"). 출시 시 AI off 확정이면 개정 때 정리 검토 |

## 6. 검증 결과

| 구분 | 명령·방법 | 결과 |
|---|---|---|
| V1~V8 프론트 단위 | `npx vitest run tests/fix-store-account-deletion.test.tsx` | 12건 통과. 라우트 시험은 `/account-deletion`을 `RoleGuard`로 감싸면 실패함을 일시 변형으로 확인 후 원복 |
| V9 프론트 전체 | `npx vitest run` | 3282 통과 / 17 실패. 17건은 기준 커밋 `3bf4c75e`에서도 같은 17건 실패(agent-counselor, chat-deeplink, 브라우저 cjs 4종, sdd220-native-release, sdd234 화면 측정) → 이 변경과 무관 |
| V10 | `npx tsc --noEmit -p tsconfig.app.json`, `npm run build` | 통과 |
| V11 실렌더 | `npm run build` → `vite preview` → `PW_CHANNEL=chrome EVIDENCE_DIR=… node e2e/public-pages.mjs` (설치된 Chrome, 새 임시 프로필, 비로그인) | 390·1440 × `/account-deletion`·`/support` 4/4 통과(제목·핵심 문구·메일 링크 표시, NotFound·로그인 화면 아님). 스크린샷 `evidence/` |
| 랜딩 실렌더 | 같은 빌드, 390·1440 | title 새 부제, 본문에 "상담"·"AI" 없음. 스크린샷 `evidence/landing-*.png` |
| B1~B11 PG | 로컬 임시 PG 16 + `alembic upgrade head` → `PG_SMOKE=1 pytest --confcutdir=tests/pg tests/pg/test_store_review_ops_seed.py` | 9건 통과 |
| PG 전체 | 새 DB에서 `pytest --confcutdir=tests/pg tests/pg -m pg` | 501 통과 |
| 발송 0 | 메일(`_send_email` 2곳)·푸시·웹푸시·리포트 메일 큐·Celery `delay/apply_async`·httpx·requests·boto3 mock 호출 0회 + 알림·outbox·토큰 등 다른 테이블 행 변화 0 | 통과. 일시 변형(apply 안에서 메일 함수 호출 후 예외 삼킴)으로도 시험이 실패함을 확인 후 원복 |
| CLI 실제 실행 | 로컬 임시 DB에 dry-run → apply → 재실행 → `ENVIRONMENT=production` | 68행 계획 → 68행 생성 → 0행·비밀번호 유지 → 접속 전 거부. 파일 600·디렉터리 700, 출력에 비밀번호 0 |
| B12 SQLite 회귀 | `pytest tests/test_sdd220_*.py tests/test_sdd211_pg_fixture_hygiene.py` | 177 통과 |

- 시험 중 덮어써진 다른 SDD 산출물(`specs/sdd-234…/screens/test-a/*`)은 HEAD로 되돌렸다. 임시 DB·임시 워크트리·비밀 파일은 삭제했다.

## 7. 운영 반영에 필요한 후속(이 카드 범위 밖)

1. **DEPLOY**: 이 PR이 develop에 들어간 뒤 prod 릴리즈(Brian 승인) → 운영 `/account-deletion`·`/support`·방침 v2.2 반영. 반영 후 운영 도메인에서 `e2e/public-pages.mjs`를 `BASE_URL=https://mindbreeze.looxidlabs.com`로 실행해 실렌더 확인.
2. **OPS**(D6, 승인 후): 운영 서버 `backend/`에서 ① dry-run → ② `--apply --allow-production` → ③ `backend/.secrets/store-review-accounts.json`을 보안 채널로 APP에 전달(심사 메모 입력) → ④ 심사 종료 후 `--deactivate --apply --allow-production`. 마이그레이션이 head인 상태에서 실행.
3. **OPS·D2**: 출시 시 탈퇴 영구 삭제 스위프·retention 스위프 활성(§3 불일치 해소). 꺼진 상태로 제출하면 안내 문구(30일·90일)와 실제 운영이 어긋난다.
4. **APP**: Play 데이터 삭제 URL `https://mindbreeze.looxidlabs.com/account-deletion`, 지원 URL `https://mindbreeze.looxidlabs.com/support`(prod 반영 후). 스토어 부제는 APP 몫.

## 8. 미실시

- 운영·dev 서버 실행, 운영 DB 접속, 운영 시드 실행, prod 반영 확인(범위 밖)
- PostgreSQL 위에서 시드 계정으로 로그인 API·리포트 API 호출(같은 합성 자료로 SQLite 시험 `test_seed_accounts_can_login_and_read_reports`는 통과, PG에서는 비밀번호 해시 검증·행 생성까지만 확인)
- 실제 앱(iOS·Android) 안에서의 공개 페이지 화면 확인(웹 빌드 실렌더만 확인)
- `specs/sdd-220-store-review-readiness/appstore-metadata.md`의 "운영 실행 방법은 제공하지 않습니다" 문구는 과거 SDD 문서라 고치지 않았다(이 카드의 운영 시드로 대체됨)
