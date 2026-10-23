# SDD-236 — 구현 전 검증 체크리스트

- 작성: 2026-10-23. **제품 코드 구현 전 작성/커밋**.
- 승인: 대표의 Spec→Plan→Verify→구현→테스트→Summary 연속 실행 지시. 추가 단계 승인 불필요.
- 현재: 시뮬레이터 시스템 부팅 장애. 원인 확정·제품 구현 미착수. 체크 항목을 사후 성공으로 표시하지 않는다.

## 원인 확정 게이트

- [ ] 17 Pro(Dynamic Island), 17e(비 Dynamic Island)에서 실제 앱이 실행된다.
- [ ] 로그인 전·오프라인 인증 홈·M01 클래스 각각 세로/가로 캡처와 native frame/statusBarHeight/safeArea/scroll inset을 저장한다.
- [ ] env(safe-area-inset-top/left/right), innerHeight/Width, html/body/root geometry를 저장한다.
- [ ] 상단 빈틈을 픽셀로 측정하고 단색 상태바/사진 경계와 구분한다.
- [ ] 원인과 최소 수정 방식을 spec/plan에 확정한 후 제품 구현에 진입한다.

## 수정 검증

- [ ] 동일 조건에서 전후 틈 0px, 상태바·노치·Dynamic Island와 콘텐츠 겹침 0.
- [ ] 상단 버튼의 bounding rect와 터치 영역이 안전 영역 안에 있으며 축소되지 않는다.
- [ ] 세로→가로→세로 회전 후 흰 띠·누적 inset·잘림 없음.
- [ ] 로그인 상태 전환 후 상태바 아이콘 대비와 헤더 색이 적절하다.
- [ ] 실패 재현 테스트 RED → 최소 수정 → GREEN. 기존 native 테스트를 유지한다.
- [x] `npx tsc --noEmit -p tsconfig.app.json` 통과.
- [ ] Chromium/WebKit 390×844, 844×390, 1440×900 웹 회귀 없음.
- [ ] Android 기기/에뮬레이터 검증 또는 명시적 미검증. 근거 없는 Android 수정 없음.
- [ ] 독립 검증자가 diff/측정값/테스트 출력을 재확인.

## 반출·정리

- [x] 임시 AppDelegate, Firebase 제외, Package.swift/Package.resolved 부수 변경 없음.
- [x] pbxproj/build.gradle 버전 번호 변경 없음, 실제 업로드 없음.
- [x] node_modules 심링크만 제거, 커밋에 포함하지 않음.
- [x] summary에 원인 확정 여부·전후 수치·기기/OS·실기기 미검증을 정확히 기재.
- [ ] 전용 브랜치만 push, develop 대상 PR. 머지·배포 금지.
