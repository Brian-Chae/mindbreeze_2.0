# fix: 즉석 클래스 회원 상담사 영상 403 (dev 7aab94a2, 2026-10-22)

## 증상
- 회원: `POST /sessions/{id}/entry/livekit-token` 403 → "상담사 영상을 불러오지 못했습니다".
- 상담사: 접속 0/1, 회원 카드 "체크인 확인 중 · 접속 확인 중", "내 화면" 타일 깜빡임.

## 원인 (회원 403 — 확정, RED 재현)
- 서버 로그(UTC 06:05~06:10): `/enter` 200 → 동의·체크인 PUT 200 → 호스트 `/start`·`/join` 200 → 이후 `entry/livekit-token` 403 반복. 배포 재시작(06:07:19) 이후에도 동일 → 배포 일시 장애 아님.
- `session_service._enter_resolved`가 `_apply_entry_consents`로 녹음 동의를 **메모리에만** 세팅 → `_mark_entered` → `class_attendance_service.mark_entered`의 `lock_participants`(`populate_existing()` 재조회)가 flush 전 값을 DB 값으로 덮어씀. 운영 `SessionLocal`은 `autoflush=False`라 동의가 유실된다.
- 결과: `participant_livekit_token`의 `require_recording_consent`가 403 `RECORDING_CONSENT_REQUIRED`. 같은 경로로 코드 입장 시 `participant.member_id = membership.id`도 유실될 수 있었다.
- PG 테스트 하네스가 (1) 동의 판정을 autouse로 우회하고 (2) autoflush=True 세션을 써서 지금까지 잡히지 않았다.

## 수정
- `backend/app/services/class_attendance_service.py` `mark_entered`: 재조회 전에 `db.flush()`.
- 회귀 테스트 `backend/tests/pg/test_fix_class_live_host_video.py` (autoflush=False + 실제 동의 게이트).

## 미확정 (상담사 쪽, 재현 못함)
- 접속 0/1: 접속 상태는 소켓 `participation_heartbeat`/join의 DB lease(`class_participation_service.socket_update`)로만 만들어진다. 회원 소켓 join 거부 로그(`join 거부`)는 없었음. 회원이 토큰 403 때문에 영상 화면 오류 상태였던 것과 같은 원인인지는 **dev 재확인 필요**(동의 유실로 member 행 상태가 어긋났을 가능성).
- 내 화면 깜빡임: `HostLiveKitBridge`/`HostLiveContainer` 콜백은 안정적(세터), 호스트 토큰은 1회만 발급. 코드상 재연결 루프 근거 없음 → 브라우저 콘솔(LiveKit 재연결 로그)이 필요.

## Verify 체크리스트 (dev)
- [ ] 즉석 클래스 생성 → 회원(녹음 동의 체크) 입장 → 상담사 시작 → 회원 화면에 상담사 영상 표시, `entry/livekit-token` 200.
- [ ] 같은 시점 상담사 상단 접속 1/1, 회원 카드 '참여 중'.
- [ ] 상담사 "내 화면" 타일이 1분간 유지(깜빡이지 않음). 깜빡이면 콘솔 LiveKit 로그 수집.
- [ ] 코드 입장(멤버십 신규 생성) 회원도 동일.
