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

## 리포트 칩(대표 확정 11/1) — 구현 위치
- 칩 `components/class/upload-attention-chip.tsx`(같은 `useUploadStatus` 훅, `live=false` 로 첫 조회 1회만). 0명·오류(401/403/404/5xx)면 아무것도 그리지 않음(실패 격리).
- (1) 리포트 목록: 데스크톱 `ReportHierarchyList` 회차 헤더(그룹 `class_id` 있을 때), 모바일 구 목록 `ReportListPage` 세션 필터 선택 시 상단. (2) `class-team-reports.tsx` 상단, 클래스 리포트 페이지 `ClassNarrativeReport` 헤더(`ClassReportResponse.session` 에 class_id 가 없어 `getSession` 으로 해석). (3) `ReportDetailView` 에 `UploadParticipantNotice`(staff 역할만, 해당 참여자가 needs_attention 일 때 한 줄).
- 리포트 DTO 에 `class_id` 가 없어 상세·클래스 리포트는 `getSession(sessionId).class_id` 1회 조회를 더함. 해석 실패 시 숨김.
- 리포트 목록은 회차가 많을수록 회차 수만큼 현황 API 가 1회씩 호출됨(페이지당 limit 만큼). 11/4 현장은 문제 없을 규모이나 부하 우려 시 목록 칩을 끄는 것이 가장 단순(`live=false` 로 폴링은 없음).

## verify.md 추가 제안 (리포트 칩, V-U 형식)
| ID | 영역 | 시나리오 | 검증 방법 | 합격선 | 우선 |
|---|---|---|---|---|---|
| V-U66 | 리포트 칩 | needs_attention N>0 회차의 리포트 목록/클래스 리포트 | 실화면 DOM | “데이터 수신 확인 필요 N명” 칩, 클릭 시 `/classes/:c/sessions/:s/upload-status` | A |
| V-U67 | 리포트 칩 | 현황 API 403/404/5xx 또는 N=0 | 응답 주입 후 DOM | 칩 0개, 리포트 승인·열람 동작 불변 | A |
| V-U68 | 리포트 칩 | 칩 문구 | 화면 문자열 검색 | 점수·판정·완료·100% 0건 | A |
| V-U69 | 리포트 상세 | 해당 참여자 needs_attention | 상세 DOM | “데이터가 아직 더 들어오고 있을 수 있어요” 한 줄, 그 외 참여자엔 없음 | B |
| V-U70 | 리포트 칩 | 목록 칩 폴링 | 네트워크 | 칩이 주기 폴링하지 않음(첫 조회 1회) | B |

## 미검증 (추가)
- 실화면 Playwright 캡처(390/1440px)는 BE 연결 전이라 이번 커밋 범위에서 수행하지 못함. QA 단계에서 BE 연결 후 확인 필요.
