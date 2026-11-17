# 운영 11/11 명상 클래스 점검 (읽기 전용 조사, 11/16)

방법: 운영 SSM(`i-0487c67f…`) journalctl + DB READ ONLY. 시각은 UTC(KST=+9). 쓰기·재시작 없음, 서버 스크래치 삭제 완료.

## 1. 결론
- **서버 전체 장애는 없음.** 11/11 구간 5xx는 **수업 종료 순간(02:37:15~26 UTC = KST 11:37) 1건**뿐. OOM 0, `QueuePool` 경고 0, 서비스 재시작 없음(현재 가동은 11/14 06:42 재배포 이후라 11/11 당시 재시작 이력은 journal 범위상 확인 불가 — 다만 11/11 로그는 단절 없이 연속). `/health/ready` 현재 2~4ms.
- **서버 결함 2건**: ① 수업 종료 시 `users`/`session_records` 행 **lock timeout 52건 → `POST /sessions/{id}/end` 500**, 상담사 리포트가 `partial`로 생성, 실시간 lease 퇴장 저장 21건 실패. ② Celery `feature_reconcile_session` **KeyError('feature_hash') 79건(10분 주기, 11/11 전 시간대)** — 정산 태스크가 계속 실패(데이터 적재 자체는 라이브 ingest로 됨).
- 데이터 결손의 대부분은 **앱/현장**: clock_reset·process_terminated(앱 종료/백그라운드), packet_gap. **ble_disconnect는 운영에서 발생(dev는 0)**: 995002da 2건·12초, a53f94ce 5건·122초.

## 2. 회차
| 회차 | 시작(UTC) | 종료 | 참가 | 상태 |
|---|---|---|---|---|
| 195e4b5d | 11/11 01:00 예정 | — | 30 | cancelled(중복 예약으로 추정, 미확인) |
| **995002da** (seq2, 시안 원천) | 01:31:55 | 02:37:14 (65분) | 39 등록 / 32 데이터 | completed |
| a53f94ce (seq1) | 06:08:46 | 07:01:39 (53분) | 18 등록 / 15 데이터 | completed |
(참고 11/10 d2befeb0·e583546a: 장애일, d2befeb0 late 윈도우 157·gap 5310건 — 풀 고갈 영향.)

## 3. 시간대별 사건
| 시각(UTC) | 사건 | 분류 |
|---|---|---|
| 00:50~ 전일 | feature_reconcile_session KeyError 10분마다(79회) | 서버 결함 |
| 01:32 | 995002da 시작, 녹음 시작 01:31:55, gap 이벤트 수신 시작 | 정상 |
| 01:32~02:37 | packet_gap eeg 1098건(32명, 합 72초) | 네트워크·현장(경미) |
| 01:32~02:37 | clock_reset 3명(각 ~407초, 합 1222초) | 앱 결함(시계 리셋) |
| 01:32~02:37 | process_terminated 4명(합 388초, 추정) | 앱 종료/백그라운드 |
| 02:37:15~26 | 종료 PUT 직후 end 500, lock timeout 52, ready 점검 실패 3, lease 실패 21 | 서버 결함 |
| 06:09~07:01 | a53f94ce: ble_disconnect 5건(122초, 2명), packet_gap 571, process_terminated 1(eeg 161s) | 착용·신호/앱 |
| 02:37 / 07:01 | 리포트 생성: client 32+17 sent, counselor 995002da=partial | 아래 |

