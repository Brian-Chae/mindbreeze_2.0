# SDD-243 데이터 센터 디자인 시안

- 상태: Spec·디자인 검토용. 제품 코드·API 구현 아님.
- `index.html`을 브라우저에서 직접 연다. HTML 하나에 CSS·JS·로고·한국어 폰트를 내장했다. 외부 CDN·서버·API 요청 없음.
- 모든 사용자·기관·이메일·날짜·수치는 합성. 이메일은 `example.invalid`, 전화는 비실사용 예시다.
- 기획 원본: `../../specs/sdd-243-platform-data-center/spec.md`.

## 화면과 조작

- 기존 6탭: 개요 / 사용자 데이터 / 측정 데이터 / 동의·연구 / 보관·삭제 / 표준 데이터. 다운로드 작업·다운로드 기록 2탭 추가.
- 하위 화면: 일반 동의·연구 동의·연구 배치, 보관 실행·삭제 후보·계정 삭제, 표준 모델·기준 측정.
- 검색·상태 필터·기관/유형 그룹핑·행 상세 선택. 이름·이메일은 노출, 연락처·생일은 기본 마스킹. 개별 열람 후 대상·탭·필터 변경 또는 모바일 상세 닫기로 재마스킹.
- 검색어에 `검색결과없음`을 입력하면 빈 상태. `필터 초기화`로 복귀.
- 390px에서는 표 내부만 가로 스크롤, 행 선택 시 아래 상세 패널로 이동. 페이지 자체 가로 넘침 없음.
- `?tab=users`, `?tab=research` 등 초기 탭 선택 가능.
- 표의 ‘신규 API 필요’는 미구현 조회 계약을 뜻한다. 표준 모델 조회는 기존 API 재사용 후보다.
- 기간·기관·역할별 서버 필터, cursor 페이지네이션, 로딩/권한오류/실데이터 연결은 후속 구현 범위. 시안은 검색·상태·그룹과 대표 합성 행으로 화면 패턴을 검토한다.

## 디자인 근거

`design-system/handoff/mind-breeze-design-system/project/SKILL.md`와 README의 보라·크림·흰 패널·한국어 UI 원칙 적용. 요청한 #5B1A8A 사용. 저장소 로고 SVG를 data URI로 내장했다. Pretendard를 우선하고 미설치 시 저장소 `backend/app/assets/fonts/NotoSansKR.ttf`에서 사용 글자만 추출한 WOFF2를 내장해 네트워크 없이 한국어를 렌더링한다. 외부 아이콘 대체 없음.

## 재현과 검증

```sh
node designs/platform-data-center/capture.mjs
```

로컬 frontend의 Playwright를 사용하고, 미설치 시 기존 메인 체크아웃의 Playwright 설치본을 읽는다. Chrome headless로 `file://` HTML만 열며 HTTP(S)는 차단한다. 패키지 설치·제품 서버 실행·DB 접속 없음.

2026-10-24 최종 실행: Chrome **155.0.8059.85**, 1440×1000 / 390×844 뷰포트, full-page PNG **26장**. 긴 목록은 세로 전체 캡처이므로 PNG 높이는 뷰포트보다 길다.

- 페이지 가로 넘침 0, 검사 대상 구성요소 겹침 0, 텍스트 잘림 0, 브라우저 오류·외부 요청 0.
- 상호작용 **23/23 통과**: 기존 개인정보·필터·모바일 9개와 측정 메타 기본/열람, 원파형 확대/선택/이동, PPG/ACC 없음, 필수입력 차단, Parquet 작업 생성, 작업 만료, 감사 표, 다중선택, 비회원 연구 차단, 미착용 반출 차단 14개.
- 이번 개정에서 새 상세·모달·작업·감사·PPG 안내·일괄·차단·미착용 PNG를 직접 열어 시각 확인했다. 기존 6탭·하위 화면·390 목록/상세도 재캡처하고 자동 레이아웃 회귀 점검했다. 모바일 표의 나머지 열은 안내된 내부 가로 스크롤로 조회하는 의도된 동작이다.
- 자동 측정 원본: `capture-results.json`. 재현 스크립트: `capture.mjs`.
- 별도 검토자가 raw 저장·기존 export·Spec/시안을 읽기 전용 검토했다. 가명 상대시간/지표 시각, 요청부터24시간, 성별·생년월 개별 열람, API 표 연결을 수정했다.
- 제품 빌드·단위 테스트·실 API·권한/DB·실기기 검증은 수행하지 않았다. 이번 결과는 **합성 HTML의 화면·상호작용 검증**이다.

