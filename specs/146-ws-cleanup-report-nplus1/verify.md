# SDD-146 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 세션 종료/마지막 참가자 이탈 시 5개 전역 dict 키 정리
- [ ] leave+disconnect 중복 정리 없음(멱등)
- [ ] client 리포트 생성 멱등·중복 방지 유지
- [ ] 서사 상태가 배치 캐시에서 올바르게 파생

## 품질

- [ ] 백엔드 pytest 1010 passed / 0 failed
