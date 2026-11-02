# SDD-275 Summary

## 결과
- 원인 확정: 웹 측정 feature outbox 가 운영에서 메모리 저장소로 만들어져, IndexedDB 만 훑는 앱 셸 보고 훅이 웹 scope 를 못 봄(R1). 추가로 raw 총량 미보고(R2), 입장 자격이 sessionStorage 에만 있어 화면 이탈 뒤 보고 불가(R3).
- 수정(JS 번들만): 기본 outbox=IndexedDB, 웹 raw 총량 보고, 입장 자격 사본을 보고 레코드에 영속(만료 전까지, final 전송 뒤 제거).
- 서버·네이티브·판정 로직 변경 0.

## 변경 파일
capture-controller.ts, expected-reporter.ts, expected-hub.ts, web-raw-totals.ts(신규), use-biosignal-expected-reporter.ts, tests/sdd275/guest-expected.test.tsx

## 시험
- 신규 sdd275 11건 통과. 수정 전(capture-controller 되돌림) V1 실패 확인(RED).
- 회귀: sdd264/266/267/260-web/273/274/sdd246-web 29파일 249 통과·1 skip. tsc -b 0 오류, eslint 0.

## 남은 위험·미확인
- 운영 실기기(Android/iOS WebView) 실측 미확인. 이미 끝난 지난 회차 소급 없음.
- 별건 원시 청크 잔류: 원인 추정만(plan §4) — 클래스 화면 밖에서 raw 큐를 재시도하는 sweeper 부재 가능성. 미수정.
- 웹 raw 총량은 BiosignalQueue 기준(sealed+receipt). 청크 생성 직후~봉인 전 구간은 세지 않음.
