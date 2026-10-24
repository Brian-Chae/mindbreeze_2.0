# 요약 — 데이터 센터 소셜 계정 재인증

## 원인
`export_reauth.issue_export_proof`가 `auth_provider != 'email'`이면 403 `reauth_method_unsupported`를 반환 → 구글·애플 가입 계정(기관관리자 포함)은 다운로드 불가. 화면의 "SSO 확인 값" 문구도 실제로는 미지원.

## 변경
- 재사용: SDD-220 `social_reauth_service`(Redis 1회용 proof, 5분) + `POST /users/me/reauth`.
  - `/users/me/reauth`에 `purpose`(`account_deletion` 기본 | `data_export`) 추가. data_export proof에는 구글 revoke용 토큰을 보관하지 않는다.
  - `POST /data-center/export-reauth`: `credential`(이메일) 또는 `social_proof`(구글·애플) 중 정확히 하나(둘 다/없음 422).
    소셜 proof는 `consume_proof(purpose=data_export)`로 원자 소비 → 기존과 같은 5분 ExportProof(바인딩 request_hash/job_id, auth_epoch, TTL) 발급.
  - 계정 유형↔방식 불일치(소셜 계정의 비밀번호, 이메일 계정의 social_proof)는 403 `reauth_method_unsupported`(proof 소비 전에 거절).
  - 소셜 proof 실패(타인·만료·재사용·다른 purpose)는 403 `reauth_invalid`로 통일하고 계정 단위 실패 잠금에 포함.
  - 서버는 소셜 토큰을 직접 믿지 않는다. 제공자 재로그인 검증(`/users/me/reauth`)을 거친 proof만 인정.
- 프론트: `social-reauth-button.tsx` 신설(`ReauthMethod`). 이메일=로그인 비밀번호 입력 + 기존 버튼, 구글=Google로 본인 확인(웹 팝업 access_token / 네이티브 id_token), 애플=Apple로 본인 확인(iOS 앱, 챌린지 nonce). 웹 Apple은 안내 문구. `export-dialog.tsx`·`export-jobs.tsx`는 재인증 영역만 수정, "SSO" 문구 제거.

## 테스트
- 신규 pytest `tests/test_fix_dc_social_reauth.py` 12건(이메일 유지, 구글·애플 성공+생성, 바인딩, 탈퇴 purpose·타인·재사용·만료·위조 거절, 방식 불일치, 422, purpose 검증).
- 신규 vitest `tests/dc-social-reauth.test.tsx` 5건. 기존 `sdd243-export`·`sdd243-navigation` 테스트는 authStore import 때문에 client mock을 `importOriginal` 방식으로 보정.
- 전체 결과는 PR 설명 참조.

## 남은 위험
- 실제 구글/애플 제공자 호출은 mock 검증. dev 실기기(웹 구글, iOS 앱 구글·애플) 확인 필요.
- 소셜 로그인 계정에도 비밀번호 해시가 있는 경우는 지원하지 않는다(비밀번호 경로는 `auth_provider=email`만).
