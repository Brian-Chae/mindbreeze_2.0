# SDD-261 — 데이터 저장·업로드 현황 화면

- 상태: Stage ① 확정(11/1 대표 결정 3건 반영) / Stage ③ verify.md 승인 대기. 구현 전.
- 기준: 2026-11-01, `sdd/261-upload-status-screens`, HEAD `df82a273` 코드 직접 확인.
- 목표: 11/4 대구교육청 40명 클래스에서 운영자가 서버 수신 공백·미완료 등록 건을 찾아 현장 확인한다. 이 화면만으로 데이터 100% 저장을 보증하지 않는다.
- 범위: 문서 2종. designs/ 시안은 별도 담당. 점수·종합점수·좋음/나쁨 없음.

## 1. SDD-260 대비 및 브리프 교정

| 항목 | SDD-260 포함 여부 / 실제 코드 | SDD-261 처리 |
|---|---|---|
| 폰 본인 업로드 안내 | 포함. `frontend/src/components/class/player/member/MemberClassContainer.tsx:787`만 렌더. `frontend/src/lib/measurement-web/upload-progress.ts:23` 대기→대조→완료/격리 확인 문구 | 유지, 관리자 완료 근거로 전용하지 않음 |
| 네이티브 이벤트 | 포함. Android `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/measurement/MeasurementPlugin.kt:224`, iOS `frontend/ios/MeasurementKit/Sources/MeasurementKit/MeasurementManager.swift:726` | 서버 보고가 아닌 JS 로컬 이벤트 |
| 설정 현황 메뉴 | 없음. `frontend/src/pages/SettingsPage.tsx:6`, `frontend/src/components/settings/settings-content.tsx:61` | 웹 운영자 메뉴 신설 |
| 코치 참여자별 원시 현황 | 없음. `frontend/src/pages/classes/host-class-detail-page.tsx:36` 기존 개요/회차/멤버/설정 | 회차별 업로드 현황 진입 추가 |
| 서버 summary | 포함. `backend/app/api/v1/session.py:861`, `:886`, `:964` 본인/호스트 1명 조회; 호스트 participant_id 없으면 422 | 관리자 배치 API 신설. 기존 API 권한 변경 안 함 |
| 다인 집계 | 두 summary를 40명에 호출하면 80회. 단, 기존 호스트 응답에 upload_status 필드는 있음 | 기존 필드는 수신 최신성 기반 idle/streaming/delayed일 뿐 내구 저장 완료 아님(`backend/app/services/session_service.py:3075`) |
| 관리자 ingest-metrics | `backend/app/api/v1/admin.py:779`, platform_admin 전용 프로세스 통계 | 참여자 저장 증거로 사용 안 함 |
| feature 기대 창 | 브리프의 세션 길이/5초 가정 교정 | 코어 1초 격자(`packages/measurement-core/src/engine.rs:25`, `:780`), 전송 5초(`frontend/src/lib/measurement-web/capture-controller.ts:13`). 워밍업·중단·gap 때문에 길이/1초도 정확한 분모 아님 |
| sequence 원점 | 코어 0 초기값 뒤 증가하여 첫 프레임 1(`packages/measurement-core/src/engine.rs:452`, `:807`); Android 그대로 전송(`.../measurement/live/FeatureUploader.kt:134`) | summary의 0부터 contiguous 계산(`backend/app/services/live_ingest_service.py:338`)을 완료 판정으로 사용 금지. SDD-260 후속 검증 사항으로 전달 |
| 폰 보고 정보 | 지속 대기량 API는 확인되지 않음. 그러나 종료 보고 경로는 이미 있음 | `backend/app/models/live_state.py:157` final_sequences, `backend/app/services/session_live_commands.py:348` 저장. `backend/app/models/biosignal.py:89` close intent·manifest도 존재. “서버는 받은 것만 안다”는 표현은 종료 보고 수신 전으로 한정 |
| 리포트 반영 | feature 입력은 맞지만 완결만으로 반영 가능 확정 불가 | `backend/app/services/class_report_stats_service.py:354` 시간 범위·품질 필터, `backend/app/services/report_scope.py:62` report_included 등 별도. 화면은 “리포트 입력 데이터 수신”으로 표기 |

## 2. 역할·권한 및 화면

