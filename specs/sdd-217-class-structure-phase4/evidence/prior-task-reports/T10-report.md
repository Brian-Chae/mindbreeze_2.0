# T10 구현 보고 — 회원·호스트 운영과 비회원 공개 가입

승인된 SDD-217 T10/R5/V28~31,V38을 `mindbreeze_2.0-sdd217`에서 수행했다. T10-base 상태와 기존 담당 파일을 보존했다. 전역 CSS·모델·마이그레이션·기존 회차 입장 계약 변경, 하위 에이전트, 커밋·푸시·배포 없음. 모든 sibling 변경/캐시 생성 테스트는 한국어 사유의 require_escalated로 실행했으며 승인 거절·우회 없음. 프런트 중심 작업 중 발견한 BE 읽기 계약 공백만 root가 명시 승인한 범위에서 보완했다.

## 변경 파일 17개

1. `frontend/src/pages/client/member-classes-page.tsx`: 기존 신청 시트 유지. 서버 membership 상태에 따른 참여/대기/완료/이탈 그룹과 상태 배지. 코드 확인→기존 로그인 join 또는 명시 waitlist. resolve의 실제 revision만 사용하며 미수신 시 대기 비활성, stale 시 코드 다시 확인.
2. `frontend/src/pages/client/member-class-detail-page.tsx`: 기존 개요/회차/입장 링크 유지. 본인 membership이 있는 상세에 개인 운영 패널 가산. 계정/역할/클래스 전환별 화면 분리.
3. `frontend/src/components/class/structure/member-class-views.tsx`: 기존 스타일 범위 안에서 개인 멤버십 배지·대기 순번과 공통 한글 상태 표시. 기존 카드/진행 의미 유지.
4. `frontend/src/components/class/structure/class-members-panel.tsx`: 기존 회원 선택기·회원 초대·이메일 초대/재발송 유지. 새 상태 라벨·서버 capability로 운영 패널 연결. 성공 후 기존 읽기 공유 무효화 호출.
5. `frontend/src/components/class/structure/member-operations.tsx` 신규: 본인 대기 취소/탈퇴/재가입, 개인 출석·참여 전·회차 취소/보강 배지, 사전 결석/복귀, 개인 보강 예약/취소, 선택 동의 부분 저장, 별도 사유 필수 연구 명시 철회. 승인 report ID만 기존 GET으로 읽고 기존 ClientReportViewer 재사용. guest 활동·읽기 헤더 분리와 지정 회차 입장 교환.
6. `frontend/src/components/class/structure/host-member-operations.tsx` 신규: 상태 필터·회원 선택, 참여 해제/복구/FIFO 승격, 출석 정정, 개인 보강 배정, guest 미리보기→충돌 확인→직접 동일인 확인→fingerprint 병합, 본인 확인 사유가 있는 10분 단회 복구 발급/숨김/만료, 공개 코드 회전. 관리자의 임상 동작은 서버 capability가 없으면 표시하지 않는다.
7. `frontend/src/components/class/structure/membership-operation-state.ts` 신규: 동기 lock으로 연속 클릭 차단, 요청 의미/버전별 UUID operation key와 통신 재시도 재사용, 계정/역할/인증 변경·언마운트 후 응답 폐기, 성공 후 shared invalidation, 401/403/409/정원/통신 오류 한글 안내.
8. `frontend/src/pages/client/guest-class-membership-page.tsx` 신규: 로그인 불필요 공개 가입·명시 대기, 클래스 코드+이름/성별/생일/이메일 네 필수 개인정보, 세 선택 동의 기본 false, 단회 복구 교환, 자격 갱신/로그아웃. 입력·장기 자격은 메모리만 사용하며 URL/로그/operation 원문·브라우저 저장소에 남기지 않는다. 브라우저 새로고침 후에는 본인 확인 복구가 필요함을 화면에 명시했다.
9. `frontend/src/App.tsx`: 공개 `/class-members/:classId` lazy route. 기존 로그인 회원 경로와 guard 유지.
10. `frontend/src/lib/api/class-operations.ts`: 기존 API 보존, 신규 멤버십/출석/보강/동의/guest/병합/복구/회전 DTO·실제 호출. 신규 member UUID와 기존 초대의 user UUID를 구분. guest는 skipAuth+X-Class-Member-Credential이며 기존 GET /reports/{id} 재사용.
11. `frontend/src/lib/api/class-structure.ts`: membership/개인 집계/추가 capability의 가산 타입.
12. `frontend/src/lib/api/class-code.ts`: 공개 resolve의 optional revision 가산 타입. 구 응답에 임의 0을 대입하지 않는다.
13. `frontend/src/hooks/use-class-structure.ts`: 기존 generation/AbortSignal·공유 요청·T06 invalidation을 사용하는 본인 membership/attendance hook. guest는 로그인 부재에서도 헤더 자격으로만 읽는다.
14. `frontend/tests/sdd217-member-operations.test.tsx` 신규: 실제 API wrapper+fetch 경계 DOM 17개.
15. `backend/app/services/class_read_service.py`: root 승인 최소 BE 연계. `_decorate_my_actions`와 본인 membership/attendance 연결에서 아래 explicit capability 가산.
16. `backend/app/services/class_code_service.py`: 성공한 resolve_class_code 제한 응답에 revision만 가산.
17. `backend/tests/pg/test_sdd217_read_access.py`: 기존 T09 22개 보존, T10 PG/HTTP 5개 추가.

