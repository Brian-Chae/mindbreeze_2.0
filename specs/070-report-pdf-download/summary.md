# SDD-070 구현 결과

서버가 승인된 리포트의 서사를 PDF로 생성하고, 상담사 상세 화면과 메일 열람 화면에서 파일로 다운로드하도록 변경했다. 브라우저 인쇄 iframe과 `window.print()` 호출은 다운로드 흐름에서 제거했다.

## 구현

- `GET /api/v1/reports/{report_id}/pdf`: counselor 역할 + 기존 `require_report_host` 검증 + `completed` 상태 필요. 미승인은 409.
- `GET /api/v1/reports/view/pdf?token=...`: 기존 `get_report_view_content`를 재사용하므로 토큰 유형/만료, 세션, 리포트 상태/유형, 현재 수신 이메일을 동일하게 검사한다. 정적 경로를 동적 경로 앞에 배치했다.
- PDF 응답: `application/pdf`, attachment, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `nosniff`.
- `report_pdf_service.py`: 보라/그린/크림 팔레트, 1페이지 명상 여정+종합 여정, 2페이지 몸, 3페이지 마음, 4페이지 마무리. 머리글/꼬리글/페이지 번호 포함. `content.eeg.narrative`의 텍스트를 사용하며 EEG 상세 수치와 상담사 메모는 제외한다. 데이터가 없으면 비교 불가 안내를 사용한다.
- Noto Sans KR 원본 TTF와 OFL 라이선스를 `backend/app/assets/fonts/`에 동봉했다. Regular/Bold 한글 글리프의 PDF subset 임베딩을 확인했다.
- HTML 문자열 escape + URL fetcher의 번들 폰트 1개만 허용으로 외부 네트워크/임의 로컬 파일 읽기를 차단했다.
- 원문이 길면 3단계 크기로 렌더링하고, 4페이지를 넘으면 422로 명시적으로 거절한다. 원문을 자르거나 숨기지 않는다. 한 서사 필드 12,000자 초과도 거절한다.
- FE 공용 API 클라이언트에 blob 응답을 추가해 기존 인증 refresh를 재사용한다. 메일 토큰 요청은 로그인 토큰을 보내지 않는다. 로딩/오류/재시도와 blob URL 해제를 처리했다. 상담사용 버튼은 승인된 리포트에 표시한다.
- 배포 workflow에 Cairo/Pango/Harfbuzz/글꼴 설치와 WeasyPrint import·번들 글꼴 존재 검사를 추가했다. requirements 설치 실패를 숨기던 `|| true`도 제거해 PDF 의존성 설치 실패가 배포 성공으로 표시되지 않게 했다.

## 검증

- RED: 신규 BE 7개가 미구현 API/서비스로 실패, FE 2개가 다운로드 버튼 부재로 실패함을 확인한 뒤 구현.
- BE 집중 테스트: **10 passed**. 인증/host/역할/승인, 토큰 만료/유형/세션/수신자 변경, 실제 PDF 4페이지/한글/임베딩/머리글/꼬리글, escape/외부 리소스 차단, 과도한 원문/폰트 누락 처리.
- BE 전체: **464 passed, 1 skipped, 20 warnings** (40.70초). 기존 deprecation 경고와 WeasyPrint 68의 URL fetcher dict 반환 deprecation 경고 포함.
- FE `npm run build`: **exit 0**, TypeScript 오류 없음. 기존 design-system CSS 경로와 큰 번들 경고는 남아 있다.
- Chrome Playwright: **4 passed**. 두 화면의 1280px/390px 다운로드, 로딩 비활성화, 오류 후 재시도, 메일 요청의 인증 헤더 미전송, blob URL 해제, 승인 전 버튼 미노출/승인 후 다운로드, 기존 메일 발송 동작. 모달은 1280px/390px/320px도 확인.
- `pdffonts`: NotoSansKR/NotoSansKR-Bold 모두 `emb yes`, `sub yes`, `uni yes`.
- 아래 4페이지 PNG를 직접 열어 한글, 정렬, 여백, 머리글·꼬리글·번호를 확인했다.
- `git diff --check`: 통과.

## 증거 및 재현

- [샘플 PDF](evidence/sdd-070-report.pdf)
- [1페이지](evidence/sdd-070-1.png), [2페이지](evidence/sdd-070-2.png), [3페이지](evidence/sdd-070-3.png), [4페이지](evidence/sdd-070-4.png)
- 샘플은 검증용 가상 텍스트와 이름을 사용했으며 실제 내담자 정보가 아니다.

