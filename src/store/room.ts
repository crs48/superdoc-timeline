import { create } from 'zustand';
import type { RoomStatus } from '@/types';

/**
 * The uploaded file is handed from the landing page to the room route in memory
 * rather than through router state, because a Blob does not survive
 * serialization and we deliberately never upload it anywhere ourselves — the
 * room *is* the document once SuperDoc has seeded it.
 *
 * A refresh therefore loses the pending blob, which is correct: at that point
 * the room already exists on the server and the right move is to join it.
 */
let pendingUpload: File | null = null;

export function setPendingUpload(file: File | null) {
  pendingUpload = file;
}

export function takePendingUpload(): File | null {
  const file = pendingUpload;
  pendingUpload = null;
  return file;
}

interface RoomState {
  status: RoomStatus;
  lastError: string | null;
  setStatus: (status: RoomStatus) => void;
  setError: (message: string | null) => void;
}

export const useRoom = create<RoomState>()((set) => ({
  status: 'idle',
  lastError: null,
  setStatus: (status) => set({ status }),
  setError: (lastError) => set({ lastError, status: lastError ? 'error' : 'connecting' }),
}));
