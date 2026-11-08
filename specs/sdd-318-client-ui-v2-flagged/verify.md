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

---

# Addendum-2 — 채팅·설정 D안 + 상단 로고·폰트 정비 (2026-11-07, 구현 착수 전 작성)

대표 지시: "318 채팅, 설정 페이지도 같은 디자인으로. 왼쪽 상단 로고 수정. 로고와 텍스트 폰트 확인." 위 A~D 는 그대로 유효하며 아래를 추가한다. 이 절은 구현 전에만 작성하고 사후 수정하지 않는다.

## E. 플래그 off 불변 (추가)
| ID | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| E1 | 기존 vitest | `cd frontend && npx vitest run` | 변경 전 실패 24건과 동일 목록, 신규 실패 0, 통과 수 ≥ 기준선 |
| E2 | 운영 빌드 | `vite build --mode prod`(`VITE_UI_V2=true` 강제 포함) 후 `node scripts/check-ui-v2-off.mjs dist` | `ui-v2`/`UiV2`/Pretendard woff2/`@font-face` 0건, 통과 |
| E3 | 검사 스크립트 확장 | `check-ui-v2-off.mjs` 에 Pretendard·woff2 파일·`@font-face`·신규 청크명(chat/settings) 검사 추가 | 운영 dist 에 대해 위반 0, 스크립트 단위 테스트(위반 샘플 → exit 1) |
| E4 | 공유 파일 무수정 | `git diff --stat` | `SidebarNav.tsx`·`AppShell.tsx`·`ClientShell.tsx`·`floating-bottom-nav.tsx`·`index.css`·tailwind 설정·프리셋 토큰 0건 |
| E5 | 직전 수정 유지 | `ui-v2.css` 의 `a[data-testid="enter-with-code"]` 글자 흰색 | 규칙 존재, 캡처에서 흰 글자 |
| E6 | 기존 테스트 파일 | `git diff --name-status` | 기존 테스트 파일 수정 0 (신규만 추가) |

