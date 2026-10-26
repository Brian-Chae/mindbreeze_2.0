# SDD-246 — 구현 전 QA 체크리스트

- Stage ③ / 작성일: 2026-10-26 / 기준 소스: `60365fbaaf02954ba154631032bba9123cec7673`.
- 입력: [Spec](spec.md)의 F01~F12/N01~N09, [Plan](plan.md)의 T01~T12.
- **구현 전 계획이다. 아래 제품 자동 테스트·통합·패리티·실기기·부하 테스트는 모두 미실행이다.** 문서 정합 검토와 제품 검증 성공을 구분한다. 빈 체크박스를 과거 fix-notes 결과로 채우지 않는다.
- 이번에는 제품 코드/테스트 작성·서비스 실행·dev `.env` 로드·DB 접속/조회·푸시·머지·배포·삭제·메일을 하지 않는다. 아래 DB/Redis/서버 장애 시험은 후속 **독립 합성 환경**의 계획이고 dev 환경 금지를 우회할 근거가 아니다.
- 감독이 기술·전환 판정을 맡고 대표는 최종 G4 실기기 게이트에만 참여한다. 이 문서는 현재 세션의 범위를 구현으로 확대하지 않는다.

## 1. 게이트와 시험 책임

| 게이트 | 선행 조건·통과 증거 | 판정자 |
|---|---|---|
| G0 | 세 문서·요구 추적·소유권·계약 독립 리뷰, 구현 전 Verify 로컬 commit 고정 | 감독+독립 검토자 |
| G1 | 실측 golden/model/profile hash 확정, native 음성off·잠금30분의 수집→실제 계산→host 표시. 초기 synthetic spike만으로 최종 통과 금지 | 감독+native 구현자 외 검증자 |
| G2 | 모든 v2 명령/snapshot·Redis·2worker·복구·권한·fallback V01~V03 | 독립 검증자 |
| G3 | 실제 세 플랫폼 golden·archive/종료 수량·hash V04/V07~V09 | 독립 검증자 |
| G4 | 최신 동일 RC로 Galaxy Note10·iOS TestFlight·상담사 Chrome·회원 웹·1:1/그룹 V05/V06/V10~V12; 대표 실제 경험 확인 | 독립 검증자+대표 |
| G5 | 최소14일 전환 관측·부하/자원/보안·rollback V13/V14, 기존 기준선 실패와 신규 실패 분리 | 감독+독립 검증자 |
| G6 | summary에 G0~G5 증거·미해결·지원 profile 기재, 감독이 출시 준비 여부 판정 | 감독 |

G1이 정상 잠금에서 실패하면 **B02 유지·출시 보류**다. OS 예외/허용오차/표본 제외를 늘려 통과시키지 않는다. 필수 테스트 미실행은 미통과이며 단위·시뮬레이터·소스 확인으로 대체하지 않는다. 시험 도중 수정되면 그 실패 시나리오와 영향받은 게이트를 같은 RC로 재검증한다.

T11이 주 검증자다. T11이 작성한 oracle은 코어 구현자가 아닌 별도 검토자가 SDK 산술·고정 expected로 표본 확인한다. T07 검증을 T07 구현자가 단독 승인하거나 T02로 golden expected를 재생성하지 않는다.

## 2. 공통 환경·증거·측정법

### 2.1 실행 환경

- [ ] 고객/운영 데이터 없는 로컬 또는 전용 QA 서버·PostgreSQL·Redis·S3 호환 저장소, 합성 host/member/guest/withdrawn 계정. 테스트 전 host allowlist·합성 설정의 대상만 확인하며 비밀값 출력 금지. dev `.env`를 source/copy/import하지 않는다.
- [ ] Galaxy Note10 실제 모델·Android/One UI·battery 설정, iPhone 실제 기종·iOS·TestFlight build, LINK BAND firmware/profile·충전상태, 상담사 Chrome 버전·OS 기록. iPhone 기종은 준비된 실기기로 먼저 고정하고 지원 하한 OS/최신 OS 추가 행을 둔다. Note10 한 대 결과를 모든 Android 지원으로 일반화하지 않는다.
- [ ] 상담사 Chrome desktop1440×900 및 mobile390×844, 회원 Chromium 웹. 브라우저/앱이 화면상 version만 아니라 실제 loaded asset/core/protocol hash와 일치함을 확인.
- [ ] 정상 시험 네트워크 RTT≤100ms/손실0%/uplink≥5Mbps를 사전 측정. 테스트 도중 실제 변화는 같이 기록하고 실패를 사후 정상 분모에서 임의 제거하지 않는다.
- [ ] 양 앱의 debug cable/충전/개발자 keep-alive 없는 release run을 포함한다. background·lock 시험에서 화면 keep-awake 및 가짜 무음 오디오 금지.

