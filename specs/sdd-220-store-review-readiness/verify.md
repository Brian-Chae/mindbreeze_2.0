# SDD-220 Verify — 구현 전 QA 체크리스트

- 상태: Stage ③ — Brian 승인 대기
- 정본: `specs/sdd-220-store-review-readiness/spec.md:1`; 계획: `specs/sdd-220-store-review-readiness/plan.md:1`.
- 작성 기준: `27c2013c`, 2026-10-20. 아래는 **미실행 QA 시나리오**이며 승인/성공 기록이 아니다.
- [차단] 모든 TS는 해당 범위의 출시 차단 조건이다. 미실행·실패·외부 승인 대기는 통과로 표시하지 않는다.
- 신규 오류코드/응답 필드는 plan의 구현 제안 계약이다. 테스트 대상 API 경로는 `/api/v1` 기준이며 `/auth/apple` 등은 해당 prefix를 생략해 표시한다.
- 제안 테스트 파일의 `:1`은 신규 파일 위치(추정). pytest는 backend, vitest/tsc/eslint는 frontend 디렉터리에서 실행한다. 이번 문서 단계에서는 테스트 DB 연결·실제 외부 호출을 수행하지 않는다.

## A. spec §5 완료 기준 대응표

| §5 순서 | 완료 기준 | Test Scenarios |
|---|---|---|
| 1 | iOS 문구·수출·매니페스트·iPhone/iPad 빌드 | TS1, TS25 |
| 2 | iPad 가로/세로 4화면 | TS2 |
| 3 | AI off 진입점/서버 호출 0·원본 유지 | TS3, TS4, TS6~TS8, TS24 |
| 4 | AI on 기존 회귀 | TS5, TS46 |
| 5 | Apple 신규/재로그인/위조 | TS9~TS11 |
| 6 | 신고·상호 차단 | TS32~TS35 |
| 7 | 만14세 3가입 경로 | TS12, TS13 |
| 8 | terms/위기/방침·Capacitor·critical 0 | TS28, TS36 |
| 9 | dev-api 0·docs 비노출 | TS30, TS31 |
| 10 | 메타데이터·메모·데모·영상 | TS44, TS45 |
| 11 | 회원 체험·예시 띠·개발패널 제거 | TS40 |
| 12 | 결제 금지어·도입 문의 | TS37, TS38 |
| 13 | native 기관 가입 비노출/web 유지 | TS38 |
| 14 | 29일 보존·30일 삭제 | TS21, TS22, TS41, TS43 |
| 15 | 의료 금지어·참고 지표·방법·고지 | TS37, TS39 |
| 16 | 3역할×3로그인 탈퇴·토큰·예외·웹 접수 | TS16~TS23 |
| 17 | 한/영 권한·사전 안내·최초 사용 | TS25~TS27 |
| 18 | pytest/vitest/tsc/eslint 전체 | TS46 |

추가 승인 범위 §9.2/F1/F2: TS13~TS15, TS19, TS21, TS24, TS43. 체인·서명·운영 수동 항목: TS29, TS42, TS45.

## B. Test Scenarios

### TS1 — iOS 산출물·버전·매니페스트 [차단]

- [ ] **실행 방법:** 수동 Xcode iPhone/iPad simulator Release 빌드 + frontend/tests/sdd220-native-release.test.ts:1 (신규·추정)
- **절차:** cap sync 후 두 destination 빌드. 결과 .app의 plist/xcprivacy와 프로젝트 Resources를 열어 확인한다.
- **Expected:** 두 빌드 exit=0, CFBundleShortVersionString=1.0.0, CFBundleVersion 증가 규칙 충족, TARGETED_DEVICE_FAMILY=1,2 유지, ITSAppUsesNonExemptEncryption=false. PrivacyInfo.xcprivacy가 Resources에 실제 복사되고 required-reason/data category가 실제 사용과 일치한다. pbxproj FileReference/BuildFile/group/Resources 등록 각 1건; 단순 소스 존재로 통과 금지.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS2 — iPad 4화면 × 가로·세로 [차단]

