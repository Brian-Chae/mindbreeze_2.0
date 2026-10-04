# [SDD-117] — Implementation Plan

> FE 4파일. Stage ③ Verify 후 구현.

## 변경
| File | 변경 |
|------|------|
| `frontend/src/lib/api/eeg-raw.ts` | BE 계약으로 재작성(리스트 presign/ack, 필드명 정렬) |
| `frontend/src/hooks/useEegRawUpload.ts` | `uploadOne` 리스트 계약 + ISO→ms·channels→channel_count·byteSize→size_bytes 변환 |
| `frontend/src/lib/session-live/raw-encoder.ts` | 신설 — interleaved float32 인코딩 + 청크 상수 |
| `frontend/src/hooks/useBand.ts` | `useEegRawUpload` 마운트 + `onEEGData` 등록 + 1초 청크 버퍼·인코딩·enqueue |

## Task
1. `eeg-raw.ts` 재작성(BE 계약).
2. `useEegRawUpload.uploadOne` 수정.
3. `raw-encoder.ts` 신설.
4. `useBand` 배선.
5. `npm run build` + `npx vitest run` 통과.

## Rollback
`eeg-raw.ts`·`useEegRawUpload`를 이전 flat 계약으로, `useBand`에서 `onEEGData` 배선 제거하면 복원.
