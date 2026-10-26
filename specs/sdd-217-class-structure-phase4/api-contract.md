# SDD-217 — 구현 계약 정본

- 상태: **T00 설계 확정, 신규 기능 미구현**. 사용자 Spec·Verify 구현 승인 및 연구 동의 O3 확정을 전제로 한다. HTTP·DB·브라우저 검증 결과는 후속 태스크에서 기록한다.
- 기준: develop `a4acf6ba`, Alembic `e036a0000056`. [spec.md](spec.md), [plan.md](plan.md), [verify.md](verify.md), [216 계약](../sdd-216-class-structure-phase3/api-contract.md).
- 아래 상대 HTTP 경로 접두는 `/api/v1/classes`. UUID는 문자열, 시각은 시간대 포함 ISO/UTC. 신규 입력은 extra=forbid. 원문 EEG·녹음·전사·연구 가명키·타인 연락처는 신규 DTO에 넣지 않는다.

## 1. 실제 216 보존 계약

- `GET /{id}`는 상세를 직접 반환한다. 목록은 `{classes,total}`, 회차는 `{sessions,total}`, 멤버는 `{members}`. 기존 멤버 항목 `id,user_id,name,status`와 nullable user_id/name을 유지한다. 추가 필드는 가산한다.
- `POST /{id}/members`의 `user_ids`와 `POST /{id}/sessions`의 **`member_ids`는 user UUID**다. 같은 필드 이름을 ClassMember UUID로 재해석하지 않는다. 정원 초과는 409 `class_capacity`; 자동 대기 등록하지 않는다. 코드 가입은 `POST /{id}/join {code}`이며 operation_key를 요구하지 않는다. 기존 ClassCodeInput은 다른 필드를 거절한다.
- `ClassMember(class_id,user_id)` UNIQUE는 guest NULL 여러 행을 허용한다. `SessionParticipant(session_id,member_id)` UNIQUE와 기존 `(session_id,user_id)` UNIQUE를 유지한다. guest 조회·생성은 member_id로 한다. 현행 ensure_expected의 user_id=NULL 조회 재사용은 T07에서 고쳐야 한다.
- 편성 스위치 off의 쓰기 404, 기존 읽기 유지, `manage/invite/schedule/host_request` capability 의미를 유지한다. 팀 참관 off·센터 관리자 D-28 제한은 확대하지 않는다.
- 기존 `/sessions` 입장·entry-state·LiveKit·research-consent 및 `/reports/{id}` 계약을 폐기하지 않는다. 회차 입장 자격 type=`class_entry`, sub=participant_id, sid=**session_id**는 부모 클래스 자격과 별개다.

## 2. 공통 명령·오류·트랜잭션

신규 일반 쓰기 입력 `MemberCommand`: `operation_key: string(1..100)`, `expected_revision: int>=0`, `reason?: string(1..1000)`. 출석 명령은 `expected_participation_version: int>=0`도 받는다. 멤버/회차/보강 ID는 경로 또는 아래 명시 필드로만 전달한다. 성공은 200이며 생성으로 명시한 경로만 201이다.

- 사용자 쓰기는 기존 `ClassOperation`의 `(actor_id,operation_key)` 전역 UNIQUE와 SHA256(action+class+대상+정규화 body), 기존 결과 재사용을 유지한다. 계획의 actor+action+대상별 키 저장소로 기존 유일성을 좁히지 않는다. 키 재사용·다른 요청은 409 `operation_key_reused`.
- guest는 users FK를 위조하지 않는다. 별도 `class_member_operations(member_id,operation_key,request_hash,result,created_at)` UNIQUE(member_id,operation_key)를 사용한다. canonical 대상·action·class를 hash에 포함한다. 매 재시도 현재 자격과 소유권을 먼저 검증한다. result에 자격 원문·PII를 저장하지 않는다.
- 신규 명령은 서버 현재 사용자/guest 주체를 확정한 후 클래스→멤버 ID순→회차 ID순→참가자 ID순으로 잠근다. 기존 편성의 User 선행 잠금이 필요한 호출은 User→Class 순서를 유지한다. 클래스 잠금을 잡은 뒤 User 잠금을 새로 얻지 않는다. 기존 입장/종료 경로도 같은 순서로 정렬해야 한다.
- 잠금 안에서 권한·정원·대기 선행·최신 버전 재검사. 멤버·출석·승격·감사·ClassEffect·operation 결과를 한 커밋으로 저장한다. 실패하면 전부 rollback. 서비스는 flush까지만, 최상위 명령이 commit을 소유한다. 외부 전달·WS·LiveKit 회수는 커밋 후 기존 effect/reconcile 경로를 사용한다.
- 새 성공 응답 공통 `{class_id,revision,...}`. 동일 키 재시도는 동일 도메인 결과를 반환한다. 검증된 기존 키는 stale_revision 비교 전에 복원한다. effect_key는 operation/event ID에 결합하여 중복 의도를 막는다.
- 새 오류는 `{detail:{code,...}}`. 401 `guest_credential_invalid`(만료/서명/폐기), 403 `action_forbidden`, 404 `class_not_found`/`member_not_found`/`session_not_found`(타 클래스·비가시 포함), 409 `stale_class`(+revision), `stale_participation`(+participation_version), `class_capacity`, `session_capacity`, `member_transition_invalid`, `waitlist_precedes`, `makeup_source_invalid`, `makeup_already_reserved`, `target_participant_exists`, `guest_merge_record_conflict`, `recovery_unavailable`; 422 입력·`reason_required`. 기존 오류 문자열/객체와 코드 시도 제한 429는 일괄 변환하지 않는다.

