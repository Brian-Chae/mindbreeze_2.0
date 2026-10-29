# Verify (구현 전 QA 체크리스트)

| # | 시나리오 | 기대 | 검증 |
|---|---|---|---|
| V1 | ACC 패킷 30샘플/1.1556s(26Hz)로 10초↑ 입력 | 헤더 observed_rate≈26/1, window_us>0, rate 는 30/1 유지 | Android JVM RawChunkerTest |
| V2 | tick 이 없거나 구간 <1초 | observed_rate null, reason not_measured | JVM |
| V3 | 서버: observed_rate 있는 ACC 청크 presign | end_ms = 실측 rate 기준(702s 아님) | pytest |
| V4 | 서버: observed_rate 없는 청크 | 기존 명목 rate 와 동일 | 기존 pytest 회귀 |
| V5 | 네이티브 stop 후 close intent 생성 | expected=queue 의 raw·feature alias/sha, streams=(signal,segment) last_chunk/received_samples, last_feature_sequence=null | JVM CloseIntentTest |
| V6 | intent 파일 영속·재생성 안 함(같은 intent_id) | 재시작 후 동일 내용 | JVM |
| V7 | 전송 성공/duplicate/conflict → sent, 네트워크 실패 → 미sent 유지 | | JVM(ArchiveUploader MockWebServer 또는 fake http) |
| V8 | 서버: 2개 intent(네이티브 raw+feature / JS indices+norm) → 합집합 평가 | 모든 산출물 uploaded 이면 close_state=complete | pytest |
| V9 | 서버: 단일 intent 기존 동작 | 변화 없음 | 기존 test_sdd244_manifest |
| V10 | JS: close 진행 중 unmount | 전송 호출이 수행됨, 예외 없음 | vitest |
| V11 | tsc / eslint / 전체 vitest·pytest 영향 파일 | green | CI |
