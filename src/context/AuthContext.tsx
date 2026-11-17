import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import type { WorkspaceSessionPayload } from '../shared/types.ts';

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  session: WorkspaceSessionPayload | null;
  sessionLoading: boolean;
  sessionError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: (overrideTenantId?: number) => Promise<void>;
  switchTenant: (tenantId: number) => Promise<void>;
  apiFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<WorkspaceSessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);

  const apiFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Authentication required.');
      }
      const token = await currentUser.getIdToken();
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (selectedTenantId) {
        headers.set('x-tenant-id', String(selectedTenantId));
      }
      if (
        options.body &&
        typeof options.body === 'string' &&
        !headers.has('Content-Type')
      ) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(path, { ...options, headers });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === 'string'
            ? body.error
            : `Request failed (${response.status})`;
        const err = new Error(message) as Error & {
          fieldErrors?: Record<string, string>;
          status?: number;
        };
        err.fieldErrors = body?.fieldErrors;
        err.status = response.status;
        throw err;
      }
      return (await response.json()) as T;
    },
    [selectedTenantId]
  );

  const loadWorkspaceSession = useCallback(
    async (user: User | null, overrideTenantId?: number) => {
      if (!user) {
        setSession(null);
        setSelectedTenantId(null);
        setSessionError(null);
        return;
      }
      setSessionLoading(true);
      setSessionError(null);
      try {
        const token = await user.getIdToken();
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        const targetTenant = overrideTenantId ?? selectedTenantId;
        if (targetTenant) {
          headers['x-tenant-id'] = String(targetTenant);
        }
        const res = await fetch('/api/workspace/session', { headers });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(
            payload?.error || 'Failed to load workspace session.'
          );
        }
        const data = (await res.json()) as WorkspaceSessionPayload;
        setSession(data);
        setSelectedTenantId(data.activeTenant.tenantId);
      } catch (err) {
        setSessionError(
          err instanceof Error ? err.message : 'Unable to load workspace.'
        );
      } finally {
        setSessionLoading(false);
      }
    },
    [selectedTenantId]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      void loadWorkspaceSession(user);
    });
    return unsubscribe;
  }, [loadWorkspaceSession]);

  const signInWithGoogle = useCallback(async () => {
    setSessionError(null);
    await signInWithPopup(auth, googleAuthProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setSession(null);
    setSelectedTenantId(null);
  }, []);

  const refreshSession = useCallback(
    async (overrideTenantId?: number) => {
      await loadWorkspaceSession(auth.currentUser, overrideTenantId);
    },
    [loadWorkspaceSession]
  );

  const switchTenant = useCallback(
    async (tenantId: number) => {
      await apiFetch('/api/workspace/tenant/switch', {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
      setSelectedTenantId(tenantId);
      await loadWorkspaceSession(auth.currentUser, tenantId);
    },
    [apiFetch, loadWorkspaceSession]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        session,
        sessionLoading,
        sessionError,
        signInWithGoogle,
        signOut,
        refreshSession,
        switchTenant,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
