# SDD-247 Verify — 구현 전 체크리스트 (RED 먼저)

## BE (pytest, backend/tests/test_audio_formats.py)
- B1 mp4 매직(`ftyp`) 청크 업로드 → 저장 경로 `.m4a`, 크기·응답 기존과 동일
- B2 webm 매직 → `.webm`, 임의 바이트 → `.bin`(거부 안 함)
- B3 동일 인덱스 재업로드 멱등(기존 유지) / `processing` 상태 업로드 수용
- B4 merge: 연속 webm(첫 청크만 EBML) → 바이트 병합, mime `audio/webm`
- B5 merge: m4a 3청크 → ffmpeg concat 단일 파일(ffprobe 길이 ≈ 합), mime `audio/mp4` (ffmpeg 없으면 skip 마커)
- B6 merge: 혼재(webm+m4a) → ffmpeg 경로. 누락 청크는 건너뛰고 경고(STT-01)
- B7 stt_task 가 병합 mime·확장자 사용(Whisper/Gemini 호출 인자 단언, 외부 호출은 mock)
- B8 pytest 전체 0 fail, `scripts/check-alembic-heads.py` head 1개(마이그레이션 없음)

## FE (vitest)
- F1 `isAvailable` false(웹) → 기존 MediaRecorder 경로 호출, 네이티브 start 미호출
- F2 true → `/audio/start` 후 `plugin.start({sessionId, apiBase, accessToken, refreshToken, chunkMs:5000, startChunkIndex})`
- F3 pause/resume/setMicEnabled(false/true)/stop 이 플러그인 호출로 위임, state 반영(recording/paused/stopped)
- F4 stop: 플러그인 stop 결과 pendingCount 반영 후 완료, 에러 시 error 상태
- F5 `error{auth_expired}` → 복귀 시 `updateCredentials` 재인계
- F6 복귀(`subscribeAppResume`) 시 네이티브 경로면 getStatus 로 상태 동기화(MediaRecorder 복구 로직 미실행)
- F7 `chunkUploaded` 이벤트 → uploadedChunks 증가, 언마운트 시 리스너 해제
- F8 tsc 0, eslint 0, vitest 실패 수 ≤ 기준선(17 fail/8파일)
- F9 토큰 값이 로그/이벤트에 노출되지 않음(정적 단언)

## iOS (swift test + xcodebuild 시뮬레이터)
- I1 청크 분할기: 44.1kHz PCM 5초 단위로 분할, 경계 샘플 유실·중복 0 (순수 로직 단위시험)
- I2 인코더: PCM → m4a, 매직 `ftyp`, 길이 5.0±0.1s, 독립 재생(AVAudioFile open)
- I3 큐: 저장→업로드 성공→삭제, 실패→백오프 스케줄, 재시작 후 인덱스 오름차순 복원
- I4 토큰: 401→refresh(body+`X-MB-Native`)→헤더 회전 저장→재시도 1회, 4xx→`auth_expired` 큐 보존
- I5 상태기계: pause/resume/micOff 인덱스 규칙, 인터럽션 시작→paused, 종료→재개
- I6 xcodebuild Debug 시뮬레이터 빌드 성공(gitignore 산출물은 커밋 금지)
## Android (JVM 단위 + gradle)
- A1 청크 분할기(동일 로직) A2 AAC 인코딩 경계: 샘플 수 정확 A3 큐/백오프/재시작 복원 A4 토큰 갱신(HttpTokenSource 재사용) A5 상태기계 동일 규칙
- A6 `./gradlew assembleDevDebug testDevDebugUnitTest` 통과, 16KB 정렬 스크립트 통과

## 통합 게이트
- G1 backend pytest 0 fail / alembic head 1 / tsc 0 / eslint 0 / vitest ≤ 17 fail·8파일 / swift test / xcodebuild / gradle

## 실기기 — Android Note10 (R3CMA0C3Y4T, Android 12)
1. dev APK 설치, counselor@test.com 로그인(연속 실패 금지 — 잠금)
2. 대면 클래스 시작 → 동의 → 녹음 시작 → 홈 → 화면 잠금 → **5분** → 복귀 → 클래스 종료
3. dev DB 읽기: `audio_chunks` 인덱스 연속(누락 0), 간격 5±2초, 파일 크기 정상(≥ 평균 50%), 합본 길이 ≈ 경과 시간
4. logcat 은 `NativeAudioRecorder`·AndroidRuntime 태그만, 토큰 필터
5. 정리: 시험 세션 앱에서 종료, RECORD_AUDIO revoke, stay_on 원복
## 실기기 — iOS (Brian TestFlight)
1. TestFlight 빌드 설치 → 상담사 로그인 → 클래스 시작 → 동의 → 녹음 시작
2. 홈 → 화면 잠금 → 5분 → 복귀 → 종료 (상태바 주황 마이크 점 확인)
3. 웹 관리자/기록에서 청크 수=경과/5±2, 다시 듣기 재생(m4a)
4. 비행기 모드 1분 on/off → 큐 복구 후 인덱스 연속 확인
5. 앱 강제 종료 후 재실행 → 잔여 큐 업로드 확인
