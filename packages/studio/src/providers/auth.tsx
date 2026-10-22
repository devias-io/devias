import type { AuthAdapter } from '@devias/core';
import { createContext, useContext } from 'react';

const AuthContext = createContext<AuthAdapter | null>(null);

export const AuthProvider = AuthContext.Provider;

export const useAuth = (): AuthAdapter => {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside <Studio>');
  }

  return value;
};
