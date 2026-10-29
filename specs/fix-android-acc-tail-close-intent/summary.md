# Summary — 안드 착용 움직임 끝부분 누락·종료 기록 미전송

## 원인
- ACC 끝부분 "누락": 데이터 누락 아님. 청크 연속·종료 플러시 정상. ACC 실제 ≈26Hz인데 헤더/서버가 명목 30Hz로 시간 계산 → 811초가 702초로 표시(`RawChunker.kt` rate, `biosignal_service._time_ms`).
- close intent 0건: 네이티브(Android/iOS)에 biosignal-events 전송 코드 없음. JS 훅은 화면 unmount와 경합(rt.active false·lease 반납)해 전송 누락. 서버는 최신 intent 1건만 평가해 JS·네이티브 intent 병합 불가.

## 수정
- 서버: close intent 합집합 평가(`_merged_intent`), observed_rate 우선 시간축, data_center raw_samples는 sample_count 우선.
- Android: RawChunker가 ACC 실측 rate 기록, CloseIntentStore(종료 시 디스크 저장→drain 후/WorkManager 전송, 12회 상한).
- JS: close가 진행 중이면 unmount cleanup이 대기, pump(rt)로 force 전송.

## 테스트
- Android JVM: RawChunker 10, CloseIntent 6, ArchiveUploader 12 통과
- pytest(sdd244/243/246/data_center/orphan/252/research_export): 597 passed
- vitest: 신규 회귀 포함 통과; 전체 중 17건 실패는 baseline(main 동일)에도 존재하는 기존 실패 8파일
- tsc 통과. eslint: sdd244-capture-hook.test.tsx 기존 `latest` 재할당 오류(미변경 줄)
