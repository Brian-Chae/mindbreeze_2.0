# SDD-086 — 세션 종료 시 리포트 2종류 자동 생성

> 세션 종료 시 상담사 세션 리포트(counselor) + 내담자 리포트(client)를 자동 생성한다.
> 마이크 오프 세션은 AI 기록(전사·요약) 제외 + EEG/PPG/ACC 몸·마음 리포트만 생성 (SDD-085 로직 재사용).
> **claude(fable) 위주 개발**.

## 1. 배경
- 리포트 2종류 생성 로직은 이미 있음: `report_task.py`의 `_counselor_content` / `_client_content`
- 마이크 오프 처리도 이미 있음: `_ai_record_block` (manual → not_available/mic_off), `content.eeg`는 항상 생성
- **갭: 세션 종료 시 리포트 자동 생성 트리거 없음** — 현재는:
  - counselor 리포트: 상담사가 리포트 목록에서 수동 생성 (`POST /reports/generate/{sessionId}`)
  - client 리포트: 내담자가 완료 화면에서 "리포트 신청" 시 생성 (`request_report_email`)

## 2. 요구 (Brian)
1. 상담사에게 2가지 리포트: (a) 플랫폼 AI 제공 세션 리포트(counselor), (b) 내담자 제공 리포트(client)
2. 두 리포트 모두 **세션 종료 시 자동 생성**
3. 마이크 오프 세션: AI 기록(전사·요약) 제외 + 몸·마음(EEG/PPG/ACC) 리포트는 정상 생성

## 3. 구현 범위

### T1. BE — 세션 종료 시 리포트 자동 생성
- `session_service.py` `transition_status('end')`에서 audio/video finalize 후 리포트 생성 호출
- counselor 리포트: `report_service.generate_report(session_id, host_id, "counselor", db)` 호출
- client 리포트: 세션의 각 participant(대기열 제외)별로 type="client" 리포트 생성
  - 각 participant_id 기준으로 리포트 생성 (그룹 세션 N명 지원)
  - 1:1 세션도 동일 처리 (내담자 1명)
- best-effort: 리포트 생성 실패해도 세션 종료는 성공 (audio finalize와 동일 패턴)

### T2. BE — participant별 client 리포트 생성 헬퍼
- `report_service`에 `generate_client_reports_for_session(session_id, db)` 추가
- 세션의 active participant(비대기열) 순회 → 각각 client 리포트 생성
- 기존 report_email_service의 participant 기반 client 리포트와 정합 (중복 생성 방지 — existing 체크 재사용)

### T3. 마이크 오프 세션 처리 확인
- counselor/client 리포트 모두 `generate_report_inline`이 `_ai_record_block`으로 manual 처리
- 몸·마음(EEG/PPG/ACC)은 `_build_eeg_content`로 정상 생성 (SDD-085 이미 반영 — 회귀 없어야 함)

## 4. 주의
- 리포트 생성은 기존 `report_service.generate_report`의 existing 체크로 멱등 처리 (중복 생성 방지)
- client 리포트는 participant별 — `participant_id` 기준. 기존 `report_email_service.request_report_email`의 participant 리포트와 충돌 없어야 함
- 마이크 오프 세션은 transcript 없음 → ai_record not_available (기존 로직)
- 승인/발송 정책 유지: client 리포트는 상담사 승인 후 발송(pending_review), counselor 리포트는 상담사 열람
- auto_approve_report 켜져 있으면 자동 승인 (기존 로직 유지)
- EEG 미측정 participant도 리포트 생성 (eeg status not_measured, ai_record만 있음)

## 5. 완료 기준
- 세션 종료 시 counselor 리포트 + 각 내담자 client 리포트 자동 생성
- 마이크 오프 세션도 AI 기록 제외 + 몸·마음 리포트 정상 생성
- BE pytest 통과(신규 테스트 포함), FE 변경 없음 (BE 위주)
