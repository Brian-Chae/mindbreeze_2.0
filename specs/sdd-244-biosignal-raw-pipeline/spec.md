# SDD-244 — 생체신호 원데이터 전체 저장·처리 파이프라인

- 상태: **Stage ① Spec — 검토 요청**. 작성일: 2026-10-24.
- 워크트리: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd244`, 브랜치: `sdd/244-biosignal-raw-pipeline`.
- Brian 요구: EEG·PPG·ACC 원데이터, feature data, 화면 6대 지표를 모두 서버에 저장하고 다운로드할 수 있어야 한다. 처리 과정을 파악한 뒤 개발한다.
- 이번 산출물은 Spec과 입력 research 3개뿐이다. Plan/Verify/구현/실기기 검증/배포를 수행하거나 SDD 완료를 선언하지 않는다. 아래 설계·수용 기준은 **미구현 제안·미실행 시나리오**다.

## 1. 근거와 현황

### 1.1 근거 기준

모든 `research/파일:행`은 이 spec 디렉터리 기준이다. 조사 문서는 정적 소스 연결을 확인한 것이며 운영 저장 성공·수치 정확도·장치 규격을 입증하지 않는다. 소스 위치·조사 HEAD는 각 research의 서두에 있다. 아래 소스 경로는 MIND BREEZE 루트 기준이며 HARU/SDK 경로 별칭은 해당 research 정의를 따른다.

- **M**: `research/01-mindbreeze.md:3-5`, `:12-19`, `:203-231` — MB 수집·저장·유실 위험.
- **H**: `research/02-haru-band.md:5-23`, `:70-91`, `:121-140` — HARU 처리 차이와 저장 한계.
- **L**: `research/03-linkband-sdk.md:18-31`, `:46-81`, `:247-261` — SDK 플랫폼별 차이.
- **D243**: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd243/specs/sdd-243-platform-data-center/spec.md:185-237`, `:408-416` — 미래 다운로드 소비 계약. 현행 구현의 증거가 아니다. 이 문서는 해당 파일을 수정하지 않는다.

### 1.2 신호 × 수신·처리·저장·다운로드

| 대상 | MB 수신·단위 | 현재 처리 | 현재 서버 저장 | 현재 다운로드 | 근거 |
|---|---|---|---|---|---|
| EEG raw | 250Hz, Fp1/Fp2, signed24→µV, lead-off | FE 60Hz notch→1–45Hz bandpass→앞15% 제거→SQI→Morlet→대역파워·원지표 | 헤더 없는 LE float32 2채널 bin + 청크 원장. 원 ADC/tick/lead-off는 bin에 없음 | 일반 ZIP raw 없음; 연구 Parquet는 bin payload 포장 | M `:28-60`, `:84-92`, `:182-197` |
| PPG raw | 50Hz, red/IR, unsigned ADC count | FE DC 제거·1–5Hz 필터·peak/RR→BPM·HRV·호흡 | raw 미연결, 일부 파생값만 feature 저장 | 파생값만 | M `:62-71`, `:85-86`, `:104-129` |
| ACC raw | 30Hz, xyz, int16→g | FE magnitude·movement·intensity→motion | raw 미연결, motion만 저장 | motion만 | M `:30-40`, `:73-76`, `:104-129` |
| feature | 분석창·원지표·대역파워·몸 지표 | FE 계산; BE 검증·저장·롤업/리포트 재계산 | 일부 컬럼만 충전; PSD·채널 SQI·RR/peak 등 없음 | 일반 features CSV, 연구 features Parquet | M `:78-80`, `:104-140`, `:182-197` |
| 화면 6대 지표 | 집중·이완·감정균형·BPM·호흡·HRV | 마음3 모델 정규화; 몸3 물리량; 게이트·hold·반올림 | 당시 값·모델·표시 버전 스냅샷 없음 | 원 feature/리포트는 당시 화면값과 다름 | M `:142-161`; H `:91` |

### 1.3 세 저장소 비교와 채택 원칙

| 범주 | MIND BREEZE | HARU BAND | LINK BAND SDK군 | 판단 |
|---|---|---|---|---|
| 시각 | 장치 tick→host anchor, EEG/PPG 샘플별 시각은 계산하나 저장 경계에 유실 | 같은 패킷 모든 샘플 Date.now | 웹 마지막 샘플 기준, native/Python 첫 샘플 해석·시간 단위 차이 | MB 샘플 시간·원 tick·수신시각을 함께 보존 |
| 업로드 | EEG 영속큐+presign/PUT/ack 있으나 삭제 결함 | raw 메모리 누적→종료 JSON PUT; `.parquet` 이름 불일치 | 웹 IndexedDB/CSV, Python 종료 파일, native CSV | MB 서비스 확장, 타 저장기 통째 복제 금지 |
| feature/화면 | 일부 feature만; 화면6 스냅샷 없음 | feature 테이블 있으나 화면 호흡 별도·미저장 | 웹 analysis CSV는 헤더만; Python 알고리즘 다름; native 분석 구현 미발견 | raw/feature/표시값을 별도 계층으로 저장 |
| HRV·호흡 | raw IR RR, 최근60 RR·30초 gate; 호흡60초 gate | filtered IR RR·중복 제거, 시간/주파수 버퍼 분리; 호흡 hook | 웹 호흡0 placeholder, Python 호흡 반환 없음 | 알고리즘 버전 고정, SDK의0을 정상 호흡으로 채택 금지 |
| ACC | 공통 JS 파서30Hz·signed16→g | 30Hz·g | 독립 native25Hz·축당1byte; Python30Hz raw count | MB 앱이 native SDK25Hz를 쓰는 것으로 오인 금지 |

