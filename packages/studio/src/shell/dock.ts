import { create } from 'zustand';

/** Which panel block (by id) is docked next to the content area, one at a time. */
interface DockState {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
  toggle: (id: string) => void;
}

export const useDock = create<DockState>()((set) => ({
  openId: null,
  open: (id) => set({ openId: id }),
  close: () => set({ openId: null }),
  toggle: (id) => set((state) => ({ openId: state.openId === id ? null : id })),
}));

// v2: panels open narrower by default; the new key drops widths remembered under the old default.
const sizeKey = (id: string) => `devias.studio.panel.${id}.size.v2`;

/** Panel width as a percentage of the content area, remembered per browser. */
export const readPanelSize = (id: string): number | undefined => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(sizeKey(id)) : null;
    const value = raw === null || raw === undefined ? Number.NaN : Number(raw);

    return Number.isFinite(value) && value > 0 && value < 100 ? value : undefined;
  } catch {
    return undefined;
  }
};

export const writePanelSize = (id: string, size: number): void => {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(sizeKey(id), String(Math.round(size)));
    }
  } catch {
    // storage unavailable: the default size is used next time
  }
};
