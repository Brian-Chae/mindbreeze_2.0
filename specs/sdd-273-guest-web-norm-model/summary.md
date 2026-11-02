# SDD-273 — Summary

## 결과
| 항목 | 상태 | 근거 |
|---|---|---|
| 모델 미적용(집중·이완·감정균형 0/100 포화) | **원인 확정 + 수정** | 웹 WASM 코어가 `legacy_cohort` 고정, `set_model` 미호출(코드·시험으로 재현) |
| 호흡·HRV 차이 | **원인 미확정** (아래 가설) | 코어 입력 차이(앵커·도착 지터·BLE 묶음)로는 재현되지 않음 |

## 변경
- `frontend/src/lib/measurement-web/model-pin.ts`(신규): 활성 모델 조회(캐시→재시도 400ms/1.2s, 총 3초 한도), `buildNativeModelPayload` 재사용 검증, `sigmoid-<version>`/sha256 hash, `resolveWebCore`.
- `web-measurement-session.ts`: 시작 시 1회 조회·pin. capture.start `modelVersion` = 코어 config = envelope 메타 동일 문자열. 조회·검증 실패는 legacy 로 시작(세션 중 교체 없음).
- `core.worker.ts`·`capture-adapter.ts`: init 에 `modelJson`, 코어 생성 직후 `set_model`(실패 시 `init_error` → `core_unavailable`, 서버 요청 없음).
- 서버 변경 없음(`/normalization/models/active` 는 무인증 공개 라우터). WASM 재생성 불필요(`set_model` 기존 노출, WASM 산출물 = 현재 코어 소스 커밋).
- `packages/measurement-core/examples/replay_model.rs`(신규): 네이티브(FFI 와 같은 api 경로)로 golden 재생 → 표시 지표 JSON.
- 시험: `tests/sdd273-wasm-model.test.ts`, `tests/sdd273-session-model.test.ts`, fixture `tests/fixtures/sdd273/native-{legacy,active}.json`. 기존 `t06c-wiring`/`t06c-hook` 은 조회 mock 만 추가.

## 정책 결정(spec §3)
조회 실패 시 legacy 로 시작하고 **이후 모델이 도착해도 적용하지 않는다** — 네이티브 1회 pin 과 동일, 서버 stream 의 `model_version` 이 capture.start 에 고정되고, 도중 교체는 곡선 불연속을 만든다.

## 시험 실제 결과
- golden 합성 입력(149 프레임), 웹 WASM:
  - focus: 모델 없음 min0/max100 (포화 100프레임) → 모델 적용 min2/max100 (포화 48)
  - relaxation: 모델 없음 값 없음(코호트 폴백 없음) → 모델 72~87
  - emotion: 모델 없음 포화 98 → 모델 71~100 (포화 50)
- **웹(WASM) = 네이티브(Rust)**: 같은 패킷+같은 모델 → focus/relaxation/emotion 표시값 허용오차 0 완전 일치, bpm/resp/sdnn 1e-9 이내, 모델 미적용도 일치.
- vitest `tests/sdd246-web tests/sdd273` 134 passed / 1 skipped; 확장 묶음(sdd272·sdd244·fix-live/native/resp/hrv/ppg) 300 passed 후 훅 시험 1건 수정해 재통과. `tsc -b` 오류 0, eslint 오류 0.

## 호흡·HRV 규명 결과
같은 golden 입력으로 웹 방식 호출을 코어에 재현해 비교:
| 조건 | bpm | resp | sdnn |
|---|---|---|---|
| 네이티브 고정 앵커 vs 웹식 앵커(패킷마다 wallMs=Date.now, anchor=arrival) | 일치 | 일치 | 일치 |
| 도착 지터(지연 최대 140ms) | 평균 70.47 동일 | 15.00 동일 | 48.69→48.71 |
| BLE 묶음(2초·5초 경계 도착) | 70.47→70.48/70.45 | 15.00 동일 | 48.69→48.53/48.62 |

→ 코어는 앵커·도착 시각 차이에 둔감하다. 모델 정규화 변경은 호흡/HRV 에 영향 없음(모델 유무 resp/sdnn 동일 확인).

### 미확정 — 남은 가설(이번에 못 확인)
1. 화면 값 우선순위: `MemberClassContainer` 는 서버 LiveState(웹 코어가 보낸 값)를 우선 쓰고, 없을 때 로컬 `useBand` JS 분석값을 쓴다. 게스트는 두 출처가 번갈아 보일 수 있다(코드 추정, 실측 안 함).
2. `raw-capture.ts` 는 PPG 헤더를 big-endian 으로 읽는다(`getUint32(0, signal !== 'ppg')`). Rust 코어는 PPG 도 little-endian. 라이브 지표는 원문 bytes 를 코어에 넘겨 영향 없으나, 저장 경로(`capture-session`/`raw-clock`)의 PPG tick 에 영향 가능 — 저장 로직 불변 원칙으로 수정하지 않음.
3. 실기 BLE 환경(Web Bluetooth 알림 누락·중복·순서 역전)은 시뮬레이션 밖. dev 에 저장된 같은 회차 원시 재생은 시도하지 않았다(운영 vc40 데이터는 prod 이므로 접근 금지 범위).
- 필요 계측(additive 제안): 웹 경로에서 PPG 패킷 `status`(accepted/duplicate/out_of_order) 카운트를 `live-diag` 로 기록 → 실기 후 비교.

## 확인 못 한 것
실기(앱+JS BLE) 화면 확인, dev 원시 재생, 앱 번들 반영 후 동작.

---

## 추가 조사 (감독 근거: 운영 48h 집계 — 호흡 채움 회원 67%/비회원 15%, 비회원 150초간 0%, sdnn 평균 회원 45.6/비회원 71.1)