현장 관리자는 **org_admin(자기 기관 클래스만) + platform_admin(전체, 기관 선택 필터 필수) + 해당 회차 담당 코치(session.host_id=본인)**로 확정한다(대표 결정 11/1). 기존 `class_role()`(`backend/app/services/class_access_service.py:26`)은 platform_admin 을 모르므로(→None→404) 신규 API 는 platform_admin 분기를 별도로 둔다. 보조 코치(assistant)·host 아닌 lead·다른 기관·client·탈퇴/비활성 사용자는 자동 공개하지 않는다. client는 기존 본인 안내만 사용한다.

### 권한 매트릭스(확정)

| 역할 | 판정 근거 | 목록(회차 선택) | 상세/집계 API |
|---|---|---|---|
| org_admin | `class_role()=='org_admin'`(활성 membership+활성 기관) | 자기 기관 클래스·회차만 | 200 (자기 기관) / 타 기관 404 |
| platform_admin | `user.role=='platform_admin'` 활성 사용자 | 기관 선택 필터 후 해당 기관 클래스·회차 | 200 (전체 기관) |
| 담당 코치 | counselor + 활성 membership + `session.host_id==actor.id` | 자기가 host 인 회차만 | 200 (그 회차만) |
| 비담당 코치(lead/assistant 포함) | host 아님 | 노출 안 함 | 403 `upload_status_forbidden` |
| 타 기관 org_admin/코치 | 기관 불일치 | 노출 안 함 | 404(존재 비공개) |
| client·게스트·미인증 | 해당 없음 | — | 403 / 401 |

- 403 수신 시 화면은 이전 이름·건수를 즉시 제거한다. 404는 클래스/회차 불일치·타 기관(존재 비공개)에 사용한다.

| 화면 | 진입·대상 | 보여 주는 것 |
|---|---|---|
| 설정 — 데이터 저장·업로드 현황 | counselor/org_admin 설정의 신규 링크 → `/settings/upload-status`. 권한 있는 클래스/회차 선택 | 선택 회차 전체 참여자 서버 수신 테이블. 상단 클래스 > 회차(담당 상담사) 유지. 모든 회차를 한 번에 집계하지 않음 |
| 코치 클래스 관리 — 참여자별 원데이터 업로드 현황 | `/classes/:classId/sessions/:sessionId/upload-status` 링크를 회차 목록에 배치. 같은 공유 테이블 | 해당 회차 고정. 참여자별 feature·EEG/PPG/ACC 원시 수신 상태. 설정과 동일 API/권한/용어 |

### 공통 테이블 계약

| 컬럼 | 정의 / 모바일 |
|---|---|
| 참여자 | 기존 멤버 `name ?? '이름 미확인'` 규칙(`frontend/src/components/class/structure/class-members-panel.tsx:27`), 회차 게스트는 기존 display_name 사용. 전화·이메일·생년월일 없음. 모바일 유지 |
| 수집 대상 | 수집 동의/수집 기록 기반 대상·미수집 동의·미착용 확인 불가. 현재 band_connected=false만으로 과거 미착용 확정 금지 |
| feature 수신 | 서버 저장 창 수, 내부 결측 수, “전체 대조 미확인”. 품질 유효성과 분리. 모바일 유지 |
| 원시 수신 | EEG/PPG/ACC 각각 uploaded / 서버 등록 total 건; 서버 등록 대기·실패 별도. 모바일 합계 및 상세 펼침 |
| 리포트 입력 | feature 있음/없음, report_included 선택/제외를 별도 표기. “생성 가능” 확정하지 않음 |
| 확인 상태 | 아래 우선순위로 표시. 모바일 유지 |
| 마지막 수신·조회 | feature.created_at / raw.uploaded_at의 최댓값과 응답 조회시각 분리. raw presign만 생성된 시각은 수신시각 아님 |
| 폰 대기량 | MVP “미보고”; 0건으로 치환 금지. 모바일 상세 |

