# SDD-335 verify (구현 전)

| # | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V1 | PPG 헤더 | 바이트 `fd 03 cd 00` → tickRaw 13435901(LE). EEG/ACC 기존 값 불변 | vitest |
| V2 | 복귀 재시작 판정 | status failed 또는 snapshot BLOCKED/CLOSED/IDLE/streamId null → true. CAPTURING·RECONNECTING·SEALING·DRAINING·null snapshot+running → false | vitest 순수 함수 |
| V3 | 재진입 requestId | 세대 0 은 기존 값 동일, 세대 1+ 은 다름·결정적 | vitest |
| V4 | 버전 비교 | "1.0.0"<"1.0.1"<"1.0.2"=, "1.0.1-dev" ≥ "1.0.1", 빈/이상값 → 차단 안 함 | vitest |
| V5 | 매니페스트 | minAppVersion 없음/비문자열 → ''(차단 없음), "1.0.1" 파싱 | vitest |
| V6 | 동의 안내 | 뇌파 미선택 시 안내 문구 노출, 선택하면 사라짐, 잠금이면 미노출 | vitest(RTL) |
| V7 | 구버전 화면 | 네이티브 + 설치 1.0.0 + min 1.0.1 → 업데이트 화면(스토어 버튼), 웹은 통과 | vitest(RTL) |
| V8 | 회귀 | 기존 tests 전체·tsc 통과 | npm test / tsc |
| V9 | 실기기 | 백그라운드 후 복귀·재진입·뒤로가기 확인창·구버전 화면 | 대표 확인 |
