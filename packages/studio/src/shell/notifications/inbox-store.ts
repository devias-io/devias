import { create } from 'zustand';

/** Notifications that reached the person over the live feed and have not been shown as toasts yet, by id. */
interface InboxState {
  arrived: string[];
  arrive: (ids: string[]) => void;
  /** Hands over everything that arrived and empties the queue. */
  take: () => string[];
}

export const useNotificationInbox = create<InboxState>()((set, get) => ({
  arrived: [],
  arrive: (ids) =>
    set((state) => {
      const fresh = ids.filter((id) => !state.arrived.includes(id));

      return fresh.length > 0 ? { arrived: [...state.arrived, ...fresh] } : state;
    }),
  take: () => {
    const { arrived } = get();

    if (arrived.length > 0) {
      set({ arrived: [] });
    }

    return arrived;
  },
}));
