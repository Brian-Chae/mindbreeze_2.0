# SDD-320 — Plan

## 1. 접근: "스코프 스킨" (기존 마크업 불변 + 신규 파일 + 진입 분기 1곳)
코치 화면은 `AppShell`/`StructureShell` 과 수십 개 Tailwind 컴포넌트를 공유한다. 각 화면을 복제하면 기능 보존 위험과 머지 충돌이 크다. 그래서:
1. **스코프 클래스** — `html.u2-coach` 를 코치 업무 경로에서만 붙인다. 신규 `ui-v2-coach-scope.ts` 가 `router.subscribe` + `authStore.subscribe` 로 (역할=counselor ∧ 경로 ∈ 허용목록 ∧ 플레이어/라이브 제외) 일 때 클래스를 토글한다. 기존 컴포넌트 마크업·상태 무변경(리마운트 없음).
2. **스킨 CSS** — 신규 `styles/ui-v2-coach.css`, 모든 규칙이 `html.u2-coach` 하위. 캔버스·사이드바·모바일 헤더/하단 내비(라이트 필)·페이지 헤더·카드·칩·표·입력·버튼·말풍선을 D 토큰으로 덮어쓴다. 로고·타이포는 318 의 `Pretendard MB`·락업 규칙 재사용(`ui-v2-brand.css` import).
3. **분기점(공유 파일 수정 = App.tsx 1곳)** — `RootLayout` 에 `useEffect(() => { if (import.meta.env.VITE_UI_V2 === 'true') void import('./components/ui-v2/ui-v2-coach-scope').then(m => m.attachCoachScope(router)); }, [])` 1개. 운영(define 'false')에서는 분기·import 모두 제거된다.
4. **대시보드(1순위)** — 마크업 복제 없이 `.ch-*` 구조(히어로·검토 배너·타일 4·내 클래스 스트립·일정·최근 대화·알림)를 스킨에서 D 카드·히어로(틴트 그라데이션 + 큰 숫자)로 재배치한다.

## 2. 신규/수정 파일
| 파일 | 구분 | 역할 |
|---|---|---|
| `frontend/src/styles/ui-v2-coach.css` | 신규 | 스코프 스킨 전부 |
| `frontend/src/components/ui-v2/ui-v2-coach-scope.ts` | 신규 | 클래스 토글(라우터·인증 구독), CSS import |
| `frontend/src/App.tsx` | 수정 1곳 | RootLayout effect 1개(위 3) |
| `frontend/scripts/check-ui-v2-off.mjs` | 수정 | `u2-coach`/`ui-v2-coach` 식별자 검사 추가 |
| `frontend/tests/sdd320-*.test.ts(x)` | 신규 | 스코프 판정·CSS 스코프·공유 파일 무수정 |
| `frontend/e2e/sdd320-capture.mjs` | 신규 | 합성 API 캡처·측정 |

## 3. 화면 → 스킨 매핑 (D안)
| 화면 | 현행 | D안 처리 |
|---|---|---|
| 공통 쉘 | 보라 사이드바 #F5EDFC, 흰 모바일 헤더, 다크 플로팅 내비 | 사이드바 흰 표면+라인, 활성 항목 틴트, 모바일 헤더 캔버스, 내비 흰 필+라인(318 `.u2-nav` 모양) |
| 대시보드 | 사진 히어로·타일·캐러셀·패널 | 틴트 그라데이션 히어로+큰 숫자, 흰 카드(반경 24)·타일, 일정 행 리스트 |
| 클래스 | 표 헤더+행 카드(`cs-class-*`) | 목록=테이블 유지, 행 카드 반경 24/라인, 필터 칩 D, 상세 탭 D |
| 회원 | 목록/프로필 | 테이블+검색·필터 유지, 입력 D |
| 리포트 | 목록/상세 | 카드·배지·승인 상태 D 토큰, 서사 중심(점수 표기 금지 유지) |
| 상담·회차·데이터·알림·설정 | Tailwind 카드 | 공통 스킨(카드·입력·버튼·칩) |
| 채팅 | 목록+방 | 말풍선·입력창 D(318 규칙 재사용), 마크업 불변 |

## 4. 기능 보존표 (모든 화면 마크업·핸들러 불변 → 보존)
스킨은 CSS 만 바꾸므로 버튼·필드·링크·API 호출·권한 분기·플래그(`isCounselingEnabled`, `AiOnly`)는 코드 변경 0. 증빙: `git diff --stat` 에 `.tsx` 기존 페이지 0건(App.tsx 1곳 제외), 캡처에서 요소 존재 확인.

## 5. 위험과 대응
| 위험 | 대응 |
|---|---|
| 운영 번들 변화 | define 'false' + 동적 import 분기 제거 + `check-ui-v2-off`(코치 식별자 추가) + 번들 해시 비교 |
| 스킨이 플레이어/라이브로 누출 | 경로 허용목록 + 제외 목록 + 단위 시험 |
| org_admin 이 같은 경로를 쓸 때 321 과 충돌 | 역할 `counselor` 에서만 켬 |
| Tailwind 유틸이 스킨보다 특이도가 높음 | `html.u2-coach` 접두(0,1,1+)로 올리고 필요 시 `!important` 최소 사용, 캡처로 확인 |
| 못 하는 것 | 화면별 마크업 재구성(서사형 리포트 레이아웃 등)은 스킨 한계 — summary 에 기록 |

## 11/9 코치 홈 카드 통일
- 승인된 `coach-home-unify-1109.md` 기준. 기존 순서·데이터 훅·이동 경로 유지.
- 홈 전용 카드/빈 상태/이니셜 마크업과 `.u2f-home` 하위 CSS만 변경.
- 내 클래스 카드와 보라 알약 CTA, 일정·대화·알림 56~64px 행, 모바일 간격 16px.
- 테스트 계정 화면 1440/390 캡처와 DOM 치수, tsc/eslint 및 지정 vitest 실행 후 독립 검토. 커밋까지만.
