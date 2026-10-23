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
- 클래스 리포트·다음 회차·목록·홈·상담 기록/상담 리포트 CTA는 **이동 설명 모달**이다. 각 대상 화면 전체를 구현한 것은 아니다. 1:1 상담은 개인 6지표 통계와 회차 평균 스파크라인·직전 회차 대비 Δ를 함께 제공한다.
- 각 화면 아래 화살표 주석은 실제 제품 문구가 아니라 검토용 전환 설명이다.

## 캡처 목록

Chrome / 1x / 모바일 390×844, 데스크톱 1440×1000 viewport의 **fullPage PNG**. 콘텐츠 길이에 따라 파일 높이는 다르다. 현재 캡처 48장.

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

기존 시안을 이어 수정했다. 아래 생체신호 6종 상태와 펼침 표, 기존 기록·정책 화면을 각 390/1440px로 갱신했다. 기존 개요에도 생체신호 6지표 통계 요약과 선택 기록 안내를 반영했다.

| 화면 | 390px | 1440px |
|---|---|---|
| 착용 세션 + 미작성 안내 | [biosignal-worn-390.png](screenshots/biosignal-worn-390.png) | [biosignal-worn-1440.png](screenshots/biosignal-worn-1440.png) |
| 일부 착용 | [biosignal-partial-390.png](screenshots/biosignal-partial-390.png) | [biosignal-partial-1440.png](screenshots/biosignal-partial-1440.png) |
| 분석 중 | [biosignal-pending-390.png](screenshots/biosignal-pending-390.png) | [biosignal-pending-1440.png](screenshots/biosignal-pending-1440.png) |
| 신호 불량 | [biosignal-quality-390.png](screenshots/biosignal-quality-390.png) | [biosignal-quality-1440.png](screenshots/biosignal-quality-1440.png) |
| 연결 끊김 | [biosignal-lost-390.png](screenshots/biosignal-lost-390.png) | [biosignal-lost-1440.png](screenshots/biosignal-lost-1440.png) |
| 미착용 | [biosignal-unworn-390.png](screenshots/biosignal-unworn-390.png) | [biosignal-unworn-1440.png](screenshots/biosignal-unworn-1440.png) |
| 참여자 통계 펼침 표 | [biosignal-participants-390.png](screenshots/biosignal-participants-390.png) | [biosignal-participants-1440.png](screenshots/biosignal-participants-1440.png) |
| 비워두기 후 조용한 작성 버튼 | [notes-skipped-390.png](screenshots/notes-skipped-390.png) | [notes-skipped-1440.png](screenshots/notes-skipped-1440.png) |
| 자동 승인 추천안 · 회차 보류 | [auto-summary-390.png](screenshots/auto-summary-390.png) | [auto-summary-1440.png](screenshots/auto-summary-1440.png) |
| 도메인별 설정 · 안내 끄기 | [auto-settings-390.png](screenshots/auto-settings-390.png) | [auto-settings-1440.png](screenshots/auto-settings-1440.png) |

- 카드 제목 **생체신호 분석 요약**. 진행 화면의 집중도/이완도/감정균형도/BPM/호흡/HRV 라벨·색·단위를 유지했다. HRV는 SDNN, 감정균형도는 정서 안정 지표다.
- 다인은 지표별 측정 인원·참여자 동등 가중 평균·개인 평균 범위·초반→후반·Δ·유효 시간/비율을 보여준다. 참여자별 평균·Δ·신호 품질 테이블을 펼칠 수 있다. 모바일도 같은 테이블의 행·라벨을 유지하며 세로 배치한다.
- 1:1은 개인 평균·유효 표본 범위와 1~3회차 평균 스파크라인·직전 회차 Δ. 모든 통계·시간·비율·추이는 **합성 샘플·표시 제안**이다. 서버 제공 사실을 의미하지 않으며 신규 집계 범위는 spec §5.E.2에 분리했다.
- 명상 종합점수·합산 점수·순위 없음. 지표 색은 식별용이며 수치·화살표·서사는 우열을 판정하지 않는다. 일부 착용은 측정자만 집계, PPG 신호 부족 샘플은 해당 3지표만 —. 서사에서도 결측 지표 변화는 생략한다.
- 현재 화면 키와 캡처 링크는 `biosignal-*`로 전환했다. 삭제 금지 지시에 따라 기존 `eeg-*` PNG 10장은 과거 산출물로 그대로 보존하며 현재 검토·검증 목록에는 포함하지 않는다. 현재 48장 + 과거 보존 10장이다.
- 진행 기록 안내는 시안에서만 `localStorage`의 `sdd237-demo-prompt-seen` 플래그로 재열기·새로고침 비노출을 체험한다. 기록 본문은 저장하지 않는다. 실제 제품은 spec의 회차×상담사 서버 저장을 권장한다. 캡처 스크립트가 미작성 안내 장면 직전에 이 합성 플래그만 초기 상태로 설정한다.
- 자동 승인 설정은 [정책 비교 문서](../../specs/sdd-237-class-end-host-flow/auto-approve-policy.md)의 **미승인 추천안**이다. 보류 버튼은 문서 메모리 상태만 바꾸고 설정 저장은 변경 내용 확인 모달까지만 시연한다. 실제 설정·예약·발송은 변경하지 않는다.
- 새 화면은 기존 라이트 업무 셸과 13px/44px 기준을 유지한다. 개인정보 검토는 운영 노출 확인이 아니라 코드 경로 분석이다.

