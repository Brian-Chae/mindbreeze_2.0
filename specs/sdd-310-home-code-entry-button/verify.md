# SDD-310 — Verify (구현 전 작성)
| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V1 | 홈(구조) 헤더 슬롯의 코드 버튼 | `mobile:hidden`(모바일 미표시) | vitest |
| V2 | 홈(구조) 본문 버튼 | `.mb-page-header-actions` 밖, `md:hidden`, 히어로 섹션 다음 형제 | vitest |
| V3 | 본문 버튼 클래스 | `h-12`, `w-full`, 외곽선(`border-[#5F0080]`), sticky/fixed 클래스 없음 | vitest |
| V4 | 본문 버튼 클릭 | `/join` 이동, 문구 '코드로 바로 입장' | vitest |
| V5 | 내 클래스 | 헤더(secondary, mobile:hidden)+본문(md:hidden) 각 1개, 본문은 header-actions 밖 | vitest |
| V6 | 레거시 홈 | `justify-end` 래퍼 없이 inline 배치, 항상 표시 | vitest |
| V7 | 금지 문구 | 점수/종합점수/좋음/나쁨/완료/보증/100% 0건 | vitest |
| V8 | 실제 렌더 높이 | 360/390px 본문 버튼 높이 ≥48px, position static, 헤더 전폭 줄 없음 | 브라우저 캡처 |
| V9 | 번들 | 신규 Tailwind 클래스(mobile:hidden, h-12 등)가 CSS에 존재 | build 후 grep |
| V10 | 회귀 | tsc -b 0, eslint 0, 관련 vitest 통과, 전체 vitest 기준선(23건/13파일) | 실행 |
| V11 | 실기기 | 미검증(앱 재빌드 필요) | 감독 |
