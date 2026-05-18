# Plan: F3 상담사 자격 증명 구현 계획

- **Sprint**: 003-counselor-credential
- **Spec**: `specs/003-counselor-credential/spec.md`
- **범위**: F3.1 ~ F3.3, F3.6

## Phase A — BE 전체
- credential_service: 업로드·목록·삭제·verified_tier 갱신
- credential 라우터: POST upload / GET list / DELETE
- admin 라우터: PUT approve/reject
- pytest

## 변경 예상
- BE ~500줄, 테스트 ~150줄
