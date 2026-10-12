# SDD-056 — 리포트 상세 EEG 섹션 축소 (서사형 우선)

> 리포트 상세에서 서사형(NarrativeSections)과 중복되는 EEG 상세 섹션(7지표/타임라인)을
> 접힘(토글) 형태로 축소한다. 서사형 우선, 상세 지표는 보조로 접어둔다.

## 1. 배경
- ReportDetailPage에 서사형(NarrativeSections)과 EEG 섹션(EegQualityBanner + EegMetricsGrid + EegTimeline)이 모두 노출.
- 서사형이 이미 몸/마음 변화를 보여주므로 EEG 상세 지표는 중복·시각 과잉.

## 2. 구현 범위 (FE cursor)
- ReportDetailPage의 EEG 섹션을 `<details>`(또는 토글)로 감싸 기본 접힘 상태로 변경
- 요약줄: "뇌파 상세 지표 보기" + 품질 배지 정도만 노출
- 펼치면 기존 EegMetricsGrid/EegTimeline 표시

## 3. 주의
- 상담사가 상세 지표를 여전히 확인 가능해야 함 (접힘 ≠ 제거)
- 점수(0~100) 노출 최소화 기조 유지

## 4. 완료 기준
- EEG 섹션 기본 접힘, 토글로 펼침 가능
- FE build 0 error
