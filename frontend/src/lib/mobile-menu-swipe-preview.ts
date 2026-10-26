interface SwipeSnapshot { node: HTMLElement; scrolls: Array<{ top: number; left: number }> }
let scope = '';
const snapshots = new Map<string, SwipeSnapshot>();

/** 계정/역할별 최대 네 루트의 시각 사본만 보관한다. React·네트워크 수명주기는 만들지 않는다. */
export function resetSwipeSnapshots(nextScope: string): void {
  if (scope === nextScope) return;
  snapshots.clear(); scope = nextScope;
}
export function saveSwipeSnapshot(owner: string, path: string, source: HTMLElement): void {
  if (!owner || owner !== scope) return;
  const node = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const clones = [node, ...node.querySelectorAll<HTMLElement>('*')];
  for (const element of clones) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['id', 'name', 'for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-live', 'autofocus', 'data-mobile-swipe-page'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.matches('a,button,input,textarea,select,[tabindex],[contenteditable]')) {
      element.setAttribute('tabindex', '-1'); element.removeAttribute('href'); element.removeAttribute('contenteditable');
    }
  }
  node.style.transform = ''; node.style.willChange = '';
  node.setAttribute('aria-hidden', 'true'); node.setAttribute('inert', '');
  node.querySelectorAll('script,iframe,video,audio').forEach(element => element.remove());
  snapshots.delete(path);
  snapshots.set(path, { node, scrolls: [node, ...node.querySelectorAll<HTMLElement>('*')].map(element => {
    const original = originals[clones.indexOf(element)];
    return { top: original.scrollTop, left: original.scrollLeft };
  }) });
  if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
}
export function mountSwipeSnapshot(owner: string, path: string, parent: HTMLElement): boolean {
  const snapshot = owner === scope ? snapshots.get(path) : undefined;
  if (!snapshot) return false;
  const clone = snapshot.node.cloneNode(true) as HTMLElement;
  parent.append(clone);
  [clone, ...clone.querySelectorAll<HTMLElement>('*')].forEach((element, index) => {
    const scroll = snapshot.scrolls[index];
    if (scroll) { element.scrollTop = scroll.top; element.scrollLeft = scroll.left; }
  });
  return true;
}
