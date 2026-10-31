# SDD-260 — 라이브 데이터 완결성과 40명 현장 운영 설계 (Astra)

작성: 2026-10-31 · 대상 브랜치: `sdd/260-live-ingest-bottleneck` · 상태: 설계 제안, 구현 승인·검증 전.
범위: 이 문서 한 개. 코드·DB·서버 변경, 커밋·푸시·배포 없음. 다른 워커 문서는 읽거나 수정하지 않았다. 이 문서는 Stage ③ verify.md를 대체하지 않는다.

## 1. 결정 요약

- 원시는 **기존 네이티브 journal/ArchiveQueue 및 웹 IndexedDB 큐를 재사용**한다. 새 큐를 병렬로 만들지 않는다. 이미 영속한 원본은 서버 검증·대조 완료 전 버리지 않는다.
- 클래스 종료와 업로드 완료를 분리한다. 로컬 봉인·종료 의도 기록 후 화면을 떠날 수 있고, 앱 전역 복구 작업이 과거 모든 미완료 세션을 찾아 이어 올린다. 네트워크 완료까지 40명을 종료 화면에 붙잡지 않는다.
- feature 저장 ACK는 DB 커밋을 뜻한다. 호스트 실시간 표시는 별도 최신값 투영으로 처리한다. **수신 요청에서 회차 락을 제거하고, DB에 최신 투영 대상을 함께 저장한 뒤 1초 주기 작업이 회차별 묶음으로 기존 outbox에 기록**한다. 기존 revision/seq 계약은 유지한다.
- 11/4 전 uvicorn 다중화는 기본 해법으로 삼지 않는다. 우선 단일 프로세스에서 락·DB 왕복·원시 업로드 몰림을 줄이고 실측한다. 다중화는 전역 휘발 상태와 DB 연결 예산 검증 후에만 선택한다.
- “완결성 100%”의 분모는 수집·영속된 데이터이다. BLE 단절·OS 정지로 수집하지 못한 구간은 복원 불가한 gap으로 드러낸다. 저장 성공률과 수집 커버리지를 따로 제시한다.

## 2. 확인한 사실과 근거

이하 경로는 워크트리 기준. `~/.hermes/share/` 보고서는 전달된 시험의 증거이며 이번 작업에서 재시험한 결과가 아니다.

| 사실 | 근거 및 해석 |
|---|---|
| 2 vCPU 착용30: 18,000창 수락, 600초 계획이 1,090초로 늘어남 | `~/.hermes/share/loadtest-40/report.md:9-14,21-29`; 전량 저장과 실시간 처리량은 다른 판정 |
| 4 vCPU 착용30 20.3창/s, 착용40 18.5창/s | `report-rerun.md:11-22`; 각각 목표30의 68%, 목표40의 46% |
| 착용40 feature DB 23,441/24,000, 38/40명만 600창 | 같은 보고서 `:40-43`; 559창 부족. ACK 23,407과 DB 23,441의 차이34는 타임아웃 창 저장 가능성을 보여 준다. 응답만으로 유실 판정 금지 |
| 회차 락 타임아웃 12건, 프로세스 CPU 110~120%, 서버 전체 약30% | 같은 보고서 `:27-35,69-72`; CPU 증설만으로 해결되지 않음. RDS CPU31%·Celery/Redis 비병목은 브리프 제공 정보이며 이번에 별도 계측하지 않음 |
| 원시 시험 B에 불일치 서술 존재 | 같은 보고서 `:20`은 재시도로 해소라 쓰지만 `:44-50`은 5,328건, 24회429를 재전송하지 않아 gap72개라 명시. 상세 검증을 채택하며 B 원시 완전성은 미통과. S3 HEAD403으로 객체 존재 독립 확인도 미완료(`:52`) |
| 최신값 배치당1회 투영은 이미 구현됨 | `backend/app/services/live_ingest_service.py:244-282`. “배치당1회”만 새로 제안해도 개선이 되지 않음. feature 커밋 후 회차 락과 outbox 커밋이 추가됨 |
| 투영 실패 후 durable ACK 가능 | 같은 파일 `:158-170`; 실패한 outbox가 항상 남는 것이 아니다. 예외 메시지는 다음 수신이 최신값을 갱신한다고 명시. 마지막 창의 영구 미투영을 막을 복구 가능한 작업 표식 필요 |
| 서버·클라이언트 순서 계약 | `backend/app/services/session_live_outbox.py:3-13`은 gap 없는 회차 revision; `frontend/src/lib/session-live/live-state.ts:323-368`은 audience/domain seq +1 및 heartbeat ahead 재동기화. 두 번호를 혼동하면 안 됨 |
| 웹 저장 자산 | `frontend/src/lib/biosignal/durable-queue.ts:25-35,104-112,143-175`: receipt·journal·lease fencing·봉인/인덱스/journal 제거 원자 처리. `frontend/src/hooks/useBiosignalCapture.ts:155-238`은 화면/회차 의존 runtime·pump |
| 기존 종료 대조 API | `backend/app/api/v1/session.py:949-975`: biosignal-events·biosignal-manifest. `biosignal_manifest_service.py:202-265`: expected alias/hash·순번·gap 대조. 새 close API를 중복 생성할 필요 없음 |
| 서버 객체 검증 존재 | `backend/app/services/biosignal_service.py:348-367`, `biosignal_artifact_service.py:343-361`: size/hash 기반 객체 검증. `biosignal_export_adapter.py:102-107`: 내보내기에서도 바이트/해시 검사 |
| 네이티브 저장 자산 | iOS `frontend/ios/MeasurementKit/Sources/MeasurementKit/AppendOnlyJournal.swift:10-15,115-150`: CRC·fsync·손상 격리. Android `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/measurement/AppendOnlyJournal.kt:14-37,57-65`: CRC·fsync·정상 prefix 복구 |
| 네이티브 복구/업로드 한계 | iOS `MeasurementManager.swift:337-367,762-772`: active 복구, 3시간/128MiB veto. Android `runtime/ArchiveWorker.kt:15-18,41-50`: 마지막 runtime.json의 한 session 큐 + 현재 토큰으로 업로드. 전체 계정별 미완료 탐색을 보장하지 않음 |
| 시연 중단의 원인은 아직 확정 아님 | `~/.hermes/share/band-analysis/report.md:13-28,35-38`: 구빌드·JS 정지·BLE 캐시·capture stop 후보. 브리프의 19:20 이후 재개 없음은 사건 관찰이며 특정 OS 원인 확정으로 쓰지 않음 |

