# SDD-310 — Summary

## 변경
- `code-entry-button.tsx`: `placement` header(기본, `mobile:hidden`) / body(`md:hidden`, h-12 w-full 외곽선 pill) / inline(레거시 홈, 모바일 전폭·데스크톱 우측) 추가.
- 홈(구조): 히어로 섹션 바로 아래 body 버튼. 내 클래스: 본문 첫 줄 body 버튼(+헤더 secondary 유지). 레거시 홈: `justify-end` 래퍼 제거 → 히어로 아래 inline.
- `page-header.css`: 모바일에서 코드 버튼만 있던 헤더 액션 줄 숨김(빈 간격 제거). 다른 페이지 헤더 영향 없음(`data-code-entry="header"` 전용).
- 시험: `sdd310-code-entry-placement.test.tsx` 신규(RED→GREEN), `member-class-structure.test.tsx` 선택자를 `.cs-read-state a`로 의도 갱신(본문에 코드 입장 링크가 추가되어 첫 `a` 가 바뀜).

## 디버깅
- `max-md:hidden` 은 tailwind `screens` 객체 설정 때문에 CSS 미생성 → 프로젝트 관례 `mobile:hidden` 으로 교체 후 번들 생성 확인.

## 실측 (Chrome 헤드리스, 합성 API, evidence/)
| 폭 | 전 | 후 |
|---|---|---|
| 360/390 홈 | 헤더 줄 전폭(328/358px) 높이 44, top 114 | 본문 히어로 아래 48px, 폭 313/343, static |
| 360/390 내 클래스 | 헤더 줄 44 | 헤더 줄 숨김 아님(신청 버튼 유지), 코드 버튼 본문 48px |
| 768/1280 | 헤더 우측 44px | 동일(회귀 없음) |
