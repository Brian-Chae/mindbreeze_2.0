# SDD-237 — 클래스 종료 후 상담사 화면 흐름 재설계

- 상태: **Stage ① 기획·디자인 검토안 / Brian 승인 대기**. 제품 구현·머지·배포 없음. SDD 완료 보고가 아님.
- 작성: 2026-10-23 · GPT Astra · 브랜치 `sdd/237-class-end-host-flow`
- 검토 기준: HEAD 및 로컬 origin/develop `c90ea4cb`. 서버·DB·환경파일·실사용자 데이터 미접근.
- 전제: **리포트 정상 발행은 Brian이 10/23 직접 검증 완료**. 본 기획은 발행 장애 수리가 아니라 종료 후 업무 연결 개선이다.
- 산출물: [인터랙티브 HTML 시안](../../designs/class-end-host-flow/index.html), [캡처 및 검증 안내](../../designs/class-end-host-flow/README.md).
- 표기: **현행**은 기준 커밋의 코드·문서 근거, **제안**은 승인 전 설계, **미확인**은 운영에서 실행 검증하지 않은 사항이다. 모든 시안 데이터는 합성 샘플이다.

## 1. 결론과 문제 정의

**추천: 클래스 종료 후 ‘회차 요약’을 기본 화면으로 제공한다. 참여자별 리포트와 비공개 진행 기록을 분리하고, 생성 중에도 기록 작성·목록 복귀가 가능하게 한다.**

상담사가 종료 직후 해결할 일은 ① 종료됐는지 확인 ② 누구의 결과가 준비됐는지 확인 ③ 필요한 기록을 남김 ④ 승인·전달 등 남은 일 파악 ⑤ 다음 일정이나 홈으로 복귀다. 이는 사용자 행동 조사 결과가 아니라, 기존 기획 F7/F8와 현재 기능으로부터 도출한 업무 가설이다.

현재 ‘기록 보기’가 유일한 주요 다음 행동인 탓에, 생성된 리포트를 볼 곳과 상담사가 직접 쓰는 기록지가 혼동된다. 기록 저장을 리포트 발행의 필수 선행 단계처럼 보이게 해서도 안 된다.

## 2. 현행 분석 — 실제 실행 경로와 문서의 차이

### 2.1 종료 버튼에서 어디로 가는가

| 단계 | 현재 동작 | 코드 근거(기준 커밋) |
|---|---|---|
| 진입 | `/sessions/:id/player`가 실제 플레이어. `/live`는 player로 replace 리다이렉트 | `frontend/src/App.tsx:240–243`, `pages/sessions/SessionLivePage.tsx:8–12` |
| 진행 중 종료 | HostLiveView의 actions.end → HostLiveContainer의 end.onRequest → EndSessionModal 확인 → 부모 finishSession | `components/class/player/host/HostLiveView.tsx:256`, `HostLiveContainer.tsx:368,454`, `pages/sessions/ClassPlayerPage.tsx:1357–1368` |
| 종료 확정 | 녹음/영상 stop, LiveKit disconnect, `transitionSession(id,'end')`, 응답으로 setSession. 일반 종료는 navigate 없음. 이탈 확인 경로의 leaveTo가 있을 때만 별도 목적지로 이동 | `ClassPlayerPage.tsx:1022–1052` |
| 상담사 완료 씬 | `isHost && (... || isEnded)` → HostPrepContainer phase=ending → EndingScene. **기록지로 자동 이동하는 것이 아니다** | `ClassPlayerPage.tsx:1384–1413`, `components/class/flow/host/HostPrepContainer.tsx:123–134` |
| 주요 CTA | EndingScene의 **기록 보기** → `/sessions/:id/record`. 완료 안내에는 ‘리포트는 기록에서 언제든 볼 수 있어요’ | `components/class/flow/host/EndingScreen.tsx:79–140`, `lib/class/flow/host-ending-model.ts:129`, `ClassPlayerPage.tsx:1519` |
| 기록지 | 클래스 메타 + 진행 상태 + RecordView. 이번 출시에서는 AI 요약·전사 탭 숨김, **상담사 메모만** | `pages/records/SessionRecordPage.tsx`, `components/records/RecordView.tsx:23–40`, `lib/features.ts`, SDD-228 summary |
| 리포트 | 별도 `/reports`, `/reports/:id`; 상담사/기관관리자 RoleGuard. 생성·승인·메일·코멘트는 리포트 영역의 책임 | `App.tsx:260–262`, `components/reports/ReportDetailView.tsx` |

