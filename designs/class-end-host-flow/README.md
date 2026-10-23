# SDD-237 — 클래스 종료 후 상담사 흐름 시안

- **검토용 프로토타입**. 제품 구현 없음. 모든 이름·시간·인원·리포트는 합성 샘플이다.
- [HTML 열기](index.html) · [기획안](../../specs/sdd-237-class-end-host-flow/spec.md)
- HTML을 Chrome에서 직접 열면 된다. 서버·로그인·설치·환경파일이 필요 없다.
- 상단 ‘화면 보기’에서 현행 재현과 제안 01~08을 전환한다. 핵심 제안은 **종료 → 회차 요약 → 참여자별 결과 / 비공개 기록**이다.

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

Chrome / 1x / 모바일 390×844, 데스크톱 1440×1000 viewport의 **fullPage PNG**. 콘텐츠 길이에 따라 파일 높이는 다르다. 총 28장.

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

## 검증과 재현

```bash
node designs/class-end-host-flow/capture.cjs
```

- Playwright: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright`
- Chrome executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- [측정 결과](validation.json): 10화면 × 2폭의 DOM 가로 넘침, 텍스트 최소 크기, 조작 영역 검사. 28장 캡처와 검색/필터·저장 실패 보존·dirty 경고·저장 복원·승인 확인 등 시안 동작 검사.
- 외부 HTTP 요청을 차단하고 요청 시 검증 실패 처리. 실제 앱·API·BLE·LiveKit·메일·DB 동작의 검증이 아니다. 제품 빌드·단위테스트는 제품 코드 미변경이므로 실행하지 않았다.
- 독립 검토: 문서의 비host 편집이력 제외 단정을 정정했다. 실제 노출 여부를 단정하지 않고, 권한과 응답 스키마까지 확인하는 구현 전 검증 항목으로 추가했다. 참여자 오연결·부분 실패 소실·공개 코멘트 저장 소실도 시안에서 보완했다.
- 캡처 스크립트 초기 실행에서 브라우저 전역 이름 `top` 충돌을 발견해 `pageHeading`으로 수정했다. 빈 화면을 통과하지 않도록 본문 존재·화면 선택값 검증을 추가하고 전체 캡처를 다시 생성했다.

이번 산출물은 Stage ① 기획·시안 검토 완료 상태다. Brian의 방향 승인 후 plan/verify를 작성하고 제품 구현을 진행해야 한다.
