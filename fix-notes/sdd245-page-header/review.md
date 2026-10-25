# SDD-245 페이지 헤더 보완 독립 코드 리뷰

- 범위: `/tmp/sdd245-header-review.diff` 및 현재 PageHeader·셸·호출부 소스. 읽기 기반 검토이며 테스트는 구현자 검증에 위임했다.
- Critical: 없음.

## Important

1. **아이콘 전용 버튼이 제거되어 동작 상실** — `frontend/src/components/ui/page-header.tsx:16-20`.
   - `interactive && text` 조건을 통과하지 않는 아이콘 전용 native button이 일반 wrapper처럼 펼쳐진다.
   - 재현: 상담사 클래스 상세 `SessionDetailPage.tsx:365`의 `aria-label="더보기"` 버튼(Ellipsis만 자식)이 PageHeader actions로 전달되면 button/핸들러가 사라져 메뉴를 열 수 없다.
   - 수정: native interactive 요소는 텍스트 유무와 무관하게 보존한다. aria-label 아이콘 버튼 클릭 회귀 검증이 필요하다.
2. **모바일 타이틀이 남은 세로 공간을 차지** — `frontend/src/components/ui/page-header.css:1` 최초 검토본.
   - AppShell/ClientShell의 세로 flex 컨테이너 직계 자식 모바일 PageHeader에 `flex:1`이 적용되어 본문과 가용 높이를 나눠 가진다.
   - 현재 소스 9행의 `.mb-page-header-mobile{flex:0 0 auto}` 반영을 확인했다. 수정 완료, 브라우저 재측정은 구현자 진행 중이다.
3. **클래스 상세의 헤더 아래 탭 토큰 누락** — `frontend/src/pages/classes/host-class-detail-page.tsx:36`.
   - `/classes/:id`의 개요/회차/멤버/설정 메뉴는 `border-b-2 px-4 py-3` 개별 스타일이며 `tabClass`를 사용하지 않는다.
   - 사용자 요구 4번의 헤더 바로 아래 공용 tab 토큰 확인·이관 범위에 해당한다.

## 기타

- `actionsOf`의 native wrapper flatten은 wrapper의 role/aria/onClick 등을 버릴 수 있다. 현재 확인한 실제 rightSlot wrapper는 단순 배치 div이므로 별도 현행 파손으로 판정하지 않았다.
- `ClassCreateAction`과 `CodeEntryButton` 같은 사용자 컴포넌트는 내부 요소가 공용 helper를 직접 사용한다. 그 밖의 새로운 사용자 컴포넌트에 자동 적용되지는 않는다.
- 영어 sub를 제목 위 오버라인으로 보존하는 현재 셸 경로는 다수 기존 화면과 일치한다. 리포트 목록만 오버라인을 제거한 것은 요청 범위에서 허용된다.

## 최종 재리뷰 판정

`/tmp/sdd245-header-review-final.diff`와 현재 공용 헤더·CSS·host/member 상세·회귀 테스트 소스를 재검토했다.

- Important 1 해결: `interactive && !text`는 원본 요소를 반환하므로 아이콘 전용 버튼과 onClick·aria-label이 보존된다. 회귀 테스트에 더보기 버튼 클릭 검증이 추가됐다.
- Important 2 해결: 모바일 헤더 `flex:0 0 auto`로 세로 공간 확장을 차단한다.
- Important 3 해결: 상담사 상세 클래스 메뉴와 회원 상세 정보 탭이 `tabClass`를 사용한다. 기존 링크 목적지·선택 상태·회원 키보드 핸들러가 유지된다.
- wrapper는 제거 대신 `display:contents`로 보존하여 기존 role·aria·핸들러도 유지한다.
- 위 수정에서 새 Critical/Important 파손은 발견하지 않았다. 최종 판정: **요청한 수정 3건 해소, 차단 결함 없음**.
- 이 재리뷰는 소스 검토다. 전체 테스트·브라우저 측정 결과는 감독자의 최종 검증에 따른다.
