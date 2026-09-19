# 프리뷰 카메라·마이크 개별 오프 + AI 분석 제어 — 기술 기획서

> 작성일: 2026-09-19
> 대상: MVP1 세션 프리뷰(SDD-083) · 음성 녹음(SDD-013) · 영상 녹화(SDD-084) · STT/AI 요약 파이프라인
> 성격: 구현 전 상세 기획 (본 문서는 기획서이며 구현을 포함하지 않음)

---

## 1. 배경 및 목적

- 클래스(수업/상담) 현장에서 부득이하게 카메라 또는 마이크를 켤 수 없는 상황이 존재함
  - 예: 대면 수업에서 녹화 불가 정책, 내담자 요청, 장소 소음, 장치 고장, 프라이버시 사유
- 현재 구조는 **카메라+마이크가 항상 켜진다는 전제**로 설계됨
  - 프리뷰: `getUserMedia({ video, audio: true })` 를 항상 동시 요청 (`SessionPreJoinPreview.tsx:77-80`)
  - 녹음 시작: 동의 모달 확인 시 `startAudio(id, true)` + `startVideo(id, true)` 를 무조건 호출 (`SessionLivePage.tsx:412-429`) — consent 값이 `true` 하드코딩
- 목적
  1. 프리뷰 화면에서 **카메라·마이크를 개별적으로 오프**할 수 있게 한다
  2. 마이크 오프 시 **AI 분석(STT·요약)이 제한됨을 사전 안내**한다
  3. 마이크 오프 세션에서는 **음성 녹음·STT·AI 요약을 실행하지 않는다** (수동 기록 모드)
  4. 카메라 오프 세션에서는 **영상 녹화를 실행하지 않는다**

---

## 2. 현황 분석 (코드 근거)

### 2.1 프리뷰 — `SessionPreJoinPreview.tsx`

- 세션 시작 전(`ready`/`scheduled`) `SessionLivePage`가 렌더 (`SessionLivePage.tsx:702-713`)
- `getUserMedia({ video: { facingMode }, audio: true })` — **비디오·오디오를 한 번에 요청**, 개별 오프 수단 없음
- 로컬 프리뷰 전용: 서버 전송·저장 없음 (컴포넌트 주석 명시)
- 상태: `pending / granted / denied / unsupported` — 권한 거부·미지원 시에도 "그래도 시작" 버튼으로 세션 시작 가능
- 마이크 레벨 미터: `AudioContext` + `AnalyserNode` RMS (`micLevel`)
- 시작 확정(`handleStart`) 시 `stopStream()` 후 `onStart()` → `transitionSession(id, 'start')` 호출
- **프리뷰에서 결정된 어떤 장치 상태도 이후 단계(녹음/녹화)로 전달되지 않음** — `onStart: () => void` 시그니처에 매체 정보 없음

### 2.2 음성 녹음 — `useAudioRecorder.ts` + `audio.py`

- FE: `getUserMedia({ audio: true })` → `MediaRecorder`(`audio/webm;codecs=opus`) → **5초 청크** → `POST /sessions/{id}/audio/chunk`
- BE (`audio_service.py`):
  - `POST /audio/start`: `consent_audio=false` 이면 **400 에러** ("음성 녹음 동의가 필요합니다") — 현재 "동의 안 함"을 상태로 기록할 방법이 없음 (`audio_service.py:53-55`)
  - start 성공 시 `SessionRecord.status='recording'`, `recording_started_at` 기록
  - `POST /audio/chunk`: `status`가 `recording/processing`이 아니면 400. 청크는 로컬 디렉토리(`AUDIO_CHUNK_DIR`) 저장 + `AudioChunk` 행 생성
  - `POST /audio/stop`: `status='processing'` 전이 후 Celery chain(`stt_task → summary_task`) 시도, 실패 시 인라인(`run_stt_inline`/`run_summary_inline`) 실행
    - 참고: `stop_recording`에서 참조하는 `stt_task`/`summary_task` 심볼이 모듈에 임포트되어 있지 않아(NameError) 현재는 **항상 인라인 폴백으로 실행됨** (`audio_service.py:109-120`)
- 세션 종료 연동: `transition_status('end')` → `audio_service.finalize_on_session_end()` (`session_service.py:364-369`)
  - **`record.status == 'recording'`일 때만** processing 전이 + STT/요약 인라인 실행 (`audio_service.py:131-143`)
  - 즉, `startAudio`를 아예 호출하지 않으면(=status `idle` 유지) 세션 종료 시 STT/요약이 **이미 실행되지 않는 구조**

