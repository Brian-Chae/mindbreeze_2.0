=== member-a
화면 | 케이스 | 설명 (방식·인원·밴드 모드·상태) | 가정
FM01 / 홈 — 다음 클래스 히어로 / 셸형 | LINKS:upcoming || upcoming | 예정 D-day · 온라인·그룹·LINK BAND 선택 | A2 (방식·장소 서버 저장)
LINKS:soon || soon | 곧 열림 · 오프라인·1:1·LINK BAND 사용 안 함 | A2 (방식·장소 서버 저장)
LINKS:open || open | 입장 가능 · 온라인·그룹·LINK BAND 선택 | A2 (방식·장소 서버 저장)
LINKS:live || live | 진행 중 · 온라인·1:1·LINK BAND 필수 | A2 (방식·장소 서버 저장)
LINKS:empty || empty | 클래스 없음 빈 상태 | -
FM02 / 클래스 목록 + 신청 시트 / 셸형 | LINKS:list || list | 입장 가능 최상단 · 예정 · 지난 클래스 (내부 스크롤) | A2 (방식·장소 서버 저장)
LINKS:invited || invited | 초대받은 클래스 카드 포함 | A2 (방식·장소 서버 저장)
LINKS:apply || apply | 신청 바텀 시트 (탭바 위로) | -
FM03 / 클래스 상세 — 4상태 / 셸형 | LINKS:scheduled || scheduled | 예정 · 온라인·그룹·LINK BAND 선택 | A2 (방식·장소 서버 저장)
LINKS:scheduled-offline || scheduled-offline | 예정 · 오프라인·1:1·LINK BAND 사용 안 함 (장소 안내) | A2 (방식·장소 서버 저장) + 장소 필드
LINKS:open || open | 입장 가능 · 온라인·그룹·LINK BAND 선택 | A2 (방식·장소 서버 저장)
LINKS:open-offline || open-offline | 입장 가능 · 오프라인·그룹·LINK BAND 필수 | A2 (방식·장소 서버 저장) + 장소 필드
LINKS:open-1on1 || open-1on1 | 입장 가능 · 온라인·1:1·LINK BAND 필수 | A2 (방식·장소 서버 저장)
LINKS:done || done | 완료 · 리포트 보기 | -
LINKS:cancelled || cancelled | 취소 | -
FM05 / 입장 확인 (회원 전용) / 몰입형 | LINKS:member || member | 열림 후 · 온라인·그룹·LINK BAND 선택 | A3 (클래스 응답에 시작 시각 포함) · A7 (초대 기반 입장 전제)
LINKS:member-wait || member-wait | 열림 전 · 자동 입장 대기 카드 | A3 (클래스 응답에 시작 시각 포함) · A7 (초대 기반 입장 전제)
LINKS:member-offline || member-offline | 열림 후 · 오프라인·1:1·LINK BAND 사용 안 함 (장소 표시) | A3 (클래스 응답에 시작 시각 포함) · A7 (초대 기반 입장 전제) + A2 (방식·장소 서버 저장)
FM10 / 취소됨 · 종료 · 아직 열리지 않음 · 오류 · 네트워크 끊김 (회원 쪽) / 몰입형 | LINKS:cancelled || cancelled | 클래스 취소됨 | -
LINKS:closed || closed | 종료·취소된 클래스 (구 입장 오류 흡수) | -
LINKS:notyet || notyet | 아직 열리지 않음 → 입장 대기하기 (구 입장 오류 흡수) | A3 (클래스 응답에 시작 시각 포함) · A7 (초대 기반 입장 전제)
LINKS:error || error | 오류 (서버 메시지 원문 숨김) | -
LINKS:offline || offline | 네트워크 끊김 | -
=== member-b
화면 | 설명 | 유형 | 케이스 | 가정
FM06a | 입장 준비 1 — 클래스 안내 · 동의 | 몰입 | LINKS:on-group-opt-member,on-group-req-member,on-solo-none-member,off-group-none-member,off-solo-opt-member,on-group-opt-member-empty || on-group-opt-memberon-group-req-memberon-solo-none-memberoff-group-none-memberoff-solo-opt-memberon-group-opt-member-empty | A1 동의 서버 저장(미확인)
FM06b | 입장 준비 2 — 오늘의 상태(설문) 3축 + 전할 말 · started: 상담사가 시작했을 때 시트 | 몰입 | LINKS:on-group-opt-member-q1,on-group-opt-member-q2,on-group-opt-member-q3,on-group-opt-member-q4,off-group-none-member-q1,on-solo-req-member-q4,on-group-opt-member-q2-started,off-group-none-member-q1-started || on-group-opt-member-q1on-group-opt-member-q2on-group-opt-member-q3on-group-opt-member-q4off-group-none-member-q1on-solo-req-member-q4on-group-opt-member-q2-startedoff-group-none-member-q1-started | A9 준비가 끝나지 않은 회원·대기실이 비어도 시작 가능, 시작 후 입장(-started 케이스)
FM06c | 입장 준비 3 — LINK BAND (연결·접촉 불량 3종·필수 모드, 사용 안 함은 단계 없음) · started 시트 | 몰입 | LINKS:on-group-opt-member-idle,on-group-opt-member-connecting,on-group-opt-member-connected,on-group-opt-member-leadoffl,on-group-opt-member-leadoffr,on-group-opt-member-leadoff,on-group-opt-member-unsupported,on-group-req-member-idle,on-group-req-member-leadoffl,on-group-req-member-leadoff,on-group-req-member-unsupported,off-solo-opt-member-idle,off-group-req-member-connected,on-group-opt-member-idle-started || on-group-opt-member-idleon-group-opt-member-connectingon-group-opt-member-connectedon-group-opt-member-leadofflon-group-opt-member-leadoffron-group-opt-member-leadoffon-group-opt-member-unsupportedon-group-req-member-idleon-group-req-member-leadofflon-group-req-member-leadoffon-group-req-member-unsu | A8 전극별 접촉 상태 전송(구현 확인) · A9 대기실이 비어도 시작 가능, 시작 후 입장(-started 케이스)
FM06d | 입장 준비 4 — 기기 점검: 내 영상·소리 합친 컴포넌트 (온라인만). camon=카메라 켜짐(마이크 토글 둘레 5단계 링 + 아이콘 밝기 + 칩 정상), camon-quiet=조용해요 · started 시트 | 몰입 | LINKS:on-group-opt-member-mic,on-group-opt-member-camon,on-group-opt-member-micdenied,on-group-opt-member-micnodev,on-group-opt-member-camdenied,on-group-opt-member-unsupported,on-group-opt-member-micdenied-sheet,on-group-opt-member-camon-micdenied,on-solo-req-member-camon-spk,on-solo-none-member-mic,on-group-opt-member-camon-quiet,on-group-opt-member-camon-started,on-group-opt-member-mic-started || on-group-opt-member-micon-group-opt-member-camonon-group-opt-member-micdeniedon-group-opt-member-micnodevon-group-opt-member-camdeniedon-group-opt-member-unsupportedon-group-opt-member-micdenied-sheeton-group-opt-member-camon-micdeniedon-solo-req-member-camon-spkon-solo-none-member-micon-group-opt-m | A9 준비가 끝나지 않은 회원·대기실이 비어도 시작 가능, 시작 후 입장(-started 케이스)
FM06e | 입장 준비 5 — 준비 완료 요약 | 몰입 | LINKS:on-group-opt-member,on-group-req-member,on-solo-none-member-skip,off-group-none-member,off-solo-opt-member-noband,on-group-opt-member-nomic || on-group-opt-memberon-group-req-memberon-solo-none-member-skipoff-group-none-memberoff-solo-opt-member-nobandon-group-opt-member-nomic | A1 동의 요약 줄
FM07 | 시작 대기 (상담사가 시작하면 기존대로 자동 입장 — 이 화면에는 started 케이스 없음) | 몰입 | LINKS:on-group-opt-member,on-group-opt-member-bgmoff,on-solo-none-member,off-group-none-member,off-solo-opt-member,on-group-req-member || on-group-opt-memberon-group-opt-member-bgmoffon-solo-none-memberoff-group-none-memberoff-solo-opt-memberon-group-req-member | A3 시작 예정 시각(클래스 정보 응답) · A5 준비 인원은 대기실 presence 기준 · A9 대기실이 비어도 시작 가능, 시작 후 입장(시작되면 자동 입장)
FM08 | 대기열(정원 초과) | 몰입 | LINKS:on-group-member,on-solo-member,off-group-member || on-group-memberon-solo-memberoff-group-member | A4 서버 정원 정책 필요
FM09 | 종료 카드 + 시트(리포트 받기 1탭·신청 완료 · 오늘 상태 남기기) | 몰입 | LINKS:on-group-member,off-solo-member,on-group-member-checked,on-group-member-report,on-group-member-reportsent,on-group-member-checkin,on-group-member-checkinempty || on-group-memberoff-solo-memberon-group-member-checkedon-group-member-reporton-group-member-reportsenton-group-member-checkinon-group-member-checkinempty | -
=== host-a
화면 | 유형 | 케이스 | 가정
FH01 / 클래스 목록 | 셸형 | LINKS:open,open-offline,progress,idle,empty,past,net || open 열림 · 온라인 그룹 · 대기 3명 / open-offline 열림 · 오프라인 1:1 · 대기 0명 / progress 진행 중 / idle 열린 클래스 없음 · 다음 클래스 카드 / empty 클래스 없음(빈 상태) / past 열림 + 지난 클래스 탭(상단 카드 유지) / net 열림 + 네트워크 끊김 /  | A5 시작하기 가능 판정은 대기실 인원 기준(1:1은 조건 없음)
FH02a / 만들기 1/5 유형·방식 | 몰입형 | LINKS:online-group,online-1to1,offline-group,offline-1to1,leave || online-group 온라인 · 그룹 (하울링 안내 한 줄) / online-1to1 온라인 · 1:1 (최대 1명 고정) / offline-group 오프라인 · 그룹 (주소 입력) / offline-1to1 오프라인 · 1:1 / leave 나가기 확인 시트 /  | A2 진행 방식(온라인/오프라인) 서버 저장
FH02b / 만들기 2/5 LINK BAND·녹음·AI 분석 | 몰입형 | LINKS:none,optional,required,offline || none LINK BAND 사용 안 함 / optional LINK BAND 선택 / required LINK BAND 필수 / offline 오프라인(영상 녹화 자리를 안내로 대체) /  | -
FH02c / 만들기 3/5 일정(5분 단위) | 몰입형 | LINKS:now,later,conflict,long || now 지금 바로 / later 시간 예약 / conflict 시간 예약 · 같은 시간 클래스 있음 / long 1시간 30분 표기 /  | A2 예약 일정과 방식 함께 저장
FH02d / 만들기 4/5 참여자 초대 | 몰입형 | LINKS:empty,picked,solo,search || empty 선택 없음 / picked 3명 선택 / solo 1:1 · 1명 고정 / search 검색 결과 /  | -
FH02e / 만들기 5/5 확인 | 몰입형 | LINKS:online,offline || online 온라인 · 그룹 · 예약 / offline 오프라인 · 1:1 · 지금 바로 /  | A2 진행 방식 서버 저장
FH03 / 생성 완료 | 몰입형 | LINKS:online,offline,partial,scheduled,none || online 온라인 · 지금 바로 / offline 오프라인 · 1:1 / partial 일부 초대 실패 · 다시 보내기 / scheduled 예약 생성 / none 초대 없이 생성 /  | A7 초대 알림만으로 입장(입장 경로 정리) · 초대 발송 결과(성공·실패) 응답은 구현 단계 확인
FH04 / 클래스 상세 | 셸형 | LINKS:ready,scheduled,open,progress,completed,cancelled,offline,menu,cancel,close,delete,net || ready 준비 / scheduled 예정 / open 입장 가능 / progress 진행 중 / completed 완료 / cancelled 취소됨 / offline 준비 · 오프라인 1:1 / menu 더보기 시트 / cancel 취소 확인 시트 / close 클래스 닫기 확인 시트(열림) / delete 삭제 확인 시트 / net 네트워크 끊김 /  | A5 시작 판정 · A6 초대 참여자 이름 표시
=== host-b
화면 ID | 화면 | 케이스 | 가정
FH05 | 세팅 — 장비 점검 (내 영상·소리) | LINKS:ok,quiet,cam-off,mic-off,mic-off-warn,mic-denied,cam-denied,nodevice,unsupported,offline || okquietcam-offmic-offmic-off-warnmic-deniedcam-deniednodeviceunsupportedoffline | A2 (오프라인 주소 표시는 장소 유형이 서버에 저장돼야 함)
FH06 | 로비(열림) | LINKS:g-on-0,g-on-3,g-on-8,g-on-12,g-off-0,g-off-3,g-off-8,g-off-12,o-on-0,o-on-1,o-on-1r,o-off-0,o-off-1,o-off-1r,g-on-3-req,g-off-3-none,o-off-1r-none,g-on-8-none,g-on-0-inv0,g-off-0-inv0,g-on-3-wait,g-off-3-wait,g-on-12-many,g-on-3-contact,g-on-8-contact || g-on-0g-on-3g-on-8g-on-12g-off-0g-off-3g-off-8g-off-12o-on-0o-on-1o-on-1ro-off-0o-off-1o-off-1rg-on-3-reqg-off-3-noneo-off-1r-noneg-on-8-noneg-on-0-inv0g-off-0-inv0g-on-3-waitg-off-3-waitg-on-12-manyg-on-3-contactg-on-8-contact | A5 (시작 판정을 대기실 인원 기준으로), A9 (대기실이 비어도·준비 중 회원이 있어도 시작 가능, 시작 후 입장), A8 (전극별 접촉 상태 전송), A6 (초대 회원 이름·알림 상태), 시안 가정 S1: 호스트가 이름별 설문·밴드·기기 준비 상태와 전극 접촉을 실시간으로 받는다, 시안 가정 S6: 아직 입장하지 않은 초대 회원에게 알림을 다시 보내는
FH06a | 로비 시트 — 회원 초대·BGM·내 밴드·발언권·채팅 | LINKS:invite,invite-all,bgm,band,band-on,band-bad-l,band-bad-r,band-bad-lr,speak,chat,chat-off || inviteinvite-allbgmbandband-onband-bad-lband-bad-rband-bad-lrspeakchatchat-off | A6, 시안 가정 S6 (알림 재전송·초대 추가). 채팅·발언권은 온라인 그룹 로비 기준. 클래스 링크는 로그인이 필요한 클래스 상세 딥링크
FH07 | 시작 확인 시트 | LINKS:ok,pending,all-wait,many-wait,mic-off,no-consent,offline,one,one-wait,empty-wait,empty-wait-offline,empty-wait-one || okpendingall-waitmany-waitmic-offno-consentofflineoneone-waitempty-waitempty-wait-offlineempty-wait-one | A1 (녹음 동의 서버 저장), A9 (대기실이 비어도 시작 가능 — 시작 후 입장 / 준비가 끝나지 않은 회원도 시작 후 입장해 이어서 준비), 시안 가정 S2: 녹음 동의를 시작 전에 받는다(현행은 시작 직후 모달), 시안 가정 S4: 오프라인도 이 기기 마이크로 녹음할 수 있다
FH08 | 나가기·클래스 닫기 시트 | LINKS:choose,choose-0,confirm || choosechoose-0confirm | 시안 가정 S3: 닫으면 대기 회원 전원에게 닫힘 안내가 전달된다
FH09 | 종료 확인, 종료 씬, 리포트 진행 | LINKS:confirm,confirm-busy,end-saving,end-stt,end-ai,end-done,manual-ing,manual-done || confirmconfirm-busyend-savingend-sttend-aiend-donemanual-ingmanual-done | 시안 가정 S5: 종료 후 /record 로 점프하지 않고 같은 몰입 화면에서 진행을 보여준다
FH10 | 닫힌 클래스 / 오류 | LINKS:closed,closed-0,closed-revisit,error,error-notfound,error-forbidden,error-network || closedclosed-0closed-revisiterrorerror-notfounderror-forbiddenerror-network | 시안 가정 S3 (닫힘 안내 인원), 서버 오류 메시지는 화면에서 사용자 문구로 매핑(구현 단계 결정)
