# SDD-326 — Implementation Plan

> 7-Stage SDD — Stage ③ Verify 승인 후에만 구현한다. 본 문서는 정적 분석 기반이며 운영 DB·서버는 조회하지 않았다.

**Goal:** 연결된 밴드의 시리얼(+선택 펌웨어)을 JS 계층에서 채취해 전용 REST 로 저장하고, 회차·참가자·기기 단위로 조회한다.

## 1. 설계 결정 (기본값 A 기준)

| 주제 | 결정 | 이유(근거) |
|---|---|---|
| 채취 지점 | **JS(`bluetoothService`)** 에서만 이름 채취 | 네이티브 측정 경로는 이름을 모른다(`BandGattClient.kt:20,94`, `BandBLE.swift`는 UUID 만). 네이티브 수정 없이 웹·Android·iOS 를 한 코드로 커버 |
| 전송 통로 | **신규 REST** `PUT /sessions/{sid}/entry/band-device` | `live:device`·`capture.start` 는 키 고정 계약(`session_live_ingest.py:43`, `session_live_v2.py:75`) + 네이티브 직접 전송이라 건드리면 앱 코드·계약 픽스처 변경 필요. 기존 `entry/eeg-consent`(`api/v1/session.py:654`) 와 같은 입장 자격(`x_entry_credential` / 로그인) 패턴 재사용 |
| 현재값 저장 | 기존 컬럼 **`session_participants.linkband_device_id` 재사용** | 이미 응답 스키마·직렬화에 노출(`schemas/session.py:137`, `session_service.py:234`) → 마이그레이션 없이 현재값 조회 가능. 탈퇴 소거도 이미 포함(`account_deletion_sweep_service.py:157`) |
| 이력 저장 | **신규 테이블 `session_band_devices`** (마이그레이션 1개) | 회차 중 교체·재연결 이력과 "기기별 연결 품질" 역조회는 단일 컬럼으로 불가. D3=A |
| 하위호환 | 신규 엔드포인트라 구 클라이언트는 호출 안 함 → 기존 동작 100% 불변. 시리얼 없는 행은 NULL | 계약·네이티브 무변경 |
| 펌웨어 | 0x180A `optionalServices` 추가 + Firmware Revision(0x2A26) 읽기 **베스트에포트** | D2=A. 서비스 목록 변경은 웹 번들 변경이라 구 앱도 새 웹 배포를 받으면 적용(§6). 실패는 무시 |

## 2. 데이터 모델

`session_band_devices` (신규, `backend/app/models/session.py` 근처)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | |
| session_id | UUID FK sessions CASCADE, index | |
| participant_id | UUID FK session_participants CASCADE, index | |
| serial | String(64) NOT NULL | 광고 이름 원문 정규화(trim, 대문자) |
| firmware | String(32) NULL | 읽기 성공 시 |
| platform | String(16) | web / android / ios |
| first_seen_at | timestamptz | 최초 보고 |
| last_seen_at | timestamptz | 같은 serial 재보고 시 갱신 |
| UNIQUE(participant_id, serial) | | 재연결·재보고는 UPSERT 로 행 1개 유지 |

- 회차 중 교체: 다른 serial 보고 → 새 행 + `linkband_device_id` 를 새 값으로(현재 = `last_seen_at` 최신).
- 연결 품질은 별도 복제 저장하지 않는다. 역조회에서 `capture_stream`(참가자별 세대 수·`close_reason`)과 업로드 현황의 구멍 집계를 **조인해 읽기 전용**으로 계산(단일 정본).
- alembic 리비전 1개(`down_revision = d305a1rot001`, 가산, downgrade=drop table). SDD 담당 워커 1명만 작성.
- 탈퇴 소거: `account_deletion_sweep_service` 의 참가자 익명화 경로에 `session_band_devices` 행 삭제 추가(시리얼은 기기 식별자이므로 개인정보로 취급). 참가자 삭제 FK CASCADE 로 대부분 처리됨 — 확인 후 누락분만 추가.

## 3. API

1. `PUT /sessions/{session_id}/entry/band-device`  body `{serial, firmware?, platform}`
   - 입장 자격 = `eeg-consent` 와 동일. 참가자 본인만.
   - 검증: serial 길이 1–64, 정규식 `^[A-Za-z0-9._:-]+$`(이메일 `@` 불가), platform enum. 위반 422.
   - 동작: UPSERT 이력 + `linkband_device_id` 갱신. 멱등. 응답 `{ok:true}`.
   - 로그: `[band-device] session=… participant=… serial=LXB-…8A5C`(끝 4자만).
