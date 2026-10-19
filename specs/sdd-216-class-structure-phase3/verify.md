# SDD-216 Verify — 명상 클래스 편성·강사 구현 전 QA 게이트

- 작성일: 2026-10-19. **Stage ③ 구현 전에 작성 / 기본값 승인 완료(2026-10-19)**.
- 기준: [spec.md](spec.md), [plan.md](plan.md).
- 아래 V-01~67·VR-01~06은 **계획·미실행**. DOC는 이번 문서의 정적 점검이며 기능 통과가 아니다.
- 승인 기록: 2026-10-19 Brian “ㅇㅇ 기본값으로 진행해”. U-216-01과 문서 기본값 승인 완료. 기능 시나리오는 미실행이며 구현 후 처음 작성한 체크리스트로 대체하지 않는다.

## 1. 게이트·환경·데이터

| 게이트 | 통과 조건 | 승인/실행 |
|---|---|---|
| G0 구현 전 | spec·plan·verify 검토, U-216-01 문구/처리 기본값 검토, 소유 표·BE→FE 순서 확인 | 2026-10-19 Brian 기본값 승인 완료. T00 착수 기준선 확인은 구현 담당 수행 |
| G1 BE 출시 | PG 필수 4대 항목·권한·알림 원자성·마이그레이션·로컬 API 통합 통과, 신규 실패 0 | T26 증거·별도 1차 출시 승인 |
| G2 FE 출시 | G1 BE 배포 이후 FE, 전체 시안 case/보완 상태·실제 로컬 API E2E·권한/고지 검증 | T37 증거·별도 2차 출시 승인 |
| G3 최종 리뷰 | BE/FE 결과·실기기/실서비스 미확인·남은 위험을 summary로 제출 | Brian Stage ⑦ |

- 로컬 테스트만 합성 계정·명상/상담·PG 데이터를 사용한다. 외부 메일/푸시/녹음/BLE는 모의 처리. 실제 서비스/장치 검증은 출시 승인 범위에서 별도 수행한다.
- PG는 localhost 허용 목록·합성 DB 이름 확인. `.env`·운영 접속 문자열·실제 개인정보를 로그·fixture에 넣지 않는다.
- `pg_conn/pg_session` 롤백 fixture는 제약/서비스 테스트, 별도 2개 연결과 barrier는 경합 테스트. SQLite 결과·skip·단일 연결 순차 실행을 PG 경합 증거로 쓰지 않는다.
- 기준 시계: `2026-11-02T10:00:00+09:00`. 경계 검증은 7일·72h·24h·60분·15분 전후를 별도 고정한다. 날짜와 요일은 계산해 대조한다.
- 역할 fixture: 같은 센터 lead A·assistant B·후보 C·guest D·org_admin O·client M1/M2·타 센터 강사 X·타 센터 관리자 Y·platform_admin·미인증. 각 계정 active/suspended/deleted 변형.
- 클래스: fixed 8회, rolling 4주, draft 미정, completed/cancelled/archived/hidden, no-band, 코드 0042, 타 센터 동일 시각, 명상+상담 같은 host.
- 회차 상태: ready/scheduled/open/in_progress/completed/cancelled × assigned/pending_ack/needs_reassign. 실제 허용되지 않는 조합은 입력 거절 검증에만 사용한다.
- 개인정보 검증: 응답·WS·토큰 claim·PDF 경로·로그에 sentinel 개인정보를 넣고 비허용 사용자 결과에서 부재를 단언한다. UI 숨김만으로 통과하지 않는다.

## 2. 기능·PG·권한 시나리오

모든 행은 **미실행**. 담당 약어는 plan 파일 소유 표의 B/S/I/F/H/O/Q를 따른다. 행 하나 안에 적힌 변형은 parameterized case로 모두 실행하며 일부만 통과한 행은 PASS가 아니다.

