"""SDD-243 플랫폼·기관 관리자 공용 데이터 센터 조회 API (`/api/v1/data-center`).

인가는 서버가 매 호출 DB 로 재검증한다(data_center_policy.resolve_context). FE capabilities·탭 숨김은 인가가 아니다.
모든 응답은 Cache-Control: no-store.
"""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas import data_center as dc
from app.services import data_center_policy as policy
from app.services import data_center_query as q

router = APIRouter(prefix='/data-center', tags=['data-center'])

SubjectType = Literal['user', 'guest']


def _no_store(response: Response) -> None:
    response.headers['Cache-Control'] = 'no-store'


def context_dep(response: Response, org_id: UUID | None = Query(None), current_user: dict = Depends(get_current_user),
                db: DBSession = Depends(get_db)) -> policy.ResolvedContext:
    _no_store(response)
    return policy.resolve_context(db, UUID(current_user['id']), org_id)


def query_dep(limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=512),
              q_: str | None = Query(None, alias='q', max_length=100),
              date_from: str | None = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
              date_to: str | None = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'), status: str | None = Query(None, max_length=30),
              kind: str | None = Query(None, max_length=30), group_by: Literal['org', 'role', 'type'] | None = Query(None),
              sort: dc.SortKey = Query('time_desc')) -> dc.DataCenterQuery:
    return dc.DataCenterQuery(limit=limit, cursor=cursor, q=q_, date_from=date_from, date_to=date_to, status=status,
                              kind=kind, group_by=group_by, sort=sort)


@router.get('/contexts', response_model=dc.DataCenterContext)
def contexts(response: Response, current_user: dict = Depends(get_current_user), db: DBSession = Depends(get_db)):
    _no_store(response)
    return policy.list_contexts(db, UUID(current_user['id']))


