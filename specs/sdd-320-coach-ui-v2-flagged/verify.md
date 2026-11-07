# SDD-320 — Verify (구현 전 QA 체크리스트, 사후 수정 금지)

작성: 2026-11-07, 구현 착수 전. 기준선: `~/.hermes/cache/scratch/sdd320/baseline-vitest.txt`.

## A. 플래그 off 불변 (최우선)
| ID | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| A1 | 기존 vitest | `cd frontend && npx vitest run` | 기준선과 동일 실패 목록, 신규 실패 0 |
| A2 | 운영 빌드 | `VITE_UI_V2=true npx vite build --mode prod` 후 `node scripts/check-ui-v2-off.mjs dist` | `u2-coach`/`ui-v2-coach`/`attachCoachScope`/`Pretendard MB` 0건, 통과 |
| A3 | 운영 산출물 비교 | 변경 전(HEAD) 운영 빌드 vs 변경 후: 파일 목록·CSS 해시 집합 | CSS 해시 집합 동일, JS 차이는 App 청크의 효과 제거분뿐(설명 가능) |
| A4 | 공유 파일 무수정 | `git diff --name-status origin/develop` | `AppShell`·`SidebarNav`·`BottomTabBar`·`floating-bottom-nav*`·`index.css`·tailwind·`ui-v2.css`·`ui-v2-brand.css` 0건, `App.tsx` 1곳만 |
| A5 | 기존 테스트 파일 | 동일 | 기존 테스트 수정 0 |
| A6 | 기존 번들 검사 | `node scripts/check-release-bundle.mjs dist` | 통과 |

## B. 플래그 on 스코프 판정 (vitest)
| ID | 항목 | 기준 |
|---|---|---|
| B1 | 코치 허용 경로 | counselor 가 `/dashboard`,`/classes`,`/classes/x`,`/clients`,`/reports`,`/counseling`,`/upload-status`,`/chat`,`/settings`,`/notifications` 에서 `u2-coach` 부여 |
| B2 | 제외 경로 | `/sessions/x/player`,`/sessions/x/live`,`/classes/now` 의 플레이어 단계 아님(`/classes/now` 은 포함 여부 명시), 로그인·랜딩·`/org/*`·`/dashboard/org`·`/admin/*` 에 미부여 |
| B3 | 역할 | org_admin·client·platform_admin·비로그인에 미부여, 로그아웃 시 제거 |
| B4 | 정리 | detach 시 클래스 제거 |

## C. 화면 (390/768/1440 × 대시보드·클래스·회원·리포트·데이터 현황·채팅·설정 등 합성 API 캡처)
| ID | 항목 | 통과 기준 |
|---|---|---|
| C1 | 가로 넘침 | `scrollWidth <= clientWidth` 전 조합 |
| C2 | 하단 가림 | 모바일 마지막 콘텐츠가 하단 내비에 가려지지 않음 |
| C3 | 터치 영역 | 모바일 a·button·input ≥ 44px(기존 컴포넌트 예외는 목록화) |
| C4 | 대비 | 본문·보조·액센트 × 캔버스·표면·틴트 ≥ 4.5:1 계산 출력 |
| C5 | 금지 표현 | 화면 본문 + 신규 소스 `점수|종합점수|좋음|나쁨|완료율|보증|100%` 0건 |
| C6 | 폰트 | 로고·제목·본문이 Pretendard MB 로 렌더(`document.fonts` / computed) |
| C7 | 모션 | reduced-motion 에서 transition/animation 0 |
| C8 | 스코프 누출 | 플레이어/로그인 경로에서 `html.u2-coach` 없음, 내담자 화면 불변 |
| C9 | 기능 요소 존재 | 대시보드 '지금 바로 시작','+ 새 클래스', 데이터 현황 링크, 타일 4, 일정 행, 최근 대화·알림 패널 DOM 존재 |

## D. 정적 검사
`npx tsc -b` 0, 변경 파일 eslint 0, `any` 0, 파일명 kebab-case.

## E. 한계(미리 명시)
- 스킨 방식이라 마크업 재구성이 필요한 시안 요소(서사형 리포트 구성 등)는 구현하지 않는다.
- 실기기·스크린리더·실서버 데이터 미검증(합성 API 만). 푸시·PR·배포·앱 빌드 안 함.
- 합성 API 로 재현하지 못한 화면은 summary 에 "캡처 미확인"으로 기록.
