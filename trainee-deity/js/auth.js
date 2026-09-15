// 实习神明 · 本地多用户 + 密码（PBKDF2；非安全边界，仅本机）
const USERS_KEY = 'td/users';
const SESSION_KEY = 'td/session';
const KDF_ITER = 120000;
const KDF_ALGO = 'PBKDF2-SHA256';

function loadUsers(){
  try{ return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); }catch{ return {}; }
}
function saveUsers(u){ localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

function loadSession(){
  try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }catch{ return null; }
}
function saveSession(s){
  const j = JSON.stringify(s);
  sessionStorage.setItem(SESSION_KEY, j);
  localStorage.setItem(SESSION_KEY, j);
}

export function getUser(){ return loadSession(); }
export function getUsername(){ return (loadSession()?.username) || null; }

function hex(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** R11：kdf = 'PBKDF2-SHA256' | 'sha256'（旧档） */
async function hashPw(password, salt, kdf = KDF_ALGO){
  const data = new TextEncoder().encode(`${salt}|${password}`);
  if(kdf === 'sha256'){
    if(globalThis.crypto?.subtle){
      return hex(await crypto.subtle.digest('SHA-256', data));
    }
    let h = 2166136261;
    for(const b of data){ h ^= b; h = Math.imul(h, 16777619); }
    return (h>>>0).toString(16) + data.length;
  }
  if(globalThis.crypto?.subtle){
    const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: KDF_ITER },
      key, 256
    );
    return hex(bits);
  }
  let h = 2166136261;
  for(const b of data){ h ^= b; h = Math.imul(h, 16777619); }
  return 'fnv:' + (h>>>0).toString(16) + data.length;
}

function makeSalt(){
  const a = new Uint8Array(16);
  if(globalThis.crypto?.getRandomValues) crypto.getRandomValues(a);
  else for(let i=0;i<a.length;i++) a[i] = Math.floor(Math.random()*256);
  return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function register(username, password){
  const name = (username||'').trim();
  if(name.length < 2 || name.length > 24) throw new Error('昵称需 2–24 字符');
  if((password||'').length < 4) throw new Error('密码至少 4 位');
  const users = loadUsers();
  const key = name.toLowerCase();
  if(users[key]) throw new Error('该昵称已存在');
  const salt = makeSalt();
  const hash = await hashPw(password, salt, KDF_ALGO);
  users[key] = { username: name, salt, hash, kdf: KDF_ALGO, createdAt: Date.now() };
  saveUsers(users);
  saveSession({ username: name, key, at: Date.now() });
  return name;
}

export async function login(username, password){
  const name = (username||'').trim();
  const key = name.toLowerCase();
  const users = loadUsers();
  const u = users[key];
  if(!u) throw new Error('用户不存在');
  const kdf = u.kdf || 'sha256';
  const hash = await hashPw(password||'', u.salt, kdf);
  if(hash !== u.hash) throw new Error('密码错误');
  saveSession({ username: u.username, key, at: Date.now() });
  return u.username;
}

export function logout(){
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function hasUsers(){
  return Object.keys(loadUsers()).length > 0;
}

