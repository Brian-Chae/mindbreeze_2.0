# SDD-240 — 모바일 메뉴 좌우 스와이프 이동

- 상태: Stage ① Spec — 2026-10-24 Brian A안(메뉴 좌우 이동) 확정 · 시안 수정 승인 (제품 구현 승인 아님)
- 브랜치: `sdd/240-mobile-menu-swipe`
- 작성일: 2026-10-24 · 코드 조사 기준: `c84d7660`
- 요청: “아이폰에서 메뉴 좌우 스와이프 … 기획서만 먼저”, “안드로이드도 확인해서 알려줘.”
- 산출물: 본 Spec + `designs/mobile-menu-swipe/index.html` 독립 설명용 프로토타입. 제품 코드·plan·verify·앱 빌드 없이 작성한다.

## 1. 문제와 목표

현재 모바일 하단 메뉴는 눌러서 이동한다. **2026-10-24 대표님 피드백 “A 방식(메뉴 좌우 이동)이 좋다”에 따라 A: 이웃 메뉴로 이동을 확정했다.** B: 직전 화면으로 뒤로가기는 별도 후속 후보로 남긴다. 둘은 목적지·출발 영역·이력 처리 방식이 다르다. 사용자가 클래스·리포트·대화 사이를 쉽게 오가되 수업·입력·가로 콘텐츠 조작 중 뜻하지 않게 이탈하지 않는 것이 목표다.

**확정: A를 우선하며 B는 별도 후속 범위로 승인받는다.** A는 iOS·Android·모바일 웹의 공통 경험으로 제공한다. B는 iOS 네이티브 뒤로가기 및 Android 시스템 뒤로가기의 이탈 보호 정합성까지 함께 다루어야 한다. A만으로 ‘아이폰 표준 뒤로가기’가 해결된다고 안내하지 않는다. 아래 수치는 설계 제안이며 실기기 검증값이 아니다.

## 2. 현행 근거

경로는 저장소 루트 기준, 행 번호는 위 기준 커밋 기준이다. 소스 확인과 실기기 동작 검증을 구분한다. 이번에는 설치된 앱·기기·배포 환경·`.env`를 조회하지 않았다.

### 2.1 플랫폼 비교

| 환경 | 탭 좌우 이동 A | 가장자리 뒤로가기 B / 현재 처리 | 확인 한계 |
|---|---|---|---|
| iOS 앱, Capacitor WKWebView | 공통 메뉴가 Link 클릭만 처리, 없음 | `capacitor.config.ts`에 활성화 설정 없음. Main.storyboard가 기본 CAPBridgeViewController 사용, AppDelegate에도 해당 속성 설정 없음. WKWebView 속성 기본값은 false이므로 이 소스에서는 활성화 근거 없음 | 설치 바이너리의 실제 비활성 여부·SPA 이력 연동은 기기 확인 필요 |
| Android 앱 | 동일하게 없음 | 프로젝트의 `backButton` 리스너·MainActivity 뒤로가기 오버라이드 없음. Capacitor App의 기본 처리에 위임하는 구조. 시스템 양쪽 가장자리 뒤로가기와 3버튼/하드웨어 백키는 탭 전환과 다른 입력 | 리스너가 없다는 것은 ‘뒤로가기 없음’이 아님. OS·내비게이션 모드·WebView 이력·키보드에 따라 실제 결과 확인 필요 |
| iPhone Safari 웹 | 동일하게 없음 | 브라우저 자체의 가장자리 이전/다음 방문 이력 제스처와 앱 탭 이동은 별개. 웹에서 추가 B를 중복 구현하지 않는 방향 | 일반 Safari 기준이며 홈 화면 웹앱과 동일하다고 단정하지 않음. 해당 SPA에서 복귀·가드 실측 안 함 |
| Android Chrome 웹 | 동일하게 없음 | 시스템/브라우저 뒤로가기 사용, 앱의 별도 B 없음 | 브라우저·OS 설정별 확인 필요 |
| 데스크톱 웹 | 모바일 pill 숨김 | 브라우저 뒤로가기 유지 | 터치패드 제스처를 A로 재해석하지 않음 |

코드 근거:

- `frontend/src/components/layout/floating-bottom-nav.tsx:13-23`: 탭 Link, 더보기 button, 경로 prefix로 활성 표시. 제스처 핸들러 없음.
- `frontend/capacitor.config.ts:3-14`: `webDir: 'dist'`, PushNotifications만 설정. `allowsBackForwardNavigationGestures`, App의 `disableBackButtonHandler` 설정 없음.
- `frontend/ios/App/App/Base.lproj/Main.storyboard:14`: 기본 `CAPBridgeViewController`. `frontend/ios/App/App/AppDelegate.swift:1-63`에는 Firebase·오디오·푸시 처리, 뒤로가기 활성화 없음. `frontend/ios/App` 소스 전체에서 해당 속성 검색 결과 0건.
- `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/MainActivity.java:1-5`: 빈 BridgeActivity 상속. `frontend/android/app/src/main/AndroidManifest.xml:5-27`: `enableOnBackInvokedCallback` 명시 없음. `frontend/android/variables.gradle:2-4`: compile/target SDK 36.
- `frontend/package.json:30-34`: Capacitor 8.5.3, App ^8.0.0. `frontend/src` 전체에서 `backButton` 검색 결과 0건. `frontend/src/lib/native/app-lifecycle.ts:45-49`의 App 리스너는 `appStateChange`이며 백키가 아니다.
- `frontend/src/hooks/useLeaveGuard.ts:16-32`: beforeunload + React Router useBlocker. 네이티브 WebView history 이동/시스템 앱 종료까지 자동 보호한다는 증거는 아니다.

**Android 뒤로가기와 predictive back 판정:**