근거: M `:25-49`, `:64-71`, `:84-102`; H `:18-23`, `:31-42`, `:74-91`, `:123-138`; L `:63-81`, `:170-188`, `:247-261`. MB Capacitor 앱은 DataView를 공통 JS 파서에 전달한다(M `:25-26`).

## 2. 문제와 우선순위

P0는 저장 손실 방지 선행조건, P1은 전체 저장·다운로드 출시 필수, P2는 호환 확장이다. ‘확인’은 코드 경로 확인이며 운영 사고 발생 횟수는 미확인이다.

| 우선 | 문제·영향 | 판정·근거 | 요구 대응 |
|---|---|---|---|
| P0 | **EEG raw ACK 실패 확인 없이 로컬 삭제 → 데이터 유실 가능** | `frontend/src/hooks/useEegRawUpload.ts:180-184`(요청의180-183 구간 포함), `backend/app/services/eeg_raw_service.py:221-248`; M `:98`, `:211` | HTTP200과 저장 성공 분리. 해당 청크의 검증 성공 ACK만 삭제 허용 |
| P0 | 최대8회/특정4xx에서 dead-letter 로그 후 실제 삭제; enqueue 실패에도 메모리 비움 | M `:98-102`, `:212` | 영속 실패 보관, 용량 실패 시 기록 중단·명시적 손실 이벤트, 묵시 삭제 금지 |
| P0 검증 | mount 후 index0·복구 stream으로 청크 키 충돌/덮어쓰기 위험 | **추정**, M `:213` | 재시작·다중 탭·동일키 다른 payload 재현, 불변 ID·충돌 거절 |
| P1 | PPG/ACC raw 미저장 | 확인, M `:207` | 처리 전 원샘플 영속 수집 |
| P1 | 화면6·정규화 모델·알고리즘 버전 미저장 | 확인, M `:142-161`, `:208` | 1초 표시 스냅샷과 모델 파라미터 보존 |
| P1 | 호흡수 누락 | **MB에는 계산·feature 전송 경로 존재**(M `:70`, `:119-123`); HARU 화면 호흡 feature 미포함(H `:80-89`), SDK 미구현(L `:255`) | MB 유효값·null 이유·다운로드 포함 검증. 없는 알고리즘으로 단정하거나0으로 보충 금지 |
| P1 | total_neural_activity/faa/play_group_id 미전달, PSD·채널 SQI·RR/peak 등 미저장 | M `:104-129`, `:209`, `:219` | 기존 컬럼과 중간 feature를 모두 계약화 |
| P1 | 샘플 시각 불충분 | HARU 패킷 단일 수신시각(H `:33-42`); MB parser는 샘플시각 계산하나 raw start/end는 수신·flush 시각(M `:44-49`) | 원 clock와 샘플별 시간 재구성 근거 저장 |
| P1 | BLE gap 서버 미기록 | M `:100`, `:215`; 로컬50건, 리포트 lost는 별도 존재 | 지속적 gap 원장·coverage |
| P1 검증 | RR 중복 누적으로30/60초 gate 조기 충족 위험 | **추정**, M `:216`; H `:74-78` | beat 시각 기반 중복 검사·실제 경과 창 검증 |
| P1 | HRV 알고리즘 HARU와 다름 | 확인, H `:72-78`; MB LF/HF 예외 배율도 M `:71` | 비교 fixture·버전 기록. 동일 수치 약속 금지 |
| P1 검증 | native ACC25Hz, byte/부호·PPG endian·header anchor 차이 | 코드 차이 확인/실장치 원인 미확정, L `:68-81` | 펌웨어 프로필별 raw packet 비교. 값만30Hz로 라벨 교체 금지 |
| P1 검증 | S3 서명헤더 미전달, ACK checksum 미검증/검증 불가 경로, SQI/PSD 왜곡 위험 | M `:92`, `:214`, `:217-218` | 서명헤더 일치·실제 checksum 확인, 분석 영향 독립 시험 |
| P2 | SDK별 불완전 내보내기·단위 상이 | L `:203-245`, `:317-327` | MB 원본 정본, 명시적 SDK 변환 프로필 |

## 3. 목표 설계 — 기술 결정안

### 3.1 수집과 불변 청크

흐름: `BLE 패킷 → 영속 수집 큐 → 신호별 불변 청크 → presign → PUT → 검증 ACK → 로컬 완료/삭제 → 회차 manifest 확정`. 분석기는 수집 큐 이후 독립 소비자로 두어 분석 부하 때문에 raw callback 이전에 버리지 않는다.

