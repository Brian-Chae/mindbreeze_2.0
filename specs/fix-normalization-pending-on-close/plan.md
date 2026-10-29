# [Fix] 정상 종료 회차 정규화 업로드 대기·종료 기록 누락 — 원인분석·계획

## 증상 (dev 회차 100e581e, 10/29 09:07~09:09 KST)
- 원시 청크·feature·indices 모두 uploaded, normalization 1건만 upload_status=pending
- capture_stream status=ended 이나 closed_at NULL, biosignal_close_intents 0건 → manifest close_state=unknown

## 원인
1. **normalization/algorithm PUT 실패 (Android 앱)** — `frontend/src/lib/biosignal/display-snapshot.ts`(normalization), `feature-collector.ts`(algorithm)가
   `content_type:'application/json'` 으로 presign → 서버가 그 Content-Type 을 SigV4 서명 → `putViaNativeHttp`(`lib/api/eeg-raw.ts`)가 CapacitorHttp(`dataType:'file'`)로 PUT.
   Capacitor Android `CapacitorHttpUrlConnection.setRequestBody` 는 Content-Type 에 `application/json` 이 있으면 `dataType` 을 무시하고 base64 문자열을 UTF-8 로 쓴다
   → body 의 SHA-256 ≠ 서명 헤더 → S3 거절(4xx) → 클라이언트 quarantine(dead_letter), ack 없음. gzip 산출물(feature/indices)과 raw(octet-stream)는 영향 없음.
   근거: dev 로그에서 artifacts/presign 10회 vs ack 9회(normalization 만 ack 없음), S3 HeadObject 404, 최근 10일 normalization pending/failed 26건 모두 Android WebView 회차.
2. **종료 기록 누락** — close intent 는 `useBand.disconnect()`(명시 밴드 해제)에서만 만들어진다. 호스트가 회차를 종료하면 회원 화면은 해제 없이 떠나므로
   close intent 가 없다(manifest unknown). capture_stream 은 서버 cutoff 로 `ended` 가 되지만 `closed_at` 은 클라이언트 `capture.close` 나 24h sweep 으로만 채워진다.
   (RENEW_FATAL 'session_ended' 로 halt 한 클라이언트는 close 를 보내지 않는다.)

## 수정
- BE `biosignal_artifact_service.presign`: 산출물 PUT Content-Type 을 항상 `application/octet-stream` 으로 서명(클라이언트 값 무시) → 이미 설치된 앱도 앱 재빌드 없이 복구.
- FE: normalization/algorithm content_type 을 octet-stream 으로 변경(서버 값과 일치).
- FE: 회차 종료(v2 phase=ended) 감지 시 `biosignal.close('session_ended')` 호출(useBand 가 `closeBiosignal` 노출, MemberClassContainer 에서 호출).
- BE `biosignal_orphan_sweep.close_expired_ended_streams`: cutoff 후 짧은 유예(30분) 안에 클라이언트 close 가 없으면 closed_at 기록(reason=session_ended_no_client_close). 24h 경로·#171 고아 정리는 유지.
- 앱 네이티브 변경 없음. 웹 번들 재배포로 FE 반영, 서버 수정만으로도 normalization 업로드는 복구.