```sh
cd backend
# macOS: Homebrew Pango/Cairo 설치 후 실행. 공백 경로 venv/bin/pytest의 /bin/sh 래퍼가 DYLD 변수를 지우므로 python 모듈 실행을 사용했다.
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib venv/bin/python -m pytest -q
cd ../frontend
npm run build
# 별도 터미널에서 npm run dev -- --host 127.0.0.1 --port 5177 --strictPort
NODE_PATH=/tmp/sdd046-browser/node_modules REPORT_TEST_BASE_URL=http://127.0.0.1:5177 node --test tests/report-server-pdf.test.cjs tests/report-modal-pdf.test.cjs
```

WeasyPrint 시스템 의존성과 macOS 라이브러리 검색 경로는 [공식 설치 안내](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)를 확인했다. 로컬 환경에는 검증용 Pango/Cairo/Poppler와 Python PDF 도구를 설치했다.

## 남은 확인

실제 EC2 배포와 운영 메일 링크의 다운로드는 실행하지 않았다. 배포 후 시스템 패키지 설치 권한 및 실제 로그인/메일 링크에서 다운로드되는지 확인하면 된다. 최종 사용자 리뷰와 Linear 업데이트는 코디네이터 소관이며, 커밋/푸시는 하지 않았다.

## 서버 PDF 내용 보완 (2026-09-16)

### 변경
- `report_pdf_narrative.py`: 웹의 지표 문구/정의/방향 해석과 1·3·5 단위 임계, 5% 상대 변화 임계, JS Math.round 동작을 이식했다.
- `narrative.changes → eeg.changes → timeline` 우선순위, 6지표 모두 필요, 전후 반 분할 후 결측 제외, 0~1 스케일 변환, sdnn/hrv 대체, 스트레스 역방향 근사를 유지했다. 종합 metrics 점수를 변화량으로 사용하지 않는다.
- `report_pdf_service.py`: 몸/마음 카드 각각 3개(변화량, 방향, 설명, 정의, 해석, 비교 캡션), 실제 시계열 SVG, 여정 chips, 처음/중간/마지막 시간 및 커버 비교 구간을 추가했다.
- 그래프는 웹과 동일한 지표 범위를 사용하고 결측을 연결하지 않는다. 데이터가 부족하면 카드를 꾸미거나 가짜 그래프를 생성하지 않는다.
- 저장 서사는 웹의 용어 변환을 적용하며, 규칙 여정·마무리를 폴백으로 사용한다. 기존 권한/토큰/외부 리소스 차단/4페이지 초과 422 계약은 유지했다.

### 검증
- RED: 신규 8개 테스트 실패를 먼저 확인한 뒤 구현했다.
- 최초 대상 검증: 18 passed (기존 PDF 10개 + 신규 8개).
- 추가 우선순위/결측/실제 PDF 회귀를 포함한 전체 BE: **475 passed, 1 skipped**, 21 warnings, 37.69초.
- macOS 공백 경로의 pytest 셸 래퍼가 DYLD 변수를 제거하므로 실제 PDF 테스트는 `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib venv/bin/python -m pytest -q`로 실행했다. skip 없이 PDF 테스트가 실행되었으며 1개 skip은 다른 기존 테스트다.
- FE `npm run build`: exit 0, 타입 오류 0. 기존 tokens.css import 경고 및 청크 크기 경고는 남아 있다.
- 실제 FE narrative/resolve-narrative 함수를 TypeScript transpile 후 실행하고 Python과 비교: 10개 경계 입력, 60개 카드의 모든 필드 및 여정/마무리 문장 일치.
- `evidence/sdd-070-metrics.pdf`: 4페이지, 한글 NotoSansKR 및 6개 지표 수치 텍스트 확인. 대응 PNG 4장을 직접 확인해 겹침·잘림 없음.
- 샘플은 검증용 합성 측정값임을 참여자명에 명시했다. 실제 이용자 데이터나 배포 환경은 변경하지 않았다.

### 남은 경계
웹과 동일하게 6개 변화량 중 하나라도 없으면 지표 카드 전체가 생략된다. 장문 서사와 카드가 4페이지에 들어가지 않으면 기존 정책대로 422를 반환하며 원문을 자르지 않는다. 배포·커밋은 수행하지 않았다.
