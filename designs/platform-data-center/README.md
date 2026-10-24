# SDD-243 데이터 센터 디자인 시안

- 상태: Spec·디자인 검토용. 제품 코드·API 구현 아님.
- `index.html`을 브라우저에서 직접 연다. HTML 하나에 CSS·JS·로고·한국어 폰트를 내장했다. 외부 CDN·서버·API 요청 없음.
- 모든 사용자·기관·이메일·날짜·수치는 합성. 이메일은 `example.invalid`, 전화는 비실사용 예시다.
- 기획 원본: `../../specs/sdd-243-platform-data-center/spec.md`.

## 화면과 조작

- 6탭: 개요 / 사용자 데이터 / 측정 데이터 / 동의·연구 / 보관·삭제 / 표준 데이터.
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

2026-10-24 최종 실행: Chrome **155.0.8059.85**, 1440×1000 / 390×844 뷰포트, full-page PNG **16장**. 긴 목록은 세로 전체 캡처이므로 PNG 높이는 뷰포트보다 길다.

- 페이지 가로 넘침 0, 검사 대상 구성요소 겹침 0, 텍스트 잘림 0, 브라우저 오류·외부 요청 0.
- 상호작용 **9/9 통과**: 개별 개인정보 열람, 대상 변경 재마스킹, 기관 그룹핑, 상태 필터, 빈 상태 초기화, 탭 이동 재마스킹, 모바일 상세 열기, 모바일 닫기 원문 폐기, 모바일 상세 닫기.
- PNG를 직접 열어 6탭·하위 화면·열람·빈 상태·그룹·390 목록/상세를 시각 확인했다. 모바일 표의 나머지 열은 안내된 내부 가로 스크롤로 조회하는 의도된 동작이다.
- 자동 측정 원본: `capture-results.json`. 재현 스크립트: `capture.mjs`.
- 별도 검토자가 데이터 전수표·보관 코드·Spec/시안을 읽기 전용 검토. EEG만 연구 보류, 동의 exported/배치 uploaded, 공개 삭제접수 received/탈퇴원장 requested, 모바일 닫기 재마스킹 수정 후 재검토 완료.
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
