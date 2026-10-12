# SDD-072 구현 전 검증 기준

작성 시점: 2026-09-16, 프로덕션 코드 변경 전.

## 인증 계약
- [ ] 이메일 role 생략 요청은 기존과 동일하게 성공한다.
- [ ] 올바른 비밀번호이나 선택 역할이 다르면 403 및 지정 안내문, access/refresh 발급 없음.
- [ ] 이메일 자격 증명 오류·잠금의 기존 응답을 유지한다.
- [ ] Google 기존 계정 역할 불일치는 토큰 발급 및 계정 연결 변경 전에 차단한다.
- [ ] 신규 counselor/org_admin Google 요청은 계정을 생성하지 않는다.
- [ ] 관리자 Google의 기존 도메인 승인 정책을 유지하고 일반 요청은 승격하지 않는다.
- [ ] 프런트는 잘못된 역할/사용자 응답을 토큰·localStorage·Zustand 저장 전에 차단한다.

## 화면·경로
- [ ] 기본·미지원 role은 회원, 공개 3탭과 관리자 모드는 분리한다.
- [ ] 회원 Google 우선, 상담사 이메일 우선, 기관 이메일 전용·가입 없음.
- [ ] 탭 클릭·뒤로 가기·새로고침의 URL 상태, 이메일 유지 및 비밀번호·오류 초기화.
- [ ] tablist/tab/tabpanel 관계, aria-selected, 좌우/Home/End 키보드 이동.
- [ ] 인증 중 중복 실행 차단, Google 취소·실패 시 잠금 해제, 시작 시 role 고정.
- [ ] /login/client는 replace로 회원 탭 이동, /admin은 관리자 모드 유지.
- [ ] 회원/상담사 온보딩 완료·미완료 이동, 기관 dashboard/org 이동.
- [ ] 관리자 next는 /admin 또는 /admin/ 경계만 허용하고 외부·비관리자 경로 차단.
- [ ] 역할 시뮬레이션은 기존 VITE_ENABLE_ROLE_SIM 조건 유지.

## 실행
- 대상 인증·프런트 회귀 테스트에서 RED 후 GREEN 확인.
- `cd backend && venv/bin/pytest` 전체 실행.
- `cd frontend && npm run build` 오류 0 확인, 관련 프런트 테스트 실행.
- 실제 브라우저·실제 Google 공급자 검증 여부는 별도 기재.
