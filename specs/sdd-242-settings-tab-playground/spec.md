# SDD-242 — 하단 메뉴 더보기를 설정으로 변경·링크밴드 플레이그라운드 진입

- 상태: Brian 2026-10-24 승인에 따라 Stage ⑥ 구현·검증 정리 완료, Stage ⑦ 최종 리뷰 대기. 구현 결과는 `summary.md`, 사전 검증은 `verify.md` 참조.
- 브랜치: `sdd/242-settings-tab-playground` / 작성일: 2026-10-24
- 조사 기준: 이 워크트리의 소스. 실서비스·서버·DB·환경변수·실제 사용자 데이터 조회 없음.
- 산출물: 이 문서, `designs/settings-tab-playground/index.html`, 같은 폴더의 조사 데이터·Playwright 캡처 및 검증 기록.
- 현재 범위: 승인된 프론트 구현·테스트·제품 화면 캡처·작업 브랜치 push·develop 대상 PR. 아래 §1~8의 조사·시안 기록은 작성 당시 기준을 보존한다. 백엔드 변경·PR 머지·배포 없음.

## 1. 배경과 목표

‘더보기’는 무엇이 있는지 예측하기 어렵고, 설정에는 사용자가 드물게 바꾸는 개인·전문 정보와 94개의 알림 토글이 함께 펼쳐진다. 하단 마지막 탭을 톱니바퀴 ‘설정’으로 바꾸고, 설정 첫 카드에서 LINK BAND 체험을 발견하도록 한다. 주요 업무 진입점과 동의·철회·삭제·로그아웃은 보존한다.

사용자가 요청한 개인정보 동의·연구 동의 철회·계정 삭제·알림 수신 선택·로그아웃은 필수 보존 대상으로 취급한다. 이 문서는 개별 항목의 법적 의무를 판정하는 법률 검토가 아니다. 저강조는 읽기 어려운 저대비·작은 글자·다단계 은닉을 뜻하지 않는다.

## 2. 현황 조사와 코드 근거

### 2.1 메뉴와 라우트

