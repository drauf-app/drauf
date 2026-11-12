import { useEffect, useRef } from 'react';
import { ensureAccessToken } from '../auth/store';

export interface SyncEvent {
  type: string;
  data: unknown;
}

interface ServerMessage {
  type?: string;
  topic?: string;
  event?: SyncEvent;
}

export interface SyncSubscription {
  lists?: string[];
  plan?: boolean;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Keeps one authenticated WebSocket to /api/sync/socket alive for the given
 * subscription and hands every event to the callback. Reconnects with backoff
 * and resubscribes; closes on unmount.
 */
export function useSync(
  subscription: SyncSubscription,
  onEvent: (topic: string, event: SyncEvent) => void,
): void {
  // The callback usually closes over page state; keep the latest one without
  // tearing the socket down on every render.
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = JSON.stringify([subscription.lists ?? [], subscription.plan ?? false]);

  useEffect(() => {
    // No WebSocket (old browser, test environment): live updates are off.
    if (typeof WebSocket === 'undefined') {
      return;
    }
    const parsed = JSON.parse(key) as [string[], boolean];
    const [lists, plan] = parsed;
    let socket: WebSocket | undefined;
    let closed = false;
    let backoff = INITIAL_BACKOFF_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleReconnect(): void {
      if (closed) {
        return;
      }
      timer = setTimeout(() => void connect(), backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }

    async function connect(): Promise<void> {
      const token = await ensureAccessToken();
      if (closed) {
        return;
      }
      if (token === undefined) {
        scheduleReconnect();
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/api/sync/socket`);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };
      socket.onmessage = (raw) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(raw.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === 'auth_ok') {
          backoff = INITIAL_BACKOFF_MS;
          socket?.send(JSON.stringify({ type: 'subscribe', lists, plan }));
          return;
        }
        if (
          (message.type === 'event' || message.type === 'evicted') &&
          typeof message.topic === 'string'
        ) {
          handler.current(
            message.topic,
            message.type === 'evicted'
              ? { type: 'evicted', data: null }
              : (message.event as SyncEvent),
          );
        }
      };
      socket.onclose = () => {
        socket = undefined;
        scheduleReconnect();
      };
    }

    const onOnline = () => {
      // Skip the remaining backoff when connectivity returns.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      backoff = INITIAL_BACKOFF_MS;
      if (socket === undefined) {
        void connect();
      }
    };
    window.addEventListener('online', onOnline);
    void connect();

    return () => {
      closed = true;
      window.removeEventListener('online', onOnline);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket?.close();
    };
  }, [key]);
}
