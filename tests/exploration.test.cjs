const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = process.env.SCREEPS_SOURCE || path.join(__dirname, '../v1');
const sources = Object.fromEntries(fs.readdirSync(root).filter(n => n.endsWith('.js')).map(n => [n, fs.readFileSync(path.join(root, n), 'utf8')]));
const test = require('node:test');
function environment() {
  const constants = {};
  for (const text of Object.values(sources)) for (const token of text.matchAll(/\b[A-Z][A-Z_0-9]+\b/g)) constants[token[0]] = token[0];
  Object.assign(constants, {OK:0, ERR_NO_PATH:-2, ERR_NOT_IN_RANGE:-9, FIND_EXIT_TOP:1, FIND_EXIT_RIGHT:3, FIND_EXIT_BOTTOM:5, FIND_EXIT_LEFT:7, TERRAIN_MASK_WALL:1});
  constants.BODYPART_COST = {MOVE:50, WORK:100, CARRY:50, ATTACK:80, RANGED_ATTACK:150, HEAL:250, CLAIM:600, TOUGH:10};
  const memory = {rooms:{},creeps:{}};
  const game = {time:100,rooms:{},creeps:{},spawns:{},flags:{},gcl:{level:2},map:{findRoute:(from,to)=>[{room:to}],describeExits:()=>({}),getRoomStatus:()=>({status:'normal'}),getRoomLinearDistance:()=>1},getObjectById:()=>null};
  function RoomPosition(x,y,roomName) { Object.assign(this,{x,y,roomName}); }
  RoomPosition.prototype.getRangeTo = function(t) { t=t.pos||t; return t.roomName!==this.roomName ? Infinity : Math.max(Math.abs(this.x-t.x),Math.abs(this.y-t.y)); };
  RoomPosition.prototype.lookFor = () => [];
  class CostMatrix {
    constructor(){this.data=new Uint8Array(2500);}
    set(x,y,v){this.data[y*50+x]=v;}
    get(x,y){return this.data[y*50+x];}
    clone(){const c=new CostMatrix();c.data.set(this.data);return c;}
  }
  const PathFinder={CostMatrix,search:()=>({incomplete:false,path:[{x:1,y:1}]})};
  const cache = {};
  const overrides = {'utils.debug':{log(){},enabled(){return false;},initialize(){}}};
  function load(name) {
    if(overrides[name]) return {exports:overrides[name]};
    if(cache[name]) return cache[name];
    const ctx = vm.createContext({...constants,Game:game,Memory:memory,RoomPosition,PathFinder,console,module:{exports:{}},require:n=>load(n).exports});
    ctx.global=ctx; cache[name] = {context:ctx};
    vm.runInContext(sources[name+'.js'], ctx, {filename:name+'.js'});
    cache[name].exports = ctx.module.exports;
    return cache[name];
  }
  function room(name, owned=true) {
    const r = {name,memory:{remote:{rooms:{}}},energyAvailable:800,energyCapacityAvailable:800,
      controller:{my:owned,level:owned?6:0,pos:new RoomPosition(25,25,name)},
      find(type,opts) { let objects = type===constants.FIND_SOURCES ? [{id:name+'source',room:this,pos:new RoomPosition(10,10,name)}] : type===constants.FIND_MY_STRUCTURES&&owned ? [{structureType:constants.STRUCTURE_SPAWN,pos:new RoomPosition(20,20,name)}] : []; return opts&&opts.filter ? objects.filter(opts.filter) : objects; },
      getTerrain:()=>({get:()=>0})};
    game.rooms[name]=r; memory.rooms[name]=r.memory;
    if(owned) game.spawns[name+'Spawn']={owner:{username:'me'},room:r};
    return r;
  }
  return {game,memory,load,room,constants,RoomPosition,overrides,PathFinder};
}
function addUnknown(e,h,name='W2N1') {h.memory.remote.rooms[name]={status:'unknown',distance:1};return name;}
function scout(e,h,target='W2N1') {
  const c={name:'scout',memory:{role:'scout',homeRoom:h.name,targetRoom:target},room:h,pos:new e.RoomPosition(20,20,h.name),fatigue:0,say(){}};
  e.game.creeps[c.name]=c;return c;
}
test('all modules parse',()=>{for(const [name,source] of Object.entries(sources))new vm.Script(source,{filename:name});});
test('scouts use one MOVE at every capacity and need only 50 energy',()=>{
  const e=environment(),h=e.room('W1N1'),m=e.load('manager.spawn').exports;
  const counts={harvester:2,transporter:1,builder:2,upgrader:1,mineralHarvester:0,defender:0};
  for(const capacity of [300,800,1300,3300,12000]){
    h.energyCapacityAvailable=capacity;h.energyAvailable=50;
    const d=m.getSpawnBodyDecision(h,'scout','scout',counts,counts);assert.equal(d.body.length,1);assert.equal(d.desiredCost,50);
  }
  h.energyAvailable=49;assert.equal(m.getSpawnBodyDecision(h,'scout','scout',counts,counts).body,null);
});
test('room routing constrains tile costs and rejects known hostile transit',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);let calls=0,options;
  e.memory.remote={unsafeRooms:{W9N9:{unsafeUntil:1000}}};
  e.game.map.findRoute=(from,to,opts)=>{calls++;assert.equal(opts.routeCallback('W9N9',from),Infinity);return[{room:'W3N1'},{room:to}];};
  c.moveTo=(pos,opts)=>{options=opts;return 0;};
  assert.equal(e.load('manager.remote').exports.moveToRoom(c,'W2N1'),0);
  assert.equal(calls,1);assert.equal(options.routeCallback,undefined);
  const matrix=new e.PathFinder.CostMatrix();assert.equal(options.costCallback('W3N1',matrix),matrix);
  const blocked=options.costCallback('W9N9',matrix);assert.equal(blocked.get(0,0),255);assert.equal(blocked.get(49,49),255);
});
test('new danger invalidates cached room and tile routes',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);let calls=0;
  e.game.map.findRoute=()=>{calls++;return calls===1?[{room:'W3N1'},{room:'W2N1'}]:-2;};c.moveTo=()=>0;
  const m=e.load('manager.remote').exports;m.moveToRoom(c,'W2N1');c.memory._move={path:'old'};
  e.memory.remote={unsafeRooms:{W3N1:{unsafeUntil:1000}}};e.game.time++;
  assert.equal(m.moveToRoom(c,'W2N1'),-2);assert.equal(calls,2);assert.equal(c.memory._move,undefined);assert.equal(c.memory.remoteRoute,undefined);
});
test('local travel does not call the room router',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);e.game.map.findRoute=()=>{throw Error('unnecessary routing');};c.moveTo=()=>0;
  assert.equal(e.load('manager.remote').exports.moveToRoom(c,h.name),0);
});
test('no route returns ERR_NO_PATH without issuing movement',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);e.game.map.findRoute=()=>-2;c.moveTo=()=>{throw Error('must not move');};
  assert.equal(e.load('manager.remote').exports.moveToRoom(c,'W2N1'),-2);
});
test('a highway reveals its exits while remaining unavailable for mining',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W1N0',false);delete r.controller;
  e.game.map.describeExits=n=>n===r.name?{3:'W2N0'}:{};
  addUnknown(e,h,r.name);const m=e.load('manager.remote').exports;m.run(h);
  assert.ok(h.memory.remote.rooms.W2N0);assert.equal(h.memory.remote.rooms[r.name].reason,'no controller');assert.equal(m.isRemoteWorkable(h.name,r.name),false);
});
test('expired foreign reservation can be scouted again',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);r.controller.reservation={username:'other',ticksToEnd:50};addUnknown(e,h,r.name);
  const m=e.load('manager.remote').exports;m.run(h);delete e.game.rooms[r.name];e.game.time+=2000;
  assert.equal(m.getScoutTarget(h.name,null),r.name);
});
test('unsafe cooldown prevents reentry but expiry permits cautious scouting',()=>{
  const e=environment(),h=e.room('W1N1');h.memory.remote.rooms.W2N1={status:'unsafe',reason:'hostile tower',lastScouted:1,distance:1,unsafeUntil:5000};
  const m=e.load('manager.remote').exports;assert.equal(m.getScoutTarget(h.name,null),null);e.game.time=5001;assert.equal(m.getScoutTarget(h.name,null),'W2N1');
});
test('separate parent connections have independent exit caches',()=>{
  const e=environment(),a=e.room('W1N1'),b=e.room('W2N2',false),m=e.load('manager.remote');const record={};const settings=m.exports.getSettings(a);
  a.find=()=>[];b.find=type=>type===7?[new e.RoomPosition(0,25,b.name)]:[];
  assert.equal(m.context.hasAccessibleExit(a,3,record,settings),false);assert.equal(m.context.hasAccessibleExit(b,7,record,settings),true);
  assert.equal(record.exitAccessByRoom[a.name].accessible,false);assert.equal(record.exitAccessByRoom[b.name].accessible,true);
});
test('one quiet observation cannot clear an active hostile-room quarantine',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);h.memory.remote.rooms[r.name]={status:'unsafe',reason:'combat hostile',distance:1,unsafeUntil:5100,unsafeAttempts:1};
  e.memory.remote={unsafeRooms:{[r.name]:{unsafeUntil:5100}}};const m=e.load('manager.remote').exports;m.run(h);
  assert.equal(h.memory.remote.rooms[r.name].unsafeUntil,5100);assert.equal(m.isRemoteUsable(h.name,r.name),false);
  assert.ok(e.memory.remote.unsafeRooms[r.name]);
  e.game.time=5101;m.run(h);assert.equal(h.memory.remote.rooms[r.name].unsafeUntil,undefined);assert.equal(m.isRemoteUsable(h.name,r.name),true);
});
test('three no-path results release a scout mission and start a bounded retry',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);e.overrides['utils.creep']={announceIntent(){},moveTo(){return -2;}};const c=scout(e,h);const role=e.load('role.scout').exports;
  for(let i=0;i<3;i++){e.game.time++;role.run(c);}
  assert.equal(c.memory.targetRoom,undefined);assert.ok(h.memory.remote.rooms.W2N1.scoutRetryUntil>e.game.time);
  const m=e.load('manager.remote').exports;assert.equal(m.getScoutTarget(h.name,null),null);e.game.time+=251;assert.equal(m.getScoutTarget(h.name,null),'W2N1');
});
test('successful-but-stationary scout moves eventually time out',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);e.overrides['utils.creep']={announceIntent(){},moveTo(){return 0;}};const c=scout(e,h),role=e.load('role.scout').exports;
  for(let i=0;i<27;i++){e.game.time++;role.run(c);}
  assert.ok(h.memory.remote.rooms.W2N1.scoutRetryUntil>e.game.time);
});
test('moving in a loop is bounded by the mission deadline',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);e.overrides['utils.creep']={announceIntent(){},moveTo(){return 0;}};const c=scout(e,h),role=e.load('role.scout').exports;
  h.memory.remote.scoutMissionTicks=5;
  for(let i=0;i<7;i++){c.pos.x=20+i%2;e.game.time++;role.run(c);}
  assert.ok(h.memory.remote.rooms.W2N1.scoutRetryUntil>e.game.time);
});
test('claimer retains fresh neutral target after scout vision is lost',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);addUnknown(e,h,r.name);const m=e.load('manager.remote').exports;
  assert.equal(m.getClaimerTarget(h.name,r.name),r.name);delete e.game.rooms[r.name];e.game.time++;assert.equal(m.getClaimerTarget(h.name,r.name),r.name);
});
test('claimer rejects stale or foreign-owned unseen intel',()=>{
  const e=environment(),h=e.room('W1N1');h.memory.remote.rooms.W2N1={status:'ready',sourceIds:['source'],hasController:true,controllerOwner:'enemy',lastScouted:99,distance:1};
  const m=e.load('manager.remote').exports;assert.equal(m.getClaimerTarget(h.name,'W2N1'),null);
  h.memory.remote.rooms.W2N1.controllerOwner=null;e.game.time+=2000;assert.equal(m.getClaimerTarget(h.name,'W2N1'),null);
});
test('priority flag seeds discovery',()=>{
  const e=environment(),h=e.room('W1N1');e.game.flags.Flag1={pos:new e.RoomPosition(25,25,'W2N1')};assert.equal(e.load('manager.remote').exports.getScoutTarget(h.name,null),'W2N1');
});
test('pause stops existing scouts and new scout requests',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);h.memory.remote.enabled=false;const m=e.load('manager.remote').exports;
  assert.equal(m.getScoutTarget(h.name,'W2N1'),null);assert.equal(m.getScoutSpawnRequest(h),null);
});
test('memory migration is idempotent and preserves exclusions and preferences',()=>{
  const e=environment(),h=e.room('W1N1');h.memory.remote.rooms.W2N1={enabled:false,status:'blocked',reason:'exit inaccessible',exitAccessible:false,exitAccessChecked:99};
  h.memory.remote.rooms.W3N1={status:'unsafe',reason:'hostile tower',unsafeUntil:9000};const m=e.load('manager.remote').exports;m.getSettings(h);
  const r=h.memory.remote.rooms.W2N1;assert.equal(r.exitAccessible,undefined);assert.equal(r.status,'unknown');assert.equal(r.enabled,false);assert.equal(h.memory.remote.rooms.W3N1.unsafeUntil,9000);
  r.exitAccessByRoom={W1N1:{accessible:true,tick:100}};m.getSettings(h);assert.equal(r.exitAccessByRoom.W1N1.accessible,true);
});
test('repeated movement refreshes traffic intent timestamp',()=>{
  const e=environment(),m=e.load('utils.creep'),c={memory:{},say(){}};m.context.announceIntent(c,'move:x','x');e.game.time+=10;m.context.announceIntent(c,'move:x','x');assert.equal(m.context.isRecentMoveIntent(c),true);
});
test('scout request is capped and existing discovery miners avoid duplicate assignments',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);const m=e.load('manager.remote').exports;assert.equal(m.getScoutSpawnRequest(h).role,'scout');
  const c=scout(e,h);assert.equal(m.getScoutSpawnRequest(h),null);delete e.game.creeps.scout;
  e.game.creeps.miner={memory:{role:'remoteMiner',targetRoom:'W2N1'}};assert.equal(m.getScoutSpawnRequest(h),null);delete e.game.creeps.miner;
  h._scoutSpawnRequestedTick=e.game.time;assert.equal(m.getScoutSpawnRequest(h),null);
});
test('defenders precede optional builders once essentials are staffed',()=>{
  const e=environment(),m=e.load('manager.spawn').exports,c={harvester:2,transporter:1,upgrader:1,builder:0,defender:0,mineralHarvester:0};assert.equal(m.getSpawnRole(c,{...c,builder:1,defender:2}),'defender');
});
function mainFixture() {
  const e=environment();e.room('W1N1');const calls=[];
  for(const file of Object.keys(sources)){const n=file.replace(/\.js$/,'');if(n.startsWith('manager.')||n.startsWith('role.'))e.overrides[n]={run(){calls.push(n);}};}
  e.game.creeps.worker={name:'worker',memory:{role:'harvester'},spawning:false};e.overrides['utils.creep']={retreatFromHostiles(){return false;}};
  return {e,calls};
}
test('optional-manager errors cannot prevent spawning or creep actions',()=>{
  const {e,calls}=mainFixture();e.overrides['manager.market']={run(){throw Error('injected market failure');}};e.load('main').exports.loop();
  assert.ok(calls.includes('manager.spawn'));assert.ok(calls.includes('role.harvester'));assert.ok(e.memory.runtimeErrors['market:W1N1']);
});
test('remote-manager error is isolated from essential execution',()=>{
  const {e,calls}=mainFixture();e.overrides['manager.remote']={run(){throw Error('injected remote failure');}};e.load('main').exports.loop();assert.ok(calls.includes('role.harvester'));
});
test('low CPU skips optional work but retains core execution',()=>{
  const {e,calls}=mainFixture();e.game.cpu={limit:20,tickLimit:20,bucket:100,getUsed:()=>18};e.load('main').exports.loop();assert.ok(calls.includes('role.harvester'));assert.equal(calls.includes('manager.construction'),false);assert.equal(calls.includes('manager.market'),false);
});

