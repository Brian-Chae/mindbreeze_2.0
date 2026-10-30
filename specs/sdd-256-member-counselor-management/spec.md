# SDD-256 — 회원 상담사 관리·빠른 추가

- 작성: 2026-10-30. 기준: `sdd/256-member-counselor-management`, `a7b5c40a`.
- 상태: 구현 전 기획·디자인 검토안. 앱 구현·실서비스 검증은 수행하지 않았다. Stage ④ 이후 미착수, SDD 완료 아님.
- 목적: 11/4부터 대구교육청 현장에서 기존 회원도 상담사를 추가하도록 두 진입점을 제공한다.

## 문제와 코드 근거

아래는 현재 체크아웃 정적 조사 결과다. 운영 서버 동작을 확인한 결과가 아니다.

| 확인 사항 | 파일:줄 | 결론 |
|---|---|---|
| 실제 회원 홈 | `frontend/src/App.tsx:190`, `frontend/src/pages/client/member-structure-home-page.tsx:24,53` | 새 홈이 목록 훅을 호출하고 기존 ClientHomePage를 조합한다. |
| 홈 상담사 표시 | `frontend/src/pages/client/ClientHomePage.tsx:124,217,486` | 첫 상담사만 표시하며 0명이면 영역 자체가 없다. 추가 버튼 없음. |
| 목록 로딩 | `frontend/src/hooks/use-client-counselors.ts:5-32` | mount GET → authStore. 기관·연결일 타입 및 명시적 loading/error/retry 없음. |
| 회원 설정 경로 | `frontend/src/pages/client/ClientAppPage.tsx:265`, `frontend/src/pages/settings/ClientSettingsPage.tsx:1` | `/app/profile`은 연결 게이트보다 먼저 진입한다. |
| 공용 설정 구조 | `frontend/src/components/settings/settings-content.tsx:44-50`, `frontend/src/App.tsx:340` | 내 계정·알림·차단·기기·개인정보·앱 정보. `/settings`에서도 공유하므로 client 전용 분기 필요. |
| 기존 6칸 입력 | `frontend/src/pages/client/ClientAppPage.tsx:38-151,303` | 입력·붙여넣기·대문자화 참고 가능. 페이지 내부 함수이며 자동 제출과 POST 응답 타입이 새 흐름에 부적합. |
| 온보딩 입력 | `frontend/src/pages/onboarding/ClientOnboardingPage.tsx:322-340,709` | 단일 입력 및 온보딩 전용 매칭 서비스. 새 추가 시트에 온보딩 API를 재사용하지 않는다. |
| 목록·추가 계약 | `backend/app/api/v1/client_portal.py:41,90,201`, `backend/app/schemas/client.py:143-153` | GET 배열, POST 201 단일 CounselorInfo. `{counselors: [...]}`가 아님. |
| 오류 | `backend/app/api/v1/client_portal.py:102-168`, `backend/app/services/org_management_service.py:74-78` | 404 코드/상담사 없음, 403 역할·비활성 상담사·미인증, 409 중복 또는 비활성 기관. |
| 채팅 자동 생성 | `backend/app/api/v1/client_portal.py:170-190` | 신규/ended 재연결에서 direct room 보장 함수를 호출. 메시지 발송과 다름. 부분 실패 복구 검증 필요. |
| 연결일 | `backend/app/models/client_counselor_link.py:21`, `backend/app/schemas/client.py:147` | DB matched_at 존재, GET/POST 응답에는 없음. 프런트에서 날짜를 만들어 표시하면 안 됨. |
| 연결 해제 | `backend/app/api/v1/client_portal.py`, API 전체 delete/unlink/disconnect/ended 검색 | 회원이 자기 상담사 연결을 해제하는 라우트 없음. 기관 상담사 제거·채팅 차단은 별개 기능. |
| 시각 기준 | `frontend/src/pages/client/ClientHomePage.tsx:496`, `frontend/src/components/settings/settings-content.tsx:17-22,44`, `frontend/tailwind.config.cjs:12` | #5F0080, 흰 카드·보라 계열 경계, 15px 본문/22px 행간과 390px 화면 유지. |

## 사용자 흐름

1. **홈 빠른 추가**: `/app` → 담당 상담사 목록 오른쪽 `+ 상담사 추가` → 공용 바텀시트 → 영문·숫자 6자리 → `상담사 추가` → 201 응답을 목록에 즉시 병합 → 성공 확인 → `완료`로 닫고 기존 홈 유지. 0명도 영역과 버튼을 노출한다. 여러 명이면 모두 표시하고 기존 대화 진입은 유지한다.
2. **설정 관리**: `/app/profile` 또는 회원의 `/settings` → 내 계정 다음 `상담사 관리` 펼침 → 이름·소속 기관 목록 → `코드로 상담사 추가` → 같은 시트 → 목록 즉시 갱신. 별도 라우트 없이 기존 Group 패턴 유지. 연결 해제 버튼 없음.

