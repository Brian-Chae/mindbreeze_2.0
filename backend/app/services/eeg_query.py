"""SDD-028 T2 — EEG 조회 최적화(batch key 기반).

라이브(live-metrics)·롤업(eeg-rollup)·게스트 상태 조회가 EEGFeatureWindow/EEGRawChunk
원천을 전체 스캔하지 않도록, window_index/chunk_index 범위(batch key)와 LIMIT 을 지원하는
공통 조회 헬퍼를 제공한다.

핵심 원칙
  1. batch key = 정렬 축(window_index/chunk_index)의 반열린 구간 [start, end).
     범위 미지정 시 전체를 반환하므로 기존 전체 스캔과 결과가 동일하다(회귀 방지).
  2. 최신값 조회는 정렬 + LIMIT 1 로 인덱스만 타게 해 전체 로딩을 피한다.
  3. null 보존 — 이 모듈은 값을 치환하지 않는다. 집계·평균은 호출측이 비-null 대상만 계산한다.
"""

from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk


def feature_windows_in_range(
    db: DBSession,
    session_id: UUID,
    *,
    participant_ids: list | None = None,
    start_index: int | None = None,
    end_index: int | None = None,
    limit: int | None = None,
    order_desc: bool = False,
) -> list:
    """EEGFeatureWindow 를 batch key(window_index 범위)로 조회한다.

    - participant_ids: 지정 시 해당 참가자로 한정(빈 리스트면 빈 결과).
    - start_index/end_index: 반열린 구간 [start, end). 미지정 축은 열어 둔다.
    - limit: 상한. order_desc=True 와 함께 쓰면 "최근 N개" 조회가 된다.
    범위를 모두 생략하면 전체 스캔과 동일한 결과(정렬 포함)를 반환한다.
    """
    if participant_ids is not None and len(participant_ids) == 0:
        return []

    q = db.query(EEGFeatureWindow).filter(EEGFeatureWindow.session_id == session_id)
    if participant_ids is not None:
        q = q.filter(EEGFeatureWindow.participant_id.in_(participant_ids))
    if start_index is not None:
        q = q.filter(EEGFeatureWindow.window_index >= start_index)
    if end_index is not None:
        q = q.filter(EEGFeatureWindow.window_index < end_index)

    order = (
        EEGFeatureWindow.window_index.desc()
        if order_desc
        else EEGFeatureWindow.window_index.asc()
    )
    q = q.order_by(order)
    if limit is not None:
        q = q.limit(limit)
    return q.all()


def latest_feature_window(
    db: DBSession,
    session_id: UUID,
    participant_id: UUID,
):
    """참가자의 최신 EEGFeatureWindow 1건을 LIMIT 1 로 조회한다.

    SDD-026: pause/resume 로 window_index 가 0 부터 재시작할 수 있으므로 created_at 기준 최신을
    취하고, 동률이면 window_index 로 안정 정렬한다. 전체 로딩 없이 인덱스 + LIMIT 1 로 끝낸다.
    """
    return (
        db.query(EEGFeatureWindow)
        .filter(
            EEGFeatureWindow.session_id == session_id,
            EEGFeatureWindow.participant_id == participant_id,
        )
        .order_by(
            EEGFeatureWindow.created_at.desc(),
            EEGFeatureWindow.window_index.desc(),
        )
        .limit(1)
        .first()
    )


def raw_chunks_in_range(
    db: DBSession,
    session_id: UUID,
    participant_id: UUID,
    *,
    stream_id: str | None = None,
    start_index: int | None = None,
    end_index: int | None = None,
    limit: int | None = None,
) -> list:
    """EEGRawChunk 를 batch key(chunk_index 범위)로 조회한다.

    범위를 생략하면 참가자(선택적으로 stream)의 전체 청크를 chunk_index 순으로 반환한다.
    """
    q = db.query(EEGRawChunk).filter(
        EEGRawChunk.session_id == session_id,
        EEGRawChunk.participant_id == participant_id,
    )
    if stream_id is not None:
        q = q.filter(EEGRawChunk.stream_id == stream_id)
    if start_index is not None:
        q = q.filter(EEGRawChunk.chunk_index >= start_index)
    if end_index is not None:
        q = q.filter(EEGRawChunk.chunk_index < end_index)

    q = q.order_by(EEGRawChunk.chunk_index.asc())
    if limit is not None:
        q = q.limit(limit)
    return q.all()