### 2.2 수집할 증거

각 run은 `run_id,commit,build_sha,core_hash,model_hash,fixture_hash,protocol/schema/profile,platform,OS,firmware,role,network_profile,start/end,steps,expected,actual,exit_code,result,limitations`를 남긴다. 로그에는 이름/이메일/token/entry credential/서명 URL/실측 raw 수치 대신 pseudonymous correlation·command/event ID·seq·count·hash·null mask·latency·오류 단계만 쓴다. 실측 골든은 별도 동의된 접근제어 artifact에 보관하고 증거에는 hash/reference만 둔다.

증거 경로는 후속 `specs/sdd-246-realtime-native-rearch/evidence/<run-id>/`이며 현재 생성하지 않는다. `manifest.json`, `summary.md`, sanitized trace/CSV, Android/iOS/Chrome 캡처, 독립 checker 출력으로 구성한다. 테스트 참여자 캡처도 개인정보 최소화한다.

### 2.3 latency·연속성 측정

- **조작 왕복:** origin monotonic `t0`(사용자 click/intent), 서버 command commit/projection, 상대 reducer→다음 paint→`live:applied`, origin이 해당 command_id의 `live:rendered` event를 수신한 `t1`. `t1-t0≤1,000ms`가 N01이고 한 기기의 monotonic 값으로 계산한다. 각 leg도 기록. 네트워크 emit 시간이나 낙관적 로컬 paint만 측정하지 않는다. target_instance/connection_generation이 다르거나 미인가된 rendered ACK는 측정/확정에 사용하지 않는다.
- **지표:** sample clock으로 창 종료→core computed→local durable→server received/committed→host received/reducer/paint를 동일 `(stream,seq)`로 연결. 기기와 host의 벽시계 단순 빼기 금지. RTT 기반 offset 추정/오차 범위(≤50ms)를 기록하고 upper bound로 N02 판정. 동기 불확실하면 판정불가로 재측정, 합격 처리 금지. 창 길이/워밍업은 latency와 별도.
- **30분:** 워밍업 완료 뒤1,800개의1Hz 유효 관측 창을 평가. source generated/applied 고유 seq 집합과 누락·역행·paint 갱신 간격을 대조. 모든 지표가 유효한 통제 세트와 실착용 세트를 나눠 센서 invalid를 숨기지 않는다. 화면 숫자가 우연히 동일해도 관측 seq는 증가해야 한다.
- **raw 수량:** EEG250Hz×1,800s=450,000쌍, PPG50Hz=90,000쌍, ACC30Hz=54,000행(25Hz profile은45,000). 이는 합성 정확 길이 oracle 값이다. 실기기는 device tick/packet 경계와 profile로 expected 수를 산출해 사전 고정하며 명목 수를 억지로 맞추지 않는다.
- **보존식:** 고유 유효 수신수=`server_verified ∪ local_pending`의 서로 겹치지 않는 수+명시적 local loss. 동일 item이 양쪽 존재해도 중복 합산하지 않는다. receipt 유실은 local pending으로 남을 수 있으므로 독립 서버 receipt와 합쳐 판정. 수신 전 BLE gap/unknown tail은 별도이고 총 완결성을100%로 표시하지 않는다.
- **복구:** 네트워크 사용 가능/서버 health 복귀 시점→권한 검증+snapshot sync_complete+호스트 새 metric paint까지10초 이내. warmup 재시작이면 연결 회복과 생리지표 준비 완료를 별도 기록한다.

## 3. 공통 골든·장애 fixture

