# SDD-306 — 백엔드 다중 프로세스·DB 풀 확대·소켓 지표 거절 원인 수정 (100명 대응)

- 상태: Stage ①~⑤ 완료(구현·시험 커밋됨) / 3단계 dev 적용·부하 재시험은 감독 신호 대기
- 브랜치: `sdd/306-backend-scale-100`
- 작성일: 2026-11-05
- 요청: 대표 지시(11/5) "세 가지 수정해서 다시 40명 부하 테스트. 최대 100명까지 버틸 수 있어야 함"

## 문제 정의 (11/5 dev 40명 시험, 근거: `~/.hermes/share/loadtest-40/sim/client-D.json`, `monD.csv`)
- 저장은 100%(8,000창 전량, 5xx 0)지만 응답이 느림: features_batch p95 7.4초, get_session p95 5.1초, presign p95 7.2초, ack p95 5.7초, 상담사 새로고침 3종 p95 13~20초.
- uvicorn 단일 프로세스가 8코어 중 1코어를 포화(평균 CPU 99%, 피크 300%). DB 연결 42개 중 38개 동시 사용.
- 소켓 `live:metric` 8,000건 중 4,135건(52%)이 `not_ready` 로 거절됨. `capture.renew` 35건이 `projection_pending`, 상담사 `session.start` 1건이 `invalid_state`.
- 서버 사양: m7g.2xlarge(8코어/32GB), RDS db.m7g.xlarge(max_connections 1702), nginx `worker_connections 768`, `ulimit -n 1024`.

## 목표 (합격 기준: 가상 클라이언트 100명, 200초)
- 5xx 0
- 데이터 유실 0 (분석창 전량 저장)
- 핵심 요청 p95 < 2초, 상담사 새로고침 p95 < 3초
- 백엔드 CPU 한 코어 포화 없음

## 범위
포함
1. 다중 프로세스: 소켓·상태 변경 REST 는 단일 프로세스(8000) 유지, 상태 방송이 없는 핫 REST 7종만 `REST_PORTS` 인스턴스로 nginx 경로 분리(설계 C).
2. DB 풀·nginx·uvicorn·systemd 한도를 100명 기준으로 상향(환경변수·배포 템플릿, 코드 기본값 20+20 유지).
3. 소켓 `metric` `not_ready` 거절의 서버 결함 수정(`projection_pending` 이 연결을 DEGRADED 로 고정하던 문제, DEGRADED 복귀 경로 추가).
4. 배포 구성 문서화(nginx 템플릿, systemd 인스턴스 유닛, dev 적용·롤백 스크립트).

제외
- 프로세스 전역 소켓 상태(집계·대기실·재생 replay·채팅 presence)의 Redis 이전(설계 B).
- 운영(prod) 반영, 앱 재빌드, 시험 도구(`sim_load_40.py`) 수정(미추적 파일, 3단계 전 별도 정비).
- 3단계(dev 서버 적용, 40→70→100명 재시험)는 감독의 "코드 배포 완료" 신호 후.

## 제약
- **WS-01 단일 워커 전제**: `session_live_namespace.py` 의 프로세스 전역 dict(`_active_signals`, `_last_aggregate_at`, `_last_group_average_at`, `_last_refresh_at`, `_refresh_in_flight`, `_session_socket_counts`, `_sid_session_ids`, `_waiting_room_presence`, `_audio_states`, `_audio_revisions` 등)와 `chat_namespace` 의 `_user_sids/_sid_users/_sid_viewing` 는 프로세스 안에만 있다. 같은 회차의 소켓이 다른 프로세스에 붙으면 집계·대기실·재생 replay·채팅 presence 가 깨지므로 **uvicorn `--workers N` 단순 증가 금지**, 소켓은 항상 1프로세스.
- 단일 프로세스(로컬·테스트·`REST_PORTS` 미지정)에서 현행과 동일하게 동작해야 한다.
- 푸시·PR·배포·운영 접근·메일·삭제·시크릿 출력 금지. `test1~20@test.com` 계정 사용 금지.

## 산출물
`plan.md`(설계 결정·전역 상태 전수조사·풀 계산), `verify.md`(구현 전 작성), `summary.md`, 코드·시험 커밋 `304daf36`.
