# Claude 백엔드·보안 리뷰 회수본

주의: Claude CLI가 최종 파일 쓰기 권한 요청 후 종료하여, stdout에 남긴 요약을 근거로 회수했다. 전체 원본은 없고 `/tmp/mb-019-claude-run.log`의 실제 출력만 반영한다.

## 핵심 결론
"비밀번호 없이 클릭 로그인 + 즉석 사용자 생성"은 본질적으로 인증 우회 + 무제한 권한상승 엔드포인트다. 목표는 "dev에서만 켜진다"가 아니라 **"prod 프로세스에는 코드 경로·URL·토큰이 물리적으로 존재하지 않는다"**로 잡아야 한다.

## 환경 분리 설계
- `debug` 재사용 금지
- `environment: Literal["local","dev","prod"] = "prod"` (fail-safe 기본값) 신설
- `sim_login_enabled` AND 조건으로 게이트
- dev/prod `jwt_secret_key` 물리 분리

## dev 전용 엔드포인트 설계
- 별도 파일 `dev_sim.py`로 분리, 조건부 import 등록
- 엔드포인트 4종: 목록 / 생성 / 무비번 로그인 / 정리

## 인증 우회 안전장치 (6겹 방어)
1. 라우터 미등록 (prod에서는 물리적으로 import 안 함)
2. 미들웨어 403
3. 시크릿 헤더 요구
4. `sim:true` 클레임 토큰 거부
5. 서명키 분리
6. 프론트 env gating

## 기존 흐름과의 격리
- `auth.py` / `deps.py` 무수정
- org_admin sim 시 `user.org_id` ↔ `org.primary_admin_id` 양방향 동시 설정
- sim org 네임스페이스 분리

## 보안 리스크 및 완화 (10건)
- R-1 platform_admin 탈취
- R-2 dev 토큰 prod replay
- R-3 조건부 등록 단일 실패점
- R-4 primary_admin 정합 훼손
- R-5 시크릿 유출
- R-6 무제한 생성
- R-7 무비번의 빈 해시 오용
- R-8 실계정 파괴
- R-9 Google 승격 오염
- R-10 OpenAPI/CORS 노출

## 최종 권고안
1. prod 프로세스에 dev 시뮬레이션 코드 경로가 물리적으로 존재하지 않게 한다.
2. `environment`(기본 prod) + `sim_login_enabled`(기본 false) + jwt 키 분리로 삼중 게이트.
3. dev 엔드포인트를 조건부 import하고 prod 라우터에는 포함하지 않는다.
4. 무비번 로그인 토큰에 `sim` 클레임을 넣고 `get_current_user`에서 거부한다.
5. org_admin sim의 org/primary_admin 정합을 양방향으로 유지한다.
6. 시뮬레이션 계정은 별도 네임스페이스(`@dev.local`, `auth_provider="dev"`)로 격리한다.

## 브리프 판단 반박 2건
1. `debug=True` 재사용은 위험 — prod 배포에 debug가 남으면 dev API가 열린다.
2. 무비번 로그인은 도메인 게이트를 우회하는 유일 경로이므로 별도 서명키/클레임 격리가 필수다.
