# SDD-072 — 로그인 3탭 통합 (회원/상담사/기관) + 플랫폼 관리자 /admin 별도

> 기획안 `docs/login-tab-기획.md`의 MVP 구현.
> `/login`을 회원/상담사/기관 3탭 단일 화면으로 통합하고, 플랫폼 관리자는 `/admin` 별도 진입으로 유지한다.

## 1. 범위
- FE: `/login` 단일 화면 + 3탭(회원/상담사/기관, 기본 회원)
- 플랫폼 관리자: `/admin` 별도 진입(`?role=platform_admin` 유지)
- `/login/client` → `/login?role=client` 리다이렉트 (하위호환)

## 2. 탭 구성
- 회원(client): Google 로그인 우선 + 이메일·비밀번호. `/register?role=client`, `/forgot-password`
- 상담사(counselor): 이메일·비밀번호 중심 + Google 보조. `/register?role=counselor`
- 기관(org_admin): 이메일·비밀번호 (기관 발급 계정). 신규 가입/Google 버튼 없음

## 3. 구현 (codex gpt-6-astra)
### T1. FE 로그인 통합
- LoginPage를 공통 화면으로 통합: 공통 레이아웃 + 이메일 폼 + Google 버튼 + 오류 처리 재사용
- 탭별 설정(제목/안내/버튼 문구/허용 인증수단/요청 역할) 분기
- ClientLoginPage 동작 흡수 → `/login/client`는 리다이렉트만
- 탭 상태 = URL `role` 파라미터 (client/counselor/org_admin). 기본/누락/미지원 → client
- 탭 전환 시 이메일 유지, 비밀번호·오류 초기화. `tablist/tab/tabpanel` + aria-selected + 키보드 이동

### T2. 플랫폼 관리자 /admin
- `/admin` 접근 시 미로그인 → 관리자 로그인(`?role=platform_admin`)으로 리다이렉트
- 관리자 모드: 공개 탭 대신 "플랫폼 관리자 로그인" + Google Workspace 인증. "일반 로그인으로 돌아가기" → `/login?role=client`
- 일반 로그인 화면에 관리자 링크/숨김 4번째 탭 없음

### T3. 역할 일치 검사 (보안 핵심)
- 탭 선택 role = 로그인 의도. 실제 권한은 서버가 결정
- 선택 role ≠ 인증된 role이면 "선택한 로그인 유형과 계정 유형이 다릅니다" 표시 + 토큰 저장 전 차단
- BE: 이메일 로그인 요청에 선택 role 선택적 필드 추가, 토큰 발급 전 역할 일치 검사 (기존 호출 하위호환)
- resolvePostLoginPath 공통 유틸 추출, 상담사 온보딩 분기 통일

## 4. 주의
- 서버 권한 검사가 1차 방어 (탭 검사·프런트 가드는 대체 아님)
- 기관 Google 버그: 신규 org_admin이 client로 잘못 생성되지 않도록 (기관 탭 Google 버튼 미노출)
- 신규 상담사·기관 Google 요청으로 계정 자동 생성·승격 금지

## 5. 완료 기준
- /login 3탭(회원/상담사/기관) + /admin 관리자 별도 진입
- 역할 불일치 시 토큰 발급 전 차단
- BE pytest 통과, FE build 0 error
