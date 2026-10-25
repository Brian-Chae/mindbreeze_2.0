# [FIX] 생체신호 전송 대기 누적·튕김·호흡/HRV 미표시 — verify (구현 전)

## 확정 원인(코드·dev 로그 근거)
1. `pump`(useBiosignalCapture.ts) 재진입 가드 없음 + 4초 주기 → 같은 객체를 겹쳐 presign (presign 200 2686회, ack 0회).
2. 앱(Capacitor, origin https://localhost) 의 S3 PUT 이 CORS 거절(OPTIONS 403 확인) → 모든 PUT 실패 → ack 0 → 큐 적체.
3. 큐가 `objects()`/`refresh()` 마다 전 payload 를 getAll → 적체 시 수백 MB 로드, 메인스레드 정지·메모리 압박(튕김).
4. 메인스레드 정지 시 lease 만료 → `checkLease` 가 만료만으로 lease_lost → "다른 창이 기록 중". 재입장 시 lease_held 는 재시도 없이 영구 stopped.
5. 세션 `/end` 이후 v1 eeg-raw presign 403(`member_access_revoked`, allow_completed=False) → permanent dead_letter → raw 미저장.
6. live-metrics 응답에 sdnn 없음(rmssd만) → 상담사 HRV 항상 '-'. 회원 호흡/HRV 는 PPG 처리 누락(적체 부하)·NaN 시각 RR 전량 폐기 시 null.

## 검증 시나리오(테스트 고정)
- V1 pump 중복 호출해도 객체당 presign 1회.
- V2 PUT 은 네이티브에서 CapacitorHttp 로 수행(CORS 무관), 웹은 fetch.
- V3 큐 목록/카운트가 payload 를 메모리에 모으지 않음(lite).
- V4 lease 만료 후에도 소유자·토큰 같으면 renew 성공. lease_held 시 TTL 내 재시도로 획득.
- V5 완료된 세션의 업로드 presign(v1/v2)이 허용됨(403 아님).
- V6 live-metrics 에 sdnn 포함, 호스트 HRV 표시.
- V7 RR 시각이 NaN 이어도 RR 버퍼 유지(HRV/호흡 계산), 부족 시 '측정 중' 문구.
- V8 presign→PUT→ack→receipt 후 payload 삭제, 데이터센터(upload_status=uploaded) 조회 조건 일치.
- 회귀: 밴드 미착용 경로 무영향, 기존 vitest 실패 17건/8파일 기준선 유지, pytest/tsc/eslint/build.
