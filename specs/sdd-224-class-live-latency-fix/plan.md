# SDD-224 Plan

## 트랙 분리 (같은 워크트리, 파일 경로 겹침 없음)

### 트랙 BE (Claude sonnet-5-5) — `backend/` 만
- T1 `backend/app/services/eeg_raw_service.py` `_STREAM_ID_RE` 에 `:` 허용. `/`, `\`, `..` 포함은 계속 422. 테스트 추가(콜론 허용, 경로 이탈 거부).
- T2 `backend/app/ws/session_live_namespace.py` `_refresh_instructor_rooms(session_id, *, force=False)`:
  세션별 마지막 실행 시각을 모듈 dict 에 두고 `REFRESH_MIN_INTERVAL_SEC = 5` 이내 재호출은 생략. 
  `broadcast_session_state`·`broadcast_participant`(구성 변경)·join/leave 경로는 `force=True`.
  세션 종료 정리(`clear_session_state`)에서 키 제거. 테스트: 연속 호출 시 1회만 DB 재검증, force 는 항상 실행.
- T3 기존 pytest(관련 파일) 통과.

### 트랙 FE (Codex gpt-6.1-sol) — `frontend/` 만
- T4 `frontend/src/hooks/useEegRawUpload.ts`: ApiError status 가 400/403/404/409/413/422 면 attempt 를 MAX 로 올려 즉시 dead-letter(재시도 중단). 401/408/429/5xx/네트워크는 기존 재시도. vitest.
- T5 상담사 지표 반올림: `components/class/player/host/host-live-model.ts`(`hostMetricValues`) 에서 모든 값 `Math.round`. 링 숫자 CSS 에 넘침 방지(`white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:clip`, font-variant-numeric tabular-nums). vitest.
- T6 `frontend/src/pages/classes/class-scheduling.css`: 낮은 창 미디어쿼리에서 `.class-member-picker__list` 220px 고정 제거 → `min-height:320px` 수준 + 본문 스크롤 유지. 기본에서도 목록 최소 높이 보장.
- T7 상담사 셀프뷰 간헐 표시(F): `HostLiveKitBridge.tsx`·`HostHeadSlot.tsx`·`HostLiveContainer.tsx`·`hooks/useVideoRecorder.ts` 조사. 로컬 트랙 attach/detach 반복, cam UI 가 videoRecorder 상태에 묶여 깜빡이는지, 녹화 getUserMedia 와 LiveKit 카메라 경합 여부 확인 후 수정(셀프뷰는 LiveKit 로컬 트랙이 있으면 그것만 사용, 트랙 동일하면 재attach 하지 않음). 원인 문서화.
- T8 `npx tsc --noEmit`, 관련 vitest 통과.

### 검증 (감독)
- diff 리뷰, pytest·vitest·tsc·build 재실행, dev 배포 후 로그 422 소멸 확인.
