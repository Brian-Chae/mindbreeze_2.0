# 분석용 데이터 다운로드 기획안

- 작성일: 2026-09-16
- 단계: Phase 1 서비스 기획 / 검토안. 구현·배포·DB 변경은 포함하지 않는다.
- 대상: 상담사(`counselor`), 기관 관리자(`org_admin`), 플랫폼 관리자(`platform_admin`).
- 목표: 리포트·세션 상세의 **데이터 다운로드**에서 참가자 1명 또는 클래스 전체의 분석 가능한 데이터를 ZIP으로 제공한다.
- 권고: **개별 feature CSV + 리포트 JSON을 먼저 제공하고, 그룹 및 raw Parquet를 단계적으로 확장**한다. ZIP은 Celery 작업자가 생성하고 S3에 저장하며, 브라우저는 프리사인드 URL로 직접 내려받는다.
- 표기 원칙: 아래의 “현재”는 저장소 코드 확인 결과, “제안”은 신규 설계, “출시 조건”은 구현 전 해결할 항목이다. 실제 RDS 행·S3 객체·운영 권한은 이번 조사에서 조회하지 않았다.

## 1. 문제와 제품 범위

- 현재 리포트의 요약·그래프만으로는 기관의 자체 분석, 측정 품질 확인, 세션 간 비교를 재현하기 어렵다.
- 제공 가치:
  - 상담사: 본인 세션의 참가자별 측정 추이 확인.
  - 기관: 소속 세션의 클래스 결과 분석과 품질 관리.
  - 플랫폼: 승인된 운영·분석 목적의 전체 범위 데이터 추출.
- 다운로드 권한은 연구 활용·제3자 제공 허가와 구별한다. 수집 동의만으로 연구·외부 반출이 허용된다고 간주하지 않는다.
- 초기 범위: 종료된 단일 세션, 그 안의 개별 참가자. 그룹 확장도 단일 클래스의 참가자 일괄 추출을 뜻한다.
- 제외: 여러 기관·여러 세션 일괄 추출, 외부 연구기관 자동 전송, PPG/가속도 원시 파형 신규 수집, 신규 생체 지표 산출, 임상 진단 제공.

## 2. 현재 데이터 구조와 기술적 가용성

### 2.1 Raw EEG — 실제 바이트는 S3

- DB 원장: `EEGRecord` → `eeg_records`.
  - `session_id`, `participant_id`, nullable `user_id`, `s3_key`, `duration_sec`, `sample_rate` 기본 250Hz, `file_count`, `play_group_id`.
  - 현재 `_sync_eeg_record`는 참가자 단위로 업로드 완료 청크 수를 집계한다. `s3_key`는 단일 분석 파일이 아니라 접두 경로일 수 있으며, `play_group_id`는 최신 확인 값으로 갱신된다.
- 청크 원장: `EEGRawChunk` → `eeg_raw_chunks`.
  - `object_key`, `stream_id`, `chunk_index`, `start_ms/end_ms`, `sample_rate`, `channel_count` 기본 2, `unit` 기본 `uV`, `schema_version`, `checksum`, `size_bytes`, `upload_status`.
  - `upload_status`: `pending/uploaded/failed`. 체크섬과 크기는 nullable이며 업로드 확인 요청에서 클라이언트가 전달한다.
  - **이 테이블에는 `play_group_id`와 `run_id` 컬럼이 없다.** 경로·스트림에 실행 구간 정보가 있더라도 별도 검증 없이 확정 식별자로 사용하지 않는다.
- 현재 경로: `eeg-raw/{session_id}/{participant_id}/{segment}/{stream_id}/{chunk_index:08d}.bin`.
- 현재 형식: `application/octet-stream`과 불투명 raw 바이트. 기존 저장물이 Parquet/CSV라는 근거는 없다.
- 접근: `POST /api/v1/sessions/{session_id}/eeg-raw/presign` → S3 직접 PUT → `/eeg-raw/ack`. 다운로드용 GET 서명은 별도 구현 대상이다.
- 코드 설정 기본값: 버킷 `mindbreeze-dev`, 리전 `ap-northeast-1`. 운영에서는 환경별 설정을 사용하며 버킷명을 고정하지 않는다.
- 용량: 청크별 실제 `size_bytes` 합산과 객체 메타데이터로 추정한다. `file_count`나 세션 예정 시간으로 정확한 바이트 수를 주장하지 않는다.
- 출시 조건:
  - `useEegRawUpload`는 `ArrayBuffer`를 받지만 실제 호출부와 직렬화 규약을 확인해야 한다. 검색상 훅 외 실제 호출을 확인하지 못했다.
  - 프런트는 단건 presign·`/{chunk_id}/ack`, 서버는 `chunks[]` presign·`/ack` 계약이다. 실연동·기존 객체 존재부터 검증해야 한다.
  - 프런트 기본 `schema_version=eeg-raw-v1`, 서버 기본 `1.0`을 포함해 데이터형, 엔디언, 채널 순서, 타임스탬프 규약별 디코더를 확정해야 Parquet 변환이 가능하다.
  - `uploaded` 표기만으로 실객체 존재·무결성을 보증하지 않는다. 내보내기 때 객체 존재·길이·체크섬을 검증한다.

