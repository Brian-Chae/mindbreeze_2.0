# SDD-216 — 바로 지금 1회차와 즉시 초대 추가 요구사항

- 최초 작성: 구현 전 요구사항·계획·검증 게이트. 2026-10-19 사용자 지시로 구현 승인: “시안 작성 안해도 되고 SDD-216 추가 요구 사항으로 반영해서 구현해줘”.
- 원본 verify.md는 변경하지 않는다. 이 문서의 기대값을 먼저 고정하고 구현한다.
- 목적: 긴급 클래스를 날짜·시간·반복 설정 없이 만들고 회원에게 바로 입장 경로를 제공한다.

## 요구사항과 계약

- CH12 ‘언제 진행할까요?’에 ‘바로 지금’ 선택 추가. 선택 시 1회차·서버 현재 시각으로 생성. 날짜·요일·시작 시간·반복 횟수 입력은 숨기고 회차 길이는 유지한다.
- 상담사는 자신을 진행자로 배정하고 CH13을 건너뛴다. 센터 관리자는 유효한 상담사 1명을 선택한다. CH14 회원 선택·이메일 초대는 유지한다.
- API는 `schedule.recurrence_rule.start_now: boolean = false`를 가산한다. 즉시는 fixed·planned_session_count=1·all_one 진행자 1명·rows=[]·ends_on=null만 허용한다. 일반 fixed는 기존 2~52회 유지. recurrence_rule의 기존 날짜·시각 필드는 구조를 유지하되 즉시 모드에서는 실제 편성 시각에 사용하지 않는다.
- 즉시는 서버 현재 시각을 사용하므로 밤·5분 경계 밖에서도 생성 가능하다. 일반 예약의 07~22시·5분 간격 규칙은 유지한다. 초안은 열지 않고 게시 시점의 현재 시각으로 1회만 연다.
- 저장 구조는 fixed와 recurrence JSON을 사용한다. 신규 열·마이그레이션 없음. 즉시 클래스 복제는 일반 fixed 2회 초안으로 돌리고 새 시작일을 입력받는다.
- 생성과 함께 회차 상태 open, opened_at 설정. in_progress·started_at·녹음은 자동 시작하지 않는다. 유효 진행자·권한·정원·통합 충돌 검사와 강제 확인, operation_key 멱등성을 유지한다. 프리뷰 이후 시간이 지나도 같은 충돌 내용 확인값은 재사용 가능하고 새 충돌은 다시 확인한다.
- 즉시 클래스의 열린 회차에는 선택 회원의 expected 참가자를 만든다. 코드 가입도 현재 열린 회차를 포함한다. 종료·취소 회차에 참가자를 소급 생성하지 않는다.
- 해당 클래스의 초대/준비 outbox를 커밋 후 바로 처리 요청한다. 기존 cron은 재시도 경로로 남는다. 실패가 클래스 재생성·초대 중복을 유발하지 않도록 기존 작업 키와 outbox 상태를 사용한다.
- class_invited는 target_type=class를 유지하고 즉시 초대에 params.session_id, params.start_now=true를 가산한다. 회원 앱은 `/class/{session_id}/enter`로 이동한다. 일반 클래스 초대와 비회원 역할의 기존 경로는 유지한다.
- 이메일은 frontend_base_url의 `/class/{session_id}/enter` 링크, `/join` 링크와 참여 코드를 포함한다. 로그인·기존 참가 자격이 없는 수신자는 코드 입장 경로를 쓴다. 미등록 메일을 사용자 계정으로 간주하거나 동의·정원·자격 검사를 우회하지 않는다. 코드·메일 주소를 URL에 넣지 않는다.
- 이메일만 지정한 기존 회원도 코드 입장을 사용할 수 있다. 회원 검색에서 선택한 계정은 앱 알림에서 바로 입장한다. 알림 수신 설정은 존중한다.
- 완료 화면에 ‘진행 화면으로 이동’과 초대 처리 상태/실패 재시도를 제공한다. 회원 클래스의 열린 회차에도 ‘입장하기’ 경로를 제공한다.

## 파일 소유와 Task

