# SDD-248 Verify (구현 전 체크리스트)

## 백엔드
- [ ] V1 필수값 누락/형식 오류/enum 오류/message 2001자 → 422
- [ ] V2 privacy_consent=false → 422
- [ ] V3 website 허니팟 채움 → 422, DB 저장 없음
- [ ] V4 정상 제출 → 201, org_inquiries 1행(status=new), 동의 시각 저장
- [ ] V5 같은 IP 6번째 요청(10분) → 429, 저장 안 됨
- [ ] V6 메일 태스크 apply_async 1회 호출(인자=문의 id)
- [ ] V7 apply_async 예외 → 여전히 201
- [ ] V8 deliver: 제목 형식, 전 필드, KST 시각, IP 미포함, reply_to=문의자, HTML 이스케이프(`<script>`), 다중 수신
- [ ] V9 발송 실패 → notify_status=failed, 태스크 RuntimeError(재시도)
- [ ] V10 Alembic head 단일, upgrade/downgrade 문법 확인
## 프론트
- [ ] F1 필수 미입력/이메일 형식/동의 미체크 시 제출 차단·오류 표시
- [ ] F2 정상 제출 시 API 페이로드(website 빈 값 포함) 호출, 제출 중 버튼 비활성
- [ ] F3 성공 문구 표시
- [ ] F4 실패 시 오류 메시지·재시도 가능
- [ ] F5 랜딩 CTA 클릭 시 폼 모달 열림
## 회귀
- [ ] tsc -b 0, vitest 기준선 17 fail/8파일 유지, 백엔드 관련 테스트 통과

## 랜딩 v6 구현 (추가, 구현 전)
- [ ] L1 섹션 순서: 히어로→웹·앱 칩→역할 3카드→클래스관리→멀티디바이스→자연→진행→리포트→문의띠→LINK BAND→이용과정→다운로드→신뢰→FAQ→문의안내→푸터
- [ ] L2 CTA 5곳(hero·roles·mid·contact·floating) 클릭 시 중앙 모달(role=dialog) 열림
- [ ] L3 모달: ESC·X·바깥 클릭 닫힘, 닫힌 뒤 포커스 복귀, Tab 포커스 트랩, 제출 버튼 하단 고정, 필수값 오류 표시
- [ ] L4 모달 성공(mock) 시 완료 화면 + "닫고 서비스 둘러보기", 실패 시 오류·재시도. 시안 미리보기 문구 없음
- [ ] L5 플로팅 버튼 상시 노출, 모달/문의섹션/기기 겹침 시 숨김
- [ ] L6 로그인·코드 입장 링크 유지, 공식 스토어 배지 2종 + "곧 출시" + 웹 시작 버튼
- [ ] L7 1440·1024·390 가로 넘침 0, 깨진 이미지 0, 콘솔 오류 0
- [ ] L8 tsc -b 0, vitest 기준선 17 fail/8파일 유지(신규 실패 0), 랜딩 vitest 추가
- [ ] L9 Playwright 캡처 시안 비교(compare-*.png), 실제 제출 금지(mock 테스트)
