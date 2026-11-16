// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeFile = vi.fn();
const share = vi.fn();
const isNativeApp = vi.fn();

vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile: (...a: unknown[]) => writeFile(...a) } }));
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => isNativeApp() }));

import { savePdfBlob } from '../src/lib/native/save-pdf';

const blob = () => new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });

describe('savePdfBlob', () => {
  beforeEach(() => {
    writeFile.mockReset().mockResolvedValue({ uri: 'file:///cache/a.pdf' });
    share.mockReset().mockResolvedValue(undefined);
    isNativeApp.mockReset();
  });

  it('앱에서는 Filesystem.writeFile 후 Share.share 를 호출한다', async () => {
    isNativeApp.mockReturnValue(true);
    expect(await savePdfBlob(blob(), 'a.pdf', '저장')).toBe('shared');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.pdf', directory: 'CACHE', data: expect.any(String) }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/a.pdf'] }));
  });

  it('앱에서 공유 시트를 닫으면 cancelled', async () => {
    isNativeApp.mockReturnValue(true);
    share.mockRejectedValue(new Error('Share canceled'));
    expect(await savePdfBlob(blob(), 'a.pdf')).toBe('cancelled');
  });

  it('앱에서 파일 쓰기가 실패하면 예외를 올린다', async () => {
    isNativeApp.mockReturnValue(true);
    writeFile.mockRejectedValue(new Error('disk full'));
    await expect(savePdfBlob(blob(), 'a.pdf')).rejects.toThrow('disk full');
  });

  it('웹에서는 a.download 로 내려받고 플러그인을 쓰지 않는다', async () => {
    isNativeApp.mockReturnValue(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    expect(await savePdfBlob(blob(), 'a.pdf')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
