# [SDD-117] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 계약 일치
- `eeg-raw.ts` presign body가 `chunks[]` + `start_ms`/`end_ms`/`channel_count`/`size_bytes`.
- ack가 `POST /eeg-raw/ack` + `chunks:[{chunk_id, checksum, size_bytes}]`.
- *검증*: BE `schemas/eeg.py` `RawPresignRequest`/`RawAckRequest`와 대조.

### TS2: 인코딩
- 250샘플 → 2000 bytes ArrayBuffer, interleaved float32 LE.
- *검증*: `raw-encoder.ts` 단위 동작.

### TS3: 수집 배선
- `onEEGData`가 샘플을 버퍼링하고 250샘플 도달 시 enqueue.
- *검증*: `useBand` 코드 경로.

### TS4: 빌드·유닛
- `npm run build` exit 0, `npx vitest run` 통과.
