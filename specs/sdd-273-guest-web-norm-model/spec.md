# SDD-273 — 비회원(코드 입장) 웹 측정에 표준 분포 모델 적용 + 호흡·HRV 차이 규명

- 상태: Stage ① Spec
- 브랜치: `sdd/273-guest-web-norm-model` (base: origin/develop)
- 작성일: 2026-11-02

## 1. 증상
대표 실기(운영 vc40, 11/2): 같은 앱에서 회원 입장과 비회원 코드 입장의 실시간 지표가 다르다. 비회원은 집중도·이완도·감정균형도가 0/100을 오가고, 호흡·HRV도 이상하다.

## 2. 코드 근거(직접 재확인)
| 항목 | 위치 | 사실 |
|---|---|---|
| 게스트 경로 | PR #226, `measurement-path.ts`, `use-native-measurement.ts` `accountId: user?.id ?? null` | 코드 입장 게스트는 `accountId=null` → 네이티브 `hasIds` 거짓 → 앱에서도 `web_wasm`(JS BLE + WASM 코어)으로 측정 |
| 회원 경로 | `use-native-measurement.ts:137` | 시작 시 `refreshActiveModel` → `buildNativeModelPayload` → 네이티브 `ModelPin`(active_sigmoid, 1회 pin) |
| 웹 경로 | `core-config.ts` | `model_mode: legacy_cohort`, `model_version: b0-cohort-2`, hash `a×64` 고정. `web-measurement-session.ts`·`core.worker.ts` 어디에도 `set_model` 호출 없음 |
| 코어 | `engine.rs:814~` | `ActiveSigmoid` 모드는 `set_model` 없으면 `model_unavailable`, `LegacyCohort`는 코호트 상수 점수 → 포화(0/100) 가능 |
| 서버 조회 | `normalization.py` `public_router` `/models/active` | **무인증 공개**(의존성 없음, 집계 m/s만 노출). 게스트도 호출 가능 → 별도 서버 변경 불필요 |
| 서버 검증 | `session_live_ingest.py`, `session_live_v2.py` | `model_version`은 형식(`_VERSION_RE`)만 검증, 모델 해시 대조 없음. capture.start 값 = envelope 값만 일치하면 됨 |

## 3. 결정
1. 웹 WASM 시작 전에 서버 활성 모델을 조회해 코어를 `active_sigmoid`(+`model_version`/`model_hash`)로 구성하고 `set_model`을 1회 호출한다. 검증은 네이티브 `buildNativeModelPayload`(= `parseModelParams`: s>0, direction ±1)를 재사용한다.
2. `model_version = sigmoid-<서버 version>`, `model_hash = sha256(정규화 params JSON)` — Android `ModelPin`과 동일 규칙. capture.start(`modelVersion`)와 envelope 메타·코어 config가 모두 같은 문자열이다.
3. **조회 실패 정책**: 캐시 → 조회 → 실패 시 짧게 재시도(400ms, 1.2s, 총 3초 한도). 끝내 못 받으면 legacy_cohort로 시작하고 **세션 중 모델을 교체하지 않는다.** 근거: (a) 네이티브도 시작 시 1회 pin, 교체 금지; (b) 서버 stream의 `model_version`은 capture.start에 고정되므로 중간 교체 시 코어 산출 버전과 어긋남; (c) 도중 교체는 같은 회차 곡선에 불연속(점프)을 만든다.
4. 모델이 없거나 유효 지표 0개면 기존 legacy_cohort 유지.
5. 회원이 브라우저에서 들어오는 웹 경로도 같은 `WebMeasurementSession`을 쓰므로 같은 수정으로 해결된다.
6. 서버 계약 변경 없음, 저장·업로드·ingest 판정 로직 불변. 금지 표현(점수·좋음/나쁨·완료·100% 단정) 새 문구 없음.

## 4. 호흡·HRV 차이 규명(필수)
모델 정규화와 무관한 PPG 기반 지표이므로 경로 비교 결과는 `summary.md`에 원인 확정/미확정을 구분해 기록한다. 비교 대상: 도착 시각(`arrivalUs`/`wallMs`/`anchorUs`), PPG 시각 재구성, 패킷 중복·순서·묶음 처리, `WebCaptureAdapter.pushPacket` 변환, tick 처리.

## 5. 비범위
WASM 재생성(코어 변경 없음 — `set_model`은 이미 WASM에 노출), 앱 빌드, 푸시·PR·배포.
