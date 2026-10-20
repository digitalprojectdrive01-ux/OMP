// OMP Remote — employee app for OT and shifts from outside the factory network.
// Everything sent or received is sealed end-to-end with the OMP server (e2e.js); the relay sees only ciphertext.
import * as E from './e2e.js';
import { Relay } from './relay.js';

const CFG = window.OMP_REMOTE || {};
const STORE = 'omp-remote-v1', MAX_PIN_FAILS = 10, IDLE_MS = 5 * 60 * 1000, ASK_TIMEOUT = 20000;
const STATUS = { pending: ['Chờ duyệt', 'info'], approved: ['Đã duyệt', 'ok'], rejected: ['Từ chối', 'bad'], cancelled: ['Đã huỷ', 'muted'] };
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dvn = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
const fmt = n => n == null ? '—' : (Math.round(n * 100) / 100).toString().replace('.', ',');
const app = () => $('#app');

let saved = load();             // what stays on the phone: device id, public keys, PIN-wrapped private keys, sequence
let session = null;             // unlocked keys (memory only)
let relay = null, meta = null, idleTimer = null, tab = 'schedule';
const waiting = new Map();      // seq -> {resolve, reject, timer}

function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
function save() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: pairing lasts this tab only */ } }
function wipe() { saved = null; session = null; try { localStorage.removeItem(STORE); } catch { /* ignore */ } relay?.close(); relay = null; }

function status(el, text, kind = '') { el.className = 'note ' + kind; el.textContent = text; el.hidden = !text; }

