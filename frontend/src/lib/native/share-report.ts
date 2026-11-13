// 앱(Capacitor)에서 책 PDF 를 기기 공유 시트로 보낸다 (SDD-327 T16).
// 앱: PDF 를 캐시 폴더에 쓰고 @capacitor/share 로 연다. 웹: Web Share API(파일 공유) → 내려받기 순으로 대체한다.
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getMyBookPdf, BOOK_PDF_FILENAME, saveBlobAsFile } from '../api/member-report';
import { isNativeApp } from './platform';

export type NativeShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Blob → base64 본문(데이터 URL 접두 제거). */
function blobToBase64(blob: Blob): Promise<string> {
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

/** 사용자가 공유 시트를 닫은 경우(플러그인 취소 오류)인지 판별한다. */
function isShareCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(message);
}

async function shareViaNativePlugin(blob: Blob): Promise<NativeShareResult> {
  const written = await Filesystem.writeFile({
    path: BOOK_PDF_FILENAME,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: '명상 기록 책', files: [written.uri], dialogTitle: '명상 기록 책 보내기' });
    return 'shared';
  } catch (err) {
    if (isShareCancelled(err)) return 'cancelled';
    throw err;
  }
}

async function shareViaWebApi(blob: Blob): Promise<NativeShareResult> {
  const file = new File([blob], BOOK_PDF_FILENAME, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: '명상 기록 책' });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlobAsFile(blob, BOOK_PDF_FILENAME);
  return 'downloaded';
}

export async function shareBookPdf(reportId: string): Promise<NativeShareResult> {
  const blob = await getMyBookPdf(reportId);
  if (isNativeApp()) return shareViaNativePlugin(blob);
  return shareViaWebApi(blob);
}

/** 앱에서만 공유 핸들러를 만든다. 웹이면 undefined → 시트가 버튼을 숨긴다. */
export function buildNativeShareHandler(reportId: string | null): (() => void) | undefined {
  if (!reportId || !isNativeApp()) return undefined;
  return () => { void shareBookPdf(reportId); };
}
