# SDD-084 — 세션 영상 녹화·저장

> Mind Breeze MVP1: 세션 중 상담사 영상(전면/후면 카메라)을 녹화해 저장한다.
> 기존 audio_chunks 패턴(multipart 청크 업로드 + S3)을 video에도 동일 적용. **claude(fable) 위주 개발**.

## 1. 배경
- 기존 음성 녹음: `useAudioRecorder.ts`(MediaRecorder, audio) → `POST /sessions/{id}/audio/chunk`(multipart) → S3 + `audio_chunks` 테이블
- 영상 녹화/저장은 현재 **없음** → video 저장 테이블/API 신설 필요
- LiveKit 화상(video=true)은 이미 있지만 "녹화 저장"은 별개 (화상 송출 ≠ 로컬 녹화 저장)

## 2. 녹화 정책 (확정)
- **오프라인 세션**: 상담사 카메라(전면/후면) + 마이크만 열고 저장
- **온라인 클래스**: 내담자 영상·음성은 **저장하지 않음** (상담사 본인 영상·음성만 저장)
- 세션 종료 후 영상·음성이 저장되어 있어야 함

## 3. 구현 범위

### T1. BE — video_chunks 테이블 + 마이그레이션
- `video_chunks`: session_id(FK), chunk_index, file_path(또는 s3_key), size_bytes, created_at
- `AudioChunk` 모델과 동일 구조 (record.py에 VideoChunk 추가)
- Alembic 마이그레이션 신규

### T2. BE — video 업로드 API
- `POST /sessions/{id}/video/start` (녹화 시작 표시)
- `POST /sessions/{id}/video/stop` (녹화 종료)
- `POST /sessions/{id}/video/chunk` (multipart 청크 업로드 → S3 + video_chunks 기록)
- 기존 audio API 구조 그대로 복제 (record_service / audio 서비스 패턴 재사용)
- S3 presigned 또는 직접 업로드 — 기존 audio와 동일 방식

### T3. FE — useVideoRecorder hook
- `getUserMedia({video:true, audio:true})`로 카메라 영상 + 마이크
- 전면/후면 카메라 전환 (`facingMode`)
- MediaRecorder로 녹화 (mimeType: video/webm) → 5초 청크 multipart 업로드
- `useAudioRecorder`와 동일 패턴 (5초 청크, 실패 시 로컬 버퍼링)

### T4. FE — SessionLivePage 영상 녹화 연동
- 세션 시작 시 상담사 카메라 영상 녹화 시작 (오프라인)
- 세션 종료 시 영상 녹화 종료
- 온라인 클래스에서도 상담사 본인 영상은 녹화 (내담자 영상은 LiveKit 송출만, 저장 안 함)
- 녹화 상태 표시 (녹화 중 인디케이터)

## 4. 재사용 (수정 최소화)
- `AudioChunk` 모델 (VideoChunk 복제 템플릿)
- audio chunk 업로드 API + record_service (video 복제 템플릿)
- `useAudioRecorder.ts` (useVideoRecorder 복제 템플릿)
- `SessionPreJoinPreview.tsx` (카메라 프리뷰 — SDD-083)

## 5. 주의
- 영상 파일 크기가 크므로 청크 크기/업로드 실패 처리 주의 (기존 audio 패턴 준수)
- S3 저장 (로컬 파일 X) — 기존 audio와 동일
- 내담자 영상/음성 저장 금지 (온라인 클래스 정책)
- BE 기존 테스트 깨지 않게 (VideoChunk 추가는 기존 영향 최소)
- 세션 삭제 시 video_chunks cascade (audio_chunks와 동일 ondelete)

## 6. 완료 기준
- video_chunks 테이블 + video 업로드 API (start/stop/chunk)
- useVideoRecorder + SessionLivePage 연동 (상담사 영상 녹화·저장)
- BE pytest 통과 (신규 video 테스트 포함), FE build 0 error
