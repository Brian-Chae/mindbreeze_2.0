# SDD-250 — Summary (Stage ⑥)

## What Was Built

| 영역 | File | 내용 |
|---|---|---|
| BE | `backend/app/services/class_read_service.py` | `_home_open_session`(시작 후 **6시간** 윈도우, D4) + 요약에 `open_session` 가산 |
| BE | `backend/app/schemas/class_parent.py` | `ClassSummary.open_session` (기존 필드 변경 없음) |
| BE | `backend/app/services/push_service.py` | FCM `android.priority=HIGH`, `channel_id=mindbreeze_default` |
| FE | `lib/class-structure/home-next.ts`, `adapters.ts` | 후보 선정·우선순위(열린 즉석 > 열린 일반 > 예정), 6시간 이중 방어, 중복 제거 |
| FE | `pages/client/member-structure-home-page.tsx`, `home-card-parity.css` | `지금 입장 가능`/`즉석 클래스` 칩, `n분 전에 시작했어요`, `이어서 예정된 일정 N건`(최대 2), **칩→제목 28px** |
| FE | `stores/notificationStore.ts`, `lib/notification-toast.ts` | 토스트 큐(최신 앞), id 중복 1회, 같은 회차 합침, 5초/8초, 일시정지, 수업 중 억제 |
| FE | `components/notifications/notification-toast-host.tsx(+css)` | 공용 토스트: 모바일·앱·데스크톱, 3개 + `+N건`, 클릭 이동·읽음, ✕·Esc·위로 스와이프, 놓친 알림 요약 |
| FE | `ClientShell.tsx`, `AppShell.tsx` | 데스크톱 전용 인라인 토스트 제거 → 공용 호스트 |
| FE | `hooks/useNotificationSocket.ts` | 클래스·회차 알림 수신 시 `invalidateClassReads()` |
| 앱 | `lib/native/push.ts`, `api/notifications.ts`, `AndroidManifest.xml` | 포그라운드 푸시→토스트(message_id dedupe), Android 채널 생성, 기본 채널 메타데이터 |

## Test Results

| 항목 | 결과 |
|---|---|
| pytest (신규+관련 회귀 10파일) | **187 passed** |
| vitest 전체 | 3507 passed / 17 failed. 실패는 **기준선과 동일한 8파일 17건**(신규 실패 0, 통과 3484→3507) |
| 신규 vitest | home-next 9, toast-store 7, toast-host 4, native-push-toast 3 |
| `tsc -b --noEmit` | 0 error |
| `eslint src` | 0 error (기존 wasm 경고 2) |
| Playwright 390×844 (API 모킹) | 홈 칩→제목 **28px**(시안 28/27px), 가로 넘침 0, 토스트 3개+`+2건`, 터치 영역 44px |

verify 매핑: TS1~5 pytest, TS6~10·12~21 vitest, TS11·24 Playwright, TS22·23 전체. TS12(소켓→재조회)는 훅 단위 테스트 없이 코드 리뷰로만 확인 → 감독 dev 확인 항목.

## Debugging Journey
- 중복 워커가 같은 파일을 겹쳐 수정 → 감독 보관 후 `open_session` 중복 정의 제거, plan·verify는 0c9eff42 본으로 확정.
- 기존 `report-progress` 테스트가 `toast`만 초기화해 큐에 같은 id가 남아 실패 → `toasts: []` 초기화 추가.
- 스토어 파일을 읽기 전에 열어 비워 버림 → git에서 복원 후 재적용.
- 대표 피드백으로 간격이 8px→**28px**로 번복, 시안·구현·spec·plan 모두 갱신.

## Notes for Reviewer / 감독
- 호환: 응답 필드는 `open_session` 추가만. 구 앱·구 서버 응답은 기존 동작.
- 수업 중 요약(D1)은 플레이어 진입 시 읽지 않은 수를 기억했다가 복귀 시 증가분으로 계산한다. 소켓이 플레이어에서 끊기는 경우를 가정한 설계이며 **실제 수업→복귀 흐름은 dev 실화면 확인 필요**.
- 앱(Android) 헤드업·채널 중요도는 실기기에서만 확인 가능(감독 dev 빌드).
- 캡처: `specs/sdd-250-home-instant-invite-toast/screens/`, `~/.hermes/share/mb-sdd250-20261028/impl/`.
