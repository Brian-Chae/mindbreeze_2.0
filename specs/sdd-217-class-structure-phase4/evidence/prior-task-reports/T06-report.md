# T06 구현 보고 — 즉시 종료 원자성·화면 갱신

- 승인 범위: SDD-217 T06 / R6 DEV-03 / NV-09~12. 경로 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`만 수정. 하위 에이전트·스키마 변경·커밋·푸시·배포 없음. 시작 시 존재하던 T00~05 변경을 보존했다.
- TDD, systematic-debugging, verification-before-completion 절차 적용. root 지시에 따라 전체 BE 반복 실행은 하지 않았다.

## 원인과 구현

1. `backend/app/services/session_service.py`: 기존 종료는 `parent.recurrence_rule`이 있는 경우에만 `finish_class_if_due`를 호출해, 실제 `_attach_parent`가 만든 SQL NULL 규칙의 즉시 1회차 클래스가 active로 남았다. 기존 helper 호출을 **정규 회차의 정상 end**에 연결했다. 상태 CAS·T03 `finalize_attendance`·부모/회원 수료·ClassEffect 수료 의도 저장이 같은 commit에 들어간다. 이 구간 예외는 명시 rollback하여 호출자가 즉시 재조회할 수 있다. 커밋 뒤의 기존 T03 participant/terminal WS·미디어 후처리 경로는 유지했다.
2. 같은 파일: 현재 권한과 기존 User→Class→members→sessions 잠금을 재확인한 뒤, 이미 completed인 클래스 회차의 end 재시도는200 읽기로 반환한다. 상태/시각/버전/출석/수료 의도 및 미디어·이벤트 후처리를 다시 실행하지 않는다. restrict_from을 명시한 호출은 이 예외에 포함하지 않는다. 다른 전이의 기존400/409 의미는 보존한다.
3. `backend/app/services/class_rolling_service.py`: fixed 수료는 정규 회차 중 completed가 최소1개이고 나머지도 completed/cancelled인 경우로 제한한다. 전체 취소는 자동 수료가 아니다. 정상 종료 트리거를 정규 end로 제한하므로 취소나 makeup end만으로 새 부모 수료를 만들지 않는다. rolling은 기존 명시 ends_on 판정을 유지하고 미래 회차0개만으로 완료하지 않는다. mixed completed/cancelled의 마지막 정규 정상 종료는 기존 settled 의미대로 허용한다. 이 해석은 root가 승인했다.
4. `frontend/src/hooks/use-class-structure.ts`: 기존 요청 공유·AbortController·계정/부모 수명 가드를 재사용한다. 클래스 목록/상세에만 읽기 revision을 더해 새 GET을 실행한다. 별도 데이터 캐시나 상태 추론은 만들지 않았다.
5. `frontend/src/lib/class-structure/invalidation.ts` 신규: 최소 revision 구독과 창 focus/visible 복귀 재조회. 마지막 구독 해제 시 DOM 이벤트도 정리한다.
6. `frontend/src/lib/api/session.ts`: 실제 end/cancel API 성공 뒤 클래스 읽기를 무효화한다. 실패 시 갱신/완료 추정 없음.
7. `frontend/src/hooks/useSessionLiveSocket.ts`: 현재 session_id 및 기존 version 가드를 통과한 completed/cancelled 이벤트만 읽기를 무효화한다. T04의 회수·heartbeat·버전 가드를 보존한다. API/실시간 훅 추가 연결 범위는 root가 승인했다.
8. 신규 테스트 `backend/tests/pg/test_sdd217_completion.py`, `frontend/tests/sdd217-completion.test.tsx`.
9. 이 보고서. 연계 `host-class-views.tsx`는 기존 부모 status를 직접 표시하고 완료 시 회차 진입 CTA를 내리는 동작이 이미 있어 수정하지 않았다. 실제 NextClassView DOM을 테스트에서 실행했다.

## RED → GREEN

- PG 최초 유효 RED: **5 failed,3 passed**. 부모 active 유지, end 재시도400, 수료 의도 실패 훅 미실행, all_cancelled 오판, 두 연결 후행 end400을 확인했다. 취소/makeup에 기존 completed 정규 이력을 추가한 유효 RED는 **3 failed,1 passed,4 deselected**로 취소·보강 트리거 오판도 확인했다. 최소 구현 후 신규 **8 passed**.
- FE 실제 공통 훅/API/WS/NextClassView 통합 단위 RED: **4 failed,3 passed**. 호스트/회원의 열린 목록상세·focus 복귀·유효 terminal WS에서 active가 유지됐다. 연결 후 **7 passed**. 지연 HTTP 폐기·cancelled 부모 상태 보존 추가 경계검증까지 최종 **9 passed**.
- 추가 실제 HTTP 증거: TestClient에서 실제 sessions/classes 라우터와 response_model, PG를 실행해 end200→재시도200→호스트·회원 상세/목록 completed를 검증. **1 passed,8 deselected**. 실제 브라우저 증거로 계산하지 않았다.
- 테스트 준비 오류는 제품 RED에서 제외했다: 처음 backend cwd에 backend/tests를 중복 지정해 no tests ran. ClassEffect의 실제 필드는 kind였으며 초기에 effect_type으로 잘못 작성했다. 경합 테스트 준비가 서비스의 선행 기관 권한 잠금보다 Class 잠금을 먼저 잡아 합성 deadlock을 만든 경우는 실제 서비스 순서로 정정했다. 추가 회차 fixture의 지역변수/필수 duration 필드 오류도 정정 후 유효 RED만 위에 집계했다. 즉시 규칙은 JSON null이 아닌 실제 생성 경로와 같은 SQL NULL을 사용했다.

## 실행 명령·검증 결과

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_completion.py \
 tests/pg/test_sdd217_attendance.py tests/pg/test_sdd217_makeup.py \
 tests/pg/test_sdd216_lifecycle.py -q --tb=short
# 82 passed,5 warnings in 16.71s (신규 HTTP 1개 추가 전)

# 같은 PG 환경·Python으로 신규 HTTP만 추가 실행
# -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_completion.py -k real_http -q --tb=short
# 1 passed,8 deselected,1 warning in 1.15s

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_session.py tests/test_sdd088_open_flow.py \
 tests/test_sdd209_i2_entry_times.py -q --tb=short
# 40 passed,2 warnings in 8.04s

cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/frontend'
npx vitest run tests/sdd217-completion.test.tsx tests/class-structure-data.test.ts \
 tests/host-class-structure.test.tsx tests/member-class-structure.test.tsx \
 tests/class-player-page-live.test.tsx tests/sdd217-presence-socket.test.tsx \
 tests/class-flow-host-ending.test.tsx tests/class-flow-member-end.test.tsx
# 8 files,129 passed (종료 전 지연응답/cancel WS 경계2개 추가 전)
npx vitest run tests/sdd217-completion.test.tsx
# 9 passed (추가 경계2개 포함 최종 신규파일)
npx tsc -p tsconfig.app.json --noEmit
# exit0
```