### 2.3 영상 녹화 — `useVideoRecorder.ts` + `video.py`

- FE: `getUserMedia({ video: { facingMode }, audio: true })` — **영상 스트림에도 오디오 트랙 포함**(128kbps) → `MediaRecorder`(`video/webm;codecs=vp8,opus`) → **3초 청크**(2Mbps, 청크당 ~1MB) → `POST /sessions/{id}/video/chunk`
- 상담사(host) 본인 카메라만 녹화 — 내담자 영상·음성 저장 금지 (프라이버시 정책, `video_service.py` 모듈 주석)
- BE (`video_service.py`):
  - `POST /video/start`: `consent_video=false` 이면 400. 성공 시 `SessionRecord.video_status='recording'`
  - 청크는 S3 우선(`video/{session_id}/...`), 자격증명 미설정 시 로컬 폴백
  - stop은 멱등(`recording`일 때만 `completed` 전이). **영상에는 후처리(STT 등) 파이프라인 없음**
- 세션 종료 시 `video_service.finalize_on_session_end()`가 녹화 중이면 자동 종료 (`session_service.py:370-375`)

### 2.4 녹음 시작 플로우 — `SessionLivePage.tsx` + `ConsentModal.tsx`

- 진행 중 화면의 녹음 컨트롤 시작 → `handleStartClick` → (온라인이면 LiveKit 연결) → `ConsentModal` 오픈
- `ConsentModal`: **음성 녹음 동의 단일 모달**. "동의하지 않으시면 수동 기록 모드로 진행됩니다" 문구는 있으나, 취소 시 아무 상태도 기록되지 않고 그냥 닫힘 (영상 녹화 동의 항목은 UI에 없음)
- 확인(`handleConsentConfirm`) 시:
  1. `startAudio(id, true)` → `recorder.start()` (음성)
  2. `startVideo(id, true)` → `videoRecorder.start()` (영상, 실패해도 음성은 유지 — 비치명 처리)
- 종료(`finishSession`) 시 녹음/녹화 중이면 `handleStop` → `stopAudio`/`stopVideo` → `transitionSession(id, 'end')`

### 2.5 STT·AI 요약 — `stt_task.py` / `summary_task.py`

- STT(`run_stt_inline`): `AudioChunk` 전체를 병합 → Whisper API(`whisper-1`, ko) → segments → `record.transcript` + `ai_summary.segments` 저장
  - **청크가 0개여도 실행됨** — `OPENAI_API_KEY` 미설정 시 `_generate_stub()`이 **가짜 대화 4줄을 transcript로 저장** (`stt_task.py:87-98`). 마이크 오프 세션에 허위 전사가 남을 수 있는 구조적 위험
- 요약(`run_summary_inline`): Deepseek(폴백 스텁)로 `transcript` 요약 → `ai_summary` 병합 + `record.status='completed'`
  - transcript가 `None`이어도 "(전사 기록 없음)"으로 LLM 호출/스텁 실행됨 (`summary_task.py:123, 198-201`)
- 리포트(`report_task.py`): `POST /reports` 요청 시 온디맨드 생성. EEG는 opt-in(`status="not_measured"`) 설계로 이미 "없으면 섹션 숨김" 계약 존재 — **음성/AI 요약에는 이에 상응하는 상태 계약이 없음**

### 2.6 데이터 모델 — `record.py`

- `SessionRecord.status`: `idle / recording / processing / completed / failed` — "동의 안 함(수동 기록)" 상태 없음
- 음성 트랙(`status`, `recording_*`)과 영상 트랙(`video_status`, `video_recording_*`)은 이미 분리 운영 (SDD-084)
- 카메라/마이크 동의·오프 여부를 기록하는 컬럼 없음 → 사후에 "AI 요약이 왜 없는지"(마이크 오프 vs 처리 실패)를 구분할 수 없음

### 2.7 현황 요약 (갭)

