# SDD-217 — 클래스 멤버십·출석·보강과 진행 상태 안정화 결과

2026-10-19. 구현 및 로컬 통합 검증을 마쳤으며 **최종 독립 리뷰 통과·Brian 최종 승인 전**이다. 배포하지 않았다. [spec](spec.md) · [plan](plan.md) · [구현 전 verify](verify.md) · [API 계약](api-contract.md).

## 구현 결과와 검증 범위

R1 멤버십·정원·FIFO, R2 실제 입장 출석·체크인/현재 접속 분리, R3 개인 결석 보강, R4 guest 자격/병합/단회 복구/O3 동의/보관, R5 본인 이력·승인 리포트·운영 UI, R6 셀프뷰 원본 교체·서버 참여 복원·즉시 완료를 구현했다. 상담 Phase6/7·클래스 리포트 Phase5·팀 참관 활성화는 제외했다.

**55 ID 판정: PASS 51 · PARTIAL 2 · 미측정 2.** PASS는 표에 명시한 증거 수준의 통과다. SDK/DOM/PG 대역 통과를 실카메라·실제 외부 서비스·운영 배포 성공으로 해석하지 않는다. 테스트 함수 수나 반복 실행 수와 55 ID는 다른 단위다.

T11은 실제 UI 로그인→즉시 생성/종료, 별도3회 클래스 생성→회원 초대→서버 체크인→진행 중 실제 입장/WS→호스트 reload→퇴장/재접속→결석→중간 합류→사전 결석/복귀→선택 동의→보강 예약/실제 참석→이탈/과거 본인 리포트, 호스트 정정/복구 및 공개 guest 가입/입장/병합/기존 자격 회수/단회 복구/이탈 읽기/로그아웃까지 수행했다. **실제 Chrome 23시나리오 PASS**, 로컬 API/PG 요청을 가로채거나 응답을 대역화하지 않았다.

합성 시계 fixture는 기존 가입일을 이틀 전, 첫 회차 일정을 하루 전으로 이동해 중간 합류를 재현한다. 승인 리포트2개는 실제 참가행 FK에 연결한 합성 completed 리포트 fixture다. AI 생성·임상 품질·일괄 승인·PDF 전달 검증이 아니다. 생성/입장/종료/보강/탈퇴/병합/자격 교환은 실제 제품 API를 통과했다. 사람·연락처·기관은 모두 합성이다.

## 최종 통합 리뷰 4건 보완

Important4건을 한 수정 단계로 보완했다. 정상 종료한 본인의 entry-state·after 체크인을 허용하고 활동 자격은 분리했다. 057 이전 회차 동의는 보수적으로 override=true로 보존한다. 보강 원결석을 바꾸는 복귀·입장·정정·재초대는 명시409로 차단하며, 탈퇴·제외는 자격을 즉시 회수하고 보강 원본 excused만 보존한다. 출석 정정 UI는 권한 있는 회차 DTO의 최소 버전을 소비해 전체 participation 권한을 요구하지 않는다. [단일 수정 보고서](evidence/final-fix-report.md). 복구한 멤버가 withdrawn 보강 대상의 예약을 명시 취소할 수 있도록 기존 서버와 capability를 맞췄고, 취소→사전 결석 복귀까지 확인했다. [마지막 PG41](evidence/final-fix-cancel-capability-green.log).

**관련 검증: PG172(신규14 포함), SQLite26, FE67, build0. 마지막 취소 capability 보완 후 PG41 통과.** PG41은 앞선172와 포함 관계이며 선행 집중PG13/FE33 및 기존T11 결과와 중복 합산하지 않는다. [PG](evidence/final-fix-pg-regression.log) · [SQLite](evidence/final-fix-sqlite.log) · [FE](evidence/final-fix-fe-regression.log) · [build](evidence/final-fix-build.log). 실제 HTTP end→entry-state→after를 로그인/guest 각각 검증했으며, 추가 브라우저 전체여정·실기기·외부 전달은 재검증하지 않았다. root가 수정 API를 재시작했고 DB/Redis readiness를 확인했다. 057의056→057 검증은 별도 임시DB이며 기존 브라우저DB와 구분한다.

