"""서버·DB 연결 없이 기존 백엔드 알림 병합 계약과 승인 매핑을 독립 검증한다."""
import ast
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
model = ast.parse((ROOT / 'backend/app/models/user.py').read_text())
service = ast.parse((ROOT / 'backend/app/services/notification_service.py').read_text())
# 모델의 정적 알림 기본값 선언·추가 이벤트 루프만 실행한다. ORM 모듈은 import하지 않는다.
namespace = {}
for node in model.body:
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.For)) and any(key in ast.unparse(node) for key in ['DEFAULT_NOTIFICATION_PREFERENCES', 'CLASS_NOTIFICATION_EVENTS']):
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<알림 기본값>', 'exec'), namespace)
defaults = namespace['DEFAULT_NOTIFICATION_PREFERENCES']
events = json.loads((ROOT / 'designs/settings-tab-playground/audit-data.json').read_text())
assert len(events) == len({item['key'] for item in events}) == 47
assert set(defaults['email']) == set(defaults['in_app']) == {item['key'] for item in events}
for item in events:
    assert defaults['email'][item['key']] == item['email']
    assert defaults['in_app'][item['key']] is True
assert [sum(item['group'] == group for item in events) for group in ['일정·참여', '대화', '리포트·운영']] == [23, 4, 20]

class User:
    id = 'fixture'
class FakeHTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)

class FakeDB:
    def __init__(self, user): self.user = user; self.commits = 0
    def query(self, _): return self
    def filter(self, _): return self
    def first(self): return self.user
    def commit(self): self.commits += 1
    def refresh(self, _): pass

runtime = {**namespace, 'User': User, 'DBSession': FakeDB, '_to_uuid': lambda value: value, 'HTTPException': FakeHTTPException, 'EVENT_CATALOG': {item['key']: {} for item in events}}
for node in service.body:
    if isinstance(node, ast.FunctionDef) and node.name in ['get_user_preferences', 'update_preferences']:
        exec(compile('from __future__ import annotations\n' + ast.unparse(node), '<알림 병합 함수>', 'exec'), runtime)
user = User()
user.notification_preferences = {'email': {'retired_event': False}, 'in_app': {'agent_message': False}, 'push': {'chat_message': False}}
before = copy.deepcopy(user.notification_preferences)
first = runtime['get_user_preferences'](user)
db = FakeDB(user)
result = runtime['update_preferences']('fixture', {'chat_message': True}, {}, db)
assert result['email']['chat_message'] is True
assert result['email']['retired_event'] is False
assert result['in_app']['agent_message'] is False
assert result['push']['chat_message'] is False
assert first['email']['chat_message'] is False
assert first['email']['retired_event'] == before['email']['retired_event']
assert db.commits == 1
try:
    runtime['update_preferences']('fixture', {'retired_event': True}, {}, db)
    raise AssertionError('미지원 키 재전송은 거부되어야 한다')
except FakeHTTPException as error:
    assert error.status_code == 422
assert db.commits == 1
print('PASS: 기본47키/그룹23·4·20/기존 legacy·push·미제출키·이전응답 불변')
