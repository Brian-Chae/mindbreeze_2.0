"""명상 BGM(배경음) 트랙 카탈로그 — 대기실 앰비언트 음악의 소스 정의.

대기실(``open``)에서 플랫폼이 자동으로 트는 BGM 10종을 URL 트랙으로 제공한다.
트랙은 프론트 정적 자산(``frontend/public/bgm/``)을 상대 경로(``/bgm/*.mp3``)로 가리키며,
클라이언트(호스트·회원)가 같은 소스를 받아 대기실에서 재생한다.

- ``url`` 트랙: 공개 오디오·S3 자산 또는 프론트 정적 경로. 운영에서 자산을 올린 뒤 환경변수
  ``CLASS_AUDIO_TRACKS_JSON`` (JSON 배열)로 등록할 수 있다. URL 을 코드에 하드코딩하지 않는다
  (기본 10종은 프론트 정적 경로를 사용).
- 진행 중(``in_progress``)에는 플랫폼이 BGM 을 자동 재생하지 않는다 — 명상 전문가가 자체
  사운드를 실행하므로 대기 BGM 은 전환 시 페이드아웃·정지한다. 이 카탈로그는 대기실 전용.

이 목록은 ``GET /class/audio-tracks`` 로 노출되며(무인증 — 회원·게스트도 상담사와 같은
소스를 받아야 동기 재생이 성립한다), WS ``class:audio_sync`` 의 ``track_id`` 검증에도 쓰인다.
"""

import json
import logging
import os

logger = logging.getLogger(__name__)

# 트랙 종류 — 배경음(BGM)만 제공. 명상 가이드(나레이션)는 상담사의 목소리(LiveKit)로만.
AUDIO_TRACK_KINDS: tuple[str, ...] = ("bgm",)

# 소스 종류 — 외부 URL(레거시 tone 은 스키마 호환용으로 유지)
AUDIO_SOURCE_KINDS: tuple[str, ...] = ("url", "tone")

# 운영에서 URL 트랙을 추가하는 환경변수(JSON 배열).
EXTRA_TRACKS_ENV = "CLASS_AUDIO_TRACKS_JSON"

# 기본 카탈로그 루프 길이(초) — Stable Audio 3.0 생성 후 5초 크로스페이드 편집 기준.
_BGM_LOOP_SEC = 55.0


def _url_track(
    track_id: str,
    title: str,
    description: str,
    *,
    path: str,
    duration_sec: float = _BGM_LOOP_SEC,
) -> dict:
    """URL 트랙 1건 — 프론트 정적 경로(``/bgm/*.mp3``) 또는 외부 URL 을 가리킨다."""
    return {
        "track_id": track_id,
        "title": title,
        "kind": "bgm",
        "url": path,
        "duration_sec": duration_sec,
        "synth": None,
        "description": description,
        "loop": True,
        "source": "url",
    }


# 기본 카탈로그 — 대기실 BGM 10종(Stable Audio 3.0 생성 · seamless loop).
# 첫 항목(bgm-ambient)이 기본 트랙 — 대기실 진입 시 자동 재생된다.
_BUILTIN_TRACKS: tuple[dict, ...] = (
    _url_track("bgm-ambient", "심신이완 앰비언트", "무테마 중립 앰비언트 — 기본 트랙", path="/bgm/bgm-ambient.mp3"),
    _url_track("bgm-forest", "고요한 숲", "새소리·바람 + 잔잔한 현악", path="/bgm/bgm-forest.mp3"),
    _url_track("bgm-ocean", "잔잔한 파도", "파도 소리 + 저음 패드", path="/bgm/bgm-ocean.mp3"),
    _url_track("bgm-rain", "빗소리", "부드러운 빗소리 + 멜로디", path="/bgm/bgm-rain.mp3"),
    _url_track("bgm-singing-bowl", "싱잉볼", "저음의 웅장한 티베트 싱잉볼·차임", path="/bgm/bgm-singing-bowl.mp3"),
    _url_track("bgm-healing-432", "432Hz 힐링", "432Hz 기반 악기 연주(순수 톤 아님)", path="/bgm/bgm-healing-432.mp3"),
    _url_track("bgm-piano", "피아노 명상", "느린 피아노 단선율", path="/bgm/bgm-piano.mp3"),
    _url_track("bgm-string-drone", "현악 드론", "현악 패드·드론(긴장 이완)", path="/bgm/bgm-string-drone.mp3"),
    _url_track("bgm-morning-birds", "새벽 새소리", "새벽 새소리 + 따뜻한 앰비언트", path="/bgm/bgm-morning-birds.mp3"),
    _url_track("bgm-wind-chime", "바람 차임", "윈드차임 + 미세한 바람", path="/bgm/bgm-wind-chime.mp3"),
)


