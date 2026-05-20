// 시스템 메시지 — 가운데 정렬 배지 스타일

interface Props {
  content: string | null;
  createdAt: string;
}

export function SystemMessage({ content, createdAt }: Props) {
  const time = new Date(createdAt).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="flex justify-center my-2">
      <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full">
        <span>{content}</span>
        <span className="ml-2 opacity-70">{time}</span>
      </div>
    </div>
  );
}
