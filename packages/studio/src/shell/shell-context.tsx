import { createContext, useContext } from 'react';

export interface ShellContextValue {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const ShellContext = createContext<ShellContextValue>({ sidebarCollapsed: false, toggleSidebar: () => {} });

export const ShellProvider = ShellContext.Provider;
export const useShell = (): ShellContextValue => useContext(ShellContext);
