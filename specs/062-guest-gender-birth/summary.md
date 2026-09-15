# SDD-062 Summary — 게스트/회원 성별·생년월일 수집

## 구현 결과
- BE: SessionParticipant에 `gender`(String 20), `birth_date`(Date) 컬럼 + 마이그레이션 e036a0000006
- BE: join_session_by_code에 gender/birth_date 파라미터 + 게스트 생성 시 저장
- BE: JoinByCodeRequest에 gender/birth_date + 참가자 직렬화 포함
- FE: class-join-page 게스트 폼에 성별(male/female/other) + 생년월일(연/월/일) 입력 (선택 필드, 반응형)

## 핵심
- 회원: 기존 온보딩에서 이미 성별/생년월일 수집 (변경 없음)
- 게스트: 이제 이름+성별+생년월일 수집 → EEG 나이·성별 분포 분석 기반 마련
- 값 규약: gender 'male'/'female'/'other', birth_date 'YYYY-MM-DD' (온보딩 통일)

## 검증·배포
- BE pytest 453 passed, FE build 0 error
- 커밋 `4081550` → Deploy Dev `35037890232` 성공
