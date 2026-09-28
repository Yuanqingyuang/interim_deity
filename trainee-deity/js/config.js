// 实习神明 · 全局常量与时代参数
// 无边界区块世界 + 日照 + 自动建造

// A-05：版本标识（构建物/控制台/关于栏统一从此处取值，发版时只改这一行）
export const APP_VERSION = '1.1.0';

export const TILE = 1.0;
export const MAXH = 9;
export const MINH = 0.2;
export const WATER_LEVEL = 0.75;

// A-02：原散落在 main.js / render.js 的关键玩法常量收口于此
export const AUTOSAVE_SEC = 180;        // 自动存档间隔（秒）
export const EXIT_SAVE_MIN_MS = 15000;  // 离场同步写档节流窗口（毫秒）
export const MAX_BUILD_MESH = 420;      // 建筑网格视觉上限（超出后抽样代表格）

// ---- 无边界区块 ----
export const CHUNK = 10;
export const START_CHUNKS = 4;     // 开局 4×4 块（以原点为中心）

export const WILD = 18;
export const FOG_NEAR = 48;
export const FOG_FAR = 100;

export const ERAS = [
  { name:'蛮荒时代', roman:'I',  popTarget:200,     starCost:3, popGoal:200 },
  { name:'城邦时代', roman:'II', popTarget:2000,    starCost:3, popGoal:2000 },
  { name:'封建时代', roman:'III',popTarget:8000,    starCost:3, popGoal:8000 },
  { name:'工业时代', roman:'IV', popTarget:20000,   starCost:3, popGoal:20000 },
  { name:'星际时代', roman:'V',  popTarget:100000,  starCost:3, popGoal:100000 },
];

// R5：星星仅由里程碑触发（每时代 3 个，一次性）。禁止纯 faithRate 时间出星。
// check(G, ctx) — ctx: { farms, inds, churches, houses }（已建成 built 计数，与 tick 一致）
export const MILESTONES = [
  [
    { id: 'e1pop',  label: '人口≥50',   check: (G) => G.pop >= 50 },
    { id: 'e1farm', label: '农田≥10',   check: (G, c) => c.farms >= 10 },
    { id: 'e1chr',  label: '教堂≥1',    check: (G, c) => c.churches >= 1 },
  ],
  // 奇迹里程碑必须指向「本时代可建」的奇迹（startWonderPlacement 取 WONDERS[G.era]，
  // eraReady 亦要求 wonders[G.era]）；若指向上一时代的奇迹则本时代无法建造，
  // 该里程碑永远无法达成 → 星星恒缺 1 → 时代进阶硬锁死。
  [
    { id: 'e2pop',  label: '人口≥400',  check: (G) => G.pop >= 400 },
    { id: 'e2ind',  label: '工业≥8',    check: (G, c) => c.inds >= 8 },
    { id: 'e2won',  label: '金字塔完成', check: (G) => !!G.wonders[1] },
  ],
  [
    { id: 'e3pop',  label: '人口≥5000', check: (G) => G.pop >= 5000 },
    { id: 'e3farm', label: '农田≥80',   check: (G, c) => c.farms >= 80 },
    { id: 'e3won',  label: '大教堂完成', check: (G) => !!G.wonders[2] },
  ],
  [
    { id: 'e4pop',  label: '人口≥1万', check: (G) => G.pop >= 10000 },
    { id: 'e4ind',  label: '工业≥200',  check: (G, c) => c.inds >= 200 },
    { id: 'e4won',  label: '摩天塔完成', check: (G) => !!G.wonders[3] },
  ],
  [
    { id: 'e5pop',  label: '人口≥5万', check: (G) => G.pop >= 50000 },
    { id: 'e5ind',  label: '工业≥500',    check: (G, c) => c.inds >= 500 },
    { id: 'e5won',  label: '太空电梯完成', check: (G) => !!G.wonders[4] },
  ],
];

