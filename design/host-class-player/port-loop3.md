# 루프3 — 잔여 일치성 정밀 개선

`design/host-class-player/index.html`(목업 최종 cascade)과 `frontend/src/pages/sessions/ClassPlayerPage.tsx` + `host-class-player.css`의 **잔여 불일치**를 정밀 개선하라. 루프2에서 조용한 신호·그룹·카드·칩·상세·정렬은 정리됨. (구현 금지 아님 — 수정 + 빌드 통과)

## 초점 (남은 정밀 항목)
1. **타이포 계층**: 제목/값/라벨/보조 크기·굵기·자간이 목업과 1:1인지 (예: 값 40px·단위 11px, 라벨 10px muted, 섹션 라벨 10px lavender letter-spacing 2px)
2. **여백·간격·보더·라운드 토큰**: --border-container #ffffff1A / --border-divider #ffffff0D, radius-container 12px 통일
3. **반응형 엣지**: 761px(좌 300px 2칼럼), 760px(모바일 148px+1fr), 1050px(좌 240px) 브레이크포인트에서 목업과 동일 배치
4. **상세 슬라이드 정밀**: 링 그라디언트·틱, 막대 밴드·평균 점선, 범례 스와치, 헤더·사전설문·닫기 배치
5. **상태 표현**: 밴드 미사용/수신 끊김/추이 대기(3분 미만) 구분, 0건 신호 pill 숨김

## 성별·나이·설문
- 루프2에서 `—` placeholder + 연결 함수 + TODO 유지. 변경 없음(백엔드 계약 확장 대기)

## 산출
- 잔여 불일치 수정 + `cd frontend && npm run build` 통과(종료코드 0)
- 일치성 보고(항목별)