## 3. 신규 멤버십·출석·보강 HTTP

- `POST /{id}/waitlist`: MemberCommand + `code`. 로그인 본인 또는 유효 guest 활동 자격. 명시 대기 신청, 기존 행 재사용. `{class_id,revision,member}`. 정원이 남고 선행 대기자가 없으면 409 `waitlist_not_required`로 새 join 선택을 유도한다. 자동 active 전환은 하지 않는다.
- `POST /{id}/members/{member_id}/transition`: MemberCommand + `action=leave|cancel_waitlist|rejoin|remove|restore|promote`. 본인은 leave/cancel_waitlist/rejoin, manage_members 권한자는 remove/restore/promote. `{class_id,revision,member,promoted_member_ids}`. removed 코드 재가입/본인 복구와 completed 재활성화는 거부. left 재가입·removed 명시 복구는 빈자리+선행 대기 여부에 따라 active 또는 waitlisted. 승격은 FIFO. 대기 취소 후 재신청은 새 끝 순번.
- `POST /{id}/sessions/{session_id}/members/{member_id}/attendance`: MemberCommand + expected_participation_version + `action=excuse|undo_excuse|correct_attended|correct_absent|correct_excused`. 본인은 시작 전 excuse/undo_excuse만, 사후 정정은 correct_attendance 권한과 reason 필수. `{class_id,revision,participant,participation_version}`. excused 직접 입장도 undo_excuse와 동일한 회차 정원을 검사한다.
- `POST /{id}/makeup-assignments`(201): MemberCommand + `member_id,source_session_id,target_session_id`. 본인 또는 assign_makeup 권한자. 즉시 유효 예약이며 별도 승인 대기 상태를 만들지 않는다. `{class_id,revision,assignment,participant}`. 대상은 ready/scheduled이며 아직 입장/시작 전. 같은 클래스·canonical 멤버의 absent/excused 원회차만 허용, 원=대상 거부. 대상 기존 정규 참가행은 409. 기존 cancelled/withdrawn 보강 참가행은 이력 보존 후 재사용 가능. 한 원결석의 유효 예약/완료는 최대 1개.
- `POST /{id}/makeup-assignments/{assignment_id}/cancel`: MemberCommand. 본인/assign_makeup, 미입장 예약만 취소. `{class_id,revision,assignment}`. 원 결석 보존, 대상 미래 보강행 withdrawn, 취소 예약은 보존하고 다른 대상 재예약 가능.
- 기존 `POST /{id}/sessions`에 **`class_member_ids: UUID[]=[]`만 가산**한다. legacy member_ids와 동시 비어 있지 않으면 422 `ambiguous_member_identifiers`. 두 입력 모두 canonical 멤버로 해석 후 동일 보강 검증 서비스를 통과해야 한다. completed 원회차의 개인 보강은 각 멤버 absent/excused 근거 필수. cancelled 원회차의 대체 편성은 attendance_kind=regular, 개인 보강 assignment 없음. 기존 makeup_for_session_id는 편성 연결로 보존하되 이것만으로 개인 보강 완료를 세지 않는다.

`MemberDTO`: 기존 id/user_id/name/status + `kind,canonical_member_id,waitlist_position,joined_at,activated_at,left_at,removed_at,completed_at,capabilities`.
`AttendanceDTO`: `id`(원 participant), `session_id,member_id,canonical_member_id,attendance_status,attendance_kind,entered_at,makeup_for_session_id,makeup_assignment_id|null`.
`MakeupAssignmentDTO`: `id,member_id,source_session_id,source_participant_id,target_session_id,target_participant_id,status`(reserved/cancelled/completed), `created_at,cancelled_at,completed_at`. completed는 대상 attended에서 파생·단일화하며 source를 참석으로 바꾸지 않는다.