| ID | 입력·행동 | 기대값 | 검증 도구 | 담당·Task |
|---|---|---|---|---|
| V-01 | 현재 GET·생성·전이·알림 계약, 신규 DTO 대조 | 실제/설계 구분, host nullable·404·sessionId·단건 내부 commit 확인, 필수 미확인 0 | 정적 대조·pytest·Vitest | B/F/Q T01 |
| V-02 | **PG 필수: 복합 FK 위반**. 다른 클래스의 강사·없는 강사로 INSERT/UPDATE, host NULL, 부모 0/2개 | DB IntegrityError, 저장 0. 유효 강사 1명은 성공. 제거 강사 행은 FK만으로는 통과하지만 앱 배정 409 | PostgreSQL·pytest·카탈로그 | B/Q T02 |
| V-03 | 빈 PG 전체 체인·055 합성 업그레이드·동일 head 재실행 | head 1, 기존 FK/CHECK/UNIQUE 유지, 추가 필드/인덱스 일치, 기존 테이블 DROP/초기화 0 | Alembic·PG 카탈로그·check-alembic-heads | B/Q T02 |
| V-04 | 동시에 Class 코드/기존 단건 Session 코드 생성, 0042 문자열 | 활성 다른 소유 코드 중복 0, 선행 0 유지. 신규 8회는 Class 코드 1개·Session 코드는 모두 NULL | PG 2연결·pytest | B/Q T05 |
| V-05 | 코드 전체 점유·잘못된/숨김/종료/취소/보관 코드·반복 시도 | 소진 503·클래스/회차/effect 0; 공개 실패 404 형태 동일·시도 제한 429 | PG·API pytest | B/Q T05 |
| V-06 | 클래스 코드로 회원/비회원, 열린 회차 0/1/2건 | 회원은 가입+다음 일정/선택; 비회원은 회차별 기존 자격만, 미래 직접 입장 없음. 코드 URL/로그 노출 0 | API pytest·Playwright | B/F T05·T35 |
| V-07 | **PG 필수: 8회 원자 생성**. 5번째 회차 INSERT 실패·member 실패·commit 실패 주입 | 실패 시 클래스/강사/회차/코드/멤버/expected/알림/effects 전부 0, 외부 호출 0. 성공 시 클래스 1·회차 8·seq 1~8·코드 1 | PostgreSQL·pytest·트랜잭션/모의 외부 호출 단언 | B/Q T07 |
| V-08 | 동시 동일 operation_key·동일 본문 재시도, 동일 키 다른 본문 | 동일 class_id/session_ids 1세트, 도메인/알림 의도 중복 0. 다른 본문 409 | PG 2연결·API pytest | B/Q T08 |
| V-09 | commit 후 브로커 오류·worker crash·메일 요청 실패 후 재처리 | 생성 클래스 유지, effect 재처리, Notification/의도 중복 0, 전달 실패 상태 표시. 외부 정확히 1회 전달 보장으로 보고하지 않음 | pytest·가짜 브로커/메일·PG | B/Q T08 |
| V-10 | fixed 8회·복수 요일·격주·skip·KST→UTC·오늘 과거 시각 | 정확히 8개·요일/간격 일치·skip 제외, 과거 입력 422, preview와 create 목록 동일 | pytest 순수 함수 | S T03 |
| V-11 | rolling 경계 28일·종료일·윤일/월말·공휴일 | 28일 미만/종료일 이하만 생성, 공휴일 자동 제외 0, 설정 안 한 날 추정 0 | pytest 고정 시계 | S T03 |
| V-12 | all_one/rotate/by_weekday/per_session·강사 순서 변경·보강·수동 override | all_one 8개 A; rotate A/B 4회씩; 요일 매핑 누락 422; 수동 회차 유지, 보강이 정규 순환을 바꾸지 않음 | pytest·Vitest | S/H T04·T31 |
| V-13 | **PG 필수: 충돌 일괄 검사**. DB 명상+상담·요청 내부 중복·새 host·일괄 이동 제외 대상 | 모든 충돌 pair 반환, 같은 요청의 후보끼리도 검출, 자기 기존 행 거짓 충돌 0, SQL 범위 조회로 후보 선택 | PostgreSQL·pytest·SQL 캡처 | S/Q T06 |
| V-14 | 끝=다음 시작·자정 넘어가는 장시간 회차·취소/완료/숨김/템플릿 | 맞닿음 0, 장시간 교차는 충돌, 제외 상태 0. force=true여도 재검사 | PostgreSQL·pytest | S/Q T06 |
| V-15 | 타 센터/타 상담사 일정 충돌·같은 주소·회원 겹침, preview 이후 새 충돌 | 비가시 상대 ID/제목/내담자 없음, 주소는 정보성, 회원 충돌은 허용 범위만. 새 fingerprint이면 409 재확인 | pytest·API 응답 sentinel 검사 | S/B T06·T10 |
| V-16 | 동일 강사 2회 추가·soft-remove 후 재추가·타 센터/정지 강사 추가 | 클래스/user 행 1개, 재추가는 복구, 타 센터/비활성 거부, 과거 FK 이력 유지 | pytest·PG | I/Q T12 |
| V-17 | 마지막 lead 제거/강등·미래 담당자 제거·open 담당자 제거·동시 배정/제거 | 정상 경로 409, 미래 재배정/취소 후 제거 가능, 경합 뒤 active lead/host 자격 위반 0 | PG 2연결·pytest | I/Q T12 |
| V-18 | 61분/정확히 60분/15분/14분 시점 변경 | 61분 즉시, 60분 pending_ack+old host, 15분 이하는 새 요청 409. 후보 이외 수락 403 | pytest 고정 시계·API | I T13 |
| V-19 | 수락/거절/타임아웃·중복 변경·수락과 열기 동시 | 수락 시만 host 변경, 거절은 기존 유효 host 복귀, 만료 후 수락 불가. 열기 성공 뒤 인계 0, 이력 1건 이하 | PG 2연결·pytest | I/B/Q T13 |
| V-20 | 본인 양도 요청·보조의 타인 회차 변경·관리자 대행 | 요청만으로 host 불변, 주강사/관리자 approve 뒤 시점 규칙 적용, 임의 변경 403, 사유·행위자 기록 | pytest·API | I/B T13 |
| V-21 | guest 타 센터·2개 회차 scope·승인 완료/14일·scope NULL·회차 숨김 | 같은 센터 한 회차만, 두 번째 scope 409, 먼저 도래한 만료 뒤 removed, NULL scope 권한 없음, 과거 본인 진행 열람만 | pytest·PG | I/B/Q T14 |
| V-22 | host 교체 중 ChatRoom 갱신 예외, 정상 변경 후 AI/알림/리마인더 조회 | 예외 시 host/history/chat/effect 전체 롤백, 정상은 동일 새 host, 옛 강사 신규 진행 권한 0 | PG·pytest·모의 AI 호출 | B/Q T15 |
| V-23 | completed 승인 전 정정·승인 후 정정·정정과 승인 동시 | 승인 전 사유 없으면 422, 승인 뒤 host/Report.user_id 불변·메모만, 경합 시 한 조건만 충족 | PG 2연결·pytest | B/Q T16 |
| V-24 | **PG 필수: needs_reassign 전환**. 플랫폼 정지/센터 정지/계정 삭제/강제 해제 | 명상 ready/scheduled만 needs_reassign, host NOT NULL·hidden_at 불변, 부모 가시, pending 폐기. open/진행/완료/취소 host 유지, 과거 리포트 유지 | PostgreSQL·API pytest | I/B/Q T17 |
| V-25 | 마지막 lead 강제 정지·정지 해제·중복 정지·정지와 수락/배정 동시 | 정지는 성공·재배정 큐 노출, 자동 assigned 복구 0, 이벤트 중복 0, 비활성 host로 열기 불가 | PG 2연결·pytest | I/B/Q T17 |
| V-26 | 역할×편성·추가·취소·열기·시작·종료·녹음·발언권 제어 | spec 권한표 일치. 진행 제어는 해당 host만, org_admin/비진행 lead 우회 0 | pytest 매개변수 행렬 | B T18 |
| V-27 | 숨김·없는·타인 부모 ID, 부모/회차/요청 ID 조합 변조 | 부모는 같은 404, 기존 단건 세션 오류 계약 구분, 보호된 응답·쓰기 0 | API pytest·Playwright | B/F T18 |
| V-28 | 개설자 lead 제거 후 접근·기관 이동·membership 비활성 | 개설자 영구 권한 0, 귀속 스냅샷으로 판정, 새 센터가 과거 본문을 얻지 못함 | pytest·PG | B T18 |
| V-29 | D-05 기존 r5-1·class-team-v1·임의 버전·저장 실패 | 유효 새 고지 확인 전 팀 본문/참관 0, 입력 임의 버전 거부, 실패해도 회원 기본 입장·선택 흐름 유지 | pytest·Vitest·Playwright | B/F T19·T29 |
| V-30 | 그룹 포함 대상 일부만 새 고지, report_included=false·미측정 | 포함 대상 전원 고지 없으면 팀 그룹 자료 차단, 제외자 재포함 0, 미측정=0 생성 0 | API pytest·fixture 검사 | B T19 |
| V-31 | 비진행 lead/assistant 참관 REST·LiveKit·WS·재접속·권한 제거 | publish=false, participant 생성 0, EEG/기기/품질 원문 payload 0, 제어 403, 새 권한으로 재인증. 별도 참관 표기 | 토큰 claim·WS 통합 pytest·Playwright | B/F/Q T19 |
| V-32 | D-28 org_admin 명상 리포트 읽기·수정·승인·재생성·발송 | 같은 기관 읽기만, 모든 쓰기 403, UI 쓰기 CTA 없음. 상태만 보고 본문을 추정하지 않음 | API pytest·Vitest | B/F T20·T29 |
| V-33 | D-28 상담 목록·상세·기록·PDF·export·메일·WS·AI·직접 URL | 메타 허용 필드만, content/subjective/전사/본문 링크/S3 key 없음, 다운로드/구독 우회 거부 | API/WS pytest·응답 sentinel 검사 | B/Q T20 |
| V-34 | 타 센터 관리자·미인증·platform_admin·퇴사 강사 | 새 역할 우회 0, 정책상 본인 과거 진행 자료만 유지, 기관 판정 users.org_id 단독 의존 없음 | pytest 권한 행렬·PG | B T20 |
| V-35 | 미정 draft 저장→목록→재개→publish, 회원 draft GET | draft 회차/코드/멤버/알림 0, lead는 조회 가능, 회원 404, 미정 공개 422 | API pytest·Playwright | B/H T09 |
| V-36 | 지난 기수에 취소·보강·수동 이동·비활성 강사·규칙 없음 | 원래 패턴만 복제, 비활성 미정, 회원 토글 off, 새 코드, 옛 동의 복사 0. 규칙 없으면 직접 입력 | pytest·Playwright | B/H T09·T30 |
| V-37 | 한 행/이후 모두/선택 3행 +7일·시각·host 변경·취소 | preview 전후 정확, 1 bulk 요청, seq 불변·skip 기록, 실패 시 변경 0 | pytest·Playwright·PG | S/B/H T10·T33 |
| V-38 | 오래된 revision/state_version·일괄 중 한 행 completed·동시 일정 변경 | 409·전체 변경 0, 재조회/재확인, 클라이언트 N회 PATCH 0 | PG 경합·Playwright | B/H/Q T10 |
| V-39 | 8회 중 3회차 취소→보강→정규 추가 | 취소 seq 유지, 자동 보충 0, 보강 분모 증가 0, 정규 추가 분모 +1, completed 분자도 정규만 | pytest·API·Vitest | B/F T11 |
| V-40 | 회원 M1 초대 2번·4회차 앞 합류·새 rolling 생성 | member 1행, 지난 1~3 expected 0, 이후 회차 expected 각 1, rolling 추가도 1, 연결 링크 자동 생성 0 | PG·pytest | B/Q T21 |
| V-41 | 마지막 자리 동시 가입·removed/completed 회원·열린 회차 코드 입장 | active 정원 초과 0, removed 자동 복구 없음, 완료 멤버 자동 재활성화 없음, 열린 회차 참여자 중복 0 | PG 2연결·API | B/Q T21 |
| V-42 | 이메일/CSV 중복·형식 오류·일부 실패·재시도·회원과 같은 이메일 | 클래스 초대 요청 1개/버전, 실패만 재시도, 장기 guest/동의/회원 자동 연결 0, 메일 전달 완료 단정 없음 | pytest·모의 메일·Playwright | B/H T22 |
| V-43 | no-band·BLE 미지원·녹음 없음·회원 리포트 미선택 | 편성·조회·입장 정상, 장치 강제/0점/리포트 자동 포함 0 | pytest·Playwright | B/F/Q T35 |
| V-44 | 변경 전후 기존 전체 테스트·CI 비차단 단계 | 새 실패 0, 기존 실패는 이름·SHA·환경·전후 결과 분리, green job만으로 전체 통과 주장 없음 | pytest·Vitest·build/lint·CI 로그 | B/F/Q T01·T26·T37 |
| V-45 | cron·상세 roll-forward 동시 호출·반복 실행·GET 상세 | 회차/seq/effect 중복 0, GET 쓰기 0, 생성 커서 단조 증가, 4주 범위 유지 | PG 2연결·API pytest | B/Q T23 |
| V-46 | rolling 규칙의 removed/정지 강사·per_session 다음 주기·이동/skip 날짜 | 제거 행 FK 유지+needs_reassign, 임의 강사 대체 0. 직접 배정은 확인한 순서 주기대로 다음 4주 투영·빈 규칙 공개 422, 이미 옮긴 날짜 재생성 0 | PG·pytest | B/Q T23 |
| V-47 | fixed 마지막 정규 완료/취소·rolling 마무리/종료일·open 존재 | fixed 조건 충족 시 completed, rolling 예정 취소·코드 무효·멤버 완료·알림 1통. open이면 마무리 409·새 생성 중단 | API pytest·PG | B/Q T24 |
| V-48 | 취소→active·보관→active·보관 해제·정규 추가 재개·일반 삭제 | 금지 전이 409, restore 원래 상태, fixed 재개 새 코드·멤버 자동 복귀 0, 이력 있는 클래스는 보관만·물리 삭제 0 | API pytest·PG | B T24 |
| V-49 | 8회 공개·일괄 변경·배정 확정 7일/60분 경계·수락 대기 | 회원 초대 클래스별 1통, 강사 배정 묶음, 회원 변경은 7일 이내 확정만·임박 푸시 선호 준수, pending 알림 0 | pytest·outbox PG 조회 | B/Q T25 |
| V-50 | needs_reassign 72h/24h 경계·중복 cron·해결 후 재실행 | 각 구간 1회, 24h 이내 시작은 해당 구간만, 해결 후 발행 0, 관리자 큐 24h 최상단 | pytest 고정 시계·PG·Playwright | B/O/Q T25 |
| V-51 | 시간 변경 전 ETA·취소/숨김/needs_reassign·excused/withdrawn·expected 누락 | 옛 ETA 발송 0, 대상 제외 정확, active 멤버는 expected 누락만으로 누락되지 않음, 비회원 리마인더 0 | pytest·가짜 Celery·PG | B/Q T25 |
| V-52 | BE 로컬 실제 HTTP로 생성→편집→초대→배정→정지, 메일 모의 | 합성 응답 대신 실제 PG 상태·API 일치, 핵심 4대 항목 skip 0, 신규 실패 0 | 로컬 BE+PG·pytest/http client | Q/B T26 |
| V-53 | 1차 배포 순서·migration·cron·스위치 검증 | 승인 SHA/head 기록, D-28 시행, 팀 열람 off, PG/권한 실패 시 출시 중단 | 승인 후 배포 로그·API 스모크 | B T27 |
| V-54 | 신규 DTO nullable host·capabilities·서버 오류 코드·코드 0042 | 미확정 이름 추정 0, 문자열 보존, API 필드 의미 일치, 서버 오류 원문 미노출 | Vitest | F T28 |
| V-55 | preview 연속 변경·저장 중 재클릭·로그아웃·사용자 교체·늦은 응답 | 최신 preview만 표시, 키 재사용으로 중복 저장 0, 이전 사용자 응답/캐시 노출 0, 취소 신호 전달 | Vitest·Playwright | F T28 |
| V-56 | 홈 오늘 일정·양 영역 메뉴·새 알림·부모/회차 링크 | 영역 칩 실제 부모 근거, 전체 집계 날조 0, class target는 부모·session target는 회차, 키 기반 배지 | Vitest·Playwright | F T29 |
| V-57 | CH10~12 단계·1/200/201자·정원 2/50/100·과거·요일 0·2/52회 | 단계 4개, 오류 기대 문구, 드래그 없이 입력, 오프라인 주소 필수/영상 off, 나가기 확인 | Vitest·Playwright | H T30 |
| V-58 | CH13 4배정·미정·충돌·강사 추가·초안 복구 | server preview만, 미정 다음 차단/초안 저장 가능, 동일 규칙 결과, 자격 없는 강사 선택 불가 | Vitest·Playwright | H T31 |
| V-59 | CH14~15 초대 생략·정원·코드 소진·연결 끊김·부분 메일 실패 | 생성 1번, 실패 입력 보존, 503 재시도, 실패 초대만 재시도, 코드 1개/전달 요청 문구 | Vitest·Playwright | H T32 |
| V-60 | CH20 데스크톱 표↔모바일 카드·선택·시트·bulk preview 취소 | 동일 모델/검증, 1요청, preview 취소 저장 0, 완료·취소 행 편집 불가, 초점 복귀 | Vitest·Playwright | H T33 |
| V-61 | CH01~04/06 강사 추가/제거/주강사/재배정·마무리·최소 멤버 | 역할별 CTA 정확, 최소 회원만, 출석률/결석 추정 0, CH05/후속 대기열·병합 CTA 없음 | Vitest·Playwright | O T34 |
| V-62 | CH30 예정/타인 진행/완료/취소/보강/재배정 필요 | 코드·참여자·장소·기록·취소 중심, 편집은 회차 탭, 클래스 코드 동일, 잘못된 부모로 조작 0 | Vitest·Playwright | O T34 |
| V-63 | 회원 ?sessionId= 선택·초대·새 일정·부모 불일치 | 실제 쿼리 소비, 올바른 회차 강조/입장, 불일치 정보 0, 합류 전 본문 없음 | Vitest·Playwright | F T35 |
| V-64 | 동의 고지·리포트/연구 별도 선택·팀 열람 스위치 | 새 문구/버전 정확, 기본 제외 유지, 미동의 연구 전파 0, 스위치 off일 때 참관/팀 본문 없음 | Vitest·API 통합·Playwright | F/B T35 |
| V-65 | /join·/class/:sessionId/enter·player/record·취소·알림, 밴드 미착용 | 공유 엔진 기능 회귀 0, 부모 ID를 sessionId로 전달 0, REST 경로 오치환 0 | Playwright·API 회귀 | F/Q T35 |
| V-66 | 로컬 실제 BE+FE로 8회 번갈아 생성→초대→미래 변경→정지/재배정→보강 | 실제 API·PG·UI가 같은 ID/상태, 모의 리플레이와 별도 증거, 실제 외부 발송 0 | Playwright local-api 프로젝트·PG 조회 | Q T37 |
| V-67 | 2차 FE 배포·고지 저장 확인→팀 열람 on·복구 연습 | 승인 SHA 기록, 고지 이전 확대 0, 실패 시 off, D-28 유지. DB downgrade/삭제 없이 복구 | 승인 후 배포 로그·API/화면 스모크 | F/B T38 |