| ID | 입력 | 독립 expected·목적 |
|---|---|---|
| GF01 | SDK 바이트 edge: EEG signed24 최소/-1/0/최대, leadoff bit0/2, PPG header `00 80 00 00`=32768tick=1초, BE red/IR, ACC signed16 | 정수·endianness·단위 수동 산술 exact; PPG header BE 오해 반드시 실패 |
| GF02 | 센서 원점 서로 다름(+92,400초), arrival jitter±25ms, clock±5분, tick wrap/reset, 중복/역순/잘림 | 센서별 clock·segment·duplicate/invalid 정확. source gap을 보간으로 지우지 않음 |
| GF03 | 비식별 동의 실측 raw 정상/접촉불량/운동·PPG 저품질/재연결, arrival schedule 포함 | 단계별 decoded/filtered/PSD/RR/feature/display expected hash. 최소3개 정상30분 기록과 실패 사례 각각 확보 |
| GF04 | 합성 RSA0.25Hz/PPG50Hz, 일정 RR·RR boundary, 누적59/60/61초, 최소박동 threshold, flat/noise·NaN/null | 워밍업·SDNN 분모N·호흡 Welch·peak index·invalid exact. 실측 GF03 대체 불가 |
| GF05 | normalize 경계(p5/p25/p75/p95 등), sigmoid model/legacy model, half rounding±,0/null/NaN/Infinity | 같은 mode/constants/model에서 backend/HARU/웹/native의 공통 점수 exact. 다른 모델 출력을 같다고 비교하지 않음 |
| GF06 | joined→metric→rich participant/null→hand lower→heartbeat→늦은 GET, snapshot 중delta·scope 변경 | 도메인 소유권·seq·generation, 손/metric 역행0 |
| GF07 | DB commit/Redis project/emit/ACK 각 단계 crash, ACK hole 1건+후속60건 정상 | 업무1회·개별 receipt·snapshot 수렴. 성공 response 누락을 재실행으로 만들지 않음 |
| GF08 | 4개 archive 오류: expired PUT403/API403/hash409/oversize422, offline 종료·lease 충돌 | 단계별 자동복구/격리·원문 보존·cutoff·manifest |
| GF09 | v1/v2 앱·웹·회차/capability·계정 전환 행렬 | 혼합 writer0·계정 누출0·진행 회차 protocol 불변 |

GF03 실제 자료와 GF05 HARU 기준 commit/hash는 T01에서 확보해야 한다. 현재 경로나 fixture가 존재한다고 주장하지 않는다. 기존 합성 테스트를 재사용하더라도 source revision/hash를 붙이고 independent oracle을 병행한다.

## 4. 요구 추적 행렬

| 검증 | 요구사항 | Task | 주 증거 |
|---|---|---|---|
| V01 명령·schema | F01/F12,N01/N09 | T01/T03/T05 | command ledger·wire·paint ACK |
| V02 snapshot/reducer | F02/F03/F08,N04 | T04/T05/T06 | cursor/snapshot race·rich DTO 회귀 |
| V03 Redis·재시작·worker | F02/F08,N04/N09 | T03/T04/T05 | crash matrix·2 worker trace |
| V04 골든 패리티 | F05/F06,N07 | T01/T02/T11 | 동일 fixture·4 runtime 결과 |
| V05 native 배경·잠금 | F04,N02/N03/N05/N08 | T07/T08 | native raw/DSP/live trace·host paint |
| V06 네트워크·밴드 복구 | F04/F08,N03/N04/N05 | T07/T08/T06 | offline/return/gap trace |
| V07 지표 신선도·품질 | F05/F09,N02/N03 | T02/T05/T06 | per-metric validity·seq·UI |
| V08 종료·권한·영속 | F07/F08,N06/N09 | T03/T09/T07/T08 | cutoff/count/receipt·negative auth |
| V09 archive 복구 | F07/F11,N06/N08 | T09 | raw/feature/display round-trip |
| V10 웹·미착용·UI | F09,N02/N03 | T06 | 1:1/그룹·desktop/mobile 캡처 |
| V11 인증·개인정보 | F03/F08/F11,N09 | T03/T04/T05/T07/T08 | 역할별 wire·로그 검사 |
| V12 손·음원·발언 | F01/F12,N01 | T05/T06/T07/T08 | 50회 hand/20회 controls·media |
| V13 구버전 전환 | F10,N09 | T10/T12 | compatibility/rollback·14일 |
| V14 부하·자원·관측 | F11,N01/N02/N08/N09 | T11/T12 | 20/100명 load·CPU/메모리/배터리 |

## 5. 자동·통합 검증 체크리스트

### V01 — 명령 계약과 멱등

