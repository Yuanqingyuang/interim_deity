// 实习神明 · Three.js 渲染
// 无边界延伸地形 · 日照系统 · 优化低多边形素材

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TILE, WATER_LEVEL, WILD, FOG_NEAR, FOG_FAR,
  PALETTES, BUILDING_STYLE, ZONES, FOLKCOL, FOLK_HEAD,
  CHURCH_STYLE, FACTORY_STYLE, CHUNK, FARM_CROP, FARM_SOIL, churchStyleForEra, factoryStyleForEra,
  sampleSun, lerpHex, hash2, mulberry32
} from './config.js';
import { cornerColor, heightAt, riverMask, sampleHeight } from './terrain.js';
import { getTile, eachTile, chunkBounds, tileLive } from './state.js';

const WATER_Y = WATER_LEVEL;
const MIN_H_SAFE = 0.22;

export class Renderer {
  constructor(canvas){
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.era = 0;
    this.dayTime = 0.35;
    this.skyTex = null;
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

    this.terrainMesh = null;
    this.waterMesh = null;
    this.hoverMesh = null;
    this.buildingGroup = new THREE.Group(); this.scene.add(this.buildingGroup);
    this.treeGroup = new THREE.Group(); this.scene.add(this.treeGroup);
    this.npcGroup = new THREE.Group(); this.scene.add(this.npcGroup);
    this.particleGroup = new THREE.Group(); this.scene.add(this.particleGroup);
    this.wonderGroup = new THREE.Group(); this.scene.add(this.wonderGroup);
    this.decoGroup = new THREE.Group(); this.scene.add(this.decoGroup);
    this.buildingMeshes = new Map();
    this.treeMeshes = new Map();
    this.wonderMeshes = new Map();
    this.terrainDirty = true;
    this._npcHomes = [];
    this._npcHomesDirty = true;

    this._buildGeo();
    this._buildSkyTexture(0, this.dayTime);
    this.makeHover();
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
    };
    this._matCache = new Map();
    this._wildHeights = null;
    this._wildHeightsMeta = null;
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
    for(let gy=0; gy<H; gy++){
      for(let gx=0; gx<W; gx++){
        const wx = ox + gx - 1;
        const wy = oy + gy - 1;
        let h = sampleHeight(wx, wy, seed);
        heights[gy*W+gx] = h;
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
    const positions = new Float32Array(W*H*3);
    const colors = new Float32Array(W*H*3);

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
    const cornerHeights = new Float32Array(W*H);
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

    const indices = [];
    for(let gy=0; gy<H-1; gy++){
      for(let gx=0; gx<W-1; gx++){
        const a = gy*W+gx, b=gy*W+gx+1, c=(gy+1)*W+gx, d=(gy+1)*W+gx+1;
        indices.push(a, c, b,  b, c, d);
      }
    }

    if(this.terrainMesh){
      this.terrainMesh.geometry.dispose();
    } else {
      this.terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:0.95, metalness:0.0 }));
      this.terrainMesh.receiveShadow = true;
      this.terrainMesh.castShadow = true;   // 地形自身也要投影，否则山体没有自阴影
      this.scene.add(this.terrainMesh);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions,3));
    g.setAttribute('color', new THREE.BufferAttribute(colors,3));
    g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.terrainMesh.geometry = g;

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
      // 几何来自 _geo 缓存，不要 dispose
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
      this.waterMesh.geometry?.dispose();
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
      for(let i=0;i<56;i++){
        const x = Math.random()*128, y = Math.random()*128;
        const rx = 3 + Math.random()*16, ry = 1.2 + Math.random()*3.5;
        const g2 = ctx.createRadialGradient(x,y,0,x,y,rx);
        g2.addColorStop(0, 'rgba(255,255,255,0.45)');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.translate(x,y);
        ctx.rotate((Math.random()-0.5)*0.8);
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

  _makeFarm(t, era=0){
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const e = Math.max(0, Math.min(4, era|0));
    const field = new THREE.Mesh(this._geo.field, this._mat(FARM_SOIL[e] ?? 0x8b6914));
    field.position.y = 0.03; field.receiveShadow = true;
    grp.add(field);
    const cropPal = FARM_CROP[e] || FARM_CROP[0];
    const cropCol = cropPal[varn % cropPal.length];
    for(let i=-1;i<=1;i++){
      const crop = new THREE.Mesh(this._geo.crop, this._mat(cropCol));
      crop.position.set(i*0.2, 0.16 + varn*0.03, 0);
      crop.scale.y = 0.85 + varn*0.12;
      crop.castShadow = true;
      grp.add(crop);
    }
    for(const [fx,fz,ry] of [[0,-0.36,0],[0,0.36,0]]){
      const f = new THREE.Mesh(this._geo.fence, this._mat(0xa08050));
      f.position.set(fx, 0.1, fz); f.rotation.y = ry;
      grp.add(f);
    }
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // 居住区：民宅 — 主屋 + 偏屋 + 坡顶 + 门窗 + 前廊
  _makeHouse(t, era){
    const style = BUILDING_STYLE[era] || BUILDING_STYLE[0];
    const grp = new THREE.Group();
    const varn = t.variant % 3;
    const bh = Math.max(0.78, style.h * (0.90 + varn*0.08));
    const fp = 0.70;
    const wallMat = this._mat(style.wall);
    const sideMat = this._mat(style.side);
    const roofMat = this._mat(style.roof);
    const trimMat = this._mat(lerpHex(style.wall, 0xffffff, 0.25));
    grp.rotation.y = (hash2(t._wx|0, t._wz|0, t.variant) - 0.5) * 0.10;

    if(!this._geo.pad) this._geo.pad = new THREE.BoxGeometry(1, 0.04, 1);
    const pad = new THREE.Mesh(this._geo.pad, sideMat);
    pad.scale.set(fp*1.18, 1, fp*1.18);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    grp.add(pad);

    if(!this._geo.houseBody) this._geo.houseBody = new THREE.BoxGeometry(1, 1, 1);
    const body = new THREE.Mesh(this._geo.houseBody, wallMat);
    body.scale.set(fp*0.72, bh, fp*0.86);
    body.position.set(-fp*0.06, bh/2, 0);
    body.castShadow = true; body.receiveShadow = true;
    grp.add(body);

    const wingH = bh * (0.55 + varn*0.08);
    const wing = new THREE.Mesh(this._geo.houseBody, sideMat);
    wing.scale.set(fp*0.42, wingH, fp*0.55);
    wing.position.set(fp*0.28, wingH/2, -fp*0.08);
    wing.castShadow = true; wing.receiveShadow = true;
    grp.add(wing);

    if(!this._geo.wingRoof) this._geo.wingRoof = new THREE.BoxGeometry(1, 1, 1);
    const wingRoof = new THREE.Mesh(this._geo.wingRoof, roofMat);
    wingRoof.scale.set(fp*0.48, 0.06, fp*0.60);
    wingRoof.position.set(fp*0.28, wingH + 0.03, -fp*0.08);
    wingRoof.castShadow = true;
    grp.add(wingRoof);

    const eave = new THREE.Mesh(this._geo.eave, roofMat);
    eave.scale.set(fp*0.82/0.78, 1, fp*0.96/0.78);
    eave.position.set(-fp*0.06, bh - 0.015, 0);
    eave.castShadow = true;
    grp.add(eave);

    const roof = new THREE.Mesh(this._geo.roof, roofMat);
    roof.position.set(-fp*0.06, bh + 0.22, 0);
    roof.rotation.y = Math.PI/4;
    roof.scale.set(fp*0.95/0.52, 0.88 + varn*0.08, fp*1.05/0.52);
    roof.castShadow = true;
    grp.add(roof);

    if(style.deco === 'thatch'){
      if(!this._geo.thatch) this._geo.thatch = new THREE.ConeGeometry(0.34, 0.24, 4);
      const thatch = new THREE.Mesh(this._geo.thatch, this._mat(style.decoCol));
      thatch.position.set(-fp*0.06, bh + 0.20, 0);
      thatch.rotation.y = Math.PI/4;
      thatch.scale.setScalar(fp/0.72);
      thatch.castShadow = true;
      grp.add(thatch);
    }

    const doorZ = fp*0.44;
    if(!this._geo.step) this._geo.step = new THREE.BoxGeometry(0.28, 0.06, 0.10);
    const step = new THREE.Mesh(this._geo.step, sideMat);
    step.position.set(-fp*0.06, 0.05, doorZ + 0.04);
    grp.add(step);

    const door = new THREE.Mesh(this._geo.door, sideMat);
    door.position.set(-fp*0.06, 0.16, doorZ);
    door.scale.set(fp/0.72 * 0.9, 1.05, 1);
    grp.add(door);
    const lintel = new THREE.Mesh(this._geo.lintelDoor, trimMat);
    lintel.position.set(-fp*0.06, 0.34, doorZ);
    grp.add(lintel);

    const winMat = this._basicMat(style.window || 0xffe08c);
    const winY = Math.min(bh*0.58, Math.max(0.38, bh*0.50));
    for(const wx of [-fp*0.28, fp*0.12]){
      const w = new THREE.Mesh(this._geo.window, winMat);
      w.position.set(wx, winY, fp*0.42);
      grp.add(w);
      if(!this._geo.sill) this._geo.sill = new THREE.BoxGeometry(0.14, 0.02, 0.03);
      const sill = new THREE.Mesh(this._geo.sill, trimMat);
      sill.position.set(wx, winY - 0.08, fp*0.43);
      grp.add(sill);
    }
    const wingWin = new THREE.Mesh(this._geo.window, winMat);
    wingWin.position.set(fp*0.28, wingH*0.55, fp*0.20);
    grp.add(wingWin);

    if(varn !== 0 && bh > 0.8){
      const chim = new THREE.Mesh(this._geo.chimney, sideMat);
      chim.position.set(fp*0.18, bh + 0.22, -fp*0.16);
      chim.castShadow = true;
      grp.add(chim);
    }

    if((style.deco === 'spire' || style.deco === 'pitched') && varn===2){
      if(!this._geo.smallSpire) this._geo.smallSpire = new THREE.ConeGeometry(0.08, 0.28, 5);
      const tip = new THREE.Mesh(this._geo.smallSpire, roofMat);
      tip.position.set(-fp*0.28, bh + 0.30, -fp*0.12);
      tip.castShadow = true;
      grp.add(tip);
    }

    if(style.deco === 'dome' && era >= 4){
      if(!this._geo.dome) this._geo.dome = new THREE.SphereGeometry(0.26, 8, 6, 0, Math.PI*2, 0, Math.PI/2);
      const dome = new THREE.Mesh(this._geo.dome, this._mat(style.glow, {
        transparent:true, opacity: style.glowA ?? 0.55, roughness:0.25
      }));
      dome.position.set(-fp*0.06, bh + 0.02, 0);
      grp.add(dome);
    }

    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // 信仰区：教堂 — 奶油石墙、深石板尖顶、尖塔十字、玫瑰窗
  _makeChurch(t, era){
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
    if(!this._geo.pad) this._geo.pad = new THREE.BoxGeometry(1, 0.04, 1);
    const pad = new THREE.Mesh(this._geo.pad, stoneMat);
    pad.scale.set(0.72, 1, 0.82);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    grp.add(pad);

    // 中殿（纵向长殿）
    if(!this._geo.nave) this._geo.nave = new THREE.BoxGeometry(1, 1, 1);
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
    if(!this._geo.churchRoof) this._geo.churchRoof = new THREE.ConeGeometry(0.42, 0.7, 4);
    const roof = new THREE.Mesh(this._geo.churchRoof, roofMat);
    roof.position.set(0, naveH + 0.32, 0.02);
    roof.scale.set(naveW/0.42 * 1.15, 1, naveL/0.42 * 0.95);
    roof.rotation.y = Math.PI/4;
    roof.castShadow = true;
    grp.add(roof);

    // 西立面钟塔 + 尖顶 + 十字
    const towerH = naveH * 1.55;
    if(!this._geo.churchTower) this._geo.churchTower = new THREE.BoxGeometry(0.28, 1, 0.28);
    const tower = new THREE.Mesh(this._geo.churchTower, wallMat);
    tower.scale.set(1, towerH, 1);
    tower.position.set(0, towerH/2, naveL*0.42);
    tower.castShadow = true;
    grp.add(tower);

    if(!this._geo.churchSpire) this._geo.churchSpire = new THREE.ConeGeometry(0.18, 0.55, 4);
    const spire = new THREE.Mesh(this._geo.churchSpire, this._mat(C.roofDeep));
    spire.position.set(0, towerH + 0.26, naveL*0.42);
    spire.rotation.y = Math.PI/4;
    spire.castShadow = true;
    grp.add(spire);

    // 十字架（金饰）
    if(!this._geo.crossV) this._geo.crossV = new THREE.BoxGeometry(0.03, 0.18, 0.03);
    if(!this._geo.crossH) this._geo.crossH = new THREE.BoxGeometry(0.12, 0.03, 0.03);
    const crossMat = this._mat(C.accent, { roughness:0.4, metalness:0.5 });
    const cv = new THREE.Mesh(this._geo.crossV, crossMat);
    cv.position.set(0, towerH + 0.58, naveL*0.42);
    grp.add(cv);
    const ch = new THREE.Mesh(this._geo.crossH, crossMat);
    ch.position.set(0, towerH + 0.62, naveL*0.42);
    grp.add(ch);

    // 塔顶发光球
    if(!this._geo.spireBall) this._geo.spireBall = new THREE.SphereGeometry(0.06, 6, 5);
    const ball = new THREE.Mesh(this._geo.spireBall, this._basicMat(C.glow));
    ball.position.set(0, towerH + 0.72, naveL*0.42);
    grp.add(ball);

    // 拱门
    if(!this._geo.archDoor) this._geo.archDoor = new THREE.BoxGeometry(0.14, 0.22, 0.04);
    const arch = new THREE.Mesh(this._geo.archDoor, this._mat(C.roofDeep));
    arch.position.set(0, 0.12, naveL*0.42 + 0.16);
    grp.add(arch);

    // 玫瑰窗（圆窗）
    if(!this._geo.rose) this._geo.rose = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8);
    const rose = new THREE.Mesh(this._geo.rose, this._basicMat(C.window));
    rose.rotation.x = Math.PI/2;
    rose.position.set(0, towerH*0.72, naveL*0.42 + 0.16);
    grp.add(rose);

    // 侧窗（高窄条）
    if(!this._geo.churchWin) this._geo.churchWin = new THREE.BoxGeometry(0.06, 0.18, 0.03);
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

    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  // 工业区：厂房 — 低矮混凝土体 + 锯齿屋顶 + 砖烟囱 + 装卸口
  _makeFactory(t, era){
    const F = factoryStyleForEra(era);
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
    if(!this._geo.pad) this._geo.pad = new THREE.BoxGeometry(1, 0.04, 1);
    const pad = new THREE.Mesh(this._geo.pad, sideMat);
    pad.scale.set(fw*1.15, 1, fl*1.1);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    grp.add(pad);

    // 主厂房（宽扁）
    if(!this._geo.shed) this._geo.shed = new THREE.BoxGeometry(1, 1, 1);
    const shed = new THREE.Mesh(this._geo.shed, wallMat);
    shed.scale.set(fw, bh, fl);
    shed.position.y = bh/2;
    shed.castShadow = true; shed.receiveShadow = true;
    grp.add(shed);

    // 锯齿屋顶条（工业厂房特征）
    if(!this._geo.saw) this._geo.saw = new THREE.BoxGeometry(0.14, 0.08, 0.55);
    const nSaw = 3;
    for(let i=0;i<nSaw;i++){
      const saw = new THREE.Mesh(this._geo.saw, roofMat);
      const sx = -fw/2 + fw*(i+0.5)/nSaw;
      saw.position.set(sx, bh + 0.04, 0);
      saw.castShadow = true;
      grp.add(saw);
      // 采光面
      if(!this._geo.sawGlass) this._geo.sawGlass = new THREE.BoxGeometry(0.1, 0.1, 0.02);
      const glass = new THREE.Mesh(this._geo.sawGlass, this._basicMat(F.window));
      glass.position.set(sx + 0.05, bh + 0.12, fl*0.28);
      grp.add(glass);
    }

    // 砖烟囱（比房高很多，工业标识）
    if(!this._geo.brickChim) this._geo.brickChim = new THREE.CylinderGeometry(0.07, 0.10, 1, 6);
    if(!this._geo.chimBand) this._geo.chimBand = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6);
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
    if(!this._geo.dock) this._geo.dock = new THREE.BoxGeometry(0.22, 0.18, 0.04);
    const dock = new THREE.Mesh(this._geo.dock, this._mat(F.metal));
    dock.position.set(-fw*0.12, 0.12, fl/2 + 0.01);
    grp.add(dock);

    // 侧窗条
    if(!this._geo.facWin) this._geo.facWin = new THREE.BoxGeometry(0.18, 0.08, 0.03);
    const winMat = this._basicMat(F.window);
    const w1 = new THREE.Mesh(this._geo.facWin, winMat);
    w1.position.set(fw*0.15, bh*0.72, fl/2 + 0.01);
    grp.add(w1);
    const w2 = new THREE.Mesh(this._geo.facWin, winMat);
    w2.position.set(-fw*0.15, bh*0.72, fl/2 + 0.01);
    grp.add(w2);

    grp.rotation.y = (hash2(t._wx|0, t._wz|0, t.variant) - 0.5) * 0.06;
    grp.position.set(t._wx, 0, t._wz);
    return grp;
  }

  makeTree(h, era, variant=0){
    const p = PALETTES[era];
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(this._geo.treeTrunk, this._mat(0x6d4c2a));
    trunk.position.y = 0.2; trunk.castShadow = true;
    grp.add(trunk);

    const kind = variant % 3;
    if(kind === 0){
      const top = new THREE.Mesh(this._geo.treeTop, this._mat(p.tree));
      top.position.y = 0.88; top.scale.setScalar(0.7 + h*0.1);
      top.castShadow = true; grp.add(top);
    } else if(kind === 1){
      // 双层球冠
      const mid = new THREE.Mesh(this._geo.treeMid, this._mat(p.tree));
      mid.position.y = 0.55; mid.castShadow = true;
      const top = new THREE.Mesh(this._geo.treeTop2, this._mat(p.tree));
      top.position.y = 0.85; top.scale.setScalar(0.75 + h*0.08);
      top.castShadow = true;
      grp.add(mid); grp.add(top);
    } else {
      // 灌木状 + 小石
      const bush = new THREE.Mesh(this._geo.bush, this._mat(p.tree));
      bush.position.y = 0.28; bush.scale.set(1.2, 0.9, 1.2);
      bush.castShadow = true;
      const bush2 = new THREE.Mesh(this._geo.bush, this._mat(p.tree));
      bush2.position.set(0.28, 0.18, 0.15);
      grp.add(bush); grp.add(bush2);
    }
    return grp;
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
    eachTile(G, (t, x, y)=>{
      t._wx = x*TILE; t._wz = y*TILE;
      // 建筑/树用邻域平均高，减少坡地穿模
      t._wy = t.water ? WATER_Y : this._surfaceY(G, x, y);
    });

    // 建筑 / 农田（视觉上限：超过后抽样代表格，逻辑数不变）
    const MAX_BUILD_MESH = 420;
    const seenB = new Set();
    let zoneCount = 0;
    eachTile(G, (t)=>{ if(t.zone>0) zoneCount++; });
    const step = zoneCount > MAX_BUILD_MESH ? Math.ceil(zoneCount / MAX_BUILD_MESH) : 1;
    let zi = 0;
    eachTile(G, (t, x, y)=>{
      const key = `${x},${y}`;
      if(t.zone>0){
        seenB.add(key);
        const idx = zi++;
        const show = step === 1 || (idx % step === 0) || this.buildingMeshes.has(key);
        if(!show) return;
        if(!this.buildingMeshes.has(key)){
          const m = this.makeBuilding(t, G.era);
          if(m){ this.buildingGroup.add(m); this.buildingMeshes.set(key, m); }
        }
        const m = this.buildingMeshes.get(key);
        if(m){
          // 底面略埋入地表 0.02，避免缝隙；高度用邻域均值
          m.position.set(t._wx, t._wy - 0.02, t._wz);
          m.visible = true;
          const prog = t.built ? 1 : Math.max(0.15, t.prog);
          const zs = ZONES[t.zone];
          m.scale.setScalar(zs.noBuilding ? (0.55+prog*0.45) : (0.35 + prog*0.65));
        }
      }
    });
    for(const [key, m] of this.buildingMeshes){
      if(!seenB.has(key)){ this.buildingGroup.remove(m); this.buildingMeshes.delete(key); }
    }

    // 树
    const seenT = new Set();
    eachTile(G, (t, x, y)=>{
      const key = `${x},${y}`;
      // 水面/极浅滩不长树
      if(t.tree && !t.water && t.h > WATER_Y + 0.15){
        seenT.add(key);
        if(!this.treeMeshes.has(key)){
          const m = this.makeTree(t.h, G.era, t.variant);
          this.treeGroup.add(m); this.treeMeshes.set(key,m);
        }
        const m = this.treeMeshes.get(key);
        if(m) m.position.set(t._wx, t._wy - 0.05, t._wz);
      }
    });
    for(const [key, m] of this.treeMeshes){
      if(!seenT.has(key)){ this.treeGroup.remove(m); this.treeMeshes.delete(key); }
    }

    // 奇迹
    for(const w of G.wonderList){
      const key = `w${w.x},${w.y}`;
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
    const pool = this.npcGroup.children;
    const prev = pool.length;

    if(prev !== target) this._npcHomesDirty = true;

    // 增员
    while(pool.length < target){
      const folkCol = FOLKCOL[G.era];
      const grp = this._makeVillager(folkCol, pool.length);
      const home = this._randomHome(G);
      const u = grp.userData;
      u.hx = home[0]; u.hz = home[1];
      u.state = 'idle';
      u.tx = home[0]; u.tz = home[1];
      u.st = 0; u.wait = 0.4 + Math.random()*2;
      grp.position.set(home[0], 0, home[1]);
      this.npcGroup.add(grp);
    }
    // 减员
    while(pool.length > target){
      this.npcGroup.remove(pool[pool.length-1]);
    }

    // 仅在人数变化或换时代时刷衣色（避免每帧全池扫描）
    const folkCol = FOLKCOL[G.era];
    if(this._npcEra !== G.era || prev !== target){
      this._npcEra = G.era;
      for(const m of pool){
        if(m.userData.clothMat) m.userData.clothMat.color.set(folkCol);
      }
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
    const b = chunkBounds(G);
    const minX = b.minX*TILE + 0.4, maxX = b.maxX*TILE - 0.4;
    const minZ = b.minY*TILE + 0.4, maxZ = b.maxY*TILE - 0.4;

    for(const m of this.npcGroup.children){
      const u = m.userData;
      u.st += dt;
      u.phase += dt;

      // 落水 / 虚空 → 立刻回岸
      if(!this._npcLand(G, m.position.x, m.position.z)){
        const home = this._randomHome(G);
        u.hx = home[0]; u.hz = home[1];
        u.tx = home[0]; u.tz = home[1];
        u.state = 'idle'; u.st = 0; u.wait = 0.4 + Math.random();
        m.position.x = home[0]; m.position.z = home[1];
        this._placeNpcY(m, G, 0);
        continue;
      }

      if(u.state === 'walk'){
        const dx = u.tx - m.position.x;
        const dz = u.tz - m.position.z;
        const d = Math.hypot(dx, dz);
        if(d < 0.12 || u.st > 5.5){
          u.state = 'idle';
          u.st = 0;
          u.wait = 0.7 + Math.random()*3.2;
        } else {
          const step = Math.min(d, u.spd * dt);
          const nx = m.position.x + (dx/d)*step;
          const nz = m.position.z + (dz/d)*step;
          if(!this._npcLand(G, nx, nz)){
            u.state = 'idle'; u.st = 0; u.wait = 0.25;
          } else {
            m.position.x = nx;
            m.position.z = nz;
            m.rotation.y = Math.atan2(dx, dz);
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

      // 四肢
      const walking = u.state === 'walk';
      if(u.legL){
        const sw = walking ? Math.sin(u.phase*9)*0.55 : Math.sin(u.phase*1.5)*0.04;
        u.legL.rotation.x = sw;
        u.legR.rotation.x = -sw;
        u.armL.rotation.x = -sw*0.85;
        u.armR.rotation.x = sw*0.85;
      }
      this._placeNpcY(m, G, walking ? Math.abs(Math.sin(u.phase*9))*0.03 : 0);
    }
  }

  _placeNpcY(m, G, bob){
    const tx = Math.round(m.position.x / TILE);
    const ty = Math.round(m.position.z / TILE);
    const tile = getTile(G, tx, ty);
    const ground = !tile
      ? sampleHeight(tx, ty, G.seed)
      : (tile.water ? WATER_Y : this._surfaceY(G, tx, ty));
    m.position.y = ground + bob;
  }

  // 低多边形村民：腿+躯干+双臂+头+发髻/挎包
  _makeVillager(folkCol, variant){
    const grp = new THREE.Group();
    const skin = this._mat(FOLK_HEAD);
    const cloth = this._mat(folkCol);
    const dark = this._mat(lerpHex(folkCol, 0x2a2018, 0.35));

    // 腿（髋部为 pivot）
    const legLg = new THREE.Group(); legLg.position.set(-0.045, 0.16, 0);
    const legL = new THREE.Mesh(this._geo.leg, dark);
    legL.position.y = -0.08;
    legL.castShadow = true;
    legLg.add(legL);
    const legRg = new THREE.Group(); legRg.position.set(0.045, 0.16, 0);
    const legR = new THREE.Mesh(this._geo.leg, dark);
    legR.position.y = -0.08;
    legR.castShadow = true;
    legRg.add(legR);
    grp.add(legLg); grp.add(legRg);

    // 躯干
    const torso = new THREE.Mesh(this._geo.torso, cloth);
    torso.position.y = 0.28;
    torso.castShadow = true;
    grp.add(torso);

    // 手臂（肩为 pivot）
    const armLg = new THREE.Group(); armLg.position.set(-0.13, 0.36, 0);
    const armL = new THREE.Mesh(this._geo.arm, cloth);
    armL.position.y = -0.07;
    armL.castShadow = true;
    armLg.add(armL);
    const armRg = new THREE.Group(); armRg.position.set(0.13, 0.36, 0);
    const armR = new THREE.Mesh(this._geo.arm, cloth);
    armR.position.y = -0.07;
    armR.castShadow = true;
    armRg.add(armR);
    grp.add(armLg); grp.add(armRg);

    // 头 + 发
    const head = new THREE.Mesh(this._geo.head, skin);
    head.position.y = 0.46;
    head.castShadow = true;
    grp.add(head);
    const hair = new THREE.Mesh(this._geo.hair, dark);
    hair.position.y = 0.48;
    hair.castShadow = true;
    grp.add(hair);

    // 变体：挎包 / 小背包
    if(variant % 2 === 1){
      const bag = new THREE.Mesh(this._geo.satchel, this._mat(0x8b5a2b));
      bag.position.set(0.1, 0.28, 0.06);
      grp.add(bag);
    }

    grp.userData = {
      legL: legLg, legR: legRg, armL: armLg, armR: armRg,
      torso, clothMat: cloth,
      hx: 0, hz: 0, tx: 0, tz: 0,
      state: 'idle', st: Math.random()*2, wait: 1+Math.random()*3,
      spd: 0.55+Math.random()*0.45,
      phase: Math.random()*Math.PI*2
    };
    return grp;
  }

  setHover(x, y, G){
    if(x==null){ this.hoverMesh.visible=false; return; }
    const t = getTile(G, x, y);
    if(!t){ this.hoverMesh.visible=false; return; }
    const h = t.water ? WATER_Y : Math.max(0.3, t.h);
    this.hoverMesh.position.set(x*TILE, h+0.06, y*TILE);
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
    for(const m of this.npcGroup.children){
      const cloth = m.userData.clothMat || m.userData.torso?.material;
      if(cloth) cloth.color.set(FOLKCOL[G.era]);
    }
    for(const [,m] of this.treeMeshes) this.treeGroup.remove(m);
    this.treeMeshes.clear();
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
}

export function cornerHeightAt(G, x, y){
  const t = getTile(G, x, y);
  if(!t) return heightAt(x, y, G.seed);
  return t.water ? WATER_Y : Math.max(0.3, t.h);
}
