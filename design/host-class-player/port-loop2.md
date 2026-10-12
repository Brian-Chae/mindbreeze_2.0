# 루프2 — 목업 일치성 검증 + 개선

`design/host-class-player/index.html`(목업 정본)과 `frontend/src/pages/sessions/ClassPlayerPage.tsx` + `frontend/src/components/class/host-class-player.css`(루프1 이식 결과)를 비교해 **목업 디자인과의 불일치**를 찾아 수정하라. (구현 금지 아님 — 수정해서 빌드 통과까지)

## 검증 포인트 (목업과 1:1 대조)
1. **조용한 신호 카드**: 좌측 최상단, 세로 3행(단색 글리프 check-circle/help-circle/pause-circle + 라벨 + 보라 원 숫자 뱃지), "응답 N·N명", "익명·최근 10초", 행 헤어라인. "미확인 새 신호 N건" 우측 상단 pill(빨간 점)
2. **그룹 흐름**: 마음 MIND(집중도·이완도·정서안정도 % → 링 게이지+중앙 숫자+증감) + 몸 BODY(BPM·호흡수·HRV → 막대 그래프+값·단위+증감), "지난 3분 평균 대비", "유효 표본 N명"
3. **참가자 카드**: 컴팩트(174×152), 이름·성별·나이 + 현재 지표 숫자 초대형 + "+N 3분대비" + 밴드 dot, 한 행 5명
4. **chip**: [모두]→테이블 / 개별 1개 단일 선택(기본 이완도, 10초 순환)
5. **상세 슬라이드**: 카드/테이블 행 클릭 → 우측 오버레이(roster), 헤더 + 사전 설문 + 마음 MIND(링) + 몸 BODY(막대) + 범례 1줄, 닫기 3종
6. **정렬**: 카드 자동(기본 이완도)/테이블 수동, 3분 미만/이후
7. **색·타이포·여백**: --bg #12081C · --purple #5F0080 · --cream #F7F4F0 · --muted #bcaec5 · --lavender #dcb5ee, 반응형(1280/390)

## 성별·나이·설문 (데이터 계약 확인됨)
- `SessionLiveMetric`에는 gender/birth_date/concerns **없음** (백엔드 계약 한계)
- 백엔드 확장 전까지 카드·상세의 성별/나이/설문은 placeholder("—")로 유지 + `// TODO: 백엔드 계약 확장(gender/birth_date/concerns)` 주석
- 확장 지점을 명확히 (SessionLiveMetric 인터페이스 확장 시 바로 연결되도록)

## 산출
- 불일치 수정 + `cd frontend && npm run build` 통과
- 일치성 보고: 각 포인트 일치/불일치/수정내용
