# SDD-145 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 신규 Google 가입 시 consents 미동의/누락 → 422
- [ ] 신규 Google 가입 시 동의 항목별 실제 값 기록
- [ ] 기존 사용자 재로그인 시 consents 없이 200
- [ ] 프론트 Google 로그인에 동의 체크박스 표시
- [ ] 미동의 시 로그인 차단 + 안내

## 품질

- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 vitest + build 통과
