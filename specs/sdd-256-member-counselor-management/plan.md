# SDD-256 — 회원 상담사 관리·빠른 추가 구현 계획

> 구현 전 초안. 이번 위임은 기획·디자인까지만 허용하며 아래 작업은 실행하지 않는다. 후속 구현자는 승인된 spec과 verify를 먼저 읽고 작업별 RED → GREEN → 회귀 검증 순서로 수행한다. 현재 하위 에이전트 금지.

**목표:** 홈과 설정에서 같은 코드 추가 흐름으로 연결 목록을 관리한다.
**아키텍처:** 기존 GET/POST를 공용 훅과 명시적 DTO로 감싸고 authStore와 동기화한다. 설정은 새 라우트 없이 기존 Group을 추가한다.
**기술:** 현재 package.json 기준 React 19, TypeScript, Zustand, 기존 API 클라이언트와 Tailwind/shadcn 계열 컴포넌트. 신규 의존성 없음.
**스펙:** `specs/sdd-256-member-counselor-management/spec.md`

## 공통 제약·리뷰 초점

- #5F0080 계열·390px 기준, 전체 목록, 6자 영숫자, 명시적 제출, 연결 해제 제외.
- 409의 서로 다른 원인 → T1/T2에서 detail 분기 테스트.
- 늦은 GET/추가 후 GET 실패 → T1에서 순서 뒤집기 및 부분 실패 테스트.
- 설정의 다른 역할과 0명 회원 → T3에서 client 전용 메뉴 및 게이트 회귀.
- 계정 전환 중 요청 완료 → T1에서 현재 사용자 id 일치 확인, 다른 사용자 store 오염 방지.
- 긴 이름/기관 및 키보드 → T4에서 390px 화면·포커스·safe area 검증.

## 파일 범위와 작업

### T1. API 계약·목록 동기화

파일: 새 `frontend/src/lib/api/client-counselors.ts`, 수정 `frontend/src/hooks/use-client-counselors.ts`, `frontend/src/lib/api/auth.ts`, 테스트 `frontend/tests/use-client-counselors.test.tsx`.

인터페이스: `ClientCounselor { id: string; name: string; profile_image: string | null; org_name: string | null; status: string; matched_at?: string | null }`. `getClientCounselors(): Promise<ClientCounselor[]>`, `addClientCounselor(code: string): Promise<ClientCounselor>`. 훅 반환은 `{ counselors, loading, error, refresh, addCounselor }`, 기존 반환값을 무시하는 호출부도 호환한다. 데이터는 authStore 하나를 기준으로 하며 stale 응답 방지 request generation을 공유한다.

- [ ] 기존 테스트에 `merges_single_201_without_losing_existing`, `stale_get_cannot_erase_added`, `keeps_added_when_refresh_fails`, `does_not_write_to_switched_user`, `distinguishes_org_409` 실패 시나리오 추가.
- [ ] `cd frontend && npm test -- tests/use-client-counselors.test.tsx`로 해당 시나리오 RED 확인.
- [ ] 위 DTO/함수 구현, auth User.counselors 타입 연결. 최신 store를 읽어 id 병합하고 GET 취소/세대 관리, 오류와 빈 목록 분리.
- [ ] 동일 명령 GREEN 확인. 중복 detail 외 409는 성공 경로에 진입하지 않는지 확인.

### T2. 공용 코드 입력 시트

파일: 새 `frontend/src/components/client/counselor-add-sheet.tsx`, `frontend/tests/counselor-add-sheet.test.tsx`; 수정 `frontend/src/pages/client/ClientAppPage.tsx`.

인터페이스: `CounselorAddSheet({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded?: (counselor: ClientCounselor) => void })`. 공용 훅의 addCounselor를 사용. 성공 뒤 완료 버튼으로 닫는다.

