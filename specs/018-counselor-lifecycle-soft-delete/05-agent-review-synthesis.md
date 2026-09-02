# SDD-018 에이전트 리뷰 종합

## 실행한 에이전트
- Claude: 백엔드/보안 리뷰 성공, 단 파일 직접 저장 실패 → stdout 요약 회수
- Codex: API/구현 정합 리뷰 문서 생성 완료
- Cursor: UX/프론트 리뷰 문서 생성 완료
- Gemini: 실행 실패 (`UNSUPPORTED_CLIENT` + trusted directory 요구). 설계 내용 산출물 없음.

## 에이전트 간 공통 합의
1. 상태모델은 `pending / active / inactive / suspended / deleted` 5단계로 확장해야 한다.
2. 기관 관리자 비활성(`inactive`)과 플랫폼 관리자 정지(`suspended`)를 절대 같은 상태로 합치면 안 된다.
3. `org_admin`은 상담사 삭제 권한을 가지면 안 되며, 활성/비활성만 제어해야 한다.
4. 현재 hard delete는 임상 기록/리포트/EEG/감사로그를 파괴하므로 기본 경로가 되면 안 된다.
5. 로그인/refresh/current_user/WebSocket/set-password/password-reset에 상태 강제가 들어가야 한다.
6. 상태 변경 시 refresh token 폐기와 감사로그 기록이 공통 불변식이어야 한다.
7. 기관 관리자 전용 상담사 관리 화면을 별도로 만들어야 한다.
8. 기존 `DELETE /org/{org_id}/counselors/{user_id}`는 삭제처럼 보이지만 실제 소속 해제이므로 의미 충돌을 해소해야 한다.

## 에이전트별 차별 포인트
- Claude: 상태 강제 부재를 최우선 Critical로 봤고, 감사로그 보존과 hard delete 제한을 강하게 요구했다.
- Codex: 엔드포인트 분리, 타입 정합, 마이그레이션/테스트 범위를 가장 구체적으로 제시했다.
- Cursor: org_admin/ platform_admin / counselor 3면 UX와 IA 분리를 가장 구체적으로 제시했다.

## 최종 설계 방향
- 정책 축: org_admin은 운영 활성/비활성, platform_admin은 제재/삭제, counselor는 상태별 차단 UX
- 데이터 축: soft delete 기본, hard delete 격리
- 인증 축: 상태 강제 전역화
- 프론트 축: 기관 관리자 전용 상담사 페이지 + 플랫폼 관리자 생명주기 콘솔 + 상담사 blocked UX

## 미해결이 아닌 명시 결정
1. 이메일 수정은 이번 범위에서 제외하고 이름/전화만 우선 허용
2. deleted 이메일 재사용은 일반 org_admin 흐름에서 허용하지 않음
3. hard delete는 platform_admin 전용이며 soft delete 이후 별도 Danger Zone에서만 허용
4. org 화면의 "삭제"/"소속 해제" 액션은 제거한다

## Gemini 실패 기록
- 실제 로그: `/tmp/mb-018-gemini-run.log`
- 원인: 인증 티어 지원 종료 + trusted directory 미설정
- 결론: 이번 기획안은 Gemini 입력 없이 확정하되, 실행 불가 사실을 운영 블로커로 기록한다.
