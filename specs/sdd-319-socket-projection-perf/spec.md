# SDD-319 — 소켓 프로세스 부하 분석·입장 반영 지연 개선

- 상태: Stage ① Spec
- 브랜치: `sdd/319-socket-projection-perf`
- 작성일: 2026-11-07
- 범위: **backend 코드만**(앱·프론트·마이그레이션·프로토콜 변경 없음). 행사(11/11) 전 backend 교체만으로 적용 가능해야 한다.

## 문제
운영 40명×200초 시험(11/7 09:40)에서 분석창 저장 100%·5xx 0 이었으나 반영이 느렸다.
- `entry.enter` p95 2.8초, `capture.renew` 708건 중 7건 `projection_pending`(p95 2.5초), `capture.start` p95 1.9초, `metric` p95 1.6초.
- 소켓 프로세스(8000) CPU 평균 101%(최대 170%), REST 4개는 평균 30%.

## 측정 근거(dev 재현, py-spy 50Hz×270초, 40명×200초)
재현 기준선: entry.enter p95 3.05초, capture.renew p95 2.86초(projection_pending 6건), metric p95 1.81초, CPU 평균 91%/최대 120%.
스레드 샘플 중 **72%가 metric/device sink 직후 방송 경로**(`make_sinks._run → publish_session_sync → publish_pending → ob.drain`)이며, 그중 `_acquire`(projector 락 20ms 폴링 대기)가 18%, SQLAlchemy 실행이 24%, Redis 왕복이 약 20%다.
→ metric 이 초당 약 40건 들어올 때마다 회차 단위 drain+방송이 **건별로 직렬 중복 실행**되고, 명령(`run_live_command`)의 drain 이 같은 projector 락을 두고 경합해 `busy`/`projection_pending` 이 난다.

## 목표
1. 같은 회차에 대한 방송(publish)·drain 을 프로세스 내에서 **합류(coalescing)** 시켜 중복 실행을 제거한다.
2. 명령 ack 의 `projection_pending` 을 없애거나 최소화한다(이미 진행 중인 drain 완료를 기다려 결과 공유).
3. 소켓 프로세스 CPU·입장 지연을 줄인다.

## 비목표
다중 소켓 프로세스, 상태 Redis 이전, 앱/프로토콜 변경, 서버 설정 변경.

## 불변 조건
- revision 단조, 명령 부수효과 정확히 1회, `projection_pending` 응답 형식·재시도 의미 유지(앱 호환).
- 방송 누락 없음: 합류로 건너뛴 호출은 반드시 진행 중 실행이 재실행한다(dirty 플래그).