### 2.2 Feature — RDS/PostgreSQL의 1초 단위 원천 특징값

- `EEGFeatureWindow` → `eeg_feature_windows`; DB 조회가 원천 접근 경로다.
- 식별·시간·품질: `id`, `session_id`, `participant_id`, nullable `user_id`, `play_group_id`, `window_index`, `device_timestamp_ms`, `quality`, `created_at`.
- 주요 컬럼: `focus_index`, `cognitive_load`, `relaxation_index`, `stress_index`, `emotional_stability`, `total_neural_activity`, `faa`, `hemispheric_balance`.
  - 기존 주석·브리프의 “7지표”와 달리 나열된 저장 컬럼은 **8개**다. 다운로드 데이터 사전에는 8개 모두 명시한다.
- 밴드파워·부가 값: `delta_power`, `theta_power`, `alpha_power`, `beta_power`, `gamma_power`, `total_power`, `meditation_level`, `attention_level`, `signal_quality`.
- 심박변이·움직임: `sdnn`, `rmssd`, `lf_power`, `hf_power`, `lf_hf_ratio`, `heart_rate`, `respiratory_rate`, `motion`.
- 결측: 숫자 값은 nullable. `quality=valid/degraded/invalid`와 결측을 그대로 보존한다. 미측정·산출 불가를 0이나 정상으로 바꾸지 않는다.
- 시간 특성: `window_index`는 `play_group_id`마다 다시 시작할 수 있다. 참가자 전체에서 단독 고유 키나 연속 초로 해석하지 않는다.
- 크기 특성: 1인 60분 연속 측정이면 약 3,600행, 20인이면 약 72,000행이다. 중단·미측정·복수 실행에 따라 실제 행 수는 달라진다.
- `eeg_rollup_service.py`의 60초 집계는 화면용 파생 데이터다. 다운로드 CSV에는 1초 원천 행을 사용한다.

### 2.3 음성 — 세션 단위 원본과 별도 청크 경로

- `SessionRecord.audio_s3_key`가 원본 S3 객체를 가리키는 구조다. `SessionRecord`는 `session_id`당 1개이며 참가자별 음성 파일 모델이 아니다.
- 실제 녹음 코드 `useAudioRecorder.ts`는 WebM/Opus를 사용한다. `AudioChunk.file_path`와 STT의 로컬 청크 처리도 있으므로 `audio_s3_key`가 항상 채워지거나 S3 원본이 존재한다고 가정하지 않는다.
- 제공 원칙: 확장 단계에서 검증된 **원본 형식 그대로** `audio.webm`/`audio.m4a`/`audio.wav` 중 실제 형식으로 제공한다. 확장자만 WAV로 바꾸지 않는다.
- WAV가 필요한 경우 별도 변환 옵션으로 두고 샘플레이트·채널·코덱·변환 이력을 기록한다. 변환 자원과 증가 용량을 사전 안내한다.
- 그룹 녹음은 다른 참가자 발화를 포함할 수 있다. 개별 참가자 ZIP에는 그룹 세션 음성을 넣지 않는다. 그룹 ZIP에는 세션 공용 음성으로 한 번만 포함하며 전체 발화자의 해당 활용 동의가 확인되지 않으면 제외한다.
- 크기 특성: 녹음 시간·비트레이트·채널 수·코덱에 좌우된다. 파일 크기를 확인할 수 없으면 “용량 확인 중”으로 표시한다.

### 2.4 리포트 — JSONB와 승인 상태

