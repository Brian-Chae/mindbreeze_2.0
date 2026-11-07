# SDD-321 — Summary

- 브랜치: `sdd/321-org-ui-v2-flagged` (로컬 커밋만. 푸시·PR·배포·앱 빌드·메일·DB/서버 접근 없음)
- 커밋: `c9a4903d`(spec·plan·verify, 구현 전) → `af5f7fa3`(구현·시험) → 후속(CSS 44px 보정·캡처 스크립트·summary·캡처)

## 1. 결과
기관 관리자 5화면을 D안으로 구현했다. `VITE_UI_V2` 플래그 뒤에서만 동작하고 운영 빌드는 `vite.config.ts` define 이 `'false'` 로 고정(SDD-318 설정 재사용, 신규 수정 없음).

| 화면 | 라우트 | D안 파일 |
|---|---|---|
| 기관 대시보드 | `/dashboard/org` | `pages/org/ui-v2/ui-v2-org-dashboard-page.tsx` |
| 코치 관리(목록·이력·정보 수정·초대·정지/해제) | `/org/counselors` | `ui-v2-org-counselors-page.tsx` |
| 센터 관리(회원·가입 요청 안내·센터 정보) | `/org/:org_id` | `ui-v2-org-management-page.tsx` |
| 센터 검색·가입 신청 | `/org/search` | `ui-v2-org-search-page.tsx` |
| 내 가입 신청 내역 | `/org/requests` | `ui-v2-org-requests-page.tsx` |
| 공통 | 쉘·하단 내비·소품·CSS | `components/ui-v2/ui-v2-org-shell.tsx`, `ui-v2-org-nav.tsx`, `ui-v2-org-parts.tsx`, `ui-v2-org-format.ts`, `styles/ui-v2-org.css` |

수정한 기존 파일은 `App.tsx`(org lazy 선언 5줄)와 `scripts/check-ui-v2-off.mjs`(검사 3줄 추가)뿐이다.

## 2. 플래그 off 불변 증거 (운영 빌드 `--mode prod`, `VITE_UI_V2=true` 강제)
| 검증 | 결과 |
|---|---|
| 변경 전 커밋(`c9a4903d`) 빌드 vs 변경 후 빌드 | 354개 파일 모두 **바이트 동일**(파일 집합 차 0, 내용 차 0) — 318 때보다 강함(청크 3개 차이 없음) |
| `check-ui-v2-off.mjs`(기관 청크·`UiV2Org*`·`u2-org-`/`u2-table` CSS 검사 추가) | 통과, 255개 파일, `.ui-v2` CSS 포함 파일 0 |
| `check-release-bundle.mjs` | 통과 |
| 검사 스크립트 위반 샘플(`UiV2OrgShell`·`ui-v2-org-dashboard-page`·`u2-org-stat` 주입) | 3건 모두 실패(exit 1) — vitest 로 고정 |
| 공유 파일(`AppShell`·`SidebarNav`·`MobileDrawer`·`BottomTabBar`·`floating-bottom-nav`·`index.css`·tailwind·`ui-v2.css`·`ui-v2-brand.css`) | diff 0, vitest 로 고정 |
| 기존 기관·코치 화면 파일, 백엔드, `.github/`, 기존 테스트 | diff 0 |

