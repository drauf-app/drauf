import type { WebSocket } from 'ws';

export interface SyncEvent {
  type: string;
  data: unknown;
}

export function listTopic(listId: string): string {
  return `list:${listId}`;
}

export function planTopic(householdId: string): string {
  return `plan:${householdId}`;
}

/** In-process pub/sub fanning mutations out to subscribed WebSocket clients. */
export class SyncHub {
  private readonly topics = new Map<string, Map<WebSocket, string>>();

  subscribe(topic: string, socket: WebSocket, userId: string): void {
    let subscribers = this.topics.get(topic);
    if (subscribers === undefined) {
      subscribers = new Map();
      this.topics.set(topic, subscribers);
    }
    subscribers.set(socket, userId);
  }

  unsubscribeAll(socket: WebSocket): void {
    for (const [topic, subscribers] of this.topics) {
      subscribers.delete(socket);
      if (subscribers.size === 0) {
        this.topics.delete(topic);
      }
    }
  }

  publish(topic: string, event: SyncEvent): void {
    const subscribers = this.topics.get(topic);
    if (subscribers === undefined) {
      return;
    }
    const message = JSON.stringify({ type: 'event', topic, event });
    for (const socket of subscribers.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  }

  /** Drops a user's subscriptions to a topic, e.g. after losing membership. */
  evict(topic: string, userId: string): void {
    const subscribers = this.topics.get(topic);
    if (subscribers === undefined) {
      return;
    }
    for (const [socket, subscriberId] of subscribers) {
      if (subscriberId === userId) {
        subscribers.delete(socket);
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'evicted', topic }));
        }
      }
    }
    if (subscribers.size === 0) {
      this.topics.delete(topic);
    }
  }
}