## BE 계약 가산 위치와 의미

- `class_read_service.py:_decorate_my_actions`(현재 511행부터): 각 본인 회차 capabilities에 `undo_excuse`, `cancel_makeup`, `guest_entry` bool. 기존 `excuse`와 `request_makeup` 의미는 유지한다. 동일 함수의 요약을 `get_my_membership` capabilities에도 가산한다. `get_my_attendance`는 현재 guest grant scope를 검사해 활동/읽기 동작을 분리한다. 기존 class detail/sessions 가산 경로도 같은 본인 DTO를 받는다.
- `undo_excuse`: 현재 활동 주체·active 멤버/클래스·미시작 미래 excused·미입장·유효 canonical 참가행·정원. 기존 `eligible_participant`/`check_capacity` 재사용. 읽기 grant에는 false.
- `cancel_makeup`: 현재 활동 주체의 유효 reserved assignment/참가행·미입장·대상 미시작 및 기존 cancel 허용 상태(ready/scheduled/open/cancelled). 로그인 completed 본인의 실제 허용도 보존한다. 읽기 grant에는 false. 다른 새 예약 가능성이 없어 request_makeup=false여도 취소는 가능하다.
- `guest_entry`: 현재 guest 자격에서 활동 active 또는 읽기 completed+fixed의 유효 개인 보강/명시 취소 대체이며 open/in_progress·정원·유효 참가행을 확인한다. 로그인 DTO는 false, left/removed/read-active는 false. FE는 이 flag로만 교환 버튼을 표시한다. 입장 자체는 기존 실제 guest-entry 서비스가 잠금 안에서 다시 검증한다.
- 취소 대상의 유효 예약은 개인 집계에서 계속 제외한다. 다만 실제 취소 API가 허용하는 남은 reserved assignment는 회차 makeup DTO에 표시하여 취소 버튼에 필요한 assignment ID를 제공한다. 새 집계/가짜 보강 완료를 만들지 않는다.
- `class_code_service.py:resolve_class_code`(현재130행): `{class_id,title,sessions,next_session,revision}`. 기존 코드 검증/active 한정/시도 제한/공개 메타만 유지한다. 회원·연락처·내부 정보 추가 없음. 최종 api-contract.md 동기화는 root 소유다.

## RED/GREEN과 검증

