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

---

# 후속 F — 확정 시안 남은 단계 (2026-11-09, 브랜치 `sdd/320-coach-pc-v2`)

방식 = `VITE_UI_V2` 뒤 ui-v2 전용 페이지·CSS. 레거시 파일(DashboardPage·AppShell·SidebarNav·클래스/회원/리포트 목록·ReportDetailView·HostLiveView)과 백엔드·API 훅은 무수정(`git diff d2fa8920 HEAD` 0건으로 시험 고정).

## 단계별 상태
| 단계 | 내용 | 커밋 | 상태 |
|---|---|---|---|
| F-0 | 감독 검수 불일치 보정: 회원 홈 2열, 좌측 메뉴(칩+밑줄·"대화"·문구 정리), 코치 홈 시안 구성 | 2e03276d | 완료 |
| F-1 | 코치 목록 3종(클래스·회원·리포트) PC 표 / 모바일 카드 | 6bc953b9 | 완료 |
| F-2 | 코치 리포트 상세 2열(읽기 / 코치의 기록·승인) | de173200 | 완료 |
| F-3 | 회원 PC 내 클래스 2열·대화(목록 320 + 대화창) | 3add2379 | 완료 |
| F-4 | 코치 나머지 화면: 메뉴 시안 순서, 쉘 밖 제목 31px | 43ba8974 | 부분(공통 스킨 수준, 아래 표 참조) |
| F-5 | 라이브(대기실·진행·종료) 스킨 — `html.u2-live` 스코프, CSS만 | 43ba8974 | 부분(글꼴·제목·터치 44px만) |

## 리포트 탭 매핑표 (시안 ↔ 실제 상태, 서버 `GET /reports/hierarchy` 탭과 1:1)
| 시안 | 실제 상태 | 서버 탭 | 비고 |
|---|---|---|---|
| 검토 대기 | 검토 필요(`pending_review`+승인 게이트)·생성 중·생성 실패 | `needs_review` | 기존 "검토 필요" 탭 |
| 승인됨 | `status=completed` | `all` 중 승인 행 | 기존 "전체"의 승인 행 |
| (사라지면 안 됨) 발송 실패 | `completed` ∧ `delivery_status=failed` | `failed` | **승인됨 탭 안 상태 필터 + 행 배지**로 유지, "다시 발송"은 상세의 `ReportApprovalStatus` |
탭 숫자: 검토 대기·발송 실패는 서버 요약(`summary`) 값. 승인 건수는 페이지 단위라 정확하지 않아 숫자를 표시하지 않음.

## 코치 좌측 메뉴 매핑 (항목 삭제 0, CSS order 로만 정렬)
시안 순서: 홈 → 클래스 → 회원 → 리포트 → 채팅 → 상담 → 설정. 시안에 없는 항목(**데이터 현황·플레이그라운드·알림**)은 설정 뒤 하단 그룹(구분선). "코치 전용" 문구 제거, 서버연결·로그아웃은 작게 유지. 라벨 "명상 클래스"는 용어집(`term`) 값이라 그대로.
회원 메뉴: 별도 `UiV2MemberSidebar`(라벨 "대화", 배지·서버연결·로그아웃 유지).

## 코치 홈 기능 이동표 (사라진 기능 0)
| 기존 | 새 위치 |
|---|---|
| 지금 바로 시작 / + 새 클래스 | 우열 "지금 함께 시작할까요?" 카드의 즉석 시작·새 클래스 |
| 데이터 현황 진입 | 하단 "회원과 이어가는 이야기" 카드 링크 |
| 루시 브리핑(AI 게이트) | 같은 카드 링크 |
| 코치 코드 접이식·복사 | 같은 카드 하단 |
| 프로필 완성 안내 배너·오류 재시도 | 제목 아래 |
| 진행 중 회차 타일(입장) | 좌열 "열린 회차" 카드 |
| 검토 대기 타일 | 우열 "검토할 기록" 카드 |
| 최근 대화·새 알림 레일 | 우열 |
| 오늘/다가오는 일정, 지난 회차 | 좌열 "다음 일정"(지난 회차 접이식은 제외 → 클래스 목록에서 확인) |

## F-4 코치 나머지 화면 상태
| 화면 | 처리 | 시안과 남은 차이 |
|---|---|---|
| 클래스 상세·회원·운영 | 공통 쉘+31px 제목(기존 D안 스킨) | 마크업은 기존(탭 구조), 시안의 2열 재배치 미구현 |
| 새 클래스(마법사)·즉석 시작 | 즉석 시작 제목 31px+글꼴(`u2-live`) | 마법사 제목 24px 유지(전체화면 모달형) |
| 회원 상세·초대 | 초대 제목 22→31px | 상세 2열 재배치 미구현 |
| 회차 기록·기록 상태·프로필·자격·상담 | 공통 쉘+31px(자격 대시보드 제목 22→31px) | 시안 2열 재배치 미구현 |
| 채팅·알림·설정 | 기존 D안 + PC 쉘 | — |
**구조 재배치가 필요해 남긴 것**: 클래스 상세 2열, 회원 상세 2열, 회차 기록, 상담 목록·상세·준비. 실제 DOM 이 탭·모달 중심이라 CSS 만으로 맞출 수 없고, 레거시 파일 수정 금지 규칙과 충돌.

