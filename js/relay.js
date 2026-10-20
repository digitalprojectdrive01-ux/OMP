// Phoenix channel client for Supabase Realtime Broadcast (vsn 1.0.0 JSON) — no SDK, no third-party code.
// The relay only ever carries sealed envelopes (see e2e.js).
export class Relay {
  // Same rule as backend/remote/connector.normalize_relay_url: https://<ref>.supabase.co → wss://…/realtime/v1/websocket
  static normalize(url) {
    let u = String(url || '').trim();
    if (!u.includes('://')) u = 'wss://' + u;
    const p = new URL(u.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:'));
    if (p.protocol === 'ws:' && !['127.0.0.1', 'localhost'].includes(p.hostname)) p.protocol = 'wss:';
    let path = p.pathname.replace(/\/+$/, '');
    if (!path.endsWith('/realtime/v1/websocket')) path = (['', '/rest/v1', '/realtime/v1'].includes(path) ? '' : path) + '/realtime/v1/websocket';
    p.pathname = path;
    return p.toString();
  }
  constructor(url, apikey) {
    url = Relay.normalize(url);
    this.url = url + (url.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(apikey) + '&vsn=1.0.0';
    this.apikey = apikey; this.ref = 0; this.handlers = new Map(); this.joined = new Map(); this.replies = new Map(); this.ws = null;
    this.ready = null; this.onstate = () => {};
  }
  _push(topic, event, payload, joinRef) {
    const msg = { topic, event, payload, ref: String(++this.ref) };
    if (joinRef) msg.join_ref = joinRef;
    this.ws.send(JSON.stringify(msg));
    return msg.ref;
  }
  // Supabase needs join_ref (the join's own ref) on every later message of that topic; we wait for the join reply.
  _join(name) {
    const topic = 'realtime:' + name, ref = String(++this.ref);
    const done = new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.replies.delete(ref); reject(new Error('Máy chủ trung chuyển không phản hồi')); }, 10000);
      this.replies.set(ref, st => { clearTimeout(t); st === 'ok' ? resolve() : reject(new Error('Máy chủ trung chuyển từ chối kênh')); });
    });
    this.ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: this.apikey }, ref, join_ref: ref }));
    this.joined.set(topic, { ref, done });
    done.catch(() => this.joined.delete(topic));
    return done;
  }
  connect(listen) {
    this.listen = listen;
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const fail = setTimeout(() => { reject(new Error('Không kết nối được máy chủ trung chuyển')); ws.close(); }, 15000);
      ws.onopen = () => {
        clearTimeout(fail);
        this.beat = setInterval(() => { try { this._push('phoenix', 'heartbeat', {}); } catch { /* reconnect below */ } }, 25000);
        Promise.all(listen.map(n => this._join(n))).then(() => { this.onstate('online'); resolve(this); }, reject);
      };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.event === 'phx_reply') { const f = this.replies.get(String(m.ref)); if (f) { this.replies.delete(String(m.ref)); f(m.payload?.status); } return; }
        if (m.event !== 'broadcast') return;
        const name = String(m.topic || '').replace(/^realtime:/, ''), p = m.payload || {};
        (this.handlers.get(name) || []).forEach(f => f(p.event, p.payload));
      };
      ws.onclose = () => {
        clearInterval(this.beat); clearTimeout(fail); this.ready = null; this.joined.clear(); this.onstate('offline');
        reject(new Error('Mất kết nối máy chủ trung chuyển'));
      };
    });
    this.ready.catch(() => {});
    return this.ready;
  }
  on(name, fn) { this.handlers.set(name, [...(this.handlers.get(name) || []), fn]); }
  async send(name, event, payload) {
    await this.connect(this.listen || []);
    const topic = 'realtime:' + name;
    if (!this.joined.has(topic)) await this._join(name); else await this.joined.get(topic).done;
    this._push(topic, 'broadcast', { type: 'broadcast', event, payload }, this.joined.get(topic).ref);
  }
  close() { try { this.ws?.close(); } catch { /* already closed */ } }
}
