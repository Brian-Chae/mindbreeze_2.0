# SDD-029 — Summary (1.0 디자인 패리티)

## 구현 결과 (P0 → P1 → P2)

### P0 — 명상·호스트 화면 + 리포트 메일 백엔드 (`4a0b42e`)
- 명상: 검정 풀블리드 + 자연 이미지 페이드(webp 10장, 20s/1s 교차) + 두뇌휴식도 `clamp(64,10vw,130)px` + "AI 분석중" 깜빡임 + 회색 바차트
- 호스트: 흰 배경 + 세션코드 배너 + DashboardBox 4종 + 평평한 8컬럼 표 + 진/연보라 버튼
- 리포트 메일 BE: 이메일 OTP → participant_token 소유 검증 → 7일 만료 링크 (pytest 316)

### P1 — 완료 화면 + LeadOffModal + Welcome (`879fd89`)
- 완료: #F5EDFC + 리포트 샘플 마퀴 + 게스트 이메일 OTP → report-email
- LeadOffModal: 풀스크린 + SensorTracker(LED 그리드) + 무시하기
- waiting Welcome 2단계 페이드

### P2 — intro 영상 + 화면 꺼짐 + 클래스 목록 표 (`894b0d7`)
- intro 영상: 11.3MB → 1.18MB 최적화, Welcome 후 자동 재생(loop)
- useWakeLock: 명상·대기 중 화면 꺼짐 방지
- 클래스 목록: 카드 그리드 → 1.0 LectureScreen 패리티 평평한 테이블

## 디버깅

- **클래스 참가자 0명 → 시작 불가** (`1e2b9d3`): 클래스 생성 `max_participants` 기본값 1이 원인. 그룹 수업인데 1명만 허용. 프론트 2곳 + 백엔드 스키마 기본값 1→10. 백엔드 join/live-metrics는 정상이었음(직접 재현 확인).

## Brian 결정 반영

1. 리포트 = 메일 발송 (전화 신청 대신)
2. 배터리 임계 = `<=25%` 통일
3. 종료 버튼 = 시작 진보라(#5F0080) / 종료 연보라(#D2AEFC)
4. 초대형 숫자 = `clamp()` 반응형
5. **자리번호 = 제외** (온라인 수업 고려 — 물리적 좌석 의미 없음)

## 테스트

- 백엔드 pytest 316 passed, 1 skipped (신규 14개: 리포트 메일·participant_token)
- 프론트 tsc/build 통과 (P0/P1/P2 각각)

## 남은 후속 (선택·하드웨어 의존)

- 실제 LINK BAND 하드웨어 BLE E2E
- SensorTracker는 P1에서 LeadOffModal에 구현 완료 (별도 작업 없음)
