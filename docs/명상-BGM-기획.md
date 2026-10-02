# Mind Breeze 2.0 — 명상 BGM(배경음) 개선 기획안

> 작성: 2026-10-02 · Brian 브리프 반영 (기존 개선 10 "명상 가이드·BGM 동기 재생" 수정)
> 범위: BGM 카탈로그(10종 루프 음원) → 대기실 자동 재생 → 진행 중 무재생(전문가 자체 사운드)
> 상태: **구현 완료 (2026-10-02)**

---

## 1. 배경 & 문제

현행 BGM(개선 10)은 실사용에 적합하지 않다.

| 문제 | 원인 |
|---|---|
| **소리가 이상함** | 현재 BGM이 실제 음악이 아니라 Web Audio로 합성한 **정현파 드론 2종**(432Hz·528Hz)뿐. "음악"이 아니라 단조로운 톤. |
| **트랙 수 부족** | 기본 카탈로그 2종. URL 트랙은 환경변수(`CLASS_AUDIO_TRACKS_JSON`)에 등록해야 하고 현재 비어 있음. |
| **재생 타이밍이 어긋남** | 대기·진행 구분 없이 호스트가 수동으로 트는 구조. 실제 명상센터 관행과 다름. |

명상센터의 실제 운영 관행:

- **대기 시간**: 참가자가 모이는 동안 잔잔한 음악을 깔아 분위기를 만든다.
- **명상 진행 시간**: 명상 전문가(지도사)가 **자체 사운드(가이드 음성·자체 음원)**를 별도로 실행한다. 플랫폼이 끼어들어 BGM을 자동으로 틀면 오히려 방해가 된다.

---

## 2. 방향 (3원칙)

1. **BGM = 대기실 앰비언트 음악.** 루프 가능한 실제 명상 음악 **10종**으로 교체. 합성 드론은 폐기.
2. **대기 중(`open`)**: 플랫폼이 자동으로 BGM 재생.
3. **진행 중(`in_progress`)**: 플랫폼은 BGM을 자동 재생하지 않음. 대기 BGM은 전환 시 자동 페이드아웃·정지. 이후 사운드는 **명상 전문가가 자체 실행**.

> 기존 개선 10의 "호스트 수동 가이드·BGM 동기 재생"은 위 원칙과 충돌하는 부분이 있어 **역할을 축소하거나 제거**한다(§7 결정 사항).

---

## 3. BGM 카탈로그 — 10종

> ✅ **생성 완료 (2026-10-02)** — Stable Audio 3.0 Small(433M) · DGX Spark 자체 호스팅. 각 55초 seamless loop(5초 크로스페이드) + 피크 정규화(-1dBFS). 파일: `frontend/public/bgm/bgm-*.{flac,mp3}` (10종 × FLAC 마스터 + MP3 320k). 호스팅은 S3 + CloudFront(구현 시 업로드).

| # | track_id | 제목 | 테마/구성 | 길이(루프 주기) |
|---|----------|------|-----------|-----------------|
| 1 | `bgm-forest` | 고요한 숲 | 새소리·바람 + 잔잔한 현악 | 55초 |
| 2 | `bgm-ocean` | 잔잔한 파도 | 파도 소리 + 저음 패드 | 55초 |
| 3 | `bgm-rain` | 빗소리 | 부드러운 빗소리 + 멜로디 | 55초 |
| 4 | `bgm-singing-bowl` | 싱잉볼 | 티베트 싱잉볼·차임 | 55초 |
| 5 | `bgm-healing-432` | 432Hz 힐링 | 432Hz 기반 악기 연주(순수 톤 아님) | 55초 |
| 6 | `bgm-piano` | 피아노 명상 | 느린 피아노 단선율 | 55초 |
| 7 | `bgm-string-drone` | 현악 드론 | 현악 패드·드론(긴장 이완) | 55초 |
| 8 | `bgm-morning-birds` | 새벽 새소리 | 새벽 새소리 + 실내 앰비언트 | 55초 |
| 9 | `bgm-wind-chime` | 바람 차임 | 윈드차임 + 미세한 바람 | 55초 |
| 10 | `bgm-ambient` | 심신이완 앰비언트 | 무테마 앰비언트(중립 기본) | 55초 |

