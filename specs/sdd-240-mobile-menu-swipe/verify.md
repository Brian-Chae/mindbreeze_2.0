# SDD-240 — 구현 전 검증 계획

작성: 2026-10-24. Brian의 Stage ②~⑥ 연속 승인에 따라 구현 전에 작성·커밋·push한다. 아래는 예정 시나리오이며 미실행 항목은 체크하지 않는다. 실제 결과는 summary.md와 기계 판독 JSON에 기록한다.

## 단위

- [x] 왼/오른쪽, 390px 거리78px 경계, 짧은 복귀, 빠른 플릭(40px·최근80ms·16ms·0.5px/ms), 역방향 속도 거절.
- [x] 12px·500ms, 세로/대각 잠금, cancel·다중터치·중복 종료, 끝 저항·순환 없음.
- [x] 3역할×상담플래그 순서·정확한 루트·끝 슬래시·상세/플랫폼관리자 제외.
- [ ] 입력 포커스·IME·미전송/미저장·저장 중·시트/모달·선택·활동 보호, 해제 후 회복.

## 실제 앱 Chrome 터치 (로컬 fixture, hasTouch 390x844)

- [x] 회원: /app ↔ /app/classes ↔ /app/chat ↔ /app/reports. 상담 공개 구성도 메뉴 순서 확인.
- [x] 상담사: /dashboard ↔ /classes ↔ /reports ↔ /chat.
- [x] 기관관리자: /dashboard/org ↔ /classes ↔ /reports ↔ /chat.
- [x] 손가락120px에 화면120px 추종, 실제 이웃 레이어 유입, 스냅 후 URL·pill 일치·한 번 push.
- [x] 짧은 드래그160ms 복귀, 40px 이상 빠른 플릭 완료, 역방향/중도 cancel 복귀.
- [ ] 세로 스크롤 증가·URL 유지, 대각 시작 후 수평 재획득 없음, 핀치/두 손가락 취소.
- [x] 좌우24px 시스템 영역, 상단/하단 메뉴 출발은 가로 이동 안 함.
- [ ] 실제 홈 가로 레일(중간/끝)의 자체 스크롤 유지, 표/차트/슬라이더 출발 제외.
- [ ] 실제 입력창 포커스·blur 후 미전송 입력, 시트/모달/더보기, 수업·녹음·통화·측정, 미저장 편집·저장 중 각각 차단.
- [ ] 도중 보호 상태 변경·화면 회전·blur·visibility 취소, 종료 잔여 click 방지.
- [ ] 상세 URL·URL 불변 상세 모달에서 금지. 첫/마지막 탭 저항만, 더보기 자동 열림 없음.
- [ ] 취소 시 데이터/필터/스크롤 유지. 완료는 기존 버튼과 동일한 재진입·이력·스크롤 정책.
- [x] prefers-reduced-motion: 추종/스냅 없이 이동 판정만, 360/767px 동작·768px/데스크톱/마우스 비활성.
- [x] 키보드로 모든 탭/더보기 사용, aria-current 단일 활성·live 안내·미리보기 inert/aria-hidden·id 중복 없음·가로 넘침 없음.
- [x] 캡처: 역할별 첫/다음 메뉴, 드래그 중, 보호 상태, reduced motion.

## 자동 검사와 독립 검토

- [x] 신규 Vitest GREEN, `cd frontend && npx tsc --noEmit -p tsconfig.app.json`.
- [x] 변경 TS/TSX 파일 eslint, 로컬 웹 번들 빌드(앱 빌드 아님).
- [x] 전체 Vitest와 origin/develop 동일 러너 실패 목록 비교, 새 실패 0.
- [x] 독립 검토자가 diff와 테스트 결과 재검증, 금지 경로 변경 0.

## 실기기 후속 (이번 실행 대상 아님)

- [ ] 다음 앱 빌드 후 iPhone WKWebView·Android WebView, Safari·Chrome에서 중앙/OS 가장자리 충돌·키보드·레일 확인.
- [ ] VoiceOver/TalkBack·OS 움직임 줄이기·수업/입력 중 우발 이탈 0 확인.
- [ ] Android 제스처/3버튼과 iOS Safari back 기존 동작 회귀 확인. 앱 버전·실제 배포 환경 별도 기록.

## 2026-10-24 실행 결과 해석

- 위 체크는 summary.md 및 captures JSON 근거에 한한다. 테스트하지 않은 세부 조합이 포함된 항목은 원문 체크를 남겼다.
- 단위25개·focused71개, 전체2673/기존실패15/새실패0. 3역할·상담 공개/비공개 Chrome 터치84+49개, 별도 padding2개.
- 실제 세로 스크롤 증가와 홈 레일 자체 가로 스크롤/끝 인계 없음 통과. 표/차트/슬라이더는 합성 DOM, 수업/녹음/통화/측정/미저장/저장 중은 실제 공유 보호 registry의 합성 callback fixture로 차단을 확인했다.
- IME 실제 키보드·핀치 확대·visibility 조합·실제 수업/녹음/BLE 및 VoiceOver/TalkBack은 실기기 후속이다. 자동 DOM/키보드·소스 확인을 그 증거로 대체하지 않는다.
- 구현 중 padding 회귀와 안내 대비 문제를 발견해 RED/실제 캡처 근거로 보완하고 재검증했다. 기존 미실행 단말 항목은 체크하지 않았다.