export const powerMaxOf = (era)=> 100 + era*60;
export const powerRegenOf = (faithRate)=> 2.5 + Math.min(10, faithRate*0.02);

export const AUTO = {
  interval: 20,
  housingPressure: 0.85,
  faithPressure: 0.4,
  maxPerTick: 4,
  industryPerTick: 2,
};

// 日照：一天 150 秒
export const DAY_LENGTH = 150;
// 0=午夜 0.25=日出 0.5=正午 0.75=日落
export const SUN_KEYS = [
  { t:0.00, elev:0.14, azim:0.55, sun:0x8a9acc, amb:0x4a5578, inten:0.90, hemi:0.62 },
  { t:0.22, elev:0.18, azim:0.70, sun:0xff9a5c, amb:0x7a6550, inten:0.95, hemi:0.68 },
  { t:0.30, elev:0.55, azim:0.85, sun:0xffd29a, amb:0x8a9aaa, inten:1.05, hemi:0.70 },
  { t:0.50, elev:1.00, azim:1.20, sun:0xfff2c8, amb:0xa8b8c8, inten:1.35, hemi:0.95 },
  { t:0.70, elev:0.55, azim:1.55, sun:0xffc080, amb:0x8a7a60, inten:1.05, hemi:0.70 },
  { t:0.78, elev:0.22, azim:1.70, sun:0xff7a4a, amb:0x6a5548, inten:0.95, hemi:0.66 },
  { t:0.90, elev:0.12, azim:1.85, sun:0x7a8aba, amb:0x4a5570, inten:0.82, hemi:0.58 },
  { t:1.00, elev:0.14, azim:0.55, sun:0x8a9acc, amb:0x4a5578, inten:0.90, hemi:0.62 },
];

export const TOOLS = {
  // R4：强度系数 ~50%（原 3.4 → 1.7），可塑但不瞬间改天
  // 再降一档：约原稿 3.4 的 26%
  raise: { cost:6, radius:1.8, kind:'terrain', strength:0.9 },
  lower: { cost:6, radius:1.8, kind:'terrain', strength:0.9 },
  flatten: { cost:8, radius:2.2, kind:'terrain', strength:1.1 },
  water: { cost:8, radius:1.8, kind:'terrain' },
  tree:  { cost:5, radius:1.8, kind:'terrain' },
  z_res: { cost:4, radius:1.3, kind:'zone', zone:1 },
  z_agr: { cost:4, radius:1.3, kind:'zone', zone:2 },
  z_ind: { cost:4, radius:1.3, kind:'zone', zone:3 },
  z_fai: { cost:4, radius:1.3, kind:'zone', zone:4 },
  demolish: { cost:1, radius:1.2, kind:'demolish' },
};

export const MIRACLES = {
  grow:  { cost:30, dur:15, field:'boostGrow',  label:'丰收祝福' },
  build: { cost:40, dur:8,  field:'boostBuild', label:'加速建造' },
  rain:  { cost:25, dur:12, field:'boostRain',  label:'天降甘霖' },
};

// ---- 信仰：按时代归一 ----
// 原始公式「教堂×K_CHURCH + 人口×K_FAITH_POP」两项都线性于人口，
// 而人口每时代涨 10~1000 倍、奇迹消耗只涨约 10 倍 → 后期信仰「秒出」，经济失效。
// 现在改为按时代给出基准产出，人口与教堂只决定「时代内的相对进度」。
export const FAITH_ERA_BASE = [15, 150, 1500, 15000, 150000];  // 各时代满规模时的信仰/秒（每时代 ×10）
export const FAITH_FILL_SEC = 100;                              // 满规模下攒满本时代奇迹所需秒数
// 阻尼系数 = 基准产出 ÷ 原始产出（刚需教堂 0.05×人口 → 原始产出 0.2×人口）
export const FAITH_ERA_DAMP = FAITH_ERA_BASE.map((b, i)=> b / (0.2 * ERAS[i].popGoal));
// 奇迹信仰消耗由「基准产出 × 目标秒数」推导，保证每个时代攒满所需时间一致
export const faithCostOf = (E)=> FAITH_ERA_BASE[E] * FAITH_FILL_SEC;

