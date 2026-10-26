# SDD-210 Summary — 운영(prod) 환경 구축·배포 워크플로우·컷오버

- 상태: Stage ⑥ Summary — Brian 최종 리뷰 대기 (사후 정리: 2026-10-20 작성)
- 기간: 2026-10-17 ~ 2026-10-18 (커밋 `1fc7217a` ~ `c02ebbc1`)
- 근거: spec/plan/verify, `baseline.md`, `precheck-result.md`, `infra-result.md`, `rehearsal-result.md`, **`cutover-result.md`(운영 컷오버 결과)**, 커밋 기록(`git log --grep 'sdd-210'`)
- 문서·커밋에 기록된 사실만 적는다. 비밀 값은 기록하지 않는다.

---

## 1. 단계별 결과

| 단계 | 내용 | 결과 | 대표 커밋 |
|---|---|---|---|
| Phase A 코드·워크플로 | T-0 기준선, T-1 사전 집계(읽기 전용), T-2 환경 주입 분리(CORS·Socket.IO·fail-fast·S3 인스턴스 역할), T-3 서버 구성 템플릿화, T-4 `release-build.yml`(build-once, dev 주소 0건·마이그레이션 게이트), T-5 `deploy-prod`·`rollback-prod`·`install-release.sh`, T-6 개인정보처리방침 N-6 게이트 점검 | 완료 | `43657a1e` `ed727f07` `0b665ad4` `36efe12e` `bc2f17c9` `b1aee0c5` `0d42995e` |
| Phase B 인프라 | T-7~T-13 AWS CLI 스크립트로 EC2·RDS·S3·IAM·SSM·SG·모니터링 생성, `infra-result.md` | 완료 | `f9f38bcd` |
| Phase C 서버 구성·리허설 | T-14 서버 구성 스크립트, T-15 첫 배포 리허설, T-16 롤백 리허설, T-17 컷오버 리허설(복제본), T-18 PITR 복구 훈련 | 완료 | `0dd1793e` `e3c4fc83` |
| 방침 페이지 | 공개 `/privacy`(시행일 2026-10-22, 버전 1.0), 로그인·가입·클래스 입장 고지·설정 링크, 녹음 보관 기간(원본 90일) 정합 | 완료 | `e7d051be` `36faafae` `055a7d0a` |
| 컷오버 준비 | `deploy/cutover/` 실행 스크립트 세트(C-0~C-10·롤백·점검 페이지·업타임 감시·dry-run), 공지문 초안, 시간표·롤백 기준 갱신, 문의 연락처 `admin-mindbreeze@looxidlabs.com`, 관리자 우회 IP 목록 | 완료 | `c67ca0dc` `52fa809d` `49606cbb` `2f844c8b` `7d924816` |
| **Phase D 컷오버** | **2026-10-18 약 13:50~14:05(≈15분), 빈 운영 환경으로 시작** — `cutover-result.md` | **완료** | `c02ebbc1` |

---

## 2. 리허설 실측 (rehearsal-result.md)

- 첫 배포 리허설: 3회차에 성공. 1회차 SSM 기본 셸(dash) pipefail 오류 → bash 재실행(`13fc1e0d`), 2회차 빈 DB 에 85개 체인 적용 시 `30c1bfbc724f` 드리프트 마이그레이션 실패(중복 테이블·없는 인덱스·기존 컬럼) → 보호 추가(`5bf7eac6`). 3회차 설치 21초, 공개 스모크 9항목 OK. 실패 시 롤백 트랩이 서버 변경 0 으로 동작.
- 롤백 리허설: `rollback-prod` **1분 4초**. 마이그레이션 실패 주입 시 종료 코드 20, 코드·서비스 변경 없음.
- 컷오버 리허설(복제본): dev 스냅샷→KMS 암호화 복사→복원 3분, S3 복사 2,866개/2,187,037,108B **dev 와 정확히 일치**(약 40초), 앱 스모크(로그인·목록·대시보드·리포트 PDF 5.0s 등) 통과.
- PITR 훈련: **RPO ≈ 2분 19초**(목표 5분), **RTO ≈ 9~10분**.
- 점검창 산정: 약 50~60분(이후 컷오버 방침이 바뀌어 사용되지 않음).

---

## 3. 운영 컷오버 결과 (cutover-result.md 요약)

- 릴리스 `20261018-033707-c8d4d8b`. **방침(Brian 확정): 데이터 이전 없음, 사용자 공지·점검창·점검 페이지 없음, 빈 운영 환경으로 시작.** dev 서버·dev 도메인 변경 0건, MIND BREEZE 1.0 접촉 0건.
- 릴리스 검증(sha256, MANIFEST 590파일, `dist/` 에 dev 주소 0건), 임시 설정 원복, Route53 `mindbreeze.`·`api.mindbreeze.` A 레코드 2건 생성(전파 40초), 서버 구성(인증서 SAN 2개, 만료 2027-01-16), `deploy-prod` 승인 후 **3분 17초** 성공, 헬스 `/health/ready` 200, 서비스 8종 active, timer 14개 활성(`retention_sweep`·`research_export` 는 비활성 유지).
- 스모크: 웹 200, CORS(운영 오리진 허용/dev 차단), HSTS, `/api/v1/dev/auth/users` 404, `/privacy` 200, 초기 계정 3종 로그인 → 클래스 생성 → 코드 확인 → 입장 → 취소 정상.
- 업타임 감시: Route53 health check 2개 + SNS + 경보 2개.

---

## 4. 테스트·검증

- verify.md 는 구현 전 승인 문서이며 항목별 통과 표는 따로 작성되지 않았다. 결과는 위 리허설·컷오버 문서의 실측으로 갈음된다.
- 테스트 정리: 폐기된 30c1bfbc724f 구현 전용 SQLite·오프라인 테스트 4건 제거, 체인 불변 가드 유지(`8c5a3c12`, SDD-211 병합 시 SDD-210 수정본 채택 `0a891fdf`).
- 컷오버 결과 문서 기준 **미검증**: 영상 업로드→리포트 생성, LiveKit 화상, 실시간 WebSocket, 푸시(FCM 미설정), Google 로그인 실제 동작, EIP 재부팅 유지(V-1.7), 경보 시험 발화.

---

## 5. 남은 일 · 이월 (cutover-result.md "남은 이슈")

1. SNS 이메일 구독 확인(us-east-1 `mindbreeze-alerts-use1`) — 확인 전에는 업타임 알림이 도착하지 않는다.
2. 초기 계정 비밀번호 교체 권장(로컬 0600 파일, 값 기록 없음).
3. 스모크로 만든 취소 상태 클래스 1건이 운영 DB 에 남음.
4. 위 미검증 항목, 특히 Google 클라이언트에 운영 오리진 등록 여부 확인.
5. 임시 DNS `prod-check`/`prod-api-check` 정리 여부 판단.
6. 빈 DB 체인 vs 모델 autogenerate 차이 12건(경미) 후속.
7. 보관 스위프·연구 내보내기는 승인 전 비활성 유지(`RETENTION_SWEEP_ENABLED=false`, `RESEARCH_EXPORT_ENABLED=false`). 연구 가명 키 오프라인 백업·복원 검증 상태는 이 문서들에 완료 기록이 없다.
8. 이후 SDD-220 의 prod AI 환경변수·retention·사용자 30일 sweep 운영 설정과 이어진다.
