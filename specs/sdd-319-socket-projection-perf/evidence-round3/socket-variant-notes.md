# round-3 소켓 표본 해석

`socket-before-{100,40}[-r2]`는 develop 4854d33c 기준선이다.
`socket-after-{100,40}[-r2]`는 **공유 잠금만 적용한 중간 variant**이며 이후 executor 실험의 결과와 혼동하지 않는다.
각 실행 JSON, 원본 로그, 실행 전후 일치 확인한 source manifest는 그대로 보존한다.

동일 test_round2_socket_load.py를 사용했다. 32tick, snapshot120, CPU15ms/25ms, 연결별5초 합성 heartbeat,
실제 localhost PG/Redis/Socket.IO, 테스트 종료 후 동시close, 증거 DB와 Redis 보존 조건이다.
로그인/REST 입장은 주입하며 WS entry.enter만 실제 호출한다. CPU는 서버와 client 스레드를 합산한다.
metric 저장은 실제 store_batch 서비스와 DB 개수로 확인하지만 전송은 시험용 socket이다.
방송 coverage는 event_id×audience 합집합이며 개별 연결별 전달·화면 증명이 아니다.

공유 잠금 단독의 100명 renew p95는 두 표본 모두 기준선보다 악화했다. 40명 renew는 두 표본 모두 개선했으나
metric/store/close와 CPU는 변동이 있으며 개선된 지표만 선택하여 전체 무악화를 주장하지 않는다.
100명 기준선 첫 표본과 수정 두 표본에서 metric timeout1이 발생했으며 시험 exit1을 그대로 기록했다.
100명 기준선 두 번째 표본 및 40명 전 표본은 통과했다. 모든 표본 durable 저장100%, closed100%,
close pending0, outbox/client 쌍 누락0이다. 2개 표본 p95의 평균은 합쳐 계산한 p95가 아니다.

재현: `python3 run_socket.py before|after 100|40 [-r2]`.
`compare_socket.py`는 DB 접근 없이 모든 표본의 범위와 표본평균을 계산한다.

## 4 worker 전용 풀 변형

`socket-pool-after-{100,40}`는 공유 잠금에 renew 전용4 worker를 더한 별도 중간 변형이다.
100명 renew p95 4.355초, 40명4.126초로 모두2초 기준을 실패했다. 100명은metricTimeout1도 있었다.
40명은소켓오류없이저장1280/1280·closed40이나renew기준으로시험exit1이다.
100명저장3200/3200·closed100, 두조건close pending0·방송/client 쌍누락0이다.
전용풀의renew queue max는100명5.445초까지 관측되어 풀분리만으로대기가줄지않음을확인했다.
`socket-pool-comparison.json`에기준선2표본대비수치를기록하며좋은결과만선택하지않는다.

## 최종 SQL 왕복 축소 변형

`socket-sql-after-{100,40}[-r2]`는 전용 풀을 철회하여 기본 풀로 복원하고 공유 잠금과
SAVEPOINT/RELEASE·중복 session SELECT 축소를 적용한 최종 변형이다.
기준선과 최종 변형을 각각2회 측정했다. 100명 renew p95 범위는 기준1.165~1.203초,
최종1.223~1.294초이며 표본평균은1.184→1.259초로 약75ms 악화했다.
공유 잠금만 적용한 중간 변형 평균1.468초보다는 개선되지만 기준선 대비 개선은 입증하지 못했다.
40명은 입장·renew·CPU 모두 두 표본에서 기준선보다 개선했다.
100명 최종 두 표본 모두 metricTimeout1로 시험exit1이며 오류를 숨기지 않는다.
40명 최종 두 표본은 통과했다. 모든 최종 표본 저장100%·closed100%·close pending0,
outbox/client 쌍누락0, 최종DB revision=applied=emitted를 확인했다.
`compare_sql.py`는 네트워크/DB 접근 없이 최종source SHA와 표본수치를 검산하며
`socket-sql-comparison.json`에 전체표본·평균·범위·오류·시험exitstatus를 기록한다.
2개 p95 표본평균은 원시표본을 합친 p95나 dev성능 보장이 아니다.
