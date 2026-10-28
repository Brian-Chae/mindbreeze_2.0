# SDD-250 — Plan (Stage ②)

- 상태: 대표 결정 D1~D5 반영 완료. 구현 가능 범위는 spec §5·§10-1.
- 제약: DB 마이그레이션 없음. 심사 중 앱 호환 — 응답 필드는 **추가만**(기존 필드 제거·의미 변경 금지).

## 1. 설계 결정

| # | 결정 | 이유 |
|---|---|---|
| P1 | 서버 `ClassSummary` 에 `open_session`(NextSession 형태, 가산) 추가. `next_session`·`has_open_session`·`open_session_id` 의미는 그대로 | 구 앱/웹 호환. 홈이 열린 회차의 `scheduled_at/seq/host/status` 를 한 번에 얻는다 |
| P2 | **D4 N=6시간**: `_home_open_session` = 열린(open/in_progress) 회차 중 `max(started_at, scheduled_at)`(없으면 제외)이 현재-6h 이후인 것. 서버가 윈도우 적용, 프론트도 같은 상수로 이중 방어(`HOME_OPEN_WINDOW_HOURS=6`) | 오래 열려 방치된 회차 노출 방지. 즉석은 생성 순간 scheduled_at=now |
| P3 | 홈 후보 우선순위: ①열린 즉석 ②열린 일반 ③예정. ①②는 최근 시작 순, ③은 가까운 순. 같은 회차 중복 제거 | spec H2 |
| P4 | 카드 칩: 열린 회차 `지금 입장 가능`(live) + 즉석이면 `즉석 클래스` + `명상`. 열린 회차 부제 `{n}분 전에 시작했어요`/`방금 시작했어요`, 제목은 즉석이면 회차 번호 생략. 하단 `이어서 예정된 일정 N건`(최대 2) | spec H3·H4, 시안 1-B/1-C |
| P5 | **칩↔타이틀 간격**: 구조 문제가 아니라 `.sh-hero__in{gap:16px}`. 홈 히어로에서만 `.sh-hero__row + .sh-hero__title{margin-top:-16px}` 로 박스 간격 0 → 글자 시각 간격 약 6~7px. 타이틀↔지도사박스 16px, 박스↔버튼 16px 유지 | 대표 피드백. 시안 = 구현 동일 규칙 |
| P6 | 소켓 `new_notification` 의 `target_type∈{class,session}` 이면 `invalidateClassReads()` | 홈 즉시 재조회(H5) |
| P7 | 토스트 스토어를 큐로 확장: `toasts[]`(최신 위, 화면 3개 + `+N`), 기존 `toast`(최신 1건)·`showToast`/`dismissToast` API 유지(기존 호출부·테스트 호환). 같은 id 1회, 같은 클래스+회차 클래스형 알림은 합침(`count`) | spec T3·T4 |
| P8 | 공용 `NotificationToastHost`(fixed): 모바일 상단바(56px+safe-area) 아래 좌우 16px, 데스크톱 종 아래 우측 360px. ClientShell·AppShell 의 인라인 토스트를 대체. 일반 5초/클래스 초대형 8초, 누르면 일시정지, ✕·Esc·스와이프 닫기, 본문 탭=이동+읽음 | spec T1~T6·T9~T11 |
| P9 | 수업 중 억제(D1): `showToast` 가 현재 경로가 플레이어(`/sessions/:id/player|live`)면 큐에 넣지 않고 `missed+=1`. 플레이어가 소켓을 안 쓰는 경우를 위해 진입 시 unread 스냅샷 → 셸 복귀 시 증가분을 `missed` 로 환산. 억제 해제 시 "놓친 알림 N건" 토스트 1개 | spec T7 |
| P10 | 앱: `pushNotificationReceived` → 토스트(id=`message_id` 로 소켓과 dedupe, D3). 푸시 `notification.title/body/data.deeplink` → 토스트 extra 로 해석 불가 시 deeplink 직접 이동. Android 채널 `mindbreeze_default`(HIGH)를 `PushNotifications.createChannel` 로 시작 시 생성 + Manifest 기본 채널 메타데이터 | D3, spec 5-4 |
| P11 | 서버 FCM: `android.priority=HIGH`, `android.notification.channel_id=mindbreeze_default`, `sound=default`, `notification_priority=PRIORITY_HIGH` 추가(iOS/웹 푸시 영향 없음) | spec 5-4 |

## 2. 변경 파일

| 구분 | 파일 | 내용 |
|---|---|---|
| BE | `backend/app/services/class_read_service.py` | `_home_open_session`, 요약에 `open_session` |
| BE | `backend/app/schemas/class_parent.py` | `ClassSummary.open_session: NextSession \| None = None` |
| BE | `backend/app/services/push_service.py` | `build_message` 에 android 블록 |
| BE | `backend/tests/test_sdd250_home_open_session.py`, `test_push_service.py` | 신규/보강 |
| FE | `frontend/src/lib/api/class-structure.ts` | DTO `open_session` |
| FE | `frontend/src/lib/class-structure/adapters.ts` | 후보·우선순위·윈도우 |
| FE | `frontend/src/pages/client/member-structure-home-page.tsx` | 칩·부제·`이어서` 목록 |
| FE | `frontend/src/components/client/home/home-card-parity.css` | P5 간격 |
| FE | `frontend/src/hooks/useNotificationSocket.ts` | P6, 클래스형 판정 |
| FE | `frontend/src/stores/notificationStore.ts` | 큐·dedupe·합침·억제 |
| FE | `frontend/src/lib/notification-toast.ts` | 순수 함수(클래스형 판정·억제 경로·합침 키) |
| FE | `frontend/src/components/notifications/NotificationToastHost.tsx`(+css) | 공용 토스트 |
| FE | `ClientShell.tsx`, `AppShell.tsx` | 인라인 토스트 제거 → Host |
| FE | `frontend/src/lib/native/push.ts`, `use-push-registration.ts` | 포그라운드 토스트·채널 |
| APP | `frontend/android/app/src/main/AndroidManifest.xml` | 기본 채널 메타데이터 |
| TEST | `frontend/tests/sdd250-*.test.ts(x)` | 어댑터·스토어·Host·푸시 |

## 3. Task (순서)

1. T1 BE 홈 열린 회차 + pytest (`class_read_service`, 스키마)
2. T2 BE FCM android 블록 + pytest
3. T3 FE 어댑터 우선순위 + vitest (RED→GREEN)
4. T4 FE 홈 카드 UI·간격(P5) + 칩/부제/이어서
5. T5 FE 토스트 스토어 큐 + 순수 함수 + vitest
6. T6 FE NotificationToastHost + Shell 교체 + 소켓 재조회
7. T7 앱 포그라운드 토스트·Android 채널
8. T8 tsc·eslint·vitest 기준선 대비, pytest, Playwright 390×844 캡처 대조
9. T9 summary.md, PR

## 4. 테스트 전략
- pytest: 신규 + `test_push_service`, `test_class_summary_api`, `test_sdd214_read_api` 회귀.
- vitest: 신규 + 기존 실패 기준선(8파일) 대비 신규 실패 0.
- `npx tsc -b --noEmit`, `npx eslint src/`.
- Playwright(로컬 vite dev, 모바일 390×844): 홈 카드(1-B/1-C 간격)·토스트 대조.
- 비범위: 앱 빌드·실기기(감독이 dev 빌드 후 확인).
