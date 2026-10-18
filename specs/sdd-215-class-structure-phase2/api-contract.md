# SDD-215 D — 코드 기준 읽기 계약

## H/M/C 가 쓰는 export 목록

모든 경로는 `frontend/src/` 기준이다. 아래 이름은 D의 공개 계약이다.

- `lib/api/class-structure`: `getClasses(params?, signal?)`, `getClass(classId, signal?)`, `getClassSessions(classId, signal?)`, `getCounseling(params?, signal?)`, `getCounselingDetail(relationshipId, signal?)`. 응답은 아래 서버 envelope 그대로다. `ListParams = {status?: string; page?: number; limit?: number}`.
- `lib/class-structure/read-model`: `ClassId`, `RelationshipId`, `SessionId`, `asClassId`, `asRelationshipId`, `asSessionId` (비어 있으면 예외), `ReadState<T>`, `DisplayField<T>`, `displayField`, `StructureRole = 'host' | 'member'`.
- `lib/class-structure/adapters`: `adaptHostClass`, `adaptMemberClass` (목록 또는 상세 DTO → ClassReadModel), `adaptClassSessions` (회차 배열 → SessionReadModel[]), `adaptCounseling` (목록 또는 상세 DTO → CounselingReadModel), `adaptMixedHome` (두 영역 ReadState<목록 envelope> → MixedHomeModel). 개별 필드는 value/no_data이며 `no_data.label`은 ‘데이터 없음’이다. 회원 모델에는 hostView 키 자체가 없다. 상담 표시 제목은 ‘상담 일정’이며 개인 누적 횟수를 만들지 않는다.
- `lib/class-structure/navigation`: `classListPath(role)`, `counselingListPath(role)`, `classPath(role, classId)`, `counselingPath(role, relationshipId)`, `classSessionPath(role, classId, sessionId)`, `counselingSessionPath(role, relationshipId, sessionId)`, `sessionPath(role, sessionId, parent?)`. parent는 `{area:'meditation',classId}` 또는 `{area:'counseling',relationshipId}`. 미확인 영역은 기존 회차 URL로 유지한다. 부모 누락/잘못된 조합은 영역 목록으로 복귀한다.
- `hooks/use-class-structure`: `useClasses(params?)`, `useCounseling(params?)`, `useClassDetail(classId)`, `useCounselingDetail(relationshipId)`, `useMixedHome()`. 반환 `{state, retry}` 또는 혼합 홈 `{classes, counseling, retry}`. 클래스 상세 성공 data는 `{detail, sessions}`. 인증은 기존 authStore를 읽는다. 동일 계정·역할·부모 키의 동시 요청만 공유하고 완료 후 캐시는 남기지 않는다.

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
