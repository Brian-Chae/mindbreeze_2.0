# SDD-215 D — 코드 기준 읽기 계약

## H/M/C 가 쓰는 export 목록

모든 경로는 `frontend/src/` 기준이다. 아래 이름은 D의 공개 계약이다.

- `lib/api/class-structure`: `getClasses(params?, signal?)`, `getClass(classId, signal?)`, `getClassSessions(classId, signal?)`, `getCounseling(params?, signal?)`, `getCounselingDetail(relationshipId, signal?)`. 응답은 아래 서버 envelope 그대로다. `ListParams = {status?: string; page?: number; limit?: number}`. DTO export: `UserBriefDto`, `SessionBriefDto`, `NextSessionDto`, `ProgressDto`, `ClassSummaryDto`, `ClassInstructorDto`, `ClassHostViewDto`, `ClassDetailDto`, `ClassSessionDto`, `ClassListResponse`, `ClassSessionsResponse`, `CounselingSummaryDto`, `CounselingSessionDto`, `CounselingDetailDto`, `CounselingListResponse`.
- `lib/class-structure/read-model`: `ClassId`, `RelationshipId`, `SessionId`, `asClassId`, `asRelationshipId`, `asSessionId` (비어 있으면 예외), `ReadState<T>`, `DisplayField<T>`, `displayField`, `StructureRole = 'host' | 'member'`.
- `lib/class-structure/adapters`: `adaptHostClass`, `adaptMemberClass` (목록 또는 상세 DTO → ClassReadModel), `adaptClassSessions` (회차 배열 → SessionReadModel[]), `adaptCounseling` (목록 또는 상세 DTO → CounselingReadModel), `adaptMixedHome` (두 영역 ReadState<목록 envelope> → MixedHomeModel). 모델 타입 export: `SessionReadModel`, `ClassReadModel`, `HostClassReadModel`, `CounselingReadModel`, `HomeNextSchedule`, `MixedHomeModel`. 개별 필드는 value/no_data이며 `no_data.label`은 ‘데이터 없음’이다. 회원 모델에는 hostView 키 자체가 없다. 상담 표시 제목은 ‘상담 일정’이며 개인 누적 횟수를 만들지 않는다.
- `lib/class-structure/navigation`: `classListPath(role)`, `counselingListPath(role)`, `classPath(role, classId)`, `counselingPath(role, relationshipId)`, `classSessionPath(role, classId, sessionId)`, `counselingSessionPath(role, relationshipId, sessionId)`, `sessionPath(role, sessionId, parent?)`. parent는 `{area:'meditation',classId}` 또는 `{area:'counseling',relationshipId}`. 회원 회차 선택은 부모 URL의 `?sessionId=<회차 ID>`로 전달하므로 F/M/C가 이 쿼리를 읽는다. 미확인 영역은 기존 회차 URL로 유지한다. 부모 누락/잘못된 조합은 영역 목록으로 복귀한다.
- `hooks/use-class-structure`: `useClasses(params?)`, `useCounseling(params?)`, `useClassDetail(classId)`, `useCounselingDetail(relationshipId)`, `useMixedHome()`. 반환 `{state, retry}` 또는 혼합 홈 `{classes, counseling, retry}`. 클래스 상세 성공 data는 `{detail: ClassDetailDto, sessions: ClassSessionsResponse}`이며 회차 배열은 `data.sessions.sessions`다. 인증은 기존 authStore를 읽는다. 동일 계정·역할·부모 키의 동시 요청만 공유하고 완료 후 캐시는 남기지 않는다.

## 코드에서 확인한 서버 계약 (2026-10-19)

근거: `backend/app/schemas/class_parent.py`, `backend/app/api/v1/classes.py`, `backend/app/api/v1/counseling.py`, `backend/app/services/class_read_service.py`. `specs/sdd-214-class-structure-phase1/schema-contract.md`는 대조 자료이며 코드가 우선한다. DB/서버 접속 없이 정적 확인했다.

| GET 경로 | envelope / 쿼리 | 호스트·회원 차이 |
|---|---|---|
| /classes | {classes: ClassSummary[], total: int} | 본인 가시 회차가 있는 부모만 |
| /classes/{id} | ClassDetail 직접 | host_view만 조건부 제공 |
| /classes/{id}/sessions | {sessions: ClassSessionItem[], total: int} | 가시 회차만 |
| /counseling | {relationships: CounselingSummary[], total: int} | client_display 공개 범위 아래 참조 |
| /counseling/{id} | CounselingDetail 직접 | 회원 report_status는 본인 리포트만 |

