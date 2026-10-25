// SDD-246 T06 — 웹 BLE 회원용 capture adapter. WASM 코어는 Web Worker 안에서만 실행한다(메인 스레드 DSP 금지).
// 미착용·EEG 미동의에서는 워커·코어·capture 요청을 만들지 않는다(plan §6.4).
import type { CoreFinalManifest, EnvelopeMeta, MetricEnvelope } from './envelope';
import type { PacketInput } from './core-session';

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface StartArgs extends EnvelopeMeta {
  eegConsent: boolean;
  bandConnected: boolean;
  /** 계약 CoreConfig JSON(문자열) */
  configJson: string;
}

export interface WebCaptureOptions {
  createWorker: () => WorkerLike;
  onEnvelope: (env: MetricEnvelope) => void;
  /** capture.start/renew 같은 서버 요청 훅 — start 가 통과한 뒤에만 호출된다 */
  onCaptureRequest: (kind: 'capture.start') => void;
  onError?: (code: string, message: string) => void;
}

type WorkerMsg =
  | { type: 'ready' }
  | { type: 'init_error'; message: string }
  | { type: 'frames'; envelopes: MetricEnvelope[]; error: { code: string; message: string } | null }
  | { type: 'closed'; final: CoreFinalManifest | null };

export class WebCaptureAdapter {
  private readonly o: WebCaptureOptions;
  private worker: WorkerLike | null = null;
  private pendingClose: ((f: CoreFinalManifest | null) => void) | null = null;

  constructor(o: WebCaptureOptions) {
    this.o = o;
  }

  isActive(): boolean {
    return this.worker !== null;
  }

  start(args: StartArgs): Promise<void> {
    if (this.worker) return Promise.resolve();
    if (!args.bandConnected) return Promise.reject(new Error('band_not_connected'));
    if (!args.eegConsent) return Promise.reject(new Error('eeg_consent_required'));
    const worker = this.o.createWorker();
    this.worker = worker;
    return new Promise<void>((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data as WorkerMsg;
        if (m.type === 'ready') { resolve(); this.o.onCaptureRequest('capture.start'); return; }
        if (m.type === 'init_error') {
          worker.terminate();
          this.worker = null;
          reject(new Error(m.message));
          return;
        }
        if (m.type === 'frames') {
          if (m.error) this.o.onError?.(m.error.code, m.error.message);
          for (const env of m.envelopes) this.o.onEnvelope(env);
          return;
        }
        if (m.type === 'closed') {
          const done = this.pendingClose;
          this.pendingClose = null;
          done?.(m.final);
        }
      };
      const { eegConsent: _c, bandConnected: _b, configJson, ...meta } = args;
      void _c; void _b;
      worker.postMessage({ type: 'init', configJson, meta });
    });
  }

  pushPacket(p: PacketInput): void {
    const w = this.worker;
    if (!w) return; // 미착용·미시작: 아무 것도 하지 않는다
    // 복사 없이 넘기기 위해 buffer 를 transfer 한다(호출 후 p.bytes 는 사용 불가)
    const bytes = p.bytes;
    w.postMessage({ type: 'packet', sensor: p.sensor, bytes, arrivalUs: p.arrivalUs, wallMs: p.wallMs, anchorUs: p.anchorUs }, [bytes.buffer]);
  }

  /** 시간 경과(패킷 없음) 처리 — gap 프레임 */
  advance(monoUs: number): void {
    this.worker?.postMessage({ type: 'advance', monoUs });
  }

  stop(): Promise<CoreFinalManifest | null> {
    const w = this.worker;
    if (!w) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pendingClose = (final) => {
        w.terminate();
        this.worker = null;
        resolve(final);
      };
      w.postMessage({ type: 'close' });
    });
  }
}
