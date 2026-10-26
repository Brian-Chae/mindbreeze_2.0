# T12-FE — 앱 측정 자동 시작 · 웹 WASM 번들 · v1 feature 업로드 차단

브랜치 `sdd/246-t12-fe`. 로컬 커밋만(push/배포/메일/삭제 0).

## 변경 파일
- `frontend/src/lib/native-measurement/index.ts`·`types.ts` — `startForSession`(JS 소유 해제 `setJSBandOwnership({owning:false})` → 자격 인계 → start; iOS=`peripheralId`, Android=`address`=MAC), `peripheralId` optional.
- `frontend/src/lib/measurement-web/use-native-measurement.ts`(신규) — `useNativeMeasurementV2`, `deterministicRequestId`(session+participant 멱등 UUID), `toMetricSnapshot`(focus_display/relaxation_display/emotion_display/bpm/respiration/sdnn, null 보존).
- `MemberClassContainer.tsx` — 훅 연결, native 소유 중 `snapshot`=native metrics, `v1FeatureUpload` 전달.
- `useBand.ts` — `v1FeatureUpload`(기본 true). false 면 REST feature 배치·WS feature emit·재전송·큐 적재 차단(raw 업로드 무관).
- `core.worker.ts` 정적 import로 WASM 연결, `vite.config.ts` `worker.format='es'`, `scripts/build-measurement-wasm.sh`, `package.json` `wasm:build`, `src/lib/measurement-web/wasm/`(산출물 커밋).
- 시험 `frontend/tests/sdd246-web/t12-native-start.test.ts`.

## 결정
- **산출물 커밋**: .wasm 434KB(+글루 13KB) < 수백KB 기준, deploy-dev 에 rust 없음, .gitignore 예외 불필요(무시되지 않음). wasm-bindgen CLI 0.2.129 = Cargo.lock 0.2.129(스크립트가 불일치 시 실패). Rust 코어를 바꾸면 `npm run wasm:build` 후 재커밋 필요.
- 웹 경로: native 일 때는 `WebMeasurementSession`/capture.start 를 만들지 않음(기존 `path==='web_wasm'` 가드). native 훅은 `webBluetooth:false`로 판정하여 웹 BLE와 무관.
- 종료: 화면 이탈 시에만 `stopMeasurement`(세션 end 는 native live:terminal).
- accountId=`authStore.user.id`. **한계**: 비로그인(입장 자격) 참가자는 accountId·refresh 토큰이 없어 `credentials_unavailable`로 표시하고 측정 없이 수업 진행(웹뷰 표시는 기존 useBand 경로 유지). 별도 설계 필요.
- 실패(`native_method_unavailable`, `js_band_release_failed`, `credentials_unavailable` 등)는 훅 `status='failed'`+`code`로 노출. 화면 문구 연결은 미수행.

## iOS 워커 요청
- `NativeMeasurementPlugin.swift:startMeasurement` 는 sessionId/credentialHandle/configHash/requestId 만 읽음 → `peripheralId`(BLE UUID, optional) 를 읽어 `MeasurementManager.startMeasurement` 에 전달해야 native 가 같은 밴드를 잡는다. 현재 facade 는 보내지만 iOS 에서 무시됨. configHash 는 현재 `'linkband2-v1'` 고정 — 계약 정의 확인 필요.
- 소유 인계 후 JS BLE disconnect 는 하지 않았다(setJSBandOwnership 가 소유를 놓는 방식). 필요하면 후속.

## 검증
| 항목 | 결과 |
|---|---|
| `npx vitest run tests/sdd246-web` | 12 파일 passed, 102 passed |
| 전체 vitest | 17 fail / 8 파일(기준선 동일), 3270 passed, 신규 실패 0 |
| `npx tsc -b` | 오류 0 |
| `npx eslint src tests/sdd246-web` | 오류 0 (wasm 산출물 경고 2) |
| `check-contracts.sh` | 통과 |
| `vite build --mode dev` | `core.worker-*.js` 별도 chunk + `measurement_core_bg-*.wasm`(434KB) 가 dist/assets 에 생성 |

## 남은 일 / 위험
- 실기기(iOS/Android) 자동 시작·소유 인계 미검증. v1 차단 시험은 소스 배선 검사 수준(useBand 훅 단위 시험 없음).
- `v2Path` 는 bandConnected 를 직전 렌더 ref 로 읽어 연결 직후 1렌더 늦게 반영될 수 있음(그 사이 v1 업로드 1회 가능성).
- 측정 실패 사용자 안내 UI 문구 미연결.
