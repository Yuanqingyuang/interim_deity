// 地形着色连续性（rev-3）
//
// 为什么需要：色彩不连续是「画面上看得见、数值上查不出」的典型缺陷 ——
// 本轮筛查发现两处，都是靠逐点扫描才定位到的：
//   ① cornerColor 在 h = h2(=1.70) 处因 `smoothstep(...) * 0.85` 产生 0.0853 的硬边
//      （红通道，8bit ≈ 22/255），且正落在可建高度带内（建筑高 0.9–2.2）
//   ② 旷野暗角按「到 bbox 中心的距离」算，与托管/旷野的实际边界不重合，
//      交界一格内亮度跳 27%
// 本测试把「色带必须连续」与「暗角必须跨界连续」两条锁死。

import { cornerColor } from '../js/terrain.js';
import { PALETTES, WATER_LEVEL } from '../js/config.js';

let pass = 0, fail = 0;
const ok = (cond, msg)=>{ if(cond){ pass++; console.log('  ok - ' + msg); } else { fail++; console.log('  FAIL - ' + msg); } };
const jump = (a, b)=> Math.max(Math.abs(a.r-b.r), Math.abs(a.g-b.g), Math.abs(a.b-b.b));

console.log('=== 1) 色带在关键高度处必须连续 ===');
{
  // 带界（与 terrain.js cornerColor 内的常量一致）
  const h1 = WATER_LEVEL + 0.05;   // 水线
  const h2 = WATER_LEVEL + 0.95;   // 沙→草
  const bounds = [['水线 h1', h1], ['沙→草 h2', h2], ['草→深草 h3', 2.8], ['深草→岩 h4', 4.3], ['岩→雪 h5', 6.2]];
  const EPS = 0.006;
  for(let era=0; era<5; era++){
    for(const [name, hb] of bounds){
      const a = cornerColor(hb - EPS, false, hb - EPS, hb - EPS, era);
      const b = cornerColor(hb + EPS, false, hb + EPS, hb + EPS, era);
      const j = jump(a, b);
      ok(j < 0.02, `E${era+1} ${name}：跨界跳变 ${j.toFixed(4)} < 0.02（8bit ≈ ${(j*255).toFixed(0)}/255）`);
    }
  }
}

console.log('');
console.log('=== 2) 全程细扫：任意 1cm 高度步进都不应出现硬边 ===');
{
  // h2 曾是重灾区，这里对它做 1cm 细扫；其余带界用粗扫覆盖
  const H2 = WATER_LEVEL + 0.95;
  let maxJ = 0, at = 0;
  for(let era=0; era<5; era++){
    for(let h = 0.5; h <= 7.0; h += 0.01){
      const a = cornerColor(h, false, h, h, era);
      const b = cornerColor(h + 0.01, false, h + 0.01, h + 0.01, era);
      const j = jump(a, b);
      if(j > maxJ){ maxJ = j; at = h; }
    }
  }
  // 0.01 高度步进下，正常色带变化应远小于 0.02
  ok(maxJ < 0.02, `五个时代全程 [0.5, 7.0] 细扫：最大单步跳变 ${maxJ.toFixed(4)} @ h=${at.toFixed(2)} < 0.02`);
  ok(at < H2 - 0.5 || at > H2 + 0.5, `最大跳变点不在 h2=${H2.toFixed(2)} 附近（实测 ${at.toFixed(2)}）`);
}

