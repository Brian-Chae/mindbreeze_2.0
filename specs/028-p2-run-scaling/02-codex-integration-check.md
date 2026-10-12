## run_id 경량 접근 판정

검토일: 2026-09-08. 최초 검토 기준: 로컬 HEAD `809322a`의 코드(검토 시작 시 코드 변경 없음). `spec.md`, `plan.md`, `verify.md` 및 SDD-025 P2 로드맵을 현재 코드와 대조했다. 아래 별도 표시 없는 `파일:행`은 저장소 루트 및 최초 검토 기준이다. 종료 직전 병행 변경이 유입되어 현재 파일의 행 번호는 달라질 수 있다. 코드·테스트·마이그레이션은 수정하지 않았다.

**판정: 경량 설계는 조건부 적정하나, 검토한 구현의 완료 증거가 부족하므로 SDD-028 통합 통과를 권고하지 않는다.** 최초 검토에서는 `Session`에는 `run_id`가 없고 생성 서비스에도 발급 로직이 없다. `backend`와 `frontend/src` 검색에서도 `run_id` 구현이 확인되지 않았다. 검토 시점 SDD-028 디렉토리에는 spec/plan/verify만 있고 전용 테스트·마이그레이션은 확인되지 않았다. 근거: `backend/app/models/session.py:14-48`, `backend/app/services/session_service.py:136-175`.

**종료 직전 병행 변경 확인:** 다른 작업자의 미완료 변경에서 nullable `Session.run_id`, 생성 시 `session.run_id = session.id`, 직렬화 시 NULL의 session_id fallback이 추가되었다(`backend/app/models/session.py:18-23`, `backend/app/services/session_service.py:49,189-192`, 종료 시점 작업 트리). 따라서 “run_id가 없다”는 위 설명은 최초 기준에 한정한다. 이때 `start_new_run`은 서비스 주석에서만 확인되어 명시적 새 회차 생성의 완성은 확인하지 못했다. 아래 회귀 실행 결과를 이러한 병행 변경 전체의 통과 결과로 간주하지 않는다.

**별도 SessionRun 테이블 없이 충분한 조건은 “Session 한 행 = 실행 한 회차”다.** 명시적 새 실행은 새로운 Session과 참가자 행을 생성하고, 해당 회차의 `run_id = session_id`를 불변으로 유지한다. EEG·raw·report의 기존 session_id FK로 회차를 분리할 수 있어 대규모 FK 이전이나 상태 중복 저장이 필요 없다. 재접속·pause/resume은 같은 Session과 run_id를 유지한다. 이 경우 run_id는 독립 도메인 모델이라기보다 실행 식별자의 별칭이며, 별도 테이블을 도입할 필요는 없다.

반대로 **같은 Session 행의 run_id만 바꾸는 방식은 부적정하다.** 과거 feature/raw/report는 여전히 같은 session_id에 연결되므로 새 run_id로 Session을 조회해도 과거·현재 데이터를 구분하지 못한다. 상태·시작/종료 시각·참가자도 한 행의 값이어서 회차 이력을 보존할 수 없다. 근거: `backend/app/models/session.py:20-48`, `backend/app/models/eeg_feature.py:33-47`, `backend/app/models/record.py:85-97`. 이는 “참여자/feature/raw/report를 실행에 연결”하라는 SDD-025 요구를 충족하지 못한다(`specs/025-live-session-parity-analysis/02-codex-integration-review.md:101-104`).

또한 새 Session을 만들기만 하면 **개별 실행 격리**는 해결되지만 **같은 수업 정의의 반복 회차 목록·연결**은 해결되지 않는다. 현행 Session 모델에는 수업 정의나 원본 세션을 가리키는 관계가 없다(`backend/app/models/session.py:14-48`). 최소한 새 실행의 원본 관계를 어떻게 보존할지와 어떤 설정을 복사할지를 계약으로 정해야 한다. 원본 Session 참조 또는 기존 템플릿 참조로 충분한지 먼저 판단하고, 독립 실행 수명주기가 실제로 필요해질 때만 SessionRun을 재검토한다. 참가자 동의·과거 측정·리포트는 새 회차에 자동 복제하는 설정과 구분해야 한다.

