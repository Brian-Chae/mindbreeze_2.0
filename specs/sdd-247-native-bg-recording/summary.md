# SDD-247 Summary — 앱 자체 백그라운드 수업 녹음(iOS·Android)

- 브랜치: `sdd/247-native-bg-recording` (PR #125 `fix/store-background-audio` 포함, origin/develop 병합 후)
- 작성일: 2026-10-26

## 구현 결과
| 트랙 | 커밋 | 내용 |
|---|---|---|
| BE | `2401608e`, `0b33fa03` | 청크 형식 매직 판별(m4a/webm, DB 변경 없음), `audio_merge_service` 형식별 병합(webm 연속은 바이트, m4a·혼재는 ffmpeg concat), STT mime 연동 |
| FE | `31e15eb2`, `00f7f213` | `NativeAudioRecorder` 래퍼 + `useAudioRecorder` 네이티브 위임(웹은 MediaRecorder 유지), 마이크 오프·일시정지·청크 인덱스·토큰 재인계 |
| Android | `b75435b5` | `AudioRecord` 연속 캡처 → 5초 AAC-LC m4a, 디스크 큐(200MB)·백오프 재시도·자체 refresh, FGS(microphone) 안에서 동작, API 24+ |
| iOS | `612475d5`, `764e08be`, `b589335d` | `AudioRecorderKit`(분할기·AAC 인코더·큐·토큰·업로더·상태기계) + `AVAudioEngine` 캡처 플러그인, 인터럽션 복구 |
| 배포 | `f5f3fb22` | `deploy/server-config.sh`·`userdata-base.sh` 에 ffmpeg 추가. dev EC2 는 10/26 설치(ffmpeg 6.1.1) |

## 계획과 달라진 점
- spec 의 "Android webm(API29+)" 대신 plan §0 결정대로 **iOS·Android 공통 m4a**. 이유: PCM 연속 캡처로 청크 경계 공백 0, API 24+ 지원, 서버 경로 단일화. 대가로 서버 병합에 ffmpeg 필요.
- iOS 순수 로직은 `frontend/ios/AudioRecorderKit/`(SwiftPM)로 분리해 `swift test` 로 시험(plan §4 경로와 다름).
- iOS 백그라운드 `URLSession`(앱 종료 후 전송)은 미구현 — 앱 종료 시 잔여 큐는 다음 실행 때 업로드.

## 디버깅
1. 검증용 APK 가 운영 API 를 호출 → 워크트리에 `frontend/.env*` 부재. 메인 체크아웃에서 복사(gitignore)하고 `--mode dev` + `VITE_LIVE_PROTOCOL_V2=true` 로 빌드.
2. 로그인 직후 크래시(`Default FirebaseApp is not initialized`) → 워크트리에 `google-services.json` 부재. 복사 후 해결. (설정 없는 빌드 방어는 후속 FIX)
3. **네이티브 녹음 미시작**: `resolveNativeAudioRecorder` 가 Capacitor 프록시를 async 로 반환 → Promise 가 `.then` 을 조회해 `NativeAudioRecorder.then() is not implemented` 로 reject. 위임 객체로 감싸 해결(`00f7f213`), 프록시를 흉내 낸 회귀 시험 추가(RED→GREEN). 기존 시험은 mock 객체라 못 잡았음.

## 시험
| 항목 | 결과 |
|---|---|
| backend pytest 전체 | 4641 passed, 515 skipped, 0 fail |
| alembic head | 1개(`e261026c0001`) |
| tsc | 0 |
| vitest 전체 | 17 fail / 8파일(기준선 동일), 3363 passed |
| swift test (AudioRecorderKit) | 20 passed |
| Android `assembleDevDebug testDevDebugUnitTest` | 성공(153건, 실패 0) |
| 16KB 정렬 | PASS |

### 실기기 V-Android (Note10, Android 12, dev API) — 합격
- 세션 `be82ac44-…`(대면 즉석, 초대 없음). 녹음 시작 20:33:04 → 화면 꺼짐 20:33:35 → deep idle 강제 약 85초 → 복귀 20:40:44.
- 청크 93개(0~92) 누락 0, 간격 최대 5.25초·평균 4.94초, 전 청크 m4a(`ftyp`), ffprobe 길이 합 459.7초 ≈ 실제 경과 460초.
- 감독 재검증(dev DB 읽기): 93개·누락 0·최대 간격 5.25초·`session_records.status=completed` 일치.
- 증거: `evidence/note10-v1.md`.

## 남은 일
- iOS 실기기(TestFlight) 화면 잠금 녹음 시험 — Brian 아이폰.
- 후속 FIX: 녹음 시작 실패가 화면에 드러나지 않음, Firebase 설정 없는 빌드 로그인 크래시 방어, 종료 버튼 잠김(1회 관찰, 재현 조건 불명).
- 스토어 심사 메모·Play FGS 선언 문안(`specs/fix-store-background-audio/review-notes.md`)을 네이티브 방식 기준으로 점검.
