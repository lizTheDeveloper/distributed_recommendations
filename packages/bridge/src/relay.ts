// Tiny NIP-01 relay client over the WHATWG WebSocket (global in Node >= 22 and
// browsers). Only what the bridge needs: EVENT -> OK, and REQ -> EVENT* EOSE.

import type { SignedEvent } from './types.ts';

export type WebSocketCtor = new (url: string) => WebSocket;

export interface RelayOptions {
  timeoutMs?: number;
  WebSocket?: WebSocketCtor;
}

export interface PublishResult {
  relay: string;
  ok: boolean;
  message: string;
}

function assertRelayUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new Error(`relay URL must be ws:// or wss://: ${url}`);
}

function open(url: string, opts: RelayOptions): Promise<WebSocket> {
  assertRelayUrl(url);
  const WS = opts.WebSocket ?? (globalThis.WebSocket as WebSocketCtor | undefined);
  if (!WS) throw new Error('no WebSocket implementation available');
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('connect timeout'));
    }, opts.timeoutMs ?? 10_000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('connection error'));
    });
  });
}

/** Send ["EVENT", e] and wait for the relay's ["OK", id, accepted, message]. */
export async function publishToRelay(relay: string, event: SignedEvent, opts: RelayOptions = {}): Promise<PublishResult> {
  let ws: WebSocket | undefined;
  try {
    ws = await open(relay, opts);
    const sock = ws;
    return await new Promise<PublishResult>((resolve) => {
      const timer = setTimeout(() => resolve({ relay, ok: false, message: 'timeout waiting for OK' }), opts.timeoutMs ?? 10_000);
      sock.addEventListener('message', (m: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (Array.isArray(msg) && msg[0] === 'OK' && msg[1] === event.id) {
          clearTimeout(timer);
          resolve({ relay, ok: msg[2] === true, message: String(msg[3] ?? '') });
        }
      });
      sock.addEventListener('close', () => {
        clearTimeout(timer);
        resolve({ relay, ok: false, message: 'connection closed before OK' });
      });
      sock.send(JSON.stringify(['EVENT', event]));
    });
  } catch (err) {
    return { relay, ok: false, message: (err as Error).message };
  } finally {
    ws?.close();
  }
}

export async function publish(relays: string[], event: SignedEvent, opts: RelayOptions = {}): Promise<PublishResult[]> {
  return Promise.all(relays.map((r) => publishToRelay(r, event, opts)));
}

/** One-shot REQ: collect stored events until EOSE (or timeout), then CLOSE. */
export async function query(relay: string, filter: Record<string, unknown>, opts: RelayOptions = {}): Promise<SignedEvent[]> {
  const ws = await open(relay, opts);
  const sub = `mfb-${Math.random().toString(36).slice(2, 10)}`;
  const events: SignedEvent[] = [];
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, opts.timeoutMs ?? 10_000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.addEventListener('message', (m: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (!Array.isArray(msg) || msg[1] !== sub) return;
        if (msg[0] === 'EVENT' && msg[2] && typeof msg[2] === 'object') events.push(msg[2] as SignedEvent);
        else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') done();
      });
      ws.addEventListener('close', done);
      ws.send(JSON.stringify(['REQ', sub, filter]));
    });
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(['CLOSE', sub]));
  } finally {
    ws.close();
  }
  return events;
}
