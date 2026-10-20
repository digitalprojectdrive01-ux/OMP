// OMP Remote envelope crypto (protocol v1) — mirrors backend/remote/crypto.py byte for byte.
// ECDH P-256 + HKDF-SHA256 + AES-256-GCM per message (fresh ephemeral key), ECDSA P-256 signatures (raw r||s).
const te = new TextEncoder(), td = new TextDecoder();
const S = crypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' }, DSA = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64d = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

/** Canonical JSON: keys sorted at every level, no spaces — the same rule as crypto.py canon(). */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const normalizeCode = c => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
// v0.2: 6-digit check code the OMP administrator types to confirm this phone (same formula as backend/remote/store.verify_code)
export async function verifyCode(dev, dkx, dsig) {
  const h = new Uint8Array(await S.digest('SHA-256', te.encode(`verify1|${dev}|${dkx}|${dsig}`)));
  let n = 0n;
  for (const b of h.slice(0, 8)) n = (n << 8n) | BigInt(b);
  const v = String(n % 1000000n).padStart(6, '0');
  return v.slice(0, 3) + ' ' + v.slice(3);
}
export const inviteId = async code => hex(await S.digest('SHA-256', te.encode('inv|' + normalizeCode(code)))).slice(0, 16);

export async function mac(code, ...parts) {
  const k = await S.importKey('raw', te.encode(normalizeCode(code)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64e(await S.sign('HMAC', k, te.encode(parts.join('|'))));
}

export async function genDeviceKeys() {
  return { kx: await S.generateKey(EC, true, ['deriveBits']), sig: await S.generateKey(DSA, true, ['sign', 'verify']) };
}
export const rawPub = async pub => b64e(await S.exportKey('raw', pub));
export const kxPub = b64 => S.importKey('raw', b64d(b64), EC, true, []);
export const sigPub = b64 => S.importKey('raw', b64d(b64), DSA, true, ['verify']);
export const exportPriv = async key => b64e(await S.exportKey('pkcs8', key));
export const importKxPriv = b64 => S.importKey('pkcs8', b64d(b64), EC, false, ['deriveBits']);
export const importSigPriv = b64 => S.importKey('pkcs8', b64d(b64), DSA, false, ['sign']);

async function aesKey(shared, salt, dir) {
  const base = await S.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('omp-remote v1 ' + dir) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** header: {dev, seq, ts}; recipient: ECDH public CryptoKey; signer: ECDSA private CryptoKey. */
export async function seal(header, body, recipient, signer, dir) {
  const eph = await S.generateKey(EC, true, ['deriveBits']);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const h = { ...header, v: 1, epk: await rawPub(eph.publicKey), salt: b64e(salt) };
  const aad = te.encode(canon(h));
  const shared = await S.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await aesKey(shared, salt, dir), te.encode(canon(body))));
  const sig = await S.sign(SIGN, signer, cat(aad, iv, ct));
  return { ...h, iv: b64e(iv), ct: b64e(ct), sig: b64e(sig) };
}

/** Verifies the sender's signature, then decrypts. Throws on any problem. */
export async function open(env, kxPriv, senderSig, dir) {
  if (!env || env.v !== 1) throw new Error('Phiên bản gói tin không hỗ trợ');
  const { iv, ct, sig, ...h } = env;
  const aad = te.encode(canon(h)), ivb = b64d(iv), ctb = b64d(ct);
  if (!(await S.verify(SIGN, senderSig, b64d(sig), cat(aad, ivb, ctb)))) throw new Error('Chữ ký máy chủ không hợp lệ');
  const shared = await S.deriveBits({ name: 'ECDH', public: await kxPub(h.epk) }, kxPriv, 256);
  const plain = await S.decrypt({ name: 'AES-GCM', iv: ivb, additionalData: aad }, await aesKey(shared, b64d(h.salt), dir), ctb);
  return { header: h, body: JSON.parse(td.decode(plain)) };
}

// ---------------------------------------------------------------- PIN wrapping of the device keys (stored locally)
const PBKDF2_ITER = 310000;
async function pinKey(pin, salt) {
  const base = await S.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrap(secretObj, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await S.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), te.encode(JSON.stringify(secretObj)));
  return { salt: b64e(salt), iv: b64e(iv), ct: b64e(ct), iter: PBKDF2_ITER };
}
export async function unwrap(w, pin) {
  const plain = await S.decrypt({ name: 'AES-GCM', iv: b64d(w.iv) }, await pinKey(pin, b64d(w.salt)), b64d(w.ct));   // wrong PIN → throws
  return JSON.parse(td.decode(plain));
}
