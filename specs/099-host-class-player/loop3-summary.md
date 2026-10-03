# 루프3 — 잔여 일치성 정밀 개선

2026-10-03. 루프2의 변경 위에 적용했다. 목업 파일과 성별·나이·설문 연결 함수/TODO는 변경하지 않았다.

## 항목별 결과

1. **타이포**: 데스크톱 카드 값 42→40px, 행간 44px, 자간 -1.4px, 단위 11px, 증감 11px/400. 모바일 값 28px/행간30px 유지. 카드 라벨 10px muted 유지. 상세 제목 21px/500/자간 -.6px, 영문 섹션 라벨 10px lavender/자간2px. 그룹 영문 라벨 9px/자간1.5px. 상세 마음 값 25px(모바일27px), 몸 값 27px(모바일24px).
2. **토큰·간격**: --radius-container:12px를 선언하고 주요 컨테이너에 공통 적용. --border-container:#ffffff1A, --border-divider:#ffffff0D 유지. 상세 배경은 목업 최종 #12081C로 수정. 고정 헤더의 구분선·패딩, 설문 8×10px 패딩, 닫기 36px 버튼 적용. 578px 상세에서 설문·6지표·범례가 함께 보이도록 몸 행72px 등 밀도 조정.
3. **반응형**: 사용자 명시 폭을 우선했다. 761px 좌300px, 760px 이하 좌148px+1fr, 762~1050px 좌240px, 1051px 이상 좌300px. 주의: 목업의 실제 최종 cascade는 761~1050px 좌240px·모바일 좌202px이므로 이 두 경계는 목업과 의도적으로 다르다. 사용자에게 충돌을 질문했으며 응답 없이 요청값을 우선했다. 루프2의 데스크톱 174×152px·5열/모바일2열·96px 카드는 보존.
4. **상세 그래프**: #A16BBC→#D4B5E3 링 그라디언트와 실제 그룹 평균 틱, 막대의 실제 그룹 평균 점선, 실제 최근 수신 범위 띠 및 SVG 범례 추가. 그룹 유효 표본이 부족하면 평균 틱·점선은 숨김. 실제 이력/그룹평균을 함께 포함하는 자동 범위를 사용한다. 정상범위 계약이 없으므로 목업의 임의 정상범위 상수는 이식하지 않았다. 범례에 ‘최근 수신 범위’로 명시하며 정상범위와 혼동하지 않는다.
5. **상태**: 카드·테이블·상세의 밴드 미사용/수신 끊김/접촉 확인/측정 대기를 구분. 유효 현재값이 있고 3분 이력이 부족한 경우만 ‘추이 대기’. 미확인 신호 0건 pill 비노출 검증. 신호별 숫자 0 원형 표시는 목업대로 유지.
6. **인구통계·설문**: 기존 `—` placeholder와 `hostParticipantProfile` 및 백엔드 계약 확장 TODO를 그대로 유지.

## 검증

- 회귀 테스트: host-class-workspace, quiet-signal, group-aggregate, class-chat-panel 총 42개 통과.
- `cd frontend && npm run build`: TypeScript + Vite 종료 코드 0. 기존 tokens.css import 해석 및 500kB 청크 경고는 남음.
- `git diff --check`: 통과.
- 실제 HostClassWorkspace + 앱 공통 CSS를 로컬 Chromium에서 모의 데이터로 렌더. 1280/1051/1050/762/761/760/390px 모두 문서 가로 넘침과 pageerror 없음. 모든 폭에서 상세의 scrollHeight=clientHeight: 데스크톱576px/모바일688px. 카드·테이블에서 열기, 닫기와 Esc 확인.
- 실로그인 전체 페이지·실하드웨어/백엔드 검증은 수행하지 않았다. 좌측 미디어는 검증용 축약 구성이다. 전체 목업과 픽셀 단위 1:1이라고 주장하지 않는다.

## 증거

- [뷰포트 실측 JSON](evidence/loop3-layout.json)
- [데스크톱](evidence/loop3-actual-1280.png) · [상세](evidence/loop3-detail-1280.png)
- [모바일](evidence/loop3-actual-390.png) · [상세](evidence/loop3-detail-390.png)
- [761px](evidence/loop3-actual-761.png) · [760px](evidence/loop3-actual-760.png) · [1050px](evidence/loop3-actual-1050.png)
