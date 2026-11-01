# SDD-262 — verify.md (Stage ③, 구현 전 QA 체크리스트)

- 작성: 2026-11-01, 구현 전. 사후 수정 금지. 정본: `specs/sdd-262-member-upload-status/spec.md`

| ID | 영역 | 시나리오 | 검증 방법 | 합격선 |
|---|---|---|---|---|
| V-M01 | 권한 | 비로그인 /app/profile/upload-status | RoleGuard 로그인 리다이렉트 | 화면·수치 0 |
| V-M02 | 권한 | counselor/org_admin 이 해당 경로 접근 | RoleGuard 거부 | 리다이렉트, 데이터 0 |
| V-M03 | 권한 | client 설정에 그룹 노출 | SettingsContent 렌더 | '내 데이터 저장 현황' 존재 |
| V-M04 | 권한 | counselor·org_admin·platform_admin 설정에 그룹 비노출 | 렌더 | 그룹 0, 기존 6그룹 유지 |
| V-M05 | 권한 | 요청에 participant_id 를 보내지 않음(타인 지정 불가) | fetch 모킹 URL 검사 | 쿼리 없음, 본인 JWT 만 |
| V-M06 | 권한 | 타인 회차 summary 403 | 모킹 403 | 수치 DOM 제거+안내 |
| V-M07 | 권한 | 404(회차 없음) | 모킹 404 | 수치 DOM 제거+안내 |
| V-M08 | 권한 | 회차 후보에 본인 attendance 없는 회차 제외 | 순수 함수 테스트 | 제외 |
| V-M09 | 정확성 | feature total_count → '수신 N창' 일치 | 모킹 응답 대조 | 숫자 일치 |
| V-M10 | 정확성 | raw uploaded/pending/failed 및 신호별 합계 일치 | 모킹 응답 대조 | 0 오차 |
| V-M11 | 정확성 | failed>0 → 확인 필요 / pending>0 → 업로드 중 / 그 외 수신>0 → 수신 확인 | 상태 함수 테스트 | 규칙대로 |
| V-M12 | 정확성 | 마지막 수신 시각 = 두 updated_at 중 늦은 값 | 함수 테스트 | 일치 |
| V-M13 | 미착용 | 둘 다 0 → '수신 기록 없음' + 미착용 정상 안내, 확인 필요 아님 | 렌더 | 오류색 아님 |
| V-M14 | 미착용 | 마이크 OFF 등 opt-out 이 누락 아니라는 안내 문구 | 렌더 | 문구 존재 |
| V-M15 | 오프라인/오류 | 오프라인 카드 + 요청 중지, 복귀 시 재조회 | navigator.onLine 모킹 | 카드 표시 |
| V-M16 | 오류 | 5xx 시 이전 수치 제거 + 재시도 안내 | 모킹 500 | 수치 0 |
| V-M17 | 회귀 | 설정 그룹 수 client 8 / 그 외 6, SDD-261 링크 테스트 통과 | settings-content·sdd261-entry 테스트 | 통과 |
| V-M18 | 회귀 | SDD-261 테스트 3파일(29건) 유지 | vitest | 전부 통과 |
| V-M19 | 폴링 | 진행중 회차만 5초 폴링, 완료 회차는 1회 | fake timers | 호출 수 일치 |
| V-M20 | 폴링 | 숨김 탭 중 요청 0, 복귀 즉시 1회 | visibility 모킹 | 일치 |
| V-M21 | 반응형 | 390px: 1열, 가로 스크롤 없음, 터치 최소 44px | 클래스 검사/캡처 | 충족 |
| V-M22 | 금지문구 | 화면 텍스트에 완료·업로드 완료·100%·점수·종합·좋음·나쁨·정상 작동 없음 | DOM 텍스트 정규식 | 0건 |
| V-M23 | 라우트 | /app/profile/upload-status 에서 하단 탭 유지(ClientShell) | 렌더 | 셸 존재 |
| V-M24 | 표기 | 시각은 서버 수신 기준 라벨('서버 수신 기준') | 렌더 | 라벨 존재 |
