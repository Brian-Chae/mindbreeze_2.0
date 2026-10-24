# SDD-244 G1 계약 v1

이 디렉터리는 T02의 계약·합성 fixture다. 서비스, ACK 검증기, binary decoder, ZIP 생성기는 구현하지 않는다. 장치·서버·DB·브라우저 검증 결과가 아니다. T03은 decoder, T04 이후는 저장과 API를 구현한다.

## 정본과 검사 경계

- `backend/app/schemas/biosignal.py`의 순수 Pydantic DTO가 정본이다. `generate-fixtures.py`는 4개 JSON Schema(Draft 2020-12), 사전, 합성 fixture를 재생성한다. 앱/config/DB를 import하지 않는다.
- JSON Schema는 구조·필수값·enum·범위 검사용이다. Pydantic `model_validator`의 교차 필드 규칙(section offset/count, close expected set, source별 provenance 등), int64 문자열 범위는 JSON Schema 단독 검사로 보장되지 않는다. 다른 언어 소비자는 아래 의미 검증을 추가해야 한다.
- JSON 숫자에 NaN/Inf 금지. 새 `*_us`는 signed int64의 canonical 10진 문자열(-0 금지). 기존 `device_timestamp_ms`는 소수 ms를 보존하는 number이며 가명 반출에서는 null+사유다. JSON null / CSV 빈칸은 0과 다르다.
- 내부 `RawChunkMeta`의 session/participant/stream/segment UUID·object_key는 공개 `ManifestRevision`에 넣지 않는다. 공개 모델은 whitelist이며 alias만 허용한다. DTO는 실제 인가를 대체하지 않는다. 매 반출 시 동의·철회·만료·정확시각 권한을 재검사한다.

## raw-v2 컨테이너

`MBRAW002` 8B + header 길이 uint32 LE 4B + UTF-8 JSON header + body. header ≤65,536B, 전체 ≤1,048,576B, padding 없음. SHA-256은 header를 포함한 전체 파일 바이트다. body의 sections는 samples → packets → packet_map 순서로 빈틈·중첩 없이 연속한다. packet_map은 UTF-8 JSONL이다. decoder는 전체 hash 검증 후 magic/header/body bounds/stride/count/float 유한성/ADC 범위를 검증해야 한다. 아직 T03 decoder를 구현한 것이 아니다.

| 신호 | 명목 rate·채널 | 샘플 body LE layout | wire 정수·단위 |
|---|---|---|---|
| EEG | 250Hz, fp1/fp2 | int32,int32,uint8,float32,float32 (17B) | signed24 [-8388608,8388607]를 부호 확장; µV=ADC×4.033/12/(2^23−1)×10^6; lead-off 원 byte 보존, Fp1=bit0(1), Fp2=bit2(4) |
| PPG | 50Hz, red/ir | uint32,uint32 (8B) | wire unsigned24 [0,16777215] ADC count; uint32 저장폭이 wire 범위를 확대하지 않는다 |
| ACC | 현재 웹30Hz, xyz | int16×3,float32×3 (18B) | signed16 [-32768,32767]; g=ADC×2/32768 |

원문 packet fixture는 현재 `blePacketParser.ts`의 framing을 독립적으로 작성했다: EEG tick LE32 + (lead-off byte + BE signed24×2), PPG tick BE32 + BE unsigned24×2, ACC tick LE32 + LE int16×3. 각 신호 마지막 `FF`는 별도 잘린 패킷이며 sample_count=0, first_sample_index=null, malformed_reason=truncated_packet이다. 원문 byte를 버리거나 정상 샘플로 만들어서는 안 된다.

`rate`는 parser 해석 명목 유리수, `observed_rate`는 실제 관측 유리수다. 관측값이 있으면 관측 구간 µs를 기록하고 없으면 null+reason. 웹30Hz를 네이티브25Hz로 재라벨하지 않는다. `raw-v2.json`의 4번째 항목은 **미검증 native25Hz 후보 header**이며 `device_relative`, UTC=null이다. 실제 25Hz 장치 바이너리를 제공한다고 주장하지 않는다. firmware/device_model unknown은 문자열 `unknown`으로 기록한다.

## 샘플 시간·gap

`anchor.relative_us + (sample_index-anchor.sample_index)×1,000,000×rate.denominator/rate.numerator`를 유리수로 계산하고 최종 출력에서만 반올림한다. 패킷 마지막 샘플 tick 기준은 parser profile에 기록한다. fixture anchor는 그 시간축을 회차 공통 원점(첫 샘플 index0=0µs)으로 옮긴 기준점이다. original device tick 및 received UTC/monotonic 시각은 packet_map에 별도로 보존하며 sample timestamp로 복사하지 않는다.