| # | 갭 | 근거 |
|---|----|------|
| G1 | 프리뷰에 카메라/마이크 개별 토글 없음 | `SessionPreJoinPreview.tsx:77-80` |
| G2 | 프리뷰 결정이 세션(녹음/녹화)으로 전달되지 않음 | `onStart: () => void` |
| G3 | 동의 모달이 음성 단일 항목, consent 값 하드코딩 `true` | `ConsentModal.tsx`, `SessionLivePage.tsx:416,424` |
| G4 | `consent_audio=false`는 400 에러 — "미동의"를 기록할 수 없음 | `audio_service.py:53-55` |
| G5 | 청크 0개여도 STT가 돌아 스텁 가짜 전사가 저장될 수 있음 | `stt_task.py:87-98` |
| G6 | 수동 기록 모드를 나타내는 SessionRecord 상태 없음 | `record.py:18` |
| G7 | 마이크 오프 시 AI 분석 제한 안내 UX 부재 | 전체 |

---

## 3. 요구사항 정의

### 3.1 기능 요구사항

- FR-1: 프리뷰 화면에서 카메라를 단독으로 끌 수 있다 (마이크 유지)
- FR-2: 프리뷰 화면에서 마이크를 단독으로 끌 수 있다 (카메라 유지)
- FR-3: 마이크 오프 선택 시 "AI 분석(자동 기록·요약) 제한" 안내가 즉시 표시된다
- FR-4: 프리뷰에서 결정한 카메라/마이크 상태가 세션 시작 이후의 녹음·녹화 동작에 그대로 적용된다
- FR-5: 마이크 오프 세션에서는 음성 녹음(getUserMedia/MediaRecorder/청크 업로드)·STT·AI 요약이 실행되지 않는다
- FR-6: 카메라 오프 세션에서는 영상 녹화(getUserMedia/청크 업로드)가 실행되지 않는다
- FR-7: 마이크 오프 세션의 기록 화면은 "수동 기록 모드"로 표시되고, 상담사 수동 노트(`counselor_notes`) 작성은 정상 동작한다
- FR-8: 권한 거부(denied)와 자발적 오프(off)는 구분되어 표시된다 (거부는 브라우저 설정 안내, 오프는 재켜기 토글)

### 3.2 비기능 요구사항

- NFR-1: 카메라/마이크 오프는 **세션 진행 자체를 막지 않는다** (LINK BAND 선택적 사용과 동일한 opt-in 원칙 — `.claude/rules/architecture.md` "필수 ↔ 선택" 분리 원칙 준수)
- NFR-2: 오프 상태에서는 해당 장치의 하드웨어 접근(트랙)을 실제로 중지한다 — 브라우저 캡처 표시등이 꺼져야 사용자가 신뢰 가능
- NFR-3: 마이크 오프 세션에 허위(스텁) 전사·요약이 저장되지 않아야 한다 (데이터 무결성)
- NFR-4: 기존 세션(카메라 ON + 마이크 ON) 플로우는 동작 변화가 없어야 한다 (하위 호환)

### 3.3 범위 제외 (본 기획 1차 범위 아님)

- 세션 진행 중 카메라/마이크 재켜기/끄기 토글 (프리뷰 결정을 세션 전체에 적용하는 것이 1차 범위 — §4.4 참고)
- 내담자(참가자) 측 장치 제어 — 현재 녹음·녹화 주체는 호스트(상담사) 단독
- LiveKit 화상회의 내부의 mute/카메라오프 (LiveKit 자체 컨트롤 존재, 녹화 파이프라인과 별개)

---

## 4. UX 설계

### 4.1 프리뷰 화면 토글 배치

- 위치: 프리뷰 비디오 타일 하단 중앙에 **원형 토글 버튼 2개** (Zoom/Meet 프리조인 관례)
  - `[🎥 카메라]` `[🎤 마이크]` — ON: 보라(`#5F0080`) 계열, OFF: 회색 배경 + 사선 아이콘 + 빨간 점 배지
- 우측 패널(기존 마이크 레벨 미터·카메라 전환 버튼 영역)에 상태 텍스트 병기
  - 카메라 OFF 시: "후면 카메라로 전환" 버튼 비활성
  - 마이크 OFF 시: 레벨 미터를 회색 처리 + "마이크 꺼짐" 라벨로 대체
- 비디오 영역 표시
  - 카메라 OFF: 검은 타일 + 사용자 이니셜/아이콘 + "카메라가 꺼져 있습니다" 문구 (스트림의 비디오 트랙 stop)
  - 마이크 OFF: 비디오는 유지, 타일 좌상단에 `🎤 꺼짐` 배지 오버레이

### 4.2 오프 시 안내 표시

