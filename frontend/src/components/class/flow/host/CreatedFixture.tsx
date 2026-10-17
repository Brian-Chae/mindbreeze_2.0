// SDD-209 H3 — 하니스용 생성 완료 래퍼(복사·템플릿 저장·다시 시도가 화면 안에서만 동작)
import { useState } from 'react';
import type { CreatedView } from '../../../../lib/class/flow/host-create-flow';
import { CreatedScreen, type TemplateState } from './CreatedScreen';

export function CreatedFixture({ view, backdropSrc }: { view: CreatedView; backdropSrc: string }) {
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState<TemplateState>('idle');
  const [rows, setRows] = useState(view.rows);
  return (
    <CreatedScreen
      view={{ ...view, rows }}
      backdropSrc={backdropSrc}
      copied={copied}
      templateState={template}
      onCopyCode={() => setCopied(true)}
      onOpenClass={() => undefined}
      onDetail={() => undefined}
      onList={() => undefined}
      onRetry={(key) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ok: true } : r)))}
      onSaveTemplate={() => setTemplate('saved')}
    />
  );
}