- `Report` → `reports`: `content` JSONB, `type`, `status`, `participant_id/user_id`, `data_credibility`, `created_at` 등.
- `content.eeg.metrics/timeline/narrative`는 집계·정규화·서술 결과이며 원천 feature와 다르다. 저장된 정규화 출처·버전 정보가 있으면 보존한다.
- `status`: `pending_analysis`, `pending_review`, `completed`, `error`를 구분한다. `data_credibility=null`을 낮은 신뢰도 등으로 임의 치환하지 않는다.
- 크기: 타임라인 길이·서술 길이에 따라 가변. 직렬화한 바이트 수로 산정한다.
- 제공: 개별 참가자에 안전하게 귀속되는 완료 리포트만 기본 포함한다. 상담사 전체 요약·타 참가자 내용·내부 메모는 개별 ZIP에 혼입하지 않는다.

### 2.5 세션·참가자 메타데이터

- `Session`: `type/status/title/duration_min/participant_mode/linkband_mode`, `host_id`, `run_id`, 시작·종료 시각 등.
- `SessionParticipant`: `id`, nullable `user_id`, `guest_name`, `gender`, `birth_date`, `consent_audio`, `consent_eeg`, 참여 상태 등.
- 현재 `Session`에는 `org_id`가 없다. `User.org_id`와 세션의 `host_id`를 연결할 수 있으나 상담사의 기관 이동에 따른 과거 세션 귀속은 별도 정책이 필요하다.
- 제공 형식: JSON. 기본 패키지는 참가자 가명 키와 분석에 필요한 최소 필드만 제공한다. 실명·이메일·생년월일·성별·상담 메모·자유 입력 제목은 기본 제외한다.
- `Session.run_id`만으로 과거 raw·feature의 실행 회차가 분리된다고 보장할 수 없다. 초기 다운로드는 단일 `session_id` 전체 범위이며 회차 분리 불확실성을 명시한다.

## 3. 제공 파일과 데이터 계약

### 3.1 MVP 개별 패키지

- `session_metadata.json`: 패키지 가명 세션·참가자 키, 유형·상태·시각·측정 여부·범위·생성 기준시각. 예정 `duration_min`과 실제 측정 시간을 구분한다.
- `feature_timeseries.csv`: 위 25개 숫자 feature와 시간·품질·구간 식별 컬럼. UTF-8, 헤더 1행, 소수점 `.`을 사용한다.
- `report.json`: 완료된 참가자 리포트의 허용 필드, `type/status/data_credibility`와 저장된 EEG 내용. 전체 DB 레코드를 그대로 덤프하지 않는다.
- `manifest.json`: 파일 목록·스키마 버전·생성시각·행 수·바이트 수·SHA-256·포함/누락 사유·원천 범위·완전성 상태. 자기 자신의 체크섬은 목록에서 제외한다.
- `data_dictionary.json`, `README_ko.md`: 컬럼 의미·단위·결측·시간축·품질 및 분석 주의사항.
- CSV 숫자 결측은 빈 필드, JSON은 `null`, Parquet는 nullable 값으로 보존한다. 부동소수점 값의 불필요한 반올림·정규화·보간을 하지 않는다.
- CSV 문자열은 정해진 식별자·열거값으로 제한하고, 외부 입력 문자열을 제공해야 할 때 수식 삽입 방지 규칙과 이스케이프 여부를 기록한다.
- 데이터 사전은 실제 SDK/산출 계약으로 단위를 확인한다. `motion` 등 단위 불명 값에 임의 단위를 붙이지 않는다. PPG 유래 HRV는 PRV임을 구분하고 ECG-HRV라고 표기하지 않는다.

### 3.2 Raw 확장 패키지

- 기본 분석 형식은 `raw_eeg.parquet`: 컬럼형 저장·압축·형식 보존에 유리하다. CSV는 분석 도구 호환이 필요한 사용자의 선택 옵션이다.
- 제안 컬럼: `participant_key`, nullable `play_group_id`, `stream_id`, `chunk_index`, `sample_index`, nullable `timestamp_ms`, `channel_1_uv`, `channel_2_uv`.
- 채널명·순서는 디코더 검증 후 데이터 사전에 명시한다. 원본이 2채널/uV 계약과 다르면 조용히 변환하지 말고 지원 여부를 판정한다.
- 타임스탬프가 실제 샘플 시각인지, 시작시각+샘플레이트로 복원한 추정 시각인지 기록한다. 원천 시각이 없으면 절대시각은 null로 두고 구간 내 샘플 순서만 제공한다.
- 원본 보존 옵션: `raw_original/{stream_key}/{chunk_index}.bin`과 `raw_manifest.json`. 이것만 제공하는 상태를 “분석 가능한 Parquet 제공 완료”로 취급하지 않는다.
- 알 수 없는 `schema_version`은 변환 실패로 명시한다. 원본 보존은 별도 선택으로 허용하고, 잘못 해석한 숫자 파일은 만들지 않는다.
- 청크 누락·겹침·순서 역전·체크섬 부재/불일치를 목록화한다. 누락 구간을 0으로 채우거나 스트림 경계를 지워 이어 붙이지 않는다.