- 검색: 참여자 이름(클라이언트 내 검색). 필터: 상태, 수집 대상, 리포트 선택 여부. 그룹: 확인 필요 / 그 외(기본), 또는 수집 대상. 정렬: 확인 필요 우선→이름→participant_id. 기본 전체 참여자, 검색 0건은 “조건에 맞는 참여자가 없어요”. 회차가 없으면 회차 선택 안내, 참여자 0명은 “등록된 참여자가 없어요”.
- 40명 전체를 한 번에 조회. 데스크톱 테이블, 모바일 핵심 열+행 상세. 기존 보라/흰색 토큰 및 ui 컴포넌트 사용. 원본·음성·리포트 PDF 다운로드 및 재전송 버튼 없음.
- **실시간 갱신(확정, §3-1)**: 진행 중 2~3초(기본 3초), 종료 후 완결 전 5~10초(7초), 완결·종료 30분 경과·오래된 회차 60초. 화면 상단에 “실시간 · N초 전 갱신” 표시와 정지/재개 버튼. 값이 바뀐 때만 본문 응답(ETag/304). 숨김 탭·오프라인은 중단, 복귀 즉시 조회. 실패 backoff 3→6→12→30→60초, 마지막 성공 데이터 유지하고 “조회 실패·마지막 확인 시각” 표시. 401 재로그인, 403 권한 안내 후 데이터 폐기, 404 회차 없음. 수동 버튼은 요청 진행 중 중복 금지. “마지막 조회”(화면이 서버에 물은 시각)와 “마지막 수신”(참여자 데이터가 서버에 도착한 시각)을 라벨로 구분한다.
- 관리자 브라우저 오프라인은 “인터넷 연결 후 다시 확인”. 참여자 폰 오프라인 여부는 MVP 알 수 없음. 마지막 수신이 오래됐다는 이유로 폰 오프라인·데이터 소실 확정 금지.

### 상태 규칙(위쪽 우선)

| 상태 | 서버 근거·표시 |
|---|---|
| 확인 필요 | raw failed > 0 또는 feature/raw 내부 결측 > 0. 등록 pending이 60초 이상이면 “서버 등록 후 대기” 사유로 포함. 원인/소실 여부는 미확정 |
| 수집 제외 | eeg_collection_consented=false이며 수신 기록 없음. consent_eeg(리포트 동의)로 대체 금지. 과거 수신 기록이 있으면 기록은 유지하고 현재 수집 제외 병기 |
| 미착용 | 명시적 미착용 증거가 있는 경우만. MVP에 과거 착용 이력 없음: 연결 false·0건만 있으면 “미수신 · 착용 여부 미확인”. 클래스 linkband_mode=none도 실제 기록이 있으면 숨기지 않음 |
| 등록 건 업로드 중 | raw 서버 등록 pending > 0, 60초 이내 |
| 수신 확인 · 전체 대조 미확인 | 수신 > 0이고 알려진 결측/실패 없음. 완료·100% 표현 금지 |
| 미수신 | 수집 대상이지만 수신 0; 초기·오프라인·미착용·미생성 중 무엇인지 확정하지 않음 |

## 3. 신규 서버 집계 API(설계, 미구현)

`GET /api/v1/classes/{class_id}/sessions/{session_id}/upload-status` — JWT 필수. 두 화면이 공유한다. query 없음, 단일 회차 전체 참여자(게스트·미착용·미수신 포함), 대기열은 별도 participation_status로 구분하고 수집 예상에서 제외한다. 잘못된 UUID 422, 미인증 401, 권한 없음 403, 없는 클래스/회차 또는 클래스-회차 불일치 404. 인증·범위 확인 후 집계한다.

권한은 위 권한 매트릭스를 따른다(org_admin 자기 기관 / platform_admin 전체 / 담당 코치 host 회차). 이름 최소 공개. 응답 `Cache-Control: no-store, private` + `ETag`; 로컬 영구 저장 금지.

```json
{
  "class_id": "uuid", "session_id": "uuid", "session_status": "in_progress",
  "as_of": "2026-11-04T05:10:00Z", "basis": "server_received",
  "participants": [{
    "participant_id": "uuid", "display_name": "참여자 예시", "participation_status": "active",
    "collection_state": "eligible", "band_connected": false,
    "report_included": true,
    "feature": {"received": 118, "legacy_count": 0, "internal_missing": 2,
      "expected": null, "expected_basis": "unknown", "completeness": "unknown",
      "last_received_at": "2026-11-04T05:09:58Z"},
    "raw": {"signals": [
      {"signal_type": "eeg", "registered": 12, "uploaded": 10, "pending": 1, "failed": 1,
       "internal_missing": 1, "oldest_pending_at": "2026-11-04T05:08:00Z"},
      {"signal_type": "ppg", "registered": 0, "uploaded": 0, "pending": 0, "failed": 0, "internal_missing": 0, "oldest_pending_at": null},
      {"signal_type": "acc", "registered": 0, "uploaded": 0, "pending": 0, "failed": 0, "internal_missing": 0, "oldest_pending_at": null}
    ], "last_received_at": "2026-11-04T05:09:55Z", "completeness": "unknown"},
    "phone_report": null,
    "status": "needs_attention", "reasons": ["feature_internal_gap", "raw_failed"]
  }]
}
```

