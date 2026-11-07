"""sys._current_frames 샘플러(py-spy 미설치 대체): 부하 시험 중 10ms 간격으로 모든 스레드의 최상위 앱 프레임을 집계."""
import collections, json, os, sys, threading, time
import pytest
cnt = collections.Counter(); leaf = collections.Counter(); total = [0]
stop = threading.Event()
def sample():
    me = threading.get_ident()
    while not stop.is_set():
        for tid, fr in sys._current_frames().items():
            if tid == me: continue
            f = fr; app = None; top = f
            while f:
                fn = f.f_code.co_filename
                if '/app/' in fn and app is None: app = f"{fn.split('/backend/')[-1]}:{f.f_code.co_name}"
                f = f.f_back
            name = top.f_code.co_name
            if name in ('wait','select','_worker','sleep','poll','acquire','recv','recv_into','_recv','read','get','epoll'): continue  # 대기성 제외
            leaf[f"{top.f_code.co_filename.split('site-packages/')[-1].split('/backend/')[-1]}:{name}"] += 1
            if app: cnt[app] += 1
            total[0] += 1
        time.sleep(0.01)
t = threading.Thread(target=sample, daemon=True); t.start()
rc = pytest.main(sys.argv[1:]); stop.set()
json.dump({'non_idle_samples': total[0], 'app_top': cnt.most_common(25), 'leaf_top': leaf.most_common(25)}, open(os.environ['PROF_OUT'], 'w'), ensure_ascii=False, indent=1)
sys.exit(rc)
