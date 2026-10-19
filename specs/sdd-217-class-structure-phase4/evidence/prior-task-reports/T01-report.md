# T01 — 셀프뷰 원본 교체 결함 수정 보고

## 원인과 수정

- 요구: spec R6 DEV-01, verify NV-01~03. 실기기 카메라 끊김 전체의 원인은 확정하지 않았다.
- 확인된 코드 결함: HostLiveKitBridge는 `useTracks` 배열에 의존한 `useMemo`로 MediaStream을 전달하고, HostHeadSlot의 SelfVideo는 `srcObject`를 직접 연결했다. 설치된 livekit-client 2.19 계열 SDK의 LocalTrack은 같은 SDK 트랙 객체를 유지한 채 `restartTrack()`/`replaceTrack()`에서 내부 MediaStream과 원본 MediaStreamTrack을 교체한다. SDK가 관리하는 attachedElements에 셀프뷰가 등록되어 있지 않아 화면에는 이전 원본이 남았다.
- 실제 SDK `restartTrack()` 재현에서 SDK 원본은 recovered로 바뀌었지만 화면의 first 원본은 ended 상태로 남았다. `replaceTrack()`도 화면에 first가 남았다. 브라우저 카메라와 MediaStream만 합성했고 SDK 교체·attach/detach 구현은 실제 설치 패키지를 실행했다.
- 수정: SDK LocalVideoTrack을 브리지 → 실제 소비자인 HostLiveContainer → HostLiveView → HostSelfView로 전달했다. SelfVideo가 SDK `attach(element)`/`detach(element)`로 연결·해제한다. 기존 stream 전달·픽스처 경로는 유지했다. 녹화 캡처 코드는 수정하지 않았다.

## RED → GREEN과 회귀

- RED: frontend에서 `npx vitest run tests/sdd217-self-view.test.tsx` → 3 failed. restart 후 ended인 이전 원본, replace 후 이전 원본, SDK에 등록되지 않은 영상 요소를 각각 검출했다. 로그: `/private/tmp/sdd217-t01-red.log`.
- GREEN/관련 회귀: frontend에서 `npx vitest run tests/sdd217-self-view.test.tsx tests/class-player-host-media.test.tsx` → 2 files passed, 33 passed(신규 3 + 기존 30). 로그: `/private/tmp/sdd217-t01-green.log`. 최종 실행 오류·경고 없음.
- 타입: frontend에서 `npx tsc -b --pretty false` → 종료 0, 출력 없음. 로그: `/private/tmp/sdd217-t01-types.log`.
- 신규 SDK 테스트: 같은 SDK 객체의 restartTrack 및 이벤트가 없는 replaceTrack 뒤 새 원본 표시, 타이머 3회 렌더 중 동일 video/stream 유지·SDK 연결 1개·방 마운트 1회·추가 getUserMedia 0회, 카메라 끔과 unmount의 연결 해제 및 srcObject 정리.
- 테스트 환경 보정: jsdom의 기본 UA가 SDK에서 Safari 경로로 분류되어 지연된 srcObject 복원을 실행했으므로, 대상 환경인 Chromium UA를 명시했다. 브라우저의 실제 렌더·프레임 진행을 검증한 결과는 아니다.

## 변경 파일

- frontend/src/components/class/player/host/HostLiveKitBridge.tsx
- frontend/src/components/class/player/host/HostHeadSlot.tsx
- frontend/src/components/class/player/host/HostLiveContainer.tsx
- frontend/src/components/class/player/host/HostLiveView.tsx
- frontend/tests/sdd217-self-view.test.tsx
- .superpowers/sdd/plan/T01-report.md

## 검증 상태와 한계

- NV-01 PASS(합성 브라우저 경계 + 실제 SDK): 같은 SDK 객체의 내부 원본 교체 이후 새 원본 연결.
- NV-02 PASS(컴포넌트/SDK): 타이머 재렌더의 불필요 attach·방 재마운트·추가 캡처 방지, 카메라 끔·unmount 해제.
- NV-03 미측정: 실카메라·녹화 켬/끔·장치 복구 전후 실제 프레임 진행을 비교하지 못했다. 사용자 관측 끊김 전체의 해결이나 녹화와의 인과관계는 주장하지 않는다.
- 전체 BE/전체 FE는 범위 밖으로 실행하지 않았다. 커밋·푸시·배포 없음. 작업 시작 시 존재한 backend/tests/test_sdd217_contract.py 및 specs 디렉터리는 타 태스크 소유로 보존했다.
