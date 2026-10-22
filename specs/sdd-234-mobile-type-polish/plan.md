# SDD-234 — 모바일 가독성 구현 계획

> 후속 워커: superpowers:executing-plans 또는 subagent-driven-development로 담당 영역만 수행. spec.md와 verify.md를 먼저 읽는다.

목표: 모바일 가독성과 터치 크기 개선. 구조: 공통 의미 토큰·셸 기반을 먼저 고정하고 화면별 스타일을 A~D 독립 워크트리에서 적용. 기술: React/Tailwind/CSS + Playwright computed style. 승인 범위는 spec.md 참조.

## 공통 담당 (현재 워커)

- `design-system/tokens/system/typography.json`, `design-system/build/outputs/{css,tailwind,ts}/*` 생성물, `DESIGN.md`
- `frontend/tailwind.config.cjs`, `frontend/src/index.css`, 신규 `frontend/src/mobile-foundation.css`
- `frontend/src/components/layout/{AppShell, floating-bottom-nav}.tsx` (공백 없는 실제 파일명 `AppShell.tsx`, `floating-bottom-nav.tsx`), `floating-bottom-nav.css`
- `frontend/src/components/client/ClientShell.tsx`
- `specs/sdd-234-mobile-type-polish/*`, 측정·검증 산출물
- StructureShell은 기존 AppShell/ClientShell 기반을 그대로 상속. `structure-shell.css`는 화면 규칙도 포함하므로 B 단독 소유로 넘긴다. 공통 CSS는 셸 고유 클래스만 대상으로 하여 카드 스타일을 침범하지 않는다.
- [ ] 측정 코드 → before 및 문서 커밋 → 공통 스타일 → 관련 검사/after → 독립 리뷰 → feat 커밋 → 지정 브랜치 push.

## 영역별 워커 프롬프트 / 소유 파일

모든 경로는 `frontend/src/` 기준. 하위 파일 glob은 해당 디렉토리의 스타일/뷰만 허용하며 API·상태·비즈니스 로직 변경 금지. 새 테스트는 각 영역 접두사 `frontend/tests/sdd234-{a,b,c,d}-*.test.tsx`. 공통 파일 변경이 필요하면 직접 수정하지 말고 통합 담당에게 구체적인 selector/요구값을 보고한다. 각자 별도 워크트리. 동일 워크트리 동시 쓰기 금지.

### A 홈

소유:
- `pages/client/{member-structure-home-page,ClientHomePage}.tsx`
- `pages/DashboardPage.tsx`, `pages/dashboard-page.css` (실제 import 경로를 확인하여 아래 파일 목록 보완)
- `components/client/home/{member-class-strip.tsx,member-home-layout.css,home-card-parity.css}`

작업:
- [ ] --area=A before를 확인하고 12px 이하 칩·상태·헤더 작업 버튼을 의미별 13/14/15로 교체.
- [ ] 홈 카드 설명은 15/24, 제목 18/27, 히어로 24/32. 헤더 버튼 44 이상. 양쪽 동일 카드 규격 유지.
- [ ] 152px 통계·304px 클래스 카드의 글자 잘림 확인. 높이 조정이 필요하면 양쪽 함께 모바일에만 적용하고 parity 검증 업데이트 이유 기록.
- [ ] --area=A after + 관련 홈 vitest. 390 일반 작은 텍스트/터치 0, 가로 넘침 0, 768/1440 기존 스타일 유지.

### B 클래스

소유:
- `pages/client/{member-classes-page,member-class-detail-page,guest-class-membership-page,use-class-apply}.tsx`
- `pages/classes/*.{tsx,css}`, `pages/class/{CodeEntryPage,EntryPage}.tsx`, `pages/sessions/ClassPlayerPage.tsx`
- `components/class/structure/*.{tsx,css}` 전체 (리포트 탭 포함: C와 공유하지 않음)
- `components/class/flow/**/*.{tsx,css}` 전체 **단 `flow/shell/MemberHomeView.tsx`는 A, 나머지는 B**
- `components/class/player/**/*.{tsx,css}` 전체 및 `components/class/{host-class-player.css,waiting-room-readiness-panel.css,waiting-room-readiness-panel.tsx}`
- `components/class/{ClassAudioPanel,GuestAudioPanel,QuietSignalButtons,ClassOnboardingCoachmarks,SensorTracker,CheckinSummary,LeadOffModal}.tsx`

