# SDD-137 — Verify (구현 전 QA 체크리스트)

## DATA-01 계정 삭제
- [x] 회원 삭제 시 `user_org_memberships`(소속)·`signup_applications`(가입신청) 정리
- [x] 기관 `owner_user_id`·`deactivated_by` 참조 해제 (FK 오류 없음)

## FE-JOIN 게스트 참여 잠금
- [x] 이름 미입력 시 오류 표시 후 다시 이름 입력하면 참여 가능 (잠금 해제)
- [x] 참여 후 `resetJoin` 시 잠금 해제되어 재참여 가능

## FE-REC 기록지 실시간 갱신
- [x] 네트워크 재연결 시 기존 방 자동 재구독 → 기록 갱신 지속

## FE-AUDIO 녹음 마지막 구간
- [x] 종료 시 마지막 청크 flush 대기 후 서버 stop 호출
- [x] 업로드 실패 청크를 원래 인덱스로 재전송 (서버 멱등)

## VID-01 영상 병합
- [x] 선행 청크 하나가 실패해도 뒤 청크들이 계속 기록 (중단 없음)

## RPT-01 리포트 재생성
- [x] 재생성 시 `generation_started_at` 리셋 → 워치독 오판 없음

## 종합 게이트
- [x] 백엔드 `pytest -q` 1009 passed / 0 failed
- [x] 프론트 `vitest run` 44 files / 318 passed
- [x] 프론트 `npm run build` 0 errors
- [x] Deploy Dev 성공(Health check 통과)
