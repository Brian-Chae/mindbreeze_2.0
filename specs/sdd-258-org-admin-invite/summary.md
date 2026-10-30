# SDD-258 — 구현 요약

## 변경
- 초대 API `POST /org/{org_id}/counselors/invite` 에 `role`(counselor|org_admin, 기본 counselor) 추가 — 신규 엔드포인트·마이그레이션 없음.
  - 신규 이메일: org_admin pending 계정(CounselorProfile 없음) + 기존 `org_admin_invite` 비밀번호 설정 링크.
  - 기존 상담사/기관관리자 계정: org_admin 멤버십(invited) + 기존 `membership_invite` 수락 링크(메일 문구만 role 분기). 수락 시 주 소속 기관이면 User.role 미러 동기.
  - 개인 상담소에는 기관관리자 초대 불가(409).
- 재발송: org_admin 대상도 허용, 역할별 메일 선택.
- 정지/해제: 기관관리자 대상 허용. 자기 자신·주 담당자 403, 다른 활성 기관관리자가 없으면 정지 409(최소 1명 가드).
- 목록 응답 `role` 은 이 기관의 멤버십 역할 기준.
- 프론트: 구성원(상담사 관리) 화면에 '기관관리자 초대' 버튼·팝업, 비활성화 버튼을 기관관리자에게도 노출(서버 가드).

## 테스트
- backend/tests/test_sdd258_org_admin_invite.py 8건 통과, 관련 회귀(sdd016/017/076/079/082/209/230) 포함 125건 통과.
- frontend/tests/sdd258-org-admin-invite.test.tsx 2건. tsc·eslint(오류 0)·build 통과.
- 전체 vitest: develop 기준선과 동일한 8파일 13건 실패(신규 0).
- 메일은 목으로 가로챔, 실제 발송 없음.
