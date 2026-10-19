# T00 결과 — 기준선·API 계약

상태: 계약 문서·실제 기존 계약 기준선 완료. 신규 제품 기능·모델·migration 미구현. 커밋·push·PR·배포 없음.

## 변경 파일

- `specs/sdd-217-class-structure-phase4/api-contract.md` 신규(106행): 216 보존 계약, 신규 경로/입력/출력/오류/capability, 멱등·잠금, 보강/취소 대체편성 분리, guest canonical·자격·병합·단회 회복, O3 동의/철회·스크럽, participation_version·socket lease, 단일 migration 설계, R/Task/V/NV 연결.
- `backend/tests/test_sdd217_contract.py` 신규: 실제 기존 계약 4개. 미래 기능 존재 확인·mock 성공·문서 존재 검사를 제품 기능 통과 증거로 만들지 않음.
- 이 보고서만 추가. 사용자 지정 외 제품 파일 변경 없음.

## 검증

실행 명령(전용 워크트리 루트):

```sh
'/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest backend/tests/test_sdd217_contract.py backend/tests/test_sdd216_capabilities.py backend/tests/test_sdd216_read_followup.py -q
```

결과: **16 passed, 1 warning, 1.95초**. 계약 신규 기준선4개 + 기존 관련 읽기/capability 회귀12개. 경고는 passlib의 Python crypt 지원 중단 예고(기존 라이브러리)다.

4개 기준선:

1. 기존 code 가입 입력은 code만, 추가 operation_key 입력은 ValidationError. 보강 member_ids는 UUID 배열로 보존.
2. 실제 HTTP 초대 정원 초과409 class_capacity, 대기 회원 자동 생성 없음.
3. 실제 SQLite INSERT에서 두 guest NULL user_id 독립 및 (session_id,member_id) UNIQUE 확인. PG migration/경합 검증이 아님.
4. 실제 GET 상세 직접 객체·members envelope·nullable guest·sessions/total·기존 capabilities 보존.

일회성 문서 검사: 로컬 링크4개 정상. `git diff --check` 정상(신규 untracked 파일은 이 명령의 대상에서 제외됨). T00은 제품 변경이 없으므로 제품 기능 RED→GREEN을 주장하지 않는다. 처음 만든 문서 존재 검사는 루트 지시로 제거했으며 최종 기능 테스트 수에 합산하지 않았다.

작업 경로 오류1회: backend workdir에서 backend/tests로 중복 지정하여 파일 생성/수집 실패. 담당 경로 tests로 바로잡은 뒤 위 최종 실행 정상. 의도한 기능 RED로 계산하지 않는다.

## 실제 코드에서 확인한 설계 주의

- `ClassOperation.actor_id`는 users FK이므로 guest용으로 그대로 쓰면 안 된다. 기존 user actor+key 전역 UNIQUE 의미도 바꾸지 않는다. 별도 guest operation/공개 가입 operation 저장소 제안.
- `ensure_expected`의 기존 session/user_id 조회는 여러 NULL guest를 하나로 취급할 수 있다. T07에서 member_id/canonical 기준으로 교체해야 하며 기준선4개 통과가 이 결함 해결을 뜻하지 않는다.
- 기존 `join {code}`에는 operation_key가 없다. 강제로 필수화하지 않고 새 명령에만 적용한다.
- 보강 생성 member_ids는 실제 user ID다. 신규 class_member_ids를 별도 필드로 가산하고 동시 입력 거부. 기존 생성 서비스까지 같은 개인 보강 검증으로 연결해야 우회가 없다.
- 체크인 실근거는 SessionRecord.subjective_state의 participant.before다. WS waiting_room 입력만으로 체크인 완료를 확정하면 안 된다.
- 기존 session state_version과 새 participation_version을 혼용하지 않는다. 서버 snapshot/WS delta에서 같은 version 계약이 필요하다. DB 기반 30초 heartbeat/90초 lease로 재시작·다중 탭의 상태와 버전을 보존하는 설계다. 전체 서버 구현 완료 증거는 아님.
- 기존 class write User 선행 잠금을 감안하여 User→Class 선행이 필요한 호출은 유지하고 클래스 이후 User 잠금을 추가하지 않는다고 계약에 기록했다. 계획의 단순 Class 선행 규칙을 실제 코드에 무조건 적용하면 교착 위험이 있다.
- 기존 completed 명시 reinvite와 새 completed 코드 재활성화 금지는 별개다. 코드 재가입 금지는 유지하고 개인 보강 때문에 부모/회원 active를 만들지 않는다.

## 후속 소유·미검증

- 통합 담당만 056 다음 migration/공유 모델/API/schema를 수정한다. T00은 신규 테이블/컬럼 설계만 기록했다.
- 후속 서비스는 계약 문서의 경로/식별자/오류/DTO를 정본으로 사용하되 실제 구현 불가능/과대 사항은 변경 근거와 함께 통합 담당에게 조정한다.
- 신규 V01~39, NV01~12, migrated PG partial UNIQUE/FK·다중 연결 경합, 실제 BE 연결 브라우저·guest 복구·카메라·WS·LiveKit 회수·실제 전달은 이 태스크에서 검증하지 않았다.
- 개인 보강·동의철회·canonical 스크럽은 기존 read/report/export/retention 경로까지 연결되어야 한다. 새 endpoint만 만들면 요구 완료가 아니다.
- 시작 git status: specs/sdd-217-class-structure-phase4/ untracked. 종료: 이 폴더와 본인 신규 contract test만 untracked. .superpowers 보고서는 기존 ignore 정책 대상이다.

## 루트 리뷰 반영 — 읽기 자격과 재가입/완료 보강

- 초기 계약의 guest read-only 일반 제한이 left 재가입·completed 지정 보강까지 막는 모순을 해소했다. 일반 read 자격의 입장/WS/미디어/일반 쓰기 금지는 유지하고 별도 두 교환 경로만 명시했다.
- `POST /classes/{id}/guest-credentials/rejoin`: 유효 본인 읽기 자격 + code, left/active 클래스에서 정원/FIFO 검증 후 active 또는 waitlisted, 같은 member ID·새 scope grant. removed/completed 본인 재가입은 거부한다.
- `POST /classes/{id}/sessions/{sid}/guest-entry`: completed fixed 클래스·completed canonical 멤버·명시 reserved 보강·원결석·대상 participant·미입장·열린 회차·정원을 잠금 안에서 검사한 뒤 해당 회차 class_entry만 발급한다. 실제 입장/출석 훅을 거치며 부모/멤버 completed를 active로 바꾸지 않는다. left/removed는 이 교환을 사용할 수 없다.
- 자격 발급 원문은 operation 결과에 저장하지 않는다. guest-entry 동일 operation 재시도도 현재 읽기 grant·배정·현재 회차 접근을 재검사한다. 읽기 자격을 기존 WS/LiveKit 인증 수단으로 직접 받아주는 방식은 금지한다.
- 문서 계약 조정이며 신규 HTTP 서비스 구현/검증 완료 주장은 없다.
