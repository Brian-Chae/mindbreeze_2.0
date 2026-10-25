# 버튼·카드·입력·탭·칩 실측 차이

대표 요소 비교. 원본 JSON에는 모든 후보가 있으며 대표는 버튼형 카드(높이>64px)를 제외한 본문 우선 요소다. 요소가 없으면 N/A. 버튼 종류는 색·class·aria에 따른 수집용 분류이며 동일 기능이라는 판정은 별도 검토한다. `9999px` radius 차이는 CSS 수치 차이이며 실제 곡률 반경 차이가 아니다. hover는 JSON의 hover에 normal/hover를 나란히 저장한다.

| 경로 / 역할 / 폭 | 종류 | 요소 | 높이 | radius | PL | PT | font-size | font-weight | 색/배경 |
|---|---|---|---:|---|---:|---:|---:|---|---|
| `/app/ai` client 1440 | primary | 동의하고 시작하기 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/ai` client 1440 | secondary | 채팅1 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/ai` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/ai` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/ai` client 1440 | card | 마음 곁의 루시 (AI)AI 대화를 시작하기 전에A | 345.5 (+41.5) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/ai` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/ai` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/ai` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 1440 | primary | 코드로 바로 입장 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/audit-unknown` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 1440 | ghost | 전체 보기 | 19.5 (-24.5) | 0px (-12) | 0 (+0) | 0 (+0) | 13 (+0) | 700 (+100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/audit-unknown` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/audit-unknown` client 1440 | card | 담당 상담사대화하기 샘샘플 상담사임상·최면심리상담  | 142.5 (-161.5) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/audit-unknown` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 1440 | chip | 곧 열림 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/app/chat/lucy` client 1440 | primary | 동의하고 시작하기 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/chat/lucy` client 1440 | secondary | 채팅1 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/chat/lucy` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat/lucy` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/chat/lucy` client 1440 | card | 마음 곁의 루시 (AI)AI 대화를 시작하기 전에A | 345.5 (+41.5) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/chat/lucy` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat/lucy` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat/lucy` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 1440 | secondary | 채팅 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/chat/sample-room` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat/sample-room` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/chat/sample-room` client 1440 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 61 (-243) | 16px (-4) | 14 (-10) | 8 (-16) | 15 (+1) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/chat/sample-room` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat/sample-room` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 1440 | secondary | 채팅1 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/chat` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/chat` client 1440 | card | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 1440 | secondary | 내 클래스로 돌아가기 | 44 (+0) | 12px (+0) | 16 (+16) | 10 (+10) | 14 (+0) | 600 (+200) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/app/classes/sample-class` client 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes/sample-class` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/classes/sample-class` client 1440 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4클 | 199.59375 (-104.41) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes/sample-class` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 1440 | tab | 개요 | 44 | 12px | 16 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/app/classes/sample-class` client 1440 | chip | 진행 중 | 28 (-4) | 20px (-9979) | 10 (-2) | 5 (+5) | 12 (-1) | 400 (-200) | rgb(101, 81, 115) / rgb(241, 237, 245) |
| `/app/classes` client 1440 | primary | 클래스 신청하기 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/classes` client 1440 | secondary | 내 클래스 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/classes` client 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/classes` client 1440 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 249.1875 (-54.81) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes` client 1440 | input | 회원 클래스 코드 | 40 | 12px | 12 | 8 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/classes` client 1440 | chip | 진행 중 | 28 (-4) | 0px (-9999) | 0 (-12) | 0 (+0) | 14 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling/sample-relationship` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 1440 | secondary | 내 상담 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/counseling/sample-relationship` client 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling/sample-relationship` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/counseling/sample-relationship` client 1440 | card | 상담 일정진행 중상담사 샘플 상담사 | 88 (-216) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/counseling/sample-relationship` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 1440 | secondary | 내 상담 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/counseling` client 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/counseling` client 1440 | card | 상담 일정진행 중상담사 샘플 상담사다음 상담 데이터 | 110 (-194) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/counseling` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 1440 | secondary | 알림 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/notifications` client 1440 | ghost | 전체 읽음 | 22 (-22) | 0px (-12) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-200) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/notifications` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/notifications` client 1440 | card | 아직 알림이 없습니다. | 120 (-184) | 16px (-4) | 48 (+24) | 48 (+24) | 15 (+1) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/notifications` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 1440 | secondary | 수정 | 31.5 (-12.5) | 9999px (+9987) | 12 (+12) | 6 (+6) | 13 (-1) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/participation-profile` client 1440 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (-12) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-200) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/app/participation-profile` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/participation-profile` client 1440 | card | 프로필 정보수정성별-생년월일-고민 분야스트레스관심  | 254 (-50) | 16px (-4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/participation-profile` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 1440 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+16) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/app/profile` client 1440 | ghost | 참여 프로필 관리 ↗ | 48 (+4) | 0px (-12) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-200) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/app/profile` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/profile` client 1440 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/app/profile` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/reports?report=sample-report` client 1440 | primary | 측정 방법과 한계 알아보기 | 18 (-26) | 0px (-9999) | 0 (-16) | 0 (+0) | 15 (+0) | 400 (-200) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/app/reports?report=sample-report` client 1440 | secondary | 상담사별 그룹핑 ON | 40 (-4) | 12px (+0) | 16 (+16) | 0 (+0) | 13 (-1) | 600 (+200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/reports?report=sample-report` client 1440 | ghost | 보기 | 19.5 (-24.5) | 0px (-12) | 0 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/reports?report=sample-report` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/reports?report=sample-report` client 1440 | card | 샘플 상담사1건제목클래스 유형날짜·시간상태액션샘플  | 160.5 (-143.5) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports?report=sample-report` client 1440 | input | 제목·요약 검색 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports?report=sample-report` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/reports?report=sample-report` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 1440 | secondary | 상담사별 그룹핑 ON | 40 (-4) | 12px (+0) | 16 (+16) | 0 (+0) | 13 (-1) | 600 (+200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/reports` client 1440 | ghost | 보기 | 19.5 (-24.5) | 0px (-12) | 0 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/reports` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/reports` client 1440 | card | 샘플 상담사1건제목클래스 유형날짜·시간상태액션NEW | 160.5 (-143.5) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports` client 1440 | input | 제목·요약 검색 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 1440 | primary | 리포트 보기 | 48 (+4) | 9999px (+0) | 24 (+8) | 0 (+0) | 15 (+0) | 700 (+100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/sessions/sample-session` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 1440 | ghost | 클래스 목록 | 44 (+0) | 0px (-12) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/sessions/sample-session` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/sessions/sample-session` client 1440 | card | 이번 클래스 | 168.6875 (-135.31) | 16px (-4) | 16 (-8) | 16 (-8) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions/sample-session` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 1440 | chip | 명상 클래스 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/app/sessions` client 1440 | primary | 클래스 신청하기 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/sessions` client 1440 | secondary | 내 클래스 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/sessions` client 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+0) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/sessions` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app/sessions` client 1440 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 249.1875 (-54.81) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions` client 1440 | input | 회원 클래스 코드 | 40 | 12px | 12 | 8 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app/sessions` client 1440 | chip | 진행 중 | 28 (-4) | 0px (-9999) | 0 (-12) | 0 (+0) | 14 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app` client 1440 | primary | 코드로 바로 입장 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app` client 1440 | secondary | 다음 클래스 | 44 (+0) | 12px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app` client 1440 | ghost | 전체 보기 | 44 (+0) | 12px (+0) | 0 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/app` client 1440 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 304 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/app` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/app` client 1440 | chip | 다음 일정 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/chat/sample-room` client 1440 | primary | + 새 채팅방 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat/sample-room` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat/sample-room` client 1440 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 61 (-243) | 16px (-4) | 14 (-10) | 8 (-16) | 15 (+1) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` client 1440 | primary | + 새 채팅방 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat` client 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (-4) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat` client 1440 | card | N/A | — | — | — | — | — | — | — |
| `/chat` client 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 1440 | secondary | 뮤트 중 | 44 (+0) | 9999px (+9987) | 8 (+8) | 0 (+0) | 13 (-1) | 400 (+0) | rgb(207, 198, 214) / rgba(24, 12, 36, 0.66) |
| `/design/class-player?role=member&case=M02` client 1440 | ghost | 내 상태 | 54 (+10) | 18px (+6) | 0 (+0) | 0 (+0) | 12 (-1) | 400 (-200) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/design/class-player?role=member&case=M02` client 1440 | icon | 나가기 | 44 (+0) | 50% (기준 9999px) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/design/class-player?role=member&case=M02` client 1440 | card |  | 392 (+88) | 50% (기준 20px) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/design/class-player?role=member&case=M02` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 1440 | chip | 마음챙김 명상수업 · 4회차12:34 / 30:00 | 56 (+24) | 9999px (+0) | 24 (+12) | 6 (+6) | 16 (+3) | 400 (-200) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/notifications` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/notifications` client 1440 | ghost | 설정 | 19.5 (-24.5) | 0px (-12) | 0 (+0) | 0 (+0) | 13 (+0) | 500 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/notifications` client 1440 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-92) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | card | 마지막 단계예요!원활한 서비스 이용을 위해아래 정보 | 595.75 (+291.75) | 16px (-4) | 32 (+8) | 32 (+8) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/client/essentials` client 1440 | input | 이름을 입력해주세요 | 50 | 12px | 16 | 12 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/client/essentials` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 1440 | primary | 다음 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/onboarding/client` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 1440 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (-12) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/onboarding/client` client 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 1440 | card | 1기본 정보2상세 정보3프로필4상담사 매칭기본 정보 | 413 (+109) | 28px (+8) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.1) |
| `/onboarding/client` client 1440 | input | 이름을 입력해주세요 | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgba(255, 255, 255, 0.9) |
| `/onboarding/client` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | card | 신청 내역이 없습니다. | 72 (-232) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (+1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` client 1440 | primary | 밴드 연결 | 28 (-16) | 8px (-9991) | 12 (-4) | 6 (+6) | 12 (-3) | 500 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` client 1440 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (+12) | 6 (+6) | 12 (-2) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` client 1440 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (-12) | 0 (+0) | 0 (+0) | 16 (+3) | 600 (+0) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` client 1440 | icon | 패널 접기 | 24 (-20) | 4px (-9995) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` client 1440 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 227 (-77) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/playground` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 1440 | primary | 기록 보기 | 44 (+0) | 12px (-9987) | 20 (+4) | 0 (+0) | 16 (+1) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` client 1440 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+14) | 0 (+0) | 13 (-1) | 600 (+200) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/live` client 1440 | ghost | 기록 보기 | 44 (+0) | 12px (+0) | 20 (+20) | 6 (+6) | 12 (-1) | 600 (+0) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/live` client 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 1440 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 468 (+164) | 16px (-4) | 24 (+0) | 64 (+40) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/live` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 1440 | primary | 기록 보기 | 44 (+0) | 12px (-9987) | 20 (+4) | 0 (+0) | 16 (+1) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` client 1440 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+14) | 0 (+0) | 13 (-1) | 600 (+200) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/player` client 1440 | ghost | 기록 보기 | 44 (+0) | 12px (+0) | 20 (+20) | 6 (+6) | 12 (-1) | 600 (+0) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/player` client 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 1440 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 468 (+164) | 16px (-4) | 24 (+0) | 64 (+40) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/player` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 1440 | primary | 메모 저장 | 38 (-6) | 12px (-9987) | 16 (+0) | 8 (+8) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` client 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 1440 | ghost | 회차 요약으로 | 44 (+0) | 0px (-12) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-200) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions/sample-session/record` client 1440 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 200 (-104) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` client 1440 | input | 합성 기록 | 221 | 12px | 12 | 12 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/settings` client 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` client 1440 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+16) | 12 (+12) | 15 (+1) | 700 (+300) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` client 1440 | ghost | 참여 프로필 관리 ↗ | 48 (+4) | 0px (-12) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-200) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` client 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/settings` client 1440 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` client 1440 | input | N/A | — | — | — | — | — | — | — |
| `/settings` client 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` client 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/app/ai` client 390 | primary | 동의하고 시작하기 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/ai` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/ai` client 390 | ghost | 동의하지 않음 | 50 (+6) | 12px (+12) | 16 (+16) | 12 (+12) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/ai` client 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/ai` client 390 | card | 마음 곁의 루시 (AI)AI 대화를 시작하기 전에A | 345.5 (+41.5) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/ai` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/ai` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/ai` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 390 | primary | 코드로 바로 입장 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/audit-unknown` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 390 | ghost | 전체 보기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 700 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/audit-unknown` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/audit-unknown` client 390 | card | 담당 상담사대화하기 샘샘플 상담사임상·최면심리상담  | 142.5 (-161.5) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/audit-unknown` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/audit-unknown` client 390 | chip | 곧 열림 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (-4) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/app/chat/lucy` client 390 | primary | 동의하고 시작하기 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/chat/lucy` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/chat/lucy` client 390 | ghost | 동의하지 않음 | 50 (+6) | 12px (+12) | 16 (+16) | 12 (+12) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/chat/lucy` client 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/chat/lucy` client 390 | card | 마음 곁의 루시 (AI)AI 대화를 시작하기 전에A | 345.5 (+41.5) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/chat/lucy` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/chat/lucy` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat/lucy` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 390 | ghost | 상대방 신고 | 44 (+0) | 0px (+0) | 8 (+8) | 0 (+0) | 13 (-1) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat/sample-room` client 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/chat/sample-room` client 390 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 146 (-158) | 16px (-4) | 12 (-12) | 8 (-16) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/app/chat/sample-room` client 390 | input | 메시지를 입력하세요 | 48 | 12px | 16 | 10 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/chat/sample-room` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat/sample-room` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+6) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/chat` client 390 | card | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 390 | input |  | 20 | 0px | 0 | 0 | 13 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/chat` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/chat` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 390 | secondary | 내 클래스로 돌아가기 | 44 (+0) | 12px (+0) | 16 (+0) | 10 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/app/classes/sample-class` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes/sample-class` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes/sample-class` client 390 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4클 | 225 (-79) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes/sample-class` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/classes/sample-class` client 390 | tab | 개요 | 44 | 12px | 16 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/app/classes/sample-class` client 390 | chip | 진행 중 | 30 (-2) | 20px (-9979) | 10 (-2) | 5 (+1) | 13 (+0) | 400 (-200) | rgb(101, 81, 115) / rgb(241, 237, 245) |
| `/app/classes` client 390 | primary | 클래스 신청하기 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/classes` client 390 | secondary | 코드로 바로 입장 | 48 (+4) | 9999px (+9987) | 16 (+0) | 0 (-10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/classes` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/classes` client 390 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 251 (-53) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes` client 390 | input | 회원 클래스 코드 | 48 | 12px | 12 | 8 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/classes` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/classes` client 390 | chip | 진행 중 | 30 (-2) | 0px (-9999) | 0 (-12) | 0 (-4) | 14 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling/sample-relationship` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 390 | secondary | 상담 | 52 (+8) | 999px (+987) | 0 (-16) | 0 (-10) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/app/counseling/sample-relationship` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling/sample-relationship` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling/sample-relationship` client 390 | card | 상담 일정진행 중상담사 샘플 상담사 | 88 (-216) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/counseling/sample-relationship` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/counseling/sample-relationship` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 390 | secondary | 상담 | 52 (+8) | 999px (+987) | 0 (-16) | 0 (-10) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/app/counseling` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/counseling` client 390 | card | 상담 일정진행 중상담사 샘플 상담사다음 상담 데이터 | 110 (-194) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/counseling` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/counseling` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 390 | ghost | 전체 읽음 | 22 (-22) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app/notifications` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/notifications` client 390 | card | 아직 알림이 없습니다. | 120 (-184) | 16px (-4) | 48 (+24) | 48 (+24) | 15 (+1) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/notifications` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/notifications` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 390 | secondary | 수정 | 31.5 (-12.5) | 9999px (+9987) | 12 (-4) | 6 (-4) | 13 (-1) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/participation-profile` client 390 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/app/participation-profile` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/participation-profile` client 390 | card | 프로필 정보수정성별-생년월일-고민 분야스트레스관심  | 310.5 (+6.5) | 16px (-4) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/participation-profile` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/participation-profile` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 390 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+0) | 12 (+2) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/app/profile` client 390 | ghost | 참여 프로필 관리 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/app/profile` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/profile` client 390 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/app/profile` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/profile` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/reports?report=sample-report` client 390 | primary | 측정 방법과 한계 알아보기 | 44 (-4) | 0px (-9999) | 0 (-16) | 0 (+0) | 16 (+2) | 400 (-200) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/app/reports?report=sample-report` client 390 | secondary | 상담사별 그룹핑 ON | 44 (+0) | 12px (+0) | 16 (+0) | 0 (-10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/reports?report=sample-report` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/reports?report=sample-report` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/reports?report=sample-report` client 390 | card | N/A | — | — | — | — | — | — | — |
| `/app/reports?report=sample-report` client 390 | input | 제목·요약 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports?report=sample-report` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/reports?report=sample-report` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 390 | secondary | 상담사별 그룹핑 ON | 44 (+0) | 12px (+0) | 16 (+0) | 0 (-10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/app/reports` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/reports` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/reports` client 390 | card | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 390 | input | 제목·요약 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/reports` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/reports` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 390 | primary | 리포트 보기 | 48 (+0) | 9999px (+0) | 24 (+8) | 0 (+0) | 15 (+1) | 700 (+100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/sessions/sample-session` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 390 | ghost | 클래스 목록 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/app/sessions/sample-session` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/sessions/sample-session` client 390 | card | 이번 클래스 | 240 (-64) | 16px (-4) | 16 (-8) | 16 (-8) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions/sample-session` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/sessions/sample-session` client 390 | chip | 명상 클래스 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (-4) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/app/sessions` client 390 | primary | 클래스 신청하기 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app/sessions` client 390 | secondary | 코드로 바로 입장 | 48 (+4) | 9999px (+9987) | 16 (+0) | 0 (-10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/app/sessions` client 390 | ghost | 메뉴 열기 1건 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/sessions` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app/sessions` client 390 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 251 (-53) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions` client 390 | input | 회원 클래스 코드 | 48 | 12px | 12 | 8 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app/sessions` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app/sessions` client 390 | chip | 진행 중 | 30 (-2) | 0px (-9999) | 0 (-12) | 0 (-4) | 14 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app` client 390 | primary | 코드로 바로 입장 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/app` client 390 | secondary | 전체 보기 | 44 (+0) | 12px (+0) | 16 (+0) | 10 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/app` client 390 | ghost | 전체 보기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 700 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/app` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/app` client 390 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 304 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/app` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/app` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/app` client 390 | chip | 다음 일정 | 32 (+0) | 9999px (+0) | 12 (+0) | 4 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/chat/sample-room` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` client 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+6) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` client 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` client 390 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 146 (-158) | 16px (-4) | 12 (-12) | 8 (-16) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` client 390 | input | 메시지를 입력하세요 | 48 | 12px | 16 | 10 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/chat/sample-room` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` client 390 | primary | + 새 채팅방 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat` client 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+6) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` client 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/chat` client 390 | card | N/A | — | — | — | — | — | — | — |
| `/chat` client 390 | input |  | 20 | 0px | 0 | 0 | 13 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 390 | secondary | 뮤트 중 | 44 (+0) | 9999px (+9987) | 8 (-8) | 0 (-10) | 14 (+0) | 400 (-200) | rgb(207, 198, 214) / rgba(24, 12, 36, 0.66) |
| `/design/class-player?role=member&case=M02` client 390 | ghost | 내 상태 | 50 (+6) | 18px (+18) | 0 (+0) | 0 (+0) | 13 (-1) | 400 (-300) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/design/class-player?role=member&case=M02` client 390 | icon | 나가기 | 44 (+0) | 50% (기준 0px) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/design/class-player?role=member&case=M02` client 390 | card |  | 232.6875 (-71.31) | 50% (기준 20px) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/design/class-player?role=member&case=M02` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-player?role=member&case=M02` client 390 | chip | 마음챙김 명상수업 · 4회차12:34 / 30:00 | 56 (+24) | 9999px (+0) | 16 (+4) | 6 (+2) | 16 (+3) | 400 (-200) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/notifications` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/notifications` client 390 | ghost | 설정 | 19.5 (-24.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-1) | 500 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` client 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` client 390 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-92) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | card | 마지막 단계예요!원활한 서비스 이용을 위해아래 정보 | 600.75 (+296.75) | 16px (-4) | 32 (+8) | 32 (+8) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/client/essentials` client 390 | input | 이름을 입력해주세요 | 50 | 12px | 16 | 12 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/client/essentials` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/client/essentials` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 390 | primary | 다음 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/onboarding/client` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 390 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/onboarding/client` client 390 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 390 | card | 1기본 정보2상세 정보3프로필4상담사 매칭기본 정보 | 417 (+113) | 28px (+8) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.1) |
| `/onboarding/client` client 390 | input | 이름을 입력해주세요 | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(255, 255, 255, 0.9) |
| `/onboarding/client` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/client` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | card | 신청 내역이 없습니다. | 72 (-232) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (+1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` client 390 | primary | 밴드 연결 | 28 (-20) | 8px (-9991) | 12 (-4) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` client 390 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (-4) | 6 (-4) | 12 (-2) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` client 390 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 600 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` client 390 | icon | 패널 접기 | 24 (-20) | 4px (+4) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` client 390 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 315 (+11) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/playground` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 390 | primary | 기록 보기 | 44 (-4) | 12px (-9987) | 20 (+4) | 0 (+0) | 16 (+2) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` client 390 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (-2) | 0 (-10) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/live` client 390 | ghost | 기록 보기 | 44 (+0) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-2) | 600 (-100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/live` client 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 390 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 518 (+214) | 16px (-4) | 24 (+0) | 64 (+40) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/live` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 390 | primary | 기록 보기 | 44 (-4) | 12px (-9987) | 20 (+4) | 0 (+0) | 16 (+2) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` client 390 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (-2) | 0 (-10) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/player` client 390 | ghost | 기록 보기 | 44 (+0) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-2) | 600 (-100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/player` client 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 390 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 518 (+214) | 16px (-4) | 24 (+0) | 64 (+40) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/player` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 390 | primary | 메모 저장 | 38 (-10) | 12px (-9987) | 16 (+0) | 8 (+8) | 15 (+1) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` client 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 390 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` client 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` client 390 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 282 (-22) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` client 390 | input | 합성 기록 | 234 | 12px | 12 | 12 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/settings` client 390 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` client 390 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+0) | 12 (+2) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` client 390 | ghost | 참여 프로필 관리 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` client 390 | icon | 알림 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/settings` client 390 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+2) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` client 390 | input | N/A | — | — | — | — | — | — | — |
| `/settings` client 390 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` client 390 | chip | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 1440 | primary | + 새 채팅방 | 44 (-4) | 9999px (+0) | 16 (+16) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/agent` counselor 1440 | secondary | 내담자 피드백·일정 변경 문의 | 40 (-16) | 12px (-4) | 16 (+0) | 8 (-8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/agent` counselor 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/agent` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/agent` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/agent` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 1440 | primary | + 새 채팅방 | 44 (-4) | 9999px (+0) | 16 (+16) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat/sample-room` counselor 1440 | secondary | 채팅 | 46.5 (-9.5) | 12px (-4) | 14 (-2) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat/sample-room` counselor 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat/sample-room` counselor 1440 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 61 (-243) | 16px (-4) | 14 (-10) | 8 (-16) | 15 (-1) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` counselor 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 1440 | primary | + 새 채팅방 | 44 (-4) | 9999px (+0) | 16 (+16) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` counselor 1440 | secondary | 채팅1 | 46.5 (-9.5) | 12px (-4) | 14 (-2) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat` counselor 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+7) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 1440 | input |  | 16 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | ghost | 목록으로 돌아가기 | 44 (+0) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+2) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/classes/new` counselor 1440 | icon | 만들기 나가기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/new` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/now` counselor 1440 | primary | 온라인 | 52 (+4) | 16px (-9983) | 0 (+0) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/classes/now` counselor 1440 | secondary | 20분 | 44 (-12) | 999px (+983) | 16 (+0) | 8 (-8) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.06) |
| `/classes/now` counselor 1440 | ghost | 더보기 · 정원 10명 · LINK BAND 선택  | 56 (+12) | 16px (+16) | 16 (+16) | 14 (+14) | 13 (+0) | 400 (-300) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/now` counselor 1440 | icon | 클래스 목록 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/now` counselor 1440 | card | 지금 바로 열어요클래스 이름비워 두면 자동 이름으로 | 579 (+275) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/classes/now` counselor 1440 | input | 클래스 이름 | 52 | 16px | 16 | 0 | 15 | 400 | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/classes/now` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/now` counselor 1440 | chip | 20분30분45분60분직접 입력직접 | 44 (+12) | 0px (-9999) | 0 (-12) | 0 (+0) | 16 (+3) | 400 (-200) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 1440 | secondary | 결과 새로고침 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` counselor 1440 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/members` counselor 1440 | card | 클래스 멤버초대 이후의 예정 정규 회차부터 함께해요 | 178 (-126) | 16px (-4) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 1440 | secondary | 회차 목록 | 44 (-12) | 12px (-4) | 16 (+0) | 0 (-16) | 15 (-1) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` counselor 1440 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/schedule` counselor 1440 | card | 편성 회차 | 136 (-168) | 18px (-2) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(61, 52, 71) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` counselor 1440 | input | 2회차 선택 | 18 | 0px | 0 | 0 | 13 | 400 | rgb(61, 52, 71) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-221.5) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 1440 | primary | 표로 보기 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (-1) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes/sample-class/sessions` counselor 1440 | secondary | 회차 목록 | 44 (-12) | 12px (-4) | 16 (+0) | 0 (-16) | 15 (-1) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` counselor 1440 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/sessions` counselor 1440 | card | 회차 목록 | 142 (-162) | 16px (-4) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 1440 | secondary | 코드 복사 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 1440 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/settings` counselor 1440 | card | 클래스 코드0042코드 복사코드는 클래스가 끝날 때 | 157.796875 (-146.2) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 1440 | input | 추가할 지도사 | 48 | 16px | 12 | 8 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 1440 | secondary | 지난 기수로 새 클래스 만들기 | 44 (-12) | 12px (-4) | 16 (+0) | 0 (-16) | 15 (-1) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class` counselor 1440 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+1) | 600 (-100) | rgb(110, 26, 140) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class` counselor 1440 | card | 클래스 개요클래스 상태진행 중클래스 진행1/4회차  | 426 (+122) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 1440 | chip | 예정 | 33.5 (+1.5) | 9999px (+0) | 12 (+0) | 6 (+6) | 13 (+0) | 400 (-200) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.4) |
| `/classes` counselor 1440 | primary | 전체 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (-1) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes` counselor 1440 | secondary | 즉석 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes` counselor 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/classes` counselor 1440 | input | 클래스 이름 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/classes` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes` counselor 1440 | chip | 진행 중 | 30 (-2) | 9999px (+0) | 10 (-2) | 6 (+6) | 12 (-1) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/invite` counselor 1440 | primary | 초대 링크 생성 | 44 (-4) | 9999px (+0) | 16 (+16) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/invite` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 1440 | ghost | ← 목록으로 | 44 (+0) | 0px (+0) | 12 (+12) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients/invite` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 1440 | card | 회원 초대초대할 회원의 이메일을 입력하면 초대 링크 | 267 (-37) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/invite` counselor 1440 | input | client@example.com | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/invite` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` counselor 1440 | primary | 저장 | 44 (-4) | 9999px (+0) | 16 (+16) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/sample-client` counselor 1440 | secondary | 30일 | 40 (-16) | 10px (-6) | 12 (-4) | 0 (-16) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/sample-client` counselor 1440 | ghost | 개인정보 열람 | 44 (+0) | 12px (+12) | 20 (+20) | 0 (+0) | 16 (+3) | 600 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/clients/sample-client` counselor 1440 | card | 회원 요약 | 286 (-18) | 20px (+0) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` counselor 1440 | input | AI 안부 대화 켜기 | 13 | 0px | 0 | 0 | 15 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/clients` counselor 1440 | primary | 회원 초대 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 16 (+1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients` counselor 1440 | secondary | 표 | 40 (-16) | 10px (-6) | 12 (-4) | 0 (-16) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients` counselor 1440 | ghost | 카드 | 40 (-4) | 10px (+10) | 12 (+12) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/clients` counselor 1440 | card | 검색과 필터 | 174 (-130) | 20px (+0) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` counselor 1440 | input | 회원 검색 | 48 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 1440 | primary | 명상 | 52 (+4) | 16px (-9983) | 8 (+8) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/counseling/new` counselor 1440 | secondary | 임상심리상담 | 52 (-4) | 16px (+0) | 8 (-8) | 0 (-16) | 15 (-1) | 600 (+200) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 1440 | icon | 정원 줄이기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` counselor 1440 | card | 어떤 클래스를 만들까요?유형임상심리상담최면심리상담명 | 489.1875 (+185.19) | 24px (+4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/counseling/new` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-221.5) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 1440 | secondary | 상담 | 46.5 (-9.5) | 12px (-4) | 14 (-2) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` counselor 1440 | ghost | 내담자 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling/sample-relationship` counselor 1440 | card | 상담 일정진행 중상담사 샘플 상담사샘플 회원내담자 | 162 (-142) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 1440 | secondary | 내담자 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 400 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling` counselor 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling` counselor 1440 | card | 상담 일정진행 중샘플 회원다음 상담 데이터 없음 | 110 (-194) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 1440 | ghost | Mind Breeze | 30 (-14) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/credentials` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 1440 | card | 인증 등급인증 완료모든 필수 서류가 승인되면 인증  | 112 (-192) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` counselor 1440 | input |  | 44 | 12px | 16 | 12 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 1440 | primary | 지금 바로 시작 | 48 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 700 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/dashboard` counselor 1440 | secondary | 루시 (AI) 브리핑오늘 일정과 내담자 피드백 확인 | 56 (+0) | 16px (+0) | 16 (+0) | 16 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/dashboard` counselor 1440 | ghost | 전체 보기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (+0) | 700 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/dashboard` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/dashboard` counselor 1440 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 304 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/dashboard` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 1440 | chip | 다음 회차 | 32 (+0) | 9999px (+0) | 12 (+0) | 0 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/design/app` counselor 1440 | primary | dashboard | 28 (-20) | 9999px (+0) | 12 (+12) | 4 (+4) | 12 (-3) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/app` counselor 1440 | secondary | signin | 28 (-28) | 9999px (+9983) | 12 (-4) | 4 (-12) | 12 (-4) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/design/app` counselor 1440 | ghost | 수업 진행 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/app` counselor 1440 | icon |  | 44 (+0) | 22px (-9977) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/design/app` counselor 1440 | card | Mind Breeze대시보드수업 진행참여자메시지3리 | 1024 (+720) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/design/app` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/app` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/app` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | card |  | 392 (+88) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/docs` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 1440 | primary | 서비스 신청 | 40 (-8) | 12px (-9987) | 18 (+18) | 0 (+0) | 14 (-1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/homepage` counselor 1440 | secondary | 샘플 리포트 보기 → | 52 (-4) | 14px (-2) | 22 (+6) | 0 (-16) | 16 (+0) | 600 (+200) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.6) |
| `/design/homepage` counselor 1440 | ghost | Mind Breeze | 28.5 (-15.5) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/homepage` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 1440 | card | HARDWARE · LINK BAND머리에 닿는 순 | 574.375 (+270.38) | 28px (+8) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/design/homepage` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | primary | 세션 예약하기 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 14 (-1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/report` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | card | MIND BREEZE2024.12.04AI brai | 417 (+113) | 28px (+8) | 28 (+4) | 32 (+8) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/design/report` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 1440 | primary | home | 26.5 (-21.5) | 9999px (+0) | 12 (+12) | 4 (+4) | 11 (-4) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/user-app` counselor 1440 | secondary | class | 26.5 (-29.5) | 9999px (+9983) | 12 (-4) | 4 (-12) | 11 (-5) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/design/user-app` counselor 1440 | ghost | 오늘 | 55 (+11) | 0px (+0) | 6 (+6) | 6 (+6) | 16 (+3) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/design/user-app` counselor 1440 | icon |  | 38 (-6) | 19px (-9980) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.7) |
| `/design/user-app` counselor 1440 | card | 2026.05.21 · 목요일안녕하세요, 민지님오늘 | 874 (+570) | 48px (+28) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/design/user-app` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/design` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | primary | 소속 초대 수락하기 | 48 (+0) | 9999px (+0) | 24 (+24) | 0 (+0) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 1440 | secondary | 알림 | 46.5 (-9.5) | 12px (-4) | 14 (-2) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/notifications` counselor 1440 | ghost | 설정 | 19.5 (-24.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (+0) | 500 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/notifications` counselor 1440 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-92) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 1440 | primary | 다음 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 16 (+1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/onboarding/counselor` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 1440 | ghost | Mind Breeze | 36 (-8) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/onboarding/counselor` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 1440 | card | 1기본 정보2상세 정보3자격 증빙4프로필나중에 하기 | 446 (+142) | 20px (+0) | 32 (+8) | 32 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/counselor` counselor 1440 | input |  | 48 | 12px | 16 | 12 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/counselor` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | card | 신청 내역이 없습니다. | 72 (-232) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 1440 | secondary | 정보 수정 | 44 (-12) | 12px (-4) | 12 (-4) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/sample-org` counselor 1440 | ghost | 소속 해제 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (+1) | 600 (-100) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/org/sample-org` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 1440 | card | 가입 요청 관리준비 중가입 요청 관리 기능은 준비  | 108 (-196) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` counselor 1440 | input | 상담사 검색 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | primary | + 기관 가입 상담 신청 | 22 (-26) | 0px (-9999) | 0 (+0) | 0 (+0) | 15 (+0) | 500 (-200) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/org/search` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | input | 센터명 검색 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/search` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 1440 | primary | 밴드 연결 | 28 (-20) | 8px (-9991) | 12 (+12) | 6 (+6) | 12 (-3) | 500 (-200) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` counselor 1440 | secondary | 체험 모드(예시 데이터) | 30 (-26) | 8px (-8) | 12 (-4) | 6 (-10) | 12 (-4) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` counselor 1440 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 600 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` counselor 1440 | icon | 패널 접기 | 24 (-20) | 4px (-9995) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` counselor 1440 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 227 (-77) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 1440 | secondary | 수정 | 31.5 (-24.5) | 9999px (+9983) | 12 (-4) | 6 (-10) | 13 (-3) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/profile/professional` counselor 1440 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/profile/professional` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/profile/professional` counselor 1440 | card | 개인정보수정선택 입력 항목입니다. 입력하지 않아도  | 236.5 (-67.5) | 16px (-4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/profile/professional` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 1440 | primary | 측정 방법과 한계 알아보기 | 18 (-30) | 0px (-9999) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-300) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` counselor 1440 | secondary | 목록으로 | 44.5 (-11.5) | 12px (-4) | 20 (+4) | 10 (-6) | 15 (-1) | 500 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports/sample-report` counselor 1440 | ghost | mind breeze / 몸·마음 리포트 | 28.796875 (-15.2) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+3) | 750 (+50) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/reports/sample-report` counselor 1440 | card | MIND BREEZE · 몸·마음 리포트상담사용me | 282.5 (-21.5) | 16px (-4) | 32 (+8) | 32 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/reports/sample-report` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reports` counselor 1440 | primary | 전체 | 40 (-8) | 0px (-9999) | 14 (+14) | 0 (+0) | 13 (-2) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/reports` counselor 1440 | secondary | 리포트 | 46.5 (-9.5) | 12px (-4) | 14 (-2) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports` counselor 1440 | ghost | 검토중 | 40 (-4) | 0px (+0) | 14 (+14) | 0 (+0) | 13 (+0) | 600 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reports` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/reports` counselor 1440 | card | 샘플 명상 기록1건제목사용자성별생년월일구분타입세션유 | 140 (-164) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` counselor 1440 | input | 리포트 검색 | 40 | 12px | 16 | 0 | 13 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reports` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | ghost | 목록으로 돌아가기 | 44 (+0) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+2) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/sessions/new` counselor 1440 | icon | 만들기 나가기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/sessions/new` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 1440 | secondary | 목록으로 | 44 (-12) | 10px (-6) | 16 (+0) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 1440 | ghost | 01오늘 수업 한 줄 | 50 (+6) | 0px (+0) | 0 (+0) | 12 (+12) | 16 (+3) | 400 (-300) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/class-report` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차수업  | 2274.9375 (+1970.94) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 1440 | input | 참여자 이름 검색 | 48 | 10px | 12 | 12 | 16 | 400 | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 1440 | chip | 상담사 전용 · 발송 대상 아님 | 33.125 (+1.12) | 16px (-9983) | 12 (+0) | 6 (+6) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/live` counselor 1440 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (-1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` counselor 1440 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/live` counselor 1440 | ghost | 01오늘 수업 한 줄 | 48 (+4) | 0px (+0) | 0 (+0) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/live` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 950.625 (+646.62) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/live` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 1440 | chip | 클래스가 종료되었습니다 | 33.4375 (+1.44) | 24px (-9975) | 10 (-2) | 6 (+6) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/player` counselor 1440 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (-1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` counselor 1440 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/player` counselor 1440 | ghost | 01오늘 수업 한 줄 | 48 (+4) | 0px (+0) | 0 (+0) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/player` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 950.625 (+646.62) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/player` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 1440 | chip | 클래스가 종료되었습니다 | 33.4375 (+1.44) | 24px (-9975) | 10 (-2) | 6 (+6) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/record` counselor 1440 | primary | 메모 저장 | 38 (-10) | 12px (-9987) | 16 (+16) | 8 (+8) | 15 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` counselor 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` counselor 1440 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions/sample-session/record` counselor 1440 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 200 (-104) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` counselor 1440 | input | 합성 기록 | 221 | 12px | 12 | 12 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 1440 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (-1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/summary` counselor 1440 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` counselor 1440 | ghost | 01오늘 수업 한 줄 | 48 (+4) | 0px (+0) | 0 (+0) | 12 (+12) | 14 (+1) | 400 (-300) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/summary` counselor 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 950.625 (+646.62) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 1440 | chip | 클래스가 종료되었습니다 | 33.4375 (+1.44) | 24px (-9975) | 10 (-2) | 6 (+6) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 1440 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session` counselor 1440 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions/sample-session` counselor 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-221.5) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/sessions/sample-session` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 1440 | primary | 전체 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (-1) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/sessions` counselor 1440 | secondary | 즉석 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions` counselor 1440 | ghost | 홈 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+2) | 500 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions` counselor 1440 | card | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 1440 | input | 클래스 이름 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/sessions` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 1440 | chip | 진행 중 | 30 (-2) | 9999px (+0) | 10 (-2) | 6 (+6) | 12 (-1) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/settings` counselor 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 1440 | secondary | 플레이그라운드 열기 ↗ | 48 (-8) | 12px (-4) | 16 (+0) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` counselor 1440 | ghost | 상담사 프로필 관리 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+2) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` counselor 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/settings` counselor 1440 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` counselor 1440 | input | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 390 | primary | 대화·브리핑 | 40 (-8) | 12px (-9987) | 16 (+16) | 8 (+8) | 16 (+2) | 400 (-300) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/agent` counselor 390 | secondary | 내담자 피드백·일정 변경 문의 | 40 (-16) | 12px (-4) | 16 (+0) | 8 (-8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/agent` counselor 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/agent` counselor 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/agent` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 390 | input | 루시에게 보낼 메시지 | 48 | 12px | 16 | 10 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/agent` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/agent` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+6) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` counselor 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` counselor 390 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 146 (-158) | 16px (-4) | 12 (-12) | 8 (-16) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` counselor 390 | input | 메시지를 입력하세요 | 48 | 12px | 16 | 10 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/chat/sample-room` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 390 | primary | + 새 채팅방 | 48 (+0) | 9999px (+0) | 16 (+16) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` counselor 390 | secondary | 대화 1건 | 52 (-4) | 999px (+983) | 0 (-16) | 0 (-16) | 13 (-3) | 800 (+400) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/chat` counselor 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+6) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/chat` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 390 | input |  | 20 | 0px | 0 | 0 | 13 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | ghost | 목록으로 돌아가기 | 44 (+0) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+1) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/classes/new` counselor 390 | icon | 만들기 나가기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/new` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/new` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/now` counselor 390 | primary | 온라인 | 52 (+4) | 16px (-9983) | 8 (+8) | 10 (+10) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/classes/now` counselor 390 | secondary | 20분 | 44 (-12) | 999px (+983) | 6 (-10) | 8 (-8) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.06) |
| `/classes/now` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/classes/now` counselor 390 | icon | 클래스 목록 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/now` counselor 390 | card | 지금 바로 열어요클래스 이름비워 두면 자동 이름으로 | 581.390625 (+277.39) | 24px (+4) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/classes/now` counselor 390 | input | 클래스 이름 | 52 | 16px | 16 | 0 | 16 | 400 | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/classes/now` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/now` counselor 390 | chip | 20분30분45분60분직접 입력직접 | 44 (+12) | 0px (-9999) | 0 (-12) | 0 (-4) | 16 (+3) | 400 (-200) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 390 | secondary | 결과 새로고침 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` counselor 390 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+0) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` counselor 390 | card | 클래스 멤버초대 이후의 예정 정규 회차부터 함께해요 | 178 (-126) | 16px (-4) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 390 | secondary | 회차 목록 | 48 (-8) | 12px (-4) | 16 (+0) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` counselor 390 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+0) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 390 | card | 편성 회차 | 198 (-106) | 18px (-2) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(61, 52, 71) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 390 | input | 2회차 선택 | 18 | 0px | 0 | 0 | 13 | 400 | rgb(61, 52, 71) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 390 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions/sample-session` counselor 390 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` counselor 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-202) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/classes/sample-class/sessions/sample-session` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 390 | primary | 표로 보기 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (+0) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes/sample-class/sessions` counselor 390 | secondary | 회차 목록 | 48 (-8) | 12px (-4) | 16 (+0) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` counselor 390 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+0) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` counselor 390 | card | 회차 목록 | 185 (-119) | 16px (-4) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 390 | secondary | 코드 복사 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 390 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+0) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` counselor 390 | card | 클래스 코드0042코드 복사코드는 클래스가 끝날 때 | 178.59375 (-125.41) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 390 | input | 추가할 지도사 | 48 | 16px | 12 | 8 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 390 | secondary | 지난 기수로 새 클래스 만들기 | 48 (-8) | 12px (-4) | 16 (+0) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class` counselor 390 | ghost | 개요 | 47 (+3) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (+0) | 600 (-100) | rgb(110, 26, 140) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` counselor 390 | card | 클래스 개요클래스 상태진행 중클래스 진행1/4회차  | 238 (-66) | 20px (+0) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` counselor 390 | chip | 예정 | 33.5 (+1.5) | 9999px (+0) | 12 (+0) | 6 (+2) | 13 (+0) | 400 (-200) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.4) |
| `/classes` counselor 390 | primary | 전체 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (+0) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes` counselor 390 | secondary | 즉석 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes` counselor 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/classes` counselor 390 | input | 클래스 이름 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/classes` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes` counselor 390 | chip | 진행 중 | 32 (+0) | 9999px (+0) | 10 (-2) | 6 (+2) | 13 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/invite` counselor 390 | primary | 초대 링크 생성 | 48 (+0) | 9999px (+0) | 16 (+16) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/invite` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 390 | ghost | ← 목록으로 | 44 (+0) | 0px (+0) | 12 (+12) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients/invite` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 390 | card | 회원 초대초대할 회원의 이메일을 입력하면 초대 링크 | 294 (-10) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/invite` counselor 390 | input | client@example.com | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/invite` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/invite` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` counselor 390 | primary | 저장 | 48 (+0) | 9999px (+0) | 16 (+16) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/sample-client` counselor 390 | secondary | 30일 | 40 (-16) | 10px (-6) | 12 (-4) | 0 (-16) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/sample-client` counselor 390 | ghost | 개인정보 열람 | 44 (+0) | 12px (+12) | 20 (+20) | 0 (+0) | 16 (+2) | 600 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` counselor 390 | card | 회원 요약 | 406 (+102) | 20px (+0) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` counselor 390 | input | AI 안부 대화 켜기 | 13 | 0px | 0 | 0 | 15 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/clients` counselor 390 | primary | 회원 초대 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 16 (+2) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients` counselor 390 | secondary | 표 | 40 (-16) | 10px (-6) | 12 (-4) | 0 (-16) | 15 (-1) | 700 (+300) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients` counselor 390 | ghost | 카드 | 40 (-4) | 10px (+10) | 12 (+12) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients` counselor 390 | card | 검색과 필터 | 262 (-42) | 20px (+0) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` counselor 390 | input | 회원 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 390 | primary | 명상 | 52 (+4) | 16px (-9983) | 8 (+8) | 0 (+0) | 15 (+1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/counseling/new` counselor 390 | secondary | 임상심리상담 | 52 (-4) | 16px (+0) | 8 (-8) | 0 (-16) | 15 (-1) | 600 (+200) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 390 | icon | 정원 줄이기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` counselor 390 | card | 어떤 클래스를 만들까요?유형임상심리상담최면심리상담명 | 533.1875 (+229.19) | 24px (+4) | 16 (-8) | 16 (-8) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/counseling/new` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/new` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-202) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 390 | secondary | 상담 | 52 (-4) | 999px (+983) | 0 (-16) | 0 (-16) | 13 (-3) | 800 (+400) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/counseling/sample-relationship` counselor 390 | ghost | 내담자 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` counselor 390 | card | 상담 일정진행 중상담사 샘플 상담사샘플 회원내담자 | 162 (-142) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 390 | secondary | 내담자 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 400 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling` counselor 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` counselor 390 | card | 상담 일정진행 중샘플 회원다음 상담 데이터 없음 | 110 (-194) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 390 | ghost | Mind Breeze | 30 (-14) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/credentials` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 390 | card | 인증 등급인증 완료모든 필수 서류가 승인되면 인증  | 134 (-170) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` counselor 390 | input |  | 56 | 12px | 16 | 12 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/credentials` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 390 | primary | 지금 바로 시작 | 48 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 700 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/dashboard` counselor 390 | secondary | 루시 (AI) 브리핑오늘 일정과 내담자 피드백 확인 | 56 (+0) | 16px (+0) | 16 (+0) | 16 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/dashboard` counselor 390 | ghost | 전체 보기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 700 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/dashboard` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/dashboard` counselor 390 | card | 진행 중샘플 · 저녁 호흡 명상클래스 진행 1/4다 | 304 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/dashboard` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/dashboard` counselor 390 | chip | 다음 회차 | 32 (+0) | 9999px (+0) | 12 (+0) | 4 (+0) | 13 (+0) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.14) |
| `/design/app` counselor 390 | primary | dashboard | 28 (-20) | 9999px (+0) | 12 (+12) | 4 (+4) | 12 (-2) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/app` counselor 390 | secondary | signin | 28 (-28) | 9999px (+9983) | 12 (-4) | 4 (-12) | 12 (-4) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/design/app` counselor 390 | ghost | 수업 진행 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+1) | 500 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/app` counselor 390 | icon |  | 44 (+0) | 22px (+22) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/design/app` counselor 390 | card | Mind Breeze대시보드수업 진행참여자메시지3리 | 1024 (+720) | 24px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/design/app` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/app` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/app` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-flow` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/class-player` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | card |  | 392 (+88) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/docs` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/docs` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 390 | primary | 서비스 신청 | 40 (-8) | 12px (-9987) | 18 (+18) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/homepage` counselor 390 | secondary | 샘플 리포트 보기 → | 52 (-4) | 14px (-2) | 22 (+6) | 0 (-16) | 16 (+0) | 600 (+200) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.6) |
| `/design/homepage` counselor 390 | ghost | Mind Breeze | 28.5 (-15.5) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/design/homepage` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 390 | card | HARDWARE · LINK BAND머리에 닿는 순 | 594.0625 (+290.06) | 28px (+8) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/design/homepage` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/homepage` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | primary | 세션 예약하기 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/report` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | card | MIND BREEZE2024.12.04AI brai | 417 (+113) | 28px (+8) | 28 (+4) | 32 (+8) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/design/report` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/report` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 390 | primary | home | 26.5 (-21.5) | 9999px (+0) | 12 (+12) | 4 (+4) | 11 (-3) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/design/user-app` counselor 390 | secondary | class | 26.5 (-29.5) | 9999px (+9983) | 12 (-4) | 4 (-12) | 11 (-5) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/design/user-app` counselor 390 | ghost | 오늘 | 55 (+11) | 0px (+0) | 6 (+6) | 6 (+6) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/design/user-app` counselor 390 | icon |  | 38 (-6) | 19px (+19) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.7) |
| `/design/user-app` counselor 390 | card | 2026.05.21 · 목요일안녕하세요, 민지님오늘 | 874 (+570) | 48px (+28) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/design/user-app` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design/user-app` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/design` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | primary | 소속 초대 수락하기 | 48 (+0) | 9999px (+0) | 24 (+24) | 0 (+0) | 15 (+1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | ghost | 랜딩 페이지로 이동 | 27 (-17) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 390 | ghost | 설정 | 19.5 (-24.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-1) | 500 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` counselor 390 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-92) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 390 | primary | 다음 | 44 (-4) | 12px (-9987) | 20 (+20) | 0 (+0) | 16 (+2) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/onboarding/counselor` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 390 | ghost | Mind Breeze | 36 (-8) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/onboarding/counselor` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 390 | card | 1기본 정보2상세 정보3자격 증빙4프로필나중에 하기 | 430 (+126) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/counselor` counselor 390 | input |  | 48 | 12px | 16 | 12 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/onboarding/counselor` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/onboarding/counselor` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | card | 신청 내역이 없습니다. | 72 (-232) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 390 | secondary | 정보 수정 | 44 (-12) | 12px (-4) | 12 (-4) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/sample-org` counselor 390 | ghost | 소속 해제 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/org/sample-org` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 390 | card | 관리자 권한이 없습니다. 일부 기능이 제한될 수 있 | 78 (-226) | 12px (-8) | 16 (-8) | 16 (-8) | 15 (-1) | 400 (+0) | rgb(31, 31, 31) / rgb(253, 246, 227) |
| `/org/sample-org` counselor 390 | input | 상담사 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | primary | + 기관 가입 상담 신청 | 22 (-26) | 0px (-9999) | 0 (+0) | 0 (+0) | 15 (+1) | 500 (-200) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/org/search` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | input | 센터명 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/search` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/search` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 390 | primary | 밴드 연결 | 28 (-20) | 8px (-9991) | 12 (+12) | 6 (+6) | 12 (-2) | 500 (-200) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` counselor 390 | secondary | 체험 모드(예시 데이터) | 30 (-26) | 8px (-8) | 12 (-4) | 6 (-10) | 12 (-4) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` counselor 390 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 600 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` counselor 390 | icon | 패널 접기 | 24 (-20) | 4px (+4) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` counselor 390 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 315 (+11) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 390 | secondary | 수정 | 31.5 (-24.5) | 9999px (+9983) | 12 (-4) | 6 (-10) | 13 (-3) | 500 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/profile/professional` counselor 390 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/profile/professional` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/profile/professional` counselor 390 | card | 개인정보수정선택 입력 항목입니다. 입력하지 않아도  | 315 (+11) | 16px (-4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/profile/professional` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/profile/professional` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 390 | primary | 측정 방법과 한계 알아보기 | 44 (-4) | 0px (-9999) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` counselor 390 | secondary | 목록으로 | 44 (-12) | 12px (-4) | 20 (+4) | 10 (-6) | 14 (-2) | 500 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports/sample-report` counselor 390 | ghost | mind breeze / 몸·마음 리포트 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 750 (+50) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` counselor 390 | card | MIND BREEZE · 몸·마음 리포트상담사용me | 254 (-50) | 16px (-4) | 16 (-8) | 16 (-8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/reports/sample-report` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reports` counselor 390 | primary | 전체 | 44 (-4) | 0px (-9999) | 14 (+14) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/reports` counselor 390 | secondary | 운영 설정 | 44 (-12) | 9999px (+9983) | 16 (+0) | 0 (-16) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/reports` counselor 390 | ghost | 검토중 | 44 (+0) | 0px (+0) | 14 (+14) | 0 (+0) | 14 (+0) | 600 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reports` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reports` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/reports` counselor 390 | input | 리포트 검색 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reports` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | ghost | 목록으로 돌아가기 | 44 (+0) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+1) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/sessions/new` counselor 390 | icon | 만들기 나가기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/sessions/new` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/new` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 390 | secondary | 목록으로 | 44 (-12) | 10px (-6) | 16 (+0) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차수업  | 2346.1875 (+2042.19) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 390 | input | 참여자 이름 검색 | 48 | 10px | 12 | 12 | 16 | 400 | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` counselor 390 | chip | 상담사 전용 · 발송 대상 아님 | 38 (+6) | 16px (-9983) | 12 (+0) | 6 (+2) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/live` counselor 390 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` counselor 390 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/live` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 883.03125 (+579.03) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/live` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` counselor 390 | chip | 클래스가 종료되었습니다 | 32 (+0) | 24px (-9975) | 10 (-2) | 6 (+2) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/player` counselor 390 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` counselor 390 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/player` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 883.03125 (+579.03) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/player` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` counselor 390 | chip | 클래스가 종료되었습니다 | 32 (+0) | 24px (-9975) | 10 (-2) | 6 (+2) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/record` counselor 390 | primary | 메모 저장 | 38 (-10) | 12px (-9987) | 16 (+16) | 8 (+8) | 15 (+1) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` counselor 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` counselor 390 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` counselor 390 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 282 (-22) | 16px (-4) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` counselor 390 | input | 합성 기록 | 234 | 12px | 12 | 12 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 390 | primary | 클래스 상세 | 48 (+0) | 12px (-9987) | 18 (+18) | 10 (+10) | 14 (+0) | 600 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/summary` counselor 390 | secondary | 클래스 목록 | 48 (-8) | 12px (-4) | 18 (+2) | 10 (-6) | 14 (-2) | 600 (+200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` counselor 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 883.03125 (+579.03) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` counselor 390 | chip | 클래스가 종료되었습니다 | 32 (+0) | 24px (-9975) | 10 (-2) | 6 (+2) | 13 (+0) | 400 (-200) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 390 | secondary | 클래스 멤버 관리 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 15 (-1) | 500 (+100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session` counselor 390 | ghost | 회차 요약으로 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+2) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` counselor 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-202) | 16px (-4) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/sessions/sample-session` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 390 | primary | 전체 | 44 (-4) | 12px (-9987) | 16 (+16) | 8 (+8) | 14 (+0) | 400 (-300) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/sessions` counselor 390 | secondary | 즉석 | 44 (-12) | 12px (-4) | 16 (+0) | 8 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions` counselor 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` counselor 390 | card | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 390 | input | 클래스 이름 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/sessions` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions` counselor 390 | chip | 진행 중 | 32 (+0) | 9999px (+0) | 10 (-2) | 6 (+2) | 13 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/settings` counselor 390 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 390 | secondary | 플레이그라운드 열기 ↗ | 48 (-8) | 12px (-4) | 16 (+0) | 12 (-4) | 15 (-1) | 700 (+300) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` counselor 390 | ghost | 상담사 프로필 관리 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+1) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` counselor 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/settings` counselor 390 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-66.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` counselor 390 | input | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 390 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` counselor 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 1440 | primary | + 새 채팅방 | 44 | 9999px | 16 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat/sample-room` org_admin 1440 | secondary | 채팅 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat/sample-room` org_admin 1440 | ghost | 샘플 상담사 메뉴 | 40 (+22) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat/sample-room` org_admin 1440 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 61 (-53) | 16px (+0) | 14 (-10) | 8 (-16) | 15 (-1) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` org_admin 1440 | input |  | 16 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 12 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 1440 | primary | + 새 채팅방 | 44 | 9999px | 16 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` org_admin 1440 | secondary | 채팅1 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat` org_admin 1440 | ghost | 샘플 상담사 메뉴 | 40 (+22) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 1440 | input |  | 16 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 12 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | ghost | 목록으로 돌아가기 | 44 (+26) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+0) | 700 (+200) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/classes/new` org_admin 1440 | icon | 만들기 나가기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/new` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/now` org_admin 1440 | primary | 온라인 | 52 | 16px | 0 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/classes/now` org_admin 1440 | secondary | 20분 | 44 (+0) | 999px (+987) | 16 (+4) | 8 (+8) | 16 (+2) | 400 (-200) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.06) |
| `/classes/now` org_admin 1440 | ghost | 더보기 · 정원 10명 · LINK BAND 선택  | 56 (+38) | 16px (+16) | 16 (+16) | 14 (+14) | 13 (-2) | 400 (-100) | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/now` org_admin 1440 | icon | 클래스 목록 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/now` org_admin 1440 | card | 지금 바로 열어요진행 지도사 · 필수지금 진행할 지 | 678.5 (+564.5) | 24px (+8) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/classes/now` org_admin 1440 | input | 진행 지도사 | 52 (+8) | 16px (+4) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/classes/now` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/now` org_admin 1440 | chip | 20분30분45분60분직접 입력직접 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` org_admin 1440 | secondary | 결과 새로고침 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 1440 | ghost | 개요 | 47 (+29) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-1) | 400 (-100) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/members` org_admin 1440 | card | 클래스 멤버초대 이후의 예정 정규 회차부터 함께해요 | 178 (+64) | 16px (+0) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 1440 | input |  | 62 (+18) | 12px (+0) | 12 (-4) | 8 (+8) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 1440 | secondary | 회차 목록 | 44 (+0) | 12px (+0) | 16 (+4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` org_admin 1440 | ghost | 개요 | 47 (+29) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-1) | 400 (-100) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/schedule` org_admin 1440 | card | 편성 회차 | 136 (+22) | 18px (+2) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(61, 52, 71) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` org_admin 1440 | input |  | 44 (+0) | 10px (-2) | 10 (-6) | 10 (+10) | 13 (-2) | 400 (+0) | rgb(61, 52, 71) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | ghost | 회차 요약으로 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-31.5) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 1440 | primary | 표로 보기 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes/sample-class/sessions` org_admin 1440 | secondary | 회차 목록 | 44 (+0) | 12px (+0) | 16 (+4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` org_admin 1440 | ghost | 개요 | 47 (+29) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-1) | 400 (-100) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/sessions` org_admin 1440 | card | 회차 목록 | 142 (+28) | 16px (+0) | 0 (-24) | 0 (-24) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 1440 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 1440 | ghost | 개요 | 47 (+29) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-1) | 400 (-100) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class/settings` org_admin 1440 | card | 클래스 코드0042코드 복사코드는 클래스가 끝날 때 | 157.796875 (+43.8) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 1440 | input |  | 62 (+18) | 12px (+0) | 12 (-4) | 8 (+8) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 1440 | secondary | 지난 기수로 새 클래스 만들기 | 44 (+0) | 12px (+0) | 16 (+4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class` org_admin 1440 | ghost | 개요 | 47 (+29) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-1) | 600 (+100) | rgb(110, 26, 140) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes/sample-class` org_admin 1440 | card | 클래스 개요클래스 상태진행 중클래스 진행1/4회차  | 426 (+312) | 20px (+4) | 24 (+0) | 24 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 1440 | chip | 예정 | 33.5 | 9999px | 12 | 6 | 13 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.4) |
| `/classes` org_admin 1440 | primary | 전체 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes` org_admin 1440 | secondary | 즉석 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 14 (+0) | 400 (-200) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes` org_admin 1440 | ghost | 기관 대시보드 | 46.5 (+28.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+0) | 500 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/classes` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/classes` org_admin 1440 | input | 클래스 이름 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/classes` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/classes` org_admin 1440 | chip | 진행 중 | 30 | 9999px | 10 | 6 | 12 | 600 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/invite` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` org_admin 1440 | primary | 저장 | 44 | 9999px | 16 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/sample-client` org_admin 1440 | secondary | 30일 | 40 (-4) | 10px (-2) | 12 (+0) | 0 (+0) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/sample-client` org_admin 1440 | ghost | 개인정보 열람 | 44 (+26) | 12px (+12) | 20 (+20) | 0 (+0) | 16 (+1) | 600 (+100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/clients/sample-client` org_admin 1440 | card | 회원 요약 | 286 (+172) | 20px (+4) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` org_admin 1440 | input | 합성 감사용 메모 | 150 (+106) | 6px (-6) | 12 (-4) | 8 (+8) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/clients` org_admin 1440 | primary | 회원 초대 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients` org_admin 1440 | secondary | 표 | 40 (-4) | 10px (-2) | 12 (+0) | 0 (+0) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients` org_admin 1440 | ghost | 카드 | 40 (+22) | 10px (+10) | 12 (+12) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/clients` org_admin 1440 | card | 검색과 필터 | 174 (+60) | 20px (+4) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` org_admin 1440 | input | 회원 검색 | 48 (+4) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/clients` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 1440 | primary | 명상 | 52 | 16px | 8 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/counseling/new` org_admin 1440 | secondary | 임상심리상담 | 52 (+8) | 16px (+4) | 8 (-4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` org_admin 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 1440 | icon | 정원 줄이기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` org_admin 1440 | card | 어떤 클래스를 만들까요?유형임상심리상담최면심리상담명 | 489.1875 (+375.19) | 24px (+8) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/counseling/new` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | ghost | 회차 요약으로 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-31.5) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 1440 | secondary | 상담 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` org_admin 1440 | ghost | 내담자 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling/sample-relationship` org_admin 1440 | card | 상담 일정진행 중상담사 샘플 상담사샘플 회원내담자 | 162 (+48) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 1440 | secondary | 내담자 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 400 (-200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling` org_admin 1440 | ghost | 기관 대시보드 | 46.5 (+28.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+0) | 500 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/counseling` org_admin 1440 | card | 상담 일정진행 중샘플 회원다음 상담 데이터 없음 | 110 (-4) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 1440 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/credentials` org_admin 1440 | ghost | 샘플 명상 회차 | 18 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 500 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/credentials` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/credentials` org_admin 1440 | card | 기관 코드상담사는 기관 담당자의 초대로 가입합니다. | 114 (+0) | 16px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/credentials` org_admin 1440 | input | 홍길동 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 1440 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/dashboard/org` org_admin 1440 | ghost | 샘플 명상 회차 | 18 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 500 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/dashboard/org` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/dashboard/org` org_admin 1440 | card | 기관 코드상담사는 기관 담당자의 초대로 가입합니다. | 114 (+0) | 16px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/dashboard/org` org_admin 1440 | input | 홍길동 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/dashboard/org` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | primary | 소속 초대 수락하기 | 48 | 9999px | 24 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | ghost | 랜딩 페이지로 이동 | 27 (+9) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | ghost | 랜딩 페이지로 이동 | 27 (+9) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 1440 | secondary | 알림 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/notifications` org_admin 1440 | ghost | 설정 | 19.5 (+1.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-2) | 500 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/notifications` org_admin 1440 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (+98) | 16px (+0) | 48 (+24) | 48 (+24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 1440 | secondary | 정보 수정 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/counselors` org_admin 1440 | ghost | 비활성화 | 44 (+26) | 8px (+8) | 10 (+10) | 6 (+6) | 12 (-3) | 600 (+100) | rgb(179, 38, 30) / rgba(0, 0, 0, 0) |
| `/org/counselors` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/org/counselors` org_admin 1440 | card | 이름이메일코드역할상태관리샘플 상담사counselor | 117 (+3) | 20px (+4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/counselors` org_admin 1440 | input | 상담사 검색 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/counselors` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/data-center` org_admin 1440 | primary | 클래스 탐색 | 44 | 12px | 16 | 8 | 15 | 600 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/org/data-center` org_admin 1440 | secondary | 회원 단위 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 1440 | ghost | 개요 | 48.5 (+30.5) | 0px (+0) | 16 (+16) | 12 (+12) | 15 (+0) | 500 (+0) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/org/data-center` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/org/data-center` org_admin 1440 | card | 클래스4 개 | 106 (-8) | 20px (+4) | 16 (-8) | 18 (-6) | 14 (-2) | 400 (+0) | rgb(47, 41, 58) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 1440 | input | 데이터 검색 | 44 (+0) | 12px (+0) | 12 (-4) | 8 (+8) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/data-center` org_admin 1440 | chip | 권한 범위 내 조회 | 33 | 9999px | 10 | 6 | 14 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/org/requests` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | card | 신청 내역이 없습니다. | 72 (-42) | 20px (+4) | 24 (+0) | 24 (+0) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 1440 | secondary | 정보 수정 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/sample-org` org_admin 1440 | ghost | 소속 해제 | 44 (+26) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-1) | 600 (+100) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/org/sample-org` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 1440 | card | 가입 요청 관리준비 중가입 요청 관리 기능은 준비  | 108 (-6) | 20px (+4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` org_admin 1440 | input | 상담사 검색 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | primary | + 기관 가입 상담 신청 | 22 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/org/search` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | input | 센터명 검색 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/search` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 1440 | primary | 밴드 연결 | 28 | 8px | 12 | 6 | 12 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` org_admin 1440 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (+0) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` org_admin 1440 | ghost | ← 설정으로 돌아가기 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 600 (+100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` org_admin 1440 | icon | 패널 접기 | 24 (-20) | 4px (-9995) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` org_admin 1440 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 227 (+113) | 16px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 1440 | secondary | 수정 | 31.5 (-12.5) | 9999px (+9987) | 12 (+0) | 6 (+6) | 13 (-1) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/profile/professional` org_admin 1440 | ghost | ← 설정으로 돌아가기 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/profile/professional` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/profile/professional` org_admin 1440 | card | 개인정보수정선택 입력 항목입니다. 입력하지 않아도  | 236.5 (+122.5) | 16px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/profile/professional` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 1440 | primary | 측정 방법과 한계 알아보기 | 18 | 0px | 0 | 0 | 15 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` org_admin 1440 | secondary | 목록으로 | 44.5 (+0.5) | 12px (+0) | 20 (+8) | 10 (+10) | 15 (+1) | 500 (-100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports/sample-report` org_admin 1440 | ghost | mind breeze / 몸·마음 리포트 | 28.796875 (+10.8) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 750 (+250) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/reports/sample-report` org_admin 1440 | card | MIND BREEZE · 몸·마음 리포트상담사용me | 282.5 (+168.5) | 16px (+0) | 32 (+8) | 32 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/reports/sample-report` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reports` org_admin 1440 | primary | 전체 | 40 | 0px | 14 | 0 | 13 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/reports` org_admin 1440 | secondary | 리포트 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports` org_admin 1440 | ghost | 검토중 | 40 (+22) | 0px (+0) | 14 (+14) | 0 (+0) | 13 (-2) | 600 (+100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reports` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/reports` org_admin 1440 | card | 샘플 명상 기록1건제목사용자성별생년월일구분타입세션유 | 140 (+26) | 16px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` org_admin 1440 | input | 리포트 검색 | 40 (-4) | 12px (+0) | 16 (+0) | 0 (+0) | 13 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reports` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | ghost | 목록으로 돌아가기 | 44 (+26) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (+0) | 700 (+200) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/sessions/new` org_admin 1440 | icon | 만들기 나가기 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/sessions/new` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 1440 | secondary | 목록으로 | 44 (+0) | 10px (-2) | 16 (+4) | 10 (+10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 1440 | ghost | 01오늘 수업 한 줄 | 50 (+32) | 0px (+0) | 0 (+0) | 12 (+12) | 16 (+1) | 400 (-100) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/class-report` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차수업  | 2274.9375 (+2160.94) | 24px (+8) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 1440 | input | 참여자 이름 검색 | 48 (+4) | 10px (-2) | 12 (-4) | 12 (+12) | 16 (+1) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 1440 | chip | 상담사 전용 · 발송 대상 아님 | 33.125 | 16px | 12 | 6 | 13 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/live` org_admin 1440 | primary | 기록 보기 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` org_admin 1440 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+2) | 0 (+0) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/live` org_admin 1440 | ghost | 기록 보기 | 44 (+26) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-3) | 600 (+100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/live` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 1440 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 468 (+354) | 16px (+0) | 24 (+0) | 64 (+40) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/live` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 1440 | primary | 기록 보기 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` org_admin 1440 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+2) | 0 (+0) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/player` org_admin 1440 | ghost | 기록 보기 | 44 (+26) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-3) | 600 (+100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/player` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 1440 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 468 (+354) | 16px (+0) | 24 (+0) | 64 (+40) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/player` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 1440 | primary | 메모 저장 | 38 | 12px | 16 | 8 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` org_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 1440 | ghost | 회차 요약으로 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions/sample-session/record` org_admin 1440 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 200 (+86) | 16px (+0) | 20 (-4) | 20 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` org_admin 1440 | input | 합성 기록 | 221 (+177) | 12px (+0) | 12 (-4) | 12 (+12) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 1440 | primary | 클래스 상세 | 48 | 12px | 18 | 10 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/summary` org_admin 1440 | secondary | 클래스 목록 | 48 (+4) | 12px (+0) | 18 (+6) | 10 (+10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` org_admin 1440 | ghost | 01오늘 수업 한 줄 | 48 (+30) | 0px (+0) | 0 (+0) | 12 (+12) | 14 (-1) | 400 (-100) | rgb(99, 88, 107) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/summary` org_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 1440 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 950.625 (+836.62) | 24px (+8) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 1440 | chip | 클래스가 종료되었습니다 | 33.4375 | 24px | 10 | 6 | 13 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 1440 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session` org_admin 1440 | ghost | 회차 요약으로 | 44 (+26) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions/sample-session` org_admin 1440 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 82.5 (-31.5) | 16px (+0) | 16 (-8) | 16 (-8) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/sessions/sample-session` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 1440 | primary | 전체 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/sessions` org_admin 1440 | secondary | 즉석 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 14 (+0) | 400 (-200) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions` org_admin 1440 | ghost | 기관 대시보드 | 46.5 (+28.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+0) | 500 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/sessions` org_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 1440 | input | 클래스 이름 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/sessions` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 1440 | chip | 진행 중 | 30 | 9999px | 10 | 6 | 12 | 600 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/settings` org_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 1440 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+4) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` org_admin 1440 | ghost | 상담사 프로필 관리 ↗ | 48 (+30) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` org_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/settings` org_admin 1440 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (+123.5) | 20px (+4) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` org_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 390 | ghost | 샘플 상담사 메뉴 | 44 (+20) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+4) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` org_admin 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` org_admin 390 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 146 (-64) | 16px (+0) | 12 (-8) | 8 (-12) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` org_admin 390 | input | 메시지를 입력하세요 | 48 (+0) | 12px (+0) | 16 (+0) | 10 (+10) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/chat/sample-room` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 390 | primary | + 새 채팅방 | 48 | 9999px | 16 | 0 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` org_admin 390 | secondary | 대화 1건 | 52 (+8) | 999px (+987) | 0 (-12) | 0 (+0) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/chat` org_admin 390 | ghost | 샘플 상담사 메뉴 | 44 (+20) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+4) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/chat` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 390 | input |  | 20 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 13 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | ghost | 목록으로 돌아가기 | 44 (+20) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (-1) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/classes/new` org_admin 390 | icon | 만들기 나가기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/new` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/new` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/now` org_admin 390 | primary | 온라인 | 52 | 16px | 8 | 10 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/classes/now` org_admin 390 | secondary | 20분 | 44 (+0) | 999px (+987) | 6 (-6) | 8 (+8) | 16 (+2) | 400 (-200) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.06) |
| `/classes/now` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/classes/now` org_admin 390 | icon | 클래스 목록 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/classes/now` org_admin 390 | card | 지금 바로 열어요진행 지도사 · 필수지금 진행할 지 | 680.890625 (+470.89) | 24px (+8) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/classes/now` org_admin 390 | input | 진행 지도사 | 52 (+4) | 16px (+4) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/classes/now` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/now` org_admin 390 | chip | 20분30분45분60분직접 입력직접 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` org_admin 390 | secondary | 결과 새로고침 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 390 | ghost | 개요 | 47 (+23) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-2) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/members` org_admin 390 | card | 클래스 멤버초대 이후의 예정 정규 회차부터 함께해요 | 178 (-32) | 16px (+0) | 24 (+4) | 24 (+4) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 390 | input |  | 62 (+14) | 12px (+0) | 12 (-4) | 8 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/members` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/members` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 390 | secondary | 회차 목록 | 48 (+4) | 12px (+0) | 16 (+4) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` org_admin 390 | ghost | 개요 | 47 (+23) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-2) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` org_admin 390 | card | 편성 회차 | 198 (-12) | 18px (+2) | 0 (-20) | 0 (-20) | 14 (-2) | 400 (+0) | rgb(61, 52, 71) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/schedule` org_admin 390 | input |  | 48 (+0) | 10px (-2) | 10 (-6) | 10 (+10) | 16 (+0) | 400 (+0) | rgb(61, 52, 71) / rgb(255, 255, 255) |
| `/classes/sample-class/schedule` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/schedule` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | ghost | 회차 요약으로 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-108) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions/sample-session` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 390 | primary | 표로 보기 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes/sample-class/sessions` org_admin 390 | secondary | 회차 목록 | 48 (+4) | 12px (+0) | 16 (+4) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` org_admin 390 | ghost | 개요 | 47 (+23) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-2) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/sessions` org_admin 390 | card | 회차 목록 | 185 (-25) | 16px (+0) | 0 (-20) | 0 (-20) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/sessions` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/sessions` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 390 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 390 | ghost | 개요 | 47 (+23) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-2) | 400 (-300) | rgb(162, 163, 173) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class/settings` org_admin 390 | card | 클래스 코드0042코드 복사코드는 클래스가 끝날 때 | 178.59375 (-31.41) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 390 | input |  | 62 (+14) | 12px (+0) | 12 (-4) | 8 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class/settings` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class/settings` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 390 | secondary | 지난 기수로 새 클래스 만들기 | 48 (+4) | 12px (+0) | 16 (+4) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/classes/sample-class` org_admin 390 | ghost | 개요 | 47 (+23) | 0px (+0) | 16 (+16) | 12 (+12) | 14 (-2) | 600 (-100) | rgb(110, 26, 140) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes/sample-class` org_admin 390 | card | 클래스 개요클래스 상태진행 중클래스 진행1/4회차  | 238 (+28) | 20px (+4) | 24 (+4) | 24 (+4) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes/sample-class` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes/sample-class` org_admin 390 | chip | 예정 | 33.5 | 9999px | 12 | 6 | 13 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.4) |
| `/classes` org_admin 390 | primary | 전체 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/classes` org_admin 390 | secondary | 즉석 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 14 (+0) | 400 (-200) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/classes` org_admin 390 | ghost | 홈으로 이동 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/classes` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/classes` org_admin 390 | input | 클래스 이름 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/classes` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/classes` org_admin 390 | chip | 진행 중 | 32 | 9999px | 10 | 6 | 13 | 600 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/invite` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/invite` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` org_admin 390 | primary | 저장 | 48 | 9999px | 16 | 0 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients/sample-client` org_admin 390 | secondary | 30일 | 40 (-4) | 10px (-2) | 12 (+0) | 0 (+0) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients/sample-client` org_admin 390 | ghost | 개인정보 열람 | 44 (+20) | 12px (+12) | 20 (+20) | 0 (+0) | 16 (+0) | 600 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients/sample-client` org_admin 390 | card | 회원 요약 | 406 (+196) | 20px (+4) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` org_admin 390 | input | 합성 감사용 메모 | 150 (+102) | 6px (-6) | 12 (-4) | 8 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients/sample-client` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients/sample-client` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/clients` org_admin 390 | primary | 회원 초대 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/clients` org_admin 390 | secondary | 표 | 40 (-4) | 10px (-2) | 12 (+0) | 0 (+0) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/clients` org_admin 390 | ghost | 카드 | 40 (+16) | 10px (+10) | 12 (+12) | 0 (+0) | 15 (-1) | 400 (-300) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/clients` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/clients` org_admin 390 | card | 검색과 필터 | 346 (+136) | 20px (+4) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` org_admin 390 | input | 회원 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/clients` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/clients` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 390 | primary | 명상 | 52 | 16px | 8 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/counseling/new` org_admin 390 | secondary | 임상심리상담 | 52 (+8) | 16px (+4) | 8 (-4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 390 | icon | 정원 줄이기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.1) |
| `/counseling/new` org_admin 390 | card | 어떤 클래스를 만들까요?유형임상심리상담최면심리상담명 | 533.1875 (+323.19) | 24px (+8) | 16 (-4) | 16 (-4) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/counseling/new` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/new` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | ghost | 회차 요약으로 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-108) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship/sessions/sample-session` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 390 | secondary | 상담 | 52 (+8) | 999px (+987) | 0 (-12) | 0 (+0) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/counseling/sample-relationship` org_admin 390 | ghost | 내담자 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (-1) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling/sample-relationship` org_admin 390 | card | 상담 일정진행 중상담사 샘플 상담사샘플 회원내담자 | 162 (-48) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling/sample-relationship` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling/sample-relationship` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 390 | secondary | 내담자 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 400 (-200) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/counseling` org_admin 390 | ghost | 홈으로 이동 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/counseling` org_admin 390 | card | 상담 일정진행 중샘플 회원다음 상담 데이터 없음 | 110 (-100) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/counseling` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/counseling` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 390 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/credentials` org_admin 390 | ghost | 샘플 명상 회차 | 24 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 700 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/credentials` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/credentials` org_admin 390 | card | 기관 코드상담사는 기관 담당자의 초대로 가입합니다. | 210 (+0) | 16px (+0) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/credentials` org_admin 390 | input | 홍길동 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/credentials` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/credentials` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 390 | secondary | 코드 복사 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/dashboard/org` org_admin 390 | ghost | 샘플 명상 회차 | 24 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 700 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/dashboard/org` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/dashboard/org` org_admin 390 | card | 기관 코드상담사는 기관 담당자의 초대로 가입합니다. | 210 (+0) | 16px (+0) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/dashboard/org` org_admin 390 | input | 홍길동 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/dashboard/org` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/dashboard/org` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | primary | 소속 초대 수락하기 | 48 | 9999px | 24 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | ghost | 랜딩 페이지로 이동 | 27 (+3) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite?token=synthetic-invite-token` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | ghost | 랜딩 페이지로 이동 | 27 (+3) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/membership-invite` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/membership-invite` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 390 | ghost | 설정 | 19.5 (-4.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-3) | 500 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` org_admin 390 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (+2) | 16px (+0) | 48 (+28) | 48 (+28) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 390 | secondary | 정보 수정 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/counselors` org_admin 390 | ghost | 비활성화 | 32 (+8) | 8px (+8) | 10 (+10) | 6 (+6) | 12 (-4) | 600 (-100) | rgb(179, 38, 30) / rgba(0, 0, 0, 0) |
| `/org/counselors` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/org/counselors` org_admin 390 | card | 이름이메일코드역할상태관리샘플 상담사counselor | 155 (-55) | 20px (+4) | 0 (-20) | 0 (-20) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/counselors` org_admin 390 | input | 상담사 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/counselors` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/counselors` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/data-center` org_admin 390 | primary | 클래스 탐색 | 44 | 12px | 16 | 8 | 15 | 600 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/org/data-center` org_admin 390 | secondary | 회원 단위 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 390 | ghost | 개요 | 48.5 (+24.5) | 0px (+0) | 16 (+16) | 12 (+12) | 15 (-1) | 500 (-200) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/org/data-center` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/org/data-center` org_admin 390 | card | 클래스4 개 | 139 (-71) | 20px (+4) | 16 (-4) | 18 (-2) | 14 (-2) | 400 (+0) | rgb(47, 41, 58) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 390 | input | 데이터 검색 | 48 (+0) | 12px (+0) | 12 (-4) | 8 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/data-center` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/data-center` org_admin 390 | chip | 권한 범위 내 조회 | 33 | 9999px | 10 | 6 | 14 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/org/requests` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | card | 신청 내역이 없습니다. | 72 (-138) | 20px (+4) | 24 (+4) | 24 (+4) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 390 | secondary | 정보 수정 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/org/sample-org` org_admin 390 | ghost | 소속 해제 | 44 (+20) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-2) | 600 (-100) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/org/sample-org` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 390 | card | 가입 요청 관리준비 중가입 요청 관리 기능은 준비  | 108 (-102) | 20px (+4) | 24 (+4) | 24 (+4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` org_admin 390 | input | 상담사 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/sample-org` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/sample-org` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 390 | primary | + 기관 가입 상담 신청 | 22 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/org/search` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 390 | card | 상담사 계정으로만 가입 신청이 가능합니다 (현재 역 | 78 (-132) | 20px (+4) | 16 (-4) | 16 (-4) | 15 (-1) | 400 (+0) | rgb(64, 64, 64) / rgb(255, 255, 255) |
| `/org/search` org_admin 390 | input | 센터명 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/search` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/search` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 390 | primary | 밴드 연결 | 28 | 8px | 12 | 6 | 12 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` org_admin 390 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (+0) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` org_admin 390 | ghost | ← 설정으로 돌아가기 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 600 (-100) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` org_admin 390 | icon | 패널 접기 | 24 (-20) | 4px (+4) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` org_admin 390 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 315 (+105) | 16px (+0) | 0 (-20) | 0 (-20) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 390 | secondary | 수정 | 31.5 (-12.5) | 9999px (+9987) | 12 (+0) | 6 (+6) | 13 (-1) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/profile/professional` org_admin 390 | ghost | ← 설정으로 돌아가기 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/profile/professional` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/profile/professional` org_admin 390 | card | 개인정보수정선택 입력 항목입니다. 입력하지 않아도  | 315 (+105) | 16px (+0) | 24 (+4) | 24 (+4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/profile/professional` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/profile/professional` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 390 | primary | 측정 방법과 한계 알아보기 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` org_admin 390 | secondary | 목록으로 | 44 (+0) | 12px (+0) | 20 (+8) | 10 (+10) | 14 (+0) | 500 (-100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports/sample-report` org_admin 390 | ghost | mind breeze / 몸·마음 리포트 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 750 (+50) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reports/sample-report` org_admin 390 | card | MIND BREEZE · 몸·마음 리포트상담사용me | 254 (+44) | 16px (+0) | 16 (-4) | 16 (-4) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/reports/sample-report` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample-report` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reports` org_admin 390 | primary | 전체 | 44 | 0px | 14 | 0 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/reports` org_admin 390 | secondary | 운영 설정 | 44 (+0) | 9999px (+9987) | 16 (+4) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/reports` org_admin 390 | ghost | 검토중 | 44 (+20) | 0px (+0) | 14 (+14) | 0 (+0) | 14 (-2) | 600 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reports` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reports` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/reports` org_admin 390 | input | 리포트 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reports` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reports` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | ghost | 목록으로 돌아가기 | 44 (+20) | 9999px (+9999) | 24 (+24) | 0 (+0) | 15 (-1) | 700 (+0) | rgb(207, 198, 214) / rgba(0, 0, 0, 0) |
| `/sessions/new` org_admin 390 | icon | 만들기 나가기 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/sessions/new` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/new` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 390 | secondary | 목록으로 | 44 (+0) | 10px (-2) | 16 (+4) | 10 (+10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차수업  | 2346.1875 (+2136.19) | 16px (+0) | 0 (-20) | 0 (-20) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 390 | input | 참여자 이름 검색 | 48 (+0) | 10px (-2) | 12 (-4) | 12 (+12) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/class-report` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/class-report` org_admin 390 | chip | 상담사 전용 · 발송 대상 아님 | 38 | 16px | 12 | 6 | 13 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session/live` org_admin 390 | primary | 기록 보기 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/live` org_admin 390 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+2) | 0 (+0) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/live` org_admin 390 | ghost | 기록 보기 | 44 (+20) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-4) | 600 (-100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/live` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 390 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 518 (+308) | 16px (+0) | 24 (+4) | 64 (+44) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/live` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/live` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 390 | primary | 기록 보기 | 44 | 12px | 20 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/player` org_admin 390 | secondary | 나가기 | 40 (-4) | 12px (+0) | 14 (+2) | 0 (+0) | 13 (-1) | 600 (+0) | rgba(255, 255, 255, 0.78) / rgba(255, 255, 255, 0.04) |
| `/sessions/sample-session/player` org_admin 390 | ghost | 기록 보기 | 44 (+20) | 12px (+12) | 20 (+20) | 6 (+6) | 12 (-4) | 600 (-100) | rgba(255, 255, 255, 0.9) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/player` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 390 | card | 클래스가 종료되었습니다녹음·녹화가 저장되었고 리포트 | 518 (+308) | 16px (+0) | 24 (+4) | 64 (+44) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(255, 255, 255, 0.05) |
| `/sessions/sample-session/player` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/player` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 390 | primary | 메모 저장 | 38 | 12px | 16 | 8 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/record` org_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 390 | ghost | 회차 요약으로 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session/record` org_admin 390 | card | 샘플 명상 회차명상수업완료클래스 코드-참여자0명일시 | 282 (+72) | 16px (+0) | 20 (+0) | 20 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` org_admin 390 | input | 합성 기록 | 234 (+186) | 12px (+0) | 12 (-4) | 12 (+12) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session/record` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/record` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 390 | primary | 클래스 상세 | 48 | 12px | 18 | 10 | 14 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/sessions/sample-session/summary` org_admin 390 | secondary | 클래스 목록 | 48 (+4) | 12px (+0) | 18 (+6) | 10 (+10) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` org_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 390 | card | 01 / 오늘 수업 한 줄샘플 명상 · 2회차이번  | 883.03125 (+673.03) | 16px (+0) | 0 (-20) | 0 (-20) | 16 (+0) | 400 (+0) | rgb(48, 43, 53) / rgb(255, 255, 255) |
| `/sessions/sample-session/summary` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session/summary` org_admin 390 | chip | 클래스가 종료되었습니다 | 32 | 24px | 10 | 6 | 13 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/sessions/sample-session` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 390 | secondary | 클래스 멤버 관리 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions/sample-session` org_admin 390 | ghost | 회차 요약으로 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (-300) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions/sample-session` org_admin 390 | card | 샘플 상담사 지도사가 진행해요회차 열기와 시작은 배 | 102 (-108) | 16px (+0) | 16 (-4) | 16 (-4) | 14 (-2) | 400 (+0) | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/sessions/sample-session` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions/sample-session` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 390 | primary | 전체 | 44 | 12px | 16 | 8 | 14 | 400 | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/sessions` org_admin 390 | secondary | 즉석 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 14 (+0) | 400 (-200) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/sessions` org_admin 390 | ghost | 홈으로 이동 | 44 (+20) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (-300) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 14 (-2) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/sessions` org_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 390 | input | 클래스 이름 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/sessions` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/sessions` org_admin 390 | chip | 진행 중 | 32 | 9999px | 10 | 6 | 13 | 600 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/settings` org_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 390 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+4) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` org_admin 390 | ghost | 상담사 프로필 관리 ↗ | 48 (+24) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (-1) | 400 (-300) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` org_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/settings` org_admin 390 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (+27.5) | 20px (+4) | 24 (+4) | 24 (+4) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` org_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` org_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 1440 | secondary | 가입 신청 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/admin/applications` platform_admin 1440 | ghost | 기관 가입 상담샘플 기관샘플 담당자applicati | 58.5 (+14.5) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/applications` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/applications` platform_admin 1440 | card | 유형기관/활동명신청자이메일상태알림접수일기관 가입 상 | 103 (-435.5) | 20px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/applications` platform_admin 1440 | input | 신청 유형 필터 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/applications` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/clients` platform_admin 1440 | primary | + 회원 추가 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/clients` platform_admin 1440 | secondary | 회원 관리 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/admin/clients` platform_admin 1440 | ghost | 정지 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-1) | 600 (+0) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/admin/clients` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/clients` platform_admin 1440 | card | 이름이메일담당 상담사상태가입일관리샘플 회원clien | 121 (-417.5) | 20px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/clients` platform_admin 1440 | input | 회원 검색 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/clients` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/clients` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/data-center` platform_admin 1440 | primary | 클래스 탐색 | 44 (+0) | 12px (-9987) | 16 (+0) | 8 (+8) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/admin/data-center` platform_admin 1440 | secondary | 회원 단위 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 1440 | ghost | 개요 | 48.5 (+4.5) | 0px (+0) | 16 (+16) | 12 (+12) | 15 (+0) | 500 (-100) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/admin/data-center` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/data-center` platform_admin 1440 | card | 클래스4 개 | 106 (-432.5) | 20px (+0) | 16 (-8) | 18 (-6) | 14 (-2) | 400 (+0) | rgb(47, 41, 58) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 1440 | input | 데이터 검색 | 44 (+0) | 12px (+0) | 12 (-4) | 8 (+8) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/data-center` platform_admin 1440 | chip | 권한 범위 내 조회 | 33 | 9999px | 10 | 6 | 14 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/admin/orgs` platform_admin 1440 | primary | 기관 등록 및 초대 발송 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/orgs` platform_admin 1440 | secondary | 검색 초기화 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/admin/orgs` platform_admin 1440 | ghost | 샘플 기관 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/admin/orgs` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/orgs` platform_admin 1440 | card | 새 기관 등록기관과 주 담당자를 등록하면 상담사용  | 538.5 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/orgs` platform_admin 1440 | input | 기관명을 입력하세요 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/orgs` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/orgs` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | primary | 승인 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | secondary | 반려 | 44 (+0) | 12px (+0) | 16 (+4) | 0 (+0) | 15 (+1) | 600 (+0) | rgb(179, 38, 75) / rgb(253, 236, 239) |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | ghost | 채팅1 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+0) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | card | 면허증대기중샘플 상담사counselor@exampl | 168.5 (-370) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 1440 | ghost | 채팅1 | 46.5 (+2.5) | 12px (+12) | 14 (+14) | 12 (+12) | 15 (+0) | 500 (-100) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/reviews` platform_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 1440 | input | 전체 유형신분증면허증졸업증명경력증명사업자등록증법인등 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/reviews` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 1440 | secondary | 상담사 관리 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/admin/users` platform_admin 1440 | ghost | 정지 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-1) | 600 (+0) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/admin/users` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin/users` platform_admin 1440 | card | 이름이메일역할상태가입일관리샘플 회원client@ex | 121 (-417.5) | 20px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/users` platform_admin 1440 | input | 상담사 검색 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/users` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin` platform_admin 1440 | primary | 기관 등록 및 초대 발송 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin` platform_admin 1440 | secondary | 검색 초기화 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/admin` platform_admin 1440 | ghost | 샘플 기관 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/admin` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/admin` platform_admin 1440 | card | 새 기관 등록기관과 주 담당자를 등록하면 상담사용  | 538.5 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin` platform_admin 1440 | input | 기관명을 입력하세요 | 44 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/admin` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 1440 | primary | + 새 채팅방 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat/sample-room` platform_admin 1440 | secondary | 채팅 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat/sample-room` platform_admin 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat/sample-room` platform_admin 1440 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 61 (-477.5) | 16px (-4) | 14 (-10) | 8 (-16) | 15 (-1) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` platform_admin 1440 | input |  | 16 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 12 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 1440 | primary | + 새 채팅방 | 44 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` platform_admin 1440 | secondary | 채팅1 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/chat` platform_admin 1440 | ghost | 샘플 상담사 메뉴 | 40 (-4) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/chat` platform_admin 1440 | card | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 1440 | input |  | 16 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 12 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 1440 | secondary | 알림 | 46.5 (+2.5) | 12px (+0) | 14 (+2) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/notifications` platform_admin 1440 | ghost | 설정 | 19.5 (-24.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-2) | 500 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/notifications` platform_admin 1440 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-326.5) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` platform_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | card | 신청 내역이 없습니다. | 72 (-466.5) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` platform_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 1440 | primary | 밴드 연결 | 28 (-16) | 8px (-9991) | 12 (-4) | 6 (+6) | 12 (-3) | 500 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` platform_admin 1440 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (+0) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` platform_admin 1440 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 600 (+0) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` platform_admin 1440 | icon | 패널 접기 | 24 (-20) | 4px (-9995) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` platform_admin 1440 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 227 (-311.5) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` platform_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 1440 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+4) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` platform_admin 1440 | ghost | 밴드 연결 · 측정 방법 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 12 (+12) | 15 (+0) | 400 (-200) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` platform_admin 1440 | icon | 알림 | 44 (+0) | 9999px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/settings` platform_admin 1440 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-301) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` platform_admin 1440 | input | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 390 | secondary | 가입 신청 | 52 (+8) | 999px (+987) | 0 (-12) | 0 (+0) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/admin/applications` platform_admin 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/applications` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/applications` platform_admin 390 | card | 유형기관/활동명신청자이메일상태알림접수일기관 가입 상 | 140 (-693) | 20px (+0) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/applications` platform_admin 390 | input | 신청 유형 필터 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/applications` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/applications` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/clients` platform_admin 390 | primary | + 회원 추가 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/clients` platform_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/admin/clients` platform_admin 390 | ghost | 정지 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-1) | 600 (+0) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/admin/clients` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/clients` platform_admin 390 | card | 샘플 회원활성client@example.invali | 197.5 (-635.5) | 20px (+0) | 16 (-8) | 16 (-8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/clients` platform_admin 390 | input | 회원 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/clients` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/clients` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/data-center` platform_admin 390 | primary | 클래스 탐색 | 44 (-4) | 12px (-9987) | 16 (+0) | 8 (+8) | 15 (+1) | 600 (+0) | rgb(255, 255, 255) / rgb(110, 26, 140) |
| `/admin/data-center` platform_admin 390 | secondary | 회원 단위 | 44 (+0) | 12px (+0) | 16 (+4) | 8 (+8) | 15 (+1) | 500 (-100) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 390 | ghost | 개요 | 48.5 (+4.5) | 0px (+0) | 16 (+16) | 12 (+12) | 15 (+0) | 500 (-100) | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/admin/data-center` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/data-center` platform_admin 390 | card | 클래스4 개 | 139 (-694) | 20px (+0) | 16 (-8) | 18 (-6) | 14 (-2) | 400 (+0) | rgb(47, 41, 58) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 390 | input | 데이터 검색 | 48 (+0) | 12px (+0) | 12 (-4) | 8 (+8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/data-center` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/data-center` platform_admin 390 | chip | 권한 범위 내 조회 | 33 | 9999px | 10 | 6 | 14 | 400 | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/admin/orgs` platform_admin 390 | primary | 기관 등록 및 초대 발송 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/orgs` platform_admin 390 | secondary | 검색 초기화 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/admin/orgs` platform_admin 390 | ghost | 샘플 기관 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/admin/orgs` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/orgs` platform_admin 390 | card | 새 기관 등록기관과 주 담당자를 등록하면 상담사용  | 833 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/orgs` platform_admin 390 | input | 기관명을 입력하세요 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/orgs` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/orgs` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 390 | primary | 승인 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin/reviews/credential/sample-review` platform_admin 390 | secondary | 반려 | 48 (+4) | 12px (+0) | 16 (+4) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(179, 38, 75) / rgb(253, 236, 239) |
| `/admin/reviews/credential/sample-review` platform_admin 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews/credential/sample-review` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews/credential/sample-review` platform_admin 390 | card | 면허증대기중샘플 상담사counselor@exampl | 168.5 (-664.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/reviews/credential/sample-review` platform_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/reviews/credential/sample-review` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 390 | ghost | 홈으로 이동 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 400 (-200) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/reviews` platform_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 390 | input | 전체 유형신분증면허증졸업증명경력증명사업자등록증법인등 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/reviews` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/reviews` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 390 | secondary | 사용자 | 52 (+8) | 999px (+987) | 0 (-12) | 0 (+0) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/admin/users` platform_admin 390 | ghost | 정지 | 44 (+0) | 12px (+12) | 12 (+12) | 0 (+0) | 14 (-1) | 600 (+0) | rgb(179, 38, 75) / rgba(0, 0, 0, 0) |
| `/admin/users` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin/users` platform_admin 390 | card | 샘플 회원활성client@example.invali | 165.5 (-667.5) | 20px (+0) | 16 (-8) | 16 (-8) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/users` platform_admin 390 | input | 상담사 검색 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin/users` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin/users` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/admin` platform_admin 390 | primary | 기관 등록 및 초대 발송 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/admin` platform_admin 390 | secondary | 검색 초기화 | 44 (+0) | 12px (+0) | 12 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/admin` platform_admin 390 | ghost | 샘플 기관 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 15 (+0) | 600 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/admin` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/admin` platform_admin 390 | card | 새 기관 등록기관과 주 담당자를 등록하면 상담사용  | 833 (+0) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin` platform_admin 390 | input | 기관명을 입력하세요 | 48 (+0) | 12px (+0) | 16 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/admin` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/admin` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` platform_admin 390 | icon | 대화 목록으로 | 44 (+0) | 9999px (+9999) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/chat/sample-room` platform_admin 390 | card | 오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나 | 146 (-687) | 16px (-4) | 12 (-12) | 8 (-16) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/chat/sample-room` platform_admin 390 | input | 메시지를 입력하세요 | 48 (+0) | 12px (+0) | 16 (+0) | 10 (+10) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/chat/sample-room` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat/sample-room` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 390 | primary | + 새 채팅방 | 48 (+0) | 9999px (+0) | 16 (+0) | 0 (+0) | 14 (+0) | 600 (+0) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/chat` platform_admin 390 | secondary | 대화 1건 | 52 (+8) | 999px (+987) | 0 (-12) | 0 (+0) | 13 (-1) | 800 (+200) | rgb(255, 255, 255) / rgb(86, 51, 101) |
| `/chat` platform_admin 390 | ghost | 샘플 상담사 메뉴 | 44 (+0) | 8px (+8) | 0 (+0) | 0 (+0) | 20 (+5) | 400 (-200) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/chat` platform_admin 390 | card | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 390 | input |  | 20 (-28) | 0px (-12) | 0 (-16) | 0 (+0) | 13 (-3) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/chat` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/chat` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 390 | ghost | 설정 | 19.5 (-24.5) | 0px (+0) | 0 (+0) | 0 (+0) | 13 (-2) | 500 (-100) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/notifications` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` platform_admin 390 | card | 🔔아직 알림이 없습니다.세션·채팅·리포트 관련 알림 | 212 (-621) | 16px (-4) | 48 (+24) | 48 (+24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/notifications` platform_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/notifications` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | icon | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | card | 신청 내역이 없습니다. | 72 (-761) | 20px (+0) | 24 (+0) | 24 (+0) | 15 (-1) | 400 (+0) | rgb(111, 111, 111) / rgb(255, 255, 255) |
| `/org/requests` platform_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/requests` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 390 | primary | 밴드 연결 | 28 (-20) | 8px (-9991) | 12 (-4) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/playground` platform_admin 390 | secondary | 체험 모드(예시 데이터) | 30 (-14) | 8px (-4) | 12 (+0) | 6 (+6) | 12 (-2) | 500 (-100) | rgb(95, 0, 128) / rgb(245, 237, 252) |
| `/playground` platform_admin 390 | ghost | ← 설정으로 돌아가기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+1) | 600 (+0) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/playground` platform_admin 390 | icon | 패널 접기 | 24 (-20) | 4px (+4) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/playground` platform_admin 390 | card | 밴드 연결 및 체험밴드 신호 보기 · 기록에 저장되 | 315 (-518) | 16px (-4) | 0 (-24) | 0 (-24) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/playground` platform_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/playground` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 390 | primary | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 390 | secondary | 플레이그라운드 열기 ↗ | 48 (+4) | 12px (+0) | 16 (+4) | 12 (+12) | 15 (+1) | 700 (+100) | rgb(91, 26, 138) / rgb(255, 255, 255) |
| `/settings` platform_admin 390 | ghost | 밴드 연결 · 측정 방법 ↗ | 48 (+4) | 0px (+0) | 0 (+0) | 12 (+12) | 15 (+0) | 400 (-200) | rgb(91, 26, 138) / rgba(0, 0, 0, 0) |
| `/settings` platform_admin 390 | icon | 메뉴 열기 | 44 (+0) | 0px (+0) | 0 (+0) | 0 (+0) | 16 (+0) | 400 (+0) | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/settings` platform_admin 390 | card | LINK BAND PLAYGROUND내 마음의 신호 | 237.5 (-595.5) | 20px (+0) | 24 (+0) | 24 (+0) | 16 (+0) | 400 (+0) | rgb(255, 255, 255) / rgb(91, 26, 138) |
| `/settings` platform_admin 390 | input | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 390 | tab | N/A | — | — | — | — | — | — | — |
| `/settings` platform_admin 390 | chip | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | ghost | 처음으로 | 21 | 0px | 0 | 0 | 15 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/account-deletion` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | input |  | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/account-deletion` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | primary | 홈으로 돌아가기 | 44 | 9999px | 24 | 0 | 15 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/audit-unknown` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 1440 | chip | 홈으로 돌아가기 | 44 | 9999px | 24 | 0 | 15 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/class-members/sample-class` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 1440 | secondary | 개인정보·연구 활용 고지 | 44 | 12px | 16 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/class-members/sample-class` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 1440 | card | 비회원 클래스 참여자격은 이 화면의 메모리에만 보관 | 149.796875 | 20px | 24 | 24 | 14 | 400 | rgb(38, 35, 43) / rgb(255, 255, 255) |
| `/class-members/sample-class` public 1440 | input | 클래스 코드 | 40 | 12px | 12 | 8 | 15 | 400 | rgb(38, 35, 43) / rgb(255, 255, 255) |
| `/class-members/sample-class` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 1440 | primary | 코드 입력하기 | 48 | 9999px | 24 | 0 | 15 | 700 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/class/sample-session/enter` public 1440 | secondary | 로그인하기 | 48 | 9999px | 24 | 0 | 15 | 700 | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/class/sample-session/enter` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 1440 | card | 초대받은 클래스에 입장해 주세요초대 이메일의 참여  | 487.1875 | 24px | 24 | 32 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/class/sample-session/enter` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | ghost | 일반 운영 문의 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/crisis-help` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 1440 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 1440 | card | 비밀번호 재설정가입하신 이메일 주소를 입력해주세요. | 308 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/forgot-password` public 1440 | input | name@example.com | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/forgot-password` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 1440 | secondary | Google로 시작하기 | 52 | 12px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/invite/sample-token` public 1440 | ghost | 개인정보 처리방침 전문 보기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/invite/sample-token` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 1440 | card | 🌿샘플 상담사샘플 기관상담사 코드: SAMPLE상담 | 975 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/invite/sample-token` public 1440 | input |  | 20 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/invite/sample-token` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/join` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/join` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/join` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/join` public 1440 | icon | 이전 | 44 | 50% | 0 | 0 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/join` public 1440 | card | 입장 코드를 입력해 주세요상담사가 알려 준 숫자 4 | 293.6875 | 24px | 24 | 24 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/join` public 1440 | input | 1번째 숫자 | 64 | 12px | 0 | 0 | 36 | 800 | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/join` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/join` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/` public 1440 | primary | 마인드브리즈 시작하기 → | 48 | 9999px | 24 | 12 | 15 | 700 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/` public 1440 | secondary | 리포트 먼저 살펴보기 ↗ | 48 | 9999px | 24 | 12 | 15 | 700 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/` public 1440 | ghost | 이메일로 도입 문의 ↗ | 44 | 0px | 0 | 0 | 15 | 700 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/` public 1440 | card | BODY & MIND작은 변화에도,이야기가 있으니까 | 152 | 16px | 20 | 20 | 16 | 400 | rgb(41, 33, 46) / rgba(255, 255, 255, 0.95) |
| `/` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/login/client` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/login/client` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/login/client` public 1440 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/login/client` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/login/client` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/login/client` public 1440 | input |  | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/login/client` public 1440 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/login/client` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/login` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/login` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/login` public 1440 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/login` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/login` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/login` public 1440 | input |  | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/login` public 1440 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/login` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 1440 | primary | 측정 방법과 한계 알아보기 | 18 | 0px | 0 | 0 | 15 | 400 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/measurement-guide` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 1440 | ghost | 긴급 도움 안내 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/measurement-guide` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 1440 | card | 측정 지표 안내 | 100 | 12px | 16 | 16 | 15 | 400 | rgb(64, 64, 64) / rgb(255, 255, 255) |
| `/measurement-guide` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 1440 | primary | 입장 코드 입력 | 48 | 9999px | 24 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/o/SAMPLE` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 1440 | ghost | Mind Breeze | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/o/SAMPLE` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 1440 | card | 기관 공개 페이지샘플 기관기관 코드SAMPLE합성  | 255 | 20px | 40 | 40 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/o/SAMPLE` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/org/register` public 1440 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/org/register` public 1440 | secondary | 기관 가입 상담 신청 | 44 | 9999px | 0 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(76, 0, 102) |
| `/org/register` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/org/register` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/org/register` public 1440 | card | 영업 담당자가 상담 후 도입을 진행합니다. 상담 사 | 774 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/register` public 1440 | input | 예: 마음숲 심리상담센터 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/register` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/org/register` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | primary | ← MIND BREEZE 홈 | 44 | 0px | 0 | 0 | 15 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/privacy` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | card | 목차 | 354 | 12px | 16 | 16 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/privacy` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/privacy` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 1440 | primary | 로그인 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/register/client` public 1440 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/client` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/client` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/client` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/client` public 1440 | card | 1이메일 인증2약관 동의3정보 입력이메일 인증이메일 | 312 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/client` public 1440 | input | name@example.com | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/client` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/register/client` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 1440 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/register/organization` public 1440 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/organization` public 1440 | secondary | 기관 가입 상담 신청 | 44 | 9999px | 0 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(76, 0, 102) |
| `/register/organization` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/organization` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/organization` public 1440 | card | 영업 담당자가 상담 후 도입을 진행합니다. 상담 사 | 774 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/organization` public 1440 | input | 예: 마음숲 심리상담센터 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/organization` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/register/organization` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/register` public 1440 | primary | 로그인 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/register` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/register` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/register` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/register` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/register` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 1440 | primary | 측정 방법과 한계 알아보기 | 18 | 0px | 0 | 0 | 15 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/report-view?token=synthetic-view-token` public 1440 | secondary | PDF 다운로드 | 46 | 12px | 20 | 10 | 16 | 500 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/report-view?token=synthetic-view-token` public 1440 | ghost | mind breeze / 몸·마음 리포트 | 28.796875 | 0px | 0 | 0 | 16 | 750 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/report-view?token=synthetic-view-token` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 1440 | card | MIND BREEZE · 몸·마음 리포트내담자용me | 282.5 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/report-view?token=synthetic-view-token` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | ghost | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | card | MIND BREEZE리포트를 열 수 없습니다유효한  | 262.375 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/report-view` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/report-view` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 1440 | primary | 측정 방법과 한계 알아보기 | 18 | 0px | 0 | 0 | 15 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample` public 1440 | secondary | 리포트 | 46.5 | 12px | 14 | 12 | 15 | 700 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/reports/sample` public 1440 | ghost | mind breeze / 몸·마음 리포트 | 28.796875 | 0px | 0 | 0 | 16 | 750 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample` public 1440 | icon | 알림 | 44 | 9999px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(242, 243, 248) |
| `/reports/sample` public 1440 | card | 측정 지표 안내 | 100 | 12px | 16 | 16 | 15 | 400 | rgb(64, 64, 64) / rgb(255, 255, 255) |
| `/reports/sample` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 1440 | chip | 몸호흡수 ↓ 좋아졌어요 · 심박수 ↓ 좋아졌어요 · | 43.390625 | 14px | 15 | 10 | 13 | 400 | rgb(38, 114, 75) / rgb(240, 249, 245) |
| `/reset-password?token=synthetic-token` public 1440 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/reset-password?token=synthetic-token` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 1440 | card | 새 비밀번호 설정새 비밀번호새 비밀번호 확인비밀번호 | 346 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password?token=synthetic-token` public 1440 | input | 영문+숫자+특수문자 8자 이상 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password?token=synthetic-token` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reset-password?token=synthetic-token` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 1440 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reset-password` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 1440 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reset-password` public 1440 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reset-password` public 1440 | card | 새 비밀번호 설정새 비밀번호새 비밀번호 확인비밀번호 | 346 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password` public 1440 | input | 영문+숫자+특수문자 8자 이상 | 44 | 12px | 16 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 1440 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/role-redirect` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 1440 | input |  | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/role-redirect` public 1440 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/role-redirect` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | ghost | 랜딩 페이지로 이동 | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/set-password?token=synthetic-token` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | input | 새 비밀번호 | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/set-password?token=synthetic-token` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | ghost | 랜딩 페이지로 이동 | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/set-password` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | input | 새 비밀번호 | 52 | 9999px | 20 | 0 | 15 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/set-password` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/set-password` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | primary | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | secondary | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | ghost | 개인정보 처리방침 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/terms` public 1440 | icon | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | card | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | input | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | tab | N/A | — | — | — | — | — | — | — |
| `/terms` public 1440 | chip | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | ghost | 처음으로 | 21 | 0px | 0 | 0 | 15 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/account-deletion` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | input |  | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/account-deletion` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/account-deletion` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | primary | 홈으로 돌아가기 | 44 | 9999px | 24 | 0 | 15 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/audit-unknown` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/audit-unknown` public 390 | chip | 홈으로 돌아가기 | 44 | 9999px | 24 | 0 | 15 | 500 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/class-members/sample-class` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 390 | secondary | 개인정보·연구 활용 고지 | 44 | 12px | 16 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(244, 237, 248) |
| `/class-members/sample-class` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 390 | card | 비회원 클래스 참여자격은 이 화면의 메모리에만 보관 | 198 | 20px | 24 | 24 | 14 | 400 | rgb(38, 35, 43) / rgb(255, 255, 255) |
| `/class-members/sample-class` public 390 | input | 클래스 코드 | 48 | 12px | 12 | 8 | 16 | 400 | rgb(38, 35, 43) / rgb(255, 255, 255) |
| `/class-members/sample-class` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/class-members/sample-class` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 390 | primary | 코드 입력하기 | 48 | 9999px | 24 | 0 | 15 | 700 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/class/sample-session/enter` public 390 | secondary | 로그인하기 | 48 | 9999px | 24 | 0 | 15 | 700 | rgb(247, 244, 240) / rgba(255, 255, 255, 0.12) |
| `/class/sample-session/enter` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 390 | card | 초대받은 클래스에 입장해 주세요초대 이메일의 참여  | 542.375 | 24px | 24 | 32 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/class/sample-session/enter` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/class/sample-session/enter` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | ghost | 일반 운영 문의 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/crisis-help` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/crisis-help` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 390 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/forgot-password` public 390 | card | 비밀번호 재설정가입하신 이메일 주소를 입력해주세요. | 296 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/forgot-password` public 390 | input | name@example.com | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/forgot-password` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/forgot-password` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 390 | secondary | Google로 시작하기 | 52 | 12px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/invite/sample-token` public 390 | ghost | 개인정보 처리방침 전문 보기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/invite/sample-token` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 390 | card | 🌿샘플 상담사샘플 기관상담사 코드: SAMPLE상담 | 1073 | 16px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/invite/sample-token` public 390 | input |  | 20 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/invite/sample-token` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/invite/sample-token` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/join` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/join` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/join` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/join` public 390 | icon | 이전 | 44 | 50% | 0 | 0 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.58) |
| `/join` public 390 | card | 입장 코드를 입력해 주세요상담사가 알려 준 숫자 4 | 297.1875 | 24px | 24 | 24 | 16 | 400 | rgb(247, 244, 240) / rgba(24, 12, 36, 0.78) |
| `/join` public 390 | input | 1번째 숫자 | 64 | 12px | 0 | 0 | 36 | 800 | rgb(247, 244, 240) / rgba(0, 0, 0, 0) |
| `/join` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/join` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/` public 390 | primary | 마인드브리즈 시작하기 → | 48 | 9999px | 24 | 12 | 15 | 700 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/` public 390 | secondary | 리포트 먼저 살펴보기 ↗ | 48 | 9999px | 24 | 12 | 15 | 700 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/` public 390 | ghost | 이메일로 도입 문의 ↗ | 44 | 0px | 0 | 0 | 15 | 700 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/` public 390 | icon | 메뉴 열기 | 44 | 9999px | 0 | 0 | 16 | 400 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/` public 390 | card | BODY & MIND작은 변화에도,이야기가 있으니까 | 152 | 16px | 20 | 20 | 16 | 400 | rgb(41, 33, 46) / rgba(255, 255, 255, 0.95) |
| `/` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/login/client` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/login/client` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/login/client` public 390 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/login/client` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/login/client` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/login/client` public 390 | input |  | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/login/client` public 390 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/login/client` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/login` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/login` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/login` public 390 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/login` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/login` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/login` public 390 | input |  | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/login` public 390 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/login` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 390 | primary | 측정 방법과 한계 알아보기 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/measurement-guide` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 390 | ghost | 긴급 도움 안내 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/measurement-guide` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 390 | card | 측정 지표 안내 | 144 | 12px | 16 | 16 | 16 | 400 | rgb(64, 64, 64) / rgb(255, 255, 255) |
| `/measurement-guide` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/measurement-guide` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 390 | primary | 입장 코드 입력 | 48 | 9999px | 24 | 0 | 15 | 600 | rgb(255, 255, 255) / rgb(95, 0, 128) |
| `/o/SAMPLE` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 390 | ghost | Mind Breeze | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/o/SAMPLE` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 390 | card | 기관 공개 페이지샘플 기관기관 코드SAMPLE합성  | 239 | 20px | 32 | 32 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/o/SAMPLE` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/o/SAMPLE` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/org/register` public 390 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/org/register` public 390 | secondary | 기관 가입 상담 신청 | 44 | 9999px | 0 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(76, 0, 102) |
| `/org/register` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/org/register` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/org/register` public 390 | card | 영업 담당자가 상담 후 도입을 진행합니다. 상담 사 | 796 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/register` public 390 | input | 예: 마음숲 심리상담센터 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/org/register` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/org/register` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | primary | ← MIND BREEZE 홈 | 44 | 0px | 0 | 0 | 15 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/privacy` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | card | 목차 | 642 | 12px | 16 | 16 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/privacy` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/privacy` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 390 | primary | 로그인 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/audit-unknown` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/register/audit-unknown` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/register/client` public 390 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/client` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/client` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/client` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/client` public 390 | card | 1이메일 인증2약관 동의3정보 입력이메일 인증이메일 | 300 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/client` public 390 | input | name@example.com | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/client` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/register/client` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 390 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/counselor` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/register/counselor` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/register/organization` public 390 | primary | 다른 유형으로 가입하기 | 17 | 0px | 0 | 0 | 12 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/organization` public 390 | secondary | 기관 가입 상담 신청 | 44 | 9999px | 0 | 0 | 16 | 600 | rgb(255, 255, 255) / rgb(76, 0, 102) |
| `/register/organization` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register/organization` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register/organization` public 390 | card | 영업 담당자가 상담 후 도입을 진행합니다. 상담 사 | 796 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/organization` public 390 | input | 예: 마음숲 심리상담센터 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/register/organization` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/register/organization` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/register` public 390 | primary | 로그인 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/register` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/register` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/register` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/register` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/register` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/register` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/register` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 390 | primary | 측정 방법과 한계 알아보기 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/report-view?token=synthetic-view-token` public 390 | secondary | PDF 다운로드 | 46 | 12px | 20 | 10 | 16 | 500 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/report-view?token=synthetic-view-token` public 390 | ghost | mind breeze / 몸·마음 리포트 | 44 | 0px | 0 | 0 | 14 | 750 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/report-view?token=synthetic-view-token` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 390 | card | MIND BREEZE · 몸·마음 리포트내담자용me | 254 | 16px | 16 | 16 | 16 | 400 | rgb(31, 31, 31) / rgb(245, 237, 252) |
| `/report-view?token=synthetic-view-token` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/report-view?token=synthetic-view-token` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | ghost | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | card | MIND BREEZE리포트를 열 수 없습니다유효한  | 232 | 16px | 16 | 16 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/report-view` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/report-view` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 390 | primary | 측정 방법과 한계 알아보기 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(64, 64, 64) / rgba(0, 0, 0, 0) |
| `/reports/sample` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 390 | ghost | mind breeze / 몸·마음 리포트 | 44 | 0px | 0 | 0 | 14 | 750 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reports/sample` public 390 | icon | 메뉴 열기 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reports/sample` public 390 | card | 측정 지표 안내 | 144 | 12px | 16 | 16 | 16 | 400 | rgb(64, 64, 64) / rgb(255, 255, 255) |
| `/reports/sample` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reports/sample` public 390 | chip | 몸호흡수 ↓ 좋아졌어요 · 심박수 ↓ 좋아졌어요 · | 96 | 14px | 12 | 8 | 15 | 400 | rgb(38, 114, 75) / rgb(240, 249, 245) |
| `/reset-password?token=synthetic-token` public 390 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/reset-password?token=synthetic-token` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reset-password?token=synthetic-token` public 390 | card | 새 비밀번호 설정새 비밀번호새 비밀번호 확인비밀번호 | 338 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password?token=synthetic-token` public 390 | input | 영문+숫자+특수문자 8자 이상 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password?token=synthetic-token` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reset-password?token=synthetic-token` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 390 | primary | 로그인 페이지로 돌아가기 | 21 | 0px | 0 | 0 | 15 | 500 | rgb(95, 0, 128) / rgba(0, 0, 0, 0) |
| `/reset-password` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 390 | ghost | Mind Breeze | 36 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/reset-password` public 390 | icon | 다크 모드로 전환 | 36 | 9999px | 0 | 0 | 16 | 400 | rgb(111, 111, 111) / rgba(0, 0, 0, 0) |
| `/reset-password` public 390 | card | 새 비밀번호 설정새 비밀번호새 비밀번호 확인비밀번호 | 338 | 16px | 24 | 24 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password` public 390 | input | 영문+숫자+특수문자 8자 이상 | 48 | 12px | 16 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/reset-password` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/reset-password` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 390 | ghost | Mind Breeze 홈으로 이동 | 44 | 0px | 0 | 0 | 16 | 400 | rgb(255, 255, 255) / rgba(0, 0, 0, 0) |
| `/role-redirect` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/role-redirect` public 390 | input |  | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/role-redirect` public 390 | tab | 회원 | 40 | 9999px | 4 | 10 | 14 | 600 | rgb(95, 0, 128) / rgb(255, 255, 255) |
| `/role-redirect` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | ghost | 랜딩 페이지로 이동 | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/set-password?token=synthetic-token` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | input | 새 비밀번호 | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/set-password?token=synthetic-token` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/set-password?token=synthetic-token` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | ghost | 랜딩 페이지로 이동 | 27 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/set-password` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | input | 새 비밀번호 | 52 | 9999px | 20 | 0 | 16 | 400 | rgb(31, 31, 31) / rgb(255, 255, 255) |
| `/set-password` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/set-password` public 390 | chip | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | primary | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | secondary | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | ghost | 개인정보 처리방침 | 19 | 0px | 0 | 0 | 16 | 400 | rgb(31, 31, 31) / rgba(0, 0, 0, 0) |
| `/terms` public 390 | icon | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | card | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | input | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | tab | N/A | — | — | — | — | — | — | — |
| `/terms` public 390 | chip | N/A | — | — | — | — | — | — | — |
