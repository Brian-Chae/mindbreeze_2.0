# [SDD-196] Verification (Pre-Implementation)

## Test Scenarios
- TS1 채팅: MessageBubble/agent-bubble 렌더 → 본문 15px, 시간 12px, 이름 13px. **Expected:** 인라인 style 값 일치
- TS2 Tailwind: 빌드 CSS에 `.text-sm{font-size:15px;line-height:22px}` 존재, `.text-xs` 12px
- TS3 하한: 대상 범위에서 `text-[9|10|10.5|11px]`·인라인 fontSize 9~11 없음(배지 예외 목록 제외) — `font-scale.test.ts`가 소스를 스캔
- TS4 입력: 모바일 폭에서 input/select/textarea computed font-size ≥16px, checkbox/radio 제외
- TS5 넘침: 390px 폭에서 주요 화면(로그인·내담자 홈·채팅·루시·설정·리포트·상담사 대시보드) `scrollWidth<=clientWidth`가 전/후 동일
- TS6 회귀: tsc, build, 기존 vitest(기존 실패 건 제외) 동일

## Edge Cases
- [ ] 알림 배지 숫자(16~18px 원)는 유지
- [ ] 하단 탭 라벨 11→12px 5개 탭 한 줄 유지
- [ ] 긴 한글 문장에서 말풍선 줄바꿈 정상(word-break)

## Security Review
해당 없음(스타일 변경).