작업:
- [ ] 목록/상세 메타 13+, 본문 15+, 라벨 14+, 버튼/아이콘 터치 44+, 주 CTA 48.
- [ ] 구조 셸 CSS의 작은 글씨 규칙을 모바일 media 내부에서만 보정. A 홈 selector를 침범하지 않게 `.mc-grid`, 상세 루트 등 좁은 selector 사용.
- [ ] 입장·로비·진행 각각 회원/상담사 케이스 측정. 채팅 시트의 외곽 크기는 B, 실제 ChatRoom/ClassChatPanel 내부는 D 소유.
- [ ] --area=B after 및 class-flow/player/structure 관련 vitest. 390 하한·넘침 검사, 768/1440 유지. 미측정 시트/장문/동의 폼 추가 캡처.

### C 리포트

소유:
- `pages/reports/*.{tsx,css}`
- `pages/client/{ClientReportListPage,ClientReportDetailModal}.tsx`
- `components/reports/*.{tsx,css}`

작업:
- [ ] 목록 메타/배지 13+, 제목 18+, 서사·본문 16/26. 모달 헤더/닫기·필터·다운로드 터치 44+.
- [ ] 카드 패딩 16~20, 섹션 24. long narrative/미측정 EEG 케이스 둘 다 확인. 종합점수/문구/데이터 추가 금지.
- [ ] 클래스 안 리포트 탭은 B 소유, `lib/report/report-print.css` 변경 금지.
- [ ] --area=C after + report 관련 vitest. 390 목록·상세·모달 잘림 없음, 768/1440 유지.

### D 채팅

소유:
- `pages/chat/ChatPage.tsx`, `pages/client/ClientChatPage.tsx`
- `components/chat/*.{tsx,css}` 전체

작업:
- [ ] 목록 이름/미리보기 15+, 메타 13+, 메시지 본문 16/26. 입력 16/26 및 48 이상, 전송/뒤로/설정 44×44.
- [ ] 방 헤더·메시지 간격 8/12/16, 긴 한글·URL 줄바꿈과 모바일 키보드 높이 확인.
- [ ] **별도 `fix/class-chat-dark-theme`의 `ChatRoom.tsx`, `ClassChatPanel.tsx`와 충돌 가능. 해당 FIX 반영 상태를 통합 담당과 확인한 뒤 스타일 hunk만 순차 적용. 색상·테마 조건·기능을 덮어쓰지 않는다.**
- [ ] --area=D after + chat 관련 vitest. 목록/방 + 클래스 채팅 패널 추가 캡처, 390 하한·768/1440 유지.

## 측정 실행

```bash
node specs/sdd-234-mobile-type-polish/measure.cjs --area=A --phase=after-a --widths=390,768,1440
```

area=all/A/B/C/D, phase는 새 출력 디렉토리 이름. before는 기준 보존. 결과: `screens/<phase>/<영역>-<화면>-<폭>.{json,png}`, 내부 스크롤 끝 추가 PNG, summary JSON. 실패 exit는 렌더/JS 오류 기준이며 작은 글자·터치 후보는 JSON을 반드시 검토한다. 하니스는 서비스 API/기기 검증을 대체하지 않는다.

## 검토 우선순위

1. 작은 글씨 개선 후 고정 높이 카드 잘림(A).
2. 모바일 키보드와 safe-area가 입력/버튼을 가림(D).
3. 긴 한글/URL로 카드 폭 초과(A~D 각각).
4. 모달/시트·상태별로 작은 텍스트가 남음(B/C/D).
5. 768px 경계에서 desktop 스타일이 바뀜(공통 + A~D).

후속 4영역 완료 전 SDD 전체 완료라고 보고하지 않는다. 공통 기반 단계 summary와 잔여 작업을 따로 남긴다.