## 검증과 재현

```bash
node designs/class-end-host-flow/capture.cjs
```

- Playwright: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright`
- Chrome executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- [측정 결과](validation.json): 19화면 × 2폭의 DOM 가로 넘침, 텍스트 최소 크기, 조작 영역 검사. 48장 캡처와 검색/필터·저장 실패 보존·dirty 경고·저장 복원·승인 확인 등 시안 동작 검사.
- 외부 HTTP 요청을 차단하고 요청 시 검증 실패 처리. 실제 앱·API·BLE·LiveKit·메일·DB 동작의 검증이 아니다. 제품 빌드·단위테스트는 제품 코드 미변경이므로 실행하지 않았다.
- 독립 검토: 문서의 비host 편집이력 제외 단정을 정정했다. 실제 노출 여부를 단정하지 않고, 권한과 응답 스키마까지 확인하는 구현 전 검증 항목으로 추가했다. 참여자 오연결·부분 실패 소실·공개 코멘트 저장 소실도 시안에서 보완했다.
- 캡처 스크립트 초기 실행에서 브라우저 전역 이름 `top` 충돌을 발견해 `pageHeading`으로 수정했다. 빈 화면을 통과하지 않도록 본문 존재·화면 선택값 검증을 추가하고 전체 캡처를 다시 생성했다.

회차 요약 중심·생체신호 6지표 요약·선택 기록 안내 방향은 10/23 결정됨. 자동 승인 세부 정책은 추천안 검토 대기다. 제품 구현 전 별도 plan/verify가 필요하며 SDD 완료 상태가 아니다.

### 10/23 추가 독립 검토 반영

- 착용 사례와 참여자 결과의 측정 상태, 분석 중 리포트 열기 제한, 상담 기록 이동 맥락을 맞췄다.
- 정책 적용 시점은 ‘이후 시작하는 회차’로 통일했다. 분모가 확정되지 않은 측정 비율 숫자는 제거하고, 개인 서사 미리보기의 범위를 spec에 명시했다.
- 이전 검토에서 보완한 착용 사례 연결·분석 중 열기 차단·한 번 안내·설정 확인을 유지한다. 이번 최종 재실행: 48장 캡처, 19화면 × 2폭 DOM 검사 통과. 페이지 오류·외부 HTTP 요청 0건. 착용 사례 연결·분석 중 열기 차단·한 번 안내·설정 확인도 검사했다.

### 10/23 생체신호 정정 검증

- `capture.cjs`: 19화면 × 390/1440, 펼침 표 캡처 포함 총 48장. 가로 넘침 0, 최소 글자 13px, 조작 44px 이상. 페이지 오류·외부 HTTP 요청 0.
- 6지표 카드 수, 참여자 4행/6지표+품질 열, PPG만 결측 3칸, 분석 중·미착용 결측 6칸, 개인 스파크라인 6개와 직전 회차 비교를 검사한다. 일부 착용 합성 평균·범위·Δ는 참여자 행과 대조한다.
- Chrome 캡처를 직접 열어 클래스·모바일 펼침 표·1:1 배치를 확인한다. 제품 코드·실제 API·기기·서버·DB 검증은 수행하지 않는다.
- 추가 사업 결정: 소수(1~2명) 통계를 상담사 전용으로 제공할 범위, 기존 자동 승인 정책 추천안. 정규화·유효 시간·분모 계산은 후속 기술 설계 사항이다.
- 독립 검토에서 발견한 신호 부족 상태의 호흡 변화 서사와 분석 중/미착용 상태의 고정 ‘24분’ 설명을 수정했다. 별도 검증자가 지정 Chrome 390px에서 3종 상태를 다시 열어 결측·문구·가로 넘침·페이지 오류·외부 요청을 확인했고 모두 통과했다.
