# SDD-216 — dev 확인 문제와 다음 SDD 인계

## 작업 종료 기준

- 2026-10-19 사용자 dev 확인에서 세 문제를 보고했다. 이후 “다음 SDD에 내용 추가하고 지금은 여기까지 해서 정리” 지시에 따라 이번 단계의 추가 구현·재배포를 중단한다.
- SDD-216의 배포된 기능은 유지한다. 아래 문제를 해결 완료나 QA 통과로 표시하지 않는다.
- 다음 작업은 기획 §9 Phase 4(멤버십·출석·보강)에 아래 결함 보완을 함께 편성한다. 출석 외 결함을 Phase 4의 기존 기능으로 바꿔 설명하지 않는다.
- 이 문서는 다음 spec·plan·구현 전 verify의 입력이다. 다음 SDD 번호는 미발급이며 `scripts/sdd new`로 발급할 때 연결한다. 원본 SDD-216 verify는 변경하지 않는다.

## 문제별 확인과 편성

| ID | 사용자 관찰 | 확인된 코드·실제 상태 | 미확인 | 다음 SDD 편성 |
|---|---|---|---|---|
| DEV-01 | 상담사 진행 화면의 **본인 카메라**가 심하게 끊김 | HostLiveKitBridge가 트랙의 mediaStream을 전달하고 HostHeadSlot이 video.srcObject에 연결. SDK는 트랙 재시작 때 스트림을 교체하며 attach된 요소를 갱신. LiveKit 카메라와 녹화용 getUserMedia가 별도로 존재 | 실제 끊김 재현, 브라우저·기기·녹화 활성 여부, 스트림 교체/동시 캡처와 증상의 인과관계 | 출석과 별개인 미디어 결함 보완. 다음 단계 첫 조사·수정 대상으로 편성 |
| DEV-02 | 체크인 후 입장했는데 ‘체크인 전’ 표시 | 전원 밴드 미착용 타일은 체크인 응답이 없으면 ‘체크인 전’. 체크인 WS 수신은 대기 화면에만 연결되고 메모리 ref에 보관. 진행 중 합류·새로고침에서 응답이 없을 수 있음 | 사용자의 실제 발생 경로가 늦은 합류인지 새로고침인지 미확인 | Phase 4 출석·참여 상태 표시와 함께 구현 |
| DEV-03 | ‘바로 지금’ 종료 후 클래스는 ‘다음 회차가 없어요’, 1회차는 완료 | 조회한 dev 즉시 클래스 1건은 클래스 completed·회차 completed·fixed·regular. 종료 서비스에 클래스 완료 판정 호출이 있고, 화면은 클래스 status=completed일 때 ‘모든 회차를 마쳤어요’를 표시 | 종료 직후 응답, 관찰 당시 클래스 상태, 화면 갱신 시점, cron 전후 상태 차이. 원인 확정 불가 | 출석과 별개인 클래스 수명·화면 갱신 결함 보완. Phase 4 종료 훅과 함께 회귀 검증 |

## 코드 근거

- DEV-01: `frontend/src/components/class/player/host/HostLiveKitBridge.tsx:54`, `HostHeadSlot.tsx:20`; `frontend/src/pages/sessions/ClassPlayerPage.tsx:809`·`:826`; `frontend/src/hooks/useVideoRecorder.ts:95`.
- DEV-01 SDK 근거: 설치된 `livekit-client/src/room/track/LocalTrack.ts`의 스트림 교체·attachedElements 갱신·재시작 경로. 매초 React 렌더가 방을 재연결한다는 근거는 확인되지 않았다.
- DEV-02: `frontend/src/components/class/player/host/HostParticipantGrid.tsx:52`, `host-live-model.ts:100`; `frontend/src/pages/sessions/ClassPlayerPage.tsx:711`·`:744`; `backend/app/services/session_service.py:2750`.
- DEV-02: `backend/app/models/session.py:158`의 joined_at 기본값은 행 생성 시각일 수 있다. 그 값이나 초대 행 존재만으로 현재 참여를 판정하지 않는다.
- DEV-03: `backend/app/services/session_service.py:1183`, `backend/app/services/class_rolling_service.py:128`, `frontend/src/components/class/structure/host-class-views.tsx:39`, `frontend/src/hooks/use-class-structure.ts:98`.
- 이번 확인은 코드 열람·dev DB 읽기다. 실제 브라우저 재현·수정 후 검증은 수행하지 않았다.

## 다음 spec에 반영할 동작