## 4. guest 가입·자격·병합·회복

- `POST /{id}/guest-memberships`(201): 공개 code 시도 제한 적용. `{code,operation_key,guest_name,gender,birth_date,report_email,report_included:false,notice_version?,research_consented:false,research_notice_version?,reminder_opt_in:false}`. 정상 서비스의 개인정보 고지/필수 입력 규칙은 기존 guest 입장 정책을 재사용한다. 이름·성별·생년월일·이메일 4개 필수는 유지한다(T07에서 DTO 선택 표기 불일치를 정정). 선택 연구·리포트 동의를 입장 필수로 만들지 않는다. `{class_id,member,credential_bundle}`. 이름/이메일 같은 값으로 기존 member를 찾아 인계하지 않는다. 정원409이면 명시 대기를 선택하도록 응답하며, 가입 body에 `join_mode=active|waitlist`(기본 active)를 가산해 신규 guest도 대기 신청 가능하게 한다.
- 가입 멱등은 별도 `class_guest_join_operations(class_id,operation_key,request_hash,member_id,created_at)` UNIQUE(class_id,operation_key)로 처리한다. operation_key는 충분한 임의 UUID로 생성한다. 공개 키·이름만으로 기존 토큰을 재발급하지 않는다. 이미 생성된 요청 재전송은 도메인 ID만 반환하며 `credential_bundle=null,recovery_required=true`; 자격 응답 유실은 강사 확인 회복을 사용한다. 원문 자격을 DB operation result에 남기지 않는다.
- 부모 guest JWT type=`class_membership`(활동)/`class_membership_read`(읽기), sub=canonical member_id, cid=class_id, ver=member.entry_ver, jti=grant_id, exp. 로그인·회차 class_entry와 교환해 쓰지 않는다. `X-Class-Member-Credential` 헤더로만 제출한다. URL/로그/알림에 넣지 않는다. `credential_bundle={activity_credential:string|null,read_credential:string,expires_at}`.
- `POST /{id}/guest-credentials/refresh`: 유효한 본인 자격에서만 90일 슬라이딩 갱신. DB grant의 revoked_at/expires_at·JWT·entry_ver·클래스·canonical 상태 모두 검사한다. 만료된 자격은 갱신 불가. active는 활동+읽기, completed/left/removed는 읽기만 발급한다. 읽기 자격은 일반 입장·WS·미디어·멤버십 쓰기에 사용할 수 없다. 아래 본인 재가입/지정 보강 교환만 별도 허용하며 읽기 토큰 자체를 회차 입장 자격으로 쓰지 않는다.
- `POST /{id}/guest-credentials/rejoin`: MemberCommand + `code`, 본인 **읽기 자격**의 제한적 교환. canonical 상태가 left이고 클래스 active일 때만 현재 코드·정원·선행 대기·최신 revision을 잠금 안에서 재검사하여 같은 member를 active 또는 waitlisted로 복구한다. `{class_id,revision,member,credential_bundle}`. active는 새 활동+읽기, waitlisted는 대기 취소 등 허용된 대기 작업만 가능한 새 활동+읽기를 발급한다. entry_ver 증가·옛 grant 폐기와 새 발급은 원자 처리한다. removed/completed 및 cancelled/archived 클래스는409 member_transition_invalid. read 자격으로 일반 transition을 실행하는 예외가 아니라 이 명시 경로에서 rejoin만 허용한다. 로그인 회원은 신규 transition의 rejoin을 사용한다.
- `POST /{id}/sessions/{session_id}/guest-entry`: MemberCommand, 본인 **읽기 자격**으로 completed 고정형 멤버의 지정 보강만 회차 자격으로 교환한다. 부모 completed·fixed, canonical member completed, 동일 클래스의 유효 reserved assignment와 대상 participant 소유, 원결석 absent/excused, 참가행 미입장·비withdrawn·비superseded, 대상 회차 open/in_progress, 정원 및 현재 assignment를 잠금 안에서 모두 검사한다. 다른 회차/일반 정규 참석/left/removed는 거부한다. 성공 `{class_id,revision,session_id,participant_id,entry_credential,expires_at}`. 기존 class_entry(type/sub/sid/ver/TTL)만 발급하고 새 장기 활동 자격은 발급하지 않는다. 실제 입장 성공 훅에서 entered_at·attended를 동일 트랜잭션으로 기록한다. 클래스와 멤버 completed는 유지한다. 이후 해당 회차의 entry-state/WS/LiveKit은 새 class_entry로만 접근한다. 토큰 원문은 operation result에 저장하지 않으며 재시도 발급은 여전히 유효한 본인 읽기 grant와 기존 동일 operation·assignment·회차 접근을 다시 검사한 뒤에만 한다. 강사 확인 단회 회복은 읽기 grant를 복구할 뿐 이 배정/정원 검증을 생략하지 않는다.
  - T07 계약 보완: **활동 자격+active 멤버**는 동일 경로에서 기존 본인 정규/보강 참가행의 회차 자격을 교환한다. 새 NULL guest 참가행을 생성하지 않는다. class/session/canonical 유효 참가행·현재 자격·정원을 잠금 안에서 검사하고 실제 입장 훅을 사용한다. 읽기 자격의 예외는 completed 멤버의 지정 개인 보강 또는 명시적 취소 회차 대체 편성으로 한정한다(T05 공통 자격 검사). left/removed의 읽기 자격은 입장에 사용할 수 없다. 재접속·동일 요청 재시도는 보존된 본인 참석 이력을 허용하되 현재 배정/자격을 다시 검증한다.

