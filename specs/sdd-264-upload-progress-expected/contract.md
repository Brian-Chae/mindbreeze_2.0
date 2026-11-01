# SDD-264 — API 계약 (BE 확정본, FE·네이티브 정본)

- 정본 spec D1~D8 을 와이어로 구체화. 변경 시 이 문서부터 고치고 FE 에 알린다.
- 가산 변경만: SDD-260/261/263 의 기존 필드·이름·의미·권한은 불변. 새 블록 `progress` 와 새 엔드포인트 1개.
- 기준: 서버 수신(`basis: "server_received"`). 응답 어디에도 점수·종합점수·좋음/나쁨·보증 값 없음. '모두 수신'(`all_received`) 은 "폰이 보고한 총량을 서버가 전부 받았다"는 뜻이며 영구 유실 부재 보증이 아니다.

## 1. 신규 — 폰 생성량(기대량) 보고

```
PUT /api/v1/sessions/{session_id}/ingest-expected
Authorization: Bearer <JWT>        또는   X-Entry-Credential: <입장 자격>
Content-Type: application/json
```

인증·소유: `features/batch` 와 동일(`resolve_upload_participant`, `allow_completed=True`). 종료된 회차 허용. 호스트 대리 보고 불가.

### 요청 본문 (알 수 없는 필드 → 422)

