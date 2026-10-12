# SDD-065 Summary — 리포트 목록 사용자 정보 표시

## 구현 결과
- BE: list_reports 응답에 participant_name/gender/birth_date/is_guest 추가 (SessionParticipant/ClientProfile 병합)
- FE: ReportListPage 테이블에 사용자/성별/생년월일/회원·비회원 컬럼 추가
- FE: ReportDto에 participant 정보 필드 추가

## 핵심
- 회원: user.name + ClientProfile.gender/birth_date
- 비회원(게스트): guest_name + SessionParticipant.gender/birth_date
- 성별 male/female/other → 남성/여성/기타 표시, 회원·비회원 배지 구분

## 버그 수정 (겸함)
- test_report_04_목록_조회: SDD-058 페이지네이션으로 page/limit이 None으로 직렬화되는 걸 반영해 assertion 업데이트

## 검증·배포
- BE pytest 454 passed, FE build 0 error
- 커밋 `cf02611` → Deploy Dev `35048292624` 성공