## 3. 트랙 1 — 로컬 사본부터 서버 완료까지

### 3.1 저장소 선택과 용량

**앱:** iOS Application Support 내부 파일, Android filesDir 내부 파일의 기존 append-only journal/ArchiveQueue 사용. cache/tmp에 유일 사본을 놓지 않는다. iOS 호출부의 실제 디렉터리·백업 제외·잠금 시 파일 보호 설정, Android 백업 제외와 암호화 설정은 구현 전 점검 대상이다. SQLite 신규 도입은 이 기한에 불필요하다. 원자 메타 파일과 기존 journal로 복구 경계를 명시한다.

**웹:** 기존 IndexedDB를 유지한다. 네이티브와 동시에 같은 BLE 원본을 수집하지 않으며 기존 ownership으로 한 수집자만 둔다. IndexedDB 영속 권한·잔여 용량을 확인하더라도 사용자 데이터 삭제까지 견디는 보장은 하지 않는다. native 미지원 기기는 웹 저장 보장 수준을 따로 표시한다.

일반 캐시 청소와 앱 데이터 삭제를 구분한다. 앱 제거·사용자의 데이터 초기화·기기 분실에는 로컬 사본만으로 생존할 수 없다. Android 내부 파일과 캐시의 차이는 [공식 저장소 문서](https://developer.android.com/training/data-storage/app-specific)를 따른다. iOS background URLSession도 사용자가 강제종료하면 전송이 취소되고 자동 재실행되지 않는다([Apple 문서](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:))). 따라서 “무조건 재개”는 **인증·네트워크·OS 실행 기회가 돌아오면 화면 선택과 무관하게 자동 재시도**라는 계약이다. OS 강제종료 중의 상시 실행을 약속하지 않는다.

60분·1인 크기는 다음 **계산 추정**이며 실측값이 아니다. EEG250Hz/PPG50Hz는 `frontend/src/lib/biosignal/raw-encoder.ts:83-84`; 행 크기는 `backend/app/services/biosignal_decoder.py:119-121`에서 EEG17B·PPG8B·ACC18B. ACC25Hz는 용량 계산용 가정으로, 실제 프로파일 확인 필요.

| 항목 | 식 | 60분 |
|---|---|---:|
| 정규화 행 | (250×17 + 50×8 + 25×18)×3600 | 18.36 MB |
| BLE 원문·packet map·journal 헤더·feature | 패킷 크기/빈도·JSON 길이 측정 전 | 미확정 |
| 실무 용량 예산(제안) | 원문·봉인본·journal 일시 중복과 복구 여유 포함 | 1인 256MiB 예약, 기기 가용1GiB 시작 기준 |

압축률을 미리 차감하지 않는다. 40명이 각50MB를 올리면 합계2GB: 현장 유효 상향10Mbps일 때 이론상 약27분, 20Mbps 약13분이며 영상/재시도 경쟁 전 하한이다. 이 50MB 역시 예시이다. 11/1 실밴드10분 파일 증가량×6과 봉인 순간 peak를 재서 예약량을 갱신한다. 128MiB 복구 제한에 걸리는 실측 파일은 메모리 일괄 읽기 대신 스트리밍 스캔으로 처리해야 하며 제한 숫자만 올리지 않는다.

### 3.2 쓰기·봉인·복구 계약

1. 수신 패킷에 원래 tick/monotonic·신호·장치 별칭·stream/segment/sequence를 붙여 journal append. durable commit 이후에만 “로컬 보관됨” 카운터를 올린다. 네이티브 fsync 방식을 우선 유지하고 성능 측정 없이 느슨하게 만들지 않는다.
2. 마지막 정상 CRC 레코드까지 복구. 찢긴 tail은 미영속 범위로 별도 gap 기록; 중간 손상은 원본 suffix를 격리 보관한다. Android도 iOS와 같은 손상 보존을 추가하고 단순 절단으로 증거를 잃지 않게 한다.
3. 기존 raw 청크 형식을 유지해 10초 단위 봉인, 파일/DB 커밋 후 alias·SHA256·bytes·sequence 범위 등록. **네트워크는 30~60초 묶음 요청**으로 줄이되 feature/상태 전송 주기는 늘리지 않는다. 기본 청크 크기는 그대로라 큰 multipart 구현이 필요 없다.
4. 네이티브 temp→동기화→원자 rename→큐 인덱스 확정 순서. crash 시 temp/인덱스/완결 파일을 대조해 orphan 봉인본 재등록. journal GC는 같은 바이트를 복구 가능한 봉인본이 확정된 다음만 허용한다.
5. receipt 영속 후 payload GC 가능하되 수신 요약 API에서 checksum 검증한 객체만 receipt로 인정. 종료 대조에 필요한 alias/hash/크기/범위 메타는 남긴다. 로컬 오류·quota 발생 시 수집 중단을 명시하고 이전 파일은 덮어쓰지 않는다.

### 3.3 서버 대조: 기존 API 확장

기존 presign→PUT→ack 및 `biosignal-events` close intent·`biosignal-manifest`를 정본으로 유지한다. EEG legacy는 기존 API로 읽고 새 원시 수집은 biosignal 경로를 사용한다. legacy 저장 완료를 새 v2 manifest의 완전성으로 자동 간주하지 않는다.

제안: `GET /sessions/{sid}/biosignal-receipts`를 기존 manifest 서비스에 추가하거나 manifest의 선택적 summary 필드로 제공한다. 별도 원장을 만들지 않는다.

- 인증에서 participant를 결정한다. 호스트 조회는 권한 범위를 확인한다. 클라가 보낸 account/participant만으로 타인 데이터에 접근하지 못한다.
- `manifest_revision`, `close_state`, `verification_state`, `next_cursor`; 그룹 키는 **participant + stream + segment + signal/kind**. sequence는 segment마다 다시 시작하므로 stream 최대값 하나로 비교하지 않는다.
- 그룹별 `verified_count`, `verified_bytes`, `max_sequence`, `contiguous_through`, `missing_ranges`, `pending_count`, `conflict_count`, `time_review_count`, `manifest_hash`.
- 페이지별 receipt `(alias, sequence/range, size_bytes, sha256, verified_at)` 제공. hash는 고정 정렬·정규 직렬화한 전체 튜플의 SHA256. max/count/총bytes가 같아도 서로 다른 청크일 수 있으므로 hash/identity 집합 일치를 최종 판정한다.
- revision 고정 페이지 조회: 중간 ACK가 오면 새 revision으로 재대조. 한 페이지 응답을 전체 집합으로 오인하지 않는다. 최대100~500건 제안, payload/사전서명 URL은 요약에 포함하지 않음.
- 기존 ACK 검증을 재사용하고 매 요약 요청마다 S3 전체 HEAD하지 않는다. 다만 현재403 이슈는 실제 앱 서버 권한으로 검증 경로가 성공하는지 먼저 해결해야 한다. 검증 불명은 `verification_pending`, uploaded 문자열만으로 완료하지 않는다.

**종료 상태 기계:** `recording → sealed_local → reconciling → uploading → verified_complete` 또는 `blocked_auth / blocked_integrity / partial_gap / time_review`. 기존 close_state를 유지하면서 UI 표시를 매핑한다. `partial`을 완전 업로드로 번역하지 않는다.

- 종료 직후 수집 중단·미봉인 패킷 저장·feature flush·close intent 영속. 실패하면 “기기 저장 확인 필요”, 성공하면 “수업 종료 · 데이터 업로드 중 N건”. 종료 UI의 진행 여부와 자료 완전성은 별개다.
- close intent 예상 집합과 서버 receipt 집합 대조 → missing만 재전송 → ack → 다시 대조. ACK 유실은 서버 요약 확인으로 해소; 같은 identity/hash 재전송은 멱등, 다른 hash는409 보존·조사.
- 완료 정의: 모든 로컬 영속 원본의 봉인 매핑, expected alias/bytes/hash 일치, 연속 sequence 또는 명시된 수집 gap, feature/indices/gap 이벤트·close intent 수신, pending/conflict/time_review 없음. 전송완료와 gap 없는 수집완료를 별도 필드로 남긴다.
- 작은 청크 PUT 중단은 같은 전체 바이트 재PUT. 미완료 원격 객체를 완료 처리하지 않는다. 대형 객체 multipart는 후속이며 기존 분할 복구를 우선 재사용한다.
- 기존 `biosignal_manifest_service.py:210-213`은 abandoned를 partial로 종료할 수 있다. 서버 sweep의 종료가 “기기에 사본 없음”을 증명하지 않으므로 자동 로컬 삭제 근거로 사용하지 않는다.

### 3.4 화면과 무관한 재개·격리·보관

앱 전역 `ArchiveRecoveryCoordinator` 역할을 기존 업로더 위에 둔다(논리 역할명, 새 독립 큐 아님). 앱 시작·인증 복구·네트워크 online·foreground·다른 화면 진입에서 단일 실행한다. UI hook mount에 의존하지 않는다. Android WorkManager의 마지막 cfg 한 개 대신 **모든 미완료 scope 인덱스**를 탐색한다. iOS 기존 background URLSession(`ArchiveUploader.swift:182-202`)과 연결하고 시스템 task ID↔alias 매핑을 재연결한다.

- scope = API환경 + 안정적 account 식별자 + participant + session + device 설치 식별자. 서버 stream/generation은 자료 원본에 유지. 게스트 자격은 해당 participant에 한정한 보안 저장소 handle로 참조한다.
- 재로그인한 동일 principal만 해당 큐를 재개한다. 계정 전환 시 기존 요청을 취소/분리하고 늦게 온 응답이 새 계정 상태에 반영되지 않게 scope generation을 확인한다. 원시 payload·토큰을 로그에 기록하지 않는다.
- 다른 기기는 서버 receipt만 확인 가능하며 이전 기기 로컬 원본을 갖고 있지 않다. 이전 기기의 복귀가 필요함을 표시한다. 오래된 archive 업로드는 새 live capture 소유권을 탈취하지 않는다.
- `recoveryMaxAgeSeconds=3h`, `recoveryMaxJournalBytes=128MiB`는 **활성 측정 자동 재개 안전 제한**과 **과거 업로드 복구**를 분리한다. 3시간 지난 데이터도 업로드 탐색 대상이다. 서버 close deadline24h(`biosignal_orphan_sweep.py:29-34`) 이후에는 권한 있는 사후 archive/time_review 접수로 보내며 live에 재주입하지 않는다. 이는 **신규 서버 계약**이다. 현재 `biosignal_service.py:100-101`은 pending_time_review를409로 거절하므로 기존 API만으로 해결되지 않는다. BE1이 deadline 초과 원본을 검역 상태로 받는 접수 계약(원래 principal/stream·동의 상태 검증, 자동 live 반영 금지, 승인/거절 감사 기록, 대조 상태 분리)을 B 단계에서 추가해야 한다. 명시적 권한 철회 자료를 허용하는 우회로로 만들지 않는다. deadline을 클라에서 우회하지 않는다.
- 429/5xx/네트워크 오류는 재시도8회 후 영구 dead_letter로 보내지 않는다. 횟수는 관찰값으로 남기고 다음 실행 기회에 재개한다.401은 인증 대기,403은 사유별 권한 회복 대기/정책 차단,409·해시 훼손은 격리 보관. 명시적 권한 철회는 자동 우회하지 않는다.
- 보관 제안: verified 완료 payload는 receipt 확인 후24시간 유예, receipt/manifest는7일. 미완료 payload는7일 경고·수동 해결 대상으로 보존하고 기한만으로 자동 삭제하지 않는다. 기존 서버 raw90일 분류(`biosignal_manifest_service.py:359`)를 임의 변경하지 않는다. 동의철회·법정 삭제와 충돌 시 서비스 정책 승인으로 별도 처리한다. 이번 작업에서 삭제는 수행하지 않는다.

### 3.5 혼잡·전력·리포트

- 기기별 원시 PUT 동시성 기본1(유휴 시 최대2), presign/ack 배치 최대24개 기존 구조 재사용. 업로드 시작 jitter0~30초, 종료 시0~60초. retry full jitter `0..min(60s,1s×2^attempt)` + 서버 Retry-After 최솟값. 재접속 시 같은 시각에 몰리지 않게 persistent nextAttempt 저장.
- 서버 `_archive_slots`는 프로세스 로컬 semaphore(`backend/app/api/deps.py:102`), 현재6슬롯. 무작정40으로 올리지 않는다. 요청 admission은 짧게 끝내고 재시도 가능429를 돌려준다. 실시간·명령 DB 예산을 예약하고 archive 검증 병렬 수는 별도 제한한다. 다중 worker에서는 총슬롯이 배수로 늘어나는 문제를 Redis lease/전역 예산으로 먼저 해결한다.
- Wi-Fi에서 지속 drain, 영상·음성 활성 중에는 원시 업로드 속도 제한을 낮춘다. 기본 셀룰러는 대기 표시 + 사용자 허용 시 전송, feature/상태는 계속 전송. 배터리 낮음·발열은 원시 전송 빈도만 늦추고 로컬 미완료를 삭제하지 않는다. 정책 때문에 대기하는 경우 이를 숨기지 않는다.
- 리포트: 상담 요약은 먼저 생성 가능. EEG 관련 확정 리포트는 feature archive/원시·gap 대조를 확인한 버전에 고정한다. 대기 중에는 “데이터 확인 중”; 불가역 gap이 있으면 수집 범위·누락을 명시한 부분 리포트. 새 자료가 들어오면 revision을 올려 재생성하며 점수 환원/종합점수는 만들지 않는다.

## 4. 트랙 2 — 실시간 서버 운영

### 4.1 대안과 선택

| 대안 | 이점 | 위험 | 결정 |
|---|---|---|---|
| 배치당1회 `_project_latest` | 간단 | 이미 구현, 정상1Hz에서는 회차 락 초당30~40회 그대로 | 단독 해법 제외 |
| participant/domain 락으로 바꾸고 기존 append_outbox 호출 | 경쟁 감소처럼 보임 | 공통 revision 할당·Redis watermark와 충돌. DB sequence도 rollback/commit 역전 gap 가능 | 제외 |
| Redis 최신값 직행, DB는 나중 | 빠름 | Redis 소실·마지막값 복구·현재 snapshot/seq 소비자 변경이 큼 | 후속 프로토콜로만 검토 |
| feature + DB 최신 투영 대상 원자 저장, 주기 묶음 outbox | 요청 회차 락 제거, 기존 소비자 계약 유지, crash 복구 가능 | 새 테이블/작업·최대1주기 지연 | **기한 내 목표안** |

metrics라는 도메인 자체는 모든 중간 화면 이벤트의 gap 없는 글로벌 revision을 필요로 하지 않는다. 그러나 **현재 구현은 필요**하다. 클라 최신값 적용은 entity_version/stream sequence로 오래된 값을 거른다(`live-state.ts:293-299`), 그 앞단에 도메인 seq 연속성 검사(`:339-345`)가 있다. 서버 projector도 revision+1을 요구한다. 이번에는 이벤트를 만들기 **전** 최신값으로 합치고, 만들어진 이벤트는 기존 연속 계약으로 전달한다.

### 4.2 저장·투영 트랜잭션 설계

제안 테이블 `live_metric_projection_pending`: PK(session, participant), generation, sequence, entity_version, payload, updated_at. 파일 소유권상 BE 담당1명이 migration을 소유한다. feature 정본은 기존 eeg_feature_windows이고 pending은 재생 가능한 최신 상태 원장이다.

1. 요청당 participant/stream 조회와 existing feature 키 조회를 배치화한다. `evaluate_ingest`의 cutoff·동의·generation·lease 규칙은 제거하지 않는다. 동일stream 시간창 판정 중 불변 조회는 공유한다. 변경 가능한 fencing/동의는 stream·participant 행 잠금 또는 권한버전 조건부 쓰기로 커밋까지 보호한다. 명령도 같은 보호 규약을 써야 하며 단순 재조회만으로 동시 takeover를 막았다고 보지 않는다. 명령/투영의 잠금 순서는 epoch→participant/stream→pending, ingest는 participant/stream→pending으로 고정하고 ingest에서 epoch로 역진입하지 않는다. 기존 명령의 잠금 순서와 맞지 않으면 먼저 계약을 정리한다.
2. feature batch INSERT + pending 최신 entity_version 조건부 UPSERT를 **같은 트랜잭션**에 넣는다. `_persist_feature_items` 현재 내부 commit(`live_ingest_service.py:246-247`)을 전 호출자에서 없애지 말고 live 전용 no-commit 옵션/내부 저장 helper로 분리, 기존 호출자는 기본 동작 유지한다. 커밋 후에만 accepted durable=true. 기존 명령의 participant/stream 행 락(`session_live_commands.py:278,307-310`)과 맞춰 동시 takeover 검증을 수행한다.
3. unique 충돌은 같은 hash인지 다시 읽어 확인한다. 현재 `_store_windows:259-260`의 경합 후 무조건 duplicate 판정 경로도 검증 대상으로 삼는다. 다른 hash이면 feature_hash_conflict이며 첫 저장을 보존한다. rejected·stale_owner_generation을 accepted로 바꾸지 않는다.
4. 1초 주기 단일 drain이 회차 epoch 락을 먼저 얻고, 해당 회차 pending을 bounded batch(최대40 참가자 시작값)로 읽는다. 명령과 같은 lock 순서를 고정하고, pending을 먼저 잡고 epoch를 기다리는 역순은 금지한다.
5. 최신 stream generation·권한·terminal/cutoff를 다시 확인해 허용된 최신값만 기존 outbox로 기록. 묶음 내 이벤트마다 기존 revision을 증가시키되 epoch 락 획득/커밋은 회차당1회. live 대상이 아닌 과거 창은 feature 정본에만 남긴다.
6. outbox 커밋과 해당 pending 버전 소비를 원자화한다. 더 새 버전은 지우지 않는다(조건부 delete/update). 실제 Redis/소켓 방송은 epoch 락을 해제한 다음 기존 projector로 실행한다. crash 전후 pending 또는 outbox 중 적어도 하나가 남는다.
7. DB 오류는 배치 rollback+retryable; Redis 오류는 저장 ACK를 되돌리지 않으며 outbox가 남아 복구된다. pending age·outbox oldest age를 모니터링한다. 작업 재시작 시 pending 자동 스캔, 마지막 창 이후 새 수신이 없어도 투영한다.

커밋 목표는 요청당 feature+pending **1회**, 투영은 회차당 초당1회이다. 이벤트 행 자체는 최대40/s라 방송 비용은 남는다. 이 설계만으로40Hz 보장을 주장하지 않고 §6 실측으로 판정한다. lock 보유 목표 P95<50ms·최대200ms는 초기 합격 기준 제안이며 초과 시 배치 크기/조회 비용을 줄인다.

### 4.3 실행 자원·다중 worker

- `asyncio.to_thread`로 DB 작업이 실행되는 v2 경로는 `backend/app/ws/session_live_namespace.py:2249,2308,2331`; 기본 executor 실크기는 이번에 계측하지 않았다. 먼저 executor 대기·실행 시간, event loop lag, SQL/commit/lock wait를 분리 계측한다.
- 구현 제안: live ingest 전용 bounded executor4, control/join/renew 전용4, archive 동시 검증2~4부터 dev에서 측정한다. 숫자는 튜닝 시작값이다. 무제한 to_thread 큐 대신 admission semaphore를 두고 포화 시 retry_after를 반환한다. REST의 AnyIO thread pool은 별개이므로 함께 제한·측정한다.
- DB pool은 전체 프로세스×(pool_size+overflow)+Celery/운영 예약 합으로 계산한다. 전달 보고의 RDS max79를 기준으로 web 합계40 이하·운영/기타20 이상 여유를 시작 예산으로 두되 실접속 한도를 DEPLOY에서 다시 확인한다. 스레드만 늘려 커넥션 고갈을 만들지 않는다.
- `AsyncRedisManager` 존재(`backend/app/ws/__init__.py:57-75`)만으로 다중화 안전하지 않다. namespace의 `_active_signals`, aggregate throttle 등 단일 worker 전제(`session_live_namespace.py:45-51,83,156`)와 heartbeat/drain 중복, socket polling sticky session, Redis 공유 room/epoch를 검증해야 한다.
- 기본 배포안: uvicorn1 유지 + 위 구조 개선. 11/2 40Hz 미달 시 다중화는 별도 변경 묶음으로 두고 전역 상태 이전/분산 리더·sticky 또는 WebSocket-only 검증 후2 workers 시험. 기존 프로세스 재시작 중 ACK 유실도 재전송 테스트. 단순 `--workers 4`는 금지한다.

### 4.4 영상·음성·상태의 영향

- feature/device는 같은 ingest 서비스다. `live_ingest_service.py:310,321-329`의 device 경로는 직접 epoch 락을 잡고 outbox/commit하며, 명령 처리 `session_live_commands.py:158`도 같은 회차 락을 공유한다(코드 확인). metrics를 분리해도 device/command의 순서·권한 계약은 유지한다.
- LiveKit 토큰은 `backend/app/api/v1/session.py:572-583,1010-1031`, `session_service.py:2343-2412` 경로다. 미디어 패킷과 API 토큰 발급을 구분한다. 토큰/입장권한 발급은 같은 API 프로세스·DB 자원을 경쟁하므로 우선순위 control 예산에 둔다. 미디어 자체의 대역폭/LiveKit 서버 성능은 별도 지표이다.
- 녹화 start/stop은 `backend/app/api/v1/video.py:26-60`의 video_service 경로다. 해당 라우트만으로 epoch 락 공유를 단정할 수 없다. 실제 음성 recorder/LiveKit 녹음 egress의 전체 연결은 미확인이다. 구현 전 실제 현장 녹음 경로를 확정하고 start/stop ACK·최종 파일·재생 가능 여부를 검증한다.
- 방송/음성/영상 켠 상태에서 토큰 갱신·device·capture.renew·session.end를 시험한다. metric 처리량만 높은 상태로 통과시키지 않는다.

### 4.5 feature 재전송과 복귀

웹 `MetricOutbox`는300창 메모리 큐,60창 배치이며 초과 시 오래된 창을 버린다(`frontend/src/lib/measurement-web/metric-outbox.ts:7-14,47-54`). retryable은 유지, stream fatal은 제거한다(`:16-19,86-96`). 이것을 raw/feature 완전 저장으로 오인하지 않는다.

- 모든 feature 원본은 전송 전에 기존 feature journal/archive에 영속되어야 한다. live 큐는300을 유지하되 overflow를 gap/진단으로 기록하고 archive 재생으로 빠진 저장분을 채운다. archive 객체 uploaded와 eeg_feature_windows 채워짐은 다른 증거다. feature archive를 읽어 기존 멱등키로 historical 저장하는 복구 경로가 없으면 추가하고, 종료/구generation 자료는 별도 승인된 historical 판정으로 처리해 live fencing을 우회하지 않는다.
- accepted 또는 duplicate **durable:true + 동일 hash**만 live ACK 완료. 응답 타임아웃은 같은 stream/sequence/hash 재전송. not_ready는 재join→snapshot READY→capture 소유권 확인 이후 backoff 재전송하며 sequence를 재번호화하지 않는다.
- 이미 서버가 발급한 stream/generation을 임의 변경하지 않는다. 새 소유자가 생겼으면 과거 live 큐를 새 generation으로 포장하지 않고 historical archive로 보관한다. 동의철회·시간검토 오류는 재시도 성공으로 덮지 않는다.
- 서버 과부하에서 raw PUT부터 늦추고 control·feature를 우선한다. feature queue 증가율·가장 오래된 나이·durable backlog를 화면/관찰에 노출한다.

| 정지 지점 | 해결 계약 | 판정 |
|---|---|---|
| WebView/JS 정지로 socket 재연결도 중단 | native 측정 경로 우선, foreground/appStateChange/visibilitychange/online에 복구 coordinator 호출. 시작 중복 single-flight | 복귀 후 READY·renew·새 feature ACK 확인 |
| BLE 캐시 없음/권한 상실 | 기존 native device 식별/ownership 재사용. 자동 재연결 가능 기기는 연결, OS 선택창이 필요한 웹은 명시적 재선택 안내 | 실제 패킷 증가 확인; 연결 표시만으로 성공 아님 |
| capture stop(memory/journal/lease) | 원인별 복구: lease 재획득, quota 해소·journal 검증 후 새 segment. 영구 오류는 보존/표시 | 중복 owner0·gap 기록·journal 증가 확인 |
| 복귀 시 capture 재개 트리거 없음 | 서버 세션 진행·동의·본인 자격 확인→소켓 READY→BLE/ownership→capture start/복구. 이미 종료된 회차는 archive만 재개 | 종료 후 잘못된 재측정0, 구창 live 역전0 |

네이티브 `recoverOnLaunch`가 있으므로 “앱 전체에 재개가 전혀 없다”고 쓰지 않는다. 웹 후보 분석과 현장 앱이 실제 선택한 native/web 모드를 기기별 확인해야 한다.

## 5. 구현 단위·일정·롤백

본 문서는 실행 지시가 아닌 승인용 계획이다. SDD spec/plan/verify 승인 후 진행하고 DEPLOY 창구 외 서버 설정 변경은 하지 않는다.

| 날짜/단위 | 범위·담당 역할 | 통과 기준 | 즉시 롤백/보존 |
|---|---|---|---|
| 10/31 A | 감독: 증거·verify 확정, 현장 앱 모드/버전 목록 | 두 트랙·실기기·40Hz 분모 및 실패 기준 합의 | 문서만, 코드 영향 없음 |
| 11/1 B | BE1: receipt 요약·대조, FE/native1: 기존 큐 전역 탐색·scope 격리 | 강제종료 후 다른 화면/재로그인에서 과거2세션 복구, 타인 업로드0 | 새 drain flag off, 파일/DB 보존, 기존 단일세션 업로드로 수동 복구 |
| 11/1 C | BE1: feature+pending 원자화, 회차별 묶음 projector | ACK전 crash·ACK유실·투영전후 crash·hash 경합 통과 | 신규 writer 중단→pending drain/내보내기 확인→구 projection flag. 단순 flag off로 pending 방치 금지 |
| 11/2 D | FE/native1: 복귀·transient 재시도; BE1: historical feature 접수·보충 | 화면잠금/BLE OFF/ON/6분 단절·종료회차 복구 통과 | native/web ownership 동시가동 금지, 검증된 모드로 다음 측정부터 복귀. 기존 journal 포맷 유지 |
| 11/2 E | DEPLOY: dev 반영·단일worker30/40 재시험, control/archive 자원 조정 | §6 모두 충족 | 직전 binary/config로 복귀, additive schema 유지·데이터 삭제 금지 |
| 11/3 F | 독립 QA: 실제 앱·밴드·현장망 60분/동시 종료·리포트 | 완전성100%+실시간 기준+앱 버전 고정 | 실패면 검증된 착용 인원 제한/비측정 서비스로 사업 결정. 실패한40명 구성을 현장에 적용하지 않음 |

파일 담당은 BE1=`live_ingest_service`·feature 저장 helper·pending 모델/migration·manifest/API·서버 tests; FE/native1=`biosignal`·전역 recovery·MeasurementKit/Android measurement·복귀 hook·앱 tests; DEPLOY=실행설정·승인된 dev 배포; QA=독립 fixture·검증 결과. 공유 파일 변경은 순차 처리한다. 구현자와 검증자를 분리한다.

필수 범위는 B~F이다. 후속으로 미룰 것은 Redis 직접 최신값 프로토콜, 일반적 다중worker 전환, 대형 multipart, 임의 기기 간 원본 이전이다. **원시100%·자동재개·실시간40명 검증 자체를 일정 때문에 후속으로 넘긴 뒤 완료라 하지 않는다.** 앱 빌드/현장 설치 시간이 부족하면11/3 go/no-go에서 기능 또는 착용 인원을 줄이는 결정이 필요하다.

## 6. 검증 계획과 합격선

### 6.1 로컬/통합 선행

- 실제 PostgreSQL 동시성: 같은 identity 동일hash 20회→행1개, 다른hash 동시입력→명확한 conflict와 기존 보존. stale generation·cutoff·동의철회·무효 EEG(null 유지) 검사.
- 저장/투영 각 crash 경계에서 DB durable ACK와 pending/outbox 복구를 확인. Redis flush/restart→epoch 재동기화·최신값 복원, consumer seq_gap 재동기화 반복 폭주 없음.
- journal 쓰기 중 종료, seal rename 직전/직후, PUT성공 ACK유실, receipt 저장 직전 종료,409·429·5xx·401·디스크 가득 참·CRC 손상. 정상 prefix100%와 손상 격리 증거 확인.
- historical feature 접수는 원래 principal/stream·generation·측정 당시 동의·cutoff/시각 증거를 검증하고, 판단 불명은 격리한다. 재전송 hash 충돌·중복을 검사하며 live 최신값/소유권은 바꾸지 않는다. DB 보충 후 리포트 revision 갱신을 검증한다. BE1은 접수·저장을, FE/native1은 자료 재전송·진행표시를 소유한다.
- 회차A 잔여 업로드 중 B측정, 계정A→B→A, 다른 기기 새 generation, endpoint dev/prod 전환. 다른 principal/환경 payload 전송0.
- 기존 `fix-notes/class-upload-queue/summary.md`의 앱 CORS/후종료403/전체payload getAll 메모리 회귀를 재확인한다. focused 테스트 성공과 기존 전체suite 실패는 분리 보고한다.

### 6.2 dev 부하 재시험

원래 시험은 응답을 기다리느라600초가885/1265초로 늘었다. 새 시험은 **생산 시계1Hz를 ACK와 분리**하고 실제 앱/MetricOutbox를 사용한다. 부하 생성기만 쓰는 시험과 실제 앱 시험 결과를 나눈다. 착용30은 호스트 포함40연결, 착용40은 호스트가 별도이면41연결임을 명시한다.

| 지표 | 제안 합격 기준 |
|---|---|
| 지속 처리량 | 10분·60분 각각 착용30≥30창/s, 착용40≥40창/s. steady-state backlog 기울기≤0. 종료 후 긴 drain을 처리량으로 합산하지 않음 |
| feature 영속 | 생산된 유효·무효 창 모두 30×600 또는40×600 identity와 대조100%. ACK유실 포함 DB/hash로 검증. 중복 물리행0·conflict 누락0 |
| 원시 | 기기별 영속 manifest expected alias/bytes/hash와 실제 서버 검증100%. S3 size/hash 검증 및 decoder 재생을 별도 수행. uploaded DB 상태만으로 합격 금지 |
| 실시간 지연 | 정상망 feature durable ACK P95≤1s/P99≤2s, 호스트 관측→실제 렌더 P95≤2s/P99≤3s. 초단위 갱신과 desktop5분 막대/mobile현재값 유지 |
| 명령/미디어 | renew timeout0·epoch lock timeout0, presence/device/command P95≤1s, 토큰/start/stop P95≤2s(외부서비스 시간 별도). 오디오 끊김·영상 정지·최종 녹음 재생 확인 |
| 복구 |6분 오프라인(300 초과) 후 live 정상화, archive/historical로 영속창100%복구. fault 중 BLE 미수집 구간은 gap과 시각/이유로 대조하고 가짜 보간0 |
| 종료 몰림 |40기기 동시종료·약한Wi-Fi·연결복구에서 미완료0 또는 명시적 auth/time_review/물리gap만 남음. 예상 바이트/가용 업링크 기반 drain 시간+20% 목표, 무한 대기 이유 은폐0 |
| 자원 | executor 대기 P95<100ms, event loop lag P95<50ms, DB연결 예산 준수, RSS 지속증가 없음. 한계값 초과 시 원인 확인 전 통과 금지 |

서버에서 창수·identity 중복·연속 구간·해시를 독립 검증 스크립트로 집계하고, 클라 manifest와 비교한다. 단순 count만으로 일치 판정하지 않는다. 영상·음성·상태 동시 부하를 반드시 포함한다. 테스트 데이터 삭제는 대상 목록을 제시하고 별도 승인받는다.

### 6.3 실밴드·앱 시험

iOS/Android 각각 실제 배포 후보 빌드1대 이상으로 ①60분 측정 ②잠금3분 ③백그라운드3분 ④BLE OFF/ON ⑤비행기모드6분 ⑥프로세스 강제종료 후 다른 화면으로 재실행 ⑦24시간 넘긴 미완료 archive ⑧저용량을 수행한다. 가능하면 실제40폰·현장Wi-Fi 리허설; 확보하지 못하면 서버 합성40명 검증과 실기기 소수검증을 명확히 나눠 잔여 현장 위험을 사업 결정에 올린다.

시작/복귀마다 앱 버전·측정 backend(native/web)·socket READY·BLE패킷수·journal durable seq·feature ACK·서버 count·호스트 렌더를 같은 시간축으로 수집한다. 인증값·개인정보는 기록하지 않는다. 앱 강제종료 중 측정 지속은 합격 조건이 아니며, 재실행 후 이미 영속된 데이터 복구와 미수집 gap 표기가 조건이다.

### 6.4 배포 순서

additive schema/API→호환 서버→앱 전역복구/재시도→feature pending writer/주기 투영 flag 순서로 dev에 적용한다. 각 단계 smoke 후 다음 단계. schema 생성과 실제 활성화는 분리한다. DEPLOY에 직전 버전·플래그·pending drain 절차·시험 시간·관찰 대시보드를 전달한다. develop 푸시/배포 및 운영 반영은 이 문서 승인과 별개의 명시적 승인 대상이다. 이번에는 어떤 배포도 실행하지 않았다.

## 7. 결정이 필요한 비즈니스 사항 (최대5개)

1. 11/3 40명 합격선 미달 시 검증된 착용 인원만 허용할지, EEG 없이 상담·명상을 진행할지 현장 책임자가 결정해야 한다.
2. 셀룰러 원시 업로드 기본 대기를 허용할지, 현장 참가자 동의 하에 즉시 전송할지 결정한다(데이터 비용·종료 후 대기 시간).
3. 미완료 로컬 원본 보관 제안(7일 경고·자동 삭제 없음), 완료24시간 유예/메타7일을 기존 동의·보관 정책에 맞게 확정한다.
4. 복구 불가 gap이 있는 부분 리포트를 현장에서 제공할지, 데이터 확인 후 제공할지 결정한다. 누락을 숨기거나 종합점수로 환원하지 않는다.
5. 앱 후보 빌드 설치·40폰 리허설 담당과 시간을 확보하고, 실제40폰 확보 불가 시 소수기기 검증의 잔여 위험을 수용할지 결정한다.

독립 문서 검토에서 지적된 fencing 동시성,24시간 이후 신규 접수 계약,device 공유 락,BE/FE 복구 담당 구분을 반영했다. 이는 설계 검토이며 동작 시험은 아니다.

## 8. 확인하지 못한 것

- 운영 서버/DB·dev 서버 접속, 실제 load test·앱 실행·밴드 실험은 수행하지 않았다. 보고서 수치를 현재 서비스의 보장으로 해석할 수 없다.
- 현장 기종·OS·앱 버전·native 기능플래그, 실제 업링크·셀룰러·배터리 정책, BLE 패킷별 오버헤드와60분 실제 용량은 미확인이다.
- iOS root 디렉터리 보호/백업 설정 및 전체 계정 credential 연결, Android 손상 tail 처리 나머지 구현, 두 플랫폼의 모든 feature archive→DB 재생 경로는 정독을 완료하지 않았다. scope 격리/역사창 보충은 구현 전 최우선 검증 대상이다.
- 실제 음성 녹음 start/stop·LiveKit egress 전체 연결 및 epoch 락 전이, 모든 v1/v2 휘발 상태·다중worker 안전성은 미확인이다. 다중화는 승인안에 포함하지 않았다.
- S3 HEAD403의 실제 원인, 객체 검증 권한, 보고서의 RDS/Redis/Celery 상세 원자료, not_ready559건의 각각의 직접 원인은 미확인이다.
- 제안 executor/배치/지연/용량 값은 튜닝·승인 기준이며 측정된 성능이 아니다. 문서 작성은 구현·기기검증·현장준비 완료를 뜻하지 않는다.
