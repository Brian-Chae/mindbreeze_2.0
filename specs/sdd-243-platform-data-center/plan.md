# SDD-243 — 플랫폼·기관 관리자 데이터 센터 구현 계획

> 후속 구현 워커: 별도 구현 승인 후 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 아래 Task의 RED → 구현 → GREEN → 독립 리뷰를 수행한다. 이번 요청은 Stage ② Plan + ③ Verify 작성·커밋·작업 브랜치 push까지만이며 구현 승인이 아니다.

- 작성: 2026-10-24. Spec 기준 `9a5a098c`, 브랜치 `sdd/243-platform-data-center`.
- 시작 시 `git fetch && git merge origin/develop` 완료, 충돌 없음. 동기화 커밋 `fb7cfb04`. 동기화로 유입된 제품 변경과 이번 문서 변경은 구분한다.
- **목표:** 플랫폼·기관 관리자가 허용된 회차 데이터를 탐색하고 원파형·feature·당시 표시값을 확인한 뒤, 독립 복원 가능한 ZIP을 감사와 함께 받는다.
- **아키텍처:** 공통 데이터센터 조회 API + 서버 범위 정책 + 기존 export 원장/Celery 확장. 244가 제공하는 decoder·manifest·artifact adapter를 소비하고 243이 preview, 작업, ZIP part, 인가, 감사를 소유한다.
- **기술:** 기존 React/TypeScript·TanStack Query·Canvas/Recharts·FastAPI·SQLAlchemy/PostgreSQL·Celery·S3 호환 저장소. 별도 수집기·브로커를 추가하지 않는다.
- **입력:** [spec.md](spec.md), [HTML 시안](../../designs/platform-data-center/index.html), `AGENTS.md`, `.claude/rules/{branch-management,taskbox}.md`.
- 244 읽기 기준: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd244/specs/sdd-244-biosignal-raw-pipeline/{spec,plan}.md`, `contracts/` G1=`56fbc926`; `backend/app/services/biosignal_decoder.py` T03=`7f654f12`. 해당 작업트리 현재 소스를 읽었으며 243에 복사·병합하지 않았다. 244 plan 서두의 T03 미실행 표기는 원 계획 시점 기록이며 T03 커밋의 코드 존재와 구분한다. T06/T12 완료를 가정하지 않는다.

## 1. 전역 제약·잠정 결정

- 이번 수정은 이 `plan.md`와 `verify.md`뿐. 제품 코드·마이그레이션 생성/실행·서버·DB·.env·메일·삭제·추가 머지·배포 금지. Stage ④~⑦ 및 summary는 이번 산출물이 아니다.
- 회차 기본, 클래스→회차→참여자 탐색. 클래스 전체는 회차 수 제한 없음; 회원·상담사는 요청당 최대50회차, 날짜 필터/묶음 선택. 상담사는 시작/종료일 필수.
- 최종 ZIP part ≤ **1,000,000,000B**, 각각 단독 열림, ZIP 중첩 금지. 브라우저 ZIP 생성 금지.
- EEG·PPG·ACC raw, 전체 feature, 화면6(집중도·이완도·감정균형도·BPM·호흡·HRV=SDNN)를 분리. 신규 점수·종합점수·순위·판정 금지. 미수집·null을 0으로 채우거나 과거 표시값을 최신 모델로 위조하지 않는다.
- platform_admin은 전역 허용 데이터, org_admin은 active 소속의 선택 기관 하나에 귀속이 확인된 명상 클래스만. 기관에는 타기관·개인상담소·상담세션·상담기록·비공개 메모·연구 반출 없음. 플랫폼도 상담/채팅/AI 본문 반출은 불가.
- 밴드 미사용은 정상 상태. 기존 상담·리포트 및 SDD-071 단건 export API를 유지한다. 데이터센터 DTO는 report include를 받지 않는다.

Brian 미응답 3개는 **잠정 권장안**이다. spec §9의 ‘유지’ 문구를 최종 승인으로 승격하지 않는다. 구현 시 정책 객체 `DataCenterPolicy`(신규 `backend/app/services/data_center_policy.py`)를 설정 주입해 사용하고 FE에는 서버 capabilities/제한값만 전달한다. 기본값 변경은 운영 정책 변경이며 이번에 설정/환경을 수정하지 않는다.

| 결정 | 잠정 기본·설정 키 | 변경 처리 |
|---|---|---|
| D1 식별·통제 | `default_identity=pseudonymized`, `identified_operations_only=true`, `require_reason=true`, `require_audit=true`, `reauth_ttl_seconds=300`, `artifact_ttl_seconds=86400`, `url_ttl_seconds=60` | 사유 trim 2~500자; 식별 필드 allowlist·정확시각·lossless 권한 각각 검사. 연구는 가명만. 기능 비활성/기간 축소 가능, 보안 필수 통제 해제는 별도 승인 없이는 허용하지 않음 |
| D2 동시 작업 | `max_active_jobs_per_actor=1` | queued/preparing 합계, 역할/기관 전체에 걸쳐 적용. 같은 멱등키는 기존 작업 반환; 다른 요청은429+자기 진행 작업ID. part 수는 작업 수가 아님 |
| D3 기관 식별 | `org_identified_operations_enabled=true` | 자기 기관 운영의 최소 식별 필드만 허용하는 구현 기본안. false면 UI 비활성+서버403. 확정 전 제품 활성화 승인으로 해석 금지 |

설정값은 후속 BE가 `backend/app/config.py`에 `data_center_*` 이름으로 추가하고 `policy_version`을 부여한다. 승인 전 권장안으로 합성 fixture를 만들 수 있지만 실제 활성화는 별도 범위다. preview/job에는 정책 버전·해시를 고정하고, 생성/실행/링크에서 최신 정책도 적용한다. 더 엄격해진 정책으로 부적격이면 차단·새 preview 요청, 기존 만료를 연장하지 않는다. 감사 보관기간은 원본90일과 별개이며 미확정 상태에서 자동 감사 삭제를 구현하지 않는다. 기간 미확정 원천의 반출 역시 허용하지 않는다.

## 2. 244 경계·소비 인터페이스

244 plan §5 소유권이 정본이다. 아래 244 경로는 **읽기 전용**이다.

| 소유 | 경로·책임 | 243 소비·게이트 |
|---|---|---|
| 244 A | `models/{record,eeg_feature,research_export,__init__,biosignal}.py`, `schemas/{eeg,session,biosignal}.py`, `api/v1/session.py`, `services/{eeg_raw_service,storage_service,session_service,biosignal_service}.py`, WS·244 migration·contracts | 저장/ACK/close/manifest 수정 요청은 A에 전달. 243은 model `__init__.py`도 직접 수정하지 않고 자기 모델 직접 import로 등록 |
| 244 B | BLE·useBand·업로드 훅·session-live 큐·processor·기존 player 표시 경로·biosignal FE | 센터 FE와 분리. 수집·표시 스냅샷을 센터에서 새로 만들지 않음 |
| 244 C | `services/{biosignal_decoder,biosignal_export_adapter,retention_sweep_service,research_export_service}.py`, `tasks/eeg_raw_task.py`, 연구 API·244 검증 스크립트 | 디코딩·저장 산출물 변환·보관/연구 확장만. ZIP/작업/인가/감사는243 |
| 243 BE | `services/{export_package,export_service}.py`, `api/v1/data_exports.py`, `schemas/data_export.py`, 센터 조회·정책·작업 확장 | 기존 export를 버전 분기 확장. 244 private storage key를 API로 반환하지 않음 |
| 243 FE | 신규 데이터센터 화면·API client, App/Sidebar의 두 역할 진입 | 244 수집 파일 및 기존 그래프 원본은 수정하지 않고 새 wrapper로 재사용 |

- **G1(완료 계약):** `RawChunkMeta`, `ManifestRevision`, `ExportSelection`, `ExportPolicy`, `ExportArtifact` 등 정본은 244 `schemas/biosignal.py`. JSON Schema만으로 교차 필드 불변식을 보장하지 않으므로 Pydantic 의미 검증과 golden fixture를 함께 사용한다. JSON int64 µs는 canonical 10진 문자열, CSV null은 빈칸, float32는 유효숫자9자리로 왕복한다.
- **T03(코드 존재):** `decode_raw_chunk(payload: bytes, metadata: RawChunkMeta | LegacyRawChunkMeta) -> Iterator[DecodedSample]`, `decode_raw_chunk_with_gaps(..., gaps=()) -> DecodedChunk`; `iter_csv_rows`, `iter_parquet_rows` 소비. 현재 decoder는 청크 전체를 검증·메모리에 담은 후 iterator 반환하므로 ‘전 회차 streaming decoder’라고 부르지 않는다. 243은 청크 단위로 읽고 해제한다. v2 ≤1MiB, 큰 legacy 청크는 별도 예산 검사. schema `1.0`을 v1로 추정 금지; 시간 원점 없는 legacy는 null/사유 유지. UTC 직렬화·인가·Parquet schema 선택은 호출자 책임.
- **T06(실제 조회 연결 전 필수):** `get_manifest(session_id, participant_id, revision) -> ManifestRevision`를 통한 검증 ACK/close expected set/후발 revision/coverage 인수. `complete`는 전달 완료이며 BLE gap 없음이 아니다. preview는 참여자별 revision을 고정; revision 부재·pending_upload는 준비중409, 명시적 partial은 제외 범위 확인 후만 허용한다. 알려진 미수집과 정책 차단을 분리한다.
- **T12(실제 ZIP 연결 전 필수):** `iter_export_artifacts(manifest: ManifestRevision, selection: ExportSelection, policy: ExportPolicy) -> Iterator[ExportArtifact]`, 주입 reader의 정책 범위/불변 객체 version/hash/파일 행·범위·availability 계약을 합동 인수. 243이 인가 결정을 ExportPolicy로 전달하며 adapter의 필터가 서버 인가를 대신하지 않는다. 합의된 callable/reader binding은 T12 결과로 확인하고 임의 shim을 제품에 붙여 완료 처리하지 않는다.
- T06/T12 전에는 G1 합성 fixture와 테스트 전용 fake로 병렬 개발 가능. 실제 PPG/ACC/표시 snapshot 제공은 244 웹 W4 인수 뒤; 앱은 W5 통과한 플랫폼만 지원. 구 앱/과거 데이터는 `unsupported_client/not_collected/display_history_missing`. 244 branch가 존재한다는 이유로 243 runtime import가 가능하다고 가정하지 않는다.
- `manifest-v1`은 **회차×참여자 revision**이다. 243 상위 `data-center-package-v1` job/part manifest는 별도로 작성한다. G1 fixture의 `aaaa...` placeholder hash는 실파일 증거가 아니므로 artifact 인수 fixture에는 실제 파일/hash를 사용한다.

## 3. API·데이터 흐름

공통 prefix `/api/v1/data-center`. spec §6의 32개(GET27/POST5)를 유지하며 #33/34 수집은244 소유다. 기관용 API를 복제하지 않는다. 기존 export router에 센터 export 경로를 연결하고 조회 router는 `backend/app/api/v1/data_center.py`, 등록은 `backend/app/api/v1/__init__.py`에서 BE 단독 수행한다.

| spec API 번호 | 담당 Task | 서비스·응답 |
|---|---|---|
| #1~4, #6~7, #26~31 | B02 | 개요/인벤토리/대상/보유/측정/클래스·회차·참여자/회원·진행자/contexts, typed 목록과 `as_of` |
| #5 | B02 | 단건 contact-reveal; no-store·재인가·원문 없는 접근 logger, 개인정보 열람 DB 감사 신설 제외 |
| #8~15 | B03 | 동의/연구 배치/보관 기록·후보/탈퇴 접수·원장/baseline 최소 투영. #9~15 플랫폼 전용 |
| #16~18, #32 | B04 | waveform/features/spectrum/indices; 제한된 시계열 DTO |
| #19~22 | B05 | preview/create/list/status, 본인 작업·고정대상/정책/revision |
| #23~25 | B07 | part URL/감사/반출 전용 재인증 |

공통 타입은 `schemas/data_center.py`에 `DataCenterContext`, `DataCenterQuery`, `DataCenterPage[T]`, `MeasurementSelection`, `WaveformResponse`, `FeaturePage`, `IndicesPage`, `SpectrumResponse`를 정의한다. 목록 기본25/최대100, 안정 cursor `(time,id)`, 필터해시·as_of 바인딩. 일반 목록에 원시 배열/자유 JSON/PII 원문을 섞지 않는다. `subject_type+subject_id+scope` 키와 canonical/claim 관계만 사용, 이름/이메일 추정 병합 금지. 확인된0과 미집계null을 구별하고 저장량은 원장 기준 부분 집계로 표기한다.

### 서버 인가

`resolve_context(db, actor_id, scope_org_id) -> DataCenterContext` 및 `authorize_selection(db, context, selection, purpose) -> AuthorizedSelection`을 `data_center_policy.py`에 둔다. active 사용자·DB role·active membership/기관·class.organization_attribution_known·meditation/non-template·실제 participant/진행 관계를 쿼리에 강제한다. `User.org_id`나 FE capabilities를 인가 증명으로 쓰지 않는다. 기관의 member 목록 접근을 모든 회원 회차 접근으로 확대하지 않는다.

모든 집계·검색·시계열·preview·생성·워커·상태·감사·part 발급에 동일 범위를 적용한다. 범위 밖 ID는404, 금지 역할/기관 연구/플랫폼 전용 API는403. 플랫폼 감사 열람은 타 요청자 파일 접근권을 주지 않는다. 캐시 키=`actor+role+scope_org+target+range+schema+policy_version`, 응답 no-store, URL/원시값/비밀은 로그·분석·localStorage 금지.

### 시계열

`read_waveform(context, selection, signal, max_points) -> WaveformResponse`: 기본2000/채널, 최대4000/채널. 구간 해당 ACK 청크만 순차 읽기, 좁으면 원본, 길면 시간 버킷 min/max envelope. 반환값에 method/source_sample_count/returned_count/time_basis/gaps/stream/segment. gap·reset·overlap을 연결/보간하지 않는다. 다운로드는 축약 결과를 재사용하지 않는다.

EEG 초기10초, 10/30/60초 전환·스크롤·`[from,to)` 공유. PPG red/ir count·명목50Hz, ACC xyz g·명목30Hz이나 manifest rate 우선(검증된25Hz를30Hz로 라벨 교체 금지). feature는 기존27개+키와 전체 상세 emit JSONL을 구분하여 페이지 제공; null/quality/원천단위·알고리즘 버전 유지. indices는 6개 표시 정수·display input·per-metric provenance, participant_player 우선/session_player fallback과 실제 view 명시. 과거는 null+display_history_missing/unverified; reconstructed·report_aggregate는 별도 출처이며 당시 시계열에 혼합하지 않는다.

`read_spectrum(context, selection) -> SpectrumResponse`: 유효 연속 EEG 2~30초만, Hann/Welch 2초 창·50% overlap·창별 평균 제거·one-sided density, 버전 `dc-welch-v1`, Hz/µV²/Hz. gap/짧은 구간/불명 시간축은 이유와 함께 계산 불가. 서버 저장 대역파워의 미확인 단위를 이 PSD 단위로 덮어쓰지 않는다. raw에는 필터를 적용하지 않는다.

## 4. Preview·작업·ZIP·발급 계약

### 대상 고정과 큐

`DataCenterExportRequest`: scope=`participant|session|class|member|facilitator`, 대상ID, 선택 참여자/회차, 기간/묶음, selection, include 5종, eeg_format=`csv|parquet`, include_raw_bin, identity, purpose=`operations|research`, allow_partial. 참여자 단건은 회차 안의 축소 선택이다. `ExportPreview`는 opaque token·expires_at·request_hash·as_of·정렬·고정 target/revision·포함/제외사유·예상 bytes/part 수·정책버전 반환. 서버 원장에 저장, token만으로 재인가 생략 금지. preview TTL은 기술값300초, 만료/범위변경은409와 재발급 안내.

회차/클래스는 종료 회차만. 회원은 회차마다 본인만; 진행자는 직접 진행 관계의 회차 참여자. 시작시각+ID 오름차순, 회원/상담사50회차 초과는413(첫50개 묵시 절삭 금지), `1~50/51~100/...` 단일 묶음 또는 기간 축소. KST 시작일00:00 포함~종료 다음날00:00 미포함을 UTC 변환; 날짜 역전/상담사 기간누락/0건 거절. 클래스 전체는 50회차·참여자100명 제한을 적용하지 않는다.

`create_data_center_export(db, context, preview_token, reason, reauth_proof, idempotency_key) -> DataExportJob`: 같은 actor/key+hash면 기존 작업, 다른 hash는409. actor 행 lock 아래 활성 수 검사→job+targets+requested audit+dispatch outbox를 한 트랜잭션에 commit. commit 직후 best-effort enqueue를 시도하며 실패는 outbox에 남긴다. 신규 `backend/process_data_export_outbox_cron.py`가 pending/lease-expired 항목을 잠금 조회해 기존 exports 큐로 재전달한다(기존 OS cron 패턴, Celery beat 신설 금지). cron 등록/운영 실행은 후속 배포 승인 범위이며 등록 증거 없이는 장애 복구 인수 완료 금지; worker는 job claim/lease+fencing으로 중복 실행 차단. 활성 한도는 설정값이므로 ‘1’에 고정된 partial unique 제약 대신 직렬화 lock을 사용한다.

queued→preparing→ready/ready_with_warnings 또는 failed, 기한 도달→expired. 모든 part publish·검증 전 ready 금지. 권한/동의/보관 변경은 전체 발급 차단이며 warning으로 우회 금지. 확인받은 기술적 누락만 ready_with_warnings; 미허용 누락·hash 손상은 failed. worker 재전달은 동일 job의 검증 완료 part를 재사용하고 미완료 attempt는 URL 비공개; terminal failed의 사용자 재시도는 새 preview/job. 만료 worker는 재개 불가. 객체 정리는 후속 승인된 기존 cleanup 흐름에 연결하며 원천 삭제·연구 ACK 실행과 분리한다.

### 패키지

`build_data_center_package(job, artifacts, output_dir, policy) -> PackageResult`를 `export_package.py`에 추가한다. 244 adapter가 공급한 파일/row iterator를 청크 단위로 소비하며 기존 `build_package` 경로는 유지한다.

```text
mbdc_{job-alias}_pseudonymized_part1.zip
  README_ko.md
  data_dictionary.json
  manifest.json
  class-C01/session-001_date-withheld/participant-P01/
    eeg_raw.csv                  # 또는 eeg_raw.parquet
    ppg_raw.csv
    acc_raw.csv
    features.csv
    indices.csv
    meta.json
    README_ko.md
    raw/{signal}/stream-S01/segment-001/{chunk,packets}-000001.bin
    features/{eeg,ppg,acc}.jsonl
    raw-derived/{eeg,ppg,acc}-waveforms.jsonl
    meta/{sample-map,gaps,display-status}.jsonl
