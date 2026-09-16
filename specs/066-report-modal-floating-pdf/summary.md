# SDD-066 구현 결과

## 변경
- 수동/자동 승인 공용 approve_report의 이메일 큐 호출을 제거했다. completed 전환, 기존 승인 메타데이터 및 알림은 유지했고 알림에서 전송 완료 표현을 제거했다.
- 상담사에게 검토 대기 리포트의 `승인하기`를 표시하며, completed 이후 `메일 발송` 폼에서만 resendReportEmail을 호출한다. 수신 주소 기본값은 report_email 또는 빈 문자열이다.
- 기존 작업 트리의 모달 하단 액션 호스트/portal과 본문 전용 printReport 구현을 보존하고 보완했다. 모달은 상단 닫기만 표시하고 독립 페이지의 목록 이동은 유지한다.
- 액션 버튼은 Tailwind와 #5F0080을 사용한다. 승인 안내 문구도 수동 발송 단계에 맞췄다.
- printReport는 리포트 DOM/CSS를 인쇄 iframe으로 복제하며 툴바·버튼·메일 폼을 제외하고 접힌 상세 지표를 펼친다. 브라우저 인쇄 창에서 PDF로 저장한다.

## 검증
- RED: 기존 승인에서 enqueue_report_email 호출 1회로 새 미발송 테스트 실패 확인. 기존 UI에는 승인하기 버튼이 없어 브라우저 테스트 실패 확인.
- BE: `backend/venv/bin/pytest backend/tests -q` → **454 passed, 1 skipped**, 14 warnings, 26.04초. 수동/자동 승인 미발송 회귀 포함.
- FE: `cd frontend && npm run build` → **exit 0**, TypeScript 오류 없음. 기존 번들 크기 경고 존재.
- 브라우저: `NODE_PATH=/tmp/sdd046-browser/node_modules node --test frontend/tests/report-modal-pdf.test.cjs` → **2 passed**. Vite 5175에서 실행.
- 수신 주소 유무 2가지, 1280/390/320px 하단 액션 위치, 상단 닫기 1개, 보라색 버튼, 승인 전 발송 폼 없음, 승인 후 기본 주소, 별도 발송 1회 확인.
- 인쇄 호출, 서사 5개 섹션, SVG, 액션 제외 확인. Chromium A4 다중 페이지 PDF 실제 생성: `/tmp/sdd-066-report.pdf` (약 821KB).
- 모바일 화면 직접 확인: `/tmp/sdd-066-modal-320.png`; 다른 폭은 같은 이름의 390/1280 파일.
- `git diff --check` 통과.

## 범위와 남은 확인
- 브라우저 테스트 API는 모킹했고 실제 SMTP 전송 및 OS 저장 대화상자 조작은 하지 않았다. 인쇄 결과 파일 생성은 Chromium PDF로 검증했다.
- 기존 sent_at 승인 메타데이터 계약은 유지했다. 이메일 전송 성공의 새 증거로 사용하지 않는다.
- 이번 분리는 approve_report의 자동 큐 호출과 상세 화면의 발송 흐름에 적용된다. 별도의 기존 게스트 report-email 요청 API가 승인 완료 리포트에 대해 예약하는 흐름은 변경하지 않았다.
- 시작 시 이미 존재하던 frontend 변경과 specs/.sdd-counter를 보존했다. 커밋·배포·DB 마이그레이션은 수행하지 않았다.