### 3.3 ZIP 내부 구조 제안

```text
session_<export-key>.zip
├── manifest.json
├── session_metadata.json
├── data_dictionary.json
├── README_ko.md
├── participants.csv                    # 그룹 확장: 가명·포함 여부·누락 사유
├── participants/
│   ├── p001/
│   │   ├── participant_metadata.json
│   │   ├── feature_timeseries.csv
│   │   ├── report.json                 # 존재하고 완료된 경우
│   │   ├── raw_eeg.parquet             # raw 확장 선택 시
│   │   └── raw_manifest.json
│   └── p002/...
└── session_audio/audio.webm             # 음성 확장·조건 충족 시 한 번만
```

- 개별 다운로드도 동일 구조를 사용하되 `participants/` 아래 한 명만 포함한다.
- 파일명·S3 export 경로에 실명·이메일·생년월일을 넣지 않는다. 가명 매핑은 작업 범위 내부에만 유지하며 다른 export와 자동 연결 가능한 식별자는 기본 제공하지 않는다.
- EEG 미측정 참가자는 헤더만 있는 CSV와 `not_measured` 사유를 제공할 수 있다. 수집 여부 자체가 불명확하면 `unknown`으로 구분한다.
- 미완료/없는 리포트는 파일을 생략하고 `report_pending/report_missing`을 기록한다. 사용자가 “완료 리포트 필수”를 선택했으면 요청을 보류한다.
- 권한 없는 데이터는 파일이나 참가자 이름 목록으로 노출하지 않는다. 무결성 검증 실패 파일은 제외하며, 허용된 부분 결과도 사용자에게 명시적으로 알린다.

## 4. 사용자 경험(UX)

### 4.1 개별 다운로드

- 위치: 상담사·관리자 리포트 상세 상단의 PDF 관련 액션 옆 **데이터 다운로드**. 세션 상세 참가자 행에도 동일 액션을 제공한다.
- 연결 후보: `ReportDetailPage.tsx`, `ReportDetailModal.tsx`, `SessionDetailPage.tsx`. 내담자 공개 리포트·샘플 화면에는 관리자용 다운로드를 노출하지 않는다.
- 참가자 리포트는 해당 참가자를 고정한다. 상담사 세션 전체 리포트는 참가자 선택을 먼저 받으며, 리포트의 `user_id`를 곧바로 참가자로 간주하지 않는다.
- 패널: 대상·측정 기간·포함 항목·미측정/미완료 항목·예상 용량·파일 보관 만료 시각·활용 목적을 표시한다.
- MVP 기본 선택: feature CSV와 완료 리포트 JSON. raw·음성은 출시 전 “준비 중” 안내로 구분한다.
- 미측정이어도 리포트/메타데이터 다운로드는 가능하다. “EEG 데이터가 없어 리포트와 세션 정보만 포함됩니다”로 안내한다.

### 4.2 그룹/클래스 다운로드

- 위치: 세션 상세의 참가자 목록 상단 **클래스 데이터 다운로드**.
- 실제 참여자 전체를 기본 선택하고 대기자는 기본 제외한다. 포함 대상 수, EEG 보유 수, 다운로드 제한/데이터 누락 수를 나누어 표시한다.
- 개별 참가자 폴더 + 공통 메타데이터를 ZIP 하나로 제공한다. 권한·동의가 충족되지 않은 대상을 몰래 포함하지 않는다.
- 부분 제공이 가능하면 “20명 중 18명 포함, 2명 제외”처럼 실제 결과를 알린다. 타인 접근 권한이 없는 사용자에게 제외 대상의 신상은 보이지 않는다.

### 4.3 대기·진행·완료·실패