- [ ] JSON Schema 단위: 필수필드/unknown kind/major/단위/seq 문자열 범위/nullable 구별, actor spoof·잘못된 target reject. 모든 Plan §3.2 명령(열기·취소·대기알림·대기열 승격/취소·capture renew/reanchor 포함)에 정상/권한/중복/예상 버전 불일치 케이스가 있다.
- [ ] 계약: 웹 TS·Swift·Kotlin 생성/parse 결과 동일. entry.enter와 live:join의 부작용 구분. pre-entry 제한 snapshot에서 타인 정보0, enter 전 보호 명령 reject, enter 후 auth_revision/full snapshot 전이. HTTP fallback도 command_id/body hash/ACK 동일.
- [ ] 통합: 동일 ID100회 동시 요청 시 ledger·업무전이/outbox1건, 다른 body 같은 ID는409/idempotency_conflict. commit 후 ACK 유실은 duplicate 결과, 실패 ACK가 새 intent를 rollback하지 않음.
- [ ] wire: READY 30분에서 entry/live-metrics/session-state REST poll0. 인증·동의·미디어 token·S3 HTTP는 허용이며 이 수치에 포함하지 않는다.

### V02 — 완전 snapshot·domain seq·화면 회귀

- [ ] snapshot은 session/participation/waiting/speaking/signal/audio/devices/metrics/aggregates/policy/terminal/through 모두 포함. 집중·정서·SDNN도 포함하고 비착용/invalid 이유 보존.
- [ ] connect/reconnect마다 full snapshot→cutoff 이후delta→sync_complete→applied→READY 순서. full snapshot 전/중·replay 종료 직전/직후 event100개·재전송·역순을 넣어 최종 상태/각 cursor가 서버와 동일.
- [ ] audience별 비공개 이벤트가 다른 회원 cursor에 가짜 gap을 만들지 않음. domain A gap이 domain B의 과거값 재적용을 허용하지 않음. auth_revision 변경 중 snapshot은 폐기/재인가. public/private audience의 동일 entity 역순이 entity_version을 후퇴시키지 않음.
- [ ] GF06의 rich DTO에 metrics=null/hand=true를 넣고 최신 metric/hand=false가 보존되는지 검사. 단순 좁은 mock만 쓰지 않는다. 실제 참여자 삭제는 tombstone으로 반영된다.
- [ ] 늦은 REST·과거 socket generation·계정/회차 전환·epoch reset 후 이전 snapshot을 주입해 적용0. log retention/buffer 상한 초과는 새 full snapshot으로 복구.

### V03 — Redis·DB·재시작·다중 worker

- [ ] DB transaction 전/후, Redis Lua 전/후, emit 전/후에서 프로세스 중단. durable command1회·outbox 재처리·event dedupe·snapshot 최종 상태 동일.
- [ ] 2 worker에 host/member를 나눠 hand/audio/metric, 어느 worker를 재시작해도 상태 보존. projector lease 만료와 old fence 쓰기 거절, outbox 순서 역전 방지.
- [ ] Redis 불가/OOM/pubsub 유실: 메모리 성공0,503/retryable·DEGRADED, client local queue 보존. Redis 전체 소실 후 DB 기반 rebuild→새 epoch·full snapshot, 과거 quiet signal 만료/metric stale 유지.
- [ ] 모든 연결0이 되어도 class 종료·state 삭제 없음. active key TTL 없음, terminal+24h 경계 검증은 가짜 clock/격리 데이터로 수행.
- [ ] 실행 중 회수된 회원이 다른 worker에서 계속 수신·명령하는 경우0. 두 worker를 켰다는 로그만으로 통과 금지.

### V04 — 공유 골든 패리티

- [ ] GF01~GF05를 Rust native host/WASM/iOS arm64/Android arm64 실제 release artifact로 실행. input/model/profile/hash가 모두 같아야 비교한다. 배치 경계와 restore 시점을 달리해도 동일 sequence·feature.
- [ ] raw 정수·packet bytes·samples/segment·null/invalid reason·peak sample index exact, DSP abs≤1e-6 또는 rel≤1e-6, BPM/호흡/SDNN abs≤1e-4. 원점 near-zero는 abs 사용. display rounding exact; 단순 평균오차로 outlier 은폐 금지.
- [ ] backend `eeg_metrics`는 fixture expected features로만 normalize/집계 검증. 공통 점수 오차≤1e-6, 소수1자리 exact, HARU 동일 model/constants/revision 결과 exact. backend raw DSP 시험은 해당 없음으로 명시. live frame과 세션 집계값을 직접 같다고 비교하지 않고 동일 mode·입력·함수끼리 비교한다. 모델 pin·B0 fallback·double normalization 방지도 시험한다.
- [ ] 기존 웹과 새로운 core의 차이 중 오류 수정이 필요하면 algorithm/profile version 증가·독립 oracle 검토. 허용오차 넓히기·기대값 일괄 재생성 금지.
- [ ] backend의 내부 weighted_total 코드 존재가 명상 리포트 종합점수 노출로 이어지지 않는 schema/UI assertion.

