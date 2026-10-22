# 하단 네비 스타일 통일 — 사전 계획·검증

사용자 직접 수정 지시: 상단은 하단 네비와 색상/스타일 통일, 확정 두 줄 구조 유지.
원인: 시안 고정색 #23142f/#382331 및14/12px 라운드를 적용해 기존 도크 토큰과 분리됨.
변경: host-player.css만 도크와 동일한 sheet-bg-strong/sheet-border/r-sheet 및 텍스트 토큰 사용. 종료의 독립 고정색 면은 도크 버튼처럼 투명/hover fill로 변경, 종료 의미는 coral 글자 유지. 복사/로직 변경 없음.
검증: 기존 집중 테스트, 전체 모바일/데스크톱 실제 하니스 PNG, 상단/도크 computed backgroundColor·border·radius 동일, 긴 제목 겹침 없음. 전역 CSS 변경 없음.