- 상태: `queued → preparing → ready / ready_with_warnings / failed`, 이후 `expired` 또는 `cancelled`.
- “대기 중 / 데이터 확인 중 / 파일 생성 중 / 다운로드 준비 완료”를 표시한다. 분모가 확정되지 않은 작업에는 가짜 퍼센트나 고정 완료 시간을 표시하지 않는다.
- 메타데이터 기반 빠른 추정 후 원천 검사 단계에서 용량을 갱신한다. 실제 바이트 기준과 추정 기준을 구분한다.
- 화면을 닫아도 작업은 지속한다. 다시 들어오면 요청자의 최근 작업을 복원한다.
- 완료 후 **ZIP 다운로드**를 누르면 단기 URL을 발급받는다. 브라우저 실제 전송률은 ZIP 생성 진행률과 별개이며 앱이 저장 완료를 확인했다고 표시하지 않는다.
- 오류는 권한 변경·원본 누락·변환 불가·용량 제한·일시 장애로 구분한다. 재시도 가능한 오류에만 재시도 액션을 제공한다.
- 링크 만료 시 권한을 재확인해 URL을 재발급한다. 패키지 보관기한이 지났으면 새 작업을 생성한다.

## 5. API와 구현 방향 제안

### 5.1 제안 엔드포인트

- `POST /api/v1/sessions/{session_id}/participants/{participant_id}/data-exports`: 개별 요청, `202 Accepted`와 `export_id`, `status`, `status_url` 반환.
- `POST /api/v1/sessions/{session_id}/data-exports`: 클래스 요청. 선택적 `participant_ids`는 반드시 해당 세션·허용 대상의 부분집합이어야 한다.
- `GET /api/v1/data-exports/{export_id}`: 상태·단계·대상 수·완료 수·예상/실제 용량·경고·만료 시각 조회.
- `POST /api/v1/data-exports/{export_id}/download-url`: 최신 권한·동의·보관 상태 재검사 후 S3 GET 프리사인드 URL 및 URL 만료 시각 반환.
- `DELETE /api/v1/data-exports/{export_id}`: 대기/진행 작업 취소 또는 완료 패키지 제거 요청. 작업 취소는 완료 전 게시를 막고 임시 객체 정리로 이어진다.
- `GET /api/v1/data-exports?session_id=...`: 요청자 자신의 최근 작업 목록, 페이지 크기 제한 및 안정적인 정렬.
- 생성 요청: `include=[features,report]`, 확장 시 `raw_format=parquet|csv`, `include_audio=false`, `purpose`, `allow_partial`, `require_completed_report`. 클라이언트가 S3 키·기관 ID·권한 정책을 지정하지 못하게 한다.
- `Idempotency-Key`: 요청자·세션·참가자 집합·옵션에 묶어 중복 클릭을 제어한다. 같은 키에 다른 옵션이면 충돌로 처리하고, 만료/데이터 변경 후 새 요청은 새 키를 사용한다.
- 오류: 미인증 401, 역할 부족 403, 접근 불가 리소스 404, 상태/멱등 충돌 409, 옵션·지원 범위 오류 422, 동시 작업/요청 제한 429.
- 기존 업로드 API의 선택적 인증 및 참가자 ID 기반 게스트 경로를 다운로드 권한에 재사용하지 않는다.

### 5.2 처리 방식 비교와 선택

- **권고: Celery 비동기 생성 + S3 저장 + 직접 다운로드**.
  - FastAPI는 권한·요청·작업 상태만 처리한다. ZIP 응답 바이트를 프록시하지 않는다.
  - 작업자는 RDS를 제한된 배치로 읽고 필요한 S3 원천을 스트리밍 읽어 변환·압축한 후 export 객체로 저장한다.
  - 백그라운드 작업자의 파일 가공과 API 서버의 사용자 파일 전송을 구분한다. `.claude/rules/architecture.md`의 직접 업로드/다운로드 규칙에 맞춰 사용자 전송은 S3로 한정한다.
  - 규칙을 “백그라운드 작업자도 원천을 읽을 수 없음”으로 운영 중이라면 S3 인접 전용 처리 환경의 허용 범위를 Phase 3 설계에서 먼저 확정한다.
- 동기 서버 ZIP 스트리밍: 구현 진입은 단순하지만 장시간 연결·취소·재시도·API 자원 점유·서버 경유 규칙 때문에 채택하지 않는다.
- 브라우저 ZIP 생성: 소량 파일에는 가능하지만 대용량 raw·그룹 데이터의 메모리와 탭 종료 복구 문제가 있어 기본 경로로 채택하지 않는다.
- MVP도 비동기 작업 계약을 동일하게 사용하여 그룹 확장 때 클라이언트 계약을 교체하지 않는다.

### 5.3 원천 일관성과 작업 안전성