### 필수 PG 실행 근거

- V-02: raw SQL 위반 INSERT와 ORM/API 거절을 분리한다. removed 강사는 DB FK를 통과할 수 있다는 사실도 증명한다.
- V-07: 각 실패 주입 전후 `classes/class_instructors/sessions/class_members/session_participants/class_operations/class_effects/notifications/notification_outbox`의 대상 건수 비교. 실패 시 열린 외부 작업 0도 단언한다.
- V-13: 상담과 명상이 같은 host일 때 교차 검출, 다른 host이면 비충돌. 요청 내부 충돌·변경 제외·마스킹·force 재검사 포함. SQL 캡처로 N회 전량 조회가 아님을 확인한다.
- V-24: 실제 suspend_user·센터 정지·delete_user 경로를 호출한다. 서비스 부품만 호출한 테스트로 통합 경로를 대체하지 않는다. 상담 관계 후속 처리를 명상 PASS에 섞지 않는다.
- V-17/19/23/25/41/45: 독립 연결·동시 barrier·최종 DB 상태와 권한을 확인한다. 잠금 대기/교착이 발생하면 timeout을 늘려 숨기지 않고 잠금 순서를 수정한다.
- 합성 성능: 100클래스×52회·20강사와 8/52개 후보를 고정하여 SQL 수·실행 계획·p50/p95를 기록한다. 현재 200ms 등 운영 성능 달성 사실은 미확인이다. 후보 강사 수와 무관한 전량 Python 조회 재도입은 실패다.

