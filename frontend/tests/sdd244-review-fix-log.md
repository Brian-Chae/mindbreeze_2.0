# SDD-244 B 리뷰 High 8 · Medium 3 수정 기록

- 작업 기준: `6a1de353`(B `90ad975d` + 서버 A 병합). 백엔드/계약 원본 수정 없음.
- 구현 검증: 관련 **17파일 261/261 통과**, `npx tsc --noEmit -p tsconfig.app.json` 종료 **0**. 전체 vitest/build/독립 계약 검증은 감독 결과를 별도로 기록한다.
- 테스트 실행 설정: `/tmp/sdd244-vitest.config.mts`(저장소 설정 + 이미 설치된 fake-indexeddb alias). 실제 브라우저/BLE/OS/객체 저장소 시험 아님.

## 항목별 원인 · 수정 · 재현

| 항목 | 원인 / 변경 | 재현과 검증 |
|---|---|---|
| H01 | 모든 그룹을 선제 제거하던 방식 → 성공한 그룹만 제거. 실패를 호출자에 전파. raw_derived 저장 뒤 feature 실패 시 묶음 식별자를 draft에 고정해 새 emit과 섞이지 않게 함. | `sdd244-review-core`: 첫/중간 신호 그룹 실패 2건, derived 성공→feature 실패→새 emit→재시도. RED `/tmp/sdd244-review-core-red.log`, GREEN focused. |
| H02 | emit/표시 행이 메모리에만 존재 → account/session/participant scope별 IndexedDB draft를 즉시 예약. outbox 저장과 draft 제거를 같은 tx로 수행. 네트워크 전송보다 로컬 flush를 먼저 수행. 새 collector/recorder 복원 및 raw ACK 메타 보존. 미봉인 source가 있으면 close 성공 금지. unmount 쓰기 실패 runtime은 같은 scope 재진입까지 메모리 보존. 2,000 feature 도달 시 새 사본을 보존하며 수집 중단. | `sdd244-review-core`: flush 전 collector/recorder 재생성 복원, 실패 묶음 재시도. RED `/tmp/sdd244-review-durable-red.log`, GREEN `/tmp/sdd244-review-durable-green.log` 및 focused. |
| H03 | close가 업로더까지 해제 → close 후 lease/업로더 유지, online 이벤트 재개, 밴드 없는 재진입의 scoped backlog 조회. 복구-only 세션은 stopped/closed이며 새 display/model을 만들지 않음. offline 초기화 실패는 online에서 재초기화. | `sdd244-capture-hook`: offline close→online 자동 전송, unmount→밴드 없는 재진입→전부 ACK→추가 표시 tick 객체 0. RED `/tmp/sdd244-review-hook-red.log`, GREEN `/tmp/sdd244-review-remount.log`. |
| H04 | 수신 개수만으로 index 연속 증가 → packet tick 경과와 샘플 수 비교, 불연속은 새 segment + packet_gap. 각 segment 첫 샘플 UTC/monotonic에서 rows−1만큼 빼고 sourceWindow에 같은 anchor 적용. 역방향 clock의 gap 경계는 정렬. | `sdd244-review-core`: tick 1초 공백, raw 헤더 first-sample 차이 1,000,000µs, gap 10,004,000→10,964,000µs 및 feature window anchor 일치. RED `/tmp/sdd244-review-clock-red.log`, GREEN focused. |
| H05 | stopReason/quota/대기/blocked가 화면 미전달, raw 실패 사본 제거 → `recordingStatus`를 useBand에서 노출하고 회원/상담사 화면에 짧은 기록 상태·전송 건수·재개 버튼 제공. 점수/생리 판정 없음. raw 실패 사본은 저장 성공까지 보존하고 sealOpen에서 재시도. local_write_failed gap 실패도 메모리 보관 후 재시도. | `sdd244-review-core`: journal 실패→중단→재시도→raw 복원 RED `/tmp/sdd244-review-write-red.log`. 회원 실제 DOM의 quota·대기·재개 버튼 테스트. 화면 테스트 작성 후 원래 MemberClassContainer를 일시 복원한 RED replay `/tmp/sdd244-review-status-red-replay.log`, 수정 복원 GREEN `/tmp/sdd244-review-replay-green.log`. |
| H06 | ClassPlayerPage recorder 미배선 → useBand displayViewKind=session_player, 1Hz 기록. 실제 상담사 본인 UI는 이완도 칩만 표시하므로 같은 `toHostParticipant` 뷰 모델의 이완도만 displayed, 나머지 5개는 not_rendered. 회원 6지표 표시/저장 경로와 구별. | `class-player-page-live`: 60초 60회 record + session_player 배선. RED `/tmp/sdd244-review-ui-red.log`, GREEN focused. 실제 DOM 60초 BLE 동시 측정은 미실행. |
| H07 | 신호 전체 sequence 공유 → signal/stream/segment별 0부터 증가, alias에 segment 포함, close에 해당 scope 최종값. 복구 전 raw/feature/indices 메타도 close 집계. | `sdd244-review-core`: 2개 segment feature 0,1 / 0 및 close [1,0]. 테스트 작성 후 신호별 구 구현으로 일시 되돌린 RED replay `/tmp/sdd244-review-h07-m02-red-replay.log`, 수정 복원 GREEN. |
| H08 | 모델별 normalization이 동일 sequence=0 슬롯 → 내용 alias별 sequence를 IndexedDB에 영속 할당, A→B→A에서 A 슬롯 재사용. | `sdd244-review-core`: 모델 A/B의 두 슬롯과 A 재사용. RED `/tmp/sdd244-review-core-red.log`, GREEN focused. |
| M01 | RR reset에서 cursor만 초기화 → RR/timestamp/BPM/호흡 중앙값·주파수/맥박 평활 이력도 초기화. 이전 시간 구간을 60초 gate에서 제외. | `sdd244-algorithms`: 이전 구간100박 후 clock reset, 새 구간50박 null→90박 12~18회/분. RED `/tmp/sdd244-review-clock-red.log`, GREEN focused. |
| M02 | 비동기 모델 등록을 기다리지 않고 tick → 표시 값·모델·호출 시각을 함께 복사하여 직렬 record. 등록 실패 요청은 메모리에 남기고 flush가 재시도/실패를 전달. 회원은 렌더 시점 normalizationModel을 넘김. | `sdd244-review-core`: 첫 B 값과 B 모델, 2초 호출 후 async 완료가 9초여도 표시 시각2초. 테스트 작성 후 기존 non-awaited setModel/tick 순서를 일시 복원한 RED replay `/tmp/sdd244-review-h07-m02-red-replay.log`, 수정 복원 GREEN. |
| M03 | 네트워크 카드에서도 6개 값 모두 표시 주장 → 네트워크·sheet·hero가 확정된 MemberLiveScreen에서 displayedKeys 결정. status sheet는6개, 일반 화면은 hero만, netDown+sheet 닫힘은0개. hidden/screenOff는 미렌더. recordDisplay optional 호출 제거 및 기존 mock 보강. | `sdd244-review-core` 지표별 not_rendered, `class-player-member-container` 실제 끊김 카드+닫힌 sheet에서 displayedKeys=[]. RED `/tmp/sdd244-review-visibility-red.log`, `/tmp/sdd244-review-ui-red.log`, GREEN focused. |