- **마이크 OFF 즉시**: 토글 아래에 경고 배너(노란색, `bg-amber-50` 계열) 고정 표시
  - 본문: §7 문구 M-1
  - AI 분석이 무엇인지 1줄 부연: "자동 전사(STT)·AI 요약·AI 기록지가 생성되지 않습니다"
- **카메라 OFF 즉시**: 정보 배너(회색, 경고 아님)
  - 본문: §7 문구 C-1 — 카메라는 AI 분석과 무관하므로 경고 톤을 쓰지 않음 (경고 인플레이션 방지)
- **시작 버튼 위 요약 라인**: 현재 조합의 결과를 1줄로 요약 (§7 문구 S-1~S-4)
  - 예: "🎥 녹화 안 함 · 🎤 녹음/AI 분석 안 함 — 수동 기록 모드로 진행됩니다"
- 마이크 OFF 상태로 "세션 시작" 클릭 시: **확인 다이얼로그 1회** (§7 문구 M-2) — 실수 방지, "그래도 시작 / 마이크 켜기" 2버튼

### 4.3 권한 거부(denied)와 자발적 오프 구분

- `denied`/`unsupported`: 기존 폴백 화면 유지 (브라우저 권한 설정 안내 + "그래도 시작") — 이 경로는 사실상 카메라 OFF + 마이크 OFF와 동일하게 처리 (§5 상태 머신의 D조합으로 시작)
- 자발적 OFF: 토글로 즉시 재켜기 가능. 재켜기 시 `getUserMedia` 재요청 없이 기존 스트림 트랙 재사용이 불가하므로(트랙 stop 방식) 스트림 재요청
- 부분 권한(카메라만 거부, 마이크만 거부): `getUserMedia`를 비디오/오디오 **분리 요청**으로 변경해 개별 실패를 개별 상태로 매핑 (§8.1 FE-1 참고)

### 4.4 세션 시작 이후 화면

- 프리뷰 결정은 세션 전체에 적용 (1차 범위)
- 카메라 OFF로 시작한 세션: `SessionHostVideoView`(셀프뷰) 대신 "카메라 꺼짐 · 녹화 안 함" 플레이스홀더 카드 표시
- 마이크 OFF로 시작한 세션:
  - 녹음 컨트롤(`RecordingControls`) 영역을 "수동 기록 모드" 안내 카드로 대체 (§7 문구 M-3) — 녹음 시작 버튼 미노출
  - `ConsentModal` 미표시 (녹음 자체가 없으므로 음성 녹음 동의 절차 불필요)
- 마커(`MarkerButton`)는 녹음 여부와 무관하게 유지 (수동 기록 보조 수단으로 오히려 중요도 상승)

---

## 5. 동작 규칙 — 상태 머신

### 5.1 프리뷰 장치 상태

```
cameraState: on | off | denied | unsupported
micState:    on | off | denied | unsupported
```

- 초기값: 권한 획득 성공 시 둘 다 `on`, 개별 실패 시 해당 장치만 `denied`
- `denied`/`unsupported`는 동작상 `off`와 동일하게 취급하되 UX 안내만 다름 (§4.3)
- 시작 시 `onStart({ cameraOn, micOn })` 형태로 SessionLivePage에 전달 → 세션 로컬 상태로 보관

### 5.2 조합별 동작 매트릭스

| 조합 | 카메라 | 마이크 | 영상 녹화 (video/start + useVideoRecorder) | 음성 녹음 (audio/start + useAudioRecorder) | STT·AI 요약 | SessionRecord 최종 상태 | 비고 |
|------|--------|--------|------|------|------|------|------|
| A | ON | ON | ✅ 실행 | ✅ 실행 (동의 모달 경유) | ✅ 실행 | `status=completed`, `video_status=completed` | 현행과 동일 (하위 호환) |
| B | OFF | ON | ❌ 미실행 (`startVideo` 미호출) | ✅ 실행 | ✅ 실행 | `status=completed`, `video_status=idle` | 영상만 없음. 녹화 스트림 자체를 열지 않음 |
| C | ON | OFF | ✅ 실행 — 단 `getUserMedia({audio:false})`로 **무음 영상** | ❌ 미실행 (`startAudio` 미호출) | ❌ 미실행 | `status=manual`(신규), `video_status=completed` | 영상에 오디오 트랙이 섞이면 "마이크 오프" 약속 위반 → 반드시 audio:false |
| D | OFF | OFF | ❌ 미실행 | ❌ 미실행 | ❌ 미실행 | `status=manual`, `video_status=idle` | 수동 기록 모드. 마커 + 수동 노트만 |

