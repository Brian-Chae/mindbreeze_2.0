# SDD-216 — 프론트 운영 트랙

- 구현 전 계획·기대값. 사용자 개발 계속·하위 에이전트 지시 적용.
- 원본 verify 변경 없음. 전체 BE/FE 회귀 금지. 직접 변경 테스트만 실행, 최종 빌드는 루트 통합 후 1회.
- 소유: host-class-detail-page, host-class-views, 신규 class-operations API/컴포넌트, SessionDetailPage, NoticeStepView, member-prep, useEntryPrep, EntryPage, class-flow의 고지 유형 전달, 운영 전용 테스트 및 이 문서.
- 공용 API/DTO는 adfacb71 의존. 검증용 읽기 복사하며 본인 커밋 제외.

| Task | 구현 | 구현 전 기대값·검증 |
|---|---|---|
| O1 | 최소 멤버 초대·이메일 결과 | 회원 검색 초대 후 새로고침, failed만 재시도, sent를 수신 완료라 부르지 않음 |
| O2 | 설정·강사·수명 전이 | 조회 설정 보존, revision 전달, 마지막 주강사/재배정 오류 표시, 명시 확인 후 취소/보관 |
| O3 | 회차 진행자 요청·CH30·참관 | 요청 목록 및 후보 수락, 현재 진행자만 진행 CTA, 참관 송출·EEG·제어 없음 |
| O4 | D05/D28 | 명상 class-team-v1 표시·확인 저장, 상담 r5-1 유지, 관리자 진행 CTA 숨김 |

| 시나리오 | 기대값 | 검증 |
|---|---|---|
| OP01 | 권한 없는 상세에서 운영 쓰기 CTA 없음 | DOM |
| OP02 | 현재 설정 전체 보존 및 revision 전송 | 단위/API |
| OP03 | 멤버 초대·이메일 상태 조회·실패만 재시도 | DOM/API |
| OP04 | 강사 추가·제거·주강사 지정, 오류 유지 | DOM/API |
| OP05 | 수명 전이 명시 확인과 중복 클릭 차단 | DOM/API |
| OP06 | 회차 요청 후보/관리자별 처리 버튼 | DOM |
| OP07 | 명상 고지의 열람 범위 표시와 class-team-v1 저장 | DOM/훅 |
| OP08 | 상담 고지 r5-1 유지 | 훅 |
| OP09 | 참관은 오디오/비디오 송출 및 제어 없음 | DOM |
| OP10 | CH30에서 편성 연결, 관리자 진행 불가 | DOM |

## 실행 결과

- O4 명상 고지 저장·표시 RED 2건 확인 후 GREEN. 신규 4 + 기존 준비 화면 13 = 17개 통과(1.28초).
- 실제 LiveKit·서버·시안 브라우저 검증 미확인.
