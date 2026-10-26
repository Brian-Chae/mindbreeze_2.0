# SDD-243 데이터 센터 디자인 시안

- 상태: **Spec + 합성 HTML 시안 개정**, 제품 구현·SDD 완료 아님.
- `index.html`을 파일로 직접 연다. CSS·JS·로고·한국어 폰트 내장, 외부 CDN/API 요청 없음.
- 모든 사용자·기관·회차·날짜·그래프·용량은 합성이다. 제품 코드·서버·DB·.env·실데이터·메일·삭제·배포는 이번 작업 범위가 아니다.
- 기준 문서: `../../specs/sdd-243-platform-data-center/spec.md`.

## 다운로드 흐름

- 기본 진입은 클래스 데이터: **클래스 목록 → 회차 표 → 참여자 표 → 1건 그래프**. 회차 표에 회차별/클래스 전체 다운로드, 참여자 표에 전체/선택 참여자 다운로드가 있다.
- 회원/상담사 단위: 118회차 합성 예시에서 1~50, 51~100, 101~118 묶음 선택 또는 날짜 범위 축소. 상담사는 시작·종료일 필수. 기간 변경 시 선택 초기화, 역전/0건/50회차 초과 요청 차단. 회원은 본인 데이터만 포함한다.
- 클래스 전체: 예상 용량·예상 ZIP 개수, 회차 폴더 및 독립 part 구조. 1GB=1,000,000,000 bytes, ZIP 안의 ZIP 없음. 실제 압축/분할은 구현하지 않았고 예상값은 합성이다.
- ZIP 미리보기: 루트 README·dictionary·manifest / class-가명 / session-회차_date-withheld / participant-가명 / eeg_raw.csv/parquet·ppg_raw.csv·acc_raw.csv·features.csv·indices.csv·meta.json·README_ko.md (미수집 파일은 제외사유 기록). 날짜는 기본 비공개, 정확한 날짜가 인가된 운영에서만 실제 날짜 경로를 제안한다.
- 사유·재인증 상태 시연 필수, 비회원 포함 연구/식별 포함 연구 차단, 미측정 제외 확인, 만료 작업 링크 비활성. 다운로드 작업은 브라우저 메모리에만 추가한다.
- EEG·대역/PSD·6대 지표 그래프 재사용. 확대/구간 선택/시간 이동 가능. PPG/ACC 원파형 미수집 안내와 “수집 후 합성 예시” 전환, 전체 feature 표를 추가했다. 실제 PSD 재계산·디코더·원본 ZIP 생성·인증·영속 감사·보관 정책 엔진은 구현하지 않았다.

## 10/24 생체신호·feature·화면 지표 확장

- 다운로드는 뇌파/맥파/움직임/feature/6대 지표를 각각 선택. 현재 PPG/ACC 미수집은 비활성, 수집 후 합성 예시에서 선택 가능. 모두 해제하면 요청 차단, EEG 해제 시 bin도 제외.
- features.csv는 정규화 전 전체 원천 컬럼. indices.csv는 집중도·이완도·감정균형도·BPM·호흡·HRV(SDNN) 화면 표시값과 모델/표시 버전. 과거 표시 이력이 없으면 null·동일성 미확인; 현재 모델 재계산을 당시값으로 오인시키지 않는다.
- PPG 50Hz red/ir(count), ACC 30Hz xyz(g) 수집 파이프라인과 표시 스냅샷 수집이 선행. 앱 내장 JS를 갱신하는 iOS/Android 빌드 필요, 이번에는 수행하지 않음. 저장 전 원파형은 소급 불가.
- 선행 수집과 데이터센터는 계약 확정 후 병렬 개발 가능하며 실제 제공 인수는 수집 완료 이후. 신규 API 제안은 데이터센터32 + 수집2 = 총34개.

## 기관관리자 보기

- 상단 역할 선택 또는 `?role=org_admin`. 기관명 **가상 마음연구소** 표시. ‘전체 메뉴’에서 상담사 관리 다음·리포트 이전의 데이터 센터 위치를 확인한다. 제품 제안 경로 `/org/data-center`.
- 공통 화면을 재사용하되 현재 기관 클래스·회차·참여자만 탐색. 최근 클래스 C01/C03, 과거 회차 C04가 자기 기관 예시이며 C02/C05는 타기관이라 제외된다. 과거 회차 예시는 최근 클래스 표와 구분했다.
- 동일 상담사가 여러 기관에서 진행한 과거118회차 중 기관 O01의59회차만 표시, 1~50/51~59 선택. 기관 회원 ZIP에는 P01만 포함한다.
- 기관 역할은 **운영 목적만**. 연구·표준 데이터·전역 보관 정리 탭 없음. 기관 식별 포함 옵션은 **허용 권장·Brian 결정 대기**라고 명시한 시연이며 제품 정책 확정이 아니다.
- 기관 작업/감사는 본인·현재기관만. 플랫폼 감사는 기관관리자 요청을 포함하지만 그 관리자의 파일 링크를 대신 제공하지 않는다.
- 역할 전환 시 선택·원문·그래프·모달을 초기화한다. 실제 서버에서 기관 범위를 강제해야 하며, 이 HTML의 필터/탭 숨김은 서버 인가 검증이 아니다.