- count는 비음수 정수, 날짜는 UTC ISO8601/null. status: needs_attention / excluded / uploading / received_unreconciled / no_data. collection_state: eligible / excluded / unknown. participation_status는 기존 참여 상태를 명시적으로 매핑한다. raw pending은 uploaded/failed 외 등록 행으로 기존 summary와 맞추고 실패 사유를 숨기지 않는다.
- internal_missing은 앞/뒤/미보고 stream의 누락을 포함하지 않는다. feature는 (session,participant,play_group_id), raw는 (session,participant,signal_type,stream_id,segment_id)별 distinct index 사이 `max(curr-prev-1,0)`의 합이다. NULL play_group은 legacy_count에만 포함한다.
- 현행 1-based 코어의 시작 1·최종 sequence F·재시작 없음이 입증되면 기대 집합 1..F, 기대 수 F다. 0-based 구버전이면 0..F, F+1이다. stream별 계산 후 합산한다. 종료 미보고·원점 불명·기본값 0·재시작 범위 불명이면 expected=null. MVP는 전부 null로 고정하고 종료 보고 활용은 후속으로 분리한다. 세션 길이÷5초, ÷1초 또는 최대 sequence만으로 완료 분모를 계산하지 않는다.
- raw는 10초 또는 크기 상한에서 seal하고 종료 시 flush하므로 길이÷10초로 기대 수를 정하지 않는다(Android `.../measurement/archive/RawChunker.kt:94`, `:208`). 후속은 close intent의 기대 alias 집합과 비교한다. 등록 10/10을 전체 생성 데이터 100%로 표시하지 않는다.
- DB: 권한 일괄 확인→참여자+이름 일괄 조회→feature GROUP BY/LAG 집계→raw GROUP BY/LAG 집계. 기존 summary를 인원수만큼 호출하지 않는다. feature/raw 원본을 직접 JOIN해 행이 곱해지지 않게 각각 집계 후 참여자별 LEFT JOIN한다. 0건 참여자도 유지한다. S3 HEAD/GET, alias 5000개, receipt_hash 재계산은 하지 않는다.
- 인원수와 무관하게 SQL 최대 8회(전체 본문 계산 시), 304 경로는 최대 2회(권한 1 + revision 1)를 목표로 한다. 40명×1시간×1초 feature와 3신호 raw 합성 데이터에서 p95<1초 목표(미측정). 한 응답은 read-only REPEATABLE READ 트랜잭션으로 일관된 스냅샷을 읽고 as_of는 시작 시각이다.
- 기존 인덱스 우선: `uq_eeg_feature_window`, `ix_eeg_feature_window_batch_key`, `ix_eeg_feature_window_participant_created` (`backend/app/models/eeg_feature.py:22`), `uq_eeg_raw_chunk_v2`, `ix_eeg_raw_chunk_signal` (`backend/app/models/record.py:126`). 참여자 session_id 복합 유일 제약도 있다. EXPLAIN ANALYZE로 확인하며 MVP는 마이그레이션 없다. 목표 초과 시에만 (session_id,participant_id,upload_status,created_at) 등을 후속 검토하며 무검증 인덱스를 동결 직전 추가하지 않는다.

### 3-1. 실시간 갱신 설계(확정)

**결정: 폴링 + revision(ETag) 방식으로 확정. 소켓 push 는 후속(11/4 이후).**

| 항목 | 폴링+ETag (채택) | 소켓 push (후속) |
|---|---|---|
| 서버 동결(11/2 22:00) 안전성 | 신규 REST 1개만. 수집 경로·소켓 무변경 | `/session-live` 에 구독 이벤트 추가: 수집 경로가 REST 배치(`features/batch`, raw ack)라 방송 훅을 수집 경로에 넣어야 함 → 수집 파이프라인 변경 위험 |
| 다중 워커 | 상태 없음(요청마다 DB) | 워커 간 방송에 Redis 매니저 의존, 호스트 room 은 라이브 소켓 join 한 호스트만 입장(`session_live_namespace.py:591`) — org_admin/platform_admin 는 observer/미입장이라 구독 경로 신설 필요 |
| 누락·순서 | 매 응답이 전체 스냅샷 → 누락 자체가 없음 | 이벤트 유실·순서 역전 시 별도 재동기화 필요 |
| 지연 | 2~3초 | <1초 |

