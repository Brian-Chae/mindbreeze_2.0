# SDD-022 — 하루밴드 × MB 2.0 통합 기획 (에이전트 리뷰 종합)

> 멀티에이전트: Claude(백엔드·EEG·리포트), Cursor(UX·리포트 기획) 완료. Codex(통합·SDK)는 ChatGPT 계정 모델 `gpt-5.5` 404로 실패 → SDK 통합 관점은 Hermes가 직접 보강.

## 1. 클래스 시작 실제 플로우 (하루밴드 로직, 코드 근거)

LINK BAND 착용 → 5단계 파이프라인:

| 단계 | 모듈 | 동작 |
|------|------|------|
| ① BLE 연결 | link-band-sdk-web `BluetoothProvider` | Web Bluetooth + Capacitor BLE 동일 인터페이스 추상화 |
| ② raw 수신 | `ble-service` → `StreamProcessor` | EEG 250Hz(fp1/fp2)·PPG 50Hz·ACC 30Hz·배터리 |
| ③ 신호 처리 | `EEGSignalProcessor` | 500샘플 임계 → biquad 필터 → 밴드파워(δ/θ/α/β/γ) |
| ④ 지표 | `AnalysisMetricsService` | SQI 80%↑ Moving Average(120개/2분) → focus·relaxation·stress·meditation 등 |
| ⑤ 저장 | `SessionManager`+`DataCollector` | IndexedDB 로컬 + 5초 배치 `POST /eeg/sessions/{id}/features` + raw S3 presigned |

## 2. 리포트 시스템 리뷰 (하루밴드 backend)

- **트리거**: 세션 종료 → arq(Redis) 워커 → `compute_application_data`
- **7지표**: focus_index_stability / total_neural_activity / cognitive_load_stability / stress / hemispheric_balance / emotional_stability / relaxation
- **핵심 원칙**: 정규화 상수 JSON(하드코딩 금지) · null 보존(0 치환 금지) · 세션 품질 게이트(insufficient/invalid/degraded/valid) · 졸음 플래그 · weighted_total 종합점수
- **집계**: analytics.py(트렌드/비교/시계열)

## 3. 에이전트 합의

### Claude (백엔드) — 5대 결정
1. **feature-worker(Node) 미이식** — 브라우저에서 feature 추출, 백엔드는 집계+지표만. raw S3 보존
2. **metrics.py 순수 Python 포팅** — numpy 불필요, 상수 version 추적
3. **저장 2계층** — `EEGFeatureWindow`(TimescaleDB 신규) + `EEGRecord`(요약)
4. **Celery chord** — `group([eeg_aggregate, chain(stt→summary)]) → chord → report_generate`, inline fallback + `/record` WS 재사용
5. **자동 산출 → 상담사 승인 게이트 → 전송**, "두뇌휴식도 = relaxation_score" 단일화

### Cursor (UX) — 핵심
- **이중 레이어 리포트**: 상담 콘텐츠(L2) 필수 + EEG(L3~L5) opt-in 확장. 미착용 시 EEG 섹션 제거
- **content 계약 단일화**(P0 블로커): UI 기대 필드 vs report_task 스텁 불일치
- **정보 비대칭**: 상담사=해석 밀도, 내담자=상위 3~4지표 + 쉬운 라벨
- **1.0 GuestComplete 전화 신청 폐기** — 계정 기반 자동 산출 + 승인으로 통합
- **트렌드/비교는 세션 상세 밖**(P1 별도 IA)

### Hermes (SDK 통합 보강, Codex 대체)
- link-band-sdk-web `BluetoothProvider`를 MB 2.0에 **코드 이식**(npm 의존성보다 로컬 `lib/eeg/` 이식) — Web Bluetooth(Chromium) + Capacitor BLE 추상화 유지
- `StreamProcessor`→`EEGSignalProcessor`→`AnalysisMetricsService`를 MB 2.0 웹 훅(`useBand`/`useEEGMetrics`)으로 이식
- SDD-021의 live-metrics/게스트 명상 placeholder → 실데이터 교체 지점: SessionLivePage 모니터링 테이블 + /join 명상 게이지

## 4. 통합 아키텍처

```text
LINK BAND ──BLE──▶ [MB 2.0 웹] BluetoothProvider → StreamProcessor → feature 추출
                        │ (5초 배치) POST /eeg/sessions/{id}/features
                        ▼
              [MB 2.0 FastAPI] EEGFeatureWindow(TimescaleDB) + raw S3
                        │ 세션 종료
                        ▼
              [Celery chord] eeg_aggregate ∥ (stt→summary) → report_generate
                        │ metrics.py 포팅 (7지표·게이트·null 보존)
                        ▼
              [Report] counselor/client type → 상담사 승인 → 내담자 발송
```

## 5. 로드맵

| Phase | 범위 |
|-------|------|
| **P0** | content 스키마 정합 + metrics.py 포팅 + EEGFeatureWindow + 7지표 카드 + 품질 배너 + 3채널 타임라인 + counselor/client 비대칭 + 승인/미착용 동작 |
| **P1** | 트렌드·세션 비교 + EEG 지연 보충 발송 + 상담사 타임라인 overlay + Web Bluetooth 실연동 |
| **P2** | 클래스 평균 대비 + PDF EEG 페이지 + 게스트 미리보기 가입 CTA |

## 6. 착수 전 블로커 3건 (Brian 결정 필요)

1. **라이선스 승인(R7)** — 하루밴드 metrics.py·normalization_constants.json·신호처리 알고리즘을 MB 2.0으로 이식할 권한(내부 자산으로 처리 가능한지)
2. **null 보존 선행 리팩터(R3)** — `report_task.py:30-31`의 `or 0`/`or {}` 치환 제거 (지표 산출 전 선행)
3. **프로덕션 broker 상시 가동(R6)** — Celery/Redis chord 운영 전제

## 7. 핵심 리스크 (Claude 13건 중 상위)

- 엣지(브라우저) 산출 신뢰성 — 기기별/브라우저별 편차
- numpy/scipy 부재 → 밴드파워 계산은 순수 Python으로 검증 필요
- 생체정보 프라이버시(뇌파+상담) — 접근 제어·보관 기간
- 실시간 부하 — 그룹 수업 N명 × 5초 배치
- TimescaleDB 도입 — 현재 PostgreSQL에서 확장 필요

## 8. 한 줄 결론

**하루밴드는 숫자를 만들고, MB 2.0은 사람과 승인을 만든다.** 클래스 시작의 실시간 뇌파는 하루밴드 파이프라인을 웹으로 이식해 재현하고, 리포트는 상담 도메인(L2 요약·승인)을 본체로 EEG 7지표(L3)를 opt-in 확장으로 얹는 이중 레이어로 기획한다. 1.0 GuestComplete 전화 신청은 전달 경로에서 내린다.
