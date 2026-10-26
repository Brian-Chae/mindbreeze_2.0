/* tslint:disable */
/* eslint-disable */

export class McCore {
    free(): void;
    [Symbol.dispose](): void;
    advance(monotonic_us: number): string;
    checkpoint(): Uint8Array;
    close(): string;
    /**
     * config_json: 계약 CoreConfig. 실패 시 JS 예외(생성자 제약) — 메시지는 계약 CoreError JSON.
     */
    constructor(config_json: string);
    /**
     * 계약 PushPacketCall(JSON)
     */
    push_packet(call_json: string): string;
    /**
     * 바이너리 직접 투입(Web Bluetooth DataView → Uint8Array). sensor: 0=eeg 1=ppg 2=acc.
     * u64 는 JS number(안전 정수 범위)로 받는다: 호출자가 경계를 지켜야 한다.
     */
    push_packet_raw(sensor: number, bytes: Uint8Array, arrival_monotonic_us: number, wall_ms: number, anchor_monotonic_us: number): string;
    static restore(config_json: string, checkpoint: Uint8Array): McCore;
    set_model(model_json: string): string;
}

export function abiVersion(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mccore_free: (a: number, b: number) => void;
    readonly abiVersion: () => number;
    readonly mc_advance: (a: bigint, b: bigint, c: number) => number;
    readonly mc_buffer_free: (a: number) => void;
    readonly mc_checkpoint: (a: bigint, b: number) => number;
    readonly mc_close: (a: bigint, b: number) => number;
    readonly mc_create: (a: number, b: number, c: number, d: number) => number;
    readonly mc_destroy: (a: bigint) => number;
    readonly mc_push_packet: (a: bigint, b: number, c: number, d: number) => number;
    readonly mc_push_packet_raw: (a: bigint, b: number, c: number, d: number, e: bigint, f: bigint, g: bigint, h: number) => number;
    readonly mc_restore: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mc_set_model: (a: bigint, b: number, c: number, d: number) => number;
    readonly mccore_advance: (a: number, b: number) => [number, number];
    readonly mccore_checkpoint: (a: number) => [number, number];
    readonly mccore_close: (a: number) => [number, number];
    readonly mccore_new: (a: number, b: number) => [number, number, number];
    readonly mccore_push_packet: (a: number, b: number, c: number) => [number, number];
    readonly mccore_push_packet_raw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly mccore_restore: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly mccore_set_model: (a: number, b: number, c: number) => [number, number];
    readonly mc_abi_version: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