- **revision 정의**: 회차 단위 경량 지문 = `(feature 행수, max(created_at), raw 행수, max(raw updated/uploaded_at), pending 수, 참여자 상태 해시)` 한 번의 집계 쿼리(인덱스 `ix_eeg_feature_window_participant_created`·`ix_eeg_raw_chunk_signal` 활용, 인원수 무관 1~2회)로 계산해 `ETag: W/"<hash>"` 로 반환. 클라이언트는 `If-None-Match` 를 보내고 일치하면 본문 계산 없이 `304`. 단, ETag 는 시각 필드(`as_of`, 상대 경과)를 제외한 내용 해시여야 한다.
- **상한 설계(SQL·p95)**: 304 경로 = 권한 확인 1 + revision 1 = 최대 2회, p95 < 150ms 목표. 200 경로 = 최대 8회, p95 < 1초 목표(미측정). 관리자 N명 × 3초 주기 → 304 비율이 높아 본문 계산은 값이 바뀐 때만. 동시 관리자 10명 가정 시 평균 3.3 req/s, 최악(모두 200) 일 때 8 SQL × 3.3 = 약 27 SQL/s. 기본 풀(20+20)을 점유하지 않도록 요청당 연결 보유 시간 < 100ms(304) 목표, 동일 (class, session) 응답은 서버 프로세스 내 1초 TTL 캐시로 관리자 수와 무관하게 초당 1회 계산으로 상한(캐시 키에 권한 결과를 섞지 않고, 권한 확인은 캐시 앞에서 수행).
- **주기 규칙**: 진행 중(`in_progress`) 3초 → 종료 직후 7초(완결 전: pending>0 또는 마지막 수신 후 90초 이내) → 완결(pending 0이며 마지막 수신 후 90초 경과)·종료 30분 경과 60초. 서버는 `Retry-After`/제안 주기를 응답 헤더 `X-Poll-Interval`(초)로 내려 클라이언트가 따른다(서버 부하 시 상향 가능).
- **탭 비활성/오프라인/403**: visibility hidden·`navigator.onLine=false` 중단, 복귀 즉시 1회 조회 후 주기 재개. 403 은 데이터 폐기·중단.
- **push 후속 조건**: 11/4 이후 수집 경로 변경 없이 `live_ingest_service` 커밋 후 outbox 이벤트를 소비하는 방식(기존 `session_live_outbox.py`)으로 `upload_status:changed`(revision 만 방송, 본문은 REST 재조회)를 구독 호스트에게 보내는 안을 별도 SDD 에서 검토한다.

## 4. 서버 수신과 폰 보고의 경계

| 정보 | MVP | 이후 확장 |
|---|---|---|
| feature DB 저장, raw uploaded ACK | 서버 수신 건수. 현재 S3 전체 객체 존재 재검증은 아님 | 필요 시 독립 감사 |
| raw pending | 서버에 presign 등으로 등록된 미완료 건수 | 폰 미송신분과 혼합 금지 |
| 지속적인 폰 outbox/격리/재시도 잔량 | 미보고/null | 신규 인증 POST `/sessions/{id}/upload-status-reports` 필요. stream+단말 실행 ID+단조 report_revision으로 역순 덮어쓰기 방지. 본인만 보고, 서버 수신시각/단말 보고시각/60초 신선도, feature/raw pending·rejected 등. 서버 저장 및 송신 앱 변경이 필요하여 MVP 제외 |
| 종료 기대 집합·최종 sequence | 기존 경로는 있으나 본 화면에서 미사용 | capture.close / biosignal events / manifest 재사용 검증. manifest complete는 raw/artifact 기대 집합 기준이며 eeg_feature_windows 완전성과 별개 |

신규 API만 만들어도 동결 앱은 지속 대기량을 보내지 않는다. PC가 폰 JS 이벤트를 읽을 수도 없다. 지속 보고 경로는 신설이 필요하지만 11/4 이후로 분리한다. 목표인 100% 저장 확인은 기존 폰 종료 대조와 현장 확인을 병행해야 하며, 본 화면은 완료를 보증하지 않는다.

## 5. 모바일·앱 노출, 일정·릴리즈 경계