주의: `ClassPlayerPage.tsx:1739` 이하의 일반 종료 JSX 및 `HostEndingCard.tsx`만 보고 상담사 현행을 대표시키면 안 된다. 상담사는 앞선 HostPrepContainer 분기에서 반환한다. 시안의 현행 화면은 **이 활성 경로의 구조·문구를 코드로 재현**한 것이며 실제 앱 스크린샷이 아니다.

### 2.2 기획과 출시 상태

- `docs/MIND_BREEZE_2.0_종합_기획.md:249–276`: 종료 → 기록 확인·편집·저장 → 내담자용 리포트 승인·발송이라는 초기 여정.
- `docs/MIND_BREEZE_2.0_기능명세서.md:F7.3,F8.1–F8.3`: 기록지는 편집 가능한 내부 산출물, 리포트는 전달용 결과. 초기 명세는 발송 전 명시 승인 원칙.
- `docs/MIND_BREEZE_2.0_개발_기획서.md:249–258`, `docs/AI_STACK_DECISION.md:30–41`: 기록 편집 API와 리포트 API 분리. 오래된 STT/요약 계획을 현재 출시 기능으로 안내하면 안 됨.
- `docs/class-entry-start-end-player-기획.md`: 독립 플레이어와 상태별 씬이라는 배경. 문서의 과거 ‘현황’은 현재 코드보다 우선하지 않음.
- `specs/sdd-228-disable-class-stt/summary.md`: **STT off**, 녹음 보존 및 리포트 생성은 유지. `stt_disabled`는 출시 정책이고 생성 실패가 아니다. 마이크 off의 `mic_off`와 구분.
- `docs/camera-mic-off-ai-analysis-기획.md`: 마이크 off 시 음성 기반 AI 기록 제외. EEG와 수동 기록은 별도.
- `docs/class-session-restructure/기획-상세-리포트.md §6–8`, `기획-상세-상담.md §1`: 명상 클래스와 1:1 상담은 상위 개체·여정이 다르고 엔진은 공유. 승인 대기 초안의 정책을 이미 구현된 사실로 쓰지 않음.
- `docs/report-counselor-comment-ai-draft-기획.md`: 내부 메모와 내담자 코멘트 구분이 유효. 해당 문서의 ‘승인이 메일을 예약하지 않음’은 현재 `report_service.approve_report`와 달라 **현행 사실로 채택하지 않음**.

### 2.3 근거 있는 UX 문제

| 문제 | 근거 | 영향 / 확실성 |
|---|---|---|
| 리포트 안내의 도착지가 내부 기록 편집기 | EndingScene → /record, RecordView는 메모 탭만 | 사용자가 결과를 기대하고 글쓰기 화면에 도착. 코드로 확인 |
| 회차 내 참여자별 결과로 이어지는 중심 화면 부재 | 활성 종료 씬에는 생성 단계·기록 CTA만 있고 참여자 리포트 목록이 없음 | 몇 명이 검토 대상인지 한눈에 파악하기 어려움. 기존 클래스 회차별 reports API는 재사용 가능 |
| 정책상 비활성화와 수동 모드 안내 혼선 가능 | `host-ending-model.ts:107–136`: stt skipped이면 manual로 간주, ‘내 메모로 리포트를 만들었어요’ 문구. EndingScene은 steps 전체 렌더 | SDD-228에서 skipped가 정상인데 음성 미사용/메모 반영을 단정할 수 있음. 코드 조건 확인, 실제 배포 화면 재현 미검증 |
| 생성 완료·승인·전달을 하나의 완료처럼 읽을 여지 | EndingScene 완료 칩과 ‘리포트 준비’ 중심. 생성 상태와 승인 상태는 별도 계약 | 생성 성공을 발송 성공으로 해석하지 않도록 설계 필요 |
| 기록 편집의 저장 확신·이탈 보호 부족 | `CounselorNotesTab.tsx:18–31,49–66`: 수동 저장/오류 표시 있음; 명시적 저장 완료·dirty 이탈 경고 없음 | 저장 여부 파악과 미저장 내용 보호 개선. 서버 저장 자체의 실패를 주장하지 않음 |