completed 재시작 차단은 현재 유지된다. start는 ready/scheduled만 허용하고 resume은 paused만 허용하며, 잘못된 전이를 서비스에서 거부한다(`backend/app/services/session_service.py:23-29,306-318`). 최초 started_at도 start 시 한 번만 기록한다(`backend/app/services/session_service.py:330-335`). 다만 이는 기존 상태 규칙의 근거이지 존재하지 않는 run_id 유지 구현의 증거는 아니다.

`play_group_id`는 run_id와 혼동하면 안 된다. 현재 모델은 play/resume마다 달라질 수 있는 **측정 세그먼트**로 정의하며, 동일 window_index도 세그먼트가 다르면 저장한다(`backend/app/models/eeg_feature.py:25-29,45-49`, `backend/app/services/session_service.py:1167-1199`). 한 실행 안의 여러 측정 세그먼트라는 관계를 유지해야 한다.

## 조회 최적화 정합

**종료 직전 추가된 헬퍼의 정적 판정:** `backend/app/services/eeg_query.py:22-58,86-114`는 반열린 범위 필터와 LIMIT를 제공한다. 범위·LIMIT를 생략하면 기존 전체 읽기와 같은 행 집합을 반환하지만 읽는 양도 줄지 않는다. 범위를 지정하면 전체 결과 자체가 아니라 전체 결과에서 같은 범위를 필터한 결과와 비교해야 한다. window_index만 정렬하므로 동률의 순서는 보장되지 않으며, `order_desc=True + limit`를 “시간상 최신 N개”로 부르는 주석은 resume 시 offset 재시작과 맞지 않는다. created_at 기준의 별도 최신 함수(`eeg_query.py:61-82`)를 구분해야 한다. 확인 시점 session_service/eeg_rollup_service에는 이 헬퍼 호출이 아직 없었다. 따라서 헬퍼 추가만으로 주요 경로의 전체 읽기가 제거되었다고 볼 수 없다.

종료 시점 모델에는 `(session_id, participant_id, window_index)`와 `(session_id, participant_id, chunk_index)` 인덱스 선언도 추가되었다(`backend/app/models/eeg_feature.py:31-39`, `backend/app/models/record.py:83-91`, 작업 트리). 전용 마이그레이션·테스트는 이 확인 시점에는 발견되지 않았다. created_at이 없는 인덱스로 최신 조회가 “인덱스만 사용”한다고 보장하는 헬퍼 주석은 실행 계획 증거가 없다. 최초 기준의 상세 검토는 다음과 같다.

**최초 기준에는 batch 최적화 전후의 동일 결과를 검증할 구현 쌍이 없었다.** 다음은 현재 경로의 확인 결과와 후속 구현이 보존해야 할 계약이다. 여기서 “전체 읽기”는 세션/참가자의 전체 이력을 애플리케이션으로 가져온다는 뜻이다. 실제 PostgreSQL의 Seq Scan 여부는 실행 계획을 측정하지 않아 단정하지 않는다.