- 체크인 설문 완료, 회차 출석, 현재 입장·접속 상태를 분리한다. 현재 참여를 확인할 수 있을 때 ‘참여 중’을 표시하며 초대만 된 사람에게 적용하지 않는다.
- 초기 조회·진행 중 합류·새로고침·재접속 후 서버 근거로 상태를 복원한다. 응답이 없다는 이유만으로 ‘체크인 전’이라고 표시하지 않는다. 밴드 착용 여부와 참여 판정은 분리한다.
- 카메라 재시작·장치 복구에도 셀프뷰가 유효한 트랙에 연결돼야 한다. 먼저 재현 테스트로 원인을 확정한 뒤 attach/detach 관리 또는 녹화 캡처 공유 여부를 결정한다.
- 마지막 정규 회차 종료 후 클래스 완료와 회차 완료를 일관되게 표시한다. 미래 회차가 없는 정기형·취소·보강은 단순히 완료로 추정하지 않는다.

## 다음 plan 작업 단위

| Task | 작업 | 완료 증거 |
|---|---|---|
| N01 | 영상 끊김 재현과 트랙·캡처 경로 진단 | 녹화 켬/끔, 장치 재시작, 프레임 진행 비교 |
| N02 | 확인된 영상 원인 수정 | NV-01~03 |
| N03 | 서버 참여·체크인 상태 계약과 복원 경로 정의 | 상태별 입력·응답·WS 계약, 초대/입장 구분 |
| N04 | 상담사 타일 표시·실시간 갱신 구현 | NV-04~08 |
| N05 | 즉시 클래스 종료 직후 상태와 화면 응답 재현·수정 | NV-09~12, 실제 PG 트랜잭션 |
| N06 | Phase 4 기본 범위와 통합·dev 확인 | 해당 verify 결과, 기존 미확인 구분 |

## 다음 구현 전 verify에 넣을 시나리오

모두 미실행. 다음 SDD의 구현 전 게이트에 편입한다.

| ID | 시나리오·기대값 | 도구·담당 |
|---|---|---|
| NV-01 | 같은 LiveKit 트랙 객체의 원본 트랙 교체 후 셀프뷰 재생 연결 유지 | 트랙 대역 단위 테스트 / FE |
| NV-02 | 타이머 렌더에서 불필요한 attach·방 재연결 없음, 언마운트에서 연결 해제 | FE 단위·브라우저 / FE |
| NV-03 | 실제 카메라에서 녹화 켬/끔·장치 복구 전후 프레임 진행 확인 | 실제 브라우저·기기 / FE·QA |
| NV-04 | 밴드 없이 체크인 후 입장하면 ‘체크인 전’ 오표시 없음 | API 연결 브라우저 / BE·FE |
| NV-05 | 진행 중 늦은 입장도 참여 상태 갱신 | WS 통합 / BE·FE |
| NV-06 | 상담사 새로고침 후 체크인·참여 상태 복원 | API·브라우저 / BE·FE |
| NV-07 | 초대만 된 미입장자는 ‘참여 중’으로 표시하지 않음 | 상태 계약·DOM / BE·FE |
| NV-08 | 퇴장·재접속은 참여 상태에 반영하고 체크인 결과 유지 | WS·브라우저 / BE·FE |
| NV-09 | ‘바로 지금’ 1회차 종료 커밋 직후 클래스·회차 completed, cron 대기 불필요 | PostgreSQL 필수 / BE |
| NV-10 | 종료 직후 상세 복귀·기존 상세 화면 재조회에서 완료 문구 표시 | API 응답·브라우저 / FE |
| NV-11 | 종료 재시도 시 완료·회원 상태·완료 알림 의도 중복 없음 | PostgreSQL 필수 / BE |
| NV-12 | 다음 회차 없는 정기형, 취소, 보강을 완료로 오판하지 않음 | PostgreSQL·DOM / BE·FE |

## 배포·기존 검증 상태

- dev 반영 제품 커밋: `7e34c0564bf9c910be4a34499cb074b936c9b530`.
- [Deploy Dev 실행](https://github.com/Brian-Chae/mindbreeze_2.0/actions/runs/39214498278): frontend·deploy 성공. 후속 E2E는 Run journeys·Run full-journey 실패. 실패 상세 원인과 위 세 문제의 관계는 미확인이며 다음 착수 시 실패 결과를 분류한다. 전체 배포 워크플로 성공으로 표현하지 않는다.
- [PR CI 실행](https://github.com/Brian-Chae/mindbreeze_2.0/actions/runs/39214505833): 조회 시점 frontend·backend-pg-smoke 성공, backend 진행 중. 이 문서는 전체 회귀 통과 증거가 아니다.
- DB head `e036a0000056`, scheduling/rolling=true, team_read=false. 공개 FE 200, API database/redis 정상, 클래스 운영 cron 실패 0건을 배포 직후 확인했다.
- 실제 메일·푸시·LiveKit 참관 권한·실기기·전체 시안 비교의 기존 미확인은 유지한다.
- 이번 정리에서는 제품 코드·원본 verify 변경, 전체 BE 회귀, 추가 배포를 수행하지 않는다.