- [ ] **실행 방법:** 수동 iPad simulator + 실기기 캡처
- **절차:** 로그인, 진행자 클래스 상세, 회원 리포트, 플레이그라운드 4화면을 1194×834 가로 / 834×1194 세로에서 각각 촬영한다.
- **Expected:** 가로 데스크톱 Sidebar 노출, 8장 모두 scrollWidth<=clientWidth, 주요 버튼/본문 겹침·잘림 0. 세로에서 모달 닫기·하단 CTA 접근 가능, 회전 후 입력/체험 상태 유지. 실제 장치와 simulator 증거 구분.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS3 — AI 기본 off·진입점 전수 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정)
- **절차:** 환경변수 미설정/false 각각 3역할로 plan AI FE 표를 순회하고 /agent, /chat/lucy, /app/chat/lucy·과거 푸시 링크 직접 진입.
- **Expected:** AI 채널·CTA·AI 요약/전사 탭·위험 신호·AI 초안 문구 0. 상담사/회원 agent unread·checkin·briefing 요청 0, agent 컴포넌트 mount 0. 직접 URL은 역할 홈/일반 채팅으로 replace하며 redirect loop=0. 녹음/영상/수동 메모/일반 채팅/EEG 리포트는 사용 가능.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS4 — AI off 서버 모든 경계 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정)
- **절차:** 유효 계정/객체 fixture로 agent·counselor API, 단일턴/멀티턴/stream transport, STT/요약 inline 및 Celery task 직접 호출. 가짜 비어 있지 않은 공급자 키를 넣어 키 미설정에 의존하지 않게 한다.
- **Expected:** AI API 전부 403 detail.code=AI_FEATURES_DISABLED. plan의 6 transport HTTP spy 합계=0, retry=0, AI 메시지/추출 행 신규 생성=0. 소켓 스트림/도구 실행도 0. report/record/EEG API까지 일괄 403 처리하면 실패.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS5 — AI×상담 플래그 4조합·재공개 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정); 기존 agent/STT/summary/report 테스트 전체
- **절차:** AI off/on × counseling off/on을 빌드·runtime fixture로 테스트한다. on에서는 공급자 성공 응답 mock 사용.
- **Expected:** off/off: 둘 다 숨김. off/on: 상담만 공개·LLM=0. on/off: AI 기능 복원·상담 메뉴/경로는 계속 숨김. on/on: 양쪽 기존 계약 유지. on의 대화 1요청당 예상 transport 1회, STT→summary 순서 보존. 기존 테스트 전체 실패=0; 과거 테스트를 off 기대값으로 일괄 바꾸어 회귀를 숨기지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS6 — E1 녹음·영상·업로드·원본 유지 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정)
- **절차:** F1/호스트 동의를 충족한 회차에서 오디오·영상 시작→청크 업로드→종료, AI=false/true 각각 실행. 기존 audio/video start·chunk·stop API의 HTTP 200 계약을 고정.
- **Expected:** off: audio/video start·chunk·stop 모두 200, 저장된 bytes와 업로드 bytes 일치, audio/video 키 보존, record.status=completed(녹음 사용)/manual(미사용), video_status=completed. STT signature=0, summary signature=0, 필요한 video merge/report 작업 각 1회. on: STT·summary 각 1회. off라고 원본을 지우거나 리포트를 미생성하면 실패.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS7 — 규칙 서사·코멘트·기존 LLM 캐시 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정)
- **절차:** 같은 지표에 source=llm 캐시가 있는/없는 fixture에서 off 리포트 생성·코멘트 초안·재생성·upgrade를 실행.
- **Expected:** 새 서사는 fallback_narrative 결과와 정확히 일치, 코멘트 응답 source=rule, draft는 _rule_based_draft와 일치. LLM cache hit로 문장을 재사용하지 않음, upgrade 외부 호출=0. EEG 지표/승인/발송 결과는 유지, UI “초안” 표시. 과거 이미 발행된 content는 변경 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS8 — 예약·잔존 큐·리포트 대화 우회 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_ai_features.py:1 (신규·추정), frontend/tests/sdd220-ai-features.test.tsx:1 (신규·추정)
- **절차:** on일 때 적재한 STT/summary/upgrade 작업을 off 후 실행; agent checkin sweep/close_stale·reminder·briefing·profile/memory·on_report_approved를 직접 호출.
- **Expected:** 모든 AI transport=0, 새 AI 메시지/위험 알림/추출 행=0, retry 예약=0. 작업은 skip로 종료해 무한 실패 큐 없음. 일반 리포트 알림/영상 병합/EEG 작업은 원래 횟수로 실행.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS9 — Apple 신규 가입·private relay·이름 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_apple_auth.py:1 (신규·추정)
- **절차:** 정상 JWKS 서명/서버 발급 nonce/authorization code, private relay 주소와 최초 이름으로 신규 요청. 동의/생일 입력 완료.
- **Expected:** POST /auth/apple 200, user.auth_provider=apple, 고유 Apple sub 연결 1건, relay 이메일 그대로, 최초 이름 정확히 저장, 사용자 1명·동의별 현행 버전 저장. refresh token은 암호문이며 응답/로그에 code·토큰·p8 원문 0건.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS10 — Apple 재로그인·중복·공급자 연결 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_apple_auth.py:1 (신규·추정)
- **절차:** 같은 sub로 이름/생일/동의 없이 재로그인; 다른 sub가 같은 이메일을 주장; 최초 가입 요청 동시 2회.
- **Expected:** 기존 sub 재로그인 200·동일 user id·최초 이름 유지·추가 user 0. 동일 이메일만으로 자동 병합/승격 0, 계정 연결 재인증 필요 오류 409 ACCOUNT_LINK_REQUIRED. 동시 가입은 sub 고유 제약으로 사용자 최대 1명. org_admin/platform_admin으로 요청 역할 조작 시 권한 상승 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS11 — Apple 토큰 보안·장애 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_apple_auth.py:1 (신규·추정)
- **절차:** 서명 위조/alg=none/다른 iss/aud/만료/nonce 누락·불일치·재사용/kid 교체·JWKS 장애 각각 호출.
- **Expected:** 위조·claim/nonce 실패는 401 APPLE_TOKEN_INVALID, 신규 사용자/토큰 발급=0. 지원 aud 외 값 거부. 정상 키 회전은 캐시 갱신 후 성공, JWKS 장애는 503 APPLE_UNAVAILABLE이며 인증 우회 0. nonce는 성공 1회 소비; 병렬 replay도 성공 최대 1회.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS12 — 만14세 3경로 경계 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_age_consents.py:1 (신규·추정), frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** Asia/Seoul 기준일을 2026-10-20으로 고정. 이메일·Google·Apple 신규 가입에 2012-10-20 / 2012-10-21 / 미래/빈값/잘못된 날짜 입력. 윤년·UTC 날짜 경계 추가.
- **Expected:** 정확한 14세 허용(이메일 신규 201, 소셜 200); 하루 미달은 422 AGE_RESTRICTED; 누락 422 BIRTH_DATE_REQUIRED; 미래/형식 오류 422 INVALID_BIRTH_DATE. 거부 때 User·Consent·토큰·메일 작업 생성=0. 기존 소셜 재로그인은 생일 없이 200.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS13 — 가입 우회·진행자/기관 발급·F2 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_age_consents.py:1 (신규·추정), frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** legacy /auth/register, 회원 가입, 진행자/기관 가입 신청·승인/초대 완료·소셜 신규 경로에 같은 연령/탈퇴 이메일 fixture 적용.
- **Expected:** 클라이언트 검사 제거해도 신규 계정 최소연령 동일, 탈퇴 처리 중 이메일 409 ACCOUNT_DELETION_PENDING·화면 “탈퇴 처리 중인 이메일”. 신청 승인/코드 입력으로 deleted 사용자를 active로 복구하지 않음. 기존 금지된 직접 counselor 등록은 403 유지.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS14 — 필수 기록·선택 EEG/연구·버전 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_age_consents.py:1 (신규·추정), frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** tos/privacy/sensitive 필수만 true, eeg/research=false로 신규 가입. 필수 하나 false 케이스와 실제 게시 버전 변경 케이스.
- **Expected:** 선택 거부로 가입/밴드 없는 클래스 차단하지 않음. 필수 누락 422 CONSENT_REQUIRED, 가입 행 0. consents에 각각 type/version/agreed가 제출 당시 게시값과 일치, EEG/연구 동의를 true로 추정하지 않음. 기존 사용자 재동의 gate가 이번 변경으로 추가되지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS15 — 앱 내 선택 동의 철회·밴드 가드 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_age_consents.py:1 (신규·추정), frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** 설정 개인정보에서 eeg·research 철회 후 밴드 연결·EEG raw presign/ack·연구 export 실행, 재동의/네트워크 실패도 검사.
- **Expected:** 철회 응답 200, eeg/research=false와 철회시각 저장, 회차 eeg_collection_consented=false. 기존 consent_eeg/report 선택과 별개임을 검증. EEG 미동의 업로드 403 EEG_CONSENT_REQUIRED·presigned URL 0, 연결 전 선택동의 안내. 연구 신규 export=0, 기존 export는 철회 요청에 연결. 필수 기록/리포트 선택은 독립 유지. 저장 실패 시 동의 성공으로 표시하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS16 — 탈퇴 3역할×3로그인×3플랫폼 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정); 수동 iOS/Android/web
- **절차:** 진행자/회원/기관 관리자 × email/Google/Apple의 9개 조합을 각 플랫폼 UI로 검증(예외 없는 fixture). 설정 첫 화면→안내→재인증→최종 확인.
- **Expected:** 설정에서 탈퇴 진입 2탭 이내. 삭제 대상·30일·복구 불가·법정 예외 표시. 성공 DELETE /api/v1/users/me=204, users.status=deleted, deleted_at 기록, purge_after=deleted_at+30일. 즉시 로그아웃·refresh cookie 만료·auth store 비움; 계정당 상태 전환 1회. 기관 승인 요청 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS17 — 재인증 실패·취소·토큰 무효화 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정)
- **절차:** 비밀번호 오류/만료 proof/다른 사용자 proof/취소. 성공 탈퇴 뒤 기존 access·refresh·로그인·연결된 WS·미디어 요청 재사용.
- **Expected:** 재인증 실패 401 REAUTH_REQUIRED, 취소 시 상태 변경=0. 성공 후 login/refresh/access 401, WS send 거부·수신 구독 해지, push token=0, 웹 푸시 구독 해지. 오래 열린 탭이 사용자 정보/원본을 읽지 못함. 과거 관리자 삭제도 기존 401 차단 유지.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS18 — 단독 기관 관리자·예정 회차 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정)
- **절차:** 유일 관리자·미래 scheduled 진행자 탈퇴 시도; 다른 관리자 지정/회차 재배정 후 재시도; 과거 완료 회차만 있는 경우.
- **Expected:** 단독 관리자 409 SOLE_ORG_ADMIN, 미래 회차 409 SCHEDULED_SESSIONS_EXIST, 계정/토큰/기관/회차 변경=0. 해결 후 204; 완료 회차 존재만으로 거부하지 않음. 다른 기관 관리자 참조와 타인 데이터 변경 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS19 — Apple revoke·Google 해제·실패 재시도 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정)
- **절차:** email/Google/Apple별 성공 탈퇴, revoke 타임아웃 후 재시도, 동일 요청 재전송.
- **Expected:** Apple revoke 성공 1회(클라이언트 id와 token_type_hint/암호화 복호 대상 정확), Google 연결 해제 성공 1회, email 외부 revoke=0. 실패는 pending outbox 유지·재시도, 로컬 deleted 상태/로그아웃 유지. 성공건 재실행 호출 0, 토큰 로그/응답 노출 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS20 — 웹 account-deletion 접수 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정); frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** 비로그인 공개 페이지에서 존재/미존재 이메일 제출, 잘못된 입력·반복 요청·메일 서비스 장애 재현.
- **Expected:** 유효 이메일은 계정 유무와 무관하게 202 {accepted:true}·동일 안내/응답형식. 요청 원장 및 운영 알림 작업 각 1건, 단순 접수로 users.status 변경 0. 잘못된 형식 422, 한도 초과 429. 메일 장애에도 원장 유지/재시도·성공 발송 중복 0. 테스트 중 실제 메일 발송 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS21 — 29일 보존·정확히30일 삭제·F2 재가입 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_deletion_sweep.py:1 (신규·추정)
- **절차:** deleted_at 고정, 29일·30일 직전·정확히30일·31일 sweep. session 종료시각은 서로 다르게 설정. 동일 이메일 재가입.
- **Expected:** 29일/30일 직전 객체 삭제=0·개인 행 보존. 정확히30일 성공 대상은 개인 행/원본/토큰/식별 메시지 0, purge 완료. 90일 미만 회차여도 사용자 기준으로 삭제. purge 완료 전 409 ACCOUNT_DELETION_PENDING, 완료 후 201/200 새 UUID·옛 데이터 복원 0. 실패한 purge는 날짜가 지났어도 재가입 불가.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS22 — 삭제 대상 전수·공유 기관/그룹 보존 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_deletion_sweep.py:1 (신규·추정)
- **절차:** plan 테이블/S3 목록의 모든 대상에 사용자 A/B 자료를 심고 A만 탈퇴/purge. FK 없는 연구 UUID·operation JSON·PDF·프로필 이미지·첨부도 삽입.
- **Expected:** A 소유 개인 데이터/원본/전사/AI 복제본/메시지/PII JSON·normalization_baselines 개인 행 0, B 자료·기관·지난 공용 회차 보존. 비식별 그룹 집계 값은 삭제 전후 동일, 개인 drill-down/인용은 제거. users FK dangling=0. 연구 철회 근거/법정 예외만 확정된 만료 정책대로 분리. 혼합 미디어 M2 미확정이면 통과 불가.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS23 — 유예 중 탈퇴 표시·접근 제한 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_account_deletion.py:1 (신규·추정); backend/tests/test_sdd220_chat_moderation.py:1 (신규·추정), frontend/tests/sdd220-chat-moderation.test.tsx:1 (신규·추정)
- **절차:** 탈퇴 직후 공용 채팅·클래스 명단·프로필·검색·리포트 소유자 표시 조회.
- **Expected:** 이름 “탈퇴한 사용자”, 원래 이름/이메일/사진 노출=0, 초대 검색 제외, 개인 프로필 접근 404. 30일 유예 동안 내부 삭제 원장 참조 보존; 기간 후 메시지 본문/첨부 삭제. 타 참여자 UI는 오류 없이 열린다.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS24 — F1 회원·게스트 필수 녹음/녹화 동의 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_recording_consent.py:1 (신규·추정), frontend/tests/sdd220-auth-consents.test.tsx:1 (신규·추정)
- **절차:** 일반 입장/초대 URL/legacy enter/join/재접속에서 false·누락·저장 실패·정상 동의. report excluded/research false도 조합.
- **Expected:** 미동의 UI “이 클래스는 녹음·녹화될 수 있어요”와 필수 체크, 다음 단계 불가·안내. 서버 403 RECORDING_CONSENT_REQUIRED, LiveKit 토큰·입장 완료·미디어 업로드 0. 정상 저장 후 true/version/agreed_at 회차 기록, 입장 성공. research/report 거부만으로 입장 차단 0. AI off 문구에 “AI 기록” 0, “녹음” 유지.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS25 — 권한 문구 한국어·영어 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-native-release.test.ts:1 (신규·추정) + iOS 한/영 실기기
- **절차:** Bluetooth/Camera/Microphone Info.plist·en.lproj와 실제 권한 창을 비교.
- **Expected:** 3키 모두 spec §3.14 한/영 문구 정확히 일치, 녹음·녹화 목적/거부 가능 안내 포함, AI 기록/텍스트 변환 문구 0. Bluetooth 거부해도 밴드 없는 클래스·리포트 이용 가능; camera off·mic muted 참여 가능(F1 동의와 OS 허용은 별개).
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS26 — 권한 시점·거부·재허용 [차단]

