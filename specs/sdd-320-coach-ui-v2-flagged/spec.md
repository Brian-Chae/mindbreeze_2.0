# SDD-320 — 코치 화면 D안 적용 (기능 플래그, dev 한정)

- 상태: Stage ① Spec → ② Plan → ③ Verify
- 브랜치: `sdd/320-coach-ui-v2-flagged`
- 작성일: 2026-11-07
- 승인: 대표 승인(11/7) — ③~⑥ 연속 진행. 선행: SDD-318(내담자 D안, 플래그 `VITE_UI_V2`).

## 1. 무엇을, 왜
코치(상담사·명상 호스트) 로그인 후 업무 화면을 D안(밝은 캔버스 #F4F4F7 + 흰 카드 반경 24 + 액센트 #5F0080 + 자체 호스팅 Pretendard)으로 바꾼다.
SDD-318 과 **같은 플래그 `VITE_UI_V2`** 뒤에서만 동작한다. 운영 빌드는 `vite.config.ts` define 으로 `'false'` 고정이라 운영 번들 변화 0바이트가 최우선 불변 조건이다(11/11 행사).

## 2. 범위 (우선순위 순)
| 순 | 화면 | 라우트 | 주요 파일 |
|---|---|---|---|
| 1 | 대시보드 | `/dashboard` | `pages/DashboardPage.tsx` |
| 2 | 클래스 목록·상세·만들기 | `/classes`, `/classes/:id(/sessions\|members\|settings\|schedule)`, `/classes/new`, `/classes/now` | `pages/classes/*` |
| 3 | 회원 관리 | `/clients`, `/clients/:id`, `/clients/invite` | `pages/clients/*` |
| 4 | 리포트 검토 | `/reports`, `/reports/:id` | `pages/reports/*` |
| 5 | 상담·회차 | `/counseling*`, `/classes/:id/sessions/:id` | `pages/counseling/*`, `pages/sessions/SessionDetailPage` |
| 6 | 데이터 현황 | `/upload-status` | `pages/upload-status/*`, `pages/data-center/*` |
| 7 | 채팅 | `/chat`, `/chat/:roomId` | `pages/chat/ChatPage.tsx` |
| 8 | 설정(코치 경로) | `/settings`, `/profile/professional` | `pages/SettingsPage.tsx`, `components/settings/*` |
| 9 | 알림 | `/notifications` | `pages/notifications/*` |

## 3. 범위 밖
- 실시간 클래스 진행 화면(호스트 플레이어 `/sessions/:id/player`, `/live`, 대기실·플로우 `components/class/flow/**`) — 11/11 행사 안정. 색·폰트도 건드리지 않음(스코프에서 경로 제외).
- 기관 관리자(`org/`, `OrgDashboardPage`, org_admin 역할) — SDD-321 담당. 본 SDD 는 역할 `counselor` 에서만 D안을 켠다.
- 플랫폼 관리자(`admin/`), 내담자 화면(318 완료), 백엔드·코어·앱 빌드, 공유 쉘/전역 CSS/tailwind/프리셋 수정.

## 4. 금지 표현
점수·종합점수·좋음·나쁨·완료율 단정·보증·100% 단정(화면 문구·신규 소스). 현장 용어: feature→분석 데이터, 원시→측정 기록 파일, 수신→서버에 도착. 리포트는 서사·변화량만.

## 5. 제약
- `AppShell`·`SidebarNav`·`BottomTabBar`·`floating-bottom-nav`·`index.css`·tailwind 설정·기존 페이지 **무수정**(부득이한 분기는 1줄 + 근거 기록).
- 신규 API·백엔드 변경 금지. 기존 훅·서비스 그대로. 기능 보존(버튼·필드·API 호출 전부).
- 푸시·PR·배포·앱 빌드·메일·삭제·DB/서버 접근 금지. 커밋은 로컬 브랜치만.
