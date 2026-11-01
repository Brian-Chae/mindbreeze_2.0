# SDD-264 — 업로드 현황: 총량 대비 수집률(폰 생성량 보고)

- 상태: Stage ① Spec 확정 / 구현 전
- 브랜치: `sdd/264-upload-progress-expected` (develop `225f7b59` 기준)
- 작성일: 2026-11-01
- 선행: SDD-260(REST 배치·종료 대조), SDD-261(회차 참여자별 수신 현황), SDD-262(회원 화면), SDD-263(전체 회차 목록)
- 트랙: BE(`backend/**`, 본 문서 4종) / FE(웹 화면 + 폰 보고 JS) / 네이티브(필요 시 additive 필드 1개)

## 1. 문제

대표 지시(11/1): 현황 화면이 **"총 수집되어야 하는 것 중 얼마나 수집됐는가"**를 한눈에 말해야 한다.

- 참여자: 전체 N명 중 M명 모두 수신
- feature: 총 X개 중 Y개 수집
- 원시 데이터: 총 P개 중 Q개 수집 (EEG/PPG/ACC 별도)
- 전체 진행률(총 수집 대상 대비 수집량)을 큰 숫자·진행 막대로 맨 위에

현재 SDD-261/263 은 서버가 **기대량을 몰라** "전체 대조 미확인"만 말한다(`expected=null`, `completeness=unknown`, `phone_report=null`). "0명 ! 확인 필요"처럼 0 인데 경고색이 나와 핵심 메시지가 불명확하다.

대표 정의: **"폰에 모였던 것이 전부 서버로 보내졌으면 완료."** → 폰이 만든 총량(기대량)을 서버가 알아야 서버 수신량과 비교할 수 있다.

## 2. 목표 / 비목표

목표
1. 폰이 **자기가 만든 총량**을 서버에 보고한다(측정 중 주기·종료 시 최종·재기동 이어올림 후 최종).
2. 서버는 참여자별 `기대 vs 수신`을 계산해 상태(모두 수신/진행 중/확인 필요/기대량 미확인/수집 제외)와 합계(참여자·feature·원시 3신호·전체 진행률)를 응답에 **가산**한다.
3. 같은 모델을 4개 화면(회차 상세·SDD-263 목록·SDD-262 회원 화면·리포트 칩)에 적용한다(FE 트랙).

비목표
- 점수·종합점수·좋음/나쁨 판정, "보증"·"100% 보증" 단정(규칙 유지). 단 **'총 X 중 Y'** 수치와 진행 막대, **'모두 수신'** 표기는 허용.
- 폰에 모이지 않은(밴드 끊김으로 영구 유실된) 데이터 복구. 기대량은 "폰에 모였던 것"이 기준이다.
- 수집 경로(`features/batch`, `biosignal-raw/*`) 변경. 소켓 `live:metric` 불변.

## 3. 설계 결정

### D1. 기대량 소스 = **신규 보고 엔드포인트**(후보 a), close_intent/manifest(SDD-244) 재사용 안 함

| 검토 | 판정 | 근거 |
|---|---|---|
| (a) `PUT /sessions/{sid}/ingest-expected` | **채택** | 와이어 1개·테이블 1개로 끝. 인증은 업로드와 동일(`resolve_upload_participant`) → 회원·게스트 모두 동작. 멱등·단조를 서버가 강제. |
| (b) close_intent / manifest(SDD-244) 재사용 | 기각 | manifest 는 "서버에 등록된 청크"(presign 시점)이지 폰 생성량이 아님 → 등록 전 대기분이 빠진다. close_intent 는 종료 시 1회뿐이라 측정 중·비정상 종료를 못 덮는다. |
| 서버가 sequence 로 추정 | 기각 | 앞·뒤·미보고 구간을 서버가 알 수 없음(SDD-261 이 이미 확인). |

### D2. 보고 단위 = **개수**(창 수 / 신호별 청크 수), 참여자 단위 스칼라 4개