// ---------------------------------------------------------------- relay
async function ensureRelay() {
  if (!relay) {
    relay = new Relay(CFG.relayUrl, CFG.apikey);
    relay.onstate = s => { const b = $('#net'); if (b) { b.textContent = s === 'online' ? 'Đã kết nối' : 'Mất kết nối'; b.className = 'net ' + s; } };
    relay.on('omp-dev-' + saved.dev, onDeviceMessage);
  }
  await relay.connect(['omp-dev-' + saved.dev, CFG.inbox]);
  return relay;
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
    body.ok ? w.resolve(body.data) : w.reject(new Error(body.error || 'OMP từ chối yêu cầu'));
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

// ---------------------------------------------------------------- pairing
function viewPair(message = '') {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('p') || '';
  if (fromLink) history.replaceState(null, '', location.pathname);       // the code never stays in the history
  app().innerHTML = `<main class="card narrow">
    <img src="img/omp-mark.svg" width="44" height="44" alt="">
    <h1>Kết nối với OMP</h1>
    <p class="muted">Trong OMP (mạng nội bộ) mở <b>Hồ sơ của tôi › Điện thoại</b> và bấm <b>Tạo mã kết nối</b>. Mã dùng một lần, hết hạn sau 10 phút.</p>
    <form id="pf" novalidate>
      <label class="field"><span>Mã kết nối</span><input id="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" value="${esc(fromLink)}" required></label>
      <label class="field"><span>Tên thiết bị</span><input id="label" maxlength="40" value="${esc(guessLabel())}"></label>
      <label class="field"><span>Đặt mã PIN (6 số) để mở ứng dụng</span><input id="pin1" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" pattern="[0-9]{6}" required></label>
      <label class="field"><span>Nhập lại mã PIN</span><input id="pin2" inputmode="numeric" type="password" autocomplete="new-password" maxlength="6" required></label>
      <p class="note" id="pmsg" role="status" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn primary wide" id="pbtn">Kết nối thiết bị</button>
    </form>
    <p class="fine">Dữ liệu OT và ca được mã hoá đầu-cuối giữa điện thoại này và máy chủ OMP. Máy chủ trung chuyển trên internet không đọc được và không lưu.</p>
  </main>`;
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const code = E.normalizeCode($('#code').value), label = $('#label').value.trim().slice(0, 40), p1 = $('#pin1').value, p2 = $('#pin2').value, msg = $('#pmsg');
    if (code.length !== 12) return status(msg, 'Mã kết nối gồm 12 ký tự (ví dụ ABCD-EFGH-JKLM).', 'bad');
    if (!/^[0-9]{6}$/.test(p1)) return status(msg, 'Mã PIN gồm đúng 6 chữ số.', 'bad');
    if (p1 !== p2) return status(msg, 'Hai lần nhập mã PIN chưa khớp.', 'bad');
    const btn = $('#pbtn'); btn.disabled = true; btn.textContent = 'Đang kết nối…';
    try {
      await pair(code, label, p1);
      await afterUnlock();
    } catch (err) {
      wipe();
      btn.disabled = false; btn.textContent = 'Kết nối thiết bị';
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
  app().innerHTML = `<main class="card narrow">
    <img src="img/omp-mark.svg" width="44" height="44" alt="">
    <h1>Mở OMP Remote</h1>
    <p class="muted">${esc(saved.label || 'Thiết bị này')} đã kết nối với OMP.</p>
    <form id="uf" novalidate>
      <label class="field"><span>Mã PIN</span><input id="pin" inputmode="numeric" type="password" autocomplete="current-password" maxlength="6" required autofocus></label>
      <p class="note bad" id="umsg" role="status" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn primary wide">Mở khoá</button>
    </form>
    <button class="btn link" id="forget" type="button">Gỡ kết nối khỏi máy này</button>
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
      if (saved.fails >= MAX_PIN_FAILS) { wipe(); return viewPair('Nhập sai mã PIN quá nhiều lần nên kết nối đã bị xoá. Tạo mã kết nối mới trong OMP.'); }
      status($('#umsg'), `Mã PIN không đúng. Còn ${MAX_PIN_FAILS - saved.fails} lần thử.`, 'bad');
    }
  };
  $('#forget').onclick = () => { if (confirm('Gỡ kết nối OMP khỏi máy này? Muốn dùng lại phải tạo mã kết nối mới.')) { wipe(); viewPair(); } };
}

function lock() { session = null; meta = null; waiting.forEach(w => clearTimeout(w.timer)); waiting.clear(); if (saved?.wrapped) viewUnlock(); }
function touch() { clearTimeout(idleTimer); if (session) idleTimer = setTimeout(lock, IDLE_MS); }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, touch, { passive: true }));

async function afterUnlock() {
  touch();
  app().innerHTML = '<main class="card"><p class="muted">Đang tải dữ liệu từ OMP…</p></main>';
  try {
    const [me, m] = await Promise.all([ask('me'), ask('meta')]);
    meta = { ...m, me };
    viewHome();
  } catch (err) {
    app().innerHTML = `<main class="card narrow"><h1>Chưa kết nối được OMP</h1><p class="note bad">${esc(err.message)}</p><button class="btn primary wide" id="retry">Thử lại</button><button class="btn link" id="lockb">Khoá</button></main>`;
    $('#retry').onclick = afterUnlock; $('#lockb').onclick = lock;
  }
}

// ---------------------------------------------------------------- home
const TABS = [['schedule', 'Lịch'], ['ot', 'Đăng ký OT'], ['shift', 'Đổi ca'], ['mine', 'Đơn của tôi']];
function viewHome() {
  app().innerHTML = `<header class="top"><div><b>${esc(meta.me.name)}</b><small>${esc(meta.me.emp_id)}</small></div>
      <span class="net online" id="net">Đã kết nối</span><button class="btn small" id="lockb" type="button">Khoá</button></header>
    <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</nav>
    <main id="view" class="card"></main>`;
  $('#lockb').onclick = lock;
  app().querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; viewHome(); });
  ({ schedule: viewSchedule, ot: viewOt, shift: viewShift, mine: viewMine })[tab]($('#view'));
}

async function viewSchedule(el) {
  el.innerHTML = '<p class="muted">Đang tải lịch…</p>';
  try {
    const s = await ask('schedule');
    el.innerHTML = `<h2>Lịch 14 ngày</h2><ul class="days">${s.days.map(d => {
      const pend = (d.pending || []).map(p => `<span class="tag info">Chờ duyệt: ${p.kind === 'ot' ? fmt(p.hours) + 'h OT' : esc(p.leave || p.shift)}</span>`).join('');
      const act = d.actual?.hours != null ? `<span>Actual ${fmt(d.actual.hours)}h</span>` : '';
      return `<li class="${d.day === s.today ? 'today' : ''}"><div class="dd"><b>${dvn(d.day)}</b><small>${esc(d.weekday)}</small></div>
        <div class="dc"><span class="shift">${esc(d.leave || d.shift || '—')}</span>${d.plan != null ? `<span>OT ${fmt(d.plan)}h</span>` : ''}${act}${pend}</div></li>`;
    }).join('')}</ul>`;
  } catch (err) { el.innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
}

function dayInput(id) {
  const t = meta.today;
  return `<label class="field"><span>Ngày</span><input id="${id}" type="date" min="${t}" value="${t}" required></label>`;
}

function issuesHtml(res) {
  const row = res?.rows?.[0];
  if (!row) return '';
  const items = (row.issues || []).map(i => `<li class="${i.level === 'error' ? 'bad' : 'warn'}">${esc(i.text)}</li>`).join('');
  return row.ok ? (items ? `<ul class="issues">${items}</ul>` : '<p class="note ok">Hợp lệ, có thể gửi.</p>') : `<ul class="issues">${items || '<li class="bad">Không hợp lệ</li>'}</ul>`;
}

function regForm(el, kind) {
  const ot = kind === 'ot';
  el.innerHTML = `<h2>${ot ? 'Đăng ký tăng ca' : 'Đổi ca / ngày OFF'}</h2><form id="rf" novalidate>
    ${dayInput('day')}
    ${ot ? `<label class="field"><span>Số giờ OT</span><input id="hours" type="number" inputmode="decimal" min="0.5" max="12" step="0.5" value="2" required></label>
      <label class="field"><span>Lý do</span><select id="reason">${meta.reasons.map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select></label>`
    : `<label class="field"><span>Ca muốn đăng ký</span><select id="shift">${meta.off_code ? `<option value="@off">Ngày OFF</option>` : ''}${meta.shifts.filter(s => s.normal_hours).map(s => `<option value="${esc(s.code)}">${esc(s.code)} · ${esc(s.start)}–${esc(s.end)}</option>`).join('')}</select></label>`}
    <label class="field"><span>Ghi chú (không bắt buộc)</span><input id="note" maxlength="200"></label>
    <div id="chk" aria-live="polite"></div>
    <button class="btn primary wide" id="send">Gửi đăng ký</button></form><div id="res" aria-live="polite"></div>`;
  const body = () => {
    const it = { day: $('#day').value };
    if (ot) it.hours = Number($('#hours').value);
    else { const v = $('#shift').value; if (v === '@off') it.leave = meta.off_code; else it.shift = v; }
    return { kind, items: [it], reason_code: ot ? $('#reason').value : '', note: $('#note').value.trim() };
  };
  let seq = 0;
  const check = async () => {
    const mine = ++seq;
    $('#chk').innerHTML = '<p class="muted">Đang kiểm tra theo quy tắc của OMP…</p>';
    try { const r = await ask('check', body()); if (mine === seq) $('#chk').innerHTML = issuesHtml(r); }
    catch (err) { if (mine === seq) $('#chk').innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
  };
  el.querySelectorAll('input,select').forEach(i => i.addEventListener('change', check));
  check();
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Đang gửi…';
    try {
      const r = await ask('submit', body());
      $('#res').innerHTML = r.done ? `<p class="note ok">Đã gửi ${r.done} đơn. Theo dõi ở tab “Đơn của tôi”.</p>` : `<p class="note bad">Chưa gửi được: ${esc((r.skipped || []).join('; '))}</p>`;
      if (r.done) $('#rf').reset();
    } catch (err) { $('#res').innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
    btn.disabled = false; btn.textContent = 'Gửi đăng ký';
  };
}
const viewOt = el => regForm(el, 'ot');
const viewShift = el => regForm(el, 'shift');

let mineKind = 'ot';
async function viewMine(el) {
  el.innerHTML = `<h2>Đơn của tôi</h2><div class="seg"><button type="button" data-k="ot" aria-pressed="${mineKind === 'ot'}">OT</button><button type="button" data-k="shift" aria-pressed="${mineKind === 'shift'}">Ca / OFF</button></div><div id="list"><p class="muted">Đang tải…</p></div>`;
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { mineKind = b.dataset.k; viewMine(el); });
  try {
    const { rows } = await ask('list', { kind: mineKind });
    $('#list').innerHTML = rows.length ? `<ul class="regs">${rows.map(r => {
      const [label, cls] = STATUS[r.status] || [r.status, 'muted'];
      const what = r.kind === 'ot' ? `${fmt(r.hours)}h OT${r.reason ? ' · ' + esc(r.reason) : ''}` : esc(r.leave_name || r.leave || r.shift);
      return `<li><div><b>${dvn(r.day)}</b> <small>${esc(r.weekday)}</small><div>${what}</div>${r.decide_note ? `<small class="muted">${esc(r.decide_note)}</small>` : ''}</div>
        <div class="right"><span class="tag ${cls}">${label}</span>${r.status === 'pending' ? `<button class="btn small" data-cancel="${r.reg_id}" type="button">Huỷ</button>` : ''}</div></li>`;
    }).join('')}</ul>` : '<p class="muted">Chưa có đơn nào.</p>';
    el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Huỷ đơn này?')) return;
      b.disabled = true;
      try { await ask('cancel', { ids: [Number(b.dataset.cancel)] }); viewMine(el); } catch (err) { alert(err.message); b.disabled = false; }
    });
  } catch (err) { $('#list').innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
}

// ---------------------------------------------------------------- start
if (!CFG.relayUrl || !CFG.inbox) {
  app().innerHTML = '<main class="card narrow"><h1>Chưa cấu hình</h1><p class="note bad">Thiếu config.js. Quản trị OMP chạy <code>python run.py --remote-init …</code> rồi deploy lại.</p></main>';
} else if (saved?.wrapped && saved.ckx) viewUnlock(); else { wipe(); viewPair(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
