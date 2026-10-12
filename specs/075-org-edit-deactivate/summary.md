# SDD-075 구현 결과

## 결과

기관 정보 수정, 비활성화/재활성화 API와 상세 모달, 목록 운영 상태 필터를 구현했다. 데이터·계정·기록 삭제 없이 기관 상태만 변경하며 상담사 역할 변경/소속 해제 UI는 추가하지 않았다.

## 구현

- Organization에 `deactivated_at`, `deactivated_by`, `deactivation_reason`, `version` 추가. Alembic `e036a0000009`는 기존 기관 version=1을 보장한다.
- PATCH는 누락 유지, phone/address null 삭제, 기관명 공백/빈/null·길이·미허용 필드 검증, 인증 변경 사유 필수, 인증 전환 시각 관리와 동일 값 시각 보존을 제공한다.
- PATCH/비활성화는 If-Match 필수(누락 428, 형식 오류 422, 불일치 412). 재활성화는 사유 필수이고, 전달된 If-Match도 검증한다.
- 기관 행 `SELECT FOR UPDATE` 아래 영향 재검사 및 상태/버전/VerificationAudit 전후 값·행위자·사유를 함께 커밋한다. 같은 운영 상태 요청은 중복 감사 없이 반환한다(전달한 버전 검사는 유지).
- 진행/paused/예정/ready 세션, 활성 연결, 개인/알 수 없는 유형, 귀속 미확정 데이터가 비활성화를 차단한다.
- 기관 검색·코드 조회·공개 기관 페이지에서 비활성화 제외. 가입 신청/처리·초대/재초대·기관 초대 수락·기관 대시보드·기관 운영 경로·신규 연결·신규 세션과 기존 세션의 호스트 업무에서 공통 상태 가드를 적용했다. 계정의 전역 상태·역할은 바꾸지 않는다.
- FE: 수정 폼, 인증 변경 사유, 저장 실패 입력 유지, 412 안내/재조회, 미저장 닫기 보호, 영향 집계·확인값·보존 동의·사유, 취소 기본 포커스, 실행 중 중복 방지, 재활성화, 목록/상세/상담사 갱신, 상태 필터와 포커스 복귀.

## 기관 귀속 정책 — 운영상 중요한 제약

기존 Session에는 생성 당시 기관 귀속과 소속 이동 이력이 없었다. 코디네이터가 구현 전 신규 세션 기관 스냅샷 및 기존 귀속 불명 데이터의 보수적 차단을 승인했다.

- 새 세션은 `organization_id`와 `organization_attribution_known=True`를 기록한다. 기관 없는 신규 개인 세션도 명시적으로 귀속 확인 상태를 기록한다.
- 기존 데이터는 기관을 추정해 채우지 않는다. 마이그레이션은 `organization_attribution_known=False`로 둔다.
- **전체 시스템에 귀속 미확정 기존 세션이 하나라도 남아 있으면 모든 기관의 비활성화가 차단된다.** 현재 다른 기관 소속이거나 소속이 없는 상담사의 과거 세션도 특정 기관과 무관하다고 증명할 수 없기 때문이다.
- 영향 응답/화면은 기관 스냅샷 및 현 소속 기준 세션 후보 건수와 전체 귀속 확인 필요 건수를 구분한다. 후자를 해당 기관의 확정 소유 건수로 표현하지 않는다.
- 기존 귀속 확정/이관용 관리 화면이나 자동 보완은 범위 밖이다. 운영에서 기존 세션의 귀속을 증거 기반으로 확인하기 전에는 비활성화를 실행할 수 없다. 계정·기록·파일은 그대로 보존한다.

## 검증

- RED: 신규 백엔드 계약 테스트 최초 19개 실패(API/필드 미구현), FE API 계약 테스트 미구현 함수 실패 확인 후 구현했다. 기관 운영 조회 차단 및 타 기관으로 이동한 과거 세션의 귀속 보호도 실패 재현 후 보완했다.
- 최종 `cd backend && venv/bin/pytest`: **556 passed, 12 skipped, 16 warnings** (35.04초).
- FE API + Chrome Playwright 테스트: **3 passed**. 모바일 모달 미저장 보호·저장 실패 유지·412 재조회·저장·비활성화·재활성화, 목록 운영/비활성화 필터, 저장 후 포커스 복귀 확인. API 응답은 테스트 fixture로 대체했으며 실 서버 브라우저 E2E는 아니다.
- 최종 `cd frontend && npm run build`: **exit 0**, TypeScript 오류 없음. 기존 대형 청크 경고가 남는다.
- Alembic `upgrade e036a0000008:e036a0000009 --sql`: PostgreSQL용 DDL 생성 성공. 실제 운영 DB에는 적용하지 않았다.
- `git diff --check`: 통과.

실행 예:

```sh
cd frontend
NODE_PATH=/tmp/f22-browser/node_modules node --test tests/org-management-api.test.cjs tests/org-management-browser.test.cjs
```

브라우저 테스트는 Vite 127.0.0.1:5175, 설치된 Chrome, 외부 Playwright 모듈이 필요하다. NODE_PATH는 해당 환경의 설치 경로로 지정한다.

## 남은 확인

- 실제 PostgreSQL 다중 연결 동시 요청/잠금 경합은 미실행(SQLite pytest로 계약 검증). 운영 DB 마이그레이션·실메일·배포는 미실행.
- pytest의 기존 deprecated API/crypt 및 일부 미대기 coroutine 경고와 12개 skip은 이번 범위에서 변경하지 않았다.
- 코디네이터/Brian 최종 Review가 남는다. 커밋·푸시·Linear 게시·배포는 하지 않았다.
- 선행 사용자 변경인 `specs/.sdd-counter`, 기존 `spec.md`를 보존했다.

## 승인 기록

애플리케이션 코드 수정 전 plan.md와 verify.md를 작성하고 Orca ask로 승인 요청했다. 코디네이터 답변: “승인합니다. 신규 세션 기관 스냅샷 추가, 기존 귀속 불명 세션/활성 연결은 보수적으로 비활성화 차단 모두 OK. 진행하세요.”
