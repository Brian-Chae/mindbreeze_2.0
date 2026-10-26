# SDD-242 구현 계획

## 승인·범위
2026-10-24 Brian 결정과 이번 구현 요청을 구현 승인으로 적용한다. 기존 시안·프로필/API·알림 저장 키를 보존한다. 시작 HEAD 5d1d0a0f, origin/develop fetch/merge 결과 Already up to date.
서버·DB·환경변수·삭제·네이티브 빌드·develop 푸시·배포·PR 머지는 하지 않는다.

## 설계
- 모든 역할 설정 첫 화면: 플레이그라운드 카드, 접힌 5그룹, 하단 로그아웃. 기존 Sidebar 전체 메뉴 유지.
- 회원/C/O 5번째 설정 탭을 하단 메뉴와 스와이프 공통 정의에서 관리. 플랫폼 스와이프 제외, 상세/폼 보호 유지. 숨겨진 메뉴 배지는 전체 메뉴에 보존.
- 알림은 일정·참여23 / 대화4 / 리포트·운영20의 47키를 두 채널에서 집계. 표 밖 레거시/미래 키는 묶음에서 제외해 보존하고, 기존 추가3종은 응답에 존재할 때 별도 호환 상세에서 선택. 처음 조회/펼침은 쓰기 요청 없음. 명시 변경은 적용 이벤트·채널 확인 후 해당 묶음에만 적용, 동시 저장 차단, 오류 복구. push 등 타 채널은 변경하지 않음.
- 52×32 공용 스위치: 켜짐 그라데이션, 꺼짐 회색, 일부 가운데 연보라. 터치44px 이상, role=switch/라벨/일부 설명. switch의 aria-checked는 boolean으로 제공하고 일부 상태를 별도 설명.
- 전문10/참여4 편집은 별도 화면에서 기존 컴포넌트·API 재사용. 계정 기본4는 설정 내 계정 상세. 플랫폼 읽기 전용·순수기관 폴백 유지.
- 진행 기록 안내와 기존 자동승인을 리포트 운영 설정에서 제공. 안내는 true=켜짐 긍정형.
- 플레이그라운드 기존 권한 및 DEV 관리자 패널 조건 유지, 회원 셸/복귀 경로 정합.

## 순차 태스크와 담당 파일
동일 워크트리 병렬 수정 금지. 조사만 병렬, 구현은 순차로 수행한다.
1. 감독(root): 이 plan·verify를 구현 전에 커밋, npm ci와 변경 전 전체 테스트 기준선 확보.
2. navigation 워커: lib/mobile-menu-swipe, 양쪽 BottomTabBar, floating-bottom-nav, 셸 배지, PlaygroundPage 및 관련 메뉴·스와이프 테스트. App.tsx는 감독 담당.
3. settings 워커: SettingsPage/ClientSettingsPage, 공통 SettingsContent/SettingsSwitch, 프로필 편집 페이지, privacy-consents, session-note-prompt-toggle, ReportListPage 운영 설정과 관련 테스트. 라우트/알림 파일 제외.
4. 감독: notification-preference-groups 및 grouped-notification-settings 구현과 RED/GREEN 테스트, App.tsx/ClientAppPage 라우트 통합.
5. 별도 검증자: 전체 diff·요구사항·권한·데이터 보존 리뷰. 감독은 테스트/캡처로 재검증.
6. 관련/전체 vitest, tsc, eslint, build. 기존 실패와 신규 실패 비교. 합성 API Playwright 390/1440 4역할 캡처·상호작용, 이미지 직접 확인.
7. summary·검증 기록·한글 기능 커밋, 브랜치 push, develop 대상 PR 생성. 머지하지 않음.

## 검증 한계
합성 API 브라우저 검증은 실제 백엔드·DB·BLE·네이티브 증명이 아니다. 실패·미실행 항목을 숨기지 않고 기록한다.