| 경로 | 내용 | 앱 재빌드 |
|---|---|---|
| 모바일 브라우저(반응형) | 배포된 웹 번들. 390px: 요약 + 문제 참여자 우선 목록(시안 03), 전체 스크롤 가능. 데스크톱 1024px+: 전체 표 | 불필요(웹 정적 자산+BE 배포) |
| 앱(Capacitor WebView) | `capacitor.config.ts` 는 `webDir: dist`, `server.url` 없음 → **웹 번들이 앱에 내장**. 앱 내 `/settings`(`App.tsx:342` RoleGuard)·`/classes/:id/sessions`는 이미 같은 라우터로 열리며 신규 라우트·링크가 번들에 포함돼야 노출 | 필요(FE 번들 포함 빌드) |

- **동결 영향**: 앱·웹번들 동결 11/2 12:00 → 앱 안에서 보려면 FE 를 그 전에 develop 에 머지해야 한다. 12:00 이후 머지된 FE 는 **브라우저(모바일/PC)에서만** 보이고, 설치된 앱에는 반영되지 않는다. 서버 동결 11/2 22:00 은 BE.
- 진입 경로: ① 설정 화면 링크 `/settings/upload-status`(counselor/org_admin/platform_admin 에게만 표시) ② 클래스 관리 > 회차 목록의 회차별 링크. 앱·모바일 하단 내비/드로어에서 설정으로 갈 수 있는지는 구현 착수 시 첫 확인 항목(§7).
- platform_admin 은 `PlatformAdminRoute`(`App.tsx:137`) 계열 가드로 `/admin/upload-status` 별도 라우트를 두고(기관 선택 필터 포함) 같은 테이블 컴포넌트를 재사용한다.

| 시기 | 대상 |
|---|---|
| 11/4 이전 MVP | 2~3개 진입점·공유 테이블, 단일 회차 BE 집계+ETag, 권한·건수·내부 결측·실시간 표시. 기존 수집 로직 변경 없음 |
| 11/4 이후 | 폰 지속 보고, 종료 보고 기반 기대 집합 대조, 착용 이력 기반 미착용, 소켓 push, 여러 회차 종합 |

현장 URL/실제 배포 캐시는 미검증이다. 승인과 실브라우저 검증이 늦어지면 동결을 지키고 연기한다. 배포는 별도 승인 대상이다.

## 6. 확정 사항(대표 결정 11/1 + 위임 판단)

| # | 확정 | 근거 |
|---|---|---|
| 1 | 현장 관리자 = org_admin(자기 기관) + platform_admin(전체, 기관 선택) + 해당 회차 담당 코치. 그 외 403/404 | 대표 결정, `class_access_service.py` 로 매트릭스 확인 |
| 2 | 모바일 반응형 + 앱 WebView 노출. 앱 노출은 FE 를 11/2 12:00 전 develop 에 넣어야 함 | 대표 결정, `capacitor.config.ts` webDir=dist |
| 3 | 폴링+ETag 로 2~3초 실시간. push 는 11/4 이후 | 대표 결정 + 서버 동결 안전성(§3-1) |
| 4 | MVP 는 미수신 후보 탐지. 100% 완료·리포트 생성 보증 안 함, 기대 수 null | 위임 판단, §3·§4 |
| 5 | 설정·클래스 관리·(platform_admin) 관리자 진입은 동일 테이블 공유 | 위임 판단 |
| 6 | 11/2 동결 전 권한·실화면·40명 부하 검증 미통과 시 연기 | 위임 판단 |

남은 비즈니스 결정: **없음.**

## 7. 구현 착수 시 첫 확인 항목(현 코드로 확정 불가)

1. 앱(WebView) 하단 내비/드로어에서 `/settings` 로 가는 경로와 org_admin/counselor 노출 여부(`BottomTabBar.tsx`, `MobileDrawer.tsx`).
2. platform_admin 이 `RoleGuard` 의 `/settings`·`/classes/:id` 라우트를 통과하는지(현재 `role={['counselor','org_admin']}`).
3. 실DB feature 시작 sequence 분포(0 또는 1), legacy NULL play_group 비율.
4. 2초 간격 폴링 시 nginx/ALB 타임아웃·로그 볼륨, 서버 프로세스(워커) 수 → 1초 TTL 캐시가 프로세스별임을 감안한 부하.
5. 읽기 전용 REPEATABLE READ 트랜잭션이 기존 `get_db` 세션과 충돌하지 않는지.
6. 배포 캐시(index.html 캐시 헤더)로 현장 브라우저가 신규 번들을 받는지.
7. 미확인(실측 필요): 실기기 종료 이벤트 도달, S3 객체, 40명 부하, 네트워크 단절 시 실제 저장.
