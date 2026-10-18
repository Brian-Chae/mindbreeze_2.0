from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# MIND BREEZE models
from app.core.database import Base
from app.models import *  # noqa: F401,F403 — 모든 모델 로드
from app.config import settings

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# SDD-214: sessions 복합 FK 2개는 PG 마이그레이션(055)에만 두고 ORM 에는 선언하지 않는다(기존 SQLite 테스트 보호, TD8).
# alembic 이 ORM 에 없는 FK 를 remove_fk 로 제안하지 않도록 이름으로 비교에서 제외한다. DB 정의는 PG 테스트가 검증한다.
_DB_ONLY_FOREIGN_KEYS = {"fk_sessions_class_host", "fk_sessions_relationship_host"}


def include_object(obj, name, type_, reflected, compare_to):  # noqa: ANN001
    if type_ == "foreign_key_constraint" and name in _DB_ONLY_FOREIGN_KEYS:
        return False
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url, target_metadata=target_metadata, literal_binds=True, include_object=include_object
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