### 요구 사항

- **루프 무결점(seamless loop)**: 곡 끝↔처음이 자연스럽게 이어져야 함. HTMLAudioElement `loop`는 미세 공백이 생길 수 있으므로, **원본 음원을 루프-레디(무공백)로 준비**하거나 프론트에서 짧은 크로스페이드 처리.
- **출처**: 로열티프리 명상 음원 라이브러리(무료: Pixabay Music 등 / 유료: Artlist·Epidemic Sound 등). **라이선스 확보가 선행** (§7-1).
- **호스팅**: S3 + CloudFront **공개 URL**(무인증 재생). `GET /class/audio-tracks`가 무인증이므로 공개 접근 가능해야 함.
- **`source: url`** 트랙. 기존 내장 톤(`tone`) 2종은 기본 카탈로그에서 **제거**(또는 자산 로드 실패 시 폴백으로만 유지).

---

## 4. 재생 정책 (상태별)

| 세션 상태 | BGM 동작 | 주체 |
|---|---|---|
| `open` (대기) | **자동 재생** · 무한 루프 | 플랫폼 (호스트·회원 각자) |
| `in_progress` (진행) | **자동 재생 없음** · 대기 BGM 페이드아웃 후 정지 | — (명상 전문가 자체 사운드) |
| `paused` | 정지 유지 (재개 시에도 자동 재생 안 함) | — |
| `completed` / `cancelled` | 정지 | — |

### 전환 동작

```
open ──[시작하기]──▶ in_progress
   BGM 재생 중          → 1.5초 페이드아웃 → 정지
```

- 호스트 대기실·회원 대기실 양쪽 모두 `open` 진입 시 자동 재생.
- `in_progress` 전환 시 진행 중이던 BGM은 자동 페이드아웃·정지. 이후 재개(`paused→resume`)해도 자동 재생하지 않음.

---

## 5. UX

### 5-1. 호스트 대기실 (ClassPlayerPage, `open` 씬)

- 대기실 진입 시 기본 BGM 자동 재생.
- 우측 하단 **BGM 미니바**: 현재 트랙명 + 재생/일시정지 + 볼륨(모니터) + 트랙 선택(10종).
- 트랙 변경 시 회원 화면도 함께 바뀌도록 **경량 브로드캐스트**(기존 `class:audio_sync` 재사용)로 전파.

### 5-2. 회원 대기실 (ClassWaitingRoom, 입장 전 준비)

- 대기실 진입 시 기본 BGM 자동 재생.
- 상단/하단 **BGM 미니바**: 트랙명 + 볼륨 + 음소거. (재생 제어 없음 — 호스트가 선택한 트랙을 따름)
- 라이브 뷰 진입 시 대기실 BGM은 자연 정지(컴포넌트 언마운트).

### 5-3. 진행 중 (GuestMeditationPanel, `in_progress`)

- BGM 미니바 **미표시** (또는 "전문가 안내에 따라 진행" 안내만). 플랫폼이 소리를 깔지 않음.

### 5-4. 자동재생 정책 대응

- 브라우저 자동재생 정책으로 무음이 될 수 있음 → 기존처럼 "여기를 눌러 소리 켜기" 버튼 표시(사용자 제스처로 재개).
- 기본 볼륨은 조용하게(예: 30~40%), 회원별 개별 조절·기억(`AUDIO_VOLUME_STORAGE_KEY` 재사용).

---

## 6. 백엔드 / 데이터 영향