### 2.4 1:1 상담과 명상 클래스

현행 라우터는 클래스 회차(`/classes/:classId/sessions/:id`)와 상담 관계 내 세션(`/counseling/:relationshipId/sessions/:id`)를 분리하고 SessionDetailPage/플레이어 엔진을 공유한다(`App.tsx:234–243`). 종료 플레이어의 활성 상담사 분기에는 영역별 업무 IA가 없다.

제안은 **동일 요약 컴포넌트, 다른 우선순위**다. 명상은 ‘회차 요약 → 참여자 결과’를 우선, 상담은 ‘상담 요약 → 비공개 상담 기록 → 내담자 리포트’를 우선한다. 명상 인원 1명을 상담으로 간주하지 않는다. 영역 판정은 class_id/관계 ID 등 서버 도메인 정보 사용. 레거시 부모 없는 세션은 기존 session 상세·목록으로 복귀한다. 상담 게이트가 꺼진 출시에서는 해당 메뉴를 새로 열지 않는다.

## 3. 정보의 소유권과 용어

| UI 명칭 | 역할·공유 대상 | 데이터·연결 |
|---|---|---|
| **회차 요약** | 상담사의 운영 진입점. 종료 시각·참여·처리 상태·다음 할 일 | 세션 메타 + 회차 참여/리포트 요약. 새 공개 리포트를 생성하는 개념 아님 |
| **클래스 리포트(상담사용)** | 해당 회차 전체를 돌아보는 상담사 전용 결과 | 기존 type=counselor. 개인 결과를 섞은 공개 문서가 아니며 회원에게 발송하는 CTA 없음 |
| **참여자 리포트** | 각 참여자의 결과. 본인 것만 공유 | type=client, report_id/participant_id로 상세 이동. 이름으로 조인하지 않음 |
| **진행 기록 / 상담 기록** | 세션당 내부 메모. 명상에서는 진행 기록, 상담에서는 상담 기록 | SessionRecord.counselor_notes. `record_service.py:120–145`에서 비host에 counselor_notes 필드 제외. 편집이력은 아래 별도 확인 항목 참조. 개인별 비공개 메모 모델 신설은 범위 밖 |
| **참여자에게 전할 코멘트** | 리포트에 포함되는 공개 글 | ReportDetailView의 counselor_comment 편집. 비공개 메모 저장과 별도 동작 |
| **클래스 전체 추이** | 여러 회차의 추이 | 기존 클래스 상세로 이동. 종료 직후 단일 회차 요약에 혼합하지 않음 |

`report_task.py:365–415`는 counselor 리포트에만 내부 메모를 포함하고 client에는 넣지 않는다. 따라서 ‘비공개’는 **참여자에게 비공개**이며 작성자만 영구 독점 열람한다는 추가 권한 약속이 아니다. 생성 시점 스냅샷을 담은 counselor 리포트가 나중에 메모를 저장할 때 자동 동기화된다고 가정하지 않는다. 최신 기록은 기록 API를 원본으로 열람하며, 내부 메모 저장은 리포트 재생성·승인·발송을 호출하지 않는다.

**독립 검토에서 확인한 개인정보 경계(정적 코드 근거):** `record_service.py:148`의 edit_history 반환은 include_internal 조건 밖에 있고, `:175–181` 팀 열람 분기만 이력을 비운다. `:225`는 메모의 before/after를 이력에 저장한다. 따라서 모든 비host 경로에서 이력까지 차단됐다고 단정할 수 없다. 실제 접근 가능성은 RECORD_VIEW 권한·응답 스키마까지 포함한 구현 전 검증 항목으로 남긴다(운영 노출 검증 아님). 비공개 표시를 제품에 적용하기 전에 이력까지 포함한 권한별 차단을 확인해야 한다. 이번 기획 작업에서 제품 코드는 수정하지 않았다.

## 4. 권장 여정과 화면 전환 (제안)

