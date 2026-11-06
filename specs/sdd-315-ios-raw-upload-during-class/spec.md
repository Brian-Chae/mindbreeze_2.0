# SDD-315 — iOS 원시 파일 수업 중 주기 업로드

- 상태: Stage ① Spec
- 브랜치: `sdd/315-ios-raw-upload-during-class`
- 작성일: 2026-11-06

## 1. 문제

iOS 앱은 원시(raw) 측정 청크(EEG/PPG/ACC)를 **수업 종료(봉인) 후에 한꺼번에** 만들어 업로드 큐에 넣는다.

| 항목 | 관측 (dev DB, 회차 83a39b18 32분 / 8ce96b60 4분) |
|---|---|
| iOS (사용자 8d857524) | 수업 중 `eeg_raw_chunks` 등록 0개 → 종료 후 32~33분 시점에 557개 일괄 등록 |
| Android (사용자 62c5fe4b) | 수업 내내 분당 약 17개(30Hz 5 / 50Hz 6 / 250Hz 6) 등록 |
| 업로드 내용 | 정상(250Hz 청크 약 0.1MB, 합계 18MB, uploaded) — 내용 문제 아님, **시점 문제** |

영향: (1) 종료 후 업로드가 몰려 "저장 완결"이 늦다. (2) 종료 직후 데이터 현황 화면에서 iOS가 "모두 도착"인데 0KB로 보임(파일이 아직 미등록). (3) 종료 시 40기기가 동시에 몰려 서버 부하.

## 2. 원인 (소스 확정)

`MeasurementManager.enqueueArchive(of:)`가 `seal()` **이후**에만 호출된다. 이 함수가 `raw.journal` 전체를 읽어 센서별 `RawChunker`(10초 또는 900,000B)에 먹이고 `flush()` 후 `ArchiveQueue.enqueue` 한다. 수업 중에는 큐에 raw 항목이 0개라 업로더(`ArchiveUploader.pump`)가 돌아도 올릴 것이 없다. Android는 `RawArchiver.kt:86`에서 수업 중 청크 봉인 즉시 enqueue 한다(정답지).

## 3. 목표 / 비목표

목표
- 수업 중 raw 청크가 만들어져 큐에 들어가고 기존 업로더 경로(SessionSync 60초 tick + verified 시 pump 연쇄)로 올라간다.
- 종료 시 남은 구간만 추가한다.
- 산출 청크(alias·sha256·sample_index·메타)는 기존(종료 후 일괄)과 **바이트 단위로 동일**.
- 앱 강제 종료 후 복구에서도 중복·누락 없음.

비목표
- Rust 코어(`packages/measurement-core`)·ABI 변경 없음 (SDD-314 별도 진행).
- 서버·계약 변경 없음 (raw-v2 MBRAW002 규격 그대로).
- feature(NF) 묶음 변경 없음.
- 앱 빌드·배포 없음 (감독이 수행).