test('replacement counts exclude expiring workers but include spawning replacements',()=>{
  const e=environment(),h=e.room('W1N1');e.game.creeps.old={room:h,memory:{role:'harvester'},body:[1,2,3],ticksToLive:1};
  const m=e.load('manager.spawn').exports;assert.equal(m.countRoles(h).harvester,0);
  e.game.creeps.new={room:h,memory:{role:'harvester'},body:[1,2,3],spawning:true};assert.equal(m.countRoles(h).harvester,1);
});
test('remote replacements include estimated travel time and an explicit override',()=>{
  const e=environment(),m=e.load('utils.lifecycle').exports,c={memory:{},body:Array(10),ticksToLive:100};e.game.map.getRoomLinearDistance=()=>2;
  assert.equal(m.needsReplacement(c,'W1N1','W3N1'),true);c.memory.replacementTravelTicks=20;assert.equal(m.needsReplacement(c,'W1N1','W3N1'),false);
});
test('remote worker counts schedule a successor before the incumbent dies',()=>{
  const e=environment();e.game.creeps.old={memory:{role:'remoteMiner',homeRoom:'W1N1',targetRoom:'W2N1',sourceId:'s'},body:Array(10),ticksToLive:1};
  const m=e.load('manager.remote');assert.equal(m.context.countRemoteCreeps(null,'remoteMiner','W2N1','s'),0);
});
test('cached route is reused while still safe',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);let calls=0;e.game.map.findRoute=()=>{calls++;return[{room:'W2N1'}];};c.moveTo=()=>0;
  const m=e.load('manager.remote').exports;m.moveToRoom(c,'W2N1');e.game.time++;c.pos.x++;m.moveToRoom(c,'W2N1');assert.equal(calls,1);
});
test('fresh foreign ownership stays excluded until observation ages',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);r.controller.owner={username:'enemy'};addUnknown(e,h,r.name);const m=e.load('manager.remote').exports;m.run(h);
  delete e.game.rooms[r.name];e.game.time++;assert.equal(m.getScoutTarget(h.name,null),null);assert.equal(m.isRemoteUsable(h.name,r.name),false);
});
test('visible hostile tower is recorded before foreign-ownership rejection',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);r.controller.owner={username:'enemy'};r.find=type=>type===e.constants.FIND_HOSTILE_STRUCTURES?[{structureType:e.constants.STRUCTURE_TOWER}]:[];addUnknown(e,h,r.name);
  e.load('manager.remote').exports.run(h);assert.equal(h.memory.remote.rooms[r.name].reason,'hostile tower');assert.ok(e.memory.remote.unsafeRooms[r.name]);
});
test('a scout records transit-room danger on that room, not its destination',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W3N1',false);addUnknown(e,h,'W2N1');r.find=type=>type===e.constants.FIND_HOSTILE_CREEPS?[{getActiveBodyparts:()=>1}]:[];
  e.overrides['utils.creep']={moveTo(){return 0;},announceIntent(){}};const c=scout(e,h);c.room=r;c.pos=new e.RoomPosition(10,10,r.name);e.load('role.scout').exports.run(c);
  assert.ok(e.memory.remote.unsafeRooms[r.name]);assert.equal(e.memory.remote.unsafeRooms.W2N1,undefined);assert.equal(c.memory.targetRoom,undefined);
});
test('a completed scout visit moves on without approaching the controller',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);addUnknown(e,h,r.name);addUnknown(e,h,'W3N1');const moves=[];e.overrides['utils.creep']={moveTo(c,p){moves.push(p.roomName);return 0;},announceIntent(){}};
  const c=scout(e,h,r.name);c.room=r;c.pos=new e.RoomPosition(0,20,r.name);e.load('role.scout').exports.run(c);
  assert.equal(c.memory.targetRoom,'W3N1');assert.equal(moves[0],'W3N1');assert.equal(h.memory.remote.rooms[r.name].lastScouted,e.game.time);
});