- `feature` = 폰이 만든 feature 창 총수 = `feature.counts` 의 `pending + acked + rejected`.
- `raw.eeg|ppg|acc` = 폰이 만든 원시 청크 총수(신호별) = 폰 archive 큐의 신호별 `pending + uploading + verified + quarantined`.
- 서버 수신량과 **같은 단위**: feature=`eeg_feature_windows` 행 수, raw=`eeg_raw_chunks` 중 `upload_status='uploaded'` 행 수(신호별).
- 개수 비교가 가능한 이유: 서버는 (stream, sequence/chunk_index) 유일 제약으로 중복이 1행이므로 `수신 ≥ 기대` 는 곧 "빠진 것 없음"과 같다(수신이 기대를 넘는 건 보고가 뒤처진 경우뿐).

### D3. 서버 규칙 — 멱등 · 단조 · final

- 저장: 참여자당 1행(`session_ingest_expected`, PK=participant_id). 신규 테이블 = **가산 마이그레이션**.
- **단조 증가만**: 각 필드 `new = max(stored, reported)`. 값이 낮으면 그 필드는 무시(응답 `ignored`에 필드명).
- **멱등**: 같은 payload 를 반복 보내도 결과 동일(200, `changed=false`).
- `final`: 보고의 모든 필드가 저장값 이상(= 뒤처진 보고가 아님)일 때만 그 보고의 `final` 값을 채택한다. 뒤처진 보고의 `final=true` 는 무시 → 늦게 도착한 과거 보고가 확정값을 뒤집지 못한다. 재기동 이어올림으로 총량이 더 늘면 새 보고의 `final` 로 갱신된다(이어올림 후 `final=true` 재보고).
- 종료된 회차에도 보고 허용(`allow_completed=True`) — 비정상 종료 후 재기동·사후 전송.
- 상한: 각 값 0..10,000,000 정수. 알 수 없는 필드·음수·비정수 → 422.

### D4. 보고 시점 · 전송 계층 = **JS 레이어**(frontend/src/lib/biosignal 계열)

- 네이티브가 이미 JS 로 올리는 `feature.counts` / `archive.counts`(SDD-260)를 구독해 JS 가 보고한다 → 네이티브 변경 없이 feature 합계 확보, 웹 번들 1곳 수정으로 Android·iOS·웹 브라우저 참가자가 같은 코드로 동작.
- 예외 1건: `archive.counts` 에는 **신호별(EEG/PPG/ACC) 분리 합계가 없다**. 대표가 신호별 표시를 요구했으므로 네이티브에 **additive 필드 `signals: {eeg:{total}, ppg:{total}, acc:{total}}`** 를 `archive.counts` 에 추가한다(양 OS 동일, 기존 필드 불변). 이 필드가 없으면 JS 는 raw 를 보고하지 않고 → 서버는 해당 참여자를 "기대량 미확인"으로 둔다(단정 금지). FE 트랙이 이 한 줄만 네이티브에 요청한다.
- 시점: 측정 중 **30초마다**(값이 바뀐 경우만), 종료 시 **즉시 최종(`final=true`)**, 재기동 이어올림 완료 시 **최종 재보고**. 오프라인이면 마지막 값 1개만 영속 큐(IndexedDB `feature_rest_outbox` 인접 스토어)에 두고 복귀 시 전송(총량은 단조 증가라 최신 1건만 유지하면 손실 없음 — SDD-260 outbox 재사용, 별도 대기열 증식 없음).
- 인증 실패 401/403 은 재시도 격리(`EEG_CONSENT_REQUIRED` 포함), 5xx·네트워크는 full jitter 재시도.

### D5. 서버 판정(참여자별 `progress.state`)

| state | 조건(위쪽 우선) | 의미 |
|---|---|---|
| `not_collected` | 수집 제외(opt-out/대기열) 이고 수신 기록 0 | 분모에서 제외, "수집 제외"로 표기 |
| `expected_unknown` | 보고 없음, 또는 회차 종료 30분 경과인데 `final=false` | 기대량 미확인. 수신량만 표시, 완료 단정 금지 |
| `needs_attention` | 부족분이 있고 (원시 `failed>0` 이거나 **마지막 수신 후 120초 이상 변화 없음**) | 확인 필요 |
| `all_received` | `final=true` 이고 feature·raw 3신호 모두 `수신 ≥ 기대` | **모두 수신** |
| `in_progress` | 그 외(부족분이 있으나 수신 변화 중, 또는 `final=false` 이고 따라잡은 상태) | 진행 중 |

