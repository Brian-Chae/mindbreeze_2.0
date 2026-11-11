# SDD-326 — 밴드 시리얼 번호 저장

- 상태: Stage ① Spec 완료 (Plan·Verify 작성됨, 구현 전)
- 브랜치: `sdd/326-band-serial-capture`
- 작성일: 2026-11-11
- 유형: [SDD] 정적 분석 기반 (운영 DB·서버 접근 없이 코드로 근거 확인)

## Goal

회원이 클래스·상담 회차에서 연결한 LINK BAND 의 **시리얼(광고 이름, 예 `LXB-0263008A`)과 가능하면 펌웨어 버전**을 서버에 저장해, 회차·참가자별 사용 기기와 기기별 연결 품질을 조회할 수 있게 한다.

## Context

- 11/11 대구 몸돌봄 클래스(회차 995002da, 참가 33)에서 연결이 불안정한 기기를 찾으려 했으나 서버에 시리얼이 없었다.
- 감독이 확인한 운영 사실(이 SDD 에서는 재조회하지 않음): `session_participants.linkband_device_id` 33명 전원 NULL / `eeg_raw_chunks.header` 에 기기 식별자 없음 / `capture_stream.device_profile='linkband2-v1'` 만 있음 / `normalization_baselines.device_id` 비어 있음.
- 밴드는 자체 저장소가 없어 끊긴 구간은 영구 유실이다. 이 SDD 는 유실 복구가 아니라 **"어느 기기가 불안정했는지 사후에 식별"** 하는 장치다.

## 코드 근거 (현재 상태)

| 항목 | 근거 | 판정 |
|---|---|---|
| 서버 컬럼은 이미 있으나 쓰는 코드 없음 | `backend/app/models/session.py:179` (`linkband_device_id`), 읽기만: `schemas/session.py:137`, `services/session_service.py:234`; 쓰기 호출부 grep 0건(탈퇴 소거 `account_deletion_sweep_service.py:157` 제외) | 확정 |
| 시리얼 = BLE 광고 이름 | 스캔 필터가 이름 접두사 `LXB`: `frontend/src/lib/eeg/bluetoothService.ts:62-67`(`LINK_BAND_NAME_PREFIX='LXB'`), `bleConnection.ts:32-34`. 이름 값은 `scan()` 이 `deviceInfo.name` 으로 보관(`bluetoothService.ts:435-440`, 487·492) | 접두사 확정 / "이름 전체가 시리얼" 은 대표 예시(`LXB-0263008A`) 기준 **추정 — 구현 첫 Task 에서 실기기 로그로 확정** |
| 웹 이름 획득 | `WebBluetoothProvider.ts:40-57` (`device.name ?? null`) | 확정 |
| Android/iOS 앱의 JS 스캔 이름 획득 | `capacitor-ble-adapter.ts:35-47` (`BleClient.requestDevice` → `device.name`) | 확정 |
| 앱 네이티브 측정 경로는 이름을 모른다 | Android `BandGattClient.kt:20,94`(주소만), iOS `BandBLE.swift`(identifier UUID 만, `name` 사용 0건). 네이티브는 JS 가 넘긴 `deviceId` 로 인계: `use-native-band-hold.ts:32-35`, `native-measurement/types.ts:142` | 확정 → **이름은 반드시 JS 에서 채취** |
| 인계 시 이름이 사라진다 | `releaseForNative()` → `disconnect()` → `deviceName=null`(`bluetoothService.ts:825`, `997-1008`) | 확정 → 해제 **전에** 읽어야 함 |
| 기존 실시간 전송 계약은 닫혀 있다 | `live:device` 허용 키 고정(`schemas/session_live_ingest.py:43-44`, 초과 키 거부 `:187-189`), `capture.start` payload 3키 고정(`schemas/session_live_v2.py:75-76`, 네이티브가 직접 전송: `LiveSession.kt:729`, `MeasurementManager.swift:235`) | 확정 → 여기에 필드를 넣으면 계약·네이티브 코드 변경 필요 → 채택 안 함 |
| 펌웨어(Device Information 서비스 0x180A) | 현재 서비스 목록에 없음(`bluetoothService.ts:49-55`, EEG·PPG·ACC·배터리만 `optionalServices`). Web Bluetooth 는 목록에 없는 서비스 접근 차단. 설명서·SDK 에 0x180A 노출 여부는 코드로 확인 불가 | **추정 — 선택 항목**, 읽기 실패해도 무시 |