test('repeated sightings during one retreat do not increase the cooldown',()=>{
  const e=environment(),h=e.room('W1N1'),m=e.load('manager.remote').exports;
  m.markUnsafe(h.name,'W2N1','combat hostile');const first=h.memory.remote.rooms.W2N1.unsafeUntil;
  e.game.time++;m.markUnsafe(h.name,'W2N1','combat hostile');assert.equal(h.memory.remote.rooms.W2N1.unsafeUntil,first);assert.equal(h.memory.remote.rooms.W2N1.unsafeAttempts,1);
});
test('replacement miners retain a source assignment while an old miner expires',()=>{
  const e=environment(),r=e.room('W2N1',false);e.game.creeps.old={name:'old',memory:{role:'remoteMiner',homeRoom:'W1N1',targetRoom:r.name,sourceId:'s'},body:Array(10),ticksToLive:1};
  const m=e.load('role.remoteMiner');assert.equal(m.context.countAssignedRemoteMiners(r,'s','new'),0);
});

test('spawn execution launches a cheap scout ahead of nonessential worker growth',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);h.energyAvailable=50;
  for(let i=0;i<2;i++)e.game.creeps['h'+i]={name:'h'+i,room:h,memory:{role:'harvester'},ticksToLive:1000,body:[1,2,3]};
  const spawned=[];const spawn={name:'Alpha',room:h,spawnCreep(body,name,opts){spawned.push({body,name,opts});return 0;}};
  e.load('manager.spawn').exports.run(spawn);assert.equal(spawned.length,1);assert.equal(spawned[0].body.length,1);assert.equal(spawned[0].opts.memory.role,'scout');
  assert.equal(h._scoutSpawnRequestedTick,e.game.time);
});
test('spawn execution protects missing essential harvesters before scouting',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);h.energyAvailable=300;const roles=[];
  const spawn={name:'Alpha',room:h,spawnCreep(body,name,opts){roles.push(opts.memory.role);return 0;}};
  e.load('manager.spawn').exports.run(spawn);assert.equal(roles[0],'harvester');
});

