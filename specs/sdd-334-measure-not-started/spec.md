# SDD-334 — 입장 후 측정 미시작 표시

- 상태: Stage ① Spec
- 브랜치: `sdd/334-measure-not-started`
- 작성일: 2026-11-23 (대표 승인 11/23)

## 배경
- 11/18 운영: 입장했는데 raw·feature 0건인 회원 6명. 코치는 몰랐음.
- 11/23 dev 회차 P05(`LXB-017200F1`): 45분간 측정 엔진 스트림 미시작, 코치 화면엔 "미연결"만 표시. 재연결 후 즉시 정상.
- 원인 조사: `docs/ppg-clock-reset-1123/report.md`(앱 측 원인). 스토어 심사 중이라 **앱·네이티브 수정 불가 → 서버+코치 웹으로 가시화**.

## 목표
코치 라이브 화면에서 "입장했는데 측정이 시작되지 않은 회원"을 바로 알 수 있게 한다.

## 판정 규칙(서버, `get_live_metrics`)
`measure_not_started = true` 조건 전부 충족:
1. 회차 상태 `in_progress`, 활성 참가자(대기열·제거·대체 제외).
2. 입장함(`entered_at` 있음). 기준 시각 = `max(entered_at, started_at)`.
3. 기준 시각으로부터 **90초 초과**(89초=false, 91초=true).
4. 이 참가자의 측정 데이터가 한 번도 없음: EEG feature 윈도 0건 **그리고** raw 청크(`eeg_raw_chunks`) 0건.
5. 밴드 미사용을 명시하지 않음(`eeg_collection_consented is not False`).
- 데이터가 한 건이라도 들어오면 즉시 `false`(해제). 측정 중이다가 끊긴 경우(feature 있음)는 해당 없음 — 기존 "연결 끊김".
- 응답 필드 추가만(`measure_not_started: bool`, `measure_not_started_since: datetime|null`). 기존 필드·소켓 이벤트·명령 불변. DB 마이그레이션 없음.

## 화면(코치 웹, SDD-330 라이브)
- "이상 M명"에 포함(입장자 + `measureNotStarted`).
- 회원 카드: "측정 시작 안 됨 · N분째" + 안내 "앱에서 밴드 다시 연결을 눌러 주세요". 점수·등급 없음, 쉬운 한국어.
- 프런트 해제: 서버 값이 true여도 실시간 지표(`last_eeg_at`)가 들어오면 즉시 해제(폴링 지연 보호).

## 비범위
앱/네이티브, 운영 배포, 마이그레이션, 소켓 프로토콜 변경.
