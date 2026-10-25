"""SDD-246 T04 — 원자 Lua 스크립트 (plan §3.3, §4.2).

모든 키는 회차 hash tag `{session}` 를 공유하므로 단일 hash slot 이다(cluster 에서도 같은 slot).
스크립트가 `base` 문자열로 파생 키를 만들기 때문에 cluster 의 "KEYS 선언" 규칙을 엄밀히 따르지는 않는다 —
운영은 단일 노드/Sentinel 전제이고, cluster 로 옮길 때는 hash tag 가 같다는 점만 유지하면 동작한다.

한 번의 EVAL 안에서: epoch·fence·이전 revision 검사 → 중복 확인 → audience 별 seq 증가 → state 갱신 + stream append
→ projection watermark(applied_revision) 갱신이 전부 일어난다. 중간 상태는 다른 클라이언트에 보이지 않는다.
snapshot/replay 도 같은 원자 경계에서 읽으므로 "snapshot 의 state 와 through vector 는 항상 같은 시점"이다.
"""

# 키 추적: 회차 키 전부를 `keys` 집합에 모아 terminal 시 한 번에 TTL 을 건다.
PROJECT = r"""#!lua
local meta = KEYS[1]
local lock = KEYS[2]
local base = ARGV[1]
local status = redis.call('HGET', meta, 'status')
if not status then return {'err', 'no_meta'} end
if status == 'building' then return {'err', 'not_ready'} end
if redis.call('HGET', meta, 'epoch') ~= ARGV[2] then return {'err', 'epoch_mismatch'} end
if redis.call('HGET', lock, 'fence') ~= ARGV[3] then return {'err', 'stale_fence'} end

local applied = tonumber(redis.call('HGET', meta, 'applied_revision'))
local rev = tonumber(ARGV[4])
local dedupe = base .. ':dedupe:' .. ARGV[5]
if redis.call('EXISTS', dedupe) == 1 or rev <= applied then return {'dup', tostring(applied)} end
if rev ~= applied + 1 then return {'err', 'gap', tostring(applied)} end

local domain = ARGV[6]
local wire_entity = ARGV[7]
local entity = wire_entity
if ARGV[6] == 'session' or ARGV[6] == 'audio' or ARGV[6] == 'aggregate' or ARGV[6] == 'policy' or entity == '' then
  entity = '_'
end
local version = tonumber(ARGV[8])
local now_ms = tonumber(ARGV[12])
local maxlen = tonumber(ARGV[16])
local retain_ms = tonumber(ARGV[17])
local keys_set = base .. ':keys'
redis.call('SADD', keys_set, meta)
redis.call('SADD', keys_set, keys_set)

local out = {'ok'}
for i = 21, #ARGV do
  local aud = ARGV[i]
  local seq_key = base .. ':seq:' .. aud .. ':' .. domain
  local ev_key = base .. ':events:' .. aud .. ':' .. domain
  local st_key = base .. ':state:' .. aud .. ':' .. domain
  local seq = redis.call('INCR', seq_key)
  -- stream ID = "<seq>-0": seq 가 곧 ID 라 replay(cursor) 가 XRANGE 한 번이다.
  redis.call('XADD', ev_key, seq .. '-0',
    'event_id', ARGV[5], 'kind', ARGV[9], 'entity_id', wire_entity, 'entity_version', ARGV[8],
    'payload', ARGV[10], 'command_id', ARGV[11], 'at', ARGV[12], 'deleted', ARGV[13])
  redis.call('XTRIM', ev_key, 'MAXLEN', maxlen)
  for _ = 1, 32 do
    local first = redis.call('XRANGE', ev_key, '-', '+', 'COUNT', 1)
    if #first == 0 then break end
    local at = nil
    local f = first[1][2]
    for j = 1, #f, 2 do if f[j] == 'at' then at = tonumber(f[j + 1]) end end
    if at and at < now_ms - retain_ms and #first > 0 and redis.call('XLEN', ev_key) > 1 then
      redis.call('XDEL', ev_key, first[1][1])
    else
      break
    end
  end
  -- entity 단위 버전 비교: 낮은 버전은 state 를 덮지 못한다(stream 에는 남는다).
  local cur = redis.call('HGET', st_key, entity)
  local write = true
  if cur then
    local c = cjson.decode(cur)
    if c.v and tonumber(c.v) > version then write = false end
  end
  if write then redis.call('HSET', st_key, entity, ARGV[20]) end
  redis.call('SADD', keys_set, seq_key, ev_key, st_key)
  out[#out + 1] = aud
  out[#out + 1] = tostring(seq)
end

redis.call('SET', dedupe, ARGV[4], 'EX', tonumber(ARGV[18]))
redis.call('SADD', keys_set, dedupe)
redis.call('HSET', meta, 'applied_revision', ARGV[4], 'last_event_ms', ARGV[12])
local auth = tonumber(redis.call('HGET', meta, 'auth_revision') or '0')
if tonumber(ARGV[15]) > auth then redis.call('HSET', meta, 'auth_revision', ARGV[15]) end
if ARGV[14] == '1' then redis.call('HSET', meta, 'status', 'terminal') end
-- 종료 후 TTL: terminal 이면 이 회차의 모든 키(이후 늦게 생기는 키 포함)에 24h 를 건다. active 동안은 만료 없음.
if redis.call('HGET', meta, 'status') == 'terminal' then
  local ttl = tonumber(ARGV[19])
  for _, k in ipairs(redis.call('SMEMBERS', keys_set)) do
    if redis.call('TTL', k) == -1 then redis.call('EXPIRE', k, ttl) end
  end
end
return out
"""

