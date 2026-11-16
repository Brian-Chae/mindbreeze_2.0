// PDF 받기 공통 경로 — 앱(Capacitor WebView)은 a.download 가 동작하지 않아 파일로 쓴 뒤 공유 시트로 연다.
// 앱: @capacitor/filesystem 으로 캐시 폴더에 쓰고 @capacitor/share 로 "파일에 저장/열기" 시트를 띄운다.
// 웹: 기존처럼 a.download 로 내려받는다.
import { isNativeApp } from './platform';

export type SavePdfResult = 'shared' | 'downloaded' | 'cancelled';

/** Blob → base64 본문(데이터 URL 접두 제거). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('PDF 를 읽지 못했습니다'));
    reader.onload = () => {
      const text = String(reader.result ?? '');
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** 브라우저 다운로드(웹 전용). */
export function downloadBlobInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // 브라우저가 다운로드를 시작할 시간을 확보한 뒤 메모리를 해제한다.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 사용자가 공유 시트를 닫은 경우(플러그인 취소 오류)인지 판별한다. */
export function isShareCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(message);
}

/** 앱이면 파일 쓰기 + 공유 시트, 웹이면 a.download. 실패는 예외로 올린다(호출자가 오류 문구 표시). */
export async function savePdfBlob(blob: Blob, filename: string, dialogTitle = 'PDF 저장'): Promise<SavePdfResult> {
  if (!isNativeApp()) {
    downloadBlobInBrowser(blob, filename);
    return 'downloaded';
  }
  // 플러그인은 앱 분기에서만 불러온다(웹·테스트 번들에 끌려오지 않게).
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const written = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [written.uri], dialogTitle });
    return 'shared';
  } catch (err) {
    if (isShareCancelled(err)) return 'cancelled';
    throw err;
  }
}
