# [SDD-192] Verification (Pre-Implementation)

## Test Scenarios
### TS1 구독 등록/갱신/해지
1. platform=web, https FCM endpoint, keys 포함 POST → 200, DB `p256dh/auth` 저장 2. 같은 endpoint 재POST → 행 1개 3. DELETE 본인 → 204, 타인 → 404
- **Expected:** 행 증가 없음, 타인 해지 불가
### TS2 endpoint/keys 검증
1. http endpoint / 허용 외 도메인 / keys 누락 → 422
- **Expected:** 모두 422, 앱(android/ios) 등록은 기존대로 keys 없이 200
### TS3 웹 푸시 발송
1. web 구독 보유 사용자에게 push outbox 적재 → process_push_outbox (webpush 모킹)
- **Expected:** `sent`, payload=title/body/deeplink/message_id만
### TS4 무효 구독
1. webpush가 404/410 → revoke, 다른 기기 발송은 계속
- **Expected:** revoked_at 기록, 전부 실패 시 attempts+1
### TS5 미설정
1. VAPID 미설정 + web 구독만 → 행 pending 유지, 예외 없음
2. FCM 미설정 + VAPID 설정 + web → 발송
- **Expected:** 위와 같음
### TS6 혼합 기기
1. android + web 동시 보유 → 둘 다 발송 시도, FCM 경로 회귀 없음
### TS7 public-key
1. VAPID 설정 시 200 {public_key}, 미설정 시 503
### TS8 프론트
1. 미지원 환경(serviceWorker/PushManager 없음) → "지원하지 않음" 안내, 구독 시도 없음
2. 권한 denied → 안내 문구
3. 구독 성공 → `/devices` POST(platform=web, keys)
4. 로그아웃 → 구독 해지 호출
5. sw.js 딥링크 검증: 외부 URL/`//`/`..` 거부, `/app/..` `/chat/..` `/agent` 허용

## Edge Cases
- [ ] 같은 브라우저에서 계정 전환 시 소유자 이전(기존 토큰 규약)
- [ ] 포커스된 창이 있으면 시스템 알림 생략
- [ ] 구독 endpoint 512자 초과 → 422

## Security Review
- [ ] endpoint allowlist(SSRF), VAPID 개인키 로그/응답 미노출
- [ ] 토큰(endpoint) 로그는 `mask_token`만
- [ ] 딥링크 오픈 리다이렉트 방지(SW·클라이언트 양쪽)
