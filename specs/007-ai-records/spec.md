# Spec 007 — AI 자동 기록 (F7)

## 개요
세션 음성을 청크 단위로 녹음·업로드하고, 세션 종료 시 STT + 화자 분리 + LLM 요약 파이프라인을 비동기로 실행하여 AI 기록지를 자동 생성한다.

## 범위
- F7.1 녹음 시작/종료 (P0)
- F7.2 STT + 화자 분리 (P0)
- F7.3 AI 기록지 생성·편집 (P0)
- F7.4 마커 (P1, F5에서 일부 구현)

## API
| Method | Path | 설명 |
|---|---|---|
| POST | /sessions/{id}/audio/start | 녹음 시작 (consent_audio 검증) |
| POST | /sessions/{id}/audio/chunk | 청크 업로드 (multipart) |
| POST | /sessions/{id}/audio/stop | 녹음 종료 → STT/요약 태스크 큐잉 |
| GET | /sessions/{id}/record | AI 기록지 조회 |
| PUT | /sessions/{id}/record | 기록지 편집 (편집 이력 누적) |
| GET | /sessions/{id}/transcript | STT 전사문 조회 |

## QA 체크리스트
1. 동의 없이 녹음 시작 → 400
2. host가 아닌 사용자 녹음 시작 → 403
3. 비로그인 → 401
4. 청크 업로드 성공 → 200, chunk_index 누적
5. stop 호출 시 SessionRecord.status = processing
6. processing 완료 시 transcript/summary 채워짐 (stub 동기 실행)
7. 기록지 편집 → is_edited=true, edit_history 누적
8. 존재하지 않는 세션 → 404
9. transcript 미생성 상태 조회 → 빈 결과
10. 세션 종료(/end) 호출 시 자동으로 STT 트리거

## 데이터 모델 변경
- SessionRecord: 컬럼 추가 `status` (idle/recording/processing/completed/failed), `audio_s3_key`, `recording_started_at`, `recording_ended_at`
- 신규: AudioChunk(id, session_id, chunk_index, file_path, size_bytes, created_at)
