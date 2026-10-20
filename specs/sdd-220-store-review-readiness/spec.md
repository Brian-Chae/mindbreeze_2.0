# SDD-220 — 앱 스토어 심사 대비와 출시 막바지 준비

- 상태: Stage ① Spec — Brian go/no-go 대기 (결정 D1~D9 확정 반영)
- 브랜치: `sdd/220-store-review-readiness`
- 작성일: 2026-10-20
- 근거: `docs/reviews/prelaunch-audit/01~05`(2026-10-18 읽기 전용 감사), SDD-219 spec P8-02(마켓 차단 항목 → 220)
- 선행: SDD-219(상담 메뉴 비공개, `VITE_COUNSELING_ENABLED`) 병합 완료(`27c2bcc1`)

## 1. 목적

iOS App Store·Google Play 첫 심사를 **한 번에 통과**하도록 반려 사유를 사전 제거하고, 첫 출시 범위에서 **AI 기능을 빼서 운영 비용 폭주 위험을 없앤다**.
감사 이후 develop 78커밋 반영분을 `origin/develop` 기준으로 재확인한 결과(2026-10-20)를 출발점으로 한다.

## 2. 확정 결정 (Brian 2026-10-20)

| ID | 결정 | 반영 |
|---|---|---|
| D1 | **Sign in with Apple 추가** (Google 로그인 유지) | §3.3 |
| D2 | 계정 삭제는 **전체 삭제**. 단 개발자 테스트 중이라 **다음 SDD(221)** 에서 구현 | 범위 밖. 단 §6 제출 게이트 |
| D3 | 채팅 **신고 버튼** + 신고 즉시 **무조건 차단**(최소 구현) | §3.4 |
| D4 | **iPad 지원**. 가로 모드는 데스크톱 레이아웃과 동일 | §3.1 |
| D5 | 최소 가입 연령 **만 14세** | §3.5 |
| D6 | 위기·운영 연락처 `brian.chae@looxidlabs.com` / `010-4248-8180` | §3.6 |
| D7 | 삭제 스위프(보관기간 90일) **운영 활성화 동의** | §3.7 |
| D8 | Apple·Play 모두 **회사(법인) 계정**으로 출시 | §3.9 |
| D9 | **AI 기능 전부 첫 출시 제외**. 유료 버전 업데이트 때 충분히 테스트 후 재공개 | §3.2 |

## 3. 범위

### 3.1 iOS·Android 네이티브 설정

| 항목 | 현재 (origin/develop) | 처리 |
|---|---|---|
| 카메라·마이크 사용 문구 | `Info.plist` 에 블루투스 문구만 | `NSCameraUsageDescription`·`NSMicrophoneUsageDescription` 추가(한/영) |
| 수출 규정 | 없음 | `ITSAppUsesNonExemptEncryption=false` |
| 개인정보 매니페스트 | `PrivacyInfo.xcprivacy` 없음 | 작성 + pbxproj 4곳 등록, 빌드 산출물 포함 확인 |
| iPad (D4) | `TARGETED_DEVICE_FAMILY="1,2"`, iPad 4방향 허용 | 유지. 가로(1024+)에서 데스크톱 레이아웃(`md:` 사이드바)이 나오는지 확인·보정, 세로는 태블릿 레이아웃 |
| 버전 | iOS `1.0(1)` 고정, Android `versionCode` 주입 의존, `package.json 0.0.0` | 첫 출시 `1.0.0`, 빌드 번호 규칙 문서화 |
| Capacitor 취약점 | `@capacitor/core·ios·android 8.3.4` (critical, GHSA-rvm3-566m-v7fv) | 8.5.3 이상 일괄 상향 + `cap sync` |
| Android 서명 | 키스토어 없으면 서명 없이 release 빌드 통과 | 서명 정보 없으면 release 빌드 실패하도록, Play App Signing 업로드 키 보관 절차 문서화 |
| Android 권한 | 위치(FINE/COARSE)·구 BLUETOOTH 선언 | `maxSdkVersion` 한정 여부 점검(API 31+ 는 위치 불필요) |

