# SDD-299 현황 감사

기준: 2026-11-05, HEAD `687967bb`. 제품 코드 읽기만 수행. 아래 경로의 `H`는 `frontend/src/components/class/player/host/`, `S`는 `H/sheets/`, `L`은 `frontend/src/lib/class/`이다. 위치는 파일:줄 형식이다. 빈도는 로그가 없는 **설계 추정**이다. 높음=진행 중 반복 확인, 중간=상황별 조작, 낮음=초기 설정·예외 처리라는 근거를 각 행에 붙였다. 온라인/오프라인은 수업 방식이며 인터넷 연결 유무가 아니다.

## 하단 독과 직접 연결된 기능
| 현재 메뉴 | 시트 | 기능 | 온라인 / 오프라인 가시성 | 소유 코드 | 빈도 추정·근거 |
|---|---|---|---|---|---|
| 지표 기준 | MetricSheet | 집중도·이완도·감정균형도·BPM·호흡·HRV 선택, MIND/BODY 구분 | 모두 | S/MetricSheet.tsx:16; L/player-case.ts:80 | 중간·관찰 대상 전환 |
| 지표 기준 | MetricSheet | 10초 자동 순환 켜기/끄기, 현재 선택 표시 | 모두 | S/MetricSheet.tsx:41 | 낮음·표시 선호 설정 |
| 채팅 | ChatSheet | 채팅 받기 켜기/끄기, 변경 중 잠금, 꺼지면 대화창 숨김 | 모두, 방식 분기 없음 | S/ChatSheet.tsx:14 | 중간·수업 운영 |
| 채팅 | ClassChatPanel→ChatRoom | 대화 목록·작성·전송·실시간 수신·읽음·전송 실패 재시도, 최근 대화 복귀(대상 메시지 탐색 시) | 인증·활성·채팅방 확보 시 모두 | frontend/src/components/chat/ClassChatPanel.tsx:170; ChatRoom.tsx:351,385,459,484 | 높음·수업 중 소통 |
| 채팅 | 독 배지 | 닫혀 있을 때 안 읽음 집계, 펼칠 때 배지 숨김 | 모두 | H/HostLiveView.tsx:158; ClassChatPanel.tsx:114 | 높음·새 대화 확인 |
| 설정 | HostSettingsSheet→HostMediaSheet | 내 카메라 켜기/끄기, 권한 거절·기기 없음 안내 | 온라인만 | H/HostMediaSheet.tsx:63 | 중간·송출 조절 |
| 설정 | HostMediaSheet | 마이크 켜기/끄기, 권한 안내, 꺼짐 시 AI 기록 제외 설명 | 온라인만 | H/HostMediaSheet.tsx:81 | 높음·발화 제어 |
| 설정 | HostMediaSheet | 녹음 마이크 상태·경과 시간 | 오프라인만 | H/HostMediaSheet.tsx:98 | 높음·현장 기록 확인 |
| 설정 | AI 기록/RecordingControls | 녹음 시작(idle), 일시정지(recording), 재개(paused), 녹음 종료(recording/paused), 상태·시간 표시 | 모두. 온라인 마이크 off이면 별도 안내+활성 녹음 종료만 노출 | H/HostMediaSheet.tsx:106; frontend/src/components/session/RecordingControls.tsx:32 | 높음·기록 구간 조절 |
| 설정 | HostMediaSheet | 영상 녹화 상태, 전면/후면 전환 | 온라인+video 존재+recording/paused | H/HostMediaSheet.tsx:129 | 중간·촬영 방향 조절 |
| 설정 | HostMediaSheet | 무음 영상 녹화 시작/종료 | video.videoOnly.available 조건. 시트 자체에는 online 가드 없음 | H/HostMediaSheet.tsx:141; H/HostLiveContainer.tsx:400 | 낮음·카메라 on/마이크 off 특수 조합 |
| 설정 | 마커/MarkerButton | 메모 입력·마커 추가·누적 개수·추가 실패, 빈 입력/처리 중 잠금 | marker 제공 시 모두. 실제 컨테이너는 제공 | H/HostMediaSheet.tsx:154; H/HostLiveContainer.tsx:406; frontend/src/components/session/MarkerButton.tsx:16 | 중간·주요 시점 기록 |
| 설정 | HostPermissionSheet | 카메라/마이크 브라우저 허용 절차, 다시 확인 | 온라인 미디어에서 진입 | H/HostMediaSheet.tsx:168 | 낮음·권한 예외 |
| 설정 | 정원 설정 | 현재 정원·현재 입장·입장 대기 표시 | capacity 존재 시 모두 | H/HostSettingsSheet.tsx:36 | 중간·입장 상황 확인 |
| 설정 | CapacityIncreaseForm | 새 정원 직접 입력·±1·증원 제출, 상한, 현재 입장 미만/동일·축소/비정수 검증 | 모두, 온라인 50 / 오프라인 100 | H/CapacityIncreaseForm.tsx:25; L/capacity-increase.ts:4 | 낮음·정원 부족 상황 |
| 설정 | CapacityIncreaseForm | 관리자 변경 사유 필수, revision 미확보 잠금, 상한 도달·처리 중 잠금, 요청 결과·서버 오류·재시도 | 모두; 사유 입력은 admin일 때만 | H/CapacityIncreaseForm.tsx:38,48,85; L/capacity-increase.ts:34 | 낮음·변경 예외 |
| 도구 | ToolsSheet | 입장순/낮은 순/높은 순 정렬 | 모두 | S/ToolsSheet.tsx:30 | 중간·관찰 대상 탐색 |
| 도구 | ToolsSheet | 손든·말하는 회원 우선 정렬 | 온라인 그룹만 | H/HostLiveView.tsx:178; S/ToolsSheet.tsx:49 | 중간·발언 순서 조절 |
| 도구 | ToolsSheet | 표로 보기(6개 지표 비교) | 모두 | S/ToolsSheet.tsx:57 | 중간·표시 방식 전환 |
| 도구 | ToolsSheet→MybandSheet | 내 밴드 상태·보기, 연결/해제, 배터리·접촉·내 이완도, 권한/미지원/오류 안내, 본인만 보는 지표 설명 | 모두, 연결 가능·플랫폼별 조건 | S/ToolsSheet.tsx:63; S/MybandSheet.tsx:16 | 낮음·본인 장치 설정 |
| 도구 | ToolsSheet | 입장 코드 표시·복사, 코드 없음 자리표시/복사 잠금 | 모두 | S/ToolsSheet.tsx:69 | 중간·입장 안내 |
| 도구 | ToolsSheet | 회원 초대 | onInvite 제공 시 모두 | S/ToolsSheet.tsx:41 | 낮음·추가 참여 안내 |
| 도구 | ToolsSheet | 클래스 화면 나가기(수업 종료와 별개) | onLeave 제공 시 모두, 뷰에서 제공 | S/ToolsSheet.tsx:78; H/HostLiveView.tsx:176 | 낮음·화면 이탈 |