30Hz는 100000/3µs 간격이다. `time-golden.json`의 108,000번째 샘플은 정확히 3,600,000,000µs다. 33333µs씩 누적하는 기존 경로와 새 계약을 혼동하지 않는다. timestamp CSV는 공통 상대 초, `t_rel_ms`는 같은 원점의 ms다. 정확시각 인가 때만 UTC ISO8601 Z를 사용하고 한 파일에서 상대/절대를 섞지 않는다.

clock wrap은 raw/unwrapped tick을 보존한다. reset·벽시계 jump·reanchor는 새 clock segment다. gap은 발견시각·범위·원인·신호·stream/segment·관측/추정 여부와 expected/received count를 갖는다. unknown expected_samples는 null이다. upload_pending은 BLE 수집 loss와 구분한다. 보간·중복 삭제로 원본을 꾸미지 않는다.

## feature와 당시 표시

- `feature-v1.json`은 EEG/PPG/ACC 각 실제 emit 형태를 표현한다. 중첩 창도 별도 feature_id/sequence이며 source_windows로 원본 hash·샘플 범위·유효 count를 연결한다. JSONL은 모든 emit, 검색 스칼라는 별도 1Hz 정책이다.
- 기존 feature 27개는 이름·의미 유지. quality는 valid/degraded/invalid 문자열, device_timestamp_ms는 소수 ms number. null인 스칼라에 대해서만 정확히 같은 key의 scalar_null_reasons를 제공한다. feature `signal`과 일치하는 상세 output 하나만 non-null이다.
- 현재 processor 반환 타입을 `processor-inventory.json`으로 pin한다. 선언 변경 시 테스트가 실패한다. EEG PSD/대역파워/뇌상태/원지표, PPG vitals/peakInfo/advancedHRV/RR, ACC activity/movement/posture/quality를 보존한다. 현재 emit에 없는 채널별 band power·beat ID는 null+not_emitted 이유이며 만들어 채우지 않는다.
- filteredData, 샘플별 SQI/mask, ACC magnitude는 raw-derived 참조(artifact/hash/field/range)다. 파형 사본은 raw와 같은90일 정책이며 만료 참조는 expired로 남긴다. PSD·RR 등 feature 값과 파형 보관정책을 혼동하지 않는다.
- `indices-v1`은 focus/relaxation/emotional/bpm/respiration/hrv 여섯 지표만 갖는다. 마음3은 표시 정수0–100, 감정균형 원천 emotional_stability, 몸3은 물리량이다. **hrv=SDNN(ms), RMSSD는 feature에 별도**다. 종합점수 없음.
- 지표마다 표시값·입력·정규화 출력·source feature·측정시각·input_source·event age·held/stale/lead-off/quality/null reason을 보존한다. 마음3 모델 snapshot에는 지표별 source/m/s/direction/B0 사유, formula/constants/version/hash가 있다. standard_model은 m/s/direction 필수, B0/cohort는 없는 sigmoid 파라미터를 null로 기록하고 B0 버전/선택사유가 필수다.
- rendered/displayed는 표시시각·알고리즘·pipeline version과 display_match=true가 필요하다. 미렌더 초는 값 null과 not_rendered. 과거 이력 없으면 source=unavailable, display_match=unverified, unavailable_reason=display_history_missing. reconstructed/report_aggregate는 display_match=false다.
- 정상 초·null 초도 view_instance+second_index로 저장한다. 호흡의 첫60초 부족은 null+insufficient_window이며 0 placeholder 금지다. 이 계약은 호흡/정규화 알고리즘을 수정하지 않는다.

## manifest와 SDD-243 반출

complete는 close intent의 전체 expected artifact ID/hash가 검증/commit된 것을 뜻하며, 수신 전 BLE gap이 없다는 뜻이 아니다. raw-derived·모델·algorithm·gap도 expected set에 포함한다. gap last sequence가 일치해야 한다. 후발 ACK는 새 revision이며 과거 revision을 바꾸지 않는다. last sequence/수신 count의 실제 원장 대조와 동의 검사는 T06 서비스 책임이다.