- 신규 회원/guest 핵심 6개는 빈 화면에서 버튼·필수 입력 부재로 6 failed RED(`T10-red.log`)→6 passed. 최초 잘못된 cwd 및 인증 메서드 오타 실행은 제품 RED로 집계하지 않았다.
- 이후 통신 멱등 재시도/계정 전환/동의 부분 입력/서버 별도 capability/로그인 대기/호스트/guest 복구 등 확장 회귀를 추가해 최종 직접 **17 passed**. 확장 항목 전부의 개별 선행 RED를 주장하지 않는다. 코드 가입 첫 실행의 export 부재 오류도 UI assertion RED로 확대하지 않는다.
- BE capability3개와 공개 revision은 필드 부재로 **4 failed RED**(`T10-be-red.log`)→4 passed. 완료 취소대체 fixture의 session_kind 누락은 실제 계약에 맞춰 수정했으며 제품 결함으로 집계하지 않았다.
- 마지막 자체점검: 취소된 대상 예약을 취소할 수 없는 읽기 공백 **1 failed RED**(`T10-cancel-red.log`)→관련 PG40 passed.
- 관련 FE 첫 확장 실행184개에서 신규1(코드가입 패널이 기존 오류 재시도 버튼 앞에 위치)·기존3(wizard route mock) 실패를 확인했다. 신규1은 패널을 읽기 상태 뒤로 옮겨 고쳤다. 기존3은 T10 이전 App을 별도 `.t10-baseline-app.tsx` 사본으로 실행한 임시 테스트에서도 정확히 재현했다(`T10-baseline-nav.log`: 3 failed/3 passed/113 skipped). 원본 파일 reset·기존 변경 수정 없이 임시 두 파일만 제거했다. 실패명은 counselor `/classes/new → wizard`, org_admin 동일, 레거시 `/sessions/new → /classes/new`다.

최종 명령(각 해당 cwd):

```bash
# frontend — T10-fe-final.log
npx vitest run tests/member-class-structure.test.tsx tests/host-class-structure.test.tsx \
 tests/class-structure-data.test.ts tests/sdd216-operations.test.tsx \
 tests/sdd216-entry-code.test.tsx tests/sdd217-member-operations.test.tsx
# 6 files / 91 passed (직접17 포함)

# frontend — T10-build.log
npm run build
# tsc -b + vite build PASS. 기존 ineffective dynamic import/큰 chunk 경고.

# backend — T10-be-regression-pg.log
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_read_access.py \
 tests/pg/test_sdd216_http.py tests/pg/test_sdd216_access.py \
 tests/pg/test_sdd216_observer.py -q --tb=short
# 40 passed / 기존 crypt warning1

# backend — T10-be-regression-sqlite.log
DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd217_read_access.py tests/test_sdd214_read_api.py \
 tests/test_sdd216_capabilities.py tests/test_sdd216_read_followup.py \
 tests/test_report.py -q --tb=short
# 77 passed / 기존 crypt·argon2 warning2
```

`git diff --check` PASS. 기존 전체 BE·FE를 반복/통과했다고 주장하지 않는다. 실제 환경파일·자격증명은 읽지 않았으며 합성 로컬 PG만 사용했다.

## Verify·T11 인계

- **V28 DOM**: 대기 취소/탈퇴/재가입/사전결석/복귀/보강취소와 호스트 정정 등 actual wrapper 요청·revision·participation version·멤버 ID. 403/409/통신 실패·최신 내용 재조회·같은 operation key 재시도. FE DOM은 fetch 합성 응답을 사용하며 실제 서버 성공 증거와 구분한다.
- **V29 DOM**: 동기 연속 클릭 쓰기1건, 계정 전환 뒤 늦은 이전 응답 미표시. route/class/credential별 컴포넌트 경계와 AbortSignal을 전달한다.
- **V30**: 개인/클래스/참여 전/취소/보강 상태 표시와 기존 반응형 컴포넌트 재사용. **실제 4뷰포트 넘침·클리핑은 미측정**.
- **V31**: 기존 초대 유지 및 새로운 실제 API wrapper 연결까지. **API 연결 브라우저에서 서버 반영 확인은 T11 필요**.
- **V38**: DOM의 신규가입 기본false/공개Authorization미첨부·장기헤더만전송/복구교환·갱신·로그아웃 경계17개에 포함. 실제 양쪽 옛 자격 회수→강사 단회복구→본인 과거 리포트와 수료 보강 여정은 T07/T09 PG 증거와 T11 브라우저 증거를 함께 판정해야 한다. T10이 실제 브라우저 성공을 주장하지 않는다.
- T11에는 root의 별도 `sdd217_browser` DB/Redis 환경을 사용한다. T10이 서버/브라우저 fixture를 시작하거나 공유 PG를 재시작하지 않았다.
- 안정된 UI 진입: `/app/classes` 코드 가입·대기, `/app/classes/:id` 개인 운영, `/classes/:id?tab=members` 기존 초대/새 운영, `/class-members/:id` 공개 guest. 폼 label/aria-label은 테스트에서 그대로 사용한다.
- 호스트 수정에는 `멤버 운영 사유`, `운영 대상 멤버`, `출석 정정 회차`, `보강 원/대상 회차`, `병합 원본/대상 비회원`이 있다. 복구 토큰은 사용자 UI output에만 일시 표시하고 URL·로그·operation 결과 저장을 금지한다. guest 단회복구는 `단회 복구 코드` password 입력으로만 교환한다.
- 기존 회차 자격을 교환한 뒤 기존 saveEntry/EntryPage 경로를 재사용한다. 새 장기 자격은 브라우저 저장소에 저장하지 않는다. guest 알림 opt-in은 저장 선택이며 실제 알림 전달 채널은 T08의 기존 제한을 유지한다.