- `POST /{id}/guest-credentials/logout`: 인증된 본인. entry_ver 증가, 모든 활동/읽기 grant 폐기. `{logged_out:true}`. leave/remove/merge도 entry_ver 증가와 해당 participant.entry_ver 및 기존 회수 의도를 함께 반영한다. 본인 leave 성공 응답에는 credential_bundle(읽기만)을 가산하고 자격 원문은 operation result에 저장하지 않는다; 강사 remove 뒤 읽기 회복은 동일인 확인 절차를 사용한다.
- `POST /{id}/guest-merges/preview`: manage_members 권한, `{source_member_id,target_member_id,reason}`. 같은 클래스 guest만. `{source_member_id,target_member_id,conflicts:[{session_id,code}],withdraw_participant_ids,preview_fingerprint}`. 신원 근거는 사람의 확인이며 이메일·이름 자동 매칭을 하지 않는다.
- `POST /{id}/guest-merges`: MemberCommand + `source_member_id,target_member_id,confirmed_preview_fingerprint,identity_confirmed:true`. 최신 미리보기 fingerprint 불일치는409 `guest_merge_preview_stale`. 실제 기록 충돌이면 전체 rollback. 성공 `{class_id,revision,canonical_member_id,source_member_id,recovery_required:true}`. 양쪽 모든 옛 자격을 폐기하며 성공 응답에 guest 자격을 강사에게 주지 않는다.
- `POST /{id}/members/{member_id}/recovery`: manage_members, MemberCommand + `identity_confirmed:true`, reason 필수. `{class_id,revision,exchange_token,expires_at}`. canonical 대상 단회 임의 토큰, 10분, 저장은 SHA256 hash만. 확인된 본인에게 전달하는 전용 화면에서만 일시 표시한다. operation result에 원문 저장 금지, 같은 요청 재시도는 새 토큰 발급 없이 `recovery_required:true`.
- `POST /{id}/guest-credentials/exchange`: `{exchange_token}`. 토큰 행 잠금→scope/expiry/미사용 검사→consumed_at과 새 grant 한 커밋. `{class_id,member,credential_bundle}`. 타 클래스/만료/이미 사용은401 `guest_credential_invalid`; 일회 교환은 일반 operation 재시도 계약에서 제외한다. 이름/공개 코드/participant ID만으로 회복하지 않는다.
- guest 화면 `/class-members/:classId`. 기존 로그인 회원 경로 `/app/classes/{id}`와 구분한다. 재가입·이메일 복구·회원 전환은 새 계정 연결 기능으로 확대하지 않는다.

### canonical 불변식

`ClassMember.canonical_member_id`는 미병합이면 NULL, 병합 원본이면 살아남은 같은 클래스 guest ID. 자기 참조·cycle 금지. 서비스는 모든 alias를 직접 최종 survivor로 평탄화한다. source 행은 removed로 보존한다. **SessionParticipant.member_id·participant ID와 EEG/리포트 FK를 재작성하지 않는다.**

읽기·입장·정원·집계·스크럽은 `canonical 범위 = survivor + alias IDs`를 사용한다. 같은 회차에서 두 행에 실제 entered_at 또는 EEG/리포트/체크인/미디어 기록이 있으면409. 한쪽에만 실제 기록이면 해당 행이 유효 행이다. 둘 다 미래 미입장 expected면 survivor 소유 행을 우선하고 나머지는 withdrawn. 이름/연락처/동의 사본은 명시 canonical 선택을 따르고 source 원문을 반환하지 않는다. 실제 기록 없는 excused/withdrawn 행도 단일 유효 참가행을 선택하되 출석 감사로 보존한다. 서로 다른 과거 회차 이력은 합산 가능하다. 같은 session의 유효 참가자는 1개로 집계하고 superseded participant는 입장 불가다. 취소 보강 예약도 alias 범위에서 조회하여 동일 원결석 중복을 막는다.