| 항목 | 변경 |
|---|---|
| 트랙 카탈로그 | `class_audio_service.py` 내장 톤 2종 → **URL 트랙 10종**(S3/CloudFront 공개 URL)으로 교체. `_BUILTIN_TRACKS`를 URL 트랙으로 재구성(환경변수 의존 제거 권장) |
| 트랙 스키마 | 변경 없음(`AudioTrackResponse` 재사용). `kind`는 `bgm` 유지. |
| `GET /class/audio-tracks` | 변경 없음(무인증 유지). 응답에 10종 반환. |
| 재생 동기 | `class:audio_sync` 재사용 가능(대기실 트랙 선택 전파). 진행 중 호스트 재생 제어는 서버 검증에서 제외 여부 결정(§7-2). |
| 신규 필드 | **없음**. 기본 트랙 지정은 프론트 상수 또는 카탈로그 첫 항목으로 처리. |

> DB 마이그레이션 불필요. 순수 카탈로그 + 프론트 재생 정책 변경.

---

## 7. 결정 필요한 사항 (Brian)

> ✅ **#1 확정 (2026-10-02)**: 연매출 $1M 미만 → Stable Audio 3.0 Community License **무료 상업 사용**. DGX Spark(`spark-d2a9`, Tailscale) 자체 호스팅으로 진행.

| # | 결정 | 추천 | 영향 |
|---|---|---|---|
| 1 | **음원 확보 방식** ✅ 확정 | **AI 생성(Stable Audio 3.0 Medium) — DGX Spark 자체 호스팅** | 자산 확보 선행. 생성 후 seamless loop 편집 필요 |
| 2 | **개선 10(호스트 가이드·BGM 동기 재생) 처리** | **진행 중 자동 재생 제거 + 호스트 수동 재생 패널도 진행 씬에서 제거**(전문가 자체 사운드 원칙). 동기 인프라는 대기실 트랙 전파용으로만 유지 | 코드 삭제/축소 범위 |
| 3 | **기본 트랙 정책** | 고정 기본 트랙 1개(`bgm-ambient` 중립) — 일관성. 랜덤은 선택지로만 | 프론트 상수 |

---

## 8. 작업 항목 (확정 후)

| # | 작업 | 난이도 |
|---|---|---|
| 1 | 음원 10종 라이선스 확보·루프-레디 정리·S3 업로드 | — (외부) |
| 2 | 백엔드 카탈로그 10종 URL 트랙으로 교체 | 하 |
| 3 | 호스트 대기실 자동 재생 + BGM 미니바 | 중 |
| 4 | 회원 대기실(ClassWaitingRoom) BGM 자동 재생 + 미니바 | 중 |
| 5 | `open→in_progress` 전환 시 페이드아웃·정지 | 하 |
| 6 | 진행 중 BGM 미니바 제거 + 호스트 수동 재생 패널 축소/제거 | 중 |
| 7 | 테스트(대기 자동재생·전환 페이드아웃·볼륨 기억·자동재생 차단 대응) | 중 |

---

## 부록 — 관련 파일 지도

- 백엔드: `backend/app/services/class_audio_service.py`(카탈로그), `backend/app/api/v1/class_audio.py`(무인증 목록), `backend/app/schemas/class_audio.py`(스키마), `backend/app/ws/session_live_namespace.py`(`class:audio_sync`)
- 프론트: `frontend/src/lib/class/audio-sync.ts`(계약), `audio-engine.ts`(재생 엔진), `frontend/src/hooks/useClassAudioPlayer.ts`(호스트), `useGuestAudioSync.ts`(회원 수신), `frontend/src/components/class/ClassAudioPanel.tsx`(호스트 패널), `GuestAudioPanel.tsx`(회원 패널), `frontend/src/pages/sessions/ClassPlayerPage.tsx`(호스트 씬), `frontend/src/components/class/ClassWaitingRoom.tsx`(회원 대기실), `frontend/src/components/class/GuestMeditationPanel.tsx`(진행 화면)
- 기획 참조: `docs/클래스-개선-루프-아이디어.md`(개선 10), `specs/098-member-class-player/`
