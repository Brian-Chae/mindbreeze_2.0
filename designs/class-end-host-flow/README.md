# SDD-237 — 클래스 종료 후 상담사 흐름 시안

- **검토용 프로토타입**. 제품 구현 없음. 모든 이름·시간·인원·리포트는 합성 샘플이다.
- [HTML 열기](index.html) · [기획안](../../specs/sdd-237-class-end-host-flow/spec.md)
- HTML을 Chrome에서 직접 열면 된다. 서버·로그인·설치·환경파일이 필요 없다.
- 상단 ‘화면 보기’에서 현행 재현과 제안 01~08 및 10/23 결정 반영 화면을 전환한다. 핵심 제안은 **종료 → 회차 요약 → 참여자별 결과 / 비공개 기록**이다.

## 현행 재현과 제안의 구분

- `current-end`: 실제 활성 `HostPrepContainer → EndingScene`의 구조·문구를 재현. `host-ending-model.ts`가 STT skipped를 manual로 파생하고 ready done인 샘플을 사용했다. **실제 앱 캡처가 아니며**, 사진 배경·아이콘·픽셀은 단순화했다.
- `current-record`: `SessionRecordPage → RecordView → CounselorNotesTab` 메타·메모 영역 재현. STT off에서 메모 탭만 남는 흐름. 실제 앱의 모든 처리 상태를 재현한 것은 아니다.
- 나머지 화면: 신규 제안. 라이트 업무 셸은 실제 `shell-kit.css`, `structure-shell.css`의 색·여백·타이포·카드/버튼 형태를 반영했다. DESIGN.md의 퍼플 구조·절제·정직한 데이터 표현 원칙 유지.
- 운영 화면이나 dev 로그인으로 확인하지 않았다. 리포트 발행 정상 여부는 10/23 Brian의 검증 완료 전제를 따른다.

## 체험 가능한 동작과 범위

- 개요 ↔ 참여자 결과 ↔ 진행 기록 전환. 참여자 검색·상태 필터.
- 참여자 A/B/C의 이름·측정/승인 상태에 맞는 샘플 개인 리포트 접근. 부분 실패에서 이동해도 실패 행 유지.
- 기록 입력·시안 내 저장·저장 실패·미저장 이탈 경고·저장 후 탭 복귀. **저장은 문서 메모리 내 예시**이며 새로고침하면 초기화된다. 서버 저장/재접속 보장은 기획안의 구현 요구사항이다.
- 공개 코멘트 편집·시안 내 저장 → 승인 확인 → 승인 상태. 실제 API·메일·알림·메시지를 호출하지 않는다.
- 개요의 ‘검토 도구 · 예외 상태’: 0명 / 모두 미착용 / 네트워크 단절. 해당 메뉴는 제품 UI가 아니다.
- 클래스 리포트·다음 회차·목록·홈·상담 기록/상담 리포트 CTA는 **이동 설명 모달**이다. 각 대상 화면 전체를 구현한 것은 아니다. 1:1 상담은 우선순위와 상위 맥락을 보여주는 보조 화면이다.
- 각 화면 아래 화살표 주석은 실제 제품 문구가 아니라 검토용 전환 설명이다.

## 캡처 목록

Chrome / 1x / 모바일 390×844, 데스크톱 1440×1000 viewport의 **fullPage PNG**. 콘텐츠 길이에 따라 파일 높이는 다르다. 총 44장.

| 화면 | 390px | 1440px |
|---|---|---|
| 현행 종료 재현 | [current-end-390.png](screenshots/current-end-390.png) | [current-end-1440.png](screenshots/current-end-1440.png) |
| 현행 기록지 재현 | [current-record-390.png](screenshots/current-record-390.png) | [current-record-1440.png](screenshots/current-record-1440.png) |
| 제안 종료 직후 요약 | [overview-390.png](screenshots/overview-390.png) | [overview-1440.png](screenshots/overview-1440.png) |
| 참여자별 결과 | [participants-390.png](screenshots/participants-390.png) | [participants-1440.png](screenshots/participants-1440.png) |
| 비공개 기록 작성 | [notes-390.png](screenshots/notes-390.png) | [notes-1440.png](screenshots/notes-1440.png) |
| 기록 저장 완료 | [notes-saved-390.png](screenshots/notes-saved-390.png) | [notes-saved-1440.png](screenshots/notes-saved-1440.png) |
| 리포트 생성 대기 | [waiting-390.png](screenshots/waiting-390.png) | [waiting-1440.png](screenshots/waiting-1440.png) |
| 리포트 생성 실패 | [failed-390.png](screenshots/failed-390.png) | [failed-1440.png](screenshots/failed-1440.png) |
| 일부 참여자 실패 | [partial-390.png](screenshots/partial-390.png) | [partial-1440.png](screenshots/partial-1440.png) |
| 개인 리포트·코멘트·승인 | [report-390.png](screenshots/report-390.png) | [report-1440.png](screenshots/report-1440.png) |
| 1:1 상담 요약 | [counseling-390.png](screenshots/counseling-390.png) | [counseling-1440.png](screenshots/counseling-1440.png) |
| 참여자 0명 | [overview-zero-390.png](screenshots/overview-zero-390.png) | [overview-zero-1440.png](screenshots/overview-zero-1440.png) |
| 모두 LINK BAND 미착용 | [overview-noband-390.png](screenshots/overview-noband-390.png) | [overview-noband-1440.png](screenshots/overview-noband-1440.png) |
| 네트워크 단절 | [overview-offline-390.png](screenshots/overview-offline-390.png) | [overview-offline-1440.png](screenshots/overview-offline-1440.png) |

