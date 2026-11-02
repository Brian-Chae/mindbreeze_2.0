# 검증 체크리스트 (구현 전 작성)

## 자동 (vitest)
- [ ] V1 게스트+앱(ios/android) → `decideMeasurementPath` = web_wasm (밴드 연결 시) / off (미연결)
- [ ] V2 로그인 회원+앱 → native 유지 (회귀)
- [ ] V3 `useWebMeasurementV2` 게스트+native 환경에서 Worker 생성·path=web_wasm
- [ ] V4 `useNativeMeasurementV2` 게스트 → path≠native, startForSession 호출 0
- [ ] V5 게스트 live v2 소켓: `getSessionLiveSocket(null)` 무토큰, `live:join` payload 에 entry_credential
- [ ] V6 `features/batch` 가 `X-Entry-Credential` 헤더로 전송 (skipAuth)
- [ ] V7 회원 화면 지표 바인딩: 게스트 liveSnap/자체 스냅샷 → snapshot 연결(소스 배선)
- [ ] V8 게스트 '수동 연결' → nativeAuto false 라 `band.connect()` 호출
- [ ] V9 native 재시작: 직전 deviceId 보관·전달, 같은 회차 재실행은 stop→start 대신 reconnectBand, 유예 후에만 stop

## 자동 (swift test)
- [ ] S1 nil peripheralId 로 재시작해도 직전 ID 유지 (`band.connect(expectedPeripheral:)`)
- [ ] S2 새 ID 가 오면 교체

## 자동 (pytest)
- [ ] P1 게스트 entry_credential join → live:metric 방송 → live-metrics 조회에 게스트 지표 포함

## 게이트
- [ ] tsc, vitest 전체, pytest(관련 묶음), swift test 통과
## 실기기(PR 후 대표 확인)
- [ ] 게스트 Android/iOS: 본인 폰 지표 + 코치 화면 지표 / WASM 로드 / 로그인 회원 회귀