- [ ] **실행 방법:** 수동 iOS/Android 새 설치·설정 초기화 + frontend/tests/sdd220-native-release.test.ts:1 (신규·추정)
- **절차:** 앱 시작→로그인→알림 설정, 밴드 연결, 화상 기능 순서. 각 권한 거부/재허용.
- **Expected:** 시작/로그인 자동 OS 권한 창=0. 해당 기능 사전 안내 확인 뒤 OS 요청 각 최초 1회; 알림은 설정/초대 맥락에서만. 거부 후 재렌더 자동 요청 반복=0, 설정 안내 후 복구 가능. 사진 보관함·ATT·연락처 요청=0; Android <=30 BLE에 필요한 위치는 제한 선언 유지, >=31 위치 요청=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS27 — 네이티브 웹 전용 UI 차단 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-native-release.test.ts:1 (신규·추정) + 수동 앱
- **절차:** native/web 각각 Settings·밴드 unsupported/denied 상태 진입.
- **Expected:** native: PWA 설치·WebPush 홈 화면 추가·Chrome/Edge로 열기 문구=0, Bluetooth 권한/설정 안내 표시. web: 지원 브라우저/PWA 안내 기존 동작 유지. 앱에서도 웹 푸시 중복 등록=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS28 — Capacitor 상향·취약점 [차단]

