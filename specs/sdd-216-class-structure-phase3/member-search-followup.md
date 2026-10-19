# SDD-216 — 클래스 회원 후보 검색

- 상태: 구현 전 계획·검증 기대값.
- 문제: 공용 ParticipantPicker의 `/clients`는 호출자 본인의 상담 연결만 조회한다. 센터 관리자와 클래스 보조강사의 초대 권한과 일치하지 않는다.
- 근거: `client_service.list_clients`, `class_access_service.authorize_class_action(action="invite")`, `class_membership_service.invite_members`, 기획 상세 편성 UX §1의 회원 검색·선택.
- 신규 GET `/classes/member-candidates?class_id=&q=`. 기존 클래스는 invite 권한, 생성 전에는 활성 상담사·센터 관리자와 현재 활성 소속 검사. 기관 없는 상담사는 현재 생성 권한과 같이 거절한다. 검색만 별도로 허용하지 않는다.
- 이름/빈 검색: 호출자가 초대할 수 있는 같은 기관 클래스의 기존 회원 + 본인 활성 상담 연결. 센터 관리자는 해당 기관의 현재 활성 상담사에 연결된 활성 회원을 포함한다.
- 정확 이메일 검색: 기존 초대 대상 조건과 같은 활성 client만 정확 일치로 조회한다. 전역 이름/부분 이메일 검색은 허용하지 않는다. 계정 정지·삭제 상태, 비활성 기관/소속, 타 기관 클래스 ID, guest·회원 호출은 차단한다.
- 반환: `id`, `name`, `masked_email`만. 원문 이메일·휴대폰·생년월일·상담 메모·관심사·상담 횟수 없음. 최대 20명과 `has_more`만 반환하며 전체 사용자 수는 제공하지 않는다.
- 이는 기존 초대 범위 내 검색 제한이며 새 전역 디렉터리 정책을 만들지 않는다.

| Task | 파일 소유 | 기대값/시나리오 | 도구 |
|---|---|---|---|
| MS1 | classes.py, class_read_service.py, class_parent.py, 신규 BE 테스트 | 주강사·보조강사·관리자 성공, guest/회원/타센터 거절, 스위치 off404 | 초점 pytest |
| MS2 | 동일 BE 파일 | 연결된 이름만 검색, 전역 정확 이메일만 일치, 부분메일/와일드카드 우회0, 비활성 계정0, 최소필드·20명 상한 | 초점 pytest |
| MS3 | 신규 class-member-candidates.ts, class-member-picker.tsx, class-members-panel.tsx, 신규 FE 테스트 | classId 유무·AbortSignal, 검색 취소/늦은응답 폐기, 선택·해제·정원, 현재 active 멤버 제외, 클래스 전용 API 사용 | 초점 Vitest |

- 전체 BE/FE 회귀·수집·빌드 금지. verify 원본은 변경하지 않는다.
- 다른 트랙은 전용 picker/API를 사용한다. 기존 상담 ParticipantPicker와 `/clients`는 변경하지 않는다.

## 구현·검증 결과

- MS1~MS3 구현. 신규 검색 라우트·최소 응답 스키마·관계 범위 조회·전용 선택기·CH04 연결 완료.
- BE RED: 신규 경로가 동적 클래스 ID로 해석되어 400(기대 200). 구현 후 **신규 18개 통과, 2.74초**. SQLite 실제 라우터/ORM 검증이며 PG 제약 변경 없음. 기존 passlib crypt 경고 1개.
- FE RED: 관리자 초대에서 전용 후보 API 미호출. 구현 후 최초 신규 4개+기존 운영 9개 **13개 통과, 1.98초**. UUID 초대 전송 사례를 추가하여 신규 5개를 별도 확인했다.
- 전용 picker는 생성 전 classId 생략을 지원한다. 200ms 입력 지연, 실제 AbortSignal, 늦은 응답 폐기, 정원/제외 목록, 선택 해제, 오류 안내 포함. API 결과의 마스킹 이메일만 메모리에 보관한다.
- 기존 상담용 ParticipantPicker·`/clients`·원본 verify는 변경하지 않았다. 전체 회귀·수집·빌드 미실행.
- 실서버 데이터 검색·브라우저 시각은 미확인. CH14 CSS와 생성 화면 연결은 마법사 담당의 통합 범위다.
- 임시 설정·캐시·테스트 임시 폴더는 이 워크트리에만 존재하며 커밋에서 제외한다.
