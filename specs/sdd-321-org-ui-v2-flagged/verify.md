# SDD-321 — Verify (구현 전 QA 체크리스트, 사후 수정 금지)

작성: 2026-11-07, 구현 착수 전. 기준선(변경 전) 산출물: `~/.hermes/cache/scratch/sdd321/`(baseline-vitest.txt, dist-base/ = `VITE_UI_V2=true` 강제 prod 빌드).

## A. 플래그 off 불변 (최우선)
| ID | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| A1 | 기존 vitest 전체 | `cd frontend && npx vitest run` | 기준선과 동일한 실패 목록, 신규 실패 0, 통과 수 ≥ 기준선 |
| A2 | 운영 빌드 불변 | `VITE_UI_V2=true npx vite build --mode prod` 후 기준선 dist-base 와 비교 | CSS 파일 집합·해시 동일, `.ui-v2`/`u2-`/`Pretendard MB`/woff2 0건, JS 는 청크 해시 참조 정규화 후 차이가 `App` 라우트 선언 stub 외 없음(차이 파일 목록을 summary 에 열거) |
| A3 | 검사 스크립트 | `node scripts/check-ui-v2-off.mjs <운영 dist>` | 통과. 확장분(`UiV2Org*` 식별자, `org-(dashboard\|counselors\|management\|search\|requests)` 청크, `ui-v2-org` CSS) 포함 |
| A4 | 검사 스크립트 위반 샘플 | `UiV2OrgShell` 문자열·`ui-v2-org-dashboard-page` 청크명을 주입한 임시 dist 에 대해 실행 | exit 1 (임시 디렉터리 사용, 저장소 오염 0) |
| A5 | 공유 파일 무수정 | `git diff --stat origin/develop..HEAD` | `AppShell.tsx`·`SidebarNav.tsx`·`MobileDrawer.tsx`·`BottomTabBar.tsx`·`floating-bottom-nav.tsx`·`index.css`·`tailwind.config.cjs`·`ui-v2.css`·`ui-v2-brand.css`·프리셋 토큰·기존 org/OrgDashboard/OrgPublic 페이지·코치 화면 파일 0건 |
| A6 | 수정 파일 허용 목록 | 같은 diff | 기존 파일 중 수정은 `App.tsx`(org 5줄 선언)·`scripts/check-ui-v2-off.mjs`·`tests`(신규만) 뿐 |
| A7 | 기존 번들 검사 | `node scripts/check-release-bundle.mjs <운영 dist>` | 통과 |
| A8 | 기존 테스트 파일 | `git diff --name-status` | 기존 테스트 수정 0 (신규만 추가) |
| A9 | 백엔드·워크플로 | diff | `backend/`·`packages/`·`.github/` 변경 0 |

## B. 플래그 on 화면 (합성 API, 390/393/768/1440px)
대상 5화면(대시보드·코치 관리·센터 관리·센터 검색·내 신청) + 코치 관리의 이력 패널·정보 수정 패널·초대 대화상자·정지 대화상자 상태.
| ID | 항목 | 통과 기준 |
|---|---|---|
| B1 | 가로 넘침 | 모든 조합 `scrollWidth <= clientWidth` (표 컨테이너 내부 가로 스크롤은 컨테이너 안에 한정, 문서 수준 넘침 0) |
| B2 | 하단 가림 | 모바일에서 스크롤 끝의 마지막 콘텐츠 하단 ≤ 하단 내비 상단 |
| B3 | 터치 영역 | a·button·input·select·[role=tab] 폭·높이 ≥ 44px (예외는 summary 에 목록으로 명시) |
| B4 | 대비 | 본문·보조·액센트·상태 칩(활성/대기/정지/인증/신청 상태) × 배경 조합 최소 4.5:1, 계산 출력 첨부 |
| B5 | 금지 표현 | 화면 본문 + 신규 소스 문구에서 `점수\|종합점수\|좋음\|나쁨\|완료율\|보증\|100\s*%` 0건 |
| B6 | 제목 잘림 | 390/393px 에서 h1 `scrollWidth <= clientWidth`, 줄바꿈 허용 |
| B7 | 모션 | `prefers-reduced-motion: reduce` 에서 transition/animation 0 |
| B8 | 폰트 | CDP `CSS.getPlatformFontsForNode` 로 제목·본문·표 머리글·로고가 Pretendard Variable(웹폰트) 로 렌더됨을 표로 남김. 측정 불가 시 못 했다고 기재 |
| B9 | 사이드바(≥768) | 기존 `SidebarNav` 유지, 브랜드 락업이 318 규칙(심볼 12px, 워드마크 대문자 높이 ≈ 심볼, 간격 ≈ ½)으로 렌더 — 수치 측정 |
| B10 | 모바일 쉘 | 상단 바 로고·메뉴 버튼·알림 겹침 0, 하단 내비 5탭(홈·클래스·리포트/상담·대화·설정), `aria-current` 단일 |
| B11 | 오류·빈·로딩 | 합성 API 로 로딩·오류·빈 상태 각 화면 확인(vitest) |

