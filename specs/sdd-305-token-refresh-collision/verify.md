# SDD-305 — 검증 계획 (verify)

> 주의: 이 문서는 C(서버) 코드 초안 작성 직후에 기록됐다(원칙상 구현 전 작성 대상이었으나 순서가 어긋났다). 시험은 구현이 아니라 아래 기준으로 판정한다.

## 0. 승인 범위 (대표 11/5)
- "모두 제안대로 수정": A(dev 수명 48시간, 감독 적용 완료) + B(Android 우선, 갱신 주체·저장·락 단일화) + C(서버 중복 요청 멱등화).
- 푸시·PR·배포·앱 빌드·운영 접근·메일·삭제 금지. iOS는 문서화만.
- 합격 전에는 "해결"로 표시하지 않는다.

## 1. 기준
- 기준 커밋: 13bff196 (develop 기반). 단말/APK: 실기기 재시험 시점에 기록(이번 워커는 미확인).
- 운영 수명 2880분. dev도 2880으로 맞춤. **15분 충돌은 격리 시험(수명 짧게)에서만 재현**한다. 공유 dev 서버 수명은 바꾸지 않는다.

## 2. C — 서버 (자동 시험)
| ID | 시나리오 | 기대 |
|---|---|---|
| C1 | 같은 old refresh 두 번(0초 간격, 순차) | 두 응답이 같은 access·같은 새 refresh 쿠키. 새 jti는 1개 |
| C2 | 유예(10초) 밖 재사용 | 401 + 사용자 전체 refresh 폐기 |
| C3 | 로그아웃(후속 토큰 폐기) 후 유예 안 재사용 | 되살리지 않음. 401 + 전체 폐기 |
| C4 | 복제 보유자 W/N 충돌: W가 R0→R1, 2초 뒤 N이 R0 제출 | N은 R1 쌍을 받음(R2 새로 만들지 않음) → 이후 W/N 모두 같은 체인 |
| C5 | 정지 계정의 중복 요청 | 거절 |
| C6 | 전체 폐기(비밀번호 재설정 등) 뒤 rotation_result 삭제 | 유예 안이어도 복원 불가 |
| C7 | DB 평문 검사 | rotation_result 열에 access/refresh 원문이 없음(암호문) |
| C8 | 로그에 토큰 값 없음, `refresh_outcome` rotated/duplicate/reuse/invalid | caplog 확인 |
| C9 (PG) | 독립 PG 연결 8개가 같은 R0을 동시에 제출 | 회전 1회, 8개 응답 모두 동일 쌍(또는 정상 401 아님), 전체 폐기 0 |
| C10 (PG) | 유예 이후 재제출 | 전체 폐기 |

PostgreSQL 시험은 `PG_SMOKE=1 DATABASE_URL=postgresql://localhost/… pytest --confcutdir=tests/pg tests/pg/test_sdd305_refresh_pg.py`. SQLite/mock만으로 동시성 합격 선언 금지.

## 3. B — Android + 웹 bridge
| ID | 시나리오 | 기대 |
|---|---|---|
| B1 | Runtime+Sweeper+오디오 동시 401 | refresh HTTP 1회, 같은 결과 공유 (JVM) |
| B2 | generation 지난 응답 | 버림, 새 자격증명 덮어쓰지 않음 |
| B3 | 로그아웃·계정 전환 중 진행 중 요청 | 결과 무효화, 다른 계정 outbox 전송 0, 원본 삭제 0 |
| B4 | 프로세스 재시작 | 저장소(SealedTokenStore)에서 복구, 단일 owner |
| B5 | 웹 native 모드: 모든 refresh 진입점(401·초기화·소켓·refreshAuth)이 bridge 경유 | vitest |
| B6 | 일반 웹 | HttpOnly 쿠키 경로 유지 |
| B7 | 구 APK(bridge 없음) | 기능 탐지 후 기존 경로로 동작 |
| B8 | refresh token을 JS로 반환하는 이벤트 | 추가 없음 |

## 4. 실기기 합격 기준 (후속, 이번 워커 미수행)
20대 모두 60분 이상 분석창 연속 도착(10초 초과 공백 0), refresh 401 0·미복구 REST 401 0, 갱신 토큰 전체 폐기 0, 단말별 성공 갱신 3회 이상(15분 정책), 앱 재시작/백그라운드 후 유지, outbox drain·sequence 중복/누락 없음. 한 대라도 영구 실패 시 미통과.

## 5. 회귀
`tsc -b` 0, 관련 vitest(`use-close-biosignal-on-end`, `sdd293-band-early-handoff` 포함), 백엔드 auth 관련 pytest, Android `:app:testDevDebugUnitTest`.