목록만 status/page/limit 지원. page >=1, 1<=limit<=100, status 최대 길이는 클래스 12/상담 10. **page와 limit 둘 다 있을 때만** 페이지 제한이 적용된다. total은 status 필터 후 전체 부모 수다. 검색·날짜 필터는 없다. 클래스는 created_at 내림차순/id, 상담은 started_at 내림차순/id, 회차는 seq 오름차순이다.

아래 ‘기본 null’은 스키마에서 생략 가능한 nullable, ‘필수’는 non-null이다. 프론트 표시 변환은 선택 메타가 누락돼도 no_data로 처리한다. 식별자/envelope 필수 구조가 손상되면 오류로 처리한다.

| 객체 | 필드 키 | 타입·nullable | 역할 차이 |
|---|---|---|---|
| UserBrief | id; name | string 필수; string 기본 null | 공개 진행자 표시명만 |
| NextSession | id; seq; scheduled_at; status; host | string 필수; int 기본 null; datetime 기본 null; string 필수; UserBrief 필수 | 클래스 다음 일정 |
| Progress | completed; total | int 필수; int 필수 | 개인 출석 아님 |
| ClassSummary | id; title; status; schedule_mode | string 필수; string 기본 null; string 필수; string 필수 | 동일 |
| ClassSummary | planned_session_count; area; progress; session_count | int 기본 null; meditation/counseling 기본 meditation; Progress 필수; int 필수 | 서비스 area는 meditation 고정 |
| ClassSummary | next_session; has_open_session | NextSession 기본 null; bool 필수 | 입장 허가 의미 아님 |
| ClassDetail 추가 | location_type; location_address; linkband_mode; record_audio | string 필수; string 기본 null; string 필수; bool 필수 | 동일 |
| ClassDetail 추가 | capacity; participant_mode; default_duration_min; host_view | int 필수; string 필수; int 필수; ClassHostView 기본 null | 호스트만 host_view 제공 |
| ClassHostView | access_code; instructors | string 기본 null; ClassInstructorInfo[] 필수 | 활성 클래스 강사 또는 가시 회차 호스트에게 제공. 회원 adapter는 폐기 |
| ClassInstructorInfo | user_id; name; role; status | string 필수; string 기본 null; string 필수; string 필수 | 회원 adapter는 폐기 |
| ClassSessionItem | id; seq; scheduled_at; status; session_kind; host; host_state | string 필수; int 기본 null; datetime 기본 null; string 필수; string 필수; UserBrief 필수; string 기본 null | 같은 가시 조건 |
| SessionBrief | id; seq; scheduled_at; status | string 필수; int 기본 null; datetime 기본 null; string 필수 | 상담 다음/최근 회차 |
| CounselingSummary | id; status; area; counselor | string 필수; string 필수; meditation/counseling 기본 counseling; UserBrief 필수 | 서비스 area는 counseling 고정 |
| CounselingSummary | client_display; modality_default; session_count; next_session; latest_session | string 기본 null; string 기본 null; int 필수; SessionBrief 기본 null; SessionBrief 기본 null | 아래 참조 |
| CounselingDetail 추가 | sessions | CounselingSessionItem[] 필수 | 가시 행만 |
| CounselingSessionItem | id; seq; scheduled_at; status; type; record_status; report_status | string 필수; int 기본 null; datetime 기본 null; string 필수; string 필수; string 기본 null; string 기본 null | 본문은 미제공 |

## 집계·권한·표시 한계

