# SDD-244 B T07~T11 검증 전용 리뷰

- 검토일: 2026-10-24. 판정: **수정 후 재검증 필요**.
- 대상: `git diff 7f654f12..origin/sdd/244-b-frontend -- frontend`. HEAD와 대상 ref는 모두 `90ad975dd8b36b81b141539feba6eab5648a8f0f`.
- 서버 계약: `origin/sdd/244-a-server` (`d56f1457e47e68411cba4b07b618b3b3ed83f0c2`)의 `specs/sdd-244-biosignal-raw-pipeline/contracts/api-v1.md`. 아래 `A/api-v1.md` 행 번호는 이 원격 ref의 문서 기준이다.
- 기준: 로컬 spec/plan/verify, contracts 전체 구조·fixture, `frontend/tests/sdd244-work-log.md`. 구현자와 분리된 읽기 전용 검증이며 계약/표시 및 알고리즘은 별도 검증자가 교차 검토했다.
- 집계: **Critical 0 / High 8 / Medium 3 / Low 0**. 기능 누락·데이터 보존 및 계약 위반은 High, 제한된 상태의 표시/알고리즘 오류는 Medium으로 분류했다.
- 코드·계약·기존 테스트 수정 없음. 커밋·push·PR·배포·서버 실행·DB·.env·메일·삭제 작업 없음. 작성 파일은 본 보고서 하나다.

## 실행 증거와 한계

| 검증 | 결과 |
|---|---|
| 대상/관련 vitest 13개 파일 | **149/149 통과**, 7.42초 |
| `npx tsc --noEmit -p tsconfig.app.json` | 종료 코드 0 |
| 실제 FeatureCollector 실패 주입, 파일 생성 없이 Node/TypeScript 메모리 transpile | 대기 3건 → 첫 저장 실패 후 **1건**, unresolved=0 |
| 실제 capture session + fake-indexeddb, 패킷 시간 간격 독립 재현 | 실제 1,000,000µs 간격 → 헤더 시간축 **40,000µs**, gap 0 |
| 알고리즘 검증자의 실제 AnalysisMetricsService 독립 실행 | clock reset 이후 새 구간 90박에도 elapsed 음수, 호흡 null |

실행 명령(cwd=`frontend`):

