import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Identity } from '@/types';

interface IdentityState extends Identity {
  setName: (name: string) => void;
  /** True once the user has told us who they are. Gates the whole app. */
  hasName: () => boolean;
}

/**
 * There are no accounts in this app, so "user" is not a thing that exists — a
 * device is. The deviceId is minted once and persisted; it is what y/hub records
 * as the author of every change, and therefore what the chart groups by.
 *
 * Consequence, accepted deliberately: the same person on a phone and a laptop is
 * two contributors, and two tabs in one browser are correctly one.
 */
export const useIdentity = create<IdentityState>()(
  persist(
    (set, get) => ({
      deviceId: crypto.randomUUID(),
      name: '',
      setName: (name) => set({ name: name.trim().slice(0, 60) }),
      hasName: () => get().name.trim().length > 0,
    }),
    {
      name: 'superdoc-timeline:identity',
      // Only the durable facts are persisted; actions are rebuilt on load.
      partialize: (state) => ({ deviceId: state.deviceId, name: state.name }),
    },
  ),
);
