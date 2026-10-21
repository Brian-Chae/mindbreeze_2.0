# SDD-226 Verify — 구현 전 QA 게이트 (구현 전 작성)

| ID | 시나리오 | 기대값 | 도구 |
|---|---|---|---|
| V01 | 목록 응답 즉석 플래그 | start_now 클래스 `is_instant=true`, 일반 false, 기존 필드 불변 | pytest |
| V02 | 자동 이름 | KST 기준 `즉석 명상 · 10월 21일 오후 3:20` 형식, 자정·정오 경계 | Vitest |
| V03 | 생성 페이로드 | start_now=true, fixed, planned 1, rows [], ends_on null, all_one 진행자 1명, duration=선택값 | Vitest |
| V04 | 기본값 | 첫 사용 30분·온라인·정원 10·LINK BAND optional·녹음 켬·채팅 끔 | Vitest |
| V05 | 지난 설정 | 생성 성공 후 저장, 재진입 시 복원, 사용자별 키 분리, 손상 JSON 무시 | Vitest |
| V06 | 상담사 2클릭 | 진입 → [지금 열기] → 공유 화면, 입력 0 | Vitest + 브라우저 |
| V07 | 관리자 | 지도사 미선택 시 [지금 열기] 비활성·안내, 선택 후 생성 | Vitest |
| V08 | 오프라인 | 주소 없으면 차단, 지난 주소 복원 | Vitest |
| V09 | 충돌 | 미리보기 충돌 시 시트 1회 → '그대로 열기'가 force+fingerprint 전송 | Vitest |
| V10 | 중복 생성 방지 | 연타·재시도 시 같은 operation_key, 클래스 1개 | Vitest |
| V11 | 공유 화면 | 코드 표시·복사, 링크에 코드·이메일 없음, QR 없음, 링크=회차 입장 주소, 상담사 → `/sessions/{id}/player` | Vitest |
| V12 | 초대 시트 | 회원 탭 inviteMembers, 이메일 탭 inviteEmails, 정원 초과 차단, 실패 시 재시도, 문자·카카오 없음 | Vitest |
| V13 | 진입점 | 목록 헤더·안내 카드·대시보드·마법사 시작 카드 모두 `/classes/now` | Vitest/정적 |
| V14 | 목록 | '즉석' 칩·필터, 완료 즉석 '다시 열기' → `?from=` 초기값 반영 | Vitest |
| V15 | 회귀 | 기존 마법사 바로 지금·초대·복제 테스트 통과 | Vitest |
| V16 | 빌드·모바일 | `npm run build` 성공, 390px scrollWidth=390, 하단 CTA 보임 | 빌드+브라우저 |
| V17 | LINK BAND 없음 | 밴드 미연결로 생성·대기실 진입 정상 | 브라우저 |
