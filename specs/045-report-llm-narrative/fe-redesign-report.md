# SDD-045 FE 재구현 결과

## 구현

- `NarrativeSections.tsx`: 정본 HTML의 두 줄 서사 제목, 3단계 여정, 몸·마음 요약 칩, 변화량/문장과 그래프를 묶은 카드, 마무리 제안 카드 및 색상 범례를 이식했다.
- `narrative-sections.css`: 정본 CSS의 글꼴, 여백, 컬러, 카드 비율과 모바일 배치를 `.narrative-report` 아래로 한정했다. 마음 섹션은 정본의 `#F2F3F8`, 마음 요약 칩/마무리는 `#F5EDFC`를 사용한다.
- 인라인 SVG는 350×195 viewBox, 5개 색상 구간과 opacity .24, 중간 점선, 보라 폴리라인·끝점, 높음/보통/낮음 라벨을 유지한다. Recharts와 종합 점수 표시는 추가하지 않았다.

## 실제 데이터 계약

코디네이터가 2026-09-15 질문에 “실제 데이터 계약 확장으로 진행”하도록 승인했다. 정본의 예시 좌표 대신 `content.eeg.timeline`을 사용한다.

- `NarrativeSectionsProps`의 `narrative: DisplayNarrative` 계약은 유지하고 `DisplayNarrative.timeline`을 선택적으로 추가했다.
- resolver가 타임라인을 복사해 전달한다. API 어댑터에서 백엔드 `t`(초)를 분으로 변환하고, 레거시 `min`은 그대로 보존한다. 근거는 `backend/app/tasks/report_task.py`의 `t=초 인덱스` 주석 및 `window_index` 출력이다.
- 축과 3단계 시간은 실제 마지막 측정 시각으로 계산한다. 20분 데이터는 0분/10분/20분, 다른 길이는 해당 시간으로 표시한다.
- 호흡수/심박수/HRV 기본 표시 범위는 10~20회/분, 55~90bpm, 20~80ms다. 범위 밖 실측값은 숨기지 않고 범위를 확장하며 캡션도 동기화한다.
- 마음 지표는 개인 시계열의 상대적 높낮이로 표시한다. 감정안정도는 기존 계약과 동일한 스트레스 역방향 근사이며 화면에 이를 명시한다.
- 데이터가 부족하면 안내 문구를 표시하며 임의의 곡선을 만들지 않는다. null 구간은 연결하지 않는다.

## 검증

- `cd frontend && npm run build`: 종료 코드 0, TypeScript/Vite 오류 0.
- `node --test frontend/tests/*.test.cjs`: **14 passed / 0 failed**. 신규 서사 회귀 6개 포함.
- 신규 검증: 초→분 변환, 레거시 분 유지, 실제 입력에 따른 SVG 변화, 6개 지표 렌더, null 구간 단절, 텍스트/변화량만 있는 구형 호출의 임의 그래프 방지.
- `git diff --check`: 통과.
- Chrome headless에서 React SSR 렌더 + 실제 컴포넌트 CSS를 900px/390px로 확인했다. SVG 6개, 각각 2열/1열 카드, 문서 폭 900/390으로 가로 넘침 없음.
- 스크린샷: [데스크톱](fe-redesign-evidence/desktop.png), [모바일](fe-redesign-evidence/mobile.png).

## 검증 범위와 잔여 사항

- 스크린샷은 테스트용 타임라인으로 만든 독립 컴포넌트 렌더다. 로그인한 실제 리포트 페이지 및 운영 API 연결은 검증하지 않았다.
- 빌드의 기존 디자인 토큰 import 경고와 번들 크기 경고는 변경 전후 동일하다.
- 정본의 정적 집중도 시간분포 막대 예시는 이번 필수 5항목 범위에 포함하지 않았다. 실제 분류 계약 없이 예시 비율을 운영 리포트에 넣지 않았다.
- 고정 서사 제목은 요청된 문구를 그대로 유지한다. 방향별 본문·변화량은 기존 데이터 계약을 따른다.
- 기존 6지표가 모두 있어야 변화량을 만드는 resolver 정책은 유지했다. 부분 지표 지원은 별도 범위다.
- 기존 변경인 `ReportStatusBadge.tsx`, `fe-impl-report.md`는 수정하지 않았다. 커밋·배포·운영 DB 변경 없음.