- **feature 중복 조회: 미최적화.** `persist_feature_windows`는 해당 session/participant의 모든 `(play_group_id, window_index)`를 `.all()`로 읽는다(`backend/app/services/session_service.py:1170-1180`). batch의 정확한 복합 키 또는 offset 범위로 후보를 줄여도, 입력 키에 대한 기존 행 존재 여부가 같다면 저장/skip 결과는 유지할 수 있다. session/participant 범위를 유지하고 `play_group_id`를 포함해 비교해야 하며, NULL 세그먼트도 빠뜨리면 안 된다. 단순 SQL 튜플 IN의 NULL 비교에 의존하지 말고 NULL 조건을 별도로 처리하는 검증이 필요하다. 범위 조회는 희소 batch에서 불필요한 중간 행까지 읽으므로 정확한 키 조회와 성능이 같다고 볼 수 없다.
- **batch 내부 중복·동시 저장: 보존 필수.** 현재 `seen_in_batch` 및 SAVEPOINT/IntegrityError 처리가 있다(`backend/app/services/session_service.py:1182-1193,1218-1226`). 기존 UNIQUE에는 nullable play_group_id가 포함되며 NULL을 동일 키로 취급하는 별도 제약은 이 마이그레이션에 없다(`backend/app/models/eeg_feature.py:27-29,47`, `backend/alembic/versions/a1c2e3f40261_sdd_026_live_session_p0_hardening.py:49-54`). 따라서 NULL 세그먼트의 동시 재전송까지 사전 조회와 UNIQUE만으로 막는다고 보장해서는 안 된다. 같은 키에 다른 payload가 도착하는 경우도 현재는 내용 비교 없이 skip하므로, 결과 동등성과 payload 정합은 별도 검증 항목이다.
- **raw: 전체 이력 읽기가 아니라 항목별 키 조회.** presign은 `(session_id, participant_id, stream_id, chunk_index)`로 `.first()`, ack는 chunk_id와 소유 범위로 `.first()`한다(`backend/app/services/eeg_raw_service.py:67-78,155-164`). 따라서 스펙의 “raw 전체 스캔 제거”는 현황을 정확히 설명하지 않는다. 남은 개선은 batch 크기만큼 반복하는 조회를 묶는 것이다. raw에는 window_index가 없으므로 stream_id/chunk_index 또는 chunk_id를 사용해야 한다(`backend/app/models/record.py:78-97`). 기존 manifest/object_key 재사용, 다른 소유자의 ack 거부, batch 내 중복, 경합 시 재조회가 유지되어야 한다. uploaded file_count는 여전히 참가자의 누적 COUNT로 갱신한다(`backend/app/services/eeg_raw_service.py:199-211`).
- **live-metrics: 전체 원천 읽기 유지.** 참가자 집합의 모든 행을 읽어 Python에서 최신값과 평균을 계산한다(`backend/app/services/session_service.py:1046-1085`). 최신은 window_index 최대가 아니라 `(created_at, window_index)` 기준이다. 최신 조회의 LIMIT와 전체 평균 집계를 분리해야 하며, 전체 데이터에 LIMIT를 적용한 뒤 평균을 계산하면 기존 결과가 달라진다. 평균은 비-null relaxation 값의 전체 평균과 소수점 4자리 반올림을 보존해야 한다. 게스트 최신값 조회에는 이미 `.first()`가 있다(`backend/app/services/session_service.py:818-830`).
- **rollup: 범위 제한 미구현.** `compute_rollup`에는 시간/offset 범위 인자가 없고 모든 원천을 읽는다(`backend/app/services/eeg_rollup_service.py:86-104`). 전체 평균은 버킷 평균의 단순 평균이 아니라 원천의 비-null 값으로 계산한다(`backend/app/services/eeg_rollup_service.py:116-135`). 범위 조회를 추가한다면 overall이 “전체 실행”인지 “선택 범위”인지 명시해야 한다. 최신 N행으로 자른 결과를 기존 전체 집계와 동등하다고 판정할 수 없다.

**인덱스는 기존 키 조회를 지원하는 정의가 있으나 P2 적용·성능 유효성은 미확인이다.** feature UNIQUE는 `(session_id, participant_id, play_group_id, window_index)`, raw UNIQUE는 `(session_id, participant_id, stream_id, chunk_index)`다(`backend/app/models/eeg_feature.py:27-30`, `backend/app/models/record.py:79-82`). raw 정의는 마이그레이션에도 있다(`backend/alembic/versions/b3d9e1f04277_sdd_027_eeg_rollup_raw_report.py:77-83`).