- 신규 `DataExportJob` 제안: 요청자, 범위, 옵션, 목적, 상태, 스키마 버전, 기준시각, 대상 원장, 객체 키, 크기, 체크섬, 만료·오류 코드. 원문 생체 데이터나 서명 URL을 작업 행에 넣지 않는다.
- 요청 접수 시각과 실제 스냅샷 기준시각을 구분한다. 작업 시작의 짧은 DB 일관 읽기 구간에서 feature·report 허용 필드와 raw 원장을 고정하고, 장시간 ZIP 생성 동안 DB 트랜잭션을 잡지 않는다.
- 수정 가능한 리포트는 고정된 JSON 사본·해시를 사용한다. raw는 가능하면 객체 버전 또는 체크섬을 고정하고, 원본 변경이 탐지되면 재시도/실패한다.
- 레거시 `participant_id=null`은 같은 세션에서 `user_id`가 단일 참가자와 명확하게 연결될 때만 매핑한다. 애매하면 `unresolved_owner`로 제외한다.
- `play_group_id`·스트림·시각·행 ID를 보존해 재시작·동일 시각 데이터를 구분한다. 회차별 조회를 지원하려면 원천 귀속 계약부터 확장한다.
- raw는 `uploaded`만 후보로 선택하고 크기·무결성을 추가 검증한다. pending/failed와 누락 객체를 완료 데이터로 위장하지 않는다.
- ZIP64 지원과 배치 크기·임시 디스크 상한·작업 시간 제한을 둔다. Parquet·이미 압축된 음성에 과도한 이중 압축을 적용하지 않는다.
- 작업 ID별 임시 객체에 쓰고 검증 완료 후에만 `ready`로 전환한다. Celery 중복 실행에도 하나의 결과만 게시하며 재시도 시 고아 파일을 정리한다.
- `storage_service.py`는 현재 PUT 서명 실패 시 스텁 URL로 대체한다. 새 다운로드 경로는 운영에서 스텁을 성공 결과로 반환하지 않고 명시적으로 실패해야 한다.

## 6. 권한·개인정보 보호

