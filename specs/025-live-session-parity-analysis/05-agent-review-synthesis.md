# SDD-025 — 1.0 라이브 세션 분석 → 2.0 개선 기획 (에이전트 리뷰 종합)

> 멀티에이전트: Claude(백엔드·데이터), Cursor(UX), Codex(통합·정합) 완료.

## 1. 핵심 결론

1.0의 지도사/참여자 라이브 세션을 분석한 결과, **2.0은 EEG 전송을 WS 중심으로 개선했지만 세션 제어·복구·모니터링까지 1.0과 정합하다고 볼 수 없다.** 특히 저장 확인 없는 전송, 재연결 시 버퍼 폐기, room 접근 검증 부재가 운영 전 P0 결함이다.

## 2. 1.0의 잘 구현된 부분 (2.0 반영 가치)

| # | 항목 | 1.0 | 2.0 현재 |
|---|------|-----|----------|
| 1 | playGroupId(그룹 재생) | ✅ | ❌ (pause/resume 시 window_index 충돌로 데이터 소실) |
| 2 | 재연결 복구 | ✅ AsyncStorage | 부분(연결 복구만, 신원·상태·측정 연속성 복구 미완) |
| 3 | DeviceStatus 4종 | ✅ 접촉/연결실패 구분 | quality 파생 + device_fail dead code |
| 4 | 접촉불량 LeadOff UX | ✅ | 부분(하드웨어 계약·안내 미흡) |
| 5 | 효율 2해상도 | ✅ 1초+60초 | 1초 시계열만, 60초 버킷 없음 |
| 6 | raw S3 보존 | ✅ presigned | EEGRecord만 정의(user_id NOT NULL 게스트 불가) |
| 7 | 리포트 파이프라인 | ✅ ReportStatus 4단계 | Report 상태 필드 부재 |
| 8 | 지도사 대시보드 | ✅ 4종+무응답 강조 | Dashboard 있음, 무응답 강조·last_eeg_at 상대시간 없음 |

## 3. 2.0이 더 나은 부분 (유지)

- WS 실시간 push (1.0은 1초 폴링 의존)
- 정규화된 데이터 모델 (Session/SessionParticipant/EEGFeatureWindow, FK+UNIQUE)
- 7지표 EEG 리포트 엔진 (SDD-022, 정규화 상수 + 품질 게이트 + null 보존)

## 4. P0 결함 (Codex 발견 — 라이브 운영 전 필수)

1. **권한 검증 부족** — connect가 잘못된 토큰도 허용, join은 session_id만으로 입장, EEG를 같은 room의 모든 게스트에게 broadcast, 대리 업로드 차단 없음
2. **재접속 데이터 유실** — WS emit 성공을 저장 성공으로 취급, 단절 중 REST 버퍼 재연결 시 폐기, offset 0 재시작으로 UNIQUE 충돌
3. **WS/REST 신호 불일치** — SQI 0.5(프론트 ok vs 서버 lead_off), null SQI valid 승격
4. **제어 이벤트/snapshot 부재** — 시작/종료는 REST·폴링, EEG는 WS 분리, 새 참여자 EEG 없으면 WS 갱신 없음

## 5. 개선 로드맵

| Phase | 범위 |
|-------|------|
| **P0** | ① 참여 권한 계약(host/guest credential·room/upload 소유 검증) ② 공통 상태 계약(join snapshot·상태/참여자/기기 이벤트) ③ 유실 없는 이어하기(영속 큐+ACK+멱등 재전송) ④ 기기·품질 정합(LeadOff/SQI 분리·unknown 정책) |
| **P1** | 1초/60초 조회 계약·raw chunk manifest(presigned)·Report 상태머신(ReportStatus 4단계) |
| **P2** | SessionRun(반복 회차)·60초 물화·배터리·규모 확장 |

## 6. 한 줄 결론

**1.0은 폴링과 MongoDB 비정규화로 지탱했던 라이브 세션을, 2.0은 WS·정규화된 모델로 개선했지만 "저장 보장·접근 통제·상태 정합"이라는 운영 안전망이 빠져 있다.** 더 완벽한 서비스를 위해선 1.0의 playGroupId·재연결 복구·DeviceStatus·LeadOff·리포트 파이프라인을 계승하면서, Codex가 지적한 P0 결함(권한·유실·신호 불일치)부터 메워야 한다.
