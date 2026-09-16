# SDD-063 구현 결과

## 결과

기관·상담사·명상가를 위한 전환 목적의 랜딩 개편을 완료했다. 보라색 #5F0080과 따뜻한 중립색을 유지하면서 내비게이션, 히어로, 대상별 가치, LINK BAND, 서사형 리포트, 서비스 흐름, FAQ, 가입 CTA를 구성했다.

- 상단 행동은 `클래스 바로 참여 → /join`, `로그인 → /login`, `회원가입 → /register` 3개다.
- 메뉴는 서비스 / LINK BAND / 리포트 / 고객센터이며 각 섹션으로 실제 이동한다.
- 모바일·태블릿 메뉴는 햄버거로 열리고 행동 버튼은 세로 배열한다. Escape 닫기, 선택 후 닫기, 버튼 포커스 복원을 지원한다.
- 기관 운영·상담 기록·명상 변화 피드백의 문제와 해결을 각각 설명한다.
- 기존 `ReportSampleModal → SampleReportContent → NarrativeSections`를 그대로 활용해 로그인 없이 예시 리포트를 연다. 실제 리포트와 샘플 데이터는 수정하지 않았다.
- FAQ는 native details, 문의는 실제 mailto, 시작 행동은 가입 경로로 연결했다.
- 새 랜딩 스타일은 Tailwind만 사용한다. 기존 리포트의 CSS·인라인 구현은 변경하지 않았다. 사용하지 않는 기존 `landing/Hero.tsx`는 범위 밖이다.

## 구현 전 승인

`plan.md`, `verify.md`를 코드 수정 전에 작성하고 orchestration ask로 승인받았다. coordinator 응답은 “승인합니다. 진행하세요”이며 디자인 방향, 대상별 가치, LINK BAND, NarrativeSections 지연 로딩, FAQ, 5회 루프를 명시적으로 승인했다.

## 5회 개선 및 검증

1. **메뉴·히어로:** 상단 3개 링크와 4개 메뉴, 모바일 메뉴, 이미지 최적화. 실제 브라우저에서 기존 ‘클래스 바로 참여’ 링크 부재를 RED로 확인한 후 구현했다. build 성공, 390/1440px 캡처·가로 넘침 없음.
2. **대상별 가치·흐름:** 기관/상담사/명상가의 문제→해결 카드와 4단계 서비스 흐름. 이전 질환·효과 단정 문구를 제거했다. build 성공, 390/1440px 캡처·가로 넘침 없음.
3. **LINK BAND:** 공식 제품/개발자 페이지를 Orca 브라우저에서 확인하고 센서·제품 사양을 반영했다. build 성공, 390/1440px 캡처·가로 넘침 없음.
4. **리포트·고객센터:** 예시 카드와 기존 서사형 리포트 모달, FAQ, 문의, CTA. build 성공, 390/1440px 시각 확인 및 모달 열기/Escape/포커스 복원 통과.
5. **최종 접근성·성능:** CTA 제목 대비, 한국어 lang, 확대 허용, 본문 건너뛰기, 페이지별 JS 지연 로딩과 로딩 실패 안내. build 성공, 실제 production preview에서 360/390/768/1024/1440px 전체 검증 통과.

각 루프 빌드 로그와 390/1440px 화면은 [evidence/](./evidence/)에 있다. 최종 [데스크톱 화면](./evidence/loop5-1440.webp), [모바일 화면](./evidence/loop5-390.webp), [모바일 리포트](./evidence/loop5-report-390.png), [자동 검증 결과](./evidence/verification.json)를 함께 저장했다.

## 성능

- 기존 히어로 PNG 약 6.9MB 대신 480px WebP 10.6KB / 800px WebP 24.9KB를 제공한다.
- 제품 이미지는 600px WebP 9.2KB / 1200px WebP 44.0KB를 제공한다. 모든 랜딩 이미지에 명시적 크기, lazy loading, async decoding을 적용했다.
- 초기 JS는 루프 1의 **2,081.58KB → 최종 277.77KB**로 약 86.7% 감소했다. gzip **553.35KB → 88.62KB**.
- 이를 위해 `App.tsx`의 랜딩 외 페이지를 React.lazy로 분리했다. 경로·권한 처리·페이지 구현은 유지한다.
- production 네트워크 검증에서 초기 JS는 index 1개이며 ReportSample/NarrativeSections/SessionLive/Recharts 청크는 최초 랜딩에서 요청되지 않았다.
- 기존 실시간 세션 청크 615.75KB의 Vite 크기 경고는 남아 있으나 랜딩 초기 다운로드 대상은 아니다. 실제 운영 네트워크의 LCP/전환율 측정은 하지 않았다.

## 검증

- `npm run build`: 5회 루프 모두 exit 0, TypeScript 오류 0.
- 변경 TSX 대상 ESLint: exit 0.
- `git diff --check`: 통과.
- Chromium production 검증: **5개 viewport PASS, runtime error 0**.
- 각 viewport에서 메뉴 4개 스크롤 위치, 상단 3개 링크와 실제 경로 이동, FAQ 열기/닫기, 리포트 예시 표시, 내부 탐색/스크롤, Escape·닫기 버튼, 포커스 복원, 가로 넘침을 확인했다.
- 리포트 청크 다운로드 강제 실패 시 안내 표시·닫기 및 랜딩 유지도 확인했다.
- `frontend/scripts/verify-landing.cjs`에 재실행 가능한 검증을 저장했다. Playwright와 Chrome이 필요하며 repo 의존성은 추가하지 않았다.

```bash
cd frontend
npm run build
npm run preview -- --host 127.0.0.1 --port 4176
# 별도 터미널; PLAYWRIGHT_MODULE은 설치된 playwright 경로로 지정 가능
PLAYWRIGHT_MODULE=/tmp/sdd046-browser/node_modules/playwright \
LANDING_URL=http://127.0.0.1:4176 node scripts/verify-landing.cjs
```

## 제품 정보 근거 및 한계

- [LINK BAND 공식 제품](https://linkband.looxidlabs.com/ko): 2채널, 약 50g, EEG/PPG/ACC를 확인했다.
- [공식 개발자 안내](https://linkband.looxidlabs.com/ko/developers): EEG 250Hz·2채널을 확인했다.
- ‘30종 지표’는 현재 공식 페이지에서 확인되지 않아 사용하지 않았다. 추가 근거가 제공되면 반영 가능하다.
- 단순 지표 변화가 진단·치료 효과임을 암시하지 않는다. LINK BAND 미착용 사용 가능과 실제 측정 데이터가 있어야 생체신호 리포트가 제공됨을 안내한다.
- 로그인 후 실제 세션·BLE 기기·백엔드 연동 전반은 이번 랜딩 검증 범위 밖이다. 페이지 분리는 모든 페이지 build 검증과 주요 공개 경로 브라우저 이동을 확인했다.
- 배포·커밋 및 Linear 게시 없음. 외부 전달은 작업 지침에 따라 coordinator로만 수행한다. 기존 변경 `specs/.sdd-counter` 및 제공받은 spec은 보존했다.

최종 리뷰는 coordinator/Brian에게 인계한다. preview는 `http://127.0.0.1:4176/`에서 확인 가능하다.