## 5. 동의·보관 HTTP

- `GET /{id}/me/consents`: 로그인 본인/guest 읽기 자격. `{member_id,report_included_default,research_consented,research_notice_version,research_selected_at,research_origin_id,reminder_opt_in,notice_version}`. 연구 가명값/타인 동의는 노출하지 않는다.
- `PUT /{id}/me/consents`: MemberCommand + 선택 필드 `report_included_default,research_consented,research_notice_version,notice_version,reminder_opt_in`. 본인 활동 자격. 연구 true 변경에는 고지 버전·명시 선택이 필요하다. `{class_id,revision,consents,updated_future_participant_ids}`. 기본값 변경은 미래 미입장 및 미종료 회차에만 적용하며 명시 override는 보존한다. completed/left/removed는 기본값을 수정할 수 없다.
- O3: 가입 한 번의 선택(미선택=false)·고지 버전·선택 시각·원동의 ID를 보존한다. 회차에는 기존 research_consents/current 및 append-only events를 생성·연결한다. 각 회차 필수 재확인 신설 없음. 기존 `PUT /sessions/{sid}/research-consent`의 명시 변경은 해당 회차 override로 기록한다.
- **기본값 false 변경은 철회와 다르다.** `POST /{id}/me/research-withdrawal`: MemberCommand + reason, 본인 읽기 자격도 허용. `{class_id,revision,affected_count,withdrawn_at}`. canonical 범위 과거·종료 회차도 기존 연구 철회 상태/이벤트·내보내기 제외 규칙을 적용한다. 기존 platform_admin의 전역 subject 철회 API 권한/의미는 유지한다. 새 API가 전역 타 클래스 신원을 추측하지 않는다. 종료 증빙의 원선택은 보존하되 현재 consented/export_state는 철회를 반영한다.
- 리포트 반영 기본값 false, 연구 미동의, 리마인더 별도 opt-in=false. report_scope·기존 연구 내보내기 조건은 유지한다. class 기본값만 보고 기존 회차 연구 동의를 추정하지 않는다.
- 스크럽 기준은 canonical 범위의 `마지막 attended 회차 종료`와 `멤버십 종료` 중 늦은 시각+90일이다. 활동 중 종료 기준이 없으면 임의 생성일로 대체하지 않는다. 멤버/alias/participant 사본 이름·성별·생년월일·이메일을 한 트랜잭션으로 지우고 scrubbed_at 기록, pending 전달을 중단한다. 재가입·기본값 복사·operation 재응답으로 원문을 되살리지 않는다. 연구 내보내기/철회 보관 규칙과 현재 hold 정책은 기존 retention service를 적용한다.
- `POST /{id}/access-code/rotate`: manage, MemberCommand → `{class_id,revision,access_code}`. 기존 공유 class_code_service를 재사용한다. 이전 공개 코드로 신규 교환만 막으며 기존 grant는 유지한다. 별도의 명시 자격 폐기에서 entry_ver를 변경한다.

## 6. 읽기·capability

- `GET /{id}/me/membership` → `{class_id,revision,member,attendance_summary:{attended,absent,excused,makeup_reserved,makeup_completed},capabilities}`.
- `GET /{id}/me/attendance` → `{sessions:[{id,seq,scheduled_at,status,session_kind,participation_scope,attendance:AttendanceDTO|null,makeup:MakeupAssignmentDTO|null,approved_report_ids:string[]}],total}`. 합류 전 회차는 participation_scope=`before_join`이고 attendance=null·리포트 ID 없음. 합류 중/이탈 중은 `eligible`/`outside_membership`; 본인 참가 근거 없이 absent를 추정하지 않는다.
- left/removed/completed도 로그인 본인/guest 읽기 자격으로 위 경로와 **승인된 본인 과거 리포트만** 읽는다. `/reports/{id}`에서도 같은 canonical 소유권·승인 조건을 적용한다. 일반 그룹 리포트 ID를 개인 기록으로 노출하지 않는다. 미승인/타인/타 기관/숨김은404. 읽기 자격으로 라이브 상태·다른 회원 목록·원문·미디어 직접 접근 불가. §4의 재가입/지정 보강 교환 성공 후 새로 발급된 해당 scope 자격만 사용한다.
- 새 capability는 항상 bool: `manage_members`(기존 invite와 같은 현재 lead/assistant/같은 센터 org_admin), `correct_attendance`·`assign_makeup`(현재 해당 회차 진행 지도사 또는 관리 가능한 클래스 강사, **org_admin이라는 이유만으로 부여하지 않음**), `merge_guests`(manage_members), `leave`·`cancel_waitlist`·`rejoin`·`excuse`·`request_makeup`·`edit_consents`·`read_own_reports`(해당 본인·상태·자격별). 클래스/멤버/회차에 맞는 위치에서 반환하며 버튼 표시 외 서버가 같은 조건을 강제한다. guest 회복은 merge_guests와 같은 권한이다.
- 참석 수는 canonical 유효 participant/session을 distinct 집계한다. 보강 완료 수는 distinct source_participant이며 참석 수를 한 번 더 더하지 않는다. 취소·보강은 정규 회차 분모에서 제외한다. 점수·등급·순위·변화 서사는 Phase5로 남긴다.