### V05 — native background/lock

- [ ] 단위: WebView destroy/unmount가 native stop/pump 해제 호출을 하지 않음. 중복 plugin/listener·manager start에도 수집 owner1개·샘플2배0.
- [ ] journal file write/DB commit 사이 종료와 checkpoint restore, per-account key·보호등급·잠금 중 SQLite/file 접근 검증. local commit 이전 데이터가 receipt 완료로 표시되지 않음.
- [ ] iOS restoration handler가 웹뷰보다 먼저 실행되고 같은 manager/queue를 복원, background URLSession task mapping 재생성. 사용자 force quit 후에는 자동 재시작을 가정하지 않음.
- [ ] Android FGS 시작 권한/알림·마이크 거부 상태의 BLE 측정, wakelock release, activity 재생성·Doze 상태. OEM 설정 요구와 기본값을 구별.
- [ ] 아래 실기기 D03/D04/D09에서 JS heartbeat가 정지한 동안 native 수집·DSP·live seq가 증가하고 host1Hz paint가 유지. raw만 쌓이는 것은 실패.

### V06 — network/BLE 자동 복구

- [ ] ACK1개 유실+다음60개 성공에서 누락 키만 재전송되고 queue가 자동 수렴. 전체 lastAckAt로 오래된 항목을 숨기지 않음.
- [ ] 네트워크10초·60초 차단→복귀, Wi-Fi↔cellular, DNS/handshake 실패, expired access refresh single-flight. owner lease30초와 서명 lease10분의 경계, capture.renew/reanchor ACK 유실도 별도 검증. 사용 가능 후10초 이내 full sync/현재 metric, backlog로 지연되지 않음.
- [ ] BLE 범위 이탈/disable/battery-off 후 새로운 segment, tick reset/중복 notify 방어. gap 양끝/unknown 구간과 추정 오차가 보존. 재발견 후15초 이내 재구독, 새 생리창 준비는 별도.
- [ ] 오래된 stream owner가 재연결해도 최신 live를 되돌리지 않음. 웹 다중탭 capture lease fencing, 앱 JS/native handoff 중 이중 owner0.

### V07 — metric freshness·품질

- [ ] PPG30초 결측+EEG 정상에서 EEG는 유지하고 BPM/호흡/SDNN은 실제 last_valid age·invalid 사유를 표시. hold가 새 관측시각을 만들지 않음.
- [ ] 낮은 SQI/actual leadoff·warmup·BLE disconnected·live stale을 각각 구분. null/0/NaN/Infinity 및 정상0이 서로 뒤바뀌지 않음.
- [ ] 과거 A를 B 뒤 저장/재전송해도 live B 유지; wall clock±5분에도 seq 순서 동일. 서버 clock uncertainty가 커지면 time_uncertain, 임의 fresh0.
- [ ] 30분1,800창 source→durable→host seq 집합 일치, N02 세부 latency와 N03 paint gap 기준 충족. 기본3초 평균이 숫자 업데이트를 지연시키지 않음.

### V08 — 종료 직후 잔여 저장·권한

- [ ] 정상 종료·중복 end·같은 초 마지막 scalar/원문/feature/display가 경합해 final manifest의 고유 count/hash가 실제 허용 수신 set과 일치. 종료 후 화면 이동/웹뷰 파괴에도 native drain 지속.
- [ ] capture.close ACK 유실·PUT성공/verify ACK 유실→same IDs 재시도로1회 저장. 정상망30분 backlog가 종료 후5분 안에 receipt와 manifest로 수렴.
- [ ] 종료5초 전 네트워크 차단→종료→10초 뒤 연결. 서버 cutoff/기존 stream/anchor uncertainty로 종료 이전 범위만 수락, 이후/애매한 경계는 reject/quarantine. 종료 후 stream 신규 생성/자가 timestamp 조작/최종seq 확대가 권한을 넓히지 않음.
- [ ] completed는 허용된 사후전송, removed/withdrawn/동의철회/타인 stream은 거절.24h±1초 유예 경계와 계정전환 큐 격리. 보존중지를 성공으로 표시하지 않음.
- [ ] 강제 종료/저장소 full에서는 마지막 committed sample 이후 unknown tail을 드러내고 ‘전량 저장’으로 요약하지 않는다. 실험 삭제는 가짜 저장 backend/fault injection으로 수행하며 사용자 파일 삭제 금지.

