"""SDD-282 복구 드라이런 — 쓰기 없음(READ-ONLY).

이 스크립트는 SELECT 와 S3 읽기(다운로드/존재 확인)만 한다. INSERT/UPDATE/DELETE/commit 을 호출하지 않으며,
연결은 `SET TRANSACTION READ ONLY` 로 열어 DB 가 쓰기를 거부하도록 강제한다(마지막에 rollback).
출력은 건수·접두사(6자)만. 개인정보·비밀값은 출력하지 않는다.

하는 일
 1) 대상 4명의 feature 파일(biosignal_artifacts kind=feature, signal=eeg, uploaded)을 읽는다.
 2) 파일 행에는 stream_id·버전값이 없으므로 capture_stream 에서 채워 MetricWindow 로 파싱하고
    운영 코드와 같은 변환기(live_ingest_service._feature_item)로 eeg_feature_windows 컬럼 값을 만든다.
 3) 정상자 14b252 의 파일 행을 같은 방식으로 변환해 DB 에 이미 있는 행과 컬럼 단위로 비교한다(변환기 검증).
 4) 대상별 삽입 예정/기존/중복/충돌 건수, 리포트·발송 상태를 센다.

실행(서버): cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
           /opt/mindbreeze/venv/bin/python - < sdd282-recovery-dryrun.py
"""
import collections, gzip, json, os
from datetime import datetime, timezone
from sqlalchemy import create_engine, text

S = "1a74e4c9-a54e-4454-8505-22840922811c"
TARGETS = ["de8312", "6a2172", "518675", "ac1a78"]
CONTROL = "14b252"
e = create_engine(os.environ["DATABASE_URL"])
c = e.connect()
c.execute(text("SET TRANSACTION READ ONLY"))  # 쓰기 시도 시 DB 가 거부


def q(sql, **p):
    return c.execute(text(sql), {"s": S, **p}).all()


def sec(t):
    print("==", t)


from app.services import storage_service as ss
from app.schemas.session_live_ingest import parse_metric_window
from app.services.live_ingest_service import _feature_item, eeg_window_invalid
from app.services.session_service import _quality_from_signal


def load_rows(key):
    b = ss.download_bytes(key)
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    return [json.loads(l) for l in b.splitlines() if l.strip()]


def envelope(row, pid, cs):
    """파일 행 + capture_stream → store_batch 가 받는 MetricWindow 원본 형태."""
    return {**row, "session_id": S, "participant_id": pid, "stream_id": cs["id"], "stream_generation": str(cs["generation"]),
            # clock_anchor_id·clock_uncertainty_ms 는 DB 에 저장되지 않는 검증용 값이다(_feature_item 이 쓰지 않는다).
            # 앵커를 못 받은 stream(capture.renew/reanchor 0건)은 NULL 이라 파서를 통과하도록 영 UUID·0 으로 채운다.
            "clock_anchor_id": cs["clock_anchor_id"] or "00000000-0000-0000-0000-000000000000",
            "clock_uncertainty_ms": cs["clock_uncertainty_ms"] if cs["clock_uncertainty_ms"] is not None else 0,
            "device_profile_version": cs["device_profile"], "algorithm_version": cs["algorithm_version"],
            "model_version": cs["model_version"]}


COLS = ["delta_power", "theta_power", "alpha_power", "beta_power", "gamma_power", "total_power", "focus_index", "relaxation_index",
        "stress_index", "meditation_level", "attention_level", "cognitive_load", "emotional_stability", "hemispheric_balance",
        "total_neural_activity", "faa", "signal_quality", "sdnn", "rmssd", "lf_power", "hf_power", "lf_hf_ratio", "heart_rate",
        "respiratory_rate", "motion", "source_feature_alias", "algorithm_version"]


def convert(row, pid, cs):
    w = parse_metric_window(envelope(row, pid, cs))
    end_at = datetime.fromtimestamp(w.observed_at_ms / 1000, tz=timezone.utc)
    f = _feature_item(w, end_at, True).model_copy(update={"timestamp": float(w.observed_at_ms)})
    vals = {k: getattr(f, k, None) for k in COLS}
    vals["window_index"] = f.second_offset
    vals["device_timestamp_ms"] = f.timestamp
    vals["quality"] = "invalid" if eeg_window_invalid(w) else _quality_from_signal(f.signal_quality)
    return w, vals


