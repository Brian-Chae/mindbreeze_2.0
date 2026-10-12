# SDD-183 — 통합 검증(1축) 실결함 2건 수정

## 원인 분석

통합 검증(파이프라인 dry-run)에서 실서버 데이터로 파이프라인을 역추적해 발견.

| # | 결함 | 원인 |
|---|---|---|
| 1 | 녹음 미시작 세션 → session_record idle 영구 정지 | `finalize_on_session_end`가 record 없음/`idle`을 마감하지 않음 |
| 2 | Gemini 긴 한글 전사 응답 잘림 → Whisper 폴백 | `generationConfig`에 maxOutputTokens 미설정 |

## 수정

- `audio_service.py` finalize_on_session_end: record 없음→manual 생성, idle→manual 마감
- `stt_task.py` _transcribe_batch: maxOutputTokens 32768 명시

## 검증

- 신규 3건 + 백엔드 1379 passed / 12 skipped / 0 failed
