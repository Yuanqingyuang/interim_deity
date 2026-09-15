// 实习神明 · 日志（压缩代号存储，加载时展开）
// 条目压缩格式：[code, t, x, y]
// code: 1居住 2农田 3工业 4教堂 | 10丰收 11加速 12甘霖 | 20奇迹开工 21奇迹完工
//       30时代进阶 40星星 50读档 60新局 70快存 80保存槽

export const LOG_CODE = {
  1: (x,y,t)=>`子民在 (${x},${y}) 建起一座房屋`,
  2: (x,y,t)=>`子民在 (${x},${y}) 开垦一片农田`,
  3: (x,y,t)=>`子民在 (${x},${y}) 建起工业区`,
  4: (x,y,t)=>`子民在 (${x},${y}) 建起教堂`,
  10: ()=>`施放「丰收祝福」`,
  11: ()=>`施放「加速建造」`,
  12: ()=>`施放「天降甘霖」`,
  20: (x,y,t)=>`开始建造奇迹`,
  21: (x,y,t)=>`奇迹建成`,
  30: ()=>`文明迈入新时代`,
  40: ()=>`凝聚一颗星星`,
  50: ()=>`读取存档`,
  60: ()=>`开启新的试炼`,
  70: ()=>`已快速保存`,
  80: ()=>`已保存到槽位`,
};

const ZONE_CODE = { 1:1, 2:2, 3:3, 4:4 };

export function logInit(){
  return [];
}

/** 写入一条（内存里展开；序列化时再压缩） */
export function logPush(G, code, x, y){
  if(!G.logs) G.logs = [];
  const t = Math.floor(G.time||0);
  G.logs.push({ c: code|0, t, x: x|0, y: y|0 });
  // 内存无上限（用户要求）；过旧可截断防内存膨胀
  if(G.logs.length > 5000) G.logs.splice(0, 1000);
  if(G.autoLog){
    const fn = LOG_CODE[code];
    const text = fn ? fn(x,y,t) : `事件 #${code}`;
    G.autoLog.unshift(text);
    if(G.autoLog.length > 6) G.autoLog.pop();
  }
}

export function logZonePlaced(G, zone, x, y){
  logPush(G, ZONE_CODE[zone] || 0, x, y);
}

/** 压缩为数组 */
export function logEncode(logs){
  if(!logs?.length) return [];
  return logs.map(e => [e.c|0, e.t|0, e.x|0, e.y|0]);
}

/** 从压缩数组展开 */
export function logDecode(arr){
  if(!Array.isArray(arr)) return [];
  return arr.map(a => ({ c: a[0]|0, t: a[1]|0, x: a[2]|0, y: a[3]|0 }));
}

/** 展示用文本列表（最新在前，limit 可选） */
export function logList(logs, limit=0){
  const src = logs || [];
  const slice = limit > 0 ? src.slice(-limit).reverse() : [...src].reverse();
  return slice.map(e => {
    const fn = LOG_CODE[e.c];
    const text = fn ? fn(e.x, e.y, e.t) : `未知事件 #${e.c}`;
    const mm = Math.floor((e.t||0) / 60);
    const ss = Math.floor((e.t||0) % 60);
    const clock = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return { ...e, text, clock };
  });
}
