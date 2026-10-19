# SDD-216 — FE 연결용 조회 보완

- 실행 근거: 전체 BE 회귀를 실행하지 않고 남은 구현을 빠르게 진행하라는 사용자 지시.
- 구현 전 기대값 기록. 기존 verify.md는 변경하지 않는다.
- 담당: BE 워커. 아래 구현 파일과 신규 테스트·이 문서·api-contract.md만 이번 커밋에 포함한다.
- DB 변경 없음. 기존 출시 준비 23파일은 별도 미커밋 상태로 보존한다. FE·push·배포는 실행하지 않는다.

| Task | 구현·독점 경로 | 완료 조건 |
|---|---|---|
| BF-T1 | api/v1/classes.py: 진행자 요청 조회, services/class_effect_service.py: 알림 request_id | 수락 대상자가 새 화면에서 요청을 식별. 관리자 전체, 일반 강사는 요청자/후보/현재 진행자인 요청만, guest는 지정 회차만 |
| BF-T2 | api/v1/classes.py: 이메일 초대 결과 조회 | 초대 권한자만 현재 pending/sent/failed 및 식별자 조회. 읽기 자체는 재발송하지 않음 |
| BF-T3 | services/class_read_service.py·schemas/class_parent.py: 현재 설정 반환 | record_video·chat_enabled·reminder_offsets를 DB 값으로 반환하여 편집 시 기본값 덮어쓰기 방지 |

## 구현 전 검증

| ID | 시나리오·기대값 | 도구·담당 |
|---|---|---|
| BF-01 | 진행자 요청 목록: 주강사/관리자 전체, 후보/요청자/현재 진행자 해당 요청, 관계없는 보조강사 빈 목록; 상태·만료·버전·ID 반환 | 실제 HTTP·SQLite pytest / BE |
| BF-02 | 회원·타 센터·정지·guest 다른 회차·숨김/다른 부모 회차 차단, 스위치 off 404 | 실제 HTTP·SQLite pytest / BE |
| BF-03 | 이메일 초대의 pending→failed→sent 변경을 재조회해 확인, 다른 클래스 제외, 초대 권한 없는 회원/타인 차단 | 실제 HTTP·SQLite pytest / BE |
| BF-04 | 진행자 요청 알림의 params.request_id가 DB 요청 ID와 일치 | 실제 효과 소비·Notification 조회 / BE |
| BF-05 | 클래스 상세의 세 설정값이 저장값과 일치, 목록 객체를 다시 읽어도 유지 | 실제 HTTP·SQLite pytest / BE |
| BF-06 | 기존 capabilities.schedule의 off/on × 4역할 유지 | 기존 test_sdd216_capabilities.py / BE |

- 먼저 신규 파일만 RED 실행, 구현 후 신규 파일+기존 capability 파일만 GREEN 실행.
- 테스트 파일: backend/tests/test_sdd216_read_followup.py. 전체 pytest·전체 수집·PG 전체 회귀 실행 금지. FK/마이그레이션/트랜잭션 변경이 없어 기존 PG 게이트를 재실행하지 않는다.
- 선택 테스트가 통과하면 추가 반복 없이 diff 검사·로컬 커밋. 전체 회귀 통과로 보고하지 않는다.

## 구현 결과

- BF-T1~3 구현. 두 GET 경로·알림 요청 ID·설정 세 필드와 API 계약을 추가했다.
- 신규 테스트 5개 RED: GET 405, request_id·record_video 누락. `read-followup-red.log`: 5 failed, 2.52초.
- 후속 테스트에서 숨김 클래스가 기본 조회에서 제외되어 테스트의 복원 코드가 실패했다. 제품 코드를 변경하지 않고 숨김 검증을 마지막으로 이동했다.
- 최종 선택 실행: 신규 5개+기존 capability 1개, **6 passed / 1 warning, 1.87초**. `read-followup-green.log`. 로그는 `.superpowers/sdd/plan/` 아래다.
- 실제 HTTP·SQLite·알림 DB 저장 검증. 외부 메일/푸시·PG·전체 회귀·배포는 이번에 실행하지 않았다. 경고는 crypt 의존성 폐기 예고다.
- 사용자 정책 결정 없음. FE 구현과 실제 서버 검증은 남아 있다.

## FE 연결 중 추가: 강사 선택 목록

- 구현 전 기록: 일반 지도사는 기존 기관 강사 목록 API를 사용할 수 없어 선택 화면이 막힌다. BF-T4는 `api/v1/classes.py`·동일 신규 테스트·API 계약만 담당한다.
- GET `/classes/instructor-candidates`: 편성 스위치 on, 활성 counselor/org_admin 및 현재 기관 소속 확인. 기본 현재 기관, 선택 `class_id`를 주면 그 클래스 관리 권한 확인 후 해당 기관. `instructors: [{id, name}]`만 반환한다.
- BF-07: HTTP 조회에서 같은 기관 활성 counselor만 포함, 관리자/회원/타 기관/정지 계정·소속 제외. 클래스 관리 권한 없는 사용자의 class_id 조회는 차단.
- BF-08: 회원·정지·기관 소속 해제·기관 비활성·스위치 off 차단. 테스트는 해당 두 함수만 RED, 구현 후 해당 두 함수만 GREEN. DB 변경 없음.
- BF-T4 구현 결과: 2 failed(기존 상세 라우트로 들어가 400) → **2 passed / 5 deselected / 1 warning, 2.34초**. `candidates-red.log`·`candidates-green.log`. 기존 5개는 변경 영향이 없어 이번 실행에서 제외했다.
