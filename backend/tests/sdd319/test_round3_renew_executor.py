"""round-3 renew 전용 소형 executor: 실제 스레드로 격리·상한·context·예외를 검증한다."""
from __future__ import annotations

import asyncio
import contextvars
import threading
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.ws import session_live_namespace as ns

# 미채택 전용 풀 실험의 증거. 해당 구현 사본에서 명시 실행할 때만 사용한다.
pytestmark = pytest.mark.skipif(
    os.environ.get("S319_EXPERIMENTAL_RENEW_EXECUTOR") != "1",
    reason="미채택 renew 전용 풀 실험")


def test_default_executor가_포화여도_renew는_진행한다():
    async def run():
        loop = asyncio.get_running_loop()
        loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
        started = asyncio.Event()
        release = threading.Event()
        def occupy():
            loop.call_soon_threadsafe(started.set)
            assert release.wait(3), '시험 blocker 해제 누락'
        pending = asyncio.create_task(asyncio.to_thread(occupy))
        try:
            await asyncio.wait_for(started.wait(), 1)
            result = await asyncio.wait_for(ns._renew_to_thread(lambda: 'renew-ok'), 1)
            assert result == 'renew-ok'
        finally:
            release.set()
            await pending
    asyncio.run(run())


def test_renew는_4개_worker를_넘어_동시에_실행하지_않는다():
    async def run():
        loop = asyncio.get_running_loop()
        first_four = asyncio.Event()
        release = threading.Event()
        lock = threading.Lock()
        state = {'active': 0, 'peak': 0}
        threads = set()
        def work(i):
            with lock:
                threads.add(threading.get_ident())
                state['active'] += 1
                state['peak'] = max(state['peak'], state['active'])
                if state['active'] >= 4:
                    loop.call_soon_threadsafe(first_four.set)
            try:
                assert release.wait(3), '시험 blocker 해제 누락'
                return i
            finally:
                with lock:
                    state['active'] -= 1
        pending = [asyncio.create_task(ns._renew_to_thread(work, i)) for i in range(12)]
        try:
            await asyncio.wait_for(first_four.wait(), 1)
            # 모든 제출이 끝난 상태에서 초과 worker가 생기는지 확인한다.
            await asyncio.sleep(0.1)
            assert state['peak'] == 4
        finally:
            release.set()
            results = await asyncio.gather(*pending)
        assert results == list(range(12))
        assert len(threads) == 4
    asyncio.run(run())


def test_renew_worker에_context를_전달하고_호출자_context는_보존한다():
    trace = contextvars.ContextVar('round3_trace', default='unset')
    async def run():
        trace.set('request-context')
        def work():
            original = trace.get()
            trace.set('worker-context')
            return original
        assert await ns._renew_to_thread(work) == 'request-context'
        assert trace.get() == 'request-context'
    asyncio.run(run())


def test_renew_worker_예외는_호출자에게_그대로_전달한다():
    error = ValueError('합성 renew 오류')
    def fail():
        raise error
    async def run():
        with pytest.raises(ValueError) as caught:
            await ns._renew_to_thread(fail)
        assert caught.value is error
    asyncio.run(run())