## 3. 시안 case 전수 리플레이

- 정본: `designs/class-structure-redesign/host-classes.html`의 실제 `reg('CH..')` 등록.
- R: 시안 구조/기능 비교. A: Phase 3 계약에 맞춰 문구/데이터/후속 조작을 보정하고 차이 근거를 남긴 비교. X: 후속 제외, 인접 화면에서 진입/쓰기 부재 확인.
- 시안 데이터는 합성 값. 실제 API 스키마·nullable·권한으로 만든 fixture만 사용한다.

| 화면 | R case | A case·차이 | X case·이유 | R+A / X |
|---|---|---|---|---|
| CH01 | open, progress, idle, warn, filter-draft, search, done, empty | 없음 | 없음 | 8 / 0 |
| CH02 | overview, open, warn, rolling, draft, done | 없음 | 없음 | 6 / 0 |
| CH03 | table, timeline, cancelled, rolling, pending, needs-reassign, reassign, host-change, host-conflict, host-urgent | makeup, makeup-add: 지정 회원 보강만, 결석/상쇄 없음 | 없음 | 12 / 0 |
| CH04 | 없음 | members, join-mid: 최소 회원·예정만. full: 정원 안내만, 대기열 없음 | absent, merge: 결석/비회원 병합 P4 | 3 / 2 |
| CH05 | 없음 | 없음 | reports, expand, approve-confirm, approve-result, generating, few-wearers, empty, no-perm: 클래스 리포트 P5 | 0 / 8 |
| CH06 | instr-leave, last-lead, finish, cancel | settings: 자동 승인 영역 분리·연구 기본값 변경 제외 | 없음 | 5 / 0 |
| CH10 | start, clone, clone-empty | 없음 | 없음 | 3 / 0 |
| CH11 | offline, error, advanced, clone, leave | online: 시안 12 대신 기본 정원 10 | 없음 | 6 / 0 |
| CH12 | fixed, rolling, skip, error | 없음 | 없음 | 4 / 0 |
| CH13 | rotate, all-one, by-weekday, per-session, unassigned, conflict, conflict-sheet, add-instructor, rolling | 없음 | 없음 | 9 / 0 |
| CH14 | summary, conflict, email, error-mail, empty, capacity, submit-error | 없음 | 없음 | 7 / 0 |
| CH15 | partial, no-invite, draft-saved, rolling | done: 템플릿 저장 제외, 기수 복제로 대체 | 없음 | 5 / 0 |
| CH20 | table, selected, conflict, conflict-sheet, place-conflict, preview, bulk-host, edit-sheet | 없음 | 없음 | 8 / 0 |
| CH30 | scheduled, open, others, completed, cancelled, needs-reassign, cancel-sheet | makeup: 지정 회원·일정만, 출석 매칭 없음 | 없음 | 8 / 0 |
| 합계 | | | | **84 / 10** |

