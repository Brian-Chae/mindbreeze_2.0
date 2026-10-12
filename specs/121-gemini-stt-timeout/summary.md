# [SDD-121] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/tasks/stt_task.py` | Gemini 타임아웃 180→300초 + `_transcribe_batch`/`_call_gemini_transcribe` 분리, 긴 오디오(>90초) 세그먼트 분할 전사 + 타임스탬프 오프셋 누적 병합 |
| `backend/tests/test_sdd095_report_progress.py` | monkeypatch fake 시그니처에 `audio_duration_sec=None` 추가 |
| `backend/tests/test_audio_record.py` | 동일 fake 시그니처 갱신 |

## Test Results
- ✅ TS1: 300초 오디오 → 4개 세그먼트 오프셋 병합 정상 (`[0,6,75,81,150,156,225,231]`)
- ✅ TS2: 짧은 오디오 단일 요청 유지
- ✅ TS3: backend pytest **985 passed, 12 skipped** (회귀 없음)

## Debugging Journey
- `_call_gemini_transcribe`에 `audio_duration_sec` 3번째 인자 추가 → 기존 monkeypatch(2인자)가 `TypeError` 발생 → 2개 테스트 파일의 fake 시그니처 갱신으로 해결.

## Notes for Reviewer
- Whisper 폴백은 SDD-120 배포 시점에 OPENAI_API_KEY가 정상 키로 교체되어 이미 동작. Gemini는 이제 긴 오디오도 분할 처리.
- 실기기 Gemini 왕복은 API 키·네트워크에 따라 다르므로 실 세션으로 검증 권장.