## 10/23 결정 반영 캡처

기존 시안을 이어 수정했다. 아래 8개 화면은 각 390/1440px로 추가했다. 기존 개요에도 뇌파 요약과 선택 기록 안내를 반영했다.

| 화면 | 390px | 1440px |
|---|---|---|
| 착용 세션 + 미작성 안내 | [eeg-worn-390.png](screenshots/eeg-worn-390.png) | [eeg-worn-1440.png](screenshots/eeg-worn-1440.png) |
| 일부 착용 | [eeg-partial-390.png](screenshots/eeg-partial-390.png) | [eeg-partial-1440.png](screenshots/eeg-partial-1440.png) |
| 분석 중 | [eeg-pending-390.png](screenshots/eeg-pending-390.png) | [eeg-pending-1440.png](screenshots/eeg-pending-1440.png) |
| 신호 불량 | [eeg-quality-390.png](screenshots/eeg-quality-390.png) | [eeg-quality-1440.png](screenshots/eeg-quality-1440.png) |
| 연결 끊김 | [eeg-lost-390.png](screenshots/eeg-lost-390.png) | [eeg-lost-1440.png](screenshots/eeg-lost-1440.png) |
| 비워두기 후 조용한 작성 버튼 | [notes-skipped-390.png](screenshots/notes-skipped-390.png) | [notes-skipped-1440.png](screenshots/notes-skipped-1440.png) |
| 자동 승인 추천안 · 회차 보류 | [auto-summary-390.png](screenshots/auto-summary-390.png) | [auto-summary-1440.png](screenshots/auto-summary-1440.png) |
| 도메인별 설정 · 안내 끄기 | [auto-settings-390.png](screenshots/auto-settings-390.png) | [auto-settings-1440.png](screenshots/auto-settings-1440.png) |

- 개인 A의 이완 변화 문장은 기존 `report_narrative.build_metrics_summary` 기반 서사의 **합성 예시**다. 클래스 전체 변화로 일반화하지 않는다. 품질은 명상 점수가 아니다. coverage는 수집 빈도·분모 계약이 확정되기 전까지 요약 숫자로 제시하지 않는다.
- 진행 기록 안내는 시안에서만 `localStorage`의 `sdd237-demo-prompt-seen` 플래그로 재열기·새로고침 비노출을 체험한다. 기록 본문은 저장하지 않는다. 실제 제품은 spec의 회차×상담사 서버 저장을 권장한다. 캡처 스크립트가 미작성 안내 장면 직전에 이 합성 플래그만 초기 상태로 설정한다.
- 자동 승인 설정은 [정책 비교 문서](../../specs/sdd-237-class-end-host-flow/auto-approve-policy.md)의 **미승인 추천안**이다. 보류 버튼은 문서 메모리 상태만 바꾸고 설정 저장은 변경 내용 확인 모달까지만 시연한다. 실제 설정·예약·발송은 변경하지 않는다.
- 새 화면은 기존 라이트 업무 셸과 13px/44px 기준을 유지한다. 개인정보 검토는 운영 노출 확인이 아니라 코드 경로 분석이다.

## 검증과 재현

```bash
node designs/class-end-host-flow/capture.cjs
```

- Playwright: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright`
- Chrome executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- [측정 결과](validation.json): 18화면 × 2폭의 DOM 가로 넘침, 텍스트 최소 크기, 조작 영역 검사. 44장 캡처와 검색/필터·저장 실패 보존·dirty 경고·저장 복원·승인 확인 등 시안 동작 검사.
- 외부 HTTP 요청을 차단하고 요청 시 검증 실패 처리. 실제 앱·API·BLE·LiveKit·메일·DB 동작의 검증이 아니다. 제품 빌드·단위테스트는 제품 코드 미변경이므로 실행하지 않았다.
- 독립 검토: 문서의 비host 편집이력 제외 단정을 정정했다. 실제 노출 여부를 단정하지 않고, 권한과 응답 스키마까지 확인하는 구현 전 검증 항목으로 추가했다. 참여자 오연결·부분 실패 소실·공개 코멘트 저장 소실도 시안에서 보완했다.
- 캡처 스크립트 초기 실행에서 브라우저 전역 이름 `top` 충돌을 발견해 `pageHeading`으로 수정했다. 빈 화면을 통과하지 않도록 본문 존재·화면 선택값 검증을 추가하고 전체 캡처를 다시 생성했다.

회차 요약 중심·EEG 요약·선택 기록 안내 방향은 10/23 결정됨. 자동 승인 세부 정책은 추천안 검토 대기다. 제품 구현 전 별도 plan/verify가 필요하며 SDD 완료 상태가 아니다.

### 10/23 추가 독립 검토 반영

- 착용 사례와 참여자 결과의 측정 상태, 분석 중 리포트 열기 제한, 상담 기록 이동 맥락을 맞췄다.
- 정책 적용 시점은 ‘이후 시작하는 회차’로 통일했다. 분모가 확정되지 않은 측정 비율 숫자는 제거하고, 개인 서사 미리보기의 범위를 spec에 명시했다.
- 최종 재실행: 44장 캡처, 18화면 × 2폭 DOM 검사 통과. 페이지 오류·외부 HTTP 요청 0건. 착용 사례 연결·분석 중 열기 차단·한 번 안내·설정 확인도 검사했다.