test('hostile destination is rejected even when a cached mission still points to it',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h),m=e.load('manager.remote').exports;
  m.markUnsafe(h.name,'W2N1','combat hostile');
  e.game.map.findRoute=(from,to,opts)=>{assert.equal(opts.routeCallback(to,from),Infinity);return -2;};
  c.moveTo=()=>{throw Error('unsafe movement issued');};assert.equal(m.moveToRoom(c,'W2N1'),-2);
});
test('targets behind hostile transit are skipped for reachable directions, including replacements',()=>{
  const e=environment(),h=e.room('W1N1'),m=e.load('manager.remote').exports;
  addUnknown(e,h,'W2N1');addUnknown(e,h,'W1N2');m.markUnsafe(h.name,'W3N1','combat hostile');
  e.game.flags.Flag1={pos:new e.RoomPosition(25,25,'W2N1')};
  e.game.map.findRoute=(from,to,opts)=>to==='W2N1'&&opts.routeCallback('W3N1',from)===Infinity?-2:[{room:to}];
  assert.equal(m.getScoutTarget(h.name,'W2N1'),'W1N2');
  assert.equal(m.getScoutSpawnRequest(h).memory.targetRoom,'W1N2');
});
test('another colony cannot shorten a shared danger cooldown',()=>{
  const e=environment(),a=e.room('W1N1'),b=e.room('W1N2'),m=e.load('manager.remote').exports;
  a.memory.remote.rooms.W2N1={unsafeAttempts:5};addUnknown(e,b,'W2N1');
  m.markUnsafe(a.name,'W2N1','combat hostile');
  assert.equal(e.memory.remote.unsafeRooms.W2N1.unsafeUntil,30100);
  assert.equal(b.memory.remote.rooms.W2N1.unsafeUntil,30100);
});
test('retreat continues into the home interior before a scout accepts another mission',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W2N1',false);addUnknown(e,h,r.name);addUnknown(e,h,'W1N2');
  r.find=type=>type===e.constants.FIND_HOSTILE_CREEPS?[{getActiveBodyparts:()=>1}]:[];
  const moves=[];e.overrides['utils.creep']={moveTo(c,p){moves.push((p.pos||p).roomName);return 0;},announceIntent(){}};
  const c=scout(e,h,r.name);c.room=r;c.pos=new e.RoomPosition(0,20,r.name);const role=e.load('role.scout').exports;
  role.run(c);e.game.time++;c.room=h;c.pos=new e.RoomPosition(49,20,h.name);role.run(c);
  assert.equal(c.memory.targetRoom,undefined);assert.equal(moves[1],h.name);
  delete e.game.rooms[r.name];e.game.time++;c.pos.x=45;role.run(c);
  assert.equal(c.memory.targetRoom,'W1N2');
  delete e.game.creeps[c.name];assert.equal(e.load('manager.remote').exports.getScoutSpawnRequest(h).memory.targetRoom,'W1N2');
});