## 4. 참가자 완결성 (995002da, 코드=user 앞6자, 수업 3919창=65분)
- 윈도우 3919(=만점): 24명 / 3913~3918: 다수. 정상 범위 3785~3919: 31명 중 28명.
- 이상(코드): `44f5d2` 58창(5분 미만, 사실상 미측정) · `0e82ca` 1687창, **RMSSD 0**(PPG 없음/무효) · `dc9729` 2719창 · `b37e0b` 3560창 · **`9b417a` 3919창 중 RMSSD 1848**(절반 결측).
- 원시 EEG 청크 ~400/인(10초×66분과 일치), PPG ~375~390. 미검증(verified_at null) EEG 2건, 실패 0.
- 오디오: 784청크 연속(중복·결번 0), 길이 일치 → **녹음 끊김 없음**(#302는 dev 재현 건, 11/11 운영 회차엔 증거 없음).
- 윈도우 quality는 invalid/unknown/valid 혼재(숫자 아님) — 전 참가자에 invalid 포함.
- a53f94ce: `e6b7e9` 2188창(원시 EEG 353 vs PPG 238), 나머지 3140~3173창 정상.
- 종료 후 업로드: 원시 청크 중 종료 이후 생성 194건(995002da)·48건(a53f94ce) — 지연 업로드, 정산(reconcile) 대상.

## 5. 수정 목록
| # | 항목 | 상태 | 분류 | 담당 파일 | 작업량 |
|---|---|---|---|---|---|
| A1 | 종료 시 lock timeout 500(users/session_records 행 잠금, lease 퇴장) | **미수정**(#321은 기관 GET 한정) | **내일 테스트 전** | `app/api/sessions.py`(end), session_live_namespace lease 정리, FOR UPDATE 범위·lock_timeout | 중(0.5~1일) |
| A2 | `feature_reconcile_session` KeyError feature_hash | **미수정** | 내일 테스트 전 | `app/services/feature_artifact_reconcile.py:218,241` (`r.get`+행 스키마 확인) | 소(2h) |
| A3 | 1/f no_raw(원시 청크 상대 ms 비교) | 수정됨 `4246fe49`(develop, 운영 미반영) | 운영 배포 전 | — | 배포만 |
| A4 | 몸 지표 EEG invalid로 버려짐 | `4246fe49` 수정 | 운영 배포 전 | — | 배포만 |
| A5 | 수업 구간 비례 분할 | `33493b52` 수정 | 운영 배포 전 | — | 배포만 |
| A6 | RMSSD 과대(앱 계산) | #303 `4c46bca8`(수정+재산출 도구, summary 있음) | 운영 배포 전 + 11/11 값 재산출 | 재산출 도구 | 실행 0.5일(워커 513a8566 결론 참조) |
| A7 | 녹음 끊김 | #302 `cd95388c`(dev) | 운영 배포 전 | — | 배포만 |
| A8 | clock_reset(3명 ~407초) 앱 원인 | 미수정, 원인 미조사 | 운영 배포 전 | 앱 시계 앵커(BLE→UTC) | 조사 1일 |
| A9 | 리포트 `partial`/지연: 종료 직후 counselor 보고서가 partial로 확정 | 미수정(A1 종속) | 운영 배포 전 | report 생성 파이프라인 | A1 후 확인 |
| A10 | 데이터 결측 UX: 58창·1687창·RMSSD 0·절반 결측 회원 | 미수정 | 내일 테스트 전(리포트 가드) | member_report 결측 문구/제외 | 소~중 |
| A11 | 195e4b5d 중복 취소 회차 정리 | 미확인 | 나중 | 데이터 | 소 |

## 6. SDD-327 리포트 깨질 지점
- 구간 분할: 58창 회원(<10분)은 기존 방식 폴백으로 처리됨(`33493b52`), 1687창은 실측 구간 기준.
- RMSSD: 실사용 전 A6 재산출 필수(과대값 그대로면 서사 오류). `0e82ca`·`9b417a`는 결측 문구 필요.
- 1/f: A3 미배포 시 운영은 전원 no_raw. 원시 청크는 있으므로 배포 후 재산출 가능.
- clock_reset 구간 ~407초는 시계열 공백 → 구간 평균 시 제외 확인.

## 7. 불확실성
- 서비스 재시작 이력은 11/14 재배포로 journal 초기화됨(로그는 11/11 연속). 4xx·지연 응답 시간, 업로드 presign/ack 실패율은 access log 요청 시간 미기록이라 산출 못 함. 메모리·CPU 시계열 없음(현재 지표만).
- quality 컬럼이 문자열이라 "미착용" 판정 비율은 별도 산출 안 함(invalid 혼재만 확인).
- feature_reconcile 실패가 실제 데이터 누락으로 이어졌는지 미검증.
