# 회원 클래스 손들기 취소(손 내리기)

## 원인
- 회원이 [손들기]를 누르면 `hand==='waiting'` → `handButton`이 `disabled:true`("손들었어요")로 고정. 취소 경로가 화면에도 서버에도 없었다.
- 백엔드에 손 내리기 API가 없었다(`raise-hand`만 존재, SDD-094).

## 수정
- BE: `POST /api/v1/sessions/{session_id}/participants/{participant_id}/lower-hand` 추가 (`api/v1/session.py`, `session_service.lower_hand`).
  - 인가·종료 세션 400·404는 `raise_hand`와 동일(본인 로그인 또는 X-Entry-Credential). 대기열 검사는 두지 않음(내리기는 항상 허용).
  - `raise_hand=False` 후 `speaking_changed` 통지(호스트 목록·본인). 이미 내려가 있으면 통지 없이 200(멱등). `speaking`은 변경하지 않음. 마이그레이션 없음.
- FE: `handButton` waiting → 활성 "손 내리기"(pressed). 상태 문구 "손들었어요 · 상담사가 확인 중이에요" 유지.
  - `lowerEntryHand`(class-flow.ts), `useMemberLiveKit.lowerHand`(성공 시 raisedHand=false, 실패 시 상태 유지+오류 문구, ref로 연타 방지), `MemberMediaControls`가 대기 중 클릭을 lowerHand로 라우팅, 실패 시 `.mp-hand-error` 안내.

## Verify 체크리스트
- [ ] 그룹 온라인 회원: 손들기 → 버튼이 "손 내리기"로 바뀌고 활성
- [ ] "손 내리기" 클릭 → 버튼이 "손들기"로 복귀, 상태 문구가 기본 뮤트 안내로
- [ ] 상담사 로비/그리드 손든 목록에서 즉시 사라짐
- [ ] 발언권 부여 후에는 "말하기 종료"로 동작(기존 그대로)
- [ ] 네트워크 실패 시 "손 내리기" 유지 + 짧은 안내
- [ ] 연타해도 요청 1회
