"""개선 10: 명상 가이드·BGM 트랙 카탈로그 (class:audio_sync 동기 재생의 소스 정의).

상담사가 로컬에서 트는 가이드 음성·BGM 을 회원 화면에서 **같은 소스·같은 위치**로
재생하기 위한 트랙 목록이다. 트랙은 두 종류의 소스를 가질 수 있다.

- ``url`` 트랙: 공개 오디오 또는 S3 자산. 운영에서 자산을 올린 뒤 환경변수
  ``CLASS_AUDIO_TRACKS_JSON`` (JSON 배열)로 등록한다. URL 을 코드에 하드코딩하지 않는다.
- ``tone`` 트랙: 무자산 내장 톤(Web Audio 생성). 자산이 없는 환경에서도 동기 재생
  기능이 실제로 동작하도록 기본 카탈로그를 채운다 — 모든 클라이언트가 같은 주파수·파형을
  만들므로 샘플 단위가 아니어도 "동일 소스"가 보장된다.

이 목록은 ``GET /class/audio-tracks`` 로 노출되며(무인증 — 회원·게스트도 상담사와 같은
소스를 받아야 동기 재생이 성립한다), WS ``class:audio_sync`` 의 ``track_id`` 검증에도 쓰인다.
"""

import json
import logging
import os

logger = logging.getLogger(__name__)

# 트랙 종류 — 배경음 / 가이드 음성
AUDIO_TRACK_KINDS: tuple[str, ...] = ("bgm", "guide")

# 소스 종류 — 외부 URL / 내장 톤
AUDIO_SOURCE_KINDS: tuple[str, ...] = ("url", "tone")

# 운영에서 URL 트랙을 추가하는 환경변수(JSON 배열).
EXTRA_TRACKS_ENV = "CLASS_AUDIO_TRACKS_JSON"

# 내장 톤 트랙의 기본 마스터 게인 — 회원이 볼륨을 직접 올리므로 기본은 조용하게 둔다.
_DEFAULT_TONE_GAIN = 0.12


def _tone(
    track_id: str,
    title: str,
    kind: str,
    description: str,
    *,
    freq_hz: float,
    waveform: str = "sine",
    gain: float = _DEFAULT_TONE_GAIN,
    detune_hz: float | None = None,
    pulse_sec: float | None = None,
) -> dict:
    """내장 톤 트랙 1건 — url 없이 클라이언트가 Web Audio 로 같은 소리를 만든다."""
    return {
        "track_id": track_id,
        "title": title,
        "kind": kind,
        "url": None,
        "duration_sec": None,  # 무한 드론 — 길이 없음(루프 개념 자체가 없다)
        "synth": {
            "freq_hz": freq_hz,
            "waveform": waveform,
            "gain": gain,
            "detune_hz": detune_hz,
            "pulse_sec": pulse_sec,
        },
        "description": description,
        "loop": True,
        "source": "tone",
    }


# 기본 카탈로그 — 자산 없이 바로 재생 가능한 톤 소스 3종.
_BUILTIN_TRACKS: tuple[dict, ...] = (
    _tone(
        "bgm-calm-drone-432",
        "고요한 드론 (432Hz)",
        "bgm",
        "저음 드론 — 생각을 가라앉히는 배경음",
        freq_hz=432.0,
        detune_hz=0.4,
        gain=0.12,
    ),
    _tone(
        "bgm-deep-relax-528",
        "깊은 이완 (528Hz)",
        "bgm",
        "밝은 배경음 — 몸의 긴장을 풀 때",
        freq_hz=528.0,
        detune_hz=0.7,
        gain=0.09,
    ),
    _tone(
        "guide-breath-4-6",
        "호흡 가이드 (4초 들숨·6초 날숨)",
        "guide",
        "10초 주기의 맥박음 — 들숨 4초·날숨 6초 호흡을 안내한다",
        freq_hz=288.0,
        pulse_sec=10.0,
        gain=0.14,
    ),
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
    """카탈로그 전체(내장 톤 + 운영 URL 트랙) — 호출측이 변형하지 않도록 복사본을 준다."""
    tracks = [dict(track) for track in _BUILTIN_TRACKS]
    for track in extra_tracks():
        if any(existing["track_id"] == track["track_id"] for existing in tracks):
            continue  # 같은 id 는 내장 트랙이 우선(운영 실수로 인한 덮어쓰기 방지)
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
    """트랙 길이(초). 없으면 None — 내장 톤은 길이가 없다(무한 드론)."""
    track = get_audio_track(track_id)
    return track.get("duration_sec") if track else None
