# SDD-329 verify (구현 전 QA 체크리스트)

## A 종료 멱등
- [ ] completed 회차 end 재호출 → 200, 첫 호출과 동일 키 세트의 SessionResponse
- [ ] 동시 2회 호출 모두 200, 500 없음
- [ ] 잠금 실패(OperationalError LockNotAvailable) 시 상태 재조회 후 completed면 200
- [ ] 비호스트는 여전히 403 (권한 완화 없음)
## B 승인 역행
- [ ] 생성 중 다른 트랜잭션이 승인(completed) → 저장 후 status=completed, content.approved 유지
- [ ] 미승인 리포트는 기존대로 pending_review
- [ ] 신선한 processing 상태의 동일 리포트 중복 생성 호출은 skip
- [ ] 역행 방지 시 로그 남김
## C presign 403
- [ ] 권한 거절은 계속 403 (429 아님), 사유 코드 로그, 로그에 원문 user id 없음
- [ ] 같은 (사용자,회차) 반복 거절 시 두 번째부터 DB 조회 없이 403
- [ ] Redis 장애 시 기존 동작(캐시 우회)
- [ ] 정상 참가자 presign 영향 없음
## D 미측정 그룹 리포트
- [ ] 입장+report_included+측정 없음 → member_report.meta.band_status=not_worn, group_story 존재, "그룹 기록" 첫머리
- [ ] 그룹 n≥10 → 그래프 데이터, n<10 → 서사만(숫자 미전송)
- [ ] 금지어(점수·등급·스트레스·우울·진단합니다·위험)·'불규칙'·본문 'ms' 0, AI 호출 0
- [ ] PDF 책 렌더 성공, 문의: 담당 클래스 코치
- [ ] 자동 승인 흐름에서 pending_review 정체 해소(동의 규칙 `report_included` 우선)
- [ ] 기존 worn 리포트·골든 픽스처 무변경
