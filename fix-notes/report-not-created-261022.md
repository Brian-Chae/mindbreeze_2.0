# 리포트 상세 '세션을 찾을 수 없습니다' 진단 (10/22, 코드 수정 없음)

## 결론
- 리포트 생성은 **성공**. 문제는 **조회 권한 판정 버그**: 즉석 클래스 회원이 본인 리포트를 열면 404.
- 오늘 변경(SDD-228 STT 끄기, #44, #37, SDD-231)과 **무관**. SDD-217(10/20, e24923b4)의 `_participation_scope` 로직과 즉석 클래스(회차 scheduled_at=생성 시각)의 상호작용.

## 1. 오류 출처 (확정)
- 호출: `GET /api/v1/reports/{id}` (frontend `lib/api/reports.ts:154 getReport`, `ReportDetailModal.tsx:28-34` → catch → 빨간 박스 `error`)
- 서버 로그(backend, UTC): 12:06:48 / 12:06:57 / 12:07:06 / 12:07:10 에 서로 다른 리포트 3건 `GET /api/v1/reports/<id>` **404** (KST 21:06~21:07, 제보 시각과 일치). 같은 구간 다른 4xx/5xx·Traceback 없음.
- 404 발생 지점: `report_service.get_report` (backend/app/services/report_service.py:794-802) → `class_read_service.require_own_approved_report` (class_read_service.py:607-619). 이 함수는 내부 어떤 실패든 `HTTPException(404, NOT_FOUND="세션을 찾을 수 없습니다")`로 뭉개서 던진다(619행 except 재포장). 문구가 "리포트"가 아니라 "세션"인 이유.
- 후보 중 video.py/chat/session_service 등은 리포트 모달 본문 로드 경로가 아님(로그에 해당 호출 404 없음).

## 2. 리포트 생성 (성공)
- 세션 ffcc14f6… `POST /sessions/{id}/end` 11:42:54Z 200 → report worker `tasks.generate_reports_for_session` received 11:42:54 → **succeeded 0.40s** 11:42:55. 이후 `report-status` 200. Traceback·Error 0건(backend/report-worker/worker/stt-worker, 11:00~12:10Z).
- 리포트 목록 `GET /reports` 전부 200. 11:47:52 `approve-all` 200.
- 참고: 11:34 / 11:58Z 워커·백엔드 재시작(배포)이 있었으나 해당 종료 체인에는 영향 없음.
- STT는 꺼져 있어 요약 단계 스킵 → generation은 정상 완료(partial 아님 여부는 DB 미접근이라 미확인).

## 3. 원인 (코드 + 재현)
`get_report`는 `cls`가 있고 요청자가 staff가 아니며 `own_member` 또는 `cls.recurrence_rule is not None`이면 "개인 리포트 경로"를 탄다(report_service.py:794). 즉석 클래스는 `recurrence_rule={start_now:true}`라 항상 이 경로. 여기서 `_participation_scope`(class_read_service.py:407-411)가 **출석 여부 검사(413행)보다 먼저**
`session.scheduled_at < min(member.joined_at)` 이면 `before_join` 반환 → `!= "eligible"` → 404.
- 즉석 클래스의 정규 회차 `scheduled_at = now`(클래스 생성 시각; class_schedule_service.py:17-19)인데, 회원은 클래스 생성 **이후** 가입/입장하므로 `joined_at > scheduled_at` 항상 성립 → 정상 출석(attended)자도 본인 리포트 404.
- 로컬 재현(순수 함수 호출, DB 불필요, `venv/bin/python`): 즉석(가입 2분 뒤) → `before_join`, 일반 클래스(가입 하루 전) → `eligible`. (로컬 테스트 DB는 만들지 않음.)
- 정규 예약 클래스도 "회원이 가입한 뒤 열린 회차"면 정상이지만, 가입 전에 이미 잡혀 있던 회차는 의도대로 숨김. 즉석만 의도와 어긋남.
- 한계: Brian 계정이 실제로 이 경로(회원)였는지는 DB 미조회로 미확인. 호출 404 패턴·코드 경로상 가장 유력(확정 아님, 높음).

## 4. 수정안 (FIX 카드로 발행 필요)
- 파일: `backend/app/services/class_read_service.py:_participation_scope`
- 방법: `attendance_status in (attended, absent, excused)` 판정(413-414)을 `before_join` 판정(410-411)보다 **앞**으로 이동(과거 참가 근거는 우선한다는 주석 의도와 일치). 보강: 즉석 클래스(`start_now`)는 before_join 비적용도 고려.
- 테스트: `tests/pg/test_sdd217_read_access.py`에 즉석 시나리오 추가 — 회차 scheduled_at < member.joined_at 이고 attended+completed 리포트 → `GET /reports/{id}` 200; 미참석(expected) 가입 전 회차는 계속 404(기존 L44-47 유지). 목록의 `approved_report_ids`/`participation_scope` 회귀도 확인.
- 부가: `require_own_approved_report`의 except 재포장(619행)이 원인을 숨기므로 서버 로그에 사유(code) 남기기 권장. 프론트는 404 시 "세션" 문구 대신 안내 문구로.
- 긴급도: **중~높음** — 즉석 클래스 회원은 전원 본인 리포트 열람 불가(dev, 릴리즈 전). 데이터 손실 없음, 수정 배포 후 즉시 복구.

## 5. Brian 결정 필요
- 즉석 클래스에 한해 "가입 전 회차" 숨김 규칙을 끌지, 출석 우선 규칙만 적용할지(권장: 출석 우선만). 
- 수정 배포 타이밍(테스트 중이면 대기, 배포 승인).

## 수정 (TASK BOX)
- `_participation_scope`의 가입 전 회차 판정 기준을 `scheduled_at` → `ended_at`(없으면 scheduled_at)으로 변경.
  출석 우선으로 순서를 바꾸는 안 대신 이 방식을 택한 이유: 기존 v25(가입 전 회차는 출석 기록이 있어도 숨김) 규칙을 그대로 지키면서,
  회차가 끝나기 전에 가입한(=진행 중 입장한) 회원만 eligible 로 본다.
- 테스트: test_instant_joined_during_session_reads_own_report 추가(수정 전 실패 확인). PG 로컬 sdd217 28 pass, 관련 pg 357 pass. 임시 DB mb_fix_report 삭제함.