2. `GET /band-devices/{serial}/usage` (코치·기관관리자·플랫폼 관리자, D1=A)
   - 응답: 해당 시리얼의 회차 목록(session_id, 제목, 일시, participant_id, 표시 이름, `stream_count`, `superseded_count`, `gap_count?`).
   - 범위: 호출자의 권한 범위(자기 기관 회차)로 필터.
3. 업로드 현황 참가자 행에 `band_serial: str | None`, `band_firmware: str | None` **가산**(`schemas/upload_status.py:51`, `services/upload_status_service.py:185,269,424`). 기존 필드·정렬 불변. 쿼리 수 증가 0 목표(기존 참가자 조회에 컬럼 추가만).

## 4. 프론트

| Action | File | Description |
|---|---|---|
| Modify | `frontend/src/lib/eeg/bluetoothService.ts` | 연결 성공 직후 `getDeviceName()` 값 + 0x180A 펌웨어 읽기 시도. `releaseForNative()` 전에 값을 스냅샷(`:997-1008`, 해제 시 `deviceName=null` `:825`). `LINK_BAND_SERVICE_UUIDS` 에 0x180A 추가(`:52-57`) |
| Create | `frontend/src/lib/band/band-device-report.ts` | 순수 함수: 이름 → 정규화/검증(`LXB` 접두), 동일 값 중복 전송 방지, 실패 시 지수 재시도 3회(밴드 연결 흐름을 막지 않음) |
| Modify | `frontend/src/hooks/useBand.ts` | 연결 성공 콜백에서 보고 호출(회차 컨텍스트 있을 때만). 재연결 후 같은 serial 이면 skip |
| Modify | `frontend/src/lib/api/class-flow.ts` | `putBandDevice()` (`:146` eeg-consent 옆) |
| Modify | 업로드 현황 화면(`frontend/src/lib/upload-status/view.ts`, `overview-view.ts` + 해당 컴포넌트) | 참가자 행에 시리얼 칼럼(끝 4자 강조, 검색·필터에 포함 — 테이블+검색 선호) |
| Create(최소) | 코치 화면의 기기 상세 시트 1개 | 시리얼 클릭 → `usage` 목록. 별도 신규 페이지 없음 |

- 네이티브 인계 흐름(`use-native-band-hold.ts:32-35`) 변경 없음: 보고는 **인계 전** 연결 직후 JS 에서 끝난다.
- 앱에서 JS 가 밴드를 놓은 뒤 재연결하는 경로(`useBand` 자동 재연결)에서도 `lastDeviceId` 캐시와 함께 serial 캐시를 유지해 재보고(멱등).

## 5. 백엔드 파일

| Action | File | Description |
|---|---|---|
| Create | `backend/alembic/versions/<id>_sdd326_session_band_devices.py` | 테이블 + 인덱스 |
| Modify | `backend/app/models/session.py` | `SessionBandDevice` |
| Create | `backend/app/schemas/band_device.py` | 요청/응답 |
| Create | `backend/app/services/band_device_service.py` | UPSERT·역조회·로그 마스킹 |
| Modify | `backend/app/api/v1/session.py` | PUT 엔드포인트 1개 |
| Create/Modify | `backend/app/api/v1/…` | `GET /band-devices/{serial}/usage` (코치 권한 기존 의존성 재사용) |
| Modify | `backend/app/schemas/upload_status.py`, `services/upload_status_service.py` | 가산 필드 |
| Modify | `backend/app/services/account_deletion_sweep_service.py` | 필요 시 이력 소거 |

## 6. 앱 재빌드 여부

- **네이티브(Kotlin/Swift) 변경 없음, 계약 변경 없음.** 변경은 전부 웹 번들(JS)과 서버.
- Capacitor `webDir: 'dist'`(`frontend/capacitor.config.ts:5`) = 앱이 번들을 내장하는 방식 → **앱에 시리얼 보고를 넣으려면 앱 재빌드·스토어 배포(TestFlight/Play) 필요**. 서버가 원격 웹을 로드하는 설정(`server.url`)은 이 파일에 없음 — 라이브 업데이트(OTA) 도구도 이 저장소에서 확인되지 않음(추정, APP 창구가 확인).
- 웹(Chrome)은 서버 배포만으로 즉시 반영. 구 앱은 서버 신규 엔드포인트를 호출하지 않으므로 안전(시리얼은 비어 있음).
- 따라서 시리얼이 모이는 순서: 웹 즉시 → 앱은 새 빌드 보급 후.

## 7. Tasks (각 3~10분 단위, 담당 경로 겹치지 않게)

