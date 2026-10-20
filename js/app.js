// OMP Remote 0.3 — employee app for OT and shifts from outside the factory network.
// Everything sent or received is sealed end-to-end with the OMP server (e2e.js); the relay sees only ciphertext.
// Look and wording follow Employee Connect's "Tăng ca" module (Stitch theme), so both apps feel the same.
import * as E from './e2e.js';
import { Relay } from './relay.js';

const CFG = window.OMP_REMOTE || {};
const STORE = 'omp-remote-v1', MAX_PIN_FAILS = 10, IDLE_MS = 5 * 60 * 1000, ASK_TIMEOUT = 20000, MAX_DAYS = 14;
const ST = { pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'], rejected: ['Từ chối', 'red'], cancelled: ['Đã hủy', 'mute'] };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dvn = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
const dfull = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const fmt = n => n == null ? '—' : (Math.round(n * 100) / 100).toString().replace('.', ',');
const fh = n => (Math.round((n || 0) * 10) / 10).toFixed(1).replace('.', ',') + 'h';
const clock = () => new Date().toLocaleTimeString('vi-VN', { hour12: false });
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wdOf = d => WD[new Date(d + 'T00:00:00').getDay()];
const app = () => $('#app');

// Line icons (24×24, stroke = currentColor), same family as EC.
const svg = (p, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const P = {
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M16 13H8M16 17H8M10 9H8"/>',
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>',
  swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
  wifi: '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0"/><path d="m2 2 20 20"/>',
  pin: '<path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
};
const ic = (k, s) => svg(P[k], s);
const I = Object.fromEntries(Object.keys(P).map(k => [k, ic(k, {"cal": 20, "doc": 20, "plus": 20, "swap": 20, "clock": 18, "lock": 20, "shield": 18, "check": 16, "warn": 16, "refresh": 18, "send": 18, "list": 18, "wifi": 18, "pin": 28, "phone": 28, "chev": 14}[k])]));

const mark = '<img src="img/omp-mark.svg" width="30" height="30" alt="">';

let saved = load();             // what stays on the phone: device id, public keys, PIN-wrapped private keys, sequence
let session = null;             // unlocked keys (memory only)
let relay = null, meta = null, sched = null, idleTimer = null, tab = 'schedule', online = true;
let counts = { ot: 0, shift: 0 };
const waiting = new Map();      // seq -> {resolve, reject, timer}

function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
function save() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: pairing lasts this tab only */ } }
function wipe() { saved = null; session = null; try { localStorage.removeItem(STORE); } catch { /* ignore */ } relay?.close(); relay = null; }

function status(el, text, kind = '') { if (!el) return; el.className = 'note ' + kind; el.textContent = text; el.hidden = !text; }

// ---------------------------------------------------------------- relay
async function ensureRelay() {
  if (!relay) {
    relay = new Relay(CFG.relayUrl, CFG.apikey);
    relay.onstate = s => { online = s === 'online'; paintNet(); };
    relay.on('omp-dev-' + saved.dev, onDeviceMessage);
  }
  await relay.connect(['omp-dev-' + saved.dev, CFG.inbox]);
  return relay;
}
function paintNet() {
  const b = $('#net'), bar = $('#offline');
  if (b) { b.textContent = online ? 'Trực tuyến' : 'Mất kết nối'; b.className = 'net ' + (online ? 'online' : 'offline'); }
  if (bar) bar.hidden = online;
}

let pairWaiter = null;
async function onDeviceMessage(event, payload) {
  if (event === 'paired' || event === 'pair_fail') { pairWaiter?.(event, payload); return; }
  if (event !== 'res' || !session) return;
  try {
    const { header, body } = await E.open(payload, session.kx, session.csig, 'res');
    const w = waiting.get(header.seq);
    if (!w) return;
    waiting.delete(header.seq); clearTimeout(w.timer);
    body.ok ? w.resolve(body.data) : w.reject(Object.assign(new Error(body.error || 'OMP từ chối yêu cầu'), { code: body.code || '' }));
  } catch { /* not for us, or tampered with: ignore */ }
}

async function ask(op, args = {}) {
  if (!session) throw new Error('Ứng dụng đang khoá');
  await ensureRelay();
  saved.seq = Math.max((saved.seq || 0) + 1, Math.floor(Date.now() / 1000));
  save();
  const seq = saved.seq, rid = E.b64e(crypto.getRandomValues(new Uint8Array(12)));
  const env = await E.seal({ dev: saved.dev, seq, ts: Math.floor(Date.now() / 1000) }, { rid, op, args }, session.ckx, session.sig, 'req');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(seq); reject(new Error('Máy chủ OMP chưa trả lời. Có thể máy chủ đang tắt hoặc mất mạng; thử lại sau.')); }, ASK_TIMEOUT);
    waiting.set(seq, { resolve, reject, timer });
    relay.send(CFG.inbox, 'req', env).catch(e => { clearTimeout(timer); waiting.delete(seq); reject(e); });
  });
}