### 3.2 AI 기능 첫 출시 제외 (D9)

원칙: **SDD-219 상담 비공개와 같은 방식** — 코드·DB·테이블은 유지하고 플래그로 닫는다. 재공개 = 값 변경 후 재배포. 단 비용은 서버에서 발생하므로 **프론트 숨김만으로 끝내지 않고 서버에서도 호출 자체를 막는다**.

플래그
- 프론트 `VITE_AI_ENABLED`(기본 false) — `lib/feature-flags.ts` 에 `isAiEnabled()` 추가
- 백엔드 `AI_FEATURES_ENABLED`(기본 false) — `config.py`

외부 AI 호출 지점 전수 (2026-10-20 grep)

| 영역 | 위치 | 서버 처리 (flag off) | 화면 처리 |
|---|---|---|---|
| 루시(회원 AI 대화) | `api/v1/agent.py`, `agent_service.py`·`agent_llm.py`·`agent_memory.py`·`agent_profile.py`·`agent_checkin.py` | 라우터 미등록 또는 404/403 | 채팅 목록의 루시 채널, `/chat/lucy`, `ai-agent-page.tsx`, 홈 진입점 제거 |
| 상담사 AI 에이전트·브리핑 | `api/v1/agent_counselor.py`, `agent_counselor_service.py`, `agent_briefing.py` | 동일 | `counselor-agent-page.tsx`, `/agent` 리다이렉트, 대시보드 진입점 제거 |
| 위험 신호 감지 | `agent_risk` (루시 대화 기반) | 루시가 꺼지면 자연 소멸 | — |
| 리포트 대화 | `agent_report_chat.py` | 차단 | 진입점 제거 |
| 녹음 → STT → AI 요약 | `audio_service.py:216-232` 체인(`stt_task`·`summary_task`) | 체인 미등록(작업 큐에 안 들어감) | AI 기록·요약 탭(`AISummaryTab`, `RecordView`), 호스트 화면의 "AI 기록" 문구 정리 |
| 리포트 서사 | `summary_task._call_narrative_llm`, `upgrade_narrative_cache` | LLM 호출 없이 **기존 규칙 폴백**(`fallback_narrative`)만 사용 | 화면 변화 없음(문장 출처만 규칙) |
| 리포트 코멘트 초안 | `report_comment_service._call_gemini` | **기존 규칙 초안**(`_rule_based_draft`)만 사용 | "AI 초안" 표기를 "초안"으로 |

- 최종 안전장치: prod 서버 환경변수에서 `GEMINI_API_KEY`·`OPENAI_API_KEY` 를 비운다(코드 경로가 남아도 호출 불가). 키 값은 보존 위치만 기록하고 출력하지 않는다.
- 리포트(뇌파·참여 지표·상담사 코멘트)는 AI 없이 그대로 생성된다 — 기존 규칙 폴백 경로가 있어 새 로직이 필요 없음.
- 방침·스토어 신고에서 AI 처리위탁(Gemini·OpenAI) 항목이 빠지므로 처리방침 개정 범위도 줄어든다(§3.7).

### 3.3 Sign in with Apple (D1)

- 프론트: 로그인·가입 화면에 Apple 버튼(iOS 앱·웹 모두). 기존 `@capgo/capacitor-social-login` 의 Apple 공급자 사용 여부를 plan 에서 확정.
- 백엔드: `POST /auth/apple` — id_token 서명(Apple JWKS)·`iss`·`aud`(번들 ID / 서비스 ID)·`exp`·`nonce` 검증. 신규 사용자는 Google 가입과 같은 약관 3종 + 연령(§3.5) 동의 경로.
- '이메일 가리기'(privaterelay) 이메일 그대로 계정 생성. Apple 은 이름을 최초 1회만 주므로 첫 응답에서 저장.
- 계정 작업(사용자/Aside): App ID 에 Sign in with Apple capability, 웹용 Services ID·Return URL, 키(.p8).

