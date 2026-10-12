# SDD-074 구현 계획

- 범위: 전달된 구현 브리프의 조회 MVP. 기존 등록/초대 및 기관 관리자 API 보존.
- 관리자 응답 스키마를 명시하여 개인정보 노출을 허용된 요약 필드로 제한한다.
- 목록 배열에 kind/has_primary_admin을 추가하고 상세 및 상담사 배열 API를 분리한다.
- 실제 모델에 version이 없으므로 상세 version은 null로 제공한다. 임의 버전 및 DB 변경은 도입하지 않는다.
- 상담사 API는 counselor/org_admin만 포함하고 프로필 코드 원본을 outer join으로 읽는다. created_at/id 오름차순.
- 모달은 native dialog로 포커스 격리/Escape를 제공하고 닫힌 후 기관명 버튼으로 복귀한다.
- 두 요청은 각각 로딩/오류/재시도를 가지며 검색/필터는 클라이언트에서 처리한다.
- 목록은 검색/인증/유형 필터와 선택형 유형 그룹핑을 제공한다.
- 개인 소유자의 코드는 상담사 API 결과에서 찾되 실패와 미등록을 구분한다.

## 작업 순서
1. 구현 전 Verify 작성 및 API 계약 테스트 RED 확인.
2. 관리자 상세/상담사 API 및 목록 확장 구현, 대상 테스트 GREEN.
3. API 타입/모달/목록 UI 구현.
4. 브라우저 동작 검증 및 backend 전체 pytest/frontend build.
5. summary에 결과와 미검증 경계를 기록한다.
