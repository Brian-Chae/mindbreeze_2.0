# 상담사 상단바 클래스 입장 코드 — 디자인 검토

제품 코드 구현 전 시안. Brian 선택 후 별도 구현 지시를 기다린다. 이번 변경은 이 디렉터리만이며 커밋·푸시·PR·배포는 하지 않았다.

## 열기와 비교

`index.html`을 Chrome에서 직접 연다. 외부 네트워크/서버 없이 동작한다. 1440·1194·390px에서 같은 3안이 반응한다. PNG는 각 폭의 전체 비교 화면이다.

- A 균형형 카드(추천): 24px 숫자 + 복사. 기존 화면과 조화롭고 불러주기 쉬움. B보다 강조 약함.
- B 숫자 강조형: 밝은 브랜드 크림 카드 + 36px 숫자(모바일 28px). 가장 눈에 잘 띄지만 진행 정보보다 강할 수 있음.
- C 가리기 포함형: 24px 숫자 + 수동 가리기. 공유·녹화 시 노출 제어 가능하지만 조작 증가.
- 모두 숫자별 공백으로 `0 4 8 2` 표시. 복사값은 `0482`. 실제 고객 코드가 아닌 샘플이다.
- 코드 누르면 크게 보기(dialog / Esc·닫기), 복사 성공 후 2초 `복사됨` 및 상태 메시지, 실패 안내 제공.
- 모바일은 닫기 / 코드 / 종료를 첫 줄, 제목·시간·인원을 두 번째 줄에 배치. 종료 왼쪽 코드 위치 유지.

## 현재 코드와 데이터 근거

- `frontend/src/components/class/player/host/HostTopBar.tsx`: 현재 오른쪽 종료 버튼만 표시. 코드 prop 없음.
- `frontend/src/lib/api/session.ts:244`: `getSession` → `GET /sessions/{id}`, `SessionDto.access_code: string | null`(42행).
- `backend/app/services/session_service.py:145`: 세션 응답의 access_code는 `class_code_service.display_code(object_session(s), s)`.
- `backend/app/services/class_code_service.py:171`: 활성 부모 클래스가 있으면 부모 `Class.access_code`, 비활성이면 null, 부모 없는 세션이면 `Session.access_code` 반환.
- `frontend/src/components/class/player/host/HostLiveContainer.tsx:335`: 이미 `session.access_code ?? ''`를 `meta.accessCode`로 넘긴다.
- `frontend/src/components/class/player/host/HostLiveView.tsx:81,159,222`: meta 타입과 기존 초대 시트에 코드가 있음. 상단바에는 아직 전달하지 않음. 기존 `codeCopied`, `actions.copyCode` 재사용 검토.
- `frontend/src/pages/classes/instant-class-share.tsx:13-15`: `getClass(result.class_id)`의 `detail.host_view.access_code`. `ic-code`로 원문 표시, 미확인 시 `확인 중…`, 복사 버튼은 코드 없으면 비활성. 성공·실패 메시지 처리. 플레이어와 같은 클래스 코드를 다른 응답에서 받는다.
- `backend/app/services/class_code_service.py:1-46`: ASCII 숫자 4자리 문자열. 선행 0 유지. 정수 변환 금지. 활성 클래스 사이 유일하며 종료 후 재사용 가능.
- `backend/app/services/class_write_service.py:265,426`: 즉석 여부와 별개로 활성 생성 및 초안 발행 시 코드 발급. 일반 예약 클래스도 코드 있음. 초안은 발행 전 코드 없을 수 있음.

## 표시 규칙 제안