## 최종 리뷰 범위

root의 최초 `T10-review.diff`836줄/17파일 이후 마지막 제품 변경은 **class_read_service.py의 취소 대상 reserved assignment 표시와 valid guard**, 테스트는 **동일 T09 PG 파일의 `test_t10_cancelled_target_keeps_cancellable_reservation_without_counting_it`1개**다. 이후 제품 변경 없음. 이 보고서와 최종 로그는 로컬 계획 산출물이다. 독립 리뷰와 T11 실브라우저 검증·최종 승인은 root/Brian 소유다.

## 독립 리뷰 수정 fix1/5 — Important 4건

이번 수정은 FE 제품6파일과 기존 T10 테스트1파일, 이 보고서에 한정했다. `T10-fix1-base`의 기존 제품 파일을 보존했다. BE/모델/마이그레이션 변경·BE 테스트 반복·전역 CSS 변경·하위 에이전트·커밋·푸시 없음. receiving-code-review와 TDD·완료 전 검증을 적용했다.

### 원인과 최소 수정

1. **복구 코드의 대상 경합** — `host-member-operations.tsx`: A 복구 요청 후 선택 변경 effect가 화면만 지우고 늦은 A 응답을 막지 못했다. 계정/역할/클래스별 state 경계를 두고, 선택마다 증가하는 generation과 member ID를 요청에 고정한다. 현재 선택 ID와 generation이 모두 일치하고 operation의 원래 scope가 살아 있는 결과만 코드를 표시한다. A→B→A도 이전 요청으로 돌아가지 않는다. 복구 응답의 화면 갱신은 operation의 scope 검사를 통과한 뒤 실행한다.
2. **응답 유실 뒤 출석 재시도** — `membership-operation-state.ts`, `member-operations.tsx`, `host-member-operations.tsx`: 같은 operation key로 재시도하면서 participation GET을 다시 해 본문이 달라졌다. 최초 MemberCommand(operation key/revision/reason)와 성공한 준비 조회의 participation version을 메모리에서 함께 고정하고 같은 의미의 재시도에 재사용한다. 자동 읽기 갱신으로 revision이 바뀌어도 기존 요청 본문은 유지한다. 준비 GET 자체가 실패한 경우에는 아직 POST를 보내지 않았으므로 준비 조회만 다시 할 수 있다. 사용자가 명시적으로 최신 내용을 다시 불러오면 reset 후 새 명령으로 시작한다.
   - 다른 동적 본문도 점검했다. 비회원 재가입 code와 연구 철회 reason은 명령 signature에 가산했다. `member-classes-page.tsx`의 로그인 코드 가입/대기도 class ID+code를 signature에 포함하고 명시 코드 확인 시 reset한다. 기존 보강 source/target, host 대상/정정 action, 동의 선택, 병합 fingerprint·사유는 이미 signature에 포함된다. raw credential/operation을 저장소에 기록하지 않는다.