## Scope

### ✅ In-scope
1. 밴드 연결 성공 직후 JS(웹·앱 공통 `useBand`/`bluetoothService`)가 시리얼(+펌웨어 시도)을 **전용 REST** 로 서버에 보고.
2. 서버: 기존 `session_participants.linkband_device_id` 에 **현재 기기** 저장 + 신규 이력 테이블에 **회차 중 교체 포함 전 이력** 저장.
3. 조회: 업로드 현황(참가자 행)에 시리얼 표시, 시리얼로 "어느 회차·누가·몇 번 스트림이 끊겨 교체됐나" 역조회 API 1개.
4. 구 앱·구 웹(시리얼 미전송) 하위호환, 탈퇴·삭제 시 소거.

### ❌ Out-of-scope
- `live:device`/`capture.start` 계약 변경, 네이티브(Kotlin/Swift) 코드 변경.
- 과거 회차(대구 995002da 등) 소급 복구 — 기기 정보가 서버에 없어 불가능.
- 기기 재고관리·펌웨어 업데이트·밴드 하드웨어 저장소.
- 회원 화면 노출, 점수화.

## Acceptance Criteria
- [ ] 웹(Chrome)에서 밴드 연결 → 해당 참가자 `linkband_device_id` 가 시리얼로 채워진다.
- [ ] Android·iOS 앱(네이티브 측정 인계 포함)에서도 같은 값이 채워진다.
- [ ] 회차 중 밴드 A→B 교체 시 이력 2행, 현재값은 B.
- [ ] 시리얼 미전송 구 클라이언트는 기존과 똑같이 동작(오류·지연 없음).
- [ ] 업로드 현황 응답에 `band_serial` 이 추가되고 기존 필드는 불변.
- [ ] 시리얼 역조회 API 가 코치·기관관리자 권한에서만 동작.
- [ ] 이메일 등 개인정보 형태 문자열은 거부, 로그에 시리얼 전체를 남기지 않는다(접두 + 끝 4자).
- [ ] `npm run build`, `tsc -b --noEmit`, `eslint src/`, `pytest`(신규+기존 관련) 통과, alembic 헤드 1개.

## Dependencies
- 선행 SDD 없음. 마이그레이션 헤드 `d305a1rot001` 위에 1개 추가.
- 앱 반영은 앱 재빌드·스토어 배포 필요(plan §6).

## Risks
| 위험 | 대응 |
|---|---|
| 광고 이름이 시리얼 전체가 아닐 수 있음 | Task 1 에서 실기기 로그(웹·Android·iOS)로 확정 후 정규식 고정. 안 맞으면 그 값을 원문 저장하고 `serial_source` 로 구분 |
| iOS 는 MAC 주소 불가(UUID 만) → 이름이 유일한 식별자 | 위 구조가 이를 전제. 이름이 `null` 이면 저장하지 않고 `serial_unknown` 로그 1줄 |
| 웹은 `device.name` 이 `null` 일 수 있음(권한·프라이버시 모드) | 같은 처리. 미수집 비율을 verify 에서 확인 |
| 현장(회차 진행 중) 배포 위험 | 구현·배포는 행사 종료 후 TASK BOX 승인 시. 이번엔 문서까지 |

## 대표님 결정 대기 (기본값 A로 진행)

| # | 결정 | 기본값 A | 대안 |
|---|---|---|---|
| D1 | 시리얼 열람 권한 | 코치·기관관리자·플랫폼 관리자만 열람, 회원 화면에는 비노출 | B: 회원도 본인 기기 확인 가능 |
| D2 | 펌웨어 버전 | 읽기를 시도하되 실패해도 무시(선택 수집) — 서비스 목록에 0x180A 추가만 | B: 이번엔 시리얼만, 펌웨어는 후속 |
| D3 | 회차 중 교체 처리 | 이력 테이블에 전부 보관, 현재값만 `linkband_device_id` | B: 최신값 하나만 덮어쓰기(이력 없음, 마이그레이션 없음) |
