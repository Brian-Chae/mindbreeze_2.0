# SDD-027 — P1: 60초 롤업 · raw S3 보존 · 리포트 상태머신

> 코드 레벨 SDD. Linear 미편성. 멀티에이전트에 Codex 포함.
> 근거: specs/025-live-session-parity-analysis/ (P1 로드맵)

## 목표
SDD-026(P0 안전망)에 이어, 1.0 리뷰에서 도출한 P1을 구현한다: ① 1초/60초 2해상도 조회 계약 ② 참여자 기반 raw chunk manifest + presigned 업로드 ③ Report 상태머신(ReportStatus 4단계).

## 배경
- 2.0은 1초 EEGFeatureWindow만 있고 60초 버킷 없음. 1.0은 efficiencies60[](60초 집계).
- raw EEG는 EEGRecord 정의만 있고(user_id NOT NULL → 게스트 불가), 실제 업로드 경로 미연결.
- Report에 상태 필드 부재. 1.0은 ReportStatus(pending_analysis→pending_review→completed/error).

## 스코프

### 1. 1초/60초 2해상도 조회
- EEGFeatureWindow 1초 원천에서 60초 버킷 파생(온디맨드 `window_index // 60` 집계)
- valid_count·coverage·시간 범위·알고리즘 버전 제공
- null/불량 구간을 0으로 치환하지 않음. 전체 평균은 유효 샘플 수로 가중

### 2. raw chunk manifest + presigned 업로드
- `EEGRawChunk` 모델: session_id, participant_id, stream_id, chunk_index, 시간 범위, sample_rate, 채널, 단위, schema_version, checksum, object_key, 업로드 상태
- `EEGRecord`에 participant_id/play_group_id/file_count 추가, user_id nullable(게스트 raw 지원)
- presigned PUT API + 확인(ack) API. SDK raw→로컬 영속 큐→presigned PUT→확인

### 3. 리포트 상태머신
- Report에 상태 필드 이식: pending_analysis → pending_review(=2.0 승인 게이트) → completed/error
- data_credibility는 quality 게이트에서 파생
- Report 게스트 지원(participant_id, nullable user_id)

## 수락 기준
- [ ] 60초 롤업 집계(valid_count/coverage) 조회 동작
- [ ] null/불량 0 치환 없음, 유효 샘플 가중 평균
- [ ] raw chunk manifest + presigned PUT/ack API 동작
- [ ] 게스트 raw 저장 가능(participant_id 기반)
- [ ] Report 상태머신 4단계 동작, pending_review = 승인 게이트
- [ ] 백엔드 pytest 통과 + 프론트 tsc/build 통과
