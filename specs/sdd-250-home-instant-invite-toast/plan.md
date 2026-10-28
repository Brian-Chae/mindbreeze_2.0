# SDD-250 — Plan

## 아키텍처 요약

```
서버: 열린 회차를 목록 응답에 가산 필드(open_session)로 노출 + FCM Android 채널/우선순위
웹  : 홈 후보 선정(adaptMixedHome) → 소켓 new_notification 시 invalidateClassReads → 공용 토스트 스택
앱  : pushNotificationReceived(포그라운드) → 토스트 스토어 / Android 채널 생성(MainActivity)
```

## 결정 사항

- **D4 N = 6시간**: 열린(`open`/`in_progress`) 회차는 `started_at ?? scheduled_at` 기준 6시간 이내만 홈 후보. 상수 `HOME_OPEN_SESSION_MAX_AGE_MS`.
- **호환**: `next_session` 의미는 그대로(미래 회차). 열린 회차는 **새 가산 필드 `open_session`**(`NextSession` 형태 + `started_at`)으로 내려준다. 구 앱은 이 필드를 무시한다. DB 마이그레이션 없음.
- **간격 규칙(대표 피드백)**: `.sh-hero__in` gap 12px, 칩→제목 8px(제목 margin-top -4px), 제목→박스 12px, 박스→CTA 12px. 홈 CSS(`home-card-parity.css`)에서 `.mh-home` 범위로만 적용.
- **우선순위(H2)**: 진행 중 즉석(`is_instant`) > 진행 중 일반 > 입장 중(open) 즉석/일반 > 예정(가까운 순). 상담은 예정으로만 경쟁.

## Files to Change

| Action | File | Description |
|---|---|---|
| Edit | `backend/app/services/class_read_service.py` | `_class_summary` 에 `open_session` 가산 |
| Edit | `backend/app/schemas/class_parent.py` | `ClassSummary.open_session` 가산 필드 |
| Edit | `backend/app/services/push_service.py` | `build_message` 에 android channel_id·priority |
| Create | `backend/tests/test_sdd250_open_session_push.py` | 서버 단위 테스트 |
| Edit | `frontend/src/lib/api/class-structure.ts` | `open_session` 타입 |
| Edit | `frontend/src/lib/class-structure/adapters.ts` | 후보 선정·우선순위·`HomeNextSchedule` 확장 |
| Create | `frontend/src/lib/class-structure/home-next.ts` | 순수 함수(후보 점수·경과 문구) — 컴포넌트 export 분리 |
| Edit | `frontend/src/pages/client/member-structure-home-page.tsx` | 즉석 카드·이어서 N건 목록 |
| Edit | `frontend/src/components/client/home/home-card-parity.css` | 간격 규칙 |
| Edit | `frontend/src/stores/notificationStore.ts` | 토스트 큐(최대 3 + overflow), dedupe, 억제·요약 |
| Create | `frontend/src/lib/notification-toast.ts` | 토스트 순수 규칙(유형·지속시간·억제 경로·합침) |
| Create | `frontend/src/components/notifications/notification-toast-stack.tsx` | 공용 토스트(모바일·데스크톱) |
| Edit | `frontend/src/components/client/ClientShell.tsx` , `layout/AppShell.tsx` | 기존 단일 토스트 제거 → 공용 스택 |
| Edit | `frontend/src/hooks/useNotificationSocket.ts` | 클래스 계열 수신 시 `invalidateClassReads`, 큐 사용 |
| Edit | `frontend/src/lib/native/push.ts` | 포그라운드 푸시 → 토스트(message_id dedupe) |
| Edit | `frontend/android/.../MainActivity.java` | 알림 채널 `mindbreeze_default` (HIGH) 생성 |
| Create | 프론트 테스트 3종, 문서 verify/summary | |

## Tasks

1. 서버 `open_session` 가산 + 스키마 + 테스트 (10분)
2. FCM android 블록(channel_id·priority HIGH) + 테스트 (5분)
3. 후보 선정 순수 함수 + adaptMixedHome 확장 + 테스트 (15분)
4. 홈 카드(즉석 칩·경과 문구·이어서 N건) + 간격 CSS (15분)
5. 토스트 큐 스토어·규칙 + 테스트 (15분)
6. 공용 토스트 컴포넌트 + 셸 교체(모바일 포함) (15분)
7. 소켓 수신 처리(클래스 재조회·억제·요약) (10분)
8. 앱 포그라운드 푸시→토스트 + Android 채널(MainActivity) (10분)
9. 테스트·캡처·Summary

## Testing Strategy

pytest(관련 + 기존 push/read 회귀), vitest(기준선 8파일 외 신규 실패 0), `tsc -b --noEmit`, `eslint src/`, Playwright 390×844 로컬 캡처(홈 카드·토스트) 시안 대조.
