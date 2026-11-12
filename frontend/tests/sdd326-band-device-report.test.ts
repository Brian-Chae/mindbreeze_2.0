// SDD-326 T8: 시리얼 정규화·보고 로직(중복 방지·재시도·실패 무시)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskSerial, normalizeBandSerial, normalizeFirmware, reportBandDevice, resetBandReportCache } from '../src/lib/band/band-device-report';

const sent = new Set<string>();
const wait = vi.fn(async () => undefined);
const base = { sessionId: 's1', credential: 'cred', platform: 'web' as const };
beforeEach(() => { resetBandReportCache(sent); wait.mockClear(); });

describe('normalizeBandSerial', () => {
  it('LXB 접두사 이름을 trim·대문자로 정규화한다', () => {
    expect(normalizeBandSerial(' lxb-0263008a ')).toBe('LXB-0263008A');
  });
  it('null·접두사 불일치·이메일·65자·한글·스크립트는 null', () => {
    for (const bad of [null, undefined, '', 'Galaxy Buds', 'LXB@a.com', `LXB${'1'.repeat(62)}`, 'LXB-밴드', 'LXB<script>']) {
      expect(normalizeBandSerial(bad)).toBeNull();
    }
  });
  it('64자는 허용', () => { expect(normalizeBandSerial(`LXB${'1'.repeat(61)}`)).toHaveLength(64); });
});

describe('normalizeFirmware / maskSerial', () => {
  it('제어문자 제거·32자 제한, 비면 null', () => {
    expect(normalizeFirmware('1.2.3\u0000\u0000')).toBe('1.2.3');
    expect(normalizeFirmware('   ')).toBeNull();
    expect(normalizeFirmware('x'.repeat(40))).toHaveLength(32);
    expect(normalizeFirmware('v1 beta')).toBeNull(); // 서버 형식(공백 불가)에 안 맞으면 시리얼만 보고
  });
  it('로그용 마스킹: 접두 + 끝 4자', () => { expect(maskSerial('LXB-0263008A')).toBe('LXB…008A'); });
});

describe('reportBandDevice', () => {
  const id = { serial: 'LXB-0263008A', firmware: null };
  it('성공 시 한 번 전송하고, 같은 값 재호출은 보내지 않는다(재연결 중복 방지)', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    expect(await reportBandDevice({ ...base, identity: id }, { put, wait, sent })).toBe(true);
    expect(await reportBandDevice({ ...base, identity: id }, { put, wait, sent })).toBe(false);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('s1', 'cred', { serial: 'LXB-0263008A', platform: 'web' });
  });
  it('펌웨어가 새로 읽히면 다시 보낸다(멱등 갱신)', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    await reportBandDevice({ ...base, identity: id }, { put, wait, sent });
    await reportBandDevice({ ...base, identity: { ...id, firmware: '1.0.4' } }, { put, wait, sent });
    expect(put).toHaveBeenLastCalledWith('s1', 'cred', { serial: 'LXB-0263008A', platform: 'web', firmware: '1.0.4' });
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('다른 밴드로 교체하면 새로 보낸다', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    await reportBandDevice({ ...base, identity: id }, { put, wait, sent });
    await reportBandDevice({ ...base, identity: { serial: 'LXB-00000001', firmware: null } }, { put, wait, sent });
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('식별 불가(null·비LXB)·세션 없음이면 호출하지 않는다', async () => {
    const put = vi.fn(async () => ({ ok: true }));
    expect(await reportBandDevice({ ...base, identity: null }, { put, wait, sent })).toBe(false);
    expect(await reportBandDevice({ ...base, identity: { serial: 'Galaxy', firmware: null } }, { put, wait, sent })).toBe(false);
    expect(await reportBandDevice({ ...base, sessionId: '', identity: id }, { put, wait, sent })).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });
  it('실패해도 던지지 않고 3회 재시도 후 포기, 이후 재호출에서 다시 시도한다', async () => {
    const put = vi.fn(async () => { throw new Error('offline'); });
    await expect(reportBandDevice({ ...base, identity: id }, { put, wait, sent })).resolves.toBe(false);
    expect(put).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(3);
    put.mockResolvedValueOnce({ ok: true });
    expect(await reportBandDevice({ ...base, identity: id }, { put, wait, sent })).toBe(true);
  });
  it('도중 성공하면 이후 재시도를 멈춘다', async () => {
    const put = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ ok: true });
    expect(await reportBandDevice({ ...base, identity: id }, { put, wait, sent })).toBe(true);
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('진행 중 동일 보고는 중복 전송하지 않는다(경합)', async () => {
    let release: () => void = () => undefined;
    const put = vi.fn(() => new Promise((r) => { release = () => r({ ok: true }); }));
    const first = reportBandDevice({ ...base, identity: id }, { put, wait, sent });
    expect(await reportBandDevice({ ...base, identity: id }, { put, wait, sent })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
