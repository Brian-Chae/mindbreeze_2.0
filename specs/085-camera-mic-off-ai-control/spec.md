# SDD-085 — 프리뷰 카메라·마이크 개별 오프 + AI 분석 제어

> 상세 기획: `docs/camera-mic-off-ai-analysis-기획.md` (반드시 먼저 읽고 구현)
> 클래스에서 카메라/마이크를 부득이하게 못 켜는 상황 대응. **claude(fable) 위주 개발**.

## 1. 요구 (Brian)
1. 프리뷰 화면에서 카메라·마이크를 **개별 오프** 가능
2. 마이크 오프 시 **"AI 분석이 제한될 수 있음" 안내**
3. 마이크 꺼진 상태에서는 **AI 분석(음성 녹음·STT·요약) 미실행**
4. 카메라 오프 시 영상 녹화 미실행

## 2. 핵심 설계 (기획서 요약)
- **4가지 조합** (기획서 §5.2 매트릭스):
  - A(카메라 ON+마이크 ON): 영상+음성+AI 정상 (현행 유지)
  - B(카메라 OFF+마이크 ON): 영상 없음, 음성+AI 정상
  - C(카메라 ON+마이크 OFF): **무음 영상**(audio:false)만, 음성+AI 없음
  - D(둘 다 OFF): 수동 기록 모드 (녹화·녹음·AI 모두 없음)
- **`SessionRecord.status = 'manual'` 신규 상태** (마이크 오프 기록)
  - `consent_audio=false` → 400 대신 `status='manual'` + 200 응답
  - `manual` 상태에서는 STT·요약 자연 스킵 (기존 `status=='recording'` 가드 재사용)
- **스텁 오염 방지** (기획서 §6.4):
  - STT: `manual` 스킵 + 청크 0개면 스텁 저장 금지
  - 요약: transcript 없으면 LLM/스텁 미실행

## 3. 구현 범위 (기획서 §9)

### Phase 1 — FE 프리뷰 토글 + 세션 연동
- FE-1: `SessionPreJoinPreview.tsx` — getUserMedia 비디오/오디오 분리 요청, cameraState/micState, 토글 UI, 트랙 stop/재요청, denied 매핑
- FE-2: 오프 안내 UX — 경고/정보 배너 + 시작 요약 라인 + 마이크 OFF 확인 다이얼로그 (기획서 §7 문구 M-1~S-4)
- FE-3: `onStart({cameraOn, micOn})` 시그니처 확장 → SessionLivePage 상태 보관
- FE-4: 조합별 분기 — 마이크 OFF: ConsentModal·startAudio·recorder 미실행 + manual 선언. 카메라 OFF: startVideo 미실행 + 셀프뷰 플레이스홀더 + 수동 기록 카드(M-3)
- FE-5: `useVideoRecorder.ts` — `openStream`에 `withAudio` 옵션 (조합 C에서 audio:false)

### Phase 2 — BE 상태 기록 + 파이프라인 가드
- BE-1: `audio_service.py` — `consent_audio=false` → `status='manual'` + 200 응답
- BE-2: `stt_task.py` — `manual` 스킵 + 청크 0개 시 스텁 저장 금지
- BE-3: `summary_task.py` — transcript 부재 시 LLM/스텁 미실행
- BE-4: `report_task.py` — `ai_record.status="not_available", reason="mic_off"` 계약 (EEG not_measured 패턴)
- BE-5: `models/record.py` — status 허용값 `manual` 반영

### Phase 3 — FE 기록/리포트 화면
- FE-6: 기록 페이지 — `status='manual'` 분기 (M-4 안내 + 전사/요약 숨김 + 노트 작성 유도)
- FE-7: 리포트 화면 — `ai_record.not_available` 섹션 숨김 + 사유 표기

## 4. 주의
- NFR-1: 오프가 세션 진행 자체를 막지 않음 (opt-in 원칙)
- NFR-2: 오프 시 하드웨어 트랙 실제 stop (캡처 표시등 꺼짐)
- NFR-4: 기존 플로우(A 조합) 하위 호환
- 조합 C 영상은 반드시 무음(audio:false)
- `status='manual'` 추가 시 기록/리포트 페이지 status 스위치 문에 케이스 추가

## 5. 완료 기준
- 프리뷰 카메라/마이크 개별 토글 + 오프 안내 + 조합별 동작
- 마이크 오프 세션: 음성 녹음·STT·AI 요약 미실행, `status='manual'` 기록
- BE pytest 통과(신규 테스트 포함), FE build 0 error
- 기획서 QA 체크리스트(§9, 7개 항목) 검증
