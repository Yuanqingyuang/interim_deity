// 渲染构建器冒烟测试（rev-1，2026-10）
//
// 目的：render.js 的构造器依赖 WebGL/DOM，Node 下无法直接 import。本测试用最小桩件
// （假 canvas / 假 WebGLRenderer / 假 OrbitControls）把 Renderer 装起来，然后遍历
// 「4 类分区 × 3 变体 × 5 时代」调用 makeBuilding，捕获重构引入的构建期错误。
//
// 覆盖的真实缺陷类型：
//   · 几何键拼写错误或未定义（Mesh 收到 undefined geometry）
//   · 材质键/参数变更导致 _mat 抛错
//   · 形体分派分支遗漏（某时代+某类型不产出任何网格）
//   · 坐标/缩放出现 NaN（会让实例矩阵污染整批渲染）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// ---- 1) 最小 DOM 桩件 ----
function makeCanvasStub(){
  const ctx2d = new Proxy({}, {
    get: (_t, prop)=>{
      if(prop === 'canvas') return { width: 512, height: 256 };
      if(prop === 'createLinearGradient' || prop === 'createRadialGradient')
        return ()=>({ addColorStop(){} });
      if(prop === 'getImageData') return ()=>({ data: new Uint8ClampedArray(4) });
      if(prop === 'measureText') return ()=>({ width: 0 });
      return ()=>{};
    },
    set: ()=>true,
  });
  const el = {
    width: 512, height: 256, style: {}, dataset: {},
    getContext: (kind)=> kind === '2d' ? ctx2d : null,
    addEventListener(){}, removeEventListener(){},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getBoundingClientRect: ()=>({ left:0, top:0, width:1440, height:900 }),
    toDataURL: ()=>'data:,',
    appendChild(){}, removeChild(){}, querySelector: ()=>null, querySelectorAll: ()=>[],
  };
  return el;
}

globalThis.document = {
  createElement: (tag)=> makeCanvasStub(),
  createElementNS: ()=> makeCanvasStub(),
  getElementById: ()=> null,
  querySelector: ()=> null,
  querySelectorAll: ()=> [],
  addEventListener(){}, removeEventListener(){},
  body: { classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} }, appendChild(){} },
  visibilityState: 'visible',
  activeElement: null,
};
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  addEventListener(){}, removeEventListener(){},
  matchMedia: ()=>({ matches:false, addEventListener(){}, removeEventListener(){} }),
};
// Node 18+ 已内置 navigator 且为只读 getter，无需（也不能）覆盖
globalThis.requestAnimationFrame = (cb)=> setTimeout(()=>cb(16), 0);
globalThis.cancelAnimationFrame = (id)=> clearTimeout(id);

// ---- 2) 说明：不 new Renderer() ----
// 构造器还需要 WebGLRenderer / OrbitControls / 场景光照，都需要真实 WebGL 与 DOM。
// render.js 已于 2026-10 把「纯字段 + 共享几何/材质池」拆成 _initState(canvas)，
// 本测试直接调用它，从而拿到与线上完全一致的 _geo / _matCache（而非手抄一份初始化）。

// ---- 3) 载入 render.js（three 由 node_modules 垫片解析到仓库内 vendor）----
const { Renderer } = await import('../js/render.js');

// 用真实的 _initState 初始化：与线上构造器完全同一份字段初始化 + 共享几何/材质池。
// 不 new Renderer() 的原因：构造器还要 WebGLRenderer / OrbitControls / 场景光照，都需要真实 WebGL。
const R = Object.create(Renderer.prototype);
R._initState(makeCanvasStub());

assert(R._geo && Object.keys(R._geo).length > 40, `_buildGeo 产出 ${Object.keys(R._geo).length} 个几何`);
assert(R._matCache instanceof Map, '_matCache 已初始化');

// ---- 4) 遍历 4 类分区 × 3 变体 × 5 时代 ----
const zoneList = [1, 2, 3, 4];   // 居住/农田/工业/信仰
let built = 0, totalMeshes = 0;
const perEra = [];
for(let era=0; era<5; era++){
  let eraMeshes = 0, eraGroups = 0;
  for(const zone of zoneList){
    for(let variant=0; variant<3; variant++){
      const t = { zone, variant, _wx: 3.5, _wy: 1.2, _wz: -2.25, built: true, prog: 1 };
      let grp;
      try{
        grp = R.makeBuilding(t, era);
      }catch(e){
        throw new Error(`makeBuilding 抛错 era=${era} zone=${zone} varn=${variant}: ${e.message}`);
      }
      assert(grp && grp.isGroup !== false, `era${era+1} zone${zone} varn${variant} 返回 Group`);
      const meshes = grp.children.filter(o=>o.isMesh);
      assert(meshes.length > 0, `era${era+1} zone${zone} varn${variant} 至少 1 个 Mesh（实际 ${meshes.length}）`);
      // 几何必须全部有定义（undefined 会在真实渲染时报错）
      for(const m of meshes){
        assert(!!m.geometry, `era${era+1} zone${zone} varn${variant} 的 Mesh 几何已定义`);
        assert(m.material !== undefined, `era${era+1} zone${zone} varn${variant} 的 Mesh 材质已定义`);
      }
      // 坐标与缩放不得为 NaN（NaN 会污染实例矩阵、整批渲染异常）
      for(const m of meshes){
        const vals = [m.position.x, m.position.y, m.position.z, m.scale.x, m.scale.y, m.scale.z];
        assert(vals.every(Number.isFinite), `era${era+1} zone${zone} varn${variant} 坐标与缩放有限`);
      }
      eraMeshes += meshes.length; eraGroups++; built++;
    }
  }
  perEra.push({ era: era+1, groups: eraGroups, meshes: eraMeshes });
  totalMeshes += eraMeshes;
}
console.log('');
console.log(`${'时代'.padEnd(6)}${'组数'.padStart(6)}${'网格数'.padStart(8)}${'单栋均值'.padStart(10)}`);
for(const r of perEra){
  console.log(`E${r.era}${' '.repeat(5)}${String(r.groups).padStart(6)}${String(r.meshes).padStart(8)}${(r.meshes/r.groups).toFixed(1).padStart(10)}`);
}
console.log('');
assert(built === 60, `共构建 ${built} 组（4 类 × 3 变体 × 5 时代 = 60）`);