// 信仰库存上限：信仰只有奇迹一个出口，若不设上限会跨时代无限囤积
// （实测：城邦时代囤到 2300 万，而奇迹只要 1.5 万 → 建成瞬间、信仰经济失效）。
// 上限取本时代奇迹花费的 2 倍：跨时代最多预存「上一时代上限」（= 本时代的 20%），
// 仍需约 FAITH_FILL_SEC 秒才能攒满，使「攒信仰→建奇迹」的节奏在每个时代都成立。
export const FAITH_CAP_MULT = 2;
export const faithCapOf = (E)=>{
  const i = Math.max(0, Math.min(FAITH_ERA_BASE.length - 1, E|0));
  return faithCostOf(i) * FAITH_CAP_MULT;
};

export const WONDERS = [
  { name:'巨石阵',   faithCost:faithCostOf(0), time:18, bonus:'全时代信仰+10%' },
  { name:'金字塔',   faithCost:faithCostOf(1), time:24, bonus:'人口容量+20%' },
  { name:'大教堂',   faithCost:faithCostOf(2), time:30, bonus:'信仰产出+30%' },
  { name:'摩天塔',   faithCost:faithCostOf(3), time:36, bonus:'人口容量+50%' },
  { name:'太空电梯', faithCost:faithCostOf(4), time:45, bonus:'通关' },
];

// 晨光清新调色（地形 + 天空基线，日照系统会在此基础上叠加日夜）
export const PALETTES = [
  { grass:0x6bd032, grass2:0x49a324, sand:0xfcd88f, rock:0x9e8b79, snow:0xffffff,
    water:0x3d7a6a, deep:0x2a5c50, tree:0x48bc21,
    sky0:0x3491e4, sky1:0x95d5f2, sky2:0xfff5e0, glow:0xffde9b, glowA:0.40,
    sun:0xfff2c8, fog:0xffeec8, nightSky0:0x1a2448, nightSky1:0x2a3860, nightSky2:0x3a4870 },
  { grass:0x72d439, grass2:0x4faf27, sand:0xfddc97, rock:0xa2907d, snow:0xffffff,
    water:0x3a8070, deep:0x286058, tree:0x4fc228,
    sky0:0x2187de, sky1:0x8addfa, sky2:0xfff8e9, glow:0xffe5a1, glowA:0.45,
    sun:0xfff4d0, fog:0xfff0d0, nightSky0:0x182040, nightSky1:0x283858, nightSky2:0x384868 },
  { grass:0x6dcc35, grass2:0x4ba523, sand:0xfad68a, rock:0x9c8976, snow:0xffffff,
    water:0x407d6c, deep:0x2c5e52, tree:0x4bb824,
    sky0:0x3380cc, sky1:0xa0d8e9, sky2:0xffefce, glow:0xffd47d, glowA:0.45,
    sun:0xffeec0, fog:0xffe8b8, nightSky0:0x1c2848, nightSky1:0x2c3c58, nightSky2:0x3c4c70 },
  { grass:0x66c730, grass2:0x479c21, sand:0xf6d287, rock:0x978476, snow:0xfcfcfc,
    water:0x3e7568, deep:0x2a564c, tree:0x47b424,
    sky0:0x4089c2, sky1:0xa1d0e1, sky2:0xfff8e9, glow:0xffe6b3, glowA:0.35,
    sun:0xfff0d0, fog:0xfff0d0, nightSky0:0x202838, nightSky1:0x304050, nightSky2:0x405060 },
  { grass:0x62dba4, grass2:0x38af77, sand:0xf1e19e, rock:0x8b92ad, snow:0xf4faff,
    water:0x4a7f8c, deep:0x325a68, tree:0x35cc93,
    sky0:0x536dca, sky1:0x9eaff1, sky2:0xffeef2, glow:0xd9ceff, glowA:0.35,
    sun:0xf0f4ff, fog:0xe8ecff, nightSky0:0x141830, nightSky1:0x202848, nightSky2:0x2c3458 },
];

