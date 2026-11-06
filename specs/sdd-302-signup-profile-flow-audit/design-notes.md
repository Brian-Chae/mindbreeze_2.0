# SDD-302 — 시각 설계 및 검증 기록

## 설계 기준
대표의 ‘기존 스타일’은 현재 /app 회원 홈으로 해석했다. 실제 라우트는 `frontend/src/App.tsx:196`의 MemberStructureHomePage다. 로그인 후 일반 회원 화면의 밝은 크림 배경·흰 카드·보라 CTA를 가입과 선택 프로필에 적용한다. 몰입 플레이어의 다크 시트는 클래스 진행 목적의 별도 변형으로 유지한다.

| 항목 | 현재 가입/온보딩 | 회원 화면 근거 | 시안 선택 |
|---|---|---|---|
| 배경 | 로그인/가입 확인 사진+검정 오버레이, essentials #FAFAFA | structure-shell.css:25–26의 #F7F4F0 | #F7F4F0, 사진 미사용 |
| 카드 | essentials radius16/padding32/shadow-lg; 가입 확인 radius24/padding24/shadow-xl | member-home-layout.css:5,17의 radius20/gap24/white | radius20/padding24/border #E8E2ED |
| 버튼 | 가입/로그인 52px pill; essentials는 공용 buttonClass | SDD-245 공용 48/44, structure-shell.css:14의 터치44 | 모바일48, 태블릿44 이상, 주 CTA pill·보조 radius12 |
| 입력 | essentials border #D4D4D4; 일반 온보딩 52px pill 반투명 | SDD-245 공용 radius12/border #857E8F | 모바일48/태블릿44, radius12 |
| 제목·본문 | essentials 24px bold; 가입 확인22; 다크 폼 흰 라벨 | page.json 제목22/700; 홈 내부 섹션18/800은 별도 | 페이지 제목22/700, 본문15, 라벨14 |
| 간격 | 가입 24/32 및 독립 max440; 일반 온보딩 별도 폭 | page.json gutter16/32/40, sectionGap24 | 모바일 gutter16, 768 gutter32, 폼 내용 최대488 |
| 플레이어 | 가입과 직접 재사용 없음 | player-tokens.css:15–31 다크 rgba 시트/radius16, member-player.css:83–86 카드 | 브랜드 #5F0080·터치44 기준만 공유. 다크 플레이어를 밝은 폼에 그대로 이식하지 않음 |

SDD-245는 공개 화면·마법사·몰입 다크 폼을 통일 범위에서 제외했다(summary ‘남은 불일치’). SDD-249는 공통 생일·가입 확인·초대·가드를 반영했지만 전체 스타일 일치는 남았다. 시안은 공용 규격의 값을 재현한 정적 HTML이며 실제 React 공용 컴포넌트를 가져온 제품 구현은 아니다. 폰트는 네트워크를 사용하지 않는 시스템 한글 폰트이며 실제 Pretendard와 글줄이 다를 수 있다.

## 화면 및 동선
- 302-index.html: Before/After 경로 탐색.
- 302-before.html: ClientEssentialsPage.tsx:111–203의 카드/필드/비활성 CTA를 코드 기반 재구성. 비교용 상단·하단 표기를 추가했으며 운영 화면 캡처가 아니다.
- 302-start.html → 소셜 또는 이메일. Apple은 iOS 앱 제공 설명. 코치·기관은 별도 안내.
- 302-social.html: 소셜 인증 이후 이름/생일/동의. 302-email.html → 302-email-info.html: 인증→가입 정보·동의.
- 두 가입 CTA → 302-home.html. 선택 안내 링크에서만 302-profile.html로 이동한다.
- 302-profile.html: 선택 입력, 다시 보지 않기 체크박스, 저장/나중에 하기. 체크 상태면 두 버튼 모두 302-hidden.html, 보류는 302-later.html.
- 302-later.html / 302-hidden.html: 홈을 가리지 않는 결과 안내. 선택 프로필 팝업 없음.
- 302-settings.html: 내 정보에서 재입력/안내 켜기. 정적 시안이므로 설정은 서버나 브라우저 저장소에 기록하지 않는다.
- 302-error.html: 안내 설정 저장 실패·재시도·이번 세션 홈 이동.
- 302-roles.html: 코치 신청/기관 문의 안내, 실제 접수 없음.

## 검증 방법과 한계
`make-mockups.py`는 HTML 생성, `capture.cjs`는 Playwright로 file:// 정적 파일을 캡처한다. 외부 HTTP/API 요청은 차단한다. 제품 빌드/개발 서버/실계정/실메일 없이 수행했다. Playwright 실행 모듈은 기존 메인 체크아웃 설치본을 읽기 전용 사용했다.

390×900, 768×900 뷰포트에서 전 화면 전체 길이 PNG를 생성한다. `validation.json`에 가로 넘침·금지 문구·CTA 높이·제목을 기록한다. 390/768 보류·숨김 클릭 연결 확인. 스크린샷은 실제 앱 키보드·접근성 트리·공급자 인증·다기기 지속성·서버 저장을 증명하지 않는다. 필수 동의 체크 미선택 차단 등은 설계 요구이며 정적 탐색 링크에서는 구현하지 않았다.

육안 확인: 선택 프로필390, 소셜768의 한글 줄바꿈·카드·버튼·여백을 확인했다. 최종 연락용 시안은 가상 데이터만 포함한다. 전체 PNG/HTML과 측정값은 동일 폴더, 공유 사본은 `~/.hermes/share/design-1105/302-*`.

## 최종 확인 결과
- HTML 13개 × 390/768 = PNG 26장, 전체 모바일 축소 검토판 1장. 가로 넘침 0건, 신규 화면 금지 문구 0건. CTA 측정 높이 44/46/48px.
- 390/768에서 보류·숨김 링크, 소셜/이메일 가입→홈 및 숨김 체크 후 저장→숨김 경로를 확인했다. 실제 영구 저장 시험은 아니다.
- 모바일 전체 축소판에서 화면 구조를 검토했고, 프로필390·소셜768은 원본 크기로 확인했다. 전 PNG를 원본 크기로 검수한 것은 아니다.
- 공유 HTML/PNG 총40개 모두 HTTP 200 확인. 결과: http-validation.json.
- 진입: http://100.105.138.107:8001/design-1105/302-index.html
- 비교판: http://100.105.138.107:8001/design-1105/302-contact-sheet.png
- 기존 공유 302 파일이 없는 것을 확인하고 새 파일만 복사했다. 제품 추적 파일 diff 없음, 신규 산출물 폴더만 git 미추적 상태. 커밋 없음.
