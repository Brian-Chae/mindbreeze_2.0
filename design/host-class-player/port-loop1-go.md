# 루프1 구현 승인 — 즉시 구현 진행

Brian 승인 완료. SDD Stage ③ Verify 게이트와 specs/099-host-class-player의 plan/verify 작성은 **생략**하고 즉시 구현한다.

지시:
1. `design/host-class-player/port-loop1.md` 의 이식 지시대로 **즉시 구현** 시작
2. `frontend/src/pages/sessions/ClassPlayerPage.tsx` + 새 CSS 파일(`frontend/src/components/class/host-class-player.css`) 작성
3. 목업 index.html 디자인(2칼럼·조용한 신호·그룹 Mind/Body·참가자 카드·chip·상세 슬라이드·정렬)을 React로 충실히 이식
4. 기존 데이터 계약(useBand/useLiveKit/useSessionLiveSocket/scoreIndices 등)·기능(채팅·몰입·코치마크·리드오프·시그널) 보존
5. `cd frontend && npm run build` 통과 필수(tsc+vite)
6. 끝까지 구현하고 빌드 통과 확인 후 종료. 승인 요청 없이 계속 진행.

이 루프에서 specs/ 스펙·verify 문서를 새로 만들지 말고, 코드 구현과 빌드 통과에만 집중하라.
