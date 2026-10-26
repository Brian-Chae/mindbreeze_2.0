// 실제 WASM(wasm-bindgen --target nodejs)을 node 에서 실행해 네이티브 replay 와 바이트 단위로 비교한다.
// 사용: node scripts/verify-wasm.mjs <pkg_dir> <golden_synth_dir> <native_replay.json>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [, , pkg, synth, nativePath] = process.argv;
const require = createRequire(import.meta.url);
const w = require(pkg + '/measurement_core.js');
const cfg = JSON.stringify({ abi_version: 1, device_profile_version: 'linkband2-v1', algorithm_version: 'web-ts-1', model_version: 'b0-cohort-2', model_hash: 'a'.repeat(64), model_mode: 'legacy_cohort', rates_hz: { eeg: 250, ppg: 50, acc: 30 }, anchor: 'last_sample_web_v1', acc_interval_profile: 'rounded_33333us_v1' });
if (w.abiVersion() !== 1) throw new Error('abi');
const blob = readFileSync(synth + '/stream.bin');
const sched = JSON.parse(readFileSync(synth + '/schedule.json', 'utf8'));
const code = { eeg: 0, ppg: 1, acc: 2 };
const core = new w.McCore(cfg);
const frames = []; const statuses = [];
for (const [arr, s, off, len] of sched) {
  const r = JSON.parse(core.push_packet_raw(code[s], new Uint8Array(blob.subarray(off, off + len)), arr, 1760000000000, 0));
  if (!r.ok) throw new Error('push 실패 ' + JSON.stringify(r));
  statuses.push(r.value.packet.status); frames.push(...r.value.frames);
}
const ck = core.checkpoint();
const fin = JSON.parse(core.close()).value;
// checkpoint 복원 + 잘못된 입력 오류 값
const restored = w.McCore.restore(cfg, ck); restored.free();
let threw = false; try { w.McCore.restore(cfg, new Uint8Array([1, 2, 3])); } catch (e) { threw = String(e).includes('checkpoint_corrupt'); }
const bad = JSON.parse(core.push_packet('{"sensor":"ppg"}'));
core.free();
const [nFrames, nFinal, nStatuses, nCk] = readFileSync(nativePath, 'utf8').trim().split('\n');
const j = (x) => JSON.stringify(x);
const checks = {
  // Rust 는 100.0, JS 는 100 으로 표기하므로 문자열이 아니라 파싱된 값(f64 동일)으로 비교한다.
  frames_equal: j(frames) === j(JSON.parse(nFrames)),
  final_equal: j(fin) === j(JSON.parse(nFinal)),
  statuses_equal: j(statuses) === j(JSON.parse(nStatuses)),
  checkpoint_len_equal: String(ck.length) === nCk,
  restore_corrupt_throws: threw,
  bad_json_returns_error_value: bad.ok === false && bad.error.code === 'invalid_config',
};
console.log(JSON.stringify({ frames: frames.length, ...checks }));
if (!Object.values(checks).every(Boolean)) process.exit(1);