- `signal_type=eeg|ppg|acc`는 센서 구분, `stream_id`는 수집 시작마다 발급·영속화하는 UUID, `segment_id`는 재접속/clock reset/해석 프로필 변경 경계다. 세 개념을 혼용하지 않는다.
- 유일키 `(session_id, participant_id, signal_type, stream_id, segment_id, chunk_index)`; 동일키·동일 SHA-256은 멱등, 동일키·다른 해시는409 충돌로 보존·조사한다. 청크 index와 payload 등록을 한 로컬 트랜잭션으로 확정한다. 다중 탭은 수집 lease로 차단하고 새 수집은 새 stream을 사용한다.
- raw는 필터 전 샘플이다. EEG signed24·lead-off·µV, PPG unsigned24 red/IR, ACC signed16 xyz·환산 g를 보존한다. **BLE 패킷 bytes와 헤더도 보존**하여 endian/scale 재검증 가능하게 한다. 현 EEG `eeg-raw-v1`은 그대로 읽고 새 계약은 `mb-biosignal-raw-v2`; 샘플·패킷·시간 매핑을 함께 해시 검증한다.
- 서버 저장은 신호별 바이너리 객체+메타 원장, 복잡 feature는 버전 있는 JSONL 객체, 검색용 스칼라는 DB. JSON을 Parquet 확장자로 저장하지 않는다. 정밀 바이너리 필드 레이아웃은 후속 Plan에서 고정 fixture와 함께 확정한다.
- 로컬 패킷 배치는 최대100ms로 영속화하고 성공 전 메모리에서 제거하지 않는다. 네트워크 청크는 명목10초 또는1MiB 중 먼저 도달할 때 봉인, 종료/끊김에는 잔여분 봉인. 갑작스런 프로세스 종료의 미영속 구간은 최대100ms 목표이며 OS suspend/quota 실패에서는 이를 보장하지 않는다. 마지막 영속 지점 이후를 unknown loss로 기록한다.
- 기존 EEG presign/ack 서비스·원장을 확장 재사용한다. D243의 `/biosignal-raw/presign`, `/biosignal-raw/ack`는 동일 서비스 어댑터이며 별도 업로드 저장기를 만들지 않는다. 기존 EEG 클라이언트 경로 유지. 수집 본인 참여자·세션·동의 범위를 서버 검증하며 관리자 조회권한이 업로드권한을 주지 않는다.

### 3.2 영속 큐·ACK·종료 manifest

- 상태: `pending → uploading → awaiting_ack → acked`; 일시실패는 retry_wait, 인증/동의/충돌/최대 재시도는 blocked 또는 durable dead_letter. 재시도 횟수로 payload를 삭제하지 않는다. 다른 계정 로그인으로 이전 계정 큐를 전송하지 않는다.
- ACK는 청크별 `chunk_id, checksum, size_bytes, status, verified_at`을 반환한다. 서버 객체 존재·크기·SHA-256(스토리지 검증 checksum 또는 서버 읽기 검증)과 DB 원장 commit이 모두 성공해야 `status=uploaded`다. HEAD 불가/해시 불일치/DB 실패는 성공 ACK 금지. PUT ETag를 SHA-256으로 간주하지 않는다.
- 클라이언트는 **자신의 청크 ID·해시·크기와 일치하는 uploaded ACK를 영속 기록한 뒤에만 해당 로컬 payload 삭제**. ACK 유실은 재조회/재전송하며 서버는 동일 ACK 반환. presign 만료 시 새 URL 발급, 서버가 지정한 SSE 등 서명헤더 그대로 PUT.
- 사용 가능 quota를 관찰해 부족 전 경고·수집 안전 중단. 미ACK 데이터를 조용히 버리지 않는다. 성공 ACK 후 큐 GC와 동의 철회에 따른 정책 삭제는 별도 사유/감사로 분리한다. 로컬 저장 자체가 거부되는 경우 메모리만으로 ‘기록 중’ 성공 표시 금지.
- 회차 종료와 업로드 완료는 별개다. 종료 시 마지막 sequence·샘플수·feature/indices 마지막 index·gap 목록을 포함한 close intent를 영속화한다. 서버 manifest는 모든 기대 청크 ACK/해시를 대조해 `complete` 또는 명시적 `partial`로 확정; 미전송 중에는 `pending_upload`다. 끝나지 않은 stream의 기대량을 아는 것처럼 계산하지 않는다.
- complete는 ‘수신 데이터 전달 완료’이며 ‘BLE 무손실’을 뜻하지 않는다. 수신 전 gap·unknown tail·밴드 미착용을 별도 coverage로 기록한다. 후발 복구는 manifest revision 추가, 기존 revision 불변. 다운로드는 revision에 고정하며 미완료/부분 상태를 숨기지 않는다.

### 3.3 시간·gap·메타

