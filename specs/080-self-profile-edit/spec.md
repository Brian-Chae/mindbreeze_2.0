# SDD-080 — 역할별 자기 정보 수정 (설정 페이지)

> 기관 관리자·상담사·회원 모두 설정 페이지에서 자기 정보를 수정할 수 있게 한다. **claude(fable) 위주로 개발**.

## 1. 문제
- SettingsPage가 `isCounselor`(role === 'counselor')일 때만 프로필 수정 섹션(AccountSection/PersonalInfoSection/ProfileSection)을 렌더링
- org_admin(기관 관리자)·client(회원)는 설정에서 "계정 정보"만 표시되고 수정 불가

## 2. 현재 BE (이미 존재 — 재사용)
- 상담사/기관관리자: `GET/PATCH /auth/counselors/me/profile` (counselor_info_service가 counselor·org_admin 허용)
- 회원: `PATCH /auth/users/me` (name, phone, gender, birth_date) + `GET/PATCH /auth/clients/me/profile` (gender, birth_date, concerns, interests)

## 3. 구현 범위 (claude fable)

### T1. FE — org_admin 자기 정보 수정
- SettingsPage에서 `isCounselor` 조건을 `counselor || org_admin`으로 확장 (프로필 수정 섹션 렌더링)
- org_admin이 `/auth/counselors/me/profile`로 본인 상담사 프로필 조회/수정

### T2. FE — client 자기 정보 수정
- SettingsPage에 client용 "내 정보" 섹션 추가: 이름/전화/성별/생년월일 수정
- `PATCH /auth/users/me` 재사용 (name, phone, gender, birth_date)
- 선택 입력, null 보존

### T3. 역할별 섹션 분기
- counselor/org_admin: 기존 AccountSection + PersonalInfoSection + ProfileSection (상담사 프로필)
- client: ClientProfile 기반 "내 정보" (이름/전화/성별/생년월일) — 상담사 전용 필드(이력·전문분야)는 미노출

## 4. 주의
- 이메일 = 아이디(변경 불가) — 수정 입력 미노출
- org_admin은 counselor 프로필이 없는 경우가 있음 (순수 기관 관리자) → 프로필 없으면 기본 정보(이름/전화)만 수정
- 역할/상태/소속/인증등급은 수정 불가
- 감사 기록, 동시 수정 방지

## 5. 완료 기준
- 기관 관리자·상담사·회원 모두 설정에서 자기 정보 수정 가능
- 이메일 읽기 전용, 역할/상태 수정 불가
- BE pytest 통과, FE build 0 error