## 실제 서버 API 계약 정합

- `putEegRawToPresignedUrl`: headers가 주어지면 그대로 PUT. legacy에서 인자가 없을 때만 기본 Content-Type. lowercase content-type·checksum·SSE 헤더로 실제 함수 fetch 인자 검증. 추가 Content-Type이 섞이던 RED → 수정 GREEN (`sdd244-api-contract`).
- 응답 `chunks[]`에서 개별 ACK ID·alias·checksum·size·verified_at_us·`upload_status === uploaded` 확인. 집계 acked=1이어도 pending/failed는 삭제하지 않는다.
- 409 `chunk_identity_conflict`, `artifact_conflict`, `alias_conflict` 모두 실제 ApiError→uploader→durable dead_letter 경로로 검증, payload 보존.
- feature presign에 `feature_id_aliases[]` 전달 검증. close intent `expected_artifacts`, stream/segment별 순번, snapshots, last_gap_sequence와 `lost_artifacts[{kind,alias,reason}]` 타입/전송 경로 검증. 자동으로 회복 가능한 사본을 lost로 선언하지 않는다.
- events는 명시적 `recorded`/`duplicate`만 sent 처리.
- 독립 서버 DTO 검증용 실제 FE runtime 산출물 `/tmp/sdd244-review-wire.json` 생성. raw header·algorithm/raw_derived/feature/normalization/indices meta+bytes·close intent 포함. 임시 export 테스트를 실행 후 원래 테스트 파일로 복원했고 지속 파일쓰기 테스트를 추가하지 않았다.

