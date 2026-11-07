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

---

# addendum-2 — 채팅·설정 D안 재구성 + 하단 메뉴 반전 확인 (구현 전, 2026-11-07)

배경: TestFlight 코치 로그인에서 설정·채팅이 구버전처럼 보임(스킨만 입힌 구조). 하단 메뉴 보라/흰 글자 반전 지시(`99ec2301`) 반영 확인 포함. 기준선: 직전 전체 vitest 실패 목록(14파일/24건), 구현 전 재측정 후 비교.

## F. 신규 화면 (플래그 `VITE_UI_V2` + 코치 역할일 때만)
| ID | 항목 | 통과 기준 |
|---|---|---|
| F1 | 코치 채팅 목록·대화방·루시 | `/chat`,`/chat/:roomId`,`/chat/lucy` 가 D안 마크업(`u2-chatrow` 등)으로 렌더. 기존 ChatRoom/훅/API 재사용, 전송·읽음·실시간·첨부 코드 무수정 |
| F2 | 코치 전용 기능 보존 | `+ 새 채팅방`(CreateRoomModal), 초대(InviteMemberModal, `canInviteToRoom`), 방 설정(RoomSettingsModal), 정렬 토글, 루시(AI 비공개 시 숨김·리다이렉트), `?message=` 딥링크, 상태 토스트가 모두 존재 |
| F3 | 코치 설정 보존표 | 기존 settings-content 그룹(내 계정·데이터 현황·알림·차단한 사용자·기기·개인정보 약관·앱 정보)·플레이그라운드 카드·운영 설정 링크·로그아웃이 하나도 빠지지 않음(시험으로 라벨 대조) |
| F4 | 설정 하위 | `/profile/professional`, `/credentials` 는 스킨 점검 후 어긋나는 곳만 CSS 로 보정(구조 변경 필요 시 summary 기록) |
| F5 | 라우트 분기 | App.tsx 분기는 `VITE_UI_V2==='true'` ∧ 역할 counselor 조건. org_admin/platform_admin 은 기존 화면 유지 |
| F6 | 실시간 진행 불변 | `/sessions/:id/player|live`, `/classes/now` 관련 파일 diff 0 |

## G. 하단 메뉴 반전 3역할 (캡처)
회원(`u2-nav`), 기관(`ui-v2-org-nav`→`u2-nav`), 코치(`floating-bottom-nav`+`html.u2-coach`) 각각 390 캡처: 배경 보라 #5F0080, 비활성 글자 #E5D3EE(≥4.5:1), 활성 흰색, 뱃지·포커스 링 식별, 마지막 콘텐츠가 가려지지 않음(Android 하단 여백 = safe-area 포함 padding 확인).

## H. 플래그 off 불변
- 운영 강제 빌드(`VITE_UI_V2=true npx vite build --mode prod`) 후 `check-ui-v2-off.mjs` 통과. 새 청크명 규칙(`ui-v2-coach-(chat|settings)-page`, `u2c-`) 추가 후에도 0건.
- 기존 테스트 파일 수정 0, 공유 파일(`AppShell`·`ChatRoom`·`settings-content`·`ui-v2.css`) 무수정.

## I. 전반 점검 (390/768/1440)
대시보드·클래스 목록/상세·회원·상담·리포트 검토·데이터 현황·알림 캡처 → 구버전처럼 보이는 곳 목록화. 스킨으로 해결되면 `ui-v2-coach.css` 보정, 구조 변경 필요분은 summary 에 기록. 실시간 진행 화면 제외.

## J. 공통 기준
tsc 0, 신규 vitest 통과, 전체 vitest 신규 실패 0, 가로 넘침 0, 모바일 44px 미만 0(기존 컴포넌트 예외는 목록화), 금지 표현(`점수|종합점수|좋음|나쁨|완료|보증|100%`) 신규 소스·화면 0, 대비 ≥ 4.5:1, reduced-motion 모션 0.