- 조합 C 핵심 규칙: `useVideoRecorder.openStream`은 현재 `audio: true` 고정 (`useVideoRecorder.ts:91`) → 마이크 OFF 시 `audio: false`로 요청해야 함. MediaRecorder mime도 오디오 트랙 없는 스트림에 대응(`vp8,opus` mime은 오디오 트랙 없어도 동작하나 명시적 분기 권장)
- 조합 C/D에서 `ConsentModal`(음성 동의)은 표시하지 않음 — 동의 대상 행위(녹음)가 없음
- 조합 B에서 영상 동의 UI가 필요해지면 `ConsentModal`을 음성/영상 2항목 체크로 확장 (2차, §8.3)

### 5.3 상태 전이 규칙

- 프리뷰 → 세션 시작: 토글 확정 값이 유일한 진입 입력. 시작 후 변경 불가(1차)
- 세션 종료(`transition_status('end')`):
  - 조합 A/B: 현행 유지 — `finalize_on_session_end`가 `recording`이면 STT·요약 실행
  - 조합 C/D: `record.status='manual'` → `finalize_on_session_end`의 `status != 'recording'` 가드에 걸려 **STT·요약 자연 스킵** (현행 코드 그대로 동작, 근거: `audio_service.py:133-135`)
- 에러 폴백: 마이크 ON인데 `recorder.start()` 실패(장치 점유 등) → 현행대로 `state='error'` + 에러 배너. 자동으로 manual 모드 전환하지 않음 (사용자가 인지하고 재시도하도록)

---

## 6. 백엔드 설계

### 6.1 분기 지점 결정

- **원칙: "실행하지 않는 것"은 FE가 API를 호출하지 않는 것으로 1차 달성하고, BE는 상태를 기록·방어한다**
  - 이미 `finalize_on_session_end`는 `status=='recording'`일 때만 STT를 실행하므로, `audio/start` 미호출 시 파이프라인은 돌지 않음 (코드 근거 §2.2)
  - 단, "안 돈 이유"를 데이터로 남기지 않으면 기록/리포트 화면에서 실패와 구분 불가 → 명시적 상태 기록 필요

### 6.2 API 변경

- `POST /sessions/{id}/audio/start` — `consent_audio: false` 의미 변경
  - 현행: 400 에러 (`audio_service.py:53-55`)
  - 변경: `consent_audio=false` 수신 시 녹음을 시작하지 않고 `SessionRecord.status='manual'` 기록 후 200 응답 (`{status: "manual"}`)
  - 사유: "마이크 오프 결정"을 서버에 명시적으로 남기는 단일 경로. FE는 마이크 OFF 세션 시작 직후 이 API를 1회 호출해 선언
  - 이후 `audio/chunk` 호출은 현행 가드(`status not in ("recording","processing")` → 400)가 그대로 차단
  - `status='manual'`인 세션에 다시 `consent_audio=true`로 start가 오면 `recording`으로 전이 허용 (2차에서 세션 중 재켜기를 열어둘 수 있는 여지, 1차에서는 FE가 호출하지 않음)
- `POST /sessions/{id}/video/start` — 변경 없음 (카메라 OFF 시 FE가 미호출, `video_status='idle'` 유지로 충분. 영상은 AI 파이프라인이 없어 상태 구분 실익이 낮음)

### 6.3 SessionRecord 상태 확장

- `status` 허용값: `idle / recording / processing / completed / failed` + **`manual` 추가**
  - `manual`: 마이크 오프(음성 미동의) 확정 — transcript·ai_summary 생성 대상 아님
  - String 컬럼이므로 DB 마이그레이션 불필요, 모델 주석·스키마 문서만 갱신
- 대안 검토 (채택하지 않음)
  - (a) `consent_audio`/`consent_video` Boolean 컬럼 추가: 상태와 동의를 이중 관리하게 되어 정합성 부담 — status 단일 축 유지가 단순
  - (b) 별도 `POST /audio/decline` API: 엔드포인트 증가 대비 이득 없음 — 기존 start의 payload 의미 확장으로 충분

### 6.4 파이프라인 방어 가드 (스텁 오염 방지)

