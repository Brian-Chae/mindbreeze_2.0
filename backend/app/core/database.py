"""Database Session & Base Model"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session as ORMSession, sessionmaker, with_loader_criteria

from app.config import settings

engine = create_engine(settings.database_url, echo=settings.debug)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


@event.listens_for(ORMSession, "do_orm_execute")
def _apply_preservation_filters(state) -> None:
    """SDD-209(B1): 숨김/제거(보존 전환)된 행을 모든 ORM SELECT 에서 기본 제외한다.

    - Session.hidden_at IS NULL            (execution_options include_hidden=True 로 해제)
    - SessionParticipant.removed_at IS NULL (include_removed=True 로 해제)
    보존 전환은 행을 지우지 않고(FK CASCADE 로 원본 소실 방지) 조회에서만 감춘다.
    스위프·관리자 삭제처럼 숨김 행까지 봐야 하는 경로만 옵션으로 해제한다.
    """
    if not state.is_select or state.is_column_load:
        return
    from app.models.session import Session as SessionModel, SessionParticipant

    options = state.execution_options
    statement = state.statement
    if not options.get("include_hidden"):
        statement = statement.options(
            with_loader_criteria(SessionModel, SessionModel.hidden_at.is_(None), include_aliases=True)
        )
    if not options.get("include_removed"):
        statement = statement.options(
            with_loader_criteria(
                SessionParticipant, SessionParticipant.removed_at.is_(None), include_aliases=True
            )
        )
    state.statement = statement


def get_db():
    """FastAPI 의존성 — 요청당 DB 세션 제공.

    MB-ERR-014: 예외 발생 시 close 만 하면 미커밋 변경이 열린 트랜잭션에 남아
    커넥션 반환(풀 재사용) 시 잠금·오염으로 이어질 수 있다. 예외 경로에서 명시적으로
    rollback 한 뒤 예외를 전파하고, finally 에서 항상 close 한다.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