sec("스키마 단서")
print("ingest_path 길이:", q("select character_maximum_length from information_schema.columns where table_name='eeg_feature_windows' and column_name='ingest_path'")[0][0])
print("제약:", [(r[0], r[1]) for r in q("select conname, contype from pg_constraint where conrelid='eeg_feature_windows'::regclass")])
print("트리거:", q("select count(*) from pg_trigger where tgrelid='eeg_feature_windows'::regclass and not tgisinternal")[0][0])
print("eeg_feature_windows 전체/이 회차:", q("select count(*) from eeg_feature_windows")[0][0], q("select count(*) from eeg_feature_windows where session_id=:s")[0][0])
print("ingest_path 분포:", q("select ingest_path, count(*) from eeg_feature_windows group by 1"))
print("이 회차 late 분포:", q("select late, count(*) from eeg_feature_windows where session_id=:s group by 1"))

sec("대상별 사전 계산")
tot = collections.Counter()
for pre in TARGETS + [CONTROL]:
    pid, band, cons = q("select id::text, band_connected, eeg_collection_consented from session_participants where session_id=:s and id::text like :p", p=pre + "%")[0]
    css = q("""select id::text, generation, clock_anchor_id::text, clock_uncertainty_ms, device_profile, algorithm_version, model_version, cutoff_code, status
               from capture_stream where session_id=:s and participant_id=cast(:pid as uuid) order by generation""", pid=pid)
    cs_list = [dict(zip(["id", "generation", "clock_anchor_id", "clock_uncertainty_ms", "device_profile", "algorithm_version", "model_version", "cutoff_code", "status"], r)) for r in css]
    arts = q("""select object_key, upload_status, row_count, first_sequence, last_sequence, to_char(created_at at time zone 'Asia/Seoul','MM-DD HH24:MI')
                from biosignal_artifacts where session_id=:s and participant_id=cast(:pid as uuid) and artifact_kind='feature' and signal='eeg' order by sequence""", pid=pid)
    up = [a for a in arts if a[1] == "uploaded"]
    pend = [a for a in arts if a[1] != "uploaded"]
    rows = [r for a in up for r in load_rows(a[0])]
    seqs = [int(r["sequence"]) for r in rows]
    hashes = collections.defaultdict(set)
    for r in rows:
        hashes[int(r["sequence"])].add(r["feature_hash"])
    # 기존 DB 행(참가자 전체, 모든 play_group)
    db_rows = {}
    for r in q("select play_group_id, window_index, source_feature_alias from eeg_feature_windows where session_id=:s and participant_id=cast(:pid as uuid)", pid=pid):
        db_rows.setdefault(r[0], {})[int(r[1])] = r[2]
    print(f"[{pre}{' 대조' if pre == CONTROL else ''}] 밴드연결={band} 뇌파동의={cons} capture_stream={len(cs_list)}개 "
          f"(generation={[s['generation'] for s in cs_list]} cutoff={[s['cutoff_code'] for s in cs_list]} status={[s['status'] for s in cs_list]})")
    print(f"      파일: 업로드완료 {len(up)}개/행 {len(rows)}, 고유seq {len(set(seqs))} 범위({min(seqs)},{max(seqs)}) 파일내중복 {len(seqs)-len(set(seqs))} "
          f"seq당 hash2개이상 {sum(1 for v in hashes.values() if len(v)>1)} / 미완료 {len(pend)}개(행 {sum(a[2] for a in pend)}) / 업로드시각분포 {dict(collections.Counter(a[5][:8] for a in up))}")
    if pre != CONTROL:
        cs = cs_list[0]
        conv_ok, conv_fail, qual = 0, 0, collections.Counter()
        valid_focus = 0
        obs_min = obs_max = None
        for r in rows:
            try:
                w, v = convert(r, pid, cs)
                conv_ok += 1
                qual[v["quality"]] += 1
                valid_focus += v["focus_index"] is not None
                obs_min = w.observed_at_ms if obs_min is None else min(obs_min, w.observed_at_ms)
                obs_max = w.observed_at_ms if obs_max is None else max(obs_max, w.observed_at_ms)
            except Exception as ex:
                conv_fail += 1
                if conv_fail == 1:
                    print("      변환 실패 예:", type(ex).__name__, str(ex)[:100])
        pg = db_rows.get(cs["id"], {})
        already = sum(1 for sq in set(seqs) if sq in pg)
        any_pg_rows = sum(len(v) for v in db_rows.values())
        would = len(set(seqs)) - already
        print(f"      변환통과 {conv_ok}/{len(rows)} (실패 {conv_fail}) quality분포 {dict(qual)} focus값있는 행 {valid_focus} "
              f"관측구간(UTC) {datetime.fromtimestamp(obs_min/1000, tz=timezone.utc):%H:%M:%S}~{datetime.fromtimestamp(obs_max/1000, tz=timezone.utc):%H:%M:%S}")
        print(f"      DB 기존 행(참가자 전체) {any_pg_rows} / 같은 play_group(=capture_stream.id) 기존 {len(pg)} / 겹치는 sequence {already} / 삽입 예정 {would}")
        tot["file_rows"] += len(rows); tot["insert"] += would; tot["already"] += already; tot["conv_fail"] += conv_fail
        tot["dup_in_file"] += len(seqs) - len(set(seqs)); tot["pending_rows"] += sum(a[2] for a in pend)
    else:
        # 변환기 검증: 파일 행을 변환해 DB 행과 컬럼 단위 비교. 파일 행이 어느 capture_stream 소속인지는 DB 에서 (sequence, hash)로 찾는다.
        by_seq = collections.defaultdict(list)
        for cs in cs_list:
            for sq, h in db_rows.get(cs["id"], {}).items():
                by_seq[sq].append((cs, h))
        dbfull = {(r[0], int(r[1])): r for r in q(f"select play_group_id, window_index, {', '.join(COLS + ['device_timestamp_ms', 'quality'])} from eeg_feature_windows where session_id=:s and participant_id=cast(:pid as uuid)", pid=pid)}
        names = ["pg", "window_index"] + COLS + ["device_timestamp_ms", "quality"]
        cmp_rows = same_cols = hash_match = 0
        diff = collections.Counter()
        for r in rows:
            sq = int(r["sequence"])
            cands = [(cs, h) for cs, h in by_seq.get(sq, []) if h == r["feature_hash"]]
            if not cands:
                continue
            hash_match += 1
            cs = cands[0][0]
            w, v = convert(r, pid, cs)
            d = dict(zip(names, dbfull[(cs["id"], sq)]))
            bad = [k for k in v if not (v[k] == d[k] or (isinstance(v[k], float) and d[k] is not None and abs(v[k] - d[k]) < 1e-9))]
            cmp_rows += 1
            if bad:
                for k in bad: diff[k] += 1
            else:
                same_cols += 1
        print(f"      변환기 검증: 파일 {len(rows)}행 중 (sequence,hash) DB와 일치 {hash_match} → 변환 컬럼값 {len(COLS)+3}개 전부 동일 {same_cols}/{cmp_rows} 불일치 컬럼 {dict(diff)}")
        print(f"      DB play_group별 행 수 {[(k[:8], len(v)) for k, v in db_rows.items()]} / DB quality·ingest_path {q('select quality, ingest_path, late, count(*) from eeg_feature_windows where session_id=:s and participant_id=cast(:pid as uuid) group by 1,2,3', pid=pid)}")

