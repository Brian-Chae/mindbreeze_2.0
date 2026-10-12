# SDD-040 — 클라이언트 클래스 지표 대시보드 (6지표 순환 + pin)

> Client(내담자)가 클래스에 참석했을 때, 6개 지표(집중도·이완도·정서안정도·BPM·호흡·HRV)를
> 현재 수치 + 하단 그래프로 표시. 6개 지표가 10초씩 자동 순환(기본값) + pin으로 고정.

## 1. 배경·목표

현재 `GuestMeditationPanel`(클라이언트 명상 화면)은 두뇌휴식도(이완도)만 대형 수치로 보여주고,
몸 지표(BPM·호흡수·SDNN·RMSSD)는 작은 카드로만 표시한다. 집중도·정서안정도는 표시되지 않는다.
6개 지표를 동등하게 대형 수치로 보여주고, 하단 그래프로 시계열을 표시하며,
10초 자동 순환 + pin 고정으로 원하는 지표에 집중할 수 있게 한다.

## 2. 6개 지표 정의 (useBand 노출값)

| key | label | source | unit |
|-----|-------|--------|------|
| focus | 집중도 | `scoredIndices.focusIndex` | % (0~100) |
| relaxation | 이완도 | `scoredIndices.relaxationIndex` | % (0~100) |
| emotional | 정서안정도 | `scoredIndices.emotionalStability` | % (0~100) |
| bpm | BPM | `heartRate` | bpm |
| respiration | 호흡 | `respiratoryRate` | 회/분 |
| hrv | HRV | `sdnn` | ms |

## 3. 구현 범위

### T1. 6지표 순환 대형 수치
- `GuestMeditationPanel`의 "두뇌휴식도" 대형 수치 영역을 6지표 순환으로 교체
- 10초마다 다음 지표로 자동 전환 (기본값)

### T2. pin 고정
- 각 지표 카드/헤더에 pin 토글 버튼
- pin ON → 해당 지표만 표시 (자동 순환 정지)
- pin OFF → 10초 자동 순환 재개

### T3. 하단 그래프
- 현재 선택된 지표의 시계열 그래프 (1Hz 링버퍼, useRef 패턴)
- 6지표 각각 시계열을 축적해, 선택 지표의 그래프 표시

### T4. 지표 전환 UX
- 좌우 화살표 또는 인디케이터(6개 dot)로 수동 전환도 가능
- 현재 지표 인디케이터 강조

## 4. 주의
- 1.0 디자인 패리티 유지 (검정 풀블리드 + FadingImageBackground + clamp 대형 수치)
- 마음 지표는 `scoredIndices`(0~100), 몸 지표는 heartRate/respiratoryRate/sdnn
- mock/실기기 무관 동일 경로
- 기존 BrainChart·두뇌휴식도·몸 지표 카드와 중복 없이 정리

## 5. 완료 기준
- 6지표가 10초 순환 + pin 고정 동작
- 선택 지표의 현재 수치 + 하단 그래프 표시
- `npm run build` 0 error