- 공통: `require_roles`와 객체 단위 범위 검증을 함께 적용한다. 활성 계정인지도 확인한다. 버튼 숨김은 서버 권한 검사를 대체하지 않는다.
- 상담사: `Session.host_id == current_user.id`인 본인 담당 세션만 허용한다.
- 기관 관리자: 기관에 귀속이 확인된 세션만 허용한다. 현재 `Session.org_id`가 없으므로 **확정된 기관 귀속 스냅샷/이력 정책을 기관 기능 출시 조건**으로 둔다. 현재 상담사의 `User.org_id`만으로 과거 세션을 새 기관에 공개하지 않는다.
- 플랫폼 관리자: 기관 범위 제한 없이 요청할 수 있으나 목적 기록·동의/반출 정책·감사 기록은 동일하게 적용한다.
- 작업 조회·취소·URL 발급은 기본적으로 생성자만 허용하고 원천 접근 권한도 유지되어야 한다. 플랫폼의 타인 작업 운영 관리 권한은 별도 권한으로 설계한다.
- 생성 시, 작업 실행 시, 게시 직전, URL 발급 시 권한·동의를 재확인한다. 변경이 감지되면 패키지를 게시하지 않거나 폐기한다.
- 뇌파·상담·음성은 서비스상 민감 데이터로 취급한다. `consent_eeg/consent_audio`는 확인 입력이지만 내보내기·연구 활용 목적과 범위를 증명하는 동의 이력/정책이 별도로 필요하다.
- 기본 가명화는 익명화를 보장하지 않는다. 타임스탬프·희소 특징만으로도 재식별 가능성이 있어 접근 통제와 목적 제한을 유지한다.
- 그룹 음성·상담사 리포트는 타 참가자 정보가 섞일 수 있으므로 개별 파일의 허용 필드와 포함 정책을 별도로 검증한다.
- 전송 TLS, 저장 암호화, 비공개 버킷, 작업자 최소 IAM 권한, export 전용 접두 경로, 임시 파일 접근 제한을 적용한다.
- 제안 기본값: 패키지 보관 24시간, 다운로드 URL 유효기간 5분. URL 발급은 패키지 만료를 넘기지 않게 제한한다.
- 프리사인드 URL은 소지자가 사용하는 접근 수단이다. 발급 이후 앱의 권한 철회만으로 이미 발급한 URL을 즉시 무효화했다고 보장할 수 없다. 사고·동의 철회 시 객체 삭제/접근 차단과 새 URL 발급 금지를 함께 수행한다.
- AWS는 요청 시작 때 URL 만료를 검사하므로 전송 중 만료와 새 요청 만료를 구분한다. 연결이 끊긴 뒤 만료된 URL로 재시작하면 재발급이 필요하다. [AWS 프리사인드 URL 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- 보관 만료는 애플리케이션 접근 차단과 명시 삭제 작업으로 처리하고 S3 수명주기 정책을 보조 정리로 사용한다. 수명주기 삭제는 비동기이며 버전 관리 사용 시 이전 버전 정리도 필요하다. [AWS 객체 만료 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)
- 감사: 요청자·역할·대상·목적·동의 정책 버전·요청/완료/URL 발급/삭제 시각·결과·용량을 기록한다. 서명 URL·원문 생체값·상담 내용은 로그에 남기지 않는다.
- URL 발급 기록을 실제 다운로드 완료 증거로 간주하지 않는다. S3 접근 로그를 연결하더라도 사용자의 로컬 저장 완료까지 보증하지 않는다.
- 외부로 저장된 파일은 서비스에서 회수할 수 없다. 다운로드 전 보관·재배포 책임을 간단히 안내하고, 법정 보관/동의 요건은 별도 개인정보 검토에서 확정한다.

## 7. 용량·비용·운영 한도

- 아래 수치는 설계 추정이며 저장 객체나 압축률의 실측값이 아니다. MB는 10진 바이트 기준이다.
- Raw 수치 배열만의 기준: `250 samples/s × 2 channels × 4 bytes × 3,600s = 7.2MB/인·시간`(Float32 가정). Float64면 14.4MB이며 타임스탬프·헤더는 별도다.
- 20인×60분 raw 배열은 Float32 가정 144MB. CSV는 숫자 문자열·시각·구분자 때문에 달라지며 ZIP/Parquet 크기를 이 값과 동일하다고 약속하지 않는다.
- Feature: 3,600행×행당 300~700바이트라는 예시 가정이면 약 1.08~2.52MB/인·시간, 20인 약 21.6~50.4MB. 실제 직렬화 표본으로 가정을 교체한다.
- 음성 예시: 64kbps 압축 음성은 약 28.8MB/시간, 16kHz·16bit·mono PCM WAV는 약 115.2MB/시간이다. 실제 코덱·설정 확인 전 견적으로 확정하지 않는다.
- 비용 구성: RDS 조회 I/O·CPU, 작업자 CPU/메모리/임시 디스크, S3 원천 GET·결과 PUT·임시 저장, 사용자 인터넷 전송, 암호화 키 요청, 감사 로그, 실패 재시도.
- 월 비용 산식: `성공/실패 작업 수 × 평균 생성 비용 + 다운로드 횟수 × 평균 전송 바이트 비용 + 평균 임시 저장량 비용`. 최신 AWS 계약·요율과 실측 데이터를 적용하며 이번 문서에서 금액 견적은 확정하지 않는다.
- 제안 초기 한도: 사용자당 동시 생성 1건, 기관당 3건, 그룹 50명, 예상 결과 1GB/건. 단일 세션 범위에서 적용하고 실측 후 조정한다.
- 상한을 넘으면 작업을 시작하기 전에 대상 축소·raw 제외를 안내한다. 추정 불가 또는 생성 중 상한 초과도 명시 실패 처리하며 잘린 ZIP을 성공으로 전달하지 않는다.
- STT·리포트 생성을 막지 않도록 export 전용 Celery 큐/동시성 한도를 둔다. 다른 요청자의 민감 패키지를 공용 캐시로 재사용하지 않는다.
- 운영 관측: 요청→준비 시간의 중앙값/95백분위, 실패·경고율, 누락 청크율, 평균 파일 크기, GB당 생성 비용, 동시 작업 수, 만료 객체 삭제 지연.

## 8. 우선순위와 출시 단계

### P0 — 개별 feature + 리포트 MVP

- 개별 요청·비동기 작업·S3 ZIP·GET 서명·권한 검사·감사·만료 처리를 완성한다.
- feature CSV, 참가자 완료 리포트 JSON, 메타데이터·manifest·데이터 사전을 제공한다.
- 상담사/플랫폼 권한과 기관 귀속 정책을 검증한다. 기관 귀속이 확정되지 않은 세션은 기관 관리자에게 공개하지 않는다.
- 완료 기준: 일반 참가자·게스트·미측정·결측·구간 재시작·리포트 미완료·권한 거부·만료 재발급에서 패키지 내용과 안내가 일치한다.

### P1 — 그룹 feature ZIP

- 클래스 전체/선택 참가자, 참가자별 폴더, 포함/제외 요약, 그룹 한도·부분 결과 UX를 제공한다.
- 20인×60분을 대표 성능 시나리오, 50인을 초기 한도 검증 시나리오로 사용한다.
- 기관 이동·권한 변경·타기관 요청·그룹 리포트의 정보 혼입 방지 검증을 출시 게이트로 둔다.

### P2 — 개별·그룹 raw ZIP

- 실제 raw 수집 연결과 프런트/서버 계약 일치를 먼저 확인한다.
- 실객체 표본으로 `schema_version`별 디코더, 채널·단위·시간축·무결성·원천 귀속을 검증한다.
- Parquet 기본, CSV 선택, 선택적 원본 청크 보존을 제공한다. 미지원 버전·누락·깨진 객체를 명확히 표시한다.
- 대용량 생성·중복 작업·작업 취소·디스크 상한·ZIP64·S3 전송을 검증한다.

### P3 — 음성 및 분석 편의 확장

- 원본 음성 S3 저장 여부와 동의 이력을 확인한 뒤 원본 형식/선택 WAV 변환을 제공한다.
- 여러 세션 다운로드·기관 분석용 식별자·연구용 데이터셋은 별도 기획과 승인 범위로 다룬다.

## 9. 구현 전 의사결정과 검증 시나리오

- 권고 기본안 승인 항목: 비동기 ZIP, feature 중심 MVP, 가명 기본값, 24시간 보관/5분 URL, 원본 음성 후순위, 기관 귀속 정책.
- Phase 1 승인 후 Phase 2에서 다운로드 패널·그룹 선택·경고·작업 복원 화면을 설계한다. Phase 3에서는 SDD `spec/plan/verify`를 작성하고 **구현 전 Verify 승인**을 받은 후 진행한다.
- 필수 검증:
  - 같은 세션의 A 참가자 요청에 B의 feature·리포트·음성이 포함되지 않는다. 게스트도 `participant_id`로 분리된다.
  - 기관 관리자에게 타기관·과거 귀속 불명 세션과 타인 export 작업이 노출되지 않는다.
  - 작업 생성 후 계정 비활성화·기관 이동·동의 철회 시 게시/URL 발급이 차단된다.
  - null·invalid·degraded·미측정·시각 불명·반복 `window_index`가 원천 의미를 유지한다.
  - 리포트 승인 상태와 정규화 메타데이터가 다운로드 기준시각의 값과 일치한다.
  - raw pending/failed·S3 누락·체크섬 오류·미지원 버전이 성공으로 오인되지 않는다.
  - 중복 클릭·Celery 재전달·탭 종료·만료·취소·부분 실패 후 결과가 예측 가능하다.
  - 브라우저 파일 전송이 API 서버를 통과하지 않고 S3에서 이뤄진다.
  - 배포 환경에서 실제 GET 서명·CORS/다운로드 헤더·저장 암호화·수명주기·삭제를 검증한다. 단위 테스트만으로 운영 동작을 입증하지 않는다.
- 본 문서의 검증 범위: 모델·서비스·API·프런트 코드의 정적 확인과 공식 S3 문서 확인. 앱 동작·객체 다운로드·성능·법적 적합성 검증은 수행하지 않았다.

## 10. 코드 근거

- [원장·리포트·음성 모델](../backend/app/models/record.py), [feature 모델](../backend/app/models/eeg_feature.py), [세션·참가자 모델](../backend/app/models/session.py), [사용자·기관 연결](../backend/app/models/user.py).
- [인증·역할 의존성](../backend/app/api/deps.py), [세션 권한·상태 서비스](../backend/app/services/session_service.py), [리포트 귀속·승인 서비스](../backend/app/services/report_service.py).
- [raw 서비스](../backend/app/services/eeg_raw_service.py), [raw API 스키마](../backend/app/schemas/eeg.py), [세션 API](../backend/app/api/v1/session.py), [S3 서명 서비스](../backend/app/services/storage_service.py), [S3 기본 설정](../backend/app/config.py).
- [60초 집계 서비스](../backend/app/services/eeg_rollup_service.py), [feature 조회](../backend/app/services/eeg_query.py).
- [raw 업로드 훅](../frontend/src/hooks/useEegRawUpload.ts), [프런트 raw API](../frontend/src/lib/api/eeg-raw.ts), [음성 녹음 훅](../frontend/src/hooks/useAudioRecorder.ts), [STT 작업](../backend/app/tasks/stt_task.py).
- [파일 직접 전송 규칙](../.claude/rules/architecture.md). 오래된 문서의 시계열 저장 설명보다 이번에 확인한 ORM·S3 원장 구조를 현재 기능 판단의 기준으로 사용했다.
