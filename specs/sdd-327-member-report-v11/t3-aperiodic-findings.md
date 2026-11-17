# T3 조사 — 뇌파 1/f(비주기) 기울기 산출 가능성 (코드 수정 없음, 11/13)

## 1. 서비스의 원시 EEG 저장 현황
- **Parquet 아님.** 원시 EEG는 클라이언트가 만든 **바이너리 청크를 S3에 직접 PUT**(presign → ack). Parquet은 연구 내보내기 번들(`research_export_service.py`)에서만 만든다.
  - 키: `eeg-raw/{session_id}/{participant_id}/{segment}/...` (`eeg_raw_service._object_prefix/_build_object_key`)
  - 메타 테이블: `eeg_raw_chunks`(`models/record.py:118`) — `object_key, start_ms, end_ms, sample_rate(250), channel_count(2), unit(uV), schema_version, signal_type(eeg|ppg|acc), status(uploaded)`
  - 디코더: `services/biosignal_decoder.py`(`decode_raw_chunk_with_gaps`, v2는 gap·anchor 포함, legacy 지원). 읽기: `storage_service.download_bytes(object_key)` — 연구 내보내기가 이미 같은 방식으로 읽는다(`research_export_service.py:397`).
- **보관 기간**: 코드 기본 `retention_raw_days=90`(`config.py:234`)이나 `retention_sweep_enabled` 기본 false(deploy `t12-ssm.sh`: false, 방침 게시·승인 전 비활성). `eeg_raw_retention_days` 기본 0=무기한. → 현재 dev 설정상 **삭제되지 않음**. 단 RETENTION 활성화 시 세션 종료 90일 후 원시 삭제 → **리포트는 생성 시점에 1회 계산해 JSON에 저장해야 함**(plan 방침과 일치). 연구 비동의·원본삭제 요청 세션은 원시가 없을 수 있음.
- **report_task에서 읽기 가능?** 가능. `generate_report_inline`(`tasks/report_task.py:483`)은 Celery(DB 세션 보유)에서 돌고 S3 접근 설정이 이미 있음(미디어·내보내기 태스크와 동일 워커). 필요 작업: 참가자의 `eeg_raw_chunks(signal_type='eeg', status='uploaded')` 조회 → 청크 다운로드·디코드 → 250Hz 2채널 시계열 복원.
- **리스크**: 청크 다수(수업 60~70분×250Hz×2ch 수십 MB/명), 리포트 생성 지연·메모리, S3 장애/객체 누락 시 결측 처리 필요(14쪽 생략). **백엔드에 numpy·scipy·specparam 의존성 없음**(requirements에 pyarrow만; numpy는 pyarrow 경유로 설치될 수 있으나 명시 아님) → 신규 의존성 추가 필요.
- 키 이름만 확인한 설정: `EEG_RAW_RETENTION_DAYS`, `RETENTION_RAW_DAYS`, `RETENTION_SWEEP_ENABLED`, S3 버킷(`S3_BUCKET`). 값은 읽지 않음.

## 2. 시안의 1/f 산출 방식 (원 분석 스크립트)
- 출처: `internal-indiv/methods.md`, `_w/analyze.py`, `baseline5/_w/b5_stats.py`.
- **원시 EEG(250Hz) → 4초 창 Hann Welch PSD, 2초 간격, 선형 추세 제거 → 유효 창(양호 채널 평균) PSD의 중앙값 → specparam 2.0.0rc7(`SpectralModel`, aperiodic_mode='fixed', 2–40Hz, 피크폭 1–8Hz, 최대 5피크, 최소 높이 0.1) → 지수(exponent) 사용, R²<0.9 적합 제외.** 사용 조건: 유효 창 합산 ≥180초(구간 전체).
- 구간 시각 정렬은 원시 청크 `anchor.utc_us + (first_sample_index − anchor.sample_index)/rate`.
- 서비스에 저장된 건 밴드파워(`delta..gamma_power`)뿐이라 시안 값은 **서비스 값이 아니라 원시 재계산**(methods.md §6도 서비스 분석창과 원시 재계산이 다름을 확인).
- 시안 1/f 값과 일치시키려면 specparam(+scipy Welch) 동일 조건이 필요. 단순 로그-로그 선형 회귀는 값이 달라져 시안·논문 인용과 불일치.

