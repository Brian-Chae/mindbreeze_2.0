# SDD-254 — 현장 QR 베타 배포(Android APK·iOS TestFlight)

- 상태: **대표 결정 5건 확정(2026-10-29) → Stage ④~⑥ 진행**. 외부 계정 작업(Play Console·AWS·TestFlight·운영 배포)·머지·메일은 하지 않음(`summary.md`의 '지휘 승인 필요 목록').
- 브랜치: `sdd/254-field-qr-beta-distribution` (develop a7839efe 기준)
- 표기: **[확인]** = 저장소 코드·문서로 확인한 사실 / **[공식]** = Apple·Google 공식 문서 근거(링크) / **[가정]** = 추측, 구현 전 검증 필요.

## 1. 목적

스토어 정식 출시는 천천히 하고, 그 사이 현장 클래스(예: 대구 명상 클래스)에서 **QR 코드 하나**로 참여자가 자기 폰에 앱을 받아 쓰게 한다.

- Android: 운영 서버에 연결되고 Play 출시 키로 서명된 APK를 공개 URL에서 내려받아 설치.
- iOS: TestFlight 외부 테스트 그룹의 공개 링크로 설치.
- 단일 QR → 우리 도메인 랜딩 → 기기(UA)로 분기. 링크가 바뀌어도 QR 재인쇄 불필요.

## 2. 범위

1. **랜딩 페이지**: 운영 웹 `/beta`(또는 `/get`, 대표 결정 불필요·기술 판단). iOS/Android/데스크톱 분기, 버전·설치 안내·"출처를 알 수 없는 앱 허용" 단계 그림, 막혔을 때 문의 경로. 라우트는 `frontend/src/App.tsx`(공개 라우트 영역, `/join` `/support` 와 같은 줄)에 추가 [확인: 현재 `/beta`·`/get` 없음].
2. **다운로드 링크 관리**: 랜딩이 읽는 설정(최신 APK URL·버전·SHA-256·TestFlight 공개 링크)을 한 곳에서 교체. 방식은 plan T-2 (정적 JSON `beta.json` 를 웹과 함께 배포하거나 S3에 별도 보관).
3. **QR 생성**: 랜딩 URL 하나를 인쇄용 SVG/PNG(여유 여백·오류정정 Q 이상)로 생성하는 스크립트와 안내 한 장(A4).
4. **빌드 파이프라인**: `release-build.yml`(현재 웹 산출물 전용 [확인])에 Android 서명 APK 빌드·체크섬·S3 업로드를 추가하거나 별도 워크플로로 분리. iOS는 기존 업로드 경로 유지, TestFlight 외부 그룹 배정은 수동.
5. **버전 관리**: Android `versionCode`(CI `-PversionCode`)·`versionName`, iOS `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION` [확인: 현재 pbxproj 4 / 1.0.0, 패키지 `com.looxidlabs.mindbreeze2` 양 플랫폼 동일]. 베타와 스토어 빌드의 번호 충돌 방지 규칙(§6) 정의.
6. **업데이트 안내**: §7.
7. **현장 운영 런북**: §10.
8. **개인정보·동의**: §11.

## 3. 비범위

- 스토어 정식 출시(Play 프로덕션·App Store 정식 심사) 자체와 그 일정.
- 앱 기능 변경, 자동 앱 내 업데이트(Play in-app update 등).
- 운영 서버 스케일업·도메인 변경.

## 4. 배포 흐름(목표 형태)

```
현장 QR ──▶ https://<운영웹>/beta ──▶ UA 판별
                                   ├─ iOS     → TestFlight 공개 링크(https://testflight.apple.com/join/…)
                                   ├─ Android → 설치 안내 → APK(https://<S3/CloudFront>/beta/mindbreeze-<ver>.apk)
                                   └─ 데스크톱 → "폰으로 다시 스캔" + 웹 로그인 링크
```

- QR에는 랜딩 URL만 넣는다. APK·TestFlight 주소는 랜딩 설정에서만 바뀐다.
- APK 호스팅: S3(+CloudFront 권장). Drive는 100MB 초과 시 바이러스 검사 안내 화면이 끼어 부적합(대표 판단 반영). **APK 크기 [확인 필요]**: 구현 시 실측.
- APK 응답 헤더: `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment` [가정, 검증 항목 verify V-A3].
- 버킷 정책 [확인]: AWS 에는 `mindbreeze-dev` 단일 버킷만 있고 prod 버킷은 없음(메모리). 운영용 공개 배포 버킷·권한은 **신규 설정이 필요**하며 구현 단계에서 별도 승인(T-3).

