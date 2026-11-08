# SDD-318 — Summary

## 결과
내담자 5화면(홈·클래스 목록·클래스 상세·리포트 목록·리포트 상세)을 D안으로 구현했다. `VITE_UI_V2` 플래그 뒤에 두었고 운영 빌드는 `vite.config.ts` define 으로 `'false'` 고정, dev 만 `deploy-dev.yml` 이 `true` 주입.

## 플래그 off 불변 증거 (운영 빌드, 변경 전 HEAD vs 변경 후, `VITE_UI_V2=true` 를 줘도)
- 산출물 354개 파일, 파일 목록 동일.
- CSS 해시 집합 완전 동일(`.ui-v2` CSS 는 운영 번들에 아예 없음).
- JS 는 청크 해시 참조를 정규화하면 3개만 다름: `index`·`components`(번들 env 객체에 `VITE_UI_V2:"false"` 한 항목 추가), `ClientAppPage`(죽은 분기 stub 1줄). 화면 렌더 코드 차이 0.
- `scripts/check-ui-v2-off.mjs` 통과(UiV2* 식별자·D안 청크·true 고정·루트 클래스 부여 0건), `check-release-bundle.mjs` 통과.
- 공유 쉘(`AppShell`·`ClientShell`·`floating-bottom-nav`)·`index.css`·`tailwind.config.cjs`·프리셋 무수정(시험으로 고정).

## 시험
- 전체 vitest: 변경 전 14파일/24건 실패(기존 환경 의존 시험), 변경 후 동일 14파일/24건, 신규 실패 0, 신규 2파일 통과(+2).
- 신규: `sdd318-ui-v2-flag.test.ts`(플래그·define·CSS 스코프·토큰·금지 표현·공유 파일), `sdd318-ui-v2-reports.test.tsx`(그룹·전체 읽음·dialog·딥링크·오류/빈 상태·아크 접근성). 관련 기존 시험 포함 58건 통과.
- `tsc -b` 0, eslint(변경 파일) 0.
- 캡처·측정(`e2e/sdd318-capture.mjs`, 합성 API): 5화면×390/393/768 = 15조건 가로 넘침 0, 하단 가림 0, 터치 44px 미만 0, 제목 잘림 0, 금지 표현 0, 최소 대비 4.86:1, reduced-motion 애니메이션 0.

## 결정 사항(시안에 없는 기존 기능)
1. 홈: 초대 카드·코드로 입장·담당 코치·상담 섹션·새 알림·최근 대화를 D 카드/목록으로 배치. 상담 섹션은 상담 플래그 on 일 때만.
2. 클래스 목록: 신청하기·코드 입장·코드 가입 폼·대기/이탈/기타 그룹 유지. 진행은 "전체 회차 n/m" 숫자만(막대·완료율 문구 없음).
3. 클래스 상세: 멤버 작업(`MemberOperations`)은 커버 아래 그대로, 개요 탭·입장하기 링크·sessionId 강조 유지.
4. 리포트: 검색·정렬·코치별 묶기·전체 읽음·페이지네이션·딥링크·검토 중 비노출 유지. 상세는 기존 `ClientReportViewer`/`PastReportsCompare` 본문을 흰 시트 안에 그대로 사용(본문 리디자인은 후속).
5. 쉘: 데스크톱(≥768)은 기존 사이드바 유지, 모바일만 D 헤더·플로팅 내비.

## 못 한 것 / 한계
- 시안 대비 차이: 리포트 상세 본문은 기존 뷰어(보라 커버 카드·승인 상태·PDF 안내)를 그대로 쓰므로 시안의 "함께 돌아보는 시간" 구성과 다르다. 본문 서사 재구성은 별도 작업 필요.
- 홈 "이번 주 클래스"는 다음 일정+이어서 예정 일정(최대 4건) 기반. 기존 `sameWeek` 집계와 다름.
- 실기기 노치·키보드·스크린리더, 풀다운 닫기, 220ms 플레이어 전환은 미구현/미검증.
- 실서버·dev DB·실계정 데이터로는 확인하지 않음(합성 API만). 푸시·PR·배포 안 함.
- 기존 실패 24건은 이번 변경과 무관(변경 전에도 동일).

---

# Addendum-2 결과 — 채팅·설정 D안 + 상단 로고·폰트 (2026-11-07)

verify addendum-2(커밋 ec3a7ca8)를 구현 전에 작성한 뒤 구현했다. 푸시·PR·배포·앱 빌드 안 함(로컬 커밋).

