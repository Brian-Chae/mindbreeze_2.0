# SDD-320 — Summary

## 결과
코치(counselor) 업무 화면에 D안을 **스코프 스킨**으로 적용했다. SDD-318 과 같은 플래그 `VITE_UI_V2` 뒤에서만 동작하고, 운영 빌드는 `vite.config.ts` define `'false'` 고정이라 켤 수 없다. 기존 페이지 마크업·핸들러는 수정하지 않았다(CSS 로만 덮음).

| 구성 | 파일 |
|---|---|
| 스킨 CSS (전 규칙 `html.u2-coach` 하위) | `frontend/src/styles/ui-v2-coach.css` |
| 스코프 판정·토글 (`counselor` ∧ 허용 경로 ∧ 제외 경로 아님) | `frontend/src/components/ui-v2/ui-v2-coach-scope.ts` |
| 분기점 (공유 파일 수정은 이 1곳) | `frontend/src/App.tsx` `RootLayout` effect 1개 |
| 운영 검사 확장 | `frontend/scripts/check-ui-v2-off.mjs` (u2-coach 식별자) |
| 시험·캡처 | `tests/sdd320-ui-v2-coach.test.ts`, `e2e/sdd320-capture.mjs` |

## 화면별 적용 상태
| 화면 | 라우트 | 상태 | 비고 |
|---|---|---|---|
| 대시보드 | `/dashboard` | ✅ 캡처 확인 | 히어로를 틴트 그라데이션+흰 카드로 교체(사진·다크 오버레이 제거), 타일·검토 배너·패널 D 카드, 사이드바·모바일 헤더·하단 내비 D 스킨 |
| 클래스 목록·상세 | `/classes*` | ✅ 캡처 확인(목록·상세) | 테이블 구조 유지, 카드 반경·색 D. **즉석 시작·다음 회차 카드의 사진 배경은 인라인 스타일이라 유지됨**(스킨 한계) |
| 회원 관리 | `/clients*` | ✅ 공통 스킨 | 테이블+검색 유지 |
| 리포트 검토 | `/reports*` | ✅ 캡처 확인 | 검토 배너·탭·표 D 색. 점수 표기 없음 |
| 상담·회차 | `/counseling*`, 회차 상세 | ⚠️ 공통 스킨만 | 합성 API 로 별도 캡처 안 함 |
| 데이터 현황 | `/upload-status` | ✅ 공통 스킨 | 캡처 통과 |
| 채팅 | `/chat*` | ✅ 캡처 확인 | 318 말풍선 규칙 재사용 |
| 설정 | `/settings`, `/profile/professional` | ✅ 공통 스킨 | 캡처 통과 |
| 알림 | `/notifications` | ✅ 공통 스킨 | |
| 제외 | `/sessions/*`(플레이어·라이브), `/classes/now`, `/dashboard/org`, `/org/*`, `/admin/*`, `/app/*` | 미적용 | 시험·캡처로 `u2-coach` 미부여 확인 |

## 플래그 off 불변 증거
- 운영 빌드(`--mode prod`, `VITE_UI_V2=true` 강제) `check-ui-v2-off.mjs` **통과**(255개 파일, 코치 식별자·Pretendard MB 0건), `check-release-bundle.mjs` **통과**.
- 변경 전(`83fb65c6`) vs 후 운영 산출물: 파일 354개 동일, **CSS 해시 집합 완전 동일**, JS 의 실질 차이는 `index` 청크의 `RootLayout` 에 빈 `useEffect(()=>{},[])` 1개 추가뿐(분기는 dead-code 제거됨).
- 공유 쉘·`index.css`·tailwind·`ui-v2.css`·`ui-v2-brand.css`·`DashboardPage.tsx` 무수정(시험으로 고정). 기존 테스트 파일 수정 0.

## 시험
| 항목 | 결과 |
|---|---|
| 신규 vitest 31건 | 통과 |
| 전체 vitest | 기준선 14파일/24건 실패(환경 의존) → 변경 후 동일 실패 목록, 신규 실패 0 (중간에 `sdd219` 상담 경로 문자열 검사가 걸려 정규식으로 수정 후 해소) |
| `tsc -b` | 0 |
| eslint(변경 파일) | 0 |
| 캡처·측정(합성 API, 390/768/1440 × 10화면 = 30조건) | 스코프 부여/제외 정상, 가로 넘침 0, 모바일 44px 미만 0, 금지 표현 0, 최소 대비 4.86:1, reduced-motion 애니메이션 0, 폰트 `Pretendard MB` |

