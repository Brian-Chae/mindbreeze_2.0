"""SDD-269 참여자 1명의 결측 구간 = 기록된 구간(biosignal_gap_events) + 저장 데이터에서 파생한 구간.

쿼리는 고정 3개(분석 데이터 창, 측정 기록 파일(뇌파), 기록 gap). 상대 시각 원점은 뇌파 측정 기록 파일의
첫 시작 ms(없으면 분석 데이터 창 최소 시각). 원인은 단정하지 않는다.
"""
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.biosignal import BiosignalGapEvent
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.schemas import data_center as dc
from app.services import gap_derivation as gd


def _load(db: DBSession, session_id: UUID, participant_id: UUID):
    windows = [gd.WindowPoint(group=r.play_group_id, window_index=r.window_index, device_ms=r.device_timestamp_ms,
                              quality_zero=(r.quality == 'invalid' or (r.signal_quality is not None and r.signal_quality == 0)))
               for r in db.query(EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index,
                                 EEGFeatureWindow.device_timestamp_ms, EEGFeatureWindow.quality,
                                 EEGFeatureWindow.signal_quality).filter(
                   EEGFeatureWindow.session_id == session_id, EEGFeatureWindow.participant_id == participant_id).all()]
    chunks = db.query(EEGRawChunk.start_ms, EEGRawChunk.end_ms).filter(
        EEGRawChunk.session_id == session_id, EEGRawChunk.participant_id == participant_id,
        EEGRawChunk.signal_type == 'eeg', EEGRawChunk.start_ms.isnot(None), EEGRawChunk.end_ms.isnot(None)).all()
    segments = [gd.SegmentSpan(float(c.start_ms), float(c.end_ms)) for c in chunks]
    recorded = db.query(BiosignalGapEvent).filter(
        BiosignalGapEvent.session_id == session_id, BiosignalGapEvent.participant_id == participant_id).all()
    return windows, segments, recorded


def collect_gaps(db: DBSession, session_id: UUID, participant_id: UUID) -> list[dc.GapRange]:
    windows, segments, recorded = _load(db, session_id, participant_id)
    # 시간 원점이 소스마다 다르다: 분석 데이터 창=절대 epoch ms, 측정 기록 파일=세션 상대 ms(파형 시간축과 같은 기준).
    # 절대 앵커가 없어 "각 소스의 첫 시각을 같은 0 으로 두는 근사"를 쓴다(오차 상한은 spec 참조).
    timed = [w.device_ms for w in windows if w.device_ms is not None]
    win_origin = min(timed) if timed else 0.0
    seg_origin = min((s.start_ms for s in segments), default=0.0) if segments else 0.0
    shifted = [gd.WindowPoint(w.group, w.window_index, None if w.device_ms is None else w.device_ms - win_origin + seg_origin,
                              w.quality_zero) for w in windows]
    derived = gd.derive_gaps(shifted, segments)
    rec_ranges = [dc.GapRange(start_us=str(g.start_us), end_us=None if g.end_us is None else str(g.end_us), reason=g.reason,
                              observed_or_estimated=g.observed_or_estimated, source='recorded') for g in recorded]
    if not derived:
        return sorted(rec_ranges, key=lambda g: int(g.start_us))
    rec_ms = [(g.start_us / 1000, (g.end_us if g.end_us is not None else 2 ** 62) / 1000) for g in recorded]
    pieces = gd.subtract_recorded([(g.start_ms, g.end_ms, g.reasons) for g in derived], rec_ms)
    out = list(rec_ranges)
    for s, e, reasons in pieces:
        if e <= 0:
            continue
        out.append(dc.GapRange(start_us=str(max(0, round(s * 1000))), end_us=str(round(e * 1000)),
                               reason='signal_lost' if gd.R_QUALITY in reasons else 'unknown',
                               observed_or_estimated='estimated', source='derived'))
    return sorted(out, key=lambda g: int(g.start_us))


def overlapping(gaps: list[dc.GapRange], from_us: int | None, to_us: int | None) -> list[dc.GapRange]:
    return [g for g in gaps if (to_us is None or int(g.start_us) < to_us)
            and (from_us is None or g.end_us is None or int(g.end_us) > from_us)]


def summarize(gaps: list[dc.GapRange]) -> dc.GapSummary:
    total = sum(int(g.end_us) - int(g.start_us) for g in gaps if g.end_us is not None)
    return dc.GapSummary(gaps=gaps, count=len(gaps), total_seconds=round(total / 1_000_000, 1))