### V09 — archive retry·외부 reader

- [ ] expired presigned PUT403은 새 URL 발급 후 회복; API403은 자동 재시도 중단·사본 보존;409 conflict는 success0;422 과대 payload는 부모 원문+새 alias 분할 복구.
- [ ] receipt hash/size/id mismatch 또는200 body verified=false는 local payload 유지. receipt commit+payload 정리의 crash-safe 순서 검사; 삭제 실행은 사용자 데이터가 아닌 격리 fixture에만 해당.
- [ ] 외부 독립 reader로 실제 S3 객체→raw/feature/display decode→count/hash/time/order 확인. manifest claimed verified와 실제 object set 비교. 비어 있는 CSV/확장자만 Parquet인 JSON을 실패 처리.
- [ ] 백로그100/1,000 items 및2시간 local storage profile에서 메타 조회가 전체 payload를 매번 읽지 않음. live와 archive 상태/건수가 섞이지 않고 N01/N02 유지.

### V10 — 웹·미착용·표시 정책

- [ ] Chromium 웹 BLE+WASM과 미착용 앱/웹이 같은 1:1·그룹 수업에 참여, 손/음성/시작/종료 정상. 미착용은 BLE 권한·native/core 수집·capability 요청0, 참여 핵심 API는 정상.
- [ ] Web Bluetooth 없는 브라우저에서 비측정 흐름 정상·지원 안내. 웹 숨김/절전 후 복구와 gap 표시를 시험하되 앱 background 보장으로 홍보하지 않음.
- [ ] 회원 숫자/변화1Hz, desktop5분 막대, mobile 현재값. 변화량·서사형 리포트에 종합점수0. 모든 UI 숫자의 unit/model/validity가 같은 snapshot과 대응. 그룹 집계는5초 별도 revision,1:1 SessionDetailPage/ClientSessionDetailPage도 동일 reducer·순서 계약을 확인한다.
- [ ] 390/1440에서 상담사1:1/그룹 실제 화면 캡처·상태 assertion. 예전 rich null 덮어쓰기와 stale hand가 보이지 않음.

### V11 — 인증·권한·보안

- [ ] 만료access/재접속·동의철회·member inactive·guest entry credential·다른회차/tenant를 각각 시험. 토큰 refresh는 native에서도 웹뷰 없이 single-flight. 재인증 실패는 명확한 BLOCKED, 무한 로그인 loop0.
- [ ] host/member/public snapshot·replay·fallback에 타인 지표/개인정보 유출0. snapshot 생성 중 권한회수·구 auth_revision ACK는 폐기. 오래된 token으로 room rejoin0.
- [ ] 로그아웃/다른 계정 로그인에서 이전 queue를 새 identity로 전송0. bridge events와 로그·crash evidence에 token/서명URL/이메일/raw 값0.
- [ ] 동의 원장 HTTP 변경 결과가 live policy event에 반영되고 실제 capture/upload 인가도 즉시 일치. UI만 숨기고 계속 수집하는 실패를 검사.

### V12 — 손 왕복·음원·실제 발언권

- [ ] 앱 두 OS 각각 raise50/lower50/host-force-lower50회. 웹 회원에도 동일 세트. N01 정의의 상대 paint ACK 왕복max≤1초; p50/p95/max·실패 건수 기록. 로컬 낙관 반응만으로 합격 금지.
- [ ] 시작/종료/발언 허용·회수/quiet signal/audio play-pause-seek-stop 각20회 max≤1초. 종료 반복 시험은 분리된 합성 회차로 수행.
- [ ] 손만 바뀔 때 LiveKit token 요청0. grant_version 변경만 token 재발급, 응답 역순은 구 세대 폐기, 발언권 회수 후 실제 upstream audio 송신 차단. media 상태가 손 상태를 되돌리지 않음.
- [ ] host 늦은join·reconnect·재시작 시 현재 track/position/server anchor 복원, 위치 오차≤1초(안정화2초 후). 종료 후 과거 음원 재생0, quiet signal expiry 후 재접속 팝업0.
- [ ] 기존 녹음/녹화 사용 회차는 동의·HTTP 청크/stop 잔여 저장을 별도 검증. audio 로컬 mic를 참여자 전체 녹음으로 오인하지 않고 현재 scope 유지.

### V13 — 전환/마이그레이션/rollback