공통 보정은 R에도 적용한다: 명상 ‘세션/오픈’ 문구를 회차/열기로 변경, CH05 탭·후속 출석 조작 숨김, no-band와 미확인 값은 실제 계약대로, 열기 시각은 실제 엔진 계약 사용(시안의 15분을 새 하드 차단으로 만들지 않음). 한 case를 R과 A에 중복 집계하지 않는다.

- 원본 URL: `host-classes.html?screen=<ID>&case=<case>`; 클래스 변형 k는 HTML에 있는 `mbsr/wed/wed-open/lunch/intro/winter/morning` 중 fixture와 맞는 값을 manifest에 지정한다.
- 제품 경로: CH10~15 `/classes/new` 단계, CH01 `/classes`, CH02 `/classes/:id`, CH03 `/classes/:id/sessions`, CH04 `/classes/:id/members`, CH06 `/classes/:id/settings`, CH20 `/classes/:id/schedule`, CH30 `/classes/:id/sessions/:sessionId`.
- CH05는 탭/직접 route/API 신설 없음. 경로 직접 진입도 안전한 부모 화면/404로 처리하고 빈 리포트 탭을 완성처럼 만들지 않는다.
- 원본에 없는 수락·거절 알림 화면, 고지 개정, 참관, 센터 재배정 큐, D-28 제한 화면, 회원 sessionId는 별도 manifest로 캡처한다. 원본 screen_id는 `미확인`으로 기록하며 위 94개 case 수에 합산하지 않는다.

