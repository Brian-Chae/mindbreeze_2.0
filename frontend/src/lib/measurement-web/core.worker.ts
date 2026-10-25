// SDD-246 T06 — Web Worker 진입점. WASM(measurement-core, `--target web`) 로드 후 CoreSession 을 구동한다.
// WASM 산출물은 T12 빌드가 `frontend/src/lib/measurement-web/wasm/` 에 배치한다(없으면 init_error=wasm_unavailable).
import { CoreSession, type McCoreLike, type PacketInput } from './core-session';
import type { EnvelopeMeta } from './envelope';

interface WasmModule {
  default: (input?: unknown) => Promise<unknown>;
  McCore: new (cfgJson: string) => McCoreLike;
}

let session: CoreSession | null = null;

async function loadWasm(): Promise<WasmModule> {
  // 변수 경로로 import 하여 번들러가 정적 해석하지 않게 한다(산출물이 없는 빌드에서도 앱이 깨지지 않음).
  const path = './wasm/measurement_core.js';
  return (await import(/* @vite-ignore */ path)) as WasmModule;
}

type In =
  | { type: 'init'; configJson: string; meta: EnvelopeMeta }
  | ({ type: 'packet' } & PacketInput)
  | { type: 'advance'; monoUs: number }
  | { type: 'close' };

self.onmessage = async (e: MessageEvent<In>): Promise<void> => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const wasm = await loadWasm();
      await wasm.default();
      session = new CoreSession(new wasm.McCore(m.configJson), m.meta);
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'packet' && session) {
      const out = session.push(m);
      if (out.envelopes.length > 0 || out.error) self.postMessage({ type: 'frames', envelopes: out.envelopes, error: out.error });
    } else if (m.type === 'advance' && session) {
      const out = session.advance(m.monoUs);
      if (out.envelopes.length > 0 || out.error) self.postMessage({ type: 'frames', envelopes: out.envelopes, error: out.error });
    } else if (m.type === 'close') {
      const final = session ? session.close() : null;
      session = null;
      self.postMessage({ type: 'closed', final });
    }
  } catch (err) {
    if (m.type === 'init') self.postMessage({ type: 'init_error', message: 'wasm_unavailable' });
    else self.postMessage({ type: 'frames', envelopes: [], error: { code: 'worker_error', message: String(err) } });
  }
};