- 정상 4자리일 때만 표시. 코드 없음(null/빈 값), 형식 불일치 시 코드 카드·복사·확대 버튼 전체 생략. `0000` 가짜 대체값이나 로딩 안내를 영구 표시하지 않음. 시안 상단에서 코드 없음 상태 확인 가능.
- 조회 중에는 코드를 추측하지 않음. API 오류는 기존 오류 처리로 대응. 최종 구현 시 종료·비활성 화면에서는 입장 가능하다고 오해할 표시를 하지 않도록 검증.
- 탭/전체 화면 녹화·공유에는 코드가 보일 수 있음. 미디어 트랙만 녹화하는 경우 UI 포함 여부는 별도 확인 필요. 자동 숨김은 기본 미적용 권고(코드를 보여 주려는 공유까지 방해). 수동 숨김은 C안 또는 A의 선택 기능.
- 크게 보기는 상담사가 의도적으로 연다. 숨김 중에는 확대·복사 비활성. 코드는 멤버에게만 전달하도록 확대 화면에 안내.

## 후속 구현 예상 변경 파일

- `frontend/src/components/class/player/host/HostTopBar.tsx`: 코드·복사 상태/콜백 prop, 버튼과 확대 접근성 UI.
- `frontend/src/components/class/player/host/HostLiveView.tsx`: 기존 meta 및 복사 액션 연결, 확대/가리기 상태 관리.
- `frontend/src/components/class/player/host/host-player.css`: 상담사 전용 코드 UI와 모바일 두 줄 레이아웃. 공유 PlayerTopBar/member 영향 최소화.
- 필요 시 호스트 전용 레이아웃 modifier와 기존 테스트 파일 보강. 현재 중앙 정렬/좌우 대칭 규칙을 데스크톱에서는 유지하고 모바일 두 줄 예외를 승인안에 명시.
- 백엔드 변경 불필요. 추가 클래스 상세 API 호출도 불필요. 기존 코드 갱신/회전 시 플레이어 query 갱신은 구현 단계에서 확인.

## 디자인 재사용

`player-tokens.css`의 실제 플레이어 `--font` 스택, `--tx-hi #F7F4F0`, `--tx-mid #CFC6D6`, `--sheet-bg`, `--sheet-border`, `--mb-pale #D2AEFC`, `--mb-purple-cream #F5EDFC` 사용. 플레이어는 DESIGN.md 전역 Inter와 달리 Pretendard 계열 UI 폰트이므로 해당 스택을 우선 재사용(로컬에 없으면 시스템 폰트). 배경은 기존 `frontend/public/images/background1.webp`(1920×1152). 블러/외부 이미지/외부 폰트 로딩 없음. 상단은 기존 자연 이미지와 보라 스크림 맥락을 재현한 시안이며 제품 컴포넌트의 픽셀 단위 복제는 아니다.

## 검증

로컬 설치 Google Chrome 실행 파일 + Playwright headless 사용. 제품 서버·DB 접속 없음.

- `preview-1440.png`, `preview-1194.png`, `preview-390.png`: 세 안 비교.
- `expanded-1440.png`, `expanded-1194.png`, `expanded-390.png`: 확대 상태.
- `copied-1440.png`: 복사 성공 피드백(Clipboard API 모의).
- 3개 폭 × 3안에서 document 가로 넘침 없음, 버튼 상단바 경계 이탈 없음, 제목/오른쪽 액션 겹침 없음(DOM rect 검사).
- 확대 열기·닫기, C 가리기, 코드 없음 전체 생략 확인. 배경 이미지 decode 성공.
- 복사 검증은 Clipboard API 모의로 원문 `0482`와 성공 피드백을 확인했으며 OS 클립보드 권한/실기기 검증은 아니다.
- 모바일·태블릿 PNG 육안 확인. 앱 통합/LiveKit/실제 녹화·화면공유 검증은 미실시(디자인 단계).

## Brian 결정 항목

1. 기본 디자인: A(추천) / B / C.
2. 크게 보기: 포함(추천) / 제외.
3. 녹화·화면공유 노출 대응: 항상 표시(단순) / 수동 가리기 추가(추천) / 자동 숨김 정책 별도 설계.

선택은 디자인 결정이며 제품 구현 승인으로 간주하지 않는다.
