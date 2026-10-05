# [SDD-132] — Summary

## What Was Built
9건 접근성 개선을 8개 파일에 적용했다.

| 이슈 | 변경 |
|------|------|
| ①-15 | 마이크 미터 role=meter 제거 → 시각 막대 aria-hidden + sr-only 상태 |
| ①-16 | in_progress 전경색 #1F8A5B → #1F7A4D(대비 4.83:1) |
| ②-5 | LeadOffModal Escape + 초기 포커스(autoFocus) |
| ②-6 | 디바이스 스트립 role=status 제거, 경과 시간 aria-hidden, 상태 전이 sr-only |
| ②-7 | 패널 핸들 tabIndex + ArrowLeft/Right/Home/End |
| ②-10 | aria-hidden을 SVG로 이동, article에 role=meter |
| ②-12 | 배터리 null 시 "배터리 —"(단위 분리) |
| ②-14 | 온보딩 모달 Tab 포커스 트랩 |
| ②-19 | 추이 탭 roving tabindex + Arrow/Home/End |

## Test Results
- ✅ `npm run build` — 0 errors
- ✅ 관련 테스트(class-waiting-room 등) 통과(①-15 반영 수정)
- ✅ 백엔드 `pytest` — 1009 passed

## Notes
- ①-15/②-6: 매 tick 변하는 값은 라이브 영역에서 제외하고 상태 전이만 안내(스크린리더 소음 제거).
- ②-10: 상담사 HostMetricDisplay 패턴(내부 SVG만 aria-hidden, 값 텍스트 노출)과 정렬.
