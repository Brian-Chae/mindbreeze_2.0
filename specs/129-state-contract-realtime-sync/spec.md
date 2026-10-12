# [SDD-129] 상태 계약·실시간 동기화 정합

## Goal
1. 서버 응답의 `guest_state` 파생값을 내려 FE 죽은 분기를 살린다(③-2).
2. 세션 상태 라벨을 단일 소스로 통합해 표기 불일치·빈칸을 제거한다(③-6).
3. 상담사 상세·회원 화면 전환에 WS 실시간 구독을 연결해 폴링 지연을 제거한다(③-8, ①-6).

## Context
- ③-2: FE가 `guest_state`('waiting'/'meditation'/'complete')를 읽지만 BE가 안 내려줘 분기가 항상 false(죽은 분기).
- ③-6: 상태 라벨 맵이 4개 파일에 중복 정의, 표기 불일치('진행중'/'진행 중') + open/ready 키 누락으로 빈칸·영문 노출.
- ③-8: 상담사 상세 `SessionDetailPage`가 WS 미구독, 5초 폴링만.
- ①-6: 회원 화면 전환이 3~4초 폴링에 의존.

## Scope
- BE: `get_guest_session_state`에 `guest_state` 파생값 + `GuestSessionStateResponse`에 필드 추가.
- FE: `session-status.ts` 단일 소스 신설, 4개 파일 교체.
- FE: `SessionDetailPage`·`class-join-page`에 `useSessionLiveSocket` 구독 추가.

## Acceptance Criteria
- [ ] `guest_state`가 서버에서 내려와 FE 분기가 정상 동작.
- [ ] 상태 라벨이 전 화면 단일 표기(진행 중/완료/취소)로 통일.
- [ ] 상담사 상세·회원 화면이 WS로 상태를 즉시 반영.
- [ ] `pytest` 통과, `npm run build` 0 errors.
