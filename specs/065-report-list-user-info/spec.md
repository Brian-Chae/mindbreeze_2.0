# SDD-065 — 리포트 목록 사용자 정보 표시 (이름/성별/생년월일/회원·비회원)

> 리포트 목록에 사용자 이름·성별·생년월일을 표시하고, 회원인지 비회원(게스트)인지 구분한다.

## 1. 현황
- 리포트 목록 API(list_reports/_serialize)가 participant 정보(이름/성별/생년월일/회원여부)를 반환하지 않음.
- ReportDto(프론트)에도 해당 필드 없음.

## 2. 구현 범위
### BE (codex)
- list_reports/_serialize에 participant 정보 포함:
  - `participant_name` (게스트 guest_name / 회원 user.name)
  - `gender` (participant.gender / client_profile.gender)
  - `birth_date` (participant.birth_date / client_profile.birth_date)
  - `is_guest` (participant.user_id 없으면 true)
- 리포트의 participant_id → SessionParticipant 조회 → 위 정보 병합

### FE (cursor)
- ReportListPage 테이블에 컬럼 추가: 사용자(이름) / 성별 / 생년월일 / 구분(회원·비회원)
- 회원·비회원은 배지로 구분 (회원=보라/비회원=회색 등)

## 3. 주의
- 성별 값: male/female/other → 남성/여성/기타 한글 표시
- 생년월일: YYYY-MM-DD 표시 (없으면 '—')
- SDD-064(모달)와 ReportListPage 수정 충돌 주의 — 순차 진행

## 4. 완료 기준
- 리포트 목록에 이름/성별/생년월일/회원·비회원 표시
- BE pytest, FE build 0 error