## F-5 라이브 스킨 범위
`html.u2-live`(코치 ∧ `/sessions/:id/player|live`, `/classes/now`)에서 글꼴 Pretendard MB, 제목 31px, 터치 44px 보정. `HostLiveView`·소켓·명령 흐름·`flow/` 디렉터리 diff 0(시험으로 고정). 업로드 상태 표시 규칙은 마크업·상태에 있어 변경 없음.
**미구현**: 시안의 진행 화면 우측 280px 컨트롤 패널 재배치, 카드 radius·배경(현재 배경 사진+반투명 시트, 시안은 단색 #12081C). 실제 라이브 세션에 들어가면 호스트 접속 기록이 생길 수 있어 하네스(`/design/class-player?role=host&case=C03·C17`)와 `/classes/now`로만 확인.

## 시험
| 항목 | 결과 |
|---|---|
| `tsc -b` | 0 |
| `vitest tests/sdd318* sdd320* sdd321* sdd322*` | 17파일 **248건 통과**(신규 `sdd320f-*` 5파일 47건) |
| 전체 vitest | 14파일 24건 실패 = 기준선(변경 전과 실패 목록 동일, 신규 실패 0) |
| 운영 강제 빌드(`VITE_UI_V2=true --mode prod`) | `check-ui-v2-off.mjs` 통과(255파일), `check-release-bundle.mjs` 통과, 산출물 중 `u2f-`/`u2-side`/코치 홈·목록 청크 포함 파일 **0** |
| `check-ui-v2-off.mjs` 규칙 추가 | 코치 홈·목록·리포트 상세 청크, 회원 사이드바, `u2f-`/`u2-side-` CSS, `u2-live` |
| 금지 표현(`점수|종합점수|좋음|나쁨|보증|100%`) | 신규 CSS/TSX 0(`100%` 한 건은 `stretch`로 교체) |
| 화면 측정(미리보기 5181, 조회 전용) | 코치 1440·390 × 홈·클래스·회원·리포트·리포트 상세 + 나머지 14화면: 가로 넘침 0, 44px 미만 0(기존 체크박스 22px 라벨 1건·로그인 화면 제외) |

## 승인·코멘트 핸들러 보존 (단위 시험 `sdd320f-coach-report-detail`)
승인 = `approveAndSendReport` → `getReport` 갱신, 확인창 문구 2종 동일, 코멘트 저장·AI 초안은 기존 `CounselorCommentCard` 그대로 렌더, 다시 발송은 `ReportApprovalStatus`, 메일·PDF·내보내기도 기존 함수. 코치용 회차 공통 문서(`type=counselor`)는 기존 `ReportDetailView` 로 위임. 승인 노출 판정 `canShowApprove` 는 기존과 같은 규칙(서버 capability 우선) 단위 시험.

## 캡처 (`captures-f/`, 왼쪽 시안 / 오른쪽 구현, 22화면 × 1440·390 = 44장)
- 코치 390 캡처 확보: 이전 워커가 막혔던 로그인 자동화를 해결(저장 세션이 복원되지 않으면 즉석 재로그인). 스크립트 `frontend/e2e/sdd320f-capture.mjs`. 비-GET API 는 차단해 저장·생성·승인은 실행되지 않음.
- 합성 API 는 쓰지 않음(dev 실데이터). 단 dev 데이터 특성상 시안과 내용(예시 이름·건수)이 다름.

## 남은 차이 (대조 캡처 기준)
1. 코치 홈: 시안의 "다음 일정" 날짜 표기·"알림" 카드 위치가 다르고, 히어로가 진행 중 회차(사진 배경)로 나온다(데이터 차이). 좌측 메뉴 아이콘 굵기는 기존 `StrokeIcon`(2px) vs 시안(1.7px, CSS로 보정했으나 일부 SVG 속성 우선).
2. 회원 홈: 시안은 "새로운 리포트·담당 코치·알림"만, 구현은 코드 입장·최근 대화·내 상담이 추가(기능 유지를 위해 남김).
3. 코치 회원 목록: 시안의 "상태 필터(검토 대기/승인됨)"는 회원 데이터에 해당 상태가 없어 "최근 활동" 필터로 대체. 시안 표의 "다음 행동" 열은 "회원 보기"만.
4. 코치 클래스 목록: 시안의 "기관별 그룹"은 데이터에 기관 필드가 없어 "상태별 그룹"으로 대체.
5. 리포트 목록: 시안 "기록 요약" 열은 서버 계층 응답에 요약문이 없어 상태 안내문(`rowState.hint`)으로 대체.
6. 라이브: F-5 "미구현" 참조.

## 회귀 위험
- 새 사이드바: 회원 메뉴 마크업이 `SidebarNav` → `UiV2MemberSidebar` 로 바뀜. 회원 알림 배지는 `max(알림, 초대)`, 대화 배지는 `채팅 + AI 미읽음`(기존 `SidebarNav` 의 client 규칙과 동일). 상담 비공개(`isCounselingEnabled`) 시 내 상담 숨김은 시험으로 확인.
- `/dashboard`·`/classes`·`/clients`·`/reports`·`/reports/:id` 라우트가 `CoachAwareList` 로 바뀜. 플래그 off 또는 org_admin 은 레거시 컴포넌트를 그대로 렌더(기관관리자는 기존 화면 유지).
- 리포트 목록: 레거시의 페이지네이션(20건/페이지)이 아닌 계층 API(회차 30개/페이지)를 사용. 레거시 데스크톱(`ReportsDesktopPage`)과 같은 API 라 데이터 일치.
- `html.u2-live` 는 코치에게만 붙고 `/sessions/*/summary|record` 등은 제외. 라이브 화면의 `.pz-root` 글꼴이 바뀌므로 줄바꿈 위치가 달라질 수 있음(실기기 미확인).
- 실기기·스크린리더·실서버 라이브 세션은 미확인. 푸시·PR·배포·DB 쓰기 없음.

## G. 코치 알림·플레이그라운드 D안 (11/9)
- 알림: `ui-v2-coach-notifications-page.tsx` 신규. 진입점에서 `counselor` 분기(플랫폼 관리자는 기존 유지). 기존 훅·API 그대로(50건 조회·읽음·전체 읽음·딥링크·설정 토글). 시안의 탭(전체/회차/리포트)에 '대화'를 더한 화면 필터.
- 플레이그라운드: `pages/playground/ui-v2/` 신규(래퍼+진입점), App.tsx 에서 `VITE_UI_V2` 상수 분기. 측정·패널 컴포넌트·`useBand` 로직은 기존과 동일, 바깥 레이아웃·제목만 교체. `/playground` 를 코치 스코프 경로(`ui-v2-coach-scope.ts`)에 추가해 보라 메뉴·31px 제목 적용.
- 운영 번들 검사: `check-ui-v2-off.mjs` 에 신규 식별자·`u2g-` CSS 규칙 추가. 캡처: `captures-g/`.
- 남은 차이: 플레이그라운드 내부 패널(연결·파형·지표)은 기존 Tailwind 스타일 그대로(로직 수정 금지 범위). 알림 시안의 행별 액션 버튼(대기실 확인 등)은 실제 알림이 단일 행 클릭 이동 구조라 행 전체 클릭으로 대체.

## 11/9 코치 홈 카드 통일
- 근거: `coach-home-unify-1109.md`의 즉시 구현 승인. 별도 시안 대신 실제 화면에 반영.
- 내 클래스를 흰 카드·점선 빈 상태·44px 보라 알약 CTA로 정리. 빈 상태 접근성 status 유지.
- 최근 대화에 40px 이니셜 추가. 일정·대화·알림 행 64px, 제목 18px/800, 카드 패딩 PC 24px/모바일 18px, 카드 간격 16px. 데이터 현황은 같은 카드 안 44px 버튼.
- 훅·핸들러·경로·순서 유지, CSS `.ui-v2.u2f-home` 한정. 공용 컴포넌트·백엔드 수정 없음.
- 실제 테스트 계정으로 기존 Vite 5181 화면 확인: 1440/390 가로 넘침 0px, console/page error 0. 모바일 최하단 카드 bottom 779.91px / 탭바 top 922px로 가림 없음. 기존 행 93~121px → 64px.
- 산출물: `/Users/brianyongwookchae/.hermes/share/design-coach-home-1109/`의 before/after-1440.png, before/after-390.png, after-390-bottom.png, after-metrics.json, 재현 스크립트 capture.cjs. 캡처는 앱 내부 스크롤이 있어 대상 카드 위치와 최하단을 별도로 저장.
- 독립 검토자는 diff에서 기능 보존과 CSS 스코프 확인. status 속성과 1px 행 높이 지적 반영. 독립 브라우저 로그인은 disabled 상태로 진입하지 못하여 화면 측정은 구현자가 직접 수행.
- 한계: 실제 계정의 클래스·새 알림은 빈 상태. 생성·발송·DB 쓰기는 실행하지 않음. Vite 재시작, 푸시·PR·배포 없음.
- 최종 검사: frontend에서 `npx tsc --noEmit -p .` exit 0, 변경 TSX ESLint exit 0, 지정 vitest 26파일/313시험 통과. `git diff --check` 통과. 중간 루트 경로의 tsc 호출은 실행 경로 오류였으며 frontend에서 재실행해 확인.
