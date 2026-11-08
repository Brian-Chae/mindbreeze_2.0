# SDD-322 — 알림 화면 D안 적용 (기능 플래그, dev 한정)

- 상태: Stage ① Spec 확정 (대표 승인 완료, ③~⑥ 연속 진행)
- 브랜치: `sdd/322-notifications-ui-v2-flagged` (기준 develop)
- 작성일: 2026-11-07

## 1. 배경
대표 지시: "알림 페이지도 디자인 변경이 필요하다. 알림 페이지만 구버전 디자인을 유지하고 있음." SDD-318(내담자)·320(코치)·321(기관)이 D안을 `VITE_UI_V2` 플래그 뒤에 넣었으나 알림 화면 3종은 구버전 그대로다.

## 2. 범위
| 대상 | 라우트 | 현재 | 목표 |
|---|---|---|---|
| 내담자 알림 | `/app/notifications` | `ClientAppPage` → `ClientShell` + `ClientNotificationPage` (구버전) | D안 내담자 쉘(`UiV2ClientShell`) 안에서 다른 탭과 같은 D안 화면 |
| 코치 알림 | `/notifications` (counselor) | `AppShell` + `NotificationCenterPage`, SDD-320 스코프 스킨 적용 | 스킨 보강: 카드·설정 패널·빈 상태가 D 토큰과 일치 |
| 기관관리자 알림 | `/notifications` (org_admin) | `AppShell` + `NotificationCenterPage` (구버전) | `UiV2OrgShell` 안의 D안 화면 |

범위 밖: 플랫폼 관리자 알림(구버전 유지), 알림 API·스토어·소켓·토스트, 서버가 만든 알림 문구.

## 3. 원칙
- 기능 변경 금지: 목록, 읽음/전체 읽음, 딥링크(`resolveNotificationTarget`), 전역 뱃지 갱신(`useNotificationStore.fetch`), 설정(메일/인앱 토글), 오류·빈·로딩 상태 모두 보존.
- 플래그 off(운영) 번들은 변경 전과 바이트 동일해야 한다.
- 점수·종합점수·좋음·나쁨·완료율·보증·100% 단정 표현 금지(서버 알림 문구는 표시만).
- 기존 파일 수정은 분기 최소 줄.
