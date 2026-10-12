# [SDD-128] — Verification

## Test Scenarios
### TS1: WS 정상 시 REST flush 중지
- WS 연결 상태에서 5초 경과. **Expected:** retransmitPending 호출 안 됨(WS 가드).

### TS2: 실패 ACK 큐 유지
- 서버 saved=0 ACK 수신. **Expected:** 큐에서 제거 안 되고 REST 폴백 재시도.

### TS3: 접촉불량 표시 일관
- lead_off/stale 상태. **Expected:** 6지표 모두 '—'(미측정), 이완도만 표시 안 됨.

### TS4: 빌드
- `npm run build`. **Expected:** 0 errors.
