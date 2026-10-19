# SDD-218 착수 보고서

2026-10-20. 요청 범위는 새 워크스페이스 구성 및 다음 SDD 정리다. 제품 구현·217 통합·커밋·작업 브랜치 push·PR·배포는 수행하지 않았다.

## 워크스페이스
- 제목: SDD-218 클래스 리포트 관리와 회원 변화 추이
- Paseo ID: `wks_0c6f56c31a55f90e`
- 브랜치: `sdd/218-class-structure-phase5`
- 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd218`
- 기준: `origin/develop` `a4acf6ba0c434fd40f7eb70ce573e7ad1a7699b4`
- 공식 스크립트로 번호 선점 후 생성된 Git worktree를 Paseo의 기존 경로 등록으로 연결했다. 별도의 중복 worktree는 만들지 않았다.
- 원격 변경은 `refs/sdd-claims/218` 번호 예약뿐이다.

## 왜 다음이 Phase 5인가
사용자가 정한 클래스 우선 출시 순서는 Phase 0~5 → 8-A → 클래스 출시다. 상담 Phase 6·7과 8-B는 후속 업데이트다. 217은 Phase 4 멤버십·출석·보강을 구현했으므로 다음 기능 단위는 리포트 관리·회원 추이다.

## 선행 SDD-217 상태와 인계
217 전용 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`.
217은 구현·독립 재리뷰 통과, 사용자 최종 승인 전이며 미커밋 상태다. 현재218 기준HEAD에는 217 모델/API/마이그레이션057이 없다. 217 구현을 수동 복사하거나 218의 변경으로 기록하면 안 된다.

217에서 재사용할 것:
- membership/canonical guest, 실제 출석·보강 연결, 본인 과거 승인 리포트 권한.
- O3 클래스 가입1회 선택→회차 복사, 명시 override·철회, legacy 동의 보수 보존.
- 정상 수료 후 본인 entry-state/after 체크인, 원결석/보강 충돌·탈퇴 예외.
- 기존 API operation key·요청 세대·계정전환·접속 버전 보호.

217 저장 검증: 55ID 중51통과/2부분/2미측정, 최종 관련 PG172/SQLite26/FE67/build 및 후속 PG41(중복).
이 값은 218 테스트 결과가 아니다. 217의 실카메라·외부LiveKit/다중워커·벽시계TTL·외부전달·운영배포 미검증과 기존wizard3기준선/N+1은 8-A 인계 항목으로 유지하며 218의 검증을 대체하지 않는다.

**실행 순서:** 217 최종 승인·통합 → 최신 develop 반영 → 057 및 공통계약 존재 확인 → 218 Spec/디자인/Plan/구현 전 Verify 승인 → 218 구현.
문서 검토는 217 통합 전에도 진행할 수 있다.

## 실제 코드와 기획의 차이
생성 기준 코드에서 직접 확인:
- `backend/app/models/record.py` Report에 승인자/시각 존재.
- `backend/alembic/versions/e036a0000055_sdd_214_session_parent_columns_constraints.py`에 승인 컬럼/FK 생성.
- `backend/app/services/report_service.py` approve_report가 승인자/시각을 기록하고 기존 단건 승인·전체 approve-all을 제공.
- `backend/app/api/v1/classes.py`에 회차 리포트 조회 경로 존재.
- `frontend/src/components/class/structure/class-team-reports.tsx`와 `class-session-detail.tsx`에 기존 회차 열람 UI 존재.
- 강사 개인 `auto_approve_report` 설정은 현 코드에 존재. Phase 5의 영역 분리는 아직 승인된 확정사항이 아니다.

따라서 “승인 컬럼 신설/모든 회차 리포트 조회를 신규 구현”이라는 오래된 기획 설명을 그대로 구현하지 않는다. 기존 단건 편집권 판정과 신규 클래스 대행 승인권은 실제 함수를 대조한 후 설계한다.

## 계획을 세울 작업 묶음
아래는 순서 제안이며 승인된 구현 plan.md가 아니다.

| 순서 | 작업 묶음 | 검증 초점 |
|---|---|---|
| 1 | 217 통합·정책/디자인·API 계약 확인 | 057 단일 head, D-36/37/43, 구 API 의미 |
| 2 | 클래스 리포트 조회·작업 상태 계약 | 권한·페이지네이션·N+1·미생성/부분 실패 |
| 3 | 일괄 승인/재생성/재발송 | 건별 멱등·큐·결과조회·중복효과·실행 시 권한 |
| 4 | 회차 변화 자료·제한적 백필 설계 | 제외·철회·유실·재시도·기존 승인자 보존 |
| 5 | 회원 추이·지도사용 요약 | 본인만·3명 미만 숨김·보강·점수금지 |
| 6 | 운영/회원 UI·통합 검증 | 실패/재시도·계정전환·4뷰포트·실제 서버 |

## 남은 결정과 다음 대화
우선 D-36 “진행 강사 + 주강사 대행 승인”을 확정하고, D-37 범위를 정한다. D-43은 217 비회원 읽기 자격과 충돌 없이 범위를 정한다. 자세한 선택 사항은 [spec](spec.md)을 따른다.
기존 디자인 파일 `designs/class-structure-redesign/`를 참고하되 Phase5 전용 리포트 탭·추이 화면의 승인이 끝났다고 간주하지 않는다.

## 셋업 검증과 제한
공식 번호/브랜치/기준SHA/Paseo 등록/문서 링크/제품파일 무변경을 확인한다. 설치·빌드·제품 테스트·실DB 변경은 이번 문서 준비 범위에서 미실행이다. 따라서 “구현 환경 기준선 통과”라고 표현하지 않는다. 구현 착수 시 당시 package lock·테스트 실행 정책을 확인한다. 전체 BE 반복 대신 관련 테스트를 개발 중 사용하고 PR 전체CI를 통합 게이트로 삼는다.

## 참고자료
- [클래스 우선 출시 기획 스냅샷](reference/class-first-roadmap.md)
- [결정 목록 스냅샷](reference/decisions.md)
- [기존 리포트 상세 기획](../../docs/class-session-restructure/기획-상세-리포트.md)
- [Spec 초안](spec.md)
- 루트 [START-HERE](../../START-HERE.md)

reference 두 문서는 원본 워크트리의 미커밋 출시 순서 결정을 2026-10-20 시점에 복사한 읽기용 스냅샷이다. 원본 수정이나 제품 변경을 승계한 것이 아니다. 스냅샷 안 상대링크는 원래 docs/class-session-restructure 문맥이므로 관련 원문 문서를 함께 참조한다.