feature의 기존 키는 세션/참가자/세그먼트를 지정한 조회에 적합한 구조지만, 세그먼트 필터 없는 window_index 범위·정렬이나 created_at 최신 정렬에 같은 효율을 보장하지 않는다. 스펙의 `(session_id, participant_id, window_index)`는 범위 조회 후보이지 created_at 최신값 조회까지 해결하는 인덱스가 아니다. 최신 조회용 정렬 키를 포함한 인덱스의 필요성과 기존 인덱스 중복 여부는 실제 SQL 실행 계획으로 결정해야 한다. DB에 마이그레이션을 적용하거나 인덱스 카탈로그를 조회하지 않았으므로 정의 존재를 운영 적용 완료로 간주하지 않는다.

**동등성 재검증 최소 사례:** 빈 batch, 전부 신규/전부 중복/혼합, batch 내부 중복, NULL·비NULL play_group_id, 다른 세그먼트의 같은 offset, 비연속·역순 offset, 다른 session/participant/stream의 같은 인덱스, 경계 59/60초, 비-null 0과 null, 지연 도착, 동시 WS/REST 재전송. 저장 개수뿐 아니라 최종 DB 행·현재값·평균·raw object_key/file_count까지 비교해야 한다. 현재 SDD-026 테스트는 세그먼트별 보존·재전송, SDD-027은 기본 롤업·raw 동작을 다루지만 P2 batch 구현의 전후 비교 테스트는 확인되지 않았다(`backend/tests/test_sdd026_live_session_p0.py:474-501`, `backend/tests/test_sdd027_rollup_raw_report.py:70-140,192-242`).

## 규모 확장 잔여 리스크

**부하 측정 전에 닫아야 할 의미·정합 문제**

1. 회차 생성/원본 연결/불변 run_id 계약, 기존 행 backfill, API·snapshot에서의 조회 계약을 확정해야 한다. 종료 시점 기본 발급은 추가되었으나 명시적 새 회차·조회 계약 전체의 충족은 미확인이다.
2. 세그먼트 시간축과 coverage 분모를 확정해야 한다. 현재 resume은 offset을 재시작할 수 있지만 rollup은 play_group_id를 구분하지 않고 `window_index // resolution_sec`만으로 묶는다. 따라서 서로 다른 세그먼트의 0초가 같은 버킷으로 합쳐진다. participant 미지정 시 여러 참가자의 valid_count도 합산하지만 coverage 분모는 resolution_sec 하나이며 1.0으로 자른다(`backend/app/services/eeg_rollup_service.py:62-81,95-109`). 이는 구현식에서 확인되는 의미적 제약이며 부하 테스트로 해결되지 않는다. 현재 동작과의 동등성이 곧 올바른 실행 시간축 집계라는 뜻은 아니다.
3. WS 최신값 갱신만으로 평균 정합을 보장할 수 없다. 서버 이벤트는 저장 입력 feature와 saved 수를 내보내고 누적 합/유효 수·평균은 포함하지 않는다(`backend/app/ws/session_live_namespace.py:213-219,236-254`). 프런트는 해당 행의 현재값을 갱신하지만 기존 avg_efficiency는 그대로 두고 새 행은 null로 둔다(`frontend/src/pages/sessions/SessionLivePage.tsx:77-109`). 이벤트별 전체 이력 재계산은 하지 않으나 `rows.map`으로 참가자 배열은 순회한다. 증분 평균을 도입한다면 서버의 중복 제거·유효 샘플 수·역순 및 재접속 보정 계약이 먼저 필요하다.

**실제 부하 측정으로 결정할 항목**

