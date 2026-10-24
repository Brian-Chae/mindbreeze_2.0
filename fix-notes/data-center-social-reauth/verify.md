# 구현 전 검증 체크리스트 — 데이터 센터 소셜 계정 재인증

원인: `export_reauth.issue_export_proof`가 `auth_provider != 'email'`이면 403 `reauth_method_unsupported`. 구글·애플 가입 계정은 다운로드 불가. 화면의 "SSO" 문구도 실제 미지원.
방침: SDD-220 탈퇴 재인증(`/users/me/reauth` → Redis 1회용 proof)을 재사용해 purpose=`data_export` proof를 발급하고, `export-reauth`가 그 proof를 소비해 기존과 같은 5분 ExportProof를 발급한다. 서버는 소셜 토큰을 직접 믿지 않고, 제공자 재로그인 검증을 거친 proof만 인정한다.

## 백엔드
- [ ] 이메일 계정: 비밀번호 경로 그대로(회귀), 성공 시 ExportProof
- [ ] 구글 계정: `/users/me/reauth {purpose:data_export, provider:google}` → proof → `export-reauth {social_proof}` → ExportProof(request_hash/job_id 바인딩, auth_epoch, TTL 그대로)
- [ ] 애플 계정: 위와 동일(nonce 챌린지·sub 연결 검증)
- [ ] 다른 purpose(account_deletion) proof는 거절 (그리고 거절 시 소비되지 않음)
- [ ] 타인 proof 거절
- [ ] 재사용(2회째) 거절, 만료(Redis 키 소멸) 거절
- [ ] 소셜 계정이 비밀번호(credential)로 시도하면 거절, 이메일 계정이 social_proof로 시도하면 거절
- [ ] credential·social_proof 둘 다/둘 다 없음 → 422
- [ ] 발급된 ExportProof의 binding 바꿔치기·auth_epoch 변경 시 기존대로 reauth_invalid (SDD-243 회귀)
- [ ] 실패 시 계정 단위 잠금 규칙 유지(비밀번호 실패), proof·비밀번호가 로그/감사에 남지 않음
- [ ] `/users/me/reauth` 기존 탈퇴 흐름 회귀(purpose 기본값=account_deletion)
- [ ] 백엔드 전체 pytest

## 프론트
- [ ] export-dialog/export-jobs: 이메일은 "로그인 비밀번호" 입력, 구글/애플은 "Google로 본인 확인"/"Apple로 본인 확인" 버튼, "SSO" 문구 제거
- [ ] 웹 구글(useGoogleLogin access_token), 네이티브 구글(id_token), 네이티브 애플(챌린지 nonce + id_token) 경로를 탈퇴 화면과 동일하게 사용
- [ ] Apple 미지원 기기 안내
- [ ] vitest 관련+전체(기존 실패 8파일·17건과 대조), tsc, build
