// 实习神明 · Three.js 渲染
// 无边界延伸地形 · 日照系统 · 优化低多边形素材

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TILE, WATER_LEVEL, WILD, FOG_NEAR, FOG_FAR,
  PALETTES, BUILDING_STYLE, ZONES, FOLKCOL, FOLK_HEAD,
  CHURCH_STYLE, FACTORY_STYLE, CHUNK, FARM_CROP, FARM_SOIL, churchStyleForEra, factoryStyleForEra,
  formForEra, BLD_ROT, FACTORY_ROT,
  sampleSun, lerpHex, hash2, mulberry32, MAX_BUILD_MESH, MAX_TREE_MESH, MAX_NPC_INST
} from './config.js';
import { cornerColor, heightAt, riverMask, sampleHeight } from './terrain.js';
import { getTile, eachTile, chunkBounds, tileLive } from './state.js';
import { buildQ } from './formulas.js';

const WATER_Y = WATER_LEVEL;
const MIN_H_SAFE = 0.22;

// P3-B：村民部件批次表。原实现每人一个 Group（腿×2/臂×2/躯干/头/发/挎包 = 8 Mesh），
// 400 人即 3200 Mesh、含阴影 pass 约 816 draws；改为 6 个 InstancedMesh 后与人数脱钩。
// k=批次名 / geo=_buildGeo 共享几何键 / mat=材质槽 / mul=每人实例数 / cast=是否投影
const NPC_BATCH_DEFS = [
  { k:'leg',   geo:'leg',     mat:'dark',  mul:2, cast:true  },
  { k:'arm',   geo:'arm',     mat:'cloth', mul:2, cast:true  },
  { k:'torso', geo:'torso',   mat:'cloth', mul:1, cast:true  },
  { k:'head',  geo:'head',    mat:'skin',  mul:1, cast:true  },
  { k:'hair',  geo:'hair',    mat:'dark',  mul:1, cast:true  },
  { k:'bag',   geo:'satchel', mat:'bag',   mul:1, cast:false }
];
// 部件在（pivot 或整体）坐标系下的固定局部平移，与原 _makeVillager 的 mesh.position 一致
const NPC_LOCAL = {
  leg:   new THREE.Matrix4().makeTranslation(0, -0.08, 0),   // 相对髋部 pivot
  arm:   new THREE.Matrix4().makeTranslation(0, -0.07, 0),   // 相对肩部 pivot
  torso: new THREE.Matrix4().makeTranslation(0, 0.28, 0),
  head:  new THREE.Matrix4().makeTranslation(0, 0.46, 0),
  hair:  new THREE.Matrix4().makeTranslation(0, 0.48, 0),
  bag:   new THREE.Matrix4().makeTranslation(0.1, 0.28, 0.06)
};

export class Renderer {
  constructor(canvas){
    this._initState(canvas);          // 纯字段 + 共享几何/材质池（可被测试单独复用）
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xffeec8, FOG_NEAR, FOG_FAR);