## 3. 시험
| 항목 | 결과 |
|---|---|
| 전체 vitest | 기준선 14파일/**24건 실패**·4,294 통과 → 변경 후 14파일/**24건 실패**·4,330 통과(+36 신규). **실패 파일 목록 동일**, 신규 실패 0 |
| 신규 `sdd321-ui-v2-org-flag.test.ts` | 14건(분기 정규식 5, 라우트·가드, CSS 스코프, 공유 파일 무수정, 금지 표현, 검사 스크립트) |
| 신규 `sdd321-ui-v2-org-behavior.test.tsx` | 22건(C1~C6, D3 기능 보존) |
| `tsc -b` / eslint(신규·변경 파일) | 오류 0 / 오류 0 |

## 4. 플래그 on 측정 (합성 API, 9화면·상태 × 390/393/768/1440 = 36조건 + 사이드바 락업 2 + reduced-motion 1)
| 항목 | 결과 |
|---|---|
| 문서 가로 넘침 | 0/36 |
| 터치 44px 미만 | 0/36 (1차 측정에서 768px 대시보드 `기록 보기` 링크 37×45 발견 → `.u2-link{min-width:44px}` 로 수정 후 재측정 0) |
| h1 잘림 / 금지 표현 | 0 / 0 |
| 하단 가림(모바일 내비 상단 대비 마지막 콘텐츠) | 0 (여백 46~56px). 초대·정지 대화상자 상태는 고정 오버레이라 측정 대상에서 제외하도록 캡처 스크립트 보정 |
| 최소 대비 | 5.42:1(보조 글자/캔버스) · 칩 조합 7.1~8.3 · 흰 글자/위험색 6.37 · 본문 14.36~15.76 |
| `prefers-reduced-motion: reduce` | 애니메이션·전환 요소 0 |
| 폰트(CDP `getPlatformFontsForNode`) | h1·표 머리글·표 셀·사이드바 워드마크 전부 **Pretendard Variable (웹폰트)**. 모바일 상단 로고 워드마크(`.u2-logo-word`)는 측정 노드가 숨김 상태라 값이 비어 **측정하지 못함** — CSS 상으로는 동일 패밀리 지정 |
| 사이드바 락업(768/1440) | 심볼 12px, 워드마크 17px/700, 간격 6px — 318 규칙과 동일 |
| JS 오류(pageerror) | 0 |

## 5. 기능 보존 (코드 근거 + vitest)
| 화면 | 보존 항목 |
|---|---|
| 대시보드 | 데이터 현황 링크(`data-upload-status-shortcut` → `/upload-status`), 기관 코드 표시·복사 성공/실패 문구, 코치 초대(`CounselorInviteSection` 그대로 + 현황 목록·재발송), 퇴직 안내 팝업(`OrgRemovedNoticeDialog`), 통계 5종(`total_members` 우선), 소속 코치 실적은 활성 코치만, 클래스 표(제목→`/sessions/:id`, 기록 보기는 기록·요약 있을 때만, 게스트 수), 빈·오류·로딩 문구. 표는 모바일에서 라벨 카드 행으로 전환 |
| 코치 관리 | 기관관리자 초대/코치 초대(역할별 대화상자), 검색(이름·이메일·코드)·역할·상태 필터(aria-label 동일), 개인 상담소 배지, 정보 수정(코치만·편집 중 비활성·기관관리자 행 안내 title), 대기 행에는 정지/활성화 없음, 정지·해제 대화상자(사유 필수, 공백 제거 후 `suspend/unsuspendCounselor(orgId,id,reason)`, ESC 닫힘), 이력 패널(프로필 4항목·탭 방향키·aria·세션/리포트 표·빈 문구·닫기) |
| **개인정보 정책** | 정보 수정은 `CounselorInfoEditor`·`getOrgCounselorProfile`/`patchOrgCounselorProfile` **재사용**(재구현 0). 성별·생년월일·전화·우편번호·주소·상세 주소 입력이 있고, 이메일은 입력 없이 "이메일 (아이디 — 변경 불가)" 로만 표시 — vitest 로 단언 |
| 센터 관리 | 비관리자 안내, 가입 요청 "준비 중" 안내, 소속 코치 N명 + 검색·상태 필터, 역할 select(확인 창 문구 동일 후 `updateCounselor`, 취소 시 호출 없음), 소속 해제(확인 창 후 `removeCounselor`, 행 제거), 센터 정보 7항목 |
| 센터 검색 | `searchOrgs(q, region)`, 결과 없음 문구, 신청 버튼 3상태·중복 신청 방지, 코치 외 역할 안내, 기관 가입 상담 신청 링크, 오류·성공 메시지, 인증 리다이렉트 |
| 내 신청 | `/login?role=counselor` 리다이렉트, 빈 문구, 상태 배지 3종, 거절 사유, 날짜 포맷 |

## 6. 결정 사항 (대표 확인 필요한 것은 ★)
| # | 내용 |
|---|---|
| D1 | 시안 D 는 내담자 모바일 기준이라 기관 표 시안이 없다. D 토큰만으로 표를 구성(카드 반경 24, 행 구분선, 머리글 12px). 390px 에서는 가로 스크롤 대신 라벨 붙은 카드 행 |
| D2 | 대시보드 클래스 표에 검색·상태·유형 필터를 **추가**(대표 선호: 테이블+검색·필터). 기본값은 전체라 건수는 기존과 동일. 클라이언트 필터일 뿐 API 변경 없음 |
| D3 | ★ 통계 라벨 "완료" → "종료한 클래스"(값·집계 동일). 금지 표현 정책(완료 단정 회피) 때문. 상태 배지 라벨은 공용 `sessionStatusLabel`("완료" 포함)을 그대로 써서 기존과 일치 — 코치 관리 이력 패널의 리포트 상태 "완료"도 기존 문구 유지. 전면 치환 여부는 결정 필요 |
| D4 | `/org/search`·`/org/requests`·`/org/:org_id` 는 현행에 쉘이 없는 단독 페이지. 쉘을 새로 씌우면 라우팅 의미가 바뀌므로 단독 구조 유지(캔버스·카드만 D안) |
| D5 | ★ 기관 공개 페이지(`/o/:org_code`, `OrgPublicPage`)는 **범위 밖으로 기록**: 비로그인 방문자용 랜딩 `Nav`·`Footer` 공유 컴포넌트를 쓰는 공개 페이지라 기관 관리자 화면이 아니다. 포함하려면 랜딩 컴포넌트 영향 검토가 필요 — 별도 SDD 권장 |
| D6 | `/admin/*`(플랫폼 관리자)는 지시대로 범위 밖(기록만) |

## 7. 못 한 것 / 한계
- 실기기 노치·키보드·스크린리더 미검증. 캡처는 headless Chromium + 합성 API(서버/DB 접근 없음).
- 모바일 상단 로고 워드마크의 렌더 폰트는 측정하지 못했다(위 4번 표).
- 코치 정보 수정 폼(`CounselorInfoEditor`)과 초대 섹션(`CounselorInviteSection`)은 재사용 컴포넌트라 내부 마크업은 기존 Tailwind 그대로이고 `.u2-org-legacy` 스코프 스킨(44px·입력 반경·색)만 입혔다. 폼 자체의 D안 재디자인은 하지 않았다(검증·저장 로직 diff 0 원칙).
- 비전 모델 판독은 오탐이 섞여 참고만 했고, 판정은 측정값(`captures/measure.json`)으로 했다. 1440px 표는 최대 폭 1200px 가운데 정렬이라 우측 여백이 넓다(의도).
- 실서버·dev DB·실계정 데이터로는 확인하지 않음. 푸시·PR·배포 안 함.
- `SDD-320`(코치)과 `App.tsx` 를 함께 고친다. 내 변경은 org 5개 lazy 선언 줄에 국한했으나 머지 시 인접 줄 충돌 가능성이 있다.

## 8. 산출물 위치
- 캡처: `specs/sdd-321-org-ui-v2-flagged/captures/` — `{dashboard,counselors,counselors-history,counselors-edit,counselors-invite,counselors-suspend,management,search,requests}-{390,393,768,1440}[-bottom].png`, `measure.json`(측정·대비·폰트)
- 캡처 스크립트: `frontend/e2e/sdd321-capture.mjs`(합성 API, 사용법은 파일 머리말)
- 기준선·비교 산출물: `~/.hermes/cache/scratch/sdd321/`(baseline-vitest.txt, dist-base, dist-new, after-vitest.txt)