PG5 warnings는 기존 crypt와 T03 실제 loopback WebSocket/uvicorn 의존성 deprecation이다. SQLite2 warnings도 기존 crypt/argon2 deprecation이다. 새 제품 실패·기준선 실패 없음. 기존 venv는 실행만 했고 실제 서비스 환경파일·자격증명은 사용하지 않았다. scratch_db는 독립 빈 DB마다 upgrade head하고 fixture가 해당 DB만 정리했다. 공유 PG 시작·중지 없음.

## Verify 대응·검증 한계

- **NV-09 PASS(PG)**: 종료 commit 직후 부모/회차 completed·회원 completed_at·미입장 absent·출석감사1·수료의도1. 수료의도 INSERT 실패 시 이전 상태/두 버전/시각/감사/의도 전체 rollback. 실제 기존 종료 helper 재사용, cron 불필요.
- **NV-10 API/DOM PASS, 실제 브라우저 미검증**: 실제 HTTP end 직후 호스트/회원 목록상세 완료200. 실제 공통 훅의 성공 API·유효 WS·focus 복귀 재조회와 실제 NextClassView 완료 문구/CTA 제거를 jsdom에서 검증. 종료 전 지연 응답은 완료를 덮지 않는다. T11에서 실제 종료→상세 복귀와 이미 열려 있던 상세의 탭/창 복귀를 확인해야 한다.
- **NV-11 PASS(PG 두 연결)**: 독립 migrated DB의 두 실제 연결. 선행 서비스와 같은 기관권한/User/Class/members/sessions 잠금 소유 후 후행 종료의 실제 FOR 잠금 시도·대기를 Event로 확인했다. 선행 end commit 뒤 후행200. 최종 class revision2/session state1/participation1/출석감사1/수료의도1, 시각 불변. 단순 스레드·목 대기만으로 동시성을 주장하지 않는다.
- **NV-12 PASS(PG/DOM)**: 미래 회차가 없는 rolling active 유지, 마지막 cancel과 makeup end로 새 부모수료 없음, all_cancelled helper false. DOM은 서버 부모 active/cancelled를 완료로 추론하지 않고 cancelled WS도 실제 부모 active를 재조회한다. 기존 fixed/rolling 명시종료일 lifecycle 회귀 통과.
- **T03 유지**: attendance 전체 관련 회귀에서 정상 완료의 실제 loopback WebSocket terminal 상태·오디오 stop 후 룸 정리, removed 회수 경로 모두 통과했다. 외부 LiveKit SDK는 기존 테스트 경계 대역이며 실제 미디어·분산 WS 검증은 아니다.
- **T05 유지**: 전체 makeup 관련 회귀에서 completed replacement 실제 입장 및 두 연결 좌석 검증 통과. 수료 회원의 일반 활동권한을 넓히지 않았다.

