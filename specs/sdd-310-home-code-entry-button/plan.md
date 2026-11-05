# SDD-310 — Plan

- `CodeEntryButton` 에 `placement` 추가: `header`(기본, 모바일 숨김 `mobile:hidden`) / `body`(본문 보조 버튼, h-12 w-full 외곽선 pill) / `inline`(항상 표시, 모바일 전폭·데스크톱 우측).
- 홈 구조(`member-structure-home-page`): rightSlot=header, 히어로 섹션 아래에 body(`md:hidden`).
- 레거시(`ClientHomePage`): `justify-end` 래퍼 제거, 히어로 아래 inline 배치.
- 내 클래스(`member-classes-page`): rightSlot=header(secondary), 본문 첫 줄 body(`md:hidden`).
- `page-header.css`: 모바일에서 코드 버튼만 남은 액션 줄은 숨겨 빈 간격 제거(`:has`).
- 다른 페이지 헤더 액션 무영향(코드 버튼 전용 클래스만 사용).