## 검증 명령

```sh
cd frontend
npx vitest run --config /tmp/sdd244-vitest.config.mts tests/sdd244-*.test.ts tests/sdd244-*.test.tsx tests/class-player-member-container.test.tsx tests/class-player-page-live.test.tsx tests/raw-chunk-queue.test.ts tests/use-eeg-raw-upload.test.tsx tests/sdd222-band-reconnect.test.tsx tests/sdd222-raw-upload-resume.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

focused 로그 `/tmp/sdd244-review-focused.log`: **17파일, 261 통과, 실패0**. tsc 로그 `/tmp/sdd244-review-tsc.log`: 출력 없음, 종료0. 전체 기준선은 감독이 확인한 **2904통과/17실패, 8파일**이며 본 구현자의 focused 숫자에 섞지 않는다.

## 남은 위험 / 서버 소유 결함

- 실제 브라우저 강제 종료·다중 탭·BLE 3신호 60분·모바일 background·객체 저장소 PUT/ACK는 미검증. fake-indexeddb, React jsdom, 합성 tick 및 모의 API의 증거다.
- 저장 장치가 모든 쓰기를 거부하는 동안 브라우저 프로세스까지 종료되면 아직 영속되지 못한 메모리 사본을 보장할 수 없다. 이 상태는 중단/오류로 표시하고 성공 close로 숨기지 않는다. unmount만으로는 retained runtime을 보관하고 같은 scope에서 재시도한다.
- tick→UTC는 host_estimated, parser profile unverified. gap 분리의 시간 복원 시험은 합성 입력이며 실기기 tick 정확도 인증이 아니다.
- draft를 emit/표시마다 저장하므로 IndexedDB 트랜잭션 부하가 늘어난다. 60분 메모리·notify→durable p99·20명 동시 비용은 미측정이다.
- 상담사 이완도는 서버/소켓 행을 정규화한 뷰 모델이다. source_feature가 확인되지 않으면 remote_fallback 사유이며 로컬 feature라고 주장하지 않는다. 다른 참가자 수치를 본인 indices로 저장하지 않는다.
- 서버 소유 결함(읽기 대조): `biosignal_manifest_service.py`의 feature/indices 순번 coverage 및 source_feature_alias 미해석 판정은 lost 선언을 제외하지 않아 특정 loss 선언만으로 partial에 도달하지 못할 수 있다. presign 전 expected+lost 항목은 DB presign row 기반 manifest 목록에 빠질 수 있다. FE는 사본/정직한 순번을 보존하고 backend는 수정하지 않았다.
- 기존 17개 전체 실패·SDD234 생성 산출물 원복·최종 독립 리뷰/커밋/push는 감독 최종 기록 참조.

## 독립 리뷰 후 경계 보완

- H03: cleanup의 봉인/flush/lease 반환이 끝나기 전에 새 mount가 lease를 얻으려던 경합을 scope별 Promise barrier로 직렬화했다. startup 중 취소도 lease 반환 완료까지 기다리며, 다른 탭 lease 점유는 inactive 대신 stopped/lease_lost로 표시한다. 의도적으로 cleanup을 지연한 즉시 remount 테스트 **RED→GREEN**.
- M02: 렌더 후 effect에서 활성 모델 캐시를 다시 읽던 마지막 경계를 없앴다. `useBand`가 모델 사본을 고정하고 `scoreIndices(raw, model)`로 계산한 값과 함께 반환한다. Member recorder는 그 사본만 전달한다. 모델 A의 표시 값이 남은 상태에서 effect 전 캐시 B로 교체하는 테스트 **RED→GREEN**.
- 경계 재현 로그: `/tmp/sdd244-review-boundary-red.log` 2실패 → `/tmp/sdd244-review-boundary-green.log` 2통과. 최종 focused는 **17파일 261통과**, 최종 tsc 종료0.


## H04 간헐 실패 후속 수정 (2026-10-24)

- 직접 원인은 **테스트의 순서 가정**. 수정 전 `sdd244-review-core.test.ts:59`의 실패값은 gap 길이가 아니라 raw 헤더 anchor 차이다. `durable-queue.ts:190,211-214`는 실시간 밀리초 createdAt으로 정렬하므로 동률이면 IndexedDB의 UUID alias 키 순서가 유지된다. 부하/실행 속도에 따라 동률 여부가 달라졌고 랜덤 UUID가 헤더 순서를 뒤집었다. packet tick/host UTC/monotonic 입력 자체는 이미 명시적 합성 값이며 공유 상태나 receive 비동기 순서 경합이 원인이 아니다.
- 재현: queue 시계를 10000ms에 고정하고 앞 8자리가 감소하는 유효 UUID를 주입했다. 기존 배열 인덱스 검증이 정확히 `expected -1000000n to be 1000000n`으로 실패(`/tmp/sdd244-h04-order-red.log`). 수정은 저장 배열이나 anchor값으로 정렬하지 않고 실제 raw binary packet_map의 `packet_seq`로 수신 순서를 식별한다. 1초 anchor 차이, 960ms packet_gap, feature window anchor 검증을 유지했다.
- 별도 **제품 결함**: 수정 전 `capture-session.ts:292-301` 재연결은 Date.now 역행 시 음수 ble_disconnect gap을 그대로 만들었다. `durable-queue.ts:168`에도 영속화 방어가 없었다. 재연결 역행은 길이 미상 ble_disconnect와 정렬된 clock_reset을 따로 남기고, segment 역행도 clock_reset으로 분류한다. 모든 addGap 호출은 저장/순번 소비 전에 음수 구간을 거절한다. 제품 회귀 3건을 RED에서 확인한 뒤 GREEN으로 전환했다(`/tmp/sdd244-h04-red.log`, `/tmp/sdd244-h04-green.log`).
- 다른 SDD244 테스트를 `Date.now/performance.now/setTimeout/objects` 패턴으로 조사했다(`/tmp/sdd244-h04-clock-audit.log`). review-core 복원 recorder도 동일 시계로 맞췄다. capture-hook의 30/100/120ms 완료 추정은 실제 DisplayRecorder 초기화, ACK receipt·빈 큐·전송 완료 이벤트 조건으로 교체했다. fake-indexeddb 비동기 완료까지 멈추는 전역 fake timer 대신 주입 시계와 상태 조건 대기를 사용했다. 알고리즘 시간 검증은 이미 fake timer, 나머지 raw clock 검증은 명시적 UTC/monotonic 입력이었다.
- 독립 검증자는 구현 diff를 읽고 관련 2파일 **20/20 통과**를 별도 실행했다(`/tmp/sdd244-h04-independent-review.log`). 실제 BLE/기기/서버 검증은 수행하지 않았다.


### 최종 검증

- 사용자 지정 명령 그대로 실행: `npx vitest run tests/sdd244-*.test.ts* tests/raw-chunk-queue.test.ts tests/use-eeg-raw-upload.test.tsx tests/sdd222-*.test.ts*` → **10/10회 성공, 매회 30파일·280건, 합계 2,800/2,800 통과**. `/tmp/sdd244-h04-exact-{1..10}.log`. 기존 `/tmp/sdd244-vitest.config.mts` 설정으로 선행한 별도 10회도 동일하게 성공했다.
- `npx tsc --noEmit -p tsconfig.app.json` 종료 0(`/tmp/sdd244-h04-tsc-final.log`). `npm run build` 종료 0(`/tmp/sdd244-h04-build.log`, 기존 청크 크기·동적 import 경고).
- 전체 vitest(`npx vitest run --config /tmp/sdd244-vitest.config.mts`) **258파일 통과·8파일 실패, 2,933통과·17실패**(`/tmp/sdd244-h04-full.log`). 기존 `/tmp/sdd244-t11-full.log`의 실패 파일과 17개 테스트 이름을 스크립트로 전부 대조해 정확히 일치했다(`/tmp/sdd244-h04-baseline-compare.json`). 이전 전체 로그의 통과 수 2,904와는 테스트 추가로 다르며 전체 성공이라고 주장하지 않는다.

| 기존/현재 동일 실패 파일 | 실패 건수 |
|---|---:|
| agent-counselor-page.test.tsx | 2 |
| chat-message-deeplink.test.ts | 2 |
| org-counselor-management-browser.test.cjs | 1 |
| org-management-browser.test.cjs | 2 |
| report-modal-pdf.test.cjs | 2 |
| report-server-pdf.test.cjs | 2 |
| sdd220-native-release.test.ts | 2 |
| sdd234-a-mobile-home.test.tsx | 4 |

- 전체 테스트가 생성한 `specs/sdd-234-mobile-type-polish` 추적 산출물은 요청대로 `git checkout -- specs/sdd-234-mobile-type-polish`로 원복했다. 백엔드 변경 없음.
