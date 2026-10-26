# SDD-228 Verify (QA 체크리스트)

> 주의: 본 문서는 구현과 같은 세션에서 spec 의 QA 표를 기준으로 정리됐다(Stage ③ 사전 게이트를 구현 전 분리 작성하지 못함 — 보고서에 명시).

| # | 항목 | 검증 방법 | 결과 |
|---|---|---|---|
| V1 | off: 종료 시 청크 보존·completed·transport 0 | test_off_종료시_녹음_보존… | ✅ |
| V2 | off: 체인=video merge+report | test_off_종료_체인은… | ✅ |
| V3 | off: 큐 잔여 skip, retry 0 | test_off_큐에_남은… | ✅ |
| V4 | off: 사유 stt_disabled, mic_off 구분, ready | test_off_리포트_사유…, test_off_진행스텝… | ✅ |
| V5 | off: 스텝 skipped | test_off_진행스텝… | ✅ |
| V6 | off: 워치독 오탐 없음 | test_off_워치독… | ✅ |
| V7 | AI on·STT off 스텝퍼 단계 숨김 | vitest sdd228 | ✅ |
| V8 | on 회귀(기존 STT/요약/진행 테스트) | 기존 pytest·vitest 전량 | 아래 summary 참조 |
| V9 | 외부 STT API 호출 0 | transport_spy 0 | ✅ |