## 독 외 연관 패널·경로도 보존
| 진입점 | 시트/패널 | 기능 | 온라인 / 오프라인 가시성 | 코드 | 빈도 추정·근거 |
|---|---|---|---|---|---|
| 상단 지표 띠 | metric | 지표 선택 재진입, 그룹 평균, 자동 순환; 표/상세 시 순환 억제 | 모두, solo면 평균 숨김 | H/HostLiveView.tsx:227 | 높음·관찰 |
| 수업 상태·더보기 | AlertsSheet | 체크인 접기/펼치기, 녹음·대기·필요 조치·내 밴드 등 칩 링크, 손 우선 변경, 밴드 현황 | 모두, 생성된 칩별 조건 | S/AlertsSheet.tsx:15; L/host-player-case.ts:333 | 높음·상황 확인 |
| 체크인/수업 상태 | CheckinSheet | 응답 수·비율·최대 3개 질문 분포·살펴볼 응답→회원 상세·입장 전 체크인 | 모두, 데이터별 조건 | S/CheckinSheet.tsx:40 | 중간·응답 확인 |
| 손들기 신호 | HandsSheet→SpeakingRightsPanel | 손든 회원 목록·발언권 부여/해제·손 내리기; 패널 없으면 안내 | 신호 버튼은 양쪽 렌더, 실제 패널은 온라인 그룹+session.max_participants ≤ 20 | H/HostLiveView.tsx:146; H/HostLiveContainer.tsx:372; S/HandsSheet.tsx:10 | 높음·발언 관리 |
| 조용한 신호 | SignalsSheet | 최근 10초 집계·회원별 최신 선택·체크인 요약 진입 | 모두 | S/SignalsSheet.tsx:5 | 높음·진행 반응 |
| 필요 조치/필터 | ActionsSheet | 참가자/밴드 상태 필터, 접촉 확인·저배터리 목록, 빈 상태 | 모두 | S/ActionsSheet.tsx:15 | 중간·장치 상황 |
| 대기 칩 | QueueSheet | 대기 목록·빈 상태·자동 입장 안내·대기실 준비 패널(제공 시) | 모두, 대기 칩은 대기자 있을 때 | S/QueueSheet.tsx:13 | 중간·입장 상황 |
| 회원 타일·살펴볼 응답 | DetailSheet | 6지표·최근 5분 추이·체크인 응답 | 모두 | S/DetailSheet.tsx:13 | 중간·개인 관찰 |
| 녹음 칩 | media | 현재는 설정으로 열림 | 모두 | L/host-player-case.ts:335 | 중간·기록 바로가기 |
| 상단 바 | HostTopBar | 클래스 코드 복사·경과 시간·인원·수업 종료 | 양쪽, solo 통계 숨김 | H/HostLiveView.tsx:252 | 높음·진행 확인 |

