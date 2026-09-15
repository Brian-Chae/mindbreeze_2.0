# SDD-062 — 게스트/회원 성별·생년월일 수집 (EEG 나이·성별 분포 대응)

> EEG 지표가 나이·성별에 따라 분포가 달라지므로, 게스트 참여 시에도 이름·성별·생년월일을 수집해
> 표준 모델 정규화의 코호트 구분 기반을 마련한다. 회원은 온보딩에서 이미 수집 중이므로 게스트를 보완한다.

## 1. 현황
- 회원: ClientOnboardingPage/CounselorOnboardingPage에서 성별·생년월일 수집 → ClientProfile/CounselorProfile 저장 (이미 존재)
- 게스트: class-join-page에서 이름(guest_name)만 수집 → SessionParticipant에 성별·생년월일 컬럼 없음

## 2. 구현 범위
### BE (codex)
- `SessionParticipant`에 `gender`(String 20), `birth_date`(Date) 컬럼 추가 + Alembic 마이그레이션
- `JoinByCodeRequest`에 gender/birth_date 필드 추가
- `join_session_by_code`에 gender/birth_date 파라미터 + 게스트 생성 시 저장
- 직렬화(participant 응답)에 gender/birth_date 포함

### FE (cursor)
- `class-join-page.tsx` 게스트 폼에 성별(남성/여성 선택) + 생년월일(연/월/일) 입력 추가
- 기존 ClientOnboardingPage의 성별·생년월일 입력 형식·값 규약을 그대로 사용
- 모바일/태블릿/웹 반응형 (Tailwind)

## 3. 주의
- gender 값 규약은 기존 온보딩과 동일하게 (MALE/FEMALE 등 — 확인 후 일치)
- birth_date는 'YYYY-MM-DD' 형식
- 게스트의 성별/생년월일은 선택 필드(미입력 허용) 또는 필수 — 기존 회원 온보딩 규약에 맞춤
- 표준 모델 정규화(normalization_baseline의 gender/birth_date)와 연결 가능하도록 문자열/Date 통일

## 4. 완료 기준
- 게스트 참여 시 성별/생년월일이 DB에 저장
- 반응형 UI 동작
- BE pytest, FE build 0 error