- 실제 목표 동시 세션·참가자 수, 1Hz feature 수신, raw chunk 크기·주기, 수업 길이·보관 기간을 입력값으로 정한다. 예를 들어 참가자 100명 × 1시간 × 1Hz = 36만 feature 행은 계산 예시이며 처리 가능 용량의 측정값이 아니다.
- PostgreSQL에서 batch 중복 확인, 최신값, 평균, rollup, raw COUNT 각각의 `EXPLAIN (ANALYZE, BUFFERS)`와 반환 행 수, 쿼리 수, p50/p95/p99 지연을 수집한다. 세션 길이에 따른 원천 읽기 비용·정렬·메모리, 대형 IN 조건, 인덱스 추가 시 쓰기 비용도 포함한다.
- 동시 WS/REST 재전송, ACK 유실, 지연 업로드, raw presign/ack 경합에서 처리량·오류율·중복·누락과 DB connection/lock 대기를 측정한다. feature별 SAVEPOINT와 raw 항목별 조회 비용을 포함한다.
- 호스트 수신 fan-out, 재접속 snapshot, 참가자 배열 갱신·React 렌더링의 지연과 메모리를 측정한 뒤 차등 갱신·가상화를 결정한다. 빌드 성공은 브라우저 부하 성능의 증거가 아니다.
- 누적 집계/물화 도입 시 지연 데이터의 버킷 재집계와 원천 대비 재검산을 검증한다. 파티션·보관 만료·S3 삭제·분석 job 대시보드는 보관량과 운영 병목 측정 후 우선순위를 정한다. 현재 수락 기준 통과와 운영 규모 확장 완료를 구분한다.

## 최종 권고안

**현재는 SDD-028 완료 승인 보류. 경량 설계 방향은 유지하되 “새 회차 = 새 Session, run_id 불변”을 명시하고 구현 후 통합 재검증한다.** 반복 수업의 원본 연결이 필요하다는 이유만으로 별도 SessionRun과 모든 FK 이전을 선행할 필요는 없다. 반대로 기존 Session의 run_id 교체만으로 반복 회차가 분리된다고 승인해서도 안 된다.

우선순위는 ① 회차·시간축·조회 범위 계약 확정, ② batch 조회와 해당 SQL에 맞는 인덱스·마이그레이션 구현, ③ 전후 결과 동등성 및 PostgreSQL NULL/동시성 검증, ④ 실제 부하 측정이다. raw의 현황은 “항목별 조회의 batch화”로 정정하고, 전체 평균·전체 rollup을 단순 LIMIT로 축소하지 않는다. 기존 spec/plan/verify는 이번 검토에서 수정하지 않았다.

이번에 실행한 회귀 검증:

- `backend`에서 `./venv/bin/python -m pytest -q`: **293 passed, 1 skipped, 12 warnings**, 30.83초, 종료 코드 0. 경고에는 deprecated API와 `broadcast_notification` coroutine 미await가 포함된다. 전체 통과가 알림 전달 성공까지 입증하지는 않는다.
- `frontend`에서 `npm run build`: **종료 코드 0**, `tsc -b && vite build` 통과. CSS 토큰 import 해석 실패 경고와 500kB 초과 chunk 경고가 있다. 화면 스타일·실브라우저 동작을 검증한 결과는 아니다.
- 백엔드 공통 fixture는 SQLite 인메모리 DB와 fakeredis를 사용하며 `Base.metadata.create_all`로 테이블을 만든다(`backend/tests/conftest.py:111-119`). 따라서 위 결과는 PostgreSQL 마이그레이션·인덱스 실행 계획·운영 동시성·S3 실서비스·실기기 부하 검증을 대체하지 않는다. 이번 검토에서는 해당 외부 환경 검증을 수행하지 않았다.

회귀 실행은 통과했지만 완료 직후 병행 변경이 확인되었다. 기본 run_id와 조회 헬퍼·인덱스 선언의 추가만으로 새 회차 분리·주요 조회 경로 최적화·마이그레이션 적용·결과 동등성을 승인할 수 없다. 병행 변경 완료 후 고정된 코드 기준으로 전체 회귀 및 P2 전용 검증을 다시 실행해야 한다. 본 문서는 최초 기준 검토와 종료 시점에 읽은 일부 변경의 정적 판정까지를 포함하며, 이후 변경은 포함하지 않는다.
