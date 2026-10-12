# SDD-022 — 하루밴드 EEG 리포트 통합 (코드 레벨 SDD)

> Linear 미편성. specs/NNN/ 코드 레벨로만 운영. 멀티에이전트에 Codex 포함.

## 목표
하루밴드의 EEG 리포트 산출 엔진(7지표·품질 게이트·null 보존)을 MB 2.0 리포트에 통합한다. 상담 콘텐츠(AI 요약·마커)는 필수 레이어, EEG 분석은 LINK BAND 착용 시 opt-in 확장 레이어로 둔다.

## P0 스코프 (이번 구현)
1. **content 스키마 정합** — UI 기대 필드(summary/insights/markers/eeg_summary/eeg_timeline)와 report_task 생성 스텁(headline/sections/eeg.available) 불일치를 단일 계약으로 통일
2. **metrics.py 순수 Python 포팅** — 하루밴드 7지표·정규화 상수 JSON·품질 게이트·null 보존·weighted_total을 MB 2.0 backend에 이식 (numpy 불필요)
3. **null 보존 선행 리팩터** — report_task.py의 `or 0`/`or {}` 치환 제거
4. **EEGFeatureWindow 저장** — 1초 단위 feature 시계열 저장 (PostgreSQL 테이블, TimescaleDB 확장은 후속 검토)
5. **리포트 프론트 확장** — 7지표 카드 + 품질 배너(valid/degraded/invalid/insufficient/not_measured) + 3채널 타임라인 + counselor/client 정보 비대칭
6. **두뇌휴식도 매핑** — 내담자 라벨 "두뇌휴식도" = relaxation_score 단일 소스

## P0 제외 (후속 Phase)
- Web Bluetooth 실연동 (P1)
- EEG feature 실수집/ingestion API (P1, 하드웨어 필요)
- 트렌드·세션 비교 (P1)
- 클래스 평균 대비·PDF EEG 페이지 (P2)
- TimescaleDB 확장 (후속 검토)

## 비기능 요구사항
- null 보존: 산출 불가는 None, 0 치환 금지
- 품질 게이트: insufficient/invalid에서 종합점수·레이더 0으로 채우지 않음
- LINK BAND 미착용 시 EEG 섹션 DOM에 미노출
- 내담자는 sent_at 이전 client 리포트 미노출 (기존 유지)
- 생체정보 프라이버시: 접근 제어 유지

## 수락 기준
- [ ] metrics.py 포팅 7지표 산출 단위 테스트 통과 (null/0 구분 포함)
- [ ] report_task 생성물이 UI 기대 content 계약과 일치
- [ ] 품질 게이트 4상태(+미측정)별 노출 규칙 동작
- [ ] "두뇌휴식도" 라벨 값 = relaxation_score
- [ ] 미착용 세션에서 EEG 섹션 미노출
- [ ] 백엔드 pytest 전체 통과 + 프론트 tsc/build 통과
