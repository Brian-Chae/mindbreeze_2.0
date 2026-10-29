# summary — 정상 종료 회차 정규화 업로드 대기·종료 기록 누락

## 원인 (dev 회차 100e581e, Android WebView + okhttp 네이티브 raw 경로)
1. normalization/algorithm 산출물만 `content_type: application/json` 으로 presign → 서버가 그 값을 SigV4 서명 →
   `putViaNativeHttp`(CapacitorHttp, dataType='file')가 PUT. Capacitor Android `CapacitorHttpUrlConnection.setRequestBody` 는
   Content-Type 이 json 이면 dataType 을 무시하고 base64 문자열을 UTF-8 로 써서 body SHA-256 이 서명과 달라진다 → PUT 거절 → ack 없음 → pending.
   (gzip 산출물·raw 는 octet-stream/gzip 이라 정상). 확인: artifacts presign 10회/ack 9회, S3 HeadObject 404, 최근 10일 normalization pending·failed 26건.
   iOS(iPhone UA) 회차의 normalization 은 uploaded.
2. 종료 기록: close intent 는 `useBand.disconnect()` 에서만 생성 → 호스트가 회차를 끝내면 회원은 해제 없이 떠나 intent 0건(manifest unknown),
   capture_stream 은 서버 cutoff 로 ended 가 되지만 closed_at 은 클라이언트 capture.close 또는 24h sweep 이 있어야 채워졌다.

## 수정
- BE `biosignal_artifact_service.py`: 산출물 PUT 서명 Content-Type 을 항상 octet-stream 으로 고정 (기존 설치 앱도 재빌드 없이 복구).
- FE `display-snapshot.ts`, `feature-collector.ts`: normalization/algorithm content_type=octet-stream.
- FE `useCloseBiosignalOnEnd`(신규) + `MemberClassContainer`/`useBand.closeBiosignal`: 회차 phase=ended 에서 close intent 1회 기록·전송.
- BE `biosignal_orphan_sweep.close_expired_ended_streams`: cutoff 후 30분 안에 close 가 없으면 closed_at 기록(reason `session_ended_no_client_close`). 24h 경로·#171 고아 정리 유지.

## 테스트
- pytest: `test_sdd244_artifacts.py`(신규 1건, 수정 전 실패 확인), `sdd246/archive/test_orphan_sweep_pg.py`(신규 1건, 수정 전 실패 확인) 포함 sdd244/sdd246 349건 통과.
- vitest: 신규 4건(수정 전 content-type 2건 실패 확인) + sdd244·class-player-member 관련 통과. 전체 실행의 실패 8개 파일은 develop 기준선과 동일(무관).
- tsc(tsconfig.app) 0 오류, eslint 변경 파일 0 오류.

## 앱 재빌드
- 네이티브(Android/iOS) 코드 변경 없음. 서버 수정만으로 normalization 업로드 복구, 웹 번들 재배포로 종료 close 반영. 앱 재빌드 불필요.

## 한계
- Android 네이티브 PUT 본문 손상은 Capacitor 소스와 로그 정황으로 확정했고, 실기기 재현은 배포 후 dev 회차에서 확인 필요.
- 이미 pending 인 과거 회차는 #171 sweep 이 failed(abandoned_orphan) 처리하며, 늦게 재전송되면 complete 로 복구된다.