- 가시 조건은 비템플릿 AND (회차 host_id=본인 OR SessionParticipant에 본인 존재). 센터·멤버십 근거로 확대하지 않는다. 부모 상세 미존재/숨김/접근불가는 동일 404. UUID 형식 오류는 400이다.
- progress.completed는 가시 완료 행 수. total은 planned_session_count가 truthy이면 max(계획-가시 취소 수,0), 아니면 가시 행 수-취소 수다. 프론트에서 분모나 완료 상태를 재계산하지 않는다. 0 분모는 비율을 만들지 않는다.
- next_session은 scheduled_at이 현재 이상이고 completed/cancelled가 아닌 가시 행 중 가장 이른 것. 일정 없는 행은 제외. latest_session은 완료 행 중 seq 최대(최근 날짜와 다를 수 있음). 다음 일정이 이미 지난 경우 홈 후보에서 제외하며 다른 회차로 보충하지 않는다.
- 상담 is_placeholder는 **응답 필드가 아니다**. 해당 관계 client_display는 서버 고정 ‘내담자 미지정’. 나머지 이름은 담당 상담사/내담자 본인에게만(비회원은 담당 상담사만). 프론트가 placeholder 여부·개인 관계·종결 주체를 추측하지 않는다.
- class_members·개인 참석/수료·보강·합류 정보, EEG·음성·전사·기록/리포트 본문, 상담사 메모는 응답에 없다. 회원 모델에는 내부 코드/강사 목록을 복사하지 않는다.

## 요청 수명과 통합 요청

현재 공통 apiClient RequestOptions에는 signal이 없고 자체 타임아웃 신호만 fetch에 전달한다. D wrapper의 signal은 취소 즉시 결과 Promise를 AbortError로 끝내고 후속 응답을 폐기한다. **전송 중단은 아직 불가능**하다. 공통 client.ts는 D 소유가 아니므로 수정하지 않았다. F/통합 담당에게 외부 AbortSignal과 내부 타임아웃 신호 결합 지원을 요청한다. 인증/401 refresh는 공통 apiClient 그대로 사용한다. 오류 상태에는 서버 메시지/data를 보관하지 않는다.

T01→T02는 위 envelope/nullable, T02→T03은 brand ID와 원본 필드, T03→T04는 ReadState/가시 모델을 공유한다. 최신 브리프의 새 경로가 과거 plan의 기존 회차 URL 보존 문장보다 우선한다. 별도 진행 파일은 소유 표 밖이므로 만들지 않는다. 시안은 UI 트랙 기준이며 이 데이터 트랙에서는 브라우저 시각 판정을 하지 않는다.

## 구현·검증 기록

- T01: 실제 서버 키·역할 차이·가시 집계·다음 일정 기준 정적 대조 완료.
- T02: wrapper 5종, 구분 식별자, 공통 인증 유지. 필수 envelope/부모·회차 ID 손상은 502로 거절한다. 선택 표시 메타 누락은 adapter에서 데이터 없음으로 처리한다.
- T03: 호스트/회원 projection, 상담 일정, 혼합 홈. 진행 집계 일부 누락은 데이터 없음. 두 영역 성공이라도 total보다 적은 부모만 받으면 nextIsComplete=false이며 전체 다음 일정이라고 단정하지 않는다.
- T04: 동시 목록 요청 공유(각 영역 1 GET), 같은 부모 상세/회차 공유(2 GET), 해제·계정/역할 전환·이전 계정 복귀 시 세대 무효화, 재시도·부분 오류, 새 링크 함수 구현. 완료 응답의 영속 캐시는 없다.
- RED→GREEN: wrapper 최초 미구현 import 실패 후 3건 통과; adapter 최초 4건 실패 후 7건 통과; hook/링크 최소 골격에서 실제 값·호출 횟수 단언 6건 실패 후 13건 통과. 부분 progress/목록 전체성 2건 실패 후 통과, 손상 응답 거절 1건 실패 후 통과. 최종 인증·역할 회귀 포함 데이터 테스트 17건.
- 변경 전 기준선: `npx tsc -p tsconfig.app.json --noEmit` 통과. 용어 가드 2파일 12건 통과. `npm test -- --run --cache false`는 124파일 중 118통과/6실패, 1697건 중 1686통과/11실패.
- 시안은 지정 워크트리 designs를 루트로 포트 5404에 읽기 전용 제공하여 host/member/counseling HTML의 HTTP 200 및 CH01/MC01/CN01 등록을 확인했다. 화면 렌더링·4뷰포트·픽셀 비교는 수행하지 않았으며 H/M/C/Q 인수 범위다.
- 읽기 전용 독립 코드 리뷰: 실제 계약·계정/역할 전환·회원 내부 필드 제외 확인. 필수 응답 검증 보완 후 남은 중요 지적 없음. DB·실제 서비스·기기 검증은 하지 않았다.

### 기존 전체 테스트 실패 11건 (변경 전)

