# SDD-039 — 표준 모델 정규화 실제 서비스 적용

> 플랫폼 관리자가 playground에서 활성화한 표준 분포 모델이 playground에만 적용되고,
> 실제 상담사/회원 데이터(두뇌휴식도 등)에는 적용되지 않는 문제를 해결한다.
> playground에 현재 적용된 모델을 표시하고, 표준 모델이 실제 값 산출에 적용되게 한다.

## 1. 배경·원인

- SDD-036에서 표준 모델 정규화(`eegPersonalScore.scoreIndices`) + `useBand.scoredIndices`를 만들었지만,
  playground의 MetricsPanel/TrendPanel만 `scoredIndices`를 쓴다.
- 실제 서비스 화면(SessionLivePage·SessionMonitorTable·GuestMeditationPanel)은 `band.currentEfficiency`를 쓰는데,
  이 값은 `setCurrentEfficiency(metrics.relaxationIndex)`로 **raw(0~1) 값**이다.
- SDD-037에서 relaxationIndex가 raw(α/(α+β), 0~1)로 바뀌면서, % 표시(0~100) 화면에서 두뇌휴식도가
  0~1로 표시되거나 0%로 보인다. 표준 모델 정규화가 실제 데이터 산출에 적용되지 않은 것.

## 2. 해결 방향

### T1. currentEfficiency 정규화 적용
- `useBand`의 `setCurrentEfficiency(metrics.relaxationIndex)` → 정규화된 `scoreIndices(...).relaxationIndex`(0~100)로 변경
- (업로드 payload의 `relaxation_index`는 raw 유지 — 백엔드 저장은 raw 기준)

### T2. 실제 서비스 화면 연동 확인
- SessionLivePage·SessionMonitorTable·GuestMeditationPanel이 `band.currentEfficiency`(0~100)를
  그대로 %로 표시하므로, 정규화 적용 시 자동으로 정상 표시

### T3. playground 활성 모델 표시
- NormalizationPanel 상단에 "현재 적용된 모델: vN (n=샘플수, 지표M/11)" 배너 명확 표시
  (이미 getActiveModel로 조회 중 — 표시 강화)

## 3. 완료 기준
- 실제 서비스(상담사/회원) 두뇌휴식도가 표준 모델 정규화된 0~100 값으로 표시
- playground에 현재 활성 모델 명확 표시
- build 0 error, mock/실기기 무관 동작
