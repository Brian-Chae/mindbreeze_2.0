# [SDD-117] raw EEG → S3 연결 — 계약 정렬 + 수집/업로드 배선

## Goal
미연결 상태인 raw EEG 보존 경로를 실제로 연결한다. FE raw 인프라(`useEegRawUpload`·`raw-chunk-queue`·`eeg-raw.ts`)는 존재하지만 ① 호출부가 없고 ② FE/BE 계약이 어긋나 실제 동작하지 않는다.

## Context
- **BE 계약**(`schemas/eeg.py`, `api/v1/session.py`): presign `POST /sessions/{id}/eeg-raw/presign` = `{participant_id, play_group_id, chunks:[{stream_id, chunk_index, start_ms, end_ms, sample_rate, channel_count, unit, schema_version, checksum, size_bytes, content_type}]}`. ack `POST /sessions/{id}/eeg-raw/ack` = `{participant_id, play_group_id, chunks:[{chunk_id, checksum, size_bytes}]}`.
- **FE 현재**(`eeg-raw.ts`): presign이 단일 flat body(`started_at` ISO, `channels` list, `byte_size`), ack가 `/{chunkId}/ack` URL + 단일 body. → **전부 어긋남**.
- **수집 경로 없음**: `useEegRawUpload` 호출부 전무, `StreamProcessor.onEEGData` 콜백 미등록.

## Approach
1. `eeg-raw.ts`를 BE 계약에 맞게 재작성(리스트 기반 presign/ack, `start_ms`/`end_ms`, `channel_count`, `size_bytes`).
2. `useEegRawUpload.uploadOne`을 리스트 계약으로 수정.
3. `raw-encoder.ts` 신설 — interleaved float32(fp1/fp2) 인코딩.
4. `useBand`에 `useEegRawUpload` 마운트 + `onEEGData` 콜백 등록 + 1초(250샘플) 청크 버퍼링·인코딩·enqueue.

## Binary format (raw 바이트)
- schema `eeg-raw-v1`, 250Hz, 2ch(fp1/fp2), unit uV.
- 청크 = 250샘플(1초) = interleaved little-endian float32 `[fp1_0, fp2_0, fp1_1, fp2_1, …]` = 2000 bytes.

## Non-goals
- S3→Parquet 변환(BE에 미구현, 후속 과제). raw `.bin`을 S3에 보존하는 것까지.
- `play_group_id` 전송(FE 미구현) — BE는 null 보존.

## Acceptance
1. raw 샘플이 수집되어 1초 청크로 인코딩·큐 적재된다.
2. presign→S3 PUT→ack 파이프라인이 BE 계약과 일치해 200을 반환한다.
3. build + vitest 통과.
