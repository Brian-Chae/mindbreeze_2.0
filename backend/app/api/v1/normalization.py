"""관리자 전용 집단 정규화 기준 관리 API."""

from collections.abc import Callable, Coroutine, Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.api.v1.admin import require_platform_admin
from app.models.user import User
from app.core.database import get_db
from app.models.normalization_baseline import NormalizationBaseline
from app.models.normalization_model import NormalizationModel
from app.schemas.normalization_model import (
    ActivateNormalizationModelResponse,
    ActiveNormalizationModelResponse,
    NormalizationModelListResponse,
    NormalizationModelResponse,
)
from app.services.normalization_distribution import MIN_BASELINES, compute_distribution
from app.schemas.normalization import (
    ActivateBaselineResponse,
    ActiveBaselineResponse,
    BaselineCreate,
    BaselineDeleteResponse,
    BaselineListResponse,
    BaselineResponse,
)


class BaselineValidationRoute(APIRoute):
    """NaN/Infinity 원문이 오류 응답 JSON 직렬화를 깨뜨리지 않게 한다."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[object, object, Response]]:
        handler = super().get_route_handler()

        async def validate(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                detail = [
                    {key: error[key] for key in ("loc", "msg", "type")}
                    for error in exc.errors()
                ]
                return JSONResponse(status_code=422, content={"detail": detail})

        return validate


router = APIRouter(
    prefix="/normalization",
    tags=["normalization"],
    dependencies=[Depends(require_platform_admin)],
    route_class=BaselineValidationRoute,
)


@contextmanager
def _write_transaction(db: Session) -> Iterator[None]:
    """인증 조회로 시작된 요청 트랜잭션에서 변경을 함께 확정한다."""
    try:
        yield
        db.commit()
    except Exception:
        db.rollback()
        raise


@router.post("/models/compute", response_model=NormalizationModelResponse, status_code=201)
def compute_model(db: Session = Depends(get_db)) -> NormalizationModelResponse:
    with _write_transaction(db):
        # 최대 버전 조회부터 저장까지 직렬화해 동시 계산의 버전 중복을 막는다.
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(420042)"))
        baselines = (db.scalars(select(NormalizationBaseline))).all()
        if len(baselines) < MIN_BASELINES:
            raise HTTPException(
                status_code=400, detail="기준 데이터가 부족합니다 (최소 5개 필요)"
            )
        version = db.scalar(select(func.max(NormalizationModel.version)))
        model = NormalizationModel(
            version=(version or 0) + 1,
            n_samples=len(baselines),
            params=compute_distribution(baselines),
            is_active=False,
        )
        db.add(model)
        db.flush()
        db.refresh(model)
        result = NormalizationModelResponse.model_validate(model)
    return result


@router.get("/models", response_model=NormalizationModelListResponse)
def list_models(db: Session = Depends(get_db)) -> NormalizationModelListResponse:
    rows = db.scalars(
        select(NormalizationModel).order_by(
            NormalizationModel.version.desc(), NormalizationModel.id.desc()
        )
    )
    return NormalizationModelListResponse(
        items=[NormalizationModelResponse.model_validate(row) for row in rows]
    )


@router.get("/models/active", response_model=ActiveNormalizationModelResponse)
def get_active_model(
    db: Session = Depends(get_db),
) -> ActiveNormalizationModelResponse:
    model = db.scalar(
        select(NormalizationModel).where(NormalizationModel.is_active.is_(True))
    )
    return ActiveNormalizationModelResponse(
        active=NormalizationModelResponse.model_validate(model) if model is not None else None
    )


@router.post("/models/{model_id}/activate", response_model=ActivateNormalizationModelResponse)
def activate_model(
    model_id: int, db: Session = Depends(get_db)
) -> ActivateNormalizationModelResponse:
    with _write_transaction(db):
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(420042)"))
        model = db.get(NormalizationModel, model_id, with_for_update=True)
        if model is None:
            raise HTTPException(status_code=404, detail="표준 모델을 찾을 수 없습니다")
        db.execute(
            update(NormalizationModel)
            .where(NormalizationModel.is_active.is_(True))
            .values(is_active=False)
        )
        model.is_active = True
        db.flush()
        result = NormalizationModelResponse.model_validate(model)
    return ActivateNormalizationModelResponse(active=result)


@router.post("/baselines", response_model=BaselineResponse, status_code=201)
def create_baseline(
    body: BaselineCreate,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
) -> BaselineResponse:
    with _write_transaction(db):
        baseline = NormalizationBaseline(
            user_id=str(admin.id),
            device_id=body.device_id,
            pipeline_version=body.pipeline_version,
            gender=body.gender,
            birth_date=body.birth_date,
            closed=body.closed.model_dump(),
            open=body.open.model_dump(),
            is_active=False,
        )
        db.add(baseline)
        db.flush()
        db.refresh(baseline)
        result = BaselineResponse.model_validate(baseline)
    return result


@router.get("/baselines", response_model=BaselineListResponse)
def list_baselines(db: Session = Depends(get_db)) -> BaselineListResponse:
    rows = db.scalars(
        select(NormalizationBaseline).order_by(
            NormalizationBaseline.created_at.desc(), NormalizationBaseline.id.desc()
        )
    )
    return BaselineListResponse(
        items=[BaselineResponse.model_validate(row) for row in rows]
    )


@router.delete("/baselines/{baseline_id}", response_model=BaselineDeleteResponse)
def delete_baseline(
    baseline_id: int, db: Session = Depends(get_db)
) -> BaselineDeleteResponse:
    with _write_transaction(db):
        baseline = db.get(NormalizationBaseline, baseline_id, with_for_update=True)
        if baseline is None:
            raise HTTPException(status_code=404, detail="기준 데이터를 찾을 수 없습니다")
        db.delete(baseline)
    return BaselineDeleteResponse()


@router.post("/baselines/{baseline_id}/activate", response_model=ActivateBaselineResponse)
def activate_baseline(
    baseline_id: int, db: Session = Depends(get_db)
) -> ActivateBaselineResponse:
    with _write_transaction(db):
        # 첫 활성 지정도 직렬화한다. 서로 다른 행 잠금만으로는 경합을 막을 수 없다.
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(410041)"))
        baseline = db.get(NormalizationBaseline, baseline_id, with_for_update=True)
        if baseline is None:
            raise HTTPException(status_code=404, detail="기준 데이터를 찾을 수 없습니다")
        db.execute(
            update(NormalizationBaseline)
            .where(NormalizationBaseline.is_active.is_(True))
            .values(is_active=False)
        )
        baseline.is_active = True
        db.flush()
        result = BaselineResponse.model_validate(baseline)
    return ActivateBaselineResponse(active=result)


@router.get("/active", response_model=ActiveBaselineResponse)
def get_active_baseline(
    db: Session = Depends(get_db),
) -> ActiveBaselineResponse:
    baseline = db.scalar(
        select(NormalizationBaseline).where(NormalizationBaseline.is_active.is_(True))
    )
    return ActiveBaselineResponse(
        active=BaselineResponse.model_validate(baseline) if baseline is not None else None
    )
