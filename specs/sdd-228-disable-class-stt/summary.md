# SDD-228 Summary

## 구현
- 백엔드 `STT_ENABLED`(기본 false) 추가. `is_stt_enabled() = ai_features_enabled AND stt_enabled` (backend/app/core/ai_features.py). 리포트 AI 초안 등 STT 외 AI 는 영향 없음.
- off 시: 종료 체인에서 stt·summary 제외(audio_service), 녹음 청크 보존·record `completed` 마감, 큐 잔여 stt/summary skip(retry 0), Gemini Audio·Whisper transport 직전 가드.
- 리포트: `ai_record.reason=stt_disabled`(마이크 꺼짐 `mic_off`와 구분), 진행 스텝 stt·summary skipped, 생성 상태 ready. 워치독은 completed 를 건드리지 않음.
- 프론트: `VITE_STT_ENABLED`(기본 비공개). AI 공개여도 STT off 면 스텝퍼의 받아쓰기·AI 요약 단계/문구 숨김, `stt_disabled` 안내 문구. 전사·기록지 영역은 기존 `ENABLE_STT_AI_RECORD`(false)에 새 플래그 AND. 영상 리플레이 불변.
- DB 마이그레이션 없음(reason 은 자유 문자열).

## 테스트
- pytest 전체(`tests`, pg 제외): 3385 passed, 12 skipped. 신규 `test_sdd228_stt_switch.py` 11건 포함.
- vitest 전체: 2458 passed, 12 failed — 12건은 변경 전(stash)에도 동일하게 실패하는 기존 실패(agent-counselor-page, chat-message-deeplink, font-scale, org-*browser, report-*pdf). 신규 sdd228 3건 통과.
- `npx tsc --noEmit` 통과.

## 디버깅·한계
- 이 워크트리에는 node_modules 가 없어 메인 체크아웃 것을 심링크로 사용(gitignore 대상, 커밋 제외).
- Stage ③ Verify 를 구현 전 분리 작성하지 못하고 구현과 함께 정리함(규칙 예외, 보고 필요).
- 기존 on 계약 테스트는 conftest/vitest 환경값(`stt_enabled=True`, `VITE_STT_ENABLED=true`)만 주입, 단언 불변.

## 재활성화
서버 `STT_ENABLED=true`(+ `AI_FEATURES_ENABLED=true`, Gemini/OpenAI 키), 프론트 `VITE_STT_ENABLED=true`(+ `VITE_AI_ENABLED=true`)로 재배포. 전사 탭/기록지는 `ENABLE_STT_AI_RECORD` 상수도 true 로 바꿔야 노출된다.
