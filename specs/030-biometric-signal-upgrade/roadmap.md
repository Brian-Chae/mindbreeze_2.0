# MindBreeze 2.0 — 생체신호 듀얼 모드 로드맵

> 웹 블루투스 불안정 + iOS 미지원 해결. haru_band_app의 듀얼 모드(simulator/logic_server) 패턴 적용.
> SDD를 단계별로 나눠 개발한다.

## 1. 아키텍처 (듀얼 모드 — 신호처리는 클라이언트에서)

```
              ┌───────────────────────────────────────────────┐
              │            웹 (브라우저)                       │
              │  Web Bluetooth → 신호처리(클라이언트 JS) → feature │
              └───────────────────────┬───────────────────────┘
              ┌───────────────────────┴───────────────────────┐
              │    네이티브 하이브리드 앱 (웹뷰 기반, 후순위)    │
              │  네이티브: BLE + 신호취득 + 푸시                │
              │  웹뷰(JS): 신호처리·지표 추출 → feature          │
              └───────────────────────┬───────────────────────┘
                                      ↓
                     동일한 1초 feature 계약
                                      ↓
               백엔드 FastAPI (저장·집계·리포트·WS broadcast)
                                      ↓
               사용자(내담자) + 상담사 화면 (모드 무관 동일 UX)
```

핵심 원칙:
- **신호처리·지표 추출은 클라이언트(웹/웹뷰 JS)에서 처리** (haru_band_app simulator 모드와 동일).
- 네이티브 앱은 **하이브리드(웹뷰)** — 블루투스·기본 신호취득·푸시만 네이티브, 나머지는 웹뷰(동일 JS 신호처리 로직).
- FeatureWorker(서버 처리)는 나중에 필요 시(logic_server 모드) 도입.

## 2. SDD 로드맵 (단계적 · 네이티브 앱은 후순위)

| SDD | 범위 | 목적 | 시점 |
|-----|------|------|------|
| **SDD-030** | 신호처리 로직 고도화 (호흡수/몸지표/리포트) | 클라이언트(웹/웹뷰)에서 처리될 지표 로직 개발 | **지금** |
| SDD-031 | FeatureWorker 서버 (raw→feature) | ~~서버측 신호처리~~ **제외** — 나중에 문제 생기면 구현 | 제외 |
| SDD-032 | 네이티브 하이브리드 앱 (웹뷰) | BLE·신호취득·푸시만 네이티브, 나머지 웹뷰 | **후순위** |

> 우선은 **클라이언트(웹/웹뷰 JS)에서 신호처리**하는 구조로 개발한다. FeatureWorker(logic 서버)는
> 제외하고, 나중에 문제가 생기면 도입한다. 네이티브 앱도 웹 검증 완료 후 순차 도입.

## 3. 각 SDD 상세 범위

### SDD-030 — 신호처리 로직 고도화 (기획 완료)
- 호흡수 산출(PPG RSA), 몸 지표(BPM/HRV/호흡수) 실시간 전달, 리포트 상세화
- 신호처리 로직(순수 TS, 플랫폼 독립) 개발 — 웹/웹뷰 클라이언트에서 동일 동작
- 상세: `spec.md` (기존 기획)

### SDD-031 — FeatureWorker 서버 구축 + 웹 호출 테스트
- haru_band_app `feature-worker`(Node.js, port 3001)를 mindbreeze에 이식
- `POST /sessions/:id/eeg` — 250Hz raw 1초 배치 → 버퍼 → EEGSignalProcessor → 마음 지표
- `POST /sessions/:id/ppg` — 50Hz raw → PPGSignalProcessor → BPM/HRV/호흡수
- `POST /sessions/:id/acc` — 30Hz raw → ACCSignalProcessor → 움직임
- raw 버퍼 누적(임계값 도달 시 처리) + 세션 상태 관리(session-manager)
- **웹 호출 테스트**: 웹 프론트가 BLE raw를 수집해 FeatureWorker로 POST, 서버 지표를 받아 표시 (프론트 처리 ↔ 서버 처리 전환 모드)

### SDD-032 — 네이티브 앱 (iOS/Android, 후순위)
- BLE 수신: iOS CoreBluetooth / Android BluetoothGATT
- raw 1초 배치를 FeatureWorker로 전송
- LINK BAND SDK(SDK-iOS/SDK-Android) 재사용
- **나중에 진행** — 웹 + FeatureWorker 검증 완료 후

## 4. 개발 순서·우선순위

1. **SDD-030** 먼저 — 웹 모드는 이미 동작 중이므로 지표 품질을 먼저 완성 (호흡수·몸지표·리포트)
2. **SDD-031** — FeatureWorker 서버 구축 + 웹에서 호출해 서버측 신호처리 테스트
3. **SDD-032** — 네이티브 앱 (나중에, 후순위)

## 5. 핵심 결정 사항 (확정 필요)
- 신호처리 로직 공유: 프론트 `lib/eeg/`를 npm 패키지로 추출해 FeatureWorker와 공유할지 (웹/서버 지표 일치 보장)
- 웹 FeatureWorker 전환 방식: 환경변수/설정 토글 vs 개발 전용 라우트