print("4명 합계:", dict(tot))

sec("518675 업로드 대기 artifact — 원본 객체·무결성·변환 가능 여부(읽기만)")
import hashlib
st, en = q("select started_at, ended_at from sessions where id=:s")[0]
sm, em = int(st.timestamp() * 1000), int(en.timestamp() * 1000)
pid518 = q("select id::text from session_participants where session_id=:s and id::text like '518675%'")[0][0]
cs518 = dict(zip(["id", "generation", "clock_anchor_id", "clock_uncertainty_ms", "device_profile", "algorithm_version", "model_version"],
                 q("select id::text, generation, clock_anchor_id::text, clock_uncertainty_ms, device_profile, algorithm_version, model_version from capture_stream where session_id=:s and participant_id=cast(:pid as uuid)", pid=pid518)[0]))
for a in q("""select object_key, row_count, first_sequence, last_sequence, upload_status, failure_reason, checksum, size_bytes, verified_at is not null
              from biosignal_artifacts where session_id=:s and participant_id=cast(:pid as uuid) and artifact_kind='feature' and upload_status<>'uploaded'""", pid=pid518):
    try:
        b = ss.download_bytes(a[0])
        raw = gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
        rows = [json.loads(l) for l in raw.splitlines() if l.strip()]
        ok = 0
        for r in rows:
            convert(r, pid518, cs518); ok += 1
        sq = [int(r["sequence"]) for r in rows]
        inw = sum(1 for r in rows if sm <= r["observed_at_ms"] <= em)
        print("  ", {"상태": a[4], "verified": a[8], "기록행": a[1], "seq(기록)": (a[2], a[3]), "실제행": len(rows), "seq(실제)": (min(sq), max(sq)),
                    "크기일치": len(b) == a[7], "저장바이트 sha256==checksum": hashlib.sha256(b).hexdigest() == a[6], "변환통과": ok, "회차구간내": inw,
                    "기존 업로드분과 seq 겹침 없음": min(sq) > 2580})
    except Exception as ex_:
        print("  ", {"상태": a[4], "S3": f"읽기/변환 실패({type(ex_).__name__})"})