@router.get('/summary', response_model=dc.SummaryResponse)
def summary(ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.summary(db, ctx)


@router.get('/inventory', response_model=dc.InventoryResponse)
def inventory(ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.inventory(db, ctx)


@router.get('/subjects', response_model=dc.DataCenterPage[dc.SubjectListItem])
def subjects(role: str | None = Query(None, max_length=20), query: dc.DataCenterQuery = Depends(query_dep),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.list_subjects(db, ctx, query, role)


@router.get('/subjects/{subject_type}/{subject_id}/holdings', response_model=dc.SubjectHoldings)
def holdings(subject_type: SubjectType, subject_id: UUID, query: dc.DataCenterQuery = Depends(query_dep),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.subject_holdings(db, ctx, subject_type, subject_id, query)


@router.post('/subjects/{subject_type}/{subject_id}/contact-reveal', response_model=dc.ContactRevealResponse)
def contact_reveal(subject_type: SubjectType, subject_id: UUID, body: dc.ContactRevealRequest,
                   ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.contact_reveal(db, ctx, subject_type, subject_id, list(body.fields))


@router.get('/measurements', response_model=dc.DataCenterPage[dc.MeasurementListItem])
def measurements(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
                 db: DBSession = Depends(get_db)):
    return q.list_measurements(db, ctx, query)


@router.get('/measurements/{session_id}/{participant_id}', response_model=dc.MeasurementDetail)
def measurement_detail(session_id: UUID, participant_id: UUID, ctx: policy.ResolvedContext = Depends(context_dep),
                       db: DBSession = Depends(get_db)):
    return q.measurement_detail(db, ctx, session_id, participant_id)


@router.get('/classes', response_model=dc.DataCenterPage[dc.ClassListItem])
def classes(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
            db: DBSession = Depends(get_db)):
    return q.list_classes(db, ctx, query)


@router.get('/classes/{class_id}/sessions', response_model=dc.ClassSessionsResponse)
def class_sessions(class_id: UUID, query: dc.DataCenterQuery = Depends(query_dep),
                   ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.class_sessions(db, ctx, class_id, query)


@router.get('/sessions/{session_id}/participants', response_model=dc.SessionParticipantsResponse)
def session_participants(session_id: UUID, query: dc.DataCenterQuery = Depends(query_dep),
                         ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.session_participants(db, ctx, session_id, query)


@router.get('/members/{member_id}/sessions', response_model=dc.SubjectSessionsResponse)
def member_sessions(member_id: UUID, subject_type: SubjectType = Query('user'),
                    query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
                    db: DBSession = Depends(get_db)):
    return q.member_sessions(db, ctx, member_id, query, subject_type)


@router.get('/facilitators/{facilitator_id}/sessions', response_model=dc.SubjectSessionsResponse)
def facilitator_sessions(facilitator_id: UUID, query: dc.DataCenterQuery = Depends(query_dep),
                         ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return q.facilitator_sessions(db, ctx, facilitator_id, query)


# ── B03 동의·보관·표준 (읽기 전용). #9~15 는 플랫폼 전용 ─────────────────────
from app.services import data_center_governance as gov  # noqa: E402


@router.get('/consents', response_model=dc.DataCenterPage[dc.ConsentItem])
def consents(kind: str = Query('collection', max_length=20), query: dc.DataCenterQuery = Depends(query_dep),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return gov.list_consents(db, ctx, query, kind)


@router.get('/research-batches', response_model=dc.DataCenterPage[dc.ResearchBatchItem])
def research_batches(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
                     db: DBSession = Depends(get_db)):
    return gov.list_research_batches(db, ctx, query)


@router.get('/research-batches/{batch_id}', response_model=dc.ResearchBatchDetail)
def research_batch(batch_id: UUID, ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return gov.research_batch_detail(db, ctx, batch_id)


@router.get('/retention-runs', response_model=dc.DataCenterPage[dc.RetentionRunItem])
def retention_runs(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
                   db: DBSession = Depends(get_db)):
    return gov.list_retention_runs(db, ctx, query)


@router.get('/retention-runs/{run_id}', response_model=dc.RetentionRunDetail)
def retention_run(run_id: UUID, ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return gov.retention_run_detail(db, ctx, run_id)


@router.get('/retention-candidates', response_model=dc.DataCenterPage[dc.RetentionCandidate])
def retention_candidates(query: dc.DataCenterQuery = Depends(query_dep),
                         ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    return gov.list_retention_candidates(db, ctx, query)


@router.get('/account-deletions', response_model=dc.DataCenterPage[dc.AccountDeletionItem])
def account_deletions(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
                      db: DBSession = Depends(get_db)):
    return gov.list_account_deletions(db, ctx, query)


@router.get('/baselines', response_model=dc.DataCenterPage[dc.BaselineItem])
def baselines(query: dc.DataCenterQuery = Depends(query_dep), ctx: policy.ResolvedContext = Depends(context_dep),
              db: DBSession = Depends(get_db)):
    return gov.list_baselines(db, ctx, query)


# ── B04 측정 1건 시계열 ───────────────────────────────────────────────────
import re  # noqa: E402

from app.services import data_center_measurement as dm  # noqa: E402

_US = re.compile(r'^(0|[1-9][0-9]{0,18})$')


def backend_dep() -> dm.MeasurementBackend:
    """244 T06/T03 어댑터 주입점(테스트에서는 dependency_overrides 로 fake 를 넣는다)."""
    return dm.default_backend()


def _selection(session_id: UUID, participant_id: UUID, from_us: str | None, to_us: str | None) -> dc.MeasurementSelection:
    for value in (from_us, to_us):
        if value is not None and not _US.match(value):
            raise policy.deny(422, 'range_invalid', 'from_us/to_us 는 0 이상의 정수 µs 문자열입니다')
    return dc.MeasurementSelection(session_id=session_id, participant_id=participant_id, from_us=from_us, to_us=to_us)


@router.get('/measurements/{session_id}/{participant_id}/waveform', response_model=dc.WaveformResponse)
def waveform(session_id: UUID, participant_id: UUID, signal_type: dc.SignalType = Query(...),
             from_us: str | None = Query(None), to_us: str | None = Query(None),
             max_points: int = Query(dm.MAX_POINTS_DEFAULT, ge=10, le=dm.MAX_POINTS_LIMIT),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db),
             backend: dm.MeasurementBackend = Depends(backend_dep)):
    dm.authorize_measurement(db, ctx, session_id, participant_id)
    return dm.read_waveform(backend, _selection(session_id, participant_id, from_us, to_us), signal_type, max_points)


@router.get('/measurements/{session_id}/{participant_id}/features', response_model=dc.FeaturePage)
def features(session_id: UUID, participant_id: UUID, from_us: str | None = Query(None), to_us: str | None = Query(None),
             limit: int = Query(200, ge=1, le=1000), cursor: str | None = Query(None, max_length=512),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db)):
    dm.authorize_measurement(db, ctx, session_id, participant_id)
    query = dc.DataCenterQuery(limit=min(limit, 100), cursor=cursor)
    query = query.model_copy(update={'limit': limit})  # 1Hz 시계열은 페이지당 최대 1000행(일반 목록 상한과 별개)
    return dm.read_features(db, _selection(session_id, participant_id, from_us, to_us), query)


@router.get('/measurements/{session_id}/{participant_id}/indices', response_model=dc.IndicesPage)
def indices(session_id: UUID, participant_id: UUID, limit: int = Query(200, ge=1, le=1000),
            cursor: str | None = Query(None, max_length=512), ctx: policy.ResolvedContext = Depends(context_dep),
            db: DBSession = Depends(get_db), backend: dm.MeasurementBackend = Depends(backend_dep)):
    dm.authorize_measurement(db, ctx, session_id, participant_id)
    query = dc.DataCenterQuery(limit=100, cursor=cursor).model_copy(update={'limit': limit})
    return dm.read_indices(db, backend, _selection(session_id, participant_id, None, None), query)


@router.get('/measurements/{session_id}/{participant_id}/spectrum', response_model=dc.SpectrumResponse)
def spectrum(session_id: UUID, participant_id: UUID, from_us: str = Query(...), to_us: str = Query(...),
             ctx: policy.ResolvedContext = Depends(context_dep), db: DBSession = Depends(get_db),
             backend: dm.MeasurementBackend = Depends(backend_dep)):
    dm.authorize_measurement(db, ctx, session_id, participant_id)
    return dm.read_spectrum(backend, _selection(session_id, participant_id, from_us, to_us))
