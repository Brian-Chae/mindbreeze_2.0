# 현장 참여 안내문 v2 — A4 단면 A안

2026년 11월 4일 대구 명상 클래스 첫 회 인쇄 배포용 시안. 제품 동작이나 배포 상태를 검증하는 자료는 아니다.

## 재생성

```sh
node specs/sdd-254-field-qr-beta-distribution/flyer/build.mjs [vars.json 경로] [출력폴더]
```

인자 생략 시 같은 폴더의 vars.json과 `~/.hermes/share/mb-sdd254-flyer/v2/`를 사용한다.
기존 JSON → HTML → Chrome headless PDF 파이프라인을 유지한다. Google Chrome, Node.js, frontend의 qrcode 의존성, Poppler(pdfinfo·pdftoppm)가 필요하다. CHROME 환경변수로 브라우저 경로를 바꿀 수 있다. 폰트는 macOS Apple SD Gothic Neo와 Menlo 기준으로 검증했다.

- 결과: `flyer.html`, `mindbreeze-flyer.pdf`, `mindbreeze-flyer-preview-1.png`(150dpi), QR PNG·SVG.
- PDF가 1페이지를 넘으면 빌드를 실패시킨다. 긴 변수를 넣은 경우 PNG를 다시 확인한다.
- 인쇄: A4 세로, 실제 크기(100%), 단면. 이미지 포함 QR 박스는 46mm이며 QR 여백은 4모듈이다.
- QR 생성: 기존 `scripts/make-beta-qr.mjs`, 오류정정 Q, 목적지 `https://mindbreeze.looxidlabs.com/beta`.

## 인쇄 전 채울 변수

| 키 | 의미 | 현재 기본값 |
|---|---|---|
| class_name | 클래스명 | 대구 명상 클래스 |
| date | 날짜·시간 | 2026.11.4 (시간 추가 필요) |
| place | 구체적 장소 | 대구 (상세 장소 추가 필요) |
| counselor_code | 6자리 영숫자 코드 | XXXXXX (실제 코드로 교체) |
| contact | 문의처 | 문의처 (현장 안내 담당자) (실제 연락처로 교체) |

값은 HTML 이스케이프된다. 상담사 코드는 Menlo 고정폭과 slashed-zero 설정으로 0/O를 구분한다.

## 디자인

브랜드 #5F0080과 저장소 `frontend/public/landing-v6/nature.webp`를 사용했다. 자연 이미지는 외부 요청 없이 HTML에 내장한다. 제목은 텍스트로 표기한다. 서비스의 명상 중 흐름 → 리포트 → 4회차 변화와, 실제 참여 1~4단계를 나누었다. 본문 11pt 이상, 개인정보 주소 10.5pt. 색상 외에도 번호·굵기·구분선으로 흑백 인쇄 시 위계를 유지한다. 양면 B안은 이번 산출물에 포함하지 않는다.

## v2 검증 증거

출력 폴더의 `layout-check.json`, `qr-check.json`, `code-glyph-check.png`, `mindbreeze-flyer-gray-1.png` 참조. QR은 원본뿐 아니라 최종 PDF를 렌더링한 컬러·흑백 PNG에서 OpenCV로 디코딩했다. 직접 인쇄 및 실기기 카메라 스캔은 미실시. `intermediate/first-pass-page-2.png`는 초기 조정 과정의 중간 산출물이며 최종 인쇄 대상이 아니다.
