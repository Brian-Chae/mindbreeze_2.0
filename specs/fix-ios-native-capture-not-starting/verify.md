# [Fix] verify (구현 전)
- V1 recoveryVeto: raw.journal 수정시각이 3h 이내 → nil(되살림 허용) / 3h 초과 → stale_session / feature 또는 outbox 129MB 이상(sparse 파일) → journal_too_large / 세션 디렉터리 없음 → nil.
- V2 recoverOnLaunch: stale 세션이면 false 반환, band.connect 0회, 소유권 미획득(isNativeOwning=false), active.json 이 abandoned 파일로 이동, 세션 디렉터리 파일 그대로 존재. 정상(신선) 세션 되살림은 기존 시험(ManagerTests) 그대로 통과.
- V3 startMeasurement: 다른 sessionId 의 CAPTURING 중 새 시작 → alreadyActive 가 아니라 성공, 이전 세션 capture.close 송신, 새 세션 capture.start 송신. 같은 sessionId·다른 requestId 는 기존대로 alreadyActive.
- V4 FE: native 시작 실패 시 기기 시트 오류줄에 사유 표시(순수 함수 시험), native 정상/idle 이면 null.
- V5 회귀: swift test 전체, vitest(tests/sdd246-web 외 관련), tsc.
- V6 실기기(미실시): 새 빌드 설치 후 앱이 종료되지 않고, 클래스 입장 시 capture.start 도달.