- 수신 변화 시각 = `max(feature last_received_at, raw last_received_at)`. 수신 0 이면 `first_reported_at` 이 120초 지난 경우부터 정체로 본다.
- 기존 `status`(`needs_attention/uploading/received_unreconciled/no_data/excluded`)와 `reasons` 는 **불변**(SDD-261/263 회귀 최소화). `progress` 는 병렬 블록.
- **'완료'는 '모두 수신'으로 표기**(대표 명시): 점수·종합점수·좋음/나쁨·'보증'·'100% 보증' 금지는 유지. 진행률 `percent` 는 내림(소수 1자리)해서 부족분이 있으면 100.0 이 되지 않는다.

### D6. 합계 · 진행률 수식

- 합계 분모 = **그 컴포넌트의 기대량이 보고된 참여자**(수집 제외 `not_collected` 는 전부 제외). 기대량 미확인 참여자는 사람 수 분모("N명 중")에는 남고 수치 합계에는 보고된 컴포넌트만 들어간다(정본: contract §2.3).
- `기대 합` = Σ expected, `수신 합(상한)` = Σ min(received, expected) → 초과 수신이 다른 사람의 부족분을 가리지 않는다.
- `overall.percent = floor(수신합 / 기대합 × 1000) / 10` (기대합=0 이면 `null` → 화면은 중립 표기).
- 기대 미확인 참여자는 **분모에서 빼지 않고 `expected_unknown` 으로 따로 센다**(`participants.expected_unknown = K`) — FE 가 진행률 옆에 "기대량 미확인 K명" 표시.
- 0 건이면 중립(경고색 금지는 FE 규칙).

### D7. 응답 가산 위치(필드 이름 유지)

| API | 가산 |
|---|---|
| SDD-261 회차 상세 | `participants[].feature.{expected,expected_basis,completeness}` 실값 채움, `raw.signals[].expected`, `participants[].phone_report`(null→객체/ null), 신규 `participants[].progress`, 신규 최상위 `progress`(합계) |
| SDD-263 목록 | `items[].progress`(회차별 합계·진행률), 최상위 `summary` 불변 + `progress`(전체 합) |
| 신규 | `PUT /sessions/{sid}/ingest-expected` |

세부 와이어는 `contract.md`.

### D8. 권한 불변 · 비용

- 조회 권한(SDD-261/263 매트릭스)은 한 줄도 바꾸지 않는다. 보고 권한은 업로드와 동일(본인·입장 자격; 호스트 대리 보고 불가).
- 응답에 개인정보 추가 없음(개수만).
- 쿼리 증가: 회차 상세 +1(기대량 1 SELECT, 참여자 수 무관), 목록 +1(IN 일괄) → 상세 6회, 목록 5회. revision 에 기대량 지문(건수·max updated_at·sum) 포함 → 기대량만 바뀌어도 ETag 변경.

## 4. 비즈니스 결정 사항

없음. 단 하나 기록: '완료' 표기 금지 규칙(SDD-261)은 이 화면에 한해 대표 명시 요청에 따라 **'모두 수신'** 으로 대체 허용한다(점수/보증 금지는 유지).

## 5. 위험

| 위험 | 대응 |
|---|---|
| 폰이 영영 보고 못 함 | `expected_unknown` + 수신량만 표시, 완료 단정 없음 |
| 보고 단위 불일치(폰 청크 수 ≠ 서버 등록 단위) | contract 에 단위 고정 + 독립 COUNT 대조(V-X1~3) + 실기 QA 항목 |
| 네이티브가 `signals` 를 안 내보냄 | raw 미보고 → 미확인으로 안전하게 후퇴(단정 없음). FE 트랙이 additive 요청 |
| 영구 유실(밴드 끊김) | 기대량에 안 들어가므로 "모두 수신" 가능 — 화면 문구는 "폰에 모인 것 기준"으로 한정(FE) |
