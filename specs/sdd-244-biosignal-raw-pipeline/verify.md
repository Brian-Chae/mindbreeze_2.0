# SDD-244 — 구현 전 검증 계획

- Stage ③, 작성일 2026-10-24. 입력: `c5897f27`의 [spec §6](spec.md#6-수용-기준검증-시나리오--모두-미실행), [plan.md](plan.md).
- **모든 제품 테스트 미실행**. 이 문서는 구현 전 시나리오이며 테스트 통과·SDD 완료·구현/앱 확대/배포 승인을 뜻하지 않는다.
- 이번 범위는 plan·verify 작성과 문서 검토·커밋·지정 브랜치 push뿐이다. 아래 서버/PG/브라우저/장치 실행은 향후 승인된 격리 환경에서 한다. 운영 서버·DB·.env·실제 개인정보·메일·정리/삭제 작업은 사용하지 않는다.
- 독립 검증자 C가 A/B 구현을 검증한다. C 구현인 decoder·연구/retention은 A가 별도 expected fixture/소스 diff로 검증한다. 같은 함수를 expected 계산에 재사용하지 않는다.

## 1. 실행 게이트·증거 규칙

- [ ] G0: `fix/eeg-raw-ack-loss` 최종 commit/diff/테스트를 인수하고 A02/A03의 legacy 회귀를 다시 확인. 실패 시 FIX 반환;244에서 중복 수정 금지.
- [ ] G1: raw v2·manifest·feature·indices·dictionary schema와 golden fixtures를 BE/FE/243 소비자가 리뷰한 commit 기록. **이 시점부터 SDD-243 fixture 기반 병렬 시작**.
- [ ] W4 웹: A01~A08/A10~A13과 A09 웹 실기기를 통과. 앱 결과와 분리해서 보고한다.
- [ ] W5 앱: W4 후 새 bundle에서 iOS/Android 각각 A09 실기기·A12를 통과한 프로필만 확대. 앱 미실행을 웹 실패로 바꾸거나 웹 통과를 앱 통과로 복사하지 않는다.
- [ ] 다운로드: SDD-243 실제 생성 MB ZIP을 외부 독립 reader로 검증. 244 decoder 단위테스트만으로 ZIP 인수 완료 금지.

각 실행 증거는 commit/build·platform/browser/OS·firmware/profile·합성 fixture hash·명령·exit code·기대/실제 count/hash/time·측정 구간·실패·재시험을 기록한다. 실기기 기록은 승인된 테스트 참여자 자료만 사용하고 반출 증거는 가명/필요 최소값으로 남긴다. 테스트가 불가능하면 이유·준비물과 함께 미실행으로 유지한다. mock/SQLite 성공은 실제 객체 스토리지/PG/브라우저/기기 증거를 대체하지 않는다.

## 2. fixture·독립 oracle

- [ ] F01 정상60초: EEG15,000쌍(250Hz), PPG3,000쌍(50Hz), ACC1,800행(30Hz). 동일 수신 시간 배열 안에 다른 sample times를 넣는다. 25Hz 변형은 ACC1,500행이며40ms 간격이다.
- [ ] F02 패킷 경계: signed24 `-8388608,-1,0,8388607`, PPG `00 00 FF`=255와 uint24 최대, ACC signed16 최소/최대·음수·native signed/unsigned byte 비교, lead-off bit0/bit2/둘다. 값/바이트/endianness 기대값을 수동 산술 fixture로 고정한다.
- [ ] F03 불량·시간: 잘린/0샘플/중복/역순/알 수 없는 profile, tick wrap/reset, 벽시계±5분, 3초 단절, 재접속, clock 재앵커. device packet loss와 host packet_seq 차이를 별도로 주입한다.
- [ ] F04 feature: 현재 MB 실제 출력 타입/return 객체 inventory의 모든 필드·배열·null/NaN·중첩창 포함. 이전 HARU 결과는 비교 데이터이며 MB expected를 HARU와 같다고 가정하지 않는다.
- [ ] F05 표시: 모델A→B, 지표 일부 invalid params→B0, lead-off/stale/held/remote fallback, HRV SDNN≠RMSSD, 호흡60초 이전/이후, null초·비활성·두 화면/view instance.
- [ ] F06 정책/legacy: 동의 범위 EEG-only/3신호/미동의/철회/비회원,90일±1µs, 연구 신호별 ACK, 기존 v1·unknown1.0·미착용·만료/원본 부재.
- [ ] F07 규모:1명/20명×60분, 실제 emit 빈도 보존, 최대 fixture participant 수가 서비스 설정 상한보다 작으면 `max(20,실제 계획 상한)`으로 추가 실행한다. 큰 ZIP은 개인정보 없이 합성으로 생성한다.

공통 보존식: **수신 정상 샘플 수 = ACK/영속 보존된 고유 샘플 수 + 명시적 local loss 수**. pending 샘플은 서버 업로드 수와 중복 합산하지 않는다. 수신 전 BLE gap/unknown tail은 별도이며 모르는 expected 수를0으로 채우지 않는다. 정상 F01은 loss=0, pending=0일 때 원본/서버/다운로드 count/hash가 일치해야 한다. raw/packet 정수는 완전 일치, float32는 해당 비트 round-trip 일치, 재구성 시각은 유리수 기준 최종 µs 반올림 오차≤1µs(절대 시계 정확도와 별개)다.

## 3. spec §6 수용 기준별 시나리오

### A01 — 세 신호 수신·영속·반출 완전성(T03/T04/T07/T12/T15)

- [ ] 단위: F01/F02를 BLE 원문→v2 encoder→별도 Python decoder에 전달. ADC·float32·lead-off·channel order·packet bytes/hash·sample-map와 행수가 일치한다. malformed packet도 보존/사유가 남고 정상 샘플로 위조하지 않는다.
- [ ] 통합: 분석기를 일부러 지연시켜도 raw capture가 먼저 journal에 들어간다.10초/1MiB/종료 잔여분 봉인,100ms persistence latency 측정. 객체 bytes·ACK·CSV·샘플행 Parquet를 비교한다.
- [ ] PG:3신호 같은 stream/index가 서로 충돌하지 않고 sample_count/size/check constraints가 유효하다. 다른 참여자 원장이 섞이지 않는다.
- [ ] 합격: 정상60초의15,000/3,000/1,800(또는1,500) 행100%, byte/hash 정합. 알려진 loss/unknown은 원인·범위로 설명하며 silent loss=0.

### A02 — 검증 ACK 전 삭제0(T01/T04/T08)

- [ ] 단위/FIX 회귀: HTTP200+failed, ACK 항목 누락·ID/hash/size 불일치, HEAD 불가, checksum 미제공/불일치, DB rollback이면 payload가 남는다. aggregate acked count만으로 개별 성공 처리하지 않는다.
- [ ] 통합: PUT 성공 후 ACK 요청/응답 유실, 서버 commit 후 브라우저 강제 종료, receipt 저장 직후/GC 직전 종료. 재개 후 동일 객체/ACK에 수렴하고 검증 ACK 후에만 GC한다.
- [ ] 객체 저장소: presign SSE 등 서명헤더 전달·URL 만료 재발급·SHA-256 read 검증·ETag 오인 방지. 모의 HEAD 통과와 실제 호환 저장소 시험을 별도 기록한다.
- [ ] 합격: unverified deletion=0, 동일키 서버객체1개, 실패가 사용자 저장완료로 표시되지 않는다. 이번 문서 단계에서 FIX 완료를 추정하지 않는다.

### A03 — 불변성·영속 실패 보관(T04/T08)

- [ ] 단위: 같은키/같은payload 재시도 멱등, 같은키/다른payload409. index0 재마운트/새 stream/순서역전/8회 초과/400·401·403·429·5xx에서 기존 bytes를 보존한다.
- [ ] 실제 호환 저장소: ACK 후 아직 만료 전인 기존 presigned URL로 다른 bytes를 PUT해 checksum 강제로 거절되거나 staging만 변하고 pinned final version은 불변인지 확인. 동일 bytes 재전송은 멱등이며 final read hash는 처음 ACK와 일치해야 한다. 불변성 지원 없는 저장소는 v2 활성화가 거절된다.
- [ ] PG: presign/ACK 동시2요청 unique 경합, 다른 hash 충돌, 부분 batch commit 정책, 완료 객체 overwrite 거절. constraint 없이 mock로만 중복 방지했다고 판정하지 않는다.
- [ ] 브라우저 실제 IndexedDB: 오프라인 reload, 강제 탭 종료, 다른 탭 lease 만료/오래된 fencing token, 계정A→B→A, upgrade blocked, quota80%/95%/쓰기거부 주입. B계정이 A queue를 전송하지 않는다.
- [ ] 합격: 미ACK payload 유실0·덮어쓰기0, blocked/dead_letter 유지, quota/메모리 상한에서 중단과 사유가 보이고 재인증 후 명시 재개 가능.

### A04 — 시각·gap 복원(T03/T07/T08)

- [ ] 단위: F01/F03에서 EEG4ms, PPG20ms, ACC1000/30ms 및25Hz40ms를 sample_index/rate로 복원. 같은 arrival을 샘플시각으로 복사하지 않는다.60분30Hz 누적 반올림 drift가 없다.
- [ ] 통합: tick wrap은 연속, reset/벽시계변경/reanchor는 새 segment·원 tick 보존.3초 BLE loss와 upload delay는 서로 다른 이벤트다. lost/duplicate 후보를 보간/삭제하지 않는다.
- [ ] 브라우저/실기기: 마지막 journal 이후 강제 종료 tail=unknown, reconnect count와 segment 대응. close intent 없는 종료를 정상 complete 처리하지 않는다.
- [ ] 합격: 원문→time basis·profile·gap 재현, 불명 손실량 null, 절대 UTC 정확성을 주장하지 않는다.

### A05 — feature 전체·원창 출처(T05/T09/T12)

- [ ] 단위: F04 inventory 대비 JSONL 필드 누락0. 기존27컬럼과 `total_neural_activity,faa,play_group_id` 누락 연결, 신호별 source_feature_id·window/source raw range가 유효하다.
- [ ] 단위: channel PSD/frequency/band power/SQI·filtered waveform/sample mask, PPG filtered red/IR·RR/peak/beat ID·제외사유, ACC 산출 배열/통계/상태가 실제 emit마다 보존된다. output에 없던 알고리즘 값을 조작해 채우지 않는다.
- [ ] 통합: PPG4Hz 이상/중첩창·역순 emit도 JSONL event count가 일치, 검색 스칼라만1Hz latest로 선택. feature는 raw-derived 참조를 통해 파형을 복원하고 만료 후에는 expired를 반환한다.
- [ ] 합격: emit 수=고유feature 레코드 수, overlap 덮어쓰기0, NaN/Inf 거부·null+reason. 원 feature 스칼라 단위/정밀도가 유지된다.

### A06 — 당시 화면6·1Hz·모델 재현(T05/T11/T16)

- [ ] 단위: F05에서 renderer와 저장자가 같은 DisplaySnapshot을 소비.6개 정수와 각각 display_input·held/stale/source·모델 hash가 일치한다. null 초도 snapshot이 존재한다.
- [ ] 통합: 모델A→B·B0 지표별 fallback·cached model·원격 fallback 출처, 화면별 view_instance 분리, snapshot 재전송 멱등. source_feature 없는 원격값은 provenance 사유가 있다.
- [ ] 브라우저: 실제 MemberClassContainer 및 ClassPlayerPage DOM의6개 표시값을1초 tick별 indices와 대조. 활성60초는60개 slot, null/품질불량도 포함. 비활성/타이머 정지 구간은 not_rendered·gap이며 실제 표시됐다고 표기하지 않는다.
- [ ] 합격: 관측된 DOM↔저장↔CSV 차이0, 모델 변경 후 과거값 불변, mind3=정규화값, 몸3=물리량, 종합점수 신설0. 재계산은 source=reconstructed/display_match=false로 별도 취급.

### A07 — 호흡·HRV·알고리즘 버전(T10)

- [ ] 단위: 실제 elapsed60초 전 호흡=insufficient_window, 이후 유효값 또는 구체 null 사유. 중첩창 RR을 여러 번 보내 실제 경과보다 gate가 일찍 열리는지 재현한다. beat ID로 같은 RR/새 RR을 구별한다.
- [ ] 단위: SDNN≠RMSSD fixture에서 화면/indices hrv가 SDNN이고 rmssd는 feature에 별도로 남는다. MB/HARU 입력 동일 fixture의 차이와 window·단위를 기록하며 동일 결과를 강요하지 않는다.
- [ ] 독립 계산: LF/HF 단위/예외 배율, SQI mask로 시간축 압축 여부, RR 반복/경과 gate의 기대값을 별도 스크립트로 검사. 확인된 수정은 algorithm version/parameters hash 변경 및 이전 version fixture 유지.
- [ ] 합격: 호흡0 placeholder를 실측값으로 저장하지 않고 overlap으로60초를 허위 충족하지 않는다. 원 데이터와 알고리즘 산출을 구분, 수집 완전성만으로 생리학적 정확도 인증 금지.

### A08 — 종료 manifest·revision(T06/T08/T12)

- [ ] 단위/통합: 종료 중 오프라인, 일부 ACK, 마지막 짧은 청크 실패, feature/indices 마지막 item 실패, feature 성공·raw-derived 실패, model snapshot 미등록·gap 마지막 event 미ACK, close intent 응답 유실에서 pending_upload/partial이 보인다. raw만 ACK됐다고 complete 처리하지 않는다.
- [ ] PG: close/ACK 동시 commit과 재전송에서 동일 intent 멱등, immutable revision 증가. 후발 ACK 뒤 기존 revision bytes/hash 불변, 최신 pointer만 변경한다.
- [ ] 브라우저+243: 업로드 복구 전 만든 ZIP revision과 이후 새 revision을 따로 복원. 부분 데이터와 gap을 manifest/화면에서 확인한다. 철회/만료 시 pinned revision도 반출 권한을 주지 않는다.
- [ ] 합격: 기대 count/마지막sequence/전체 expected artifact set(raw-derived·모델·gap 포함)의 hash·ACK/commit이 모두 일치할 때만 complete, 수신 전 BLE gap은 coverage에 남는다.

### A09 — 웹 실기기와 앱 후속 단계(T16/T17/T18)

- [ ] W4 웹: LINK BAND+Chrome/Edge 각각60분. 버전/OS/firmware·프로필·원문 tick/endian/ACC rate·수신/서버/반출 count 기록. foreground/탭전환·네트워크단절·BLE 거리단절·재접속·브라우저 재시작을 포함한다.
- [ ] W5 iOS 새 bundle60분: foreground/background·화면잠금·OS 종료/재시작·네트워크전환·BLE 단절/재연결·IndexedDB 재개를 관측한다. OS가 중단한 구간은 gap/unknown/pending이며 연속 수집 성공으로 주장하지 않는다.
- [ ] W5 Android 새 bundle60분: 위 조건과 동일. iOS 결과를 Android 증거로 대신하지 않는다. 구버전 앱 EEG-only/indices unavailable 계약도 검증한다.
- [ ] 프로필 비교: 현재 MB 앱의 공통 JS30Hz를 먼저 확인한다. 독립 native25Hz/축당1byte·PPG LE/첫샘플 anchor 후보는 별도 fixture/장치 근거로 검증한다. 실제 raw bytes·firmware를 확인하기 전25Hz 재라벨/16bit 역복원 금지.
- [ ] 합격: 플랫폼별 검증된 capability만 활성화, 지원 불명은 명시적 제한. native SDK 전환/새 플러그인 도입이 필요하면 별도 범위 결정 후 해당 프로필 재시험.

### A10 — MB ZIP 독립 복원·정책(T03/T12/T15+SDD-243)

- [ ] 단위: v1/v2 decoder·CSV UTF-8/RFC4180·정수·float32 round-trip·null≠0·시간단위·unknown unit/version. bin 전체 hash를 검증한 뒤 잘못된 section offset/length/overlap/truncated bytes를 거절한다.
- [ ] 통합: SDD-243 참여자/회차 폴더와 root manifest/dictionary/README, raw3종·packet/sample-map·전체 feature·raw-derived·indices·display-status를 실제 ZIP에서 독립 재생성한다. 없는 신호는 사유이며 영값 waveform이 아니다.
- [ ] 구간: `[from,to)` 경계 샘플·빈구간·stream/segment 분리·선택 범위보다 큰 원본 bin extra range를 확인. 샘플행 Parquet는 실제 reader로 읽으며 binary-payload 연구 Parquet와 다른 schema로 구분한다.
- [ ] 가명: 원 UUID·장치 ID·object_key·절대 tick/UTC·모델 원 ID가 sidecar/bin/header/파일명에 남지 않는다. 원문 bin이 금지된 정책에서는 차단사유 및 redacted_packet_view를 확인하고 무손실 원본이라는 이름을 붙이지 않는다.
- [ ] 큰 파일: 최종 ZIP 999,999,999/1,000,000,000/초과 경계를 검증. 각 part 독립 열림·root meta 포함·중첩ZIP 없음, CSV 행/Parquet row-group 경계, 전체 복원 count/hash 중복0/누락0. metadata 오버헤드까지 크기 합산한다.
- [ ] 합격: C의 `verify-sdd244-artifacts.py`와 별도 ZIP/CSV/Parquet reader가 모두 통과. sample/feature/UI 연계 hash와 pinned manifest revision이 일치한다.

### A11 — 동의·인가·90일·연구ACK(T04/T13/T14)

- [ ] 단위/API: 본인/다른 참여자·다른 기관·관리자 조회권한만 보유·expired entry credential·구버전·미동의·철회·비회원 연구반출 차단. raw/feature/indices/manifest/재시도 경로 모두 동일 권한 검사.
- [ ] PG: 기준일 `(ended_at ?? created_at)+90일` 경계±1µs, completed/cancelled·template·적용하한. 연구ACK+90일로 연장되지 않는다. sweep 비활성/legacy와 중복 금지.
- [ ] 통합: EEG ACK/PPG 미ACK/ACC 미동의 조합에서 EEG는 정책에 따라 만료, PPG는 유효 동의이면 보류, ACC는 반출 차단·보류 비대상. 범주/artifact kind·revision/hash가 다른 ACK 재사용 차단. r5-2를 신규 범주 자동 동의로 인정하지 않는다.
- [ ] 연구 v3: 새 raw3/feature/indices/gap/version 파일·가명·field-list hash·scope를 검증, 수신자 구version이면 pending. legacy v2 ACK는 legacy 범주만 변경한다. 철회와 ACK 동시 경합은 철회 반출차단을 우선 보존한다.
- [ ] PG+모의 객체: 원장 commit 후 객체 삭제 실패/재시도/작업 종료, tombstone와 deletion outbox가 실제 객체완료와 구분된다. raw-derived 필터파형·샘플별 mask·export 임시 사본도 만료/철회 대상, 파형 없는 feature/모델은 기존 feature 정책 유지.
- [ ] 합격: 연구 반출범위 확대0, unauthorized payload0, unknown ACK로 삭제0, 재시도 후 정책 결과 일치. 실제 운영 삭제/연구 전송은 이 시험에 포함하지 않는다.

### A12 — 용량·처리량·메모리 계측(T15/T16/T18)

- [ ] 아래 §4 계측표를 synthetic60분·실기기60분으로 채우고 예산과 비교한다. 예산은 측정 결과가 아니다.
- [ ] 1명과20명(더 큰 계획 상한이 있으면 그 상한) 조건에서 emit 빈도·객체수·PUT/ACK 호출·queue peak·CPU/heap/persistence p95/p99·DB/WAL·반출 작업공간을 기록한다.
- [ ] 합격: 요구 필드/emit 누락 없이 상한 내에서 지속하거나 안전 중단을 정확히 표시. 180–650MB/인·시간을 벗어나면 압축/청크/비용 재산정 검토 전 출시 인수 보류. 저장 범주 생략으로 통과 금지.

### A13 — 레거시·밴드 미착용·핵심 회귀(T03/T12/T15)

- [ ] 세 신호가 같은 원장에 있을 때 기존 EEG 조회/연구v2/legacy retention/file_count에 PPG·ACC가 섞이지 않고 v2를 v1 float32로 디코딩하지 않는다. legacy nullable participant·segment 기본값·동시요청 unique 회귀를 PG에서 검증한다.
- [ ] v1 float32 bytes 유지, schema1.0은 내용 검증 가능한 fixture만 해석하고 불명은 unsupported. legacy missing ADC/tick/PPG/ACC/snapshot은 unavailable이며 reconstruction으로 위조하지 않는다.
- [ ] 밴드 미착용/observationOnly: 생체 저장은 not_collected, 상담·명상 진행·녹음·AI요약·리포트·종료 흐름이 정상이다. EEG 없는 몸 지표/품질 게이트는 기존 의미를 유지한다.
- [ ] 기존 EEG uploader·feature WS ACK/REST fallback·play_group null uniqueness·정규화·클래스 리포트·기존 사용자 ZIP·연구/retention 회귀를 실행한다. 변경 원인 실패와 기준브랜치 기존 실패를 구분한다.
- [ ] 합격: 구버전 앱 허용 범위 유지, 기존 raw 파일/feature/리포트 계약을 깨지 않으며 모르는 과거 데이터를0으로 채우지 않는다.

## 4. 용량 실측 설계(현재 측정값 없음)

plan의 raw v2는 ADC와 환산값을 함께 보존하므로 spec 초기 가정보다 크다. 압축 전 sample section 산술은 EEG15.30MB/h(250×17×3600), PPG1.44MB/h, ACC1.944MB/h(30×18×3600), 합18.684MB/h이며 여기에 원packet·header/map·feature·raw-derived·indices·DB·export가 추가된다. spec의180–650MB/h는 초기 예산이고 상한 보장이 아니다.

| 계측 항목 | 기록 단위·방법 | 판단 |
|---|---|---|
| raw sample/packet/map | signal/profile별 bytes/count, 파일 hash와 wire bytes | 가정 vs 실제,25/30Hz 별도 |
| feature/raw-derived/indices | emit/s·records·압축 전/후 bytes·window 중첩률 | 상세 feature 전량과1Hz scalar/snapshot 분리 |
| 객체/API | raw3종 최소1,080/h, feature·indices 각360/h 가정+raw-derived·크기분할 추가; PUT/GET/HEAD/ACK 실제 횟수 | spec1,800/h를 확정값으로 사용 금지 |
| IndexedDB/메모리 | 2분/10분/60분 offline quota·queue bytes·journal p95/p99·peak heap | quota80% 경고·95% 또는2분 여유 미만 중단, 미영속8MiB 상한, silent loss0 |
| 수집 지연 | notify→durable latency, 분석 동시부하, foreground/background 구분 | 정상 foreground p99≤100ms 목표. 초과 시 손실창/부하 개선 후 재시험, OS 중지는 보장 제외 |
| 장시간 메모리 |30분/60분 drain 후 heap 차이·peak·객체 retained count | queue external storage 제외 heap 증가≤20MiB 목표, 선형 누수 없음 |
| 서버/PG | 20명 ACK p95/p99·DB insert/s·WAL bytes·잠금/rollback·connection count | lost/overwrite0, 온라인 복구 구간5분 내 정상 backlog drain 목표 |
| ZIP | 원본/압축 크기·최종part bytes·작업공간 peak·CPU/생성시간 | 최종part≤1GB, whole ZIP 메모리 적재 금지, 독립 복원 |
| 월 비용 산술 | 실제 bytes×90일 서비스 보관 + 연구보류/사본 별도, PUT/GET/검증read/반출 | 최신 견적 확보 전 가정 단가로만 표기, 실제 청구액이라고 보고 금지 |

위 latency/heap/drain 값은 기술 인수 목표다. 환경/장치 사양과 함께 기록하고 미달 시 원인/재산정 근거를 남겨 재검토한다. 절대적인 OS 지속측정 보장으로 표현하지 않는다.

## 5. 실행 명령·회귀 범위(향후, 현재 미실행)

- BE focused: `cd backend` 후 `pytest tests/test_sdd244_ingest.py tests/test_sdd244_decoder.py tests/test_sdd244_export_contract.py tests/test_sdd244_policy.py`.
- PG: 승인된 격리 PostgreSQL fixture 환경에서 `pytest tests/pg/test_sdd244_schema.py tests/pg/test_sdd244_ingest.py tests/pg/test_sdd244_policy.py`. 빈DB와 현재 head synthetic seed→새 migration upgrade, legacy/new writer 공존·unique 경합·rollback·잠금 계측. 운영 연결·자동 downgrade 금지.
- migration 정적 확인: `python3 scripts/check-alembic-heads.py`로 단일 head; 배포 시 실제 upgrade는 별도 승인 대상이다.
- FE focused: `cd frontend` 후 `npx vitest run tests/sdd244-capture.test.ts tests/sdd244-queue.test.ts tests/sdd244-features.test.ts tests/sdd244-algorithms.test.ts tests/sdd244-display.test.tsx tests/use-eeg-raw-upload.test.tsx tests/sdd222-raw-upload-resume.test.tsx`와 `npm run build`.
- BE 회귀: `test_sdd209_b12_retention_sweep.py`, `test_sdd209_b13_research_export.py`, `test_sdd241_research_export_metadata.py`, `test_sdd241_research_notice_consent.py`, `test_normalization.py`, `test_normalization_score.py`, 클래스 report 관련 tests. model/schema/migration 변경이므로 통합 시 BE 전체 pytest/PG migration suite도 필요하다.
- FE 회귀: 기존 session-live/feature queue/신호 연결/member-class/정규화·플레이어·상담 테스트, 전체 vitest. 실제 Chrome/Edge 별도 harness·DOM 및 네트워크/IndexedDB 관측. 빌드만으로 화면 성공 판정 금지.
- 독립 검증 도구: `scripts/verify-sdd244-artifacts.py`는 `--input <합성ZIP> --expected <golden.json>`을 받아 schema/count/hash/gap/field coverage 실패 시 nonzero 종료. `scripts/measure-sdd244-capacity.py`는 `--participants 20 --minutes 60 --profile mb-web`로 bytes/emit/object/API/memory 지표를 JSON 출력하도록 T15에서 작성한다. 이들은 아직 없는 미래 산출물이며 측정대상 실행기와 명시적으로 연결한다.

## 6. 결과 기록 양식·완료 판정

| ID/플랫폼 | 실행 commit·명령·fixture | 기대/실제·증거 위치 | 상태·담당 |
|---|---|---|---|
| A01~A08/A10~A13 | 미실행 | 미측정 | 구현 후 A/B, 독립 C(A가 C 산출 검증) |
| A09 Chrome/Edge | 미실행 | 장치/firmware 미확인 | W4 C |
| A09 iOS/Android | 미실행 | 새 앱/실기기 미검증 | W5 C |
| 용량/비용 | 미실행 | 산술 가정만 있음 | T15/T16/T18 |

향후 summary에는 통과/실패/미실행을 따로 기재한다. W4 웹 완료와 W5 앱 완료를 구분하고 실기기·PG·실제 ZIP 증거 없는 항목은 체크하지 않는다. 이번 문서 검토는 경로·AC 추적·소유권·범위 정합성만 확인하며 Stage⑤ 테스트 실행을 대신하지 않는다.

### 이번 문서 검토 기록(제품 검증과 별개)

2026-10-24 작성자와 읽기 전용 독립 검토자가 spec·research·plan·verify를 대조했다. ACK 후 유효 URL 재PUT 불변성과 종료 expected set의 raw-derived/model/gap 누락 위험을 보완했다. 문서 정적 검사에서 Task18개·각2~5시간·합계75시간(A19/B28/C28), 담당 경로 패턴58개 소유권 중복0, A01~A13 모두 존재, 실행 완료 체크0, 문서 상대링크와 기존 담당 파일 존재를 확인했다. 변경 범위는 plan.md·verify.md 두 파일이며 spec/research는 변경하지 않았다. 이 결과는 문서 정합성 증거이며 제품·DB·실기기·업로드·다운로드 테스트 결과가 아니다.
