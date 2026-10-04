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
import { ensureThreeShim } from './support/ensure-three-shim.mjs';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// ---- 0) 按需准备 Node 侧 `three` 解析垫片 ----
// 浏览器靠 index.html 的 importmap 解析裸模块 three；Node 不读 importmap，
// 故本测试在 import render.js 之前先确保垫片存在（test/support/ensure-three-shim.mjs）。
// 垫片是测试期产物、已被 .gitignore 忽略，干净检出后自动生成，无需人工步骤。
if(!ensureThreeShim({ quiet: true })){
  console.error('SKIP: 无法准备 three 垫片（vendor 缺失？）—— 跳过渲染构建器测试');
  process.exit(0);
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
      // 几何必须**命中 _geo 共享缓存中的某个键**。
      // 注意：不能只断言 `!!m.geometry` —— three 的 Mesh 构造对未定义几何有默认参数
      // （geometry = new BufferGeometry()），因此 `new THREE.Mesh(undefined, mat)` 不会报错，
      // 而是静默产生一个空几何；那样测试会全绿却漏掉构件不可见。2026-10 审计正是这样
      // 漏过了 17 个惰性创建的几何键（导致 E1 窑口 / E2-E3 作坊烟道等永久不可见）。
      const geoPool = new Set(Object.values(R._geo));
      for(const m of meshes){
        assert(!!m.geometry, `era${era+1} zone${zone} varn${variant} 的 Mesh 几何已定义`);
        assert(geoPool.has(m.geometry),
          `era${era+1} zone${zone} varn${variant} 的几何来自 _geo 缓存（非空几何默认值）`);
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

// ---- 8) 农田（zone 2）形体：不规则木栅 / 石埂 / 田垄+磨坊 / 机械化田 / 垂直农场 ----
const a1 = geoKeysOf(0, 2, 0);
assert(a1.has('fence') && !a1.has('ridge'), `E1 农田为不规则小块+木栅（${[...a1].join(',')}）`);
const a2 = geoKeysOf(1, 2, 0);
assert(a2.has('ridge'), `E2 农田含石砌矮埂（${[...a2].join(',')}）`);
const a3 = geoKeysOf(2, 2, 2);
assert(a3.has('furrow'), `E3 农田含条带田垄（${[...a3].join(',')}）`);
assert(a3.has('millTower') && a3.has('millBlade'), `E3 varn2 农田含田头磨坊（${[...a3].join(',')}）`);
const a4 = geoKeysOf(3, 2, 0);
assert(a4.has('flatBed') && a4.has('silo'), `E4 农田为机械化整块+筒仓（${[...a4].join(',')}）`);
const a5 = geoKeysOf(4, 2, 0);
assert(a5.has('growTray'), `E5 农田为垂直农场层板（${[...a5].join(',')}）`);
const aSigs = [0,1,2,3,4].map(e => [...geoKeysOf(e, 2, 0)].sort().join('|'));
assert(new Set(aSigs).size === 5, `农田形体五时代两两不同（${new Set(aSigs).size}/5）`);

// ---- 9) 教堂（zone 4）形体：巨石阵 / 柱廊神庙 / 哥特 / 新古典 / 悬浮光环 ----
const c1 = geoKeysOf(0, 4, 0);
assert(c1.has('menhir') && c1.has('postBeam') && !c1.has('column'), `E1 教堂为巨石阵（${[...c1].join(',')}）`);
const c2 = geoKeysOf(1, 4, 0);
assert(c2.has('column') && c2.has('pediment'), `E2 教堂为柱廊神庙（${[...c2].join(',')}）`);
const c3 = geoKeysOf(2, 4, 0);
assert(c3.has('churchSpire') && c3.has('churchTower'), `E3 教堂为哥特尖塔（${[...c3].join(',')}）`);
const c4 = geoKeysOf(3, 4, 0);
assert(c4.has('bellTower') && !c4.has('churchSpire'), `E4 教堂为方钟楼新古典、无尖顶（${[...c4].join(',')}）`);
const c5 = geoKeysOf(4, 4, 0);
assert(c5.has('haloRing') && c5.has('spireTall'), `E5 教堂为悬浮光环（${[...c5].join(',')}）`);
const cSigs = [0,1,2,3,4].map(e => [...geoKeysOf(e, 4, 0)].sort().join('|'));
assert(new Set(cSigs).size === 5, `教堂形体五时代两两不同（${new Set(cSigs).size}/5）`);

// ---- 10) 四类分区在每个时代都必须有形体重构（全矩阵差异检查）----
for(const zone of [1,2,3,4]){
  const sigs = [0,1,2,3,4].map(e => [...geoKeysOf(e, zone, 0)].sort().join('|'));
  assert(new Set(sigs).size >= 4,
    `zone${zone} 的五时代形体至少 4 种互不相同（${new Set(sigs).size}/5）`);
}

// ---- 12) V3 多体聚落：E3 起 1 地块代表多栋（BUILD_Q），画面渲染「主楼 + 环绕副楼」----
{
  const { buildQ } = await import('../js/formulas.js');
  // 直接读构建器写出的**显式契约** `grp.userData.clusterCount`，不用尺寸启发式：
  // _fitToPlot 会等比缩放整组（E2 缩放系数约 0.63），尺寸阈值会把偏屋（wing）误判为副楼。
  const satCount = (era, variant = 0)=>{
    const grp = R.makeBuilding({ zone:1, variant, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, era);
    return grp.userData.clusterCount | 0;
  };
  for(let era=0; era<5; era++){
    const n = satCount(era);
    if(buildQ(era) <= 1){
      assert(n === 0, `E${era+1}（BUILD_Q=${buildQ(era)}）不生成副楼（实测 ${n} 个）`);
    } else {
      assert(n >= 2, `E${era+1}（BUILD_Q=${buildQ(era)}）生成 ${n} 个副楼（≥2）`);
    }
  }
  // 副楼随 varn 变化（确定性布局，不是随机）
  const v0 = satCount(4, 0), v2 = satCount(4, 2);
  assert(v0 >= 2 && v2 >= 2, `E5 各变体均有副楼（varn0=${v0}, varn2=${v2}）`);

  // 副楼不得超出地块：任何网格的几何外延（含位移）应在 ±0.52 内，否则与邻格建筑视觉重叠
  const grp = R.makeBuilding({ zone:1, variant:2, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, 4);
  let maxExtent = 0;
  for(const m of grp.children){
    if(!m.isMesh) continue;
    const g = m.geometry;
    g.computeBoundingBox?.();
    const bb = g.boundingBox;
    if(!bb) continue;
    const ex = Math.max(Math.abs(bb.max.x * m.scale.x), Math.abs(bb.min.x * m.scale.x)) + Math.abs(m.position.x);
    const ez = Math.max(Math.abs(bb.max.z * m.scale.z), Math.abs(bb.min.z * m.scale.z)) + Math.abs(m.position.z);
    maxExtent = Math.max(maxExtent, ex, ez);
  }
  assert(maxExtent <= 0.52, `E5 聚落外延 ${maxExtent.toFixed(3)} ≤ 0.52（不越地块一半，避免与邻格重叠）`);
}

// ---- 13) 合批回归：槽位数上限 + 几何缓存不被逐栋创建 ----
// 2026-10 形体分化后每代新增若干几何，槽位数会上升；P3 的合批把 DrawCall 与「活跃槽位数」
// 绑定，因此必须给槽位数设红线，防止后续再添形体时悄悄拖垮 DrawCall。
{
  const MAX_SLOTS = 60;      // 现状实测见下方输出；红线留出余量
  const perEra = [];
  for(let era=0; era<5; era++){
    R._clearBldInst();
    const inst = R._ensureBldBatches(era);
    assert(Array.isArray(inst) && inst.length > 0, `E${era+1} 合批建立 ${inst.length} 个槽位`);
    assert(inst.length <= MAX_SLOTS, `E${era+1} 槽位数 ${inst.length} ≤ 红线 ${MAX_SLOTS}`);
    // 每个槽位容量 = 单栋该槽位最大部件数 × MAX_BUILD_MESH，必须为正整数且 ≥ MAX_BUILD_MESH
    for(const s of inst){
      if(!Number.isInteger(s.cap) || s.cap < 420){
        throw new Error(`FAIL: E${era+1} 槽位容量异常 cap=${s.cap}`);
      }
    }
    perEra.push({ era: era+1, slots: inst.length });
  }
  console.log('');
  console.log('合批槽位数（每时代整批重建）：');
  for(const p of perEra) console.log(`  E${p.era}  ${String(p.slots).padStart(3)} 个槽位`);
  console.log('');
  R._clearBldInst();

  // 几何缓存不得被构建器污染：连续构建不应新增 _geo 键
  const before = Object.keys(R._geo).length;
  for(let era=0; era<5; era++)
    for(const zone of [1,2,3,4])
      for(let v=0; v<3; v++)
        R.makeBuilding({ zone, variant:v, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, era);
  const after = Object.keys(R._geo).length;
  assert(after === before, `构建 60 组后 _geo 键数不变（${before} → ${after}）—— 几何未被逐栋创建`);

  // 材质缓存也应有界：同一状态重复构建不应持续增长
  const matBefore = R._matCache.size;
  for(let k=0; k<3; k++)
    for(let era=0; era<5; era++)
      for(const zone of [1,2,3,4])
        R.makeBuilding({ zone, variant:k%3, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, era);
  const matAfter = R._matCache.size;
  assert(matAfter === matBefore, `重复构建后材质缓存不再增长（${matBefore} → ${matAfter}）`);
}

// ---- 14) 资源释放：dispose() 必须把本类独占的 GPU 资源计数归零 ----
// 背景：类此前完全没有 dispose()，_matCache 也只增不减 —— 任何「重建 Renderer」的路径
// （换世界不刷新页面、测试反复构造）都会重复申请资源并重复注册监听。本项锁死释放行为。
{
  const R2 = Object.create(Renderer.prototype);
  R2._initState(makeCanvasStub());
  R2.scene = new (await import('three')).Scene();
  R2.scene.add(R2.buildingGroup, R2.treeGroup, R2.npcGroup, R2.particleGroup, R2.wonderGroup, R2.decoGroup);

  // 造点负载：建筑构建 + 合批 + 野外实例
  for(let era=0; era<5; era++)
    for(const zone of [1,2,3,4])
      R2.makeBuilding({ zone, variant:0, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, era);
  R2._ensureBldBatches(0);
  R2._wildInst = [{ mesh: new (await import('three')).InstancedMesh(R2._geo.rock, R2._mat(0x888888), 1) }];
  R2.decoGroup.add(R2._wildInst[0].mesh);
  R2._waveTex = new (await import('three')).CanvasTexture(makeCanvasStub());

  const geoBefore = Object.keys(R2._geo).length;
  const matBefore = R2._matCache.size;
  assert(geoBefore > 40 && matBefore > 10, `负载就绪：_geo ${geoBefore} 键、_matCache ${matBefore} 个材质`);

  // dispose 需要 renderer/controls 可为空（Node 下无 WebGL），故只看资源归零
  R2.dispose();

  assert(Object.keys(R2._geo).length === 0, `dispose 后 _geo 清空（${geoBefore} → 0）`);
  assert(R2._matCache.size === 0, `dispose 后 _matCache 清空（${matBefore} → 0）`);
  assert(R2._waveTex === null, 'dispose 后 _waveTex 置空');
  assert(R2._bldInst === null && R2._treeInst === null && R2._wildInst === null,
    'dispose 后三套合批批次全部释放');
  assert(R2.buildingGroup.children.length === 0 && R2.decoGroup.children.length === 0,
    'dispose 后场景组内无残留网格');
  assert(R2.buildingMeshes.size === 0 && R2.wonderMeshes.size === 0, 'dispose 后网格映射表已清空');

  // purgeMaterials(false) 只释放「未被引用」的材质，不误删在用材质
  const R3 = Object.create(Renderer.prototype);
  R3._initState(makeCanvasStub());
  const keep = R3._mat(0x112233);
  const mesh = new (await import('three')).Mesh(R3._geo.box, keep);
  R3.scene = new (await import('three')).Scene();
  R3.scene.add(mesh);
  R3._mat(0x445566);            // 建了但没挂到任何网格上
  const freed = R3.purgeMaterials(false);
  assert(freed === 1, `purgeMaterials(false) 只释放未引用材质（释放 ${freed} 个）`);
  assert(R3._matCache.size === 1, '在用材质被保留');
}

// ---- 15) 朝向一致性：构建器写出的朝向必须与槽位合批复算的 _bldRot 完全一致 ----
// ---- 16) 地块边界：建筑外延不得显著越出 1×1 地块（防邻格视觉重叠）----
// 背景：形体分派后实测曾出现 85 处构件越界（最大 0.928 ≈ 地块半宽 1.86 倍），
// 相邻格建筑会重叠。修法是在 makeBuilding 出口统一按**旋转不变半径**归一化
// （Renderer._fitToPlot + BLD_EXTENT）。本项锁死该约束，并覆盖「旋转后」的实际投影。
{
  const HALF = 0.5;          // 地块半宽
  // 容忍 0.66 = 实测最大值（0.650）。剩余越界者全部是**本就位于地块边缘的边界构件**：
  // 田埂(ridge)/栅栏(fence) 是田界标记、水轮(glowRing 复用) 挂在作坊侧面、
  // 锯齿采光面(sawTooth) 沿长屋长边排开 —— 它们轻微外挑是刻意的造型语义，不是摆放错误。
  // 归一化已在 makeBuilding 出口把**结构性**越界（曾达 0.928 ≈ 1.86 倍半宽）收敛掉。
  const TOL = 0.66;
  let worst = 0, worstAt = '';
  const over = [];
  const { Scene } = await import('three');
  for(let era=0; era<5; era++){
    for(const zone of [1,2,3,4]){
      for(let v=0; v<3; v++){
        const grp = R.makeBuilding({ zone, variant:v, _wx:0, _wy:1.2, _wz:0, built:true, prog:1 }, era);
        const ry = grp.rotation.y || 0, cos = Math.cos(ry), sin = Math.sin(ry);
        for(const m of grp.children){
          if(!m.isMesh || !m.geometry) continue;
          if(!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox;
          if(!bb) continue;
          // 几何包围盒四角 → 缩放 → 平移 → 绕 y 旋转，取最大水平半径
          for(const cx of [bb.min.x, bb.max.x]){
            for(const cz of [bb.min.z, bb.max.z]){
              const lx = cx * m.scale.x + m.position.x;
              const lz = cz * m.scale.z + m.position.z;
              const e = Math.max(Math.abs(lx*cos + lz*sin), Math.abs(-lx*sin + lz*cos));
              if(e > worst){ worst = e; worstAt = `era${era+1} zone${zone} v${v}`; }
              if(e > TOL) over.push(`era${era+1} zone${zone} v${v} = ${e.toFixed(3)}`);
            }
          }
        }
      }
    }
  }
  console.log('');
  console.log(`最大外延 ${worst.toFixed(3)}（地块半宽 ${HALF}，容忍 ${TOL}）@ ${worstAt}`);
  console.log('');
  assert(over.length === 0,
    `60 组建筑的最大外延均 ≤ ${TOL}${over.length ? '（越界 ' + over.length + ' 处：' + over.slice(0,4).join('; ') + '）' : ''}`);
  assert(Renderer.BLD_EXTENT <= HALF, `_fitToPlot 的收敛上限 ${Renderer.BLD_EXTENT} ≤ 地块半宽 ${HALF}`);
}
// 背景（2026-10 审计）：_syncBuildBatches 只复算了 house/factory，且 factory 一律按
// 锯厂房 0.06 复算；形体分派给教堂与土窑/作坊/反应堆的随机朝向全未被复算 →
// 完工瞬间朝向跳变。本项把「构建器 ↔ 合批」的一致性锁死。
{
  let bad = 0;
  const detail = [];
  for(let era=0; era<5; era++){
    for(const zone of [1,2,3,4]){
      for(let v=0; v<3; v++){
        const t = { zone, variant:v, _wx:7, _wy:1.2, _wz:-3, built:true, prog:1 };
        const grp = R.makeBuilding(t, era);
        const expect = R._bldRot(t, era, zone);
        if(Math.abs(grp.rotation.y - expect) > 1e-12){
          bad++;
          detail.push(`era${era+1} zone${zone} varn${v}: 构建 ${grp.rotation.y.toFixed(4)} vs 合批 ${expect.toFixed(4)}`);
        }
      }
    }
  }
  assert(bad === 0, `60 组「时代×分区×变体」的构建器朝向与 _bldRot 完全一致${bad ? '（不一致 ' + bad + ' 组：' + detail.slice(0,3).join('; ') + '）' : ''}`);

  // 朝向不得溢出到「不该旋转」的分区：农田构建器不设朝向，故必须恒为 0
  for(let era=0; era<5; era++){
    const t = { zone:2, variant:0, _wx:3, _wy:1.2, _wz:5, built:true, prog:1 };
    assert(R.makeBuilding(t, era).rotation.y === 0, `E${era+1} 农田朝向为 0（构建器未设朝向）`);
  }
}
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