export const BUILDING_STYLE = [
  { wall:0xd58b42, side:0x9f632c, roof:0xe5aa56, h:0.9, deco:'thatch',  decoCol:0xd49e4a },
  { wall:0xe38b4a, side:0xb1652d, roof:0xf4ad63, h:1.2, deco:'pitched', decoCol:0x000000 },
  { wall:0xd1cab9, side:0x9e9786, roof:0xcb411e, h:1.4, deco:'spire',   decoCol:0xcb411e, glow:0xffe48c, glowA:0.95 },
  { wall:0x9da8ba, side:0x6d798e, roof:0x55616e, h:2.2, deco:'factory', decoCol:0x675644, window:0xffe08c, windowA:0.85 },
  { wall:0x6ad1ec, side:0x2e9dc2, roof:0xf2fbff, h:1.7, deco:'dome',    decoCol:0xf2fbff, glow:0x40a8cc, glowA:0.55 },
];

// 信仰区：现实教堂色调（奶油石墙 + 深石板尖顶 + 金饰）
export const CHURCH_STYLE = {
  wall: 0xf3ece1,
  side: 0xd6cdbd,
  roof: 0x45525e,
  roofDeep: 0x38434d,
  accent: 0xc9a227,
  stone: 0xb7aea0,
  window: 0x8ec8e0,
  glow: 0xffe08c,
};

// 工业区：厂房 / 仓库（混凝土灰 + 砖红 + 金属构件）
export const FACTORY_STYLE = {
  wall: 0x8b949e,
  side: 0x6e7882,
  roof: 0x555e68,
  brick: 0x7a5c4e,
  metal: 0x4a5560,
  window: 0xffe08c,
  smoke: 0xb0b8c0,
};

// 农田作物色（随时代微变）
export const FARM_CROP = [
  [0x6fbe3a, 0x8bc34a, 0x9ccc65],
  [0x7cb342, 0x9ccc65, 0xaed581],
  [0x8bc34a, 0xa5d6a7, 0xc5e1a5],
  [0x9e9d24, 0xc0ca33, 0xd4e157],
  [0x00bfa5, 0x64ffda, 0xa7ffeb],
];
export const FARM_SOIL = [0x8b6914, 0x7a5c2e, 0x6d4c41, 0x5d4037, 0x37474f];

/** 教堂：基色 + 时代叠色 */
export function churchStyleForEra(era){
  const e = Math.max(0, Math.min(4, era|0));
  const tints = [
    { wall:0xf3ece1, roof:0x45525e, accent:0xc9a227 },
    { wall:0xefe6d4, roof:0x3d4a56, accent:0xd4af37 },
    { wall:0xe8e0d0, roof:0x35414c, accent:0xe0c060 },
    { wall:0xdde5ec, roof:0x2f3a48, accent:0x90a4ae },
    { wall:0xd0e8ff, roof:0x1a237e, accent:0x80cbc4 },
  ];
  const tint = tints[e];
  return {
    ...CHURCH_STYLE,
    wall: tint.wall, roof: tint.roof, accent: tint.accent,
    scaleBoost: 1 + e * 0.08,
  };
}