### 3.4 채팅 신고 → 즉시 차단 (D3)

- 메시지 메뉴와 상대 프로필에 "신고" 버튼 1개. 사유 선택(선택 입력).
- 신고 즉시: 신고자 ↔ 대상자 **상호 차단** 기록 → 이후 신고자에게 대상자 메시지 비노출, 1:1 방은 메시지 전송 불가, 대상자를 초대 검색에서 제외.
- 신고 건은 `chat_reports` 에 적재하고 운영 메일(D6 이메일)로 알림. 관리자 처리 화면은 범위 밖(DB 조회로 대응).
- 이용약관에 금지행위·제재 조항(§3.7).
- 차단 해제 UI는 첫 출시 범위 밖(설정 > 차단 목록은 후속).

### 3.5 만 14세 미만 가입 차단 (D5)

- 이메일·Google·Apple 가입 모두 생년월일 필수 → 만 14세 미만이면 서버에서 거부(프론트 안내 + 서버 검증 이중).
- 처리방침·약관에 "만 14세 미만은 가입할 수 없음" 명시. 스토어 연령 등급 설문과 일치.

### 3.6 위기 시 도움 받기 (D6)

- 설정·도움말·회원 홈에서 항상 열 수 있는 정적 화면.
- 공공 긴급번호(자살예방 상담 109, 정신건강 위기상담 1577-0199, 긴급 119, 청소년 1388 — 게시 전 최신 번호 재확인) + 서비스 운영 연락처(D6).
- AI(루시)가 꺼지므로 '위기 감지 응답' 경로는 첫 출시에 없음 → 상시 화면만.

### 3.7 약관·방침·보관기간 (D7)

- `/terms` 이용약관 페이지 신설(본문 초안은 이 SDD, 확정은 법무). 가입·로그인·설정에서 링크.
- 처리방침 개정: 연령 제한, 위탁·국외이전 표(AWS S3·Resend·FCM·LiveKit — AI 제외로 Gemini·OpenAI 제외), 보호책임자, 운영 연락처.
- 삭제 스위프: prod `RETENTION_SWEEP_ENABLED=true` + `RETENTION_APPLY_FROM` 설정 → 방침 시행일 전에 dry-run 결과 확인 후 활성화.

### 3.8 웹 번들·운영 노출 정리

- `cap:ios`·`cap:android`·`cap:sync` 기본 스크립트를 prod 모드로, 번들에 `dev-api` 0건 검사 게이트.
- 번들 용량(약 99MB): `public/bgm` 56MB·`mb-design` 32MB 를 앱 번들에서 제외하거나 원격 제공 전환.
- 운영 API `docs_url/redoc_url/openapi_url` 비활성, `/design/*` 16개 라우트 prod 빌드 제외.
- 앱 안의 웹 전용 UI(PWA 설치 안내, 브라우저 호환 안내) 네이티브에서 숨김.

### 3.9 심사 준비물 (D8)

- 심사용 데모 계정 쌍(진행자·회원) + 샘플 클래스·리포트 시드(prod 데모 기관), 밴드 없이 볼 수 있는 경로 안내.
- `specs/sdd-220-.../appstore-metadata.md`: 앱 이름·부제·설명·키워드·카테고리(Health & Fitness 회피 검토)·연령 등급·App Privacy / Play Data safety 답변·심사 메모(BLE 네이티브 근거, 의료기기 아님, 데모 계정, 상담 메뉴 비공개).
- 법인 계정 점검(읽기 전용, Aside): Apple 법인 팀 멤버십 상태, 번들 ID(현재 iOS `com.looxidlabs.mindbreeze.ios` = 개인 팀 기준) 확정, Play 조직 계정 개발자 인증 상태.

## 4. 범위 밖