캡처: `specs/sdd-320-coach-ui-v2-flagged/captures/*.png`, 측정: `measure.json`.

## 못 한 것 / 한계
1. 스킨 방식이라 **마크업 재구성이 필요한 시안 요소**(서사형 리포트 구성, 클래스 상세의 아크 커버·타임라인)는 미구현.
2. 클래스 화면의 사진 배경 카드(즉석 시작·다음 회차)는 인라인 `style`이라 CSS 로 못 바꿈 — 바꾸려면 `host-classes-page.tsx` 수정 필요.
3. 상담 목록·상세, 회원 상세, 리포트 상세, 클래스 만들기 마법사는 합성 API 로 개별 캡처하지 않음(공통 스킨 적용만).
4. 데스크톱 `≥768` 사이드바는 기존 마크업에 색만 입힘. 실기기·스크린리더·실서버 데이터 미검증. 푸시·PR·배포·앱 빌드 안 함.

## 대표 결정 필요
- 클래스 목록의 사진 배경 카드를 D안(틴트 카드)으로 바꿀지(기존 페이지 1파일 수정 필요).
- 기관관리자(org_admin)가 같은 경로를 쓰므로 현재 코치에서만 켬 — SDD-321 병합 시 역할 조건(`shouldApplyCoachScope`) 합의 필요.

---

# 후속 — 코치 채팅·설정 D안 재구성 + 하단 메뉴 반전 확인 (2026-11-07)

## 결과
TestFlight 코치 로그인에서 설정·채팅이 구버전처럼 보이던 문제는 SDD-320 이 **스킨만** 입혔기 때문. 두 화면을 내담자 D안(318)과 같은 부품(`u2-chatrow`, `u2-setgroup` 등)으로 **새 화면**으로 만들었다. 플래그 `VITE_UI_V2` ∧ 역할 `counselor` 일 때만 렌더하고, 그 밖(운영 빌드·기관·플랫폼 관리자)은 기존 화면 그대로.

| 화면 | 처리 | 파일 |
|---|---|---|
| 채팅 `/chat`, `/chat/:roomId`, `/chat/lucy` | 재구성(D안 목록·방 헤더·루시 행) | `src/pages/coach/ui-v2/ui-v2-coach-chat-page.tsx` |
| 설정 `/settings` | 재구성(인셋 그룹 리스트·플레이그라운드 카드·위험 액션 분리) | `src/pages/coach/ui-v2/ui-v2-coach-settings-page.tsx` |
| 보조 CSS | `.ui-v2.u2c` 래퍼 한정 | `src/styles/ui-v2-coach-screens.css` |
| 분기 | `CoachAwareSettings`/`CoachAwareChat` (App.tsx) | `src/App.tsx` |
| 전문 프로필 `/profile/professional` | 스킨 유지(캡처 확인, 문제 없음) | — |
| 자격 `/credentials` | **캡처 미확인**(합성 API 부족으로 h1 미렌더) — 스킨 비적용 경로 | — |
| 대시보드·상담·리포트·알림·데이터 현황 | 스킨 유지(캡처 확인) | — |

## 보존표
- 설정: 내 계정(AccountSettings, 코치 프로필 관리 링크 포함)·데이터 현황·알림(NotificationGroups+WebPushCard)·차단한 사용자·기기·LINK BAND·개인정보·약관(동의·처리방침·계정 삭제)·앱 정보·리포트 운영 설정 링크·플레이그라운드 카드·로그아웃 → 전부 유지(vitest 라벨 대조). 내담자 전용 그룹은 코치에게 원래 없음.
- 채팅: `+ 새 채팅방`(CreateRoomModal), 초대(InviteMemberModal·`canInviteToRoom`), 방 설정(RoomSettingsModal), 정렬 토글, 방 메뉴, 루시(AI 비공개 시 숨김·리다이렉트), `?message=` 딥링크, 상태 토스트, 그룹 포크 이동 → 유지. 전송·읽음·실시간·첨부는 `ChatRoom`/`CounselorAgentPage` 그대로(새 로직 없음).