## 후속 인계

- **T11**: NV-10 실제 브라우저 증거 및 이미 열려 있던 탭/상세 복귀 확인. jsdom PASS와 혼동하지 않는다. 실제 외부 LiveKit·여러 WS 워커·알림 전달도 본 태스크에서 검증하지 않았다.
- **T09 (root에 전달 완료)**: 기존 `class_read_service._class_access_ids`는 ClassMember.status==active만 읽기 범위에 넣는다. recurrence_rule이 있는 정규 클래스 수료 뒤 completed 회원의 목록/상세 이력이 사라질 수 있다. 즉시 클래스는 SQL NULL 규칙의 legacy participant 읽기로 NV-10이 통과한다. completed의 역사 읽기와 활동 자격을 구분하는 계약은 T09 소유이므로 추가 구현하지 않았다. 본 태스크가 정규 수료 회원 이력 접근까지 해결했다고 주장하지 않는다.
- 독립 코드 리뷰와 최종 통합은 root 소유다. 본 구현자가 자기 리뷰 승인을 주장하지 않는다.

## 독립 리뷰 수정 round 1/5 — Important 1건 (자동 재조회가 미저장 입력을 지우는 문제)

기준 `.superpowers/sdd/plan/T06-fix1-base` 이후의 수정이다. T06 spec 리뷰는 PASS였고 품질 리뷰의 이 finding만 수정했다. BE·스키마 변경이 없어 BE/PG를 반복하지 않았다. 하위 에이전트·커밋·푸시·배포 없음.

### 원인·수정

- focus/visible 무효화는 요청 key를 변경한다. 기존 훅은 즉시 success→loading을 반환해 ReadStateView가 설정·편성·초대 패널을 unmount했다. 조회가 끝나면 새 패널이 원본 값으로 mount됐다. loading 화면만 막아도 설정은 `useEffect([detail])`에서 동일 revision의 새 응답 객체마다 입력을 초기화했다. 편성은 `detail.revision`을 React key에 포함하여 새 revision 때 무조건 입력을 지웠다.
- 공통 읽기 훅은 **같은 계정·역할·클래스 리소스**의 마지막 성공 화면을 background GET 중에 유지한다. 계정/역할/부모 전환의 첫 render에는 이전 값을 표시하지 않는 기존 경계는 유지했다. 네트워크·5xx의 일시 재조회 실패도 편집을 유지하고, 상세 페이지는 오류와 재조회 버튼을 표시한다. 접근 거부 등4xx는 과거 화면을 유지하지 않는다. 이 성공 화면 보존은 클래스 읽기에만 적용하고 counseling 조회 의미는 넓히지 않았다.
- 설정은 dirty 입력이 있으면 새 detail 객체로 초기화하지 않는다. 작성 기반 revision을 별도로 유지하여 서버 revision이 달라지면 입력을 보관한 채 경고하고 저장을 차단한다. 사용자가 **입력 취소하고 최신 내용 불러오기**를 명시 선택하면 최신 서버 설정으로 다시 편집한다. 편집하지 않은 설정은 최신 서버 값으로 갱신된다.
- 편성은 계정·역할·클래스로 editor 생명주기를 고정한다. 변경 중인 행·시트·선택은 보존하고 작성 기반 revision으로 preview/write를 묶는다. 서버 revision 변경 시 기존 draft를 임의로 새 revision에 얹지 않고 preview/save를 차단한다. **입력 취소하고 최신 편성 불러오기**로 명시 초기화한다. 회차 추가 하위 경로에도 작성 기반 revision을 전달하므로 미저장 추가를 새 서버 revision으로 자동 재기반화하지 않는다.
- 초대 이메일과 열려 있는 회원 검색은 기존 패널을 유지하여 보존한다. 새로운 초대 입력 캐시나 별도 저장 기능은 만들지 않았다. 종료 성공·유효 terminal WS·창 복귀 재조회는 기존 T06대로 계속 실행된다.