### 코드 비교 결과
| # | 항목 | 결과 |
|---|---|---|
| 1 | 엔디언 | `raw-capture.parseRawPacket` 의 `bytes` 는 `source` 복사본 그대로(가공 없음). `tickRaw` 만 PPG 를 big-endian 해석(`getUint32(0, signal!=='ppg')`)하며 Rust `parse_packet` 은 LE. `onRaw` 가 코어로 넘기는 것은 `p.bytes.slice()` 이므로 **코어 지표 입력에는 영향 없음** — `tests/sdd273-ppg-diag.test.ts` 가 bytes 동일·tickRaw 불일치를 직접 증명. 영향은 저장 경로(`capture-session`/`raw-clock`)의 PPG tick 에만 있음(불변 원칙으로 미수정). |
| 2 | 도착 시각 | ppg 도 `arrivalUs=receivedMonotonicUs`, `anchorUs=arrivalUs`, `wallMs=receivedUtcUs/1000` 로 EEG 와 동일하게 전달됨(시험으로 확인). 코어 샘플 시각은 **장치 헤더 tick 기준**(`clock.rs` 주석: arrival jitter 로 간격 재구성 안 함, `timeline.sample_times` 가 ext_tick→ms). 도착시각은 앵커·slew 보정에만 쓰임. |
| 3 | 구독 | `startDataStreams` 가 EEG→PPG→ACC 를 한 번에 구독. Capacitor 어댑터는 구독 전 `stopNotifications` 로 중복 방지. 웹 어댑터는 확인 못함(앱 경로는 Capacitor). 중복이 있으면 코어가 `duplicate` 로 걸러 지표 영향 없음(시험). |
| 4 | 표시값 출처 | `MemberClassContainer:277` `liveSnap`(서버 LiveState, 웹 코어값) 우선, 없을 때만 `useBand` 로컬 값. LiveState 에 값이 오가면 화면이 두 출처를 오갈 수 있으나, **운영 DB 의 저장값(코어 산출)이 이미 다르므로 표시 우선순위는 원인이 아님**. |

### 같은 PPG 바이트열을 JS 알림 모양으로 코어에 투입 (`tests/sdd273-ppg-delivery.test.ts`, 150초, 72bpm 합성)
| 입력 모양 | 호흡 채움(0-60/60-90/90-120/120-150프레임) | sdnn 평균 |
|---|---|---|
| 정상 | 0/90/100/100% | 45.9 |
| **패킷 유실 1/20 (10샘플)** | 0/80/100/100% | **81.7** |
| **패킷 유실 1/10 (10샘플)** | 0/70/100/100% | **96.2** |
| 패킷 유실 1/5 (25샘플) | 0/**0**/47/100% | 45.0 |
| **순서 뒤바뀜 1/10 (10샘플)** | 0/70/100/100% | **96.6** |
| 순서 뒤바뀜 1/10 (25샘플) | 0/**7**/100/100% | 58.1 |
| 정지 후 몰림(0.5~12초), 지연 누적, 지연 파동, 중복 | 정상과 거의 같음 | 45.6~46.1 |

- **확정**: 코어는 알림 *타이밍*(몰림·정지·지연)에는 둔감하다 → 이벤트루프 지연 가설은 기각. 
- **강한 후보(미확정)**: PPG 패킷 **유실·순서 뒤바뀜**. 1/10~1/20 유실만으로 sdnn 평균이 2배(비회원 71 vs 회원 46 과 같은 방향·크기)가 되고, 유실이 잦을수록 호흡 시작이 늦어진다(순서 뒤바뀜/유실 1/5 에서 60~120초 구간 7%~0%).
- **미설명**: 비회원의 "처음 150초 호흡 0%"는 시뮬레이션 최악 케이스(유실 1/5, 25샘플)에서도 120~150프레임 구간은 100%라 **완전히 재현되지 않음**. 실기에는 더 심한 유실/연속 끊김, 또는 코어 재시작(세션 재시작·segment reset)이 겹쳤을 가능성.
- 유실이 JS BLE 에서 생기는 지점 후보: Capacitor 브릿지 콜백 순서/드롭, `useBand` 와 같은 characteristic 에 이중 CCCD(코드 주석 `bluetoothService:996` 가 JS↔네이티브 이중 구독 시 드롭을 언급).

### 추가한 계측(additive, 동작 불변)
- `measurement-web/ppg-diag.ts`: PPG `accepted/duplicate/out_of_order/conflict/invalid` 판정 누계(워커 1초 tick 으로 전달), 알림 `pkts`, 1.5초↑ 공백 `stall`, 5ms 이내 몰림 `burst`.
- `entry-state` 요청 쿼리에 `pd=a120.d0.o3.c0.i0.p125.s2.b40` 형태로 첨부 → 서버 접근 로그에서 게스트 실기 회차별 PPG 입력 품질 확인 가능(개수만, 민감정보 없음). 기존 `ld` 형식·시험 불변.

### 시험
- `vitest tests/sdd273 tests/sdd246-web tests/fix-live-diag tests/class-flow*`: **61 files passed / 749 passed / 1 skipped**
- `tsc -b`: 오류 0. eslint: 오류 0(기존 경고 2건은 본 변경 외 파일).

### 다음 단계(실기 후)
실기 게스트 1회 후 `pd` 의 `o`(out_of_order)·`d`·`s`·`b` 확인 → o/ 유실이 크면 JS BLE 구독 경로(이중 CCCD·Capacitor 콜백 순서)를 수정 대상으로 확정. 원인 확정 전 PPG 처리 로직은 변경하지 않음.