- **앱 내 계정 전체 삭제(D2) → SDD-221.** 단 §6 제출 게이트에 걸림.
- AI 기능 재공개·유료 버전·사용량 과금(후속)
- 오류 모니터링(Sentry)·강제 업데이트 API·AI 비용 상한(AI 제외로 시급도 하락)
- 녹음 참여자 개별 동의(§7 E1 결정에 따라 일부 해소)
- 신고 관리자 화면, 차단 해제 UI
- 실제 스토어 제출(메타데이터 입력·업로드·제출은 Brian 승인 후 별도 진행)

## 5. 완료 기준

- [ ] iOS 산출물에 카메라·마이크 문구·수출 규정·`PrivacyInfo.xcprivacy` 포함, iPhone·iPad 시뮬레이터 빌드 통과
- [ ] iPad 가로에서 데스크톱 레이아웃, 세로에서 깨짐 없음(4개 주요 화면 캡처)
- [ ] AI 플래그 off: 프론트 진입점 0건 + 서버의 LLM 호출 0건(테스트로 증명: 루시·상담사 에이전트 403/404, 녹음 종료 시 STT·요약 작업 미등록, 리포트 서사·코멘트는 규칙 출처)
- [ ] AI 플래그 on: 기존 테스트 전부 통과(재공개 회귀 보장)
- [ ] Apple 로그인 신규 가입·재로그인·토큰 위조 거부 테스트
- [ ] 신고 → 상호 차단 → 메시지 비노출·전송 불가 테스트
- [ ] 만 14세 미만 가입 3경로(이메일·Google·Apple) 서버 거부 테스트
- [ ] `/terms`·위기 도움 화면·개정 방침 노출, Capacitor 8.5.3+ 및 `npm audit --omit=dev` critical 0
- [ ] 앱 번들 `dev-api` 0건, `/docs` 비노출
- [ ] `appstore-metadata.md`·심사 메모·데모 계정 준비
- [ ] pytest 전체·vitest·tsc·`eslint src/` 통과

## 6. 제출 게이트 (중요)

Apple 5.1.1(v)·Play 계정 삭제 정책상 **앱 내 계정 삭제가 없으면 심사 반려**된다. D2 로 삭제를 SDD-221 로 미뤘으므로 **스토어 제출은 SDD-221 병합 후**에만 가능하다. 220 완료 시점은 "제출 직전 상태"이며, TestFlight 내부 테스트·Play 내부 테스트 트랙 업로드는 220 만으로 진행할 수 있다.

## 7. 남은 확인 (구현 전, 추천 포함)

| ID | 질문 | 추천 |
|---|---|---|
| E1 | AI 를 끄면 녹음은 STT 용도가 사라진다. **녹음 기능 자체도 끌지**(녹음 버튼·업로드·동의 모달 비노출) | **끈다** — 저장 비용·녹음 동의(감사 02 차단 항목)·처리방침 범위가 함께 줄어든다. 뇌파·화상은 유지 |
| E2 | D6 개인 휴대전화를 앱·처리방침에 **공개 게시**하게 된다 | 화면엔 이메일 + 공공 긴급번호만, 전화번호는 스토어 심사 연락처에만 쓰는 안 추천. 그대로 게시도 가능 |
| E3 | Apple 법인 팀 멤버십이 현재 활성인지(이전 만료 이력 있음) | Aside 읽기 점검으로 확인 후 보고 |

## 8. 위험

| 위험 | 대응 |
|---|---|
| Capacitor 상향이 BLE·푸시·Google 로그인 회귀 유발 | 실기기 회귀 시나리오를 verify 에 포함, 단독 커밋으로 분리 |
| AI 플래그가 서버 전 경로를 못 막음 | 외부 호출 함수에 단일 가드 + prod 키 제거 이중 장치, 호출 0건 테스트 |
| AI 기능에 기대던 화면이 빈 상태로 남음 | AI 진입점 전수 grep 표를 plan 에 고정, 플래그 off 스냅샷 테스트 |
| 1.4.1 웰니스 지표(스트레스·집중) 지적 | 면책 상시 노출, 지적 시 문구 순화 재제출안 준비 |
| 법인 계정 상태로 일정 지연 | 계정 점검을 Task 0 으로 선행 |