3. **수료 후 유효 읽기 자격 차단** — `use-class-structure.ts`, `member-operations.tsx`, `guest-class-membership-page.tsx`: 읽기 훅에 HTTP errorStatus를 가산하여 실제 활동 자격의 401만 부모에 알린다. 남아 있는 읽기 자격으로 전환한 뒤 서버의 읽기 capability로 과거 리포트·수료 지정 보강을 제공한다. 원래 쓰기를 읽기 토큰으로 자동 재전송하지 않는다. 자격 갱신/로그아웃도 실제 활동401일 때만 읽기 자격으로 한 번 시도하고, 갱신 성공의 새 bundle을 반영한다. 읽기도 무효하면 오류를 그대로 표시한다. 403/503/통신 실패를 자격 변경으로 해석하지 않는다.
4. **새 가입자의 동의 선택 오염** — `guest-class-membership-page.tsx`: 자격 수락과 로그아웃 때 새 가입 초안의 report/research/reminder 및 대기 선택을 false로 초기화하고 가입 operation도 비운다. 계정/클래스 경계는 기존 key 재마운트로 초기화한다. 기존 회원의 서버 동의 설정은 새 가입 초안과 분리된 상태를 유지한다.

### 실제 컴포넌트 RED → GREEN

`T10-fix1-red.log`의 첫8개 중 **6 failed RED + 2 passed**:

- A 복구→B→A 선택 뒤 늦은 복구 코드가 표시되는 결함1개.
- 본인/호스트 출석 응답 유실 뒤 revision/participation/body가 달라지는 결함2개. 본인 케이스는 자동 focus 읽기로 서버 revision도 바꾼다.
- completed guest 활동401 뒤 유효 read로 본인 리포트·지정 회차를 읽지 못하는 결함1개.
- 활동401 갱신이 읽기 자격으로 이어지지 않는 결함1개.
- A 선택동의 true→로그아웃→B 실제 가입 POST에도 true가 전송되는 결함1개.
- 403/503 갱신을 자동 fallback하지 않는2개는 원래부터 PASS인 경계 검사다.

수정 후8개 GREEN, 추가 경계6개(명시 새 명령/사유 변경/읽기403·503 비전환/복구 계정·클래스 전환)를 포함해 **직접31개 포함 관련105개 PASS**. 추가 경계6개 전부의 개별 선행 RED를 주장하지 않는다. `T10-fix1-green.log`는 후속 계정·클래스2개 추가 전29 passed이며 최종105개의 로그는 아래다.

최초 GREEN 호출은 repo root에서 npx --prefix를 써 백업 테스트 사본까지 수집했고, 실제8개 PASS와 별도로 백업의 의존 파일 부재 suite오류가 있었다. 올바른 frontend cwd에서 재실행해 제외했다. 초기 타입 검사는 nullable bundle 좁히기1개를 발견했고 명시 current guard로 고친 후 최종 build의 tsc를 통과했다. 이 두 하네스/타입 중간 실패를 제품 GREEN으로 계산하지 않는다.

```bash
# cwd: mindbreeze_2.0-sdd217/frontend
npx vitest run tests/member-class-structure.test.tsx tests/host-class-structure.test.tsx \
 tests/class-structure-data.test.ts tests/sdd216-operations.test.tsx \
 tests/sdd216-entry-code.test.tsx tests/sdd217-member-operations.test.tsx
# T10-fix1-regression.log: 6 files / 105 passed (3.70s), 직접31 포함

npm run build
# T10-fix1-build.log: tsc -b + vite build PASS (2.11s build)
# 기존 ineffective dynamic import·큰 chunk 경고 유지
```

최종 `git diff --check` PASS. fix1에서 새 기준선 실패는 없다. 최초 T10의 wizard3개 기준선은 이번 fix1 범위에서 재실행/수정하지 않았다. 실제 브라우저/API 연결 여정과4뷰포트 검증은 여전히 T11 소유이며 DOM 증거를 실브라우저 증거로 확대하지 않는다. BE는 수정하지 않아 원래 PG40/SQLite77 결과를 fix1 재실행 결과로 주장하지 않는다. 마지막 제품 변경은 guest 자격 전환의 nullable current guard이며, 이후 계정·클래스 회귀2개와 이 보고서만 추가했다. 독립 재리뷰가 남는다.
