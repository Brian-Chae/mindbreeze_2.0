"""SDD-246 T12b — transport 하네스(PG + Redis, v2 플래그 on) 재사용."""
from tests.sdd246.transport.conftest import *  # noqa: F401,F403
from tests.sdd246.transport.conftest import _isolate_handlers, _v2_runtime  # noqa: F401  (autouse fixture 재노출)