- `run_stt_inline` (`stt_task.py:110`):
  - 가드 1: `record.status == 'manual'`이면 즉시 return (로그만)
  - 가드 2: `AudioChunk` 0개면 STT 실행하지 않고 `status='failed'`(또는 `completed` + `transcript=None`) 처리 — **현행처럼 스텁 가짜 대화를 transcript에 저장하는 경로 제거** (G5)
- `run_summary_inline` (`summary_task.py:185`):
  - 가드: `record.transcript`가 없으면(None/공백) 요약 LLM 호출·스텁 생성 없이 종료 — "(전사 기록 없음)"으로 LLM을 호출하는 현행 경로 제거
- `stop_recording`의 Celery/인라인 분기: `manual` 상태에서는 stop 자체가 호출되지 않으나(FE 미호출), 방어적으로 `status=='manual'`이면 no-op 처리

### 6.5 세션 종료 처리

- `transition_status('end')` (`session_service.py:364-375`): 변경 없음
  - `audio_service.finalize_on_session_end`: `status=='recording'` 가드로 manual 세션 자연 스킵 (현행)
  - `video_service.finalize_on_session_end`: `video_status=='recording'` 가드로 카메라 오프 세션 자연 스킵 (현행)

### 6.6 기록/리포트 조회 계약

- `GET /sessions/{id}/record` (`RecordResponse`): `status='manual'`이 그대로 내려감 — FE가 이 값으로 "수동 기록 모드" 화면 분기
- 리포트 생성(`report_service.generate_report` → `report_task.generate_report_inline`):
  - transcript 없음 → 요약 섹션은 EEG의 `status: "not_measured"` 패턴과 동일하게 **`ai_record: {status: "not_available", reason: "mic_off"}`** 계약 추가 (프론트 섹션 숨김 + 사유 표기)
  - EEG·마커·수동 노트 기반 리포트는 정상 생성 (EEG는 이미 opt-in 계약 존재 — `report_task.py` 모듈 주석)

---

## 7. 안내 문구 초안

| ID | 위치 | 문구 |
|----|------|------|
| M-1 | 프리뷰, 마이크 OFF 직후 경고 배너 | **"마이크를 끄면 AI 분석이 제한됩니다."** 음성이 녹음되지 않아 자동 전사(STT)·AI 요약·AI 기록지가 생성되지 않습니다. 세션 기록은 수동 작성 모드로 진행됩니다. |
| M-2 | 마이크 OFF 상태로 "세션 시작" 클릭 시 확인 다이얼로그 | 마이크가 꺼진 상태로 시작합니다. 이 세션에서는 음성 녹음과 AI 자동 기록·요약이 제공되지 않으며, 기록지는 직접 작성해야 합니다. 계속할까요? [마이크 켜기] [그대로 시작] |
| M-3 | 세션 진행 중, 녹음 컨트롤 대체 카드 | 이 세션은 마이크 꺼짐으로 시작되어 수동 기록 모드로 진행 중입니다. 마커와 상담사 노트로 기록을 남길 수 있습니다. |
| M-4 | 세션 기록 페이지 (`status='manual'`) | 이 세션은 마이크를 사용하지 않아 AI 자동 기록(전사·요약)이 없습니다. 아래에 상담사 노트를 직접 작성해주세요. |
| C-1 | 프리뷰, 카메라 OFF 직후 정보 배너 | 카메라를 끄면 이 세션의 영상이 녹화되지 않습니다. 음성 녹음과 AI 분석은 정상 제공됩니다. |
| S-1 | 시작 버튼 위 요약 (A: 둘 다 ON) | 🎥 영상 녹화 · 🎤 음성 녹음 + AI 자동 기록으로 진행됩니다 |
| S-2 | 시작 버튼 위 요약 (B: 카메라 OFF) | 🎥 영상 녹화 안 함 · 🎤 음성 녹음 + AI 자동 기록은 정상 제공됩니다 |
| S-3 | 시작 버튼 위 요약 (C: 마이크 OFF) | 🎤 음성 녹음·AI 분석 안 함(수동 기록) · 🎥 영상은 무음으로 녹화됩니다 |
| S-4 | 시작 버튼 위 요약 (D: 둘 다 OFF) | 녹화·녹음·AI 분석 없이 수동 기록 모드로 진행됩니다 |

- 톤 원칙
  - 마이크 관련은 **경고 톤**(기능 손실 발생), 카메라 관련은 **정보 톤**(AI 분석 무관)
  - "AI 분석"만 쓰지 않고 괄호로 구체 기능(전사·요약·기록지)을 병기 — 사용자가 잃는 것을 정확히 인지
  - 법적/동의 문구("30일 보관" 등)는 기존 `ConsentModal` 관할 유지, 프리뷰 배너에는 중복 기재하지 않음