# KEYS[1]=meta, ARGV: base, domains(csv), with_state(0/1), audiences...
SNAPSHOT = r"""#!lua flags=no-writes
local meta = KEYS[1]
local base = ARGV[1]
local status = redis.call('HGET', meta, 'status')
if not status then return {'err', 'no_meta'} end
if status == 'building' then return {'err', 'not_ready'} end
local res = {'ok', redis.call('HGET', meta, 'epoch'), status,
  redis.call('HGET', meta, 'auth_revision') or '0', redis.call('HGET', meta, 'applied_revision') or '0'}
local entries = {}
for i = 4, #ARGV do
  local aud = ARGV[i]
  for dom in string.gmatch(ARGV[2], '[^,]+') do
    local seq = redis.call('GET', base .. ':seq:' .. aud .. ':' .. dom) or '0'
    local state = {}
    if ARGV[3] == '1' then state = redis.call('HGETALL', base .. ':state:' .. aud .. ':' .. dom) end
    entries[#entries + 1] = {aud, dom, seq, state}
  end
end
res[6] = entries
return res
"""

# KEYS[1]=meta, ARGV: base, expected_epoch(''=무시), (audience, domain, cursor)*
REPLAY = r"""#!lua flags=no-writes
local meta = KEYS[1]
local base = ARGV[1]
local status = redis.call('HGET', meta, 'status')
if not status then return {'err', 'no_meta'} end
if status == 'building' then return {'err', 'not_ready'} end
local epoch = redis.call('HGET', meta, 'epoch')
if ARGV[2] ~= '' and ARGV[2] ~= epoch then return {'err', 'epoch_mismatch', epoch} end
local res = {'ok', epoch, status, redis.call('HGET', meta, 'auth_revision') or '0'}
local entries = {}
local i = 3
while i <= #ARGV do
  local aud, dom, cstr = ARGV[i], ARGV[i + 1], ARGV[i + 2]
  local cursor = tonumber(cstr)
  i = i + 3
  local seq = tonumber(redis.call('GET', base .. ':seq:' .. aud .. ':' .. dom) or '0')
  local ev_key = base .. ':events:' .. aud .. ':' .. dom
  local flag = 'ok'
  local evs = {}
  if cursor > seq then
    flag = 'ahead'                       -- 클라이언트가 서버보다 앞섬: epoch 불일치와 같은 취급(새 snapshot)
  elseif cursor < seq then
    local first = redis.call('XRANGE', ev_key, '-', '+', 'COUNT', 1)
    local first_seq = nil
    if #first > 0 then first_seq = tonumber(string.match(first[1][1], '^(%d+)-')) end
    if first_seq == nil or first_seq > cursor + 1 then
      flag = 'truncated'                 -- log 가 잘렸다: replay 불가, 새 snapshot
    else
      evs = redis.call('XRANGE', ev_key, '(' .. cstr .. '-0', '+')
    end
  end
  entries[#entries + 1] = {aud, dom, tostring(seq), flag, evs}
end
res[5] = entries
return res
"""