test('replacement scout rejects a quarantined priority room after visibility is lost',()=>{
  const e=environment(),h=e.room('W1N1'),m=e.load('manager.remote').exports;
  addUnknown(e,h,'W2N1');addUnknown(e,h,'W1N2');m.markUnsafe(h.name,'W2N1','combat hostile');
  e.game.flags.Flag1={pos:new e.RoomPosition(25,25,'W2N1')};e.game.time+=1600;
  assert.equal(m.getScoutSpawnRequest(h).memory.targetRoom,'W1N2');
});
test('no reachable safe targets means no replacement scout is spawned',()=>{
  const e=environment(),h=e.room('W1N1');addUnknown(e,h);e.game.map.findRoute=()=>-2;
  assert.equal(e.load('manager.remote').exports.getScoutSpawnRequest(h),null);
});
test('expired shared danger preserves backoff for a new colony encountering the same threat',()=>{
  const e=environment(),a=e.room('W1N1'),m=e.load('manager.remote');
  m.exports.markUnsafe(a.name,'W2N1','combat hostile');e.game.time=5101;
  assert.equal(m.context.isGloballyUnsafeRoom('W2N1'),false);
  const b=e.room('W1N2');m.context.rememberUnsafeRemote(m.exports.getSettings(b),{},'W2N1','combat hostile');
  assert.equal(e.memory.remote.unsafeRooms.W2N1.attempts,2);
  assert.equal(e.memory.remote.unsafeRooms.W2N1.unsafeUntil,15101);
});
test('a safe alternate route is eligible from the scouts actual room',()=>{
  const e=environment(),h=e.room('W1N1'),r=e.room('W1N2',false),m=e.load('manager.remote').exports;
  addUnknown(e,h,'W2N1');m.markUnsafe(h.name,'W3N1','combat hostile');
  e.game.map.findRoute=(from,to,opts)=>{
    assert.equal(from,r.name);assert.equal(opts.routeCallback('W3N1',from),Infinity);
    assert.equal(opts.routeCallback('W2N2',from),1);return [{room:'W2N2'},{room:to}];
  };
  assert.equal(m.getScoutTarget(h.name,'W2N1',r.name),'W2N1');
});
test('finishing retreat inside home cannot path through a neighboring hostile room',()=>{
  const e=environment(),h=e.room('W1N1'),c=scout(e,h);let options;
  e.overrides['utils.creep']={moveTo(c,p,s,i,k,o){options=o;return 0;}};
  e.load('manager.remote').exports.moveHome(c,'scoutRetreat');assert.equal(options.maxRooms,1);
});