---

## 8. 데이터 정합성

### 8.1 조합별 데이터 상태 (세션 종료 후)

| 조합 | SessionRecord | AudioChunk | VideoChunk | Report |
|------|--------------|-----------|-----------|--------|
| A | `status=completed`, transcript ✅, ai_summary ✅ | n개 | n개 | 요약+EEG(측정 시) 정상 |
| B | `status=completed`, transcript ✅ / `video_status=idle` | n개 | **0개** | 정상 (영상은 리포트 미포함 — 현행도 동일) |
| C | `status=manual`, transcript=null, ai_summary={} / `video_status=completed` | **0개** | n개(무음) | `ai_record.status="not_available"` + 수동 노트·마커·EEG만 |
| D | `status=manual`, transcript=null, ai_summary={} / `video_status=idle` | 0개 | 0개 | 수동 노트·마커·EEG만 |

### 8.2 무결성 규칙

- `status='manual'` 레코드에 transcript/ai_summary가 존재해서는 안 됨 — §6.4 가드가 보증 (스텁 경로 차단 포함)
- `counselor_notes`·`markers`·`edit_history`는 status와 무관하게 항상 쓰기 가능 (수동 기록 모드의 핵심 수단)
- 조합 C의 영상은 **무음(webm에 오디오 트랙 없음)**이어야 함 — FE `audio:false` 요청이 보증. QA 시 저장된 webm의 트랙 구성 검증 필요
- EEG 파이프라인은 본 기획과 완전 독립 (마이크/카메라 오프와 무관하게 LINK BAND opt-in 규칙 유지)
- 사후 판별 가능성: "AI 요약 없음"의 사유를 `status`로 구분 — `manual`(의도적 오프) vs `failed`(처리 실패) vs `processing`(진행 중)

### 8.3 하위 호환

- 기존 완료 세션(`completed`)·기존 API 응답 스키마 변경 없음 (status 값만 1개 추가)
- `RecordResponse.status`에 `manual`이 추가되므로 기록 페이지·리포트 페이지의 status 스위치 문에 케이스 추가 필요 (미처리 시 "알 수 없음"류 표시로 새지 않는지 FE 점검)

---

## 9. 구현 범위 및 단계

### Phase 1 — 프리뷰 토글 + 세션 연동 (FE 중심)

| ID | 태스크 | 대상 파일 | 내용 |
|----|--------|----------|------|
| FE-1 | 프리뷰 카메라/마이크 분리 요청 + 개별 토글 | `SessionPreJoinPreview.tsx` | `getUserMedia` 비디오/오디오 분리 요청, `cameraState`/`micState` 도입, 토글 UI, 트랙 stop/재요청, 부분 denied 매핑 |
| FE-2 | 오프 안내 UX | `SessionPreJoinPreview.tsx` | 경고/정보 배너(M-1, C-1), 시작 요약 라인(S-1~4), 마이크 OFF 시작 확인 다이얼로그(M-2) |
| FE-3 | 프리뷰 → 라이브 상태 전달 | `SessionPreJoinPreview.tsx`, `SessionLivePage.tsx` | `onStart({cameraOn, micOn})` 시그니처 확장, SessionLivePage 상태 보관 |
| FE-4 | 조합별 녹음·녹화 분기 | `SessionLivePage.tsx` | 마이크 OFF: ConsentModal·startAudio·recorder 미실행 + manual 선언 호출. 카메라 OFF: startVideo·videoRecorder 미실행 + 셀프뷰 플레이스홀더. 수동 기록 모드 카드(M-3) |
| FE-5 | 무음 영상 녹화 | `useVideoRecorder.ts` | `openStream`에 `withAudio` 옵션 추가 (조합 C에서 `audio:false`) |

### Phase 2 — 백엔드 상태 기록 + 파이프라인 가드 (BE 중심)

