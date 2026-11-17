# SDD-326 — Summary

## What Was Built
| 영역 | 파일 | 내용 |
|---|---|---|
| BE | `alembic/versions/e326a1band001_*`, `models/session.py`, `schemas/band_device.py`, `services/band_device_service.py`, `api/v1/session.py` 외 | 이력 테이블 `session_band_devices`, `PUT /sessions/{sid}/entry/band-device`(멱등 UPSERT), `GET /band-devices/{serial}/usage`(gap_count·gap_reasons), 업로드 현황 `band_serial`·`band_firmware`·`band_gap_count` 가산 |
| FE | `lib/eeg/bluetoothService.ts` | 연결 직후 이름 스냅샷(`releaseForNative` 이전 채취), 펌웨어 0x180A 베스트에포트 |
| FE | `lib/band/band-device-report.ts`, `hooks/use-band-serial-report.ts`, `pages/class/EntryPage.tsx`, `hooks/useBand.ts` | 정규화·중복 방지·재시도 3회·실패 무시 보고. 미착용이면 무동작 |
| FE | `components/class/upload-status-table.tsx`, `band-usage-sheet.tsx`, `lib/upload-status/view.ts`, `lib/api/*` | 시리얼 칼럼(끝 4자 강조)·검색·"끊김 N회"·사용 이력 시트(끊김 사유 한글) — 코치·기관관리자만 |

## Test Results
- BE: `pytest tests/test_sdd326_band_serial.py tests/test_upload_status*` → 123 passed, 9 skipped. `check-alembic-heads.py` → 헤드 1개(e326a1band001).
- FE: sdd326 27건 + 관련 기존 포함 56파일 557건 통과, tsc 0, eslint 에러 0, build 통과, 신규 Tailwind 클래스 생성 확인.
- 계약 대조: 요청/응답/usage/업로드 현황 필드 일치(`band_gap_count` 포함).
- 390px 시트: 마지막 항목 하단이 시트 안에 들어옴(잘림 없음, 측정값 828 ≤ 844).
- TS1~TS12 중 실기기 항목(TS2 앱, TS12 이름 형식)은 미수행.

## Debugging Journey
- 밴드 단계 `useBandStep` 은 sessionId 없는 관찰 전용 → 보고를 `EntryPage` 에 배선.
- 모바일 시트가 하단 탭에 가림 → `document.body` 포털 + z-[100].
- 서버 펌웨어 정규식이 더 엄격 → FE 가 형식 불일치 펌웨어는 보내지 않음.

## Notes for Reviewer
- 마이그레이션 `e326a1band001` 포함(가산 테이블).
- **앱 재빌드 필요**: 웹 번들 내장 방식이라 Android/iOS 는 새 빌드 배포 후 시리얼 수집. 웹은 서버 배포만으로 반영.
- **남은 일**: 실기기(Chrome·Android·iPhone) 광고 이름 형식 T1/TS12 확인. 현장 회차 진행 중 배포 금지.