이탈 후 미래 보강 원본에 excused가 남는 예외는 원결석·감사와 보안 회수를 함께 보존하기 위한 root 승인 결정이다. 화면은 멤버 상태·참여 범위를 함께 확인해야 한다. 완료 보강의 원결석을 자동으로 정정하는 정책은 추가하지 않았다. 제한된 재리뷰와 Brian 최종 승인이 남는다.

## 구현 중 확정한 해석

진행 기록의 Ruling 14건을 기록 순서대로 보존한다. 해석 오류의 비용은 원 기록의 명시 내용과 해당 결정의 영향을 설명한 것이며, 새 정책이나 승인 범위를 추가하지 않는다.

1. **공유 파일은 순차 구현하고 태스크별 검토 뒤 다음 작업으로 진행한다.** 승인된 계획을 지키고 변경 책임을 분명히 하며, 전체 BE 반복 대신 변경 관련 회귀를 수행하기 위한 결정이다. 해석이 틀리면 공유 변경 충돌·회귀 누락을 복구하고 재검증하는 비용이 생긴다.
2. **임시 HTTP 계약은 T00에서 고정하고 API와 UI가 같은 정본을 사용한다.** 실제 서버 계약과 다른 가짜 응답을 기준으로 구현하는 일을 막기 위함이다. 해석이 틀리면 입력·응답·식별자 의미가 어긋나 API와 화면을 함께 다시 수정해야 한다.
3. **056 이후 가산 스키마는 통합 담당 한 명이 소유하며, T01 뒤·T02 전에 기반 스키마 작업을 추가한다.** 후속 서비스의 모델 의존성을 먼저 해결하고 마이그레이션을 한 흐름으로 유지하기 위함이다. 해석이 틀리면 중복 revision·적용 순서 충돌과 DB 재적용 비용이 생긴다.
4. **NV-03 실카메라 미측정은 증상 전체 해결로 간주하지 않고 T11 실제 검증 게이트로 넘긴다.** 카메라 실측은 다른 기능의 구현 의존성을 막지 않아 작업을 이어갈 수 있었기 때문이다. 해석이 틀리면 실제 프레임 끊김이 남은 상태를 해결로 오인할 수 있다. 최종 결과에서도 NV-03은 미측정으로 유지했다.
5. **안내 문서의 React 18 표기를 실제 잠금 파일의 React 19에 맞추고, 기존 의존성 버전은 유지한다.** 이번 기능 구현에 의존성 업그레이드를 섞지 않기 위함이다. 해석이 틀리면 문서·실행 환경 불일치나 불필요한 의존성 변경에 따른 회귀·재설치 비용이 생긴다.
6. **completed 재활성화 금지는 코드 자가 재가입과 보강 때문에 부모·멤버를 강제로 활성화하는 경우에 적용한다.** Verify V02 축약문보다 Spec R1/R3 정본을 우선하여, 기존 강사의 명시 재초대 계약은 보존하고 신규 transition의 completed 복구는 거부한다. 해석이 틀리면 재초대 정책과 기존 호환 동작을 다시 검토해야 한다.
7. **V36의 현재 접속 회수 소비는 T03 입장·접속 권한 경계에서 완성한다.** T02는 자격 폐기·회수 의도의 원자 저장까지 담당하고, 기존 참관자만 처리하던 효과 소비 결함을 T03 완료 게이트에 포함했다. 이 경계를 잘못 해석해 소비 처리를 빠뜨리면 제외된 회원의 기존 접속이 유지될 수 있다.
8. **고정형 자동 완료는 마지막 정규 회차의 정상 종료에서, 정규 completed가 최소 하나이고 나머지가 completed/cancelled일 때만 수행한다.** 취소만 된 클래스나 보강 종료를 수료로 오인하지 않고, 정기형은 기존 명시 ends_on 조건을 유지하여 미래 회차가 없다는 사실과 수료를 구분한다. 해석이 틀리면 취소 이후 운영 완료 정책과 관련 상태·알림을 다시 검토해야 한다.
9. **누락된 active guest 정규 입장 교환을 기존 guest-entry 경로에 보완한다.** 활동 자격과 active 멤버의 본인 유효 참가행으로 교환하고 새 NULL guest 참가행을 만들지 않는다. 읽기 자격 예외는 completed의 지정 보강·취소 회차 대체로 제한해 비회원 핵심 입장 여정을 완성한다. 해석이 틀리면 자격 범위와 입장 권한을 다시 검토해야 한다.
10. **비회원 가입은 기존 이름·성별·생년월일·이메일 네 필수 항목을 보존한다.** T00 DTO의 선택 필드 표기와 기존 정책 재사용 문구의 충돌을 정리하고, 요청 없이 가입 정책을 완화하지 않기 위함이다. 연구·리포트 동의는 계속 선택 사항이다. 해석이 틀리면 가입 마찰과 필수 정보 수집 정책을 다시 검토해야 한다.
11. **안전하지 않은 guest 병합은 미리보기200에 충돌을 표시하고 확정에서409로 거부하며, 보강 예약을 조용히 취소하지 않는다.** 실제 기록을 보존할 행을 선택하는 과정에서 유효 보강의 원참가행을 무효화하지 않고, 사용자 예약과 원 FK를 보존하기 위함이다. 해석이 틀리면 병합 전에 사용자가 예약을 수동 취소해야 하는 운영 비용이 생긴다.
12. **클래스 본인의 연구 철회는 canonical 소유 동의 행·현재 상태·이벤트로 한정하고 전역 ResearchWithdrawalRequest를 만들지 않는다.** 기존 전역 철회 판정이 다른 클래스의 미래 동의까지 막기 때문이다. 플랫폼 관리자의 기존 전역 철회는 유지한다. 해석이 틀리면 연구 외부 삭제 확인 응답(ack)의 적용 범위를 다시 검토해야 한다.
13. **멤버 FK가 없는 이메일 초대는 이메일 일치만으로 guest에 귀속하거나 삭제하지 않는다.** 스크럽 후 원문 재노출 차단은 명시 member ID가 있는 작업 결과 DTO에 적용하고, 독립 초대메일의 보관 정책을 유지한다. 비회원 리마인더는 기존 전체 미발송을 유지하며 opt-in=true를 이유로 새 전달 채널을 만들지 않는다. 해석이 틀리면 초대 연락처 보관 정책과 별도 전달 채널을 후속 검토해야 한다.

