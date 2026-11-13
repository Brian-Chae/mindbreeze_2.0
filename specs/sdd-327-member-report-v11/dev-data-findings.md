# SDD-327 후속 A — dev 데이터 경로 디버깅 결과 (11/13)

dev DB·S3 읽기 전용. 원시는 `~/.hermes/cache/scratch/a1/`에만 두었고 저장소·share에는 복사하지 않음.

## 1. 1/f 14건 전부 `no_raw` — 원인 확정·수정
| 항목 | 내용 |
|---|---|
| 원인 | `eeg_raw_chunks.start_ms/end_ms`는 **세션 시작 기준 상대 ms**(dev 실측 −96 ~ 5,699,396). `load_eeg_array`가 이를 절대 UTC ms(`t_lo/t_hi`, ≈1.79e12)와 비교 → `end_ms < t_lo−5000`이 항상 참 → 전 청크 건너뜀 → `no_raw` |
| 근거 | 업로드 `biosignal_service._time_ms`가 `anchor.relative_us` 기준으로 기록. 표본 절대시각은 헤더 `anchor.utc_us`(디코더 `utc_us`)에만 있음 |
| 수정 | `member_report_aperiodic.chunk_utc_span_ms(header)` 추가: 헤더 앵커로 절대 [시작,끝] ms 계산 → 구간 필터에 사용. 앵커 없는 청크(`utc_us=None`)는 기존대로 시각 추정 없이 건너뜀 |
| 테스트 | 상대 start_ms 청크가 내려받아지는 회귀, 구간 밖 제외, 앵커 없음 제외 (`test_member_report_aperiodic.py` +3) |

## 2. 보정 후에도 `poor_fit`/`insufficient_window` — 서비스 경로 차이 아님, 신호 불량
서비스 `compute_aperiodic`와 시안 방식(golden.py `place`: 앵커 기준 배치·중복 제거)을 **같은 입력**으로 비교: 배치(구간·µV 스케일·채널 순서·중복 표본)는 동일(청크 중복 0, 스케일 0.04006 µV/LSB, fp1/fp2 순서 일치). 갈리는 지점 없음. 결과가 짧은 이유는 데이터 자체.

| 회차(참가자) | 원시 길이 | 포화(|x|≥300k µV, ADC 만땅) | 평탄(연속 동일값) | 4초 창 중 유효 | 결과 |
|---|---|---|---|---|---|
| 11/10 A | 94.9분 | 100% | 100% | 18/2852 (36초) | insufficient_window |
| 11/10 B | 94.7분 | 100% | 100% | 21/2849 (42초) | insufficient_window |
| 11/10 C | 94.5분 | 100% | 100% | 24/2851 (48초) | insufficient_window |
| 11/06 14:11 (1명, EEG valid 창 최다) | 92.0분 | 45.6% | 45.7% | 975/2755 (1950초) | 전체 구간 poor_fit(R² 0.37) |
| 〃 5분 타일 18개 | | | | 0~274초 | 2개 poor_fit(R² 0.60/0.82), 나머지 insufficient_window |

- 11/10 회차(21명 규모)는 EEG가 전부 ADC 포화·평탄 = 전극 미접촉/미착용 수준. 시안(대구, 53명 중 36명 산출)과 달리 **dev 테스트 데이터가 1/f를 낼 수 없는 신호**.
- 11/06 회차는 절반이 포화, 나머지도 전극 접촉 불안정 → 유효 창이 흩어져 R² 미달.
- 알고리즘 쪽 수정 없음(상수 시안 동일).

## 3. `quality='invalid'` 다수
- 판정 위치: `live_ingest_service.eeg_window_invalid` — EEG 지표(focus/relaxation/emotion/tna 및 display) **전부** `validity='invalid'`이면 창 `quality='invalid'`로 저장(`session_service._persist_feature_items`). EEG 판정 전용 플래그.
- dev 분포(읽기):

| 회차 | invalid | valid | 비고 |
|---|---|---|---|
| 11/10 e6523c7a | 113,866 (100%) | 0 | focus/relax=0건, EEG 완전 불량 |
| 11/06 401d48c5 | 95,099 | 2,921 | invalid 창에도 HR 36,678·RMSSD 93,493·호흡 91,395 존재 |
| 11/05 83a39b18 | 2,856 | 976 | invalid 창 HR 100%, RMSSD 48% |
| 11/06 c44cb210 | 641 | 288 | invalid 창 HR/RMSSD 100% |

- **버그**: `person_minutes_from_windows`가 몸 지표(HR·RMSSD·SDNN·LF/HF·움직임)까지 EEG `quality`로 걸러 → PPG에서 값이 정상 산출된 창도 통째로 버림. 시안 규칙 `nv/n ≥ 0.5`의 nv는 "그 지표가 유효한 창 수"인데 서비스는 EEG 품질을 nv로 썼음.
- **수정**: 몸 지표는 `값 있는 창 / 분 내 창 ≥ 0.5`(EEG quality 무관), 마음 지표는 기존대로 EEG non-invalid ≥ 0.5. 테스트 3건(마음 가드 유지, 몸 지표 invalid 창 사용, 몸 지표 비율 가드).
- **유지(수정 안 함)**: 착용 판정 `worn = any(quality != 'invalid')`. 11/10 p0는 EEG 전부 포화인데 HR이 107 고정(p5=p50=p95), p1·p2는 HR 0건 → PPG도 신뢰 불가이므로 EEG 전부 invalid면 `band_not_worn` 유지가 안전.

## 효과 (예상, 재생성 안 함)
- 11/06·11/05 회차: EEG invalid 창이 많아도 몸 지표(HR·RMSSD 등) 산출 분 증가. 11/10 회차는 원 신호 불량이라 여전히 not_worn/결측이 정상.
- 1/f는 로더 수정으로 `no_raw`가 사라지고 실제 사유(`insufficient_window`/`poor_fit`)가 표시됨.

## 남은 위험
- 몸 지표 RMSSD 값 자체가 시안 원시 재계산 대비 3.2배(methods.md) 문제는 이번 범위 밖(분석창 계산 방식).
- 몸 지표를 EEG invalid 창에서도 쓰므로, PPG 미착용 상태의 잔여값이 들어오는 경우는 업로드 단계의 PPG 판정(SDD-316)에 의존.
- dev 재생성·실데이터 end-to-end 재검증은 감독 승인 후(쓰기 금지 규칙으로 미수행). 서버 /tmp는 내가 만든 임시를 모두 삭제함.