### 변경 파일

1. `frontend/src/hooks/use-class-structure.ts`
2. `frontend/src/pages/classes/host-class-detail-page.tsx`
3. `frontend/src/components/class/structure/class-settings-panel.tsx`
4. `frontend/src/components/class/structure/class-schedule-editor.tsx`
5. 신규 `frontend/tests/sdd217-completion-drafts.test.tsx`
6. 이 보고서

### RED → GREEN 증거

실제 HostClassDetailPage·공통 조회 훅·실제 설정/편성/초대 컴포넌트를 실행했다. StructureShell의 외곽만 최소 대역으로 바꾸고 HTTP 경계만 대체했다. 브라우저 검증으로 계산하지 않는다.

- 최초 **5 failed,1 passed**: 보류한 focus 상세 GET 동안 기존 input.isConnected가 false, 서버 revision 변경 뒤 dirty 제목 덮어쓰기, 편성 시트/90분 소실, visible/focus 뒤 초대 이메일·검색 입력 소실, 연결 실패 뒤 편집 화면 소실을 재현했다. 변경하지 않은 설정의 최신 서버 값 갱신은 이미 PASS였다.
- 수정 후 동일6개 **6 passed**. 같은 revision의 새 detail 객체·진행 중 GET 모두 입력 보존. revision1에서 작성한 설정/편성을 서버 revision2에 임의 덮어쓰기하지 않는 것도 확인했다. 명시 초기화 뒤에는 최신 서버 값이 표시되고 수정한 설정 요청은 expected_revision2를 전송했다.
- 오류 보존의 접근 회수 경계를 추가 검증했다. 실제 ApiError403 뒤 과거 편집 화면을 유지하여 **RED1**. 보존을 네트워크·5xx로 한정한 뒤 접근 거부는 화면을 회수한다. 최종 신규 **7 passed**.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/frontend'
npx vitest run tests/sdd217-completion-drafts.test.tsx
# 최초 RED: 5 failed,1 passed → 1차 GREEN:6 passed
npx vitest run tests/sdd217-completion-drafts.test.tsx -t '접근 거부'
# 추가 RED:1 failed,6 skipped
npx vitest run tests/sdd217-completion-drafts.test.tsx tests/sdd217-completion.test.tsx \
 tests/class-structure-data.test.ts tests/host-class-structure.test.tsx \
 tests/member-class-structure.test.tsx tests/class-schedule-editor.test.tsx \
 tests/class-settings-instant.test.tsx tests/sdd216-operations.test.tsx \
 tests/sdd216-operation-settings.test.ts
# 9 files,91 passed in 3.88s, warning 없음
npx tsc -p tsconfig.app.json --noEmit
# exit0
```

최종 `git diff --check` PASS. 종료 후 재조회·기존 계정/부모 이동·초대·즉시 클래스 설정·편성 회귀도 위91개에 포함된다. NV-10 실제 브라우저 및 T09 정규 completed 이력 읽기의 기존 인계는 그대로다. 독립 재리뷰는 root 소유다.