## 1. 구현
| 영역 | 내용 | 파일 |
|---|---|---|
| 채팅 | 목록(인셋 카드·미읽음 배지·미리보기·시간·정렬 토글·방 메뉴), 방(뒤로가기 헤더·하단 내비 숨김·D 말풍선/입력창·안전영역), 루시(AI, `isAiEnabled` 가드 유지). 전송/읽음/실시간은 기존 `ChatRoom` 그대로 재사용 | `pages/client/ui-v2/ui-v2-chat-page.tsx` |
| 설정 | 홈(큰 제목 + 인셋 그룹 리스트, 로그아웃은 위험 색), 참여 프로필, 선택 프로필(검증·저장 호출·문구 동일) | `ui-v2-settings-page.tsx`, `ui-v2-participation-profile-page.tsx`, `ui-v2-optional-profile-page.tsx` |
| 분기 | 빌드 상수 `import.meta.env.VITE_UI_V2 === 'true'` 만 사용. 기존 컴포넌트 파일 수정 0 | `ClientAppPage.tsx`, `App.tsx`(분기만) |
| 로고 | 정본 락업: 기존 `/mb-design/assets/logo_symbol_dark.svg` 재사용 + 대문자 `MIND BREEZE`(700, +0.04em, line-height .85). 홈 링크 `aria-label="MIND BREEZE 홈"`, 터치 44px. 큰 제목 접힘 시 워드마크만 숨겨 겹침 방지 | `components/ui-v2/ui-v2-logo.tsx`, `ui-v2-client-shell.tsx` |
| 사이드바 | `[data-shell-variant="ui-v2"] [data-sidebar-brand]` 스코프 CSS로만 덮어씀. `SidebarNav.tsx` 무수정 | `styles/ui-v2-brand.css` |
| 폰트 | Pretendard Variable 자체 호스팅(`font-family:'Pretendard MB'`), `font-display:swap`, `.ui-v2` 스코프. OFL 1.1 고지 동봉 | `src/assets/fonts/PretendardVariable-KS.woff2`, `Pretendard-OFL-1.1.txt` |
| 운영 검사 | `check-ui-v2-off.mjs` 확장: 신규 청크명, Pretendard 자체 호스팅 참조, woff/woff2 파일 | `scripts/check-ui-v2-off.mjs` |
| 캡처 | 채팅·설정·로고·폰트 합성 API 캡처 | `e2e/sdd318-capture-a2.mjs` |

## 2. 사실 정정 (브리프 전제와 다른 점)
- 브리프: "Pretendard CDN 0건, 한 번도 로드된 적 없다" → **실제로는 `src/mb-tokens.css:12`가 jsDelivr CDN `pretendardvariable-dynamic-subset.css`를 `@import` 한다**(운영 번들 CSS에도 포함). 네트워크가 되는 기기에서는 CDN으로 로드되고, 차단/오프라인(앱 첫 실행 등)에서는 시스템 폰트로 떨어진다. 이번 측정 환경은 외부 요청을 막았고, 측정 Mac에 Pretendard가 로컬 설치돼 있어 전(前) 표의 "(시스템)"이 Pretendard로 나온 항목이 있다(실기기 = 설치 안 된 기기는 다를 수 있음).
- 따라서 이번 자체 호스팅은 "한 번도 적용 안 됨"이 아니라 "**외부 CDN 의존·오프라인 시 폴백 제거 + 상단 로고 등 D안 쉘이 확실히 정본 폰트를 쓰도록 보장**"이 효과다. 전역 CDN `@import`는 운영 화면 불변 조건상 건드리지 않았다.

## 3. 폰트 측정 (CDP `CSS.getPlatformFontsForNode`, headless Chrome, 합성 서버)
| 대상 | 전(현행 dev 번들) | 후(이번 변경) |
|---|---|---|
| 상단 로고 글자 (390) | `MIND BREEZE` 13px/600/2px — **.SF NS (시스템) ×11** | 17px/700/0.04em — **Pretendard Variable (웹폰트) ×11** |
| 큰 제목 h1 (390) | Pretendard SemiBold (시스템, 로컬 설치분) ×5 | Pretendard Variable (웹폰트) ×5 |
| 보조 문구 (390) | Pretendard (시스템) ×19 | Pretendard Variable (웹폰트) ×19 |
| 하단 내비 라벨 (390) | Pretendard (시스템) ×1 | Pretendard Variable (웹폰트) ×1 |
| 데스크톱 사이드바 브랜드 (1024) | `Mind Breeze` 18px/800 — Pretendard ExtraBold (시스템) ×11 | `MIND BREEZE` 17px/700 — Pretendard Variable (웹폰트) ×11 |
- 원인: `mb-tokens.css`가 h1~h3·p·버튼 등에 CDN 패밀리를 직접 지정해 D안 쉘 폰트를 덮고 있었다 → `.ui-v2` 안에서 `font-family: inherit` 로 쉘 폰트를 상속시켜 해결.
- 측정 한계: "본문/목록 제목" 항목은 클래스 화면에 해당 요소가 없어 측정 못 함. 실기기(iOS/Android) 렌더는 미측정.

