# SDD-256 — 구현 요약

## 결과
- 홈 '담당 상담사': 전체 목록 + `+ 상담사 추가`(0명이어도 영역 유지). 설정 > `상담사 관리`(client 전용): 목록·기관 + `+ 코드로 상담사 추가`.
- 공용 코드 입력 시트(`counselor-add-sheet.tsx`, body 포털): 영문·숫자 6자리(숫자만 코드 가능), 소문자·공백 정규화, 7자/기호 전송 차단, 기존 `POST /client/counselors` 재사용, 201 즉시 병합 후 GET 재검증(실패해도 추가 행 유지+안내), 404/403 서버 문구, 409 중복/기관 비활성 detail 구분, 네트워크 단절은 결과 불명 문구(자동 재시도 없음), 오류 시 입력 유지, 중복 전송 방지, '클래스 입장 코드는 사용할 수 없어요' 안내.
- 목록 훅(`use-client-counselors.ts`): 요청 세대로 늦은 GET 무시, 계정 전환 시 타 사용자 store 오염 방지, 조회 실패≠0명(재시도 제공).
- 대표 결정 반영: 최초 연결일 미표시(서버 변경 0), 용어 '상담사' 유지(문구는 `lib/client-counselor-copy.ts` 한 곳 → SDD-257 용이), 연결 해제 범위 밖. 기존 상담사 0명 → `CounselorCodeScreen` 동작 불변.

## 디버깅 기록
- 390px에서 시트 버튼이 하단 탭바에 가려져 클릭 불가 → `createPortal(document.body)` + z-[60] 로 수정(캡처 스크립트로 발견).

## 검증
- tsc -p tsconfig.app.json 통과, eslint src/ 오류 0(기존 경고 2), npm run build 통과.
- 신규 vitest 15건(counselor-management 13, counselor-home-entry 2) 통과. 기대값 수정 2건: 0명 홈에 영역 유지, client 설정 7그룹.
- 전체 vitest --cache false: 8파일·13건 실패 = 기준선과 동일(신규 실패 0). 실패 파일: agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd220-native-release, sdd234-a-mobile-home(specs 캡처는 원복).
- 헤드리스(합성 API, 빌드 산출물): 390·1440 가로 넘침 0, 버튼 ≥48px, JS 오류 0, 추가 후 홈에 새 상담사 반영. 캡처: `screens/` (qa.json, capture.cjs).

## 보완 — 실제 회원 홈(`/app`) 반영
- 원인 재확인: `/app` 은 `MemberStructureHomePage`(내부에서 ClientHomePage hideHero 사용). 버튼은 우측 레일 맨 아래라 모바일에서 y≈1730(스크롤 끝)에 묻혀 있었음.
- 수정: 공용 `components/client/counselor-section.tsx` 신설 → 회원 홈은 '내 상담' 아래(전폭, grid-row 5)에 배치, 레거시 ClientHomePage 는 기존 레일 위치에서 같은 컴포넌트 사용. 모바일 버튼 y 1729→1110.
- dev 실연동(vite → dev-api 프록시, client@test.com, 390·1440): `/app` 에 담당 상담사 영역·`+ 상담사 추가` 노출, 시트 열림, 잘못된 코드(ZZZZZZ) → '유효하지 않은 상담사 코드입니다', `/app/profile` 에 '상담사 관리' 노출, JS 오류 0. 성공 추가는 dev 데이터 보호로 미실행. 캡처 `screens/real-*.png`.
- 테스트: 실제 홈(MemberStructureHomePage) 기준 2건 추가, 훅 목 형태 수정 3파일. 전체 vitest 8파일·13건 실패 = 기준선 동일.

## 미확인(실기기·배포)
- 가상 키보드 가림, 스크린리더, 채팅방 자동 생성(V16), 앱 재빌드·설치(V20)는 미실행. **앱 재빌드 필요**(웹 반영만으로 설치 앱에 생기지 않음).
