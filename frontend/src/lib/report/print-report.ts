import './report-print.css';

/** 화면과 동일한 DOM/CSS를 사용하되 앱과 모달의 스크롤 제약을 인쇄 문서에서 분리한다. */
export async function printReport(content: HTMLElement, title: string): Promise<void> {
  document.querySelector('iframe[data-report-print]')?.remove();
  const frame = document.createElement('iframe');
  frame.title = '리포트 인쇄';
  frame.dataset.reportPrint = '';
  frame.className = 'fixed -left-[10000px] top-0 h-px w-[900px] border-0';
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!doc || !printWindow) throw new Error('인쇄 문서를 열 수 없습니다.');
    doc.documentElement.lang = 'ko';
    doc.title = title;
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.append(base);
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => {
      const copy = node.cloneNode(true) as HTMLElement;
      const loaded = copy instanceof HTMLLinkElement
        ? new Promise<void>((resolve, reject) => {
          copy.onload = () => resolve();
          copy.onerror = () => reject(new Error('인쇄 스타일을 불러오지 못했습니다.'));
        })
        : Promise.resolve();
      doc.head.append(copy);
      return loaded;
    });
    const body = content.cloneNode(true) as HTMLElement;
    body.querySelectorAll('[data-print-exclude]').forEach(node => node.remove());
    doc.body.className = 'report-print-document m-0 bg-white';
    doc.body.append(body);
    await Promise.all(styles);
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => undefined)));
    await new Promise<void>(resolve => printWindow.requestAnimationFrame(() => resolve()));
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
    // afterprint 미지원 환경은 다음 인쇄 또는 페이지 이탈 시 정리한다.
  } catch (error) {
    frame.remove();
    throw error;
  }
}
