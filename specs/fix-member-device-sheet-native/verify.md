# verify — 구현 전 체크리스트
- [ ] toNativeDevice: sqi 0.8→ok/0.5→degraded/0.1→invalid/null→unknown; contact leadoff→lead_off, 둘 다 contact→ok, unknown→unknown (null 을 ok 로 승격 금지)
- [ ] band_state connected→연결, reconnecting/lost→끊김 취급
- [ ] facade.getRawPreview: android 에서만 호출, 플러그인 reject/UNIMPLEMENTED→null, ios/web→호출 안 함
- [ ] 응답에 토큰 모양 키 없음(숫자 배열 4개만)
- [ ] 뷰: 뇌파·맥파 두 블록 분리 렌더, ppg 없으면 맥파 블록 생략, 웹 경로 기존 동작 유지
- [ ] wavePath/ppg 정규화: DC 큰 PPG 도 진폭이 보임, 상수열은 평선
- [ ] Kotlin RawPreviewBuffer: 용량 초과 시 오래된 것 제거, 다운샘플 점 수·처음/끝 유지, 빈 버퍼 빈 배열, Engine 통과 후 값 채워짐
- [ ] 전체 vitest 기준선 17 fail/8파일 외 새 실패 0, tsc -b, gradlew testDevDebugUnitTest 통과