## 직접 진입

- 기본/`?tab=measurements`: 클래스 탐색
- `?tab=member`, `?tab=facilitator`: 회원/상담사 단위
- `?tab=detail`: 그래프, `?tab=measurements&modal=download`: 참여자 다운로드
- `?tab=downloads`, `?tab=audit`: 본인 작업/감사
- `?role=org_admin`: 기관 클래스 탐색
- 기존 개요·사용자·동의/연구·보관/삭제·표준 데이터는 플랫폼 보기에서 유지.

## 재현·검증

```sh
node designs/platform-data-center/capture.mjs
```

로컬 frontend Playwright 또는 기존 메인 체크아웃 설치본을 읽어 Chrome headless `file://`로 실행한다. HTTP(S) 차단, 패키지 설치·제품 서버 실행 없음. 1440×1000 중심, 기존 사용자 화면은390×844 회귀 확인. 화면은 full-page, 대화상자는 viewport 캡처다. 긴 대화상자 본문은 세로 스크롤하며 제목·하단 버튼은 고정한다. 정책/재인증 영역은 별도 `*-download-policy.png`로 확인한다.

- 2026-10-24 최종 실행: Chrome155.0.8059.85, 캡처59장(기관13장 포함), 상호작용63/63 통과. 검사 대상 가로 넘침·겹침·잘림0, 브라우저 오류·외부 요청0. 상세: `capture-results.json`.
- 읽기 전용 별도 검토와 감독 재검증으로 회원 ZIP의 타인 표시, 회차 상세 날짜/ID, 검색 후 참여자 전체선택, 기관 필터 후 결과순번, 결정 질문 참조를 수정했다.
- 개인정보 마스킹·필터·모바일, 그래프·목적 차단, 클래스 탐색, 50회차/기간, part별 링크, 기관 범위/전용탭/감사 표시를 확인한다. 토스트가 사라진 뒤 캡처해 표를 가리지 않도록 했다.
- 주요 PNG를 직접 열어 텍스트/여백/잘림/겹침 확인. 자동 측정은 지정 구성요소의 가로 넘침·형제 겹침·텍스트 너비 검사이며 모든 브라우저/기기·서버 보안의 증명은 아니다.
- 제품 빌드·단위 테스트·API·DB·스토리지·실기기 검증은 수행하지 않았다. 서버 인가·가명화·실제 ZIP·동의/보관 재검사는 후속 제품 Verify 대상이다.

## 주요 캡처

| 경로 (`captures/` 아래) | 화면 |
|---|---|
| `1440-class-list.png` | 플랫폼 클래스 목록 |
| `1440-class-sessions.png` | 클래스 회차 표 |
| `1440-session-participants.png` | 회차 참여자 선택 |
| `1440-measurement-detail.png` | 1건 그래프·화면6대 지표 |
| `1440-detail-features.png` | 전체 원천 feature 표 |
| `1440-detail-ppg-collected.png`, `1440-detail-acc-collected.png` | 수집 후 원파형 합성 예시 |
| `1440-download-signals.png`, `1440-download-signals-collected.png` | 신호별 미수집/수집 후 체크 |
| `1440-class-download.png`, `1440-class-download-policy.png` | 클래스 전체·예상 용량/분할·정책/재인증 |
| `1440-zip-preview.png` | ZIP 회차 폴더 구조 |
| `1440-member-limit.png`, `1440-member-batch.png`, `1440-member-dates.png` | 회원50회차 초과/묶음/기간 |
| `1440-facilitator-limit.png`, `1440-facilitator-batch.png`, `1440-facilitator-dates.png` | 상담사50회차/기간 |
| `org_admin-class-list.png`, `org_admin-menu.png` | 기관명·클래스·메뉴 위치 |
| `org_admin-sessions.png`, `org_admin-participants.png` | 기관 회차·참여자 |
| `org_admin-measurement-detail.png` | 기관1건 그래프 |
| `org_admin-download.png`, `org_admin-download-policy.png` | 기관 운영 다운로드·정책 |
| `org_admin-download-created.png`, `org_admin-audit.png` | 기관 작업·본인 감사 |
| `org_admin-facilitator-limit.png`, `org_admin-facilitator-batch.png` | 자기 기관59회차 제한/묶음 |
| `org_admin-member-zip.png` | 기관 회원 본인만 포함 |
| `org_admin-users.png` | 기관 사용자 목록 |
| `1440-platform-org-audit.png` | 플랫폼의 기관관리자 감사 조회 |

기존 탭/하위 화면·390 사용자·단건/선택 다운로드·차단·작업·감사 캡처도 삭제 없이 갱신했다. 전체 목록은 `capture-results.json`의 results를 따른다.