| Task | 트랙·독점 경로 | 작은 작업·검증 |
|---|---|---|
| IN-T01 | BE: backend/app/schemas/class_scheduling.py, services/class_schedule_service.py, 신규 instant 테스트 | 즉시 스키마·서버 시각·일반 예약 보존 RED→GREEN |
| IN-T02 | BE: services/class_write_service.py, class_membership_service.py, class_code_service.py | 1회 원자 생성·open·expected·초안 게시·복제·멱등성 RED→GREEN |
| IN-T03 | BE: services/class_effect_service.py, api/v1/classes.py; BE 공유 파일과 마이그레이션 담당도 동일 1명 | 커밋 후 클래스 한정 dispatch·초대 링크·재시도 RED→GREEN |
| IN-T04 | FE 마법사: pages/classes/class-scheduling-wizard.tsx, lib/api/class-scheduling.ts, lib/class-structure/scheduling-model.ts, components/class/structure/class-settings-panel.tsx, 마법사 전용 스타일·신규 테스트 | 바로 지금 선택·강사 축약·초대 유지·초안·완료 동선 RED→GREEN |
| IN-T05 | FE 입장: lib/api/notifications.ts, pages/class/EntryPage.tsx, pages/client/member-class-detail-page.tsx, 신규 테스트 | 앱 초대 직접 입장·메일 무자격 안내·열린 회차 입장 RED→GREEN |
| IN-T06 | 통합: specs/sdd-216-class-structure-phase3 문서, 로컬 검증 증거 | 초점 테스트·1회 FE 빌드·실제 로컬 PG/API/브라우저 확인·결과 기록 |

- BE·FE 마법사·FE 입장을 각각 루트 내부 전용 워크트리에서 병렬 구현. 공유 파일은 BE 1명만 소유한다. 각 담당 파일만 추가하여 로컬 커밋. push·배포·merge·삭제·외부 메일 발송 없음.
- 출시 순서 ① BE 선택 필드/동작 배포 ② FE CTA 배포. 기존 FE 요청 기본 false로 호환. 실제 배포는 이번 작업 범위 밖이다.
- 전체 BE 회귀·전체 수집은 하지 않는다. 변경 관련 테스트만 실행하며 통합 FE 빌드는 변경이 모인 시점에 수행한다. 리뷰에서 컴포넌트가 추가되면 해당 변경을 반영해 한 번 더 확인한다.

## 구현 전 QA 게이트

| 시나리오 | 기대값 | 도구 | 담당 |
|---|---|---|---|
| IN-Q01 | 즉시 1회 허용, 일반 1회/즉시 rolling·복수회·임의 rows 거절 | 초점 pytest | BE |
| IN-Q02 | 서버 현재 시각 사용, 자정·5분 밖 허용, 일반 예약 시간 제한 유지 | 초점 pytest | BE |
| IN-Q03 | 클래스·1회·멤버·expected·outbox 원자 커밋, 실패 전부 롤백, 같은 키 재시도 동일 ID | PostgreSQL 초점 테스트 필수 | BE/통합 |
| IN-Q04 | 유효 host·권한·정원 검사 유지, open+opened_at, started_at 없음 | 초점 pytest/실제 API | BE |
| IN-Q05 | 충돌 재확인·강제 확인 유지, 같은 충돌 지문 시간 경과 허용, 새 충돌 재거절 | PostgreSQL 초점 테스트 필수 | BE |
| IN-Q06 | 초안 저장은 회차0, 게시 시 현재 시각1회, 재게시/재요청 중복0, 복제 일반2회 초안 | 초점 pytest | BE |
| IN-Q07 | 지금 열린 회차의 회원/코드 가입 expected, 완료·취소 소급0 | 초점 pytest | BE |
| IN-Q08 | 커밋 이후 해당 클래스 outbox 즉시 처리 요청, 재시도 중복 억제·실패 표시 | 초점 pytest, 메일 어댑터 대역 | BE |
| IN-Q09 | 이메일 입장·코드 경로 정확, URL에 코드/이메일 없음, 앱 extra.session_id 계약 | 초점 pytest | BE |
| IN-Q10 | 바로 지금 선택 시 시간 입력 숨김·1회, 상담사 강사 단계 건너뜀, 관리자 유효 진행자 선택 | 초점 Vitest | FE 마법사 |
| IN-Q11 | 회원+이메일 초대 둘 다 유지, 실패 재시도 중 클래스 중복0, 일반 방식 전환 시 정상 복원 | 초점 Vitest | FE 마법사 |
| IN-Q12 | 즉시 초안 재개/게시·생성 완료 진행 링크, 즉시 클래스 설정은 반복·배정 편집 숨김, 모바일 넘침0 | 초점 Vitest/브라우저 | FE 마법사/통합 |
| IN-Q13 | 즉시 회원 알림 직접 입장, 일반 초대·직원은 기존 경로, 잘못된 extra 안전 처리 | 초점 Vitest | FE 입장 |
| IN-Q14 | 이메일 링크의 무자격 수신자는 코드 입장 안내. 미초대 회원의 POST /sessions/{id}/enter는 403·멤버/expected 생성0. 코드 입장은 정상 가입. 참가 자격/동의·정원 우회 없음 | 초점 Vitest/실제 API | FE 입장/BE |
| IN-Q15 | 회원 클래스 open/in_progress 입장 버튼, 완료/취소 회차 버튼 없음 | 초점 Vitest | FE 입장 |
| IN-Q16 | 실제 PG 서버에서 생성→회원 앱 알림→입장 준비 화면, 초대 메일 본문은 대역으로 확인 | 로컬 브라우저/API, 메일 실발송 금지 | 통합 |

