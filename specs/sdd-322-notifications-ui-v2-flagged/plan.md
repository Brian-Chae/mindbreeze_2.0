# SDD-322 — Plan

## 1. 분기 방식 (318/321 과 동일: 신규 파일 + 진입점에서 빌드 상수로 선택)
| 분기 지점 | 방법 | 기존 파일 수정량 |
|---|---|---|
| 내담자 `/app/notifications` | `ClientAppPage` 에 `UiV2NotificationsPage` lazy 선언 1개 + 채팅·설정과 같은 조기 반환 1줄. 상담사 미연결 상태에서도 알림은 열려야 하므로 기존 "알림은 게이트 예외" 규칙을 지키려고 조기 반환은 `/app/chat` 분기 근처(게이트 앞)에 둔다 | 약 4줄 |
| `/notifications` (코치·기관) | `App.tsx` 의 `NotificationCenterPage` lazy 선언 1개를 삼항으로 교체. D안 쪽 모듈은 역할이 `org_admin` 이면 기관 쉘 화면, 그 외(코치·플랫폼 관리자)는 기존 `NotificationCenterPage` 를 그대로 렌더 | 1줄(선언) |
| 코치 | 기존 마크업 유지. `ui-v2-coach.css` 에 `html.u2-coach` 하위 규칙만 추가 | 0(CSS 추가만) |

## 2. 신규 파일 (`frontend/src/`)
| 파일 | 역할 |
|---|---|
| `pages/notifications/ui-v2/use-ui-v2-notifications.ts` | 목록·읽음·전체 읽음·딥링크·뱃지 갱신 훅. 구버전 두 페이지와 같은 API/스토어 함수를 호출(복사 아님 — 같은 함수 호출) |
| `pages/notifications/ui-v2/ui-v2-notification-parts.tsx` | D안 알림 행(유형 아이콘·제목·본문·시간·유형 칩·읽지 않음 점), 상단 요약줄, 빈/오류/로딩 블록 |
| `pages/client/ui-v2/ui-v2-notifications-page.tsx` | 내담자 알림 (UiV2ClientShell) |
| `pages/notifications/ui-v2/ui-v2-org-notifications-page.tsx` | 기관관리자 알림 (UiV2OrgShell) + 설정 패널 |
| `pages/notifications/ui-v2/ui-v2-notification-center-page.tsx` | `/notifications` 진입점: org_admin → 기관 화면, 그 외 → 구 `NotificationCenterPage` |
| `styles/ui-v2-notifications.css` | `.ui-v2 .u2-notif-*` 규칙(전 선택자 `.ui-v2` 시작) |
| `tests/sdd322-*.test.ts(x)`, `e2e/sdd322-capture.mjs` | 시험·캡처 |

수정: `ClientAppPage.tsx`(~4줄), `App.tsx`(1줄), `styles/ui-v2-coach.css`(`html.u2-coach` 규칙 추가), `scripts/check-ui-v2-off.mjs`(알림 D안 청크/CSS 검사 추가).

## 3. 결정
- D1 `NotificationCard` 는 이모지 아이콘·구 색 토큰이라 D안 마크업으로 쓰기 어렵다. **구버전·코치 화면은 `NotificationCard` 그대로**(코치는 CSS 스킨), 내담자·기관 D안은 신규 행 컴포넌트가 같은 `TYPE_LABELS`/`timeAgo`/`NotificationDto` 를 사용한다. 표시 문구는 서버 값 그대로.
- D2 기관 화면은 기존 `NotificationCenterPage` 의 설정 패널(이메일/인앱 토글, 낙관적 갱신·실패 되돌림)을 보존한다. 내담자 화면은 구버전에 설정이 없으므로 추가하지 않는다(설정 탭에 이미 존재).
- D3 내담자 구버전의 "행 클릭 시 딥링크 없으면 본문 펼침"을 D안도 보존한다. 기관/코치는 구버전처럼 이동만.
- D4 필터/탭은 구버전에 없다. 추가하지 않는다(전체 읽음·설정만 보존) — 기능 변경 금지 원칙.

## 4. 보존표
| 항목 | 내담자 | 기관 | 코치(스킨) |
|---|---|---|---|
| 목록 50건 조회 | ✔ | ✔ | 불변 |
| 읽음 처리 + 전역 뱃지 재조회 | ✔ | ✔ | 불변 |
| 전체 읽음(+뱃지 갱신, 실패 메시지) | ✔ | ✔(읽지 않은 것 있을 때만 표시) | 불변 |
| 딥링크 이동 | role=client | user.role | 불변 |
| 딥링크 없으면 본문 펼침 | ✔ | — | — |
| 빈 상태 / 오류+다시 시도 / 로딩 | ✔ | ✔ | 불변 |
| 설정 패널(메일/인앱 토글) | — | ✔ | 불변 |
| 읽지 않은 수 요약줄 | — | ✔ | 불변 |
