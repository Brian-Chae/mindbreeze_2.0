import os
import subprocess
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, text
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.core.database import Base
import app.models

with tempfile.TemporaryDirectory(prefix='sdd030_pg_') as tmp:
    root = Path(tmp)
    pgdata = root / 'data'
    subprocess.run(['initdb', '-D', str(pgdata), '-A', 'trust', '-U', 'sdd030', '--no-locale'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['pg_ctl', '-D', str(pgdata), '-l', str(root / 'pg.log'), '-o', f"-k {tmp} -p 55439 -h ''", '-w', 'start'], check=True)
    try:
        url = f'postgresql://sdd030@/postgres?host={tmp}&port=55439'
        env = {**os.environ, 'DATABASE_URL': url}
        def migrate(*args):
            subprocess.run(['./venv/bin/alembic', *args], env=env, check=True)
        # 기존 마이그레이션 체인의 중복 테이블 오류와 분리해 직전 모델 스키마 구성.
        from sqlalchemy import MetaData
        engine = create_engine(url)
        previous = MetaData()
        for table in Base.metadata.sorted_tables:
            table.to_metadata(previous)
        table = previous.tables['eeg_feature_windows']
        table._columns.remove(table.c.respiratory_rate)
        previous.create_all(engine)
        migrate('stamp', '4235a5871ac6')
        migrate('upgrade', 'head')
        engine = create_engine(url)
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
            print('FULL_METADATA_DIFF:', diff, flush=True)
            assert diff == [], diff
            col = conn.execute(text("SELECT is_nullable, data_type FROM information_schema.columns WHERE table_name='eeg_feature_windows' AND column_name='respiratory_rate'" )).one()
            assert tuple(col) == ('YES', 'double precision'), col
        migrate('downgrade', '4235a5871ac6')
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name='eeg_feature_windows' AND column_name='respiratory_rate'" )).scalar_one() == 0
        migrate('upgrade', 'head')
        with engine.connect() as conn:
            assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []
        engine.dispose()
        print('PASS: PostgreSQL previous-model baseline incremental upgrade, nullable column, downgrade, re-upgrade, compare_metadata=[]', flush=True)
    finally:
        subprocess.run(['pg_ctl', '-D', str(pgdata), '-m', 'fast', '-w', 'stop'], check=True)
