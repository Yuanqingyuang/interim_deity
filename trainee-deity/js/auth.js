// 实习神明 · 本地多用户 + 密码（PBKDF2；非安全边界，仅本机）
const USERS_KEY = 'td/users';
const SESSION_KEY = 'td/session';
const KDF_ITER = 120000;
const KDF_ALGO = 'PBKDF2-SHA256';
const KDF_SHA256 = 'sha256';          // 旧档标签
const KDF_FALLBACK = 'FNV-1a-weak';   // C-02：非安全上下文的弱兜底，如实标注，绝不冒充强哈希
const MIN_PW_LEN = 8;                 // G-03：注册密码最小长度（登录不校验，兼容既有账号）

function loadUsers(){
  try{ return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); }catch{ return {}; }
}
function saveUsers(u){ localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

function hasSubtle(){ return !!globalThis.crypto?.subtle; }

// G-11：会话只写 sessionStorage（同标签页刷新仍保持登录，新标签/重开浏览器需重新登录）
function loadSession(){
  try{
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    // 清理历史版本残留的持久会话，避免旧双写数据继续自动登录
    if(localStorage.getItem(SESSION_KEY) != null) localStorage.removeItem(SESSION_KEY);
    return s;
  }catch{ return null; }
}
function saveSession(s){
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function getUser(){ return loadSession(); }
export function getUsername(){ return (loadSession()?.username) || null; }

function hex(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** 弱兜底哈希（FNV-1a 32 位）。仅在无 crypto.subtle 的环境使用，kdf 标签如实记录。 */
function fnvFallback(data){
  let h = 2166136261;
  for(const b of data){ h ^= b; h = Math.imul(h, 16777619); }
  return (h>>>0).toString(16) + data.length;
}

/** R11：kdf = 'PBKDF2-SHA256' | 'sha256'（旧档） | 'FNV-1a-weak'（非安全上下文兜底） */
async function hashPw(password, salt, kdf = KDF_ALGO){
  const data = new TextEncoder().encode(`${salt}|${password}`);
  if(kdf === KDF_FALLBACK) return 'fnv:' + fnvFallback(data);
  if(kdf === KDF_SHA256){
    if(hasSubtle()) return hex(await crypto.subtle.digest('SHA-256', data));
    // 兼容旧行为：早期版本在非安全上下文用 sha256 标签写入的其实是无前缀 FNV 值
    return fnvFallback(data);
  }
  if(hasSubtle()){
    const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: KDF_ITER },
      key, 256
    );
    return hex(bits);
  }
  return 'fnv:' + fnvFallback(data);
}

// G-02：盐必须来自 CSPRNG；无 getRandomValues 的环境直接拒绝注册，不再退化到 Math.random
function makeSalt(){
  if(!globalThis.crypto?.getRandomValues) throw new Error('当前环境缺少安全随机源，无法注册');
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function register(username, password){
  const name = (username||'').trim();
  if(name.length < 2 || name.length > 24) throw new Error('昵称需 2–24 字符');
  if((password||'').length < MIN_PW_LEN) throw new Error(`密码至少 ${MIN_PW_LEN} 位`);
  const users = loadUsers();
  const key = name.toLowerCase();
  if(users[key]) throw new Error('该昵称已存在');
  const salt = makeSalt();
  const kdf = hasSubtle() ? KDF_ALGO : KDF_FALLBACK;
  if(kdf === KDF_FALLBACK){
    console.warn('[auth] 非安全上下文（无 crypto.subtle），密码哈希退化为 FNV-1a 弱算法，仅适用于本机娱乐场景');
  }
  const hash = await hashPw(password, salt, kdf);
  users[key] = { username: name, salt, hash, kdf, createdAt: Date.now() };
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
  const kdf = u.kdf || KDF_SHA256;
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