- 앱이 사용하는 `@capacitor/app`은 선언 범위 ^8.0.0, 실제 lock 버전 **8.1.2**다(`frontend/package-lock.json:393-400`). 원본 저장소 설치 패키지도 동일 버전임을 확인했다. `frontend/node_modules/@capacitor/app/android/src/main/java/com/capacitorjs/plugins/app/AppPlugin.java:34-62`(원본 저장소 경로 기준)는 AndroidX `OnBackPressedCallback`을 등록하고, JS 리스너가 없으면 WebView `canGoBack()`일 때 `goBack()`을 호출한다. **이력이 없으면 해당 callback 안에 종료/상위 dispatcher 위임이 없다.** 따라서 초안의 ‘루트에서 기존 시스템 앱 복귀’는 보장된 현황이 아니다. 설치 바이너리·IME·다른 플러그인까지 포함한 결과는 실기기 미확인이다.
- [Android 16 공식 변경사항](https://developer.android.com/about/versions/16/behavior-changes-16#predictive-back)에 따르면 target 36 이상 앱을 Android 16 이상에서 실행하면 시스템 predictive back 애니메이션이 기본 활성이다. 이 프로젝트는 target 36이며 소스 manifest에 opt-out `enableOnBackInvokedCallback="false"`가 없다. **속성 부재를 미지원 근거로 쓰지 않는다.** 병합 manifest·설치 빌드·등록된 callback의 실제 효과까지 확인한 것은 아니다.
- 시스템 홈/액티비티/태스크 복귀 미리보기와 **WebView 내부 SPA 화면 미리보기**는 다르다. 앱 자체의 진행률·취소·화면 미리보기 구현은 검색되지 않았다. AndroidX callback 사용만으로 내부 화면 predictive back 완성을 선언하지 않는다.
- 후속 출시 검증은 Android 13/14 및 15/16의 제스처/3버튼, 이전 이력 유/무, 키보드, 중도 취소, 미저장 상태를 구분한다. 최소 SDK 24이므로 실제 지원 단말의 Android 7~12 기본 뒤로가기 회귀도 포함한다.

공식 참고(2026-10-24 확인): [Apple WKWebView 속성](https://developer.apple.com/documentation/webkit/wkwebview/allowsbackforwardnavigationgestures?language=objc) — 기본 false; [Capacitor App v8](https://capacitorjs.com/docs/apis/app) — Android 기본 back handler와 backButton 구독 시 기본 처리 대체; [Android predictive back](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture) — 시스템 애니메이션과 사용자 정의 back 처리의 연동 요구. Safari의 앱별 복귀 품질은 이번 조사에서 기기 검증하지 않았다.

### 2.2 하단 메뉴 순서와 이동

SDD-233 B안의 어두운 플로팅 pill을 유지한다. **5칸 중 4칸은 라우트, 마지막은 서랍 열기**다. 상담 공개 여부는 빌드 플래그로 결정되며 기본값은 비공개다. 배포된 플래그 값은 조사하지 않았다.

| 역할 / 상담 공개 | 1 홈 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 상담사 / 비공개 | `/dashboard` | 클래스 `/classes` | 리포트 `/reports` | 대화 `/chat` | 더보기, URL 없음 |
| 상담사 / 공개 | `/dashboard` | 클래스 `/classes` | 상담 `/counseling` | 대화 `/chat` | 동일 |
| 기관관리자 / 비공개 | `/dashboard/org` | 클래스 `/classes` | 리포트 `/reports` | 대화 `/chat` | 동일 |
| 기관관리자 / 공개 | `/dashboard/org` | 클래스 `/classes` | 상담 `/counseling` | 대화 `/chat` | 동일 |
| 회원 / 비공개 | `/app` | 내 클래스 `/app/classes` | 대화 `/app/chat` | 리포트 `/app/reports` | 동일 |
| 회원 / 공개 | `/app` | 내 클래스 `/app/classes` | 상담 `/app/counseling` | 리포트 `/app/reports` | 동일 |
| 플랫폼관리자 / 플래그 무관 | `/admin/orgs` | 가입 신청 `/admin/applications` | 사용자 `/admin/users` | 대화 `/chat` | 동일; **A 적용 대상에서는 제외** |

근거: `frontend/src/components/layout/BottomTabBar.tsx:17-31`, `frontend/src/components/client/BottomTabBar.tsx:15-22`, `frontend/src/lib/feature-flags.ts:3-5`. 디자인 근거는 `specs/sdd-233-home-stats-floating-nav/spec.md:53-65`, 실제 pill 색·크기·768px 이상 숨김은 `frontend/src/components/layout/floating-bottom-nav.css:2-12`. 과거 Spec의 ‘현황’ 문단 대신 현재 코드와 확정 탭 표를 기준으로 한다.

현재 탭 클릭은 React Router Link로 목적지 루트에 이동하며 탭별 독립 내비게이션 스택은 메뉴 컴포넌트에 없다. 상세 화면에서도 경로 prefix로 상위 탭이 활성화될 수 있으므로 **활성 탭 표시만으로 스와이프 허용을 판단하면 안 된다**. 더보기/햄버거는 MobileDrawer를 연다(`frontend/src/components/layout/AppShell.tsx:248-249`, `frontend/src/components/client/ClientShell.tsx:265-266`).

### 2.3 하위 화면 구조

| 소속 | 하위 화면 / 현재 구조 | 근거 |
|---|---|---|
| 상담사·기관 클래스 | `/classes/:classId`, `/sessions`, `/members`, `/settings`, `/schedule` 하위 탭; `/classes/:classId/sessions/:id` 세션 상세 | `frontend/src/App.tsx:228-234` |
| 회원 클래스 | `/app/classes/:classId`; 구 `/app/sessions/:id`는 ClientAppPage 내부 분기 | `frontend/src/App.tsx:184-189`, `frontend/src/pages/client/ClientAppPage.tsx:303-307` |
| 상담 | `/counseling/:relationshipId`, 그 아래 `/sessions/:id`; 회원 `/app/counseling/:relationshipId` | `frontend/src/App.tsx:186-187,235-238` |
| 대화 | 상담사·기관 `/chat/:roomId`; 회원 `/app/chat/:roomId`, 루시도 이 채널 아래 | `frontend/src/App.tsx:243-250`, `frontend/src/pages/client/ClientChatPage.tsx:73-74,133-135` |
| 리포트 | 상담사·기관 `/reports/:id`; 회원 목록 안 `selectedReportId`로 상세 모달을 열어 URL이 그대로일 수 있음 | `frontend/src/App.tsx:265-270`, `frontend/src/pages/client/ClientReportListPage.tsx:140,378-381` |
| 수업·기록 | `/sessions/:id/live`, `/sessions/:id/player`, `/sessions/:id/record` | `frontend/src/App.tsx:240-242` |
| 더보기 | 회원·상담사 관리, 설정·알림 등 별도 경로. 탭 루트로 간주하지 않음 | `frontend/src/App.tsx:203-218,319-321`, `frontend/src/pages/client/ClientAppPage.tsx:338-342` |

### 2.4 충돌 조사: 실제 위치와 제외 정책

`frontend/src` 전체 및 `frontend/package.json`에 아래 검색을 수행했다. 앱 소스의 명시적 구현을 조사한 것이며 브라우저 기본 동작·의존 라이브러리 내부 제스처까지 없다는 의미는 아니다. 아래 경로는 모두 `frontend/src/` 기준이다.

| 영역 | 실제 위치(파일:행) / 확인 결과 | A 정책 |
|---|---|---|
| 홈 레일·캐러셀 성격 카드 | `components/client/home/home-card-parity.css:12-13`, `member-home-layout.css:21-22`, `components/dashboard/counselor-home.css:17-18`: overflow-x + scroll-snap | 레일 내부 출발 제외. 스크롤 끝에서도 부모 메뉴로 넘기지 않음 |
| 별도 캐러셀 | `Carousel/carousel/embla/swiper/useSwipe/swipeable` 검색 0건(src와 package.json). 현재 확인된 캐러셀 성격 동작은 위 CSS 레일 | 추후 캐러셀 추가도 같은 제외 원칙 |
| 클래스 플레이어 시트 드래그 | `components/class/player/shared/PlayerSheet.tsx:56-95,112-120`: Esc·바깥 pointerdown·닫기 버튼; 손잡이는 aria-hidden span. **드래그 구현 없음** | 손잡이 모양을 구현으로 오인하지 않음. 수업·열린 시트 전체 차단; 후속 드래그 도입 시 시트 우선 |
| 리포트·세션 차트 | `components/reports/EegTimeline.tsx:46-85`, `components/session/SessionParticipantDetailPanel.tsx:236`: Recharts Tooltip. `components/reports/NarrativeSections.tsx:97,160,300`: SVG 정적 그래프 | 차트 영역 출발 제외. Tooltip 존재가 드래그/줌 구현의 증거는 아님 |
| 개발용 차트 | `components/playground/TrendPanel.tsx:177`, `SpectrumPanel.tsx:89,111`, `AccPanel.tsx:73`, `PlaygroundMeditationPanel.tsx:399,446`, `WaveformCanvas.tsx:190` | playground 자체 적용 제외. Brush·앱 차트 touch/drag 핸들러 검색 0건 |
| 가로 표·칩(모바일 후보) | `pages/clients/ClientListPage.tsx:65`, `pages/org/OrgCounselorsPage.tsx:277,305,484`, `pages/org/OrgManagementPage.tsx:166`, `pages/admin/SignupApplicationsPage.tsx:186`, `pages/admin/OrgManagementPage.tsx:374`, `pages/records/SessionRecordPage.tsx:154`, `components/session/SessionMonitorTable.tsx:173`, `components/admin/org-detail-modal.tsx:226` | 가로 overflow 컨테이너 내부 출발 제외. 상당수 화면은 루트 허용 목록에서도 제외 |
| 가로 표(현재 데스크톱만 표시) | `pages/admin/ClientManagementPage.tsx:502`, `pages/admin/UserManagementPage.tsx:200`, `pages/reports/ReportListPage.tsx:663`, `pages/client/ClientReportListPage.tsx:356`, `pages/OrgDashboardPage.tsx:528,715,769`의 `hidden md:block` | 모바일 충돌이 이미 발생한다고 주장하지 않음. 향후 반응형 변경 시도 제외 계약 유지 |
| 개발용 가로 표 | `components/playground/NormalizationPanel.tsx:395,431,498` | 적용 제외 |
| 오디오·볼륨 슬라이더 | `components/class/GuestAudioPanel.tsx:75,125`, `ClassAudioPanel.tsx:103,132`, `flow/member/WaitStartView.tsx:61`, `flow/host/LobbySheets.tsx:154`, `player/member/MemberSheets.tsx:163` (마지막 5개는 components/class/ 하위) | range 및 주변 조작 영역 제외 |
| 텍스트 선택·채팅 입력 | `components/chat/ChatTextarea.tsx:37-61`: textarea·한글 IME·내부 세로 스크롤. `components/chat/ChatRoom.tsx:461`: 입력 사용. 전역 `user-select:none`·`getSelection`·`selectionchange` 관련 구현 검색 0건 | 기본 길게 누르기·선택 핸들 유지. 선택 중/폼 포커스/조합 중에는 A 전체 차단. 일반 텍스트의 길게 누르기도 이동으로 인식하지 않음 |
| 미저장 편집·모달·서랍 | `components/chat/RoomSettingsModal.tsx:74-85,213-214` dirty 확인; `pages/classes/class-scheduling-wizard.tsx:69,293`, `components/class/flow/host/CreateWizardContainer.tsx:39` 이탈 가드; `pages/client/ClientReportListPage.tsx:140,378-381` URL 불변 상세 모달; `components/layout/AppShell.tsx:248`, `components/client/ClientShell.tsx:265` 서랍 | 열린 상태·미저장·저장 중은 전체 차단. URL만으로 허용 판정 금지 |

조사 재현용(읽기 전용, 일치 없음의 exit 1은 오류가 아님):

```bash
rg -n -i 'swipe|carousel|embla|swiper|onTouch|onPointer|touch-action|touchAction|overflow-x|overflowX|scroll-snap|scrollSnap|<Brush|type="range"|select-none|user-select|getSelection|selectionchange' frontend/src
rg -n 'Carousel|carousel|embla|swiper|useSwipe|swipeable|touchstart|touchmove|touchend|pointermove|pointerup' frontend/src frontend/package.json
rg -n 'recharts|<Tooltip|<Brush|<canvas|<svg' frontend/src/components
rg -n 'textarea|contentEditable|isComposing|dirty|useLeaveGuard|useWizardLeaveGuard' frontend/src
rg -n 'backButton|disableBackButtonHandler|allowsBackForwardNavigationGestures|OnBackInvoked|predictive' frontend/src frontend/ios/App frontend/android frontend/capacitor.config.ts
```

## 3. 대안 비교

| 대안 | 사용자 가치 | 오동작 위험 | 구현량(상대 추정) | 네이티브 재빌드 | iOS / Android 관례 적합성 |
|---|---|---|---|---|---|
| A: 주요 메뉴 간 좌우 이동 | 세 플랫폼 공통으로 주요 메뉴 탐색 단축. 요청의 ‘메뉴’에 직접 대응 | 중간~높음. 레일·표·선택과 경쟁; 루트/출발 영역/보호 상태 제한 필요 | 중간: 인식·예외 상태·라우터 연동·접근성 | native 코드 변경은 원칙상 불필요. **현재 번들 앱에는 새 JS를 포함한 재빌드·버전 배포 필요**, 웹만은 불필요 | iOS: HIG가 요구하는 표준 탭 동작은 아님, 보조 단축 제스처로 제한. Android: Material bottom navigation의 전통적 지침과 차이 있음 |
| B: 가장자리 뒤로가기 | 상세→직전 화면 복귀. iOS 불편 해결, Android 기존 back 품질 점검 | 높음. native WebView 이력과 SPA 가드 불일치, 수업/입력 이탈 | 중간~큼: iOS 속성 하나보다 가드·취소·이력 검증이 큼 | iOS native 변경 필요. Android 보완 범위에 따라 native 변경; JS만 바뀌어도 앱 번들 배포 필요 | iOS: 계층 복귀 관례에 더 가까움(웹 이력과 앱 계층은 다름). Android: 기존 시스템 back 존중이 적합, 중복 edge 제스처 금지 |
| A+B 동시 | 주요 메뉴 이동·상세 복귀 모두 | 가장 높음. 중앙/가장자리와 탭/상세 조합·중복 이동 위험 | 큼: 각 대안 + 플랫폼 조합 검증 | 필요 | B의 관례 적합성은 확보하되 A의 비표준 위험은 그대로 남음 |

**공식 지침과 설계자의 해석(2026-10-24 확인):**

- [Apple HIG — Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures): 익숙한 제스처의 의미와 다른 입력 수단을 존중한다. [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): 주요 섹션 이동, 라벨·선택 상태, 섹션별 탐색 상태가 중요하다. **HIG가 iPhone 하단 메뉴 좌우 스와이프를 필수로 요구한다는 근거는 없다.** 따라서 A는 앱 고유의 선택 가능한 단축 동작이며 버튼을 항상 유지한다.
- [Google의 현행 Material 3 NavigationBar 안내](https://developer.android.com/develop/ui/compose/components/navigation-bar): 동일 중요도의 3~5개 목적지를 클릭으로 선택하는 구조다. [Material 구 지침 — Bottom navigation, Swiping](https://m1.material.io/components/bottom-navigation.html#bottom-navigation-behavior)는 콘텐츠 영역 스와이프로 주요 목적지 사이를 이동하지 않는다고 명시한다. 이는 **구 버전의 명시적 지침**이지 M3의 최신 금지 문구를 확인했다는 뜻은 아니다. [Material Tabs](https://m1.material.io/components/tabs.html)는 스와이프 가능한 콘텐츠 탭과 구분한다. 파일명 BottomTabBar를 이유로 두 패턴을 동일시하지 않는다.
- [Android 16 predictive back](https://developer.android.com/about/versions/16/behavior-changes-16#predictive-back)은 OS 뒤로가기 규칙이다. A로 재해석하거나 웹 자체 edge 동작을 덧씌우지 않는다.
- 기존 pill의 더보기 액션·탭별 스택 미보유·push 이력은 native 탭 관례와 다른 **현행 계약**이다. 이번 A에서 이를 개편하지 않으며 ‘HIG/Material 완전 준수’라고 표기하지 않는다.

**10/24 확정: 제한된 A를 먼저, B는 별도 후속.** ‘주요 메뉴 이동’을 먼저 해결한다는 가정이다. A는 양 플랫폼 공통 효용이 있지만 플랫폼 표준이 아니므로 루트의 비충돌 영역에서만 보조 동작으로 제공한다. 390px 프로토타입으로 방향·끝 동작·보호 정책을 먼저 판단하고, 실제 홈 레일이 많은 화면에서 쓸 수 있는 영역과 오동작률은 구현 승인 후 실기기로 검증한다. 수업/입력에서 우발 이탈이 한 번이라도 재현되면 출시하지 않는다. 2026-10-24 Brian이 A안을 확정했으며, 이번 승인은 독립 HTML 시안 수정 범위다. 제품 구현은 별도 승인 대상이다.

## 4. A안 확정 제스처 규칙 (2026-10-24)

### 4.1 A — 메뉴 이동

- 대상: 767 CSS px 이하 모바일 터치, 하단 메뉴가 실제 보이는 4개 루트 화면. 마우스·데스크톱 트랙패드·키보드 화살표는 가로 스와이프로 해석하지 않는다.
- 방향: 손가락을 왼쪽으로 밀면 오른쪽 이웃 탭, 오른쪽으로 밀면 왼쪽 이웃 탭. 한 번에 한 칸. 첫/마지막에서 멈춤, 순환 없음. 마지막에서 더보기를 자동으로 열지 않는다.
- 출발: 콘텐츠 본문 중 제외 요소가 아닌 곳. 좌우 가장자리 각 24px, 상단 헤더, 하단 pill와 홈 인디케이터/safe area 제외. Android 시스템이 더 넓은 영역을 점유하면 OS 우선이며 강제로 빼앗지 않는다.
- 인식: 한 손가락. 누른 뒤 500ms 이내에 12px 이상 움직인 경우에만 후보를 시작한다(그 전 길게 누르기는 텍스트 선택 우선). 이후 `|dx| ≥ 1.5 × |dy|`면 수평 후보. 세로 방향이 먼저 확정되면 손을 뗄 때까지 A 금지. 12px 이후 수평 우세를 만족하지 않으면 해당 입력은 세로/대각 동작으로 넘기고 손을 뗄 때까지 재획득하지 않는다. 세로 스크롤/핀치 확대·텍스트 선택 방해 금지. 버튼·링크·입력·선택 컨트롤 안에서 시작해도 A를 인식하지 않는다.
- 완료: 손을 뗄 때 `|dx| ≥ max(64px, 본문 너비×0.20)` 또는 `|dx| ≥ 40px`이면서 최근 80ms 내 최소 2개 샘플·최소 16ms 간격의 수평 평균 속도 ≥0.5px/ms이며 최종 이동 방향과 속도 방향이 같아야 한다. 본문 너비는 패딩을 빼기 전 인식 컨테이너 폭이다. 390px이면 거리 기준 78px. 수평 비율 조건도 최종 충족해야 한다. 속도 샘플이 부족하면 거리만 사용한다.
- 취소: 임계 미달, pointercancel, 두 번째 손가락, 창 비활성, 화면 회전, 도중 금지 상태로 전환 시 원위치. 자동 이동·중복 클릭 없음. 종료 후 잔여 click을 메뉴/카드 클릭으로 실행하지 않음.
- 피드백: 수평 방향 잠금 뒤 현재 메뉴 화면이 손가락의 전체 이동량을 **1:1로 추종**하고, 이동 방향의 이웃 메뉴 화면이 옆에서 함께 들어온다. 임계값을 넘기면 240ms 스냅 전환 후 메뉴·하단 탭 강조·접근성 안내를 함께 갱신한다. 미달이면 160ms로 원위치 복귀한다. 첫/마지막에서는 이동량의 22%, 최대 32px 저항만 제공하고 순환·더보기 자동 진입은 없다. 움직임 줄이기는 추종·전환 애니메이션 없이 완료 판정과 메뉴 이동만 유지한다. 드래그 중 이웃 화면은 비활성·접근성 트리 제외 미리보기이며 실제 라우트·데이터 변경은 완료 후 한 번만 처리한다.
- 브라우저 제어: 패드만이 아니라 **본문 인식 컨테이너 전체에 `touch-action: pan-y pinch-zoom`**을 적용한다. 처음 12px에서 방향 잠금 후 수평 입력만 pointer capture하며, 원래 터치 대상에서 capture가 넘어올 때 발생하는 `lostpointercapture`는 실제 컨테이너 캡처 상실과 구분한다. `pointercancel`·다중 터치 등 취소 시 잔여 전환 없이 원위치로 돌린다. 가로 레일은 독립 스크롤 컨테이너와 `data-no-swipe`를 유지하며 레일 위 터치는 레일만 스크롤한다.
- 이동은 기존 탭 클릭과 동일한 권한·라우트 가드·이력 정책을 따른다. 현행 Link와 같이 한 번 push하며 추가 이력 중복 생성 금지. 탭별 스택/스크롤 기억 신설 없음. 돌아온 목록의 복원은 기존 정책 유지. 반복 스와이프 이력도 시스템 back으로 역순 이동한다.
- 쿼리/필터는 현재 화면의 상태로 취급하고 목적지는 탭의 기존 루트 URL. 경로 끝 `/`만 정규화, 상세 경로를 prefix로 허용하지 않는다. 전환 중 추가 제스처는 무시하고 전환 종료 후 다시 시작한다.
- 역할·기능 플래그로 화면에 실제 렌더된 4개 메뉴가 순서의 유일한 기준이다. 숨은 상담·AI·플랫폼관리자 메뉴를 생성하지 않는다.

### 4.2 B — 뒤로가기 (후속 후보)

- 의미: ‘왼쪽 이웃 탭’이 아니라 직전 방문 화면. 뒤로가기 버튼과 같은 보호·목적지 정책을 사용한다. 상세 딥링크로 들어와 안전한 앱 내 이전 이력이 없으면 가장자리 제스처는 비활성, 명시적 ‘목록으로’ 버튼은 부모 목록으로 이동한다.
- iOS 앱: 우선 검토 방식은 native WKWebView 제스처. 왼쪽 가장자리→오른쪽이 뒤로가기이며 임계 거리·속도·시각 전환은 OS 소유(앱 수치 강제 없음). 해당 속성은 앞으로가기도 허용할 수 있으므로 오른쪽 가장자리 앞으로가기와 가드까지 확인해야 한다. 단순 true 설정만으로 출하하지 않는다.
- native 방식에서 위험 화면별 차단·가드가 보장되지 않으면 출시 보류. 안전성을 희생해 전역 활성화하지 않는다. 대체안은 iOS 앱 안에서만 제어하는 custom B: 왼쪽 20px 시작, 수평 우세 1.5배, 완료 거리 max(80px,너비×0.25) 또는 48px+0.5px/ms, 180ms 완료/120ms 취소. native B와 동시 활성화 금지. custom은 iOS 표준 전환과 동일하다고 표현하지 않는다.
- Android: 양쪽 가장자리 시스템 back·3버튼/하드웨어 back을 유지. custom edge recognizer 추가하지 않음. 기본 처리 대체 시 키보드→최상단 닫을 수 있는 오버레이→보호 확인→앱 내부 이전 화면 순서를 보장하고, 안전한 앱 내 이력이 없는 루트에서는 앱을 백그라운드로 보내는 시스템 수준 복귀를 목표로 한다. 현재 플러그인의 이력 없는 callback 무동작과 다르므로 **B 후속 개선 범위**이며 A에 몰래 포함하지 않는다. 앱 종료를 강제로 추가하지 않는다. 위험 상태는 명시적 확인을 거친다.
- 웹 Safari/Chrome: 브라우저 기본 back을 존중하고 custom B는 추가하지 않음. 브라우저 제스처를 완전히 끌 수 있다고 약속하지 않는다. 앱 제어 밖 종료/이탈은 저장 보전 및 가능한 가드를 별도 검증한다.
- predictive back: 시스템 미리보기 진행/취소와 실제 이동이 한 번만 일어나야 한다. WebView 내부 화면 미리보기 신규 개발은 이번 추천 MVP 밖이며 지원된다고 표기하지 않는다.

### 4.3 공통 예외·보호

수업 대기/진행·음성 녹음·측정·통화 중, 폼 포커스/IME 조합·키보드 표시·미전송 입력·저장 안 된 편집·저장 요청 중, 모달/시트/더보기 열림, 선택된 텍스트, 가로 레일/표/차트/슬라이더 안 출발은 신규 A와 custom B를 비활성화한다. 활성 수업이 백그라운드에 남아 있어도 상태를 기준으로 차단한다. 키보드가 닫혔다고 미저장 상태를 해제하지 않는다.

이 규칙은 현재 모두 구현되어 있다는 뜻이 아니다. 기존 `useLeaveGuard`만으로 회원·편집 전체 보호를 가정하지 않는다. 버튼과 OS back도 조용히 데이터를 버리면 안 된다. 버튼은 기존 종료/저장/취소 확인 흐름을 제공하고, B 범위에서는 OS back 보호까지 확보해야 한다. 브라우저/OS가 소유한 입력은 ‘물리적으로 비활성’이 아니라 ‘가능한 가드와 보전’으로 구분한다.

## 5. 적용 / 비적용 화면

| 구분 | A | B 후보 |
|---|---|---|
| 상담사 `/dashboard`, 기관 `/dashboard/org`, 공통 `/classes`, `/reports` 또는 `/counseling`, `/chat` 목록 | 허용, 현재 표시된 탭만 | 안전한 앱 내 이력이 있을 때 OS 정책; A+B면 중앙/가장자리 분리 |
| 회원 `/app`, `/app/classes`, `/app/chat` 또는 `/app/counseling`, `/app/reports` 목록 | 허용, 연결 게이트/로딩·오류 전체 화면은 제외 | 동일 |
| 클래스·상담·세션 상세, 채팅방, 리포트 상세 | 금지 (pill 표시와 무관) | 읽기 전용·안전한 이력·금지 상태 없음에 한해 후보 |
| 회원 리포트 상세 모달, 모든 서랍·시트·대화상자 | 금지 | custom 금지. Android back은 닫기/확인 정책 우선 |
| 수업 입장/로비/진행/종료 확인, `/sessions/:id/live`, `/sessions/:id/player`, `/sessions/:id/record` | 금지 | 새 iOS 제스처 금지. OS back은 종료 확인·데이터 보전 검증 대상 |
| `/classes/new`, `/classes/now`, `/counseling/new`, 설정·프로필·회원/기관 관리, 편집 폼 | 금지 | MVP 허용 목록 밖. 명시적 버튼과 기존 보호 사용 |
| 로그인·가입·온보딩·외부 공유·공개 진입·플랫폼관리자·playground·디자인 경로 | 금지 | 이번 기능 범위 밖, 기본 OS/브라우저 동작 유지 |
| 768px 이상 | 금지 | 기본 OS/브라우저 동작 유지 |

## 6. 접근성·발견 가능성

- 모든 이동을 기존 탭 버튼/링크와 명시적 뒤로가기·목록 버튼으로 수행 가능. 스와이프 전용 정보·기능 없음. 버튼 최소 44×44px, 입력·주 CTA 48px, 설명 글자 13px 이상(기존 DESIGN.md 기준).
- VoiceOver/TalkBack의 탐색 제스처를 빼앗지 않는다. 보조기술 감지에 의존해 접근성을 보장한다고 주장하지 않으며 실제 탐색/활성화 검증 필요.
- 활성 탭 aria-current, 이동 후 새 화면 제목으로 예측 가능한 포커스 및 간결한 안내. 취소 시 포커스 이동 없음, 오버레이 포커스 트랩 유지.
- `prefers-reduced-motion: reduce`일 때 따라 움직임·슬라이드 제거, 즉시 전환과 텍스트 안내만. 확대/핀치와 세로 스크롤 유지.
- 허용된 첫 루트 방문에 “본문을 좌우로 밀어 메뉴를 이동할 수 있어요”를 닫을 수 있는 1회 안내로 제공. 가로 카드·가장자리에서 시도하도록 유도하지 않는다.

## 7. 수용 기준 (향후 구현 검증 요구, 아직 미실행)

1. 세 역할 × 상담 공개/비공개에서 표시 메뉴 순서대로 한 칸 이동한다. 더보기 자동 열림·순환·숨은 기능 진입은 0건.
2. 390px에서 중앙 수평 80px 이동은 완료, 느린 30px는 취소; 45px 빠른 동작은 속도 기준 충족 시 완료. 세로 우세·다중 터치·pointercancel은 이동 0회.
3. 첫/마지막 경계, 중복 이벤트·빠른 반복에서도 이동 1회 이하. 전환 취소 시 URL·이력·포커스 유지.
4. 모든 상세 및 회원 리포트 모달에서 A는 이동 0회. 루트 경로가 그대로여도 모달/입력 상태를 반영한다.
5. 홈 레일·차트·표·range 조작은 기존 동작 유지, 끝에서도 탭 이동 0회. 본문 세로 스크롤·핀치 확대 유지.
6. 수업·녹음·측정·저장/입력 중 신규 제스처로 이탈 0회. 명시적 버튼의 저장/종료 확인 유지.
7. A는 탭 클릭과 동일한 권한/이력 결과, back 한 번에 이전 방문 화면 하나로 복귀. 로그인·다른 역할·외부 이력으로 잘못 보내지 않는다.
8. iPhone WKWebView와 Safari, Android 앱 및 Chrome 각각에서 A 중앙 동작과 OS 가장자리 우선권 확인. 390px 외 좁은 360px 및 767/768px 경계 확인.
9. B 선택 시 iOS 이전 이력 있음/없음·앞으로가기·수업 이탈, Android 제스처/3버튼/가능한 하드웨어 back·키보드·취소·predictive back을 별도 기기 검증. 가드 우회나 이중 이동이면 B 출시 불가.
10. VoiceOver/TalkBack·키보드만으로 동등한 동작, 최소 터치 영역 및 움직임 줄이기 확인. 권한·배지·더보기·기존 탭 클릭 회귀 없음.

## 8. 범위 밖과 검증 수준

제품 코드 수정, plan/verify/summary 작성, SDD 전체 완료 처리, 앱 빌드·업로드, 서버·DB·환경 설정, PR·머지·develop push·배포는 이번 범위 밖이다. 플랫폼관리자 메뉴 확대, 탭별 독립 스택, 실데이터 선조회·햅틱, EEG/리포트 내용 변경도 제안 범위 밖이다.

프로토타입은 **확정된 A안만** 체험하는 390px 설명용 샘플이다. 역할/상담 공개 전환, 수업·입력·시트·미저장·상세 상황 토글, 레일 스크롤·선택 영역 제외, 버튼 대체 이동을 제공한다. 요구된 마우스 드래그는 데모 편의를 위한 예외이며 제품 A는 모바일 터치만 대상이다. B는 구현하지 않고 Spec 비교표에서 검토한다. 실제 native 설정·시스템 back·predictive back·API·권한·라우터·실기기 성능의 증거가 아니다. 데이터는 모두 샘플이며 실제 회원 정보·EEG 점수는 사용하지 않는다.

## 9. 릴리즈 경로 (향후 승인 시)

| 대상 | 반영 경로 | 버전·확인 요건 |
|---|---|---|
| 모바일 웹 | 승인된 제품 구현을 웹 정적 번들로 빌드·배포하면 새 웹 사용자에게 반영 | 캐시 갱신·기능 플래그 일치 확인. 이번에는 배포하지 않음 |
| iOS 앱 | `webDir: 'dist'` 번들 생성 → Capacitor sync → iOS 재빌드 → TestFlight 검증 → 승인된 스토어 버전 | 웹 배포만으로 설치 앱 JS가 바뀌지 않음. CFBundleVersion 증가, 출시 버전은 릴리즈 담당 결정 |
| Android 앱 | 같은 웹 번들을 sync → Android 재빌드 → 내부 테스트 → 승인된 Play 버전 | versionCode 증가, versionName 확정. 제스처/3버튼·SDK별 back 별도 확인 |
| B 후속 | iOS native 제스처와 가드 통합; Android back 보호/루트 복귀 보완 범위를 먼저 확정 | A+B 채택 시 조합 검증 후 앱 버전으로 함께 제공 |

근거: `frontend/capacitor.config.ts:3-13`은 로컬 dist이며 원격 `server.url` 없음. `frontend/package.json:27-52`에 OTA updater 없음(`@capgo/capacitor-social-login`은 로그인용이며 OTA가 아님). `frontend/android/app/build.gradle:9-21`은 versionCode/versionName CI 주입과 기본값 2/1.0.0, `frontend/ios/App/App.xcodeproj/project.pbxproj:326-333,351-358`도 2/1.0.0이다. 이 값은 저장소 기본값이지 현재 스토어/설치 버전이 아니다. **다음 버전 번호는 추정해 쓰지 않으며 실제 릴리즈 시 확정한다.** 앱 업데이트 전 사용자는 기존 버튼 이동을 계속 사용한다.

## 10. Brian 결정 항목 (비즈니스 관점)

1. **2026-10-24 확정:** A(주요 메뉴 좌우 탐색). “화면 스크롤처럼 작동한다”는 피드백을 반영해 1:1 추종·이웃 화면·스냅 전환형 시안으로 수정한다. B는 이번 범위에서 제외한다.
2. **첫 제공 대상:** 추천 상담사·회원·기관관리자 및 iOS·Android·모바일 웹 동시 / 일부 역할·플랫폼부터. 일부만이면 교육 안내가 달라진다.
3. **보호 우선 원칙:** 추천 수업·입력·미저장 상태에서는 제스처보다 작업 보전을 우선하고 버튼으로 명시적 이탈. 편의 때문에 보호 예외를 늘리지 않는다.

A안 방향은 확정됐으며 첫 제공 대상·보호 정책의 제품 적용 승인은 후속 단계다. 임계값·이벤트 방식·검증 방법은 기술 담당자가 책임지고 조정한다. 이번 Spec 커밋·푸시는 기획 전달이며 구현 승인으로 해석하지 않는다.

## 11. 초안 독립 검토 결과

- 유지: A/B 의미 분리, A 제한 도입 추천, 더보기 제외, 루트 허용 목록, 앱 번들 재배포 필요, 네이티브 실측과 코드 근거 구분.
- 수정: SDK 36의 Android 16 predictive back 기본 정책 명시; App 8.1.2 callback의 이력 없는 경우를 근거로 ‘루트에서 앱 복귀 보장’ 제거.
- 보강: 플랫폼관리자 현행 탭까지 기록하되 A 대상 제외; Material bottom navigation과 tabs 구분 및 관례 차이 명시; 채팅 IME·텍스트 선택·전체 가로 overflow 위치와 실제 드래그 없는 시트 구분.
- 구체화: 길게 누르기·속도 방향·샘플 최소 기간·대각 취소, 릴리즈 버전 관리, 프로토타입 실제 범위(확정 A만) 및 검증 한계.

## 12. 기획 산출물 확인 기록

### 12.1 최초 시안 (07fcd35c 기준 과거 기록)

- 제품 구현 수용 기준(§7)은 **미실행**이다. 아래 브라우저 확인은 독립 HTML에만 해당한다.
- 산출물: `designs/mobile-menu-swipe/index.html`, `designs/mobile-menu-swipe/capture.cjs`, 같은 디렉토리의 `captures/` 및 `capture-results.json`.
- 2026-10-24: Google Chrome **155.0.8059.85**, 390×844, DPR 1, 모바일/터치 에뮬레이션. 실행 파일 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, Playwright는 원본 저장소 `mindbreeze_2.0/frontend/node_modules/playwright`를 사용했다. 서버 없이 로컬 HTML을 열었다.
- 재현 명령: 저장소 루트에서 `node designs/mobile-menu-swipe/capture.cjs`.
- **43개 확인 통과, JS 실행 오류 0건.** 터치·마우스 메뉴 이동, 6개 역할/플래그 구성, 양끝 정지, 5개 비활성 상황, 가장자리·레일 제외, 세로 우세·pointercancel·길게 누르기 취소, 미전송 입력 보존, 버튼 대체 이동·확인 취소, 움직임 줄이기, 텍스트 선택을 확인했다. 빠른 45px/55ms 이동은 CDP 입력 시각을 지정한 판정 확인으로 실사용 속도 실측과 다르다.
- 가로 넘침 0px, 표시 글자 12px 이하 0개, 하단 버튼 약 68.8×52px(최소 44×44 충족). 캡처 3장을 직접 열어 선택 탭·보호 안내·레이아웃을 확인했다.
- 별도 검토자가 코드 근거·규칙을 읽기 전용으로 확인했다. 발견된 체험 패드 마우스 드래그/텍스트 선택 충돌은 **패드에만** 선택 금지를 적용해 해결했고, 검토자가 실제 마우스로 메뉴 이동 및 일반 본문 선택 유지까지 재확인했다.
- 제품 전체 테스트·iPhone/Android 실기기·VoiceOver/TalkBack·네이티브 이탈 가드·배포는 실행하지 않았다. 기획 산출물 검증을 제품 기능 완료로 해석하지 않는다.

| 캡처 | 확인 상태 |
|---|---|
| [01-member-home-390.png](../../designs/mobile-menu-swipe/captures/01-member-home-390.png) | 회원 홈, 메뉴·가로 레일·보호 토글 |
| [02-touch-next-tab-390.png](../../designs/mobile-menu-swipe/captures/02-touch-next-tab-390.png) | 실제 Chrome 터치 입력 후 내 클래스로 이동 |
| [03-protected-class-390.png](../../designs/mobile-menu-swipe/captures/03-protected-class-390.png) | 수업 중 토글 후 드래그해도 홈 유지 |

[HTML 체험 열기](../../designs/mobile-menu-swipe/index.html) · [브라우저 확인 결과](../../designs/mobile-menu-swipe/capture-results.json)


### 12.2 10/24 A안 확정·페이지 전환형 시안 검증

- 범위: 독립 HTML·캡처 스크립트·결과·본 Spec만 수정. 제품 코드·제품 SDD 단계·PR·배포는 진행하지 않는다.
- 수정 전 실제 Chrome 터치 재현: 패드 안 `(270,300) → (150,300)`에서 손가락 -120px 대비 화면 -30px. 패드 밖 `(270,200)`에서 수평 이동 시 `pointerdown → pointermove → pointercancel`, 손을 뗀 뒤에도 `/app` 유지. 컨테이너 계산 스타일은 `touch-action:auto`였다. 기존 완료 효과 역시 opacity + 16px 페이드였으므로 이웃 페이지가 들어오지 않았다.
- 회귀 검증을 수정 전에 추가해 “패드 밖 터치 120px에 화면 1:1 추종”이 실제 0px로 실패하는 것을 확인한 뒤 시안을 수정했다.
- 가로 레일의 자체 스크롤은 결함이 아니라 의도한 제외 동작이다. 메뉴 전환 영역과 구별하고 레일 끝에서도 메뉴 전환을 넘겨받지 않는다.
- 재현 명령: `node designs/mobile-menu-swipe/capture.cjs`. Chrome 155.0.8059.85, `hasTouch:true`, `isMobile:true`, 390×844. WebKit은 Playwright 실행 파일이 설치되어 있지 않아 미실행. iPhone Safari/실기기 동작 확인으로 표현하지 않는다.
- **최신 54개 확인 통과, JS 실행 오류 0건.** 실제 터치의 패드 밖 좌/우 이동·하단 강조·짧은 복귀·세로 스크롤 증가·레일 자체 스크롤·수업 중 차단과 기존 보호/역할/움직임 줄이기를 확인했다. 가로 넘침 0px, 12px 이하 표시 글자 0개, 하단 버튼 약 68.8×52px. 캡처 4장을 직접 열어 확인했다.
- 독립 검토자는 12px 미만 정지·120px 추종·이웃 화면·완료·짧은 복귀·끝 저항·레일·움직임 줄이기를 별도 Chrome 입력으로 확인했다. 검토 중 발견한 보호 확인 후 전환 취소 회귀는 실패 테스트를 추가한 뒤 dialog 닫힘/보호 갱신 완료 후 이동하도록 수정했다. 독립 재검증에서 확인 후 목적지 도착·취소·재열기 후 Escape와 실행 오류 0건을 확인했다.
- 최신 실행 결과와 확인 목록: [capture-results.json](../../designs/mobile-menu-swipe/capture-results.json). 수정 전 관찰값도 `baseline`에 기록한다. 이전 §12.1의 43개는 과거 기록이며 최신 실행과 구분한다.
- 추가 캡처: [04-mid-drag-pages-390.png](../../designs/mobile-menu-swipe/captures/04-mid-drag-pages-390.png) — 손가락 120px 이동 중 홈과 내 클래스가 함께 보이는 상태. 기존 01~03 캡처도 갱신한다.
