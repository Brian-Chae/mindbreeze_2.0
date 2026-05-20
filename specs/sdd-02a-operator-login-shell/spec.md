# SDD-02a — 상담사 앱 디자인 시스템 이식 (Login + AppShell)

## 미션
`design-system/handoff/mind-breeze-design-system/project/ui_kits/app/`의 UI Kit 디자인(보라색 #5F0080 기반)을 실제 상담사 페이지들에 이식한다.

## 현재 상태
- LoginPage.tsx: Clinical Garden(세이지 그린 #88A887) 기반. 왼쪽 브랜드 패널 + 오른쪽 로그인 폼.
- 상담사 내부 페이지들: AppShell 없이 독립 레이아웃.

## 목표 디자인 (UI Kit 기반)
- **보라색 브랜드**: #5F0080 (purple-900)
- **라벤더 배경**: #F5EDFC (purple-50)  
- **크림 배경**: #EBE6E2
- **텍스트**: #1F1F1F (gray-800), #6F6F6F (gray-600)
- **Pretendard 폰트** (font-sans)
- Tailwind preset이 이미 purple을 mb-tokens로 override했으므로 bg-purple-900 → #5F0080 자동 적용됨

## 작업 1: LoginPage.tsx → UI Kit SignIn 디자인
`design-system/handoff/.../ui_kits/app/SignIn.jsx` 디자인을 참고하여 완전히 재작성:

**레이아웃**: 전체 화면, 배경 이미지 + 그라데이션 오버레이
- 배경 이미지: `/mb-design/assets/images/thumbnail3.jpg` (또는 적절한 asset)
- 그라데이션: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)`
- 중앙 정렬 컬럼

**콘텐츠 (위→아래)**:
1. 로고: `/mb-design/assets/logo_symbol_dark.svg` (84x38, filter: brightness(0) invert(1))
2. "mind breeze" 텍스트 (32px, bold, white)
3. "상담사 전용 · MIND BREEZE Operator" (15px, white/0.86)
4. 이메일 입력창 (280px 너비, rounded-full, 흰색 배경, border)
5. 비밀번호 입력창 (동일)
6. 로그인 버튼 (보라색 #5F0080, rounded-full, 흰색 텍스트)
7. "비밀번호를 잊으셨나요?" 링크
8. "아직 계정이 없으신가요? 회원가입" 링크
9. "기관 발급 계정으로만 접속하실 수 있습니다" (12px, white/0.7)

**기능은 그대로**: 이메일/비밀번호 상태, 로그인 API 호출, 에러 처리, 로딩 상태 유지

## 작업 2: AppShell.tsx 레이아웃 컴포넌트 생성
`frontend/src/components/layout/AppShell.tsx` 생성 (UI Kit AppShell.jsx 기반)

**사이드바 (240px, #F5EDFC 배경)**:
- 로고 + "mind breeze" 텍스트
- Rail nav: 대시보드, 세션, 내담자, 채팅, 리포트, 설정
- 하단: 상담사 이름/소속 카드

**헤더 (76px)**:
- 왼쪽: 페이지 타이틀 + 서브타이틀
- 오른쪽: 알림 버튼 + rightSlot

**콘텐츠 영역**: 흰색 배경, 패딩, 스크롤

Props: `{ children, title, sub?, rightSlot?, contentPad?, noScroll? }`

## 작업 3: 대시보드 페이지 생성
`frontend/src/pages/DashboardPage.tsx` 생성 — AppShell을 사용한 대시보드
- UI Kit Dashboard.jsx의 미니캘린더 + 일정 리스트 디자인 참고
- 간소화된 버전: "오늘의 세션" + "최근 내담자" 위젯

## 작업 4: App.tsx 라우트 수정
- 로그인 후 상담사는 `/dashboard`로 이동
- `/sessions`, `/clients`, `/chat` 등도 AppShell로 감싸도록 라우트 구조 변경 (또는 각 페이지에서 AppShell 사용)

## 주의
- 모든 스타일은 Tailwind 클래스로 변환 (인라인 스타일 금지)
- `mb-btn`, `mb-eyebrow` 등 mb-tokens 유틸 클래스 활용
- 기존 LoginPage의 기능(로딩, 에러, 잠금)은 모두 유지
- `/mb-design/assets/` 경로로 asset 참조
- 빌드 검증 필수
