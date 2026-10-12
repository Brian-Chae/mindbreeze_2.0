# SDD-043 — 리포트 디자인 개선 (mind-breeze-report 1.0 스킴 + 서사형)

> mind-breeze-report(1.0)의 디자인을 참고해, mindbreeze 2.0 리포트(ReportDetailPage)의
> 디자인을 완성도 높게 개선한다. codex(gpt-6-astra)로 디자인 기본안을 만들고,
> 충분히 루프를 돌며 완성도를 끌어올린다.

## 1. 배경

- 1.0 리포트(mind-breeze-report): 6섹션(Cover→Introduction→Summary→Stress→Attention→Balance),
  보라/그린 크림 배경, 종합 스코어 + ProgressBar, 추이 LineChart + 5구간 BarChart
- 2.0 현재 리포트(ReportDetailPage): Cover → 상담 본문 → EEG 품질 배너 → 7지표 → 타임라인
- 최근 기획: 점수 중심 → **서사형**(종합 여정 → 몸의 변화 → 마음의 변화) 전환

## 2. 목표

1.0 디자인 스킴을 참고하되, 서사형 기획(점수 없음, 변화량 중심)을 반영한 완성도 높은 리포트 디자인.

## 3. 디자인 원칙

1. 1.0의 보라/그린 크림 배경·타이포 스케일·카드 레이아웃 계승
2. 섹션: 종합 여정 → 몸의 변화 → 마음의 변화 (서사형)
3. 개별 지표: 방향성(↑/↓) + 변화량(±%/±단위), 점수(0~100) 없음
4. 그래프: 추세 흐름 + ReferenceArea 구간색 (1.0 스킴)

## 4. 작업 흐름 (디자인 루프)

1. codex(gpt-6-astra)가 디자인 기본안 HTML 프로토타입 작성
2. 리뷰 워커가 시안 검토 → 개선 포인트 도출
3. codex가 개선 반영 (루프 반복 3회 이상)
4. 최종 확정 후 ReportDetailPage에 적용

## 5. 완료 기준

- 디자인 기본안 HTML 완성 (루프 후 완성도 상향)
- mind-breeze-report(1.0) 디자인 스킴 + 서사형 기획 반영
- 최종 디자인을 ReportDetailPage(또는 리포트 렌더)에 적용
