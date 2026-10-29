# SDD-254 Plan — 현장 QR 베타 배포

> spec: `spec.md`. 대표 결정 #1~#5 확정 후 착수. 구현 담당은 트랙별 독립 워커(병렬), 같은 파일 동시 수정 금지.

## 아키텍처 요약
- 단일 QR → `frontend` 공개 라우트 `/beta` → `beta.json`(최신 APK URL·버전·SHA-256·TestFlight 링크) 읽어 UA 분기.
- Android APK 는 S3(+CloudFront) 공개 경로에 버전 파일명으로 보관. 서명은 spec §5-B(Play 서명 유니버설 APK) 기준.
- 빌드/번호 규칙은 spec §6.

## Task 표

| # | Task | 담당 파일(예상) | 담당 | 선행 |
|---|---|---|---|---|
| T-0 | Play Console 서명 구성 확인(업로드 키 vs 앱 서명 키, 유니버설 APK 메뉴 권한) — **사람 작업** | (문서 `fix-notes`/summary 기록) | 대표/담당자 | 결정 #1 |
| T-1 | `/beta` 랜딩 페이지(UA 분기, 안내 단계, 데스크톱 안내, 접근성, 모바일 우선) | `frontend/src/pages/BetaLandingPage.tsx`, `frontend/src/App.tsx`(라우트 1줄), `frontend/tests/` | FE 워커 | — |
| T-2 | `beta.json` 스키마·배포 방식(웹 정적 파일 vs S3 별도), 캐시 정책, 링크 교체 스크립트 | `frontend/public/beta.json` 또는 `scripts/beta-publish.sh`, 스키마 문서 | FE/DevOps 워커 | T-1 |
| T-3 | 공개 다운로드 버킷/CloudFront·권한·헤더 설정(IaC 또는 `deploy/aws/` 스크립트), 업로드 전용 권한 | `deploy/aws/t-beta-apk-hosting.sh`(신규), 필요 시 IAM | DevOps 워커 (**AWS 쓰기는 건별 승인**) | 결정 #2 |
| T-4 | 베타 안내/동의 문구 초안(랜딩 하단, 설치 안내, 약관 링크) | `frontend` 랜딩 문구, `docs/` 초안 | 기획 워커 | 결정 #5 |
| T-5 | Android APK 빌드·체크섬·업로드 워크플로 (운영 API 주소 주입, dev-leak 게이트 재사용, versionCode 자동 증가 규칙) | `.github/workflows/release-build.yml` 확장 또는 `.github/workflows/android-beta.yml`(신규), `frontend/android/app/build.gradle` (인자만) | CI 워커 | T-0, T-3 |
| T-6 | iOS 베타 업로드 경로 정리 + TestFlight 외부 그룹·공개 링크·베타 앱 정보 체크리스트(설정 변경은 수동·승인) | 런북 문서 | 운영 | 원신호 합격 |
| T-7 | QR 생성 스크립트(SVG/PNG, 오류정정 Q, 여백) + 인쇄용 안내 A4 | `scripts/make-beta-qr.*`, `docs/` 안내 시안 | 디자인 워커(Claude/Gemini) | T-1 URL 확정 |
| T-8 | 현장 런북(점검표·막히는 지점·연락 체계) | `specs/sdd-254-…/runbook.md` | 기획 워커 | — |
| T-9 | (선택, 결정 #3) 앱 시작 시 최신 버전 확인 배너 | `frontend/src/` 앱 부트스트랩, `beta.json` 사용 | FE 워커 | 결정 #3 |
| T-10 | 검증 전담: verify 체크리스트 실행, 실기기 시험, 서명 비교 | `specs/…/summary.md` | **검증 워커(구현자와 분리, Gemini)** | T-1~T-8 |

병렬 트랙: [T-1,T-2,T-4,T-7(초안)] FE/디자인 / [T-3,T-5] DevOps/CI / [T-0,T-6,T-8] 사람·운영. 마이그레이션 변경 없음.

## 순서와 일정(목표, spec §12)
D0 결정·T-0·T-1 시작 → D1 T-3/T-5 + 운영 선반영(별도 승인) → D1~2 원신호 합격 시험, iOS 베타 심사 제출 → D2~3 T-7/T-10 → 현장 투입.

## 위험과 완화
| 위험 | 완화 |
|---|---|
| 서명 불일치로 추후 Play 업데이트 불가 | T-0 선행, 방식 B, verify V-S* 로 인증서 지문 비교 |
| 원신호 합격 지연 | 합격 빌드만 배포; 지연 시 일정 재산정 |
| iOS 베타 심사 지연/거절 | 심사용 계정·메모 사전 준비, 제출 D1 |
| TestFlight 90일 만료 | 만료일을 런북·랜딩 관리표에 기록, 만료 14일 전 재업로드 |
| APK 공개로 변조본 유통 | SHA-256 표기, HTTPS, 버킷 쓰기 권한 제한 |
| 운영 선반영 미완료 | 게이트 3(spec §8) 선행 확인 |

## 금지(전 Task 공통)
푸시·머지·운영 배포·메일 발송·스토어/TestFlight 설정 변경은 대표 승인 건별. AWS/Play/App Store Connect 쓰기 동작은 사전 승인.
