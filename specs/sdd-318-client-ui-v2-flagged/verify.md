# SDD-318 — Verify (구현 전 QA 체크리스트, 사후 수정 금지)

작성: 2026-11-06, 구현 착수 전. 기준선(변경 전) 산출물은 `~/.hermes/cache/scratch/sdd318/`(baseline-vitest.txt, dist-base/).

## A. 플래그 off 불변 (최우선)
| ID | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| A1 | 기존 vitest 전체 | `cd frontend && npx vitest run` | 기준선과 동일한 통과 수, 신규 실패 0 |
| A2 | off 렌더 동일 | vitest 스냅샷: 홈·클래스 목록·상세·리포트 목록·리포트 모달을 off 로 렌더한 HTML 을 **변경 전 커밋(b7c6dbd1) 코드**와 `git stash`/worktree 비교 | 문자열 100% 동일 |
| A3 | 운영 빌드 불변 | `vite build --mode prod` 산출물에서 `ui-v2` 신규 클래스가 **활성 경로로 쓰이지 않음** 검사 스크립트 `scripts/check-ui-v2-off.mjs`: ① `VITE_UI_V2` 가 `"false"` 로 고정 ② JS 번들에 `UiV2`/`ui-v2-` 컴포넌트 문자열 0건(트리 셰이킹) ③ CSS 에 `.ui-v2` 선택자가 있어도 루트 클래스 부여 코드가 JS 에 없음 ④ 환경변수 `VITE_UI_V2=true` 를 줘도 prod 빌드는 off | 4항 모두 통과, 위반 시 exit 1 |
| A4 | 전역 CSS 불변 | 변경 전/후 prod CSS 에서 `.ui-v2` 미포함 규칙의 집합 비교 | 차이 0 (신규 규칙은 전부 `.ui-v2` 하위) |
| A5 | 공유 쉘 무수정 | `git diff --stat` 에 `AppShell.tsx`·`ClientShell.tsx`·`floating-bottom-nav.tsx`·`index.css`·`tailwind.config.cjs`·design-system 프리셋 없음 | 0건 |
| A6 | 기존 번들 검사 | `node scripts/check-release-bundle.mjs <prod dist>` | 통과 |

## B. 플래그 on 화면 (390/393/768px, 5화면)
| ID | 항목 | 통과 기준 |
|---|---|---|
| B1 | 가로 넘침 | `scrollWidth <= clientWidth` 15조건 모두 |
| B2 | 하단 가림 | 스크롤 끝에서 마지막 콘텐츠 하단 ≤ 내비 상단(상세 시트 제외) |
| B3 | 터치 영역 | a·button·input·[role=tab] 폭·높이 ≥ 44px (예외 목록은 summary 에 명시) |
| B4 | 대비 | 본문·보조·액센트 × 캔버스·표면·틴트 조합 최소 4.5:1, 계산 스크립트 출력 |
| B5 | 금지 표현 | 화면 본문 + 신규 소스 문구에서 `점수|종합점수|좋음|나쁨|완료율|보증|100%` 0건 |
| B6 | 제목 잘림 | 390/393px 에서 h1 `scrollWidth <= clientWidth`, 줄바꿈 허용 |
| B7 | 밴드 미착용 | EEG 데이터 없는 합성 사용자로 5화면이 에러 없이 완결, EEG 요소는 `bandConnected` 가드 |
| B8 | 모션 | `prefers-reduced-motion: reduce` 에서 transition/animation 0 (computed style 검사) |
| B9 | 기능 보존 | 신청·코드가입·나가기/대기·검색·정렬·그룹·전체읽음·검토중 비노출·dialog(ESC·포커스복원)·로딩/오류/빈 상태가 vitest 로 각각 확인 |
| B10 | 시안 대비 | 구현 캡처와 `D/*-390.png` 좌우 비교 이미지 5장 생성(`specs/.../captures/compare-*.png`) |

## C. 정적 검사
| ID | 명령 | 기준 |
|---|---|---|
| C1 | `npx tsc -b` | 오류 0 |
| C2 | `npx eslint <변경 파일>` | 오류 0 |
| C3 | 규칙 | `any` 0, 파일명 kebab-case, 기존 테스트 파일 무수정 |

## D. 한계(미리 명시)
- 실기기 노치·키보드·스크린리더는 검증 불가(캡처는 headless Chromium).
- 로그인·서버 데이터가 필요한 화면은 API 모킹으로 캡처한다. dev/운영 서버·DB 접근 안 함.
- 앱 빌드·배포는 하지 않는다.
