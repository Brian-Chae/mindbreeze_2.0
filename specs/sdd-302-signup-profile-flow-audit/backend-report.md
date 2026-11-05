# SDD-302 — 백엔드 구현 결과

## 변경
- 본인 UserResponse에 `client_required_fields`, `profile_prompt_dismissed`, `gender`, `birth_date`, `phone` 추가. 필수 판정은 client 역할의 실제 이름·성별·생일이며 공급자/기존 완료 플래그와 독립이다. 전화번호는 선택이다.
- `GET /api/v1/auth/users/me`는 최신 UserResponse 반환. 생일은 과거 상세정보 수정 호환을 위해 ClientProfile 값 우선, 없으면 User 값으로 보완한다. 신규/PATCH는 두 값을 함께 저장한다.
- 이메일(레거시 포함)·Google·Apple 신규는 성별 누락 시 422 `detail.code=GENDER_REQUIRED`. 소셜 기존 로그인에는 가입 입력을 요구하지 않는다. Apple 오류는 nonce 소비 전에 반환되어 같은 nonce로 성별 보완 재시도가 가능하다.
- Google 신규 확인 이름은 요청의 trim된 name 우선, 없으면 공급자 이름 사용. 기존 계정 재로그인은 입력 이름으로 덮어쓰지 않는다.
- `POST /onboarding/client/complete`: client 역할 확인, 필수 누락 400 `{code:CLIENT_REQUIRED_FIELDS, message, required_fields}`. 충족 시 기존 step1~4·전화번호 없이 완료 가능. 코치 완료 계약은 유지한다.
- `POST /onboarding/client/profile-dismiss`: client 전용, UserResponse 반환. `OnboardingProgress.steps.profile_prompt_dismissed=true`만 저장하고 다른 진행키/완료 상태 보존, 반복 요청 안전. DB migration 없음.

## 검증
- 신규 핵심 RED: 27 failed / 1 passed → 구현 후 28 passed.
- Google 신규 확인 이름 RED: 1 failed → 구현 후 관련 회귀 통과.
- 과거 상세프로필 생일 우선 RED: 1 failed → 구현 후 통과.
- 관련 13파일 회귀: **165 passed**, 60.23초. 인증·가입·코치/회원 온보딩·초대·역할·연령/동의·Apple nonce/연결 포함.
- 생일 호환 최종 수정 후 신규+Apple 재검증: **51 passed**, 25.14초.
- `git diff --check` 통과. crypt/argon2 및 기존 HTTP 422 상수 DeprecationWarning 존재.
- 전체 `pytest -q --tb=short --maxfail=10`는 SQLite 강제 환경에서 실행 중이다. 전체 통과로 보고하지 않는다. 최종 결과와 실패 분류는 후속 기록한다.

## 테스트 입력 호환
기존 공통 fixture의 생일 기본값 보정에 성별을 추가했다. `X-Test-Strict-Signup: 1`은 모든 가입 기본값 보정을 끄며 신규 실패 테스트는 이를 사용한다. 기존 프로필 없는 출발 상태 복원은 생일과 성별 둘 다 자동 주입했을 때에만 수행한다. 기존 연령·동의·nonce 테스트 단언은 유지하고 정상 payload에 성별을 추가했다.

## 한계
합성 HTTP API + SQLite/fakeredis 검증이다. 실 OAuth·네이티브 앱·운영 DB·메일 발송은 수행하지 않았다. PR/배포는 감독 담당이다.

## 독립 리뷰 보완
- 선택 전화번호 PATCH는 미전달이면 보존, 명시 `""`/공백/`null`이면 삭제(None). 값은 양끝 공백을 제거한다. RED 3개 → GREEN.
- 공용 `get_progress`에서 기존 User 부모행을 `SELECT FOR UPDATE`로 잠가 단계·완료·보류 쓰기를 사용자별 직렬화한다. 진행행이 아직 없어도 최초 INSERT가 경합하지 않는다. 잠금 획득 후 `populate_existing`으로 오래 열린 세션의 JSON 캐시를 갱신한다.
- 로컬 전용 임시 PostgreSQL + Alembic 하네스로 실제 2스레드 race 검증: 최초 보류 동시요청은 중복 키 예외, 기존 단계/보류 동시저장은 키 소실로 **RED 2 failed** 재현 → 수정 후 **2 passed**. 기존 step1/새 step3/보류키/current_step/완료=true 보존을 확인했다.
- 전화번호·동시성 변경 후 신규/PG/회원·코치 온보딩/초대/가입/Apple 회귀 **86 passed**, 48.63초. PG 검증은 SQLite 대체가 아닌 실제 로컬 PostgreSQL이며 외부 DB에 접속하지 않았다.