## 사용자 결정 필요

- 없음. 사용자가 바로 지금·초대 유지·시안 생략·SDD-216 추가 구현을 지시했다.

## 검증 결과

- IN-T01~06 구현 완료. 추가 6 Task·16 시나리오. 원본 40 Task·79 QA 수와 구분한다.
- PG 신규 21개 통과(2.21초): 실제 PG16/head056, 외부 트랜잭션+savepoint 롤백. 즉시 1회 원자성/실패 원복/operation key 재실행/시간 경과 충돌 지문/새 충돌 거부/직접 링크 무초대403/초안·게시·복제/효과 처리·메일 대역 검증. 원본 8회·복합FK·계정정지 전체 세트는 이번에 재실행하지 않았다.
- FE 신규 고유 41개: 최초 통합 5파일38개 통과(3.86초), 리뷰 보완 3개 추가 후 변경된 마법사 파일11개 통과(2.06초). 이 두 실행은 8개가 겹친다. 담당 트랙에서 기존 편성 계산18개·인접 FE 사례도 확인했으며 전체 회귀는 실행하지 않았다.
- FE 프로덕션 빌드 성공. 첫 통합 이후 실제 발송 상태 컴포넌트 추가로 최종 빌드 1회 재실행(번들 단계2.68초). 기존 큰 청크·동적/정적 import 혼용 경고 유지. 마지막 버튼 아이콘 정렬은 로컬 Vite·브라우저로 확인한다.
- 읽기 전용 리뷰에서 발견한 2건 수정: 숨겨진 예약값(빈 날짜/요일 등)은 즉시 전환 시 유효 기본값으로 정규화, 일반 복귀 원본 입력은 보존. 완료 화면은 실제 pending/sent/failed 조회·새로고침·실패 재시도를 제공한다. 수정 diff 재리뷰에서 추가 P1/P2 없음.
- 실제 로컬 브라우저: 상담사 → 바로 지금 → 회원1명+이메일1개 → 생성 → 진행자 로비 → 회원 로그인 → 앱 초대 알림 → 입장 확인 → 기존 고지/준비 화면. 1회차가 open이고 scheduled_at=opened_at, started_at=null 확인. 수업 시작·녹음은 실행하지 않았다.
- 실제 생성 클래스 `bf797fb8-b0b3-450f-81d7-c4b9e0bd6344`, 회차 `d621062b-f5b4-476a-87be-8a72bbe42610`. 합성 계정/테스트 데이터다. 이메일 sent는 로컬 발송 함수 대역의 성공 기록이며 외부 메일 전송은 없다.
- 모바일390px에서 일정·초대·진행자 로비·회원 준비 화면을 확인했다. 일정/회원 준비 document.scrollWidth=390. 데스크톱1280px 알림·회원 준비 화면 확인. 별도 시안 및 전체 픽셀 비교는 하지 않았다.
- expected 참가자의 joined_at=None이 DB 기본값으로 현재 시각이 되던 경로도 SQL NULL 명시로 바로잡았다. 실제 입장 전에 참여 이력을 만들지 않는다.
- 근거 로그: `.superpowers/sdd/plan/instant-pg-integrated.log`, `instant-fe-integrated.log`, `instant-fe-final.log`, `instant-fe-build-final.log`. 브라우저 캡처/실제 DB 요약: `.superpowers/sdd/plan/instant-review/`.
- 사용자 결정 필요 없음. 실제 외부 메일 수신함·모바일 푸시·LiveKit·BLE·실기기·배포는 미확인. 클래스 효과의 즉시 처리와 기존 알림 전달 worker는 별도이며 운영 worker 설정 검증은 출시 단계에 남는다.