## 4. 시각·접근성 검증 시나리오

| ID | 입력·검증 | 기대값·증거 | 도구 | 담당·Task |
|---|---|---|---|---|
| VR-01 | CH01~04·CH06 히어로·사이드바·건수 탭·목록 행·강사 패널 | 원본 구조·간격·타이포·색/그림자·정렬 재현, 역할 CTA만 승인된 차이. SDD-215의 59%를 이번 결과로 재사용하지 않음 | Playwright·픽셀 diff·수동 overlay | Q/O/F T29·T34·T36 |
| VR-02 | CH10~15 전 case, 4단계·오류·초안·복제·완료 | 4뷰포트 각각 1단계 1화면, 입력/CTA 잘림 0, 목록 내부 스크롤, 서버 요청/단계 리플레이 일치 | Playwright·Vitest·수동 비교 | Q/H T30~32·T36 |
| VR-03 | CH20 전 case, 표/카드·시트·키보드·전후 preview | 390/834 세로는 카드, 1194/1280 가로는 표, 같은 편집값·검증. 시트 초점 고정/복귀·Escape·터치 동작 | Playwright 측정·수동 입력 | Q/H T33·T36 |
| VR-04 | CH30 전 case, 읽기/제어 역할·보강·needs_reassign | 코드·참여자·장소·기록·취소로 축소, 올바른 편성 링크, 미허용 버튼·본문 없음 | Playwright·픽셀 diff | Q/O T34·T36 |
| VR-05 | 84 case×4뷰포트 원본/앱/diff/overlay + 보완 상태 | 비교쌍 336개 누락 0, 공통영역 diff≤0.1%(threshold 0.2)·정렬 오차≤2px, 의도 차이 근거/검토자 명시, 미승인 차이 0 | Playwright·이미지 비교·사람 판정 | Q/소유자 T36~37 |
| VR-06 | 전체 R/A와 보완 상태의 fit·접근성·용어·외부 요청 | 글자<12px·터치<44×44·잘림·페이지 넘침·중복 셸 0, 키보드 조작/초점 정상, 영역별 금지어 0·외부 요청 0 | DOM 측정·클릭·용어 가드·수동 QA | Q/소유자 T36~37 |

