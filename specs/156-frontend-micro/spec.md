# SDD-156 — 프론트 마이크로 (6건)

## 배경

기능 오류 전수조사 하(하) 17건 중 프론트 마이크로 6건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-07 | SelfCheckinPanel 건너뛰기 단일 세션 덮어쓰기 |
| 2 | MB2-08 | apply-eeg-feature signal_quality_level unknown 강등 |
| 3 | MB2-09 | HRV 지표 불일치(상담사 rmssd vs 회원 sdnn) |
| 4 | MB2-10 | useAudioRecorder start 중복 방지 가드 불완전 |
| 5 | FUNC-10 | 기존 사용자 Google 로그인 동의 강제 |
| 6 | FUNC-11 | TranscriptView dead 컴포넌트 |

## 변경

1. skip 기록 JSON 배열 누적 저장(구버전 문자열 호환).
2. sq01 null + 이벤트 부재 시 기존 행 값 유지(홀드).
3. 상담사 관제 HRV를 회원 기준 SDNN으로 통일 + 라벨 명시.
4. start 진입 가드 강화 + 사전 cleanup.
5. 사전 동의 게이트 제거 → 로그인 시도 → 백엔드 422(신규가입 동의 필요) 시에만 체크박스 노출.
6. TranscriptView 삭제(import 0건 확인).

## 검증

- 프론트 vitest 44/318 + build 0 errors
