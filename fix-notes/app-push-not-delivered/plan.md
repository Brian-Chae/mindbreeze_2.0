# 앱 푸시 미수신 원인분석·수정 계획

사용자가 이번 요청에서 최소 수정·테스트·커밋·PR 생성을 승인한 Fix 작업이다. 구현 전 검증 항목은 verify.md에 기록한다. 새 기능 기획이 아니라 기존 푸시 전달 계약의 누락을 복구한다.

## 확인한 원인
- notification_service.notify_event는 ws/email만 생성한다. push 선호가 켜져도 일반 알림은 push로 전달되지 않는다.
- push 기본값은 회차 변경 4종뿐이다. 채팅 별도 경로는 사용자 push 선호를 확인하지 않는다.
- 네이티브 최초 권한은 설정의 사전 안내에서만 요청한다. 이미 허용한 기기의 등록 실패는 무시하며 복귀 시 재시도가 없다. UI는 서버 등록 전에 성공을 표시한다.
- iOS APNs→FCM 교환은 이미 구현되어 있다. schema와 앱 payload는 일치한다. 제보된 422 원인과 과거 채팅 3건 최종 상태는 응답/DB 없이 확정 불가.

## 최소 수정
1. report_ready, session_invited, class_invited, session_started만 일반 push에 연결하고 기본 ON. 채팅은 기존 경로 유지, 기본 ON·명시 OFF 존중. 기존 class_effect/agent/risk의 별도 push와 중복시키지 않는다.
2. 잠금화면은 이름·상담 내용 없는 고정 문구, 역할에 맞는 딥링크. 기존 미발송 행의 상태·available_at은 변경하지 않고 신규 이벤트만 생성한다.
3. 즉시 발송 결과와 적재 건수를 개인정보 없이 관측 가능하게 한다. cron·즉시 소비자의 DB/커밋 경로를 문서화한다.
4. 앱 복귀 시 권한 허용된 기기의 토큰 등록을 재시도한다. 권한 승인과 서버 등록 성공을 혼동하는 문구를 수정한다. 재빌드 최소 버전 Android 5/iOS 4로 올린다.
5. 실제 외부 접속과 .env 로드를 차단한 pytest, vitest, tsc로 검증하고 독립 리뷰를 받는다.

## 소유 범위
backend notification_service.py, chat_service.py(푸시 헬퍼만), models/user.py(푸시 기본값만), tasks/push_task.py 및 관련 테스트. frontend native/push.ts, WebPushCard.tsx, native-push.test.ts, 앱 버전 설정. 밴드·클래스 플레이어·class_effect 파일은 수정하지 않는다.

## 확장 검증에서 확인한 리포트 중복 보완

전체 pytest에서 일반 report_ready와 기존 루시 리포트 메시지가 각각 push를 생성하는 회귀를 재현했다. agent_service의 리포트 전용 분기만 추가해 이미 생성된 report 딥링크 push가 있으면 추가 발송하지 않으며 report_ready OFF도 존중한다. AI ON/OFF × push ON/OFF 및 중복 승인 4종 검증을 추가했다. 기존 비식별 테스트는 한 건·개인정보 차단 단언을 유지하고 새 일반 본문 및 직접 리포트 링크 계약을 검증한다.