- 패킷별 `device_tick_raw, unwrapped_tick, received_at_utc_us, received_monotonic_us, packet_seq, sample_count, header_anchor, clock_segment_id, parser_profile_version` 보존. packet_seq는 호스트 수신순번이며 장치 패킷 손실을 단독 증명하지 않는다.
- 현 코드가 가정하는 MB 웹 프로필(실기기 미검증)은 tick rate32768, 마지막 샘플 기준 `t_i = mapped_header_time + (i-(N-1))*1,000,000/fs`(µs). 정수 누적 반올림 대신 유리수 rate와 sample index로 계산하여 ACC30Hz 누적 오차를 막는다. 25Hz 프로필은40ms이며30Hz로 재샘플링하지 않는다. 현 ACC 코드는 이전 패킷 이후 연속 배치·큰 간격 재앵커링(M `:47`)을 사용한다. 위 식은 저장 시간축의 목표 계약이며 현 ACC 구현 전체가 이 식과 동일하다는 뜻이 아니다. 펌웨어 실측으로 header anchor를 확정한 뒤 프로필 버전을 부여한다.
- 최초 host wall-clock와 monotonic clock를 anchor로 삼고 이후 장치 경과를 매핑한다. tick wrap과 reset을 구별, reset/벽시계 점프/재앵커링은 새 segment. 원시각은 불변, 보정 시각과 변환 버전은 별도 저장한다. clock 검증 전에는 `host_estimated`/`device_relative`를 사용하며 UTC 정확성·µs 정확도를 주장하지 않는다.
- gap 이벤트: 신호·stream/segment·구간 `[start,end)`·원인(`ble_disconnect, packet_gap, local_write_failed, process_terminated, upload_pending, unknown`)·관측/추정 여부·예상/수신 샘플수·재연결 횟수·발견시각. 전송 지연과 측정 손실을 분리하며 모르는 손실량은 null. 서버 영속 이벤트도 멱등 ACK 적용. raw 보간·중복 제거로 원본을 바꾸지 않고 중복 후보를 표시한다.
- 신호별 metadata: nominal/measured sample rate, channel_names/order, units, ADC scale·range·signedness·endianness, sample/packet count, schema/parser/algorithm/build version, firmware/device model(미확인은unknown), time_basis·anchor·오차 추정, sample range, SHA-256, bytes, retention deadline, consent scope/version. 장치 식별자는 내부 제한 접근, 반출은 가명화한다.

### 3.4 전체 feature와 화면 6대 지표

‘전체 feature’는 기존 DB27개 컬럼만이 아니라 **현재 MB 처리기가 실제 생성하는 원지표·중간 결과 전체**다. SDK30종이라는 이유로 MB에 없는 알고리즘을 새로 만든 것으로 간주하지 않는다.

- 기존 원천 스칼라 전부(§4), `total_neural_activity/faa/play_group_id` 누락 연결 포함. EEG 채널별·병합 band power, 전체 frequency/PSD, SQI 배열/마스크·lead-off, 실제 분석에 사용한 필터 파형·샘플 index; PPG 필터 red/IR, peak sample index·beat ID·RR와 채택/제외 사유·HRV/RSA PSD; ACC 처리기가 산출한 filtered xyz·magnitude·movement·통계·activity 결과를 버전 있는 feature 레코드로 보존한다.
- 각 레코드는 `feature_id, signal_type, stream_id, segment_id, window_start/end, source_chunk/sample_ranges, computed_at, algorithm_id/version, parameters_hash, valid_sample_count, status`를 가진다. 겹친 분석창의 결과를 덮어쓰지 않는다. 반복 배열은 content hash로 중복 저장을 줄일 수 있지만 원 분석 결과 복원이 가능해야 한다. 미구현/무효는 null+reason, NaN/Inf 직렬화 금지.
- MB HRV는 **SDNN(ms)**, RMSSD는 별도 feature. 감정균형은 **정규화 emotional_stability**, SDK emotionalBalance·FAA로 대체하지 않는다. L `:309`의 UI RMSSD 제안보다 실제 MB 바인딩(M `:146-155`)을 우선한다.
- 화면 렌더에 쓰는 동일 snapshot 객체를 1초마다 저장: 마음3 정규화 입력/출력, BPM·호흡(breaths/min)·SDNN 원값/표시 정수, 지표별 `measured_at, displayed_at, source_feature_id, held, stale, lead_off, quality, unavailable_reason`. null 초도 남긴다. 로컬/원격 fallback 출처, 화면 종류·표시 버전 포함. 화면 비활성 시 실제 표시됐다고 주장하지 않고 `not_rendered`로 구분한다.
- 활성 정규화 모델 ID/version, 지표별 파라미터 `{m,s,direction}`·공식상수·hash, B0 fallback 버전/사유, 필터·분석·표시 pipeline 버전·앱 build를 고정 보존. 모델 변경 전후를 구분하고 최신 모델로 과거 스냅샷을 덮어쓰지 않는다. 재계산은 별도 `source=reconstructed`, 동일성 보장 안 함.
- 저장 목적의 기존 마음3 표시값 보존이며 종합점수·순위 신설은 없다. 웰니스 리포트는 서사·변화량 원칙 유지.
- HARU와 동일 알고리즘으로 일괄 전환하지 않는다. 첫 수집 버전은 MB 결과를 명시적으로 기록하고 RR 중복·LF/HF 배율 등 재현된 결함은 새 알고리즘 버전으로 수정한다. 현재 버전의 수치 정확성 인증과 기록 완전성은 별개 인수 항목이다.

