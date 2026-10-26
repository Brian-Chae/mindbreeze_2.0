# SDD-247 Plan — 앱 자체 백그라운드 수업 녹음

## 0. 결정 요약 (코드 확인 근거)
| 주제 | 결정 | 근거 |
|---|---|---|
| 청크 형식 | **iOS·Android 공통 AAC-LC m4a(audio/mp4), 청크마다 독립 재생 가능 파일** | iOS 는 webm 불가. Android 도 `AudioRecord`+`MediaCodec`(AAC)+`MediaMuxer` 로 같은 형식을 쓰면 서버 경로 1개, API 24+ 에서 동작(spec 의 'API29 webm' 대비 폴백 대상이 줄어듦). 기존 웹 경로는 webm 유지. |
| 캡처 방식 | 연속 PCM 캡처(Android `AudioRecord`, iOS `AVAudioEngine` input tap) → 5초 분량마다 인코드·파일 확정 | `MediaRecorder` 파일 회전은 청크 경계 공백 발생. PCM 연속 캡처는 공백 0, 마이크 오프/일시정지 경계도 정확. |
| 서버 형식 판별 | **바이트 매직 스니핑**(DB 컬럼·마이그레이션 없음) | `AudioChunk` 에 형식 컬럼 없음. mp4: 오프셋 4에 `ftyp`, webm: `1A 45 DF A3`. 구 서버(미배포)에도 업로드는 그대로 저장돼 Note10 시험 가능. |
| 서버 병합 | 형식 혼재/독립청크이면 `ffmpeg` concat(디코드 후 재인코드)으로 단일 파일 생성. 기존 연속 webm(JS 경로: 첫 청크만 EBML 헤더)은 기존대로 바이트 이어붙이기 | `stt_task.py` 의 `_transcribe_batch`/`_call_whisper` 가 청크 바이트 단순 병합 + mime `audio/webm` 하드코딩. ffmpeg 는 서버에 필요(EC2 설치 확인은 BE 트랙 과제). |
| 토큰 | 네이티브 자체 갱신. 인계=`start` 인자(1회) → 네이티브 봉인 저장소(Android SealedTokenStore+HttpTokenSource 재사용 / iOS KeychainCredentialStore+동일 refresh 규칙). 401 시 `POST {apiBase}/auth/refresh` body `{refresh_token}`, 헤더 `X-MB-Native: capacitor`, 회전 토큰은 응답 헤더 `X-MB-Refresh-Token` | 앱은 refresh 를 `localStorage` 에 보관(`client.ts` getNativeRefreshBody). 백그라운드에서 JS 가 정지하므로 네이티브가 직접 갱신해야 함. 이미 측정 모듈이 같은 방식. |
| 회전 충돌 | 포그라운드 복귀/JS 갱신 시 `updateCredentials` 로 네이티브 저장소에 동기화. 네이티브가 갱신한 값은 JS 가 복귀 시 `getNativeRefreshBody` 가 못 읽으므로, 복귀 시 JS 는 `updateCredentials` 호출 전에 **네이티브가 갱신했을 수 있음**을 전제로 401 → 재로그인 실패 시 `error{auth_expired}` 처리 | refresh 4xx(Invalid)이면 큐는 보존, `error{auth_expired, recoverable:true}` 발행, JS 가 복귀 시 재인계. |

