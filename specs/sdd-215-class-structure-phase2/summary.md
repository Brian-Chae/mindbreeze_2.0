# SDD-215 summary — 클래스·세션 재설계 2단계 (클래스 읽기·화면 구조 전환)

> 2026-10-19 구현·develop 반영(PR #16, 머지 `9cb1b07f`). DB·백엔드 변경 없음. 최종 리뷰(Stage ⑦) 대기.

## 구현
- **데이터 계층(D)**: 읽기 API 5종 래퍼, 식별자 타입 구분, 표시 어댑터(누락=데이터 없음, 0·false 보존), 역할별 링크 함수, 요청 취소·계정 전환 보호 훅. 계약 정본 `api-contract.md`(코드 기준).
- **셸·내비(F)**: 사이드바 3종·모바일 탭 개편(명상 클래스·상담, 기관 관리자 `구성원`, 회원 내 클래스·내 상담), 용어 키 가산, 탭 키 기준 배지, 공통 셸·읽기 상태 컴포넌트, 알림 `class`/`counseling` 대상 해석.
- **호스트(H)**: `/classes` 목록(현재 목록 검색·상태 필터), `/classes/:id` 개요·회차(원본 seq 유지).
- **회원(M)**: `/app` 홈(다음 일정), `/app/classes`·상세(`?sessionId=` 회차 선택).
- **상담(C)**: `/counseling*`, `/app/counseling*` 일정 중심 임시 입구(역할 props).
- **라우트(T13)**: 새 경로 연결, 레거시 `/sessions`·`/sessions/new`·`/app/sessions` 이동, `/sessions/:id`는 class_id/area로 부모 해석(실패 시 `/classes`). `/sessions/:id/{live,player,record}`·`/join`·`/class/:id/enter`·`/clients*` 유지.
- **검증 하네스(Q)**: Playwright 288건(read 16 + visual 276), 합성 응답·4뷰포트.

## 결정·변경
- 2026-10-19 Brian: 기존 세션은 테스트 데이터 → 기존 URL·화면 보존 제약 폐기, 새 경로로 일괄 전환(spec §5, plan T13).
- F의 `/clients` 목록→`/counseling` 리다이렉트가 상담 화면의 `내담자` 링크와 순환 → 목록은 기존 `ClientListPage` 유지(`ffd1e49c`).

## 검증 결과
- tsc 통과, `npm run build` 성공(산출 CSS에 `cs-structure` 생성 확인).
- vitest 1,874 통과 / 11 실패. 11건은 기존 실패(agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf)이며 새 실패 0.
- Playwright(합성 응답): read 16/16, visual 276/276. 4뷰포트에서 넘침·잘림·터치 44px 미만·12px 미만 텍스트 0.
- PR CI: backend·backend-pg-smoke·frontend 전부 pass(frontend 테스트 단계는 비차단이라 로컬 vitest가 근거).
- **미검증**: 실제 백엔드 연동·실기기·dev 서브도메인 화면(머지 후 Deploy Dev 결과 확인 필요).

## 남은 항목
- **시안 대비 시각 차이**: 픽셀 변경 중앙값 약 59%(14~86%). 히어로 "열린 세션" 카드, 건수 탭, 사이드바 스타일, 목록 행 레이아웃은 미반영 → 디자인 마감 패스 필요 여부 Brian 결정.
- 스코프 이월: 홈 `오늘 일정` 영역 칩·영역별 집계, 회차 상세 축소(CH30), 클래스 상세 멤버·리포트·설정 탭, 알림 발행 계약 변경.
- `/counseling/new`는 유형 고정 없는 기존 위저드, 상담 목록 탭·검색 없음. 상담 목록→`내담자`는 기존 `/clients`.
- 기존 11건 vitest 실패 정리, 공통 `apiClient` AbortSignal 지원(실제 전송 중단), 회원 부모 URL `?sessionId=` 소비 확인.
- 워크트리 `mindbreeze_2.0-sdd215{,-int,-d,-f,-h,-m,-c,-q}`와 브랜치 `sdd/215-*` 정리는 최종 리뷰 승인 후.
- 메인 `node_modules/.vite` 캐시가 M 워커 첫 실행으로 갱신됨(소스 영향 없음).


## 214~216 통합 상태 확인 (2026-10-19)

- 이 단계의 병합 커밋은 dev 제품 커밋 `7e34c056`에 포함됨을 확인했다. 216은 기능 브랜치에서 dev에 배포됐으며 PR #18의 develop 병합은 아직 남아 있다.
- [통합 변경·배포·검증·이월 정리](../sdd-216-class-structure-phase3/integration-closeout.md). 당시 테스트 결과와 현재 제품 HEAD의 검증 결과를 구분한다.

- 통합 마무리 추가 확인: 사용자 승인으로 216과 함께 통합 출시를 진행한다. 216의 후속 dev E2E 실행 39218057339는 네 단계 모두 성공했으며, 기존 전체 시각·실기기 미확인과 이후 Phase 이월은 유지한다.
