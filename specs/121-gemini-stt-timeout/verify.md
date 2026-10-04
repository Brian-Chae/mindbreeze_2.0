# [SDD-121] — Verification (원인분석 + Pre-Implementation)

## 원인 분석
E2E 클래스 테스트 4에서 `[stt_task] Gemini transcribe failed, Whisper fallback: The read operation timed out` 발생.

- `stt_task.py:148` — Gemini `generateContent` 호출 `timeout=180`초.
- 4.3분(52청크) 오디오를 base64 `inline_data`로 **단일 요청**에 통째로 전송 → Gemini가 180초 내 응답 못 함.
- 이후 Whisper 폴백이 `OPENAI_API_KEY=***`(플레이스홀더)로 401 → STT 전체 실패 → 리포트 실패.

**근본 원인**: (1) 타임아웃 180초가 긴 오디오에 너무 짧음, (2) 긴 오디오를 단일 요청으로 보내 크기/시간이 과도.

## 수정 방안 (채택)
1. 타임아웃 `180→300`초 증액.
2. 긴 오디오(>90초)는 **세그먼트 분할 전사** — 청크를 배치로 나눠 각각 Gemini 요청, 타임스탬프 오프셋 누적 병합.

## Test Scenarios

### TS1: 긴 오디오 분할 병합
1. 300초 오디오(60청크) → 4개 세그먼트(90초 단위)로 분할.
2. 각 세그먼트 전사 후 오프셋(0/75/150/225초) 누적.
- **Expected:** 8개 세그먼트의 start가 `[0, 6, 75, 81, 150, 156, 225, 231]`로 병합. (검증 통과)

### TS2: 짧은 오디오 단일 요청 (분할 없음)
- **Expected:** 90초 이하 오디오는 기존처럼 단일 요청(300초 타임아웃).

### TS3: 기존 테스트 회귀
- **Expected:** `_call_gemini_transcribe` 3번째 인자 추가로 인한 monkeypatch 깨짐 → 2개 테스트 파일 fake 시그니처 갱신 후 `985 passed`.

## Edge Cases
- [ ] `audio_duration_sec` 없을 때 → 청크당 5초 근사로 분할 판정
- [ ] 단일 청크(분할 불가) → `len(chunk_paths) > 1` 가드로 단일 요청 유지
- [ ] Gemini 여전히 실패 시 → Whisper 폴백(현재 정상 동작)이 STT 보장

## Security Review
- [ ] 신규 코드는 STT 태스크 내부 — 서버 API/자격증명 변경 없음
- [ ] 세그먼트 분할은 동일 키·엔드포인트 재사용, 신규 권한 없음
