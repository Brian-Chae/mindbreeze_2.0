# SDD-031 — FeatureWorker 서버 (raw → feature) — 후순위

> **나중에 필요 시 도입(logic_server 모드).** 우선은 클라이언트(웹/웹뷰)에서 신호처리(SDD-030).
> haru_band_app `feature-worker`(Node.js, port 3001)를 mindbreeze에 이식하는 서버측 신호처리.
> 산출되는 1초 feature 계약은 클라이언트 처리와 동일.

## 1. 배경·목표

웹 블루투스가 불안정하고 iOS에서 미지원 → 네이티브 앱(SDD-032)이 BLE raw를 수신해 이 서버로 전송하고,
서버가 신호처리(마음·몸 지표 산출)를 수행한다. 목표:

1. raw(EEG 250Hz / PPG 50Hz / ACC 30Hz) 1초 배치를 받아 신호처리하는 API 구축
2. 산출 지표가 웹 모드(프론트 `lib/eeg/`)와 **동일한 계산 로직·결과**를 보장
3. 세션별 버퍼·상태 관리 (연속 raw 스트림 → 임계값 도달 시 처리)

## 2. haru_band_app FeatureWorker 분석 결과 (이식 대상)

| 구성 | 역할 |
|------|------|
| `POST /sessions/:id/eeg` | 250샘플(1초) raw → 버퍼 누적 → EEGSignalProcessor → 마음 지표(focus/relaxation/stress 등) |
| `POST /sessions/:id/ppg` | 50샘플 raw → PPGSignalProcessor → BPM/HRV |
| `POST /sessions/:id/acc` | 30샘플 raw → ACCSignalProcessor → 움직임/자세 |
| `session-manager` | 세션별 raw 버퍼 + 임계값(BUFFER_THRESHOLDS) + 처리 상태(lastEEGResult 캐시) |
| `DELETE /sessions/:id` | 세션 정리 |
| `GET /sessions/status` | 모니터링 |

**핵심 패턴**: 앱이 1초 단위로 raw를 보내면, 서버가 버퍼에 누적 → 임계값 도달 시 처리 → 지표 반환.
미도달 시 `cached`(이전 결과) 또는 `buffering` 상태 반환.

## 3. mindbreeze 이식 설계

### 3.1 기술 스택
- **Node.js + Express** (haru_band_app과 동일) 또는 **FastAPI Python** (mindbreeze 백엔드와 통일)
- 권고: **신호처리 로직을 공유**하기 위해, 프론트 `lib/eeg/`의 TS 신호처리 코드를 재사용할 수 있는
  Node.js(Express) 선택이 유리. 단, Python 이식 시 이미 포팅된 `eeg_metrics.py` 재사용 가능.

### 3.2 신호처리 로직 공유 (핵심)
프론트 `frontend/src/lib/eeg/`의 EEGSignalProcessor/PPGSignalProcessor/AnalysisMetricsService를
**공유 패키지(npm workspace 또는 별도 패키지)로 추출**해, 프론트(웹)와 FeatureWorker(서버)가 동일 코드 사용.
→ 웹/앱 모드 간 지표 결과 일치 보장.

### 3.3 API 계약 (mindbreeze)
- `POST /sessions/:session_id/eeg` — body: `{ samples: [{ch1, ch2, leadoff_ch1, leadoff_ch2, timestamp}], sample_rate_hz }`
- `POST /sessions/:session_id/ppg` — body: `{ samples: [{red, ir, timestamp}], sample_rate_hz }`
- `POST /sessions/:session_id/acc` — body: `{ samples: [{x, y, z, timestamp}], sample_rate_hz }`
- 응답: `{ indices: {마음/몸 지표}, band_powers, signal_quality, status: processed|cached|buffering }`

### 3.4 배포
- Docker 컨테이너 (port 3001) — mindbreeze 백엔드와 별도 서비스
- 앱(SDD-032)만 이 서버를 호출 (웹은 프론트 처리)

## 4. 구현 범위
1. 공유 신호처리 패키지 추출 (lib/eeg → 패키지화)
2. Express 서버 + eeg/ppg/acc 라우트 (haru_band_app 이식)
3. session-manager (raw 버퍼 + 임계값 + 상태)
4. 호흡수(PPG RSA, SDD-030에서 개발된 로직)를 PPG 처리에 통합
5. **웹 호출 테스트**: 웹 프론트 `useBand`에 FeatureWorker 전송 모드 추가 — BLE raw를 수집해 `POST /sessions/:id/eeg|ppg|acc`로 보내고, 서버 지표를 받아 현재 UI에 표시 (프론트 처리 ↔ 서버 처리 전환)
6. 단위 테스트 (웹 모드와 동일 지표 결과 일치 검증)

## 5. 검증 기준
- 동일 raw 입력 → 웹 모드(프론트)와 서버 모드(FeatureWorker)가 **동일한 지표** 산출
- 1초 배치 연속 수신 → 버퍼 누적 → 임계값 도달 시 처리 (buffering/cached 상태 정상)
- BPM/HRV/호흡수/마음 지표가 올바르게 반환

## 6. 의존·후속
- 선행: SDD-030 (호흡수·지표 로직 — FeatureWorker에 통합될 로직)
- 후속: SDD-032 (네이티브 앱이 이 서버를 호출), SDD-033 (듀얼 모드 통합)
