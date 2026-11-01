# SDD-261 FE 구현 노트

## spec §7 첫 확인 항목 (FE 해당)
1. 앱 하단 내비: `BottomTabBar.tsx:24` 가 `/settings` 를 상담사·기관관리자 탭으로 제공(모바일 드로어도 동일). 설정 하단 링크로 현황 진입 가능. platform_admin 은 하단 내비 대상이 아니라 설정 화면에서 `/admin/upload-status` 로 진입.
2. `RoleGuard` 는 `['counselor','org_admin']` 한정(`App.tsx` `/classes/:classId`·`/settings/upload-status`). platform_admin 은 통과하지 못하므로 `PlatformAdminRoute` 로 `/admin/upload-status` 를 별도로 두었다. `/settings` 자체는 role 미지정이라 platform_admin 도 진입 가능.

## 계획과 달라진 점
- 설정 화면: 기존 테스트가 설정 그룹을 6개로 고정(`tests/settings-content.test.tsx`)해 그룹 추가 대신 하단 운영 링크 줄(`data-upload-status-link`)로 노출.
- `apiClient` 가 응답 헤더·304 를 노출하지 않아 `lib/api/upload-status.ts` 에서 전용 fetch 사용(401 시 refreshAccessToken 1회). ETag 는 훅 클로저 메모리에만 보관.
- platform_admin 기관→클래스→회차 목록은 기존 `/admin/orgs` + `/data-center/classes?org_id=` + `/data-center/classes/{id}/sessions` 재사용(백엔드 무변경). data-center 활성 설정(`data_center_enabled`)이 꺼져 있으면 목록 403 → 선택 불가. 확인 필요(미검증).
- 담당 코치용 회차 목록은 `session.host.id === 본인` 만 노출(서버가 최종 판정).
- 304 응답에도 `X-Poll-Interval` 을 읽어 주기를 갱신한다.
- 401/403/404 는 폴링 중단 + 데이터 즉시 제거. 그 외 오류는 3→6→12→30→60초 backoff, 마지막 데이터 유지.

## 미검증
- 실제 BE 응답과의 연결(BE 계약 contract.md 기준 DTO 만 맞춤), CORS 에서 `ETag`/`X-Poll-Interval` 헤더 노출 여부(본문 `etag`/`poll_interval_sec` 로 폴백).
- 앱 WebView 실기기, 390px/1440px 실브라우저 캡처(아래 별도 기록).
