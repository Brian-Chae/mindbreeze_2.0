# SDD-285 Plan — 작업 분할 (analysis.md 기준)

- 원칙: 앱(Play vc47)은 **원인 확정 전 수정하지 않는다**. 금요일(11/6) 전 배포는 서버만. 행사 당일(11/11) 배포 금지, 11/10 밤까지.
- 일정 표기: ◎ = 금요일(11/6) 전 운영 배포 가능 / ○ = 가능하나 위험 있어 검증 후 / △ = 11/6 이후 또는 앱 심사 필요.
- 구현자·검증자 분리. 운영 DB 쓰기는 건별 승인.

## T0. 원인 확정용 증거 확보 (선행, 오늘~11/5 정오)
| 작업 | 내용 | 산출 |
|---|---|---|
| T0-1 | 묶음 C 4명 기기 로그 확보: `outbox.log`, `scope.json`, 앱 로그(가능하면 `LiveState` 이력). 대표가 해당 참가자에게 요청 | 4명 중 1명이라도 확보 시 §4.2 확정 |
| T0-2 | dev 재현(아래 verify §4-R): 소켓 열린 채 `capture.start` ACK 유실 + 교착 주입 | 재현 여부 → A1/A2 필요성 결정 |
| T0-3 | 교착 피해 참가자 전체 목록(journald의 `DeadlockDetected` 11건 전후 SQL 대상) 확정 | analysis §4.2 가설 2 확정/기각 |
| T0-4 | 행사 기기 앱 버전(vc46 vs vc47) 확인: 사이트 APK와 Play 게시본 차이 | 앱 수정 판단 근거 |

## 서버 작업 (금요일 전 가능 범위 중심)

### S1. 종료 정산 — "파일엔 있고 DB엔 없는 창" 자동 적재 ◎/○
- 효과: 묶음 C 같은 사건에서 앱 수정 없이 분석 DB 57~93% 회복 (SDD-282 F5·F6의 재적재 방식을 서비스화).
- 설계: 수업 종료(Celery, 종료 후 N분) 시 참가자별로 `biosignal_artifacts`(kind=feature) 행과 `eeg_feature_windows`를 대조 → 누락 시퀀스를 `_feature_item` 변환 → `store_batch` 동일 멱등 키(`play_group_id`=해당 참가자 `capture_stream.id`)로 적재, `ingest_path='artifact_reconcile'`로 표식(롤백 기준).
- 조건: 해당 참가자 `capture_stream`이 1개 이상 있어야 함. stream이 0개(묶음 E 같은 경우)는 제외·로그.
- 위험: 중복 적재 → 멱등 키 + `feature_hash`로 방지. 리포트 재생성 경로는 별도(SDD-282 plan). 운영 쓰기이므로 배포 후 최초 실행은 읽기 전용 드라이런 → 건수 확인 → 대표 승인.
- 금요일 전 가능: 구현 1.5일 + dev 검증. **○** (드라이런 모드 우선 배포).

### S2. `capture.start` 교착 완화 ◎
- 원인(확정): 입장 폭주 시 `capture_stream` INSERT의 `sessions` 행 `FOR KEY SHARE`와 동시 갱신이 교착(11건). 핸들러 예외로 ACK 미전송(`session_live_commands.py:329`, `apply_command`의 `except Exception: raise`).
- 수정: (a) 교착(`DeadlockDetected`/`OperationalError`)을 잡아 **`retryable`(committed:false, retry_after_ms)** ACK으로 변환하거나 서버에서 1~2회 자동 재시도 (b) `capture.start`의 락 순서를 `sessions` → `participant` 고정. 에러 응답 시 `Task exception was never retrieved`가 남지 않도록 소켓 핸들러에서 예외 격리.
- 효과: 앱이 ACK 부재로 멈추는 경로 하나 제거(가설 1의 일부). 위험: 낮음(재시도는 command_id 멱등). **◎**