## 캡처 목록

| 파일 | 화면 |
|---|---|
| `captures/1440-overview.png` | 개요·데이터 보유 지도 |
| `captures/1440-users.png` | 사용자·비회원·상담사·기관관리자 목록과 마스킹 |
| `captures/1440-measurements.png` | 측정·파생 데이터·밴드 미사용 |
| `captures/1440-research.png` | 일반 동의 |
| `captures/1440-research-consents.png` | 연구 동의·버전·철회 |
| `captures/1440-research-batches.png` | 연구 배치·수신 확인 |
| `captures/1440-retention.png` | 보관 사전점검 실행 기록 |
| `captures/1440-retention-candidates.png` | 보관 기한 임박·EEG 보류 |
| `captures/1440-retention-deletion.png` | 탈퇴 원장·공개 접수 구분 |
| `captures/1440-standards.png` | 표준 모델 이력 |
| `captures/1440-standards-baselines.png` | 개인정보 제외 기준 측정 |
| `captures/1440-users-revealed.png` | 합성 개인정보 개별 열람 |
| `captures/1440-users-grouped.png` | 기관별 그룹핑 |
| `captures/1440-empty.png` | 검색 결과 없음 |
| `captures/390-users.png` | 모바일 조회 목록 |
| `captures/390-users-detail.png` | 모바일 상세 패널 |

## 10/24 다운로드 중심 개정

- 상세 직접 진입: `?tab=detail`. Fp1/Fp2는 10.3Hz·6.1Hz·22.7Hz·37.1Hz 성분과 느린 진폭 변화로 만든 합성 파형이다. 측정 상세에서 확대/이동/구간 선택·PPG/ACC 미저장 탭·6대 지표를 확인한다.
- 모달: `?tab=measurements&modal=download`. 범위·CSV/Parquet·식별 수준·목적·사유·재인증 상태 시연. 사유/재인증 필수, 비회원 포함 연구 목적 및 식별 연구 반출 차단.
- 작업: `?tab=downloads`, 감사: `?tab=audit`. 요청부터24시간·URL60초 권장안. 생성은 브라우저 메모리 합성 항목만 추가한다. 실제 파일·인증·URL·영속 감사는 구현하지 않았으며 감사 표는 고정 예시다.
- 실제 제품의 서버 필터 스냅샷·동의/보관 재평가·PSD 계산·디코딩·가명화·스트리밍 ZIP은 Spec 계약이다. HTML 대역/PSD·지표는 계산 결과가 아닌 합성 그림이며 선택 구간별 재계산은 하지 않는다. 작업/감사의 검색·필터는 화면 배치용이다.
- 기존 제품은 EEG bin·지표를 보관하지만 PPG/ACC raw는 없다. CSV `timestamp,fp1,fp2`는 제조사 표준 확인본이 아닌 신규 제안이다. raw 포맷·성능 산술은 2프레임 합성 LE float32 디코딩으로 별도 확인했으며 제품 디코더 테스트는 아니다.

| 추가 캡처 | 화면 |
|---|---|
| `captures/1440-measurement-detail.png` | EEG·대역/스펙트럼·6대 지표·메타 |
| `captures/1440-detail-ppg.png`, `1440-detail-acc.png` | 원파형 미저장 |
| `captures/1440-download-dialog.png` | 단건 다운로드 대화상자 |
| `captures/1440-download-bulk.png` | 다중 선택 일괄 다운로드 |
| `captures/1440-download-blocked.png` | 비회원 포함 연구 다운로드 차단 |
| `captures/1440-download-jobs.png` | 진행·완료·만료 작업 |
| `captures/1440-download-created.png` | 합성 Parquet 작업 생성 |
| `captures/1440-download-audit.png` | 누가·언제·무엇·사유·결과 |
| `captures/1440-detail-unworn.png` | 미착용 데이터 없음 |