`/join`의 `코드로 바로 입장`은 클래스 입장용으로 유지한다. 상담사 추가는 UserPlus, 클래스 입장은 기존 아이콘을 유지한다. 시트 설명은 “상담사에게 받은 영문·숫자 6자리 코드를 입력해 주세요. 클래스 입장 코드는 사용할 수 없어요.”로 고정한다. 상담사 추가로 클래스 가입/출석이 완료되었다고 표시하지 않는다.

## 입력·상태 계약

- 6칸, 영문/숫자, 소문자 대문자화, 붙여넣기 지원. 공백 제거 후 6자 영숫자만 허용하고 7자 이상/기호 포함은 오류 안내(조용히 잘라 다른 코드로 제출하지 않음).
- 6자 완성 후 명시적 제출. 미완성/전송 중 버튼 비활성, 연속 클릭 1요청. Backspace·포커스 이동·스크린리더 레이블 지원.
- 201: 단일 응답을 id 기준으로 기존 목록에 불변 병합, authStore 최신 user에 반영. 이후 GET으로 재검증. GET 실패여도 생성 성공은 유지하고 “추가했어요. 목록을 새로 확인하려면 다시 시도해 주세요.” 표시.
- 조회 중/빈 목록/조회 실패 분리. 실패를 0명으로 표시하지 않고 기존 목록 유지 + 재시도 제공. 오래된 GET이 추가 직후 목록을 덮지 않게 요청 순서/취소 처리.
- 중복 409: “이미 연결된 상담사입니다”, GET 재조회, 중복 행 없음. 비활성 기관 409는 성공으로 처리하지 않는다. status만 보지 않고 서버 detail로 구분한다.
- 404: “유효하지 않은 상담사 코드입니다”. 미인증 403: 서버의 “해당 상담사는 아직 인증이 완료되지 않아 연결할 수 없습니다”. 비활성 상담사/기관은 서버 문구 그대로. 401은 기존 로그인 복구 흐름, 422는 형식 안내, 통신/5xx는 입력 보존 + 수동 재시도.
- 응답을 받기 전 네트워크 단절 시 “연결 결과를 확인하지 못했어요. 목록을 새로고침해 주세요.” 자동 POST 재시도 금지. 이후 중복 응답도 생성 실패로 단정하지 않는다.
- 서버 제공 org_name만 표시. null은 “소속 기관 정보 없음”. 다중 기관 전체 목록은 현재 응답으로 확인 불가.

## 연결일과 서버 범위

**대표 결정(10/30): 최초 연결일은 표시하지 않는다.** 서버 변경 0건(DB·API·응답 필드 모두 불변). 날짜를 브라우저 시각·가입일로 대체하지 않는다. 이름·소속 기관만 표시한다.

## 수용 기준

- AC1: 기존 연결 유무와 무관하게 홈·설정 두 진입점이 보인다. 상담 기능 플래그 비활성이어도 상담사 연결 기능은 사용 가능.
- AC2: 연결된 전체 상담사와 기관을 표시하고 추가 후 새로고침 없이 새 상담사가 나타난다. 기존 항목·대화 기능 유지.
- AC3: 6자리 입력, 중복/미인증/잘못된 코드/오프라인을 구분하고 같은 POST를 자동 반복하지 않는다.
- AC4: 연결일은 표시하지 않는다(대표 결정). 연결 해제는 제공하지 않는다.
- AC5: 390px에서 가로 넘침 0, 44px 이상 터치 목표, 입력 16px 이상, 키보드·safe area 대응. focus trap/ESC/포커스 복귀 및 aria-live 상태 안내.
- AC6: 클래스 입장과 상담사 추가의 문구·아이콘이 다르며 온보딩/0명 기존 흐름을 훼손하지 않는다.
- AC7: 앱 재빌드 및 실제 배포 채널 설치 검증 뒤 운영 반영을 판단한다. HTML 시안은 앱 동작 증거가 아니다.

## 범위 밖

연결 해제, 기관 변경, 상담사 코드 생성/공유, 온보딩 재설계, 클래스 자동 가입, 메시지 자동 발송, 리포트/EEG 변경. 이번 작업에서는 앱 구현·push·PR·배포·메일·삭제·stash·하위 에이전트 실행 모두 금지.

## 비즈니스 결정 사항(10/30 확정)

- 최초 연결일 표시 안 함 → 서버 변경 0.
- 화면 용어는 이번 SDD 에서 기존 “상담사” 유지. “코치” 전면 변경은 SDD-257 에서 일괄 처리하며, 새 문구는 `frontend/src/lib/client-counselor-copy.ts` 한 곳에 모았다.
- 회원 연결 해제는 범위 밖.
