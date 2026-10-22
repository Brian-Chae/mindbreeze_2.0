# SDD-228 — 출시판 음성 받아쓰기(STT) 끄기

- 상태: Stage ①~⑥ 완료(로컬 커밋, 푸시 전)
- 브랜치: `sdd/228-disable-class-stt`
- 작성일: 2026-10-22

## 1. 배경·목적
- 클래스/상담 종료 후 음성 STT(전사·화자분리·전사 기반 요약) 때문에 리포트까지 시간이 매우 오래 걸린다.
- 출시판은 영상·음성 저장과 리플레이는 제공하되 STT 스크립트는 제공하지 않는다(비용·테스트 부족).
- 출시 후 별도 기능으로 다시 켤 수 있어야 한다 → 코드 삭제 없이 **설정 스위치**로 끈다.

## 2. 범위
- 상담 세션과 클래스 모두 같은 스위치를 따른다.
- 포함: 백엔드 STT 전용 스위치, 종료 체인에서 STT·요약 제외, 큐 잔여 작업 skip, 리포트 사유값(`stt_disabled`), 진행 스텝퍼·안내 문구 숨김.
- 제외: 녹음·영상 저장/재생, EEG 리포트, 리포트 AI 초안(Gemini) 등 STT 외 AI, DB 마이그레이션(없음).

## 3. 요구사항
| ID | 내용 |
|---|---|
| R1 | `stt_enabled`(기본 False). `is_stt_enabled() = ai_features_enabled AND stt_enabled`. |
| R2 | off: 종료 체인에 `tasks.stt`/`tasks.summary` 미발행, 영상 병합·리포트 생성은 유지. 녹음 청크 보존, record `completed` 마감. |
| R3 | off: Gemini Audio·Whisper·요약 외부 호출 0건(큐 잔여 작업도 skip, 재시도 0). |
| R4 | off: 리포트는 전사 없이 바로 생성되고 `ai_record.reason=stt_disabled`(마이크 꺼짐 `mic_off`와 구분), 생성 상태 `ready`. |
| R5 | off: 진행 스텝 stt·summary = skipped, 워치독이 completed 기록을 failed 로 오탐하지 않음. |
| R6 | 화면: AI 공개여도 STT off 면 받아쓰기·요약 단계/문구/전사 영역 숨김. 영상 리플레이 유지. |
| R7 | on(`STT_ENABLED=true`, `VITE_STT_ENABLED=true`): 기존 동작 그대로(회귀 테스트). |

## 4. QA 체크리스트
| # | 시나리오 | 기대 |
|---|---|---|
| 1 | stt off, 세션 종료 | 청크 보존·record completed·STT transport 0 |
| 2 | stt off, 종료 체인 | video merge + report 만 |
| 3 | stt off, 큐 잔여 stt/summary | skip, 예외·재시도 없음 |
| 4 | stt off, 리포트 사유 | `stt_disabled`(마이크 오프는 `mic_off` 유지), ready |
| 5 | stt off, 진행 스텝 | stt/summary skipped |
| 6 | stt off, 워치독 | completed 기록 불변 |
| 7 | stt off, AI on, 스텝퍼 | 받아쓰기·AI 요약 단계 비노출 |
| 8 | stt on | 기존 체인 순서·사유·스텝 동작 |