### 3.5 90일·연구·retention

근거: M `:163-178`, `:189-197`; D243 `:410-414`. SDD-238의 기준일은 ended_at(없으면 created_at)+90일이며 연구 ACK+90일이 아니다. 통합 sweep 기본 비활성/legacy0 설정은 코드 기본값이고 운영 활성 상태는 미확인이다.

- 서비스 EEG/PPG/ACC raw·패킷·raw와 동등한 필터 파형은 동일90일 정책 대상으로 묶는다. 원본을 다른 이름의 feature에 복제해90일 제한을 우회하지 않는다. 스칼라 feature·indices·모델 버전은 기존 feature 보관 체계와 연계하며 새 무기한 원본 보관 경로를 만들지 않는다. 필터 파형·샘플별 품질마스크는90일 raw-equivalent 객체로, 스칼라·PSD·RR/peak·창 요약은 별도 feature 객체로 물리 분리한다. feature는 파형 객체 참조만 가지며 만료 후 참조 상태를 expired로 보존한다. 파형을 포함한 export 임시 사본에도 원본 만료/철회 재검사를 적용한다.
- SDD-238 연구 예외: 해당 신호를 포함한 유효 연구동의가 있고 연구 이관 미ACK이면 원본 삭제 보류. EEG ACK 하나로 PPG/ACC까지 완료 처리 금지. 해당 신호 동의가 없으면 반출 차단·연구 보류 비대상, 철회는 현행 철회 상태 전이에 따른다.
- SDD-241 연구 사본 계약을 신호별 raw/feature/indices와 stream/segment·gap·알고리즘/모델 메타까지 버전 확장. manifest의 신호별 파일 hash·revision·동의 scope를 ACK에 바인딩. 기존 r5-2가 신규 범주까지 허용하는지는 고지 범위 검토 후 결정하며 자동 확장 동의로 간주하지 않는다. 연구 사본 영구 보관 정책은 원본90일과 분리, 일반 다운로드 기간을 늘리지 않는다.
- retention 평가·원장·객체 삭제·재시도를 세 신호와 파형 feature에 동일 적용. 삭제 원인/시각·coverage tombstone은 남겨 `expired`와 `not_collected`를 구분하되 바이오 payload·재식별 정보는 남기지 않는다. DB 삭제 성공과 객체 삭제 완료를 구분한다. 이번 작업에서는 dry-run조차 실행하지 않는다.

### 3.6 저장량·비용 추정

**측정값/클라우드 견적이 아닌 설계 산술 가정**. 참여자1명·60분·EEG250/PPG50/ACC30Hz·압축 전 decimal MB(1MB=10⁶B), 샘플당 시간은 packet sidecar로 계산한다.

| 계층 | 가정 | 60분 MB |
|---|---|---:|
| EEG 값 | 250×2×float32(4B)×3600 | 7.200 |
| PPG 값 | 50×2×uint32(4B)×3600 | 1.440 |
| ACC 값 | 30×3×float32(4B)×3600 | 1.296 |
| 패킷 원본 | (250×7+50×6+30×6)×3600, 패킷4B헤더 제외 | 8.028 |
| 패킷 헤더/시간 sidecar | 합계20notify/s×(4+48)B×3600 가정 | 3.744 |
| 스칼라·indices | 각1Hz, 합계1.5KB/s 가정 | 5.400 |
| PSD/SQI/RR/필터파형 feature | 1초당40KB 가정(중첩 창 저장) | 144.000 |
| 합계 | 인덱스·JSON 문자열·DB/WAL·ZIP 작업영역 제외 | **171.108** |

feature 발생빈도가4Hz이면144MB 항목은576MB로 증가하여 총603.108MB다. 따라서 **예산 기준180–650MB/인·60분**,30분은90–325MB,20명 회차는3.6–13GB를 임시 사용한다. 전체 중간 feature 저장은 raw9.936MB만 계산한 예산보다 훨씬 크다. 압축률·중복 제거율·실제 분석빈도를 계측하기 전 낮은 용량을 약속하지 않는다.

