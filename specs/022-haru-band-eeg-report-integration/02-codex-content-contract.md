# SDD-022 — content 단일 계약 및 통합 정합 검토

검토일: 2026-09-07. 구현 전 계약 정의 및 현재 코드 정적 검토 결과다. 아래 계약은 **구현자가 따라야 할 목표 계약**이며 현재 구현 완료나 Stage ③ 승인 증거가 아니다. 코드·기존 spec/plan/verify는 수정하지 않았다.

우선순위는 [spec.md:5–28](spec.md#L5) → [verify.md:5–31](verify.md#L5) → [plan.md:3–38](plan.md#L3) → 에이전트 권고다. spec은 EEG 원칙을, verify는 `status/reliability/drowsiness_flag/score/metrics/timeline` 필드를 요구한다. 필드 타입·단위·빈 값·변환 위치는 본 문서에서 확정한다. 종합 리뷰의 TimescaleDB·BLE·ingestion·chord 구상을 P0 필수 구현으로 확대하지 않는다. PostgreSQL 및 실수집 P1 경계는 spec을 따른다.

**검토 시점 구분:** 아래 매핑표와 정합 검토 1–5절의 “현재”는 최초 읽기 시점의 기준선이다. 검토 중 다른 작업자가 FE를 변경했으므로 최종 상태는 정합 검토 6절의 추가 확인을 함께 적용한다. 최초 RD/CD/reports.ts 코드는 Git `c2bae00` 기준으로 재현할 수 있다(`git show c2bae00:frontend/src/pages/reports/ReportDetailPage.tsx`). 해당 세 파일의 초기 줄 번호 링크는 파일 자체로 연결하고, 6절은 새 작업본의 줄 번호를 사용한다. 코드 변경은 본 리뷰어가 수행한 것이 아니다.

경로 정정(최초 읽기 시점): 요청 및 plan의 `frontend/src/lib/api/report.ts`는 존재하지 않는다. 당시 실제 공통 API는 [frontend/src/lib/api/reports.ts:7–40](../../frontend/src/lib/api/reports.ts)다.

## content 단일 계약(JSON 스키마)

**결정: 저장·HTTP 응답에는 중첩 `content.eeg`만 사용한다.** `eeg_summary`, `eeg_timeline`, 최상위 `score`는 저장하지 않는다. 이 세 이름은 기존 화면 연결을 위한 프론트 공통 ViewModel의 파생 필드로만 유지한다. 따라서 verify의 UI 기대 필드와 생성기 `content.eeg` 요구를 단일 어댑터로 충족하며 두 EEG 원본을 만들지 않는다.

다음은 `ReportResponse.content` 대상 JSON Schema 2020-12다. HTTP 외곽의 `id/session_id/user_id/type/sent_at/pdf_url/...`는 기존 DTO에 남는다. 문법적 스키마 외의 교차 필드 규칙은 아래 의미 규칙까지 함께 적용한다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SDD022ReportContentV1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "status", "headline", "summary", "insights", "markers", "counselor_notes", "greeting", "approved", "error", "eeg"],
  "properties": {
    "schema_version": {"const": 1},
    "status": {"enum": ["generating", "ready", "failed"]},
    "headline": {"type": "string", "minLength": 1},
    "summary": {"type": ["string", "null"]},
    "insights": {"type": "array", "items": {"type": "string", "minLength": 1}},
    "markers": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["label", "value"],
        "properties": {
          "label": {"type": "string", "minLength": 1},
          "value": {"type": ["string", "number", "null"]}
        }
      }
    },
    "counselor_notes": {"type": ["string", "null"]},
    "greeting": {"type": ["string", "null"]},
    "approved": {"type": "boolean"},
    "error": {
      "oneOf": [
        {"type": "null"},
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["code", "message"],
          "properties": {
            "code": {"type": "string", "minLength": 1},
            "message": {"type": "string", "minLength": 1}
          }
        }
      ]
    },
    "eeg": {"oneOf": [{"type": "null"}, {"$ref": "#/$defs/eeg"}]}
  },
  "allOf": [
    {
      "if": {"properties": {"status": {"const": "ready"}}},
      "then": {"properties": {"eeg": {"$ref": "#/$defs/eeg"}, "error": {"type": "null"}}}
    },
    {
      "if": {"properties": {"status": {"enum": ["generating", "failed"]}}},
      "then": {"properties": {"eeg": {"type": "null"}, "approved": {"const": false}}}
    },
    {
      "if": {"properties": {"status": {"const": "generating"}}},
      "then": {"properties": {"error": {"type": "null"}}}
    },
    {
      "if": {"properties": {"status": {"const": "failed"}}},
      "then": {"properties": {"error": {"type": "object"}}}
    }
  ],
  "$defs": {
    "score": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
    "reason": {"type": ["string", "null"], "minLength": 1},
    "metrics": {
      "type": "object",
      "additionalProperties": false,
      "required": ["focus_index_stability_score", "total_neural_activity_score", "cognitive_load_stability_score", "stress_score", "hemispheric_balance_score", "emotional_stability_score", "relaxation_score"],
      "properties": {
        "focus_index_stability_score": {"$ref": "#/$defs/score"},
        "total_neural_activity_score": {"$ref": "#/$defs/score"},
        "cognitive_load_stability_score": {"$ref": "#/$defs/score"},
        "stress_score": {"$ref": "#/$defs/score"},
        "hemispheric_balance_score": {"$ref": "#/$defs/score"},
        "emotional_stability_score": {"$ref": "#/$defs/score"},
        "relaxation_score": {"$ref": "#/$defs/score"}
      }
    },
    "metric_reasons": {
      "type": "object",
      "additionalProperties": false,
      "required": ["focus_index_stability_score", "total_neural_activity_score", "cognitive_load_stability_score", "stress_score", "hemispheric_balance_score", "emotional_stability_score", "relaxation_score"],
      "properties": {
        "focus_index_stability_score": {"$ref": "#/$defs/reason"},
        "total_neural_activity_score": {"$ref": "#/$defs/reason"},
        "cognitive_load_stability_score": {"$ref": "#/$defs/reason"},
        "stress_score": {"$ref": "#/$defs/reason"},
        "hemispheric_balance_score": {"$ref": "#/$defs/reason"},
        "emotional_stability_score": {"$ref": "#/$defs/reason"},
        "relaxation_score": {"$ref": "#/$defs/reason"}
      }
    },
    "eeg": {
      "type": "object",
      "additionalProperties": false,
      "required": ["subject_user_id", "status", "reason", "reliability", "drowsiness_flag", "score", "metrics", "metric_reasons", "timeline", "normalization_version"],
      "properties": {
        "subject_user_id": {"type": ["string", "null"], "format": "uuid"},
        "status": {"enum": ["valid", "degraded", "invalid", "insufficient", "not_measured"]},
        "reason": {"$ref": "#/$defs/reason"},
        "reliability": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        "drowsiness_flag": {"type": ["boolean", "null"]},
        "score": {"$ref": "#/$defs/score"},
        "metrics": {"$ref": "#/$defs/metrics"},
        "metric_reasons": {"$ref": "#/$defs/metric_reasons"},
        "normalization_version": {"type": ["string", "null"], "minLength": 1},
        "timeline": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["t", "concentration", "relaxation", "stress"],
            "properties": {
              "t": {"type": "number", "minimum": 0},
              "concentration": {"$ref": "#/$defs/score"},
              "relaxation": {"$ref": "#/$defs/score"},
              "stress": {"$ref": "#/$defs/score"}
            }
          }
        }
      },
      "allOf": [
        {
          "if": {"properties": {"status": {"enum": ["invalid", "insufficient", "not_measured"]}}},
          "then": {"properties": {"score": {"type": "null"}, "reason": {"type": "string"}}}
        },
        {
          "if": {"properties": {"status": {"const": "not_measured"}}},
          "then": {"properties": {"reliability": {"type": "null"}, "drowsiness_flag": {"type": "null"}, "timeline": {"maxItems": 0}, "normalization_version": {"type": "null"}}}
        }
      ]
    }
  }
}
```

**意味 규칙(스키마와 함께 필수 적용)**

1. `null`은 미산출·미확인, `0`은 실제 산출값이다. `metrics`와 `metric_reasons`는 항상 7개 키를 모두 보낸다. 점수가 null이면 해당 사유 코드를 보내고, 수치이면 사유는 null이다. `false`는 졸음 없음이 확인된 경우이며 미평가는 null이다. NaN/Infinity/문자열 수치를 보내지 않는다. `[]`는 목록에 항목이 없음을 뜻하며 수치의 null 대체값이 아니다.
2. `eeg.status`는 서버 품질 엔진만 결정한다. 미착용은 엔진 품질 상태가 아닌 opt-in 외곽 상태 `not_measured`다. 착용/측정 시도 이력이 있지만 window가 없으면 `insufficient` + `NO_FEATURE_WINDOWS`; 기간 부족이면 `TOO_SHORT`; 저품질이면 `invalid` + `LOW_QUALITY`를 사용한다. 전자는 본 계약이 추가한 코드, 후자 두 개는 verify 명시 코드다. 미측정 사유는 `NOT_MEASURED`, 동의 미충족은 `NO_EEG_CONSENT`로 구분한다. 알려지지 않은 사유는 FE에서 일반 안내로 표시하되 원본을 보존한다.
3. `not_measured`에서는 7지표 모두 null, 사유는 미측정 사유, 점수·신뢰도·졸음·버전은 null, timeline은 `[]`다. 현재 연결이 끊겼다는 이유만으로 과거 정상 측정 리포트를 미측정으로 바꾸지 않는다. 참여자 동의와 세션 당시 측정 근거로 결정한다. 근거 불명인 구버전 데이터는 미측정으로 단정하지 않고 재생성 대상으로 처리한다.
4. `invalid/insufficient`에서는 본 계약의 보수적 공개 정책으로 7지표도 모두 null 및 사유를 반환한다. 원시값·진단용 중간 산출은 저장 계층에 남기고 공개 확정 점수처럼 보내지 않는다. 신뢰도와 졸음은 실제 평가된 경우만 보존한다. timeline은 공개본에서 `[]`로 한다. 이는 spec의 종합점수·레이더 숨김을 구체화한 추가 결정이다.
5. `valid/degraded`의 `score`는 `weighted_total` 결과다. null 지표를 제외하고 가중치를 재정규화하며, 전부 null이면 score도 null이다. 실제 0은 가중치 계산에서 제외하지 않는다. FE 재계산·78/82 기본값·AI 상담 점수 혼합은 금지한다. 유효 품질이어도 개별 지표 산출 불가는 별도 상태로 인정한다.
6. `reliability`는 0–1 비율, 점수는 0–100이다. FE는 신뢰도 수치를 표시할 때만 ×100하여 %로 표현한다. 품질 임계값과 정규화 방향은 포팅 엔진·버전 상수의 책임이며 FE가 재판정하지 않는다. 이번 검토는 외부 하루밴드 엔진 자체의 수식·임계값 정확성 검증을 포함하지 않는다.
7. timeline의 `t`는 **세션 시작 기준 경과 초**, 오름차순·중복 없음이다. 3채널은 각각 0–100 또는 null이다. 결측 1초 구간은 채널 null인 점으로 보존한다. FE는 `min=t/60`만 계산하고 `connectNulls=false`로 빈 구간을 잇지 않는다. 정규화된 window 시계열이 없으면 `[]`이며 세션 종합값을 복제해 그래프를 만들지 않는다. 0–1 원천값은 원천 단위가 확인된 BE 변환 지점에서만 변환한다. 값 크기를 보고 단위를 추측하지 않는다.
8. `timeline.concentration`은 순간 집중도이지 `focus_index_stability_score`가 아니다. `timeline.relaxation` 또한 세션 `relaxation_score`와 동일한 값이라는 계약이 아니다. **내담자 카드의 “두뇌휴식도”는 오직 `metrics.relaxation_score`**다. `meditationLevel`, `avgEfficiency`, 순간 `relaxationIndex`, `score`를 대용하지 않는다. 타임라인 라벨은 “이완도”로 둔다.
9. `normalization_version`은 사용한 상수 파일의 실제 버전이다. 엔진 실행 전에는 null, valid/degraded에는 비어 있지 않은 문자열이 필수다. `subject_user_id`는 측정 대상 회원이며 측정된 상태에는 필수다. 상담사용 Report의 `user_id`는 상담사 소유권 값이므로 EEG 대상자로 사용하지 않는다. 여러 참여자의 EEG를 하나의 객체에 합산하지 않는다. P0에서 대상자를 유일하게 정하지 못하면 생성 오류로 처리한다.
10. 상담 본문은 EEG와 독립이다. 요약 미생성은 `summary:null`, 인사이트 없음은 `[]`로 표현하고 “요약 준비 전” 등 본문 상태를 표시한다. 상담 레이어 전체를 EEG 유무로 숨기지 않는다. counselor/client 모두 같은 구조를 사용하되 client에는 `counselor_notes:null`, `markers:[]`를 반환한다. 내담자 공유 마커 선별 기능은 이번 계약에 추가하지 않는다.
11. `approved`는 HTTP 외곽 `sent_at != null`과 일치해야 한다. `content.status`는 생성 상태이고 `eeg.status`와 별개다. 생성 중·실패를 `eeg.not_measured`로 위장하지 않는다. 생성 실패의 `error.message`에는 안전한 안내만 넣고 예외 원문은 서버 로그에 남긴다. 승인/수정/재생성도 동일 계약을 지켜야 한다.

## 프론트↔백엔드 매핑표

근거 약어: **RT**=[report_task.py](../../backend/app/tasks/report_task.py), **RS**=[report_service.py](../../backend/app/services/report_service.py), **RD**=[ReportDetailPage.tsx](../../frontend/src/pages/reports/ReportDetailPage.tsx), **CD**=[ClientReportDetailPage.tsx](../../frontend/src/pages/client/ClientReportDetailPage.tsx). 행의 줄 번호는 검토 당시 코드 기준이다.

| FE 기대/사용처 | 현재 BE 산출·실제 불일치 | 확정 계약 및 변환 위치 |
|---|---|---|
| `summary:string` (RD 256, CD 248) | 양쪽 생성기에 없음. counselor는 `headline/sections` (RT 20–21), client는 고정 headline (55) | BE 생성 시 `ai_summary.sections`의 문자열 항목을 `제목: 본문` 순서로 개행 결합. 유효 section이 없으면 실제 AI headline, 그것도 없으면 null. 장식용 기본 headline을 요약으로 복제하지 않음 |
| `insights:string[]` (RD 257, 287–295) | counselor는 필드 없음, client는 `{title,body}[]` (RT 47–57) | BE에서 양쪽 모두 문자열 배열 생성. client 기존 3개 제한 유지, counselor는 유효 section 전체. `{title,body}`는 `title: body`; 객체의 Python `str()` 결과를 본문으로 보내지 않음 |
| `markers[{label,value}]` (RD 258, 306–307) | counselor는 원본 배열 무변환, client는 필드 없음 (RT 22, 51–68). 실제 원본은 `{timestamp_sec,note,created_at}` ([session_service.py:439–454](../../backend/app/services/session_service.py#L439)) | BE에서 counselor만 `label=note`(빈 메모는 “마커”), `value=timestamp_sec`의 `MM:SS` 문자열로 변환. 소수 초는 표시에서 버림, 0초는 `00:00`, 누락은 null. client는 `[]`. 미래 overlay용 원본은 SessionRecord에 유지 |
| 마커 `value:string\|number` (RD 99) | 임의 dict라 누락 허용, 의미 검증 없음 | FE 타입에 null 추가하고 null만 “정보 없음”. 0은 그대로 표시. 시간 마커 제목을 “상담 마커”로 구분해 EEG 수치로 오인하지 않도록 함 |
| `headline` (RD 25, 목록 화면) | 양쪽 존재하나 client 고정 문자열 | 같은 이름 유지. `summary`와 별개인 표제. 목록의 기존 fallback 호환 유지 |
| `title/session_type/scheduled_at` | content에 중복 (RT 17–19, 52–54); FE는 외곽 `session_title/session_type/scheduled_at` 사용 (RD 26–27, 57) | 외곽 메타데이터만 유지. content의 중복 제거 |
| `counselor_notes/greeting` | BE 각각 산출하나 RD/CD 본문에서 미사용 (RT 23, 56) | content에 nullable 필드 유지. FE는 상담사 메모와 내담자 인사말의 알맞은 본문에 표시. client 응답에서 메모 제거는 BE 책임 |
| Cover `content.score` (RD/CD 24) | 하드코딩 78/82, 미착용도 반환 (RT 39, 66) | 저장 필드는 `eeg.score`만. 공통 FE 어댑터의 `score = valid/degraded ? eeg.score : null`. Cover는 ViewModel을 읽고 “EEG 종합점수”로 표시 |
| `eeg_summary` (RD 259, 319) | 필드 없음. counselor는 `eeg.available/samples`, client는 `available/highlight` (RT 24–38, 58–65) | BE가 엔진 결과를 `eeg.metrics`로 생성. FE 어댑터의 `eeg_summary = valid/degraded ? eeg.metrics : null`. 고정 highlight 폐기. 임의 `Object.entries` 대신 7개 키 레지스트리 사용 |
| `eeg_timeline` (RD 260, 108–114) | 어느 생성기에도 시계열 없음 | BE가 정규화 window를 `eeg.timeline`으로 생성. FE 어댑터만 `{t,...channels} → {min:t/60,...channels}` 변환. 원천 없음은 `[]` |
| X축 `min`, Y축 0–100 (RD 140–151) | UX 초안은 `t`, 값 0.6/0.7 예시 ([03 리뷰:124–126](03-cursor-report-ux-review.md#L124)) | 본 계약의 초/0–100으로 확정. 이름 변경만으로 0–1 데이터를 넣지 않음. UI 변환은 시간축만 담당 |
| 품질 배너·졸음·신뢰도·null 사유 | `available:boolean`뿐. FE도 상태 분기 없음 | BE `eeg.status/reason/reliability/drowsiness_flag/metric_reasons`; FE 어댑터가 상태를 보존하여 배너 props와 노출 boolean 생성. `available` 호환 키 신설 금지 |
| 두뇌휴식도·7지표 레이블 | 전용 필드/라벨 없음, FE는 키의 `_`만 공백으로 바꿈 (RD 325, CD 315) | FE 고정 레지스트리에서 `relaxation_score → 두뇌휴식도`. BE에 숫자 별칭이나 `summary_labels` 중복 저장 금지 |
| `approved`, `sent_at` | 승인 시만 둘을 갱신 (RS 160–163); 재생성은 approved=false (RT 40/67) | RS 승인·재생성·수정에서 일관성 유지. FE 권한/발송 판단은 외곽 `sent_at`, 서버 접근 통제 필수 |
| 생성 중/실패 | 초기 `{status:"generating"}` (RS 81), 실패 `{headline,error,fallback}` (RT 91) | BE가 전체 V1 구조 및 별도 생성 상태 반환. FE 공통 어댑터가 loading/error ViewModel 생성. 부분 객체를 정상 리포트로 캐스팅하지 않음 |
| GET/list/generate/update/approve 응답 | BE `dict[str,Any]`, FE `Record<string,unknown>`로 무검증 통과 ([schemas/report.py:13–26](../../backend/app/schemas/report.py#L13), [reports.ts:12–40](../../frontend/src/lib/api/reports.ts)) | 모든 BE 쓰기 경로에서 공통 계약 검증. FE `reports.ts`의 공통 어댑터를 모든 반환 경로 및 목록 각 항목에 한 번 적용. ViewModel을 update payload로 역전송하지 않음 |

**변환 소유권:** BE는 원천 데이터 → 공식 content 생성과 검증, FE의 `reports.ts`는 공식 content → 화면 ViewModel 변환만 담당한다. FE 어댑터는 공통 하나로 두고 RD/CD 모두 재사용한다. ViewModel은 원본 `eeg`와 `showEeg/showScore/showRadar`, 위의 평탄화 필드를 포함한다. 원본 DTO의 `content`에 별칭을 덧씌워 저장용 타입과 섞지 않는다.

계획상 `report_service.py`가 생성 조립을 소유하더라도 현재 RS 13은 RT를 import한다. RT에서 RS를 모듈 최상위로 역참조하면 순환 import가 생긴다. 구현 시 순수 계약 빌더/검증 모듈을 양쪽에서 공유하거나 호출 방향을 정리한다. 어느 방식을 택해도 도메인 변환을 FE와 BE에 중복 구현하지 않는다.

**기존 저장본:** `schema_version` 없는 객체는 V1으로 간주하지 않는다. 신뢰 가능한 SessionRecord/EEG 원천이 있으면 BE 공통 빌더로 재생성한다. `eeg.available=true`만으로 valid를 추정하거나 78/82를 이관하지 않는다. 원천이 부족하면 정상 V1로 승격하지 말고 재생성 필요/실패 상태를 표시한다. 새 FE와 BE는 함께 배포하며, 구버전 처리도 API 경계에서 끝낸다.

## 정합 검토 결과(불일치/권고)

### 1. null 보존 — 현재 불충족

- **직접 손실:** [RT 30–31](../../backend/app/tasks/report_task.py#L30)의 `duration_sec or 0`, `analysis_result or {}`는 [모델 51–53](../../backend/app/models/record.py#L51)의 nullable 값을 훼손한다. null과 실제 0초, null과 실제 빈 객체를 구분할 수 없다. 원본은 그대로 전달하고 검증/산출 결과에 별도 사유를 붙여야 한다.
- **동일 파일 전체 검사 필요:** [RT 15](../../backend/app/tasks/report_task.py#L15), [45–46](../../backend/app/tasks/report_task.py#L45)의 AI summary/sections `or {}`도 verify의 “잔존 없음” 대상이다. 지표 결측 손실과 텍스트 파싱용 기본값은 의미가 다르지만, 명시적 `is None`/타입 검증으로 바꿔 실패·빈 내용을 분리해야 한다.
- **직렬화에서도 정상처럼 보정:** [RS 33](../../backend/app/services/report_service.py#L33), [161](../../backend/app/services/report_service.py#L161)의 `content or {}`는 잘못된 content를 빈 객체로 숨긴다. 정상 V1 구조 검증으로 대체할 대상이다. dict 자체가 항상 금지인 것은 아니며, 알 수 없는 EEG 값을 `{}`로 대체하는 것이 문제다.
- **FE는 null을 0으로 만들지는 않지만 표시 계약이 없음:** RD/CD 24의 `?? null`은 실제 0을 보존한다. 반면 [RD 328](../../frontend/src/pages/reports/ReportDetailPage.tsx), [CD 318](../../frontend/src/pages/client/ClientReportDetailPage.tsx)은 null을 문자열 `"null"`, 객체를 `"[object Object]"`로 표시한다. nullable 점수는 “산출 불가”와 사유로 표시해야 한다.
- **첫 시점 null이면 채널 전체 소실:** [RD 125–129](../../frontend/src/pages/reports/ReportDetailPage.tsx), [CD 124–127](../../frontend/src/pages/client/ClientReportDetailPage.tsx)은 첫 점의 숫자 키만 채널로 선택한다. 첫 점은 null, 다음 점은 정상인 채널도 표시되지 않는다. 3채널을 명시적으로 고정하고 유효값 존재 여부는 시계열 전체로 판단한다.

### 2. 품질 게이트 4상태 + 미측정 — 현재 불충족

RT는 레코드 존재 여부만으로 `available`을 결정한다. 품질 판정·신뢰도·사유·졸음·7지표 필드가 없으며, 현재 검토 범위의 BE에 `services/eeg_metrics.py`와 FE의 신규 EEG 컴포넌트도 없다. [RD 314](../../frontend/src/pages/reports/ReportDetailPage.tsx), [CD 305](../../frontend/src/pages/client/ClientReportDetailPage.tsx)의 조건은 평탄화 필드 존재 여부일 뿐이다. 현재 EEG 영역이 안 나오는 것은 계약 불일치의 결과이며 미착용 가드 구현의 증거가 아니다. Cover의 고정 점수는 EEG 영역 밖에서 계속 노출된다.

| 상태 | BE 공개 content | 상담사 UI | 내담자 UI |
|---|---|---|---|
| valid | 실제 점수·7지표(null 허용)·시계열·버전 | 품질·신뢰도 수치, 7지표 및 null 사유, 3채널 | 정상 품질 안내, 4지표 기본 + 나머지 접힘, 3채널 |
| degraded | 같은 구조 + 품질 저하 사유 | 주의 배지·사유 + 유효값만 표시 | 쉬운 주의 문구 + 동일 값, 추정 보완 금지 |
| invalid | score/7지표 null, LOW_QUALITY, timeline=[] | 사유 배너, 산출 불가 카드; 종합점수·레이더·차트 숨김 | 참고 생략 안내; 종합점수·레이더·차트 숨김 |
| insufficient | score/7지표 null, TOO_SHORT 또는 NO_FEATURE_WINDOWS, timeline=[] | 부족 사유·산출 불가; 점수·레이더·차트 숨김 | 측정 부족 안내; 점수·레이더·차트 숨김 |
| not_measured | 위 의미 규칙 3의 명시적 객체 | EEG 배너·카드·차트·Cover EEG 점수 DOM 모두 없음 | 동일. 상담 본문은 정상 노출 |

valid/degraded라도 `score:null`이면 Cover 점수는 숨긴다. 레이더는 7지표 모두 수치일 때만 표시하고, 빠진 축을 0으로 채우지 않는다. 레이더 도입 자체는 이번 문서가 추가하는 필수 기능이 아니다. `eeg:null`인 생성 중/실패에서는 EEG 대신 생성 상태만 표시한다.

### 3. 두뇌휴식도·역할 비대칭 — 현재 미구현

목표는 [spec 14](spec.md#L14), [verify 24–28](verify.md#L24)의 단일 소스와 역할별 밀도다. 현재 BE에는 `relaxation_score` 산출이 없고, FE에는 두뇌휴식도 매핑도 없다. 일관성 검증 결과는 “정합”이 아니라 “양쪽 미구현”이다. client의 고정 긍정문구 [RT 61](../../backend/app/tasks/report_task.py#L61)는 실제 이완 결과를 증명하지 못하므로 제거한다.

FE 레지스트리는 다음 7키를 고정한다. 내담자 기본 4개는 **두뇌휴식도·집중 안정·정서 안정·스트레스**로 정하고 나머지는 접는다. “상위”를 점수가 높은 순으로 해석해 결측값을 감추지 않는다. stress_score의 좋고 나쁨 방향은 엔진 정의 검증 전 별도 반전하지 않는다.

| metrics 키 | 내담자 라벨 | 기본 노출 |
|---|---|---|
| relaxation_score | 두뇌휴식도 | 기본 |
| focus_index_stability_score | 집중 안정 | 기본 |
| emotional_stability_score | 정서 안정 | 기본 |
| stress_score | 스트레스 | 기본 |
| total_neural_activity_score | 뇌 활동량 | 접힘 |
| cognitive_load_stability_score | 인지 부하 안정 | 접힘 |
| hemispheric_balance_score | 좌우 균형 | 접힘 |

상담사는 모든 카드와 null 사유·신뢰도 수치를 본다. 내담자 쉬운 라벨은 표시만 바꾸며 값·null·품질 상태는 동일하다. [CD 247–325](../../frontend/src/pages/client/ClientReportDetailPage.tsx)는 별도 구현이므로 RD만 바꾸면 내담자 수락 기준은 충족되지 않는다. 플랜 T9에 CD와 공통 어댑터 사용을 포함해야 한다.

### 4. 추가 통합 차단 이슈

1. **P0 — insights 렌더링 타입 충돌.** RT 47–57의 객체를 RD 295/CD 286에서 React 자식으로 직접 렌더링한다. 비어 있지 않은 sections로 client 리포트를 생성하면 런타임 오류로 이어질 수 있다. `as string[]`는 변환/검증이 아니다. API 경계와 생성기 계약을 함께 맞춘다.
2. **P0 — 발송 전 접근 차단이 실제로 없음.** spec 27의 “기존 유지”와 다르게 [RS 107–112](../../backend/app/services/report_service.py#L107)는 `user_id`만으로 목록을 조회하고 [123–132](../../backend/app/services/report_service.py#L123)는 소유자/host만 검사한다. 내담자에게 `type=client AND sent_at IS NOT NULL`을 강제하지 않는다. [ClientReportListPage 74–80](../../frontend/src/pages/client/ClientReportListPage.tsx#L74)도 응답을 그대로 노출한다. 서버 list/get 양쪽에서 차단하고 host 초안 열람은 유지해야 한다. 인증 의존성만 있는 [reports API 30–44](../../backend/app/api/v1/reports.py#L30)는 이 필터를 대신하지 않는다.
3. **P0 — 대상자 혼합 위험.** [RT 82](../../backend/app/tasks/report_task.py#L82)는 `session_id`만으로 EEG를 전부 가져오며 [RS 62–72](../../backend/app/services/report_service.py#L62)는 첫 참여자와 세션+type만 사용한다. 여러 참여자가 있으면 타인의 EEG 혼합/잘못된 수신자 선택 가능성이 있다. [EEGRecord 48–49](../../backend/app/models/record.py#L48)의 user_id로 측정 대상을 제한한다. counselor용과 client용의 소유자는 다르지만 동일 대상자의 EEG 숫자는 같아야 한다. 게스트 `user_id:null`도 가능한 [SessionParticipant 58–68](../../backend/app/models/session.py#L58)을 임의 첫 회원/host로 바꿔 넣지 않는다.
4. **P0 — 동의/착용과 레코드 존재의 혼동.** RT 24–38/58–65는 참여자의 `consent_eeg`와 당시 측정 근거를 보지 않는다. 미착용·동의 미충족·착용했지만 feature 없음의 세 경우를 구분해야 한다. feature 실수집은 P1이므로 P0 통합 테스트에는 상태별 명시적 fixture가 필요하다.
5. **P1 — 승인·재생성 불일치.** 승인된 Report 재생성 시 RS 74–86은 기존 객체를 사용하고 RT는 `approved:false`로 덮지만 `sent_at`은 남긴다. 외곽 sent_at을 진실값으로 삼되 내용 변경 시 발송/재승인 정책을 구현 전에 정해야 한다. 권고는 발송본 스냅샷을 보존하고 새 초안을 분리하는 것; 최소한 발송본의 승인 상태와 내용을 무통보로 교체하지 않는다.
6. **P0 — 수정 경로에서 계약·EEG 무결성 우회.** [RS 144–145](../../backend/app/services/report_service.py#L144)는 임의 content를 통째로 저장한다. 생성기만 고치면 update가 다시 계약을 깨뜨린다. 상담 텍스트 수정 필드만 허용하고 `eeg/schema_version/approved`는 서버 관리 값으로 보호하며 최종 객체를 검증한다.

### 5. 검증 증거와 한계

이번 결과는 지정 문서와 생성·직렬화·모델·API·양쪽 상세 화면·목록·기존 테스트의 **정적 교차 검토**다. 현재 서비스 import/DB 접근/리포트 생성/pytest/tsc/build는 실행하지 않았다. 구현 전 문서 작업이므로 verify 체크박스를 통과로 표시하지 않는다. 기존 [test_report.py 62–87](../../backend/tests/test_report.py#L62)는 headline 존재/리포트 유형만 검사하고, [123–146](../../backend/tests/test_report.py#L123)은 느슨한 수정 payload와 승인 필드만 검사하므로 새 계약·품질 상태·미발송 접근 차단의 증거가 아니다.

구현 후 필수 계약 검증 시나리오는 다음과 같다.

- counselor/client 생성, 목록 각 항목, 상세, 수정, 승인 응답 모두 동일 JSON Schema 통과. client insights는 전부 문자열이고 원본 마커를 넣었을 때 `00:00` 및 메모가 표시됨.
- 품질 5상태 × 역할 2종에서 위 노출표 확인. not_measured는 Cover를 포함한 EEG DOM 0개, invalid/insufficient는 점수·레이더 0 채움 없음.
- 실제 0과 null을 같은 fixture에 포함. `relaxation_score=0`은 두뇌휴식도 0, null은 산출 불가. reliability=0과 null, drowsiness=false와 null, duration=0과 null도 각각 보존.
- 첫 점 null/다음 점 정상인 3채널, 중간 결측 구간, t=60의 1분 X축, 0–100 Y축 검증. 빈 시계열은 빈 차트 대신 “시계열 없음” 안내.
- 부분 null의 weighted_total 가중치 재정규화, 전체 null의 score=null, 숫자 0의 가중치 포함. Cover 점수와 두뇌휴식도를 서로 다른 fixture 값으로 넣어 잘못된 별칭 매핑 검출.
- 서로 다른 두 참여자의 EEG fixture로 혼합 방지, 미동의/미착용/feature 없음 분기 검증. 모호한 대상자는 오류 처리.
- 내담자 미발송 list 제외/get 차단, host 초안 열람, 발송된 본인 client만 조회, 타인 거부. client API payload에 상담사 메모/원본 마커 없음.
- EEG 없는 상담 본문, 요약 없는 상태, 생성 중, 실패, 구버전 content 재생성 경로, 수정 후 계약 유지 및 승인 상태 일치 확인.
- 마지막으로 plan 지정 BE `./venv/bin/python -m pytest -q`, FE tsc 및 `npm run build` 실행 결과를 별도 Summary에 기록.

### 6. 동시 진행 FE 변경 재확인 — 추가 읽기 시점의 발견

추가 읽기 시점에 `frontend/src/lib/api/report.ts`와 `components/reports/`가 신설되고 RD/reports.ts가 수정되었다. 따라서 “report.ts 없음”, “FE 컴포넌트 없음”, “FE 매핑 미구현”이라는 앞 절의 기준선 판정은 아래 결과로 갱신한다. BE RT의 `or 0/or {}`·고정 점수와 CD의 기존 직접 렌더링은 해당 추가 읽기 시점에 그대로였다. 문서 검증 중 CD도 다시 수정 중인 것을 확인했으므로 CD 관련 잔존 판정은 이 읽기 시점에 한정하며, 이후 작업본의 해결 여부는 미검증이다. 이 변경을 되돌리거나 수정하지 않았다.

**반영된 부분:** [신규 report.ts:16–57](../../frontend/src/lib/api/report.ts#L16)은 7키·두뇌휴식도 라벨·내담자 기본 4키를 정의한다. [EegMetricsGrid.tsx:28–29](../../frontend/src/components/reports/EegMetricsGrid.tsx#L28)는 수치 0과 null을 구분하고 [58–68](../../frontend/src/components/reports/EegMetricsGrid.tsx#L58)은 역할별 접힘을 구현한다. [EegTimeline.tsx:75–85](../../frontend/src/components/reports/EegTimeline.tsx#L75)는 고정 채널·connectNulls=false로 기준선의 첫 점 채널 누락 문제를 해소한다. [RD:183–186](../../frontend/src/pages/reports/ReportDetailPage.tsx#L183), [236–247](../../frontend/src/pages/reports/ReportDetailPage.tsx#L236)에 어댑터·품질 배너·지표·타임라인 연결이 생겼다. 이는 정적 코드 확인이며 실행 통과 판정은 아니다.

**남은 계약 불일치 및 새 발견:**

| 우선순위 | 새 코드 근거 | 불일치·재현 입력·권고 |
|---|---|---|
| P0 | [report.ts:142–148](../../frontend/src/lib/api/report.ts#L142), [182–195](../../frontend/src/lib/api/report.ts#L182) | `t`를 그대로 `min`에 넣고 0–1 값을 크기만 보고 ×100한다. 계약 입력 `{t:60,concentration:1,relaxation:0.5,stress:0}`는 1분·1·0.5·0이어야 하지만 60분·100·50·0이 된다. `t/60`, 점수 그대로 전달로 수정 필요 |
| P0 | [report.ts:238–239](../../frontend/src/lib/api/report.ts#L238), [257–285](../../frontend/src/lib/api/report.ts#L257), [316](../../frontend/src/lib/api/report.ts#L316) | not_measured를 null로 지운 후 legacy fallback, 구형 평탄 데이터는 valid로 추정한다. `eeg.status=not_measured`와 남은 eeg_timeline이 함께 있으면 EEG가 다시 표시될 수 있다. 명시 상태 우선, 미확인 품질 승격 금지 |
| P0 | [report.ts:323–328](../../frontend/src/lib/api/report.ts#L323), [RD:86–89](../../frontend/src/pages/reports/ReportDetailPage.tsx#L86) | 미측정/EEG 없음에서 `content.score`를 복구해 BE 스텁 78/82를 다시 노출한다. client Cover는 이 종합값을 “오늘의 두뇌휴식”으로 부른다. 고정/구형 score fallback 제거, EEG 종합점수 라벨 또는 실제 relaxation_score 기반 별도 카드로 수정 필요 |
| P0 | [report.ts:67–82](../../frontend/src/lib/api/report.ts#L67), [124–125](../../frontend/src/lib/api/report.ts#L124), [241–249](../../frontend/src/lib/api/report.ts#L241) | `drowsiness_flag:null`을 false로 대체하고 subject_user_id/reason/metric_reasons를 잃는다. markers.value도 null 불허다. 공식 DTO와 ViewModel을 분리하고 nullable/사유 필드를 보존해야 함 |
| P0 | [report.ts:201–218](../../frontend/src/lib/api/report.ts#L201), [335–338](../../frontend/src/lib/api/report.ts#L335) | 기존 객체 insights를 문자열로 변환하지 않고 모두 제거하며 원본 마커도 label이 없어서 제거한다. RD 크래시 위험은 줄지만 빈 본문 문제는 남는다. BE 공식 생성기 정합이 선행되어야 함; CD는 여전히 구형 직접 렌더링이라 객체 insights 오류 위험 유지 |
| P1 | [report.ts:129–132](../../frontend/src/lib/api/report.ts#L129) | NaN만 거부하여 Infinity와 범위 밖 값이 남는다. 유한성·0–100/0–1 범위 검증 필요 |
| P1 | [report.ts:351–361](../../frontend/src/lib/api/report.ts#L351), [EegMetricsGrid.tsx:90–94](../../frontend/src/components/reports/EegMetricsGrid.tsx#L90) | 카드 값은 해당 metrics 키를 정확히 사용하나 서버 summary_labels가 고정 라벨을 덮어쓴다. 다른 지표를 “두뇌휴식도”로 부를 수도 있으므로 고정 레지스트리를 최종 권위로 사용 |
| P1 | [reports.ts:46–59](../../frontend/src/lib/api/reports.ts#L46), [RD:183](../../frontend/src/pages/reports/ReportDetailPage.tsx#L183) | API 함수는 여전히 원시 응답, RD에서만 어댑터 호출. CD와 모든 응답 소비 경로가 공유되었다는 증거 없음. `report.ts` 순수 어댑터를 `reports.ts` 경계에 일관되게 연결하고 CD도 같은 ViewModel 사용 |

추가 구현은 품질 UI와 카드의 일부 요구를 충족하는 방향이지만, **단위 오류·legacy 품질 승격·미측정 점수 복구·졸음 null 손실은 계약 수락 차단 항목**이다. 리뷰 중 변경된 작업본이므로 향후 줄 번호가 다시 이동할 수 있으며, 수정 완료 후 동일 fixture로 교차 검증해야 한다.

## 최종 권고안

**단일 계약은 `content.eeg` 중심 V1으로 확정한다. 현재 구현은 이 계약을 충족하지 않으며, 단순 필드 이름 변경만으로 해결되지 않는다.**

1. BE T4/T5는 null 보존 → 대상자/동의 판정 → 품질 엔진 산출 → 공통 content 빌더/검증 → 저장 순서로 구현한다. counselor/client를 별개 EEG 산출 경로로 만들지 않는다.
2. FE T7은 실제 `reports.ts`에 공통 ViewModel 어댑터를 연결하고(순수 구현은 신규 `report.ts`에 분리 가능), T9는 RD와 CD 모두 적용한다. 7지표 키·두뇌휴식도 라벨·상태 노출 규칙은 공통 레지스트리/컴포넌트로 공유한다.
3. 미발송 접근 통제와 EEG 대상자 구분을 P0 통합 검증 차단 항목으로 취급한다. 기존에 보장된다고 가정하지 않는다. 수정/승인/재생성 경로도 같은 계약을 준수해야 한다.
4. 구현 전 verify에는 본 문서의 상태별 null/0·단위·대상자·권한 fixture를 반영하고 승인 게이트를 따른다. 본 문서 작성 자체는 구현 승인이나 테스트 통과를 의미하지 않는다.