## 하단 메뉴 반전(대표 지시) 확인 — 390px 실캡처·계산 스타일
| 역할 | 요소 | 배경 | 활성 글자 | 비활성 글자 | 하단 여백 |
|---|---|---|---|---|---|
| 회원 | `.u2-nav` | #5F0080 | #FFFFFF | #E5D3EE | 28px(+safe-area) |
| 기관 | `.u2-nav` (ui-v2-org-nav) | #5F0080 | #FFFFFF | #E5D3EE | 28px(+safe-area) |
| 코치 | `.floating-bottom-nav` + `html.u2-coach` | #5F0080 | #FFFFFF | #E5D3EE | 12px(+safe-area) |
뱃지(빨강 #B3264B) 식별, 스크롤 끝에서 마지막 콘텐츠가 메뉴에 안 가림(설정·클래스 하단 스크롤 캡처 확인; 스크롤 컨테이너 하단 패딩 100~120px). Android 실기기 확인은 못 함(safe-area 값만 확인).

## 시험
| 항목 | 결과 |
|---|---|
| tsc -b | 0 |
| eslint(변경 파일) | 0 |
| 신규 vitest `sdd320b-ui-v2-coach-screens.test.ts` | 34건 통과 |
| 전체 vitest | 기준선 25 failed → 변경 후 25 failed, 실패 목록 동일(신규 실패 0). `sdd320-ui-v2-coach.test.ts` 의 '공유 파일 무수정' 1건은 감독 커밋 `99ec2301`(ui-v2.css 반전)로 인한 기존 실패라 기준선에 포함 |
| 운영 강제 빌드(`VITE_UI_V2=true --mode prod`) | `check-ui-v2-off.mjs` 통과(255개, 코치 D안 청크/`u2c-` CSS 규칙 추가 후), `check-release-bundle.mjs` 통과 |
| 캡처·측정(390/768/1440 × 14화면) | 가로 넘침 0, 모바일 44px 미만 0, 금지 표현 0, 최소 대비 4.86:1, reduced-motion 모션 0, 폰트 Pretendard MB (credentials 제외) |
캡처: `specs/sdd-320-coach-ui-v2-flagged/captures-b/`, 측정 `measure.json`, 스크립트 `e2e/sdd320b-capture.mjs`, `e2e/sdd320b-nav-probe.mjs`.

## 수정 중 잡은 문제
- 모바일 채팅 목록에 빈 오른쪽 패널("왼쪽에서 대화를 선택하세요")이 같이 보임 → 모바일에서 숨김(`u2c-pane--idle`).
- 설정 제목이 "SETTINGS"+"설정"으로 중복 → 영문 부제 제거.

## 구조 변경이 필요해 남긴 것 (전반 점검 결과)
| 화면 | 구버전처럼 보이는 곳 | 비고 |
|---|---|---|
| 클래스 목록 `/classes` | 즉석 시작·다음 회차 카드의 사진/어두운 배경(인라인 style) | `host-classes-page.tsx` 수정 필요(기존 한계 재확인) |
| 클래스 상세 | 다크 회차 카드·탭 | 마크업 재구성 필요 |
| 회원 `/clients` | 모바일에서 표 가로 스크롤 | 카드 보기 토글은 있음; 기본을 카드로 바꿀지 결정 필요 |
| 리포트 `/reports` 빈 상태 | 점선 테두리 박스 | 스킨으로 가능하나 이번 범위 제외(저위험이라 보류) |
| 전문 프로필 | 정상(D 카드) | — |
실시간 진행(`/sessions/*`, `/classes/now`)은 손대지 않음.

## 못 한 것
`/credentials` 합성 API 캡처·실기기(iOS/Android)·스크린리더·실서버 데이터 검증, 푸시·PR·배포·앱 빌드.

---

# 후속 3 — 코치 클래스 목록·상세, 회원 목록 모바일 카드, 리포트 빈 상태 (2026-11-07)

## 화면별 처리
| 화면 | 처리 | 방식·파일 |
|---|---|---|
| 클래스 목록: 즉석 시작 배너 | 사진+어두운 그라디언트 → 연보라 틴트 카드(#EEE5F5), 버튼 보라 | CSS 스코프 `html.u2-coach` (`src/styles/ui-v2-coach-classes.css`), 인라인 style은 `!important` 로 덮음 |
| 클래스 목록: 열린 회차·다음 회차 | 사진·오버레이 제거 → 틴트 카드, 칩·버튼 D안 색 | 동일 |
| 클래스 상세 | 다음 회차 히어로 틴트화, 탭·회차 보기 전환·카드 D안 색 | 동일 |
| 회원 목록 | 모바일(<768) 기본 보기 표 → 카드. 데스크톱은 표 유지 | `defaultClientViewMode` (`lib/clients/overview.ts`) + `ClientListPage.tsx` 초기값 |
| 리포트 빈 상태 | 점선 박스 → 흰 카드 | CSS 스코프 |
| `/credentials` | 합성 API(`/credentials`) 보강해 캡처 확인(렌더 정상, 스킨 비적용 경로라 구버전 톤) | 캡처 `captures-c/credentials-*` |

## 보존표
- 클래스 목록·상세 TSX 3개(`host-classes-page`, `host-class-detail-page`, `host-class-views`) 무수정 → 링크·필터 6종·검색·더 보기·바로 입장·다시 열기·ClassCreateAction 불변.
- 회원 목록: 검색·필터(클래스/코치/유형/기간)·그룹·페이지·보기 토글·초대 불변. 기본값 변경 조건 = `VITE_UI_V2==='true'` ∧ 코치 ∧ 저장된 선택(`mb_clients_view`) 없음 ∧ 폭<768. 그 외는 이전과 동일.
- 실시간 진행(`/sessions/*`, `/classes/now`) 관련 파일·`structure-shell.css`·`ui-v2.css`·`ui-v2-coach.css`·하단 메뉴 CSS diff 0 (시험으로 고정).

## 플래그 off 검증
- 운영 강제 빌드(`VITE_UI_V2=true --mode prod`): `check-ui-v2-off.mjs` 통과(255개, `html.u2-coach` CSS 포함 시 실패하는 규칙 추가), `check-release-bundle.mjs` 통과, 산출물에서 `u2-coach` 포함 파일 0개.

## 시험
| 항목 | 결과 |
|---|---|
| tsc -b / eslint(변경 파일) | 0 / 0 |
| 신규 vitest `sdd320c-coach-classes-clients.test.ts` | 21건 통과 |
| 전체 vitest | 기준선 14파일/24건 실패 → 변경 후 14파일/24건, 실패 목록 동일(신규 실패 0) |
| 캡처·측정(390/768/1440 × 7화면, 열린 회차 있음/없음 2세트) | 가로 넘침 0, 모바일 44px 미만 0, 금지 표현 0, 최소 대비 4.86:1, reduced-motion 모션 0, 스코프 제외 화면(player) 미적용 |
캡처: `captures-c/`(열린 회차 있음), `captures-c-next/`(없음 → 다음 회차 히어로), 측정 `measure.json`, 스크립트 `frontend/e2e/sdd320c-capture.mjs`.

## 수정 중 잡은 문제
- 첫 CSS는 `main` 조상을 가정했으나 실제 DOM에 `main` 이 없어 즉석 배너·점선 박스가 안 바뀜 → 선택자에서 `main` 제거 후 캡처로 재확인.
- 캡처 빌드에 `VITE_API_BASE_URL` 을 합성 호스트로 안 줘 목록이 비던 문제 → 지정해 재캡처.
- vitest 실행이 SDD-234 캡처를 덮어씀 → `git checkout` 으로 원복(커밋 제외).

## 못 한 것 / 한계
1. `/credentials` 는 스킨 비적용 경로(코치 스코프 CSS 밖, 별도 래퍼)라 구버전 톤 유지 — D안화는 별도 작업.
2. 클래스 상세의 아크 커버·타임라인 등 마크업 재구성 요소는 미구현(색만 D안).
3. 클래스 상세 '멤버/설정' 탭, 합성 데이터로 개별 캡처하지 않음. 실기기·스크린리더·실서버 데이터 미검증. 푸시·PR·배포·앱 빌드 안 함.

---

# 후속 4 — 회원·코치·기관 홈/클래스 메인 카드 자연 배경 통일 (2026-11-08)

| 역할 | 화면 | 처리 |
|---|---|---|
| 회원 | 홈 | 기존(PR #279) 유지 |
| 회원 | 내 클래스 대표 카드 | `u2-hero--nature` + `natureHeroStyle(model.id)` (신규 `components/ui-v2/nature-hero.ts`) |
| 코치 | 홈 `ch-hero` | 틴트 → 사진+어두운 그라데이션, 흰 글자, CTA 흰 바탕+보라, 하단 고정, min-height 320 |
| 코치 | 즉석 시작·열린 회차 | 틴트 → 기존 사진 유지 + `#251038` 폴백·눌림 그림자, 흰 글자/버튼 |
| 코치 | 클래스 상세 다음 회차 | `cs-class-hero` 오버레이를 D안 그라데이션으로, 흰 글자/버튼, min-height 320 |
| 기관 | 대시보드 기관 코드 카드 | `u2-hero--nature` + 'home' 고정 사진, 코드·복사 버튼 흰색 계열 |
| 기관 | 클래스 메인 카드 | 기관 화면에 해당 카드 없음(대시보드 클래스는 목록 행) — 미적용 |

- 코치 TSX(`host-classes-page`·`host-class-views`) 무수정, CSS만 `html.u2-coach` 하위.
- 시험: tsc 0, 신규 `sdd320d-nature-hero-all.test.ts` 통과, 320c 시험 2건을 새 방침(틴트 제거)에 맞게 갱신. sdd318~322 합계 171건 중 170 통과. 실패 1건(`320c 금지 영역 무수정`)은 변경 전에도 실패하던 기존 건(git diff 기준 기준선 문제).
- 운영 강제 빌드(`VITE_UI_V2=true --mode prod`) `check-ui-v2-off.mjs`(255파일, 0건)·`check-release-bundle.mjs` 통과.
- 캡처: `captures-d/{client,coach,org}/` (390/1440 등). 가로 넘침 0, 44px 미만 0, 금지 표현 0. 합성 API용 빌드는 `VITE_API_BASE_URL=https://<host>.local/api/v1` 필요.
- 한계: 실기기·실서버 미확인, 이미지 로딩 실패 상태 캡처는 미실시(배경색 #251038 폴백은 CSS로만 보장).

---

# 후속 E — 확정 시안(11/8) 반영: 코치 모바일·PC, 회원 PC (2026-11-08, 부분 완료)

브랜치 `sdd/320-coach-pc-v2`. 방식 = `VITE_UI_V2` 뒤 CSS·ui-v2 전용 페이지 래퍼만. 레거시 파일·백엔드·API 훅 무수정.

## 단계별 상태
| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | PC 공통 셸(≥1024 좌측 216px 보라 그라데이션 메뉴, 회원·코치 공용 `ui-v2-pc.css`) | 완료 |
| 2 | 회원 설정 제목 31px | 이미 31px(390·1440 실측) → 회귀 시험만 추가 |
| 3 | 회원 PC: 홈·클래스 상세·설정·리포트 목록·알림 2열 | 완료. 내 클래스 목록·대화는 전체 폭만 적용(별도 2열 배치 없음) |
| 4 | 코치 핵심: 공통 제목 31px, 홈 PC 2열, 터치 44px | 부분. 홈은 2열. 클래스 목록·회원 목록·리포트 목록·채팅·알림·설정은 제목/셸/폭만 시안 규격, 표·열 재배치는 미구현 |
| 5 | 코치 나머지(회원 상세·초대, 클래스 운영, 회차 기록, 상담 등) | 보류 — 공통 스킨만 적용된 상태 |
| 6 | 라이브(대기실·진행·종료) 스킨 | 보류 — 미착수(HostLiveView 무수정) |

## 시험
- `tsc -b` 0, vitest `sdd318* sdd320* sdd321* sdd322*` 12파일 201건 통과(신규 `sdd320e-pc-shell.test.ts` 21건).
- 운영 강제 빌드(`VITE_UI_V2=true --mode prod`): `check-ui-v2-off.mjs`(255파일) 통과, `check-release-bundle.mjs` 통과, 산출물 중 `u2-pc-` 포함 파일 0.
- 실측(미리보기 5181, 조회만): 코치 1440 7화면 + 회원 390·1440 6화면 가로 넘침 0. 코치 390 7화면 넘침 0·h1 31px. 44px 미만 조작은 코치 채팅의 체크박스 22px 1건만 남음(기존 컴포넌트).

## 남은 차이·위험
1. 코치 390 캡처는 로그인 자동화 불안정으로 `captures-e` 에 없음(측정 수치만 확보). 코치 1440 7화면·회원 390/1440 6화면만 `vs-*.png`.
2. 시안의 코치 리포트 목록(검토 대기/승인 탭 + 5열 표), 클래스 목록 표, 회원 표는 실제 앱의 기존 구조(전체/검토 필요/발송 실패 탭, 그룹 목록)와 달라 CSS만으로 맞출 수 없음 → 마크업 재구성 필요(미구현).
3. 코치 리포트 상세(읽기 영역 + 코멘트·승인 2열)는 공용 `ReportDetailView` 라 스킨 한계. 미리보기 계정에서 상세 진입 경로를 못 찾아 확인 못 함.
4. 회원 PC 클래스 상세는 래퍼 적용·소스 시험만, 실제 클래스 데이터가 없어 화면 캡처 미확인. 채팅방 2열도 개별 확인 안 함.
5. 라이브 화면 미착수.
