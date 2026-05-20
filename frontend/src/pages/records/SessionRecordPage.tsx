// 세션 후 AI 기록지 조회·편집 페이지

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getRecord, getTranscript, type RecordResponse, type TranscriptResponse } from '../../lib/api/audio';
import { RecordView } from '../../components/records/RecordView';
import { TranscriptView } from '../../components/records/TranscriptView';

export default function SessionRecordPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<RecordResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [tab, setTab] = useState<'record' | 'transcript'>('record');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getRecord(id), getTranscript(id)])
      .then(([r, t]) => {
        setRecord(r);
        setTranscript(t);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }
  if (!record) {
    return <div className="p-6 text-sm text-neutral-500">기록지 로딩 중...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 md:max-w-3xl md:p-6 text-sm md:text-base">
      <h1 className="text-lg md:text-xl font-semibold text-neutral-900 dark:text-neutral-100">AI 기록지</h1>
      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setTab('record')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'record'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400'
          }`}
        >
          기록지
        </button>
        <button
          type="button"
          onClick={() => setTab('transcript')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'transcript'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400'
          }`}
        >
          전사문
        </button>
      </div>

      {tab === 'record' ? (
        <RecordView record={record} onUpdated={setRecord} />
      ) : (
        <TranscriptView data={transcript} />
      )}
    </div>
  );
}
