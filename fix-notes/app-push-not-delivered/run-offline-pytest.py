"""환경파일을 읽지 않고 외부 네트워크를 차단하는 pytest 검증 진입점."""
import sys
import socket
import os
from pathlib import Path

os.chdir(Path(__file__).resolve().parents[2] / "backend")
from pydantic_settings import BaseSettings
original = BaseSettings.__init__
def isolated(self, *args, **kwargs):
    kwargs['_env_file'] = None
    original(self, *args, **kwargs)
BaseSettings.__init__ = isolated
original_connect = socket.socket.connect
def blocked(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        raise RuntimeError('외부 네트워크는 검증 중 금지됨')
    return original_connect(self, address)
socket.socket.connect = blocked
sys.path.insert(0, '.')
import pytest
raise SystemExit(pytest.main(sys.argv[1:]))
