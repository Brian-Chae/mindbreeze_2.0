# SDD-326 — Verification (Pre-Implementation)

> 구현 전 게이트 문서. 구현 후 결과는 summary.md 에 기록한다. 아래 `[ ]` 는 Stage ⑤ 에서 채운다.

## Test Scenarios

### TS1: 웹에서 시리얼 저장
1. Chrome 으로 회차 입장 → 밴드 스캔·연결.
2. `PUT …/entry/band-device` 1회 호출 확인, 참가자 `linkband_device_id` 조회.
- **Expected:** 값 = 광고 이름(예 `LXB-0263008A`, 대문자 정규화). `session_band_devices` 1행.

### TS2: Android·iOS 앱 저장(네이티브 인계 포함)
1. 앱 로그인 → 밴드 연결 → 네이티브 보류(hold)/측정 인계 진행.
2. 서버 값 확인.
- **Expected:** 인계로 JS 가 밴드를 놓은 뒤에도 값이 이미 저장됨(인계 전 보고). 네이티브 코드·`capture.start` payload 불변(계약 픽스처 diff 0).

### TS3: 재연결 멱등
1. 같은 밴드를 끊고 5회 재연결.
- **Expected:** 이력 1행 유지, `last_seen_at` 만 갱신, 에러 0.

### TS4: 회차 중 밴드 교체
1. 밴드 A 연결 → 해제 → 밴드 B 연결.
- **Expected:** 이력 2행, `linkband_device_id` = B, 역조회 `usage(A)`·`usage(B)` 각각 해당 회차 표시.

### TS5: 구 클라이언트 하위호환
1. 시리얼 보고를 호출하지 않는 구 번들로 입장·측정.
- **Expected:** 모든 기존 API 응답 동일(필드 추가 제외), `linkband_device_id`=NULL, 오류·지연 없음. 업로드 현황에서 `band_serial=null` 표시는 "미수집".

### TS6: 업로드 현황 가산 필드
1. 참가자 N명 회차에서 현황 호출.
- **Expected:** `band_serial`/`band_firmware` 추가, 기존 필드 값·정렬 불변, SQL 횟수 증가 0(기존 쿼리 수 테스트 통과).

### TS7: 시리얼 역조회 권한
1. 코치·기관관리자·타 기관 코치·회원·비로그인으로 `GET /band-devices/{serial}/usage`.
- **Expected:** 코치/관리자는 자기 범위만 200, 타 기관 범위는 비포함, 회원 403, 비로그인 401.

### TS8: 입력 검증
1. serial 에 이메일, 공백, 65자, 한글, `<script>` 전송.
- **Expected:** 모두 422, 저장 없음.

### TS9: 펌웨어 선택 수집
1. 0x180A 지원/미지원 밴드 각각.
- **Expected:** 지원 시 `firmware` 저장, 미지원·읽기 실패 시 NULL 이며 **밴드 연결 흐름은 영향 없음**(연결 성공·측정 시작 시간 회귀 없음).

### TS10: 탈퇴·삭제
1. 참가자 계정 탈퇴 처리 후 `linkband_device_id`·`session_band_devices`.
- **Expected:** 소거됨(기존 sweep 시험 갱신).

### TS11: 마이그레이션
1. `alembic upgrade head` / `downgrade -1` / `check-alembic-heads.py`.
- **Expected:** 헤드 1개, 오프라인 SQL 에 CREATE TABLE·UNIQUE 렌더, 기존 테이블 무변경, 하드코딩 head 단언 테스트 갱신.

### TS12: 실기기 이름 형식 확정(T1)
1. 웹·Android·iOS 각 1대에서 `device.name` 원문 기록.
- **Expected:** 3환경 동일 형식. 다르면 plan §Risks 대로 정규식·`serial_source` 조정 후 verify 갱신.

## Edge Cases
- [ ] `device.name` 이 `null`(웹 권한/iOS 캐시): 저장 안 함, `serial_unknown` 로그, 연결 흐름 정상.
- [ ] 회차 컨텍스트 없는 연결(플레이그라운드·밴드 단계 단독): 호출 안 함.
- [ ] 네트워크 오프라인 중 연결: 재시도 3회 후 포기, 다음 재연결·재전송 때 다시 시도.
- [ ] 동일 serial 을 서로 다른 두 참가자가 보고(밴드 돌려쓰기): 각 참가자 행 별도, 역조회에 둘 다 표시.
- [ ] 동시 보고 경합(웹소켓 재연결 중 중복 PUT): UNIQUE 로 1행.
- [ ] 비회원(게스트) 입장 자격으로 보고: 허용(참가자 본인), `user_id` NULL 이어도 저장.
- [ ] 회차 종료 후 보고: 거부하지 않되(늦은 재연결 기록) 상태가 `completed` 이면 이력만 갱신.

## Security Review
- [ ] 시리얼은 기기 식별자 → 로그에는 마스킹(접두+끝 4자), 에러 응답에 원문 에코 금지.
- [ ] 회원 화면·회원용 API 응답에 노출되지 않음(D1=A).
- [ ] 타 참가자 대신 보고 불가(입장 자격↔participant 일치 검사).
- [ ] 입력 정규식으로 개인정보(이메일)·스크립트 문자열 차단.
- [ ] `usage` 는 호출자 소속 기관 범위만(IDOR 시험 포함).

## 비기능 게이트
- [ ] `live:device`·`capture.start` 계약 픽스처(`contracts/session-live-v2`, `measurement-bridge`) diff 0.
- [ ] 보고 호출은 밴드 연결·측정 시작을 지연시키지 않는다(백그라운드, 실패 무시).
- [ ] 운영 현장(회차 진행 중) 배포 금지 — 행사 종료 후 DEPLOY 창구 승인으로만.

## BE 절 — 자동 검증 매핑 (구현 후 기록, `backend/tests/test_sdd326_band_serial.py`)

| 시나리오 | 시험 |
|---|---|
| TS1 저장 | `test_ts1_게스트_본인_보고시_현재값과_이력_저장` |
| TS3 멱등 | `test_ts3_재연결_5회_멱등_1행_last_seen만_갱신`, 펌웨어 유지 |
| TS4 교체 | `test_ts4_회차중_교체_이력_2행_현재값은_B`, 돌려쓰기 |
| TS5 하위호환 | `test_ts5_보고_없으면_NULL_기존_입장_동작_불변` |
| TS6 현황 가산 | `test_ts6_*` 3건(가산·교체 시 행 중복 없음·SQL 횟수 기준선 동일) |
| TS7 권한 | `test_ts7_*` (코치/기관관리자/타 기관/플랫폼/회원 403/비로그인 401, 타 코치 비노출) |
| TS8 검증 | 스키마 9종 + API 422·원문 에코 없음 |
| TS10 소거 | sweep 분류·누락 FK 0 |
| TS11 마이그레이션 | 단일 헤드·체인·테이블/UNIQUE |
| 로그 마스킹 | `test_로그_마스킹_원문_시리얼이_로그에_없다` |
- 미검증(FE/실기기): TS2, TS9, TS12, 회원 화면 비노출 UI.