| ID | 태스크 | 대상 파일 | 내용 |
|----|--------|----------|------|
| BE-1 | `consent_audio=false` → `manual` 상태 기록 | `audio_service.py`, `schemas/record.py` | 400 대신 `status='manual'` 전이 + 200 응답, `manual`→`recording` 재전이 허용 |
| BE-2 | STT 가드 | `stt_task.py` | `manual` 스킵 + 청크 0개 시 스텁 저장 금지 (G5 제거) |
| BE-3 | 요약 가드 | `summary_task.py` | transcript 부재 시 LLM/스텁 미실행 |
| BE-4 | 리포트 계약 | `report_task.py` | `ai_record.status="not_available", reason="mic_off"` 블록 추가 (EEG `not_measured` 패턴 준용) |
| BE-5 | 모델 주석·상태값 문서화 | `models/record.py` | status 허용값에 `manual` 반영 |

### Phase 3 — 기록/리포트 화면 반영 (FE)

| ID | 태스크 | 대상 파일 | 내용 |
|----|--------|----------|------|
| FE-6 | 기록 페이지 수동 모드 표시 | 세션 기록 페이지 (`/sessions/{id}/record`) | `status='manual'` 분기: M-4 안내 + 전사/요약 섹션 숨김 + 노트 작성 유도 |
| FE-7 | 리포트 화면 | 리포트 페이지 | `ai_record.not_available` 섹션 숨김 + 사유 표기 |

### 후속 (본 기획 범위 외, 백로그)

- 세션 진행 중 마이크/카메라 재켜기 (BE-1의 `manual→recording` 재전이를 활용)
- `ConsentModal` 음성/영상 2항목 동의로 확장 (현재 영상 녹화는 별도 동의 UI 없이 시작됨 — 프라이버시 규칙상 검토 필요)
- `audio_service.stop_recording`의 Celery chain 미임포트(NameError로 상시 인라인 폴백) 수정 — 본 기획과 무관한 기존 결함이나 발견 사항으로 기록

### QA 체크리스트 (SDD verify 단계 초안, ≥3행)

1. 프리뷰에서 마이크만 OFF → 경고 배너 표시 → 시작 → ConsentModal 미표시·audio/start(`consent_audio=false`) 1회 호출·audio_chunks 0건·세션 종료 후 `status=manual`·transcript null 확인
2. 프리뷰에서 카메라만 OFF → 시작 → video/start 미호출·video_chunks 0건·음성 녹음/STT/요약은 정상 완료(`status=completed`) 확인
3. 카메라 ON + 마이크 OFF → 저장된 video webm에 오디오 트랙이 없는지(무음) 검증
4. 둘 다 ON(기존 플로우) → 현행과 동일하게 녹음·녹화·STT·요약 완료 (회귀 없음)
5. 둘 다 OFF → 녹화·녹음·AI 산출물 전무, 마커·상담사 노트 작성 정상
6. OPENAI_API_KEY 미설정 환경에서 마이크 OFF 세션 종료 → 스텁 가짜 전사가 저장되지 않는지 확인 (G5 회귀 방지)
7. 마이크 권한 브라우저 거부 상태 → denied 안내(권한 설정 유도)와 자발적 OFF 안내가 다르게 표시되는지 확인

---

## 부록 — 참조 코드 위치

| 영역 | 파일 |
|------|------|
| 프리뷰 | `frontend/src/components/session/SessionPreJoinPreview.tsx` |
| 세션 라이브 | `frontend/src/pages/sessions/SessionLivePage.tsx` |
| 음성 녹음 훅 | `frontend/src/hooks/useAudioRecorder.ts` |
| 영상 녹화 훅 | `frontend/src/hooks/useVideoRecorder.ts` |
| 동의 모달 | `frontend/src/components/session/ConsentModal.tsx` |
| 음성 API 클라이언트 | `frontend/src/lib/api/audio.ts` |
| 영상 API 클라이언트 | `frontend/src/lib/api/video.ts` |
| 음성 API/서비스 | `backend/app/api/v1/audio.py`, `backend/app/services/audio_service.py` |
| 영상 API/서비스 | `backend/app/api/v1/video.py`, `backend/app/services/video_service.py` |
| 세션 상태전이 | `backend/app/services/session_service.py` (`transition_status`) |
| STT | `backend/app/tasks/stt_task.py` |
| AI 요약 | `backend/app/tasks/summary_task.py` |
| 리포트 | `backend/app/tasks/report_task.py`, `backend/app/services/report_service.py` |
| 데이터 모델 | `backend/app/models/record.py` (`SessionRecord`, `AudioChunk`, `VideoChunk`) |
| 스키마 | `backend/app/schemas/record.py` (`AudioStartRequest.consent_audio`, `VideoStartRequest.consent_video`) |
