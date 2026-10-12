# [SDD-192] 웹 푸시 (브라우저 알림)

## Goal
웹(Chrome/Edge/Firefox/Safari PWA)에서 탭이 닫혀 있어도 채팅·AI 채널 알림을 브라우저 알림으로 받는다. 기존 앱 푸시(SDD-190)의 outbox 파이프라인을 재사용한다.

## Context
- SDD-188/189/190이 `notification_outbox(channel="push")` 적재 → `push_task.process_push_outbox`가 `device_tokens`(FCM)로 발송한다. 웹 수신자는 토큰이 없어 `skipped`.
- Firebase 자격증명이 환경에 없다 → **표준 Web Push(VAPID) 직접 발송**(pywebpush). 외부 계정 불필요, 키 한 쌍만 서버 env에 둔다.
- 푸시 payload는 기존 규약 그대로 비식별(이름·상담 내용 없음).

## Scope
### ✅ In-scope
**백엔드**
1. 설정 `VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT`. 미설정이면 웹 푸시 비활성(발송 시도 없음).
2. `device_tokens` 재사용: `platform="web"`, `token`=구독 endpoint, 신규 컬럼 `p256dh`, `auth`(nullable) — 마이그레이션 `e036a0000040`(down=`e036a0000039`).
3. `POST /devices` web 지원(keys 필수·endpoint는 https + 허용 푸시 서비스 도메인만 — SSRF 방지). `GET /devices/web-push/public-key`.
4. `web_push_service.py`(pywebpush 발송, 404/410 → 토큰 무효 revoke). `push_task`가 플랫폼별(FCM/웹)로 분기, FCM 미설정이어도 웹 푸시는 동작.
5. `.env`/deploy cron에 VAPID env 전달.

**프론트엔드**
6. `public/sw.js`: push 수신 → 알림 표시(앱 창이 포커스면 표시 대신 알림 목록 갱신 메시지), 클릭 → 허용된 딥링크로 창 포커스/오픈.
7. `lib/web-push.ts`: 지원 감지·권한·구독·서버 등록/해지. 설정 페이지에 "브라우저 알림" 카드(켜기/끄기, 거부·미지원 안내).
8. 로그아웃 시 현재 브라우저 구독 서버 해지(구독 자체는 유지하지 않고 unsubscribe).

### ❌ Out-of-scope
- 알림 종류별 웹 푸시 on/off 세분화(기존 인앱 설정 따름), FCM 웹, 이메일/세션 임박 신규 트리거 추가(이미 push 채널로 적재되는 것만 대상), iOS 비PWA Safari, 알림 아이콘 디자인 고도화.

## Acceptance Criteria
- [ ] 웹 구독 등록·갱신(upsert)·해지, 타인 구독 삭제 불가, 허용되지 않은 endpoint 422
- [ ] push outbox 행이 웹 구독으로 발송(모킹)되고 sent/failed/skipped 기록, 404/410 구독 revoke
- [ ] VAPID 미설정 시 웹 구독은 발송 시도 없이 안전(행 유지), FCM 경로 회귀 0
- [ ] 앱(android/ios) 토큰 기존 동작 불변, `alembic heads` 단일
- [ ] 프론트 `npm run build`·vitest 통과, sw.js 딥링크 검증, 지원 안 되는 브라우저에서 카드가 안내만 표시
- [ ] payload에 이름·상담 내용 없음

## Dependencies
SDD-190(device_tokens·push_task·outbox), `pywebpush`.

## Risks
| 리스크 | 대응 |
|---|---|
| endpoint SSRF | https + 푸시 서비스 도메인 allowlist |
| VAPID 키 유실 시 전 구독 무효 | 키는 서버 `.env`에만, 교체 시 재구독 필요를 summary에 명시 |
| iOS Safari는 홈 화면 PWA에서만 | 미지원 안내 문구 |
| 포그라운드 중복 알림 | 포커스된 창이 있으면 시스템 알림 생략 |