## C. 기능 보존 (vitest, 코드 근거 + 단언) — 누락 0
| ID | 화면 | 단언 |
|---|---|---|
| C1 | 대시보드 | 데이터 현황 링크(`data-upload-status-shortcut`, href `/upload-status`), 기관 코드 표시·복사 성공/실패 메시지, 코치 초대 섹션 렌더, 통계 5종 값, 소속 코치 표는 **활성 코치만**(`isActiveForStats`), 클래스 표 링크(`/sessions/:id`, `/sessions/:id/record` 는 기록·요약 있을 때만), 게스트 수, 빈 문구 2종, 오류 배너, 로딩, 퇴직 안내 팝업 마운트 |
| C2 | 코치 관리 | 헤더 액션으로 `기관관리자 초대`/`코치 초대` 각각 올바른 `inviteRole` 로 대화상자 열기, 검색(이름·이메일·코드)·역할·상태 필터 결과, 정보 수정 버튼은 코치만 활성·편집 중 비활성·기관 관리자 title 안내, 대기 행에는 정지/활성화 버튼 없음, 정지 대화상자는 사유 비면 확인 비활성, 확인 시 `suspendCounselor/unsuspendCounselor(orgId, id, reason)` 호출, 이력 패널 탭 방향키 이동·aria-selected·세션/리포트 표·빈 문구·닫기, ESC 로 대화상자 닫힘(`useDialogA11y`) |
| C3 | 정보 수정 정책 | 정보 수정이 `CounselorInfoEditor` 를 `getOrgCounselorProfile`/`patchOrgCounselorProfile` 로 연결, 편집기에 성별·생년월일·전화·주소 입력이 있고 **이메일 입력은 없음**을 렌더 단언 |
| C4 | 센터 관리 | 비관리자 안내, "준비 중" 가입 요청 안내, 역할 select 변경 시 `confirm` 문구(`역할을 '관리자'(으)로 변경하시겠습니까?`) 후 `updateCounselor`, 소속 해제 `confirm('소속을 해제하시겠습니까?')` 후 `removeCounselor`, 센터 정보 7항목 |
| C5 | 센터 검색 | `searchOrgs(q, region)` 호출, 결과 없음 문구, 신청 버튼 상태 3종, 코치 외 역할 안내, 이미 신청(비거절) 시 비활성, 오류·성공 메시지 |
| C6 | 내 신청 | 미인증 시 `/login?role=counselor` 이동, 빈 문구, 상태 배지 3종, 거절 사유 노출 |
| C7 | 로직 불변 | 기존 페이지·API·컴포넌트(`counselor-invite-section`, `counselor-info-editor`, `OrgRemovedNoticeDialog`) 파일 diff 0 |

## D. 분기 정확성
| ID | 검증 | 통과 기준 |
|---|---|---|
| D1 | `App.tsx` 분기 | 5개 org 라우트 lazy 선언이 `import.meta.env.VITE_UI_V2 === 'true'` 삼항이고 off 쪽은 기존 import 와 동일 경로 |
| D2 | 라우트·가드 | `RoleGuard`·경로·`:org_id` 정적 우선순위 diff 0 |
| D3 | 플래그 on/off 렌더 | vitest: on 이면 `.ui-v2` 루트 클래스가 있고 off(기존 페이지)에는 없음 |

## E. 정적 검사
| ID | 명령 | 기준 |
|---|---|---|
| E1 | `npx tsc -b` | 오류 0 |
| E2 | `npx eslint <변경·신규 파일>` | 오류 0 |
| E3 | 규칙 | `any` 0, 파일명 kebab-case, 신규 CSS 모든 선택자 `.ui-v2` 시작(스코프 시험으로 고정) |

## F. 한계(미리 명시)
- 실기기 노치·키보드·스크린리더 검증 불가(캡처는 headless Chromium). 로그인·서버 데이터는 합성 API(서버/DB 접근 없음).
- 앱 빌드·푸시·PR·배포 안 함. 기관 공개 페이지·플랫폼 관리자는 범위 밖.
- 공용 SDD-234 캡처 파일이 덮어써지면 커밋 전에 `git checkout origin/develop -- <경로>` 원복. `measurement_core.h` 변경은 커밋 금지.