- [ ] **실행 방법:** frontend에서 npm ci, npm audit --omit=dev --json, npm ls 및 cap sync 후 빌드
- **절차:** 실행 시의 선택 버전·lock 해시·audit 결과 보관. 설치/빌드는 구현 단계에서만 수행.
- **Expected:** core/ios/android/cli 모두 >=8.5.3의 호환 버전, 중복 비호환 core=0, npm ci exit=0, audit vulnerabilities.critical=0. BLE/social-login/push plugin native sync 성공. audit의 다른 심각도는 기록하되 critical 실패를 예외 처리하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS29 — Android release 서명·버전·권한 [차단]

- [ ] **실행 방법:** 수동 Gradle bundleProdRelease + merged manifest/AAB 검사
- **절차:** 서명 fixture 없음/있음 두 경우. prod versionCode 증가 및 manifest 확인.
- **Expected:** 서명 없으면 release 비영 exit·누락 사유, debug는 가능. 유효 키로 서명 AAB 생성·검증 통과, versionName=1.0.0, versionCode 이전보다 큼. FINE_LOCATION/구 BLUETOOTH maxSdkVersion=30, SCAN neverForLocation, COARSE remove 유지. 키 원문/비밀번호 로그 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS30 — prod 번들·design·정적 자산 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-native-release.test.ts:1 (신규·추정) + prod 빌드 산출물 스캔
- **절차:** cap:ios/android/sync 기본 실행의 최종 JS/HTML/config/assets 검사, /design 전 경로 진입·BGM 재생.
- **Expected:** 모든 최종 산출물 dev-api 문자열=0, prod API 사용. prod design 16개 라우트 접근은 NotFound·디자인 모듈 번들 포함 0. mb-design와 chat-test.html 배포 제외; bgm 제외 시 remote URL 재생 200·오프라인 실패 안내, 존재하지 않는 로컬 경로 요청 0. 자산 크기 전후 실측 기록, 임의 99MB 기준만으로 판정하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS31 — 운영 API 문서 비공개 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_production_docs.py:1 (신규·추정)
- **절차:** production/non-production 설정으로 ASGI test client 생성, docs/redoc/openapi와 health 조회.
- **Expected:** production /docs /redoc /openapi.json 모두 404, app.docs_url/redoc_url/openapi_url=None. health 계약 유지. 개발 환경 문서는 기존 200 유지. 테스트가 운영 설정 검증을 건너뛰어 임의 통과하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS32 — 신고→즉시 상호 차단·UI [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_chat_moderation.py:1 (신규·추정), frontend/tests/sdd220-chat-moderation.test.tsx:1 (신규·추정)
- **절차:** A가 메시지 메뉴 또는 상대 프로필에서 B 신고(사유 빈값/선택값). 같은 operation 재전송.
- **Expected:** 201 {reported:true,blocked:true}; chat_reports 1행·정규화 pair chat_blocks 1행, 양방향 is_blocked=true. 운영 알림 outbox 1건. 재전송은 동일 결과·중복 신고/메일=0. 성공 즉시 클라이언트 기존 B 메시지/preview 제거, 운영 연락 이메일 링크 제공.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS33 — REST·WS 차단 우회·기존 연결 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_chat_moderation.py:1 (신규·추정), frontend/tests/sdd220-chat-moderation.test.tsx:1 (신규·추정)
- **절차:** A↔B direct send/방 재생성/old WS sid 전송, 메시지 목록/context/읽음/초대 검색·직접 target id 초대.
- **Expected:** 양쪽 direct send/생성·초대 403 CHAT_BLOCKED, message row 증가=0, WS ack error.code=CHAT_BLOCKED·상대 emit=0. 초대 검색 결과 대상 id=0, 목록/context/preview/unread에서 차단 상대 콘텐츠=0. URL 직접 접근·다른 방 생성으로 우회 불가.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS34 — 그룹 방 수신 필터·알림 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_chat_moderation.py:1 (신규·추정), frontend/tests/sdd220-chat-moderation.test.tsx:1 (신규·추정)
- **절차:** A/B 차단, C는 미차단인 같은 그룹. B 발신 후 A/C 수신 및 pagination/context/read/unread/푸시 확인.
- **Expected:** A에 B 메시지/첨부/preview/알림/푸시/WS emit=0, C는 정상 1건 수신. room 전체 broadcast로 A에게 전송한 뒤 FE에서만 숨기면 실패. 반대 방향도 동일. 그룹 자체 삭제/차단되지 않은 사람 전송 방해 0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS35 — 신고 권한·경합·실패 원자성 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_chat_moderation.py:1 (신규·추정), frontend/tests/sdd220-chat-moderation.test.tsx:1 (신규·추정)
- **절차:** 자기 신고/미가입 방 메시지/타기관 임의 id/중복 동시 요청/메일 큐 장애. 신고 저장 실패를 주입.
- **Expected:** 자기 신고 422 INVALID_REPORT_TARGET, 권한 없는 대상 404·신고/차단 행=0. 동시 동일 pair unique 유지. DB 실패 시 report/block 모두 rollback; 메일 장애 시 report/block 유지·outbox 재시도, 성공 중복 발송=0. 탈퇴 시 신고 증거의 PII 복제도 삭제 대상에 포함.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS36 — 약관·방침·도움 접근·F3 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-public-copy.test.tsx:1 (신규·추정), backend/tests/test_sdd220_public_copy.py:1 (신규·추정); 수동 공개 페이지/운영 확인
- **절차:** 로그인/가입/설정의 /terms, /privacy 링크와 설정/도움말/회원 홈의 도움 링크 순회. AI off·상담 off·비로그인 포함.
- **Expected:** 약관 본문에 금지행위/제재·14세 제한·탈퇴 30일 안내. 책임자 채용욱 대표이사 및 운영 이메일 명시, 개인 휴대전화 화면/방침=0. 처리방침에 AWS S3·Resend·FCM·LiveKit의 업무/항목/국가/방법/시점/보유기간 실제값, AI 위탁 제외, 광고/마케팅/데이터 브로커 미제공, 그룹 비식별 집계 보존 명시. 공공번호는 게시 직전 검증 근거와 일치해야 통과.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS37 — 결제·의료 금지어 회귀 게이트 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-public-copy.test.tsx:1 (신규·추정), backend/tests/test_sdd220_public_copy.py:1 (신규·추정)
- **절차:** 렌더 가능한 문자열/JSX·리소스·BE 규칙 서사/코멘트·알림·메일·PDF 및 메타데이터 검사. 의도적 금지 문장 fixture를 넣어 탐지 확인.
- **Expected:** 결제 사전(가격/요금/구독/결제/유료/무료 체험/업그레이드/플랜/구매)과 의료 효과 문맥 사전 위반 0. “무료로 시작하기”도 실패. 식별자·주석·design 제외; 의료 면책은 정확한 문장 allowlist만 허용. fixture 위반 탐지>0, 일반 “효과 입증” 문장을 광범위 allowlist로 통과시키지 않음. AI off 렌더의 위험 신호=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS38 — 기관 가입 native 차단·B2B 소개·체험 문구 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-public-copy.test.tsx:1 (신규·추정), backend/tests/test_sdd220_public_copy.py:1 (신규·추정)
- **절차:** native /register/organization·/org/register 직접 진입 및 /register 선택, web 동일 경로, 로그인 화면.
- **Expected:** native 기관 가입 폼=0, “기관 도입은 웹 또는 영업 문의로 진행됩니다” 및 “기관 도입 문의” mailto 링크. /register 기관 선택=0. 웹 기관 가입 폼 유지; 회원·진행자 가입/초대·/join 유지. 로그인 한 줄 다기관 서비스 소개·기관 도입 문의 표시, 가격/외부 결제 링크 0. 체험 기능의 예시 모드는 “무료 체험”으로 표기하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS39 — 지표 고지·측정 방법·첫 연결 면책 [차단]

- [ ] **실행 방법:** frontend/tests/sdd220-public-copy.test.tsx:1 (신규·추정), backend/tests/test_sdd220_public_copy.py:1 (신규·추정)
- **절차:** 플레이그라운드/리포트/첫 지표 노출 화면, 첫 밴드 연결 또는 첫 실행·설정 정보 진입.
- **Expected:** 집중도/이완도/스트레스 명칭 유지, 첫 지표 화면마다 “추정 참고 지표”와 방법 링크. 링크 본문은 2채널 이마 EEG 주파수 대역 비율·개인차/착용 영향·의학적 판단 근거 아님 설명. 첫 1회 의료기기 아님 고지, 재실행 자동 반복=0, 설정에서 재열람 가능. 서비스 효과/질병명 연결 금지 표현=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS40 — 실기기 핵심 회귀·회원 체험 [차단]

- [ ] **실행 방법:** iPhone/iPad/Android 실기기 + frontend/tests/sdd220-demo-mode.test.tsx:1 (신규·추정)
- **절차:** Capacitor 상향 prod 빌드로 BLE 스캔→연결→EEG→끊김→재연결, 푸시 수신/탭 이동, Google·Apple 로그인. 밴드 없는 회원 데모로 체험→보고서.
- **Expected:** 실제 BLE 값/연결 복구 확인, 권한 거부에도 밴드 없이 클래스/리포트 작동. 푸시 탭은 내부 경로 1회 이동; Google·Apple 성공/취소 정상. 예시 모드 파형/스펙트럼/지표/명상 값은 시간 진행에 따라 변함, “예시 데이터입니다 · 실제 측정값이 아닙니다” 띠 계속 표시. prod Debug/Calibration/Normalization 패널=0, 예시 데이터의 실측 업로드/리포트 저장=0, 모드 종료 시 실제 신호와 섞이지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS41 — S3 삭제 실패·재시도·동시 sweep [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_deletion_sweep.py:1 (신규·추정)
- **절차:** S3 일부 삭제 실패/DB commit 실패/중복 worker/버저닝·multipart fixture·로컬 경로 탈출 입력. dry-run도 실행.
- **Expected:** 실패 객체 키/원장은 보존·purge 완료=false, retry 후 모든 version/잔여 multipart 제거 확인 뒤 완료. 성공 객체 재삭제는 멱등, 다른 사용자 키 삭제 0. 로컬 허용 루트 밖 삭제 0, 외부 file_url HTTP DELETE=0. dry-run DB write/외부 delete/revoke=0. 사용자 lock으로 경쟁 purge 완료 기록 1건.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS42 — Alembic 단일 head·데이터/FK 회귀 [차단]

- [ ] **실행 방법:** 메인 backend venv의 alembic heads(접속 없음); 구현 후 임시 PostgreSQL에서 upgrade/downgrade/upgrade
- **절차:** 빈 DB와 0058 fixture DB에서 0059→0060; age/consent/deleted/chat 제약과 기존 사용자 보존 확인.
- **Expected:** heads 출력 e036a0000060 하나. 0059 down_revision=0058, 0060 down_revision=0059(전체 id는 plan 표). users.birth_date 기존값 임의 생성 0, consents.version 기존 행 보존. report/block pair 중복 거부. FK 정리 후 개인 삭제 가능·다른 기관/회차 행 보존. 임의 merge revision=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS43 — 90일 retention과 연구 철회 정합 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_deletion_sweep.py:1 (신규·추정); 기존 retention/research 테스트
- **절차:** session 종료+89/90일과 사용자 탈퇴+29/30일 교차 fixture. 연구 export pending/acked·철회·Spark 확인 전후.
- **Expected:** 기존 retention의 설정/apply_from/hold 규칙 유지, 사용자 sweep는 deleted_at 기준. 90일 설정 false가 사용자 30일 완료를 거짓 보고하게 하지 않음. 연구 미동의/철회 이후 export=0, 탈퇴 시 withdrawal 요청 중복 0·Spark 확인 미완료 상태 추적. 법정 예외 항목·만료일 미확정이면 영구 삭제 완료/제출 판정 금지.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS44 — 심사 데모 시드 스크립트 안전성 [차단]

- [ ] **실행 방법:** backend/tests/test_sdd220_review_seed.py:1 (신규·추정); 격리 fixture만
- **절차:** dry-run, 최초/재실행, 부분 실패, 탈퇴한 데모 이메일, 명시 prod 실행 승인 없음 조건.
- **Expected:** dry-run DB write/메일/외부 API=0. 실행 fixture는 진행자 1+회원 1·합성 클래스/EEG/리포트로 로그인/조회 가능, 재실행 중복=0. prod 기본 거부·명시 실행 인자와 운영 승인 없으면 write=0. 탈퇴 계정 F2 우회 복구=0. 비밀번호/키/실사용자 데이터 문서/로그=0.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS45 — 스토어 메타데이터·계정·영상 준비 [차단]

- [ ] **실행 방법:** 수동; specs/sdd-220-store-review-readiness/appstore-metadata.md:1 (신규·추정)
- **절차:** 법인 팀/Play 조직 인증 읽기 확인, 데모 계정 접근·영상 링크·권한/수집 대응표·8장 iPad 캡처 확인. 각 미완료는 미체크 유지.
- **Expected:** 앱 이름/설명/스크린샷 특정 기관명=0, 다기관 B2B·무료 앱/앱 밖 기관 계약 설명, 실제 판매 링크=0. 카테고리 최종 선택 이유·연령 설문·App Privacy/Data safety/건강 신고가 녹음/영상/EEG 실제 수집과 일치. 1~2분 LINK BAND 실제 시연 영상 재생 가능, 저장 샘플 리포트 열람 성공, 데모 심사 기간 동결/대체 절차 명시. 개인 전화는 심사 연락처에만. 초안/깨진 링크를 준비 완료로 판정하지 않음.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

### TS46 — 전체 회귀·제출 전 통합 게이트 [차단]

- [ ] **실행 방법:** backend 전체 pytest; frontend npm test, npx tsc -b, npx eslint src/, npm run build; 별도 승인된 prod 심사 리허설
- **절차:** AI on 기존 회귀·off 신규 회귀를 모두 실행하고 prod 빌드 데모→체험→리포트→탈퇴 버튼 위치 확인. 실제 탈퇴는 별도 시험 계정.
- **Expected:** 전체 pytest/vitest 실패=0, tsc/eslint/build exit=0. 기준선 실패가 남으면 “전체 통과”로 기록하지 않음. 밴드 없는 주요 여정 성공, TS1~TS45와 수동 항목 미완료=0일 때만 제출 준비 충족. 실제 스토어 제출/업로드는 Brian 별도 승인 전 0회.
- **증거:** 구현 후 명령/테스트명·결과·환경·캡처 또는 로그 위치 기록. 현재 미실행.

## C. Edge Cases

- [ ] AI 설정 미정의/문자열 false/true 외 값은 off, 상담 플래그와 독립(TS3~TS5).
- [ ] off 전 큐 적재·캐시 LLM 잔존·스트림 연결·예약 체크인에서 외부 호출 0(TS7, TS8).
- [ ] 밴드 미착용·마이크/카메라 거부여도 필수 동의 후 클래스·리포트 가능; 선택 EEG/연구 거부는 F1과 분리(TS14, TS24~TS26).
- [ ] 윤년 생일·한국 자정·미래 날짜·소셜 신규/재로그인 구분(TS12).
- [ ] Apple 최초 이름 누락/relay·키 회전·nonce 동시 재사용·같은 이메일 다른 sub(TS9~TS11).
- [ ] 30일 경계·purge 실패·재가입 경쟁·시드 재생성의 F2 우회 금지(TS21, TS41, TS44).
- [ ] 단독 관리자 판정 중 관리자 변경·미래 회차 동시 배정은 잠금으로 검사/탈퇴를 원자화(TS18).
- [ ] 그룹 방 차단·기존 열린 소켓·room preview·context pagination·다중 단말 캐시에서도 유출 0(TS33, TS34).
- [ ] S3 버저닝/로컬 fallback/삭제 후 늦은 업로드·report retry가 개인정보를 다시 만들지 않음(TS22, TS41).
- [ ] 연구 append-only 이력·Spark 미확인·혼합 원본의 미확정 정책은 QA 완료를 막음(TS22, TS43).
- [ ] iPad 회전 중 모달/입력·체험→실측 전환·offline BGM 안내(TS2, TS30, TS40).

## D. Security Review

- [ ] Apple id_token: 서명/알고리즘/iss/aud/exp/nonce 모두 서버 검증, 코드 교환·revoke 토큰 암호화, 이메일 자동 연결 금지(TS9~TS11).
- [ ] 탈퇴 후 토큰: access/refresh/소셜 재로그인·진행 중 WS·원본 URL 발급·push까지 무효화. 이미 발급된 presigned URL의 TTL/폐기 한계도 실측하여 보고(TS17).
- [ ] 본인 재인증 proof는 대상 user·purpose·만료·일회성에 묶임; 관리자 예외 경합은 행 잠금으로 보호(TS17, TS18).
- [ ] 신고 권한/차단 우회: REST·WS·그룹·초대·검색·context·푸시를 서버에서 차단, UI 숨김만으로 통과 금지(TS32~TS35).
- [ ] AI 호출 0건: 키가 설정된 fixture에서도 6 transport 0, stale task/직접 함수/API/stream/예약 작업 포함(TS4, TS8).
- [ ] 공개 삭제 폼은 이메일 존재 여부를 누설하지 않고 요청만 접수; rate-limit·메일 재시도·실제 삭제 본인 확인 분리(TS20).
- [ ] 삭제 객체는 서비스 소유 버킷/로컬 허용 루트만, S3 버전·export 복제본·JSON·타인 자료 경계 검증(TS22, TS41).
- [ ] age/F1/선택 동의를 클라이언트 값만 신뢰하지 않고 서버에서 재검증(TS12~TS15, TS24).
- [ ] 테스트/문서/로그에 실제 계정 비밀번호·id_token·refresh token·p8·환경변수 비밀값 0건(TS9, TS19, TS29, TS44).

## E. 코드 밖 검증(실기기·스토어)

- [ ] E3 법인 팀 멤버십 복구·최종 bundle ID·Play 조직 인증은 계정 소유자 확인 증거로만 완료(TS45).
- [ ] Apple capability·Services ID·Return URL·p8, Google OAuth·FCM/APNs·Play App Signing을 운영 계정에서 확인. 값 노출 금지.
- [ ] iPhone/iPad/Android 각각 BLE·푸시·Google·Apple 로그인·권한 거절/재허용 실기기 회귀. simulator만 성공하면 미완료(TS40).
- [ ] iPad 4화면 가로/세로 8장·iOS 산출물 PrivacyInfo 포함·Android 서명 AAB 증거(TS1, TS2, TS29).
- [ ] 약관/방침 법무 확정, 위탁/국외이전 실제값·법정 보관 만료일·연구 이력 처리·혼합 미디어 삭제 범위 확정. 임의 법률 판단으로 대체 금지.
- [ ] 공공 긴급번호는 게시 직전 한국 관할 헬프라인 조회/공식 근거로 검증; 이 문서 작성만으로 최신 검증 완료 표시 금지.
- [ ] prod AI 키 비우기·AI_FEATURES_ENABLED=false는 별도 운영 변경 승인 후 확인. off 호출 0 테스트를 대체하지 않음.
- [ ] D7 90일 보관 스위프 dry-run 검토·RETENTION_SWEEP_ENABLED/RETENTION_APPLY_FROM·스케줄 실행 확인. 사용자 30일 스위프도 별도 dry-run/운영 활성화 확인.
- [ ] 심사 데모 시드는 스크립트/격리 테스트까지만. prod 실행은 별도 승인 후 수행; 동결·F2와 양립하는 대체계정 절차 확인(TS44).
- [ ] 실제 LINK BAND 영상 1~2분 링크·데모 리포트·밴드 없는 체험 경로·로그인 정보 보안 전달을 확인(TS45).
- [ ] App Privacy·Play Data safety·건강 앱 신고·권한 문구의 수집 항목 일치. 카테고리/연령 설문 최신 콘솔에서 확인(TS45).
- [ ] 실제 업로드·메타데이터 입력·스토어 제출은 Brian 별도 승인 전 실행하지 않는다(TS46).

## F. 회귀 방지 금지어 테스트 범위

- [ ] 결제: 가격·요금·구독·결제·유료·무료 체험·무료로 시작하기·업그레이드·플랜·구매 및 외부 결제 링크. 주석/소켓 구독 식별자 제외, 실제 사용자 문자열만 검사.
- [ ] 의료: 진단·치료·치유·처방·환자·질환·증상·개선 효과·효과 입증·정상/비정상·위험 수준·뇌 건강/두뇌건강·질병명을 서비스 효과/지표 해석에 연결한 문장. 면책 exact allowlist 외 포괄 예외 금지.
- [ ] FE 화면뿐 아니라 BE fallback_narrative/_rule_based_draft·메일·알림·PDF·스토어 설명/스크린샷에도 같은 규칙 적용(TS37).
- [ ] 상담 on 기존 기능 테스트와 출시 off 화면 검사 분리. 지표명 집중도·이완도·스트레스는 유지하고 “추정 참고 지표” 및 측정 방법 안내를 검증(TS39).

## G. 검증 기록 원칙

- [ ] Stage ③ 승인 전 구현을 시작하지 않는다. 이 파일에 승인 일자/사용자 발언을 새로 만들어 넣지 않는다.
- [ ] 전체 테스트 실패와 기존 기준선 실패를 구분하고 실제 명령 결과를 기록한다. 미실행을 통과로 바꾸지 않는다.
- [ ] 코드 완료와 실기기·운영·스토어 준비 완료를 구분한다. plan 스펙 정합 메모 M2/M3가 미해결이면 관련 시나리오/제출 준비는 미완료로 남긴다.