메시지의 발신자·시각·안 읽은 인원 표시는 MessageBubble 소유이며 메뉴 재편성으로 분리·복제하지 않는다. 별도 메시지별 조작 메뉴는 이 컴포넌트에서 발견하지 못했다. 초대는 기존 외부 흐름 호출로 보존한다. 채팅 구현에 존재하는 1:1 전용 차단 조건을 클래스 기능으로 간주하지 않는다.

## 근거 기반 진단
1. 미디어와 정원이 같은 ‘설정’에 있어 목적이 다른 조작을 한 화면에서 찾는다(HostSettingsSheet:33~49).
2. 지표 선택은 MetricSheet, 정렬·표 보기는 ToolsSheet에 분산되어 관찰 화면을 조절할 때 두 메뉴를 오간다.
3. ‘도구’는 표시 옵션·내 장치·초대·나가기를 포괄하여 라벨만으로 내용을 예측하기 어렵다. 사용 빈도 실측은 없다.
4. 코드 복사는 상단과 도구, 내 밴드는 도구와 수업 상태, 손 우선은 도구와 상태 경로에 중복 진입한다. 같은 동작의 바로가기이므로 무조건 제거할 중복은 아니다.
5. host-player-case.ts:364~367에 오프라인 ‘녹음’이라는 오래된 주석과 현재 양쪽 ‘설정’ 계약이 함께 있다. 11/4 시안 문서의 제안 단계 기술과 현재 구현도 구분해야 한다.

## 확인 한계
브라우저 제품·API·네이티브·BLE·실사용 빈도는 미확인이다. 무음 영상의 오프라인 가드는 상위 상태 의존이라 후속 구현에서 확인해야 한다. 이번 시안에서는 오프라인에 녹음·마커만 표현하며 이 차이를 현행 코드 동작으로 단정하지 않는다.
