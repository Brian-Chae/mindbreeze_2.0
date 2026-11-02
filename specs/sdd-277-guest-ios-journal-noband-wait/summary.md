# SDD-277 Summary

## 결과
| 항목 | 상태 | 내용 |
|---|---|---|
| A 원인 | **부분 확정** | 원시 기록이 실제로 끊겼음은 확정(운영 집계). 끊긴 직접 오류(iOS 오류 이름)는 기기 로그가 없어 **미확정** |
| A 수정 | 완료(웹만) | 연결 공유·연결 소실 재오픈·journal/봉인 재시도(250/500/1000ms)·파생 데이터 쓰기 실패 격리·중단 사유 상세 기록 |
| B 원인 | 확정 | 밴드 없는 입장은 capture.start 가 없어 폰 보고 scope 가 0 → 서버 `expected_unknown`("집계 대기")이 영원히 유지 |
| B 수정 | 완료(웹만) | 회차 종료 화면에서 측정 흔적이 없을 때만 feature 0 · raw 0/0/0 · final=true 1건 보고 |

## A — 증거 (운영 읽기 전용 SSM 집계, 개인정보 없음)
- 회차 0dd26f7a(21:27~21:30) 비회원: 원시 청크 eeg·ppg 각 1건(21:29:01) 뒤 **없음**, gap `local_write_failed/unknown` 1건, 폰 보고 raw=1/1/0·feature=108, 종료 의도 3건. 같은 참여자의 feature 는 계속 도착 → 원시 journal 쓰기가 독립으로 실패.
- 회차 a9818435(21:08~21:17) 비회원 53134a65: ppg/acc/eeg 청크 17분 연속(최대 공백 47초), `local_write_failed` 0건 → 이 회차는 끊기지 않음.
- 최근 30시간 `local_write_failed` 는 0dd26f7a 1건뿐.
- 코드 근거: ① 쓰기 1회 실패 → 재시도 없이 비가역 중단 ② 저장소 객체마다 IndexedDB 연결을 따로 열고 닫지 않음(SDD-275 가 60초 관측기·outbox·기대량 보고를 추가하며 연결 증가) ③ 파생(feature/display) 초안 쓰기 실패도 원시 수집을 `journal_failed` 로 중단시킴. 가설 순위: 1) 연결 소실·누적 2) 트랜잭션 경합 3) 저장 공간.

## 데이터 유실 가능성 (강조)
- **0dd26f7a 의 비회원 기록은 21:29:01 이후 원시 청크가 서버에 없다.** 폰에 사본이 남았는지는 확인 불가(재접속 시 recover 가 봉인·업로드할 수 있음). 이미 끊긴 회차는 이번 수정으로 소급되지 않는다.
- 이번 수정 뒤에도 재시도 3회를 모두 넘기는 지속 장애면 중단은 그대로 일어나며, 그때는 `local_write_failed` gap 과 stopDetail 로 남긴다(조용한 유실 없음).

## 변경 파일
queue-db.ts(공유 연결·재오픈), durable-queue.ts·metric-outbox.ts·expected-reporter.ts(공유 연결 사용), capture-session.ts(재시도·stopDetail), feature-collector.ts·display-snapshot.ts(파생 쓰기 실패 격리), no-band-final.ts(신규), EntryPage.tsx(종료 시 호출), tests/sdd277/*(신규), tests/sdd244-review-core.test.ts(H05 기대를 재시도 반영으로 갱신)

## 시험
- 신규 tests/sdd277 10건 통과. 수정 전 같은 시험: journal 5건·B 5건 모두 실패(RED).
- 회귀: sdd277·275·274·273·264·266·267·260-web·246-web·244·raw-chunk-queue·recording-status-notice·class-player-member-container 49파일 449 통과·1 skip, sdd272/273/274 단일 7파일 42 통과.
- `tsc -b` 0 오류. 변경 12파일 eslint 0건(전체 실행의 오류 13건은 손대지 않은 기존 시험 9파일).

## 남은 위험·미확인
- iOS 실기기 오류 이름 미확인(다음 재현 시 콘솔 `[biosignal] 원시 journal 쓰기 실패 <이름>: <메시지>`로 확정 가능).
- 원시 업로드 클라이언트·SDD-275 이전 연결 구조(raw-chunk-queue.ts 는 호출마다 열고 닫는 기존 방식 유지)는 건드리지 않음.
- 네이티브 앱(회원 측정) 보고 경로는 변경하지 않음. 네이티브 수정은 필요해 보이지 않음.
- B: 회차 종료 화면에 도달하지 못한 밴드 없는 입장(앱 강제 종료 등)은 여전히 "집계 대기"로 남는다 — 서버가 종료 후 일정 시간 뒤 판정하는 별도 규칙이 필요(서버 변경이라 이번 범위 밖).
