# SDD-229 Summary

## 변경

| 파일 | 내용 |
|---|---|
| `.github/workflows/deploy-dev.yml` | `e2e-smoke` 잡 제거. `requirements.txt` 해시가 같으면 apt·pip 설치 생략(설치 성공 후에만 해시 기록, venv 재생성 시 해시 삭제) |
| `.github/workflows/e2e-smoke.yml` | 호출 입력 `ref` 추가, 설명·알림 문구를 릴리스 게이트용으로 |
| `.github/workflows/release-build.yml` | `e2e` 잡(= e2e-smoke.yml 호출) 추가, `build.needs: [e2e]` |
| `.github/workflows/ci-feature.yml` | `changes` 잡 추가 → frontend / backend(none·related·full) / pg 잡을 변경분에 따라 실행 |
| `scripts/test-changed` | 선택 로직 재작성(ast import 그래프, 역방향 2단계 확장, 라우터 URL 매칭, 공통 영역·0개·60% 이상 → 전체), `--ci` 모드 |
| `.claude/rules/branch-management.md` | §5 CI 실행 시점 갱신 |

## 설계 판단

- 역 import 확장을 끝까지 하면 `ws`·`chat`·`report` 경유로 클래스·세션 서비스 하나만 바뀌어도 211개 중 187개가 걸린다 → 2단계로 제한. 더 먼 간접 영향은 Release Build 전체 pytest 가 잡는다.
- `from app.services import x` 는 패키지(`app.services`)가 아니라 모듈 `x` 의존으로 본다(패키지 `__init__` 경유 과대 확장 방지).
- E2E 대상은 운영이 아닌 dev 서버(운영 DB 에 테스트 데이터 금지). 릴리스할 커밋이 dev 에 배포돼 있어야 의미가 있다.

## 검증 (verify.md)

| ID | 결과 |
|---|---|
| V01 | actionlint: 이번 변경으로 새 오류 0 (남은 info 4건은 기존 코드 그대로) |
| V02~V08 | 선택 단위 검증 17건 PASS (`~/.hermes/cache/scratch/v_sel.py`) |
| V04 실이력 | 최근 커밋 재현: dashboard 변경 6/211, class_effect 9/211, 클래스 계열 3건 106~117/211(기존 211 전체) |
| V09 | dashboard 선택 6개 파일 로컬 pytest **71 passed, 9초** |
| V10 | Deploy Dev 잡 = frontend·deploy |
| V11 | Release Build: e2e → build |
| V12 | 설치 생략 셸 로직 5경우(최초·동일·변경·설치 실패 후·venv 재생성) 기대대로 |
| V13 | 이 PR CI(워크플로 변경 → 전체 실행) + 머지 후 Deploy Dev 실측 — PR 에서 확인 |

## 예상 효과

- dev 배포: 약 10분 → 약 2분 30초~3분 30초
- 프론트만 바뀐 PR: 약 26분 → 약 5분 / 백엔드 서비스 1개 변경 PR: 수 분
