# Claude 백엔드·보안 리뷰 회수본

주의: Claude CLI가 최종 파일 쓰기 권한 요청 후 종료하여, stdout에 남긴 요약을 근거로 회수한 문서다. 전체 원본 본문은 없고, 아래 내용은 `/tmp/mb-018-claude-run.log`의 실제 출력만 반영한다.

## 권장 상태모델
- `pending / active / inactive / suspended / deleted`
- `inactive`는 기관 관리자 운영 비활성 상태
- `suspended`는 플랫폼 관리자 제재 상태
- `deleted`는 soft delete 상태
- 보조 필드 권고: `deleted_at`, `deleted_by`, `status_reason`

## 권한 매트릭스
- `org_admin`: 활성화/비활성화만 가능
- `platform_admin`: 정지/정지해제/soft delete/hard delete 가능
- Claude는 브리프에 포함된 "org_admin soft delete" 해석을 명시적으로 반박했고, Brian 결정 원문을 우선해야 한다고 판단했다.

## API/서비스 변경안
- 상태 강제 지점을 우선 신설해야 한다.
- 상태 변경/삭제/비밀번호 재설정 시 `revoke_all_user_tokens`를 공통 불변식으로 묶어야 한다.
- hard delete는 제한해야 하며, 감사로그 삭제를 금지해야 한다.

## 보안/감사/세션 정책
- `login`, `refresh`, `get_current_user`에 상태 강제가 전혀 없는 점을 Critical로 지적
- `suspend_user`가 refresh token을 폐기하지 않는 점 지적
- access token TTL 48시간 동안 상태 변경이 반영되지 않을 수 있는 위험 지적
- `verification_audits`는 삭제 대상이 아니라 보존 대상이라고 권고

## 기존 결함 및 리스크
Claude stdout 요약에 명시된 핵심 리스크:
1. 계정 상태 강제 지점이 전무함
2. `remove_counselor`에 자기 자신/최소 관리자 보호가 없음
3. `delete_user`가 `sessions/reports/eeg_records/verification_audits` 등 다수 자식 테이블을 하드 삭제함
4. 상태 변경 후 refresh token 미폐기
5. 비밀번호 재설정 관련 토큰/세션 정합 부족
6. 이메일 대소문자 불일치로 재설정 메일 유실 가능성
7. `primary_admin` 고아화 위험

## 최종 권고안
1. 상태모델을 `pending/active/inactive/suspended/deleted`로 고정
2. `inactive`와 `suspended`를 분리
3. `org_admin`은 활성/비활성만 수행
4. `platform_admin`만 soft/hard delete 수행
5. 인증 계층 전체에 상태 강제 추가
6. 상태변경/삭제/재설정 시 토큰 폐기 불변식화
7. 감사로그 보존 및 hard delete 축소