파일 메타는 상대 path/schema/dictionary key/rows/bytes/hash/실제 time range/선택 범위/extra range/retention class와 deadline/consent scope+version/availability+reason을 포함한다. 경로의 빈 segment·`.`·`..`를 거부한다. `[from,to)` 샘플 선택은 CSV/Parquet에 적용하고 bin은 겹치는 전체 청크와 extra range를 기록한다. revision이 불변이어도 현재 철회/만료를 우회하지 못한다.

SDD-243은 기존 root README/dictionary/manifest, 회차·참여자 경로, 1,000,000,000B 최종 part 상한·독립 열림·중첩 ZIP 금지와 인가/감사를 유지한다. 244 additive 경로는 `raw/{signal}/stream-S01/segment-001/{chunk,packets}-000000.bin`, `features/{eeg,ppg,acc}.jsonl`, `raw-derived/*-waveforms.jsonl`, `meta/{sample-map,gaps,display-status}.jsonl`이다. 기본 sample CSV 컬럼은 EEG timestamp/fp1/fp2, PPG timestamp/red/ir, ACC timestamp/x/y/z다. float32는 유효숫자9자리로 비트 왕복하고 PPG는 정수다.

features.csv는 play_group_id/window_index/t_rel_ms + 기존27개다. indices.csv는 t_rel_ms/play_group_id/window_index + 화면6 + 각 *_display_input + normalization_version/normalization_model_id_alias/normalization_params_hash/normalization_source/display_pipeline_version/source/display_match/unavailable_reason으로 평탄화한다. 상세 per-metric provenance와 source window는 sidecar/JSONL에서 보존한다. 원 UUID/tick/UTC 포함 원문은 lossless 권한 있을 때만 반출한다. 가명 변환이 필요하면 원본 bin 차단+redacted_packet_view를 명시하고 무손실 원본이라 부르지 않는다.

## fixture 증거 수준과 재생성

- raw binary/hash/expected CSV/ADC·float32/packet bytes는 실제 파일끼리 독립 비교한다. manifest 첫 raw 항목은 제공된 EEG binary의 실제 hash/size/row_count를 참조한다.
- 다른 manifest artifact와 algorithm/model/raw-derived의 `aaaa...` hash는 구조 예시용 placeholder다. 실제 파일·등록/ACK 증거가 아니며 업로드 가능한 production close intent로 쓰면 안 된다. decoder 테스트는 raw-golden의 실제 해시를 사용한다.
- error-cases는 기대 실패 목록이며 T03 단계의 hash/magic/truncation/nonfinite binary 오류는 T02에서 구현·통과했다고 주장하지 않는다. DTO 오류는 focused pytest에서 검증한다.
- generate-fixtures.py는 processor inventory를 자동 덮어쓰지 않는다. emit 변경은 사람이 DTO·단위·보관 계층을 리뷰한 다음 signature/fields를 갱신해야 한다.

검증 명령: `PYTHONPATH=/tmp/sdd244-contract-deps <pytest+pydantic Python> -m pytest --noconftest backend/tests/test_sdd244_contracts.py -q`. jsonschema가 기본 환경에 있으면 PYTHONPATH는 생략한다. `--noconftest`는 기존 autouse fixture의 .env/DB 로드를 피하기 위해 필수다. 4개 frozen schema는 DTO export와 완전 일치 검사한다. 생성은 같은 Python으로 `contracts/generate-fixtures.py` 실행.

상세 feature 숫자가 비유한 결과이면 NaN을 직렬화하지 않고 null과 `detail_null_reasons`의 정확한 경로(예: `eeg.frequencySpectrum.ch1Power.0`)를 함께 기록한다. null 상세 수치의 집합과 사유 key 집합은 일치해야 한다. scalar_null_reasons와 구분한다. 아직 emit하지 않는 optional 구조(channelBandPowers/beats 등)는 각 전용 reason 필드를 사용한다.

close intent는 `streams[]`의 (stream_alias,segment_alias,signal)별 마지막 chunk/feature 순번과 수신 샘플수, `snapshots[]`의 (stream_alias,view_instance_alias)별 마지막 화면 순번을 별도로 기록한다. 재연결 후 segment별 chunk 0을 동시에 표현하며 scope 중복은 거부한다. 마지막 gap sequence는 close intent 전체 event outbox 기준이다.

manifest-v1은 **회차·참여자 단위 revision 계약**이다. SDD-243은 여러 회차·참여자의 revision을 pin하여 별도의 ZIP job/part 상위 manifest를 조립한다. 244 manifest를 ZIP job/part manifest 전체의 대체물로 쓰지 않는다.