**BE 트랙(워커 1)** — 경로: `backend/**`
- T1 실기기 이름 형식 확정: 웹·Android·iOS 에서 `device.name` 로그 3건 수집(구현 전 확인, 정규식 확정)
- T2 모델+alembic+모델 테스트
- T3 service(UPSERT·교체·마스킹)+PUT API+테스트
- T4 업로드 현황 가산 필드+쿼리 수 회귀 테스트
- T5 `usage` 역조회 API+권한 테스트
- T6 탈퇴 소거 확인/보강

**FE 트랙(워커 2)** — 경로: `frontend/src/**`(네이티브 폴더 제외)
- T7 `bluetoothService` 이름 스냅샷·펌웨어 읽기
- T8 `band-device-report.ts`+`useBand` 배선+vitest
- T9 `class-flow.ts` API
- T10 업로드 현황 칼럼+기기 상세 시트+vitest
- 검증 워커(분리): 구현 후 pytest·tsc·eslint·build·Tailwind 클래스 생성 확인

계약 파일(요청/응답 필드명)은 BE 가 T2 직후 `schemas/band_device.py` 로 먼저 커밋하고 FE 가 읽는다(필드 불일치 방지).

## 8. 예상 규모
- BE: 신규 3파일 + 수정 5파일, 약 350~450줄 + 테스트 250줄. 마이그레이션 1개.
- FE: 신규 2파일 + 수정 5파일, 약 300줄 + 테스트 200줄.
- 구현 약 반나절(워커 2병렬) + 검증 1회. 앱 재빌드는 별도(APP 창구).

## Testing Strategy
- `cd backend && pytest tests/<신규> + 업로드 현황·세션 관련` / `python3 scripts/check-alembic-heads.py`
- `cd frontend && npx tsc -b --noEmit && npx eslint src/ && npx vitest run <관련> && npm run build`
- 빌드 CSS 에 신규 클래스 생성 여부 스크립트 확인(Tailwind)
- 실기기 확인(웹 Chrome + Android + iPhone 각 1대) 후 dev 서브도메인에서 화면 확인

## 9. FE 트랙 구현 결과 (T7~T10, 2026-11-12)

| Task | 변경 | 비고 |
|---|---|---|
| T7 | `lib/eeg/bluetoothService.ts` — 0x180A 서비스 목록 추가, `connect()` 성공 직후 `captureIdentity()`(이름 스냅샷 동기 + 펌웨어 0x2A26 비동기·실패 무시), `getBandIdentity()` 공개 | `releaseForNative()`→`disconnect()` 가 `deviceName=null` 로 만들어도 `identity` 스냅샷은 유지(다른 밴드 연결 시 교체) |
| T8 | `lib/band/band-device-report.ts`(정규화·중복 방지·재시도 3회·throw 없음), `hooks/use-band-serial-report.ts` | **배선 위치 변경**: 밴드 단계 `useBandStep` 은 `observationOnly`(sessionId 없음)라 `useBand` 가 아니라 **`EntryPage`** 에서 `bandOutcome==='connected'` 일 때 보고. `useBand`(진행 화면) 에도 같은 보고 이펙트를 두어 재연결·플레이그라운드 외 경로 커버(관찰 전용·예시 모드·sessionId 없음이면 무동작). 중복은 모듈 레벨 `sent` 집합으로 차단 |
| T9 | `lib/api/class-flow.ts` `putBandDevice()` / `PutBandDeviceBody` | `entryRequestOptions(credential)` 재사용(eeg-consent 와 동일) |
| T10 | `lib/api/upload-status.ts`(`band_serial`·`band_firmware` 가산, `fetchBandDeviceUsage`), `lib/upload-status/view.ts`(`splitBandSerial`·`matchesParticipantQuery`), `components/class/upload-status-table.tsx`(시리얼 칼럼·검색), `components/class/band-usage-sheet.tsx`(기기 상세 시트, body 포털) | 코치·기관관리자 화면(`upload-status-table`)에만 노출. 회원용 `my-upload-status` 는 미변경(D1=A) |

계약 대조(`origin/sdd/326-be-band-serial:backend/app/schemas/band_device.py`): 요청 `{serial, firmware?, platform: web|android|ios}`, 응답 `{ok}`, 역조회 `{serial, items[], truncated}` 와 필드명 일치. 서버 `FIRMWARE_PATTERN`(`[A-Za-z0-9._+-]{1,32}`) 에 맞춰 FE 도 형식 불일치 펌웨어는 보내지 않는다. 서버 시리얼 정규식은 `LXB` 접두 필수 — FE 도 `LXB` 접두만 보고.