## 7. 체크인·현재 접속의 스냅샷/이벤트

현행 근거: 체크인은 `SessionRecord.subjective_state.participants[participant_id].before`, REST 저장은 `POST /api/v1/sessions/{sid}/checkin`이다. WS waiting_room의 client checkin payload, joined_at, 초대행, band_connected는 영속 체크인/현재 참여 근거가 아니다.

- `GET /{id}/sessions/{sid}/participation` → `{session_id,participation_version:int,generated_at,presence_ttl_seconds:90,participants:[{participant_id,member_id,canonical_member_id,attendance_status,entered_at,checkin_state,checkin_at,presence_state,presence_expires_at}]}`. 현행 회차 호스트만 전체, 본인은 본인 한 행, observer/org_admin의 단순 운영 권한은 거부한다.
- checkin_state=`completed|not_completed|unknown`. 서버 before 저장 근거면 completed. 서버가 명시적인 초기화/미작성 상태를 기록한 신규 행만 not_completed. 기존 NULL/근거 부재는 unknown. after 체크인은 before 완료로 보지 않는다. 내용·감정·메모는 이 DTO에 넣지 않는다.
- presence_state=`connected|disconnected|unknown`. 인증된 WS 실제 세션 join에서만 connected. 서버가 관찰한 연결이 모두 퇴장/만료하면 disconnected, 관찰한 적 없는 기존 행은 unknown. HTTP enter 성공은 attended/entered_at만 바꾸며 socket 접속을 추정하지 않는다.
- 기존 Socket.IO namespace `/session-live`, `join`→`joined.snapshot`, `leave`/disconnect, 호스트 `participant_changed`를 그대로 사용한다. 신규 `participation_heartbeat`는 서버가 저장한 sid 세션/participant 문맥만 사용하고 클라이언트 지정 타인 ID를 신뢰하지 않는다. 30초 주기, lease TTL90초, 여러 탭은 유효 lease 하나라도 있으면 connected. waiting_room_changed와 현재 수업 presence는 분리한다.
- 스냅샷/participant_changed에 동일 `participation_version`을 가산한다. 기존 session 상태 `version=Session.state_version`은 바꾸거나 비교에 혼용하지 않는다. 스냅샷 수집과 버전 할당은 동일 회차 잠금 안에서 일관되게 수행한다. 체크인 저장·출석·WS join/heartbeat/leave·lease 만료 반영 때 세션 participation_version을 단조 증가시킨다. 커밋 후 이벤트 발행. FE는 같은 session에서 저장 버전보다 작은/같은 delta를 무시하고, snapshot 대기 동안 delta를 버퍼링한 뒤 더 큰 버전만 적용한다. gap/재연결은 재조회한다.
- 버전/lease는 DB 기반(아래)으로 정한다. 기존 단일 프로세스 dict를 영속 스냅샷 근거로 확장하지 않는다. lease는 조회/heartbeat 및 최대30초 주기 정리에서 만료 처리하고 version을 갱신한다. FE는 expires_at 이후 재조회하고 재조회 실패 시 unknown을 표시한다. 체크인·attended는 presence TTL 만료로 지우지 않는다. 실제 WS 회수 시간·실브라우저 NV 검증은 별도다.

## 8. 추가 스키마·마이그레이션 설계

실제 056 다음 **단일 migration 소유자는 통합 담당**이다. T00은 제품 모델/마이그레이션을 수정하지 않는다. revision은 통합 시 실제 head를 검사해 발급한다. 기존 제약 완화·원문 데이터 삭제·참가자 FK 재작성은 없다.

