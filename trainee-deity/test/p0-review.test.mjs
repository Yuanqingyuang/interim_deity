// P0 复查：拆除不误建日志；奇迹不占分区（placeAt/demolish 路径）
import { createState, eachTile, getTile, refreshBuiltCache } from '../js/state.js';
import { genWorld, placeAt, applyTool } from '../js/terrain.js';
import { LOG_CODE } from '../js/log.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

assert(typeof LOG_CODE[90] === 'function', 'demolish log code 90 exists');

const G = createState(21);
genWorld(G);
G.logs = [];
let site = null;
eachTile(G, (t,x,y)=>{ if(!site && !t.water && t.h>1.2 && t.h<4.5) site=[x,y]; });
placeAt(G, site[0], site[1], 1, 'manual');
// simulate main onZonePlaced only for place - demolish uses onZoneRemoved
G.onZonePlaced = (x,y,z)=>{ G.logs.push({c:z,x,y,t:0}); };
G.onZoneRemoved = (x,y)=>{ /* no build log */ };
G.tool = 'demolish';
G.power = 50;
applyTool(G, site[0], site[1], 0.05);
const buildLogs = G.logs.filter(e => e.c>=1 && e.c<=4);
assert(buildLogs.length === 0, 'no build logs on demolish');
assert(getTile(G, site[0], site[1]).zone === 0, 'zone cleared');

// food口径：built vs zoned 不变量 — place farm, not built → foodPerSec(built)=0
placeAt(G, site[0]+2, site[1], 2, 'manual');
refreshBuiltCache(G);
assert(G._builtCache[2] === 0, 'farm not built yet');
assert(G._zoneCache[2] === 1, 'farm zoned=1');

console.log('P0 review tests PASS');
