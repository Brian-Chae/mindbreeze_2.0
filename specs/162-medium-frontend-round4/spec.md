# SDD-162 — 중(중) 프론트 6건 (4차)

## 배경

4차 전수조사 중(중) 프론트 6건 — EEG 수치 정확성, 수명주기, 성능, 계약.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | EEG-NUM-002 | 좌우뇌 균형 FAA 로그비 오계산 |
| 2 | BAND-LIFE-002 | 언마운트 reconnect 타이머 미해제 |
| 3 | EEG-NUM-003 | SQI 꼬리 124샘플 0 |
| 4 | STREAM-PERF-001 | 패킷마다 Morlet 전체 재분석 |
| 5 | ACC-NUM-001 | ACC 단위 g/centi-g 불일치 |
| 6 | NOTIF-FE-03 | 알림 딥링크 role 미전달 |

## 구현

- EEG-NUM-002: faa(로그비) 필드 추가, scoreIndices에 faa 사용(폴백 hemisphericBalance).
- BAND-LIFE-002: cleanup에 reconnectTimerRef clearTimeout.
- EEG-NUM-003: SQI window 겹침·꼬리 계산.
- STREAM-PERF-001: EEG 분석 1초 쓰로틀 + in-flight 가드.
- ACC-NUM-001: 단위 centi-g 통일.
- NOTIF-FE-03: 딥링크 role 전달.
