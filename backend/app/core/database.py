"""Database Session & Base Model"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, echo=settings.debug)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


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
