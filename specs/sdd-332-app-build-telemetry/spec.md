# SDD-332 — 수업별 앱 빌드·OS 버전 기록 — 밴드 보고에 앱 빌드 번호·기기 OS 추가

- 상태: 승인(대표 11/23) → ③~⑥ 연속
- 브랜치: `sdd/332-app-build-telemetry`

## 배경
모든 dev 빌드의 `device_tokens.app_version` 이 `1.0.0-dev` 라 어떤 빌드로 측정했는지 알 수 없다.

## 요구
1. 밴드 시리얼 보고(SDD-326 PUT `/sessions/{id}/entry/band-device`)에 선택 필드 추가: `app_version`, `app_build`(iOS 빌드/Android versionCode), `os_name`, `os_version`, `device_model`.
2. `session_band_devices` 에 nullable 5컬럼(가산 마이그레이션 `e332appbuild01`). 구버전 앱·기존 행 영향 없음, 재보고에서 빈 값은 기존 값을 지우지 않는다.
3. 형식이 안 맞는 앱 정보는 422 가 아니라 버리고 시리얼 보고는 성공(부가 정보가 측정 흐름을 막지 않는다).
4. 앱은 `@capacitor/app` `App.getInfo()` + `@capacitor/device` `Device.getInfo()`, 웹은 UA 기반 OS만.
5. 표시: 코치 업로드 현황 표·밴드 사용 시트에 "앱 56 · Android 15 · 모델" 한 줄(있을 때만). 회원 화면 노출 없음.
## 범위 밖
기존 수업 소급 기록, 운영 배포.
