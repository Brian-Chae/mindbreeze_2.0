# SDD-141 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 대시보드 클래스 목록이 실제 최근 활동 순으로 정렬되는가? (DASH-01)
- [ ] 리포트 목록이 DB limit/offset 으로 페이지네이션되고 N+1 이 없는가? (PERF-02)
- [ ] 세션 목록이 selectinload 로 참여자를 즉시 로딩하는가? (PERF-04)
- [ ] 초대 링크가 배포 도메인 기반으로 생성되고 표시=복사 일치하는가? (UX-02)
- [ ] 상담사 온보딩 필수 입력 미충족 시 진행이 차단되는가? (UX-03)
- [ ] 세션 생성 모달 재오픈 시 최대 인원이 10으로 유지되는가? (FE-UI-001)
- [ ] 모든 소켓이 단일 SOCKET_URL 을 사용하는가? (FE-RT-002)
- [ ] 세션 상세 WS 연결 후 참여자 추가/제거가 반영되는가? (FE-RT-003)
- [ ] VideoPlayer sessionId 변경/unmount 시 blob URL 이 해제되는가? (FE-VID-001)

## 회귀 검증

- [ ] 백엔드 pytest 1009 passed / 0 failed
- [ ] 프론트 vitest 44 files / 318 tests
- [ ] 프론트 build 0 errors