sec("리포트·발송 상태 (건수·상태값만)")
for pre in TARGETS:
    r = q("""select p.id::text, p.report_included, p.report_consent_override, (p.report_email is not null), (p.report_email_sent_at is not null),
                    p.report_email_status, p.attendance_status, (p.removed_at is not null), p.is_waitlisted from session_participants p where p.session_id=:s and p.id::text like :p""", p=pre + "%")[0]
    print(f"[{pre}] report_included={r[1]} override={r[2]} 이메일등록={r[3]} sent_at있음={r[4]} email_status={r[5]} attendance={r[6]} removed={r[7]} waitlisted={r[8]}")
    for rep in q("""select type, status, generation_status, data_credibility, length(content::text), sent_at is not null, approved_at is not null, approval_source,
                           delivery_status, delivery_attempt_count, is_read, pdf_url is not null from reports where session_id=:s and participant_id=cast(:pid as uuid)""", pid=r[0]):
        print("      client 리포트(유형,상태,생성상태,신뢰도,본문길이,sent_at,approved_at,승인경로,발송상태,발송시도,읽음,pdf):", rep)
print("회차 reports 분포:", q("select type, status, generation_status, count(*) from reports where session_id=:s group by 1,2,3 order by 1,2,3"))
print("counselor 리포트(상태,생성상태,본문길이,approved_at,sent_at,class_report있음,counselor_comment있음):", q("select status, generation_status, length(content::text), approved_at is not null, sent_at is not null, content ? 'class_report', content ? 'counselor_comment' from reports where session_id=:s and type='counselor'"))
print("회차 report_email_sent_at 있는 참가자:", q("select count(*) from session_participants where session_id=:s and report_email_sent_at is not null")[0][0])
print("호스트 auto_approve_report / class_id 있음:", q("select u.auto_approve_report, s.class_id is not null from sessions s join users u on u.id=s.host_id where s.id=:s")[0])
print("대상 4명 report_choice_events:", q("select substr(participant_id::text,1,6), count(*) from report_choice_events where session_id=:s and participant_id::text ~ '^(de8312|6a2172|518675|ac1a78)' group by 1 order by 1"))
print("회차 notification_outbox 중 report_ready 건수(대상 4명 user):", q("""select count(*) from notification_outbox o where o.created_at > now() - interval '2 days' and o.payload::text like '%report%'""")[0][0] if q("select 1 from information_schema.tables where table_name='notification_outbox'") else "테이블 없음")
c.rollback()
print("끝 — 쓰기 없음(READ ONLY 트랜잭션 rollback)")