- 10초 청크는3신호×360=1,080 raw 컨테이너/인·시간(샘플·패킷·sidecar·해당 파형을 함께 보관), feature는3신호를 묶은 객체/indices 객체 각10초 묶음이면 추가720객체 가정. 다운로드는 컨테이너를 디코딩하여 위 파일로 분리한다. 실제 저장 구현에서 패킷/파형을 별도 객체로 나누면 객체수·PUT 비용도 다시 산정한다. 객체/메타 overhead와 presign·PUT·ACK 호출량을 부하 시험한다.
- 비용 예시 입력값: 저장단가 **가정** $0.03/GB·월, PUT **가정** $0.005/1,000건, 반출 **가정** $0.10/GB. 실제 AWS 지역/요금 인용이 아니다. 60분1인180–650MB의90일 저장은 $0.0162–0.0585,1,800 PUT은 $0.009,1회 전체 반출은 $0.018–0.065다. GET/검증 read/DB·백업·연산·세금 제외.
- 매일100인·60분이면90일 정상상태 원본1.62–5.85TB, 위 가정 저장비 월 $48.6–175.5. 연구 보류·영구 사본·중간 feature 장기보관은 추가이며 상한이 아니다. 출시 전 실측으로 예산/청크를 조정하되 요구 데이터를 임의 생략하지 않는다.

## 4. 다운로드 계약 — SDD-243 소비

MB 원본 ZIP을1차 정본으로 채택한다. D243의 회차/참여자 폴더·가명·1GB 독립 part·중첩 ZIP 금지·기관/목적 인가·사유/감사·만료 정책을 그대로 소비한다. SDD-244는 저장·디코더·manifest/field dictionary 계약, SDD-243은 선택 UI·작업·인가·ZIP 생성/전달을 담당한다.

```text
class-C01/session-001_date-withheld/participant-P01/
  eeg_raw.csv                 # 또는 샘플행 Parquet
  ppg_raw.csv
  acc_raw.csv
  features.csv
  indices.csv
  meta.json
  README_ko.md
  raw/{signal}/stream-S01/segment-001/chunk-000001.bin
  raw/{signal}/stream-S01/segment-001/packets-000001.bin
  features/{eeg,ppg,acc}.jsonl
  raw-derived/{eeg,ppg,acc}-waveforms.jsonl
  meta/{sample-map,gaps,display-status}.jsonl
```

추가 하위 파일은 전체 중간 feature/패킷/상태를 빠짐없이 전달하기 위한 **D243 additive 확장안**이다. 루트 manifest/dictionary/README 유지, 단일 신호 재시작·gap은 D243의 `eeg_raw-stream-S01-segment-001.csv` 규칙으로 분리한다. raw bin은 decoder schema로 의미를 구분하고 기존 EEG bin의 바이트를 변경하지 않는다.

