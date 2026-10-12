# SDD-100 — 구현 및 검증 결과

## 변경

- SessionLiveMetric의 Pydantic·TypeScript 계약에 gender, birth_date, concerns를 추가했다.
- 활성 회원 ClientProfile을 한 번에 조회한다. 참가자 성별·생년월일을 우선하고 프로필로 보완한다. 게스트 설문은 항상 빈 배열이다.
- 생년월일을 서비스에서 ISO 문자열로 변환하여 REST와 호스트 소켓 스냅샷에 모두 안전하게 전달한다.
- 카드·테이블·상세에 성별과 현지 날짜 기준 만 나이를 연결했다. 생일 전후를 구분하고 잘못된 날짜·미래 날짜는 생략한다. 정보가 없으면 구분점도 생략하며, 게스트 또는 빈 설문은 섹션을 숨긴다.
- 사용자 기존 호스트 화면 미커밋 작업을 보존했다. 커밋·배포·Linear 게시를 수행하지 않았다.

## 검증

변경 전 프론트 신규 시나리오 10건이 placeholder 때문에 실패했고, 백엔드 신규 3건이 필드 누락 때문에 실패했다. 구현 후 다음 명령이 통과했다.

```sh
cd backend
uv run --python 3.12 --with-requirements requirements.txt --with fakeredis --with 'psycopg[binary]' pytest tests/test_live_metric_profile.py tests/test_sdd021_session_class_flow.py tests/test_sdd024_session_live_ws.py tests/test_sdd062_guest_gender_birth.py -q
# 28 passed

cd ../frontend
npx vitest run tests/host-class-workspace.test.tsx
# 21 passed
npx vitest run --exclude '**/*.test.cjs'
# 27 files / 244 passed
npm run build
# 종료코드 0
```

독립 코드 리뷰에서 이번 변경 범위의 수정 필요 사항 없음. git diff --check 통과. 신규 any 없음.

## 전체 실행의 한계와 경고

- 프론트 `npx vitest run`은 Vitest 테스트 244개가 통과했지만 Node 전용 `.test.cjs` 9개를 함께 수집하여 종료코드 1이었다.
- 실행기 불일치(No test suite found): login-page, login-role, narrative-sections, org-management-api, signal-metric-parity.
- Playwright 미설치: org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf.
- 위 실행 중 별도 Node assertion 실패도 관찰했다: login-page의 “기본 회원 탭은 Google을 이메일보다 먼저 보여 준다”, login-role의 “일치한 역할은 요청으로 전달하고 인증을 저장한다”. 이번 프로필 변경 범위 밖이므로 수정하지 않았다.
- 빌드는 디자인 토큰 CSS import 미해결 및 500 kB 초과 청크 경고와 함께 성공했다.
- 백엔드 전체 pytest 및 실제 브라우저/BLE 검증은 수행하지 않았다. 관련 API·소켓 회귀와 DOM 렌더링 테스트로 검증했다.
- 백엔드에 pytest 실행 환경이 없어 uv 격리 환경을 사용했으며, fakeredis와 현재 DB 드라이버 psycopg를 함께 제공했다. 저장소 의존성 파일은 변경하지 않았다.
