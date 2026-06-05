"""LINK BAND EEG API — 실시간 지표 + Raw 배치 업로드"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.record import EEGRecord
from app.models.session import Session as SessionModel
from app.schemas.eeg import (
    EEGMetricsPayload,
    EEGBatchUploadResponse,
    EEGSessionSummary,
)

router = APIRouter(prefix="/sessions", tags=["eeg"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/{session_id}/eeg/metrics", status_code=status.HTTP_204_NO_CONTENT)
def submit_eeg_metrics(
    session_id: str,
    payload: EEGMetricsPayload,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """1Hz 실시간 EEG 지표 저장 (선택적 — WebSocket이 주 경로)"""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.status not in ("in_progress", "paused"):
        raise HTTPException(status_code=400, detail="진행 중인 세션이 아닙니다")

    # EEGRecord에 메트릭 스냅샷 저장
    record = (
        db.query(EEGRecord)
        .filter(EEGRecord.session_id == session_id, EEGRecord.user_id == current_user["id"])
        .order_by(EEGRecord.created_at.desc())
        .first()
    )
    if record:
        prev = record.analysis_result or {}
        snapshots = prev.get("snapshots", [])
        snapshots.append({
            "timestamp": _now().timestamp(),
            "metrics": payload.model_dump(),
        })
        # 최근 300개만 유지 (~5분)
        if len(snapshots) > 300:
            snapshots = snapshots[-300:]
        record.analysis_result = {**prev, "snapshots": snapshots}
    else:
        record = EEGRecord(
            session_id=session_id,
            user_id=current_user["id"],
            s3_key="",  # raw data 없이 metrics만
            sample_rate=1,
            analysis_result={
                "snapshots": [{
                    "timestamp": _now().timestamp(),
                    "metrics": payload.model_dump(),
                }]
            },
        )
        db.add(record)

    db.commit()
    return None


@router.post("/{session_id}/eeg/raw", response_model=EEGBatchUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_eeg_raw(
    session_id: str,
    file: UploadFile = File(...),
    user_id: str = Form(...),
    sample_rate: int = Form(250),
    duration_sec: int = Form(...),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """세션 종료 후 Raw EEG 데이터 S3 업로드"""
    import boto3
    from app.config import settings

    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    # S3 업로드
    s3 = boto3.client(
        "s3",
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    record_id = str(uuid.uuid4())
    s3_key = f"eeg/{session_id}/{record_id}.parquet"

    try:
        contents = await file.read()
        s3.put_object(
            Bucket=settings.s3_bucket,
            Key=s3_key,
            Body=contents,
            ContentType="application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"S3 업로드 실패: {e}")

    # DB 레코드 생성
    record = EEGRecord(
        id=record_id,
        session_id=session_id,
        user_id=user_id,
        s3_key=s3_key,
        sample_rate=sample_rate,
        duration_sec=duration_sec,
    )
    db.add(record)
    db.commit()

    return EEGBatchUploadResponse(s3_key=s3_key, record_id=record_id)


@router.get("/{session_id}/eeg/summary", response_model=EEGSessionSummary)
def get_eeg_summary(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """세션 EEG 요약 조회"""
    records = (
        db.query(EEGRecord)
        .filter(EEGRecord.session_id == session_id)
        .all()
    )

    if not records:
        return EEGSessionSummary(session_id=session_id, data_points=0)

    # 모든 스냅샷 취합
    all_snapshots = []
    for r in records:
        snapshots = (r.analysis_result or {}).get("snapshots", [])
        all_snapshots.extend(snapshots)

    if not all_snapshots:
        return EEGSessionSummary(session_id=session_id, data_points=0)

    metrics_list = [s["metrics"] for s in all_snapshots if "metrics" in s]
    data_points = len(metrics_list)

    def avg(key: str) -> float | None:
        vals = [m[key] for m in metrics_list if m.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    return EEGSessionSummary(
        session_id=session_id,
        avg_neural_activity=avg("neural_activity"),
        avg_concentration=avg("concentration"),
        avg_relaxation=avg("relaxation"),
        avg_stress=avg("cognitive_stress"),
        avg_heart_rate=avg("heart_rate"),
        data_points=data_points,
    )
