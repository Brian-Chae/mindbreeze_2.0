# SDD-244 워커 B 실행 기록

기준: `eda77656` (G1 `56fbc926`, T03 `7f654f12`, FIX `9501fc59` 병합). 브랜치 `sdd/244-b-frontend`.
사용자 승인 범위: T07→T08→T09→T10→T11 웹, B 소유 경로만. 각 Task RED/GREEN 뒤 커밋/해당 브랜치 push. 서버·DB·.env·계약 변경·PR·머지·배포·삭제 금지.

## 사전 경계 확인

| 생산/소비 Task | 공유 인터페이스 | 판단 |
|---|---|---|
| G1→T07 | raw header/packet map/fixture | G1 유지, binary byte 일치 검사 |
| T07→T08 | 원문 capture/clock/encoder | subscribeRawPackets로 journal 연결; 분석 전에 원문 복사 |
| T08→T09/T11 | raw/artifact/event outbox | 모든 emit/표시 slot 보존; ACK 영속 확인 이후 GC |
| T09→T10 | processor 전체 출력 | 기존 inventory 유지; 재현된 결함만 version 변경 |
| T10→T11 | HRV/호흡 provenance | SDNN 표시, 실제 경과 gate, null reason |
| A T04~T06→B | API transport | G1은 본문 DTO만 존재. wrapper/capability 미정은 mock/주입 경계로 검증하고 A 통합 필요 |

- 판단: 승인된 기존 spec/plan을 그대로 실행하며 새 설계 승인 절차를 반복하지 않는다.
- 판단: 소유 경로 제한 때문에 실행 기록은 B 소유 `frontend/tests/sdd244-*`에 둔다. plan/verify/contracts는 변경하지 않는다.
- 구현·검증 분리: 순차 구현 워커와 감독 재검증/읽기 전용 리뷰. 동시 구현 금지.
- node_modules는 사용자가 지정한 원본 frontend/node_modules 심볼릭 링크, 커밋 제외.

## 실행 상태

- T07 진행 중. 원문 capture/encoder/clock RED→GREEN 예정.
- T08~T11 대기.
- 기준 전체 vitest: `npm test` → 9 failed / 246 passed files; 17 failed / 2821 passed tests (2838). `/tmp/sdd244-baseline-vitest.log`. 기존 17건 재현. raw-chunk-queue는 별도 suite import 실패(fake-indexeddb 설치 누락)로 테스트 수에 포함되지 않음.
- 기준 테스트가 덮어쓴 기존 SDD-234 화면 추적 산출물 19개는 시작 시점 HEAD bytes로 복원. 제품 변경 없음.
- 실제 웹 BLE/서버 API/객체 저장소/브라우저 재시작/실기기 검증은 아직 미실행. mock 성공과 구분한다.

## API wrapper 임시 가정 — 사용자 승인

G1 DTO 기반 주입형 transport/mock을 계속한다. A가 schemas/biosignal.py 및 contracts/api-v1.md를 원격 A 브랜치에 확정하면 fetch 후 읽기 전용 대조. 그 전 요청 participant_id/play_group_id/chunks[], 응답 chunks[{chunk_id,upload_status,checksum,size_bytes}]에 signal/stream 필드를 추가하는 legacy 형태를 가정하고 모든 wrapper 매핑은 api/biosignal.ts로 제한한다. G1 receipt status/verified_at_us는 내부 정본으로 유지한다.

- A wrapper 확정 확인: `origin/sdd/244-a-server`의 `90edd067` contracts/api-v1.md 및 biosignal.py wrapper 읽기 완료. 임시 가정은 대체됨. raw 요청 header/checksum/size_bytes, PUT upload_headers, upload_url=null이면 ACK만 재요청. capability 신호별 upload_allowed 및 raw schema 확인. 실제 서버 미구현은 mock으로 검증.
- FIX 회귀: 임시 `/tmp/sdd244-vitest.config.mts`가 fake-indexeddb@6.2.6을 `/tmp/sdd244-test-deps`에서 alias. 원본/shared node_modules 수정 없음. 3 files/46 tests passed.

- T09 alias 임시 규칙 사용자 승인: 클라이언트 생성 alias 문자열과 서버 ACK UUID 대응을 api adapter 한 곳에 격리. A가 alias 규칙을 커밋하면 fetch 후 대조. 기다림으로 중단하지 않는다.
- T07 감독 재검증: capture+band-reconnect+raw queue+upload+resume 5 files/90 tests PASS. 독립 리뷰 capture18 PASS, observed_rate 양의 정수 검증 보강 후 커밋 예정.

## T07 완료

- 신규 capture19/19, 감독 관련5files91/91, tsc 통과. build 통과(그 뒤 clock/observed_rate 검증 보강은 최종 build에서 재검증).
- RED: 초기12 실패, clock/격리 추가4 실패, forward jump1 실패, observed_rate1 실패. GREEN 로그 `/tmp/sdd244-t07-{green,final,supervisor}.log`.
- 독립 리뷰: fixture3개 전체 bytes 일치, 분석전 복사, clock 검토. observed_rate 양의 정수 지적 수정+nullable 타입 오류 수정 후19/19+tsc 통과.
- 실제 journal/1MiB 봉인 흐름은 T08, 실제 BLE/100ms latency/실브라우저 재시작 미검증.
- 최신 A 계약 `b3e9ee15`: client chunk_alias/artifact_alias+feature_id_aliases와 서버 UUID 응답, close expected는 {kind,alias,sha256}. 임시 alias mapping 가정은 이 정본으로 대체.

## 이어받기 완료 기록 (Claude, T08~T11)

- T08 `81618841` · T09 `e1f65029` · T10 `fd1f8f07` · T11 `1acaa31a` (모두 sdd/244-b-frontend push).
- 전체 vitest: 17 failed / 2904 passed (2921) — 기준선 실패 17건과 동일 파일(8개). raw-chunk-queue suite는 fake-indexeddb alias로 이제 로드·통과.
- 검증 명령: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`. 테스트는 /tmp/sdd244-vitest.config.mts(fake-indexeddb alias)로 실행.
- 미검증: 실제 BLE·브라우저 재시작·서버 API·객체 저장소(전부 mock/fake-indexeddb). ClassPlayerPage(session_player) snapshot 미배선.
- 한계: beats(beat ID)·channelBandPowers는 현재 처리기 미emit → null+사유. 원창 매핑은 수신 샘플 카운트 기반 추정(분석 드롭 시 어긋날 수 있음).
