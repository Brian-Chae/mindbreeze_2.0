"""개선 10: 클래스 오디오 트랙 API — 명상 가이드·BGM 목록.

회원·게스트는 상담사와 **같은 소스**를 받아야 타임코드 동기 재생이 성립하므로 목록은
무인증으로 공개한다(정적 메타데이터 — PII·세션 정보 없음, 읽기 전용).
재생 제어(play/pause/seek/stop)는 REST 가 아니라 `/session-live` WS `class:audio_sync` 로만
가능하며 서버가 발신자를 상담사(호스트)로 제한한다.
"""

from fastapi import APIRouter

from app.schemas.class_audio import AudioTrackListResponse
from app.services import class_audio_service

router = APIRouter(prefix="/class", tags=["class-audio"])


@router.get("/audio-tracks", response_model=AudioTrackListResponse)
def list_class_audio_tracks() -> AudioTrackListResponse:
    """명상 가이드·BGM 트랙 목록(무인증)."""
    tracks = class_audio_service.list_audio_tracks()
    # dict → 스키마 변환은 pydantic 검증에 맡긴다(카탈로그 값이 계약을 벗어나면 500 대신 여기서 걸린다)
    return AudioTrackListResponse.model_validate({"tracks": tracks, "count": len(tracks)})
