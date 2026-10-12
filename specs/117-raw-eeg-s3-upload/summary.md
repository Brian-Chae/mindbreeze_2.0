# [SDD-117] — Summary

## What Was Built
raw EEG → S3 보존 경로를 실제로 연결. FE 4파일.

| File | 변경 |
|------|------|
| `frontend/src/lib/api/eeg-raw.ts` | BE 계약으로 재작성 — presign `chunks[]` + `start_ms`/`end_ms`/`channel_count`/`size_bytes`, ack `POST /eeg-raw/ack` + `chunks:[{chunk_id, checksum, size_bytes}]` |
| `frontend/src/hooks/useEegRawUpload.ts` | `uploadOne` 리스트 계약 + ISO→ms·channels→channel_count·byteSize→size_bytes 변환 |
| `frontend/src/lib/session-live/raw-encoder.ts` | 신설 — interleaved float32(fp1/fp2) 인코딩, 250샘플(1초) 청크 |
| `frontend/src/hooks/useBand.ts` | `useEegRawUpload` 마운트 + `onEEGData` 등록 + 1초 청크 버퍼·인코딩·enqueue + disconnect 시 flush/drain |

## Result
- **호출부 배선**: `StreamProcessor.onEEGData` 콜백 등록 → raw 샘플 수집 → 250샘플(1초) 청크 → interleaved float32 인코딩 → 영속 큐 → presign→S3 PUT→ack.
- **계약 정렬**: FE presign/ack가 BE `RawPresignRequest`/`RawAckRequest`와 일치(이전 flat/단일 + `/{chunkId}/ack` URL 불일치 해소).
- disconnect 시 잔여 청크 flush + raw 큐 drain(15초).

## Verification
- `npm run build` exit 0.
- `npx vitest run` 263 passed.

## Deploy
- push 후 dev 배포, health 200 확인.
