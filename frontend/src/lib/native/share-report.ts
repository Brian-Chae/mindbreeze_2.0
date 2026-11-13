// 앱(Capacitor)에서 책 PDF 를 기기 공유 시트로 보낸다 (SDD-327 T16).
// @capacitor/share · @capacitor/filesystem 이 package.json 에 없어 현재는 웹 Share API(파일 공유)로 대체한다.
// 플러그인을 추가하면(앱 재빌드 필요) 이 함수 안에서만 교체하면 된다.
import { getMyBookPdf, BOOK_PDF_FILENAME, saveBlobAsFile } from '../api/member-report';
import { isNativeApp } from './platform';

export type NativeShareResult = 'shared' | 'downloaded' | 'cancelled';

export async function shareBookPdf(reportId: string): Promise<NativeShareResult> {
  const blob = await getMyBookPdf(reportId);
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

/** 앱에서만 공유 핸들러를 만든다. 웹이면 undefined → 시트가 버튼을 숨긴다. */
export function buildNativeShareHandler(reportId: string | null): (() => void) | undefined {
  if (!reportId || !isNativeApp()) return undefined;
  return () => { void shareBookPdf(reportId); };
}