// ---- 5) 形体差异：E1 应含圆锥草顶、E4 应含锯齿、E5 应含穹顶 ----
function geoKeysOf(era, zone, variant){
  const t = { zone, variant, _wx: 0, _wy: 1.2, _wz: 0, built: true, prog: 1 };
  const grp = R.makeBuilding(t, era);
  const keys = new Set();
  for(const m of grp.children){
    if(!m.isMesh) continue;
    for(const [k, g] of Object.entries(R._geo)) if(g === m.geometry) keys.add(k);
  }
  return keys;
}
const e1 = geoKeysOf(0, 1, 0);
assert(e1.has('bodyCyl') && e1.has('coneRoof'), `E1 住房含圆筒墙+圆锥草顶（${[...e1].join(',')}）`);
const e4 = geoKeysOf(3, 1, 0);
assert(e4.has('sawTooth') && e4.has('silo'), `E4 住房含锯齿屋顶+筒仓（${[...e4].join(',')}）`);
const e5 = geoKeysOf(4, 1, 0);
assert(e5.has('domeBig') && e5.has('glowRing'), `E5 住房含穹顶+发光环带（${[...e5].join(',')}）`);
const e2 = geoKeysOf(1, 1, 0);
assert(e2.has('gableRoof') && e2.has('column'), `E2 住房含人字坡顶+柱廊（${[...e2].join(',')}）`);
const e3 = geoKeysOf(2, 1, 0);
assert(e3.has('steepRoof') && e3.has('buttress'), `E3 住房含陡尖顶+飞扶壁（${[...e3].join(',')}）`);

// ---- 6) 五种时代的住房构件集合必须互不相同（"区分明显"的可测代理指标）----
const sigs = [0,1,2,3,4].map(e => [...geoKeysOf(e, 1, 0)].sort().join('|'));
const uniq = new Set(sigs);
assert(uniq.size === 5, `五个时代的住房构件集合两两不同（${uniq.size}/5 种）`);

// ---- 7) 工业（zone 3）形体：E1 土窑 / E2-E3 作坊 / E4 锯齿厂房 / E5 反应堆 ----
const f1 = geoKeysOf(0, 3, 0);
assert(f1.has('kilnDome') && f1.has('kilnHole'), `E1 工业为土窑（${[...f1].join(',')}）`);
const f2 = geoKeysOf(1, 3, 0);
assert(f2.has('brickChim') && !f2.has('sawTooth'), `E2 工业为作坊（细烟道、无锯齿，${[...f2].join(',')}）`);
const f3 = geoKeysOf(2, 3, 0);
assert(f3.has('glowRing'), `E3 工业含水轮（复用 glowRing 几何，${[...f3].join(',')}）`);
const f4 = geoKeysOf(3, 3, 0);
assert(f4.has('saw') && f4.has('brickChim') && f4.has('shed'), `E4 工业为锯齿厂房+砖烟囱（${[...f4].join(',')}）`);
const f5 = geoKeysOf(4, 3, 0);
assert(f5.has('bodyCyl') && f5.has('glowRing') && !f5.has('saw'), `E5 工业为圆柱反应堆（${[...f5].join(',')}）`);
const fSigs = [0,1,2,3,4].map(e => [...geoKeysOf(e, 3, 0)].sort().join('|'));
assert(new Set(fSigs).size >= 4, `工业形体至少 4 种互不相同（${new Set(fSigs).size}/5）`);

// ---- 8) 每类分区在每个时代都必须产出网格（防止分派遗漏导致"空地"）----
for(let era=0; era<5; era++){
  for(const zone of [1,2,3,4]){
    for(let variant=0; variant<3; variant++){
      const t = { zone, variant, _wx: 1, _wy: 1.2, _wz: 1, built: true, prog: 1 };
      const grp = R.makeBuilding(t, era);
      const n = grp.children.filter(o=>o.isMesh).length;
      if(n === 0) throw new Error(`FAIL: era${era+1} zone${zone} varn${variant} 未产出任何网格`);
    }
  }
}
assert(true, '4 类分区 × 3 变体 × 5 时代 全部产出至少 1 个网格');

console.log('渲染构建器冒烟测试 PASS');