```json
{
  "participant_id": "<uuid>",
  "feature": 1200,
  "raw": {"eeg": 80, "ppg": 40, "acc": 40},
  "final": false
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `participant_id` | uuid | JWT 사용 시 생략 가능(본인 행 확정), 주면 본인과 같아야 함(다르면 403). 입장 자격도 일치 필수 |
| `feature` | int | **필수.** 폰이 만든 feature 창 총수 = `feature.counts` 의 `pending+acked+rejected`. 0..10,000,000 |
| `raw` | object | 선택. 있으면 `eeg`·`ppg`·`acc` 3개 모두 int(0..10,000,000). 폰이 만든 원시 청크 총수(신호별) = archive 큐의 신호별 `pending+uploading+verified+quarantined`. 생략 = "원시 미보고"(서버는 `null` 로 둠, 이전에 저장된 값 불변). 부분 객체(2개만)는 422 |
| `final` | bool | 필수. 측정 종료 후 폰이 더 만들 것이 없고 이 값이 최종이면 `true` |

- 단위: feature 는 `eeg_feature_windows` 행 1개 = 창 1개, raw 는 `eeg_raw_chunks` 행 1개 = 청크 1개(폰이 presign 요청 단위로 만드는 청크). 서버 수신 = feature 행 수, raw 는 `upload_status='uploaded'` 행 수(신호별).
- 착용 안 한 신호(PPG 없음 등)는 **0 으로 보고**한다(생략 아님). 생략하면 그 참여자는 `expected_unknown`.

### 서버 규칙

| 규칙 | 내용 |
|---|---|
| 저장 | 참여자당 1행. 처음 보고 시 `first_reported_at` 기록 |
| 단조 | 필드별 `stored = max(stored, reported)`. 저장값(null 은 -∞)보다 낮으면 그 필드는 무시하고 `ignored` 에 필드명(`feature`,`raw.eeg`…) 기록. 오류 아님 |
| 멱등 | 같은 본문 반복 → 200, `changed=false` |
| `final` | ① 보고 필드 중 저장값보다 **낮은** 것이 하나라도 있으면(뒤처진 보고) `final` 무시. ② 아니고 어느 필드든 **증가**했으면 `stored.final = reported.final`. ③ 증가 없고 뒤처지지 않았으면 `stored.final = stored.final OR reported.final` (같은 값의 `final=false` 재보고가 확정을 되돌리지 않음) |
| 경합 | 동일 참여자 동시 보고는 행 잠금(PG `SELECT … FOR UPDATE`, 없으면 INSERT 경합 후 재조회)으로 직렬화. 결과 = 필드별 최댓값 |

### 응답 200

```json
{
  "session_id": "<uuid>",
  "participant_id": "<uuid>",
  "expected": {"feature": 1200, "raw": {"eeg": 80, "ppg": 40, "acc": 40}},
  "final": false,
  "changed": true,
  "ignored": [],
  "updated_at": "2026-11-04T05:10:11Z"
}
```

- `expected.raw.*` 는 저장값(미보고면 `null`). `ignored` 는 문자열 배열(항상 존재).

### 에러

| HTTP | detail | 의미 | 폰 처리 |
|---|---|---|---|
| 400 | `"잘못된 ID 형식입니다"` | session_id 가 uuid 아님 | 격리 |
| 401 | (기존 문구) | 인증 없음/만료, 자격 없이 participant_id 만 | 토큰 갱신 후 재시도 |
| 403 | (기존 문구) / `EEG_CONSENT_REQUIRED` | 타인 대리, 호스트, 대기열, 수집 거부 | **격리**(재시도 금지) |
| 404 | (기존) | 세션 없음 | 격리 |
| 422 | `{"code":"invalid_message","field":"feature"}` | 스키마 위반(음수·비정수·상한 초과·알 수 없는 필드·부분 raw·bool 이 아닌 final) | 격리(앱 버그) |
| 5xx/타임아웃 | — | 서버/네트워크 | full jitter 재시도 |

## 2. 가산 — SDD-261 회차 상세 (`GET /classes/{cid}/sessions/{sid}/upload-status`)

기존 응답에 아래만 더해진다. ETag 지문에 기대량 요약(보고 행 수·`max(updated_at)`·값 합·final 수)이 포함돼 기대량만 바뀌어도 ETag 가 바뀐다.

### 2.1 참여자별 기존 필드의 값이 채워지는 곳 (이름 불변, 보고 없으면 기존 값 그대로)

| 필드 | 보고 없음(기존) | 보고 있음 |
|---|---|---|
| `feature.expected` | `null` | int |
| `feature.expected_basis` | `"unknown"` | `"phone_report"` |
| `feature.completeness` | `"unknown"` | `"all_received"`(received ≥ expected) / `"short"` |
| `raw.completeness` | `"unknown"` | raw 3신호 모두 보고됨: `"all_received"` / `"short"`, 일부라도 미보고: `"unknown"` |
| `raw.signals[].expected` (**신규 키**, 항상 존재) | `null` | int(그 신호 미보고면 `null`) |
| `phone_report` | `null` | `{"reported_at": "<ISO>", "final": bool}` |

### 2.2 참여자별 신규 `progress` (항상 존재)

```json
"progress": {
  "state": "in_progress",
  "feature": {"expected": 1200, "received": 1180, "percent": 98.3},
  "raw": {
    "eeg": {"expected": 80, "received": 78, "percent": 97.5},
    "ppg": {"expected": 40, "received": 40, "percent": 100.0},
    "acc": {"expected": 40, "received": 40, "percent": 100.0}
  },
  "total": {"expected": 1360, "received": 1338, "percent": 98.3}
}
```

| 필드 | 정의 |
|---|---|
| `state` | `all_received` / `in_progress` / `needs_attention` / `expected_unknown` / `not_collected` (spec D5 표, 위쪽 우선). 아래 §4 |
| `*.expected` | 보고된 총량. 미보고 `null` |
| `*.received` | 서버 수신량. feature=행 수, raw=신호별 `uploaded` 수. **항상 존재(0 가능)**. 기대를 넘어도 그대로 표시(상한은 합계에서만) |
| `*.percent` | `expected` 가 `null` 이거나 0 이면 `null`, 아니면 `floor(min(received,expected)/expected×1000)/10` |
| `total` | 보고된 컴포넌트만 합산(기대 `null` 인 컴포넌트는 `expected`·`received` 양쪽에서 제외). 합산 대상이 하나도 없으면 `{"expected": null, "received": 0, "percent": null}`. `received` 는 `min(received, expected)` 상한 후 합 |

### 2.3 최상위 신규 `progress` (항상 존재, 합계)

```json
"progress": {
  "participants": {
    "total": 40, "counted": 38, "all_received": 31, "in_progress": 4,
    "needs_attention": 1, "expected_unknown": 2, "not_collected": 2
  },
  "feature": {"expected": 48000, "received": 47100, "percent": 98.1},
  "raw": {
    "eeg": {"expected": 3200, "received": 3150, "percent": 98.4},
    "ppg": {"expected": 1600, "received": 1600, "percent": 100.0},
    "acc": {"expected": 1600, "received": 1590, "percent": 99.3}
  },
  "overall": {"expected": 54400, "received": 53440, "percent": 98.2}
}
```

| 필드 | 정의 |
|---|---|
| `participants.total` | `summary.participants` 와 같음(활성 참여자 수) |
| `participants.not_collected` | state=`not_collected` 인원 |
| `participants.counted` | `total − not_collected` (참여자 진행 분모 "N명 중") |
| `participants.all_received` | "M명 모두 수신" 의 M |
| `participants.expected_unknown` | 기대량 미확인 K. **counted 에 포함**(분모에서 안 뺌) |
| `participants.in_progress` / `needs_attention` | 각 state 인원. 합 `all_received+in_progress+needs_attention+expected_unknown = counted` |
| `feature`/`raw.*` | **보고된 참여자만**(state ∉ {not_collected, expected_unknown} 이 아니라 *그 컴포넌트가 보고된* 참여자) 합. `received` 는 참여자별 `min(received, expected)` 합(상한). 보고 참여자 0 이면 `expected: null`, `received: 0`, `percent: null` |
| `overall` | `feature + raw.eeg + raw.ppg + raw.acc` 의 expected 합·상한 received 합, percent 는 위 식. 단위가 다른 창·청크의 단순 합이므로 화면은 오버롤과 함께 컴포넌트별 값도 보여 준다 |

- `expected_unknown` 인 참여자도 일부 컴포넌트(예: feature 만)를 보고했다면 그 컴포넌트는 `feature` 합에 들어간다 — 수치가 늘 뿐 분모에서 사람이 사라지지 않는다.
- `not_collected` 참여자는 모든 합계에서 제외.

## 3. 가산 — SDD-263 목록 (`GET /upload-status/overview`)

- `items[]` 각 항목에 신규 `progress` (회차 합계, §2.3 와 **같은 구조·같은 계산 함수**). 기존 필드 불변.
- 최상위에 신규 `progress` (후보 `items` 전체 합, §2.3 구조; `participants.total` 은 `Σ items[].participants`).
- `summary`·`status`·정렬·권한·304 의미 불변. ETag 지문에 `items[].progress` 가 포함된다(기대량 변화 → ETag 변경).
- 회차별 캐시(TTL) 안에 progress 포함 → 기대량 보고는 그 TTL 만큼 늦게 반영될 수 있다(진행 중 2s / 종료 30분 내 10s / 그 외 300s).

## 4. `progress.state` 판정 (위쪽 우선, 참여자별)

입력: 수집 제외 여부(`collection_state=="excluded"` 또는 대기열), 수신 기록 존재(feature>0 또는 raw registered>0), 보고 행, 회차 상태·종료 시각, `as_of`.

| 순서 | state | 조건 |
|---|---|---|
| 1 | `not_collected` | 수집 제외(대기열 포함)이고 수신 기록 없음 |
| 2 | `expected_unknown` | 보고 행 없음, 또는 feature 미보고, 또는 raw 3신호 중 미보고 있음, 또는 (회차 `completed`·`ended_at` 이 30분 이상 지났고 `final=false`) |
| 3 | `needs_attention` | 부족분 있음(어느 컴포넌트든 `received<expected`)이고 (raw `failed>0` 또는 정체) |
| 4 | `all_received` | `final=true` 이고 모든 컴포넌트 `received ≥ expected` |
| 5 | `in_progress` | 그 외 |

- 정체 = 마지막 수신 시각(`max(feature.last_received_at, raw.last_received_at)`) 이 있으면 `as_of − 마지막 ≥ 120초`, 없으면 `as_of − first_reported_at ≥ 120초`.
- `final=false` 이고 모두 따라잡은 상태는 `in_progress`(아직 더 만들 수 있음).
- 기존 `status`·`reasons` 와 독립이다(두 값이 달라 보일 수 있음: 예 `status=received_unreconciled` 이고 `progress.state=in_progress`).

## 5. 샘플

`sample-response.json` 에 상세·목록 가산 필드 예(구현 후 실제 응답에서 갱신).

## 6. 성능·캐시

- 상세: 본문 계산 시 + 기대량 1회(참여자 IN 일괄) = 총 6회(권한 1 + revision 1 + 참여자·feature·raw·기대량 4). 목록: 후보 1 + 참여자·feature·raw·기대량 4 = 5회. 인원·회차 수 무관.
- 보고 PUT: 업로드 인증 1 + 기존 행 조회/잠금 1 + UPSERT 1.
- 같은 입력에서 상세·목록은 같은 `aggregate()` 로 계산한다(화면 간 수치 불일치 방지).

## 7. 폰·FE 체크리스트

- 보고 시점: 측정 중 30초마다(값 변동 시), 종료 즉시 `final=true`, 이어올림 완료 시 `final=true` 재보고.
- 오프라인: 마지막 값 1건만 영속 보관(총량은 단조 증가) → 복귀 시 전송.
- `archive.counts` 의 `signals`(additive) 가 없으면 `raw` 를 생략(feature 만 보고).
- 문구: '완료' 대신 '모두 수신', '보증'·점수 금지. 0 이면 중립색.
