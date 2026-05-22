// 새 채팅방 생성 모달 — 개별(1:1) / 그룹(다중) 선택
import { useCallback, useEffect, useState } from 'react';
import { createDirectRoom, createGroupRoom } from '../../lib/api/chat';
import { listClients, type ClientListItem } from '../../lib/api/clients';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api/client';

type RoomMode = 'direct' | 'group';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateRoomModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<RoomMode>('direct');
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 그룹방: 선택된 참여자 ID Set
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 그룹방: 방 이름
  const [roomName, setRoomName] = useState('');

  const resetState = (): void => {
    setMode('direct');
    setSearch('');
    setClients([]);
    setSelectedIds(new Set());
    setRoomName('');
    setError(null);
  };

  const loadClients = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listClients({ q: q || undefined, size: 50 });
      setClients(res.clients);
    } catch {
      setError('내담자 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      resetState();
      loadClients('');
    }
  }, [open, loadClients]);

  useEffect(() => {
    if (open) {
      loadClients(search);
    }
  }, [search, open, loadClients]);

  const handleCreateDirect = async (client: ClientListItem): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const room = await createDirectRoom({ client_id: client.id, room_type: 'direct', name: roomName.trim() || undefined });
      onClose();
      navigate(`/chat/${room.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '채팅방 생성에 실패했습니다');
    } finally {
      setCreating(false);
    }
  };

  const toggleGroupSelect = (clientId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const handleCreateGroup = async (): Promise<void> => {
    if (selectedIds.size < 2) {
      setError('그룹 채팅방은 최소 2명 이상 선택해야 합니다');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const room = await createGroupRoom({
        participant_ids: Array.from(selectedIds),
        room_type: 'group',
        name: roomName.trim() || undefined,
      });
      onClose();
      navigate(`/chat/${room.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '그룹 채팅방 생성에 실패했습니다');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1F1F1F]">새 채팅방</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#6F6F6F] flex items-center justify-center text-sm"
          >
            ✕
          </button>
        </div>

        {/* 모드 선택 탭 */}
        <div className="flex rounded-xl bg-[#F2F3F8] p-1 mb-4">
          <button
            type="button"
            onClick={() => { setMode('direct'); setSelectedIds(new Set()); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'direct'
                ? 'bg-white text-[#5F0080] shadow-sm'
                : 'text-[#6F6F6F] hover:text-[#1F1F1F]'
            }`}
          >
            개별 채팅방
          </button>
          <button
            type="button"
            onClick={() => setMode('group')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'group'
                ? 'bg-white text-[#5F0080] shadow-sm'
                : 'text-[#6F6F6F] hover:text-[#1F1F1F]'
            }`}
          >
            그룹 채팅방
          </button>
        </div>

        {/* 방 이름 입력 (공통) */}
        <input
          type="text"
          placeholder={mode === 'direct' ? '채팅방 이름 (선택, 예: 홍길동 상담)' : '그룹방 이름 (선택)'}
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          className="w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] mb-3"
        />

        {/* 그룹방: 선택된 인원 표시 */}
        {mode === 'group' && selectedCount > 0 && (
          <div className="flex items-center gap-2 mb-3 text-sm text-[#5F0080] font-medium">
            <span className="w-6 h-6 rounded-full bg-[#F5EDFC] flex items-center justify-center text-xs font-bold">
              {selectedCount}
            </span>
            명 선택됨
          </div>
        )}

        <input
          type="text"
          placeholder="내담자 이름 또는 이메일 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] mb-3"
        />

        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}

        <div className="max-h-56 overflow-y-auto border border-[#EFEFEF] rounded-xl divide-y divide-[#EFEFEF]">
          {loading ? (
            <div className="p-4 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
          ) : clients.length === 0 ? (
            <div className="p-4 text-center text-sm text-[#6F6F6F]">검색 결과가 없습니다</div>
          ) : mode === 'direct' ? (
            clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCreateDirect(c)}
                disabled={creating}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F8FB] transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold text-sm shrink-0">
                  {c.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1F1F1F] truncate">{c.name}</div>
                  <div className="text-xs text-[#6F6F6F] truncate">{c.email}</div>
                </div>
              </button>
            ))
          ) : (
            // 그룹 모드: 체크박스
            clients.map((c) => {
              const isSelected = selectedIds.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#F8F8FB] transition-colors ${
                    isSelected ? 'bg-[#F5EDFC]' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleGroupSelect(c.id)}
                    disabled={creating}
                    className="accent-[#5F0080] w-4 h-4"
                  />
                  <div className="w-10 h-10 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold text-sm shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1F1F1F] truncate">{c.name}</div>
                    <div className="text-xs text-[#6F6F6F] truncate">{c.email}</div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* 그룹방 생성 버튼 */}
        {mode === 'group' && (
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={creating || selectedCount < 2}
            className="w-full mt-4 h-11 rounded-xl bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] disabled:opacity-50 transition-colors"
          >
            {creating ? '생성 중...' : `그룹 채팅방 만들기 (${selectedCount}명)`}
          </button>
        )}
      </div>
    </div>
  );
}