// ---------------------------------------------------------------- bottom sheet (replaces confirm())
function sheet({ title, body = '', actions = [] }) {
  let d = $('#sheet');
  if (!d) { d = document.createElement('dialog'); d.id = 'sheet'; d.className = 'sheet'; d.setAttribute('aria-labelledby', 'sheetT'); document.body.append(d); }
  d.innerHTML = `<div class="sheet-b"><h2 id="sheetT">${esc(title)}</h2>${body}<div class="sheet-a">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  return new Promise(resolve => {
    actions.forEach((a, i) => { $(`[data-act="${i}"]`, d).onclick = () => { d.close(); resolve(a.value); }; });
    d.onclose = () => resolve(undefined);
    d.onclick = e => { if (e.target === d) d.close(); };
    d.showModal();
    $(`[data-act="${actions.length - 1}"]`, d)?.focus();
  });
}

// ---------------------------------------------------------------- onboarding frame (as EC)
const steps = now => ['Quản trị OMP cấp mã kết nối cho bạn', 'Nhập mã và đặt mã PIN trên điện thoại này', 'Quản trị OMP xác nhận mã 6 số trên máy']
  .map((t, i) => `<li class="${i < now ? 'done' : i === now ? 'now' : ''}">${t}</li>`).join('');
const hero = (title, text, now) => `<section class="hero"><div class="row-l">${mark}<span class="cap">OMP Remote · mạng ngoài</span></div>
  <h1>${title}</h1><p>${text}</p>${now == null ? '' : `<ol aria-label="Các bước kết nối">${steps(now)}</ol>`}</section>`;

// ---------------------------------------------------------------- pairing
function viewPair(message = '') {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('p') || '';
  if (fromLink) history.replaceState(null, '', location.pathname);       // the code never stays in the history
  app().innerHTML = `<main class="onb">
    ${hero('Kết nối với OMP', 'Xem lịch ca, đăng ký tăng ca và đổi ca khi ở ngoài mạng nhà máy. Dữ liệu được mã hoá đầu-cuối với máy chủ OMP.', 1)}
    <form id="pf" class="card" novalidate>
      <p class="title">${ic('pin', 18)} Mã kết nối từ quản trị OMP</p>
      <label class="field"><span>MÃ KẾT NỐI (12 KÝ TỰ)</span><input id="code" class="in codein" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" value="${esc(fromLink)}" required></label>
      <p class="help">Mã dùng một lần, hết hạn sau 10 phút. Không có mã? Liên hệ quản trị OMP.</p>
      <label class="field"><span>TÊN THIẾT BỊ</span><input id="label" class="in" maxlength="40" value="${esc(guessLabel())}"></label>
      <div class="pinrow">
        <label class="field"><span>MÃ PIN (6 SỐ)</span><input id="pin1" class="in pin" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" pattern="[0-9]{6}" required></label>
        <label class="field"><span>NHẬP LẠI PIN</span><input id="pin2" class="in pin" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" required></label>
      </div>
      <p class="help">Mã PIN dùng để mở ứng dụng trên máy này; OMP không biết mã PIN của bạn.</p>
      <p class="note" id="pmsg" role="status" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn primary big wide" id="pbtn">${I.shield} Kết nối thiết bị</button>
    </form>
    <p class="fine">Máy chủ trung chuyển trên internet chỉ chuyển gói đã mã hoá: không đọc được và không lưu dữ liệu OT, ca của bạn.</p>
  </main>`;
  if (message) $('#pmsg').className = 'note bad';
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const code = E.normalizeCode($('#code').value), label = $('#label').value.trim().slice(0, 40), p1 = $('#pin1').value, p2 = $('#pin2').value, msg = $('#pmsg');
    if (code.length !== 12) { $('#code').setAttribute('aria-invalid', 'true'); return status(msg, 'Mã kết nối gồm 12 ký tự (ví dụ ABCD-EFGH-JKLM).', 'bad'); }
    $('#code').removeAttribute('aria-invalid');
    if (!/^[0-9]{6}$/.test(p1)) return status(msg, 'Mã PIN gồm đúng 6 chữ số.', 'bad');
    if (p1 !== p2) return status(msg, 'Hai lần nhập mã PIN chưa khớp.', 'bad');
    const btn = $('#pbtn'); btn.disabled = true; btn.textContent = 'Đang kết nối…';
    try {
      await pair(code, label, p1);
      await afterUnlock();
    } catch (err) {
      wipe();
      btn.disabled = false; btn.innerHTML = `${I.shield} Kết nối thiết bị`;
      status(msg, err.message, 'bad');
    }
  };
}

function guessLabel() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Điện thoại Android' : 'Máy tính';
}

async function pair(code, label, pin) {
  const keys = await E.genDeviceKeys();
  const dev = E.b64e(crypto.getRandomValues(new Uint8Array(16)));
  const dkx = await E.rawPub(keys.kx.publicKey), dsig = await E.rawPub(keys.sig.publicKey);
  saved = { v: 1, dev, label, dkx, dsig, seq: 0, fails: 0 };
  await ensureRelay();
  const reply = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Máy chủ OMP chưa phản hồi. Kiểm tra máy chủ đang chạy, rồi thử lại.')), ASK_TIMEOUT);
    pairWaiter = (event, p) => { clearTimeout(t); pairWaiter = null; event === 'paired' ? resolve(p) : reject(new Error(p?.reason || 'Không kết nối được.')); };
  });
  await relay.send(CFG.inbox, 'pair', { inv: await E.inviteId(code), dev, dkx, dsig, label, mac: await E.mac(code, 'pair1', dev, dkx, dsig, label) });
  const p = await reply;
  // The server proves it knows the same one-time code: a relay cannot slip in its own keys.
  if (p.mac !== await E.mac(code, 'paired1', dev, p.ckx, p.csig)) throw new Error('Phản hồi không đến từ máy chủ OMP của bạn. Dừng lại và báo quản trị OMP.');
  saved.ckx = p.ckx; saved.csig = p.csig;
  saved.wrapped = await E.wrap({ kx: await E.exportPriv(keys.kx.privateKey), sig: await E.exportPriv(keys.sig.privateKey) }, pin);
  save();
  session = { kx: await E.importKxPriv(await E.exportPriv(keys.kx.privateKey)), sig: await E.importSigPriv(await E.exportPriv(keys.sig.privateKey)),
              ckx: await E.kxPub(p.ckx), csig: await E.sigPub(p.csig) };
}

// ---------------------------------------------------------------- unlock
function viewUnlock(message = '') {
  app().innerHTML = `<main class="onb">
    <div class="row-l">${mark}<b class="title">OMP Remote</b></div>
    <form id="uf" class="card center" novalidate>
      <span class="lockicon">${I.lock}</span>
      <h1 class="title">Mở khoá OMP Remote</h1>
      <p class="muted">${esc(saved.label || 'Thiết bị này')} đã kết nối với OMP.</p>
      <label class="field wide-field"><span>MÃ PIN</span><input id="pin" class="in pin" inputmode="numeric" type="password" autocomplete="current-password" maxlength="6" required autofocus></label>
      <p class="note bad" id="umsg" role="status" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn primary big wide">Mở khoá</button>
    </form>
    <button class="btn ghost" id="forget" type="button">Gỡ kết nối khỏi máy này</button>
  </main>`;
  $('#pin').focus();
  $('#uf').onsubmit = async e => {
    e.preventDefault();
    try {
      const k = await E.unwrap(saved.wrapped, $('#pin').value);
      session = { kx: await E.importKxPriv(k.kx), sig: await E.importSigPriv(k.sig), ckx: await E.kxPub(saved.ckx), csig: await E.sigPub(saved.csig) };
      saved.fails = 0; save();
      await afterUnlock();
    } catch {
      saved.fails = (saved.fails || 0) + 1; save();
      if (saved.fails >= MAX_PIN_FAILS) { wipe(); return viewPair('Nhập sai mã PIN quá nhiều lần nên kết nối đã bị xoá. Nhờ quản trị OMP cấp mã kết nối mới.'); }
      $('#pin').value = '';
      status($('#umsg'), `Mã PIN không đúng. Còn ${MAX_PIN_FAILS - saved.fails} lần thử.`, 'bad');
    }
  };
  $('#forget').onclick = forget;
}

async function forget() {
  const ok = await sheet({ title: 'Gỡ kết nối OMP khỏi máy này?', body: '<p class="help">Khoá trên máy này bị xoá. Muốn dùng lại phải nhờ quản trị OMP cấp mã mới. Nên báo quản trị thu hồi thiết bị này trong OMP.</p>',
    actions: [{ label: 'Giữ lại', value: false }, { label: 'Gỡ kết nối', cls: 'danger', value: true }] });
  if (ok) { wipe(); viewPair(); }
}

function lock() { session = null; meta = null; sched = null; waiting.forEach(w => clearTimeout(w.timer)); waiting.clear(); $('#sheet')?.close(); if (saved?.wrapped) viewUnlock(); }
function touch() { clearTimeout(idleTimer); if (session) idleTimer = setTimeout(lock, IDLE_MS); }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, touch, { passive: true }));

async function loadAll() {
  const [me, m] = await Promise.all([ask('me'), ask('meta')]);
  meta = { ...m, me };
  await refresh();
}
async function refresh() {
  const [s, lo, ls] = await Promise.all([ask('schedule'), ask('list', { kind: 'ot', status: 'pending' }), ask('list', { kind: 'shift', status: 'pending' })]);
  sched = s; sched.at = clock();
  counts = { ot: lo.rows.length, shift: ls.rows.length };
}

async function afterUnlock() {
  touch();
  app().innerHTML = `<main class="onb"><div class="card center"><span class="lockicon">${I.refresh}</span><p class="muted">Đang tải dữ liệu từ OMP…</p></div></main>`;
  try {
    await loadAll();
    viewHome();
  } catch (err) {
    if (err.code === 'PENDING') return viewPending();
    app().innerHTML = `<main class="onb"><div class="card"><p class="title">${I.wifi} Chưa kết nối được OMP</p><p class="note bad">${esc(err.message)}</p>
      <button class="btn primary big wide" id="retry">Thử lại</button><button class="btn ghost" id="lockb">Khoá</button></div></main>`;
    $('#retry').onclick = afterUnlock; $('#lockb').onclick = lock;
  }
}

// v0.2: the phone is paired but works only after an OMP administrator confirms it with the code shown here.
async function viewPending() {
  const code = await E.verifyCode(saved.dev, saved.dkx, saved.dsig);
  app().innerHTML = `<main class="onb">
    ${hero('Chờ quản trị xác nhận', 'Điện thoại đã kết nối với OMP nhưng chưa dùng được. Đưa màn hình này cho quản trị OMP, hoặc đọc mã qua điện thoại, để họ xác nhận đúng là máy của bạn.', 2)}
    <section class="card">
      <p class="cap">Mã xác nhận thiết bị</p>
      <p class="vcode" aria-label="Mã xác nhận" id="vcode">${esc(code)}</p>
      <p class="help">Quản trị nhập 6 số này trong <b>OMP › Quản trị › Điện thoại (OMP Remote)</b>. Mã chỉ hiện trên máy này.</p>
      <p class="note" id="vmsg" role="status" hidden></p>
      <button class="btn primary big wide" id="recheck" type="button">${I.refresh} Kiểm tra lại</button>
      <button class="btn ghost" id="lockb" type="button">Khoá</button>
    </section>
    <p class="fine">Không đọc mã này cho ai khác ngoài quản trị OMP. Nếu bạn không yêu cầu kết nối, hãy báo quản trị OMP.</p>
  </main>`;
  $('#lockb').onclick = lock;
  $('#recheck').onclick = async () => {
    const b = $('#recheck'); b.disabled = true; b.textContent = 'Đang kiểm tra…';
    try {
      await loadAll();
      viewHome();
    } catch (err) {
      b.disabled = false; b.innerHTML = `${I.refresh} Kiểm tra lại`;
      status($('#vmsg'), err.code === 'PENDING' ? 'Quản trị OMP chưa xác nhận. Thử lại sau khi họ báo đã xong.' : err.message, err.code === 'PENDING' ? 'warn' : 'bad');
    }
  };
}

// ---------------------------------------------------------------- home shell
const TABS = [['schedule', 'Lịch tôi', I.cal], ['mine', 'Đơn ký', I.doc], ['ot', 'ĐK OT', I.plus], ['shift', 'Đổi ca', I.swap]];
const initials = n => String(n || '').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase() || 'NV';
function viewHome() {
  const pend = counts.ot + counts.shift;
  app().innerHTML = `<header class="top"><div class="brand">${mark}<b>OMP Remote</b><span class="role">NHÂN VIÊN</span></div>
      <button class="iconbtn" id="lockb" type="button" aria-label="Khoá ứng dụng" title="Khoá">${I.lock}</button>
      <button class="avatar" id="acct" type="button" aria-label="Tài khoản và thiết bị">${esc(initials(meta.me.name))}</button></header>
    <div class="wrap">
      <div class="offline-bar" id="offline" role="status" ${online ? 'hidden' : ''}>${I.wifi}<span>Mất kết nối tới trạm trung chuyển. Đang thử kết nối lại; dữ liệu chưa gửi không được lưu lại.</span></div>
      <div class="hello"><b id="who">${esc(meta.me.name)}</b><span class="row-l"><span class="chip mute mono">${esc(meta.me.emp_id)}</span><span class="net ${online ? 'online' : 'offline'}" id="net" role="status">${online ? 'Trực tuyến' : 'Mất kết nối'}</span></span></div>
      <nav class="tabs" role="tablist" aria-label="Chức năng">${TABS.map(([k, l, ic]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${tab === k}" aria-controls="view">${ic}<span>${l}</span>${k === 'mine' && pend ? `<span class="count" aria-label="${pend} đơn chờ duyệt">${pend}</span>` : ''}</button>`).join('')}</nav>
      <section id="view" role="tabpanel" class="viewbox"></section>
    </div>`;
  $('#lockb').onclick = lock;
  $('#acct').onclick = account;
  $$('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; viewHome(); });
  ({ schedule: viewSchedule, ot: viewOt, shift: viewShift, mine: viewMine })[tab]($('#view'));
}

async function account() {
  const r = await sheet({ title: 'Tài khoản & thiết bị', body: `<dl class="kv"><dt>Nhân viên</dt><dd>${esc(meta.me.name)}</dd><dt>Mã NV</dt><dd class="mono">${esc(meta.me.emp_id)}</dd>
      <dt>Thiết bị</dt><dd>${esc(saved.label || 'Thiết bị này')}</dd><dt>Kết nối</dt><dd>${online ? 'Trực tuyến · mã hoá đầu-cuối' : 'Mất kết nối'}</dd></dl>
      <p class="help">Ứng dụng tự khoá sau 5 phút không dùng. Mất máy: thu hồi trong OMP › Hồ sơ của tôi › Bảo mật, hoặc báo quản trị OMP.</p>`,
    actions: [{ label: 'Gỡ kết nối', cls: 'danger-line', value: 'forget' }, { label: 'Khoá ngay', cls: 'primary', value: 'lock' }] });
  if (r === 'lock') lock(); else if (r === 'forget') forget();
}

// ---------------------------------------------------------------- Lịch tôi
const emp = () => (meta.employees || [])[0] || {};
const shiftDef = code => (meta.shifts || []).find(s => s.code === code);
function quotaCard() {
  const e = emp(), lim = meta.rule?.monthly || 0, used = e.cycle_used || 0, pend = e.pending || 0;
  if (!lim) return '';
  const pct = Math.min(100, (used / lim) * 100), add = Math.max(0, Math.min(100 - pct, (pend / lim) * 100)), all = (used + pend) / lim;
  const tone = all > 1 ? 'bad' : all >= (meta.rule.warning || 0.8) ? 'warn' : '';
  const [c0, c1] = meta.cycle || [];
  return `<section class="card quota ${tone}" aria-label="Hạn mức OT kỳ công">
    <div class="row"><p class="title"><span class="dot" aria-hidden="true"></span> Hạn mức OT kỳ công</p><span class="chip mono">${fh(used)} / ${fh(lim)} (${Math.round(used / lim * 100)}%)</span></div>
    <svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Đã dùng ${fmt(used)} giờ, chờ duyệt ${fmt(pend)} giờ, ngưỡng ${fmt(lim)} giờ"><rect class="bg" width="100" height="8"/><rect class="${all > 1 ? 'over' : 'used'}" width="${pct.toFixed(1)}" height="8"/><rect class="add" x="${pct.toFixed(1)}" width="${add.toFixed(1)}" height="8"/></svg>
    <div class="row"><span class="state">${tone ? I.warn : I.check} ${tone === 'bad' ? 'Vượt ngưỡng kỳ công' : tone ? 'Gần ngưỡng kỳ công' : 'Trong ngưỡng an toàn OMP'}</span><span class="mono muted">Còn lại: <b>${fh(Math.max(0, lim - used - pend))}</b></span></div>
    <p class="help">Kỳ công ${dvn(c0)}–${dvn(c1)} theo OMP: đã dùng ${fh(used)}${pend ? ` + chờ duyệt ${fh(pend)}` : ''}. Ngưỡng năm ${fh(meta.rule.annual)} (đã dùng ${fh(e.year_used)}).</p></section>`;
}
const dayChips = d => {
  const out = [];
  if (d.leave) out.push(`<span class="chip red">${esc(d.leave)}${d.leave_part ? ' · ' + esc(d.leave_part) : ''}</span>`);
  else if (d.shift) out.push(`<span class="chip p">${esc(d.shift)}</span>`);
  else out.push('<span class="chip line">Chưa có ca</span>');
  const sd = shiftDef(d.shift);
  if (sd && !d.leave) out.push(`<span class="time">${esc(sd.start)}–${esc(sd.end)}</span>`);
  if (d.plan) out.push(`<span class="chip">+${fmt(d.plan)}h OT</span>`);
  (d.pending || []).forEach(p => out.push(`<span class="chip warn">Chờ: ${p.kind === 'ot' ? '+' + fmt(p.hours) + 'h' : esc(p.leave || p.shift)}</span>`));
  if (d.actual?.hours != null) out.push(`<span class="chip ok">Actual ${fmt(d.actual.hours)}h</span>`);
  return out.join('');
};
function todayCard(d) {
  if (!d) return '';
  const sd = shiftDef(d.shift), p = (d.pending || [])[0];
  return `<section class="card"><div class="row"><p class="row-l"><span class="chip p">HÔM NAY</span> <b class="title">${esc(wdName(d.weekday))}, ${dfull(d.day)}</b></p></div>
    <div class="shiftline"><span class="code ${d.leave || !d.shift ? 'off' : ''}">${esc(d.leave || d.shift || '—')}</span><div><b>${d.leave ? 'Nghỉ ' + esc(d.leave) : sd ? esc(sd.name || 'Ca ' + sd.code) : d.shift ? 'Ca ' + esc(d.shift) : 'Chưa có ca'}</b>
      <p class="muted mono">${sd && !d.leave ? `${esc(sd.start)} – ${esc(sd.end)}` : 'Theo lịch OMP'}</p></div></div>
    <div class="tiles"><div class="tile"><span class="cap">OT kế hoạch <b>${d.plan ? '+' + fmt(d.plan) + 'h' : ''}</b></span><b>${d.plan ? 'Đã có kế hoạch' : 'Không có'}</b>${d.plan_source ? `<span class="muted">Nguồn: ${esc(d.plan_source)}</span>` : ''}</div>
      <div class="tile ${p ? 'pend' : ''}"><span class="cap">Chờ duyệt <b>${p?.kind === 'ot' ? '+' + fmt(p.hours) + 'h' : ''}</b></span><b>${p ? (p.kind === 'ot' ? 'Đơn OT đang chờ' : 'Đổi ca: ' + esc(p.leave || p.shift)) : 'Không có đơn'}</b></div></div></section>`;
}
const wdName = w => ({ T2: 'Thứ Hai', T3: 'Thứ Ba', T4: 'Thứ Tư', T5: 'Thứ Năm', T6: 'Thứ Sáu', T7: 'Thứ Bảy', CN: 'Chủ Nhật' }[w] || w || '');

async function viewSchedule(el) {
  const draw = () => {
    const days = sched.days || [], t = days.find(d => d.day === sched.today);
    const ot = days.reduce((a, d) => a + (d.plan || 0), 0), pend = days.reduce((a, d) => a + (d.pending || []).filter(p => p.kind === 'ot').reduce((x, p) => x + (p.hours || 0), 0), 0);
    el.innerHTML = `${quotaCard()}${todayCard(t)}
      <section class="card"><div class="row"><div><p class="title">${ic('cal', 18)} Lịch 14 ngày</p><p class="muted mono">${dvn(days[0]?.day)} – ${dfull(days.at(-1)?.day)} · ${esc(sched.at || '')} · OMP</p></div>
        <button class="iconbtn" id="reload" type="button" aria-label="Tải lại lịch">${I.refresh}</button></div>
        <ul class="days" aria-label="Lịch 14 ngày">${days.map(d => `<li class="${d.day === sched.today ? 'today' : ''}"><div class="dd"><small class="${d.weekday === 'CN' ? 'sun' : ''}">${esc(d.weekday)}</small><b>${dvn(d.day).slice(0, 2)}</b><small>/${d.day.slice(5, 7)}</small></div>
          <div class="dc">${dayChips(d)}</div></li>`).join('')}</ul>
        <div class="ribbon"><span>Tổng OT kế hoạch: <b>${fh(ot)}</b></span><span>Chờ duyệt: <b>${fh(pend)}</b></span></div>
        ${sched.actual_coverage?.actual_until ? `<p class="help">Actual (quẹt thẻ) có đến ${dfull(sched.actual_coverage.actual_until)}.</p>` : ''}</section>`;
    $('#reload', el).onclick = async () => {
      const b = $('#reload', el); b.disabled = true;
      try { await refresh(); viewHome(); } catch (err) { b.disabled = false; el.insertAdjacentHTML('afterbegin', `<p class="note bad">${esc(err.message)}</p>`); }
    };
  };
  if (sched) return draw();
  el.innerHTML = '<div class="card"><p class="muted">Đang tải lịch…</p></div>';
  try { await refresh(); draw(); } catch (err) { el.innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
}

// ---------------------------------------------------------------- ĐK OT / Đổi ca
function dayPicker(kind) {
  const days = (sched?.days || []).filter(d => d.day >= meta.today);
  return `<section class="card"><div class="row"><p class="title">${ic('cal', 18)} Ngày đăng ký</p>
      <div class="seg" role="group" aria-label="Số ngày"><button type="button" data-mode="one" aria-pressed="true">1 ngày</button><button type="button" data-mode="many" aria-pressed="false">Nhiều ngày</button></div></div>
    <p class="cap">${days.length ? `${dvn(days[0].day)} – ${dvn(days.at(-1).day)} · chạm để chọn` : 'Chọn ngày bên dưới'}</p>
    <div class="dgrid" role="group" aria-label="Chọn ngày">${days.map(d => `<button type="button" data-day="${d.day}" aria-pressed="false" class="${(d.pending || []).length ? 'has' : ''}" aria-label="${esc(wdName(d.weekday))} ${dfull(d.day)}${d.shift ? ', ca ' + esc(d.shift) : ''}${d.leave ? ', nghỉ ' + esc(d.leave) : ''}${(d.pending || []).length ? ', đang có đơn chờ' : ''}">
      <small class="${d.weekday === 'CN' ? 'sun' : ''}">${esc(d.weekday)}</small><b>${d.day.slice(8)}</b><i>${esc(d.leave || d.shift || '··')}</i></button>`).join('')}</div>
    <div class="more"><label class="field"><span>+ NGÀY KHÁC</span><input id="day" class="in" type="date" min="${meta.today}"></label></div>
    <div class="picked" id="picked"></div></section>`;
}

function issuesHtml(res) {
  const rows = res?.rows || [];
  if (!rows.length) return '';
  const blocked = rows.filter(r => !r.ok).length, warn = rows.filter(r => r.ok && (r.issues || []).length).length;
  const verdict = blocked ? ['KHÔNG HỢP LỆ', 'red', 'bad'] : warn ? ['CẢNH BÁO', 'warn', 'warn'] : ['HỢP LỆ', 'ok', 'ok'];
  const r0 = rows.at(-1), lim = r0.cycle_limit, after = r0.cycle_after, hrs = rows.reduce((a, r) => a + (r.hours || 0), 0), before = after != null ? after - hrs : null;
  const issues = rows.flatMap(r => (r.issues || []).map(i => `<li class="${i.level === 'error' ? 'bad' : ''}"><b>${dvn(r.day)}</b>${esc(i.text)}</li>`)).join('');
  return `<div class="row"><p class="title">${I.shield} Thẩm định tự động</p><span class="chip ${verdict[1]} verdict">${verdict[0]}</span></div>
    ${lim && hrs ? `<div class="calc"><span class="muted">Kỳ công ${dvn(r0.cycle?.[0])}–${dvn(r0.cycle?.[1])}:</span><span class="mono">${fh(before)} + ${fh(hrs)} = <b>${fh(after)}</b> / ${fh(lim)}</span>
      <svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="bg" width="100" height="8"/><rect class="used" width="${Math.min(100, before / lim * 100).toFixed(1)}" height="8"/><rect class="${after > lim ? 'over' : 'add'}" x="${Math.min(100, before / lim * 100).toFixed(1)}" width="${Math.max(0, Math.min(100, after / lim * 100) - Math.min(100, before / lim * 100)).toFixed(1)}" height="8"/></svg>
      <div class="row mono muted"><span>Hiện có ${Math.round(before / lim * 100)}%</span><span>Sau đăng ký: ${Math.round(after / lim * 100)}%</span></div></div>` : ''}
    ${issues ? `<ul class="issues">${issues}</ul>` : ''}
    <p class="note ${verdict[2]}">${blocked ? `${blocked} ngày không gửi được. Bỏ chọn hoặc sửa rồi kiểm tra lại.` : warn ? 'Gửi được, người duyệt sẽ thấy các cảnh báo trên.' : 'Hợp lệ, có thể gửi.'}</p>
    <p class="help">Đã kiểm tra lúc ${clock()} (giờ máy). Kết quả kiểm tra không phải phê duyệt; OMP kiểm tra lại khi gửi.</p>`;
}

function regForm(el, kind) {
  const ot = kind === 'ot';
  const shifts = (meta.shifts || []).filter(s => s.normal_hours);
  el.innerHTML = `<form id="rf" class="viewbox" novalidate>${dayPicker(kind)}
    ${ot ? `<section class="card"><div class="row"><p class="title">${I.clock} Số giờ tăng ca</p><span class="muted">Áp dụng cho mọi ngày đã chọn</span></div>
        <div class="hgrid" role="group" aria-label="Chọn nhanh số giờ">${[1.5, 2, 2.5, 4].map(h => `<button type="button" data-h="${h}" aria-pressed="${h === 2}">+${fmt(h)}h</button>`).join('')}</div>
        <div class="window">${I.clock}<div><b id="win">—</b><p class="muted">Khung giờ tham chiếu, nối tiếp sau ca</p></div>
          <label class="stepper"><span class="sr-only">Số giờ OT mỗi ngày</span><input id="hours" class="in" type="number" inputmode="decimal" min="0.5" max="12" step="0.5" value="2" required>h</label></div>
        <p class="help">OMP kiểm tra giờ từng ngày khi thẩm định và khi gửi. Đây là giờ đăng ký, không phải Actual.</p></section>
      <section class="card"><div class="row"><p class="title">${ic('doc', 18)} Lý do tăng ca</p><span class="chip red">Bắt buộc</span></div>
        <label class="field"><span class="sr-only">Lý do</span><select id="reason" class="in">${(meta.reasons || []).map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select></label>`
    : `<section class="card"><p class="title">${ic('swap', 18)} Ca muốn đăng ký</p>
        <div class="sgrid" role="group" aria-label="Chọn ca">${meta.off_code ? `<button type="button" data-shift="@off" aria-pressed="false"><span class="code off">${esc(meta.off_code)}</span><span><b>Ngày OFF</b><small>Mã ${esc(meta.off_code)} theo OMP</small></span></button>` : ''}${shifts.map((s, i) => `<button type="button" data-shift="${esc(s.code)}" aria-pressed="${!meta.off_code && i === 0}"><span class="code">${esc(s.code)}</span><span><b>${esc(s.name || 'Ca ' + s.code)}</b><small>${esc(s.start)}–${esc(s.end)}</small></span></button>`).join('')}</div>`}
        <label class="field"><span>GHI CHÚ GỬI OMP (KHÔNG BẮT BUỘC)</span><textarea id="note" class="in" maxlength="300" rows="2" placeholder="${ot ? 'Ví dụ: hỗ trợ đơn hàng xuất, bù tiến độ chuyền…' : 'Ví dụ: đổi ca với đồng nghiệp…'}"></textarea><span class="counter" id="ncount">0/300</span></label>
        <p class="help">Chỉ giữ lúc nhập; không lưu trên thiết bị.</p></section>
    <section class="card audit" id="chk" aria-live="polite"><p class="muted">Chọn ngày để OMP thẩm định.</p></section>
    <div class="actions"><button class="btn primary big wide" id="send" disabled>${I.send} Gửi đề xuất</button></div>
    <div id="res" aria-live="polite"></div></form>`;

  const sel = new Set();
  let many = false, shiftPick = ot ? null : ($('[data-shift][aria-pressed=true]', el)?.dataset.shift || null), seq = 0, lastOk = false;
  const hours = () => ot ? Number($('#hours', el).value) : 0;
  const items = () => [...sel].sort().map(day => {
    const it = { day };
    if (ot) it.hours = hours();
    else if (shiftPick === '@off') it.leave = meta.off_code; else it.shift = shiftPick;
    return it;
  });
  const body = () => ({ kind, items: items(), reason_code: ot ? $('#reason', el).value : '', note: $('#note', el).value.trim() });
  const addTime = (hhmm, h) => { const [a, b] = hhmm.split(':').map(Number), m = a * 60 + b + Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const paint = () => {
    $$('[data-day]', el).forEach(b => b.setAttribute('aria-pressed', sel.has(b.dataset.day)));
    $$('[data-mode]', el).forEach(b => b.setAttribute('aria-pressed', (b.dataset.mode === 'many') === many));
    const byDay = Object.fromEntries((sched?.days || []).map(d => [d.day, d]));
    const list = [...sel].sort();
    $('#picked', el).innerHTML = list.length ? `<div class="row"><span class="cap">Đang chọn: ${list.length} ngày</span><button type="button" class="link" id="clear">Xóa chọn</button></div>
      <ul>${list.map(day => { const d = byDay[day], sd = shiftDef(d?.shift); return `<li><b>${wdOf(day)} · ${dvn(day)}${d?.shift ? ' ' + esc(d.shift) : ''}</b><small>${sd ? `${esc(sd.start)}–${esc(sd.end)}` : d?.leave ? 'Nghỉ ' + esc(d.leave) : 'Ngoài lịch 14 ngày'}</small></li>`; }).join('')}</ul>`
      : '<p class="muted">Chưa chọn ngày nào.</p>';
    $('#clear', el)?.addEventListener('click', () => { sel.clear(); changed(); });
    if (ot) {
      $$('[data-h]', el).forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.h) === hours()));
      const sds = list.map(day => shiftDef(byDay[day]?.shift)).filter(Boolean), sd = sds[0];
      $('#win', el).textContent = sd?.ot_start && sds.every(x => x.ot_start === sd.ot_start) ? `Khung giờ: ${sd.ot_start} – ${addTime(sd.ot_start, hours())}` : list.length ? 'Khung giờ theo ca từng ngày' : '—';
    } else $$('[data-shift]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.shift === shiftPick));
    const btn = $('#send', el), h = hours() * list.length;
    btn.innerHTML = `${I.send} ${list.length ? `Gửi đề xuất ${list.length} ngày${ot ? ` (${fmt(h)}h OT)` : ''}` : 'Gửi đề xuất'}`;
    btn.disabled = !list.length || !lastOk;
  };
  const check = async () => {
    const mine = ++seq, chk = $('#chk', el);
    lastOk = false; paint();
    if (!sel.size) { chk.innerHTML = '<p class="muted">Chọn ngày để OMP thẩm định.</p>'; return; }
    if (!ot && !shiftPick) { chk.innerHTML = '<p class="muted">Chọn ca muốn đăng ký.</p>'; return; }
    chk.innerHTML = `<p class="title">${I.shield} Thẩm định tự động</p><p class="muted">Đang kiểm tra theo quy tắc của OMP…</p>`;
    try {
      const r = await ask('check', body());
      if (mine !== seq) return;
      chk.innerHTML = issuesHtml(r) + `<button type="button" class="btn soft wide" id="recheck">${I.shield} Kiểm tra lại</button>`;
      $('#recheck', el).onclick = check;
      lastOk = (r.rows || []).some(x => x.ok);
    } catch (err) { if (mine === seq) chk.innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
    paint();
  };
  let deb = 0;
  const changed = () => { paint(); clearTimeout(deb); deb = setTimeout(check, 350); };   // one check per burst of taps (the connector allows 30 requests / minute)
  $$('[data-day]', el).forEach(b => b.onclick = () => {
    const d = b.dataset.day;
    if (many) { if (sel.has(d)) sel.delete(d); else if (sel.size < MAX_DAYS) sel.add(d); }
    else { sel.clear(); sel.add(d); }
    changed();
  });
  $$('[data-mode]', el).forEach(b => b.onclick = () => { many = b.dataset.mode === 'many'; if (!many && sel.size > 1) { const f = [...sel].sort()[0]; sel.clear(); sel.add(f); } changed(); });
  $('#day', el).addEventListener('change', e => { const d = e.target.value; if (!d || d < meta.today) return; if (!many) sel.clear(); if (sel.size < MAX_DAYS) sel.add(d); e.target.value = ''; changed(); });
  if (ot) {
    $$('[data-h]', el).forEach(b => b.onclick = () => { $('#hours', el).value = b.dataset.h; changed(); });
    $('#hours', el).addEventListener('change', changed);
    $('#reason', el).addEventListener('change', check);
  } else $$('[data-shift]', el).forEach(b => b.onclick = () => { shiftPick = b.dataset.shift; changed(); });
  $('#note', el).addEventListener('input', e => { $('#ncount', el).textContent = `${e.target.value.length}/300`; });
  const first = (sched?.days || []).find(d => d.day >= meta.today);
  if (first) sel.add(first.day);
  changed();

  $('#rf', el).onsubmit = async e => {
    e.preventDefault();
    const btn = $('#send', el); if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Đang gửi…';
    try {
      const r = await ask('submit', body());
      $('#res', el).innerHTML = r.done ? `<p class="note ok">Đã gửi ${r.done} đơn. Theo dõi ở tab “Đơn ký”.</p>` : `<p class="note bad">Chưa gửi được: ${esc((r.skipped || []).join('; '))}</p>`;
      if (r.done) {
        sel.clear(); $('#note', el).value = ''; $('#ncount', el).textContent = '0/300';
        refresh().then(() => { const c = $('.tabs .count'); const n = counts.ot + counts.shift; const tb = $('[data-tab=mine]'); if (tb) { c?.remove(); if (n) tb.insertAdjacentHTML('beforeend', `<span class="count" aria-label="${n} đơn chờ duyệt">${n}</span>`); } }).catch(() => {});
        changed();
      }
    } catch (err) { $('#res', el).innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
    paint();
  };
}
const viewOt = el => regForm(el, 'ot');
const viewShift = el => regForm(el, 'shift');

// ---------------------------------------------------------------- Đơn ký
let mineKind = 'ot', mineSt = 'all';
async function viewMine(el) {
  el.innerHTML = `<div class="row"><div class="seg" role="group" aria-label="Loại đơn"><button type="button" data-k="ot" aria-pressed="${mineKind === 'ot'}">Tăng ca</button><button type="button" data-k="shift" aria-pressed="${mineKind === 'shift'}">Ca / OFF</button></div>
      <button class="iconbtn" id="reload" type="button" aria-label="Tải lại">${I.refresh}</button></div>
    <div id="list"><div class="card"><p class="muted">Đang tải…</p></div></div>`;
  $$('[data-k]', el).forEach(b => b.onclick = () => { mineKind = b.dataset.k; viewMine(el); });
  $('#reload', el).onclick = () => viewMine(el);
  try {
    const { rows } = await ask('list', { kind: mineKind });
    const n = s => rows.filter(r => s === 'all' || r.status === s).length;
    const shown = rows.filter(r => mineSt === 'all' || r.status === mineSt);
    const left = Math.max(0, (meta.rule?.monthly || 0) - (emp().cycle_used || 0) - (emp().pending || 0));
    $('#list', el).innerHTML = `<div class="viewbox"><div class="pills" role="group" aria-label="Lọc trạng thái">${[['all', 'Tất cả'], ['pending', 'Chờ'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối'], ['cancelled', 'Đã hủy']].map(([k, l]) => `<button type="button" data-s="${k}" aria-pressed="${mineSt === k}">${k === 'pending' ? '• ' : ''}${l} (${n(k)})</button>`).join('')}</div>
      <div class="ribbon"><span>${I.list} <b>${n('pending')}</b> đơn đang chờ duyệt</span>${mineKind === 'ot' && meta.rule?.monthly ? `<span>Hạn mức: <b>${fh(left)}</b> còn lại</span>` : ''}</div>
      ${shown.length ? `<ul class="regs">${shown.map(r => {
        const [label, cls] = ST[r.status] || [r.status, 'mute'];
        const what = r.kind === 'ot' ? `<b>+${fmt(r.hours)}h</b>${r.from && r.to ? `<span>${esc(r.from)}–${esc(r.to)}</span>` : ''}` : `<b>${esc(r.leave_name || r.leave || r.shift)}</b>${r.leave_part ? `<span>${esc(r.leave_part)}</span>` : ''}`;
        return `<li data-st="${esc(r.status)}"><div class="row"><span class="mono"><b>#${r.reg_id}</b> <span class="muted">${esc(r.weekday)} · ${dfull(r.day)}</span></span><span class="chip ${cls}">${label}</span></div>
          <div class="what">${what}</div>
          ${r.reason || r.note ? `<p class="meta">${r.reason ? `Lý do: ${esc(r.reason)}` : ''}${r.reason && r.note ? ' · ' : ''}${r.note ? esc(r.note) : ''}</p>` : ''}
          ${r.decide_note ? `<p class="note ${r.status === 'rejected' ? 'bad' : ''}">Người duyệt: ${esc(r.decide_note)}</p>` : ''}
          <div class="foot"><span class="muted">Duyệt: theo OMP</span>${r.status === 'pending' ? `<button class="btn sm danger-line" data-cancel="${r.reg_id}" type="button">Hủy đơn</button>` : ''}</div></li>`;
      }).join('')}</ul>` : `<div class="empty">${rows.length ? '<p>Không có đơn ở trạng thái này.</p><button class="btn sm" type="button" data-s="all">Xem tất cả</button>' : `<p>Chưa có đơn ${mineKind === 'ot' ? 'tăng ca' : 'đổi ca'} nào.</p>`}</div>`}
      <button class="btn primary big wide" type="button" id="newreg">${I.plus} ${mineKind === 'ot' ? 'Tạo đề xuất OT mới' : 'Đăng ký đổi ca / OFF'}</button></div>`;
    $$('[data-s]', el).forEach(b => b.onclick = () => { mineSt = b.dataset.s; viewMine(el); });
    $('#newreg', el).onclick = () => { tab = mineKind === 'ot' ? 'ot' : 'shift'; viewHome(); };
    $$('[data-cancel]', el).forEach(b => b.onclick = async () => {
      const r = rows.find(x => String(x.reg_id) === b.dataset.cancel);
      const ok = await sheet({ title: `Hủy đơn #${r.reg_id}?`, body: `<p class="help">${dfull(r.day)} · ${r.kind === 'ot' ? '+' + fmt(r.hours) + 'h OT' : esc(r.leave_name || r.leave || r.shift)}. Đơn đã hủy không khôi phục từ điện thoại được.</p>`,
        actions: [{ label: 'Giữ đơn', value: false }, { label: 'Hủy đơn', cls: 'danger', value: true }] });
      if (!ok) return;
      b.disabled = true;
      try { await ask('cancel', { ids: [Number(b.dataset.cancel)] }); refresh().catch(() => {}); viewMine(el); }
      catch (err) { b.disabled = false; $('#list', el).insertAdjacentHTML('afterbegin', `<p class="note bad">${esc(err.message)}</p>`); }
    });
  } catch (err) { $('#list', el).innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
}

// ---------------------------------------------------------------- start
if (!CFG.relayUrl || !CFG.inbox) {
  app().innerHTML = '<main class="onb"><div class="card"><p class="title">Chưa cấu hình</p><p class="note bad">Thiếu config.js. Quản trị OMP chạy <code>python run.py --remote-init …</code> rồi deploy lại.</p></div></main>';
} else if (saved?.wrapped && saved.ckx) viewUnlock(); else { wipe(); viewPair(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