def _clean_url_track(raw: object) -> dict | None:
    """환경변수로 받은 URL 트랙 1건을 검증·정규화한다(부적합하면 None — 조용히 제외)."""
    if not isinstance(raw, dict):
        return None
    track_id = raw.get("track_id")
    title = raw.get("title")
    url = raw.get("url")
    kind = raw.get("kind", "bgm")
    if not isinstance(track_id, str) or not track_id.strip():
        return None
    if not isinstance(title, str) or not title.strip():
        return None
    if not isinstance(url, str) or not (url.startswith("http://") or url.startswith("https://") or url.startswith("/")):
        return None
    if kind not in AUDIO_TRACK_KINDS:
        return None

    duration = raw.get("duration_sec")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
        duration = None

    description = raw.get("description")
    if not isinstance(description, str):
        description = ""

    return {
        "track_id": track_id.strip(),
        "title": title.strip(),
        "kind": kind,
        "url": url,
        "duration_sec": float(duration) if duration is not None else None,
        "synth": None,
        "description": description,
        "loop": bool(raw.get("loop", True)),
        "source": "url",
    }


def extra_tracks() -> list[dict]:
    """운영 URL 트랙(환경변수) — 없거나 깨졌으면 빈 목록(기본 카탈로그는 유지)."""
    raw = os.getenv(EXTRA_TRACKS_ENV)
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("[class-audio] %s 파싱 실패 — URL 트랙 무시", EXTRA_TRACKS_ENV)
        return []
    if not isinstance(parsed, list):
        logger.warning("[class-audio] %s 는 JSON 배열이어야 합니다 — 무시", EXTRA_TRACKS_ENV)
        return []

    tracks: list[dict] = []
    seen: set[str] = set()
    for item in parsed:
        track = _clean_url_track(item)
        if track is None or track["track_id"] in seen:
            continue
        seen.add(track["track_id"])
        tracks.append(track)
    return tracks


def list_audio_tracks() -> list[dict]:
    """카탈로그 전체(기본 URL 트랙 + 운영 URL 트랙) — 호출측이 변형하지 않도록 복사본을 준다."""
    tracks = [dict(track) for track in _BUILTIN_TRACKS]
    for track in extra_tracks():
        if any(existing["track_id"] == track["track_id"] for existing in tracks):
            continue  # 같은 id 는 기본 트랙이 우선(운영 실수로 인한 덮어쓰기 방지)
        tracks.append(track)
    return tracks


def get_audio_track(track_id: str | None) -> dict | None:
    """track_id 로 트랙 1건 조회 — 없으면 None(호출측이 브로드캐스트를 생략한다)."""
    if not track_id:
        return None
    for track in list_audio_tracks():
        if track["track_id"] == track_id:
            return track
    return None


def is_known_track(track_id: str | None) -> bool:
    return get_audio_track(track_id) is not None


def track_duration_sec(track_id: str | None) -> float | None:
    """트랙 길이(초). 없으면 None."""
    track = get_audio_track(track_id)
    return track.get("duration_sec") if track else None