- `class_members`: canonical_member_id nullable self FK RESTRICT + index, research_consented bool default false, research_notice_version nullable varchar20, research_selected_at nullable timestamptz, research_origin_id nullable UUID, reminder_opt_in bool default false. 기존 report_included_default/entry_ver/notice와 상태 날짜를 재사용한다. canonical 같은 클래스·guest·비순환 조건은 잠금 서비스에서 검증하고 가능한 복합 FK/CHECK를 추가한다.
- `sessions`: participation_version bigint NOT NULL DEFAULT0. `session_participants`: checkin_state nullable varchar20, checkin_at nullable timestamptz, presence_seen_at nullable timestamptz, report_consent_override bool default false, research_consent_override bool default false, research_origin_id nullable UUID, superseded_by_participant_id nullable self FK RESTRICT. 기존 entered_at·attendance·member_id·entry_ver를 재사용한다. superseded는 조회에서 무조건 숨기지 않고 기록/스크럽 대상에 남기되 입장·집계에서 제외한다.
- `class_attendance_events`: id,class_id,session_id,participant_id,member_id,old_status,new_status,actor_kind,actor_user_id nullable,reason,operation_key,created_at. append-only, FK 삭제 CASCADE 금지. 기존 ClassMemberEvent는 멤버 상태 이력에만 재사용한다.
- `class_makeup_assignments`: UUID PK,class_id,member_id,source_participant_id,source_session_id,target_participant_id,target_session_id,status,created_at,cancelled_at,completed_at. status CHECK(reserved/cancelled/completed), source!=target. **partial UNIQUE(source_participant_id) WHERE status IN ('reserved','completed')**. canonical merge 시 alias 원결석 동시 예약도 잠금 서비스에서 재검사한다. target participant FK 유지, `(session_id,member_id)` UNIQUE 유지.
- `class_guest_credentials`: id(UUID jti),class_id,member_id,scope(activity/read),entry_ver,expires_at,last_used_at,revoked_at,created_at. 서명 토큰 원문 미저장. 인증은 DB grant와 일치해야 한다. `class_guest_recoveries`: id,class_id,member_id,token_hash UNIQUE,expires_at,consumed_at,issued_by,reason,created_at. 10분 만료·한 번 사용을 row lock으로 보장한다.
- `class_guest_merges`: id,class_id,source_member_id UNIQUE,target_member_id,actor_user_id,reason,preview_fingerprint,created_at. append-only. 동일 operation 재시도는 ClassOperation에서 복원. `class_member_operations` 및 `class_guest_join_operations`는 §2/4의 UNIQUE/저장값을 따른다. 공개 가입 hash는 서버 HMAC으로 개인정보를 직접 남기지 않는다.
- `class_member_consent_events`: id,class_id,member_id,choice(report/research/reminder),value,notice_version,selected_at,origin_id,actor_user_id nullable,operation_key. append-only. 기존 research_consents에 origin_id nullable UUID를 가산하여 가입 선택 원본을 연결한다. 최초 선택·기본값 변경과 명시 철회 이벤트를 구별한다. 기존 가명 식별·export_state·내보내기/철회 테이블 유지.
- `session_presence_leases`: id(server socket 식별자),session_id,participant_id,expires_at,last_seen_at, UNIQUE(session_id,id), expiry index. 서버 인증 성공 시 생성/갱신, leave/disconnect는 해당 lease만 삭제. 개인 원문/자격 미저장. session row 잠금 아래 version과 함께 반영한다. 단일 워커 메모리 소멸/재시작으로 버전이 뒤로 가지 않는다. 만료 lease는 정리 가능하지만 participant.presence_seen_at은 unknown/끊김 판별에 남긴다.
- backfill: 기존 연구 동의를 가입 동의로 추정하지 않는다(false/NULL). 기존 체크인 before 실존만 completed로 채우고 나머지 NULL=unknown. 기존 guest가 canonical이라는 가정 외 동일인 추정 없음. 기존 makeup_for_session_id만으로 개인 assignment를 합성하지 않는다. 실제 기록 검토 없는 자동 병합/리포트 재귀속 없음. 새 NULL/FALSE 기본값 가산 후 PG migrated DB에서 FK·partial UNIQUE·두 연결 경합을 검증한다. SQLite create_all 통과는 migration 증거가 아니다.

## 9. 태스크/검증 연결과 기술 판단