## F. 플래그 on 화면 (채팅 목록·대화방·AI 루시·설정 홈·설정 하위 1~2개 × 390/393/768px)
| ID | 항목 | 통과 기준 |
|---|---|---|
| F1 | 가로 넘침 | 모든 조합 `scrollWidth <= clientWidth` |
| F2 | 하단 가림 | 목록·설정 홈: 마지막 콘텐츠 ≤ 내비 상단. 대화방: 입력창이 하단 안전영역(`env(safe-area-inset-bottom)`) 위에 위치, 내비 숨김 |
| F3 | 터치 영역 | a·button·input·[role=tab] ≥ 44px, 예외는 summary 에 명시 |
| F4 | 대비 | 내 말풍선(#FFFFFF on #5F0080) 포함 모든 조합 ≥ 4.5:1, 계산 출력 첨부 |
| F5 | 금지 표현 | 화면 본문 + 신규 소스 문구 `점수|종합점수|좋음|나쁨|완료율|보증|100%` 0건 (위험 동작에도 적용) |
| F6 | 키보드·안전영역 | 설계 기술(visualViewport/`env()`/`dvh` 사용 근거). **실기기 키보드는 미검증이면 그렇게 명시** |
| F7 | 모션 | `prefers-reduced-motion: reduce` 에서 transition/animation 0 |
| F8 | 밴드 미착용·AI 플래그 | `isAiEnabled` false 일 때 AI 진입 비노출, true 일 때 노출 — vitest |
| F9 | 메시지 로직 불변 | 전송/읽음/실시간 훅·서비스 파일 diff 0, 마크업 래퍼·className 만 변경 |

## G. 기능 보존표 (누락 0)
- 채팅: 대화 목록 행(미읽음 배지·마지막 메시지 미리보기·시간), 정렬 토글, 방 메뉴(RoomActionsMenu 전 항목), 방 진입/뒤로가기, 말풍선(내/상대/시스템), 입력·전송, AI 에이전트 진입.
- 설정: 현행 `settings-content.tsx` 와 하위 페이지(participation-profile, optional-profile, account-deletion, 로그아웃 등)의 **전 항목을 코드 근거와 함께 표로 열거**하고 시안 위치에 1:1 매핑. 누락 0, 폼 검증·저장 로직 diff 0.
- 증빙: vitest(설정 항목 보존 — 항목 목록 단언), 매핑 표를 summary.md 에 수록.

## H. 로고·폰트
| ID | 항목 | 통과 기준 |
|---|---|---|
| H1 | 전 측정 | 현행 dev 번들 기준 상단 로고·제목·본문의 **실제 렌더 폰트**를 CDP `CSS.getPlatformFontsForNode` 로 측정해 표로 남김. 측정 불가 항목은 못 했다고 기재 |
| H2 | 락업 | 심볼(`/mb-design/assets/logo_symbol_dark.svg` 재사용, 복제 금지) + 워드마크 `MIND BREEZE` 대문자, Pretendard 700, letter-spacing .04em, line-height .85. 캡처에서 **워드마크 대문자 높이 ≈ 심볼 높이, 간격 ≈ ½ 심볼 높이**를 수치로 측정(허용 ±15%) |
| H3 | 링크·접근성 | 홈 링크 `aria-label="MIND BREEZE 홈"`, 터치 영역 ≥ 44px, 알림 아이콘과 겹침 0, 큰 제목 접힘 전환과 충돌 0, 뒤로가기 화면은 뒤로가기 버튼 유지 — vitest + 캡처 |
| H4 | 데스크톱 사이드바 | ≥768px 에서 `[data-shell-variant="ui-v2"] [data-sidebar-brand]` 스코프 CSS 로만 오버라이드, `SidebarNav.tsx` 무수정, 상담사 쉘 렌더 불변 |
| H5 | 폰트 자체 호스팅 | Pretendard Variable 자체 호스팅(외부 CDN 0), `.ui-v2` 스코프에서만 `font-family`, `font-display: swap`. 서브셋 vs dynamic-subset 비교(번들·Capacitor 증가량 측정) 후 선택 근거 기록 |
| H6 | 후 측정 | 적용 후 같은 방식으로 재측정, 로고·제목·본문이 Pretendard 로 렌더됨을 표로 증명 |
| H7 | 라이선스 | SIL OFL 1.1 고지 파일을 저장소 규칙에 맞게 추가 |
| H8 | 운영 번들 | 운영 빌드에 폰트 파일·`@font-face` 0건 (E2/E3 와 동일 검사, `VITE_UI_V2=true` 강제 포함) |
| H9 | 비교 캡처 | 폰트 적용 전/후 로고·제목 비교 이미지 `specs/.../captures/` 에 저장 |

## I. 정적 검사·한계
- `npx tsc -b` 0, 변경 파일 eslint 0, `any` 0, 파일명 kebab-case.
- 한계: 실기기 노치·키보드·스크린리더 미검증, 캡처는 headless Chromium + 합성 API(서버/DB 접근 없음), 앱 빌드·푸시·PR·배포 안 함.

---

# Addendum F-A — 회원 새 디자인 시안 불일치 수정 (B2·B1·중간·낮음) · 구현 전 작성

근거: `~/.hermes/share/audit-318/REPORT.md`. 제외: B3·B4(리포트 상세 시트), B13(코드 입장 pill 유지).

| ID | 항목 | 통과 기준 |
|---|---|---|
| FA-1 | B2 버튼 리셋 | `.ui-v2 button` 리셋을 `:where()` 로 특이도 0 화. 레거시 버튼("클래스 나가기"·"클래스 코드 확인"·홈 "대화하기"/"+ 코치 추가")의 computed style 에서 border>0 또는 배경 비투명(또는 보라 글자색)이 나옴. `.u2-primary/.u2-secondary`·하단 메뉴·탭·도구 칩의 computed 배경/색 불변 |
| FA-2 | B1 구조 | 클래스 상세 DOM 순서 = 커버 → 탭 → 타임라인(탭 패널) → "내 참여와 동의"(접기/펼치기) → "클래스 나가기". 커버~탭 사이에 MemberOperations 없음 |
| FA-3 | B1 기능 보존 | 참여 정보·선택 동의 저장·연구 동의 철회·최신 내용 다시 불러오기·대기취소/재가입이 접힌 섹션을 펼치면 모두 접근 가능(legacy `member-operations.tsx` diff 0). 나가기는 `caps.leave` 일 때 전체 폭 보조 버튼으로 하단 노출 |
| FA-4 | B5 | 일반 카드에 큰 숫자·"클래스 전체 진행" 각주 없음(대표 카드만 숫자). 완료 카드 = 제목 + 한 줄(칩 "완료 · 수료" 제거) |
| FA-5 | B6 | 코드 참여 섹션 ui-v2 카드(흰 면·radius 24), 입력 placeholder "숫자 4자리"(코드 자릿수 코드 확인값 4), 버튼 secondary 전체 폭. 해석·가입·대기 로직 diff 0 |
| FA-6 | B7 | 완료 회차에 큰 시각 없음, 날짜에 시각 중복 없음, "시각 · 지도사 가", "회차 상세 ›" 링크 |
| FA-7 | B8 | 리포트 목록 제목=서사 제목(`content.headline`) 우선·회차 부제, 없으면 기존 제목 유지(보고). 상태 문구 홈/목록 동일 "안 읽음", "확인 가능" 칩 제거 |
| FA-8 | B9 | 홈 최근 리포트 카드에 서사 제목·메타(회차·지도사)·서사 한 줄 |
| FA-9 | B10 | 홈 담당 코치를 ui-v2 카드로, 순서 히어로→이번 주→리포트→알림→대화(코치 섹션은 대화 앞 보조 위치). 코치 추가·대화하기 기능 보존 |
| FA-10 | B11·B12 | `.u2-card{isolation:isolate}` 로 아크 보임(캡처 픽셀), h1~h3 색 `#25212C` |
| FA-11 | B14 | "지도사 가" 접두, "이번 주 클래스", 알림 "리포트 확인 ›", 빈 상태 "없어요", 다음 회차 2줄 |
| FA-12 | 회귀 | `tsc -b` 0, vitest sdd318/320/321/322 통과, 운영 빌드 ui-v2 미노출(`check-ui-v2-off`, `check-release-bundle`), 금지 표현 신규 0, B13·B3/B4 파일 diff 0 |
| FA-13 | 캡처 | 390px 홈·클래스 목록·클래스 상세·리포트 목록 전/후 `captures-fa/` |
## Addendum-F-B — 회원 리포트 상세 시트 D안 재구성 (구현 전)

범위: `components/ui-v2/ui-v2-report-sheet.tsx` + 신규 `ui-v2-report-body.tsx`, `styles/ui-v2.css` 파일 끝 `.u2-rp-*` 규칙만. 레거시 `ClientReportViewer`·`ReportCoverSection` 수정 0, 백엔드 0.

| ID | 항목 | 통과 기준 |
|---|---|---|
| FB1 | 커버 반복 제거 | 시트 안에서 `session_title`(회차 제목)은 최대 1회. eyebrow=`session_title`(클래스명·N회차), h1=`content.headline`. headline 없으면 eyebrow=한글 유형 라벨, h1=`session_title` |
| FB2 | 영문 내부값 | `meditation/clinical/hypnosis/custom` 등 영문 값 화면 노출 0 → 한글 라벨 매핑(명상수업/임상심리상담/최면심리상담/수업) |
| FB3 | 내부 상태 비노출 | "승인 완료", "PDF 생성", "준비 중", "MIND BREEZE · 몸·마음 리포트", "내담자용/코치용" 칩 0 |
| FB4 | 밴드 미착용 | EEG 없음/`not_measured` 이면 `.notice` "이번 시간에는 밴드를 착용하지 않았어요…" 노출, 측정 서사 비노출 |
| FB5 | 밴드 착용 | `displayNarrative` 가 있으면 기존 측정 서사(NarrativeSections, 변화량 중심) 노출, 종합점수 대형 노출 0 |
| FB6 | 섹션 | "함께 돌아보는 시간", "코치 코멘트"(있을 때), "AI 요약"(있을 때·AI 플래그 가드) |
| FB7 | 닫기 | 하단 전체 폭 보조 버튼 "리포트 닫기"(onClick=onClose), 글자 링크 "닫기" 없음 |
| FB8 | 의료 고지 | `WELLNESS_DISCLAIMER` 작게 유지 |
| FB9 | 없는 필드 | 인용문(quote)에 해당하는 서버 필드 없음 → 가짜로 만들지 않고 숨김, summary 에 명시 |
| FB10 | 검토 중·과거 비교 | 기존 `in_review` 분기와 `PastReportsCompare` 유지 |
| FB11 | 운영 격리 | `check-ui-v2-off.mjs`·`check-release-bundle.mjs` 통과, 신규 금지 표현(점수|종합점수|좋음|나쁨|완료율|보증|100%) 0 |
| FB12 | 검사 | `tsc -b` 0, vitest `sdd318g-report-sheet` + 기존 `sdd318*`·`sdd322*` 통과, 390px 캡처(착용/미착용) |
