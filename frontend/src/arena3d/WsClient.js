/**
 * Monad Colosseum - WebSocket Client
 *
 * Handles connection, reconnection, message dispatch, and subscriptions.
 */

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';
const RECONNECT_DELAY = 3000;

export class WsClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // type → Set<callback>
    this.connected = false;
    this._reconnectTimer = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return; // already open/connecting

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.connected = true;
      this._emit('_connected');
      console.log('[WS] Connected to', WS_URL);
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this._emit(msg.type, msg);
      } catch (e) {
        console.warn('[WS] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emit('_disconnected');
      console.log('[WS] Disconnected. Reconnecting in', RECONNECT_DELAY, 'ms');
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(arenaId) {
    this.send({ type: 'subscribe', arenaId });
  }

  unsubscribe(arenaId) {
    this.send({ type: 'unsubscribe', arenaId });
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback); // unsubscribe fn
  }

  _emit(type, data) {
    const cbs = this.listeners.get(type);
    if (cbs) cbs.forEach((cb) => cb(data));
    // Wildcard
    const all = this.listeners.get('*');
    if (all) all.forEach((cb) => cb(type, data));
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY);
  }
}