```text
플레이어 ‘클래스 종료’ → 기존 종료 확인 → 서버 종료 성공
  → /sessions/:id/summary (신규 제안, replace)
      ├─ 개요: 종료 확인 + 남은 일 + 클래스 리포트 진입
      ├─ 참여자 결과: 대상별 상태 → /reports/:reportId → 같은 결과 목록으로 복귀
      ├─ 진행 기록: /summary?tab=notes → 작성 → 명시적 저장 → 저장 시각
      └─ 클래스 상세 / 다음 회차 / 클래스 목록 / 홈
기존 /sessions/:id/record → 기록 편집 유지 + ‘회차 요약으로’ 링크
완료된 /player 재접속 → 서버 상태 확인 후 동일 /summary (권한 유지)
```

- **종료 실패/응답 불명은 성공 화면으로 이동하지 않는다.** 재조회로 completed 확인 후 이동. 아직 진행 중이면 종료 재시도. 네트워크 복구만으로 같은 종료 요청을 무조건 반복하지 않는다.
- 이탈 가드에서 명시적으로 고른 홈/목록은 기존 leaveTo 의도 존중. 다음에 세션을 열면 요약으로 복원.
- 요약은 잠깐 뜨는 모달이 아니라 다시 찾을 수 있는 화면. class/relationship/session ID를 서버로 확인해 상단 breadcrumb와 복귀 목적지 결정. 임의 returnTo 외부 URL은 허용하지 않음.
- 리포트 상세의 돌아가기 목적지는 `/summary?tab=participants`로 고정 가능한 내부 경로. 선택한 필터와 행은 URL/메모리로 복원하되 개인정보를 URL에 넣지 않음.
- 명상: 우선 CTA **참여자 결과 확인**. 생성 중이면 **진행 기록 남기기**, 별도 목록 복귀 허용. 완료 리포트가 한 건도 없으면 결과 목록의 상태 확인은 가능하되 열기 버튼은 없음.
- 상담: 우선 CTA **상담 기록 작성** 또는 저장된 경우 **내담자 리포트 확인**. 글쓰기를 마쳐야 나갈 수 있는 강제 단계는 아님.
- 다음 회차는 기존 예정 회차 상세로 이동. 없으면 ‘다음 일정 없음’ + 권한 있을 때 편성 화면 링크. 클릭 한 번으로 새 세션 복제/생성을 실행하지 않음.
- 메시지는 권한 있는 기존 채팅방으로 이동만 한다. 게스트 등 채널 없는 경우 ‘연결된 대화 없음’. 자동 메시지 발송 기능 추가 없음.

## 5. 화면 정보 구조·디자인

### A. 회차 요약

1. 상위 클래스 / 회차 / 완료 일시와 명확한 ‘클래스가 종료되었습니다’.
2. 시간·참여 인원·리포트 대상 수. 참여 등록 수와 실제 출석 수 구분. 값 미확인 시 ‘확인 중’, 0으로 대체하지 않음.
3. 남은 일: 생성 중 / 검토 대기 / 승인됨 수와 자동 승인 **현재 정책 안내(읽기 전용)**.
4. 클래스 리포트(상담사용) 진입, 참여자별 결과, 비공개 기록의 분리된 제목.
5. 다음 회차와 클래스 상세·목록·홈 복귀. 처리 종료를 기다리게 하지 않음.

### B. 참여자별 결과

데스크톱: 검색 + 상태 필터 + 표(참여자 / 측정 / 생성 / 승인 / 전달 / 열기). 모바일: 같은 행을 세로 카드로 배치하고 라벨 보존. ‘리포트 미반영’ 참여자는 별도 그룹으로 표시하고 승인/발송 대상에서 제외. 게스트·회원 구분은 필요할 때만 보조 라벨.

리포트 상세에서 공개 코멘트 저장 → 미리보기 → ‘승인’ 확인. 기존 자동 메일 예약이 있을 수 있음을 확인문에 표시. 요약 화면에서 전체 계정 대상 `approve-all`을 호출하지 않는다. 초기 범위는 **단건 상세 승인 재사용**. 회차 한정 일괄 승인·재발송은 기존 class report-jobs 계약을 검토한 후 후속 확장.

