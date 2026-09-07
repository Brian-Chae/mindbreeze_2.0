"""SDD-027 T1 — 60초 롤업 집계.

EEGFeatureWindow(1초 원천)에서 60초 버킷을 온디맨드로 파생한다(물화 없음, P2 과제).
버킷 인덱스는 `window_index // resolution_sec` 로 계산한다.

핵심 원칙(SDD-022/026 계승)
  1. null 보존 — 산출 불가/미수신 값은 None 이며 0 으로 치환하지 않는다. 평균은 비-null 샘플만 대상.
  2. 전체 평균은 **유효 샘플 수 가중** — 버킷 단순 평균이 아니라 전 구간 비-null 샘플의 전역 평균이다
     (희소 버킷이 과대 가중되지 않는다).
  3. 버킷마다 valid_count·coverage·시간 범위·알고리즘(정규화 상수) 버전을 함께 제공한다.
"""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.services import eeg_query

# 롤업 대상 지표(원천 feature 컬럼). 밴드파워는 재분석 자산이므로 롤업에서 제외한다.
ROLLUP_METRIC_KEYS: tuple[str, ...] = (
    "focus_index",
    "cognitive_load",
    "relaxation_index",
    "stress_index",
    "emotional_stability",
    "total_neural_activity",
    "faa",
    "hemispheric_balance",
    "attention_level",
    "meditation_level",
)

_DEFAULT_RESOLUTION_SEC = 60


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _mean_non_null(values: list) -> float | None:
    """비-null 값만의 평균. 유효 샘플이 없으면 None(0 치환 금지)."""
    usable = [v for v in values if v is not None]
    if not usable:
        return None
    return round(sum(usable) / len(usable), 4)


def _algorithm_version() -> int | None:
    """롤업 산출에 쓰인 알고리즘(정규화 상수) 버전. 로드 실패 시 None(치환 금지)."""
    try:
        from app.services import eeg_metrics

        return eeg_metrics.get_constants().version
    except Exception:  # noqa: BLE001
        return None


def _bucket_payload(bucket_index: int, windows: list, resolution_sec: int) -> dict:
    """단일 버킷(예: 60초) 집계 payload 를 만든다."""
    sample_count = len(windows)
    # valid_count 는 품질 게이트(§A4.4)의 'valid' 윈도우 수 — coverage 산출 기준.
    valid_count = sum(1 for w in windows if w.quality == "valid")
    # coverage = 유효(valid) 초 / 해상도(초). 최대 1.0 으로 캡.
    coverage = round(min(valid_count / resolution_sec, 1.0), 4)

    metrics = {
        key: _mean_non_null([getattr(w, key) for w in windows])
        for key in ROLLUP_METRIC_KEYS
    }

    return {
        "bucket_index": bucket_index,
        "start_sec": bucket_index * resolution_sec,
        "end_sec": (bucket_index + 1) * resolution_sec,
        "sample_count": sample_count,
        "valid_count": valid_count,
        "coverage": coverage,
        "metrics": metrics,
    }


def compute_rollup(
    session_id: str,
    db: DBSession,
    *,
    participant_id: str | None = None,
    resolution_sec: int = _DEFAULT_RESOLUTION_SEC,
    start_bucket: int | None = None,
    end_bucket: int | None = None,
) -> dict:
    """세션(선택적으로 특정 참가자)의 60초 롤업을 온디맨드로 산출한다.

    participant_id 미지정 시 세션 전체 윈도우를 대상으로 한다.

    SDD-028: batch key(버킷 범위) 지원 — start_bucket/end_bucket 을 주면 해당 버킷 구간만
    조회·집계한다(반열린 구간 [start_bucket, end_bucket)). 버킷 인덱스는 window_index 범위
    [start_bucket*resolution, end_bucket*resolution) 로 환산해 인덱스 범위 스캔으로 읽는다.
    범위를 생략하면 전체 스캔과 동일한 결과를 반환한다(회귀 방지).
    """
    if resolution_sec < 1:
        raise HTTPException(status_code=400, detail="resolution 은 1 이상이어야 합니다")

    sid = _to_uuid(session_id)
    # 버킷(batch key) 범위를 window_index 범위로 환산 — 필요한 구간만 원천을 읽는다.
    start_index = start_bucket * resolution_sec if start_bucket is not None else None
    end_index = end_bucket * resolution_sec if end_bucket is not None else None
    participant_ids = [_to_uuid(participant_id)] if participant_id else None
    windows = eeg_query.feature_windows_in_range(
        db,
        sid,
        participant_ids=participant_ids,
        start_index=start_index,
        end_index=end_index,
    )

    # 버킷 그룹핑(window_index // resolution_sec)
    grouped: dict[int, list] = {}
    for w in windows:
        grouped.setdefault(w.window_index // resolution_sec, []).append(w)

    buckets = [
        _bucket_payload(bucket_index, grouped[bucket_index], resolution_sec)
        for bucket_index in sorted(grouped)
    ]

    # 전체 평균 = 유효 샘플 수 가중(= 전 구간 비-null 샘플의 전역 평균).
    # 버킷 단순 평균이 아니라 원천 윈도우 전체를 대상으로 계산해 희소 버킷 과대가중을 막는다.
    overall_metrics = {
        key: _mean_non_null([getattr(w, key) for w in windows])
        for key in ROLLUP_METRIC_KEYS
    }
    overall_valid_count = sum(1 for w in windows if w.quality == "valid")

    return {
        "session_id": str(sid),
        "participant_id": participant_id,
        "resolution_sec": resolution_sec,
        "algorithm_version": _algorithm_version(),
        "window_count": len(windows),
        "bucket_count": len(buckets),
        "buckets": buckets,
        "overall": {
            "sample_count": len(windows),
            "valid_count": overall_valid_count,
            "metrics": overall_metrics,
        },
    }
