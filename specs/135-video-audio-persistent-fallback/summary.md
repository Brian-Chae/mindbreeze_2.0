# [SDD-135] — Summary

## What Was Built
영상·오디오 S3 폴백 저장 경로를 휘발성 `/tmp` → 영속 디스크로 변경해, EC2 재시작·디스크 정리 시 녹화물이 유실되는 문제를 차단했다.

| 파일 | 변경 |
|------|------|
| `backend/app/services/video_service.py` | `VIDEO_CHUNK_DIR` 기본값 `/tmp/mindbreeze_video` → `/var/lib/mindbreeze/video` |
| `backend/app/services/audio_service.py` | `CHUNK_STORAGE_DIR` 기본값 `/tmp/mindbreeze_audio` → `/var/lib/mindbreeze/audio` |

## 원인
10/4 이전 S3 자격증명 미설정 기간에 18개 세션 영상이 `/tmp`로 폴백 저장됐고, EC2 재시작/디스크 정리로 17개가 유실됐다. S3 설정 추가(10/4 01:47) 이후 세션은 정상이나, 폴백 경로 자체가 휘발성이라 재발 위험이 남아 있었다.

## 인프라/데이터 작업 (dev 서버)
- `sudo mkdir -p /var/lib/mindbreeze/{video,audio}` + ubuntu 소유권 부여
- `/tmp/mindbreeze_video/*` 326개 파일 → 영속 경로 이동
- DB `video_s3_key` 18건 경로 갱신(`/tmp/mindbreeze_video/` → `/var/lib/mindbreeze/video/`)

## 결과
- 남은 병합본 1건(0203ee0b, 35MB)이 영속 경로로 복구 → 재생 가능
- 유실 17건은 파일이 이미 삭제되어 복구 불가(과거 데이터)
- 신규 세션 + 일시 S3 실패 폴백 모두 영속 디스크에 저장되어 유실 차단

## 검증
- `py_compile` OK, 배포 성공(Health check 통과)
- 영속경로 병합본 존재 확인, `/tmp` 잔재 0건