# KEYS[1]=meta. ARGV: base, epoch, applied_revision, auth_revision, status, terminal_ttl, states_json
# states_json = {"<aud>|<dom>": {"<entity>": "<value json>"}}
RESTORE = r"""#!lua
local meta = KEYS[1]
local base = ARGV[1]
local cur_status = redis.call('HGET', meta, 'status')
if cur_status and cur_status ~= 'building' then
  local cur = tonumber(redis.call('HGET', meta, 'epoch') or '0')
  if cur >= tonumber(ARGV[2]) then return {'exists', tostring(cur)} end
end
local keys_set = base .. ':keys'
local fence_key = base .. ':fence'
-- 이전 epoch 의 stream/seq/state/dedupe 잔재를 전부 지운다. fence 카운터는 지우지 않는다(과거 fence 재사용 금지).
for _, k in ipairs(redis.call('SMEMBERS', keys_set)) do
  if k ~= fence_key then redis.call('DEL', k) end
end
redis.call('SADD', keys_set, meta, keys_set)
local decoded = cjson.decode(ARGV[7])
for ad, n in pairs(decoded.seqs) do
  local aud, dom = string.match(ad, '^(.-)|(.+)$')
  local sk = base .. ':seq:' .. aud .. ':' .. dom
  redis.call('SET', sk, n)
  redis.call('SADD', keys_set, sk)
end
for ad, fields in pairs(decoded.states) do
  local aud, dom = string.match(ad, '^(.-)|(.+)$')
  local st_key = base .. ':state:' .. aud .. ':' .. dom
  redis.call('DEL', st_key)
  for ent, val in pairs(fields) do redis.call('HSET', st_key, ent, val) end
  redis.call('SADD', keys_set, st_key)
end
redis.call('HSET', meta, 'epoch', ARGV[2], 'applied_revision', ARGV[3], 'auth_revision', ARGV[4], 'status', ARGV[5],
  'protocol', '2')
redis.call('SADD', keys_set, meta)
if ARGV[5] == 'terminal' then
  local ttl = tonumber(ARGV[6])
  for _, k in ipairs(redis.call('SMEMBERS', keys_set)) do
    if redis.call('TTL', k) == -1 then redis.call('EXPIRE', k, ttl) end
  end
end
return {'ok', ARGV[2]}
"""

# KEYS[1]=lock, KEYS[2]=fence counter, KEYS[3]=keys set. ARGV: token, ttl_ms
LOCK_ACQUIRE = r"""#!lua
local t = redis.call('HGET', KEYS[1], 'token')
if not t then
  local f = redis.call('INCR', KEYS[2])
  redis.call('HSET', KEYS[1], 'token', ARGV[1], 'fence', tostring(f))
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  redis.call('SADD', KEYS[3], KEYS[2])
  return {1, tostring(f)}
elseif t == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return {1, redis.call('HGET', KEYS[1], 'fence')}
end
return {0, '0'}
"""

LOCK_RENEW = r"""#!lua
if redis.call('HGET', KEYS[1], 'token') == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
"""

LOCK_RELEASE = r"""#!lua
if redis.call('HGET', KEYS[1], 'token') == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""

# 단순 문자열 락(재구축 락) 비교 삭제
STR_UNLOCK = r"""#!lua
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