## 4. 폰트 서브셋 선택
| 방식 | 크기 | 앱(Capacitor) 영향 | 결론 |
|---|---|---|---|
| 전체 가변 woff2 | 2,057,688 B | 앱 번들에 2.0MB 추가 | 제외 |
| dynamic-subset (92조각) | 합계 약 3.0MB(디렉터리) | 웹은 필요 조각만 로드하나 앱은 전 조각 번들 → 3.0MB | 제외 |
| **KS X 1001 한글 2,350자 + 라틴·기호 정적 서브셋** | **463,532 B** | 앱·웹 모두 +0.46MB, 단일 요청 | **선택** |
- 서브셋 밖 글리프(희귀 한글 등)는 전역 CDN 패밀리 → 시스템 폰트로 폴백(깨지지 않음). 한글 11,172자 전체는 포함하지 않음.
- 운영 번들 증가량 **0 바이트**(D안 코드가 운영에서 제거되므로 폰트도 번들되지 않음, 아래 검증).

## 5. 플래그 off 불변 증거
| 검증 | 결과 |
|---|---|
| 운영 빌드(`--mode prod`, `VITE_UI_V2=true` 강제) + `check-ui-v2-off.mjs` | 통과(255개 파일, `.ui-v2` CSS 포함 파일 0, JS 활성 경로 0) |
| 운영 dist 내 woff/woff2 | 0건 / `Pretendard MB`·`PretendardVariable-KS` 참조 0건 / `@font-face` 0건 |
| 운영 CSS 바이트 비교(변경 전 기준선 dist-base vs 이번) | **완전 동일(525,399 B)** |
| 위반 샘플 단위 검증(`@font-face`+woff2 주입) | 검사 스크립트 exit 1 |
| `check-release-bundle.mjs` | 통과 |
| 공유 파일 diff (`SidebarNav`, `AppShell`, `ClientShell`, `floating-bottom-nav`, `index.css`, `tailwind.config.cjs`) | 0 |
| 기존 테스트 파일 수정 | 0 (신규 1개만) |
| vitest 전체 | 24 failed / 4,294 passed (기준선 24 failed / 4,266 passed). **신규 실패 파일 0**, 통과 +28(신규 테스트 + 기존 SDD-318) |

## 6. 플래그 on 화면 측정 (채팅 목록·방·루시·설정 홈·참여 프로필·선택 프로필 × 390/393/768 = 18조합)
| 항목 | 결과 |
|---|---|
| 가로 넘침 | 0/18 |
| 하단 가림(내비 상단 대비) | 0/18 (설정 홈 마지막 줄과 내비 사이 여백 확인) |
| 터치 44px 미만 | 0/18 |
| h1 잘림 | 0/18 |
| 금지 표현(화면 본문) | 0/18 |
| 최소 대비 | 5.42:1 (보조 글자/캔버스), 내 말풍선 11.68:1 |
| `prefers-reduced-motion` | 애니메이션/전환 요소 0 |
| 대화방 | 하단 내비 숨김, 입력창 하단 = 뷰포트 하단(390: 844/844) |
| 말풍선 실측 | 내 것 `rgb(95,0,128)` / 흰 글씨, 상대 `rgb(244,244,247)` / `rgb(37,33,44)` |
| 접힘 전환(큰 제목→작은 제목) | 워드마크 숨김, 로고·작은 제목·알림 겹침 0 |
- 락업 실측(캡처 1024 사이드바 / 390 상단 바): 심볼 높이 12px, 워드마크 대문자 높이 12.02px(비율 1.00), 간격 6px(½ 심볼 높이 대비 1.00).
- 기능 보존(코드 근거): 채팅 — `ChatRoom`·`RoomActionsMenu`·`ChatSortToggle`·`RoomSettingsModal`·`AiAgentPage` 그대로 재사용, 전송/읽음/소켓 파일 diff 0.

