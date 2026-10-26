# SDD-234 C — 리포트 모바일 가독성 결과

## 범위와 결정

- 워크트리 `mindbreeze_2.0-sdd234-c-report`, 브랜치 `sdd/234-c-report`. 승인된 plan C만 구현했다.
- 767px 이하의 글자·행간·여백·터치 스타일만 변경. 기존 클래스는 보존하고 `mobile:` 토큰 또는 `@media screen and (max-width:767px)`로 제한했다.
- 서사와 안내 본문 16/26, 목록 요약 15/24, 카드·모달 제목 18/27, 화면 제목 22/30, 메타13/20, 조작 라벨14/20. 카드 내부16px, 서사 섹션24px.
- 일반 버튼/링크44px, 입력·승인/저장 등 주요 CTA48px. 승인 스위치는 44px 터치박스 안에 기존24px 트랙을 유지한다.
- 문구·상태·API·라우팅·점수 추가 없음. 인쇄 CSS, 공통 토큰·셸, 클래스 내부 리포트 탭은 수정하지 않았다. 제품 TSX23개는 className과 mobile 스타일 토큰을 제외한 소스가 시작 커밋과 동일함을 독립 AST 검사했다.
- 기록 판단: 실행 기록은 공통 plan/verify/summary를 수정하지 않고 이 영역 보고서에 남긴다. 다른 영역의 완료 상태를 덮어쓰지 않기 위함이다.

## 390px 전후 실측

`before`는 공통 개선 이전이다. C 단독 효과는 공통 단계 `after`와도 함께 비교했다. 상담사 목록의 30→28 텍스트 노드 차이는 이미 반영된 PR #55 중복 토글 제거이며 이번 변경은 스타일뿐이다.

| 화면 | 최소 글자(px) | 작은 글자 ≤12px before→C | 공통 after→C | 높이<44 before→C | 공통 after→C | 폭<44 before→C |
|---|---:|---:|---:|---:|---:|---:|
| 회원 목록 | 12 → 13 | 13 → 0 | 7 → 0 | 7 → 0 | 2 → 0 | 2 → 0 |
| 상담사 목록 | 12 → 13 | 13 → 0 | 7 → 0 | 16 → 0 | 9 → 0 | 2 → 0 |
| 회원 상세 모달 | 11 → 13 | 29 → 0 | 29 → 0 | 5 → 0 | 5 → 0 | 0 → 0 |
| 상담사 상세 | 11 → 13 | 43 → 0 | 37 → 0 | 7 → 0 | 4 → 0 | 2 → 0 |

- 네 화면 모두 작은 글자·작은 터치·좁은 터치0, document 가로 넘침0. 서사 실제16/26, 양쪽 검색16/26·높이48.
- 네이티브 select의 computed line-height는 Chrome에서 `normal`; 실제 font-size16/높이48을 확인했다. 검색 input의 행간26과 구분한다.
- 768/1440 여덟 화면은 before의 texts/touches/spacing 공통 필드(글자·행간·굵기·폰트·위치·폭·높이·패딩·마진·gap)8,063개가 모두 동일하다. 원시 JSON은 보존한다. class 문자열은 의도적으로 추가됐으며, before에 없던 tag/inputType 메타와 PR #55로 바뀐 DOM selector/조상 text는 스타일 비교 대상에서 제외한다.
- 회원 목록·상세 상단/하단, 상담사 목록 및 실제 EEG가 있는 긴 서사 모달 캡처를 눈으로 확인했다. 제목·본문·다운로드·닫기 잘림 없음.

## 테스트와 재현