- R1→T02/V01~06,V36; R2→T03/T04/V07~10,NV04~08; R3→T05/V11~14,V35; R4→T07/T08/V15~24,V37~39; R5→T09/T10/V25~31,V38; R6→T01/T04/T06/NV01~12. 통합 T11/V32~34 및 DOC01~04.
- 계약 테스트는 기존 DTO/실제 HTTP envelope/초대409/NULL guest·member UNIQUE 4개만 검증한다. 문서 연결은 일회성 검사로 분리한다. T00은 제품 변경이 없으므로 제품 기능 RED→GREEN을 주장하지 않는다. 신규 기능의 RED→GREEN은 각 후속 담당이 검증한다.
- 계획의 T00 마이그레이션 생성과 “서비스/화면 출력” 문구는 소유 경계에 맞춰 통합 담당 migration·후속 서비스 작업으로 정정 해석한다. 자동 completed 재가입 허용, guest user NULL 공유, 개인 보강과 취소 대체편성 혼합은 현행 구현 결함/확장 대상이며 호환 필드 의미와 구분한다.
- 카메라 DEV01은 원인 미확정이며 이 계약으로 수정법을 확정하지 않는다. 즉시 고정형 마지막 정규 회차 종료는 출석/회차/부모/효과를 한 커밋으로 완료하고 이후 FE 클래스 목록·상세·회원 상세를 무효화한다. rolling·취소·보강만 남음 여부로 자동 완료하지 않는다.

## T10 화면 연결 가산 계약

- 회차 capability에 `undo_excuse`, `cancel_makeup`, `guest_entry` bool을 가산한다. 각각 현재 본인의 사전 결석 복귀, 유효 예약 취소, 비회원의 현재 회차 자격 교환 가능 여부이며 서버의 실제 상태·권한·정원 검사에 따른다. 기존 `excuse`와 `request_makeup` 의미를 바꾸지 않는다. 취소된 대상의 유효 예약은 취소 UI용으로 표시하되 출석·보강 집계에서는 제외한다.
- 공개 코드 확인 성공 응답에 현재 `revision`만 가산해 아직 가입하지 않은 로그인 사용자의 대기 명령에 사용한다. 멤버/개인정보를 추가하지 않으며 충돌 시 다시 코드 확인 후 새 명령을 만든다.


## 최종 통합 리뷰 보완 계약 (2026-10-19)

- 정상 종료한 회차의 본인 `GET /sessions/{sid}/entry-state`와 `POST /sessions/{sid}/checkin`의 `phase=after`는 completed 멤버에게도 허용한다. 로그인 본인 또는 기존 유효 class_entry로 소유를 확인한다. left/removed, 철회·제거·superseded 참가행, 타인 요청은 계속 차단한다. 이 예외는 before 체크인·새 입장·WS·미디어 자격으로 확대하지 않는다.
- `GET /classes/{id}/sessions`의 회차 DTO에 `participation_version: int|null`을 가산한다. `correct_attendance=true`인 회차만 실제 버전을 제공하고 나머지는 null이다. 출석 정정 UI는 이 값을 최초 명령에 고정해 응답 유실 재시도에도 같은 본문을 보낸다. 전체 `/participation` 읽기 권한은 기존 회차 host 한정으로 유지한다.
- 유효 reserved/completed 보강의 원결석을 absent/excused 밖으로 변경하는 사전 결석 복귀·직접 입장·강사 정정·명시 재초대는 409 `makeup_source_in_use`다. 응답에는 `assignment_id,assignment_status`를 제공한다. reserved는 명시 취소 후 변경할 수 있고, completed는 기존 감사·예약을 자동 변조하지 않고 충돌로 유지한다.
- 탈퇴·제외는 위 충돌로 차단하지 않는다. 유효 보강의 원본 excused는 원결석으로 보존하는 예외를 두고, 멤버 자격·entry_ver 회수와 대상 미래행 철회는 기존대로 처리한다. 비활동 멤버는 입장·정원·새 예약에서 제외하며 재가입/복구 뒤에도 원결석 이력은 유지한다. 복구한 본인은 withdrawn인 미입장 대상의 reserved 예약도 기존 서버 조건대로 명시 취소할 수 있고 cancel_makeup capability를 제공한다. 이탈 후 미래 원행이 excused로 남을 수 있으므로 화면은 멤버 상태·참여 범위를 함께 해석해야 한다.
- 미배포 057의 기존 참가행 backfill은 두 consent_override를 true로 설정한다. 056 이전에는 회차 선택과 기본값 사본을 확정 구분할 수 없으므로 ResearchConsent·선택 이력·거절·철회·증빙 없는 값까지 보수 보존한다. 신규 참가행 DEFAULT는 false이며, 기존 회차 동의로 클래스 가입 연구 동의·origin을 추정하지 않는다.
