# 워커 브리프 — SDD-209 plan.md + verify.md 작성 (코드 조사 전담, 코드 수정 금지)

SDD 절차 중 ②Plan·③Verify 만 쓴다. **코드·시안 수정 금지, git 커밋·푸시 금지.** 쓰기 허용: `specs/sdd-209-class-flow-redesign/plan.md`, `verify.md`, `investigation/*.md` 뿐. 경로에 공백 → 따옴표. 저장소 루트 `ROOT=/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0` (develop, 최신).

## 먼저 읽을 것
1. `specs/sdd-209-class-flow-redesign/spec.md` (확정 결정 1~8, 범위, 코드 조사 항목)
2. `designs/class-flow-redesign/기획.md` (정본: 화면 FM/FH, §0 R1~R3, §9 가정 A1~A9·S6)
3. `designs/class-flow-redesign/survey/회원-화면조사.md`, `상담사-화면조사.md` (현행 파일:줄·문제점·API)
4. 시안 4종 `member-a.html member-b.html host-a.html host-b.html` — `?index=1` 인덱스 표와 `?screen=&case=` 프리셋, 구조(마크업·CSS 클래스)를 읽어 구현 컴포넌트 설계 참고
5. SDD-208 선례: `specs/sdd-208-class-player-redesign/{plan,verify,verify-changes}.md` — **같은 형식·깊이**로 쓴다. 구현 방식은 `~/.hermes/skills/software-development/sdd-workflow/references/large-ui-redesign-implementation.md` 가 있으면 따른다(새 컴포넌트 선추가 → 마지막에 호출부 교체, 구 컴포넌트는 마지막에 삭제, 하니스 `?case=` 로 시안과 같은 프리셋 렌더, 측정 스크립트 재사용: `frontend/e2e/class-player/`, `frontend/src/components/class/player/`).

## 조사 과제 (각각 `investigation/<번호>-<주제>.md` 에 근거(파일:줄·실행 결과)와 함께 정리 → plan에 요약)
- **I1 입장 모델 제거(A7)**: `/join`(class-join-page.tsx) 코드 경로·게스트 경로·by-code API(`/sessions/by-code/…`)·participant_token·게스트 참가자 생성 전부. 회원 입장 신규 경로(상세/홈/알림 → 입장 확인 → 사전 확인 마법사)로 대체 시 프론트·백엔드 변경 목록. **기존 데이터 호환**(과거 세션 access_code, 게스트 참가자 레코드) 보존 방안. 라우트 제거/리다이렉트 제안. 푸시·메일·딥링크에서 `/join?code=` 를 쓰는 곳 전수(grep).
- **I2 리포트 신청 OTP 제거**: `ReportEmailRequestPanel`, `POST /auth/email/request-otp·verify-otp`, `POST /sessions/{id}/report-email` — 회원 1탭 신청으로 바꿀 때 백엔드 변경 필요 여부.
- **I3 생성·예약(A2·A6)**: `SessionCreatePage`/`CreateSessionModal` 통합 마법사화, 예약 모달이 `location_type` 을 서버에 안 보내는 버그 위치, `duration_min` 5분 단위·시작 시각 5분 단위 검증(프론트/백엔드 제약), 초대 응답 DTO 에서 참여자 이름이 UUID 로 나오는 원인, 초대 알림 발송 경로와 실패 처리, 템플릿 저장, 시간 충돌 검사.
- **I4 열림·시작·준비 현황(A5·A9·S6)**: `ClassPlayerPage` 세팅/로비/시작 전 구간(`HostClassWorkspace`)과 `start`/`open`/`cancel` API, 시작 가능 판정(`activeCount`)과 대기실 presence(`useWaitingRoomPresence`, `waiting_room_changed` WS)·준비 단계(설문·밴드·기기) 전달 구조, **시작 후 입장하는 회원**(in_progress 에서 join 가능한가, 대기실 게이트를 건너뛰는 경로), 회원이 준비 중일 때 `in_progress` 수신 시 현행 동작(`class-join-page.tsx`), 알림 재전송·초대 추가 API 유무, 서버가 `start` 시 최소 인원을 요구하는지.
- **I5 밴드·전극(A8)**: `useBand`, `LeadOffStatus {ch1,ch2}`, `SensorTracker`, `LeadOffModal`, 상담사에게 전달되는 참가자 접촉 정보(`live-metrics`, `device_status`, WS) — 전극별(L·R) 접촉 상태가 상담사 화면까지 가는지, 없으면 변경 범위. `linkband_mode` 가 대기실/로비에서 반영되지 않는 문제(`ClassWaitingRoom` props) 수정 방안.
- **I6 기기·미디어**: 대기실 마이크·카메라·스피커 점검(`ClassWaitingRoom`, `class-waiting-room.ts`), 합친 "내 영상·소리" 컴포넌트 구현 방법(getUserMedia 레벨 측정 → 5단계 링), 오프라인에서 기기 단계 생략 조건, 칩 문구 구분(NotFound vs NotAllowed 버그), 상담사 `SessionPreJoinPreview` 대체.
- **I7 동의(A1)**: `ConsentModal`, `record_audio/record_video`, 회원 쪽 동의 저장 필드·API 유무, 시작 전 확인 시트로 옮길 때 변경 범위, 데이터 프라이버시 규칙(`.claude/rules/data-privacy.md` 있으면) 충돌 여부. **정책 결정이 필요한 것은 plan 의 "사용자 결정 필요" 로 분리**(기본값 제안).
- **I8 셸형 화면**: 회원 홈 히어로(`ClientHomePage`, `pickUpcomingClass`)의 입장 CTA 정합, 세션 목록(`ClientSessionListPage` 이중 렌더), 상세, 신청 모달(탭바 가림), 상담사 목록(`SessionListPage` open 클래스 사라짐), 상세(취소 확인 없음), 클래스 용어 치환 범위.
- **I9 대기열(A4)·시작 대기·종료**: `WaitingForStart`, 정원 초과 처리, 종료 씬(`MemberEndScene`, `HostEndingCard` 미연결), 리포트 진행(`ReportProgressStepper`, `/record` 점프) 연결.
- **I10 재사용 가능한 SDD-208 자산**: `components/class/player/shared`(PlayerShell/Sheet/Dock/StatusRing/NoticeOverlay 등), `player-tokens.css`, 하니스(`?case=`), 측정 스크립트 — 사전 흐름에서 그대로 쓸 수 있는 것과 새로 필요한 것. 디자인 토큰: 시안 `flow-base.css` 의 `fl-*`/`sh-*` 를 어떻게 코드의 토큰·컴포넌트로 옮길지(이름·위치·`pz-*` 와 통합 여부).

