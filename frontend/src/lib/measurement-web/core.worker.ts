// SDD-246 T06 — Web Worker 진입점. WASM(measurement-core, `--target web`) 로드 후 CoreSession 을 구동한다.
// WASM 산출물은 `npm run wasm:build` 가 `frontend/src/lib/measurement-web/wasm/` 에 배치한다(로드 실패 시 init_error=wasm_unavailable).
import { CoreSession, type McCoreLike, type PacketInput } from './core-session';
import type { EnvelopeMeta } from './envelope';

interface WasmModule {
  default: (input?: unknown) => Promise<unknown>;
  McCore: new (cfgJson: string) => McCoreLike;
}

let session: CoreSession | null = null;

async function loadWasm(): Promise<WasmModule> {
  // 정적 경로 import — 번들러가 wasm-bindgen 글루와 .wasm 을 asset 으로 묶는다(산출물: npm run wasm:build, 커밋됨).
  return (await import('./wasm/measurement_core.js')) as unknown as WasmModule;
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