## 5. Android 서명 호환(핵심 위험)

사실 관계:
- **[확인]** `frontend/android/app/build.gradle` 은 `keystore.properties` 의 키로 release 서명. 이 키가 Play에 올리는 **업로드 키**인지, 앱 서명 키 자체인지는 저장소로 판단 불가 → **구현 전 Play Console 확인 필수**(대표/담당자).
- **[공식]** Play App Signing 을 쓰면 Google 이 **앱 서명 키**를 보관하고, 개발자는 **업로드 키**로 서명해 올린다. 스토어가 배포하는 APK 는 앱 서명 키로 서명된다. 신규 앱은 Play App Signing 이 기본. (https://support.google.com/googleplay/android-developer/answer/9842756)
- **[공식]** Android 는 같은 패키지명이라도 **서명 인증서가 다르면 덮어쓰기 설치(업데이트)를 거부**한다.

→ 결론(추론):
| 경우 | 사이드로드 APK 서명 | 추후 Play 정식 설치본 | 업데이트 호환 |
|---|---|---|---|
| A. 로컬/CI 업로드 키로 서명한 APK 를 그대로 배포 | 업로드 키 | 앱 서명 키 | **불일치 → 사용자가 삭제 후 재설치(데이터 손실)** |
| B. Play Console 이 만든 **서명된 유니버설 APK**(앱 번들 탐색기 → 다운로드) 배포 | 앱 서명 키 | 앱 서명 키 | **일치 → 덮어쓰기 가능** (권장) |
| C. 앱 서명 키를 내보내 CI 서명 | 앱 서명 키 | 앱 서명 키 | 일치. 단 키 내보내기 가능 여부·보안 부담 [가정/확인 필요] |

- B 의 공식 근거: Play Console 의 "Signed, universal APK" 다운로드 [공식, 링크 확인 필요: App bundle explorer 도움말]. 구현 전에 실제 콘솔에서 해당 메뉴 존재·권한 확인.
- B 는 **Play 에 올라간 번들(예: 내부 테스트 트랙)** 에서만 APK 를 뽑을 수 있다 → 베타 빌드도 Play 에 업로드(내부 테스트)해야 함. 프로덕션 공개와는 별개 트랙 사용 가능.
- 추가 주의: 사이드로드 → Play 업데이트 시 **versionCode 가 Play 가 가진 값보다 낮으면 업데이트 불가**. 베타 versionCode 는 장래 Play 정식 빌드보다 **작거나 같지 않게** 단조 증가 관리(§6).

## 6. 버전 번호 규칙과 현재 심사 중 빌드와의 충돌

현재 상태(대표 전달): 심사 중 iOS 빌드 20 · Play versionCode 23(구 버전). dev 시험 빌드 iOS 21 · Android vc6(a7839efe) [dev 변종은 `applicationIdSuffix .dev` 라 별도 앱 — 확인].

- Play: 한 앱 안에서 **versionCode 는 트랙과 무관하게 전역 유일·증가**해야 업로드 가능 [공식 일반 규칙]. 심사 중 vc23 이 있으므로 베타 APK 는 **vc ≥ 24** 이어야 하고, 정식 심사본이 먼저 나가면 그보다 작은 번호는 쓸 수 없다. 규칙안: 베타·정식 모두 같은 증가 순서를 공유(별도 번호대 두지 않음).
- Play 프로덕션 심사 중 vc23 과의 충돌: 내부 테스트 트랙에 더 높은 vc 를 올리는 것 자체는 심사를 막지 않는 것이 일반적 [가정, 콘솔에서 확인]. 단 **정식 출시를 vc23 으로 내보낼 계획이면, 그 뒤 올라가는 정식 빌드가 vc23 보다 커야** 하므로 vc23 은 출시되면 "구 버전"이 된다(이미 대표 인식과 일치).
- iOS: 같은 앱(`com.looxidlabs.mindbreeze2`)에서 빌드 번호는 버전(MARKETING_VERSION) 안에서 유일·증가 [공식 일반 규칙]. 정식 심사 중인 빌드 20 과 TestFlight 외부 베타 빌드는 **같은 App Store Connect 앱의 다른 빌드로 병행 가능**한 것이 일반적이나, 심사 제출된 빌드를 베타 그룹에 쓰는 방식·외부 베타 심사 제약은 [확인 필요]. 규칙안: 베타 빌드는 21 이상.
- TestFlight 외부 테스트 [공식]: 첫 빌드마다 베타 앱 심사(통상 ~1일), 빌드는 업로드 후 90일 유효, 외부 테스터 최대 10,000명, 공개 링크로 초대 가능. (https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview , 공개 링크: https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
- **90일 만료**: 11/초 업로드 시 1월 말 만료 → 정식 출시 또는 재업로드 일정을 성공 기준에 포함.

## 7. 업데이트 안내

- **현재 앱에는 버전 확인/강제 업데이트 기능이 없음** [확인: 백엔드·프론트에 min-app-version 류 검색 결과 없음].
- 1차(필수·저비용): 랜딩에 "최신 버전 N, 내 앱 버전 확인법"과 SHA/날짜 표시. APK 는 같은 파일명 덮어쓰지 않고 버전 파일명 + `beta.json` 의 최신 링크 갱신(캐시 문제 방지).
- 2차(대표 결정 #3 으로 이번에 포함): 앱 시작 시 `beta.json` 조회 → 설치 빌드 번호(Android versionCode / iOS 빌드)가 최신보다 낮으면 "새 버전이 있어요" 배너 → 랜딩(`/beta`) 안내. `updateBannerEnabled=false` 가 기본(게시 전 오작동 방지), 운영자가 새 빌드 게시 시 true. 네이티브 플러그인 추가 없음(`@capacitor/app` 기존).
- 구 APK 사용자 갱신 방법: 같은 서명 키(§5-B) 기준이면 새 APK 를 열어 "업데이트" 로 덮어쓰기. 서명이 다르면 삭제 후 재설치 필요 — 이 경우 로그인 외 로컬 데이터 손실 범위를 런북에 명시.
- iOS: TestFlight 앱이 자동으로 새 빌드를 안내(푸시/앱 내) [공식].

## 8. 출시 전제(게이트)

배포 대상 빌드는 모두 통과해야 한다.
1. **원신호 완결 합격 시험**: iOS·Android 각 30~60분, 중간에 화면 잠금 및 네트워크 1분 단절, 원시 데이터 ≥ 99%, 종료 상태 complete. (기준은 대표 전달값, 측정 절차는 verify V-G1.)
2. 운영 서버 연결 확인(빌드에 운영 API 주소 포함, dev 주소·역할 시뮬레이션 0건 — 기존 `release-build.yml` 게이트 재사용).
3. **운영 서버에 develop 묶음 선반영**: 마이그레이션 `a253b0c1d2e3` 포함 + **운영 `/privacy` 가 최신판(코드 기준 v2.3, 2026-10-26 시행) 이상인지 확인**. (운영 배포는 별도 승인·이번 SDD 범위 밖의 선행 조건.)
4. Android: §5-B 서명 일치 확인. iOS: 베타 앱 심사 통과.

## 9. 대표 결정 (2026-10-29 확정)

| # | 결정 | 반영 |
|---|---|---|
| 1 | **A. 구글 서명 유니버설 APK** | §5-B 채택. CI 는 업로드 키 서명 AAB 만 만들고(`android-beta-aab.yml`), 배포 APK 는 Play Console 에서 내려받아 `scripts/beta-apk-prepare.py` 로 검수 |
| 2 | **A. QR 스캔한 누구나** | 공개 다운로드. 참석 코드 없음. APK 는 SHA-256 표기, 쓰기 권한은 CI/운영자만 |
| 3 | **앱 내 '새 버전 있음' 알림 이번에 포함** | `BetaUpdateBanner` + `beta.json` 의 `updateBannerEnabled`. 구버전 앱에는 없으므로 이 기능이 들어간 빌드(vc≥24)부터 작동 |
| 4 | **A. 11/4 고정** | summary.md 의 역산 일정표 |
| 5 | **A. 기존 약관·처리방침·가입 동의로 갈음** | 랜딩에 '베타 버전, TestFlight 사용 시 Apple에 충돌·사용 정보 공유' 한 줄 추가. **운영 `/privacy` 최신판 확인을 운영 선반영 체크항목에 추가**(현재 코드 `PRIVACY_POLICY_VERSION='2.3'`, 시행 2026-10-26 — 지휘 전달문의 v2.2 보다 최신. 운영이 2.3 이상인지 확인) |

## 10. 현장 운영 런북 요지 (안내 한 장에 들어갈 내용)

- QR 한 개, 만료 없음, 인쇄물에 "사진 속 문제 시: 담당 연락처" 병기.
- Android: ①QR→링크 ②다운로드 ③"출처를 알 수 없는 앱 설치 허용"(브라우저/파일앱별 한 번) ④설치 ⑤Play 프로텍트 경고 시 "그래도 설치" 안내 ⑥마이크·블루투스 권한 안내.
- iOS: ①QR→링크 ②TestFlight 앱 설치(없으면) ③"테스트 시작" ④권한.
- 막히는 지점 목록(예상): 삼성/브라우저별 설치 허용 화면 차이, 회사 MDM 폰, 저장공간 부족, 구버전 OS, TestFlight 이메일/Apple ID 없음, 현장 Wi-Fi 부족 → **LTE 로도 받을 수 있게** APK 용량·CDN 점검, 현장 담당자용 예비 설치 도우미 1인.
- 현장 사전 점검 체크리스트: 랜딩 접속, APK 다운로드 속도, TestFlight 링크 유효(만료/정원), 운영 서버 상태.

## 11. 개인정보·동의

- 베타 앱도 운영 서버·운영 DB 를 쓰므로 정식과 동일한 개인정보처리방침·이용약관이 적용된다 [확인: `/privacy` `/terms` 기존 페이지]. 뇌파·음성 등 민감정보 동의 플로우는 앱 가입 단계 그대로.
- 베타 고유 문구(기능 미완성 가능성, 데이터 이관·삭제 가능성, 문의처) 추가 여부는 대표 결정 #5. 문구 초안은 plan T-4 에서 작성만, 법률 검토는 별도.
- Apple 외부 베타 공개 링크 사용 시 App Store Connect "베타 앱 정보"(연락처, 개인정보 URL, 심사용 계정·메모) 필요 [공식].
- 테스트 계정 정보를 랜딩·QR 에 노출하지 않는다. APK 에 시크릿 포함 금지(기존 `dev-leak` 게이트 + 신규 점검).

## 12. 성공 기준 및 일정 가능성

성공 기준
- 신규 폰(iOS·Android 각 3대 이상, 다른 제조사)이 QR 스캔부터 로그인까지 **5분 이내**, 도움 없이 완료.
- 서명 일치 검증 통과(§5), 원신호 합격 시험 통과 빌드만 배포.
- 링크 교체(새 APK) 후 QR 재인쇄 없이 신규 버전이 노출.
- 현장 후 설치 실패 사유 집계 가능(문의 채널).

크리티컬 패스(11/4 기준 가능성)
1. 대표 결정 #1·#2·#4 → 2. Play Console 서명 구성 확인·내부 테스트 업로드(구글 측 처리 수 시간~1일 [가정]) → 3. 운영 선반영(마이그레이션) → 4. 운영 연결 빌드 생성 → 5. **원신호 합격 시험(양 OS 각 30~60분 + 재시험 여유)** → 6. iOS 베타 앱 심사(~1일) → 7. 랜딩·S3·QR 배포·실기기 검증.
- 랜딩·QR·S3 는 병렬로 1~2일. 병목은 **원신호 합격 + iOS 베타 심사 + 운영 선반영**.
- 평가: 11/4 는 **조건부 가능**(10/30 중 결정·빌드·시험 착수, 10/31~11/1 iOS 베타 심사 제출 시). 시험 실패·서명 구성 확인 지연 시 11/5~6 로 밀림. 정확한 판단은 Stage ③ 승인 후 첫 이틀 결과로 재산정.

## 13. 참고(공식 문서, 링크 유효성은 구현 시 재확인)
- Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756
- Play Console 앱 번들 탐색기/서명된 유니버설 APK: https://support.google.com/googleplay/android-developer/answer/9006925 [링크 번호 확인 필요]
- Android 앱 서명: https://developer.android.com/studio/publish/app-signing
- TestFlight 개요·외부 테스트·공개 링크: Apple 개발자 도움말(위 §6 링크)