```

`eeg_raw/ppg_raw/acc_raw/features/indices/meta/README` 구성은 spec/G1의 위 파일명과 additive 하위 폴더를 그대로 따른다. 임의로 호환되지 않는 신호 폴더 구조로 교체하지 않는다. 없는 신호는 파일을 만들지 않고 manifest에 not_collected/unsupported_client/expired/withdrawn/lost/unknown 및 밴드 미사용 사유를 남긴다. indices 레거시 행은 null+사유 계약 유지. EEG timestamp/fp1/fp2, PPG timestamp/red/ir, ACC timestamp/x/y/z 및 feature27개는 dictionary 정본으로 검사한다.

- 가명별칭은 job 단위, 모든 part에서 동일, 원 UUID/장치ID/실명/이메일/원본 경로/역매핑표 제외. date-withheld 기본, 정확시각 인가된 운영만 날짜·UTC Z 허용. 모든 신호 공통 상대초, feature t_rel_ms는 같은 원점; 가명 device_timestamp_ms=null+사유. 식별 운영도 전화·생일 일자·상담본문 금지, 최소 필드 명시 선택.
- CSV UTF-8/RFC4180, float32 9자리·PPG 정수·음수 보존, 문자 메타 수식 주입 방지. Parquet 채널 float32·상대 timestamp float64 또는 검증된 UTC timestamp[us,UTC]. 구간은 `[from,to)`; bin은 겹치는 청크 전체와 extra_range를 preview에서 확인. v2 header/packet의 원 UUID/tick/UTC 노출 때문에 기본 가명에 원본 bin을 그대로 넣지 않는다. lossless 권한 없으면 bin 차단+redacted_packet_view/사유, 서버 정본 수정 금지.
- 회차→참여자 순서로 packing; 넘으면 참여자/CSV 행/Parquet row group/JSONL 레코드 경계로 분할, 각 조각에 헤더·schema·연속 범위. 원본 bin은 바이트 분할 금지, 단독 상한 초과면 차단+대체 포맷. `..`, 절대경로, 중복/충돌 파일명 금지.
- 디스크 임시파일+ZIP64, 압축 후 **루트 메타·central directory 포함** 실제 크기로 검사. 상한 넘으면 마지막 논리조각을 다음 part로 이동하여 재패킹, 무한 재시도 금지·단독 불가 항목 실패. 전체 part 수가 확정되면 root metadata를 최종화하고 모든 크기를 다시 검사한다.
- 각 part manifest에는 해당 파일 SHA-256/bytes/rows/schema/범위, 고정 source revision, 제외·gap·계속되는 part/segment와 전체 part 목록/개수/완료 상태를 둔다. 자기 ZIP hash를 자기 manifest 안에 넣는 순환은 금지: part 최종 ZIP hash/크기는 DB job manifest/status에 저장하고 ZIP 내부에는 payload 파일 hash와 part 식별·순서만 넣는다. 루트 메타 반복 크기도 예산에 포함한다.

### 재인증·감사·URL

반출 전용 proof는 actor·role·scope_org·export 목적·request_hash 또는 job_id·auth_epoch·만료에 바인딩, 비밀번호/SSO 기존 인증 검증기를 재사용하되 탈퇴 proof는 거부한다. 생성과 URL 모두 최근300초 확인. 기관 전환/소속해제/계정비활성/권한변경 시 무효화.

expires_at=min(요청시각+86400초, 포함 원천별 허용 deadline). deadline 미확정 원천은 반출 불가; 연구 ACK 보류로 물리 객체가 있어도 기한 초과 반출 불가. part마다 연장하지 않는다. URL POST는 본인 job+현재 기관+해당 part와 모든 고정 대상의 현재 정책 검사→영속 감사 commit→서명 발급, TTL=min(60초, 남은 job/원천기한). 서명 실패는 별도 실패 이벤트를 기록하고 발급 성공으로 표시하지 않는다. URL no-store, GET 선제 발급 금지. S3 URL은 일회용·즉시 철회 보장이 없고 최대60초 잔여 접근 가능성을 명시한다.

감사 requested/denied/preparing/ready/failed/expired/url_issued/url_denied: actor/role/org, job/고정대상 참조, UTC, 목적/사유/식별/항목/필터 hash/정책·동의버전, 결과/건수/bytes. URL·비밀·생체값 제외. 감사 실패 시 생성·발급 fail closed. URL 발급 이력은 실제 수신 완료 증거가 아니다. 원천 삭제 cascade 없이 보존한다.

## 5. 마이그레이션 목록·소유권

243 BE 한 명만 작성. 아래 파일은 **미생성·미실행**이며 `<revision>`은 구현 시 통합 head 확인 후 정한다. 244 M1~M3와 동일 head 번호 선점 금지, 통합 담당이 단일 선형 계보를 확인한다. 이번에는 DB 접근도 하지 않는다.

| 순서·예정 파일 | 변경·제약 | 호환/검증 |
|---|---|---|
| M243-1 `backend/alembic/versions/<revision>_sdd243_export_scope.py` | 기존 data_export_jobs에 kind/schema·scope_org_id·scope/identity/purpose_type/reason·policy_version/hash·preview ref·target_count·auth_epoch·lease/fencing 추가. bulk용 기존 session_id/participant_id 및 consent_eeg를 nullable화하고 legacy job은 기존 필수 CHECK 유지. data_export_previews 및 data_export_targets 추가: actor/org/request_hash/revisions/순서/동의정책·deadline 고정 | 기존 목적 자유문 purpose 유지, legacy kind default·기존 멱등 unique 유지. target unique(job,session,participant), preview token hash unique·expires index. 50회차는 서버가 distinct session으로 검증; 수집 원장 FK cascade 없음 |
| M243-2 `backend/alembic/versions/<revision>_sdd243_export_parts.py` | data_export_parts(job,part_no,object ref/version,bytes,checksum,status), data_export_dispatch_outbox(job unique,상태/재시도) | unique(job,part_no), bytes≤1,000,000,000 CHECK, object ref API 비노출. 기존 단건 object_key 유지, legacy part1 호환; worker lease/fencing 회귀 |
| M243-3 `backend/alembic/versions/<revision>_sdd243_export_audit.py` | 기존 data_export_audits에 scope_org_id·identity·purpose_type/reason·request_hash·정책/동의버전·part_no·counts·event_id 추가, 일괄 data_export_audit_targets 추가. 기존 session/participant nullable+legacy 호환 | unique event_id·actor/org/time 조회 index. 원천/job 삭제 cascade 금지, URL/생체값/재인증 비밀 컬럼 없음. 차단된 무대상 요청도 감사 가능 |

모델은 기존 `models/data_export.py` 안에서 확장하여244 `models/__init__.py`와 충돌을 피한다. nullable/default 중심 additive 적용, 작은 배치 backfill·구버전 coexistence·잠금 시간은 격리 PG에서 검증. source manifest revision은 의미 참조로 고정하고244 테이블 변경을 요구하지 않는다. rollback은 센터 capability 비활성, 데이터/열 삭제·자동 downgrade 없음. preview의 제한된 대상목록은 TTL 접근차단, 물리 정리는 별도 승인 정책에 따른다.

## 6. 워커·Task 실행 계획

구현 시 BE/FE는 **서로 다른 전용 워크트리**에서 병렬. 같은 index·같은 파일 동시 수정 금지. 공통 계약 B01을 먼저 동결하고 FE는 mock으로 진행한다. BE↔FE 파일 교차 수정 없이 리뷰만 한다. 통합/QA 담당은 승인된 통합 단계에서 diff/테스트/실제 API·화면을 재검증한다. 아래 Task는 모두 미실행이다.

| 워커 | 독점 경로 |
|---|---|
| BE | `backend/app/services/{export_package,export_service,data_center_policy,data_center_query,data_center_governance,data_center_measurement,export_reauth}.py`, `backend/app/schemas/{data_export,data_center}.py`, `backend/app/api/v1/{data_exports,data_center,__init__}.py`, `backend/app/models/data_export.py`, `backend/app/tasks/export_task.py`, `backend/process_data_export_outbox_cron.py`, `backend/app/config.py`, `backend/alembic/versions/*sdd243*.py`, `backend/tests/test_sdd243_*.py`, `backend/tests/pg/test_sdd243_*.py` |
| FE | `frontend/src/pages/data-center/**`, `frontend/src/components/data-center/**`, `frontend/src/lib/api/data-center.ts`, `frontend/src/hooks/use-data-center.ts`, `frontend/src/App.tsx`, `frontend/src/components/layout/SidebarNav.tsx`, `frontend/tests/sdd243-*` |
| QA/통합 | 신규 `scripts/verify-sdd243-package.py`, `frontend/e2e/sdd243-data-center.spec.ts`, `specs/sdd-243-platform-data-center/{plan,verify,summary}.md`(후속 실행기록). BE/FE 제품 파일은 읽기 리뷰만 |

### B01 — 계약·인가 기반 (BE)

- 경로: `schemas/{data_center,data_export}.py`, `services/data_center_policy.py`, `config.py`; 테스트 `backend/tests/test_sdd243_policy.py`.
- 입력: G1·spec §5.1. 출력: §1 정책, §3 DTO/resolve_context/authorize_selection, §4 request/preview 계약. FE 타입은 FE가 동일 응답 fixture로 작성.
- [ ] `test_org_scope_intersection`, `test_policy_switches`, `test_forbidden_purpose` 작성: 다기관/개인상담소/소속해제404, 연구403, 잠정 설정 변경 반영.
- [ ] `cd backend && pytest tests/test_sdd243_policy.py -q` RED 확인.
- [ ] 서버 범위·필드 allowlist·오류와 DTO 구현, 정책/schema fixture를 FE에 인계.
- [ ] 같은 명령 GREEN 및 기존 인가 회귀, FE 읽기 리뷰 후 `feat(sdd-243): 데이터센터 계약과 인가` 커밋.

### B02 — 탐색·집계·개별 열람 (BE, B01 후)

- 경로: `services/data_center_query.py`, `api/v1/{data_center,__init__}.py`, `schemas/data_center.py`; 테스트 `test_sdd243_queries.py`.
- 인터페이스: `query_data_center(db, context, resource, query: DataCenterQuery) -> DataCenterPage`; #1~7/#26~31. contact-reveal은 별도 POST 함수, raw 원문 bulk 반환 금지.
- [ ] `test_as_of_counts_and_subject_identity`, `test_member_facilitator_scope`, `test_reveal_projection` 작성: canonical 중복0, 타 회차 미포함, 마스킹·no-store·원문 없는 logger.
- [ ] `cd backend && pytest tests/test_sdd243_queries.py -q` RED 확인.
- [ ] scoped query·안정 cursor·개별 열람·기관 context 구현.
- [ ] GREEN 및 기존 목록 회귀, 독립 리뷰 후 `feat(sdd-243): 데이터센터 탐색과 집계` 커밋.

### B03 — 동의·보관·표준 조회 (BE, B02 후)

- 경로: `services/data_center_governance.py`, `api/v1/data_center.py`, `schemas/data_center.py`; 테스트 `test_sdd243_governance.py`.
- 인터페이스: `query_governance(db, context, resource, query) -> DataCenterPage`; #8~15. 저장 report allowlist·순수 후보 평가만,244 retention/research 서비스 수정 금지.
- [ ] `test_governance_get_has_no_mutation`, `test_org_governance_denied`, `test_research_no_reverse_link` 작성: dry-run 호출/쓰기0, baseline PII0, 구동의 확장0, 접수/원장 구별.
- [ ] `cd backend && pytest tests/test_sdd243_governance.py -q` RED 확인.
- [ ] 기존 읽기 데이터 투영, 공유 정책 규칙이 부족하면244에 읽기 계약 요청(스위프 실행 금지).
- [ ] GREEN, 독립 리뷰 후 `feat(sdd-243): 동의와 보관 현황 조회` 커밋.

### B04 — 파형·feature·표시값·PSD (BE, B01+T03; 실제 연결 T06)

- 경로: `services/data_center_measurement.py`, `api/v1/data_center.py`, `schemas/data_center.py`; 테스트 `test_sdd243_measurements.py`.
- 인터페이스: §3 read_waveform/read_spectrum, `read_features(...) -> FeaturePage`, `read_indices(...) -> IndicesPage`; G1 type/decoder 소비.
- [ ] `test_waveform_budget_and_gap`, `test_legacy_time_unknown`, `test_indices_not_reconstructed`, `test_welch_sine_density` 작성: 채널당4000 이하, gap 미연결, SDNN 고정, 합성10Hz 피크·적분파워 A²/2 ±5%.
- [ ] `cd backend && pytest tests/test_sdd243_measurements.py -q` RED 확인.
- [ ] 청크 단위 조회/축약·feature 페이지·원 snapshot·PSD 구현, T06 없으면 fake 검증까지만 표시.
- [ ] GREEN 및 T06 revision 실제 인수, 독립 리뷰 후 `feat(sdd-243): 생체신호 상세 조회` 커밋.

### B05 — Preview·원장·작업 큐 (BE, B01/B02, M243-1/2; T06)

- 경로: `services/export_service.py`, `schemas/data_export.py`, `api/v1/data_exports.py`, `models/data_export.py`, `tasks/export_task.py`, `backend/process_data_export_outbox_cron.py`, M243-1/2; 테스트 `test_sdd243_jobs.py`, `pg/test_sdd243_jobs.py`, `pg/test_sdd243_schema.py`(M243-3 반영까지 BE가 갱신).
- 인터페이스: §4 create_data_center_export; `preview_export(...) -> ExportPreview`, `run_export(export_id, db)`는 job kind 분기. B06 PackageResult 소비.
- [ ] `test_50_51_and_class_unlimited`, `test_preview_revision_pinned`, `test_idempotency_race`, `test_outbox_and_lease_recovery` 작성: member 자기 참여만, 기간경계, 동시2요청 중1개, 큐실패 재전달 중복0.
- [ ] `cd backend && pytest tests/test_sdd243_jobs.py -q` RED 확인; PG race는 승인된 격리 환경에서 별도 실행.
- [ ] preview·대상 고정·outbox·lease·멱등·한도·마이그레이션 구현. 정책 변경 fail closed.
- [ ] GREEN/PG race/구버전 단건 회귀, 독립 리뷰 후 `feat(sdd-243): 다운로드 작업과 큐` 커밋.

### B06 — 원본 ZIP·독립 part (BE, B05; T12 필수)

- 경로: `services/export_package.py`, `services/export_service.py`; 테스트 `test_sdd243_package.py`.
- 인터페이스: §4 build_data_center_package→PackageResult(parts, files, exclusions, source_revisions); T12 iter_export_artifacts 입력.
- [ ] `test_package_roundtrip`, `test_part_limit_with_metadata`, `test_pseudonym_bin_redaction`, `test_single_oversize_bin` 작성: 3신호 sample/hash/null·행수 일치, 최종1GB 이하·단독 열림·중첩0·원UUID0.
- [ ] `cd backend && pytest tests/test_sdd243_package.py -q` RED 확인.
- [ ] CSV/Parquet·JSONL·sidecar·독립ZIP·final size 검사·가명화 구현. small cap 단위시험과 실제1GB 경계 인수시험 구분.
- [ ] GREEN, QA의 Q01 패키지 독립 verifier 부분을 선행 실행하고 T12 합동 인수 후 `feat(sdd-243): 원본 ZIP과 분할 파일` 커밋.

### B07 — 재인증·감사·part URL (BE, B05/B06, M243-3)

- 경로: `services/{export_reauth,export_service}.py`, `api/v1/data_exports.py`, `schemas/data_export.py`, `models/data_export.py`, M243-3; 테스트 `test_sdd243_delivery.py`, `pg/test_sdd243_audit.py`.
- 인터페이스: `issue_export_proof(context, binding, credential) -> ExportProof`, `issue_part_url(db, context, job_id, part_id, proof) -> DataExportDownload`; 인증 비밀은 응답/감사에 보존하지 않음.
- [ ] `test_proof_binding_and_expiry`, `test_revocation_between_stages`, `test_audit_failure_blocks_url`, `test_ttl_minimum` 작성: 300초/24h/60초 경계·기관전환·원천 조기만료·타 작업403/404.
- [ ] `cd backend && pytest tests/test_sdd243_delivery.py -q` RED 확인.
- [ ] 생성·실행·발급 재검사/영속 감사/URL 및 소유자 status·목록 구현, expiry cleanup은 제품 정책만 설계하고 실제 삭제 실행 별도 승인.
- [ ] GREEN/PG 감사 원자성·기존 SDD-071 회귀, 독립 리뷰 후 `feat(sdd-243): 다운로드 감사와 발급 통제` 커밋.

### F01 — 공통 탐색·플랫폼·기관 화면 (FE, B01 계약 후 BE와 병렬)

- 경로: `pages/data-center/data-center-page.tsx`, `components/data-center/{data-center-table,data-center-detail,data-center-filters}.tsx`, `lib/api/data-center.ts`, `hooks/use-data-center.ts`, `App.tsx`, `SidebarNav.tsx`; 테스트 `frontend/tests/sdd243-navigation.test.tsx`.
- 인터페이스: typed DataCenterPage/context/capabilities, `/admin/data-center`·`/org/data-center`; §3 API fixture 소비. 기관 경로를 `/org/:org_id` 동적 라우트와 구분.
- [ ] 탐색·검색·필터·그룹·cursor·빈/미집계·reveal 폐기·기관 탭 범위를 실패 테스트로 작성.
- [ ] `cd frontend && npx vitest run tests/sdd243-navigation.test.tsx` RED 확인.
- [ ] HTML 보라/크림·테이블/상세 구조를 실제 공통 컴포넌트로 구현, 역할/기관/탭 변경 시 선택·preview·proof·파형 요청 취소/버퍼 폐기.
- [ ] GREEN·실브라우저1440/390 검증, BE 읽기 리뷰 후 `feat(sdd-243): 플랫폼과 기관 데이터센터 화면` 커밋.

### F02 — 측정 1건 그래프 (FE, F01+B04 계약; mock 병렬)

- 경로: `components/data-center/{measurement-detail,signal-waveform,feature-table,indices-chart,spectrum-panel}.tsx`; 테스트 `frontend/tests/sdd243-measurement.test.tsx`.
- 인터페이스: WaveformResponse/FeaturePage/IndicesPage/SpectrumResponse, 공통 MeasurementSelection `[from,to)`. 기존 Canvas/Recharts 패턴 재사용,244 player/processor 수정 없음.
- [ ] 10/30/60초·범위·EEG2ch/PPG2ch/ACC3ch·gap·null·미수집·SDNN·출처/버전·늦게 도착한 이전 응답 폐기를 실패 테스트 작성.
- [ ] `cd frontend && npx vitest run tests/sdd243-measurement.test.tsx` RED 확인.
- [ ] 제한된 서버 시계열 렌더·선택구간 공유·별도 원 feature/표시값 탭 구현.
- [ ] GREEN·브라우저 시간축/결측/단위 확인 후 `feat(sdd-243): 생체신호 그래프와 원천 표` 커밋.

### F03 — 다운로드·작업·감사 (FE, F01+B05/B07 계약; mock 병렬)

- 경로: `components/data-center/{export-dialog,export-jobs,export-audits}.tsx`, `lib/api/data-center.ts`; 테스트 `frontend/tests/sdd243-export.test.tsx`.
- 인터페이스: ExportPreview/ExportProof/DataExportStatus/part status; 정책값은 서버 제공, 클라이언트 고정 보안 판정 없음.
- [ ] 50/51회차·묶음/날짜 초기화·제외확인·미선택·사유·재인증·429 진행바로가기·part별 발급·만료·감사/수신 구분 실패 테스트 작성.
- [ ] `cd frontend && npx vitest run tests/sdd243-export.test.tsx` RED 확인.
- [ ] 다운로드 흐름·5개 항목/bin 별도·가명 기본·기관 운영 전용·잠정 정책 상태·파일구조·실제/예상 part 구분 구현.
- [ ] GREEN·플랫폼/기관 브라우저 확인 후 `feat(sdd-243): 다운로드 작업과 감사 화면` 커밋.

### Q01 — 독립 인수 (QA/통합, 최종 인수는 B01~B07/F01~F03+244 T06/T12 후)

- 패키지 verifier 작성·음성 fixture·부분 인수는 B06과 병렬 선행하며, B06이 Q01 전체 완료를 기다리지 않는다. 최종 통합 검증만 모든 제품 Task 완료 후 수행한다.
- 경로: `scripts/verify-sdd243-package.py`, `frontend/e2e/sdd243-data-center.spec.ts`, 후속 verify/summary 기록.
- 인터페이스: 생성 ZIP/DB와 API 증거/244 golden packet·expected CSV. 구현 decoder/package 코드를 oracle로 import하지 않고 stdlib struct/hashlib/zipfile 및 독립 Parquet reader로 검증한다.
- [ ] 손상 hash·누락 행·part 초과·중첩ZIP·PII 주입에 verifier가 실패하는 음성 fixture 작성/실패 확인.
- [ ] 정상3신호·legacy·null·재시작·1GB경계·51회차·다기관 합성 fixture에서 전체 복원/인가 매트릭스 실행.
- [ ] 승인된 격리 환경에서 PG migration/경합·API·실제 브라우저·성능 실행, mock/실제/웹/앱 근거를 분리 기록.
- [ ] [verify.md](verify.md) 모든 실행 증거 검토, 미실행/실패/기준선 남기고 `docs(sdd-243): 데이터센터 인수 결과` 커밋. 승인 없는 배포/머지/삭제 금지.

## 7. 검토 집중점·실행 게이트

| 실패 조건 | 기대 동작 | 담당/검증 |
|---|---|---|
| preview 뒤 소속·동의·보관·정책 변경 | pinned revision도 현재 인가 우회 불가, 전체 발급 차단 | B05/B07, V03/V09 |
| 51회차·동일시각·기간 끝 경계·타기관 진행자 | 안정 묶음, 자기 범위만, 조용한 절삭 없음 | B02/B05/F03, V04 |
| 후발 ACK·complete 안의 gap·미렌더 초 | revision 고정/coverage 분리, null·미수집 보존 | B04/B06/F02, V05/V06 |
| 단일 거대파일·루트 manifest 증가·part 재실행 | 최종1GB, standalone, hash/범위 누락중복0 | B06/Q01, V07/V08 |
| 큐 전송·감사·서명·worker 장애/중복 | 원자성·멱등·유한 재시도, 감사 없는 URL0 | B05/B07, V09/V10 |

자체 대조: spec §2~3/§4 조회는 B02/B03/F01, §3.2~3.5·4.2는 B04/F02, §4.3~4.6은 B05~B07/F03, §5~5.1은 B01 및 모든 호출, §6의32개는 §3 표, §7의 수집 단계는244로 연결했다. 기존6탭+작업/기록을 생략하지 않는다. 제품 구현/성능/실제 저장 인수는 모두 미실행. warm 시계열 p95≤2초·생성202≤1초·worker peak RSS≤256MiB는 목표이며 Q01 합성 대량 측정으로 확인한다. 전체 대상은 디스크/DB cursor로 처리, 메모리에 누적하지 않는다.

이번 문서 후속 게이트: 구현 승인 → B01 계약 → BE/FE 격리 병렬 → T06/T12 실연결 → Q01 실제 검증 → summary/최종 리뷰. 244 fixture 성공으로 실제 저장·실기기·앱 인수를 대체하지 않는다.