- 실제 더보기는 별도 목록이 아니라 `frontend/src/components/layout/MobileDrawer.tsx:42`의 `SidebarNav` 전체 메뉴 서랍이다. 상단 햄버거는 `AppShell.tsx:109`, `components/client/ClientShell.tsx:132`에 이미 있다.
- `frontend/src/components/layout/floating-bottom-nav.tsx:12-22`는 앞 네 탭 외 모든 경로를 더보기 활성으로 처리한다. 마지막 버튼의 텍스트는 더보기이고 `ICONS.menu`를 쓴다. 현 아이콘 path는 SidebarNav의 세 줄 메뉴이며, 요구에서 표현한 ‘…’와 실제 아이콘 차이도 구현 때 확인한다. 시안의 전/후는 요구의 ‘… 더보기’ 표기를 사용한다.
- SDD-233 B안: `floating-bottom-nav.css:2-6` 어두운 pill(#201427), 높이66, 아이콘 아래 라벨. SDD-234 모바일 글자 확대 규칙(:12-14) 유지.
- 회원 정규 설정: `frontend/src/pages/client/ClientAppPage.tsx:326-342`의 `/app/profile` → `ClientSettingsPage`. 공통 `/settings`는 `App.tsx:324`에서 로그인 가드만 적용되어 회원 직접 접근도 가능하다. 서로 다른 두 화면을 한 화면으로 오인하지 않는다.
- 상담사·기관·플랫폼 `/settings`: `SettingsPage.tsx:245-267`에 역할/프로필 조건, :289-305에 email/in_app 전체 키 렌더링. 정상 회원 `/app/profile`에는 WebPushCard·메일·인앱 설정이 없다(`ClientSettingsPage.tsx:146-168`).

### 2.2 역할별 하단 탭과 SDD-240 정합

| 역할 | 현재 앞 4개 (상담 비공개) | 상담 공개 시 | 제안 5번째 |
|---|---|---|---|
| 회원 | 홈 `/app`, 내 클래스 `/app/classes`, 대화 `/app/chat`, 리포트 `/app/reports` | 3번째가 상담 `/app/counseling` | 설정 `/app/profile` |
| 상담사 | 홈 `/dashboard`, 클래스 `/classes`, 리포트 `/reports`, 대화 `/chat` | 3번째가 상담 `/counseling` | 설정 `/settings` |
| 기관관리자 | 홈 `/dashboard/org`, 클래스 `/classes`, 리포트 `/reports`, 대화 `/chat` | 3번째가 상담 `/counseling` | 설정 `/settings` |
| 플랫폼관리자 | 홈 `/admin/orgs`, 가입 신청 `/admin/applications`, 사용자 `/admin/users`, 대화 `/chat` | 변화 없음 | 설정 `/settings` |

근거: `frontend/src/lib/mobile-menu-swipe.ts:7-24`, `components/layout/BottomTabBar.tsx:21-29`, `components/client/BottomTabBar.tsx:10-20`, `specs/sdd-240-mobile-menu-swipe/spec.md:47-63`.

권장: 회원·상담사·기관관리자 공유 탭 정의에 설정 라우트를 추가해 **5개 탭을 터치/스와이프 공통 순서**로 쓴다. 플랫폼 스와이프 제외는 유지한다. 루트 정확 일치, 폼·모달·가로 스크롤 보호, reduced motion, 끝 경계 저항을 유지한다. 설정 내부 펼친 폼에서의 입력 보호도 검증한다. `/playground`, 프로필 편집, 상세 화면을 스와이프 루트에 넣지 않는다. 미매칭 업무 경로를 설정 활성으로 칠하지 않는다. 플레이그라운드에서 돌아가기는 회원 `/app/profile`, 나머지 `/settings`.

### 2.3 더보기 항목 전수 재배치

아래 ‘전체 메뉴’는 기존 상단 ☰로 여는 서랍이다. 업무 링크는 설정으로 복제하지 않는다. 기존 데스크톱 사이드바 항목도 유지한다. A=회원, C=상담사, O=기관관리자, P=플랫폼관리자.

| 기존 항목 | 역할 | 기존 경로 | 새 위치 / 소실 방지 |
|---|---|---|---|
| 홈 / 기관 대시보드 | A/C/O | `/app`, `/dashboard`, `/dashboard/org` | 앞 4개 탭 + 전체 메뉴 유지 |
| 내 클래스 / 명상 클래스 | A/C/O | `/app/classes`, `/classes` | 앞 4개 탭 + 전체 메뉴 유지 |
| 회원 | C/O | `/clients` | 전체 메뉴 유지 |
| 내 상담 / 상담 | A/C/O | `/app/counseling`, `/counseling` | 상담 공개 시 3번째 + 전체 메뉴, feature flag 보존 |
| 채팅 | 전체 | `/app/chat`(A), `/chat` | 전체 메뉴 유지. A 상담 공개 시 pill 밖으로 밀려도 여기서 진입 |
| 리포트 | A/C/O | `/app/reports`, `/reports` | 전체 메뉴 유지. C/O 상담 공개 시에도 여기서 진입 |
| 구성원 | O | `/org/counselors` | 전체 메뉴 유지 + 내 계정의 기관 구성원 관리 링크 |
| 플레이그라운드 | C/P 기존, A/O 신규 발견 경로 | `/playground` | 설정 상단 카드(4역할), C/P 기존 전체 메뉴도 유지 |
| 알림 | 전체 | `/app/notifications`(A), `/notifications` | 상단 종 + 전체 메뉴 |
| 설정 | 전체 | `/app/profile`(A), `/settings` | 5번째 탭 + 전체 메뉴 |
| 기관 관리 | P | `/admin/orgs` | 홈 탭 + 전체 메뉴 |
| 가입 신청 | P | `/admin/applications` | 2번째 탭 + 전체 메뉴 |
| 상담사 관리 | P | `/admin/users` | 3번째 ‘사용자’ 탭 + 전체 메뉴 ‘상담사 관리’, 현 라벨 차이 기록 |
| 회원 관리 | P | `/admin/clients` | 전체 메뉴 유지 |
| 계정 이름·이메일 | 전체 | 서랍 푸터 | 전체 메뉴 표시 유지, 설정 내 계정에 한 번만 요약 |
| 로그아웃 | 전체 | 서랍 액션 / A 설정 액션 | 서랍 유지 + 설정 하단 저강조 버튼 |
| 서버 연결 상태 | 전체 | 서랍 상태 표시 | 서랍 유지 + 앱 정보의 상태 조회(설정 토글 아님) |

전체 목록 근거: `frontend/src/components/layout/SidebarNav.tsx:98-142,205-214,309-336`, 실제 라벨 `frontend/src/lib/terms.ts:37-58`. 현재 더보기 배지는 초대 + 상담 공개 때 밀려난 대화(A)/리포트(C/O)의 합계이다. **합산 배지를 설정으로 옮기지 않는다.** 초대=알림 종·알림 목록, 대화=대화 메뉴, 리포트=리포트 메뉴로 보존한다. 상단 전체 메뉴에도 숨은 업무의 미확인 합계를 표시하는 방안을 후속 구현에서 검증한다(중복 숫자 합산 금지).

### 2.4 플레이그라운드 권한·패널 전수

`App.tsx:325`는 `<RoleGuard>`만 사용하며 `components/auth/RoleGuard.tsx:15-39`는 역할 인자가 있을 때만 제한한다. 현재도 로그인한 4역할 모두 `/playground` URL 접근 가능하다. 발견 경로는 상담사·플랫폼 사이드바만(`SidebarNav.tsx:105,141`). **4역할 카드 노출을 권장**한다. 권한 확대가 아닌 기존 허용 기능 발견성 개선이다.

| 기능 | `frontend/src/pages/playground/PlaygroundPage.tsx` 근거 | 보존 조건 |
|---|---|---|
| 연결·예시 체험 | :42-46,144-146 | observationOnly=true, participantId=null. 예시 표시·실제 측정 구분 |
| 측정 방법 안내 | :145 | `/measurement-guide` 유지 |
| CalibrationPanel | :148 | DEV만, 현재는 관리자 전용 아님 |
| NormalizationPanel | :41,150-158 | **DEV && platform_admin** 유지 |
| EEG 파형 / Spectrum | :160-171 | 전 역할, 연결 가드 유지 |
| PPG / ACC | :173-183 | 전 역할, 연결 가드 유지 |
| Metrics / Trend | :185-203 | 전 역할, 참고 지표·변화 표시. 종합 웰니스 점수 신설 금지 |
| PlaygroundMeditationSimulator | :205 | 전 역할, 선택적 밴드 사용 유지 |
| DebugPanel | :207 | DEV만 유지 |
| 활성 모델 설명 | :129-140 | DEV && 비플랫폼 사용자 현재 조건 유지 |

`backend/app/api/v1/normalization.py:54-58`의 관리자 dependency는 UI와 별도로 유지한다. 활성 모델 공개 읽기 router(:61-63)와 관리 API를 혼동하지 않는다. `ConnectionPanel.tsx:44-65,79-103`의 미지원 브라우저 안내, 관찰 기록 저장 안 함, 체험·연결·해제·초기화 흐름을 보존한다. 현 AppShell 기반 플레이그라운드는 회원 셸과 다르므로 회원 메뉴·종 경로 및 돌아가기 정합을 후속 검증한다.

## 3. 설정 항목 전수표와 판정

### 3.1 집계 기준

‘설정 개수’는 **설정 영역 안에서 독립 변경 가능한 최상위 필드/제어** 기준이다. 자격·경력은 반복 컬렉션 각각 1개, 조회값·링크·삭제·로그아웃 명령은 제외하여 별도 표로 남긴다. 제안은 기본 정보4 + 목적별 알림6 + 기기알림1 + 선택동의2 =13, 플랫폼은 기본정보 수정 권한을 추가하지 않아9. 전문·참여 프로필은 별도 업무 화면으로 이동하며 필드가 삭제되는 것이 아니다. 첫 화면은 모든 역할 5개 접힌 그룹 + 플레이그라운드 카드이고, 13/9개 제어는 상세를 펼치거나 이동했을 때 보인다.

| 역할 | 현재 → 제안 | 현재 산식 | 변화 의미 |
|---|---|---|---|
| 회원 | **10 → 13** | 기본4+참여프로필4+동의2 | 참여프로필4 이동, 없던 알림6+기기권한1 추가. 숫자 증가는 누락된 수신 선택 복구 |
| 상담사 | **112 → 13** | 기본4+개인5+전문5+알림94+기기1+진행안내1+동의2 | 프로필10/진행안내1 업무 화면 이동, 알림94→6 |
| 순수 기관관리자 | **102 → 13** | 기본4+알림94+기기1+진행안내1+동의2 | 업무 설정 이동·알림 통합 |
| 상담사 프로필 보유 기관관리자 | **112 → 13** | 상담사와 동일 | 전문 프로필 진입권 유지 |
| 플랫폼관리자 | **97 → 9** | 알림94+기기1+동의2 | 기본 정보 읽기 전용 유지 |

기기 알림은 환경별 비활성일 수 있어 표시 가능한 제어 1개로 센다. 기관 프로필 조회 실패 폴백은 기본2만 수정하여 현재100개이며 정상102개와 구분한다. 회원의 비정규 `/settings` 직접 접근과 레거시 알림 키는 위 정상 경로 개수에 섞지 않는다. 현재 API 응답은 저장된 추가 키도 합치므로 사용자별 실제 항목 수는 기준보다 늘 수 있다. 실사용 로그를 조회하지 않았으므로 **사용 빈도는 전부 추정**이다. 이벤트 수신 빈도와 설정 변경 빈도는 다르다.

### 3.2 계정·개인·전문 정보

F=`frontend/src/components/settings/`. A/C/O/P는 §2.3과 동일. ‘O*’는 상담사 프로필을 보유한 기관관리자. 모든 행의 빈도 추정은 낮음(가입 또는 정보 변경 시)이다. 다른 화면 이동은 접근 링크를 남기고 원래 API/권한/저장값을 보존한다.

| 항목 | 역할 | 파일:행 | 빈도 추정 | 백엔드 필드 | 판정 · 근거/목적지 |
|---|---|---|---|---|---|
| 이름 | A/C/O | F/ClientAccountSection.tsx:105, AccountSection.tsx:105 | 낮음 | users.name | 유지 · 내 계정 기본 정보 |
| 전화번호 | A/C/O | 위 두 파일:120 | 낮음 | users.phone | 유지 · 연락처 변경 |
| 사진 URL | A/C/O | 위 두 파일:130 | 낮음 | users.profile_image | 유지 · 내 계정 상세, 첫 화면 직접 입력 제거 |
| 소개글 | A/C/O | 위 두 파일:140 | 낮음 | users.bio | 유지 · 내 계정 상세 |
| 성별 | A | F/ClientProfileSection.tsx:124 | 낮음 | client_profiles.gender | 다른 화면 이동 · 참여 프로필, 선택 입력 |
| 생년월일 | A | 위 파일:139 | 낮음 | client_profiles.birth_date, users.birth_date 동기 | 다른 화면 이동 · 참여 프로필, 기존 정보 보존 |
| 고민 분야 | A | 위 파일:149 | 낮음 | client_profiles.concerns | 다른 화면 이동 · 참여 프로필, 빈 배열 허용 |
| 관심 분야 | A | 위 파일:159 | 낮음 | client_profiles.interests | 다른 화면 이동 · 참여 프로필 |
| 성별 | C/O* | F/PersonalInfoSection.tsx:116 | 낮음 | counselor_profiles.gender | 다른 화면 이동 · 전문 프로필의 비공개 개인정보 |
| 생년월일 | C/O* | 위 파일:130 | 낮음 | counselor_profiles.birth_date | 다른 화면 이동 · 전문 프로필의 비공개 개인정보 |
| 우편번호 | C/O* | 위 파일:142 | 낮음 | counselor_profiles.postal_code | 다른 화면 이동 · 개인정보 상세, 선택 null 유지 |
| 주소 | C/O* | 위 파일:152 | 낮음 | counselor_profiles.address_line1 | 다른 화면 이동 · 개인정보 상세, 선택 null 유지 |
| 상세주소 | C/O* | 위 파일:163 | 낮음 | counselor_profiles.address_line2 | 다른 화면 이동 · 개인정보 상세, 기존 편집권 보존 |
| 소속센터 | C/O* | F/ProfileSection.tsx:156 | 낮음 | counselor_profiles.affiliation_type | 다른 화면 이동 · 전문 프로필. 실제 기관 멤버십 변경과 구분 |
| 전문분야 | C/O* | 위 파일:165 | 낮음 | counselor_profiles.specialties | 다른 화면 이동 · 전문 프로필 |
| 경력연수 | C/O* | 위 파일:175 | 낮음 | counselor_profiles.years_of_experience | 다른 화면 이동 · 전문 프로필 |
| 자격정보 | C/O* | 위 파일:204,220,228 | 낮음 | counselor_profiles.qualifications[{name,issuer,issued_at}] | 다른 화면 이동 · 전문 프로필, 기존 자격 검증 `/credentials`와 별도 |
| 이력정보 | C/O* | 위 파일:258,274,283,290,299 | 낮음 | counselor_profiles.careers[{organization,role,started_at,ended_at,is_current}] | 다른 화면 이동 · 전문 프로필 |

사진·소개 읽기는 users 값 우선, legacy profile 값 fallback(`backend/app/services/counselor_info_service.py:103-104`, `backend/app/api/v1/auth.py:1254-1255`). 회원 생일 동기는 auth.py:1297-1302. 기관 조건 `SettingsPage.tsx:245-257`; 폴백 :78-81,267 및 `SelfInfoSection`의 이름·전화 유지. 개인정보를 임의 기본값으로 채우거나 전문 프로필로 옮겼다는 이유로 공개하지 않는다. 주소 등 실제 사용성이 불명확한 값은 이번에 삭제하지 않고 필요 시 별도 정책으로 판단한다.

### 3.3 알림 항목 47종 전수 (각 행 이메일·인앱 2개)

현재 C/O/P는 모든 행 노출, A 정규 설정은 모두 미노출. 아래 한 행은 **독립된 email/in_app 두 설정**을 빠짐없이 나타낸다. `N=frontend/src/lib/notification-format.ts`, UI 근거 `SettingsPage.tsx:289-305`, 기본 정의 `backend/app/models/user.py:11-106`, 저장 필드 `users.notification_preferences.{email|in_app}.<event>`(user.py:128).

모든 행의 판정은 **유지(목적별 그룹 제어로 통합)**다. 단순 숨김/일괄 기본값 고정이 아니다. 3그룹×2채널로 6개 선택만 제공한다. 표의 역할은 ‘현재 표시 역할’이며 수신 대상 역할의 증명이 아니다. 실제 알림 수신자 조건과 접근권은 기존 발송 로직을 유지한다. 그룹 라벨·설명은 역할에 맞게 예시를 다르게 보여도 아래 이벤트 매핑은 공통으로 유지한다.

| 항목 | 역할 | 파일:행 | 빈도 추정 | 백엔드 필드의 event 키 | 기본 이메일/인앱 | 판정 · 제안 그룹 |
|---|---|---|---|---|---|---|
| 세션 예약 | C/O/P | N:33 | 낮음(최초·불편 시) | `session_booked` | ON/ON | 유지 · 일정·참여 |
| 세션 변경 | C/O/P | N:34 | 낮음(최초·불편 시) | `session_updated` | ON/ON | 유지 · 일정·참여 |
| 세션 취소 | C/O/P | N:35 | 낮음(최초·불편 시) | `session_cancelled` | ON/ON | 유지 · 일정·참여 |
| 세션 초대 | C/O/P | N:40 | 낮음(최초·불편 시) | `session_invited` | ON/ON | 유지 · 일정·참여 |
| 검증 결과 | C/O/P | N:56 | 낮음(최초·불편 시) | `verification_result` | ON/ON | 유지 · 리포트·운영 |
| 기관 검증 결과 | C/O/P | N:57 | 낮음(최초·불편 시) | `organization_verification_result` | ON/ON | 유지 · 리포트·운영 |
| 검증 요청 | C/O/P | N:58 | 낮음(최초·불편 시) | `verification_requested` | ON/ON | 유지 · 리포트·운영 |
| 기관 가입 결과 | C/O/P | N:61 | 낮음(최초·불편 시) | `organization_join_result` | ON/ON | 유지 · 리포트·운영 |
| 기관 제외 | C/O/P | N:66 | 낮음(최초·불편 시) | `organization_removed` | ON/ON | 유지 · 리포트·운영 |
| 계정 정지 | C/O/P | N:70 | 낮음(최초·불편 시) | `account_suspended` | ON/ON | 유지 · 리포트·운영 |
| 계정 재활성화 | C/O/P | N:71 | 낮음(최초·불편 시) | `account_reactivated` | ON/ON | 유지 · 리포트·운영 |
| 세션 준비 완료 | C/O/P | N:36 | 낮음(최초·불편 시) | `session_ready` | OFF/ON | 유지 · 일정·참여 |
| 세션 오픈 | C/O/P | N:37 | 낮음(최초·불편 시) | `session_opened` | OFF/ON | 유지 · 일정·참여 |
| 세션 진행 시작 | C/O/P | N:38 | 낮음(최초·불편 시) | `session_started` | OFF/ON | 유지 · 일정·참여 |
| 세션 완료 | C/O/P | N:39 | 낮음(최초·불편 시) | `session_completed` | OFF/ON | 유지 · 일정·참여 |
| 대기자 승격 | C/O/P | N:41 | 낮음(최초·불편 시) | `session_waitlist_promoted` | OFF/ON | 유지 · 일정·참여 |
| 참여자 제외 | C/O/P | N:42 | 낮음(최초·불편 시) | `session_participant_removed` | OFF/ON | 유지 · 일정·참여 |
| 세션 삭제 | C/O/P | N:43 | 낮음(최초·불편 시) | `session_deleted` | OFF/ON | 유지 · 일정·참여 |
| 채팅 메시지 | C/O/P | N:45 | 낮음(최초·불편 시) | `chat_message` | OFF/ON | 유지 · 대화 |
| 채팅방 개설 | C/O/P | N:46 | 낮음(최초·불편 시) | `chat_room_created` | OFF/ON | 유지 · 대화 |
| 채팅방 초대 | C/O/P | N:47 | 낮음(최초·불편 시) | `chat_room_invited` | OFF/ON | 유지 · 대화 |
| 채팅방 제외 | C/O/P | N:48 | 낮음(최초·불편 시) | `chat_room_removed` | OFF/ON | 유지 · 대화 |
| 리포트 검토 요청 | C/O/P | N:50 | 낮음(최초·불편 시) | `report_review_requested` | OFF/ON | 유지 · 리포트·운영 |
| 리포트 발행 | C/O/P | N:51 | 낮음(최초·불편 시) | `report_ready` | ON/ON | 유지 · 리포트·운영 |
| 리포트 생성 실패 | C/O/P | N:52 | 낮음(최초·불편 시) | `report_generation_failed` | OFF/ON | 유지 · 리포트·운영 |
| 리포트 신뢰도 낮음 | C/O/P | N:53 | 낮음(최초·불편 시) | `report_low_confidence` | OFF/ON | 유지 · 리포트·운영 |
| 리포트 메일 발송 실패 | C/O/P | N:54 | 낮음(최초·불편 시) | `report_email_failed` | OFF/ON | 유지 · 리포트·운영 |
| 기관 가입 신청 | C/O/P | N:60 | 낮음(최초·불편 시) | `organization_join_requested` | OFF/ON | 유지 · 리포트·운영 |
| 기관 정보 변경 | C/O/P | N:62 | 낮음(최초·불편 시) | `organization_updated` | OFF/ON | 유지 · 리포트·운영 |
| 기관 비활성화 | C/O/P | N:63 | 낮음(최초·불편 시) | `organization_deactivated` | OFF/ON | 유지 · 리포트·운영 |
| 기관 재활성화 | C/O/P | N:64 | 낮음(최초·불편 시) | `organization_reactivated` | OFF/ON | 유지 · 리포트·운영 |
| 기관 역할 변경 | C/O/P | N:65 | 낮음(최초·불편 시) | `organization_role_changed` | OFF/ON | 유지 · 리포트·운영 |
| 상담사 프로필 변경 | C/O/P | N:68 | 낮음(최초·불편 시) | `counselor_profile_updated` | OFF/ON | 유지 · 리포트·운영 |
| 대표 관리자 프로필 변경 | C/O/P | N:69 | 낮음(최초·불편 시) | `primary_admin_profile_updated` | OFF/ON | 유지 · 리포트·운영 |
| 개인상담소 개설 | C/O/P | N:72 | 낮음(최초·불편 시) | `personal_office_opened` | OFF/ON | 유지 · 리포트·운영 |
| 클래스 초대 | C/O/P | N:20 | 낮음(최초·불편 시) | `class_invited` | OFF/ON | 유지 · 일정·참여 |
| 클래스 가입 | C/O/P | N:21 | 낮음(최초·불편 시) | `class_member_joined` | OFF/ON | 유지 · 일정·참여 |
| 클래스 회차 추가 | C/O/P | N:22 | 낮음(최초·불편 시) | `class_session_added` | OFF/ON | 유지 · 일정·참여 |
| 클래스 마무리 | C/O/P | N:23 | 낮음(최초·불편 시) | `class_completed` | OFF/ON | 유지 · 일정·참여 |
| 클래스 취소 | C/O/P | N:24 | 낮음(최초·불편 시) | `class_cancelled` | OFF/ON | 유지 · 일정·참여 |
| 진행자 배정 | C/O/P | N:25 | 낮음(최초·불편 시) | `session_host_assigned` | OFF/ON | 유지 · 일정·참여 |
| 진행자 변경 요청 | C/O/P | N:26 | 낮음(최초·불편 시) | `session_host_change_requested` | OFF/ON | 유지 · 일정·참여 |
| 진행자 변경 요청 결과 | C/O/P | N:27 | 낮음(최초·불편 시) | `session_host_change_resolved` | OFF/ON | 유지 · 일정·참여 |
| 진행자 양도 요청 | C/O/P | N:28 | 낮음(최초·불편 시) | `session_host_transfer_requested` | OFF/ON | 유지 · 일정·참여 |
| 진행자 변경 | C/O/P | N:29 | 낮음(최초·불편 시) | `session_host_changed` | OFF/ON | 유지 · 일정·참여 |
| 진행자 해제 | C/O/P | N:30 | 낮음(최초·불편 시) | `session_host_released` | OFF/ON | 유지 · 일정·참여 |
| 진행자 배정 필요 | C/O/P | N:31 | 낮음(최초·불편 시) | `session_host_needed` | OFF/ON | 유지 · 일정·참여 |

알림 통합 적용 규칙:

1. `session_*`, `class_*` → 일정·참여, `chat_*` → 대화, 나머지 표 항목 → 리포트·운영. 상담사는 검토·진행자 예시, 회원은 초대·발행 예시, 기관은 소속·운영 예시, 플랫폼은 관리 결과 예시를 설명에 쓴다. 이벤트를 새 역할에 발송하는 변경이 아니다.
2. 기존 true/false가 섞인 그룹은 **일부 켜짐**으로 표시하며 화면 진입만으로 PATCH하지 않는다. 신규 계정도 현재 이벤트별 기본을 유지(이메일 ON12/OFF35, 인앱 ON47), 일괄 ON 전환 금지.
3. 사용자가 그룹을 명시 변경하면 적용되는 이벤트 목록과 채널을 보여준 뒤 해당 키만 묶어 PATCH. 일부 켜짐은 조회 상태이지 신규 저장값이 아니다. 오류 시 전체 응답/이전 상태로 복구. 사용자별 기존 수신 거부를 무동의 재구독하지 않는다.
4. 역할 전환·상담 비공개·AI 비공개만으로 설정값을 덮어쓰지 않는다. 수신 대상/기능 게이트는 발송 측 기존 정책을 유지한다. 이 화면이 모든 역할에게 모든 이벤트를 보내는 권한을 만들지 않는다.
5. `notification_service.py:127-139,460-465`의 기존 키 병합·미제출 키 보존 계약 유지. 표 외 legacy/미래 키는 알려진 그룹에 임의 넣어 수정하지 않고 보존한다. API에 실제 나타나는 미분류 키는 구현 게이트에서 확인하여 매핑을 추가한다. `schedule_change_request`, `agent_message`, `risk_signal`은 서비스 카탈로그에는 있지만 기본47종에는 없다(`notification_service.py:76-84`). 해당 키가 사용자 설정에 있으면 별도 호환 상세로 접근을 유지하며 위 기준 개수와 구분한다.
6. push 이벤트 맵(user.py:91-96)은 현재 상세 설정 UI에 없고 위94에 포함하지 않는다. WebPushCard는 **기기 권한·구독 제어**이며 email/in_app 묶음과 별개. 마케팅 수신 동의 필드는 현재 설정 소스에서 확인되지 않았으므로 임의 신설·기본 동의하지 않는다. 기존 서비스 알림 수신 선택을 보존한다.

### 3.4 동의·권한·업무 설정 및 표시/명령 전체

| 항목 | 역할 | 파일:행 | 빈도 추정 | 백엔드 필드/동작 | 판정 · 이유/목적지 |
|---|---|---|---|---|---|
| 브라우저/앱 알림 허용·해제 | 현재 C/O/P, 제안 전체 | F/WebPushCard.tsx:36-39,83-105 | 낮음(기기별 초기) | 브라우저 permission/subscription, native device_tokens; users 토글 아님 | 유지 · 알림 상세; 회원에도 진입 제공. OS 차단이면 안내만 |
| 진행 기록 안내 | C/O | F/session-note-prompt-toggle.tsx:23-29; SettingsPage.tsx:312 | 낮음 | users.show_session_note_prompt=true | 다른 화면 이동 · `/reports`의 ‘운영 설정’ 상세(신규 UI), 설정에 업무 링크 유지 |
| 자동 승인 | C/O 인접 화면 | pages/reports/ReportListPage.tsx:322-345; backend/app/api/v1/reports.py:44-59 | 낮음(운영 정책 변경) | users.auto_approve_report=false | 유지 · 리포트 화면. 설정에 중복 스위치 신설하지 않음 |
| 뇌파 수집 동의 | 전체 | F/privacy-consents.tsx:11,49-85 | 낮음(동의 변경) | consents[type=eeg].agreed; 기본false | 유지 · 개인정보·약관 상세 |
| 비식별 연구 동의·철회 | 전체 | 위 파일:12,49-85 | 낮음 | consents[type=research].agreed/withdrawn_at; 기본false | 유지 · 개인정보·약관 상세, 철회 요청 흐름 보존 |
| 필수 개인정보·약관 동의 내역 | 현재 독립 설정 UI 없음 | 위 파일:1,11-12; lib/api/account.ts | 낮음(확인) | consents[type=tos/privacy/sensitive] | 유지 · 기존 동의 데이터 조회 진입 추가 제안; 미지원 조회 API는 구현 전 확인 |
| 계정 삭제 | 전체 | F/account-deletion.tsx:97-105 | 낮음 | users.deleted_at/purge_after, 본인 재인증 | 유지 · 개인정보 그룹 펼치기→삭제 안내 2탭 이내 |
| 로그아웃 | A 설정, 전체 서랍 | pages/settings/ClientSettingsPage.tsx:151-159; layout/SidebarNav.tsx:324-325 | 중간(공유기기) | auth 세션 종료 | 유지 · 설정 하단 저강조, 서랍도 유지 |
| 이름·이메일·역할 중복 요약 | 전체 | pages/SettingsPage.tsx:184-205; ClientSettingsPage.tsx:117-140 | 낮음(조회) | users, 이메일 불변 | 제거 · **중복 카드만** 없애고 내 계정 헤더에 한 번 표시 |
| 초대 코드·복사 | C | pages/SettingsPage.tsx:207-238 | 중간(회원 초대) | counselor_profiles.counselor_code | 다른 화면 이동 · 기존 `/clients/invite`에 코드 복사 배치, 회원 목록에서 진입 |
| 개인정보 처리방침 | 전체 | SettingsPage.tsx:318; ClientSettingsPage.tsx:167 | 낮음 | 정적 정책 링크 | 유지 · 개인정보·약관; 실제 링크 보존 |
| 외부 AI 전송 안내 | C/O | F/session-note-prompt-toggle.tsx:29 | 낮음(확인) | 저장 필드 없음 | 다른 화면 이동 · 개인정보 설명 + AI 사용/운영 설정 맥락에 재노출 |
| 앱명·회사 | 전체 | SettingsPage.tsx:319; ClientSettingsPage.tsx:168 | 낮음 | 정적 정보 | 유지 · 앱 정보/하단 |
| 서버 연결 상태 | 전체 서랍 | layout/SidebarNav.tsx:331-336 | 낮음(장애 확인) | 상태 조회, 저장 없음 | 유지 · 앱 정보 진단 + 기존 서랍 |

판정 요약: 사용자 선택권이 있는 값의 삭제·강제 기본값 고정은 **0개**. 제거 대상은 중복 요약 UI뿐이다. 운영·프로필 정보는 적절한 화면으로 이동하고, 이벤트 토글은 6개 묶음 제어로 축약한다. 기존 값의 강제 초기화로 화면을 정리하지 않는다.

### 3.5 SDD-237과의 정합

- 현재 진행 기록 안내는 구현됨. 지금의 ‘모든 회차에서 안내 끄기’ 역방향 토글을 ‘진행 기록 안내 받기’로 긍정 문구화하고 true=안내 켜짐을 일치시킨다. 위치는 리포트의 운영 설정 상세, 설정에 링크 유지. 기존 기록·승인 정책과 독립(`backend/app/api/v1/account.py:195`).
- 현재 자동 승인은 `/reports`의 단일 `auto_approve_report` 제어다. API는 C/O를 허용하지만 서비스는 `host.role == counselor` 조건도 확인한다(`backend/app/services/report_service.py:1000-1005`). 순수 기관관리자에게 실제 효과가 없는 자동 승인 스위치를 새 설정에서 유효한 것처럼 안내하지 않는다. 기존 리포트 링크는 보존하고 기관 효과/대상 조건을 구현 전 확정한다.
- 현재 무측정·기록 없는 명상 자동 승인 제외 근거는 `report_service.py:504-505,1013-1016`. 모든 도메인의 새 C안 전체 구현과 동일하지 않다.
- `specs/sdd-237-class-end-host-flow/auto-approve-policy.md:9-13,96-104`는 **채택된 후속 설계**: 상담/명상 분리, 기본 수동, 유예 기본0·선택0/5/10/30분, 비공개 메모 초안 제외, 무데이터 제외, 미래 회차 적용. 본 워크트리의 현재 단일 bool UI와 구분한다.
- 본 시안은 새 자동 승인 스위치를 구현 완료처럼 보여주지 않는다. C안 구현 시 리포트 운영 설정을 단일 편집 위치로 삼고, SDD-237 문서의 ‘설정 화면’과 이 IA의 위치 변경을 함께 정합화한다. 0분에는 보류 버튼을 만들지 않고 >0일 때만 기한/보류를 노출하는 기존 결정은 변경하지 않는다.

## 4. 새 정보 구조와 역할 차이

설정 첫 화면: 제목 → **LINK BAND 플레이그라운드 카드** → 5개 접힌 그룹 → 역할별 업무 설정 링크(C/O만) → 로그아웃/앱명.

| 그룹 | 공통 내용 | 역할 차이 |
|---|---|---|
| 내 계정 | 이름·이메일·역할 요약, 기본 정보4 편집 | P는 조회 전용. A 참여 프로필 링크. C 전문 프로필 링크. O 기관 구성원 링크 + 상담사 프로필 보유 시 본인 전문 프로필 링크 |
| 알림 | 3목적×이메일/인앱, 기기 알림 | A에도 수신 선택 진입 복구. 설명 예시는 역할별. 발송 권한 불변 |
| 기기 · LINK BAND | 연결·측정 방법, 체험 다시 열기 | 4역할 동일. 밴드 미착용 정상 이용 |
| 개인정보 · 약관 | 필수 동의 내역, 선택동의2, 철회, 정책·약관, 계정 삭제 | 4역할 동일. 실제 권한·삭제 제한·재인증 유지 |
| 앱 정보 | 앱/버전·도움말·연결 상태 | 사용자 조절 토글 없음. 진단은 조회 중심 |

**신규 화면과 기존 경로 구분**:
- `/app/profile`은 회원 설정 경로로 유지. 회원이 `/settings` 직접 진입하면 정규 경로로 normalize하는 방향을 후속 구현에서 검증(로그인·돌아가기 보존).
- `/app/participation-profile`은 **제안 신규 경로**다. 내 계정에서 진입하며 선택 프로필4를 편집한다. `/app/profile` 기존 링크를 끊지 않는다.
- `/profile/professional`은 **제안 신규 경로**다. C/O*만 본인 개인5·전문5를 편집, 기존 API/검증·비공개성 유지. 공개 프로필 화면을 뜻하지 않는다. 기관관리자의 타인 개인정보 편집 권한은 기존 `/org/counselors`에서 유지.
- `/reports`는 기존 경로이고 ‘운영 설정’ 상세 패널은 **신규 UI 제안**이다. 진행 기록 안내와 자동 승인으로 연결한다. 역할 가드는 기존 API와 일치시킨다.
- `/clients/invite`, `/org/counselors`, `/credentials`, `/playground`, `/measurement-guide`는 기존 경로. 초대 코드 복사 UI의 이동은 후속 구현 대상.
- 약관 공개 URL·도움말 목적지는 현재 소스의 연결 계약을 후속 Plan에서 확인한다. 시안의 해당 버튼은 설명 다이얼로그이며 존재하지 않는 제품 페이지로 이동하지 않는다.

대안 비교: (A) 모든 메뉴를 설정에 복사하면 업무·환경설정 혼잡이 재발한다. (B) 모든 고급 설정을 강제 기본값으로 숨기면 기존 수신 거부/개인정보 선택을 손상시킨다. **권장 C: 전체 메뉴 유지 + 5그룹 + 프로필/업무 설정 이동 + 알림 묶음 선택**.

## 5. HTML 시안과 검증 범위

- `designs/settings-tab-playground/index.html`: 외부 자산·네트워크 없이 file://로 열리는 단일 HTML. CSS/JS/SVG/합성 이벤트 목록 내장. 보라 #5B1A8A, 크림, 어두운 pill 유지.
- 역할 4개 전환, 메뉴 전/후, 현재/제안 설정 비교, 플레이그라운드 진입·복귀, 그룹 펼치기, 전체 메뉴 서랍을 검토 가능.
- 현재 화면은 소스 기반 구조 재현이며 운영 화면 캡처가 아니다. 합성 이름·정보만 쓴다. 데스크톱 현재 화면은 긴 94개 목록을 내부 스크롤, 모바일은 전체 길이 캡처.
- 시안은 상담 비공개 기본 탭을 보여준다. 상담 공개 탭/배지/스와이프 실동작은 §2.2·§6의 후속 제품 검증 대상이다.
- 플레이그라운드 시안은 예시 데이터 안내와 변화량을 보여주는 제안 화면이며 기존 MetricsPanel 구현의 픽셀 복제가 아니다. 관리자 패널/DEV 도구는 일반 시안에 노출하지 않는다.
- 스크립트 `designs/settings-tab-playground/capture.cjs`로 기존 Playwright를 사용해 서버 없이 캡처. 390px 모바일(역할별 현재/제안, 메뉴 전후, 체험), 1440px 데스크톱 비교. 산출물 `captures/*.png`, `captures/validation.json`.
- 실제 제품 테스트·BLE·API·DB·권한 검증을 통과했다고 주장하지 않는다. 이번에는 문서/시안 검증만 수행한다.

## 6. 완료 조건과 후속 구현 게이트

### 이번 요청의 산출물 완료 조건

- [x] 역할별 메뉴·설정 전수 근거와 개수, 이동·통합 판정이 문서/HTML에서 일치한다.
- [x] NormalizationPanel 및 DEV 전용 조건을 문서와 일반 시안에 보존한다.
- [x] 390px / 1440px 캡처 생성 후 직접 시각 확인한다. 가로 넘침·잘림·메뉴 겹침을 수정한다.
- [x] 시안 플레이그라운드 이동·돌아가기, 4역할 선택, 5그룹 열기를 Playwright로 확인한다.
- 전달 절차: 제품 코드 변경0, 지정 문서/시안만 커밋하고 작업 브랜치 push -u origin.

### 제품 구현 전 별도 Plan/Verify에 옮길 수락 조건 (이번에는 미실행)

- [ ] 4역할 × 상담 공개/비공개 메뉴의 모든 이전 진입점과 배지 보존. 미매칭 경로의 설정 오활성 없음.
- [ ] 회원/C/O 5탭 공유 정의와 스와이프 일치, P 제외, 편집 폼/모달/스크롤 영역 보호.
- [ ] 알림 47×2 매핑 무누락, 혼합/legacy/오류/역할 변경/재로그인에 기존 동의 보존. 실서비스 의미의 수신 거부·권한 상태 독립 검증.
- [ ] 정상·순수기관·겸직기관·조회실패 폴백 구분. 이메일 불변, 개인정보·타인 편집권 보존.
- [ ] 계정 삭제 안내 2탭 이내, 재인증/최종 확인·기관 차단 조건·연구 철회/필수동의 조회 계약 유지.
- [ ] 플레이그라운드 4역할 허용, 회원 셸 정합, 미연결/미지원/native 지원 경로, 관리자 API 거부 검증.
- [ ] SDD-237 현재/채택안 구분, 기관 자동승인 실제 효과, 진행 안내의 긍정 토글, 미래회차 적용 계약 정합.
- [ ] 주요 기능 44px+ 터치·주 CTA48px+, 390/1440 및 safe-area 실제 화면 검증.

## 7. Brian 결정 질문 (3개, 모두 권장안 포함)

1. **플레이그라운드 카드를 로그인한 4역할 모두에게 보여줄까요?** 권장: 전 역할 노출. 현재 라우트가 이미 허용하며 관리자·DEV 패널 권한은 그대로 유지한다.
2. **알림 94개를 목적별 6개 제어로 묶을까요?** 권장: 일정·참여 / 대화 / 리포트·운영 × 이메일·인앱. 기존 혼합값과 거부는 보존하고 명시 변경 때만 묶음 적용한다. 회원에도 빠진 수신 선택을 제공한다.
3. **개인·전문 프로필과 리포트 운영 설정을 별도 화면으로 분리할까요?** 권장: 설정은 5그룹, 기존 업무 메뉴는 상단 전체 메뉴 유지. 프로필 편집과 자동 승인·진행 안내는 각 업무 화면에서 관리하며 설정에는 연결만 둔다.

질문은 Spec/시안 채택을 위한 것이며 이번 문서 커밋·push 승인 재요청이 아니다. 제품 구현은 이 결과물 채택 후 별도 Plan/Verify로 이어간다.

## 8. 시안 검증 기록 (2026-10-24)

- 실행: `node designs/settings-tab-playground/capture.cjs`. 기존 메인 체크아웃의 Playwright 모듈만 사용, headless Chrome, file://. 제품 서버 실행, 의존성 설치, .env 로드 없음.
- 390px 4역할 현재/제안 8장, 메뉴 전후/체험/알림 펼침/개인정보 펼침/동의 상세 5장, 1440px 비교 1장 = PNG 14장.
- 자동 확인 16기록: 역할별 넘침/터치영역 8건, 체험 왕복 및 5그룹 4건, 알림 초기 상태, 데스크톱 폭, 전체 메뉴, 이벤트 매핑. 콘솔 오류0, 외부 요청0, 가로 넘침0, 검사된 표시 조작부44px 미만0.
- 직접 이미지 확인: 역할별 현재/제안, 메뉴 전후, 플레이그라운드, 상세와 데스크톱 비교. 긴 현재 목록은 모바일 전체 캡처와 데스크톱 내부 스크롤로 재현. 데스크톱 목록과 pill을 별도 영역으로 나누어 겹침 수정.
- 독립 검토: 백엔드 AST 기본47종과 JSON/HTML 일치(이메일 ON12, 인앱 ON47; 그룹23/4/20). 역할 수치, 권한, SDD-237 현재/정책 구분에서 추가 중대 누락 없음. 지적된 혼합 초기값 수정 후 검토자 재확인 및 Playwright 검증 통과.
- 제품 빌드, 전체 테스트, 실제 API, 실기기 BLE는 이번 범위 밖이며 실행하지 않았다. 시안 검증을 제품 구현 완료로 해석하지 않는다.


## Brian 결정 (2026-10-24)
| # | 결정 |
|---|---|
| 1 | 플레이그라운드는 회원·상담사 모두 노출(관리자 전용 패널 권한은 유지) |
| 2 | 알림 94개 → 3목적 × 2채널 = 6개 스위치로 통합, 기존 수신 선택 보존(섞여 있으면 '일부' 상태) |
| 3 | 전문·참여 프로필은 별도 프로필 편집 화면, 진행 기록 안내·자동 승인은 리포트 '운영 설정'으로 이동하고 설정에는 링크만 유지 |
| 디자인 | 시안 승인. 켜기/끄기 항목은 모두 스위치(52×32, 켜짐·꺼짐·일부 3상태)로 통일 |