### 캡처 재현 조건

1. DPR=1, locale=ko-KR, timezone=Asia/Seoul, 고정 시계, reduced motion, Chromium/OS/폰트 버전·원본/앱 SHA 기록.
2. 정확히 **390×844 / 834×1194 / 1194×834 / 1280×720**. `document.fonts.ready`·이미지 로드·API 안정 후 캡처. missing token/asset·콘솔 오류가 있으면 실패.
3. 시안은 designs 상위 루트를 서버 루트로 제공한다. 앱과 시안은 같은 브라우저·폰트·시계 사용. 외부 API·메일·S3 요청은 차단한다.
4. 전체 화면을 나란히 비교하고 50% overlay로 히어로 높이·사이드바 폭·본문 시작점·행 높이·색·간격을 측정한다. 본문 전체 마스킹 금지. 승인된 문구 차이는 좌표·근거를 기록한다.
5. 13개 범위 화면 각각 loading/error/empty/missing-fields/no-band/long-content 6상태×4뷰포트 = **312장** 추가 앱 캡처. draft/단계 empty는 입력/목록 없음, missing-fields는 필수 응답 손상 오류 또는 선택 메타 없음으로 정의하고 화면별 기대값을 manifest에 적는다.
6. 기본 비교 원본 336·앱 336·diff 336·overlay 336장, 보완 앱 312장. **앱 최소 648장**, 별도 screen_id 미확인 변형은 이 수와 분리한다. X 10개는 제외/부재 검증이며 통과 캡처 수로 세지 않는다.
7. 이미지는 증거이지 판정 자동화의 대체가 아니다. 임계값 초과를 명세 차이로 자동 승인하지 않는다. 0.1%를 만족시키려고 원본을 수정하거나 허용값을 올리지 않는다.