## 3. 실시간 산출 쪽 가능성
- 프런트 `lib/eeg/EEGSignalProcessor.ts`와 Rust `measurement-core/src/dsp/eeg.rs`는 **Morlet 7사이클 PSD**(PSD_CALIB×corr(f), 1–45Hz bin, 하루밴드 정본)를 이미 산출하고 `emit_spectrum`으로 스펙트럼도 낸다. 1/f 기울기 계산 자체는 이 스펙트럼 위에 로그-로그 적합만 추가하면 된다(수십 줄).
- 그러나 ① Morlet PSD는 Welch와 값이 달라(보정 상수 포함) **시안의 specparam 값과 불일치**, ② 저장 경로가 없음: `eeg_feature_windows` 스키마(Alembic 마이그레이션)·업로드 API·FE 윈도 payload·Rust ABI/WASM(`packages/measurement-core`) 변경이 필요, ③ **앱 재빌드·재배포 필요**(Capacitor 앱 포함), 과거 세션은 값이 없음(소급 불가), ④ 밴드 스트리밍 특성상 실시간 계산 구간 유실 시 영구 결측.
- 즉 "산출은 쉽지만 시안과 동일한 수치·소급·무배포"라는 점에서 불리.

## 4. 안 비교
| 항목 | ① 리포트 생성 시 원시에서 계산 | ② 실시간 산출·저장 추가 | ③ MVP 14쪽 생략 |
|---|---|---|---|
| 구현량 | 중: 청크 조회·디코드·4초 Welch·중앙값·specparam + 의존성(numpy/scipy/specparam) + 골든 테스트 | 대: Rust/TS 계산, 윈도 스키마·마이그레이션, 업로드 API, FE 반영, 앱 재빌드·배포 | 소: 14쪽·화면 카드 생략 분기만(결측 처리는 어차피 필요) |
| 시안 수치 일치 | 높음(동일 알고리즘, 시안 샘플로 골든 검증 가능) | 낮음(Morlet≠Welch, 별도 기준 재정의 필요) | 해당 없음 |
| 마이그레이션 | 없음(`reports.content` JSONB에 저장) | 필요(컬럼 추가) | 없음 |
| 앱 재빌드 | 불필요 | 필요 | 불필요 |
| 과거 세션 | 원시가 남아 있으면 계산 가능 | 불가(신규 세션부터) | — |
| 위험 | 생성 지연·메모리(Celery로 격리 가능), 원시 보관 만료·누락 시 결측, 의존성 증가(specparam rc 버전 고정 필요) | 배포 범위 큼, 수치 불일치, 일정 위험 큼 | 18쪽 구성 중 1쪽 누락(대표 확정 시안 대비 축소) |

## 5. 추천
- **①을 기본안으로, 구현은 격리·결측 안전하게**: `member_report_aperiodic.py` 순수 함수(원시 샘플 → 지수/R²/사용 창 수) + 청크 로더를 분리하고, 실패·원시 없음·유효 창 <180초·R²<0.9면 `None` 반환 → 14쪽·화면 카드 생략(③이 자동 폴백). 리포트 본문 생성과 분리해 1/f만 실패해도 리포트 전체는 생성되게 한다.
- ②는 비채택(수치 불일치·앱 재빌드·소급 불가). 
- 사전 확인 필요(T0 계약에 반영): (a) 백엔드 의존성 추가(numpy, scipy, specparam — 서버 이미지·배포 영향, 승인 필요), (b) 리포트 생성 소요시간 실측, (c) 원시 보관 정책(RETENTION 활성화 전에 리포트가 먼저 생성됨을 보장), (d) 시안 샘플 참가자 1~2명으로 골든(시안 지수 ±허용오차) 확보.
- 일정 압박 시: 1차 릴리즈는 ③으로 가고 ①을 후속 T3로 붙이는 단계적 진행도 가능(결측 분기를 T0 계약에 처음부터 넣어두면 추가 비용 없음).
