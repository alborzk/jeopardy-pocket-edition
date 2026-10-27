/** What the browser remembers about a room so it can rejoin after a dropped socket or reload. */
export interface Session {
  code: string;
  token: string;
  role: 'host' | 'player';
  /** Players only. */
  name?: string;
}

// Keyed by role too, so one browser can be the host of a room and also a player in it.
const sessionKey = (code: string, role: Session['role']) => `jeopardy.session.${code}.${role}`;
const LAST_KEY = 'jeopardy.lastSession';

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    typeof v.token === 'string' &&
    (v.role === 'host' || v.role === 'player')
  );
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(sessionKey(session.code, session.role), JSON.stringify(session));
    localStorage.setItem(LAST_KEY, JSON.stringify({ code: session.code, role: session.role }));
  } catch {
    // Private mode or a full disk: the game still works, rejoin just won't survive a reload.
  }
}

export function loadSession(code: string, role: Session['role']): Session | null {
  try {
    const raw = localStorage.getItem(sessionKey(code, role));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isSession(parsed) && parsed.code === code && parsed.role === role ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSession(code: string, role: Session['role']): void {
  try {
    localStorage.removeItem(sessionKey(code, role));
    const last = localStorage.getItem(LAST_KEY);
    if (last) {
      const parsed = JSON.parse(last) as { code?: string; role?: string };
      if (parsed.code === code && parsed.role === role) localStorage.removeItem(LAST_KEY);
    }
  } catch {
    // Nothing to clean up.
  }
}

/** The room this browser was last in, if it still has a token for it. */
export function lastSession(): Session | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, role } = parsed as { code?: unknown; role?: unknown };
    if (typeof code !== 'string' || (role !== 'host' && role !== 'player')) return null;
    return loadSession(code, role);
  } catch {
    return null;
  }
}