14. **최종 수정 담당에게 미배포057 단일 소유권을 위임하고 기존 회차 동의·보강 원결석을 보수 보존한다.** root 승인으로056 기존 참가행의 두 override를 true로 설정한다. 기존 선택과 기본값 사본을 확정 구분할 수 없기 때문이며, legacy행은 이후 클래스 기본값 자동전파에서 제외되는 비용이 있다. 보강 원결석을 무효화하는 명시 변경은409지만 탈퇴·제외는 차단하지 않는다. 유효보강 원본 excused만 보존하고 자격회수·대상미래행철회를 유지하여 원FK·감사·보안을 함께 보존한다. 비용은 이탈 후 미래 원행에 excused가 남아 운영화면에서 멤버상태·참여범위를 함께 해석해야 한다는 점이다. 복구 후 withdrawn 대상 예약의 명시취소 capability는 기존 서버 허용조건에 맞춘다. 완료 보강 자동취소·감사변조·새상태는 추가하지 않는다.

## 환경·SHA·스위치

- 작업: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`, branch `sdd/217-class-structure-phase4`.
- HEAD/기준 SHA: `a4acf6ba0c434fd40f7eb70ce573e7ad1a7699b4`. 구현은 미커밋 변경이며 새 배포 SHA가 없다.
- PostgreSQL: localhost `55437`, 테스트 DB `sdd217_test`, 브라우저 전용 DB `sdd217_browser`. 새 빈 browser DB 전체 migration 및 head `e036a0000057` 적용(root 준비). Redis `55438`, API `55439`, FE `55440`.
- Chrome headless 실제 브라우저·실제 FastAPI/Socket.IO·실제 PostgreSQL. viewport 390×844, 834×1194, 1194×834, 1280×720. 실제 휴대폰·iPad 기기 검증 아님.
- `CLASS_SCHEDULING_ENABLED=true`. 팀 참관/rolling/연구 외부 export 등 별도 기능 스위치는 기본 off 유지. 실 LINK BAND·카메라·LiveKit 외부 서버·Resend/푸시·Spark 자격을 사용하지 않았다. 기존 외부 dev/prod와 기존 E2E lib 기본 주소는 실행하지 않았다.
- FE localhost API·Socket.IO proxy 및 토큰 CSS dev resolve 연결은 root가 임시 개발서버 구성으로 제공했다. 실제 `.env`/실계정은 읽지 않았다. fixture는 환경파일이 있으면 읽기 전에 거부한다. 합성 비밀번호는 `/private/tmp/sdd217-browser-fixture.json` 0600에만, 로그인 access/guest 자격은 브라우저/Node 메모리에만 둔다. 스크린샷 output 자격은 숨긴다.
- T11 BE 수정 후 root가 API를 재시작했다. 운영 배포·cron/전달 채널 활성화는 미수행이다.

## T11에서 실제로 발견하고 고친 결함

1. **조회가 작성 중인 동의 선택을 덮음.** 사전 결석 취소 뒤 지연된 membership 응답이 체크한 report 선택을 지워 PUT에는 research만 남았다. 브라우저2회 재현 및 신규 DOM1개 RED. `ConsentSettings`에서 dirty 필드는 보존하고 미수정 필드만 새 서버값을 반영한다. 신규1+기존31=32 PASS, 실제 PUT/GET 모두 report/research=true 확인.
2. **운영 autoflush=False에서 guest 버전 증가가 유실됨.** `_revoke`의 변경 뒤 `lock_context.populate_existing`이 entry_ver를 덮어 병합→단회 복구에서 `class_effects` 키 중복500을 만들었다. 운영 설정 PG2개 RED 후 잠금 조회를 변경 앞으로 이동했다. 신규2+guest41=43 PASS. 연속 merge(1)→exchange(2)→refresh(2)→logout(3)→재복구(4)와 이전 grant 회수 확장 후 신규3만 재실행 PASS. refresh는 기존의 사용 grant만 회수하는 의미를 유지했다. 실제 브라우저 복구 교환200·재사용401·이탈 읽기·로그아웃 회수 확인.
3. **타일과 호스트 집계가 서로 다른 근거를 사용함.** 시각 검증에서 타일은 체크인 완료/참여 중인데 헤더는 접속2/2·체크인0/2였다. 신규4개 RED. 현재 접속은 서버 presence=connected, 체크인은 저장된 completed로 칩/오프라인 요약/시트가 같은 근거를 쓴다. 미접속 후에도 체크인 완료를 유지하며 대기실 원문만으로 완료를 추정하지 않는다. 밴드 연결 문구를 접속 인원과 구분했다. 하니스는 명시 서버 상태를 합성하고, 오프라인 기대값을 지속 체크인7/8로 정정했다. 관련 FE172 PASS 및 최신 실제 화면에서 접속1/2·체크인1/2·밴드 연결0 일치 확인.

T11 제품 변경은 `member-operations.tsx`, `class_guest_service.py`, `host-player-case.ts`, `fixtures/host-cases.ts`, `HostChipLine.tsx` 5파일이다. 신규 FE 회귀2파일(5개), PG 회귀1파일(3개), 기존 FE fixture/기대2파일, E2E 하네스·fixture2파일, 본 summary·증거·T11 보고서를 추가/갱신했다. T00~T10의 전체 변경은 [변경 파일 목록](evidence/changed-files.txt) 및 [태스크별 보고서](evidence/prior-task-reports/)에 있다. 타 작업을 reset·커밋·push·merge하지 않았다.

## 독립 리뷰 보완 — 참여 중 상태의 4뷰포트

최초 V30 촬영이 최종 정규 회차 종료 뒤 left/completed 상태에 집중되어 active 회원의 활성 조작 영역이 빠졌다는 지적을 확인했다. 보완 전 V30을 PARTIAL로 낮춘 뒤, `--active-layout-only`로 별도 실제 active 클래스를 준비했다. 첫 정규 회차는 실제 정상 종료·결석, 다음 정규 회차는 미래 일정, 개인 보강 대상은 빈 makeup 회차로 두고 부모와 회원 active 상태를 유지했다.

390×844·834×1194·1194×834·1280×720 각각에서 참여 중 배지/나가기, 사전 결석 버튼, 선택한 원/대상 회차의 보강 신청, 편집 가능한 선택 동의와 저장, 예약 후 보강 배지·취소 버튼을 촬영했다. **추가20장 모두 view_image로 시각 확인**했고 각 본문의 가로 넘침·클리핑은0이었다. 실제 UI 동의 저장200·사전 결석200·복귀200·보강 예약201 후 회원 active/예약1도 확인했다.

추가 실행은 로그인4개와 준비/촬영/저장/예약촬영을 포함한 **8 helper 단계 PASS/0 실패**이며 기존 전체 여정23개나55 ID에 더하지 않는다. 제품 코드 변경·단위/전체 BE 재실행은 없었다. 이 추가 증거로 V30을 PASS로 복원했다. [active 결과](evidence/T11-active-layout-results.json) · [active 수치](evidence/T11-active-layout.json) · [추가 로그](evidence/T11-active-layout.log) · [20장 시각 점검 링크](evidence/T11-visual-review.md#독립-리뷰-fix1-active-활성-조작-영역).

```bash
# repo root — 기존 localhost API/PG/Redis/FE 환경만 사용
node frontend/e2e/sdd217-class-membership.mjs --active-layout-only
# 8 helper steps passed / 0 failed, 4 viewports × 5 screenshot sections
```

## 실행 결과와 재현

관련 테스트는 반복/포함 관계가 있으므로 아래 수를 합산하지 않는다. root 최종 BE gate는 BE 마지막 수정 후, root FE63/build는 마지막 호스트 집계 수정 전 결과다. 그 뒤 FE172와 최신 build를 수행했다. 전체 저장소 BE/FE 회귀는 실행했다고 주장하지 않는다.

```bash
# repo root — 실제 브라우저 환경은 위 포트로 root가 기동
'/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' frontend/e2e/sdd217-browser-fixture.py init
node frontend/e2e/sdd217-class-membership.mjs
# 23 passed / 0 failed; 마지막 제품 수정 후 재실행
node frontend/e2e/sdd217-class-membership.mjs --layout-only
# 동일 데이터의 아래 스크롤 추가 확인(6 helper steps); 23개에 합산하지 않음