### S3. 상태 신호 보강 — 연결 오판 방지 ◎
- 서버가 **분석/원시 업로드 활동**을 보고 `band_connected`와 별개로 `last_ingest_at`(참가자)를 갱신하거나, 호스트 화면/운영 조회에서 "stream 없음·업로드 있음"을 표시할 수 있게 지표 노출. (대시보드 UI 변경 없이 조회 API/로그 먼저.)
- 최소안: `features/batch`·`biosignal-raw/ack` 수신 시 `[ingest-batch]`/`[raw-ack]` INFO 로그(S5와 함께) + "stream 없는 참가자의 업로드" 경고 로그. **◎**

### S4. `log_truncated` 반복 차단 ◎
- 위치: `class_participation_service.py:893`(되감기 폭 = 방송 대상 행 수 `n_rows`, 재구축 직후 stream 이력 없음). 반복 1,561회.
- 수정: `ReplayUnavailable` 시 해당 `(aud,dom)`은 건너뛰고 1회 경고 + 해당 이벤트는 snapshot 경로로 위임(재방송 생략). 같은 `(session, aud, dom)`은 60초 억제.
- 위험: 방송 누락 → heartbeat self-heal(코드 주석) 확인 필요. **◎**

### S5. 로깅 설정 ◎
- `app/main.py`(또는 `core`)에 `logging.basicConfig`/`dictConfig` 추가, `app.*` 로거 INFO, uvicorn과 동일 포맷. `[ingest-batch]`(session.py:848) 출력. 용량: 요청당 1줄이므로 4,000~10,000건/시간 → journald 허용 범위, `LogRateLimit` 확인.
- 검증: dev에서 `features/batch` 호출 후 journald에 1줄. **◎**

### S6. 입장 시 플랫폼·빌드 기록 ◎
- `refresh_tokens.user_agent` 전원 빈 값(F16) 원인 확인(로그인 경로가 헤더를 저장하지 않음)부터. `entry-state`/join 시 `X-MB-Native`·UA·`app_build`(hello 메시지에 이미 있음, `LiveSession.kt:hello()`)를 참가자 행 또는 신규 `participant_client_info`에 기록. 마이그레이션 필요(Alembic, 신규 컬럼 nullable). 위험 낮음. **○** (마이그레이션 포함이라 배포 시점 신중)

### S7. 정원 계산(비회원 중복 행) ○/△
- 이번 행사는 전원 회원이라 우선순위 낮음. `_has_capacity`가 비대기·미제거 행을 세는 문제(활성 51>50)는 회원 1행 구조에선 재현 안 됨. 회원 경로에서는 **변경하지 않는다**. △

### S8. 403 사유 코드 ○
- `eeg-raw/presign` 403(약 10,100건)에 사유 코드(`waitlisted`/`eeg_consent_required`) 본문 추가. 클라이언트가 읽을지는 별도(앱 변경 없음, 로그·집계용). 회원 경로에선 재시도 폭주가 없어 우선순위 낮음. ○

## 앱 작업 (원인 확정 후 결정 — 현재 보류)
- A1: stream 없이 N초 지속 시 소켓 강제 재연결 + 새 command 재시작. A2: join/resync snapshot의 본인 활성 stream 채택(소유자 검증). A3: 귀속 전 창 정체 진단 이벤트.
- 심사 1회 제약: A1·A2를 한 번에 넣을 때만 진행. **T0-1 또는 T0-2로 원인이 앱 쪽 상태 꼬임으로 확정될 때만 대표 승인 요청.** 아니면 보류하고 S1·S2로 방어.

## 순서와 병렬화
1. 11/4~5: T0-3·T0-4(읽기 전용 조사), S5·S2·S4 구현 시작(서로 다른 파일: 로깅 설정 / `session_live_commands`·`session_live_namespace` / `class_participation_service`).
2. 11/5: S1 구현, S3. dev 검증 병행(verify.md).
3. 11/5 밤~11/6: develop 푸시 → Deploy Dev → 40명 회원 경로 부하 시험(verify §5). 통과 시 운영 배포 승인 요청(대표).
4. 11/6~10: S6, 필요 시 앱 심사 반영. 11/10 밤 이후 배포 금지.

## 대표 결정 필요
1. 서버 수정(S1~S6) 진행 go.
2. 묶음 C 4명 기기 로그 확보 요청 가능 여부(T0-1).
3. S1 최초 실행(운영 쓰기) 승인은 드라이런 결과 후 별도.
