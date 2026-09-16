# SDD-073 — 회원가입 역할별 분리 (회원/상담사/기관) + 개인 상담사 신청 + 우회 정리

> 기획안 `docs/signup-role-기획.md`의 구현. claude fable 5.1로 개발.
> 회원가입을 역할별(회원/상담사/기관)로 분리하고, 개인 상담사 신청·기관 상담 접수를 구현한다.

## 1. 정책 확정 (Brian)
- **개인 상담사**: 제출 시 즉시 개인 기관 + 상담사 계정 + 프로필을 생성. 플랫폼 관리자 페이지에서 승인하면 **바로 적용**(active)된다.
- **전화번호**: 선택 필드 (문자 인증 없음, 입력 안 해도 됨)
- **우회 경로 정리**: 기존 `/org/register`(OrgRegisterPage)와 `/auth/register/counselor`(org_code 직접 가입)을 정리해 플랫폼 관리자 등록 정책을 우회하지 않도록 한다.

## 2. 구현 범위 (claude fable 5.1)

### T1. 역할별 가입 페이지 분리 (FE)
- `/register` 역할 선택 화면 → 회원/상담사/기관 3개 진입
- `/register/client` 회원 가입: 이름·성별(male/female/other)·생년월일(YYYY-MM-DD)·전화번호(선택)·이메일(OTP) + 초대 상담사 코드(6자리 counselor_code) → 가입
- `/register/counselor` 상담사 가입: 기관 초대 안내 + 개인 상담사 신청 폼
- `/register/organization` 기관 가입 상담 신청 폼
- 기존 `?role=client|counselor` 주소 호환 + invite_token 보존

### T2. 기관 가입 상담 신청
- 기업/기관명, 담당자 이름, 연락처(전화), 업무 이메일, 동의 → 제출
- `SignupApplication` 저장 + `brian.chae@looxidlabs.com` 알림 (email_app/Celery, 수신자 서버 고정)
- 접수만으로 계정·기관 생성 안 함 (영업 상담 후 플랫폼 관리자가 등록)

### T3. 개인 상담사 신청
- 이름, 이메일(OTP), 전화번호(선택), 활동명/전문분야(선택) → 제출
- **즉시** 개인 Organization(kind=individual) + User(role=counselor, status=pending) + CounselorProfile(counselor_code) 생성 (트랜잭션)
- brian.chae 알림 → 플랫폼 관리자 승인 페이지에서 승인 → **바로 active** 적용
- 승인 전 로그인 불가(pending), 승인 시 초대 수락(비밀번호 설정) 메일 발송

### T4. 플랫폼 관리자 신청 관리 페이지
- 신청 목록/상세/승인/반려 + 발송 상태·재발송
- 승인 시 개인 상담사 계정 active 전환 + 활성화 메일

### T5. 회원 상담사 코드 검증·연결
- counselor_code 검증(형식·활성 상담사·승인 상태) → 상담사 표시명·기관명 표시 → 연결
- invite_token 있으면 코드 대신 초대 상담사 확정

### T6. 우회 경로 정리
- `/org/register`(OrgRegisterPage) 제거 또는 정책 정리
- `/auth/register/counselor`(org_code 직접 가입) 차단/정리

## 3. 주의
- 이메일 발송은 Celery email_app worker(systemd mindbreeze-email-worker) 필수
- 전화번호는 선택, 마스킹, 로그·메일 제목에 미노출
- 뇌파·개인정보: 동의·감사·보관(신청 90일) 정책
- 서버 권한 검사 1차 방어 (우회 금지)

## 4. 완료 기준
- 역할별 가입 3페이지 + 기관/개인 상담사 신청 + 회원 코드 가입
- 개인 상담사 승인 시 바로 적용, 우회 경로 정리
- BE pytest 통과, FE build 0 error
