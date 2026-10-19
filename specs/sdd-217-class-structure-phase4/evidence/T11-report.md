# T11 통합 검증·결과 인계

상태: 구현 후 summary 신규 작성. 실제 Chrome+FastAPI+PG 통합23개 PASS, 4 viewport 16기본+12하단 screenshot 실제 시각 확인. 최종 독립 리뷰는 root 소유이며 Brian 최종 승인·배포 미수행. [최종 summary](../summary.md).

## 범위와 실제 증거

지정 sibling 워크트리와 root의 localhost PG55437/browser DB·Redis55438·API55439·FE55440만 사용했다. 실제 UI 로그인(합성 hash), 생성/초대/사전결석/복귀/동의/보강/탈퇴/정정/복구/guest 가입·병합·단회복구·리포트 열람과 실제 서버 입장·종료·Socket.IO join/disconnect/reconnect를 검증했다. band없음, 참관off 유지. 공개 코드/API 응답을 intercept하지 않았다. 중간합류는 합성 시계 이동, 리포트는 실제 participant FK의 합성 completed fixture임을 summary에 명시했다.

## T11 제품 결함3건

1. ConsentSettings 늦은 재조회가 dirty report 선택을 지움: 실제2회·DOM1 RED→필드별 보존, 관련32 PASS 및 실제 PUT/GET GREEN.
2. guest _revoke의 lock_context.populate_existing이 autoflush=False인 운영 세션에서 미저장 entry_ver를 덮음: 실제복구500·PG2 RED→잠금 선행 최소수정, guest관련43 PASS; 연속 merge/recovery/refresh/logout/recovery 확장 후 신규3 PASS. 버전1→2→2→3→4·모든 이전 grant 차단. root API 재시작 후 실제 guest 복구200/단회재사용401/이탈읽기200/로그아웃report404 확인.
3. 타일 체크인/참여는 정확하지만 헤더 접속2/2·체크인0/2: screenshot으로 발견·신규4 RED→server presence/checkinstate로 집계 통일, 밴드 연결 문구 분리. 기존 합성fixture 명시 상태 가산·지속체크인 기대7/8. 관련 FE172 PASS, 실제 접속1/2·체크인1/2·밴드연결0 screenshot/assertion GREEN.

## 변경 파일

- 제품: frontend/src/components/class/structure/member-operations.tsx, backend/app/services/class_guest_service.py, frontend/src/lib/class/host-player-case.ts, frontend/src/lib/class/fixtures/host-cases.ts, frontend/src/components/class/player/host/HostChipLine.tsx.
- 신규: frontend/tests/sdd217-integration-regressions.test.tsx(1), frontend/tests/sdd217-host-summary.test.ts(4), backend/tests/pg/test_sdd217_browser_regressions.py(3).
- 기존 테스트: class-player-host-detail.test.tsx 지속체크인7/8 기대, class-player-host-container.test.tsx 네트워크 시나리오에 서버 connected fixture. 후자는 T11-base 모듈 사본에서도 기존1실패를 먼저 재현했고 unknown 제품표시를 바꾸지 않았다.
- 하네스/fixture: frontend/e2e/sdd217-class-membership.mjs, sdd217-browser-fixture.py. .env 존재 시 fixture 읽기 전 거부. credentials0600/메모리만, output 숨김·합성 watermark.
- docs: specs/sdd-217-class-structure-phase4/summary.md 및 evidence. 원본 spec/verify 사후 수정 없음. 기존 타 태스크 변경·스키마·계약·배포 변경 없음.

## 최종 검증

- 실제 browser23 PASS. 추가 layout-only6 helper step은23에 합산하지 않는다.
- 신규 동의1+기존31=32 PASS; 마지막 집계 관련8files172 PASS. npm run build(tsc-b 포함) exit0, 기존 import/chunk 경고.
- BE guest43 PASS는 신규2 포함. 확장 신규3만 재실행3PASS로 중복 합산하지 않는다. 이후 root 최종 PG217211 PASS7warnings, SQLite6 PASS1warning. root FE63/build는 마지막 집계 수정 전이며 이후172/latestbuild로 덮는 범위를 명시했다.
- 기존 wizard route-mock3 baseline은 T10 이전 App에서도 재현. host-container1 baseline은 T11-base 모델에서도 재현 후 의도한 server connected fixture를 명시해 관련29개 통과. 명령cwd/로비/201/일정충돌 등의 하네스 오류는 제품RED와 구분했다.
- 모든 원문로그·55ID별 증거·뷰포트 시각 링크는 summary와 evidence에 보존했다. 수를 중복 합산하거나 전체 저장소 회귀 통과를 주장하지 않는다.

## 실장치·환경 한계

NV03 실카메라 미측정: system_profiler 카메라 출력없음, Chrome에는 영상입력없음(오디오2개만). 촬영·getUserMedia/fake camera/외부공유 없음. 물리 장치 부재 확정으로 해석하지 않는다. 녹화 on/off·장치복구 실제프레임은 미측정이다. 실제 외부LiveKit·여러WS워커·90초 실제TTL·메일/푸시/Spark전달/cron은 미측정. 정규 다건 DTO N+1 유보. V34 배포미승인·미실행. 55IDs는 PASS51/PARTIAL2/미측정2. root 범위 독립리뷰와 최종승인 남음.

## 독립 리뷰 보완 fix1 — 완료

V30 active 멤버의 4뷰포트 조작 영역 누락을 확인하여 PARTIAL로 낮췄다. 기존 전체 여정이 완료 뒤 left/completed만 촬영했으므로 별도 active 클래스에서 사전 결석·보강·선택 동의 영역을 보완한다. 제품 수정·단위/전체 BE 재실행은 하지 않는다.


보완 결과: `node frontend/e2e/sdd217-class-membership.mjs --active-layout-only`를 지정 localhost 환경에서 실행하여 8 helper 단계 PASS/0 실패(로그인4 포함)를 확인했다. 기존 전체23여정/55ID에 중복 합산하지 않는다. active 전용 클래스에서 미래 사전 결석·보강 신청·선택 동의 활성 영역과 보강 예약 후 취소 버튼을 390×844, 834×1194, 1194×834, 1280×720에 촬영했다. 총20장 모두 view_image로 확인했고 본문 overflow/clipping0이다. 실제 동의200·사전결석200·복귀200·보강201 및 회원 active/예약1도 확인했다.

증거: evidence/T11-active-layout-results.json, T11-active-layout.json, T11-active-layout.log 및 T11-active-{top,attendance,makeup,consents,makeup-reserved}-{viewport}.png. summary와 T11-visual-review.md에 링크했다. 보완 후 V30 PASS, 55IDs PASS51/PARTIAL2/미측정2로 복원했다. 제품 수정·단위/전체 BE 재실행 없음. 변경은 E2E 하네스의 active 전용 진입점·증거·문서뿐이며 scoped 재리뷰는 root 소유다.