    const c = 0;
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 600);
    this.camera.position.set(20, 28, 20);
    this.camera.lookAt(c, 4, c);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // 光照
    this.hemi = new THREE.HemisphereLight(0xd8ecf8, 0x7a8a5a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2c8, 1.3);
    this.sun.position.set(40, 50, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this._shadowR = 30;                 // 阴影正交框半径（随城区尺寸更新）
    this._focus = { x: c, z: c };       // 阴影/日照焦点 = 城区中心
    const s = this._shadowR;
    this.sun.shadow.camera.left=-s; this.sun.shadow.camera.right=s;
    this.sun.shadow.camera.top=s; this.sun.shadow.camera.bottom=-s;
    this.sun.shadow.camera.near=1; this.sun.shadow.camera.far=170;
    // OrthographicCamera 构造时已固化投影矩阵，改完 left/right/top/bottom 必须重算，
    // 否则生效值仍是默认的 ±5（阴影只覆盖 10×10 世界单位）
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.sunTarget.position.set(c,0,c);
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.ambient = new THREE.AmbientLight(0x8899aa, 0.25);
    this.scene.add(this.ambient);

    // 高空云层（y≈34，随风漂移）
    this._buildClouds(c);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI*0.47;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 90;
    this.controls.target.set(c, 4, c);
    this.controls.update();
    // 城建常见操作（Cities / SimCity 系）：
    // 左键=工具（导航工具时旋转）· 右键拖动=旋转 · 中键拖动=平移 · 滚轮=缩放
    // Shift+右键=平移 · WASD=平移 · Q/E=水平旋转
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.enablePan = true;
    this._camMode = 'none'; // none | rotate | pan
    this._keys = { w:false, a:false, s:false, d:false, q:false, e:false, shift:false };
    this._bindCameraKeys(canvas);

    // 场景挂载（容器已在 _initState 建好，这里只挂到 scene 上）
    this.scene.add(this.buildingGroup);
    this.scene.add(this.treeGroup);
    this.scene.add(this.npcGroup);
    this.scene.add(this.particleGroup);
    this.scene.add(this.wonderGroup);
    this.scene.add(this.decoGroup);
    // 悬停高亮环：必须在 scene 与 _geo 就绪后创建。
    // 2026-10 审计发现 makeHover 此前**全仓零调用**，而 setHover 无条件解引用
    // this.hoverMesh（_initState 里置 null）→ 开始游戏后首次鼠标移动即 TypeError，
    // 且悬停环永不显示。
    this.makeHover();
  }

  /**
   * 纯字段初始化 + 共享几何/材质池（2026-10 从 constructor 拆出）。
   * 拆出的理由：构造器里的 WebGLRenderer / OrbitControls / 场景光照都需要真实 WebGL 与 DOM，
   * 而**几何与材质池是建筑构建器的全部依赖**。拆出后 test/rev-1-builders.test.mjs 可以
   * 用 Object.create(Renderer.prototype) + _initState(canvas) 得到与线上完全一致的
   * _geo / _matCache，对 makeBuilding 做构建期冒烟（而非在测试里手抄一份初始化，那样会漂移）。
   */
  _initState(canvas){
    this.canvas = canvas;
    this.era = 0;
    this.dayTime = 0.35;
    this.skyTex = null;
    this.buildingMeshes = new Map();
    this.wonderMeshes = new Map();
    // 场景挂载组：纯容器（Object3D/Group 不需要 WebGL），放在这里使合批逻辑可被 Node 测试覆盖
    this.buildingGroup = new THREE.Group();
    this.treeGroup = new THREE.Group();
    this.npcGroup = new THREE.Group();
    this.particleGroup = new THREE.Group();
    this.wonderGroup = new THREE.Group();
    this.decoGroup = new THREE.Group();
    this.terrainMesh = null;
    this.waterMesh = null;
    this.hoverMesh = null;
    // P2-A 植被合批：区块内树不再逐棵建 Group，而是按部件合入 5 个 InstancedMesh 批次
    this._treeCand = [];       // 每帧收集的候选树格（复用数组，避免逐帧分配）
    this._treeInst = null;     // {trunk,cone,mid,ico,bush} 批次缓存（时代切换时重建）
    this._treeDummy = new THREE.Object3D();
    this._treeSigA = null; this._treeSigB = null; this._treeKept = -1;
    // P3-A 建筑合批：已完工建筑按「模板部件表」写入全局 (几何,材质,阴影) 槽位 InstancedMesh；
    // 建造中建筑仍走独立 Group（进度缩放动画需要逐栋矩阵）
    this._bldCand = [];        // 每帧收集的已完工建筑格（复用数组）
    this._bldInst = null;      // 槽位 InstancedMesh 数组（时代切换时重建）
    this._bldTpl = null;       // 模板缓存 Map(`${type}|${varn}` → 部件表)
    this._bldDummy = new THREE.Object3D();
    this._bldM1 = new THREE.Matrix4();
    this._bldM2 = new THREE.Matrix4();
    this._bldSigA = null; this._bldSigB = null; this._bldKept = -1;
    this._bldEra = -1;         // 槽位批次当前所属时代（_ensureBldBatches 守卫用）
    this.terrainDirty = true;
    this._npcHomes = [];
    this._npcHomesDirty = true;
    // P3-B 村民合批：状态记录改为纯数据数组，网格由 6 个 InstancedMesh 承载
    this._npcs = [];           // 村民状态（位置/朝向/摆动角/目标/计时）
    this._npcInst = null;      // { cap, b:{批次名→InstancedMesh}, mats }
    this._npcEra = null;       // 当前批次配色对应的时代
    this._npcDummy = new THREE.Object3D();   // 整体（位置 + 朝向）
    this._npcPivot = new THREE.Object3D();   // 髋/肩 pivot（位置 + 摆动 rotation.x）
    this._npcM1 = new THREE.Matrix4();
    this._npcM2 = new THREE.Matrix4();
    this._buildGeo();
  }

  _buildGeo(){
    this._geo = {
      box: new THREE.BoxGeometry(0.72, 1, 0.72),
      roof: new THREE.ConeGeometry(0.52, 0.55, 4),
      door: new THREE.BoxGeometry(0.18, 0.28, 0.06),
      window: new THREE.BoxGeometry(0.12, 0.12, 0.04),
      chimney: new THREE.CylinderGeometry(0.07, 0.09, 0.28, 5),
      fence: new THREE.BoxGeometry(0.7, 0.06, 0.05),
      treeTrunk: new THREE.CylinderGeometry(0.07,0.11,0.42,5),
      treeTop: new THREE.ConeGeometry(0.42,0.95,6),
      treeTop2: new THREE.IcosahedronGeometry(0.4,0),
      treeMid: new THREE.IcosahedronGeometry(0.28,0),
      bush: new THREE.IcosahedronGeometry(0.22,0),
      rock: new THREE.DodecahedronGeometry(0.22,0),
      npc: new THREE.CapsuleGeometry(0.12,0.28,3,6),
      head: new THREE.SphereGeometry(0.09,6,5),
      // 村民肢体（原点在关节处，便于摆动）
      leg: new THREE.BoxGeometry(0.07, 0.16, 0.08),
      arm: new THREE.BoxGeometry(0.06, 0.14, 0.07),
      torso: new THREE.CylinderGeometry(0.09, 0.12, 0.22, 6),
      hair: new THREE.SphereGeometry(0.095, 6, 4, 0, Math.PI*2, 0, Math.PI*0.55),
      satchel: new THREE.BoxGeometry(0.08, 0.08, 0.05),
      particle: new THREE.SphereGeometry(0.08,5,4),
      stone: new THREE.DodecahedronGeometry(0.6,0),
      pillar: new THREE.CylinderGeometry(0.26,0.32,1.9,6),
      lintel: new THREE.BoxGeometry(2.3,0.42,0.42),
      crop: new THREE.BoxGeometry(0.1, 0.22, 0.55),
      field: new THREE.BoxGeometry(0.74, 0.06, 0.74),
      eave: new THREE.BoxGeometry(0.78, 0.06, 0.78),
      lintelDoor: new THREE.BoxGeometry(0.24, 0.05, 0.05),

      // ---- 原为 _makeChurchGothic/_makeSawFactory 内的惰性创建，2026-10 审计发现其导致
      //      六个构件永久缺失（E1 窑口、E2/E3 作坊烟道、E4 长屋采光面、E4 玫瑰窗、
      //      E5 顶球/排气塔），且 Mesh(undefined) 静默降级为空几何使测试无法察觉。
      //      约定：_geo 必须在构造期完整，任何 _make* 内不得再 new THREE.* ----
      nave: new THREE.BoxGeometry(1, 1, 1),
      churchRoof: new THREE.ConeGeometry(0.42, 0.7, 4),
      churchTower: new THREE.BoxGeometry(0.28, 1, 0.28),
      churchSpire: new THREE.ConeGeometry(0.18, 0.55, 4),
      crossV: new THREE.BoxGeometry(0.03, 0.18, 0.03),
      crossH: new THREE.BoxGeometry(0.12, 0.03, 0.03),
      spireBall: new THREE.SphereGeometry(0.06, 6, 5),
      archDoor: new THREE.BoxGeometry(0.14, 0.22, 0.04),
      rose: new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8),
      churchWin: new THREE.BoxGeometry(0.06, 0.18, 0.03),
      shed: new THREE.BoxGeometry(1, 1, 1),
      saw: new THREE.BoxGeometry(0.14, 0.08, 0.55),
      sawGlass: new THREE.BoxGeometry(0.1, 0.1, 0.02),
      brickChim: new THREE.CylinderGeometry(0.07, 0.10, 1, 6),
      chimBand: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6),
      dock: new THREE.BoxGeometry(0.22, 0.18, 0.04),
      facWin: new THREE.BoxGeometry(0.18, 0.08, 0.03),
      // ---- 民宅构件（2026-10 重构：原为 _makeHouse 内懒创建，改形体分派后集中到此，
      //      保证 _geo 在构造期即完整——否则 _houseBox/_houseRound 会取到 undefined 几何）----
      pad: new THREE.BoxGeometry(1, 0.04, 1),
      houseBody: new THREE.BoxGeometry(1, 1, 1),
      wingRoof: new THREE.BoxGeometry(1, 1, 1),
      step: new THREE.BoxGeometry(0.28, 0.06, 0.10),
      sill: new THREE.BoxGeometry(0.14, 0.02, 0.03),
      thatch: new THREE.ConeGeometry(0.34, 0.24, 4),
      smallSpire: new THREE.ConeGeometry(0.08, 0.28, 5),
      // ---- 时代形体几何（2026-10 新增，见 时代建筑外观规划.md）----
      // 与既有几何同一约定：全部进 _geo 共享缓存，_make* 内不得再 new THREE.*，
      // 否则会被逐栋创建、破坏 P3 槽位合批的 (几何,材质,阴影) 聚合前提。
      padRound: new THREE.CylinderGeometry(0.5, 0.52, 0.04, 10),   // 圆形地基（蛮荒）
      bodyCyl: new THREE.CylinderGeometry(0.34, 0.40, 1, 8),       // 上窄下宽的圆筒墙体
      coneRoof: new THREE.ConeGeometry(0.48, 0.42, 10),            // 圆锥草顶（蛮荒）
      gableRoof: new THREE.ConeGeometry(0.52, 0.34, 4),            // 人字坡顶（城邦，压扁四棱锥）
      steepRoof: new THREE.ConeGeometry(0.46, 0.72, 4),            // 陡峭尖顶（封建）
      kilnDome: new THREE.SphereGeometry(0.30, 8, 6, 0, Math.PI*2, 0, Math.PI/2), // 土窑穹体
      kilnHole: new THREE.CylinderGeometry(0.05, 0.06, 0.10, 6),   // 窑顶烟孔
      sawTooth: new THREE.ConeGeometry(0.16, 0.14, 3),             // 锯齿屋顶单元
      silo: new THREE.CylinderGeometry(0.10, 0.10, 0.30, 8),       // 筒仓
      siloCone: new THREE.ConeGeometry(0.11, 0.09, 8),             // 筒仓锥顶
      domeBig: new THREE.SphereGeometry(0.30, 10, 6, 0, Math.PI*2, 0, Math.PI/2), // 星际大穹顶
      domeSmall: new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI*2, 0, Math.PI/2),// 副穹顶（多体聚落）
      glowRing: new THREE.CylinderGeometry(0.30, 0.30, 0.035, 12), // 发光环带
      glowBand: new THREE.BoxGeometry(0.05, 0.34, 0.05),           // 竖向光带
      spireTall: new THREE.ConeGeometry(0.20, 0.66, 4),            // 哥特尖塔
      buttress: new THREE.BoxGeometry(0.06, 0.30, 0.16),           // 飞扶壁薄板
      towerSquare: new THREE.BoxGeometry(0.24, 1, 0.24),           // 方钟楼（工业时代）
      column: new THREE.CylinderGeometry(0.05, 0.05, 0.34, 6),     // 柱廊圆柱（城邦）
      pediment: new THREE.ConeGeometry(0.26, 0.12, 4),             // 三角楣（城邦）
      // ---- 农田 / 教堂的时代形体几何（2026-10，见 时代建筑外观规划.md）----
      ridge: new THREE.BoxGeometry(0.70, 0.05, 0.05),              // 田埂（城邦石砌）
      furrow: new THREE.BoxGeometry(0.06, 0.04, 0.62),             // 田垄（封建条带）
      flatBed: new THREE.BoxGeometry(0.74, 0.05, 0.74),            // 整块田床（工业机械化）
      shedBarn: new THREE.BoxGeometry(0.30, 0.18, 0.22),           // 田头仓房
      growTray: new THREE.BoxGeometry(0.66, 0.04, 0.12),           // 垂直农场层板
      millTower: new THREE.CylinderGeometry(0.07, 0.09, 0.34, 6),  // 磨坊塔身（封建）
      millBlade: new THREE.BoxGeometry(0.04, 0.26, 0.02),          // 风车叶片
      menhir: new THREE.BoxGeometry(0.10, 0.36, 0.08),             // 立石/巨石阵柱（蛮荒）
      postBeam: new THREE.BoxGeometry(0.62, 0.08, 0.10),           // 石楣横梁
      bellTower: new THREE.BoxGeometry(0.22, 0.42, 0.22),          // 方形钟楼（工业时代）
      haloRing: new THREE.TorusGeometry(0.20, 0.02, 4, 10),         // 悬浮光环（星际教堂）
      gothicArch: new THREE.BoxGeometry(0.07, 0.20, 0.03),         // 尖拱窗（哥特）
    };
    this._matCache = new Map();
    this._wildHeights = null;
    this._wildHeightsMeta = null;
    this._terrainBufMeta = null;
    this._terrainPos = null;
    this._terrainCol = null;
    this._terrainCorner = null;
    this._terrainIdx = null;
    this._terrainIdxMeta = null;
    this._terrainGeoMeta = null;
    this._wildInst = null;
    this._skyCanvas = document.createElement('canvas');
    // 宽度不能是 2：背景纹理会被拉伸到整个视口，任何 x 方向的像素差都会变成整条横向色带
    this._skyCanvas.width = 512; this._skyCanvas.height = 256;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    this._builtCount = {1:0,2:0,3:0,4:0};
  }

  _mat(color, opts){
    const key = `${color}|${opts?.roughness ?? 0.9}|${opts?.metalness ?? 0}|${opts?.transparent?1:0}|${opts?.opacity ?? 1}`;
    if(this._matCache.has(key)) return this._matCache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color, flatShading:true,
      roughness: opts?.roughness ?? 0.9,
      metalness: opts?.metalness ?? 0.0,
      transparent: !!opts?.transparent,
      opacity: opts?.opacity ?? 1,
    });
    this._matCache.set(key, m);
    return m;
  }

  _basicMat(color){
    const key = `basic|${color}`;
    if(this._matCache.has(key)) return this._matCache.get(key);
    const m = new THREE.MeshBasicMaterial({ color });
    this._matCache.set(key, m);
    return m;
  }

  // ---- 天空：随时代 + 昼夜混合（复用 canvas，避免每帧新建）----
  _buildSkyTexture(era, dayTime){
    const p = PALETTES[era];
    const sun = sampleSun(dayTime);
    const dayK = sun.day;
    const sky0 = lerpHex(p.nightSky0, p.sky0, dayK);
    const sky1 = lerpHex(p.nightSky1, p.sky1, dayK);
    const sky2 = lerpHex(p.nightSky2, p.sky2, dayK);
    const glow = lerpHex(0x1a2040, p.glow, dayK);

    const cv = this._skyCanvas;
    const ctx = cv.getContext('2d');
    const c0 = new THREE.Color(sky0), c1 = new THREE.Color(sky1), c2 = new THREE.Color(sky2);
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0,    `#${c0.getHexString()}`);
    grad.addColorStop(0.55, `#${c1.getHexString()}`);
    grad.addColorStop(1.0,  `#${c2.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cv.width, 256);

    const glowC = new THREE.Color(glow);
    const glowGrad = ctx.createLinearGradient(0, 190, 0, 256);
    const ga = p.glowA * (0.35 + dayK*0.65);
    glowGrad.addColorStop(0, `rgba(${(glowC.r*255|0)},${(glowC.g*255|0)},${(glowC.b*255|0)},0)`);
    glowGrad.addColorStop(1, `rgba(${(glowC.r*255|0)},${(glowC.g*255|0)},${(glowC.b*255|0)},${ga})`);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 190, cv.width, 66);

    // 星空（夜间）：二维分布，避免整行拉伸成横向条纹
    if(dayK < 0.45){
      ctx.fillStyle = `rgba(255,255,255,${0.7*(1-dayK/0.45)})`;
      for(let i=0;i<140;i++){
        const sx = (i*211 + i*i*37) % cv.width;
        const sy = (i*i*13 + i*7) % 180;
        const sz = (i%9===0) ? 2 : 1;
        ctx.fillRect(sx, sy, sz, sz);
      }
    }

    if(!this.skyTex){
      this.skyTex = new THREE.CanvasTexture(cv);
      this.skyTex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.skyTex;
    } else {
      this.skyTex.needsUpdate = true;
    }
  }

  _ensureWildHeights(seed, ox, oy, W, H){
    const meta = `${seed}|${ox}|${oy}|${W}|${H}`;
    if(this._wildHeights && this._wildHeightsMeta === meta) return;
    const n = W * H;
    const heights = new Float32Array(n);
    // 增量重建：种子不变且旧网格是新网格的子矩形时，直接拷贝旧值，
    // 只对新增环带跑 sampleHeight（全量重噪声在边界每扩一格时要重算数十万点）
    let prevX0 = 0, prevY0 = 0, prevX1 = -1, prevY1 = -1;
    const prev = this._wildHeights, pm = this._wildHeightsMeta;
    if(prev && pm){
      const parts = pm.split('|');
      const ps = parts[0]|0, pox = parts[1]|0, poy = parts[2]|0, pW = parts[3]|0, pH = parts[4]|0;
      if(ps === seed && prev.length === pW*pH
        && pox >= ox && poy >= oy && pox + pW <= ox + W && poy + pH <= oy + H){
        for(let gy=0; gy<pH; gy++){
          const dst = (poy - oy + gy) * W + (pox - ox);
          heights.set(prev.subarray(gy*pW, gy*pW + pW), dst);
        }
        prevX0 = pox - ox; prevY0 = poy - oy;
        prevX1 = prevX0 + pW - 1; prevY1 = prevY0 + pH - 1;
      }
    }
    for(let gy=0; gy<H; gy++){
      const inPrevRow = gy >= prevY0 && gy <= prevY1;
      for(let gx=0; gx<W; gx++){
        if(inPrevRow && gx >= prevX0 && gx <= prevX1) continue;
        const wx = ox + gx - 1;
        const wy = oy + gy - 1;
        heights[gy*W+gx] = sampleHeight(wx, wy, seed);
      }
    }
    this._wildHeights = heights;
    this._wildHeightsMeta = meta;
  }

  // 高空云平面：比地形高很多，缓慢漂移
  _buildClouds(center){
    const size = 220;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,256,256);
    // 云斑必须由种子决定：否则同一 ?seed= 每次刷新天空都不一样
    const mSeed = /[?&]seed=(\d+)/.exec(location.search);
    const rand = mulberry32(mSeed ? (mSeed[1]|0) : 1);
    // 软云斑：每个云斑在 3×3 偏移上重复绘制，保证平铺后接缝处连续（否则 repeat 出现硬边）
    for(let i=0;i<28;i++){
      const x = rand()*256, y = rand()*256;
      const r = 18 + rand()*42;
      for(let oy=-1; oy<=1; oy++){
        for(let ox=-1; ox<=1; ox++){
          const cx = x + ox*256, cy = y + oy*256;
          if(cx < -r || cx > 256+r || cy < -r || cy > 256+r) continue;
          const g = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
          g.addColorStop(0, 'rgba(255,255,255,0.55)');
          g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5,5);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cloudTex = tex;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI/2);
    this.cloudMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent:true, opacity:0.55, depthWrite:false, side:THREE.DoubleSide
    }));
    this.cloudMesh.position.set(center, 34, center); // 明显高于山体与建筑
    this.scene.add(this.cloudMesh);
  }

  updateClouds(t, dayK){
    if(!this.cloudMesh) return;
    const c = 0;
    this.cloudMesh.position.set(c + Math.sin(t*0.02)*6, 34, c + Math.cos(t*0.015)*4);
    if(this.cloudTex) this.cloudTex.offset.set((t*0.004)%1, (t*0.002)%1);
    this.cloudMesh.material.opacity = 0.25 + dayK*0.4;
    // MeshBasicMaterial 不吃光照：必须手动按昼夜着色，否则入夜后云仍是纯白
    this.cloudMesh.material.color.setHex(lerpHex(0x435178, 0xfdfdfd, dayK));
  }

  // 每帧轻量更新日照（天空每 0.5s 重建即可）
  updateDayLight(dayTime, era){
    this.dayTime = dayTime;
    const sun = sampleSun(dayTime);
    const p = PALETTES[era];
    const c = this._focus.x, cz = this._focus.z;
    const R = 55;
    const elev = Math.max(0.08, sun.elev);
    const x = Math.cos(sun.azim*Math.PI) * R;
    const z = Math.sin(sun.azim*Math.PI) * R;
    this.sun.position.set(c + x, elev*R*0.9, cz + z);
    this.sunTarget.position.set(c, 0, cz);
    this.sun.color.setHex(sun.sun);
    this.sun.intensity = sun.inten;
    this.hemi.intensity = sun.hemi;
    this.hemi.color.setHex(lerpHex(0x5a6a9a, 0xd8ecf8, sun.day));
    this.hemi.groundColor.setHex(lerpHex(0x2a3048, 0x7a8a5a, sun.day));
    this.ambient.color.setHex(sun.amb);
    // 环境光保底：ACES 会显著压暗低亮度区，夜间原值会让画面接近纯黑
    this.ambient.intensity = 0.45 + sun.day*0.14;
    // 雾色：夜冷昼暖（夜间不要太深）
    const fogDay = p.fog;
    const fogNight = lerpHex(0x1a2438, p.fog, 0.22);
    this.scene.fog.color.setHex(lerpHex(fogNight, fogDay, sun.day));
    if(this.waterMesh){
      this.waterMesh.material.color.setHex(lerpHex(0x1a3050, p.water, 0.35+sun.day*0.65));
    }
  }

  makeHover(){
    const g = new THREE.RingGeometry(0.42, 0.5, 6);
    g.rotateX(-Math.PI/2);
    const m = new THREE.MeshBasicMaterial({ color:0xffd54f, transparent:true, opacity:0.85, side:THREE.DoubleSide });
    this.hoverMesh = new THREE.Mesh(g, m);
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // ---- 管理区角点高度 ----
  _cornerH(G, gx, gy){
    let sum=0, n=0;
    for(let dy=0; dy<=1; dy++)
      for(let dx=0; dx<=1; dx++){
        const t = getTile(G, gx-dx+1, gy-dy+1);
        if(t){ sum += t.water ? WATER_Y : t.h; n++; }
      }
    return n ? sum/n : 0;
  }

  _cornerAdjWater(G, gx, gy){
    for(let dy=0; dy<=1; dy++)
      for(let dx=0; dx<=1; dx++){
        const t = getTile(G, gx-dx+1, gy-dy+1);
        if(t && t.water) return true;
      }
    return false;
  }

  // 阴影/日照框跟随城区：正交框外的一律没有阴影，必须随区块范围更新
  _syncShadow(cx, cz, half){
    this._focus.x = cx; this._focus.z = cz;
    const R = Math.max(20, Math.min(120, half));
    if(Math.abs(R - this._shadowR) < 0.5) return;
    this._shadowR = R;
    const cam = this.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.updateProjectionMatrix();
  }

  // ---- 地形 Mesh：已生成区块 + 旷野延伸 ----
  buildTerrain(G){
    const seed = G.seed|0;
    const era = G.era;
    const b = chunkBounds(G);
    // 城区中心与半径（世界坐标）：阴影框与日照焦点跟随城区而非死锁在原点
    this._syncShadow(
      (b.minX + b.maxX) * 0.5 * TILE,
      (b.minY + b.maxY) * 0.5 * TILE,
      Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.5 * TILE + 8
    );
    const ox = b.minX - WILD, oy = b.minY - WILD;
    const GW = (b.maxX - b.minX + 1) + WILD*2;
    const GH = (b.maxY - b.minY + 1) + WILD*2;
    const W = GW+1, H = GH+1;
    this._ensureWildHeights(seed, ox, oy, W, H);
    const wildH = this._wildHeights;
    // 缓冲复用：尺寸不变时不再每帧重建时新分配数百 KB 的 TypedArray（GC 压力主源）
    const bufMeta = `${W}|${H}`;
    if(this._terrainBufMeta !== bufMeta){
      this._terrainPos = new Float32Array(W*H*3);
      this._terrainCol = new Float32Array(W*H*3);
      this._terrainCorner = new Float32Array(W*H);
      this._terrainBufMeta = bufMeta;
    }
    const positions = this._terrainPos;
    const colors = this._terrainCol;

    const heightOf = (wx, wy)=>{
      const t = getTile(G, wx, wy);
      // 用水面下真实高程，河床/湖底有起伏，水面另铺一层
      if(t) return t.h;
      const gx = wx - ox + 1, gy = wy - oy + 1;
      if(gx>=0 && gx<W && gy>=0 && gy<H){
        const h = wildH[gy*W+gx];
        return Number.isFinite(h) ? h : 0;
      }
      let h = sampleHeight(wx, wy, seed);
      return h;
    };

    // 角点高度 = 周围 4 格均值
    const cornerH = (gx, gy)=>{
      const wx = ox + gx - 1;
      const wy = oy + gy - 1;
      let sum=0,n=0;
      for(let dy=0;dy<=1;dy++)
        for(let dx=0;dx<=1;dx++){
          sum += heightOf(wx+dx, wy+dy); n++;
        }
      return n? sum/n : 0;
    };

    // 先算所有角点高度一次，颜色阶段复用
    const cornerHeights = this._terrainCorner;
    for(let gy=0; gy<H; gy++){
      for(let gx=0; gx<W; gx++){
        cornerHeights[gy*W+gx] = cornerH(gx, gy);
      }
    }

    for(let gy=0; gy<H; gy++){
      for(let gx=0; gx<W; gx++){
        const i = (gy*W+gx)*3;
        const h = cornerHeights[gy*W+gx];
        positions[i]   = (ox + gx)*TILE - TILE*0.5;
        positions[i+1] = h;
        positions[i+2] = (oy + gy)*TILE - TILE*0.5;
        const wx = ox+gx-1, wy = oy+gy-1;
        const tile = getTile(G, wx, wy);
        const inManaged = !!tile;
        const hR = gx+1<W ? cornerHeights[gy*W+gx+1] : h;
        const hD = gy+1<H ? cornerHeights[(gy+1)*W+gx] : h;
        let c;
        if(inManaged){
          // 用真实高程着色（河床/沙滩），不再把邻水格整块染蓝
          c = cornerColor(h, false, hR, hD, era);
        } else {
          c = cornerColor(h, h <= WATER_Y, hR, hD, era);
          const dcx = wx - b.cx, dcy = wy - b.cy;
          const d = Math.sqrt(dcx*dcx+dcy*dcy) / Math.max(8, (b.maxX-b.minX)/2 + WILD*0.6);
          const dim = 1 - Math.min(0.35, d*0.4);
          c = { r:c.r*dim, g:c.g*dim, b:c.b*dim };
        }
        colors[i]=c.r; colors[i+1]=c.g; colors[i+2]=c.b;
      }
    }

    // 索引拓扑只由 W/H 决定：缓存为 Uint32Array，尺寸不变时零分配（原 push 普通数组每次重建 ~2MB）
    if(this._terrainIdxMeta !== bufMeta || !this._terrainIdx){
      const idx = new Uint32Array((W-1)*(H-1)*6);
      let p = 0;
      for(let gy=0; gy<H-1; gy++){
        for(let gx=0; gx<W-1; gx++){
          const a = gy*W+gx, b=gy*W+gx+1, c=(gy+1)*W+gx, d=(gy+1)*W+gx+1;
          idx[p++]=a; idx[p++]=c; idx[p++]=b; idx[p++]=b; idx[p++]=c; idx[p++]=d;
        }
      }
      this._terrainIdx = idx;
      this._terrainIdxMeta = bufMeta;
    }

    const geoMeta = bufMeta;
    if(!this.terrainMesh){
      this.terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:0.95, metalness:0.0 }));
      this.terrainMesh.receiveShadow = true;
      this.terrainMesh.castShadow = true;   // 地形自身也要投影，否则山体没有自阴影
      this.scene.add(this.terrainMesh);
    }
    const g = this.terrainMesh.geometry;
    if(this._terrainGeoMeta !== geoMeta){
      // 尺寸变化（城区扩张）才重建 GPU 缓冲；否则原地更新，避免 dispose/上传抖动
      g.dispose();
      // F1：computeVertexNormals 复用已存在的 normal 属性且不校验 count；扩张后旧 normal
      // 缓冲比新 position 小，WebKit 严格校验 active attribute → glDrawElements
      // INVALID_OPERATION 并跳过地形 draw call（整块地形消失）。删除旧 normal，
      // 让下方 computeVertexNormals 按新尺寸重建。
      g.deleteAttribute('normal');
      g.setAttribute('position', new THREE.BufferAttribute(positions,3));
      g.setAttribute('color', new THREE.BufferAttribute(colors,3));
      g.setIndex(new THREE.BufferAttribute(this._terrainIdx,1));
      this._terrainGeoMeta = geoMeta;
    } else {
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('color').needsUpdate = true;
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();

    // 旷野装饰：低频重建（时代切换/初始化），避免刷地形时卡顿
    if(!this._wildBuilt || this._wildEra !== era){
      this._buildWildDeco(G, ox, oy, GW, GH, seed, era);
      this._wildBuilt = true;
      this._wildEra = era;
    }
  }

  _clearWildInst(){
    if(!this._wildInst) return;
    for(const m of this._wildInst){
      this.decoGroup.remove(m.mesh);
      // 几何来自 _geo 共享缓存，不可 dispose（会连带销毁仍在复用的几何）；
      // 但 InstancedMesh.dispose() 释放的是**实例缓冲**（instanceMatrix）——
      // 它是每次重建新建的 GPU 资源，必须释放，否则每次重建泄漏一份。
      m.mesh.dispose();
    }
    this._wildInst = null;
  }

  /** 与地形网格一致的「格心」高度：自格+四邻平均，避免建筑埋进坡里 */
  _surfaceY(G, x, y){
    const hOf = (wx, wy)=>{
      const t = getTile(G, wx, wy);
      if(t) return t.water ? WATER_Y : Math.max(MIN_H_SAFE, t.h);
      return Math.max(MIN_H_SAFE, sampleHeight(wx, wy, G.seed));
    };
    const h = (
      hOf(x, y) + hOf(x+1, y) + hOf(x-1, y) + hOf(x, y+1) + hOf(x, y-1)
    ) / 5;
    return h;
  }

  _buildWildDeco(G, ox, oy, GW, GH, seed, era){
    this._clearWildInst();
    const p = PALETTES[era];
    const step = 3;
    const trunkMat = this._mat(0x6d4c2a);
    const topMat = this._mat(p.tree);
    const rockMat = this._mat(0x8a8478);

    const trunks=[], topsCone=[], topsIco=[], rocks=[];
    for(let wy=oy; wy<oy+GH; wy+=step){
      for(let wx=ox; wx<ox+GW; wx+=step){
        if(getTile(G, wx, wy)) continue;
        // 必须用 sampleHeight（含河道），否则河床上会长树
        const h = sampleHeight(wx+0.5, wy+0.5, seed);
        if(h <= WATER_Y+0.18) continue;
        const r = ((wx*73856093) ^ (wy*19349663) ^ seed) >>> 0;
        const rn = (r % 1000)/1000;
        if(rn < 0.14 && h>1.45 && h<5.6){
          const sx = wx*TILE+0.5*((r%7)/7-0.5);
          const sz = wy*TILE+0.5*(((r>>3)%7)/7-0.5);
          const s = 0.7+((r>>4)%10)/20;
          const useAlt = ((r>>8)&1)===1;
          // 树根略抬，减少与地表 z-fight
          trunks.push({x:sx, y:h+0.12, z:sz, s:1});
          if(useAlt) topsIco.push({x:sx, y:h+0.48, z:sz, s});
          else topsCone.push({x:sx, y:h+0.78, z:sz, s});
        } else if(rn < 0.26 && h>2.6){
          rocks.push({x:wx*TILE, y:h+0.08, z:wy*TILE, s:0.6+rn});
        }
      }
    }

    const mkInst = (geo, mat, list, cast=false)=>{
      if(!list.length) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const dummy = new THREE.Object3D();
      for(let i=0;i<list.length;i++){
        const it = list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.scale.setScalar(it.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.decoGroup.add(mesh);
      return mesh;
    };

    this._wildInst = [
      {mesh: mkInst(this._geo.treeTrunk, trunkMat, trunks, false)},
      {mesh: mkInst(this._geo.treeTop, topMat, topsCone, false)},
      {mesh: mkInst(this._geo.treeTop2, topMat, topsIco, false)},
      {mesh: mkInst(this._geo.rock, rockMat, rocks, false)},
    ].filter(x=>x.mesh);
  }

  // ---- 水面：略低于岸线，柔和透明 + 纹理滚动 ----
  buildWater(G){
    const p = PALETTES[G.era];
    const b = chunkBounds(G);
    const size = ((b.maxX-b.minX+1) + WILD*2 + 50) * TILE;
    // 世界扩张时重建水面几何
    if(this.waterMesh && this._waterSize && size > this._waterSize * 1.12){
      this.scene.remove(this.waterMesh);
      // 水面几何是本函数内新建的（不入 _geo 缓存），随网格一起释放
      this.waterMesh.geometry?.dispose();
      // 以下三项每次重建都会新建，之前未释放 —— 每次「世界扩张 >12%」泄漏
      // 1 张贴图（_waveTex）+ 1 个标准材质 + glow 的 clone 几何与 Basic 材质
      const oldGlow = this.waterGlow;
      if(oldGlow){
        oldGlow.geometry?.dispose();
        oldGlow.material?.dispose();
      }
      this.waterMesh.material?.dispose();
      this._waveTex?.dispose();
      this._waveTex = null;
      this.waterMesh = null;
      this.waterGlow = null;
    }
    this._waterSize = Math.max(this._waterSize || 0, size);
    if(!this.waterMesh){
      const g = new THREE.PlaneGeometry(size, size, 1, 1);
      g.rotateX(-Math.PI/2);
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,128,128);
      // G-10 修复：焦散纹理原用裸 Math.random，每次重建花纹都不同，
      // 破坏「同种子 → 同世界」的确定性约定；改为世界种子派生的 mulberry32。
      const wrand = mulberry32(((G.seed|0) || 1) ^ 0x5eed1);
      for(let i=0;i<56;i++){
        const x = wrand()*128, y = wrand()*128;
        const rx = 3 + wrand()*16, ry = 1.2 + wrand()*3.5;
        const g2 = ctx.createRadialGradient(x,y,0,x,y,rx);
        g2.addColorStop(0, 'rgba(255,255,255,0.45)');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.translate(x,y);
        ctx.rotate((wrand()-0.5)*0.8);
        ctx.scale(1, ry/rx);
        ctx.translate(-x,-y);
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(x,y,rx,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      this._waveTex = new THREE.CanvasTexture(cv);
      this._waveTex.wrapS = this._waveTex.wrapT = THREE.RepeatWrapping;
      this._waveTex.repeat.set(6, 6);
      this._waveTex.colorSpace = THREE.SRGBColorSpace;

      this.waterMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color:p.water, transparent:true, opacity:0.48,
        roughness:0.35, metalness:0.15,
        map: this._waveTex,
        emissiveMap: this._waveTex,
        emissive: new THREE.Color(p.deep),
        emissiveIntensity: 0.10,
        depthWrite: false,
        flatShading:false
      }));
      this.waterMesh.receiveShadow = true;   // 水面也要接阴影，否则山影里的湖面依旧发亮
      this.waterMesh.renderOrder = 2;
      const glow = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial({
        color: 0x9cc4b8, transparent:true, opacity:0.05, depthWrite:false,
        blending: THREE.AdditiveBlending
      }));
      glow.position.y = 0.02;
      glow.renderOrder = 3;
      this.waterGlow = glow;
      this.waterMesh.add(glow);
      this.scene.add(this.waterMesh);
    } else {
      this.waterMesh.material.color.set(p.water);
    }
    // 水面略低于岸顶，减少与沙滩 z-fighting
    this._waterBaseY = WATER_Y - 0.04;
    this.waterMesh.position.set(b.cx, this._waterBaseY, b.cy);
  }

  updateWater(t){
    if(!this.waterMesh || !this._waveTex) return;
    // 明显流动：双层 UV 速度差 + 慢旋转
    const t1 = (t*0.055)%1;
    const t2 = (t*0.032)%1;
    this._waveTex.offset.set(t1, t2);
    this._waveTex.center.set(0.5, 0.5);
    this._waveTex.rotation = Math.sin(t*0.08)*0.05;
    this.waterMesh.material.emissiveIntensity = 0.14 + Math.sin(t*0.9)*0.05;
    this.waterMesh.material.opacity = 0.56 + Math.sin(t*0.6)*0.06;
    // 极轻的高度呼吸，强化“活水”感（不与地表 z-fight）
    this.waterMesh.position.y = (this._waterBaseY ?? (WATER_Y - 0.04)) + Math.sin(t*1.3)*0.012;
    if(this.waterGlow){
      this.waterGlow.material.opacity = 0.06 + (Math.sin(t*0.5)+1)*0.04;
      this.waterGlow.position.x = Math.sin(t*0.15)*0.4;
    }
  }

  // ---- 建筑：三区独立建模，互不复用 ----
  makeBuilding(t, era){
    const z = ZONES[t.zone];
    if(z.noBuilding) return this._makeFarm(t, era);
    if(t.zone === 4) return this._makeChurch(t, era);
    if(t.zone === 3) return this._makeFactory(t, era);
    return this._makeHouse(t, era);
  }

  // 农田：按时代形体分派（2026-10，见 时代建筑外观规划.md）
  //   E1 不规则小块+木栅 · E2 石埂方田 · E3 条垄+磨坊 · E4 机械化大块+仓房 · E5 垂直农场层板
  // 配色仍由 FARM_CROP / FARM_SOIL 按时代决定（本轮不改配色），此处只改形体。
  _makeFarm(t, era = 0){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const e = Math.max(0, Math.min(4, era|0));
    const soilMat = this._mat(FARM_SOIL[e] ?? 0x8b6914);
    const cropPal = FARM_CROP[e] || FARM_CROP[0];
    const cropCol = cropPal[varn % cropPal.length];
    const cropMat = this._mat(cropCol);

    const add = (geoKey, mat, scale, pos, rot = null, shadow = true)=>{
      const m = new THREE.Mesh(this._geo[geoKey], mat);
      if(Array.isArray(scale)) m.scale.set(scale[0], scale[1], scale[2]);
      else if(scale !== null) m.scale.setScalar(scale);
      m.position.set(pos[0], pos[1], pos[2]);
      if(rot){ m.rotation.x = rot[0] || 0; m.rotation.y = rot[1] || 0; m.rotation.z = rot[2] || 0; }
      if(shadow) m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
      return m;
    };

    if(e === 0){
      // ---- E1 蛮荒：不规则小块 + 木栅栏 + 零散作物（无规整田埂）----
      add('field', soilMat, [0.80, 1, 0.66], [0.02, 0.03, -0.03], [0, 0.22, 0], false);
      for(let i=0;i<4;i++){
        const cx = -0.24 + i*0.16, cz = (i % 2 ? 0.14 : -0.12);
        add('crop', cropMat, [1, 0.8 + (i%2)*0.25, 1], [cx, 0.15, cz], [0, 0.3 - i*0.2, 0]);
      }
      for(const [fx,fz,ry] of [[0,-0.36,0],[0,0.40,0],[-0.40,0,Math.PI/2]]){
        add('fence', this._mat(0xa08050), null, [fx, 0.10, fz], [0, ry, 0]);
      }
      // 一块翻土（不规则感）
      add('field', soilMat, [0.34, 1, 0.30], [-0.22, 0.04, 0.20], [0, -0.35, 0], false);

    } else if(e === 1){
      // ---- E2 城邦：规整方田 + 石砌矮埂 ----
      add('field', soilMat, null, [0, 0.03, 0], null, false);
      for(let i=-1;i<=1;i++) add('crop', cropMat, [1, 0.9, 1], [i*0.22, 0.16, 0]);
      for(const [fx,fz,ry] of [[0,-0.37,0],[0,0.37,0]]) add('ridge', this._mat(0xb7aea0), null, [fx, 0.05, fz], [0, ry, 0]);
      for(const [fx,fz,rx] of [[-0.37,0,0],[0.37,0,0]]) add('ridge', this._mat(0xb7aea0), null, [fx, 0.05, fz], [0, 0, rx]);

    } else if(e === 2){
      // ---- E3 封建：条带状田垄 + 田头磨坊（部分变体）----
      add('field', soilMat, null, [0, 0.03, 0], null, false);
      for(let i=-1;i<=1;i++) add('furrow', this._mat(0x6d4c41), null, [i*0.22, 0.07, 0], null, false);
      for(let i=0;i<3;i++) add('crop', cropMat, [1, 0.85 + (i%2)*0.2, 1], [0, 0.15, -0.20 + i*0.20], [0, Math.PI/2, 0]);
      if(varn === 2){
        add('millTower', this._mat(0xb7aea0), null, [0.30, 0.17, -0.30]);
        for(let i=0;i<4;i++){
          add('millBlade', this._mat(0x8b6914), null, [0.30, 0.34, -0.30], [0, 0, i*Math.PI/2]);
        }
      }

    } else if(e === 3){
      // ---- E4 工业：整块机械化田 + 田头仓房 + 筒仓 ----
      add('flatBed', soilMat, null, [0, 0.03, 0], null, false);
      for(let i=0;i<3;i++) add('crop', cropMat, [1.25, 0.75, 1], [0, 0.12, -0.20 + i*0.20], [0, Math.PI/2, 0]);
      add('shedBarn', this._mat(0x7a5c4e), null, [-0.26, 0.10, 0.24]);
      add('silo', this._mat(0x9da8ba), [1.1, 0.9, 1.1], [0.28, 0.14, 0.26]);
      add('siloCone', this._mat(0x55616e), [1.1, 0.9, 1.1], [0.28, 0.28, 0.26]);

    } else {
      // ---- E5 星际：垂直农场（多层悬空层板）+ 发光环带 ----
      add('field', soilMat, [0.86, 1, 0.86], [0, 0.03, 0], null, false);
      for(let lv=0; lv<3; lv++){
        const y = 0.14 + lv*0.15;
        add('growTray', this._mat(0x37474f), [1 + lv*0.06, 1, 1], [0, y, -0.16 + lv*0.16]);
        add('crop', cropMat, [1.1, 0.55, 0.55], [0, y + 0.05, -0.16 + lv*0.16]);
      }
      const glow = this._basicMat(0x64ffda);
      add('glowRing', glow, [1.25, 0.5, 1.25], [0, 0.06, 0], null, false);
    }

    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // 居住区：民宅 — 主屋 + 偏屋 + 坡顶 + 门窗 + 前廊
  /**
   * 建筑朝向（弧度）：**构建器与槽位合批必须共用本函数**，否则完工瞬间朝向跳变。
   * 2026-10 审计发现 _syncBuildBatches 只复算了 house/factory，且 factory 一律按锯厂房
   * 0.06 复算 —— 而形体分派给教堂（0.5/0.14/0.10）与土窑(0.6)/作坊/反应堆(0.10) 的
   * 随机朝向全部未被复算，完工瞬间会跳变。
   * house 沿用原表达式以保持既有观感与既有存档一致；church 按时代取 BLD_ROT.church。
   */
  _bldRot(t, era, zone){
    const e = Math.max(0, Math.min(4, era|0));
    const h = ()=> hash2(t._wx|0, t._wz|0, t.variant) - 0.5;
    // 农田（zone 2）的构建器不设朝向，故恒为 0 —— 与 _makeFarm 精确对应
    if(zone === 2) return 0;
    // 教堂（zone 4）：按该时代的实际形态取幅度（E1 巨石阵 0.5 / E2 神庙 0.14 /
    // E3 哥特 0.10 / E4 新古典 0.10 / E5 悬浮光环 0.10）
    if(zone === 4) return h() * BLD_ROT.church[Math.min(e, BLD_ROT.church.length - 1)];
    // 工业（zone 3）：按该时代的实际形态取幅度（E1 土窑 0.6 / E2-E3 作坊 0.10 /
    // E4 锯厂房 0.06 / E5 反应堆 0.10）
    if(zone === 3){
      const form = factoryStyleForEra(e).form;
      const a = form === 'kiln' ? FACTORY_ROT.kiln
              : form === 'workshop' ? FACTORY_ROT.workshop
              : form === 'reactor' ? FACTORY_ROT.reactor
              : 0.06;
      return h() * a;
    }
    // 住房（zone 1）：各时代统一 0.10，与 _makeHouse 一致
    return h() * BLD_ROT.house[0];
  }

  // 居住区民宅：按 BUILDING_STYLE[era].form 选择形体（2026-10，见 时代建筑外观规划.md）。
  // 形体差异是「剪影级」的——远看即可分辨时代，而配色仍由 style 决定（本轮不改配色）。
  // 关键约束：所有几何一律取自 _geo 共享缓存、材质取自 _matCache，禁止在此 new THREE.*，
  // 否则会被逐栋创建，破坏 P3 槽位合批的 (几何,材质,阴影) 聚合前提。
  _makeHouse(t, era){
    const style = BUILDING_STYLE[era] || BUILDING_STYLE[0];
    const form = formForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const bh = Math.max(0.78, style.h * (0.90 + varn*0.08));
    const fp = 0.70;
    // 三型共享的四个材质（_mat 带缓存，重复取用无成本）
    const c = {
      wall: this._mat(style.wall),
      side: this._mat(style.side),
      roof: this._mat(style.roof),
      trim: this._mat(lerpHex(style.wall, 0xffffff, 0.25)),
    };
    grp.rotation.y = this._bldRot(t, era, 1);

    const add = (geoKey, mat, scale, pos, rotY = 0, shadow = true)=>{
      const m = new THREE.Mesh(this._geo[geoKey], mat);
      if(Array.isArray(scale)) m.scale.set(scale[0], scale[1], scale[2]);
      else if(scale !== null) m.scale.setScalar(scale);
      m.position.set(pos[0], pos[1], pos[2]);
      if(rotY) m.rotation.y = rotY;
      if(shadow){ m.castShadow = true; m.receiveShadow = true; }
      grp.add(m);
      return m;
    };

    if(form.body === 'cyl')            this._houseRound(grp, c, { bh, fp, varn, era, style, add });
    else if(form.body === 'longhouse') this._houseLonghouse(grp, c, { bh, fp, varn, era, style, add });
    else                               this._houseBox(grp, c, { bh, fp, varn, era, style, add, form });

    this._houseCommon(grp, c, { bh, fp, varn, era, style, add, form });
    // V3 多体聚落：E3 起 1 地块代表多栋逻辑建筑（BUILD_Q），画面上渲染为「主楼 + 环绕副楼」，
    // 使「1 格 = N 栋」在视觉上可信（否则玩家看到 1 栋房却被告知代表 20 栋）。
    this._houseCluster(grp, c, { bh, fp, varn, era, style });

    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /**
   * BUILD_Q 的多体聚落：在主楼周围补 0–3 个缩小副楼。
   * 副楼与主楼共用几何/材质缓存（仅缩放不同），因此不新增合批槽位 —— 但会按副楼数量增加实例数，
   * 容量按 (1+CLUSTER_MAX) × MAX_BUILD_MESH 预留，见 _ensureBldBatches。
   * 位置取 ±0.30 的有限偏移（不超过地块内切一半），避免与邻格建筑视觉重叠。
   */
  _houseCluster(grp, c, { bh, fp, varn, era, style }){
    const q = buildQ(era);
    if(q <= 1) return;                                   // E1/E2：1 格 = 1 栋，不补副楼
    // 副楼数量随 BUILD_Q 与变体变化（2–3 个）：BUILD_Q 越大，聚落越成片
    const maxSat = Math.min(3, Math.max(2, Math.round(q / 8)));
    const count = Math.min(maxSat, 2 + (varn % 2));
    const off = fp * 0.30;
    // 两点/三点布局：偏移量取 fp*0.30，配合副楼缩放后总外延 ≈0.41，不越地块一半（实测见测试）
    const LAYOUTS = {
      2: [[-off, -off], [off, off]],
      3: [[0, -off], [-off, off], [off, off]],
    };
    const spots = LAYOUTS[count] || LAYOUTS[2];
    const satMat = { wall: c.side, roof: c.roof };
    for(let i=0; i<spots.length; i++){
      const [sx, sz] = spots[i];
      const sh = bh * (0.34 + (i % 2) * 0.10);
      const sw = fp * (0.30 + (i % 3) * 0.04);
      const sb = new THREE.Mesh(this._geo.houseBody, satMat.wall);
      sb.scale.set(sw, sh, sw * 1.04);
      sb.position.set(sx, sh/2, sz);
      sb.castShadow = true; sb.receiveShadow = true;
      grp.add(sb);
      // 副楼顶：按时代取圆顶/坡顶/平顶，保持与主楼同一时代语汇
      const rk = style.form?.roof === 'dome' ? 'domeSmall'
               : (style.form?.roof === 'cone' ? 'coneRoof'
               : (style.form?.roof === 'saw' ? 'wingRoof' : 'gableRoof'));
      const rf = new THREE.Mesh(this._geo[rk] || this._geo.wingRoof, satMat.roof);
      if(rk === 'domeSmall') rf.scale.set(sw*0.72, sw*0.62, sw*0.72);
      else if(rk === 'coneRoof') rf.scale.set(sw*1.5, 0.75, sw*1.5);
      else rf.scale.set(sw*1.25, 0.055, sw*1.35);
      rf.position.set(sx, rk === 'wingRoof' ? sh + 0.03 : sh + (rk === 'coneRoof' ? 0.13 : 0.02), sz);
      if(rk === 'gableRoof') rf.rotation.y = Math.PI/4;
      rf.castShadow = true;
      grp.add(rf);
    }
  }

  /** 民宅配件：门/台阶/门楣/窗/窗台/烟囱 —— 与形体无关，三型共用 */
  _houseCommon(grp, c, { bh, fp, varn, era, style, add, form }){
    const doorZ = fp*0.44;
    add('step', c.side, null, [-fp*0.06, 0.05, doorZ + 0.04], 0, false);
    const door = add('door', c.side, [fp/0.72*0.9, 1.05, 1], [-fp*0.06, 0.16, doorZ], 0, false);
    door.receiveShadow = false;
    add('lintelDoor', c.trim, null, [-fp*0.06, 0.34, doorZ], 0, false);

    const winMat = this._basicMat(style.window || 0xffe08c);
    const winY = Math.min(bh*0.58, Math.max(0.38, bh*0.50));
    for(const wx of [-fp*0.28, fp*0.12]){
      add('window', winMat, null, [wx, winY, fp*0.42], 0, false);
      add('sill', c.trim, null, [wx, winY - 0.08, fp*0.43], 0, false);
    }

    // 烟囱：1 号变体不加（保持轮廓变化）；圆筒屋用细烟管，方屋用砖烟囱
    if(varn !== 0 && bh > 0.8){
      const chim = add('chimney', c.side, null, [fp*0.18, bh + 0.22, -fp*0.16]);
      chim.receiveShadow = false;
    }
    // 竖向光带（星际）：贴在墙体侧面的自发光条
    if((form.extras || []).includes('glowBand') && style.glow){
      const gm = this._basicMat(style.glow);
      for(const gx of [-fp*0.40, fp*0.40]){
        add('glowBand', gm, [1, bh/bh, 1], [gx, bh*0.55, -fp*0.10], 0, false);
      }
    }
  }

  /** E1 蛮荒：圆形地基 + 上窄下宽圆筒墙 + 圆锥草顶 —— 与方屋形成「圆 vs 方」的年代分界 */
  _houseRound(grp, c, { bh, fp, varn, era, style, add }){
    add('padRound', c.side, [fp*1.30, 1, fp*1.30], [0, 0.02, 0], 0, false).receiveShadow = true;

    const body = add('bodyCyl', c.wall, [fp*1.02, bh, fp*1.02], [0, bh/2, 0]);
    body.receiveShadow = true;

    // 草顶：圆锥 + 屋檐挑出（比墙体宽，形成明显草棚剪影）
    add('coneRoof', c.roof, [fp*1.55, 1, fp*1.55], [0, bh + 0.19, 0]);
    add('thatch', this._mat(style.decoCol), fp/0.72, [0, bh + 0.02, 0], Math.PI/4);
    // 顶部草束（加高锥顶，强化"茅草"观感）
    add('coneRoof', c.roof, [fp*0.55, 0.85, fp*0.55], [0, bh + 0.40, 0], 0.6);
  }

  /** E4 工业：低矮长屋 + 锯齿屋顶 + 筒仓 —— 厂房轮廓，与民居/教堂区分 */
  _houseLonghouse(grp, c, { bh, fp, varn, era, style, add }){
    const lw = fp*0.86, ll = fp*1.55, lh = bh*0.82;
    add('pad', c.side, [lw*1.22, 1, ll*1.10], [0, 0.02, 0], 0, false).receiveShadow = true;

    const body = add('houseBody', c.wall, [lw, lh, ll], [0, lh/2, 0]);
    body.receiveShadow = true;
    // 端部高体（厂房常见的错落体量）
    add('houseBody', c.side, [lw*0.55, lh*1.35, ll*0.30], [-lw*0.35, lh*1.35/2, ll*0.42]);

    // 锯齿屋顶：3 个三棱柱（ConeGeometry seg=3）沿长边排开 —— 工业时代的招牌剪影
    for(let i=0;i<3;i++){
      const zz = -ll*0.30 + ll*0.30*i;
      add('sawTooth', c.roof, [lw/0.16, 1, ll*0.30/0.14], [0, lh + 0.07, zz]);
      add('sawGlass', this._basicMat(style.window || 0xffe08c), null, [lw*0.30, lh + 0.09, zz], 0, false);
    }
    // 筒仓（2 个，一高一矮）
    for(const [sx, sh] of [[lw*0.52, 1.15], [-lw*0.52, 0.85]]){
      add('silo', c.side, [1, sh, 1], [sx, sh*0.15, -ll*0.30]);
      add('siloCone', c.roof, [1, sh, 1], [sx, sh*0.15 + 0.15, -ll*0.30]);
    }
  }

  /** E2/E3/E5 方体屋：主体 + 偏屋 + 坡顶/尖顶/穹顶，按 form.roof 选屋顶 */
  _houseBox(grp, c, { bh, fp, varn, era, style, add, form }){
    add('pad', c.side, [fp*1.18, 1, fp*1.18], [0, 0.02, 0], 0, false).receiveShadow = true;

    const body = add('houseBody', c.wall, [fp*0.72, bh, fp*0.86], [-fp*0.06, bh/2, 0]);
    body.receiveShadow = true;

    const wingH = bh * (0.55 + varn*0.08);
    const wing = add('houseBody', c.side, [fp*0.42, wingH, fp*0.55], [fp*0.28, wingH/2, -fp*0.08]);
    wing.receiveShadow = true;
    add('wingRoof', c.roof, [fp*0.48, 0.06, fp*0.60], [fp*0.28, wingH + 0.03, -fp*0.08]);
    add('eave', c.roof, [fp*0.82/0.78, 1, fp*0.96/0.78], [-fp*0.06, bh - 0.015, 0]);
    add('window', this._basicMat(style.window || 0xffe08c), null, [fp*0.28, wingH*0.55, fp*0.20], 0, false);

    const roof = form?.roof || 'pyramid';
    if(roof === 'dome'){
      // E5 星际：大穹顶 + 发光环带（主穹顶在 _houseCluster 里补副穹顶）
      add('glowRing', this._basicMat(style.glow || 0x40a8cc), [fp*1.30, 1, fp*1.30], [-fp*0.06, bh + 0.01, 0], 0, false);
      add('domeBig', this._mat(style.roof), [fp*1.05, 0.92, fp*1.25], [-fp*0.06, bh, 0]);
    } else {
      const key = roof === 'steep' ? 'steepRoof' : (roof === 'gable' ? 'gableRoof' : 'roof');
      const hMul = roof === 'steep' ? 1.0 : (roof === 'gable' ? 1.0 : (0.88 + varn*0.08));
      add(key, c.roof, [fp*0.95/0.52, hMul, fp*1.05/0.52], [-fp*0.06, bh + 0.22, 0], Math.PI/4);
      // 陡尖顶额外加一枚小尖塔（封建时代的竖向特征）
      if(roof === 'steep') add('smallSpire', c.roof, null, [-fp*0.06, bh + 0.62, 0]);
    }

    // 柱廊（城邦）：正面两根圆柱 + 三角楣
    if((form?.extras || []).includes('columns')){
      for(const cx of [-fp*0.36, fp*0.24]){
        add('column', c.trim, null, [cx, 0.17, fp*0.50], 0, false);
      }
      add('pediment', c.roof, [1, 1, 1], [-fp*0.06, 0.44, fp*0.50], Math.PI/4);
    }
    // 飞扶壁（封建）：两侧斜靠薄板
    if((form?.extras || []).includes('buttress')){
      for(const bx of [-1, 1]){
        const b = add('buttress', c.side, null, [bx*fp*0.52, bh*0.34, -fp*0.06], 0);
        b.rotation.z = bx * 0.28;
      }
    }
    // 筒仓（工业）
    if((form?.extras || []).includes('silo')){
      add('silo', c.side, [1, 1.1, 1], [fp*0.52, 0.17, -fp*0.36]);
      add('siloCone', c.roof, [1, 1.1, 1], [fp*0.52, 0.32, -fp*0.36]);
    }
  }

  // 信仰区：教堂 — 奶油石墙、深石板尖顶、尖塔十字、玫瑰窗
  _makeChurch(t, era){
    const e = Math.max(0, Math.min(4, era|0));
    if(e === 0) return this._makeChurchMegalith(t, era);
    if(e === 1) return this._makeChurchTemple(t, era);
    if(e === 3) return this._makeChurchNeoclassic(t, era);
    if(e === 4) return this._makeChurchStar(t, era);
    return this._makeChurchGothic(t, era);
  }

  /** E1 蛮荒：巨石阵 —— 一圈立石 + 石楣横梁，无屋顶无尖塔 */
  _makeChurchMegalith(t, era){
    const C = churchStyleForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const r = 0.30 + varn*0.02;
    const stoneMat = this._mat(C.stone);
    const wallMat = this._mat(C.wall);

    const pad = new THREE.Mesh(this._geo.padRound, stoneMat);
    pad.scale.set(r*3.4, 1, r*3.4);
    pad.position.y = 0.02; pad.receiveShadow = true;
    grp.add(pad);

    // 8 根立石围成环
    const N = 8;
    const h = 0.30 + varn*0.05;
    for(let i=0;i<N;i++){
      const a = i / N * Math.PI*2;
      const m = new THREE.Mesh(this._geo.menhir, stoneMat);
      m.scale.set(1, h/0.36, 1);
      m.position.set(Math.cos(a)*r, h/2, Math.sin(a)*r);
      m.rotation.y = -a;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    // 石楣横梁（只架四段，留出入口感）
    for(let i=0;i<4;i++){
      const a = (i + 0.5) / 4 * Math.PI*2;
      const beam = new THREE.Mesh(this._geo.postBeam, stoneMat);
      beam.scale.set(r*1.9, 1, 1);
      beam.position.set(Math.cos(a)*r*0.92, h + 0.04, Math.sin(a)*r*0.92);
      beam.rotation.y = -a + Math.PI/2;
      beam.castShadow = true;
      grp.add(beam);
    }
    // 中央祭坛石
    const altar = new THREE.Mesh(this._geo.houseBody, wallMat);
    altar.scale.set(0.22, 0.10, 0.22);
    altar.position.y = 0.05;
    altar.castShadow = true; altar.receiveShadow = true;
    grp.add(altar);

    grp.rotation.y = this._bldRot(t, era, 4);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E2 城邦：柱廊神庙 —— 平顶方体 + 正面六柱 + 三角楣 */
  _makeChurchTemple(t, era){
    const C = churchStyleForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const w = 0.52 + varn*0.03, d = 0.62 + varn*0.03, h = 0.42 + varn*0.05;
    const wallMat = this._mat(C.wall);
    const stoneMat = this._mat(C.stone);
    const roofMat = this._mat(C.roof);

    const pad = new THREE.Mesh(this._geo.pad, stoneMat);
    pad.scale.set(w*1.3, 1, d*1.25);
    pad.position.y = 0.03; pad.receiveShadow = true;
    grp.add(pad);
    const base = new THREE.Mesh(this._geo.houseBody, stoneMat);
    base.scale.set(w*1.18, 0.06, d*1.15);
    base.position.y = 0.06; base.receiveShadow = true;
    grp.add(base);

    const body = new THREE.Mesh(this._geo.houseBody, wallMat);
    body.scale.set(w, h, d);
    body.position.y = 0.09 + h/2;
    body.castShadow = true; body.receiveShadow = true;
    grp.add(body);
    const cornice = new THREE.Mesh(this._geo.eave, roofMat);
    cornice.scale.set(w*1.16/0.78, 1, d*1.12/0.78);
    cornice.position.y = 0.09 + h + 0.02;
    cornice.castShadow = true;
    grp.add(cornice);
    for(let i=0;i<3;i++){
      for(const side of [-1, 1]){
        const col = new THREE.Mesh(this._geo.column, stoneMat);
        col.scale.set(1, (h + 0.09)/0.34, 1);
        col.position.set((-1 + i) * w*0.36, (h + 0.09)/2, side * d*0.56);
        col.castShadow = true;
        grp.add(col);
      }
    }
    for(const side of [-1, 1]){
      const ped = new THREE.Mesh(this._geo.pediment, roofMat);
      ped.scale.set(w*1.5, 1.0, 1);
      ped.position.set(0, 0.09 + h + 0.10, side * d*0.50);
      ped.rotation.y = Math.PI/4;
      ped.castShadow = true;
      grp.add(ped);
    }

    grp.rotation.y = this._bldRot(t, era, 4);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E4 工业：新古典 —— 平顶 + 山墙 + 方形钟楼（无尖顶，与封建哥特区分） */
  _makeChurchNeoclassic(t, era){
    const C = churchStyleForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const w = 0.56 + varn*0.03, d = 0.60 + varn*0.03, h = 0.50 + varn*0.04;
    const wallMat = this._mat(C.wall);
    const sideMat = this._mat(C.side);
    const roofMat = this._mat(C.roof);

    const pad = new THREE.Mesh(this._geo.pad, sideMat);
    pad.scale.set(w*1.24, 1, d*1.20);
    pad.position.y = 0.03; pad.receiveShadow = true;
    grp.add(pad);
    const body = new THREE.Mesh(this._geo.houseBody, wallMat);
    body.scale.set(w, h, d);
    body.position.y = h/2;
    body.castShadow = true; body.receiveShadow = true;
    grp.add(body);
    const flat = new THREE.Mesh(this._geo.houseBody, roofMat);
    flat.scale.set(w*1.06, 0.04, d*1.06);
    flat.position.y = h + 0.02; flat.castShadow = true;
    grp.add(flat);
    for(const side of [-1, 1]){
      const ped = new THREE.Mesh(this._geo.pediment, wallMat);
      ped.scale.set(w*1.45, 1.1, 1);
      ped.position.set(0, h*0.55, side * d*0.52);
      ped.rotation.y = Math.PI/4;
      grp.add(ped);
    }
    for(let i=0;i<4;i++){
      const col = new THREE.Mesh(this._geo.column, this._mat(C.stone));
      col.scale.set(1, (h*0.62)/0.34, 1);
      col.position.set((-1.5 + i) * w*0.28, h*0.31, d*0.56);
      grp.add(col);
    }
    const tower = new THREE.Mesh(this._geo.bellTower, wallMat);
    tower.scale.set(1, (h*2.0)/0.42, 1);
    tower.position.set(0, h*1.0, -d*0.18);
    tower.castShadow = true; tower.receiveShadow = true;
    grp.add(tower);
    const cap = new THREE.Mesh(this._geo.houseBody, roofMat);
    cap.scale.set(0.26, 0.05, 0.26);
    cap.position.set(0, h*2.0 + 0.03, -d*0.18);
    cap.castShadow = true;
    grp.add(cap);
    const face = new THREE.Mesh(this._geo.rose, this._basicMat(C.glow));
    face.rotation.x = Math.PI/2;
    face.position.set(0, h*1.55, -d*0.18 + 0.13);
    grp.add(face);

    grp.rotation.y = this._bldRot(t, era, 4);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E5 星际：悬浮光环 —— 尖塔 + 环带 + 发光顶球 */
  _makeChurchStar(t, era){
    const C = churchStyleForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const h = 0.78 + varn*0.08;
    const wallMat = this._mat(C.wall);
    const glowMat = this._basicMat(C.glow);

    const pad = new THREE.Mesh(this._geo.padRound, this._mat(C.stone));
    pad.scale.set(1.20, 1, 1.20);
    pad.position.y = 0.02; pad.receiveShadow = true;
    grp.add(pad);
    const ring0 = new THREE.Mesh(this._geo.glowRing, glowMat);
    ring0.scale.set(1.15, 1, 1.15);
    ring0.position.y = 0.06;
    grp.add(ring0);
    const spire = new THREE.Mesh(this._geo.spireTall, wallMat);
    spire.scale.set(1.35, h/0.66, 1.35);
    spire.position.y = 0.06 + h/2;
    spire.rotation.y = Math.PI/4;
    spire.castShadow = true; spire.receiveShadow = true;
    grp.add(spire);
    for(let i=0;i<2;i++){
      const halo = new THREE.Mesh(this._geo.haloRing, glowMat);
      halo.scale.setScalar(1.1 + i*0.45);
      halo.position.y = 0.06 + h*(0.42 + i*0.34);
      halo.rotation.x = Math.PI/2;
      grp.add(halo);
    }
    const ball = new THREE.Mesh(this._geo.spireBall, glowMat);
    ball.scale.setScalar(1.8);
    ball.position.y = 0.06 + h + 0.06;
    grp.add(ball);
    for(let i=0;i<4;i++){
      const a = i/4*Math.PI*2;
      const band = new THREE.Mesh(this._geo.glowBand, glowMat);
      band.scale.set(1, h/0.34, 1);
      band.position.set(Math.cos(a)*0.14, 0.06 + h/2, Math.sin(a)*0.14);
      grp.add(band);
    }

    grp.rotation.y = this._bldRot(t, era, 4);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E3 封建：哥特 —— 高窄中殿 + 尖拱窗 + 高尖塔 + 飞扶壁（原实现改名保留） */
  _makeChurchGothic(t, era){
    const C = churchStyleForEra(era);
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const scale = (1 + era*0.04) * (C.scaleBoost || 1);
    const naveH = (0.95 + varn*0.08) * scale;
    const naveW = 0.52;
    const naveL = 0.78;
    const wallMat = this._mat(C.wall);
    const sideMat = this._mat(C.side);
    const roofMat = this._mat(C.roof);
    const stoneMat = this._mat(C.stone);

    // 石基座
    const pad = new THREE.Mesh(this._geo.pad, stoneMat);
    pad.scale.set(0.72, 1, 0.82);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    grp.add(pad);

    // 中殿（纵向长殿）
    const nave = new THREE.Mesh(this._geo.nave, wallMat);
    nave.scale.set(naveW, naveH, naveL);
    nave.position.set(0, naveH/2, 0.02);
    nave.castShadow = true; nave.receiveShadow = true;
    grp.add(nave);

    // 侧廊（比中殿矮）
    const aisleH = naveH * 0.62;
    const aisle = new THREE.Mesh(this._geo.box, sideMat);
    aisle.scale.set(0.72/0.72, aisleH, (naveL*0.92)/0.72);
    aisle.position.set(0.28, aisleH/2, 0.02);
    aisle.castShadow = true;
    grp.add(aisle);

    // 陡峭人字顶（教堂标志）
    const roof = new THREE.Mesh(this._geo.churchRoof, roofMat);
    roof.position.set(0, naveH + 0.32, 0.02);
    roof.scale.set(naveW/0.42 * 1.15, 1, naveL/0.42 * 0.95);
    roof.rotation.y = Math.PI/4;
    roof.castShadow = true;
    grp.add(roof);

    // 西立面钟塔 + 尖顶 + 十字
    const towerH = naveH * 1.55;
    const tower = new THREE.Mesh(this._geo.churchTower, wallMat);
    tower.scale.set(1, towerH, 1);
    tower.position.set(0, towerH/2, naveL*0.42);
    tower.castShadow = true;
    grp.add(tower);

    const spire = new THREE.Mesh(this._geo.churchSpire, this._mat(C.roofDeep));
    spire.position.set(0, towerH + 0.26, naveL*0.42);
    spire.rotation.y = Math.PI/4;
    spire.castShadow = true;
    grp.add(spire);

    // 十字架（金饰）
    const crossMat = this._mat(C.accent, { roughness:0.4, metalness:0.5 });
    const cv = new THREE.Mesh(this._geo.crossV, crossMat);
    cv.position.set(0, towerH + 0.58, naveL*0.42);
    grp.add(cv);
    const ch = new THREE.Mesh(this._geo.crossH, crossMat);
    ch.position.set(0, towerH + 0.62, naveL*0.42);
    grp.add(ch);

    // 塔顶发光球
    const ball = new THREE.Mesh(this._geo.spireBall, this._basicMat(C.glow));
    ball.position.set(0, towerH + 0.72, naveL*0.42);
    grp.add(ball);

    // 拱门
    const arch = new THREE.Mesh(this._geo.archDoor, this._mat(C.roofDeep));
    arch.position.set(0, 0.12, naveL*0.42 + 0.16);
    grp.add(arch);

    // 玫瑰窗（圆窗）
    const rose = new THREE.Mesh(this._geo.rose, this._basicMat(C.window));
    rose.rotation.x = Math.PI/2;
    rose.position.set(0, towerH*0.72, naveL*0.42 + 0.16);
    grp.add(rose);

    // 侧窗（高窄条）
    const winMat = this._basicMat(C.window);
    for(const wz of [-0.12, 0.12]){
      const w = new THREE.Mesh(this._geo.churchWin, winMat);
      w.position.set(naveW/2 + 0.01, naveH*0.55, wz);
      w.rotation.y = Math.PI/2;
      grp.add(w);
      const w2 = new THREE.Mesh(this._geo.churchWin, winMat);
      w2.position.set(-naveW/2 - 0.01, naveH*0.55, wz);
      w2.rotation.y = Math.PI/2;
      grp.add(w2);
    }

    grp.rotation.y = this._bldRot(t, era, 4);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // 工业区：按时代形体分派（2026-10，见 时代建筑外观规划.md）
  //   E1 土窑 · E2/E3 作坊（单坡+细烟道/水轮） · E4/E5 锯齿厂房（既有造型，工业招牌剪影）
  _makeFactory(t, era){
    const F = factoryStyleForEra(era);
    if(F.form === 'kiln')     return this._makeKiln(t, era, F);
    if(F.form === 'workshop') return this._makeWorkshop(t, era, F);
    if(F.form === 'reactor')  return this._makeReactor(t, era, F);
    return this._makeSawFactory(t, era, F);
  }

  /** E1 蛮荒：土窑 —— 半球窑体 + 窑顶烟孔 + 柴堆，圆形剪影与作坊/厂房区分 */
  _makeKiln(t, era, F){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const r = 0.34 + varn*0.03;
    const earthMat = this._mat(F.brick);          // 夯土/砖色复用工厂色板
    const stoneMat = this._mat(F.side);

    const base = new THREE.Mesh(this._geo.padRound, stoneMat);
    base.scale.set(r*2.6, 1, r*2.6);
    base.position.y = 0.02; base.receiveShadow = true;
    grp.add(base);

    const dome = new THREE.Mesh(this._geo.kilnDome, earthMat);
    dome.scale.set(r*2.3, r*1.9, r*2.3);
    dome.position.y = 0.04;
    dome.castShadow = true; dome.receiveShadow = true;
    grp.add(dome);

    // 窑顶烟孔（冒烟口）
    const hole = new THREE.Mesh(this._geo.kilnHole, stoneMat);
    hole.position.set(0, r*1.9 + 0.04, 0);
    grp.add(hole);

    // 窑口（正面拱口）
    const mouth = new THREE.Mesh(this._geo.archDoor, this._mat(F.roof));
    mouth.position.set(0, 0.12, r*1.06);
    grp.add(mouth);

    // 柴堆（两段横木，强化"蛮荒工业"语义）
    for(let i=0;i<2;i++){
      const log = new THREE.Mesh(this._geo.fence, this._mat(F.brick));
      log.position.set(r*1.35, 0.06 + i*0.07, -r*0.5);
      log.rotation.y = 0.35 + i*0.3;
      grp.add(log);
    }

    grp.rotation.y = this._bldRot(t, era, 3);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E2/E3 作坊：方体 + 单坡顶 + 细烟道；E3 另加外置水轮（封建水力作坊） */
  _makeWorkshop(t, era, F){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const bh = (0.48 + varn*0.05) * (1 + era*0.05);
    const fw = 0.58, fl = 0.66;
    const wallMat = this._mat(F.wall);
    const sideMat = this._mat(F.side);
    const roofMat = this._mat(F.roof);

    const pad = new THREE.Mesh(this._geo.pad, sideMat);
    pad.scale.set(fw*1.18, 1, fl*1.14);
    pad.position.y = 0.02; pad.receiveShadow = true;
    grp.add(pad);

    const body = new THREE.Mesh(this._geo.houseBody, wallMat);
    body.scale.set(fw, bh, fl);
    body.position.y = bh/2;
    body.castShadow = true; body.receiveShadow = true;
    grp.add(body);

    // 单坡顶：斜置薄板（比双坡/锯齿更"手工"）
    const shed = new THREE.Mesh(this._geo.wingRoof, roofMat);
    shed.scale.set(fw*1.12, 0.06, fl*1.18);
    shed.position.set(0, bh + 0.05, 0);
    shed.rotation.z = -0.16;
    shed.castShadow = true;
    grp.add(shed);

    // 细烟道（比方厂房的砖烟囱细，体量小）
    const chim = new THREE.Mesh(this._geo.brickChim, this._mat(F.brick));
    chim.scale.set(0.8, bh*1.5 + 0.3, 0.8);
    chim.position.set(fw*0.30, (bh*1.5 + 0.3)*0.5 + bh*0.4, -fl*0.24);
    chim.castShadow = true;
    grp.add(chim);

    // 木门 + 窗
    const door = new THREE.Mesh(this._geo.door, sideMat);
    door.position.set(0, 0.15, fl*0.5 + 0.01);
    door.scale.set(1.15, 1.0, 1);
    grp.add(door);
    const winMat = this._basicMat(F.window);
    for(const wx of [-fw*0.30, fw*0.30]){
      const w = new THREE.Mesh(this._geo.window, winMat);
      w.position.set(wx, bh*0.62, fl*0.5 + 0.01);
      grp.add(w);
    }

    // E3 水轮：外置圆盘（封建水力作坊特征）
    if(era >= 2){
      const wheel = new THREE.Mesh(this._geo.glowRing, this._mat(F.roof));
      wheel.scale.set(1.7, 1, 1.7);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(-fw*0.72, bh*0.45, 0);
      wheel.castShadow = true;
      grp.add(wheel);
    }

    grp.rotation.y = this._bldRot(t, era, 3);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E5 星际：圆柱反应堆 + 发光环带 */
  _makeReactor(t, era, F){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const rh = 0.72 + varn*0.08;
    const wallMat = this._mat(F.wall);
    const glowMat = this._basicMat(F.eraGlow || F.window);

    const pad = new THREE.Mesh(this._geo.padRound, this._mat(F.side));
    pad.scale.set(1.5, 1, 1.5);
    pad.position.y = 0.02; pad.receiveShadow = true;
    grp.add(pad);

    // 主反应堆柱体（上窄下宽）
    const core = new THREE.Mesh(this._geo.bodyCyl, wallMat);
    core.scale.set(1.5, rh, 1.5);
    core.position.y = rh/2;
    core.castShadow = true; core.receiveShadow = true;
    grp.add(core);

    // 两道发光环带（时代的自发光特征）
    for(let i=0;i<2;i++){
      const ring = new THREE.Mesh(this._geo.glowRing, glowMat);
      ring.scale.set(1.58, 1, 1.58);
      ring.position.y = rh*(0.34 + i*0.38);
      grp.add(ring);
    }

    // 顶盖 + 排气塔
    const cap = new THREE.Mesh(this._geo.padRound, this._mat(F.roof));
    cap.scale.set(1.3, 1, 1.3);
    cap.position.y = rh;
    grp.add(cap);
    const stack = new THREE.Mesh(this._geo.brickChim, this._mat(F.roof));
    stack.scale.set(0.7, 0.34, 0.7);
    stack.position.y = rh + 0.17;
    grp.add(stack);

    grp.rotation.y = this._bldRot(t, era, 3);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  /** E4 工业：锯齿屋顶厂房（原实现，保留为工业时代招牌造型） */
  _makeSawFactory(t, era, F){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const bh = (0.55 + varn*0.06) * (1 + era*0.06);
    const fw = 0.62 + era*0.02;
    const fl = 0.70 + era*0.02;
    const wallMat = this._mat(F.wall);
    const sideMat = this._mat(F.side);
    const roofMat = this._mat(F.roof);
    const brickMat = this._mat(F.brick);

    // 混凝土基座
    const pad = new THREE.Mesh(this._geo.pad, sideMat);
    pad.scale.set(fw*1.15, 1, fl*1.1);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    grp.add(pad);

    // 主厂房（宽扁）
    const shed = new THREE.Mesh(this._geo.shed, wallMat);
    shed.scale.set(fw, bh, fl);
    shed.position.y = bh/2;
    shed.castShadow = true; shed.receiveShadow = true;
    grp.add(shed);

    // 锯齿屋顶条（工业厂房特征）
    const nSaw = 3;
    for(let i=0;i<nSaw;i++){
      const saw = new THREE.Mesh(this._geo.saw, roofMat);
      const sx = -fw/2 + fw*(i+0.5)/nSaw;
      saw.position.set(sx, bh + 0.04, 0);
      saw.castShadow = true;
      grp.add(saw);
      // 采光面
      const glass = new THREE.Mesh(this._geo.sawGlass, this._basicMat(F.window));
      glass.position.set(sx + 0.05, bh + 0.12, fl*0.28);
      grp.add(glass);
    }

    // 砖烟囱（比房高很多，工业标识）
    const chimH = Math.min(1.1, Math.max(0.55, bh * 1.4 + 0.25));
    const chim = new THREE.Mesh(this._geo.brickChim, brickMat);
    chim.scale.set(1, chimH, 1);
    chim.position.set(fw*0.28, bh + chimH*0.5, -fl*0.22);
    chim.castShadow = true;
    grp.add(chim);
    const band = new THREE.Mesh(this._geo.chimBand, this._mat(F.metal));
    band.position.set(fw*0.28, bh + chimH*0.7, -fl*0.22);
    grp.add(band);

    // 装卸口 / 卷帘门
    const dock = new THREE.Mesh(this._geo.dock, this._mat(F.metal));
    dock.position.set(-fw*0.12, 0.12, fl/2 + 0.01);
    grp.add(dock);

    // 侧窗条
    const winMat = this._basicMat(F.window);
    const w1 = new THREE.Mesh(this._geo.facWin, winMat);
    w1.position.set(fw*0.15, bh*0.72, fl/2 + 0.01);
    grp.add(w1);
    const w2 = new THREE.Mesh(this._geo.facWin, winMat);
    w2.position.set(-fw*0.15, bh*0.72, fl/2 + 0.01);
    grp.add(w2);

    grp.rotation.y = this._bldRot(t, era, 3);
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // ---- P2-A 植被合批：区块内树按 5 个部件批次 InstancedMesh 绘制 ----
  // 原 makeTree 每棵建独立 Group（2-4 个 Mesh 且逐个 castShadow），高人口下 DrawCall
  // 爆炸（压测峰值 9632，移动端红线 <2000）。合批后树数量不再影响 DrawCall（恒定 ~5+5）。
  // 几何/材质全部来自 _geo 与 _matCache 共享池，清理时只 dispose 实例缓冲区本身。
  _clearTreeInst(){
    if(!this._treeInst) return;
    for(const m of Object.values(this._treeInst)){ this.treeGroup.remove(m); m.dispose(); }
    this._treeInst = null;
    this._treeSigA = null; this._treeSigB = null; this._treeKept = -1;
  }

  _ensureTreeBatches(G){
    if(this._treeInst) return this._treeInst;
    const p = PALETTES[G.era];
    const trunkMat = this._mat(0x6d4c2a);
    const leafMat = this._mat(p.tree);
    const cap = MAX_TREE_MESH;
    const mk = (geo, mat, capacity)=>{
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.count = 0;
      m.castShadow = true;               // 与原逐棵 castShadow 视觉一致
      m.receiveShadow = true;
      m.frustumCulled = false;           // 实例散布全图，单件几何包围球不再适用
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.treeGroup.add(m);
      return m;
    };
    this._treeInst = {
      trunk: mk(this._geo.treeTrunk, trunkMat, cap),
      cone:  mk(this._geo.treeTop,   leafMat,  cap),
      mid:   mk(this._geo.treeMid,   leafMat,  cap),
      ico:   mk(this._geo.treeTop2,  leafMat,  cap),
      bush:  mk(this._geo.bush,      leafMat,  cap*2),
    };
    return this._treeInst;
  }

  /** 对 _treeCand 做确定性抽样（与建筑 MAX_BUILD_MESH 抽样同构），再重填实例矩阵。
   *  变化签名（双哈希）不变时跳过重填，避免每帧上传 instanceMatrix。 */
  _syncTreeBatches(G){
    const cand = this._treeCand;
    const n = cand.length;
    const tstep = n > MAX_TREE_MESH ? Math.ceil(n / MAX_TREE_MESH) : 1;
    let sigA = 0, sigB = 0, kept = 0;
    for(let i=0;i<n;i+=tstep){
      const t = cand[i];
      const v = ((t._wx|0)*73856093) ^ ((t._wz|0)*19349663)
        ^ (Math.round(t._wy*50)*83492791) ^ (Math.round(t.h*20)*25569)
        ^ ((t.variant|0)*1274126177);
      sigA = (sigA*16777619 ^ v) | 0;
      sigB = (sigB + v + 0x9e3779b9 + (sigB<<6) + (sigB>>2)) | 0;
      kept++;
    }
    if(sigA === this._treeSigA && sigB === this._treeSigB && kept === this._treeKept) return;
    this._treeSigA = sigA; this._treeSigB = sigB; this._treeKept = kept;

    const inst = this._ensureTreeBatches(G);
    const d = this._treeDummy;
    d.rotation.set(0, 0, 0);
    const put = (mesh, idx, x, y, z, sx, sy, sz)=>{
      d.position.set(x, y, z);
      d.scale.set(sx, sy !== undefined ? sy : sx, sz !== undefined ? sz : sx);
      d.updateMatrix();
      mesh.setMatrixAt(idx, d.matrix);
    };
    let nTrunk=0, nCone=0, nMid=0, nIco=0, nBush=0;
    for(let i=0;i<n;i+=tstep){
      const t = cand[i];
      const bx = t._wx, by = t._wy - 0.05, bz = t._wz;
      const h = t.h;
      put(inst.trunk, nTrunk++, bx, by+0.2, bz, 1);
      const kind = (t.variant|0) % 3;
      if(kind === 0){
        put(inst.cone, nCone++, bx, by+0.88, bz, 0.7 + h*0.1);
      } else if(kind === 1){
        put(inst.mid, nMid++, bx, by+0.55, bz, 1);
        put(inst.ico, nIco++, bx, by+0.85, bz, 0.75 + h*0.08);
      } else {
        put(inst.bush, nBush++, bx, by+0.28, bz, 1.2, 0.9, 1.2);
        put(inst.bush, nBush++, bx+0.28, by+0.18, bz+0.15, 1);
      }
    }
    inst.trunk.count = nTrunk; inst.cone.count = nCone; inst.mid.count = nMid;
    inst.ico.count = nIco; inst.bush.count = nBush;
    for(const m of Object.values(inst)) m.instanceMatrix.needsUpdate = true;
  }

  // ---- P3-A 建筑合批：已完工建筑按模板部件写入全局槽位 InstancedMesh ----
  // 原每栋建筑一个独立 Group（6~18 个 Mesh，castShadow 阴影 pass 再翻倍），
  // 满城抽样 420 格时 DrawCall ~2020（占总量 67%）。合批后 DrawCall 只由
  // 「活跃部件槽位数」决定（~40 主 pass + ~25 阴影 pass），与建筑数量脱钩。
  // 建造中建筑 scale 随 t.prog 逐帧变化，保留独立 Group（同屏通常仅数栋）。
  _clearBldInst(){
    if(this._bldInst){
      for(const s of this._bldInst){ this.buildingGroup.remove(s.mesh); s.mesh.dispose(); }
    }
    this._bldInst = null; this._bldTpl = null; this._bldSlotIdx = null;
    this._bldSigA = null; this._bldSigB = null; this._bldKept = -1;
    this._bldEra = -1;   // 使 _ensureBldBatches 的 era 守卫在下次调用时重建
  }

  /** 收集当前时代全部 12 个 (type×varn) 建筑模板：用伪格跑一次 makeBuilding，
   *  读取每个 Mesh 的几何/材质/局部矩阵/阴影属性后弃壳。
   *  几何全部来自 _geo 共享缓存、材质来自 _matCache 池，模板壳无 GPU 资源。
   *  再按 (几何,材质,阴影属性) 聚合全局槽位，容量 = 单栋该槽位最大部件数 × MAX_BUILD_MESH。 */
  _ensureBldBatches(era){
    // 槽位几何/材质按时代取色，故批次与 era 绑定。正常路径由 applyEraVisuals 调 _clearBldInst
    // 整批重建；此处再显式校验一次 era，避免将来新增「换时代/换世界」路径漏调 applyEraVisuals 时，
    // 静默沿用旧时代材质（隐式耦合 → 显式守卫）。
    if(this._bldInst){
      if(this._bldEra === era) return this._bldInst;
      this._clearBldInst();
    }
    this._bldEra = era;
    const tpl = new Map();
    for(const [type, zone] of [['farm',2],['house',1],['church',4],['factory',3]]){
      for(let varn=0; varn<3; varn++){
        const grp = this.makeBuilding({ zone, variant: varn, _wx: 0, _wz: 0 }, era);
        grp.rotation.y = 0;   // 随机朝向归入实例矩阵，模板保持零旋转
        const parts = [];
        for(const o of grp.children){
          if(!o.isMesh) continue;
          o.updateMatrix();
          parts.push({ geo: o.geometry, mat: o.material, m: o.matrix.clone(),
                       cast: !!o.castShadow, recv: !!o.receiveShadow });
        }
        tpl.set(`${type}|${varn}`, parts);
      }
    }
    this._bldTpl = tpl;
    const slots = new Map();
    const keyOf = (p)=> `${p.geo.uuid}|${p.mat.uuid}|${p.cast?1:0}|${p.recv?1:0}`;
    for(const parts of tpl.values()){
      const per = new Map();
      for(const p of parts){
        const key = keyOf(p);
        per.set(key, (per.get(key)||0)+1);
        if(!slots.has(key)) slots.set(key, { geo:p.geo, mat:p.mat, cast:p.cast, recv:p.recv, perBld:0 });
      }
      for(const [key, cnt] of per){
        const s = slots.get(key);
        if(cnt > s.perBld) s.perBld = cnt;
      }
    }
    this._bldInst = [];
    this._bldSlotIdx = new Map();
    for(const [key, s] of slots){
      const mesh = new THREE.InstancedMesh(s.geo, s.mat, s.perBld * MAX_BUILD_MESH);
      mesh.count = 0;
      mesh.castShadow = s.cast;
      mesh.receiveShadow = s.recv;
      mesh.frustumCulled = false;      // 实例散布全图，单件几何包围球不再适用
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.buildingGroup.add(mesh);
      this._bldSlotIdx.set(key, this._bldInst.length);
      this._bldInst.push({ mesh, n: 0, cap: s.perBld * MAX_BUILD_MESH });
    }
    this._bldKeyOf = keyOf;
    return this._bldInst;
  }

  /** 重填已完工建筑的实例矩阵。变化签名（双哈希，与树批次同构）不变时跳过，
   *  避免每帧上传数十个 instanceMatrix 缓冲区。 */
  _syncBuildBatches(G){
    const cand = this._bldCand;
    const n = cand.length;
    let sigA = 0, sigB = 0;
    for(let i=0;i<n;i++){
      const t = cand[i];
      const v = ((t._wx|0)*73856093) ^ ((t._wz|0)*19349663)
        ^ (Math.round(t._wy*50)*83492791) ^ ((t.variant|0)*1274126177)
        ^ ((t.zone|0)*2654435761);
      sigA = (sigA*16777619 ^ v) | 0;
      sigB = (sigB + v + 0x9e3779b9 + (sigB<<6) + (sigB>>2)) | 0;
    }
    if(sigA === this._bldSigA && sigB === this._bldSigB && n === this._bldKept) return;
    this._bldSigA = sigA; this._bldSigB = sigB; this._bldKept = n;

    const inst = this._ensureBldBatches(G.era);
    for(const s of inst) s.n = 0;
    const d = this._bldDummy;
    const m1 = this._bldM1, m2 = this._bldM2;
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    for(let i=0;i<n;i++){
      const t = cand[i];
      const type = ZONES[t.zone].noBuilding ? 'farm'
        : t.zone === 4 ? 'church' : t.zone === 3 ? 'factory' : 'house';
      const parts = this._bldTpl.get(`${type}|${t.variant % 3}`);
      if(!parts) continue;
      // 整栋矩阵：世界位置（底面埋入地表 0.02）+ 与 makeBuilding 一致的随机朝向
      // 与构建器共用同一纯函数 —— 此前只复算 house/factory 且 factory 幅度写死 0.06，
      // 导致教堂与土窑/作坊/反应堆完工瞬间朝向跳变（2026-10 审计）
      const rot = this._bldRot(t, G.era, t.zone);
      d.position.set(t._wx, t._wy - 0.02, t._wz);
      d.rotation.y = rot;
      d.updateMatrix();
      m1.copy(d.matrix);
      for(const p of parts){
        const s = inst[this._bldSlotIdx.get(this._bldKeyOf(p))];
        if(s.n >= s.cap) continue;   // 容量保护（抽样上限内理论不可达）
        m2.multiplyMatrices(m1, p.m);
        s.mesh.setMatrixAt(s.n, m2);
        s.n++;
      }
    }
    for(const s of inst){
      s.mesh.count = s.n;
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  makeWonder(era, prog){
    const grp = new THREE.Group();
    if(era===0){
      const stoneMat = this._mat(0x8a8278);
      const radius = 1.45;
      for(let i=0;i<6;i++){
        const a = (i/6)*Math.PI*2;
        const p = new THREE.Mesh(this._geo.pillar, stoneMat);
        p.position.set(Math.cos(a)*radius, 0.95, Math.sin(a)*radius);
        p.castShadow = true;
        grp.add(p);
      }
      for(let i=0;i<3;i++){
        const a = (i/3)*Math.PI*2;
        const l = new THREE.Mesh(this._geo.lintel, stoneMat);
        l.position.set(Math.cos(a)*radius*1.28, 2.0, Math.sin(a)*radius*1.28);
        l.rotation.y = a;
        l.castShadow = true;
        grp.add(l);
      }
      const c = new THREE.Mesh(this._geo.stone, this._mat(0x6f675f));
      c.position.y = 0.3; c.castShadow = true;
      grp.add(c);
    } else if(era===1){
      // 金字塔
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.2, 4), this._mat(0xd4a85a));
      pyr.position.y = 1.1; pyr.rotation.y = Math.PI/4;
      pyr.castShadow = true;
      grp.add(pyr);
    } else if(era===2){
      // 大教堂：中殿 + 尖顶 + 双塔（与时代 IV 的塔楼区分）
      const stone = this._mat(0xc9c2b4);
      const nave = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 3.0), stone);
      nave.position.y = 0.5; nave.castShadow = true; nave.receiveShadow = true;
      grp.add(nave);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.0, 4), this._mat(0x8a6a4a));
      roof.position.y = 1.5; roof.rotation.y = Math.PI/4;
      roof.castShadow = true;
      grp.add(roof);
      for(const dx of [-0.95, 0.95]){
        const tw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.5), stone);
        tw.position.set(dx, 0.85, -1.2); tw.castShadow = true;
        grp.add(tw);
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.9, 4), this._mat(0x6f6a62));
        sp.position.set(dx, 2.15, -1.2); sp.castShadow = true;
        grp.add(sp);
      }
    } else if(era===3){
      // 摩天塔：细高多层收分塔楼
      let y = 0, w = 0.95;
      for(let i=0;i<4;i++){
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, 0.85, w), this._mat(i%2 ? 0x9fb3c8 : 0xb8c6d6));
        seg.position.y = y + 0.425; seg.castShadow = true;
        grp.add(seg);
        y += 0.85; w *= 0.82;
      }
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 6), this._mat(0xd9e2ec));
      tip.position.y = y + 0.6; tip.castShadow = true;
      grp.add(tip);
    } else {
      // 太空电梯：基座 + 超细塔身 + 顶部光环
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.5, 8), this._mat(0x6f7a86));
      base.position.y = 0.25; base.castShadow = true;
      grp.add(base);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 6.0, 6), this._mat(0xb9c6d2));
      mast.position.y = 3.5; mast.castShadow = true;
      grp.add(mast);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 14), this._mat(0x00e5ff));
      ring.position.y = 6.6; ring.rotation.x = Math.PI/2; ring.castShadow = true;
      grp.add(ring);
    }
    return grp;
  }

  syncWorld(G){
    // 建筑 / 农田（视觉上限：超过后抽样代表格，逻辑数不变；MAX_BUILD_MESH 已收口至 config.js，A-02）
    // #25 性能：抽样步长依赖「划定总数」，优先取划定缓存，避免为它再全图扫一趟
    let zoneCount = 0;
    const zc = G._zoneCache;
    if(zc && zc.valid){
      zoneCount = (zc[1]||0)+(zc[2]||0)+(zc[3]||0)+(zc[4]||0);
    } else {
      eachTile(G, (t)=>{ if(t.zone>0) zoneCount++; });
    }
    const step = zoneCount > MAX_BUILD_MESH ? Math.ceil(zoneCount / MAX_BUILD_MESH) : 1;
    let zi = 0;
    const seenB = new Set();
    this._treeCand.length = 0;   // P2-A：树候选格每帧重收集，统一抽样合批
    this._bldCand.length = 0;    // P3-A：已完工建筑格每帧重收集，统一写入槽位实例批次

    // #25 性能：原「坐标预计算 / 建筑 / 树」共 4 趟全图遍历合并为 1 趟；
    // _wy 需 5 次 getTile 求邻域均值，只在真正要摆网格（有划定或长树）的格上计算，
    // 其余格（水面、空地）跳过——它们不再被任何渲染/逻辑消费。
    eachTile(G, (t, x, y)=>{
      t._wx = x*TILE; t._wz = y*TILE;
      const isZone = t.zone > 0;
      const isTree = !!t.tree && !t.water && t.h > WATER_Y + 0.15;
      if(!isZone && !isTree) return;
      t._wy = t.water ? WATER_Y : this._surfaceY(G, x, y);

      if(isZone){
        const key = `${x},${y}`;
        seenB.add(key);
        const idx = zi++;
        // P3-A：完工建筑（缩放恒为 1、朝向可由哈希复算）走槽位实例批次，
        // 与建筑总数脱钩；建造中建筑需要逐栋进度缩放，仍保留独立网格（同屏仅数栋）。
        if(t.built){
          // 顺序很关键：必须先记录「本来就已可见」，再释放独立网格。
          // 若先 delete 再 has(key)，第三项保留条件恒为 false（死条件），
          // step>1 的大城里刚完工且未命中抽样的建筑会永久消失（2026-10 审计发现）。
          const wasVisible = this.buildingMeshes.has(key);
          const m = this.buildingMeshes.get(key);
          if(m){
            // 建造中→完工：释放独立网格（几何全部来自 _geo 共享缓存，无需 dispose）
            this.buildingGroup.remove(m);
            this.buildingMeshes.delete(key);
          }
          // 与建造中分支同口径的三条保留条件：step==1、抽样命中、或「本来就已可见」。
          if(step === 1 || (idx % step === 0) || wasVisible) this._bldCand.push(t);
        } else {
          const show = step === 1 || (idx % step === 0) || this.buildingMeshes.has(key);
          if(show){
            if(!this.buildingMeshes.has(key)){
              const m = this.makeBuilding(t, G.era);
              if(m){ this.buildingGroup.add(m); this.buildingMeshes.set(key, m); }
            }
            const m = this.buildingMeshes.get(key);
            if(m){
              // 底面略埋入地表 0.02，避免缝隙；高度用邻域均值
              m.position.set(t._wx, t._wy - 0.02, t._wz);
              m.visible = true;
              const prog = Math.max(0.15, t.prog);
              const zs = ZONES[t.zone];
              m.scale.setScalar(zs.noBuilding ? (0.55+prog*0.45) : (0.35 + prog*0.65));
            }
          }
        }
      }

      if(isTree){
        // P2-A：不再逐棵建 Group，先收集候选格（_wx/_wy/_wz 已就绪），遍历后统一合批
        this._treeCand.push(t);
      }
    });

    for(const [key, m] of this.buildingMeshes){
      if(!seenB.has(key)){ this.buildingGroup.remove(m); this.buildingMeshes.delete(key); }
    }
    this._syncTreeBatches(G);
    this._syncBuildBatches(G);

    // 奇迹
    // G-09 修复：原实现只增不删——读档换世界 / 奇迹从 wonderList 移除后，
    // 旧网格永远滞留在 wonderGroup 与 wonderMeshes 中（几何体一并泄漏）。
    // 参照 building/tree 的 seen 清理协议，移除项需释放内联几何体；
    // 材质来自 _matCache 共享池，不可 dispose。
    const seenW = new Set();
    for(const w of G.wonderList){
      const key = `w${w.x},${w.y}`;
      seenW.add(key);
      if(!this.wonderMeshes.has(key)){
        const m = this.makeWonder(w.era, w.prog);
        this.wonderGroup.add(m); this.wonderMeshes.set(key,m);
        w._meshKey = key;
      }
      const m = this.wonderMeshes.get(key);
      if(m){
        const t = getTile(G, w.x, w.y);
        const wy = t ? (t.water ? WATER_Y : this._surfaceY(G, w.x, w.y)) : sampleHeight(w.x,w.y,G.seed);
        m.position.set(w.x*TILE, wy-0.05, w.y*TILE);
        const prog = w.done ? 1 : Math.max(0.1, w.prog);
        m.scale.setScalar(0.3 + prog*0.7);
      }
    }
    for(const [key, m] of this.wonderMeshes){
      if(!seenW.has(key)){
        this.wonderGroup.remove(m);
        this._disposeInlineGeo(m);
        this.wonderMeshes.delete(key);
      }
    }
  }

  // G-09 配套：释放组合网格中「非共享」的几何体（makeWonder 各时代分支内联 new 的几何）。
  // 共享几何（this._geo.*）与缓存材质（_matCache）仍被其他网格使用，严禁 dispose。
  _disposeInlineGeo(root){
    const shared = new Set(Object.values(this._geo));
    root.traverse((o)=>{
      if(o.isMesh && o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    });
  }

  spawnBurst(x, z, color, count=14){
    for(let i=0;i<count;i++){
      const m = new THREE.Mesh(this._geo.particle, new THREE.MeshBasicMaterial({ color, transparent:true }));
      m.position.set(x, 0.8, z);
      const sp = 2 + Math.random()*3;
      const ang = Math.random()*Math.PI*2;
      m.userData = { vx:Math.cos(ang)*sp, vy:2+Math.random()*3, vz:Math.sin(ang)*sp, life:0.8+Math.random()*0.4, age:0 };
      this.particleGroup.add(m);
    }
  }
  spawnRain(x, z){
    const m = new THREE.Mesh(this._geo.particle, new THREE.MeshBasicMaterial({ color:0x64b5f6, transparent:true }));
    m.position.set(x + (Math.random()-0.5)*8, 12, z + (Math.random()-0.5)*8);
    m.scale.setScalar(0.55);
    m.userData = { vy:-10, life:1.2, age:0, rain:true, vx:0, vz:0 };
    this.particleGroup.add(m);
  }
  updateParticles(dt){
    for(let i=this.particleGroup.children.length-1; i>=0; i--){
      const p = this.particleGroup.children[i];
      const u = p.userData;
      u.age += dt;
      p.position.x += (u.vx||0)*dt;
      p.position.y += u.vy*dt;
      if(!u.rain) p.position.z += (u.vz||0)*dt;
      if(!u.rain) u.vy -= 6*dt;
      const k = 1 - u.age/u.life;
      if(k<=0){ this.particleGroup.remove(p); p.material?.dispose(); }
      else { p.scale.setScalar(Math.max(0.1, k)); if(p.material){ p.material.opacity = k; p.material.transparent=true; } }
    }
  }

  // ========== 村民渲染系统（numeric-design §7）==========
  // 数量：N_render = clamp(round(50*log10(N)-85), min(E), max(E))
  // 行为：家锚点缓存 + idle/walk 状态机 + 落水/超时脱困

  _npcLand(G, x, z){
    const t = getTile(G, Math.round(x/TILE), Math.round(z/TILE));
    return !!(t && !t.water);
  }

  /** 缓存「家」锚点：已建成且非水面的格，附近陆地 */
  _refreshHomes(G){
    const anchors = [];
    eachTile(G, (t, x, y)=>{
      if(t.zone===1 && t.built && !t.water){
        anchors.push({ x: x*TILE, z: y*TILE });
      }
    });
    if(!anchors.length){
      eachTile(G, (t, x, y)=>{
        if(t.zone>0 && !t.water) anchors.push({ x: x*TILE, z: y*TILE });
      });
    }
    this._npcHomes = anchors;
    this._npcHomesDirty = false;
  }

  _randomHome(G){
    if(this._npcHomesDirty || !this._npcHomes) this._refreshHomes(G);
    const homes = this._npcHomes;
    if(homes && homes.length){
      const a = homes[(Math.random()*homes.length)|0];
      // 在锚点旁找陆地
      for(let i=0;i<10;i++){
        const ang = Math.random()*Math.PI*2;
        const r = 0.3 + Math.random()*1.8;
        const px = a.x + Math.cos(ang)*r;
        const pz = a.z + Math.sin(ang)*r;
        if(this._npcLand(G, px, pz)) return [px, pz];
      }
      return [a.x, a.z];
    }
    // 尚无建筑：原点附近
    for(let i=0;i<12;i++){
      const ang = Math.random()*Math.PI*2;
      const r = 1 + Math.random()*4;
      const px = Math.cos(ang)*r, pz = Math.sin(ang)*r;
      if(this._npcLand(G, px, pz)) return [px, pz];
    }
    return [0, 0];
  }

  markNpcHomesDirty(){ this._npcHomesDirty = true; }

  setNpcCount(n, G){
    const target = Math.max(0, n|0);
    const npcs = this._npcs;
    const prev = npcs.length;

    if(prev !== target) this._npcHomesDirty = true;

    // 增员：只追加纯数据状态记录，网格由实例批次统一承载
    while(npcs.length < target){
      const home = this._randomHome(G);
      npcs.push({
        x: home[0], y: 0, z: home[1], rot: 0, sw: 0,
        hx: home[0], hz: home[1], tx: home[0], tz: home[1],
        state: 'idle', st: 0, wait: 0.4 + Math.random()*2,
        spd: 0.55+Math.random()*0.45,
        phase: Math.random()*Math.PI*2,
        bag: (npcs.length % 2 === 1)      // 原 _makeVillager(variant) 的奇偶挎包规则
      });
    }
    // 减员
    if(npcs.length > target) npcs.length = target;

    this._ensureNpcBatches(Math.min(MAX_NPC_INST, Math.max(1, npcs.length)));
    this._npcApplyEra(G);       // 仅在人数变化或换时代时刷配色（避免每帧全池扫描）
    this._writeNpcInstances();  // 立刻落位，避免新批次首帧出现在原点
  }

  /** 按时代取四套共享材质（_mat 走缓存池，不可 dispose） */
  _npcMatsFor(era){
    const e = Math.max(0, Math.min(4, era|0));
    const folkCol = FOLKCOL[e];
    return {
      cloth: this._mat(folkCol),
      dark:  this._mat(lerpHex(folkCol, 0x2a2018, 0.35)),
      skin:  this._mat(FOLK_HEAD),
      bag:   this._mat(0x8b5a2b)
    };
  }

  /** 创建/扩容 6 个村民部件批次；容量足够时直接复用 */
  _ensureNpcBatches(cap){
    const cur = this._npcInst;
    if(cur && cur.cap >= cap) return cur;
    if(cur){
      for(const d of NPC_BATCH_DEFS){ this.npcGroup.remove(cur.b[d.k]); cur.b[d.k].dispose(); }
    }
    const mats = this._npcMatsFor(this._npcEra);
    const b = {};
    for(const d of NPC_BATCH_DEFS){
      const mesh = new THREE.InstancedMesh(this._geo[d.geo], mats[d.mat], cap * d.mul);
      mesh.count = 0;
      mesh.castShadow = d.cast;
      mesh.frustumCulled = false;   // 村民散布全图，单件几何包围球不再适用
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.npcGroup.add(mesh);
      b[d.k] = mesh;
    }
    this._npcInst = { cap, b, mats };
    return this._npcInst;
  }

  /** 换时代：整体替换批次材质。
   *  旧实现直接改 clothMat.color——而 _mat 是按颜色缓存的共享材质，
   *  那会污染上一代配色的缓存条目；改为换引用后缓存池保持干净。 */
  _npcApplyEra(G){
    if(this._npcEra === G.era) return;
    this._npcEra = G.era;
    const inst = this._npcInst;
    if(!inst) return;             // 批次尚未创建：创建时按 _npcEra 取色
    const mats = this._npcMatsFor(G.era);
    inst.mats = mats;
    for(const d of NPC_BATCH_DEFS) inst.b[d.k].material = mats[d.mat];
  }

  /** 每帧全量重写实例矩阵：整体矩阵 × pivot 矩阵 × 部件局部偏移 */
  _writeNpcInstances(){
    const inst = this._npcInst;
    if(!inst) return;
    const npcs = this._npcs;
    const n = npcs.length;
    const d = this._npcDummy, p = this._npcPivot;
    const m1 = this._npcM1, m2 = this._npcM2;
    d.scale.set(1,1,1); p.scale.set(1,1,1);
    let bagI = 0;
    for(let i=0;i<n;i++){
      const u = npcs[i];
      d.position.set(u.x, u.y, u.z);
      d.rotation.set(0, u.rot, 0);
      d.updateMatrix();
      const sw = u.sw;
      // 双腿：pivot(±0.045, 0.16, 0)，左腿 +sw / 右腿 -sw（反相）
      // 双臂：pivot(±0.13, 0.36, 0)，左臂 -sw*0.85 / 右臂 +sw*0.85（与腿反相）
      for(let s=0;s<2;s++){
        const side = s === 0 ? -1 : 1;
        p.position.set(side*0.045, 0.16, 0);
        p.rotation.set(-side*sw, 0, 0);
        p.updateMatrix();
        m1.multiplyMatrices(d.matrix, p.matrix);
        m2.multiplyMatrices(m1, NPC_LOCAL.leg);
        inst.b.leg.setMatrixAt(i*2+s, m2);

        p.position.set(side*0.13, 0.36, 0);
        p.rotation.set(side*sw*0.85, 0, 0);
        p.updateMatrix();
        m1.multiplyMatrices(d.matrix, p.matrix);
        m2.multiplyMatrices(m1, NPC_LOCAL.arm);
        inst.b.arm.setMatrixAt(i*2+s, m2);
      }
      m1.multiplyMatrices(d.matrix, NPC_LOCAL.torso); inst.b.torso.setMatrixAt(i, m1);
      m1.multiplyMatrices(d.matrix, NPC_LOCAL.head);  inst.b.head.setMatrixAt(i, m1);
      m1.multiplyMatrices(d.matrix, NPC_LOCAL.hair);  inst.b.hair.setMatrixAt(i, m1);
      if(u.bag){
        m1.multiplyMatrices(d.matrix, NPC_LOCAL.bag);
        inst.b.bag.setMatrixAt(bagI++, m1);
      }
    }
    for(const def of NPC_BATCH_DEFS){
      const mesh = inst.b[def.k];
      mesh.count = def.k === 'bag' ? bagI : n * def.mul;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _pickWalkTarget(G, u, minX, maxX, minZ, maxZ){
    for(let i=0;i<8;i++){
      const a = Math.random()*Math.PI*2;
      const r = 0.7 + Math.random()*2.6;
      const px = u.hx + Math.cos(a)*r;
      const pz = u.hz + Math.sin(a)*r;
      const cx = Math.max(minX, Math.min(maxX, px));
      const cz = Math.max(minZ, Math.min(maxZ, pz));
      if(this._npcLand(G, cx, cz)) return [cx, cz];
    }
    return null;
  }

  updateNpcs(dt, G){
    if(this._npcHomesDirty) this._refreshHomes(G);
    const npcs = this._npcs;
    const b = chunkBounds(G);
    const minX = b.minX*TILE + 0.4, maxX = b.maxX*TILE - 0.4;
    const minZ = b.minY*TILE + 0.4, maxZ = b.maxY*TILE - 0.4;

    for(let i=0;i<npcs.length;i++){
      const u = npcs[i];
      u.st += dt;
      u.phase += dt;

      // 落水 / 虚空 → 立刻回岸
      if(!this._npcLand(G, u.x, u.z)){
        const home = this._randomHome(G);
        u.hx = home[0]; u.hz = home[1];
        u.tx = home[0]; u.tz = home[1];
        u.state = 'idle'; u.st = 0; u.wait = 0.4 + Math.random();
        u.x = home[0]; u.z = home[1];
        this._placeNpcY(u, G, 0);
        continue;
      }

      if(u.state === 'walk'){
        const dx = u.tx - u.x;
        const dz = u.tz - u.z;
        const dist = Math.hypot(dx, dz);
        if(dist < 0.12 || u.st > 5.5){
          u.state = 'idle';
          u.st = 0;
          u.wait = 0.7 + Math.random()*3.2;
        } else {
          const step = Math.min(dist, u.spd * dt);
          const nx = u.x + (dx/dist)*step;
          const nz = u.z + (dz/dist)*step;
          if(!this._npcLand(G, nx, nz)){
            u.state = 'idle'; u.st = 0; u.wait = 0.25;
          } else {
            u.x = nx;
            u.z = nz;
            u.rot = Math.atan2(dx, dz);
          }
        }
      } else {
        // idle
        if(u.st > u.wait){
          const t = this._pickWalkTarget(G, u, minX, maxX, minZ, maxZ);
          if(t){
            u.tx = t[0]; u.tz = t[1];
            u.state = 'walk';
            u.st = 0;
          } else {
            const home = this._randomHome(G);
            u.hx = home[0]; u.hz = home[1];
            u.tx = home[0]; u.tz = home[1];
            u.st = 0; u.wait = 1;
          }
        }
      }

      // 四肢摆动角（写入状态，由 _writeNpcInstances 复合进实例矩阵）
      const walking = u.state === 'walk';
      u.sw = walking ? Math.sin(u.phase*9)*0.55 : Math.sin(u.phase*1.5)*0.04;
      this._placeNpcY(u, G, walking ? Math.abs(Math.sin(u.phase*9))*0.03 : 0);
    }
    this._writeNpcInstances();
  }

  _placeNpcY(u, G, bob){
    const tx = Math.round(u.x / TILE);
    const ty = Math.round(u.z / TILE);
    const tile = getTile(G, tx, ty);
    const ground = !tile
      ? sampleHeight(tx, ty, G.seed)
      : (tile.water ? WATER_Y : this._surfaceY(G, tx, ty));
    u.y = ground + bob;
  }

  // P3-B：原 _makeVillager（每人一个 Group、8 个 Mesh）已移除，
  // 改由 NPC_BATCH_DEFS 定义的 6 个 InstancedMesh 批次承载；
  // 部件尺寸沿用 _buildGeo 共享几何，局部偏移见 NPC_LOCAL，动画由 _writeNpcInstances 复合。

  // #24 style: 'ok' 可放置（金）| 'bad' 不可放置（红）| 'demolish' 可拆除（橙）| 'none' 隐藏
  setHover(x, y, G, style){
    // 防御：hoverMesh 由 makeHover() 创建；缺失时静默跳过而不是每次鼠标移动都抛异常
    // （2026-10 审计：makeHover 曾零调用，导致 setHover 无条件解引用 null）
    if(!this.hoverMesh) return;
    if(x==null || style === 'none'){ this.hoverMesh.visible=false; return; }
    const t = getTile(G, x, y);
    if(!t){ this.hoverMesh.visible=false; return; }
    const h = t.water ? WATER_Y : Math.max(0.3, t.h);
    this.hoverMesh.position.set(x*TILE, h+0.06, y*TILE);
    const m = this.hoverMesh.material;
    if(style === 'bad'){ m.color.setHex(0xff5252); m.opacity = 0.95; }
    else if(style === 'demolish'){ m.color.setHex(0xff8a65); m.opacity = 0.90; }
    else { m.color.setHex(0xffd54f); m.opacity = 0.85; }
    this.hoverMesh.visible = true;
  }

  screenToTile(px, py){
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    if(w<=0 || h<=0) return null;
    this._ndc.set(
      ((px - rect.left) / w) * 2 - 1,
      -((py - rect.top) / h) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.camera);
    const toTile = (v)=> Math.floor(v / TILE + 0.5);

    if(this.terrainMesh && this.terrainMesh.geometry){
      const hits = this._raycaster.intersectObject(this.terrainMesh, false);
      if(hits.length > 0){
        const p = hits[0].point;
        return [toTile(p.x), toTile(p.z)];
      }
    }
    if(this._raycaster.ray.intersectPlane(this._plane, this._hit)){
      return [toTile(this._hit.x), toTile(this._hit.z)];
    }
    return null;
  }

  applyEraVisuals(G){
    this.era = G.era;
    this._buildSkyTexture(G.era, this.dayTime);
    const p = PALETTES[G.era];
    this.scene.fog.color.set(p.fog);
    if(this.waterMesh) this.waterMesh.material.color.set(p.water);
    for(const [,m] of this.buildingMeshes) this.buildingGroup.remove(m);
    this.buildingMeshes.clear();
    // P3-B：村民批次改为按时代整体换材质引用（旧实现改共享材质颜色会污染 _mat 缓存池）
    this._npcApplyEra(G);
    // P2-A：树批次材质含时代叶色，时代切换时整批重建（下一帧 syncWorld 自动重填）
    this._clearTreeInst();
    // P3-A：建筑槽位批次的几何/材质同样按时代取色，切换时整批重建
    this._clearBldInst();
    // _matCache 此前只增不减：每换一次时代都会为新时代配色建一批材质，
    // 五代跑满后旧时代材质永久驻留。此处回收「已无任何网格引用」的材质；
    // 仍被 terrain/water 等引用的材质会被保留（purgeMaterials(false) 只删未引用项）。
    this.purgeMaterials(false);
    this.terrainDirty = true;
  }

  render(){ this.renderer.render(this.scene, this.camera); }
  resize(){
    this.camera.aspect = window.innerWidth/window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _bindCameraKeys(canvas){
    const setKey = (e, down)=>{
      const k = e.key?.toLowerCase();
      if(!k) return;
      const map = { w:'w', a:'a', s:'s', d:'d', q:'q', e:'e' };
      if(k in map){
        this._keys[map[k]] = down;
        // 游戏中避免方向键/字母触发浏览器
        if(down) e.preventDefault();
      }
      if(k === 'shift') this._keys.shift = down;
    };
    window.addEventListener('keydown', (e)=>setKey(e, true));
    window.addEventListener('keyup', (e)=>setKey(e, false));
    window.addEventListener('blur', ()=>{
      this._keys = { w:false, a:false, s:false, d:false, q:false, e:false, shift:false };
    });
    // Shift + 右键 = 平移（OrbitControls 用 RIGHT=PAN 临时切换）
    let shiftRmb = false;
    const applyRight = ()=>{
      this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    };
    canvas.addEventListener('pointerdown', (e)=>{
      if(e.button === 2 && e.shiftKey){
        shiftRmb = true;
        this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      }
    });
    window.addEventListener('pointerup', (e)=>{
      if(shiftRmb && e.button === 2){
        shiftRmb = false;
        applyRight();
      }
    });
  }

  /** 每帧：WASD 平移 + Q/E 水平旋转（城建标配） */
  updateCameraKeys(dt){
    if(!this.controls) return;
    const k = this._keys;
    const moving = k.w || k.a || k.s || k.d || k.q || k.e;
    if(!moving) return;
    const target = this.controls.target;
    const cam = this.camera.position;
    const offset = cam.clone().sub(target);
    const radius = offset.length();
    // 地平面朝向
    let yaw = Math.atan2(offset.x, offset.z);
    if(k.q) yaw += dt * 1.1;
    if(k.e) yaw -= dt * 1.1;
    const speed = (12 + radius * 0.15) * dt;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = 0, mz = 0;
    if(k.w){ mx -= fx; mz -= fz; }
    if(k.s){ mx += fx; mz += fz; }
    if(k.a){ mx -= rx; mz -= rz; }
    if(k.d){ mx += rx; mz += rz; }
    const len = Math.hypot(mx, mz) || 1;
    const pan = new THREE.Vector3((mx/len)*speed, 0, (mz/len)*speed);
    if(k.q || k.e){
      offset.x = Math.sin(yaw) * radius;
      offset.z = Math.cos(yaw) * radius;
      cam.copy(target).add(offset);
    }
    if(k.w || k.a || k.s || k.d){
      target.add(pan);
      cam.add(pan);
    }
    this.controls.update();
  }

  /**
   * 方案 A（天际线式）：
   * - 左键：施法；cam_rot=旋转 / cam_pan=平移
   * - 右键：旋转（Shift+右键=平移）
   * - 中键：平移；滚轮：缩放；WASD/QE 键盘
   */
  setCamMode(mode){
    const m = mode === 'rotate' || mode === 'pan' ? mode : 'none';
    this._camMode = m;
    if(!this.controls) return;
    const LEFT = m === 'rotate' ? THREE.MOUSE.ROTATE
      : m === 'pan' ? THREE.MOUSE.PAN
      : null;
    this.controls.mouseButtons = {
      LEFT,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE
    };
    const ONE = m === 'rotate' ? THREE.TOUCH.ROTATE
      : m === 'pan' ? THREE.TOUCH.PAN
      : null;
    this.controls.touches = { ONE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  getCamMode(){ return this._camMode; }

  // R7 视角：回城 / 俯视 / 跟随居住质心
  panCameraTo(tx, ty, dist=null, elev=null){
    const target = new THREE.Vector3(tx, 2, ty);
    this.controls.target.copy(target);
    const d = dist ?? this.camera.position.distanceTo(this.controls.target);
    const el = elev ?? 0.55;
    const az = Math.PI * 0.35;
    this.camera.position.set(
      tx + Math.cos(az) * d * Math.cos(el),
      Math.sin(el) * d + 4,
      ty + Math.sin(az) * d * Math.cos(el)
    );
    this.controls.update();
  }
  viewHome(G){
    // 居住质心，无居住则原点
    let sx=0, sy=0, n=0;
    eachTile(G, (t,x,y)=>{ if(t.zone===1){ sx+=x; sy+=y; n++; } });
    const cx = n ? sx/n : 0, cy = n ? sy/n : 0;
    this.panCameraTo(cx, cy, 36, 0.55);
  }
  viewTop(G){
    let sx=0, sy=0, n=0;
    eachTile(G, (t,x,y)=>{ if(t.zone===1){ sx+=x; sy+=y; n++; } });
    const cx = n ? sx/n : 0, cy = n ? sy/n : 0;
    this.panCameraTo(cx, cy, 48, 1.25);
  }

  /**
   * 释放本渲染器持有的全部 GPU 资源（2026-10 新增）。
   * 此前类完全没有 dispose，导致任何「重建 Renderer」的路径（换世界不刷新页面、
   * 单页应用内重启、测试反复构造）都会重复申请几何/材质/贴图并重复注册事件监听。
   * _geo 与 _matCache 是**本类独占**的共享池（不同于 _geo 里被多处引用的几何本身），
   * 因此可以整池释放；但要在释放前先清掉引用它们的批次网格。
   */
  dispose(){
    // 1) 批次与实例缓冲（InstancedMesh.dispose 释放 instanceMatrix）
    this._clearTreeInst();
    this._clearBldInst();
    this._clearWildInst();
    if(this._npcInst){
      for(const m of Object.values(this._npcInst.b || {})){ this._npcGroupRemove(m); m.dispose(); }
      this._npcInst = null;
    }
    // 2) 场景中所有网格：几何若是本类 _geo 池内的，交由第 4 步统一释放；材质同理
    const geoPool = new Set(Object.values(this._geo || {}));
    const matPool = new Set((this._matCache || new Map()).values());
    this.scene.traverse((o)=>{
      if(!o.isMesh && !o.isInstancedMesh) return;
      if(o.geometry && !geoPool.has(o.geometry)) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for(const mt of mats) if(mt && !matPool.has(mt)) mt.dispose();
    });
    // 3) 本类独占的贴图与画布
    this._waveTex?.dispose(); this._waveTex = null;
    this.skyTex?.dispose();   this.skyTex = null;
    this._skyCanvas = null;
    // 4) 共享池整池释放
    for(const g of geoPool) g.dispose();
    this._geo = {};
    this.purgeMaterials(true);
    // 5) 渲染器本体与事件
    this._unbindCameraKeys?.();
    this.controls?.dispose?.();
    this.renderer?.dispose?.();
    this.buildingMeshes.clear();
    this.wonderMeshes.clear();
  }

  /** 移除村民批次里的一个网格（dispose 时用，避免直接访问私有分组） */
  _npcGroupRemove(m){ if(m) this.npcGroup.remove(m); }

  /**
   * 释放材质缓存（2026-10 新增）。
   * _matCache 此前只增不减：每换一次时代都会为新的时代配色建一批材质，
   * 五代跑满后旧时代材质永久驻留（数百个），且没有任何回收入口。
   * all=false 时只释放「当前未被任何网格引用」的材质。
   */
  purgeMaterials(all = false){
    if(!this._matCache) return 0;
    let used = null;
    if(!all){
      used = new Set();
      this.scene.traverse((o)=>{
        if(!o.material) return;
        for(const mt of (Array.isArray(o.material) ? o.material : [o.material])) if(mt) used.add(mt);
      });
    }
    let n = 0;
    for(const [k, m] of this._matCache){
      if(all || !used.has(m)){ m.dispose?.(); this._matCache.delete(k); n++; }
    }
    return n;
  }
}


export function cornerHeightAt(G, x, y){
  const t = getTile(G, x, y);
  if(!t) return heightAt(x, y, G.seed);
  return t.water ? WATER_Y : Math.max(0.3, t.h);
}