| 파일 | 고정 컬럼·내용 | 단위/계약 |
|---|---|---|
| eeg_raw.csv | `timestamp,fp1,fp2` | µV, float32 왕복 정밀도. ADC·lead-off·packet/sample index는 sample-map/패킷 원본으로 연결 |
| ppg_raw.csv | `timestamp,red,ir` | unsigned ADC count 정수, 명목50Hz |
| acc_raw.csv | `timestamp,x,y,z` | g, 명목30Hz(다른 프로필이면 실제 rate 명시), int16·환산계수 sidecar |
| features.csv | 키 `play_group_id,window_index,t_rel_ms` + 아래27개 원천 컬럼 | 기존 D243 고정 컬럼 유지, 미수집 null·사유. source feature/window 연결은meta |
| indices.csv | `t_rel_ms,play_group_id,window_index,focus,relaxation,emotional,bpm,respiration,hrv`, 각 `*_display_input`, `normalization_version,normalization_model_id_alias,normalization_params_hash,normalization_source,display_pipeline_version,source,display_match,unavailable_reason` | 마음3 표시 정수0–100, bpm, breaths/min, **hrv=SDNN ms**; 실제 표시와 입력 분리 |
| features/*.jsonl 및 raw-derived/*-waveforms.jsonl | §3.4 전체 분석 레코드·중간 배열·알고리즘/창/원본 참조;90일 파형은raw-derived에 분리 | PSD µV²/Hz·band power µV², RR/SDNN/RMSSD ms, LF/HF ms²(버전별 확인), 비율 무차원, motion0–1. 불확실 단위는unknown+버전 |
| meta.json/sidecars | 신호별 schema·채널·단위·rate·원본 범위·시간매핑·gap·snapshot 지표별 모델/게이트·hold·source·manifest revision | 가명 ID만 반출. 원 장치 tick·벽시계는 정확시각 인가 범위에서만, 가명본은 상대 offset으로 변환 |
| README_ko.md | 시간/단위·결측·schema/버전·디코딩·실제 포함범위·제외사유 | 당시 표시/재계산/집계, raw/필터파형, nominal/observed 구분 |

features 원천27개: `focus_index,cognitive_load,relaxation_index,stress_index,emotional_stability,total_neural_activity,faa,hemispheric_balance,delta_power,theta_power,alpha_power,beta_power,gamma_power,total_power,meditation_level,attention_level,signal_quality,sdnn,rmssd,lf_power,hf_power,lf_hf_ratio,heart_rate,respiratory_rate,motion,quality,device_timestamp_ms`. 키는 별도다.

- 시간대: 내부 UTC µs + 상대µs 보존, UI KST(+09:00). 가명 CSV timestamp는 회차 공통 기준의 상대 초, 모든 신호 같은 기준 사용. `t_rel_ms`는 같은 기준의 ms다. 정확한 날짜 인가 및 시간근거 확인 때만 UTC ISO8601 `Z` 사용; 한 파일에서 상대/절대 혼합 금지. host 추정시각은 그 한계를 명시한다. 가명 feature의 device_timestamp_ms는 null이며 이유를 제공한다.
- CSV UTF-8/RFC4180, 소수점 '.', null은 빈칸, 0과 구분. JSON null, NaN/Inf 금지. 파일마다 행수·바이트·SHA-256·실제 범위·schema·time_basis를 manifest에 기록. 선택범위는 `[from,to)`; bin은 겹치는 청크 전체, CSV/Parquet는 샘플시각으로 자른다.
- 가명 반출에서는 원 BLE 패킷의 device tick도 상대화 필요 여부를 평가한다. 원문 변환이 필요하면 무손실 원본이라고 부르지 않고 `redacted_packet_view`로 별도 제공하며 원문 bin은 차단 사유를 명시한다. 서버 정본은 변경하지 않는다.
- 없는 신호는 `not_collected/unsupported_client/expired/withdrawn/lost/unknown`을 구분, 영값 파일·가짜 waveform 생성 금지. raw 없는 과거 회차·snapshot 없는 과거 indices는 소급 복원 불가. 필요한 경우 reconstructed를 명시한 별도 산출물만 허용한다.
- SDK 변환 프로필은 **선택적2차 제안**: `linkband-web-v1`, `linkband-python-v1`, `linkband-android-csv-v1`, `linkband-ios-csv-v1`. web/native ms vs iOS/Python s, ACC count/g·25/30Hz 차이·누락 필드를 manifest에 표시한다. 컬럼 호환이 분석 알고리즘 동등성을 뜻하지 않으며 SDK의 빈 feature 파일/손실형JSON 버그를 재현하지 않는다. native1byte ACC에서16bit 역복원 금지. 근거 L `:317-327`.

## 5. 범위 분할·마이그레이션

| 단계 제안 | 포함 | 경계·의존 |
|---|---|---|
| 별도 긴급 FIX(권장) | EEG ACK 본문 검증, 미ACK/재시도초과 영속 보존, enqueue 실패 보존; 키충돌은 재현 후 범위 확정 | 전체244 완료를 기다리지 않고 현 수집 유실 경로부터 막음. 이번에는 코드 작성/카드 생성 안 함 |
| SDD-244 웹·서버 | 세 신호·패킷/feature/indices 영속화, manifest/gap, retention/연구 확장, 버전 디코더 | Spec 승인 후 Plan→구현 전Verify. 알고리즘 결함 수정은 재현 근거/버전 변경 필수 |
| SDD-244 앱 | 공통 JS 수집+영속큐/재개, iOS/Android 새 bundle 빌드 | **앱 재빌드 필요**. 새 BLE 플러그인 도입은 현재 근거상 필수 아님. 백그라운드 지속 측정을 OS에서 보장 못 하면 gap·pending을 정확히 보고 |
| SDD-243 병렬 | 확정 DTO/schema fixture 기반 UI·조회·기존EEG/feature·ZIP·인가 | raw/feature/indices/manifest 계약 고정 후 병렬 가능; 새 PPG/ACC 실제 제공·표시 동일성 인수는244와 새 앱 검증 후 |
| 2차 호환 | SDK별 변환 profile | MB 정본 출시와 분리 권장 |

- additive migration: 신호별 청크 메타/unique key, stream/segment/manifest revision/gap, feature 객체 참조, indices·모델 snapshot/version 추가. 기존 EEG 원장·eeg-raw-v1·feature 컬럼 의미 유지. Alembic 담당1명, 기존 head 확인 후 단일 계보 유지(이번에는 생성/실행 안 함).
- 순서: 서버 구·신계약 수용→신규 웹/앱 capability 표시→계정/회차 단위 확대→검증 후 구 uploader 종료 검토. 앱 구버전은 EEG-only/indices-unavailable로 명시, 과거 PPG/ACC나 당시 화면값 backfill 금지. 기존1.0 schema는 실제 바이트 검증 없이는v1로 단정하지 않는다.
- rollback은 신규 수집 비활성·기존 경로 유지, 이미 저장된 v2를 읽는 디코더 유지. 컬럼/객체 삭제·자동 downgrade는 하지 않는다. retention 적용하한·확장 연구동의는 별도 활성화 검토, 과거 원본 일괄 삭제를 포함하지 않는다.
- 이번 변경 파일은 spec.md와 research3개. 제품 코드·서버·DB·.env·메일·삭제·PR 머지·배포는 범위 밖이다.

## 6. 수용 기준·검증 시나리오 — 모두 미실행

다음은 Stage① 요구이며 Stage③ verify.md를 대체하지 않는다. 구현자는 독립 검증자가 원본→서버→다운로드를 대조할 수 있는 합성 fixture·재현 로그를 제공해야 한다.

| ID | 수용 기준 | 검증 시나리오/합격 증거 |
|---|---|---|
| A01 | 3신호 수신 샘플100%가 영속화 또는 명시적 loss로 설명됨 | 60초 fixture EEG15,000/PPG3,000/ACC1,800, 원 정수·변환값·lead-off·packet hash와 서버/CSV/Parquet 일치;25Hz fixture는1,500 |
| A02 | 검증 ACK 전 로컬 삭제0건 | HTTP200+failed, 누락 ACK, checksum/size 불일치, HEAD 불가, DB실패, ACK후 앱종료·응답유실; 큐 보존/재개·단일 서버객체 확인 |
| A03 | 재시작·중복·순서역전에도 불변성 | 같은키 같은payload 재전송, 같은키 다른payload409, mount index0/다중탭·계정전환·오프라인·재시도8회 초과·403·quota 주입; 새 데이터 덮어쓰기0 |
| A04 | 시간축과 gap을 복원 가능 | 패킷단일 arrival·샘플 간격4/20/1000÷30ms, wrap/reset·벽시계변경·3초 BLE유실·재연결·프로세스강제종료; 무보간·segment/gap 일치, 불명 손실은null |
| A05 | feature 전체와 UI6의 출처 보존 | 출력 객체 필드 inventory 대비 JSONL 누락0, 기존27컬럼/미전달3개 확인; PSD/SQI/filtered/RR/ACC 배열과 원창 연결 |
| A06 | 표시 snapshot 1Hz·null초·버전 일치 | 실제 화면6 정수와 indices 대조, 정상/접촉불량/stale/held/원격fallback/모델변경/B0/offscreen; 마음3 재계산과 당시값 혼동0 |
| A07 | 호흡 누락·HRV 혼동 방지 | 60초 전 insufficient_window, 이후 유효 호흡 값 또는 구체 사유. HRV=SDNN·RMSSD별도. 동일 PPG fixture MB/HARU 비교, 반복 overlap RR 중복/실경과 gate 재현, 수정 시 새버전 |
| A08 | 회차 종료와 저장 완료 분리 | 종료 오프라인·일부 ACK·마지막 청크 실패·close intent 유실→pending/partial; 복구후 새revision, 다운로드 고정revision 재현 |
| A09 | 실기기 지원 프로필 확인 | 실제 LINK BAND+Chrome/Edge 및 iOS/Android 새 앱 각60분, foreground/background·화면잠금·네트워크전환·앱 재시작·BLE거리단절·재접속; 수신시각/샘플수/firmware/ACC25·30Hz/endian/header 원문 비교. OS 미수집은 gap으로 보고 |
| A10 | 반출 파일로 독립 복원 | D243 참여자 폴더·UTF-8·null·단위·UTC/KST/상대시간·정밀도·선택범위·가명 sidecar·SHA-256 검증, 전체 중간 feature·indices 동반,1GB part 독립 열기·전체복원 |
| A11 | 정책·인가·연구ACK 범위 유지 | 본인수집/타참여자/타기관/구버전·미동의/철회/연구비대상 차단;90일 경계·미ACK보류·신호별ACK·연구 사본·원본파형 feature 삭제대상·tombstone 및 객체실패 재시도 합성 검증 |
| A12 | 성능·용량 추정 검증 | 60분·최대계획 참여자 수의 실제 raw/feature/indices byte·주파수·객체수·큐 quota·메모리 상한 계측;180–650MB 가정 벗어나면 예산/청크 재산정. 저장 범주 생략으로 통과 금지 |
| A13 | 레거시·밴드 미착용 지원 | EEG-v1 및 지원 불명1.0 분기, PPG/ACC 없음·미착용·만료 구별, 기존 상담·AI요약·리포트 동작 유지 |

실기기/운영 저장·비용·생리학적 정확도는 이번 문서 작성으로 검증되지 않았다. 모든 데이터가 서버에 도착했다는 주장에는 수신 원본 대조와 ACK 증거가 필요하다.

## 7. Brian 결정 질문 — 3개

1. **현 EEG 유실 방지 FIX를 전체 파이프라인과 분리해 먼저 진행할까요?** 권장: 분리. 지금 수집하는 데이터의 보존 위험부터 줄이고 전체 저장 확장은244에서 진행합니다. 이번 Spec·커밋·push 승인은 FIX 구현/배포 승인과 다릅니다.
2. **1차 출시 순서를 웹 먼저, 앱 검증 후 앱 확대로 할까요?** 권장: 웹 우선 후 iOS/Android. 앱도 전체 범위에 포함하되 새 빌드·실기기 검증을 거쳐 제공하고 구버전의 미수집 상태를 명확히 표시합니다.
3. **1차 다운로드는 완전한 MB 원본 ZIP에 집중하고 SDK 변환은2차로 둘까요?** 권장: MB 원본 우선. 세 신호·전체 feature·화면6은1차 필수이고 SDK별 컬럼 변환만 후속으로 분리합니다.

위 질문은 향후 우선순위 결정이며 이번 문서 작성·커밋·push를 막지 않는다. 90일/연구 예외는 기존 정책을 확장하는 기술안으로 반영했으며, 고지 범위에 없는 연구 반출은 허용하지 않는다.
