# 체크인 질문 A안 구현 결과

- 기준 커밋: 077501ef8043297bd1e9dd0e14249eeaf081f7dc. `git fetch && git rebase origin/develop` 완료(이미 최신).
- 사용자 확정 A안에 따라 지정 design/checkin-question-layout 브랜치를 유지했다. 별도 SDD 번호·브랜치를 만들지 않았다.
- 제품 변경: SurveyStepView.tsx(현재 문항 접근성·키보드), member-flow.css(설문 전용 A안), MemberFlowFrame.tsx(기본 false인 survey 옵션·전용 진행 안내).
- 공통 flow-shared.css, 데이터·문구·선택 값·훅·API·백엔드는 수정하지 않았다.

## 실측

Chrome 지정 실행 파일, DPR 1, Pretendard 로딩 확인. 실제 앱 `/design/class-flow`의 기존 입장 mock 픽스처를 사용했다. 로컬 Vite 플러그인에서만 설문 픽스처를 React 상태로 감싸 원래 onSelect 값을 반영했다. API 요청은 차단했다. 기준 서버(5187)는 위 기준 커밋의 제품 3파일을 읽으며, 변경 서버(5188)는 현재 제품 파일을 읽는다. 설정 및 환경 파일과 원격 프록시를 로드하지 않는다.

| 항목 | 이전 제품 | A 시안 | 이후 제품 |
|---|---|---|---|
| 질문 모바일 / 데스크톱 | 24 / 24px | 28 / 40px | 28 / 40px |
| 보기 글자 | 15px | 18px | 18px |
| 보기 높이 모바일 / 데스크톱 | 52 / 52px | 58px 이상 | 58 / 59.1875px |
| 8개 설문 화면 전체 텍스트 최저 대비 | 1.250:1 | 7.811:1 | 7.811:1 |

제목·보조·내부 단계·보기·다음·건너뛰기·상단 안내의 텍스트 영역 전체 배경 픽셀을 글자 투명화 캡처에서 측정했다. 실제 사진은 시안과 같은 background3.webp. 집중·감정 × 선택 전후 × 390×844/1440×900, 전후 총 16장. `capture-metrics.json`은 크기·높이·동작·색·위치, `contrast-results.json`은 텍스트별 최저 대비 원본이다. 코드 입력·안내의 4개 화면은 geometry 전체 동일 및 PNG 픽셀 차이 0을 확인했다(이 화면의 기존 대비 수치는 설문 개선 대상에 포함하지 않는다).

선택 1~5 값은 화면에 점수로 표시하지 않는다. 방향키·Home·End·포커스·순환을 실제 Chrome에서 검증했다. 전할 말과 시작 후 시트도 두 뷰포트로 추가 캡처했으며, 시트 열림 시 footer inert를 확인했다. 제목 아래 기존 gap을 제거하고 선택 라디오 크기를 시안과 맞춘 뒤 최종 캡처를 재생성했다.

## 검증

- 신규 접근성 테스트 RED(현재 문항 누락으로 1 실패/10 통과) → GREEN.
- 최종 관련 vitest: 33파일 525개 모두 통과. 설문·입장·class-flow member·class-player member·checkin 포함.
- `npx tsc --noEmit -p tsconfig.app.json`: 통과.
- 변경 TSX 및 테스트 eslint: 통과. CSS는 브라우저 computed 값으로 검증.
- `node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"`: 통과. 기존 청크 크기·정적/동적 import 경고 존재.
- `git diff --check`: 통과.
- 독립 검증자의 diff 검토: 범위·접근성·저장 계약 차단 이슈 없음. 구현자도 diff 및 테스트·캡처를 재검증.

추가 전체 `npm test`는 아래 범위 밖 실패를 확인한 후 자동 생성 스크린샷이 범위 밖 파일을 갱신하여 약 2분 실행 후 중단했다. 테스트가 생성한 기존 스크린샷 변경 1개는 기준 상태로 원복했다. 전체 suite 통과를 주장하지 않는다. 해당 실패의 baseline 재현은 수행하지 않았다.

- org-management-browser.test.cjs: 2 실패
- org-counselor-management-browser.test.cjs: 1 실패
- report-modal-pdf.test.cjs: 2 실패
- report-server-pdf.test.cjs: 2 실패
- agent-counselor-page.test.tsx: 2 실패
- chat-message-deeplink.test.ts: 2 실패

실제 서버·DB·저장 요청은 검증하지 않았다. 10개 사진 전체의 교차 페이드 대비, 모바일 키보드·780px 미만 화면의 시각 검증은 이번 증거에 포함하지 않는다. 머지·develop push·배포 없음. 의존성 심링크는 최종 제거한다.

## 재현

1. 사용자 지정대로 원본 frontend/node_modules 심링크를 준비한다.
2. frontend에서 `node ../fix-notes/checkin-question/serve.mjs`를 실행한다.
3. 루트에서 `node fix-notes/checkin-question/capture.cjs`를 실행한다.
4. `python3 fix-notes/checkin-question/measure-contrast.py`를 실행한다(Pillow 필요).

캡처는 `after-{mobile,desktop}-{focus,emotion}-{unselected,selected}.png`, 다른 입장 단계는 `{before,after}-{mobile,desktop}-{code,notice}-unselected.png`, 추가 화면은 `after-{mobile,desktop}-{note,sheet}.png`다.
