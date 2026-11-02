# SDD-272 — 시각 보정 지연으로 실시간 지표 숨김 수정

- 상태: Stage ① Spec
- 브랜치: `sdd/272-live-clock-anchor-fix`
- 작성일: 2026-11-02

## 1. 증상 (운영 앱 vc34, 11/2 13:03~13:10 회차 5bcca158)
- 회원 폰: 입장·밴드 연결 성공, 서버에 분석 118창·방송 이벤트 118건 정상 저장(지표 22종 valid). 그런데 폰·상담사 화면 모든 지표가 "-".
- 서버 방송 `freshness=time_uncertain` → 프런트 `displayCell`이 값을 "-"로 가림.
- 비회원(코드 입장) 폰: 밴드 연결 뒤 "다음"이 안 넘어감.

## 2. 원인 (코드 확인)
### 2-1. 지표 숨김 — 확정(코드 경로) / 운영 로그 재현은 reanchor 0건으로 부합
1. `capture.start` 시 `clock_uncertain=True`. `capture.reanchor` 성공(서버가 probe 10초 안 확인)해야 해제.
2. Android `LiveSession.sendProbe()`: probe ok여도 `anchorProvider()`가 null(첫 뇌파 패킷 전)이면 **아무것도 보내지 않고** 다음 시도가 5분 뒤. 2분 회차는 재시도 기회가 없다. reanchor ACK가 rejected/실패여도 재시도 없음.
3. iOS `MeasurementManager.syncClock()`: stream 확정 직후 1회 + 5분 주기. probe 실패/reanchor 거절/`clock_uncertain=true` 응답이면 5분 대기.
4. 웹 `CaptureController.reanchorNow()`: 시작 시 1회 + 5분. 실패·`clock_uncertain=true` 응답이어도 재시도 없음.
5. 표시 쪽: `time_uncertain`이면 값이 있어도 무조건 "-" (`live-view.ts` freshnessOf/displayCell).

### 2-2. 비회원 "다음" — 코드상 확정(가설→코드 근거 있음, 실기기 로그는 미확인)
`EntryPage.tsx`의 리포트 반영 재확인 시트(`FlowSheet`)가 `<BandStepContainer/>` **형제**로 렌더되어 `PlayerShell`(`position:fixed; inset:0`) **밖**에 있다. 시트 CSS(`.pz-sheet[data-mode=bottom]`)는 셸 그리드 칸(grid-row 3)에 놓일 때만 보이는 구조라, 밖에서는 고정 전체화면 셸 뒤로 가려져 화면에 안 보이고 셸은 inert도 아니다. 비회원은 `report_included=false`라 항상 이 분기를 타서 "다음"을 눌러도 아무 반응이 없어 보인다. 회원(report_included=true)은 이 분기를 안 타서 정상. 기존 시험은 텍스트 존재만 보아 못 잡았다.
- `POST /devices` 422는 푸시 토큰 등록(lib/native/push.ts)이라 무관 — 추적 제외.

## 3. 범위
1. **앱 재앵커 재시도**(Android·iOS·웹): 앵커 없음/probe 실패/reanchor 거절·`clock_uncertain=true` 시 짧은 간격 재시도(2s→4s→8s→15s 상한, 최대 8회 후 기존 5분 주기). 매번 **새 probe**→10초 안 reanchor. 앵커가 처음 생기는 첫 뇌파 패킷 즉시 1회 트리거. 새 stream·재연결에서도 재시작. 기존 5분 주기 유지.
2. **표시 방어**: 아래 §4.
3. **비회원 "다음"**: 시트를 셸 안 슬롯으로 이동(최소 수정).

## 4. 표시 방어 선택: 프런트(수신 시각 기준) — 서버 변경 없음
| 안 | 내용 | 판단 |
|---|---|---|
| A 서버 | payload에 수신 시각 필드 추가 | `MetricsEntity`가 `additionalProperties:false` → 계약 스키마 변경·골든 픽스처 갱신 필요 |
| B 서버 | freshness를 fresh로 승격 | 시각 불확실 값을 fresh로 오인시킴 — 금지 |
| **C 프런트(선택)** | 이벤트 봉투에 이미 있는 `received_at_server_ms`(서버 시계)를 metrics 항목에 보관, 서버 추정 현재시각(`serverNowMs`)과의 경과로만 신선도 판정 | 계약 변경 0, 서버 저장·ingest 판정 무변경, 서버시계끼리 비교라 기기 시계 오차 무관 |

규칙(C):
- 서버 `freshness=time_uncertain`이고 수신 경과 ≤ 5s → 값 표시(status=`value`, `timeUncertain=true` 보조 표기), ≤ 30s → `delayed`, 초과 → `stale`("-").
- 수신 시각을 모르는 값(snapshot 복원·재연결 재생)은 기존대로 time_uncertain("-").
- `observed_at_ms`는 계속 null 유지 → 5분 막대(관측 시각 기반)에는 넣지 않는다(시각 오인 방지). 모바일 현재값·상담사 현재값 칸만 대상.
- 새 문구는 점수·좋음/나쁨·완료·100% 단정 표현 없음. 보조 표기는 "시각 보정 중"만.
- 저장(feature windows)·`evaluate_ingest`·업로드 현황 로직 무변경.

## 5. 비목표
앱 스토어 빌드·배포·푸시 없음. 서버 DB 쓰기 없음. 밴드→앱 구간 유실 복구 범위 아님.
