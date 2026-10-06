# SDD-184 — 통합 검증(2축) 인프라 결함 수정

## 원인 분석

통합 검증(2축: mock end-to-end)에서 EEG raw/미디어 정리 스윕이 서버에서 미실행됨을 발견.

| 항목 | 상태 |
|---|---|
| EEG feature → DB | ✅ 정상 (eeg_feature_windows 43,817건) |
| EEG raw → S3 | ✅ 1550 uploaded |
| raw pending 누적 | ⚠️ 170건 (S3 미업로드, 정리 안 됨) |

**근본 원인**: `sweep_stale_eeg_raw_cron.py`·`sweep_stale_media_cron.py`가 로컬엔 있지만
`deploy-dev.yml` 배포 번들·crontab 등록에 누락 → 서버에 파일도 없고 cron도 없음.

## 수정

- 배포 번들에 두 스크립트 추가
- crontab 등록 (매일 04:30 eeg_raw / 04:45 media)

## 검증

- 배포 후 서버 cron 10건 + 두 스크립트 존재 확인
