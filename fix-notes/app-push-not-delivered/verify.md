# 구현 전 검증 체크리스트

- [x] 새 리포트·초대·시작 이벤트당 push 한 건, 기존 ws/email 유지
- [x] push OFF·in_app OFF 독립성, 미지원/별도 처리 이벤트 중복 없음
- [x] commit=False 알림은 rollback 시 push도 취소되고 즉시 발송하지 않음
- [x] 채팅 push OFF 존중, 메시지 본문·이름 노출 없음
- [x] 신규 push를 mock FCM으로 소비해 sent 확인, 기존 만료/재시도/무토큰 규칙 유지
- [x] 앱 복귀 등록 재시도·중복 억제·로그아웃 이후 재등록 금지
- [x] 네이티브/웹 디바이스 schema 경계값과 422 조건 확인
- [x] 관련 pytest, vitest, tsc; 실제 외부 전송 및 환경파일 로드 차단
- [x] 독립 검증자가 diff·테스트 재검증
- [x] summary에 근거 행·미확정 사항·실기기 절차·재빌드 버전 기록

전체 suite와 실기기/네이티브 빌드는 통과로 간주하지 않는다. summary의 관측 실패·미검증 범위를 참조한다. 리포트 AI ON/OFF × push ON/OFF × in_app ON/OFF 및 중복 승인에서도 한 건/0건 정책을 추가 검증했다.