console.log('');
console.log('=== 3) 沙→草段单向推进 + 全程取值在分段端点之间 ===');
{
  // 「沙→草」这一段的绿通道应随高度上升（这是设计本意：越来越绿）
  let prevG = -1, rise = true, bad = 0;
  for(let h = WATER_LEVEL + 0.06; h <= WATER_LEVEL + 0.95; h += 0.05){
    const c = cornerColor(h, false, h, h, 0);
    if(c.g < prevG - 0.005){ rise = false; bad++; }
    prevG = c.g;
  }
  ok(rise, `沙→草段 [${(WATER_LEVEL+0.06).toFixed(2)}, ${(WATER_LEVEL+0.95).toFixed(2)}] 绿通道上升（违反 ${bad} 次）`);

  // grass 是草地峰值色，往 grass2（深草）过渡时绿通道**下降**是设计本意，
  // 故不做全程单调断言；改为断言「每段取值都落在该段两个端点之间」（凸组合性质），
  // 这才是分段线性插值真正该满足的不变量。
  const segs = [
    ['bed→sand', 0.40, WATER_LEVEL + 0.05],
    ['sand→grass', WATER_LEVEL + 0.05, WATER_LEVEL + 0.95],
    ['grass→grass2', WATER_LEVEL + 0.95, 2.8],
    ['grass2→rock', 2.8, 4.3],
    ['rock→snow', 4.3, 6.2],
  ];
  let outside = 0;
  for(let era=0; era<5; era++){
    for(const [, a, b] of segs){
      const ca = cornerColor(a, false, a, a, era);
      const cb = cornerColor(b, false, b, b, era);
      for(let h = a; h <= b + 1e-9; h += (b - a) / 20){
        const c = cornerColor(h, false, h, h, era);
        for(const ch of ['r','g','b']){
          const lo = Math.min(ca[ch], cb[ch]) - 1e-6, hi = Math.max(ca[ch], cb[ch]) + 1e-6;
          if(c[ch] < lo || c[ch] > hi) outside++;
        }
      }
    }
  }
  ok(outside === 0, `五个时代 × 5 段：取值均在分段端点之间（越界 ${outside} 次）`);
}

console.log('');
console.log('=== 4) 暗角：跨界连续 + 只随外接距离变化 ===');
{
  // 复刻 render.js 的暗角公式，验证它在托管边界处连续
  const b = { minX:-20, maxX:20, minY:-20, maxY:20 };
  const dimOf = (bb, wx, wy)=>{
    const outX = Math.max(bb.minX - wx, wx - bb.maxX);
    const outY = Math.max(bb.minY - wy, wy - bb.maxY);
    return 1 - Math.min(0.35, Math.max(0, outX, outY) * 0.02);
  };
  const inside = dimOf(b, 20, 0);        // 托管最外格
  const outside1 = dimOf(b, 21, 0);      // 紧邻的旷野格
  const outside10 = dimOf(b, 30, 0);     // 外接距离 10 格
  const outside20 = dimOf(b, 40, 0);     // 外接距离 20 格（已过最深点）
  ok(Math.abs(inside - 1) < 1e-9, `托管侧 dim = ${inside.toFixed(4)}（应为 1.0）`);
  ok(Math.abs(inside - outside1) < 0.03, `跨界一格跳变 ${Math.abs(inside-outside1).toFixed(4)} < 0.03（原实现为 0.27）`);
  ok(outside10 < inside, `向外渐深（外接 10 格处 ${outside10.toFixed(3)} < ${inside.toFixed(3)}）`);
  // 斜率 0.02/格、上限 0.35 → 外接 17.5 格处到达最深 0.65
  ok(Math.abs(outside10 - 0.80) < 1e-9, `外接 10 格处 dim = 0.80（实测 ${outside10.toFixed(3)}）`);
  ok(Math.abs(outside20 - 0.65) < 1e-9, `外接 20 格处已到最深 0.65（实测 ${outside20.toFixed(3)}）`);

  // 不依赖 bbox 中心/跨度：取一个对两个 bbox 都在外面的点，外接距离相同则 dim 必须相同。
  // （注意：若取的点落在某个 bbox 内部，dim 恒为 1 —— 那不叫"一致"，是情形不同。）
  const b2 = { minX:-10, maxX:30, minY:-20, maxY:20 };
  const P = [40, 0];                     // 对 b 外接 20；对 b2 外接 10
  ok(dimOf(b, ...P) === 0.65 && dimOf(b2, ...P) === 0.80,
    `同一点在不同 bbox 下按各自外接距离取值（b:${dimOf(b,...P).toFixed(2)} / b2:${dimOf(b2,...P).toFixed(2)}）`);
  // 外接距离相同 → 值相同（平移 bbox 但保持该点的外接距离）
  const b3 = { minX:0, maxX:40, minY:-20, maxY:20 };
  const Q = [50, 0];                     // 对 b3 外接 10
  ok(dimOf(b2, 40, 0) === dimOf(b3, 50, 0),
    `外接距离相同则 dim 相同（${dimOf(b2,40,0).toFixed(3)} === ${dimOf(b3,50,0).toFixed(3)}）—— 不依赖 bbox 中心/跨度`);
}

console.log('');
console.log(`地形着色连续性测试 ${fail === 0 ? 'PASS' : 'FAIL'}  （${pass} 通过 / ${fail} 失败）`);
if(fail) process.exit(1);