- `agent-counselor-page.test.tsx` 2건: ‘상담사는 브리핑과 입력창을 보고 CTA로 세션 목록을 연다’, ‘메시지 전송 성공 후 입력을 비우고 사용자·AI 응답을 최신 하단에 표시한다’. 높이 단언 undefined 및 입력 요소 타입 불일치.
- `chat-message-deeplink.test.ts` 2건: ‘대상 missing이면 최근 대화로 돌아갈 수 있다’, ‘대상 failure이면 최근 대화로 돌아갈 수 있다’. input disabled 단언 undefined.
- `org-management-browser.test.cjs` 2건: ‘기관 모달: 미저장 보호, 실패 유지, 충돌 재조회, 수정, 비활성화, 재활성화’, ‘목록 상태 필터와 저장 후 포커스 복귀’. 로컬 브라우저 대상 미표시/연결 실패.
- `org-counselor-management-browser.test.cjs` 1건: ‘상담사 보호 대상, 확인 사유, 실패 유지, 역할 변경과 소속 해제’. 로컬 브라우저 대상 미표시.
- `report-modal-pdf.test.cjs` 2건: ‘하단 액션과 본문 전용 PDF (수신 주소: saved@example.com)’, ‘하단 액션과 본문 전용 PDF (수신 주소: 없음)’. localhost:5175 연결 거부.
- `report-server-pdf.test.cjs` 2건: ‘detail: 서버 파일 다운로드와 실패 복구’, ‘email: 서버 파일 다운로드와 실패 복구’. localhost:5175 연결 거부.

### 다른 트랙 인수 요청

1. F/통합: D 소유 밖 `lib/api/client.ts`의 RequestOptions에 외부 signal을 추가하고 내부 timeout과 결합해야 실제 fetch 전송 취소가 가능하다. D에서는 임의 fetch나 공통 인증 우회를 만들지 않았다.
2. F/M/C: 회원 부모 URL `sessionId` 쿼리로 선택 회차를 표시한다. 호스트 회차 링크는 새 중첩 경로를 사용한다. 기존 /sessions/:id/{live,player,record}, /join, /class/:sessionId/enter는 이 데이터 트랙에서 변경하지 않았다.
3. H/M/C: 화면은 adapter 결과를 표시하고 ReadState의 error/not_found 공개 문구만 사용한다. raw DTO를 화면에 펼치지 않는다. M은 nextIsComplete=false일 때 전체 다음 일정으로 단정하지 않는다. Q는 실제 라우트/역할·브라우저·시각 QA를 수행한다.

### 최종 로컬 검증

아래 명령은 지정 워크트리의 frontend에서 실행했다.

- `npx vitest run tests/class-structure-data.test.ts tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts --cache false`: 3파일/29건 통과, 실패 0(데이터 17 + 기존 용어 12).
- `npx tsc -p tsconfig.app.json --noEmit`: 오류 0. 초기 T03에서 드러난 null 제네릭 타입 추론은 명시적 string 타입으로 수정 후 재검증했다.
- `npx eslint src/lib/api/class-structure.ts src/lib/class-structure/read-model.ts src/lib/class-structure/adapters.ts src/lib/class-structure/navigation.ts src/hooks/use-class-structure.ts tests/class-structure-data.test.ts`: 오류/경고 0.
- `npm test -- --run --cache false`: 125파일 중 119통과/6실패, 1714건 중 1703통과/11실패. 위 기준선의 동일 11개 이름·단언/로컬 환경 실패가 재현됐고 신규 실패 0.
- 추가 테스트 파일 타입 검사: `npx tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2023 --jsx react-jsx --types vite/client tests/class-structure-data.test.ts src/lib/eeg/types/bluetooth.d.ts` 통과. 잘못된 verified_tier fixture를 실제 unverified 값으로 바로잡았다.
- 추가 진단 중 저장소 루트에서 vitest를 잘못 실행한 1회는 frontend 로컬 버전 대신 별도 캐시의 Vitest 5.0.5를 사용해 jsdom 해석 오류 1건으로 실패했다(용어 12건만 통과). 성공 근거에서 제외했고 올바른 frontend/Vitest 5.0.2 환경에서 위 최종 검증을 다시 실행했다. 프로젝트 package/lock/의존성은 변경하지 않았다.
- `git diff --check` 통과. 정적 시안 서버는 확인 후 종료했다. 빌드 산출·배포·실제 API/DB·실제 BLE·4뷰포트 화면 검증은 실행하지 않았다.
