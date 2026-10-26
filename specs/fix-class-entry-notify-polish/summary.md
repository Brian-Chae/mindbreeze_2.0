# 요약

## 1. 입장 설문 자동 다음
- 원인: 보기 선택 후 '다음' 버튼을 눌러야만 이동. 수정: `useEntrySurvey` 에 auto 이동(300ms). EntryPage 한 곳이 이 훅을 쓰므로 웹·앱 경로 공통 적용.
- 시험: `tests/use-entry-survey.test.tsx` 6건. 수정 전 4 fail → 수정 후 6 pass. 기존 `class-flow-member-survey` 1건은 새 인자(auto=true)에 맞게 갱신.

## 2. 클래스 알림 중복 — 재현 표 (PG, `tests/pg/test_fix_class_invite_notify.py`)
| 경로 | 만들어진 effect | 수정 전 회원 알림 | 수정 후 |
|---|---|---|---|
| 즉석 + 회원 1 | class_invited, class_member_joined(lead용), session_host_assigned(진행자용), session_prepare(시스템) | "클래스 초대" 1건 + push | 동일(1건) |
| 예약(2회차) + 회원 1 | 위 + session_prepare ×2 | **"명상 클래스 안내 — 클래스의 변경 내용을 확인해 주세요"** 1건 (초대가 변경 문구로 나감) | "클래스 초대" 1건 |
- 결론: 단일 시험 DB 에서 회원 알림이 2건이 되는 경로는 재현되지 않았다. 확인된 결함은 (a) 예약 클래스 초대가 '변경 안내' 문구로 나가는 것, (b) 일정 변경·회차 추가·진행자 변경·종료 등 모든 effect 가 같은 모호 문구를 쓰는 것. 같이 온다는 제보는 즉석 초대(클래스 초대 push) 후 같은 클래스의 다른 effect(회차 추가·일정 변경, 예: 초대 뒤 회차 추가)가 '변경 내용' 문구로 나간 경우로 추정(미재현, 후보).
- 수정: effect 종류별 구체 문구(`_MESSAGES`). 초대=클래스 초대, 일정 변경=회차 일시 변경, 진행자 변경 등. 생성·초대 시 변경 알림은 만들지 않음(원래 만들지 않았고 시험으로 고정). 시작·종료·리포트 로직 불변.
- 기존 `test_sdd223_live_invite` 가 버그 문구를 정답으로 고정하고 있어 "클래스 초대"로 갱신.
- pytest(PG) 90 passed.

## 3. 종료 시 Failed to fetch
- 원인 추정(서버 로그 정상 → 클라이언트 쪽): 종료 후 화면 전환 중 이탈·언마운트로 끊긴 fetch 의 TypeError('Failed to fetch') 원문이 `setError(e.message)` 로 그대로 노출. 후보 지점: ClassPlayerPage(finishSession 등 6곳), useLiveKit·useMemberLiveKit(토큰 발급). 실제 브라우저 재현은 하지 못함(추정).
- 수정: `userErrorMessage` — AbortError·이탈 중 TypeError 는 미표시, 그 외 브라우저 네트워크 오류는 한국어 안내로 치환. useMemberLiveKit 은 언마운트 가드 추가.
- 시험: `tests/user-error.test.ts` 6건. 업로드 큐·재시도(upload-helper 등)는 이미 TypeError 를 재시도하므로 변경하지 않음.
- 미확정: 회원 EntryPage 의 폴링(useEntryState) 오류 경로는 TypeError→'offline' 분류로 이미 원문 비노출. 남은 후보가 있으면 실제 재현 후 보강.

## 검증
- tsc 0, eslint 오류 0(경고 2건은 기존). 전체 vitest: 수정 직후 9파일/18 fail(새 1건=위 survey 시험) → 시험 갱신 후 해당 파일 통과, 기준선 17 fail/8파일과 동일.
- verify.md 는 구현 도중 커밋됨(절차상 구현 전 커밋 규칙을 지키지 못했음).
