# SDD-254 Summary — 현장 QR 베타 배포

## 구현 결과 (코드로 끝낼 수 있는 범위)
| 항목 | 파일 |
|---|---|
| `/beta` 랜딩(iOS/Android/데스크톱 분기, 설치 단계, TestFlight 정보공유 한 줄, 약관·처리방침 링크), `/get`→`/beta` | `frontend/src/pages/BetaLandingPage.tsx`, `frontend/src/App.tsx` |
| `beta.json` 스키마·검증(https만, sha 형식)·UA 판별·버전 비교 | `frontend/public/beta.json`, `frontend/src/lib/beta/beta-config.ts` |
| 앱 내 "새 버전 있음" 배너(네이티브만, 기본 꺼짐, 닫기 기억) | `frontend/src/lib/beta/use-beta-update.ts`, `frontend/src/components/beta/BetaUpdateBanner.tsx` |
| QR 생성(SVG/PNG, 오류정정 Q, https만) | `scripts/make-beta-qr.mjs` (`qrcode` devDependency 추가) |
| 유니버설 APK 검수(패키지·vc≥24·debuggable·인증서 대조) + beta.json 갱신본 생성 | `scripts/beta-apk-prepare.py` |
| 업로드 키 서명 AAB 빌드(수동, vc≥24 강제, 운영 주소 주입, dev 흔적 검사) | `.github/workflows/android-beta-aab.yml` |
| 런북 | `runbook.md` |

## 테스트 (실제 실행)
- vitest `sdd254-beta.test.ts` 8/8, pytest `test_sdd254_beta_apk_prepare.py` 3/3, `tsc --noEmit` 0 오류, `npm run build` 성공(dist 에 beta.json 포함), dev 흔적 검사 0건.
- 실브라우저(vite preview, UA 에뮬레이션): Android → "Android 설치(APK)"+APK 링크+SHA 표시, iOS → TestFlight 링크, 데스크톱 → "휴대폰으로 다시 스캔", `/get` → `/beta`. 링크 비어 있으면 "준비 중" 표시.
- QR 스크립트: 생성 확인(SVG/PNG), http 주소 거부(rc=1).
- 전체 vitest: 17건 실패 — **변경 전(스태시) 동일 8개 파일 17건 동일 실패**, 이번 변경과 무관(사전 존재).
- **미검증**: 배너의 실기기 동작(네이티브에서 `App.getInfo().build` 값 형식·표시), APK/AAB 실제 빌드(시크릿 없음, CI 미실행), `beta-apk-prepare.py` 의 실제 APK 대상 실행(aapt/apksigner 로컬 미설치 — 파서만 단위 검증).

## 알아둘 점
- 배너 작동 조건: 이 코드가 들어간 빌드(vc≥24 / iOS 신규 빌드)부터. 이미 배포된 구버전에는 배너 없음 → 구버전은 QR 재스캔.
- `updateBannerEnabled` 기본 false. 새 빌드 게시 시 true 로 바꾸되 `ios.latestBuild`/`android.versionCode` 가 실제 게시본과 맞는지 먼저 확인.
- `beta.json` 은 웹 배포(Deploy Prod) 때만 갱신됨 → 즉시 교체가 필요하면 S3 별도 보관으로 전환(승인 필요).
- 운영 `/privacy`: 코드는 v2.3(2026-10-26). 운영이 이 값 이상인지 확인(선반영 체크).
- 사전 존재: 로컬 python 3.9 → 스크립트에 `from __future__ import annotations` 적용.

## 지휘 승인 필요 목록 (정확한 절차)
1. **Play Console 서명 확인(T-0)**: Play Console → 앱 → 설정 → 앱 무결성 → 앱 서명. ① 'Play 앱 서명 사용 중' 확인 ② '앱 서명 키 인증서' SHA-256 기록(`--expect-cert` 값) ③ '업로드 키 인증서' 지문이 현재 `keystore.properties` 키와 같은지 대조 ④ 릴리스 → 앱 번들 탐색기 → 해당 vc → 다운로드 탭 → '서명된 유니버설 APK' 가능 여부.
2. **업로드 키 시크릿 4종 설정**: 저장소 Settings → Secrets → `ANDROID_KEYSTORE_BASE64`(업로드 키스토어 base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. (값은 에이전트가 다루지 않음)
3. **AAB 빌드 → Play 내부 테스트 업로드**: Actions → "Android Beta AAB" 수동 실행(ref=원신호 합격 커밋, version_code≥24) → 아티팩트 AAB 를 Play 내부 테스트 트랙에 업로드 → 번들 탐색기에서 유니버설 APK 다운로드.
4. **APK 검수**: `python3 scripts/beta-apk-prepare.py <apk> --apk-url https://<공개URL>/beta/mindbreeze-<ver>.apk --expect-cert <Play 앱 서명키 SHA-256>` (aapt2·apksigner 필요).
5. **AWS 공개 버킷**: 운영 계정에 공개 읽기 `beta/` 접두사 전용 버킷(+CloudFront 권장), `Content-Type: application/vnd.android.package-archive`, 쓰기는 운영자/CI 역할만, 목록 노출 금지. 신규 리소스 생성이므로 건별 승인.
6. **TestFlight**: App Store Connect → TestFlight → 외부 그룹 생성 → 합격 빌드 배정 → 베타 앱 정보(연락처·개인정보 URL·심사 메모/계정) 입력 → 베타 심사 제출 → 통과 후 '공개 링크' 활성화(정원 설정) → `beta.json.ios.testflightUrl/latestBuild/expiresAt`(업로드+90일) 기록. 심사 중 빌드 20 과 공존 여부 화면에서 확인.
7. **운영 선반영**: develop → main 머지(별도 승인) → Deploy Prod, 마이그레이션 `a253b0c1d2e3`, `/privacy` v2.3 확인.
8. **원신호 합격 시험(실기기)**: iOS·Android 각 30~60분, 잠금·1분 단절, 원시 ≥99%, complete.
9. **beta.json 게시**: 채운 값으로 갱신 후 웹 배포(또는 S3 별도 보관), 마지막에 `updateBannerEnabled=true`.

## 11/4 역산 일정표 (조건부)
| 일자 | 할 일 | 의존 |
|---|---|---|
| 10/29(목) | 본 PR 리뷰·Ready, 대표 승인 → Play 서명 확인(1), 시크릿(2) | 대표/담당자 |
| 10/30(금) | 운영 선반영(7) 승인·실행, 합격 후보 커밋 확정, AAB 빌드(3), TestFlight 업로드 | 선반영 |
| 10/31(토) | iOS 베타 심사 제출(6), 원신호 합격 시험 1차(8) | 심사 ≈1일 |
| 11/1(일) | 시험 결과 확정(실패 시 재빌드 → 재시험), 유니버설 APK 검수(4), 버킷(5) 생성 | 시험 |
| 11/2(월) | beta.json 게시(9), 실기기 설치 시나리오 verify(iOS·Android 각 3대), QR 인쇄·인식 | iOS 심사 통과 |
| 11/3(화) | 리허설(런북), 예비 | |
| 11/4(수) | 현장 투입 | |
**데드라인 위험**: 10/31까지 iOS 심사 제출 못하면 11/4 불가. 시험 실패 시 1일 이내 재시험 여유는 11/3 하나뿐 → 사실상 예비 1일.
