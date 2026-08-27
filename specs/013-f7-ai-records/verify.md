# [SDD-013] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 녹음 시작 — 동의 검증
1. `POST /sessions/{id}/audio/start` with `consent_audio: false`
2. 응답 확인
- **Expected:** 400 Bad Request ("음성 녹음 동의가 필요합니다")

### TS2: 녹음 시작 — host 권한 검증
1. host가 아닌 사용자로 `POST /sessions/{id}/audio/start`
2. 응답 확인
- **Expected:** 403 Forbidden

### TS3: 녹음 시작 → 청크 업로드 → 중지 (정상 플로우)
1. `POST /sessions/{id}/audio/start` with `consent_audio: true` → 200, status=recording
2. `POST /sessions/{id}/audio/chunk` (chunk_index=0, binary file) → 200
3. `POST /sessions/{id}/audio/chunk` (chunk_index=1, binary file) → 200
4. `POST /sessions/{id}/audio/stop` → 200, status=processing
- **Expected:** chunk_index 순차 누적, total_chunks=2, stop 시 processing 상태

### TS4: Celery 체인 완료 → 기록지 생성
1. TS3 실행 직후
2. `GET /sessions/{id}/record` 주기적 폴링 (최대 30초)
3. status=completed 확인
- **Expected:** transcript 필드에 전사문 존재, ai_summary.headline 필드 존재

### TS5: 기록지 AI 요약 탭
1. 기록지 페이지 접속 (`SessionRecordPage`)
2. "AI 요약" 탭 클릭
- **Expected:** headline 표시, sections 섹션별 카드 렌더링, keywords 리스트 표시

### TS6: 기록지 전사문 탭
1. "전사문" 탭 클릭
2. 텍스트 검색 입력
- **Expected:** 화자별 타임라인 (speaker + timestamp + text) 표시, 검색 필터 동작

### TS7: 기록지 상담사 메모 탭
1. "상담사 메모" 탭 클릭
2. 메모 입력 후 저장
3. 새로고침 후 메모 유지 확인
4. `edit_history` 조회
- **Expected:** 메모 저장 성공, is_edited=true, edit_history 배열에 변경 기록 추가

### TS8: WebSocket 처리 상태
1. `POST /sessions/{id}/audio/stop` 호출 직후 WebSocket 구독
2. `record_status` 이벤트 수신
- **Expected:** merging → transcribing → diarizing → summarizing → completed 순서로 이벤트 수신

### TS9: 비로그인 접근 차단
1. 토큰 없이 `GET /sessions/{id}/record` 호출
- **Expected:** 401 Unauthorized

### TS10: 존재하지 않는 세션
1. 임의 UUID로 `GET /sessions/{uuid}/record` 호출
- **Expected:** 404 Not Found

### TS11: 프론트엔드 빌드
1. `cd frontend && npm run build`
- **Expected:** 0 errors, dist/ 생성

## Edge Cases

- [ ] 녹음 중인 세션을 다시 녹음 시작 → 적절한 오류 또는 기존 녹음 중지
- [ ] 청크 업로드 중 네트워크 오류 → chunk_index 순서 보장, 재시도 로직
- [ ] Celery worker 다운 → stop_recording 시 동기 폴백 실행
- [ ] 빈 녹음 (청크 0개) → stop 호출 시 "녹음 데이터 없음" 처리
- [ ] 매우 긴 세션 (100+ 청크) → 청크 병합 성능 확인
- [ ] concurrent stop 호출 → idempotent 처리
- [ ] 세션 종료(/end) 시 자동 stop → finalize_on_session_end 호출 확인

## Security Review

- [ ] 오디오 청크 파일이 외부에서 직접 접근 불가능한 경로에 저장되는지 (`/tmp/mindbreeze_audio/`)
- [ ] host 상담사만 녹음 시작/중지 가능한지 (권한 검증)
- [ ] 세션 참여자만 기록지 조회 가능한지
- [ ] 상담사 메모는 host만 수정 가능한지
- [ ] edit_history에 editor_id 기록되는지