## plan.md 에 반드시 담을 것 (SDD-208 plan 과 같은 구조)
1. 목적·범위 한 줄 + 시안/케이스 → **구현 컴포넌트 매핑표**(화면 ID × 케이스 × 코드에 있음/일부/없음 × 담당 파일)
2. **변경되는 현행 동작 목록**(회원이 체감하는 변경, 제거되는 기능)
3. **백엔드 변경 목록**(엔드포인트·모델·마이그레이션·호환·테스트) — 필요 최소, 기존 데이터 보존, 각각 `필수/권장/보류` 분류. 프론트만으로 가능한 대체안도 병기
4. **사용자 결정 필요 항목**(비즈니스·정책만. 기술 선택은 plan 이 기본값 제안): 예) 동의 저장 정책, 게스트 경로 제거 시 기존 공유 링크 처리, 시작 후 입장 허용 범위 등. 각 항목 옵션·기본값·영향
5. **Task 분해**: 공용 기반(T0~) → 회원 트랙 / 상담사 트랙 / 백엔드 트랙을 **서로 다른 브랜치·worktree 로 병렬** 가능하게 파일 소유권 분리(충돌 지점 명시), 통합(I1~I3: 호출부 교체 → 전 케이스 측정 → dev 배포·구 컴포넌트 삭제). 각 Task 의 산출 파일·테스트·완료 기준·예상 규모
6. 하니스·측정: 시안 `?case=` 프리셋을 코드 하니스로 옮기는 방법(SDD-208 `player-harness` 확장), 4뷰포트 대칭·fit 측정 재사용
7. 위험·롤백(호출부 교체 커밋 1개 되돌리면 복귀 등), CI 영향(`e2e/full-journey.mjs` 스모크가 `/join?code=` 를 쓰므로 갱신 필요 — 실제 CI 파일 확인), 배포 순서(백엔드 먼저/프론트 동시), 마이그레이션 위험

## verify.md (구현 전 QA 게이트 — SDD-208 verify 와 같은 형식)
- 화면×케이스별 합격 시나리오(시안 `?case=` 와 1:1), 상태 전이(시작 중 회원 준비 단계 → started 시트 등), 권한(회원/상담사/org_admin), 기존 데이터(과거 세션·게스트) 호환 시나리오, 백엔드 테스트 목록, E2E 시나리오(스모크 갱신 포함), 측정 게이트(4뷰포트 스크롤 0·12px·터치 44·균형 S1~S10·이모지/글리프 0·금지 용어 0·코드/귀/게스트/OTP/QR 0), 회귀(진행 화면 SDD-208 케이스 M01~M21/C01~C18 유지), 실기기 체크리스트(iPhone/iPad/Android/데스크톱 Chrome: 마이크·카메라 권한, 밴드 접촉 UI, 시작 후 입장).
- **구현 후 완화 금지** 규칙을 파일 상단에 명시.

## 규칙
- 근거 없는 주장 금지: 확인 못 한 것은 `미확인`. 추측으로 채우지 마라. 백엔드는 실제 모델·라우터 코드(`backend/app/`)를 읽고 파일:줄을 달아라.
- 사용자가 이미 정한 8개 결정(spec)은 뒤집지 마라. 충돌이 있으면 "결정 충돌" 로 분리 보고.
- 완료 보고에 숫자로: plan/verify 줄 수, investigation 문서 수, 백엔드 변경 필수/권장/보류 개수, 사용자 결정 필요 개수, Task 개수·트랙 수, 확인하지 못한 것.
