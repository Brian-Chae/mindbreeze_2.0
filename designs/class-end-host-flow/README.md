# SDD-237 — 클래스 종료 후 상담사 흐름 시안

## 명상 클래스 서사형 v2 — 10/23 최종 기획 반영

- **기본 진입: [명상 클래스 서사형 v2](index.html#narr-normal)**. 기존 시안은 화면 선택기에 그대로 보존했다. `counseling` 화면·기존 캡처는 변경하지 않았다.
- 기준: `class-narrative.md` **137a21ff**, 이후 **90991be2**의 AI 허용·상담사용 클래스 리포트 결정 및 `counselor-class-report.md` §2.6. 문서는 읽기만 했으며 `specs/`를 수정하지 않았다.
- **요약**: S0 종료 헤더 → S1 AI 한 줄·6지표 방향 칩 → S2 참석/측정/리포트 대상 → 클래스 리포트 동선 → S6 승인·선택 기록·다음 회차.
- **상담사용 클래스 리포트**: S1~S5를 같은 합성 데이터로 표시. 몸→마음 순서, 시간축 그래프, 문장 아래 접힌 6지표 근거, 참여자 검색·상태 필터·개인 상세. 업무 S6는 넣지 않는다. `narr-report`(완료), `narr-report-pending`(생성 중).
- 서사에 **AI 요약 · 상담사 검토용**과 근거 링크. 통계로 만든 S3 문구·상태 문구에는 AI 라벨을 붙이지 않는다. 실제 AI 호출 없이 채택 문장을 가정한 합성 예시다.
- 회원 리포트 실제 소스 6개를 확인했다: `NarrativeSections.tsx`, `ClientReportViewer.tsx`, `narrative-sections.css`, `EegTimeline.tsx`, `EegMetricsGrid.tsx`, `ReportCoverSection.tsx`. 라이트 퍼플 커버·편집형 타이포·번호 목차·전후 비교를 가져왔고, 판정 문구·정상 범위 띠는 적용하지 않았다.

### 상태와 동작

| 요약 화면 키 | 상태 | 리포트 상세의 차이 |
|---|---|---|
| `narr-normal` | 참석·측정 4명 | 6지표·마음 3선 / 몸 개별 3축 |
| `narr-partial` | 참석 4명·측정 2명 | 측정자만 집계, 전체 대표 아님 표기 |
| `narr-single` | 측정 1명 | 6행 유지, 클래스 평균·범위·변화·그래프 숨김 |
| `narr-poor` | 몸 신호 부족 | 몸 3지표 `—`, 마음만 서술·표시 |
| `narr-lost` | 일부 연결 유실 | 10–15분 비교 1명 구간 선·범위 비표시 |
| `narr-unworn` | 미착용 | S3 짧은 안내, S4 측정 없음 1장 |
| `narr-pending` | 분석 중 | 인원 확인 중, 6지표 `—`, 열기 비활성 |
| `narr-error` | 요약 조회 실패 | 오류 안내·읽기 재시도, 참여자는 별도 조회 예시 |
| `narr-zero` | 참석 0명 | S3~S5 없음, 요약에는 다음 회차·목록만 |

- 요약의 근거 링크·참여자 결과 버튼은 **같은 상태의 클래스 리포트 해당 섹션**으로 이동한다. `?report-state=single#narr-report`처럼 상태를 URL에 유지해 새로고침에도 평균이 나타나지 않는다.
- 5분 버킷 6개와 전반/후반 평균을 한 합성 시계열에서 계산한다. 15분 경계, 마음 0–100%, 몸은 각각 단위·축, 선택 구간의 수치는 그래프 아래 표시한다. 개인 평균 범위 띠는 선택 표시이며 개인 선을 겹치지 않는다.
- 지표 상세: 전후 2막대 + 80px 시간 추이 + 측정/비교 인원·개인 범위·유효 시간. 지표 식별색은 spec §5.E.1을 따른다. 상태/방향의 우열 색은 없다.
- 검토 도구에서 유예 0/10분 전환: 0분은 ‘자동 승인 즉시 적용’·보류 없음, 10분은 19:40 예정·이번 회차 보류. 상담사용 리포트는 승인 대상 집계와 분리한다.
- 진행 기록은 선택. 안내를 본 회차는 재진입 때 숨기며 ‘비워두기’·‘전체 회차 안내 끄기’를 체험할 수 있다. `localStorage`에는 합성 시안의 안내 플래그만 저장한다. 기록 본문은 메모리에만 있으며 서버 저장이 아니다.

### 대표 캡처

Google Chrome, 모바일 390×844 / 데스크톱 1440×1000, DPR 1, fullPage PNG. **v2 신규 44장**. 기존 52장과 과거 보존 10장은 그대로다.

| 화면 | 데스크톱 1440 | 모바일 390 |
|---|---|---|
| 정상 회차 요약 | [normal-1440](screenshots/narrative-normal-1440.png) | [normal-390](screenshots/narrative-normal-390.png) |
| 클래스 리포트 완료 · 그래프 | [report-1440](screenshots/narrative-report-1440.png) | [report-390](screenshots/narrative-report-390.png) |
| 클래스 리포트 생성 중 | [pending-1440](screenshots/narrative-report-pending-1440.png) | [pending-390](screenshots/narrative-report-pending-390.png) |
| 측정 1명 요약 | [single-1440](screenshots/narrative-single-1440.png) | [single-390](screenshots/narrative-single-390.png) |
| 측정 1명 리포트 | [report-single-1440](screenshots/narrative-report-single-1440.png) | [report-single-390](screenshots/narrative-report-single-390.png) |
| 미착용 요약 | [unworn-1440](screenshots/narrative-unworn-1440.png) | [unworn-390](screenshots/narrative-unworn-390.png) |
| 미착용 리포트 | [report-unworn-1440](screenshots/narrative-report-unworn-1440.png) | [report-unworn-390](screenshots/narrative-report-unworn-390.png) |
| 몸 그래프 탭 | [body-1440](screenshots/narrative-body-1440.png) | [body-390](screenshots/narrative-body-390.png) |
| 지표 근거 펼침 · 범위 | [evidence-1440](screenshots/narrative-evidence-1440.png) | [evidence-390](screenshots/narrative-evidence-390.png) |
| 참여자별 상세 펼침 | [detail-1440](screenshots/narrative-participant-detail-1440.png) | [detail-390](screenshots/narrative-participant-detail-390.png) |
| 유예 10분 | [grace-1440](screenshots/narrative-grace-1440.png) | [grace-390](screenshots/narrative-grace-390.png) |

나머지 상태도 `screenshots/narrative-{상태}-{폭}.png`, 리포트는 `narrative-report-{상태}-{폭}.png`로 캡처했다. 정상 리포트만 `narrative-report-{폭}.png`다.

### 검증 및 기획과의 차이

- 실행: `node designs/class-end-host-flow/capture-narrative.cjs`. 원본 저장소 `frontend/node_modules/playwright`와 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 사용. HTTP 요청 차단, file URL로 실행.
- [검증 JSON](narrative-validation.json): 9상태 × 요약/리포트 × 2폭 = **36화면**. 가로 넘침 0, 최소 글자 13px, 조작 44×44px 이상. 페이지 오류·외부 HTTP 요청 0.
- 수치 독립 재계산, 0–100 차트 좌표, 결측 구간의 선 끊김, 몸/마음 탭, 근거 펼침, 검색, 구간값, 유예/보류, 1회 안내 재진입, 예외 리포트 상태·새로고침을 실제 브라우저에서 검사했다.
- 기존 상담 `#app`은 137a21ff 소스와 같은 안내 상태로 맞춰 **390/1440 픽셀 동일** 확인. 상담 캡처 파일은 생성·수정하지 않았으며 비교는 메모리 버퍼만 사용했다. 구현자와 별도 검토자의 읽기전용 검토를 거쳤다.
- **의도한 차이**: 설치·제품 코드 변경 없는 정적 HTML 시안이므로 Recharts 대신 동일 축·수치를 쓰는 SVG를 사용한다. 원시 1초 신호/이동평균·서버 집계·실제 AI 호출은 구현하지 않고 5분 집계 합성 데이터로 표현한다. 선택 항목인 참여자 행 미니 차트와 방향 분포 건수는 생략하고 상세 펼침으로 연결했다.
- 버튼은 최신 감독 지시의 **‘상담사 클래스 리포트 열기’**를 사용했다(기획의 ‘클래스 리포트 전체 보기’와 동일 동선). 초기 S0~S6 한 페이지 요구는 최신 90991be2 §2.6의 요약/리포트 분리로 대체했다.
- 제품 코드·서버·DB·환경파일·메일·실제 AI 미사용. 이 결과는 디자인 시안 검증이며 제품 동작·운영 검증이 아니다. PR·머지·develop 푸시·배포 없음.

---

## 기존 시안 기록 (보존)

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

Chrome / 1x / 모바일 390×844, 데스크톱 1440×1000 viewport의 **fullPage PNG**. 콘텐츠 길이에 따라 파일 높이는 다르다. 기존 시안 캡처 52장 (v2 별도).

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

기존 시안을 이어 수정했다. 아래 생체신호 7종 상태와 펼침 표, 기존 기록·정책 화면을 각 390/1440px로 갱신했다. 기존 개요에도 생체신호 6지표 통계 요약과 선택 기록 안내를 반영했다.

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
| 자동 승인 C안 · 유예 10분 / 회차 보류 | [auto-summary-390.png](screenshots/auto-summary-390.png) | [auto-summary-1440.png](screenshots/auto-summary-1440.png) |
| 자동 승인 C안 · 유예 0분 | [auto-summary-zero-390.png](screenshots/auto-summary-zero-390.png) | [auto-summary-zero-1440.png](screenshots/auto-summary-zero-1440.png) |
| 측정 1명 · 클래스 평균/범위 비노출 | [biosignal-single-390.png](screenshots/biosignal-single-390.png) | [biosignal-single-1440.png](screenshots/biosignal-single-1440.png) |
| 도메인별 설정 · 안내 끄기 | [auto-settings-390.png](screenshots/auto-settings-390.png) | [auto-settings-1440.png](screenshots/auto-settings-1440.png) |

- 카드 제목 **생체신호 분석 요약**. 진행 화면의 집중도/이완도/감정균형도/BPM/호흡/HRV 라벨·색·단위를 유지했다. HRV는 SDNN, 감정균형도는 정서 안정 지표다.
- 6개 지표는 데스크톱·모바일 모두 **1열 풀폭 카드**로 나열한다. 이름·EEG/PPG·대표값 아래 통계는 데스크톱 1줄, 모바일 2줄이다. 후속 업무는 하단으로 옮겨 카드 공간을 확보했다.
- 측정 2명 이상에서만 클래스 평균·범위를 표시한다. 1명이면 `측정 1명 — 참여자별 결과에서 확인`을 표시하며 평균·범위·클래스 변화량을 숨긴다. 연결 유실로 1명만 남은 상태에도 같은 규칙을 적용한다.
- 다인은 지표별 측정 인원·참여자 동등 가중 평균·개인 평균 범위·초반→후반·Δ·유효 시간/비율을 보여준다. 참여자별 평균·Δ·신호 품질 테이블을 펼칠 수 있다. 모바일도 같은 테이블의 행·라벨을 유지하며 세로 배치한다.
- 1:1은 개인 평균·유효 표본 범위와 1~3회차 평균 스파크라인·직전 회차 Δ. 모든 통계·시간·비율·추이는 **합성 샘플·표시 제안**이다. 서버 제공 사실을 의미하지 않으며 신규 집계 범위는 spec §5.E.2에 분리했다.
- 명상 종합점수·합산 점수·순위 없음. 지표 색은 식별용이며 수치·화살표·서사는 우열을 판정하지 않는다. 일부 착용은 측정자만 집계, PPG 신호 부족 샘플은 해당 3지표만 —. 서사에서도 결측 지표 변화는 생략한다.
- 현재 화면 키와 캡처 링크는 `biosignal-*`로 전환했다. 삭제 금지 지시에 따라 기존 `eeg-*` PNG 10장은 과거 산출물로 그대로 보존하며 현재 검토·검증 목록에는 포함하지 않는다. 현재 52장 + 과거 보존 10장이다.
- 진행 기록 안내는 시안에서만 `localStorage`의 `sdd237-demo-prompt-seen` 플래그로 재열기·새로고침 비노출을 체험한다. 기록 본문은 저장하지 않는다. 실제 제품은 spec의 회차×상담사 서버 저장을 권장한다. 캡처 스크립트가 미작성 안내 장면 직전에 이 합성 플래그만 초기 상태로 설정한다.
- 자동 승인 설정은 [정책 비교 문서](../../specs/sdd-237-class-end-host-flow/auto-approve-policy.md)의 **채택된 C안**이다. 기본 0분, 옵션 0/5/10/30분이며 상담·명상별 켜기/끄기를 제공한다. 0분 요약에는 즉시 적용 안내만, 10분 요약에는 예정 시각과 보류를 제공한다. 비공개 메모는 자동 초안에서 제외하고 데이터 없는 리포트는 자동 승인하지 않는다. 보류 버튼은 문서 메모리 상태만 바꾼다. 설정 확인 모달은 선택한 영역별 유예 값을 보여주며, 안내 끄기는 합성 시안의 `sdd237-demo-prompt-off` 플래그에만 반영한다. 실제 설정·예약·발송은 변경하지 않는다.
- 새 화면은 기존 라이트 업무 셸과 13px/44px 기준을 유지한다. 개인정보 검토는 운영 노출 확인이 아니라 코드 경로 분석이다.

## 검증과 재현

```bash
node designs/class-end-host-flow/capture.cjs
```

- Playwright: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright`
- Chrome executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- [측정 결과](validation.json): 21화면 × 2폭의 DOM 가로 넘침, 텍스트 최소 크기, 조작 영역 검사. 52장 캡처와 검색/필터·저장 실패 보존·dirty 경고·저장 복원·승인 확인 등 시안 동작 검사.
- 외부 HTTP 요청을 차단하고 요청 시 검증 실패 처리. 실제 앱·API·BLE·LiveKit·메일·DB 동작의 검증이 아니다. 제품 빌드·단위테스트는 제품 코드 미변경이므로 실행하지 않았다.
- 독립 검토: 문서의 비host 편집이력 제외 단정을 정정했다. 실제 노출 여부를 단정하지 않고, 권한과 응답 스키마까지 확인하는 구현 전 검증 항목으로 추가했다. 참여자 오연결·부분 실패 소실·공개 코멘트 저장 소실도 시안에서 보완했다.
- 캡처 스크립트 초기 실행에서 브라우저 전역 이름 `top` 충돌을 발견해 `pageHeading`으로 수정했다. 빈 화면을 통과하지 않도록 본문 존재·화면 선택값 검증을 추가하고 전체 캡처를 다시 생성했다.

회차 요약 중심·생체신호 6지표 요약·선택 기록 안내 방향은 10/23 결정됨. 자동 승인 C안·기본 0분·옵션 0/5/10/30분도 10/23 결정됨. 제품 구현 전 별도 plan/verify가 필요하며 SDD 완료 상태가 아니다.

### 10/23 추가 독립 검토 반영

- 착용 사례와 참여자 결과의 측정 상태, 분석 중 리포트 열기 제한, 상담 기록 이동 맥락을 맞췄다.
- 정책 적용 시점은 ‘이후 시작하는 회차’로 통일했다. 분모가 확정되지 않은 측정 비율 숫자는 제거하고, 개인 서사 미리보기의 범위를 spec에 명시했다.
- 이전 검토에서 보완한 착용 사례 연결·분석 중 열기 차단·한 번 안내·설정 확인을 유지한다. 이번 최종 재실행: 52장 캡처, 21화면 × 2폭 DOM 검사 통과. 페이지 오류·외부 HTTP 요청 0건. 착용 사례 연결·분석 중 열기 차단·한 번 안내·설정 확인도 검사했다.

### 10/23 생체신호 정정 검증

- `capture.cjs`: 21화면 × 390/1440, 펼침 표 캡처 포함 총 52장. 가로 넘침 0, 최소 글자 13px, 조작 44px 이상. 페이지 오류·외부 HTTP 요청 0.
- 6지표 카드 수, 참여자 4행/6지표+품질 열, PPG만 결측 3칸, 분석 중·미착용 결측 6칸, 개인 스파크라인 6개와 직전 회차 비교를 검사한다. 일부 착용 합성 평균·범위·Δ는 참여자 행과 대조한다.
- Chrome 캡처를 직접 열어 클래스·모바일 펼침 표·1:1 배치를 확인한다. 제품 코드·실제 API·기기·서버·DB 검증은 수행하지 않는다.
- 10/23 추가 결정: 클래스 평균은 2명 이상, 1명은 참여자별 결과로 안내. C안·기본 0분을 채택했다. 정규화·유효 시간·분모 계산은 후속 기술 설계 사항이다.
- 독립 검토에서 발견한 신호 부족 상태의 호흡 변화 서사와 분석 중/미착용 상태의 고정 ‘24분’ 설명을 수정했다. 별도 검증자가 지정 Chrome 390px에서 3종 상태를 다시 열어 결측·문구·가로 넘침·페이지 오류·외부 요청을 확인했고 모두 통과했다.

### 10/23 카드 배치·자동 승인 확정 검증

- 21화면 × 390/1440, 파생 상태 포함 52장 재캡처. 카드 6장 1열·내부 통계 1줄/2줄을 실제 좌표로 검사한다.
- 측정 1명 및 연결 유실 상태의 평균·범위 비노출, 0분 보류 버튼 없음, 영역별 0/5/10/30 옵션, 끄기 시 유예 비활성, 10분 선택 확인 모달, 안내 끄기 후 재진입을 검증한다.
- 독립 검토에서 진행 기록 화면의 과거 ‘비공개 메모를 AI 초안에 참고’ 문구를 발견해 제외 정책으로 통일했다. 측정 1명 화면에서 참여자 결과·개인 리포트로 이동할 때도 측정 인원과 미측정 상태가 유지되도록 보완하고 검증했다.