/** 工厂：时代金属/混凝土差分 */
export function factoryStyleForEra(era){
  const e = Math.max(0, Math.min(4, era|0));
  const tints = [
    { wall:0x8b949e, roof:0x555e68, brick:0x7a5c4e },
    { wall:0x78909c, roof:0x455a64, brick:0x6d4c41 },
    { wall:0x607d8b, roof:0x37474f, brick:0x5d4037 },
    { wall:0x546e7a, roof:0x263238, brick:0x4e342e },
    { wall:0x4dd0e1, roof:0x006064, brick:0x37474f, glow:0x00e5ff },
  ];
  const tint = tints[e];
  return { ...FACTORY_STYLE, wall: tint.wall, roof: tint.roof, brick: tint.brick, eraGlow: tint.glow || 0 };
}

export const ZONES = {
  1:{ key:'z_res', name:'居住', color:0xc4a574, hMul:1.0 },
  2:{ key:'z_agr', name:'农田', color:0x8fbc5a, hMul:0.0, noBuilding:true },
  3:{ key:'z_ind', name:'工业', color:0x8a9aa8, hMul:1.15 },
  4:{ key:'z_fai', name:'信仰', color:0xd4b06a, hMul:1.4 },
};

export const FOLKCOL = [0xf4ad68, 0xfbbf79, 0xb1b7f0, 0x788bb0, 0xe0f7ff];
export const FOLK_HEAD = 0xfeead1;

export function hash2(x, y, seed=0){
  let h = (x*374761393 + y*668265263 + seed*1274126177) | 0;
  h = (h ^ (h>>>13)) * 1274126177 | 0;
  h = h ^ (h>>>16);
  return ((h>>>0) & 0xffffff) / 0xffffff;
}

/** 可复现 PRNG（自动建造/自动决策专用；地形生成仍用 valueNoise） */
export function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 自动建造决策 RNG：mulberry32(G.seed + tick + salt) */
export function autoRng(G, salt=0){
  const tick = Math.floor((G.time || 0) * 2);
  return mulberry32((G.seed|0) + tick * 9973 + (salt|0));
}

function smooth(t){ return t*t*(3-2*t); }
export function valueNoise(x, y, seed=0){
  const xi=Math.floor(x), yi=Math.floor(y);
  const xf=x-xi, yf=y-yi;
  const a=hash2(xi,   yi,   seed);
  const b=hash2(xi+1, yi,   seed);
  const c=hash2(xi,   yi+1, seed);
  const d=hash2(xi+1, yi+1, seed);
  const u=smooth(xf), v=smooth(yf);
  return a*(1-u)*(1-v) + b*u*(1-v) + c*(1-u)*v + d*u*v;
}

export function fbm(x, y, octaves=4, seed=0){
  let v=0, amp=1, freq=1, max=0;
  for(let i=0;i<octaves;i++){
    v += amp * valueNoise(x*freq, y*freq, seed+i*17);
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / max;
}

// 线性插值颜色
export function lerpHex(a, b, t){
  const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255;
  const br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
  return ((ar+(br-ar)*t)<<16) | ((ag+(bg-ag)*t)<<8) | (ab+(bb-ab)*t)|0;
}

// 根据 dayTime 采样太阳关键帧
export function sampleSun(dayTime){
  const t = ((dayTime % 1)+1)%1;
  let i=0;
  while(i<SUN_KEYS.length-1 && SUN_KEYS[i+1].t < t) i++;
  const a = SUN_KEYS[i], b = SUN_KEYS[Math.min(i+1, SUN_KEYS.length-1)];
  const span = (b.t - a.t) || 1;
  const k = Math.max(0, Math.min(1, (t - a.t)/span));
  return {
    elev: a.elev + (b.elev-a.elev)*k,
    azim: a.azim + (b.azim-a.azim)*k,
    sun:  lerpHex(a.sun, b.sun, k),
    amb:  lerpHex(a.amb, b.amb, k),
    inten:a.inten + (b.inten-a.inten)*k,
    hemi: a.hemi + (b.hemi-a.hemi)*k,
    day:  Math.max(0, Math.min(1, Math.sin(t*Math.PI*2 - Math.PI/2)*0.5+0.5)),
  };
}