# frontend — 동의 수정 후 집중 회귀
npx vitest run tests/sdd217-integration-regressions.test.tsx tests/sdd217-member-operations.test.tsx
# 32 passed
# frontend — 마지막 집계 수정 후 관련 회귀
npx vitest run tests/sdd217-host-summary.test.ts tests/sdd217-participation.test.tsx tests/class-player-host-case.test.ts tests/class-player-host-view.test.tsx tests/class-player-host-detail.test.tsx tests/class-player-host-container.test.tsx tests/class-player-host-model.test.ts tests/class-player-host-sheets.test.tsx
# 8 files / 172 passed
npm run build
# tsc -b + vite build exit0. 기존 ineffective dynamic import/큰 chunk 경고

# backend — T11 guest 수정 후 집중 회귀
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_browser_regressions.py tests/pg/test_sdd217_guests.py -q --tb=short
# 첫 신규2+기존41=43 passed. 확장 신규3 단독 3 passed(중복 합산 금지)
# root 최종 변경범위 gate, backend cwd
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_*.py -q --tb=short
# 211 passed / 7 warnings / 29.42s
DATABASE_URL=sqlite:// '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest tests/test_sdd217_contract.py tests/test_sdd217_read_access.py -q --tb=short
# 6 passed / 1 warning / 1.58s
# root FE SDD217 8파일 gate: 63 passed. 이후 위172/build가 마지막 수정 검증
```

증거: [브라우저 결과](evidence/T11-browser-results.json) · [브라우저 로그](evidence/T11-browser.log) · [레이아웃 수치](evidence/T11-layout.json) · [시각 점검](evidence/T11-visual-review.md) · [최신 FE172](evidence/T11-summary-counts-green.log) · [최신 build](evidence/T11-final-build.log) · [최종 PG211](evidence/final-pg.log) · [SQLite6](evidence/final-sqlite.log) · [root FE63](evidence/final-fe.log).

## 기준선·중간 오류 구분

- T10 이전부터 있던 wizard navigation3개(counselor `/classes/new`, org_admin 동일, legacy `/sessions/new`→wizard)의 route-mock 기대 실패는 T10 이전 App 사본에서도 재현됐다. [T10 보고서](evidence/prior-task-reports/T10-report.md) 기록을 보존한다. 이번 실제 UI wizard 생성은 통과했으나 그3개 단위 테스트를 전체 GREEN으로 계산하지 않는다.
- 기존 host-container 네트워크 테스트1개는 T04의 presence 미확인 우선 규칙 때문에 `수신 일시 중단` 대신 `접속 확인 중`으로 실패했다. T11 이전 모델 import 사본에서도 동일하게 재현([기준선 로그](evidence/T11-host-container-baseline.log)). 이 테스트의 의도인 서버 접속 확인된 행을 fixture에 명시한 후29개를 포함한172 PASS. unknown의 제품 표시를 바꾸지 않았다.
- 하네스 초기 로그인 응답 대기·로비/라이브 화면 구분·생성201 기대·반복 실행 일정 충돌, 잘못된 cwd/파일 이중경로는 하네스/명령 준비 오류이며 제품 RED에 넣지 않는다. 수정 전 제품 RED는 위3건(동의1·guest2·집계4)만 별도 기록했다. 전체 기능의 선행 RED는 각 태스크 보고서를 따른다.
- 실제 브라우저의 웹푸시 공개키503은 합성 로컬 환경의 전달 자격 미설정이다. 권한 검사에서 의도한401/404, 화면 전환의 ERR_ABORTED와 구분한다. 마지막 브라우저에 pageerror는 없으며 클래스 쓰기/읽기의500은 없었다. 외부 푸시 성공으로 해석하지 않는다.

## Verify 55 ID별 판정

PG/DOM/API의 세부 함수·개별 RED/GREEN·경합 근거는 보존한 [태스크 보고서](evidence/prior-task-reports/) 및 실제 테스트 파일에 있다. T00~T10 보고 수를 중복 합산하지 않고 root의 변경범위 PG211과 T11 실제 브라우저 증거를 연결했다.

| ID | 결과 | 실제 근거·한계 |
|---|---|---|
| V01 | PASS | T02 PG: 같은 멤버 ID·재가입·미래행만 생성 |
| V02 | PASS | T02 API/PG: removed 자가 재가입 거부·강사 복구. 기존 explicit reinvite 의미는 보존 |
| V03 | PASS | T02 독립 PG 3연결: 마지막 자리 restore/promote/join 정원·FIFO |
| V04 | PASS | T02 PG: FIFO·대기 취소/재신청·정원 축소 |
| V05 | PASS | T02 PG + T11: 미래행 철회·과거 본인 리포트 보존 |
| V06 | PASS | T02 PG: 효과 저장 실패 원자 롤백·멱등. 외부 전달 수신 증거 아님 |
| V07 | PASS | T03 PG + T11 실제 before 체크인/enter: 초대·체크인만으로 attended 아님 |
| V08 | PASS | T03 PG + T11 실제 end: 미입장 expected만 absent |
| V09 | PASS | T03 독립 PG 2연결: 반환 좌석 점유 뒤 복귀 거부 |
| V10 | PASS | T03 API/PG + T11 UI 강사 정정: 사유/이전·이후 감사 |
| V11 | PASS | T05 PG: 다른 클래스/멤버·원결석 없음·동일 회차 거부 |
| V12 | PASS | T05 독립 PG 2연결: 원결석 예약 1개·대상 정원 |
| V13 | PASS | T05 PG + T11 UI 예약/실입장: 원 absent 유지·보강 완료 1 |
| V14 | PASS | T05 PG: 취소/재예약·수료 후 지정 보강·부모 completed 유지 |
| V15 | PASS | T07 PG + T11 공개 UI 2가입: NULL guest 분리 |
| V16 | PASS | T07 API/PG: 90일·변조·클래스 범위·entry_ver·로그아웃 |
| V17 | PASS | T07 PG + T11 UI 명시 병합: 원 참가자/리포트 FK 보존 |
| V18 | PASS | T07 PG: 실제 기록 충돌409·실패 전체 롤백·재시도 |
| V19 | PASS | T07 API/PG + T11 옛 활동/읽기 4자격401 |
| V20 | PASS | T08 API/PG + T11: 세 선택 기본false·미동의 입장 허용 |
| V21 | PASS | T08 PG + T11 동의 저장: 미래 미입장만·override/과거 보존 |
| V22 | PASS | T08 PG/기존 export 회귀 + T11 O3 원선택 ID 복사. Spark 실전달 아님 |
| V23 | PASS | T08 PG: canonical 90일 경계·동시 스크럽·재발송 차단 |
| V24 | PASS | T08 API/PG: 코드 회전·기존grant 유지·비회원 리마인더 제외. 실제 수신 미측정 |
| V25 | PASS | T09 API/PG + T11: 중간 합류 전 메타만·결석에 점수 없음 |
| V26 | PASS | T09 API/PG + T11: left 본인 승인리포트200·타인404 |
| V27 | PASS | T09 API/PG: canonical distinct 집계·기존216/관리자 제한 |
| V28 | PASS | T10 DOM: 성공/403/409/통신 실패. T11 주요 성공 여정 실제 서버 반영 |
| V29 | PASS | T10 DOM: 연속 클릭·계정 전환 폐기·멱등 재시도 |
| V30 | PASS | T11 기본 4화면×4뷰포트/하단12장 + fix1 active 4뷰포트×5영역20장. 활성 사전결석·보강신청·동의저장·예약취소, view_image 시각 확인·본문 가로 넘침/클리핑0 |
| V31 | PASS | T11 UI 초대/복구/정정·회원 나가기/보강/동의, 실제 API·PG 반영 |
| V32 | PASS | T11 실제 BE+PG 브라우저 23시나리오: 생성→초대→중간합류→입장→결석→보강→이탈→본인 리포트 |
| V33 | PASS | T11 linkband_mode=none·장치 미연결 핵심 여정. 참관 off 유지 |
| V34 | 미측정 | 배포 승인 없음. push/merge/deploy·운영 cron·외부 전달 확인 미실행 |
| V35 | PASS | T05 PG: 기존 보강 생성 경로 검증·취소 대체 별도·legacy user ID 보존 |
| V36 | PARTIAL | T03 PG 2연결·실제 loopback WS 회수 PASS. 외부 LiveKit 실제 권한 회수/여러 워커 미측정 |
| V37 | PASS | T07/T09 PG: 다른 과거 이력 보존·미래 중복1좌석·원 FK 유지 |
| V38 | PASS | T07 API/PG + T11 UI: 옛4grant401→10분 단회 복구/재사용401→left 본인과거200→로그아웃 report404. 운영 autoflush=False 신규 PG3 추가 |
| V39 | PASS | T08 PG: 기본값 false와 명시 철회 구분·종료 증빙/로컬 export 제외. 외부 Spark 삭제 확인 아님 |
| NV-01 | PASS | T01 실제 LiveKit SDK+합성 미디어 경계: 같은 객체 restart/replace 원본 교체 |
| NV-02 | PASS | T01 DOM/SDK: 타이머 재렌더 attach/방 재마운트 방지·unmount detach |
| NV-03 | 미측정 | 실카메라 영상입력0 관찰·촬영/권한 요청/fake camera 없음. 녹화 켬/끔·장치 복구 프레임 미측정 |
| NV-04 | PASS | T04 API/DOM + T11 실제 REST 체크인·실입장·타일/체크인1/2 복원 |
| NV-05 | PASS | T04 PG/WS + T11 진행 중 늦은 실제 enter/WS connected·헤더1/2 |
| NV-06 | PASS | T11 호스트 실제 reload: completed 체크인·현재 접속·헤더/타일 일치 |
| NV-07 | PASS | T11 초대2명 lobby 미입장·체크인 unknown. 신규 FE 집계에서도 접속 추정 금지 |
| NV-08 | PARTIAL | T11 실제 WS disconnect/reconnect·버전 증가·체크인/attended 보존. 역순 이벤트/TTL 제어시각은 T04 DOM/PG, 실제90초 벽시계 만료/여러워커 미측정 |
| NV-09 | PASS | T06 PG + T11 즉시1회 정상 end 직후 parent completed·cron 불필요 |
| NV-10 | PASS | T11 열린 상세 focus 재조회와 종료 상세 completed 실제 표시 |
| NV-11 | PASS | T06 독립 PG 2연결: 동시/재시도 end·완료/출석/효과 중복 없음 |
| NV-12 | PASS | T06 PG/DOM: rolling 미래0·cancel-only·makeup 종료를 완료로 오판하지 않음 |
| DOC-01 | PASS | 공식217·전용 branch sdd/217-class-structure-phase4·기준 SHA a4acf6ba·기존 dirty 변경 보존 |
| DOC-02 | PASS | R1~6→T00~11·V39개/NV12개/DOC4개=55 대응을 spec/plan/verify/계약/본표로 점검 |
| DOC-03 | PASS | 상담 Phase6/7·리포트 Phase5 제외. 216 재사용·확장·실측 미확인 구분 |
| DOC-04 | PASS | 사용자 2026-10-19 구현 승인 기록·구현 전 Verify 보존·문서 링크/공백 최종 점검 |

## 남은 위험·승인 사항

- **NV-03 실카메라 프레임은 미측정.** macOS `system_profiler SPCameraDataType` 출력이 없었고 Chrome enumerateDevices에는 audioinput/audiooutput만 보였다. 물리 장치가 아예 없다는 확정 증거는 아니다. getUserMedia/사용자 촬영/외부 공유/fake camera는 수행하지 않았다. 녹화 켬/끔·장치 복구 전후 프레임 비교와 실제 LiveKit 미디어 연결 검증이 필요하다.
- V36 외부 LiveKit 권한 회수·여러 WS 워커, NV-08 90초 실제 벽시계 lease 만료/정리 지연은 미측정이다. DB lease/제어시각/역순 이벤트·실제 단일 워커 WS 회수 증거만 있다.
- 실제 메일·푸시 수신, Spark 내보내기·삭제 ack, 운영 cron·자격·보관 sweep 배치 실행은 미측정이다. 로컬 효과 의도/철회·export 제외와 외부 전달을 분리한다.
- 정규 클래스 다건 DTO의 N+1은 T09에서 유보된 성능 위험이다. 기존 legacy 상수 질의 테스트 통과를 신규 정규 다건 성능 보장으로 해석하지 않는다.
- 실제 장치/휴대폰, 전체 저장소 회귀, 운영 데이터 검증은 수행하지 않았다. 제품 push·merge·배포는 승인되지 않았으며 **V34 미실행**이다. 최종 독립 리뷰는 통과했으며 Brian의 Stage⑦ 승인이 남는다.

## 최종 리뷰 결과

최종 전체 리뷰 Important 4건을 단일 수정 단계에서 보완하고, 독립 재리뷰에서 4건 모두 ADDRESSED·새 Critical/Important 0건으로 판정됐다. 최종 관련 검증은 PG172·SQLite26·FE67·빌드 성공, 마지막 예약 취소 표시 보완 후 PG41 성공이다(중복 합산하지 않음). 이는 코드리뷰 통과이며 Brian의 Stage⑦ 승인 또는 운영 배포 완료를 의미하지 않는다. [최종 수정 보고서](evidence/final-fix-report.md)를 참조한다.

## 2026-10-20 통합 승인

사용자가 미검증 항목을 후속으로 분리하고 검증 완료 범위의 커밋·develop 통합·dev 배포를 승인했다. 위의 승인 전/미커밋 상태는 구현 시점 기록이며, 최신 상태와 제외 항목은 [통합·배포 기록](integration-closeout.md)을 따른다. 실카메라·외부 연동 검증 완료를 뜻하지 않는다.
