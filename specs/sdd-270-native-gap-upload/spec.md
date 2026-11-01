# SDD-270 — 앱 측정 구멍 기록 서버 전송

- 상태: Stage ① Spec
- 브랜치: `sdd/270-native-gap-upload`
- 작성일: 2026-11-01

## 1. 문제 (실측)

- 웹 측정 경로는 끊길 때마다 구멍(gap)을 `POST /sessions/{sid}/biosignal-events` 로 보내 `biosignal_gap_events` 에 쌓는다.
- 앱(네이티브) 경로는 구멍을 폰 안 `snapshot.gaps` 로만 갖고 서버로 안 보낸다. dev DB: 앱 경로 구멍 행 0건(웹 경로 7,367건).
- 실사례(회차 fbb7ee46): 와이파이 1회 단절 + 밴드 off/on 1회 → raw segment 5개로 분할, feature 창 품질 0 구간 12개. 구멍 기록 0건.
- 밴드는 자체 저장소가 없어 끊긴 구간은 복구 불가 → 우리는 "끊김을 정확히 기록"한다.

## 2. 목표

앱(Android·iOS 공통)이 측정 중 발생한 구멍(밴드 끊김·패킷 갭·시계 되감김·앱 종료)을 서버 `biosignal-events` 로 **유실 없이** 올려 `biosignal_gap_events` 에 쌓는다.

## 3. 범위

| 포함 | 제외 |
|---|---|
| 앱이 관측한 recorded 구멍을 앱→서버로 올리는 경로(Android·iOS) | 저장 데이터에서 파생 구간 계산(SDD-269) |
| 오프라인·강제종료·로그아웃 후 이어올림 | 서버 스키마 변경(없음 — 기존 `GapEventIn` 계약 그대로) |
| 종료 기록(close intent)에 `last_gap_sequence` 반영 | 밴드 구간 데이터 복구(불가) |

## 4. 완료 기준

1. 밴드 off/on·와이파이 off/on·앱 강제종료 후 재개 시 서버 `biosignal_gap_events` 에 구멍 행이 생긴다.
2. 같은 구멍이 두 번 올라가지 않는다(event_id 멱등, sequence 중복 0, 구멍 번호 0..N 연속).
3. 오프라인·로그아웃 중 만든 구멍은 디스크에 남아 로그인·네트워크 복귀 후 올라간다.
4. 도착량 대조(SDD-264/266 expected-reporter)에는 구멍을 포함하지 않는다.
5. 기존 웹 경로·서버 수신 테스트 회귀 없음.