### C. 기록 작성

‘참여자에게 공유되지 않는 기록’ 설명 + 자유 입력 + 저장 상태 + 수정 이력. 입력 중/저장 중/저장됨 HH:mm/저장 실패를 구분. 저장 응답 성공 시에만 저장됨 표기. 탭 전환·상세 이동·목록 복귀는 dirty 확인창(계속 작성 / 저장 후 이동 / 저장하지 않고 이동). 저장 실패 시 입력 유지, 이동 중단. 새로고침/탭 종료는 브라우저 기본 이탈 경고. 이번 범위에서 민감한 기록의 localStorage 영속 저장은 제안하지 않음; 강제 종료 시 미저장분은 복구 보장하지 않고 이를 안내.

재접속은 마지막 서버 저장본과 수정 이력을 로드. 늦은 폴링 응답이 작성 중 입력을 덮어쓰지 않음. 동시 편집 충돌은 revision 또는 updated_at 조건부 저장이 필요하며, 현재 API에는 없으므로 BE 범위에 명시한다. 충돌이면 내 입력 유지 + 최신 저장본 확인, 무조건 덮어쓰지 않음.

### D. 디자인 적용

`DESIGN.md`의 퍼플 구조·절제·정직한 샘플·가짜 차트 금지를 따른다. 다만 현재 업무 화면은 `.sh-scope`/`.cs-structure`의 라이트 셸을 이미 사용한다. **플레이어의 다크 몰입 화면에서 기존 라이트 업무 셸로 전환**하는 것을 추천하며 전역 테마 교체는 하지 않는다.

- 실제 출처: `components/class/flow/shell/shell-kit.css`의 #5F0080 / #F5EDFC / #F7F4F0 / #ECE6F0, Pretendard 계열; `components/class/structure/structure-shell.css`의 16px 카드·테이블 레이아웃; `frontend/src/index.css`의 토큰 import.
- 1440px: 224px 업무 사이드바, 본문 2열(결과/후속), 참여자 표. 390px: 사이드바 생략, 본문 16px 여백, 상태·행 세로 배치, CTA 최소 48px, 일반 조작 최소 44px.
- 모바일 13px 미만 텍스트 없음, 입력 16px, 본문 16/26, 제목 22/30. 색만으로 상태 전달하지 않음. 키보드 포커스 표시·aria-live 저장 알림.
- 시안 상단 검토 도구는 제품 UI와 구분. 현행 재현 / 제안 라벨, 화면 전환 화살표 및 설명을 상시 제공. HTML은 정적 합성 데이터로만 동작하며 실제 저장·승인·발송 없음.

## 6. 상태별 UX와 상태 계약

### 6.1 반드시 분리할 네 축

1. 세션: completed 여부 (종료 성공).
2. 생성: `pending | processing | ready | partial` + steps failed/reason 및 개별 report.status=error.
3. 승인: `pending_analysis | pending_review | completed | error` (completed는 승인됨).
4. 전달: 인앱 열람 가능 / 이메일 대기·발송·실패·미신청·확인 불가. **report.sent_at만으로 메일 발송 성공 표시 금지**.

근거: `lib/api/report-status.ts:152–207`; `useReportProgress.ts`는 `/record`의 `report:progress` + REST `/sessions/:id/report-status`를 5초 간격 조회, ready/partial 시 폴링 중단. 따라서 회차 진행 이벤트만으로 모든 참여자 리포트·메일을 완료 처리하지 않는다. 참여자 요약 조회를 별도로 갱신하며, 탭 재진입·재연결·focus 복귀 시 전체 상태 재조회. 연속 갱신 실패는 마지막 갱신 시각과 연결 상태로 노출한다.

