// 시스템 메시지 — 가운데 정렬 배지 스타일

interface Props {
  content: string | null;
  createdAt: string;
}

export function SystemMessage({ content, createdAt }: Props) {
  const timeStr = (createdAt || new Date().toISOString()).slice(11, 16);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
      <div style={{
        padding: '4px 12px',
        fontSize: '12px',
        color: '#6F6F6F',
        background: '#F2F3F8',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span>{content ?? ''}</span>
        <span style={{ opacity: 0.7 }}>{timeStr}</span>
      </div>
    </div>
  );
}
