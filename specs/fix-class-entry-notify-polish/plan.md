# fix-class-entry-notify-polish — 계획
1. 입장 설문 자동 다음: `useEntrySurvey.select(axis, value, auto)` — 질문 1~3은 클릭 시 300ms 뒤 다음 문항. 타이머 1개 공유(연타 시 한 칸), 뒤로·건너뛰기·다음·재시작 시 취소. 키보드 화살표는 auto 없이 선택만. 전할 말(4)은 제외.
2. 알림 중복: `class_effect_service._deliver` 의 문구를 effect 종류별 `_MESSAGES` 로 구체화. 모호 문구 제거. 초대는 항상 "클래스 초대".
3. 종료 시 Failed to fetch: `lib/api/user-error.ts`(userErrorMessage) — AbortError·페이지 이탈(pagehide) 중 TypeError 는 null, 브라우저 원문은 한국어 안내로 치환. ClassPlayerPage·useLiveKit·useMemberLiveKit 적용, 언마운트 가드.
