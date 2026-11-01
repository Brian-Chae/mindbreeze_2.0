# SDD-261 — 데이터 저장·업로드 현황 화면

- 상태: Stage ① 기획안 완성 / 감독 승인 대기. 구현·verify 작성 전.
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

현장 관리자는 **해당 기관의 활성 org_admin 또는 해당 회차 담당 counselor**로 MVP 확정 제안한다. 전체 기관 counselor, 클래스 보조 코치에게 자동 공개하지 않는다. 기존 클래스 접근은 `backend/app/services/class_access_service.py:31`의 기관 멤버십·강사 역할 검사를 따른다. 플랫폼 운영자의 일괄 조회는 MVP 제외. client는 기존 본인 안내만 사용한다.

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
- 가시 탭에서 진행 회차 10초, 종료 회차 30초 자동 새로고침. 수동 버튼, 진행 요청 중 중복 금지. 숨김 탭/브라우저 오프라인 중단, 복귀 즉시 조회. 실패 10→20→40→60초 backoff, 마지막 성공 데이터 유지하고 “조회 실패·마지막 확인 시각” 표시. 401 재로그인, 403 권한 안내 후 데이터 폐기, 404 회차 없음.
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

권한은 활성 사용자 + 활성 기관 멤버십 + (동일 기관 org_admin 또는 counselor이면서 session.host_id=본인 및 해당 클래스 접근 가능). client/입장 자격/타 기관/탈퇴 사용자/단순 assistant 거절. 이름 최소 공개. 응답 `Cache-Control: no-store`; 로컬 영구 저장 금지.

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
- 인원수와 무관하게 SQL 최대 8회를 목표로 한다. 40명×1시간×1초 feature와 3신호 raw 합성 데이터에서 p95<1초 목표(미측정). 한 응답은 read-only REPEATABLE READ 트랜잭션으로 일관된 스냅샷을 읽고 as_of는 시작 시각이다.
- 기존 인덱스 우선: `uq_eeg_feature_window`, `ix_eeg_feature_window_batch_key`, `ix_eeg_feature_window_participant_created` (`backend/app/models/eeg_feature.py:22`), `uq_eeg_raw_chunk_v2`, `ix_eeg_raw_chunk_signal` (`backend/app/models/record.py:126`). 참여자 session_id 복합 유일 제약도 있다. EXPLAIN ANALYZE로 확인하며 MVP는 마이그레이션 없다. 목표 초과 시에만 (session_id,participant_id,upload_status,created_at) 등을 후속 검토하며 무검증 인덱스를 동결 직전 추가하지 않는다.

## 4. 서버 수신과 폰 보고의 경계

| 정보 | MVP | 이후 확장 |
|---|---|---|
| feature DB 저장, raw uploaded ACK | 서버 수신 건수. 현재 S3 전체 객체 존재 재검증은 아님 | 필요 시 독립 감사 |
| raw pending | 서버에 presign 등으로 등록된 미완료 건수 | 폰 미송신분과 혼합 금지 |
| 지속적인 폰 outbox/격리/재시도 잔량 | 미보고/null | 신규 인증 POST `/sessions/{id}/upload-status-reports` 필요. stream+단말 실행 ID+단조 report_revision으로 역순 덮어쓰기 방지. 본인만 보고, 서버 수신시각/단말 보고시각/60초 신선도, feature/raw pending·rejected 등. 서버 저장 및 송신 앱 변경이 필요하여 MVP 제외 |
| 종료 기대 집합·최종 sequence | 기존 경로는 있으나 본 화면에서 미사용 | capture.close / biosignal events / manifest 재사용 검증. manifest complete는 raw/artifact 기대 집합 기준이며 eeg_feature_windows 완전성과 별개 |

신규 API만 만들어도 동결 앱은 지속 대기량을 보내지 않는다. PC가 폰 JS 이벤트를 읽을 수도 없다. 지속 보고 경로는 신설이 필요하지만 11/4 이후로 분리한다. 목표인 100% 저장 확인은 기존 폰 종료 대조와 현장 확인을 병행해야 하며, 본 화면은 완료를 보증하지 않는다.

## 5. 일정·릴리즈 경계

| 시기 | 대상 |
|---|---|
| 11/4 이전 MVP | PC/모바일 브라우저의 2개 진입점·공유 테이블, 단일 회차 BE 집계, 권한·건수·내부 결측·조회 신선도. 기존 앱 변경 없음 |
| 11/4 이후 | 폰 지속 보고, 기존 종료 보고 기반 기대 집합 대조, 착용 이력 기반 미착용 판정, 원데이터 완전성 감사, 여러 회차 종합 현황, platform_admin 조회 |

`frontend/capacitor.config.ts:6`은 webDir=dist이고 server.url이 없다. 설치 앱의 내장 화면은 서버 업데이트로 바뀌지 않는다. 반면 `.github/workflows/deploy-dev.yml:208`은 빌드 dist를 nginx 루트로 배치하므로 **Web 정적 자산+BE 배포**로 브라우저 경로를 반영할 수 있다. BE만 재시작해서는 화면이 추가되지 않는다. 현장 URL/실제 배포 캐시는 미검증이다. 11/2 12:00 앱 동결, 22:00 서버 동결. 승인과 실브라우저 검증이 늦어지면 동결을 지키고 MVP를 연기한다. 배포는 별도 승인 대상이다.

## 6. 대표 결정 사항(5개, 승인 검토용)

1. 현장 관리자는 동일 기관 org_admin 또는 해당 회차 담당 코치이며 브라우저를 사용한다.
2. MVP는 미수신 후보를 찾는다. 100% 완료·리포트 생성 가능을 보증하지 않는다.
3. 11/4 이전은 Web+BE만, 폰 보고와 완전성 대조는 이후로 분리한다.
4. 설정과 클래스 관리는 동일 회차별 테이블을 공유하고 feature/원데이터를 분리한다.
5. 11/2 동결 전 권한·실화면·40명 부하 검증이 안 되면 연기한다.

미확인: 실기기 및 배포 앱의 종료 이벤트 도달, 실DB 시작 sequence 분포, S3 객체, 배포 URL과 현장 사용자 권한, 40명 부하, 네트워크 단절 시 실제 저장. 코드 확인을 실동작 증거로 간주하지 않는다. verify.md는 감독 승인 후 구현 전에 별도 작성한다.