| 상황 | 사용자 안내·CTA | 데이터·복구 원칙 |
|---|---|---|
| 최초 조회/상태 불명 | ‘종료 상태 확인 중’ / 다시 확인 | 임의 진행률·ETA·성공 건수 생성 금지 |
| 생성 중 | ‘리포트를 준비하고 있어요. 다른 업무를 계속할 수 있어요.’ / 기록 남기기·목록 | STT 단계 숨김. 서버 단계만 표시, 가짜 %와 3~5분 약속 제거 |
| 생성 완료 + 승인 대기 | ‘리포트 준비 · 검토 대기 N명’ / 결과 확인 | ready와 approved 분리. 자동 화면 이동·팝업 없음 |
| 자동 승인 켜짐 | ‘자동 승인 적용 · 승인 후 수신 가능한 참여자에게 전달 절차가 진행돼요’ | 계정 현행 설정을 표시만 함. 생성 전에 발송을 막아준다는 약속 금지 |
| 전체 생성 실패 | ‘리포트를 만들지 못했어요. 클래스 종료와 저장된 기록은 유지됩니다.’ / 상태 다시 확인·기록 | 실패 원인 코드로 안내. 영구 실패와 네트워크 실패 구분. 재생성 API의 대상/멱등성이 검증되기 전 실행 CTA 없음 |
| 부분 실패 | ‘준비 2명 · 확인 필요 1명’ / 실패 행 보기 | 성공한 리포트는 계속 열람·검토. failed step/개별 error와 정상 생략 구분 |
| 참여자 0명 | ‘참여자가 없어 개인 리포트가 없습니다’ / 진행 기록·목록 | 생성 실패로 표시하지 않음. 실제 0명 확정일 때만 표시. 시작 가드 우회 제안 아님 |
| LINK BAND 미착용 | ‘뇌파 미측정’ / 가능한 리포트·공개 코멘트 | 0점·실패 아님. 서사·수동 코멘트 제공, 없는 EEG 변화/차트 생성 금지 |
| STT off | ‘이번 버전에서는 자동 전사·요약을 제공하지 않습니다’ | stt_disabled는 정상 정책. EEG 리포트는 별도 유지 |
| 마이크 off | ‘음성을 사용하지 않아 AI 기록이 없습니다’ | mic_off와 실제 녹음 없음 구분. 메모만으로 AI 리포트 생성했다는 문구 금지 |
| 리포트 미반영 | ‘리포트 미반영’ 그룹 | 개인 리포트/집계/발송 대상 제외. 참여 사실 자체를 숨기지는 않음 |
| 메일만 실패 | ‘리포트 승인됨 · 이메일 전달 확인 필요’ / 상세 전달 상태 | 리포트 재생성하지 않음. 명시 요청 시에만 기존 재발송 확인 절차 |
| 종료 요청 중 단절 | ‘종료 여부를 확인할 수 없습니다’ / 연결 후 상태 확인 | completed 재조회 후 이동. 동일 종료 요청 중복 제출 방지 |
| 요약 조회 중 단절 | 마지막 상태 + ‘연결이 끊겨 최신 상태를 확인할 수 없습니다’ | 생성 실패로 바꾸지 않음. 메모 저장 버튼은 실패 상태를 명시하고 입력 보존 |
| 재접속 | 서버 현재 상태·저장 기록 복원 / 남은 일 계속 | 사용자 ID·권한 재검증, 이전 세션 응답 무시, 개인정보 캐시 공유 금지 |

### 6.2 현행 승인·자동 발송 정책과 제안의 경계

`backend/app/services/report_service.py:987–996`의 auto_approve_enabled는 현재 명상·상담 모두 계정 단일 설정을 사용한다. `:1112–1163` 승인에서는 completed와 sent_at/approved_at 설정 후, 최초 승인에 회원 알림 및 client 이메일 예약을 수행한다. `_enqueue_client_email_on_approval`은 participant·수신 이메일·기발송 여부를 확인한다. 메일 실제 완료는 `report_email_service.py:223–224`의 participant.report_email_status/sent_at이다.

자동 승인 경로는 `report_service.py:502–504`에서 공개 코멘트 초안 보완을 호출하며, 승인 후에는 `agent_report_chat.on_report_approved` 훅도 있다. 후자는 AI 활성·회원 client·비그룹 등의 조건부 동작이다(`agent_report_chat.py:45–80`). STT off와 AI 전체 off는 다른 설정이고, 이번 작업은 운영 설정값을 읽지 않았다. 새 자동 메시지를 추가하지 않되 기존 조건부 부수효과는 유지한다.

