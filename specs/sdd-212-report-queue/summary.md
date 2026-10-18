# SDD-212 — Summary (Stage ⑥)

- 범위: 리포트 생성 줄(큐) 분리 · 동시성 상한 · 대기 시간 보정 · 적체 모니터링 · 회원 지연 안내
- 선행 승인: Brian go, D-1~D-7 = spec §4 추천안 확정
- 브랜치: `sdd/212-report-queue` (PR #8, base `develop`)
- DB 마이그레이션: **없음** (alembic 변경 0건 → head 충돌 위험 없음)

## 1. 한눈에 보기

| 항목 | 결과 |
|---|---|
| 구현 Task | T1·T2·T3·T4·T6·T7·T8·T9·T11 완료 / T0 미실시 / T5·T10 조건 미충족으로 미구현 |
| 백엔드 pytest 전체 | **2911 passed, 20 skipped, 0 failed** (기준선 2807 passed → 신규 104건) |
| 프론트 vitest | 1685 passed, 11 failed / 6파일 (기준선 1676 passed, 11 failed / 6파일 — **실패 케이스 동일**, 신규 9건 통과) |
| 프론트 tsc | 오류 0 (기준선 동일) |
| 프론트 eslint | 3 errors (기준선과 동일 3건, 신규 0) |
| 기본 동작 | 줄 분리 **꺼짐**이 코드 기본값 (아래 §3-1). 켜기 전까지 기존 단일 줄 구성과 동일 |

## 2. Task 현황

| Task | 상태 | 내용 | 테스트 |
|---|---|---|---|
| T0 실측 보정 | **미실시** | 운영 로그·DB·공급자 한도 확인은 서버/AWS 접근이 필요해 건너뜀(§6) | — |
| T1 라우팅 | 완료 | `build_task_routes()`; `stt`(음성 변환·영상 병합) / `report`(요약·리포트 생성) / 나머지 `celery`, `exports` 유지. 설정 플래그로 제어 | `test_sdd212_queue_routing.py` |
| T2 일꾼 유닛 | 완료 | 유닛 템플릿 2종 신설(`stt` 동시 2 / `report` 동시 2), 기존 일꾼 `-Q celery --concurrency=1`, 설치·활성화·컷오버 점검 목록·운영 매니페스트 반영, dev용 유닛 파일 준비 | `test_sdd212_worker_units.py` |
| T3 시간 상한·멱등 | 완료 | 리포트 생성 soft 25분 / hard 28분. 시간 초과 시 완료분 보존(§3-2) | `test_sdd212_report_time_limit.py` |
| T4 대기 보정 | 완료 | 스윕 유예 +60분, 재발행 지연 30→90분, 줄이 밀려 있으면 재발행 보류(§3-3) | `test_sdd212_wait_compensation.py` |
| T5 대규모 청크 | **불필요 판정** | 30명 클래스가 시간 초과 후 재시도로 중복 없이 완료됨을 확인(T-04). 청크 처리 추가 안 함 | `test_sdd212_report_time_limit.py::T04` |
| T6 지표·조회 API | 완료 | `pipeline_backlog_service.snapshot/evaluate_alerts`, `GET /api/v1/admin/pipeline/backlog` (platform_admin) | `test_sdd212_backlog_service.py` |
| T7 감시 cron·경보 | 완료(적용 제외) | `report_backlog_probe` 1분 timer, 로그 JSON, CloudWatch 게시(기본 꺼짐), 경보 스크립트·IAM 정책 문서 준비(**미실행**) | `test_sdd212_probe.py` |
| T8 회원 안내 | 완료 | 가산 필드 `in_review_delayed` + 보조 문구 `평소보다 조금 늦어지고 있어요.` (목록·상세) | `test_sdd212_member_notice.py`, `client-report-delayed-notice.test.tsx` |
| T9 부하 재현 | 완료 | 실제 라우팅·실제 사슬을 쓰는 이산 이벤트 시뮬레이터 | `test_sdd212_load_simulation.py` |
| T10 Phase B | **미구현** | 착수 조건(T0 한도 확인 + 운영 429 로그)이 충족되지 않음 | — |
| T11 문서·롤백 | 완료 | `deploy/README.md` 운영 절(배포 순서·롤백·설정·지표 읽는 법) | — |

## 3. 구현 중 판단 (plan 과 달라진 점)

### 3-1. 줄 분리를 설정 플래그로 제어 (`PIPELINE_QUEUE_SPLIT_ENABLED`, 코드 기본 `false`)
- 사유: dev 배포 워크플로(`.github/workflows/deploy-dev.yml`)는 기존 워커 유닛 3종만 설치한다. 라우팅을 무조건 켜면 dev 에서 `stt`/`report` 줄에 소비자가 없어 작업이 쌓인다.
- 운영 매니페스트는 `true`(신규 유닛이 같은 릴리스로 설치됨). 롤백도 이 값 한 곳(spec §6 "설정 한 곳을 되돌려 복귀").
- `deploy-dev.yml`(CI/CD 파이프라인)은 수정하지 않았다 → dev 에서 분리 구성을 시험하려면 승인 후 워크플로에 유닛 2종 추가가 필요(§7).

### 3-2. plan TD3 의 전제가 깨져 있어 함께 수정
- plan 은 "상한을 걸면 재시도가 완료분을 건너뛴다(멱등)" 고 가정했다. 그러나 시간 초과 예외가 기존 `except Exception` 에 잡혀 `_mark_pipeline_failure` 가 **이미 끝난 `pending_review` 리포트까지 `error` 로 되돌렸고**, 재시도가 전부 다시 생성했다.
- 수정: 시간 초과(`SoftTimeLimitExceeded`)는 **재시도가 소진된 마지막 시도에서만** 실패 마킹한다. 그 외 예외의 기존 동작은 불변(테스트로 고정).
- 참고: 전사 없음·마이크 끔 등으로 `partial` 인 리포트는 기존 정책(STT 복구 반영)대로 재시도 때 다시 만든다 — 변경하지 않음.

### 3-3. plan TD4 "적체 모드" 정의를 보정
- plan 문구("최장 대기 시간이 임계 이상이면 재발행 보류")를 그대로 구현하면, 재발행 지연(90분)이 지난 단일 정체 건은 항상 임계(30분)를 넘으므로 **영구 보류**가 된다.
- 구현: **파이프라인 줄에 대기 중인 작업이 있으면** 이번 회차 재발행을 보류(시도 횟수 미소모). 보류 상한 = 판정 시각을 재드라이브 지연만큼 더 넘기면(발행 후 180분) 줄이 밀려 있어도 유실로 보고 재발행. 브로커 조회 실패 시 "적체 아님"으로 처리해 유실 복구를 막지 않는다.

### 3-4. 기타
- 경보 스크립트는 `t13-monitoring.sh` 수정 대신 별도 `t14-pipeline-alarms.sh` 로 분리 — t13 재실행이 신규 경보를 의도치 않게 만들지 않도록. 환경 변수 `MB_PIPELINE_ALARMS_APPROVED=yes` 없이는 실행을 거부한다.
- 테스트가 개발 PC 의 실제 Redis 잔량에 영향받지 않도록 `conftest.py` 에 빈 fakeredis 기본 주입(autouse) 추가. (이 PC 의 로컬 Redis `celery` 줄에 잔량이 있어 기존 테스트가 "보류"로 바뀐 것을 발견해 보강.)
- CI 1회차에서 신규 테스트 1건이 실패했다: 종료 API 를 호출하는 테스트가 실제 브로커(Redis)에 의존해, 브로커가 없는 CI 에서는 발행이 실패해 `pending` 으로 남았다(로컬은 Redis 가 떠 있어 통과). 발행을 가짜로 대체하도록 수정하고, `REDIS_URL` 을 닫힌 포트로 지정해 브로커 없는 환경에서도 신규·관련 155건이 통과함을 확인했다.
- 컷오버 스크립트 `c05`·`c06` 의 운영 서비스 점검 목록에 신규 일꾼 2종 추가(`lib.sh` 의 dev 중지 목록은 dev 유닛 구성이므로 불변).

## 4. 기존 테스트 변경 (의도된 기준 변경 4건)
| 파일 | 변경 | 사유 |
|---|---|---|
| `test_report_watchdog.py::test_03` | 기록 마감 기준에 대기 유예 가산 | 스윕 기준 의도적 변경(W-02) |
| `test_sdd210_deploy_templates.py` | 활성 작업 = dev cron 14 + 운영 전용 1(`report_backlog_probe`), timer 15개 | 신규 timer |
| `test_sdd210_install_release.py` | 설치 timer 수 14 → 15 | 신규 timer |
| `test_sdd211_member_report_visibility.py` | allow-list 에 `in_review_delayed` 분류 추가 | 새 필드는 분류를 강제하는 기존 가드 |

## 5. verify.md 시나리오 결과

| 구분 | ID | 결과 |
|---|---|---|
| A 줄 분리 | Q-01·Q-02·Q-05 | 자동 통과 (`queue_routing`) |
| | Q-03·Q-04 | 자동 통과 (`worker_units`) |
| B 동시성 | C-01·C-02·C-03·C-05 | 자동 통과 (`load_simulation`) |
| | C-04 | 자동 부분(다른 줄 진행 + 소비자 0 경보) 통과 / 실제 일꾼 중지 수동 확인 **미실시** |
| C 시간 상한 | T-01·T-02·T-03·T-04 | 자동 통과 (`report_time_limit`) |
| D 대기 보정 | W-01~W-06 | 자동 통과 (`wait_compensation`; W-05·W-06 은 기존 스위트와 함께 확인) |
| E 지표·경보 | M-01~M-04·M-08 | 자동 통과 (`backlog_service`) |
| | M-05·M-06 | 자동 통과 (`probe`) |
| | M-07 경보 도달 | **미실시** (AWS 승인 필요) |
| F 회원 안내 | U-01~U-05·U-08 | 자동 통과 (`member_notice`) |
| | U-06·U-07 | 자동 통과 (vitest) / U-07 화면 수동 확인 **미실시** |
| G 무회귀 | R-01·R-02·R-03·R-04·R-06 | 백엔드 전체 pytest 통과(2911) |
| | R-05 | vitest·tsc·eslint 기준선 대비 신규 실패 0 |
| H 배포·롤백 | P-01~P-05 | **미실시** (서버 작업, 별도 승인) — 절차는 `deploy/README.md` |
| I 조건부 | X-01 | 미적용 (T0 미실시) |
| | X-02 | 해당 없음 (D-2 = A) |
| | X-03 | 미적용 (T0 미실시) |

## 6. 시뮬레이션 결과 (T9, 가정값 기반 — 실측 아님)
정시 10세션 동시 종료(음성 변환 8분 · 요약 2분 · 리포트 1.5분 가정):
- 분리 구성: 마지막 리포트 완료 ≤ 50분, STT 동시 실행 ≤ 2, 첫 세션의 요약은 대기 0분으로 시작
- 기존 단일 줄: 첫 세션의 요약이 10분 넘게 STT 뒤에서 대기, 마지막 리포트도 더 늦음
- 리포트 행 생성까지 대기가 30분을 넘는 건이 3건 이상 → 보정 전 기준(30분)이면 오판 대상, 보정 후 기준(스윕 90분 / 재발행 90분)에서는 0건

## 7. 미실시 항목과 사유
| 항목 | 사유 |
|---|---|
| T0 실측(STT·요약·리포트 소요 분포, 몰림 빈도, 공급자 한도) | 운영 DB·로그·dev 서버 접근이 필요해 건너뜀(지시 (c)). 동시 처리 수 초기값(2/2/1)과 대기 보정 기본값은 **가정값** |
| CloudWatch `PutMetricData` 권한 확인·게시, 경보 생성, SNS 수신자 구독 | AWS 변경(지시 (a)). 코드·정책·스크립트만 준비 |
| 서버 적용(신규 유닛 설치·기동·설정 변경), 배포·롤백 리허설(P-01~P-05), 일꾼 중지 확인(C-04 수동) | 서버 직접 변경 금지(지시 (b)) |
| dev 서버 N세션 동시 종료 재현(P-05) | dev SSH 금지(지시 (c)) |
| Linear 코멘트에 문서 게시 | 이슈 ID 미지정 |

## 8. 승인 필요 목록
1. **AWS**: 인스턴스 역할의 `cloudwatch:PutMetricData` 허용 확인(`CloudWatchAgentServerPolicy` 에 포함돼 있을 가능성 있음, 부족하면 `deploy/aws/pipeline-metrics-policy.json` 인라인 추가) → 경보 생성(`t14-pipeline-alarms.sh`, 임계 1800초/20건) → 알림 수신자(Brian·운영 담당) SNS 구독
2. **운영 값**: `PIPELINE_METRICS_CLOUDWATCH_ENABLED=true` 전환 시점
3. **dev 서버**: T0 실측을 위한 로그·DB 읽기 접근, 분리 구성 재현(P-05), `deploy-dev.yml` 에 신규 유닛 2종 설치 추가(CI/CD 변경)
4. **D-6**: 외부 AI 한도 확인 결과에 따른 Phase B(T10) 착수 여부
5. **배포(supervisor)**: 순서 — 신규 유닛 기동 → 라우팅 설정 → 기존 일꾼 인자 변경(직전 `celery` 줄 잔량 확인). 마이그레이션은 없음

## 9. 알려진 한계
- 보조 문구는 목록·상세에만 적용(spec 범위). 홈 카드(`ClientHomePage`)는 `리뷰 중` 칩만 표시.
- 지연 판정은 "세션 종료 후 15분 + 생성 미완료"라서, 단일 세션이 정상이어도 STT 가 15분을 넘기면 문구가 보일 수 있다(의도된 동작, 임계는 `PIPELINE_REPORT_DELAY_NOTICE_SECONDS`).
- 소비자 수 조회(`celery inspect`)는 응답이 없으면 모든 줄 0으로 본다 → 초기 운영 중 `no_consumer` 오경보 여부를 로그로 확인한 뒤 경보 연결을 권장.
- 적체 감시 timer 는 운영 전용이다(dev 서버 cron 에는 등록하지 않음).
