# [SDD-017] 상담사 초대 — 기관 담당자가 일괄 초대하는 방식으로 전환

## 1. 배경

현재 상담사는 `/auth/register/counselor`에서 기관 코드 + 이메일 검증 + 비밀번호 + 약관동의를 직접 입력해 가입한다.
이 복잡한 가입을 없애고, **기관 담당자(org_admin)가 상담사 정보를 일괄 입력해 초대 메일을 보내면,
상담사가 같은 방식(초대 토큰 + 비밀번호 설정 링크)으로 메일을 받아 로그인**하도록 전환한다.
SDD-016(기관 담당자 초대)에서 구축한 초대 토큰/이메일 인프라를 그대로 재사용한다.

## 2. 초대 절차

```
① org_admin(기관 대시보드)이 상담사 이름 + 이메일 입력 → 초대
② counselor 계정(status=pending) + CounselorProfile(상담사 코드 자동 발급) 생성 + org_id 연결
③ 초대 토큰(7일 만료, 일회용) + 비밀번호 설정 링크 이메일(HTML 버튼형) 발송
④ 상담사 링크 클릭 → 비밀번호 설정 → 계정 활성화
⑤ 이메일+비밀번호 로그인 → 상담사 대시보드(/dashboard)
   - 자격증명·경력 등 온보딩은 최초 로그인 후 본인이 원할 때 선택적으로 기입 (강제하지 않음)
```

## 3. 결정사항 (Brian 승인)

1. **온보딩 비강제화**: 비밀번호 설정 후 최초 로그인 시 자격증명·경력을 원할 때만 기입. 필수 단계 아님.
2. **기존 기관코드 가입 숨김**: `/auth/register/counselor`(기관코드 가입) 경로를 프론트에서 숨김(비활성화). 백엔드 엔드포인트는 유지(롤백 가능). 완전 삭제 아님.
3. **초대 최소 입력**: 이름 + 이메일만. 전화·전문분야는 이후 상담사 본인이 수정.

## 4. 데이터 모델

| 대상 | 변경 |
|------|------|
| 초대 토큰 | `org_invite_service` 재사용. 토큰 type 화이트리스트(`org_admin_invite`, `counselor_invite`). **`_invite_key(jti, token_type)`로 파라미터화해 발급·소비가 동일 key를 공유** |
| `User` | counselor 계정은 기존 role="counselor" + org_id + status="pending" 으로 표현. 초대 시각·만료 시각 노출을 위해 `invited_at`/`invite_expires_at` 필드 추가(선택: 별도 테이블 대신 User 컬럼) |
| `CounselorProfile` | counselor_code(6자리)는 **초대 시점에 `code_service.generate_unique_code`로 발급** (유니크 보장. 기존 온보딩 `random.choices` 경로와 통일) |

## 5. API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/v1/org/{org_id}/counselors/invite` | org_admin 전용. 이름+이메일 → counselor 계정(pending) + CounselorProfile + 초대 토큰 발급 + 이메일 발송. 이메일 중복 409. 초기 초대에도 레이트리밋 적용 |
| POST | `/api/v1/org/{org_id}/counselors/{user_id}/resend-invite` | org_admin 전용. **`status=="pending"`만 허용** (active 대상 재발송·비번 초기화 차단). 쿨다운 key 분리(`counselor_invite_resend:{org_id}`) |
| POST | `/api/v1/auth/set-password` | 확장: `counselor_invite` 토큰도 처리(화이트리스트). 비밀번호 설정 + 계정 활성화. role은 변경하지 않음 |
| (기존) | `GET /api/v1/org/{org_id}/counselors` | **org_admin 권한 검증 추가** + 응답에 `status`/`invited_at`/`invite_expires_at` 포함 |
| (기존) | `/api/v1/auth/register/counselor` | 백엔드 유지(하위 호환). 프론트에서만 숨김. `/register` 안내 문구를 "기관 담당자에게 초대 요청"으로 수정 |
| (기존) | `/api/v1/auth/login` | counselor 로그인 (변경 없음) |

## 6. 프론트

| 화면 | 변경 |
|------|------|
| 기관 대시보드(/dashboard/org) | "상담사 초대" 폼(이름+이메일) 추가 + "초대·가입 현황" 목록(pending/active/만료 뱃지 + 재발송 버튼) 신설. 기존 "회원가입 시 코드 입력" 카드는 초대 전환 모델에 맞게 문구 변경/축소 |
| 상담사 목록 구분 | pending 상담사는 "실적" 통계/테이블에서 제외하고 초대 관리 목록에서만 표시. 실적 집계는 active만 |
| 비밀번호 설정(/set-password) | 기존 화면 재사용. **성공 리다이렉트를 role 분기** (counselor→`/dashboard`, org_admin→`/dashboard/org`) + counselor 수신자용 카피 |
| 상담사 최초 로그인 | 온보딩 강제 진입 해제. `/dashboard`로 바로 진입 + dismissible 배너("프로필 완성하기") + 설정 메뉴에서 선택적 기입. 상담사 코드는 대시보드/설정에 상시 노출 |

## 7. 보안 (SDD-016 + 리뷰 반영)

- 초대 토큰: 일회용, 7일 만료, 원문 DB 저장 금지(Redis에 jti→user_id 매핑만)
- 이메일 디버그 로깅에서 토큰/비밀번호 마스킹 필수
- 이메일 중복 등록은 409 거부. **중복 검사 전 `.strip().lower()` 정규화** (대소문자 우회 차단)
- org_admin 권한 검증: 초대·목록·재발송 API는 반드시 본인 기관 org_admin만 호출 가능
- **resend는 `status=="pending"`만** (active 계정 비밀번호 초기화 벡터 차단)
- **초기 초대에도 기관당 레이트리밋** (이메일 폭탄 방지)
- counselor_code는 `code_service.generate_unique_code`로 유니크 보장

## 8. 검증 기준

1. org_admin이 상담사 초대 → counselor 계정(pending) + 상담사 코드 발급 + org_id 연결
2. 초대 링크로 비밀번호 설정 → 계정 활성화 → 상담사 대시보드(/dashboard) 진입 (role 분기 확인)
3. 초대 토큰 재사용/만료 시 거부
4. 이메일 중복 초대 시 409 (대소문자 변형 포함)
5. 레거시 `/auth/register/counselor` 백엔드 유지 + 프론트 숨김 확인
6. 상담사 목록에서 pending/active/만료 상태 구분 표시 + pending은 실적 제외
7. resend는 pending만 허용, active 대상은 4xx
8. 무인증 상담사 목록 조회 401/403
9. 백엔드 테스트 회귀 없음 (기존 164 passed 유지, 레거시 테스트는 갱신)
10. 프론트 `npm run build` 0 errors