- [ ] 새 서버+구 앱 v1 / 새 웹 v2 / native v2 / legacy backlog / 업데이트 안 된 앱의 v2 회차 진입 행렬. 회차 중 protocol 전환0, v2 미지원은 분명한 업데이트 안내.
- [ ] additive migration을 격리 PG에서 이전 schema→새 schema로 실행, Alembic head1, 기존행 읽기 동일. legacy metadata unknown 보존, 과거 raw 내용/hash 변경0.
- [ ] shadow 비교가 명령/수집 이중 writer를 만들지 않음. native handoff 후 JS 새 수집0, 이전 IndexedDB pending drain은 계속. 앱 업그레이드/복귀 시 queue count/receipt 유지.
- [ ] rollout off 후 새 회차v1·기존v2 마무리, 기존 v2 state/receipt/epoch/queue 보존. 파괴적 downgrade/삭제를 rollback 수단으로 쓰지 않음.
- [ ] 최소14일·v2회차30회(각 앱≥10회), 오류/지연/queue/legacy 사용 trace. 기준 미달이면 감독이 전환 보류·수정, 대표 중간 결정 대기 없음.

### V14 — 부하·자원·운영 관측

- [ ] 1명→20명/회차→5회차100명,2worker,1Hz+simulated raw backlog를30분. N01/N02/N03 유지, participant 간 state 누출0, outbox lag·Redis memory·DB query load 기록.
- [ ] Note10/iPhone 비충전·초기배터리50~90%·동일밝기/네트워크·media off/on 각각30분. heap 증가≤20MiB, battery 감소≤10%p,thermal serious/critical0, 분석max≤500ms. 배터리 값만으로 CPU budget을 대체하지 않음.
- [ ]2시간 offline 저장 예산과512MiB 경계/80% 알림, 디스크 부족 fault를 시험. 이전 미확정 payload overwrite0, 중단사유와 gap/unknown tail 보존. 서버 capture lease 만료 자료는 pending으로 분리하고 자동 검증완료로 계산하지 않음.
- [ ] 관측상 command 생성→commit→projection→수신→paint, metric generated→durable→received→applied, archive pending→PUT→verified를 각각 연결. live 정상/보관 backlog·live 끊김/로컬 정상 네 조합을 UI에 정확히 표시.
- [ ] 변경 관련 테스트·빌드·타입·CI 결과와 full suite 기준선 실패를 따로 기록. 과거 ‘17건 실패’는 참고일 뿐 이번 RC의 실제 결과를 새로 확인한다. 핵심 계약 관련 미해결 실패는 출시 차단.

## 6. 필수 실기기 실행표

아래 D01~D10은 **양 앱 각각 LINK BAND+상담사 Chrome 동시**, 최소3회 반복한다. 정상 연속/잠금은1:1과20명 그룹(실착용1명+합성19명)을 모두 실행한다. 실제 다수 BLE 기기 시험과 합성 부하는 증거 등급을 구분한다. 각 run 전2분 이상 warmup 후 모든 유효 지표의30분 창을 확보하며 quality invalid가 반복되면 원인을 분리하고 전체 재시험한다. 실패 구간을 잘라내어 연속30분이라고 하지 않는다.