```sh
npx vitest run --config /tmp/sdd244-vitest.config.mts tests/sdd244-*.test.ts tests/sdd244-*.test.tsx tests/raw-chunk-queue.test.ts tests/use-eeg-raw-upload.test.tsx tests/sdd222-band-reconnect.test.tsx tests/sdd222-raw-upload-resume.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

기존 `/tmp/sdd244-vitest.config.mts`를 읽어 확인한 뒤 재사용했다. 이 설정은 저장소 vitest 설정을 상속하고 fake-indexeddb만 기존 `/tmp/sdd244-test-deps`로 연결한다. 의존성을 설치하거나 공유 node_modules를 수정하지 않았다. 전체 vitest/build는 재실행하지 않았다. work-log의 전체 기준선 실패 17건은 이번 실행 결과로 재확인한 수치가 아니다. 실제 브라우저/BLE/OS suspend/서버 API/객체 저장소 검증은 수행하지 않았으며 fake-indexeddb 통과를 그 증거로 해석하지 않는다. SDD-234 산출물 변경은 발생하지 않았다.

## High

### H01 — 첫 feature 그룹 저장 실패 시 나머지 신호 그룹이 조용히 유실된다

- 근거: `frontend/src/lib/biosignal/feature-collector.ts:118-135`. 모든 그룹을 만든 뒤 `this.pending = keep`으로 대기열에서 제거한다. 첫 `bundle()` 실패 시 해당 그룹만 되넣고 throw하므로 아직 순회하지 않은 그룹은 사라진다. `:85-87`은 예외를 로그로 삼켜 호출자에게 성공처럼 반환한다.
- 재현(실행): EEG/PPG/ACC 각 1건 emit, 각 원창은 봉인 완료로 제공, queue.enqueueArtifact에 저장 실패 주입, `flush(true)` 호출. **pendingCount 3 → 1, unresolved 0**. 실제 FeatureCollector를 실행했고 저장 경계만 실패 주입했다.
- 영향: 이후 재시도·close expected 목록에서도 두 그룹이 빠진다. 모든 emit 보존(`verify.md:64-66`)을 위반한다.
- 수정 제안: 각 그룹은 저장 성공 후에만 대기열에서 제거하거나, 실패 시 미처리 그룹 전체를 복구한다. 실패를 close 호출자에게 전달하고 3신호 중 첫/중간 그룹 실패 테스트를 추가한다.

### H02 — 오프라인에서 feature/indices 로컬 영속화까지 멈추고, unmount·종료 실패 시 사본이 사라진다

- 근거: `frontend/src/hooks/useBiosignalCapture.ts:91-96`은 `navigator.onLine === false`이면 collector/display flush 이전에 반환한다. `:137-143` cleanup은 runtime을 지우고 raw session.pause만 호출한다. feature는 `feature-collector.ts:53,73-81`의 메모리 pending, 표시 행은 `display-snapshot.ts:159,202-204`의 메모리 rows에 있다.
- 재현: 오프라인으로 분석 emit/표시 tick을 쌓은 뒤 페이지 이동 또는 reload. raw journal은 남아도 미봉인 feature/indices는 복구할 영속 레코드가 없다. feature가 2,000건을 넘으면 `:73`에서 추가 emit도 카운터만 올리고 버린다. UI로 이 카운터를 전달하는 경로가 없다.
- 종료 변형: collector/display의 `flush()`는 저장 오류를 삼킨다(`feature-collector.ts:86`, `display-snapshot.ts:208`). `useBiosignalCapture.ts:152-160`은 그 후 close intent를 작성하고 runtime 종료를 유발한다. 아직 메모리인 항목은 expected set에도 없다.
- 영향: 오프라인 수집의 주요 산출물이 조용히 누락된다. raw가 존재한다는 사실만으로 당시 처리 결과/표시를 복원할 수 없다.
- 수정 제안: 로컬 journal/outbox 쓰기와 네트워크 전송을 분리한다. emit/표시 행을 crash-recoverable하게 보관하고 종료 실패를 상위에 전달한다. 미저장 항목은 성공 종료에서 제외하지 말고 pending/loss로 명시한다.

### H03 — 오프라인 종료 후 업로더가 꺼지고, 밴드 재연결 없이는 영속 큐를 재개하지 못한다

- 근거: `useBiosignalCapture.ts:62-75`의 armed/active는 밴드 연결로만 시작된다. `:155-160`은 close 후 pump가 오프라인으로 반환해도 `setArmed(false)`를 실행한다. `:137-143`은 업로드/lease 타이머와 runtime을 제거한다. 새 mount에서도 밴드 미연결이면 capability/복구/업로더가 시작되지 않는다.
- 재현: 밴드 연결→오프라인→수동 disconnect/종료→온라인 복귀. `useBand.ts:1116`이 close를 호출한 뒤 v2 pending raw/artifact/close intent는 남지만 자동 전송 경로가 없다. 같은 페이지를 밴드 없이 다시 열어도 같다. legacy 업로더는 v2 store를 처리하지 않는다.
- 영향: payload 자체는 남아 있으나 회차의 업로드와 manifest가 새 BLE 연결에 종속되어 완료되지 않는다.
- 수정 제안: 계정/회차 범위를 지키는 복구 업로더를 수집 연결 수명과 분리한다. 종료 후에도 pending을 drain하고, 온라인 복귀·밴드 없는 재진입에 재개한다.

### H04 — 수신 사이의 실제 시간 공백을 연속 샘플로 압축하고 packet_gap을 남기지 않는다

- 근거: `capture-session.ts:135-155`는 첫 패킷에서만 anchor를 정하고 다음 패킷의 firstSampleIndex를 수신 개수로 연속 증가시킨다. `:227-230`은 이 인덱스를 고정 rate 시간축으로 선언한다. `raw-clock.ts:49-52`는 tick과 host 시간이 함께 전진하면 segment를 바꾸지 않는다. 실제 패킷 tick 간격과 정상 샘플 개수를 비교하는 packet_gap 생성 경로가 없다.
- 재현(실행): EEG 10샘플 패킷 2개, tick 0/32768, host·monotonic도 1초 간격으로 입력 후 close. journal firstSampleIndex는 0/10, 헤더 sample_count=20, gap=0. 고정 250Hz 헤더 기준 두 패킷 첫 샘플 차이는 **40ms**, 실제 tick 차이는 **1초**다.
- 영향: 패킷 bytes/tick은 남지만 정본 헤더로 복원하는 sample timestamp와 feature source window가 틀린다. BLE 단절 후 tick이 계속 흐르는 경우에도 발생할 수 있다.
- 수정 제안: packet tick으로 기대 첫 샘플 시각을 검증하고 공백은 gap+새 segment 또는 계약상 명시적 시간 매핑으로 표현한다. 합성 손실 패킷을 넣어 decoder/feature 시각까지 대조한다.

#### H04 후속 감독 재검증 (2026-10-24)

- 간헐 `-1000000n`은 gap 부호가 아닌 테스트의 헤더 배열 순서 오류였다. createdAt 동률 + 역순 UUID로 결정적으로 RED 재현했고, 실제 원문 packet_seq로 헤더를 식별해 기존 1초/960ms/feature anchor 검증을 유지했다.
- 별개로 재연결 wall clock 역행의 실제 음수 gap 저장 결함을 확인했다. addGap 영속 경계에서 음수 구간을 거절하고, 재연결은 unknown ble_disconnect + clock_reset, segment 역행은 clock_reset으로 보존한다. 제품 경계 3건 RED→GREEN.
- 자세한 원인·파일:행·검증 로그 및 전체 실패 대조는 `frontend/tests/sdd244-review-fix-log.md`의 H04 후속 절에 기록한다.

### H05 — quota·journal·lease 실패로 v2 기록이 중단되어도 화면에는 실패 상태가 전달되지 않는다

- 근거: `capture-session.ts:163-167,195-204,281-287`은 기록을 중단한다. `useBiosignalCapture.ts:164-180`은 stopReason/quotaWarning/pendingCount/blockedCount/resumeBlocked를 반환하지만, `useBand.ts:456-467,1728-1743`은 이를 소비 화면에 노출하지 않고 recordDisplay만 전달한다.
- 재현: BLE는 연결한 상태로 quota 95% 또는 journal 쓰기 실패 주입. v2 session은 stopped, 후속 패킷은 `capture-session.ts:125`에서 버려지지만 기존 분석/연결 UI는 계속 진행한다. quota 경고나 durable dead_letter 재개 동작을 사용자가 볼 수 없다.
- 영향: '기록 중'으로 인식한 채 EEG/PPG/ACC raw와 후속 feature를 잃는다. 로컬 gap 기록조차 quota로 실패하면 `:202-203`에서 예외를 삼킨다. `plan.md:178`의 명시적 상태 표시 요구에 미달한다.
- 수정 제안: BLE 연결 상태와 기록 상태를 분리해 UI에 경고·중단·미전송 건수·재개를 연결한다. 쓰기 불가 상태의 손실 사유를 복구 후 영속화하고 기존 수신 메모리도 성공 전 제거하지 않는 정책을 마련한다.

### H06 — T11 대상 ClassPlayerPage는 표시 스냅샷을 전혀 기록하지 않는다

- 근거: `frontend/src/pages/sessions/ClassPlayerPage.tsx:398-402`는 useBand만 호출하며 파일 전체에 recordDisplay 호출이 없다. `useBand.ts:456-463`은 session_player viewKind도 전달하지 않는다. `plan.md:156`, `verify.md:72`는 두 플레이어 모두를 명시한다. `frontend/tests/sdd244-work-log.md:53`도 미배선을 인정한다.
- 재현: ClassPlayerPage에서 밴드 연결 후 60초 진행. raw/feature 경로가 실행되어도 해당 화면의 session_player indices는 0건이다.
- 영향: 핵심 요구인 당시 화면6 저장이 해당 화면 전체에서 빠진다. MemberClassContainer 테스트 통과로 T11 완료를 주장할 수 없다.
- 수정 제안: 해당 화면이 렌더하는 view model과 같은 snapshot을 session_player로 기록하고 DOM/저장 행 60초 대조를 추가한다.

### H07 — close intent의 segment별 마지막 feature 순번이 신호 전체 최종 순번으로 덮인다

- 근거: `capture-session.ts:307`은 signal만 key로 저장하고 `:325-329`는 모든 segment에 동일한 마지막 순번을 넣는다. `feature-collector.ts:74-75,171`도 signal 단위다. `contracts/README.md:66`은 stream+segment+signal별 마지막 순번을 요구한다. `A/api-v1.md:43`은 순번 구멍을 pending_upload로 판정한다.
- 재현: EEG segment A의 feature 0~4 이후 clock reset, segment B의 feature 5~9를 저장하고 close. A/B 모두 last_feature_sequence=9로 선언한다.
- 영향: 이전 segment에 존재하지 않는 feature를 요구하며 완료 판정과 실제 원장이 어긋난다.
- 수정 제안: feature 순번 정책과 최종값을 stream/segment/signal scope에 맞추고 close에 해당 scope의 최종값만 넣는다. 재연결 2개 segment에 대한 계약 테스트가 필요하다.

### H08 — 모델 변경 normalization은 같은 artifact 슬롯 0을 재사용해 서버 계약상 409가 된다

- 근거: `display-snapshot.ts:181-190`은 모델마다 다른 NORM alias/hash를 만들면서 모두 kind=normalization, stream/segment/signal=null, view 미지정, sequence=0으로 등록한다. `A/api-v1.md:38`은 `kind+stream+segment+signal+view+sequence`가 같고 hash가 다르면 artifact_conflict라고 명시한다. alias를 달리해도 슬롯 충돌은 해소되지 않는다.
- 재현(계약 대조): 같은 회차·참여자에서 모델 A snapshot을 등록한 뒤 B 모델로 전환하여 두번째 presign. 동일 슬롯에 다른 checksum이므로 계약상 409. `upload-queue.ts:50-52`는 이를 permanent dead_letter로 보관한다.
- 영향: 모델 변경 이후 normalization artifact가 ACK되지 않아 complete 조건을 만족하지 못한다. `A/api-v1.md:26`의 content-addressed 등록 설명과 확정 슬롯 규칙 사이도 정리해야 한다.
- 수정 제안: 서버와 합의한 모델 content-addressed identity를 사용하거나 모델별 영속 sequence를 할당한다. 실제 API 계약 테스트에 A→B→A를 포함한다. 서버 동작을 실행해서 관측한 결과가 아니라 명시 계약에 근거한 통합 차단사항이다.

## Medium

### M01 — RR clock reset 시 이전 구간 버퍼가 남아 60초 호흡 gate를 잘못 닫는다

- 근거: `AnalysisMetricsService.ts:378-389`는 clock reset에서 lastRrEndTimestamp만 초기화하고 RR/timestamp 버퍼를 유지한다. `:472-476`은 서로 다른 시간 기준의 마지막−첫 시각을 경과시간으로 사용한다.
- 재현(독립 검증자 실행): 시작시각 500,000ms의 RSA 100박 입력→호흡 15회/분. 시각을 10,000ms로 리셋한 후 새 구간 90박 입력→buffer=120, elapsed=-471,140.85ms, 호흡 null/insufficient_window. 새 구간은 이미 60초를 넘었다.
- 영향: 재연결 후 호흡 표시/legacy 저장값이 불필요하게 오래 null이다. 공통 StreamProcessor 경로이므로 v2 capability 유무와 무관하다.
- 수정 제안: 시간 segment 변경 시 RR·timestamp·평활 이력을 함께 초기화하거나 구간별로 분리한다. `sdd244-algorithms.test.ts:59-64`의 버퍼 길이24 검증 대신 리셋 후 60초 전/후 결과를 확인한다.

### M02 — 모델 전환 첫 표시 행은 새 값에 이전 normalization을 결합한다

- 근거: `useBiosignalCapture.ts:173-174`는 비동기 setModel을 기다리지 않고 tick한다. `display-snapshot.ts:184-186`은 SHA 계산 await 후 normalization을 교체한다.
- 재현: A→B로 모델을 바꾸어 B 기준 화면이 렌더된 직후 첫 recordDisplay 호출. tick은 A snapshot을 읽지만 입력 표시값은 B다. 저장 행은 display_match=true다.
- 영향: 이 전환 행을 기록된 파라미터로 재현할 수 없다. H08의 서버 업로드 문제와 별개인 클라이언트 내 불일치다.
- 수정 제안: 표시값 계산 시 사용한 모델 snapshot을 렌더 데이터와 함께 불변 객체로 전달한다. `sdd244-display.test.tsx:106`처럼 setModel을 미리 await하는 단위 테스트 외에 실제 hook 배선 순서를 검증한다.

### M03 — 네트워크 단절 카드만 보이는 화면도 여섯 수치를 displayed로 기록한다

- 근거: `MemberClassContainer.tsx:201-208`은 탭 숨김/화면 끄기만 판정한다. `MemberStage.tsx:161-169`는 netDown에서 HeroRing 대신 netDownCard를 렌더한다. `display-snapshot.ts:106-108`은 제공된 값에 rendered/displayed/display_match=true를 붙인다.
- 재현: BLE 연결 유지, 상태 시트 닫기, 네트워크/소켓 down 상태로 전환 후 1Hz tick. 화면에는 숫자가 없지만 저장 행에는 여섯 값이 들어간다.
- 영향: 실제로 보이지 않은 값을 당시 표시값으로 오인한다.
- 수정 제안: 실제 view 상태 및 지표별 표시 여부를 recorder에 전달한다. `sdd244-display.test.tsx:148-157`의 정상 M01+status sheet 외에 netDown/닫힌 sheet 등 상태 전환을 검증한다.

## 나머지 점검 결과와 테스트 증거 수준

- **검증 ACK 전 삭제:** v2 adapter는 응답 ID를 먼저 찾고(`api/biosignal.ts:55-57`), uploader는 alias/hash/size/uploaded/verified_at을 확인한다(`upload-queue.ts:23-34`). receipt 쓰기와 payload 삭제는 같은 IndexedDB 트랜잭션이다(`durable-queue.ts:194-200`). legacy도 ID/hash/size/status 검증 후 삭제한다(`useEegRawUpload.ts:218-225`). 이 정상 경로에서 ACK 확인 전 삭제 결함은 발견하지 않았다.
- **봉인 원자성/lease:** index 증가·payload 삽입·journal 삭제는 하나의 readwrite 트랜잭션(`durable-queue.ts:127-140`), 같은 트랜잭션에서 owner/token/만료 확인(`:87-101`)을 수행한다. fake-indexeddb lease takeover 테스트는 통과했다. 실제 탭 간 경합/중간 브라우저 종료는 미검증이다.
- **재시작 journal/dead_letter:** 남은 raw journal의 재봉인과 unknown tail 생성은 존재한다(`capture-session.ts:91-104`). 영속 실패 객체는 삭제하지 않고 보관한다(`durable-queue.ts:202-215`). 다만 H02/H03처럼 전체 산출물 복구·전송은 완결되지 않는다. journal이 이미 비어 있는 순간의 강제 종료 tail 추적은 별도 persistent heartbeat 없이 입증되지 않았다.
- **v1/밴드 미연결:** legacy uploader는 유지된다(`useBand.ts:442-448`). 미연결 사용자는 v2 요청을 하지 않고 capability 미지원이면 inactive다(`useBiosignalCapture.ts:62-75,114-118`). raw-v2 지원 시에도 legacy EEG 업로드가 병행된다. 기존 동작 보존은 되지만 추가 저장/전송 비용은 측정이 필요하다.
- **계약 일치:** raw header/binary golden, feature inventory/분리 참조, indices 스키마 관련 테스트는 통과했다. presign/ACK wrapper, 서명 헤더 PUT, null URL ACK 재조회, client alias/feature_id_aliases 전송은 계약에 맞는 경로가 있다. 그러나 H04/H07/H08/M02/M03처럼 개별 schema 통과만으로 시간·종료·표시 의미가 맞지는 않는다. 서버 계약의 `lost_artifacts`(`A/api-v1.md:42`)는 현재 CloseIntent 타입에 없어 유실을 명시하는 경로도 후속 설계가 필요하다.
- **T10 정당성/버전/회귀:** RR overlap 결함 수정은 `plan.md:85`, `verify.md:77-79`의 승인 범위다. `feature-collector.ts:14-23,103-113`은 PPG v2/중복 제거/60초 gate/parameters hash를 기록한다. 다만 공통 분석 변경이므로 상담사·회원 HRV(SDNN/RMSSD/LF/HF)·호흡 및 legacy feature(`useBand.ts:321-327`)도 달라질 수 있다. 기존 리포트 값을 동일하게 유지한다고 볼 수 없다. 과거 버전은 설명 문자열만 남아 있으며 v1 계산 golden을 보존·비교한 증거는 없다. 보고서/실화면 수치 변화량은 미측정이다.
- **성능:** raw callback에서 동기 복사/파싱(`raw-capture.ts:47-50`), 패킷마다 별도 IDB transaction(`capture-session.ts:162-164`, `durable-queue.ts:110-111`), feature callback에서 JSON.stringify(`feature-collector.ts:78-79`)를 수행한다. raw journal과 봉인이 하나의 promise chain을 공유하므로 봉인 중 encode/hash 대기 뒤로 journal 쓰기가 밀린다. 큐 조회는 전체 store getAll 후 필터(`durable-queue.ts:113-118,181-187`)여서 backlog에 따라 메모리/복사량이 커진다. notify→durable p99≤100ms, 60분 heap, BLE callback/frame 지연을 측정하지 않았으므로 성능 회귀 확정 대신 인수 검증 미충족으로 기록한다.
- **mock의 한계:** queue/capture 테스트는 실제 구현+fake-indexeddb를 사용하므로 순수 mock만의 검증은 아니다. 다만 `sdd244-capture-hook.test.tsx:8-11,51-67`은 API 전체를 mock하고 PUT 호출/intent 존재만 확인하며 모든 artifact ACK/서버 schema 통과는 확인하지 않는다. 표시 테스트는 화면 컴포넌트 일부 정상 상태 대조이고 실제 Container 타이머/모델 전환/네트워크 상태를 연결하지 않는다. 실패 주입도 raw journal 단건 위주여서 H01의 다중 그룹 실패, H02의 offline local flush, H03의 종료 후 online 재개, H07/H08의 서버 계약 충돌이 빠졌다.

## 재검증 우선순위

1. H01~H05 보존·시간축·복구부터 수정 후 독립 재현을 회귀 테스트로 고정한다.
2. H07/H08을 서버 계약과 함께 맞추고 다중 segment/모델 전환 종료가 complete 또는 명시적 partial에 도달하는지 검증한다.
3. H06/M01~M03을 실제 화면 배선으로 검증하고 DOM/저장/반출의 동일성 및 60초 창을 확인한다.
4. 실제 브라우저 재시작·quota·다중 탭 및 BLE 동시부하 측정을 별도 수행한다. 이번 149개 테스트 통과만으로 T07~T11 인수 완료를 선언하지 않는다.