- [ ] 입력/붙여넣기/7자 거절/연속 클릭/404·403·서로 다른 409/401·422/응답 불명/포커스 복귀 테스트 작성 후 `npm test -- tests/counselor-add-sheet.test.tsx` RED 확인.
- [ ] 기존 CounselorCodeScreen의 6칸 UI 패턴만 참고해 구현. 자동 제출·잘못된 `{counselors}` 계약은 복사하지 않는다.
- [ ] 기존 0명 화면도 공용 추가 로직을 사용하도록 최소 연결하고, 조회된 목록은 store와 일치시키되 설정 우회는 유지한다. 온보딩 API 변경 없음.
- [ ] 동일 명령 GREEN 및 기존 0명 진입 회귀 확인.

### T3. 홈·설정 진입점

파일: 수정 `frontend/src/pages/client/ClientHomePage.tsx`, `frontend/src/components/settings/settings-content.tsx`; 새 `frontend/src/components/client/counselor-management-panel.tsx`, `frontend/tests/counselor-management.test.tsx`.

인터페이스: `CounselorManagementPanel()`은 목록·기관·공용 시트를 제공. 홈은 전체 상담사를 표시하고 동일 시트를 연다. 새 홈 조합 파일과 App 라우트는 변경 불필요.

- [ ] `home_zero_one_many`, `settings_client_only`, `settings_without_link`, `preserves_join_and_chat`, `null_org_and_missing_date`, `counseling_flag_off` 테스트 작성 후 `npm test -- tests/counselor-management.test.tsx` RED 확인.
- [ ] 홈 기존 primaryCounselor 영역을 전체 목록으로 바꾸고 0명에도 추가 버튼 제공. 설정에는 client에게만 내 계정 다음 Group 추가.
- [ ] 동일 테스트와 `npm test -- tests/member-home-legacy-sections.test.tsx tests/settings-content.test.tsx tests/sdd242-settings-routes.test.tsx` 실행. 달라진 기대값은 요구 변화에 해당하는 부분만 수정.

### T4. 브라우저·앱 QA

파일: 새 `frontend/tests/counselor-management-browser.test.cjs`(독립 Playwright 스크립트).

- [ ] API fixture로 두 진입점·201 병합·오류·조회 재시도를 검증. `node tests/counselor-management-browser.test.cjs`로 실행 가능하게 만들고 base URL은 환경변수로 주입한다.
- [ ] 390×844와 1440×1000에서 전체 목록/바텀시트/설정 캡처 및 bounding box로 overflow=0, 터치 목표≥44px 확인. 입력과 CTA가 가상 키보드에 가려지는지는 실기기에서 별도 확인.
- [ ] `npm run build`와 위 집중 테스트 실행 후 baseline 실패가 있으면 분리 기록. summary는 실제 결과가 나온 뒤 작성한다.

## 예상 규모

- FE 기능 8파일(신규 3 + 수정 5), 테스트 4파일(기존 1 + 신규 3): 기본 **12파일**. 기존 홈/설정 테스트 기대값 수정 시 1~3파일 추가 가능.
- 서버 변경 0(연결일 미표시 결정). 새 홈/App 라우트/온보딩은 읽기 근거이며 수정 대상 아님.

## 앱 재빌드·운영 반영 순서(후속 승인 작업)

1. 대표 결정(연결일 미표시·용어 유지) 및 기획·시안 승인 → verify 사전 기준 확정 → 구현·집중 테스트·독립 검증.
2. FE build 후 승인된 dev 앱 채널용 `npm run cap:ios:dev` / `npm run cap:android:dev`로 네이티브 웹 자산 동기화·재빌드. 실기기 두 경로와 재로그인 확인.
3. 운영(main 머지·배포)은 별도 승인. 운영 앱은 `npm run build:prod` 및 release bundle 검사 후 운영 설정으로 Capacitor sync·서명·배포 채널 업로드.
4. 11/4 전에 현장 설치 버전·추가 성공·목록·채팅방 접근 검증. 서버/웹 반영만으로 기존 설치 앱에 기능이 생겼다고 판단하지 않음. 심사·설치 일정 확인 필요.
5. 문제 발생 시 승인된 이전 앱 버전/배포 복귀 경로 사용. 사용자 연결 데이터 삭제로 롤백하지 않는다.