## 5. 결과·증거·리플레이 계약

- 경로(향후): `specs/sdd-216-class-structure-phase3/evidence/<실행-SHA>/`. Q만 쓰고 실제 시크릿/개인정보 없음.
- manifest 필드: scenario_id, screen_id, case_id, classification, role, prototype_url, app_url, fixture_id, viewport, source_sha, app_sha, clock, expected_copy, allowed_difference, excluded_reason, reference_image, actual_image, diff_image, overlay_image, pixel_diff_ratio, fit_violations, reviewer, result.
- API 증거: request fixture·response schema/hash·호출 수·허용/거절 상태·부수효과 건수. 코드·이메일 등은 합성값만, 실제 토큰은 제거.
- PG 증거: 적용 revision·실제 DB dialect·필수 테스트 이름·skip 0·실패 주입 위치·전후 건수·경합 최종 상태·SQL/실행 계획. PASS 총수만으로 대체하지 않는다.
- 리플레이: 같은 fixture·시계·viewport·case로 원본/앱 재생. 실패 수정 후 동일 입력 재실행, 이전 증거를 새 SHA의 PASS로 쓰지 않는다.
- 결과는 PASS/FAIL/BLOCKED/미실행. 미확인·도구 실패·부분 실행을 PASS로 바꾸지 않는다.
- 모의 API 리플레이, 실제 로컬 BE+PG E2E, CI, dev 배포, 실기기/실제 LiveKit·BLE 결과를 구분한다.
- 이전 SDD-215 summary의 vitest 11실패·픽셀 중앙값 59%는 비교 참고. 현재 기준선은 T01에서 새로 확보한다.

## 6. 이번 문서 정적 검증

| ID | 대상 | 기대값 | 도구 | 담당 |
|---|---|---|---|---|
| DOC-01 | 문서 첫 줄·구현 전 상태·권한 경계 | spec 제목 정확, 3문서 존재, 문서 승인 기록·이번 워커 코드 구현/배포 금지 명시, 이번 코드/경로 밖 변경 0 | 파일 읽기·git diff | 문서 |
| DOC-02 | 입력·실제 근거·확정 정책 | 실제 경로/함수 대조, D-05/D-28 확정, 기본값 표·미확인·SDD-215 이월 구분 | rg·정적 경로 검사 | 문서 |
| DOC-03 | 파일 소유·Task DAG | 공유 BE 8개 지정 경로/versions는 B 1명, 소유 충돌 0, 40 Task 선행/검증 연결 | 정적 검사·수동 대조 | 문서 |
| DOC-04 | 시나리오·case·수량 | V 67·VR 6·DOC 6 고유, 원본 case 94 = R/A 84+X10, 4뷰포트·PG 필수 4행 | 정적 파서·HTML 등록 대조 | 문서 |
| DOC-05 | 커밋 범위·공백 | 지정 3문서만 staged/committed, diff --check 통과, 로컬 커밋만 | git status/diff/show | 문서 |
| DOC-06 | 보고·남은 게이트 | 커밋/파일/40 Task/79 시나리오/남은 정책 0/미확인 6 보고, 기능 미실행 구분 | 수동 대조 | 문서 |

- 수량: **기능 67 + 시각 6 = 구현 후 실행할 시나리오 73개**, 문서 정적 점검 6개를 포함하면 **79개**. 시안 case 94개와 혼동하지 않는다.
- 현재 G0 문서 승인 완료, T00 착수 기준선 확인은 남음. G1/G2/G3 미도달. 이번 문서 정적 검증은 PG·브라우저·실환경 통과를 의미하지 않는다.