**초기 범위는 이 정책을 변경하지 않는다.** 상담은 수동 승인을 기본으로 분리하자는 기존 상세 기획은 별도 결정 사항이며, UI 이름만 바꾸고 이미 작동 중인 자동 승인을 몰래 끄거나 재발송하지 않는다. 정책 변경을 선택하면 설정·마이그레이션·이전 설정 안내를 별도 계획해야 한다.

## 7. 대안 비교

| 안 | 내용 | 장점 | 비용·한계 |
|---|---|---|---|
| A. 기록지 보강 | /record 상단에 리포트 링크·상태만 추가 | 가장 작은 변경 | 명상도 글쓰기 중심. 회차 요약·다수 결과 확인이 분산 |
| **B. 회차 요약 중심 (추천)** | 종료 성공 후 지속 가능한 요약 페이지, 결과·비공개 기록 분리 | 끝났는지/무엇이 남았는지 명확. 명상·상담 우선순위 조정 가능. 기존 리포트 상세 재사용 | 회차 범위 데이터 계약 보강 및 신규 화면 필요 |
| C. 기존 회차 상세로 복귀 | 완료된 SessionDetailPage를 결과 중심으로 재구성 | 새 라우트 없이 재방문 일관 | 기존 예정/진행 화면의 정보·조작이 많음. 종료 맥락과 편성 작업이 섞임 |

B를 추천하되 완료된 기존 회차 상세에도 ‘회차 요약’ 링크를 넣어 중복 진입점을 수렴한다. 별도 성공 축하 모달·강제 순서형 위저드는 넣지 않는다.

## 8. 구현 범위 추정 — 승인 후 별도 plan/verify 작성

본 작업에서 아래 제품 파일은 **수정하지 않음**. 기존 자산 재사용 가능성을 조사한 파일 단위 예상이다.

| 구분 | 후보 파일 | 역할 |
|---|---|---|
| FE 변경 | `frontend/src/App.tsx`, `pages/sessions/ClassPlayerPage.tsx` | summary 라우트 및 종료/재접속 진입, leaveTo 유지 |
| FE 신규 | `pages/sessions/session-summary-page.tsx`, `components/session-summary/{summary-overview,participant-results,record-editor}.tsx`, `session-summary.css` | 영역별 정보 구조·상태·필터·반응형 UI |
| FE 변경 | `components/class/flow/host/EndingScreen.tsx`, `lib/class/flow/host-ending-model.ts` | 잔존 종료 진입점의 목적지/문구 정합, STT off·실패/생략 분리 |
| FE 변경 | `pages/records/SessionRecordPage.tsx`, `components/records/CounselorNotesTab.tsx`, `pages/sessions/SessionDetailPage.tsx` | 기록 원본·저장 피드백/dirty 보호 공유, 요약 복귀 링크 |
| FE 변경 | `pages/reports/ReportDetailPage.tsx`, `components/reports/ReportDetailView.tsx` | 요약으로 돌아가기, 승인과 전달 문구·코멘트 분리 |
| FE 변경 | `hooks/useReportProgress.ts`, `lib/api/{class-operations,reports,report-status,audio}.ts` | 회차 데이터·오류/최종 갱신 시각·재연결 갱신, 저장 버전 계약 |
| BE 재사용/확장 | `api/v1/classes.py`, `services/class_operations_service.py`, `api/v1/reports.py`, `services/report_service.py`, `schemas/report.py` | 기존 class 회차 reports는 id/type/status/이름 중심. 참여자 ID·제외/미생성 행·측정·생성·전달 상태를 한 회차 범위로 안전하게 읽는 계약 보강 |
| BE 신규 후보 | `schemas/session_summary.py`, `services/session_summary_service.py`, `api/v1/sessions.py` | 클래스 없는 상담/레거시 세션도 동일 요약 계약. 기존 API 조합으로 충분하면 신규 endpoint 생략 |
| BE 변경 후보 | `schemas/audio.py`, `services/record_service.py`, `models/record.py` | 조건부 저장 revision, 충돌 409. 모델에 적합한 버전 필드 없으면 migration 별도. 무조건 last-write-wins 유지하지 않음 |
| 검증 | FE summary/record/routing 테스트, BE summary 권한·상태 집계·조건부 저장 테스트 | 제품 구현 전에 verify.md에 실패/재접속/권한 시나리오 고정 |