## 1. 흐름
1. 상담사 동의 → JS `useAudioRecorder.start()`: `NativeAudioRecorder.isAvailable()` true 이면 `POST /audio/start`(기존) 후 `plugin.start(...)`. false/오류이면 기존 MediaRecorder 경로(웹·미지원).
2. 네이티브가 5초마다 m4a 확정 → 로컬 큐(디스크)에 `{sessionId}/{index}.m4a` 저장 → 업로더가 `POST /sessions/{id}/audio/chunk`(multipart `chunk_index`, `file`) → 2xx 이면 파일 삭제 + `chunkUploaded`.
3. 정지: JS `stop()` → 네이티브 마지막 청크 확정·업로드 시도(최대 10초) → `{pendingCount}` 반환 → JS `POST /audio/stop`. 남은 큐는 네이티브가 계속 전송(서버 `save_chunk` 는 `processing` 상태도 수용).
4. 일시정지/재개: 캡처 중단·재개, 인덱스 이어짐. 마이크 오프(`setMicEnabled(false)`): 캡처 중단, 해당 구간 제외, 인덱스 진행 없음, 켜면 이어서. (AI기록 제외 규칙은 호출부 그대로)
5. 네트워크 끊김: 업로더는 지수 백오프(1,2,4…최대 30초), 청크는 큐에 누적(디스크 상한 200MB 초과 시 `error{disk_full}`+일시정지). 연결 복구·앱 시작 시 인덱스 오름차순 재전송. 서버 멱등(동일 인덱스 재업로드 무시).
6. 앱 강제 종료/크래시: 캡처는 종료(OS 정책). 큐와 `state.json`(sessionId, nextIndex, 마지막 확정) 은 남음 → 다음 실행 시 네이티브가 큐를 업로드하고 `stateChanged{state:'stopped',reason:'app_restart'}` 발행. 녹음 자동 재개는 하지 않음(동의 UX 위반 방지). 확정 전 5초 미만 조각은 유실(허용, 문서화).
7. 백그라운드: Android = 기존 호스트 FGS(microphone 타입, PR #125) 안에서 `AudioRecord` 동작. iOS = `UIBackgroundModes audio` + `playAndRecord` 세션(PR #125) 에서 `AVAudioEngine` 동작, 업로드는 일반 `URLSession`(앱이 오디오로 살아 있는 동안) + 큐 + 백그라운드 `URLSession`(앱 종료 후 잔여분).
8. 폴백: `isAvailable` false(웹, 네이티브 초기화 실패, 권한 영구 거부 후 재시도 불가) → 기존 MediaRecorder. Android 는 RECORD_AUDIO 미허용 시 `start` 가 `permission_denied` 를 reject → JS 가 MediaRecorder 폴백하지 않고 사용자 안내(기존과 동일 UX).

## 2. 브리지 계약 (소스: `frontend/src/lib/native-audio-recorder/types.ts` — 구현 시작 전 커밋, 이후 변경은 감독만)
| 구분 | 이름 | 설명 |
|---|---|---|
| 플러그인 | `NativeAudioRecorder` (iOS `jsName`, Android `@CapacitorPlugin(name=)`) | |
| 메서드 | `isAvailable` `start` `stop` `pause` `resume` `setMicEnabled` `getStatus` `updateCredentials` | 요청 6종 + 토큰 동기화 1종 |
| `start` 인자 | sessionId, apiBase, accessToken, refreshToken, chunkMs(5000), startChunkIndex | |
| 이벤트 | `chunkUploaded` `stateChanged` `error` | 오류 코드: permission_denied, session_interrupted, audio_engine_failed, auth_expired, upload_failed, disk_full, unsupported |
| 형식 | `audio/mp4` AAC-LC mono 44.1kHz 64kbps, 5초, 파일 확장자 `.m4a` | |
| 업로드 | 기존 `POST /api/v1/sessions/{id}/audio/chunk` multipart(`chunk_index`,`file`) 변경 없음, 파일명 `chunk-{idx}.m4a`, Content-Type `audio/mp4` | |

## 3. 서버 보강 설계 (BE 트랙)
- `audio_service.save_chunk`: 바이트 매직으로 형식 판별(`mp4|webm|unknown`), 파일 확장자 `.m4a`/`.webm`/`.bin`. 크기·인덱스 규칙 불변. 형식 검증 실패(unknown)는 기존 호환상 거부하지 않는다(경고 로그).
- 신규 `audio_merge_service.merge_chunks_for_stt(paths) -> (path, mime)`: ① 전부 webm 이고 첫 청크만 EBML 헤더 → 기존 바이트 병합(mime `audio/webm`). ② 그 외 → `ffmpeg -f concat -safe 0 -i list -c:a aac|libopus` 로 단일 m4a(mime `audio/mp4`) 생성. 누락 청크 건너뛰기 규칙(STT-01) 유지.
- `stt_task._transcribe_batch`/`_call_whisper`: 하드코딩 `audio/webm`/`.webm` 대신 병합 결과의 mime·확장자 사용. 길이 추정(`AUDIO_CHUNK_SECONDS`) 유지.
- 리플레이: 현재 오디오 리플레이 엔드포인트 없음(영상만 `video.py`). 비범위 — 그러나 음성 단독 재생이 필요해지는 경우를 위해 `merge_chunks_for_stt` 를 재사용 가능한 서비스로 둔다.
- 마이그레이션 없음(스키마 불변). alembic head 불변 확인만.

## 4. 파일 소유권 (트랙 간 겹침 금지)
| 트랙 | 브랜치 | 소유 파일 |
|---|---|---|
| BE | `sdd/247-be` | `backend/app/services/audio_service.py`, `backend/app/services/audio_merge_service.py`(신규), `backend/app/tasks/stt_task.py`, `backend/tests/test_audio_*.py`(신규 `test_audio_formats.py`) |
| FE 브리지 | `sdd/247-fe` | `frontend/src/lib/native-audio-recorder/{index.ts,*.test.ts}`(types.ts 는 읽기 전용), `frontend/src/hooks/useAudioRecorder.ts` + 테스트, `frontend/src/lib/api/client.ts` 의 토큰 getter 노출이 필요하면 최소 추가만 |
| iOS | `sdd/247-ios` | `frontend/ios/App/App/AudioRecorder/**`(신규: 플러그인·엔진·큐·업로더), `frontend/ios/App/App.xcodeproj/project.pbxproj`(파일 등록), `frontend/ios/App/App/Info.plist`·`AudioSessionConfig.swift`(필요 시), 단위 시험 |
| Android | `sdd/247-android` | `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/audiorecorder/**`(신규), `MainActivity.java`(플러그인 등록 1줄), `AndroidManifest.xml`(필요 시), `app/src/test/**/audiorecorder/**` |
공통 금지: `types.ts`, `contracts/`, `MeasurementService.kt`/측정 모듈(변경 필요 시 감독에 보고, 변경하면 plan 에 이유 기록). Android 는 PR #125 의 FGS microphone 타입을 그대로 쓴다(JS `useHostBackgroundSession` 변경 없음).

## 5. 병합 순서
각 트랙 브랜치 → `sdd/247-native-bg-recording`(통합) 순서: BE → FE → Android → iOS. 충돌 가능 파일 없음(표 기준). pbxproj 는 iOS 단독.

## 6. 위험
- 서버 ffmpeg 미설치 시 STT on 에서 m4a 병합 실패 → BE 트랙이 가용성 확인·문서화(STT 현재 off).
- iOS 백그라운드 업로드는 앱 오디오가 살아 있는 동안만 보장, 시험은 TestFlight 실기기 필요(Brian).
- refresh 토큰 회전 경합(JS vs 네이티브): updateCredentials + 4xx 시 큐 보존으로 완화.
