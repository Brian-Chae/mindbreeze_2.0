# [Fix] verify (수정 전 기준)
- V1 PeripheralPick: known 우선 / 연결된 동일 ID / 다른 기기만 연결 시 스캔 / ID 없고 연결된 밴드 있으면 선택 / 없으면 스캔.
- V2 facade: deviceId null + releaseJsBand가 ID 반환 → peripheralId 전달. deviceId 있으면 우선. 둘 다 없으면 peripheralId 생략.
- V3 회귀: tsc, vitest(tests/sdd246-web, fix-ios-native-band-owner, fix-native-score-model-ppg), swift test.
- V4 실기기(미실시): 대기→클래스 진입 후 밴드 연결 유지·capture.start 도달. 앱 재빌드 필요.
