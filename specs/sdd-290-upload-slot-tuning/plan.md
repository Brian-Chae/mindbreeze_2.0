# SDD-290 Plan

## 변경 (최소)
| 파일 | 변경 |
|---|---|
| `backend/app/config.py` | `archive_max_concurrent` 16→32, `archive_slot_wait_sec` 0.5→1.0 (+주석) |
| `backend/tests/sdd260/test_resources.py` | 기본값 단언을 32/1.0으로 갱신 |
| `backend/tests/sdd290/test_upload_slot.py` | 신규 시험 5건 |

근거는 `analysis.md`. 슬롯 보유 시간 단축(ack S3 검증을 슬롯 밖으로)은 4개 핸들러 재구성이 필요해 1주 전 최소 변경 원칙상 제외 → **후속 후보**.
대기 1.5초안은 기각: 포화 시 스레드 최악 64(=anyio 한도)에서 대기자가 스레드를 더 오래 잡아 다른 요청을 막는다. 1.0초로 한다.

## 운영 반영
- 코드 기본값 변경이므로 일반 배포(develop → dev 시험 → main 머지) 후 backend 재시작 1회. `prod.env`·SSM 변경 없음(`ARCHIVE_*`는 env-manifest에 없어 렌더 불가).
- 응급 값 조정이 필요하면 코드 수정 배포가 유일한 경로(분석 §4). 환경변수 오버라이드를 원하면 매니페스트에 선택 키 추가가 필요 — 이번 범위 밖.

## 롤백
- 이 커밋 revert → 재배포 → 재시작 1회(16/0.5초 복귀). DB·앱 변경 없음.

## dev 40명 시험 합격선
- 시나리오: 40명 동시, raw 3센서 10초 청크 + 분석 파일, 종료 직후 복귀 업로드 폭주 포함.
- 429 비율: 현 설정(16/0.5) 대비 감소(행사 실측 약 506건/2.5시간 기준 절반 이하 목표).
- DB 연결 사용률: 풀 40 중 **피크 28(70%) 이하**(`ingest_metrics`의 풀 지표 또는 pg_stat_activity 건수).
- 업로드 p95: presign 응답 < 1초, ack 응답 < 3초(대기 포함). anyio `borrowed_tokens` 피크 < 64(`ingest_metrics.py:68`).
- 로그인·`/health` 응답이 시험 중 p95 1초 이하(다른 요청 기아 없음).
- 하나라도 미달 시 롤백하고 후속(보유 시간 단축) 진행.

## 후속 후보 (이번 제외)
- ack의 S3 HEAD를 슬롯 밖으로(핸들러 내부 세분화), 청크별 HEAD 병렬화, 환경변수 오버라이드용 매니페스트 키 추가.
