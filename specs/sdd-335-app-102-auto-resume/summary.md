# SDD-335 summary (작성 중 — 빌드·제출 후 갱신)

## 구현
1. 복귀 자동 재시작: `shouldRestartOnResume` + `subscribeAppResume(ble)` (use-native-measurement.ts). 실패·멈춘 엔진은 stop 후 새 requestId 로 재시작.
2. 재진입: 실제 stop 마다 세대 증가 → 다음 시작 requestId 가 새 값(세대 0 은 기존과 동일). 측정 중 뒤로가기는 `MeasuringLeaveGuard`(데이터 라우터에서만) 확인 창.
3. 동의 안내: 입장 통합 동의(뇌파 미선택)·뇌파 선택 화면에 "측정과 리포트 지표가 없어요" 문구. 정책 불변.
4. 구버전 차단: `latest.json` 의 `minAppVersion` + `useMinAppVersion` → `AppUpdateRequiredScreen`(스토어 열기). 서버 입장 API 차단은 근거 부족으로 미적용(plan §4).
5. PPG 헤더 LE: `raw-capture.ts`, 새 프로필 `packet_endian='little'`(서버 검증은 'little' 이면 LE, 구앱 'mixed' 는 기존 BE 유지).

## 테스트
- vitest: 신규 `tests/sdd335-app-102.test.tsx` 11건, 전체 4773 통과 / 실패 파일 20개는 변경 전 기준선과 동일(기존 실패).
- 백엔드: 디코더·계약 111건 통과(`--noconftest`, LE 프로필 신규 1건).
