# SDD-219 Plan — 클래스 출시 점검과 통합 검증

- 상태: Stage ② Plan
- 선행: spec.md (P8-01/01a/02/03 확정)

## 1. 아키텍처

### 1.1 상담 비공개 — 단일 플래그 모듈
- 신규 `frontend/src/lib/feature-flags.ts`: `export const COUNSELING_ENABLED = import.meta.env.VITE_COUNSELING_ENABLED === 'true'` (미설정=false).
- 테스트에서 값을 바꿀 수 있도록 `isCounselingEnabled()` 함수로 감싼다(vitest `vi.stubEnv`).
- 신규 `components/routing/counseling-gate.tsx`: 플래그 off 면 `<Navigate to=홈 replace />`, on 이면 children. 홈은 역할별(`homePathForRole`) 재사용.
- **서버·API·DB 변경 없음.** 상담 페이지 컴포넌트·라우트 정의는 삭제하지 않고 게이트로 감싼다(재공개=환경변수 변경).

### 1.2 변경 지점 (T = Task)

| T | 파일 | 변경 |
|---|---|---|
| T1 | `lib/feature-flags.ts`(신규), `.env.example`, 배포 워크플로 환경변수 확인 | 플래그 정의. dev·prod 기본 false 명시 |
| T2 | `App.tsx:182-183,221-224` | 상담 5개 라우트를 `CounselingGate` 로 감쌈 |
| T3 | `SidebarNav.tsx` 3개 목록 | 플래그 off 시 상담 항목 필터 |
| T4 | `BottomTabBar.tsx:38` | 상담 탭 제거. 남는 탭 3개 레이아웃(균등 폭) 확인 |
| T5 | `member-structure-home-page.tsx:40-41` | 내 상담 영역·조회 생략 |
| T6 | `legacy-session-path.ts`, `dashboard-navigation.ts`, `navigation.ts`, `notifications.ts:168`, `read-state.tsx:23` | 상담 경로 → 클래스 홈 대체 |
| T7 | `wizard-steps.tsx`, `class-wizard.ts`, `class-labels.ts` 등 | 임상·최면 유형 선택지 제외(프론트만) |
| T8 | `DashboardPage`, `OrgDashboardPage`, `ReportListPage`, `ClientReportListPage`, `SessionCard` | `area=counseling` 행·상담 문구 혼입 점검, 필요 시 필터 |
| T9 | 218 이월 | `class-session-detail.tsx` 의 `ClassTeamReports` → 218 `class-report-manage` 로 교체 연결. `pending` 수동 재시도 안내 문구 |
| T10 | 218 이월 | `useSessionReportRows` 회차 수 호출 측정(20회차 클래스). 임계 초과 시에만 일괄 조회 추가(아니면 후속 분류) |
| T11 | 점검 | 홈 통계 `by_area`·센터 관리자 클래스 현황 누락 점검 → 출시 필수만 구현, 나머지 후속 분류 |
| T12 | 점검 | 알림·메일 `세션`/`클래스` 문구 정리(클래스 관련만) |
| T13 | 문서 | `launch-readiness.md`: 이월 분류표 · prod 사전 점검(Alembic head·스냅샷·스케일업·워커) · 릴리스 승인 체크리스트 · 잔존 경로 명시 |
| T14 | 실측 | dev 배포 후 통합 여정 H1~H7, 4뷰포트(G5), B14, E8, H7 실측 → verify 에 결과 기록 |

### 1.3 순서·병렬
- 1단계(순차): T1 → T2.
- 2단계(병렬, 파일 겹침 없음): [T3·T4·T5·T6·T7·T8] 상담 차단 묶음 / [T9·T10·T11·T12] 이월 묶음.
- 3단계: 단위·빌드 검증 → develop 반영 PR → dev 배포 → T13·T14.

## 2. 위험·롤백
- 위험: 상담 경로 누락 → 상담 화면 노출. 완화: 라우트 게이트 + 경로 계산 테스트 + 전수 grep 테스트(`/counseling` 문자열이 게이트 밖에서 쓰이는지 검사).
- 위험: 기존 알림 딥링크가 상담으로 연결 → 대체 이동으로 처리.
- 롤백: 플래그 true 로 재빌드 시 원상. 코드 revert 불필요.
- 마이그레이션 없음.

## 3. 테스트 전략
- vitest: 플래그 off/on 양쪽에서 사이드바·탭·라우트·경로 계산·마법사 유형 검증.
- 프론트 빌드(tsc 포함) 통과.
- 백엔드 변경이 없으면 백엔드 스위트는 회귀 확인용 1회.
- dev 실측은 T14.