- 신규 `frontend/tests/sdd234-c-mobile.test.tsx`: 실제 Chrome+생성 Tailwind CSS로 390/767px 긴 한글·URL·EEG 미측정, 글자/행간/44px 터치, 390px 글자200% 확대와 마지막 PDF 동작 접근을 검증한다.
- RED: 구현 전 두 모바일 테스트가 글자11/12px, 서사15/30 또는16/32, 작은 링크로 실패. GREEN: 세 테스트 통과.
- 관련 vitest **10파일 96개 통과**, 기존 PDF 브라우저 테스트 **2파일 4개 통과**(합계100). 최종 실행 결과는 `checks/area-c-tests.log` 참조.
- 초기 관련 실행: 서버 미기동으로 PDF4개 ECONNREFUSED. 빈 envDir 로컬 Vite를 기동한 뒤에도 기존 테스트의 단일 dep 해시와 Vite8 모듈별 해시 불일치로 504가 재현됐다. 단순 redirect는 ESM URL 캐시로 Router context를 분리했다. C 전용 실행기는 기존 합성 HTML의 import URL만 현재 해시로 정규화한다. 기존 테스트 코드/assertion/skip은 변경하지 않는다.
- `npx tsc --noEmit -p tsconfig.app.json`, 변경 TSX+신규 테스트 eslint 통과. `npm run build`는 빈 envDir wrapper로 실행; 기존 chunk 크기·동적/정적 import 경고는 남는다.
- 전체 vitest는 실행하지 않았다. 관련 테스트와 실제 Chrome 검증 범위를 보고한다.

```bash
node specs/sdd-234-mobile-type-polish/test-c.cjs
node specs/sdd-234-mobile-type-polish/build-c.cjs
node specs/sdd-234-mobile-type-polish/measure.cjs --area=C --phase=after-c --widths=390,768,1440
node specs/sdd-234-mobile-type-polish/check-c.cjs
```

기존 after-c 재실행 시에만 `--overwrite`를 추가한다. 모든 실행기는 빈 envDir/합성 API를 사용하며 서비스 서버·DB·.env에 접근하지 않는다. PDF 테스트의 승인·메일 요청도 전부 합성 route.fulfill이며 실제 발송은 없다.

## 잔여 후보와 공통 요청

- 글자/터치/가로 넘침 잔여 후보 없음(측정4화면 기준).
- 간격 원시 후보는 목록2개·상담사 상세의 `.floating-bottom-nav.md\:hidden` padding6px 각1개. 기존 공통 내비게이션의 의도된 여백이며 C 소유 밖이다. 요청값 없음, 변경 요청하지 않는다. 회원 모달 간격 후보0.
- 실기기/iOS 키보드/BLE/LiveKit/실서비스 API·실제 메일·실제 서버 PDF는 검증 범위 밖. 200% 검증은 Chrome DOM 텍스트 확대이며 OS 접근성 확대와 구별한다.
- 독립 검토자가 diff/JSON을 확인했다. 입력 토큰 중복과 페이지네이션/샘플 링크 라벨 지적을 수정했고, 재검토에서 차단 사항 없음.
- C 영역만 완료이며 SDD-234 전체 완료나 배포 완료를 의미하지 않는다.

## 변경 파일과 커밋

- `pages/reports/`: ReportListPage, ReportDetailPage, ReportDetailModal, ReportSamplePage, ReportViewPage.
- `pages/client/`: ClientReportListPage, ClientReportDetailModal.
- `components/reports/`: BulkApproveModal, ClientReportViewer, CounselorCommentCard, DataExportButton, EegMetricsGrid, EegQualityBanner, EegTimeline, GenerationStatusBadge, NarrativeSections, ReportCoverSection, ReportDetailView, ReportStatusBadge, SubjectiveCheckinCard, TranscriptTimeline, VideoPlayer, narrative-sections.css.
- `components/legal/wellness-notice.tsx`.
- 신규 C 테스트, 이 보고서, test-c/build-c/check-c 실행기와 after-c 측정·검증 증거.
- `d46ac23b` — 리포트 모바일 글자와 터치 간격 개선. 후속 증거·최종 보완 커밋은 git log 참조.
- node_modules 심링크는 커밋하지 않으며 최종 검사 후 요청대로 제거한다. PR/머지/develop 푸시/배포 없음.