| ID | 절차 | 합격·측정 방법 |
|---|---|---|
| D01 정상30분 | 앱 foreground·밴드 안정 착용·상담사 Chrome; 회원 웹도 별도 동일 run | 유효1Hz창1,800개·raw tick 연속·전송/paint누락0·fake fresh0, N02/N03 count/latency |
| D02 서버 재시작 | 손 든 회원·발언권·음원 재생 중 QA backend process 종료/재시작;2worker 한쪽/전체 각각 | 서비스 available부터10초 내 snapshot+현재 metric, 손·발언·대기·음원 일치; 중단 중 local loss0, archive receipt 수렴 |
| D03 background10분 | 앱 홈으로 나가 다른 앱 사용10분, 음성off; 앱 복귀 없이 상담사 관찰 | JS timer정지에도 native/DSP/live seq 증가, N02 지속·유효10분창600개 누락0; 복귀 snapshot 중복 수집0 |
| D04 화면 잠금30분 | 화면 잠금·비충전30분, 음성off/실제media on을 별도 run. 상담사 화면 계속 기록 | native 수집/DSP/저장/Socket.IO 모두 독립 지속,1,800창·N02/N03·battery/thermal 기준. 저장만 계속되면 실패 |
| D05 Wi-Fi10초 | cellular off로 실제 네트워크 차단10초(우회 경로 없음)→복원; 이후 Wi-Fi↔cellular 별도 | 단절 표시3초 이내, local sample loss0, network available부터10초 내 live복구, pending 자동0/receipt. 단절 중 fresh 숫자 위장0 |
| D06 손 왕복 | raise/lower/상담사 강제내림 각50회, 단조 command_id·영상/paint ACK | 각max≤1초, state 역행0; 지연 중복클릭으로 복구하지 않음. 두 앱·웹 각각 통계 |
| D07 종료 잔여 | 종료 직전1초 창/업로드inflight, end 직후 화면 이동; offline-end도 별도 | 허용 종료 전 샘플/창 receipt 전량 일치, 정상망5분 내 backlog수렴. 종료이후/시간불확실 자료 명시 격리 |
| D08 범위 이탈 후 복귀 | 밴드를 실제 범위 밖으로30초 이동 후 복귀(앱 foreground/lock 각각) | gap 경계·영구유실/unknown 명시, 재발견15초 내 재구독·새segment, 워밍업 후 지표 회복. 사라진 raw를 복원했다고 표시0 |
| D09 token/OS | lock 중 token 만료·앱 메모리 회수/복원, Android Doze·OEM 기본 배터리 설정 | native refresh·재join/queue 복구,1Hz 보장 프로필 충족. OS 강제회수 gap은 기록; 무음 오디오/ADB 면제로 통과시키지 않음 |
| D10 물리 한계 | 사용자가 force quit, 밴드 전원off/배터리 소진을 각각 시험 후 재실행 | 연속 측정 보장 대상 아님. 마지막commit~첫복구 gap/unknown 표시·이전 보관 사본 인계, 중단중 데이터를 새로 만들어 채우지 않음 |

D02의 재시작 대상은 격리 QA 서버뿐이다. 이번 문서 작성 중 실행하지 않는다. iOS TestFlight 배포·기기 접근이 준비되지 않으면 사유·준비물을 남기고 미실행이다. 대표는 최종 RC의 D01/D03/D04/D06/D07 경험 확인에 참여하고, fault injection/반복 측정은 독립 검증자가 준비한다.

## 7. 결과 기록·실패 처리

| 항목 | 현재 상태 | 후속 완료 조건 |
|---|---|---|
| 요구·설계·Verify 문서 | 작성·독립 검토 대상 | 세 파일·문서 리뷰·로컬 commit |
| 제품 unit/contract/integration | 미실행 | T01~T12 해당 명령·실제 exit/개수 |
| 실측 golden/4 runtime parity | 미확보·미실행 | 동의된 raw/reference/model hash 및 독립 비교 |
| Galaxy Note10 / iOS TestFlight / Chrome | 미실행 | D01~D10 artifact·SLO·누락0 증거 |
| Redis/PG/S3·multiworker fault | 미실행 | 독립 합성 환경 crash matrix |
| 14일 dual run·배포 | 미실행·이번 범위 밖 | 별도 실행 범위에서 실제 관측 |

실패는 요구ID→원인 증거→수정 소유Task→재시험run으로 연결한다. G1 불가 시 감독이 B02 유지·출시 보류를 기록하고 동일 목표 재설계한다. 미확인 사실을 DB 조회·dev 환경 접근으로 채우지 않는다. 마지막 보고는 문서 완료/자동 검증/실기기/운영을 별도로 적으며, 세 문서만으로 SDD 전체 완료라고 표현하지 않는다.

## 8. 이번 문서 자체의 검토 기록

- 2026-10-26 독립 설계 검토자가 세 문서를 읽고 프로토콜·소유권·일정·수치·iOS 제약을 검토했다.
- 지적5건(상대 paint ACK 반환, owner/서명 lease 구분, snapshot→live 전환 경계, audience 간 entity version,1:1 상세 화면 담당)을 반영했고 재검토에서 실질 해소 및 추가 중대 결함 없음으로 확인했다. presence/rendered 표의 세부 필드2건도 최종 보완했다.
- 감독이 F01~F12/N01~N09→V01~V14 추적, T01~T12·D01~D11 존재, Task120~160인일+여유0~5, Markdown fence·한국어·미실행 상태를 정적 검사했다. 이는 제품 자동 테스트 통과를 뜻하지 않는다.
- 제품·서버·DB·실기기 검증은 위 표대로 미실행이다. 이번 산출물은 spec/plan/verify 세 파일뿐이며 summary는 구현 결과가 생긴 뒤 작성한다.
