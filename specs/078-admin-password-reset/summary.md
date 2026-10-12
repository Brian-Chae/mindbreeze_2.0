# SDD-078 — Summary (관리자 비밀번호 재설정)

> Stage ⑥ 구현 결과 정리. 작성일: 2026-09-17

## 구현 결과

Phase 1(MVP) 범위 전체 구현 완료.

| 범위 | 결과 |
|---|---|
| T1 토큰 | `admin_password_reset` type, TTL 24h, jti 일회용, 재발급 시 이전 jti 무효화(Redis active 키). `ALLOWED_INVITE_TYPES` 미등록 — 초대 수락 로직과 완전 격리 |
| T2 API | 플랫폼 2종(`/admin/orgs/{org_id}/primary-admin/password-reset`, `/admin/orgs/{org_id}/counselors/{user_id}/password-reset`) + 기관 관리자 1종(`/org/{org_id}/counselors/{user_id}/password-reset`). 소비는 기존 `/auth/set-password` 단일 경로에 type 분기 통합 |
| T3 권한 | 플랫폼=전체, 기관=소속 상담사(role==counselor)만, 자기 자신 403(본인은 forgot 안내), 대상 active만(pending→409 resend 안내, suspended→409), 비활성 기관 409, 대상자당 60초 쿨다운 429 |
| T4 감사 | `VerificationAudit`: `password_reset_issued`(reason·org_id·target_role·expires_at) + `password_reset_completed`(issued_by·jti) |
| T5 FE | 주 담당자 카드 버튼(active만) + 상담사 행 버튼(active만) + `PasswordResetConfirm`(대상 요약·사유 필수·효과 고지) + 결과 메시지. `SetPasswordPage` `type=reset` 문구 분기, 완료 시 /login 이동 |
| T6 메일 | 재설정 링크(관리자 이름 전체 + 역할 + 24시간 + "본인 요청 아님 시 문의") + 완료 알림(변경 + 전 기기 로그아웃) |

## 보안 검증 사항

- 비밀번호 원문 무전송 — 링크만. 토큰 원문은 이메일 본문에만 (응답은 `email_sent`/`expires_at`뿐)
- 소비 시 `revoke_all_user_tokens` 무조건 호출 — 테스트로 이전 refresh 토큰 회전 401 확인
- 사유 공백 422 (Pydantic `str_strip_whitespace` + `min_length=1`) — 프론트 버튼 비활성화 이중 방어
- 직전 3개 비밀번호 재사용 차단(`check_password_history`) 적용 — 본인용과 동일 정책
- 소비 시점 status 재검증 — 발급 후 정지된 계정은 409 (재설정으로 세션 부활 차단)
- 정책 위반(약한 비밀번호) 시 토큰 미소모 — 재시도 가능

## 디버깅 노트

1. `UserResponse`에 `status` 필드가 없어 테스트에서 로그인 응답으로 status 검증 불가 → DB 직접 조회로 대체.
2. 테스트에서 fakeredis 쿨다운 삭제를 `asyncio.get_event_loop()`로 시도 시 전체 스위트 실행에서 이벤트 루프 충돌 → `_cooldown_key` monkeypatch 우회 방식으로 변경.

## 테스트

- BE: `tests/test_sdd078_admin_password_reset.py` 15건 — 발급(주담당자·상담사·기관관리자), pending/suspended/사유/쿨다운/재발급 무효화, 소비(비밀번호 변경·세션 무효화·감사·일회용·정책 422), 권한(타기관·org_admin 대상·자기 자신·일반 상담사), 초대 소비 회귀
- 전체 스위트: **621 passed, 12 skipped** (`venv/bin/pytest`)
- FE: `npm run build` (tsc -b 포함) **0 error**

## 비고

- Stage ③ verify.md는 이 스펙에서 생략 — 구현 브리프(디스패치)가 QA 기준을 직접 정의했고, 사후 작성 금지 규칙에 따라 소급 작성하지 않음. 테스트 15건이 수락 기준을 대신 커버.
- Phase 2(인앱 알림 `notification_service`, 기관 관리자용 FE 화면 통합, 감사 로그 뷰 노출)는 범위 외.
