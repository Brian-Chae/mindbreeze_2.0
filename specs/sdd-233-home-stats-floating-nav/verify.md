# SDD-233 구현 전 검증 계약

작성: 2026-10-22, 제품 코드 변경 전. Brian의 Stage ②~⑥ 연속 승인 근거로 진행.

- [x] 회원 비공개: 홈/내 클래스/대화/리포트/더보기. 공개: 홈/내 클래스/상담/리포트/더보기.
- [x] 상담사·기관 비공개: 홈/클래스/리포트/대화/더보기. 공개: 홈/클래스/상담/대화/더보기.
- [x] 플랫폼: 홈/가입 신청/사용자/대화/더보기. 클래스·리포트 무권한 경로 제거.
- [x] 빠진 모든 메뉴는 더보기·햄버거에서 접근. 상담·AI 공개 플래그 유지. 종 유지.
- [x] report/chat/AI/invite 배지 중복 합산 없음, 알림은 더보기 합산 제외, 9+ 상한.
- [x] 정확히 한 활성 탭, 하위 경로·쿼리·더보기 상태. aria-label/aria-current, 아이콘 aria-hidden, 키보드 포커스.
- [x] B 시안 색·66px·16px 좌우·12px 아래+safe-area·작은 라벨·활성 채움 아이콘.
- [x] 회원 4카드 바로 다음 내 클래스, 데이터/링크·로딩/부분 실패 불변. 데스크톱4열.
- [x] 상담사 상태 카드→클래스 인접 및 기존 링크 유지.
- [x] 390/430/1440 회원·상담사 mock 캡처. 가로 넘침 없음, 마지막 요소 가림 없음.
- [x] 모바일 safe-area0/34, 세 셸의 스크롤 하단100px+safe-area. 1440 바 숨김.
- [x] 몰입형 player·대화방 hideBottomTab 및 noBottomPad/noScroll 기존 계약.
- [x] 관련 BottomTabBar·홈·셸 vitest, tsc, 변경 파일 eslint(CI react-hooks), build 결과 기록.
- [x] 실제 iOS 툴바/회전/키보드와 실 API는 로컬 mock 검증과 구분해 잔여 시나리오로 인계.

## 추가 검증 항목 — TASK BOX 2026-10-22 (기존 항목 유지)
- [x] 회원·상담사 홈 각각 5개 이상일 때 정확히 4개 카드만 렌더한다.
- [x] 4개 초과 시 `전체 보기 (N)`은 잘라내기 전 총수이며 기존 전체 목록 경로로 연결된다.
- [x] 4개 이하에서는 총수 괄호를 붙이지 않는다. 회원은 기존 정렬이 없으면 기존 순서를 보존하고 상담사는 기존 정렬을 보존한다.
- [x] `HOME_CLASS_LIMIT = 4` 한 곳에서 공유하며 전체 클래스 페이지·API에 제한을 전파하지 않는다.

## 실행 결과 (2026-10-22)
- 구현 전 문서 fba1a844, 추가 4개 제한 요구 문서 56286410 커밋 후 구현.
- 관련 13파일268건 통과. 독립 검증자8파일206건 재실행 통과, 차단 문제 없음.
- tsc app, 변경 제품9개+테스트8개 eslint(CI react-hooks 포함), build, diff --check 통과.
- mock Chrome 회원·상담사390/430/1440, PNG18개. JS오류/가로넘침0. 두홈6개→4카드·전체 보기(6) 확인.
- 바66px/좌우16px/아래12px, 마지막 콘텐츠 간격 회원37.6px/상담사21.7px. safe-area34 모의에서도 동일 간격.
- 실 iOS/실API는 미실행으로 구분하여 summary 인계. 관리자는 공통 셸 DOM/CSS·역할별 테스트로 확인, 별도 관리자 브라우저 캡처 없음.

## 10/22 카드 회귀 — 수정 전 추가 검증 계약
- 실제 AppShell `/dashboard`에 `.cs-structure`가 없어도 스타일이 적용된다.
- 실제 ClientShell `/app`과 390/1440에서 hero/chip/button/tile/classCard/panel의 computed radius/height/min-height/padding/border/shadow가 일치한다.
- 섹션 gap24, 히어로→검토배너24, 4개 클래스, 가로 넘침0, JS오류0을 `parity.cjs`가 assert한다.
- `screens/parity-*.png`에 두 홈 개별·나란히 캡처, `parity.json`에 측정값을 저장한다.
- 스타일만 변경하며 기존 동작 테스트와 tsc/eslint/build를 통과한다. 실제 iPhone Safari 검증과 mock Chrome 증거를 구분한다.

### 카드 회귀 실행 결과
- 실제 셸 RED에서 상담사 radius0/gap0 재현 후 공통 스타일 적용, DEV 및 BUILD Chrome 390/1440 비교 GREEN.
- 히어로 폭358/1120, 높이263.188, 상태152, 클래스304, 패널200(합성 데이터), radius20/padding24·18·24·24/gap24 양쪽 일치. 모든 상태·클래스·패널 규격 비교, 가로 넘침/JS오류0.
- 관련70건/tsc/eslint/build 통과. 전체 vitest 기준선과 수정 후 동일12파일4건 실패(상세 summary). 독립 리뷰 지적3건 수정 후 차단 이슈 없음.
