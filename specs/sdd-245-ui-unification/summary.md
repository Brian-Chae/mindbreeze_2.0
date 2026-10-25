# SDD-245 구현 요약 (Stage ⑥)

- 브랜치 `sdd/245-ui-unification` · 결정 D1(몰입 플레이어 제외)·D2(관리자도 같은 토큰)·D3(읽기·폼 폭 유지, 외곽 여백·제목만 통일) 반영.
- 화면 구성·문구·기능·API 변경 없음. 로그인 화면·클래스 몰입 플레이어 소스 변경 없음.

## 커밋
| Task | 내용 |
|---|---|
| A | 토큰(`design-system/tokens/ui/page.json`, `radius-lg` 20px를 CSS·Tailwind preset과 일치, 프레임 별칭), `components/ui/*`(Button·ButtonLink·ButtonAnchor·Card·Input/Select/Textarea·PageFrame·PageHeading, 클래스 생성기), structure 셸 gutter 16/32/40, 회원 클래스 프레임 1200·gap 24 |
| B | 회원: 리포트·참여 프로필·세션 목록의 이중 gutter 제거, 주 CTA·입력 공용 규격 |
| C | 상담사·공통: 클래스/세션 래퍼 1152→1200, 회원 초대·자격증명 제목·카드·CTA, 요약/클래스 리포트 모바일 여백 16, 주 CTA 32곳 이관 |
| D | 기관·플랫폼·데이터 센터: 안쪽 padding 이중 적용 제거, 기관·플랫폼 홈 CTA/카드를 공용 규격(D2), `/org/*` 제목 22/700 |

## 토큰 (정본)
gutter 16(모바일)/32(태블릿)/40(데스크톱) · 콘텐츠 최대폭 1200(=1280 border-box) · 섹션 gap 24 · 제목 22/700 · 카드 radius 20·padding 24·border #E8E2ED · 주 CTA pill #5F0080 높이 48(모바일)/44(데스크톱) · secondary/ghost radius 12 · 입력 48/44·radius 12·테두리 #857E8F(경계 대비 3.9:1) · 탭 44 · 칩 28+.
참고: 토큰 생성기(style-dictionary)는 이 저장소에 설치돼 있지 않고 체크인된 preset은 수기 관리라, 생성물 3종(JSON·base.css·preset)을 같은 값으로 직접 수정하고 `tests/sdd245-token-contract.test.ts`로 일치를 고정했다.

## 검증 결과 (verify.md 시나리오)
- **홈 회귀**: 회원·상담사 홈 4표본(390/1440) 비교 항목 전체 변경 0(`audit/after/home-regression.txt`). 768/1024/1920 회원·상담사 홈도 변경 0. 기관·플랫폼 홈은 D2에 따라 CTA(42→44/48, pill)·카드(16→20)가 의도적으로 바뀜.
- **홈 대비 허용폭 ±1px (324표본 중 평가 292, 범위 밖 32)**: 엄격 충족 **155/292**(변경 전 같은 기준 124/292). 승인 예외 포함 292/292, 미충족 0. 예외 내역(읽기 폭 23·독립 레이아웃 114, 사유 표 `audit/after/assert-result.md`): 공개 비로그인 화면 54, 채팅 분할 19, AppShell 밖 독립 화면 10, 마법사·온보딩·초대 수락·세션 생성 등. 범위 밖 32 = 시안·몰입 플레이어·404·권한/토큰 안내 상태.
  - 판정 규칙(`audit/style-targets.json`)은 구현 후 결과를 보고 예외 목록을 확정했다. 엄격 충족률과 예외 포함 충족률을 함께 읽을 것.
- **제목 22/700**: 188/234 표본(나머지는 독립 레이아웃의 자체 제목·랜딩 등).
- **보조 폭 768/1024/1920**: 51표본 가로 넘침 0, 셸 시작선 32/40 전환 정상.
- **버튼 AA**: 공용 토큰 조합 22종·경계 3종 전부 통과(`audit/after/contrast.md`, primary 11.68:1 등). 실제 컨트롤 3,676개 중 미달 715(변경 전 729): 대부분 기존 비활성 탭/내비·랜딩 흐린 글자 등 이관하지 않은 요소라 남은 불일치로 기록.
- **컴포넌트 대표값(크게 거친 지표)**: 주 CTA pill·44~48 규격 18→55/152, 카드 radius 20: 32→72/229. 대표 선택 휴리스틱이 텍스트 링크를 primary로 분류하는 경우가 있어 하한 지표.
- **테스트**: vitest 전체 3,048건 중 통과 3,031 / 실패 17(278파일 중 8) — 기준선과 실패 이름 17건 동일, 신규 실패 0(`audit/after/vitest-after.txt`). 신규 테스트 4파일(token-contract·ui-primitives·member/host/admin styles) 통과. `tsc --noEmit -p tsconfig.app.json` 오류 0, `eslint src/` 오류 0, `npm run build` 성공. 기존 테스트 단언 수정 없음.
- **캡처**: 대표 불일치 10곳 [홈|변경 전|변경 후] `audit/after/compare-*.png`, 전체 after 캡처는 /tmp/sdd245-after/captures(재생성: `AUDIT_OUT=… node audit/measure.cjs`). 몇 장 육안 확인(클래스 1440, 회원 초대 390, 데이터 센터 1440).

## 남은 불일치·한계
- 호스트 클래스 행 등 `components/class/structure/*` 내부 버튼·카드(자체 CSS)는 외곽 폭만 맞추고 컴포넌트 규격 이관은 일부.
- 설정·알림·프로필(672)·회차 상세(960)·리포트 문서 폭은 D3로 유지, 본문이 중앙 정렬이라 홈 시작선과 다름(셸 시작선은 일치).
- `/credentials`, `/clients/invite`, `/org/*` 등 AppShell 밖 독립 화면은 셸 편입 시 화면 구성이 바뀌므로 제외(제목·카드·CTA 토큰만 적용). 후속 SDD 후보.
- 공개 가입·찾기·약관의 `font-light` 큰 제목은 로그인과 맞춰 유지. 마법사·몰입 다크 입력(`fl-*`/`fm-*`)은 제외.
- `fieldClass`/`buttonClass`에 클래스 병합(twMerge)이 없어 `w-full`·`whitespace-nowrap`을 덮으려면 `!w-auto`/`!whitespace-normal`이 필요(D 파일 일부에서 사용). 후속으로 병합 도입 검토.
- 기관 모달·기관 상담사 브라우저 테스트 3건은 서버 필요·기준선 실패라 전후 비교 불가(vitest 전체 실행에서는 기존 실패 이름 동일).
- fixture 합성 데이터 기준 측정이며 실기기·실서버 검증이 아니다.

## 재현
```bash
export AUDIT_BUILD_INFO=/tmp/sdd245-final-build.json AUDIT_OUT=/tmp/sdd245-after
node specs/sdd-245-ui-unification/audit/build.cjs
AUDIT_WIDTHS=390 node specs/sdd-245-ui-unification/audit/measure.cjs   # 1440 도 동일
python3 specs/sdd-245-ui-unification/audit/summarize.py $AUDIT_OUT
node specs/sdd-245-ui-unification/audit/assert-styles.cjs --measurements=$AUDIT_OUT --tolerance=1
node specs/sdd-245-ui-unification/audit/compare-homes.cjs $AUDIT_OUT
node specs/sdd-245-ui-unification/audit/contrast.cjs $AUDIT_OUT
```
