# SDD-074 구현 결과

## 구현
- 플랫폼 관리자 전용 `GET /admin/orgs/{org_id}` 및 `/counselors` 조회 API 추가.
- 기관 상세: 주소, 인증시각, 유형 및 허용된 6개 필드의 담당자/소유자 요약. 참조 부재는 null.
- 상담사: 해당 기관 counselor/org_admin만, 프로필 원본 코드 및 주 담당자/소유자 플래그, created_at ASC/id ASC 정렬.
- 기존 목록 배열 응답을 유지하고 kind/has_primary_admin 추가. 기존 `/org/{org_id}/counselors` 및 권한 로직은 변경하지 않음.
- 기관 정보/상담사 두 탭 모달, 고정 헤더와 스크롤 본문, KST 날짜, 개인 소유자 및 원본 상담사 코드.
- 목록 검색/인증·유형 필터/유형 그룹핑, 상담사 이름·이메일·코드 검색/역할·상태 필터.
- 독립 요청 로딩/실패/재시도, 실패와 0명 구분, 누락 미등록 및 미확인 상태 표시.
- 기관명 버튼과 행 클릭, 복사/재초대 전파 차단, Enter/Space/Escape, Tab/Shift+Tab 순환 및 원래 버튼 포커스 복귀.

## 계약 결정
- 모델에 수정 버전 필드가 없으므로 상세 `version: null`. 조회 MVP에 임의 버전이나 DB 마이그레이션을 추가하지 않았다.
- 상담사 응답은 이번 브리프의 클라이언트 필터 범위에 맞춘 전체 배열. 기획의 후속 서버 페이지네이션은 포함하지 않았다.
- 기존 기관 등록/초대 재발송을 유지. 개인 기관 및 담당자 없는 기관의 재초대는 비활성화하고 이유 표시.
- 수정/비활성화/상담사 관리, 상담·리포트·채팅 본문 접근은 추가하지 않았다.

## 검증 결과
- 신규 API 계약 테스트 RED: 구현 전 13개 실패 확인.
- 대상 테스트 GREEN: 신규 13개 + 기존 SDD-016 온보딩 21개 = **34 passed**.
- 전체 백엔드: `cd backend && TMPDIR='/Volumes/Looxid SSD/tmp-sdd074' venv/bin/pytest` → **529 passed, 12 skipped, 16 warnings**, 34.93초.
- 프런트엔드: `cd frontend && npm run build` → **exit 0**, TypeScript 오류 없음. 기존 chunk 크기 경고 있음.
- Chrome/Playwright: `browser-check.mjs` 통과. 목록 검색·필터·그룹, 클릭 전파, API 양방향 독립 재시도, 상담사 검색·필터, 미확인 상태, 0명, Enter/Space/Escape/포커스 격리·복귀, 개인 소유자, 모바일, 목록 실패 재시도 검증.
- `git diff --check` 통과.
- 데스크톱 상담사 표와 모바일 기관 상세 스크린샷을 직접 검토함. 증거: `evidence/counselors-desktop.png`, `evidence/owner-desktop.png`, `evidence/owner-mobile.png`.

## 디버깅
- 첫 전체 테스트는 시스템 디스크 용량 부족(OSError 28)으로 중단. 코디네이터 공간 확보 후 임시 경로를 외장 디스크로 지정하고 전체 재실행 성공.
- 브라우저 테스트의 공통 채팅 모의 응답을 실제 rooms 배열 계약에 맞춤.
- native dialog의 마지막 Tab 이동이 브라우저 UI로 나가는 것을 재현하고 명시적 순환 처리로 수정, 브라우저 재검증 통과.

## 경계 및 인계
- 브라우저 테스트는 API 모의 응답 기반이며 실제 운영 DB/메일 전달 검증은 아님. 백엔드 테스트는 프로젝트의 인메모리 SQLite fixture 사용.
- 기존 전체 테스트의 12개 skip 및 경고는 결과 그대로 기록했으며 통과로 간주하지 않았다.
- spec.md와 specs/.sdd-counter는 작업 시작 전에 존재하던 변경으로 보존. plan/verify는 구현 전에 작성했고 결과는 본 summary에 기록.
- 커밋/배포/운영 DB 변경 없음. 최종 리뷰가 남아 있다.

## 브라우저 재현
- Vite 개발 서버: `cd frontend && npm run dev -- --host 127.0.0.1 --port 5187`
- 별도 설치된 Playwright 경로 지정: `PLAYWRIGHT_PACKAGE=/절대경로/playwright node specs/074-org-management-crud-mvp/browser-check.mjs`
- 이 실행에서는 `/Volumes/Looxid SSD/tmp-sdd074/browser/node_modules/playwright`를 사용했으며 프로젝트 의존성은 변경하지 않았다.