새 집계 DTO 최소 필드(제안): session identity/domain/completed timestamps, participation counts, autoApproval policy, counselorReport(id/status), participant rows(participantId, displayName, included, measurementStatus, reportId nullable, generationStatus/reason, approvalStatus, deliveryStatus nullable), recordVersion/updatedAt, fetchedAt, capabilities. 공개 이메일 주소 원문을 요약 DTO에 추가하지 않는다. ‘보고 대상’과 ‘현재 생성된 리포트’는 분모가 다름을 명시한다.

`lib/api/class-operations.ts:15`의 회차 reports API, `api/v1/class_reports.py`의 회차 summary/report-jobs를 우선 재사용한다. 전체 `/reports` API는 현재 page/limit만 받으므로 전체 계정 결과를 받은 뒤 첫 페이지에서만 session_id 필터링하는 구현은 금지. 미생성 행·제외 행도 보여야 하므로 roster 기반 결합이 필요하다.

비범위: STT 재활성화, 리포트 내용/발행 파이프라인 재작성, 새로운 자동 발송·알림, 개인별 내부 상담 메모 모델, 전체 계정 일괄 승인, 명상 점수/순위, 새 메시징/예약 엔진, 운영 데이터 확인.

## 9. 수용 기준 (승인 후 구현 검증의 입력)

- [ ] 정상 종료는 서버 completed 확인 후 요약 진입. 별도 이탈 목적지를 고른 경우 그 목적지 유지.
- [ ] 재접속·기존 상세·기록지·리포트 상세에서 같은 회차 요약으로 돌아갈 수 있다.
- [ ] 요약에서 클래스 리포트와 참여자 리포트에 **각각 올바른 report ID**로 접근한다.
- [ ] 생성/승인/메일 상태가 서로 독립적이며 sent_at만으로 발송 완료를 표시하지 않는다.
- [ ] 자동 승인 현행 설정을 정확히 안내하고, 화면 진입만으로 승인·메일·메시지를 실행하지 않는다.
- [ ] 정상 생성·전체 실패·일부 실패·정책 생략·네트워크 오류를 구분한다. 가짜 진행률 없음.
- [ ] 참여자 0명·미착용·미반영을 실패/0점으로 취급하지 않는다. 명상은 서사·변화량만, 종합점수/순위 없음.
- [ ] STT off에서는 전사·AI 요약 대기 단계를 노출하지 않는다. 마이크 off 기록 제외 문구를 별도 검증한다.
- [ ] 내부 메모 저장은 client 리포트나 메일 내용에 포함되지 않고 발송을 호출하지 않는다.
- [ ] 저장 성공/실패/충돌·dirty 이탈·재조회 중 편집·재접속 복원이 검증된다.
- [ ] 권한 없는 사용자·타 기관·회원에게 내부 메모/타인 결과를 노출하지 않는다. 승인 권한과 메모 편집 권한을 동일시하지 않는다.
- [ ] 390/1440에서 가로 잘림 없음. 모바일 글자 13px 이상, 입력 16px, 조작 44px+, 주요 CTA 48px+.
- [ ] 다음 회차·메시지 CTA는 실제 존재하고 접근 가능한 대상에만 연결한다. 생성·발송은 별도 명시적 조작.

## 10. Brian 결정 필요 항목

1. **이번에 B안(회차 요약 중심)으로 진행할지** — 추천 B. 핵심 결정이며 이 승인 전 제품 구현 없음.
2. **상담/명상의 자동 승인 정책을 이번 범위에서 분리할지** — 추천: 이번에는 현행 정책 표시만, 정책 변경은 별도 카드. 현재 단일 계정 설정이 양쪽에 적용된다는 점은 숨기지 않음.
3. **종료 후 기록을 필수 업무로 만들지** — 추천: 명상·상담 모두 선택 작성, 미작성 표시만. 메모 저장을 리포트 발행 조건으로 추가하지 않음.

우선 1번 결정 후 나머지를 순차 확정한다. 기술 파일 분할·라우트 파라미터·스타일 세부는 구현자가 처리할 사항이며 별도 사업 결정으로 묻지 않는다.
