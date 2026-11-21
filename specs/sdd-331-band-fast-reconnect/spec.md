# SDD-331 — 밴드 재연결 개선 — 끊긴 직후 빠른 재시도·깨우기 안내·안드로이드 다시 연결

- 상태: 구현 완료(Stage ④~⑥)
- 브랜치: `sdd/331-band-fast-reconnect`
- 작성일: 2026-11-21 · 대표 승인 11/21

## 배경
밴드 펌웨어는 끊긴 뒤 0~2분 안에 sleep 한다. 1.0 앱은 5초 고정 간격 재시도로 그 안에 붙었으나, 2.0은 지수 백오프(1·2·4·8·15·30초)라 놓쳤다. 근거: `docs/ble-reconnect-1121/firmware-and-v1-comparison.md`.

## 범위(JS·Android·iOS 3경로, 서버·DB 변경 없음)
1. 끊긴 뒤 120초: 2~3초 고정 간격 재시도, 시도당 10초 제한. 이후 기존 느린 백오프 + 스캔 복귀.
2. 120초 넘게 못 붙으면 "밴드 버튼을 한 번 눌러 깨워 주세요" + [깨웠어요](빠른 창 재시작 + 스캔).
3. Android `reconnectBand` 구현(JS 분기 해제).
4. 정책 상수는 한 곳씩(JS `reconnect-policy.ts`, Kotlin `BandReconnectPolicy`, Swift `ReconnectBackoff`).

## 제외
펌웨어 변경(v1.44.4 sleep 조건), 서버·DB, 점수·등급 표시.