### 설정 항목 보존표 (현행 `settings-content.tsx` → D안 `ui-v2-settings-page.tsx`)
| 현행 항목 | 표시 조건 | D안 위치 |
|---|---|---|
| 플레이그라운드 카드 | 전체 | 상단 히어로 카드 (`/playground`) |
| 내 계정 (`AccountSettings`) | 전체 | 그룹 1 |
| 선택 프로필 → `/settings/optional-profile` | client | 그룹 |
| 코치 관리 (`CounselorManagementPanel`) | client | 그룹 |
| 데이터 현황 → `uploadStatusTo` | 상담사·기관·플랫폼 관리자 | 그룹 |
| 알림 (`NotificationGroups`+`WebPushCard`) | 전체 | 그룹 |
| 차단한 사용자 (`BlockedUsersList`) | 전체 | 그룹 |
| 기기·LINK BAND (`/measurement-guide`, `/playground`) | 전체 | 그룹 |
| 내 데이터 저장 현황 → `/app/profile/upload-status` | client | 그룹 |
| 개인정보·약관 (`PrivacyConsentsSection`, `PrivacyPolicyLink`, `AccountDeletionSection`) | 전체 | 그룹 |
| 앱 정보 (버전·서버연결·도움말) | 전체 | 그룹 |
| 리포트·운영 설정 링크 | 상담사·기관 | 하단 안내 줄 |
| 로그아웃 + 오류 `role=alert` | 전체 | 하단, 위험 색 `u2-danger` |
| 참여 프로필 관리 (`/app/participation-profile`) | client | 내 계정 그룹 내부 링크(기존 `AccountSettings`) → D안 페이지 |
- 누락 0, vitest(설정 항목·경로·컴포넌트·문구 단언)로 고정.

## 7. 대비 계산
| 조합 | 비율 |
|---|---|
| #FFFFFF on #5F0080 (내 말풍선) | 11.68 |
| #25212C on #FFFFFF / #F4F4F7 (본문) | 15.76 / 14.36 |
| #68616F on #FFFFFF / #F4F4F7 (보조) | 5.95 / 5.42 |
| #5F0080 on #EEE5F5 (액센트/틴트) | 9.54 |
| #B3264B on #FFFFFF (위험 동작) | 6.37 |
| #111111 on #F4F4F7 (워드마크) | 17.20 |

## 8. 산출물 위치
`specs/sdd-318-client-ui-v2-flagged/captures/` — `chat-*`, `settings-*` (390/393/768 + `-bottom`), `font-before|after-{390,1024}.png`, `compare-logo-font-{390,1024}.png`, `settings-collapsed-390.png`, `measure-a2.json`(대비·폰트 전/후·결과).

## 9. 못 한 것 / 미검증
- 실기기(iOS 노치·키보드 올라올 때 입력창, Android) 미검증. 입력창은 기존 `useKeyboardHeight`(visualViewport) 값을 그대로 쓰고, D안은 바깥 창에 `env(safe-area-inset-bottom)`만 추가했다 — 키보드 동시 상황은 코드 근거뿐이다.
- 데스크톱(≥768px) 채팅 2단 레이아웃은 768px 캡처로만 확인(1024+ 캡처 없음). 방 메뉴(⋯)는 기존 `RoomActionsMenu`(무수정)를 쓰며, 폭 40px이던 것을 `.u2-legacy button{min-width:44px}` 스킨으로 44px 보정했다(최종 캡처 0건).
- 한글 서브셋 밖 희귀 글리프 폴백 미시각 확인.
- 스크린리더 미검증.

## F-C. 리포트 인용 한 줄(quote) 백엔드
- 계약: `content.quote: string|null` (1인칭 해요체 한 문장, ≤60자, 목표 40자). DB 컬럼·마이그레이션 없음.
- 구현: `backend/app/services/report_quote.py`(신규) — 근거 수집→Gemini JSON→`sanitize_quote` 후처리. `report_task.generate_report_inline` 이 저장 직전 `attach_quote` 호출(client·counselor 공통). `report_service.normalize_report_content` 가 항상 `quote` 키(없으면 null) 노출 → 기존 리포트도 `quote: null`.
- 근거 규칙: 전사(STT) 우선, 없으면 코치 코멘트. 둘 다 없으면 LLM 호출 0건. 마이크 오프(`status=="manual"`)·저신뢰·STT off 는 전사 미사용(코멘트만). 그룹 세션·리포트 제외 참가자·생성 실패 스텁은 null.
- 필터: 점수·종합점수·스코어·좋음·나쁨·완료·보증·100%·진단·치료·완치·처방·우울증 등 포함 시 null. 해요체 종결·단일 문장 아니면 null.
- 시험: `tests/test_sdd318_report_quote.py` 33건(LLM mock) 통과. 리포트 관련 회귀 `-k "report or comment or summary or quote"` 921 passed / 28 skipped. 기존 `test_sdd211_member_report_visibility.py` 의 EMPTY_CONTENT 에 `quote: None` 반영(계약 필드 추가에 따른 기대값 갱신).
- 한계: 실제 Gemini 호출은 하지 않음(품질 미검증, 첫 생성분 육안 확인 필요).
- 백필(필요 시): 기존 `completed` 리포트는 `POST` 재생성 경로(report regenerate)로 다시 만들면 quote 가 채워진다. 스크립트는 만들지 않음.
