/* Stickhaven world simulation — host-authoritative.
   Stick-Online-style formula: no classes; stat points on level-up;
   stamina drained per weapon swing; weapons + hats as the two equip slots;
   gold shops; damage threshold to qualify for drops. */
'use strict';

const TAU = Math.PI * 2;
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
let nextId = 1;
function uid() { return nextId++; }

/* ================= equipment data ================= */

const WEAPONS = [
  { id: 'stick',      name: 'Wooden Stick', dmg: 8,  stam: 4,  price: 0,     targets: 1 },
  { id: 'branch',     name: 'Tree Branch',  dmg: 13, stam: 7,  price: 800,   targets: 1 },
  { id: 'mace',       name: 'Iron Mace',    dmg: 20, stam: 11, price: 4000,  targets: 1 },
  { id: 'sword',      name: 'Steel Sword',  dmg: 28, stam: 16, price: 9000,  targets: 1 },
  { id: 'pitchfork',  name: 'Pitchfork',    dmg: 34, stam: 20, price: 15000, targets: 1, knock: true },
  { id: 'greatsword', name: 'Great Sword',  dmg: 40, stam: 29, price: 26000, targets: 1 },
  { id: 'bow',        name: 'Hunter Bow',   dmg: 30, stam: 12, price: 20000, targets: 1, ranged: true },
  { id: 'inferno',    name: 'Inferno Blade',dmg: 45, stam: 32, price: 60000, targets: 3 },
  { id: 'sandblade',  name: 'Sand Blade',   dmg: 55, stam: 40, price: 0,     targets: 2, dropOnly: true },
];

const HATS = [
  { id: 'none',   name: 'No Hat',      price: 0,     mods: {} },
  { id: 'cap',    name: 'Cloth Cap',   price: 1500,  mods: { hp: 15 } },
  { id: 'bunny',  name: 'Bunny Ears',  price: 6000,  mods: { agi: 3 } },
  { id: 'frog',   name: 'Froggy Hat',  price: 12000, mods: { vit: 2, stam: 20, jump: 1 } },
  { id: 'knight', name: 'Knight Helm', price: 25000, mods: { str: 3, hp: 30 } },
  { id: 'wizard', name: 'Wizard Hat',  price: 30000, mods: { int: 4 } },
  { id: 'beret',  name: 'Green Beret', price: 0,     mods: { str: 2, hp: 40 }, dropOnly: true },
];

function weaponById(id) { return WEAPONS.find((w) => w.id === id) || WEAPONS[0]; }
function hatById(id) { return HATS.find((h) => h.id === id) || HATS[0]; }

/* ================= world ================= */

const WORLD_W = 2400, WORLD_H = 900, GROUND_Y = 780;

function makePlatforms() {
  return [
    { x: 0, y: GROUND_Y, w: WORLD_W, h: 120 },
    { x: 220, y: 600, w: 260, h: 24 },
    { x: 620, y: 470, w: 260, h: 24 },
    { x: 1020, y: 600, w: 260, h: 24 },
    { x: 1420, y: 470, w: 260, h: 24 },
    { x: 1820, y: 600, w: 260, h: 24 },
    { x: 820, y: 300, w: 220, h: 24 },
    { x: 1380, y: 300, w: 220, h: 24 },
  ];
}

function createWorld(mode) {
  return {
    mode, // 'survival' | 'mp'
    time: 0,
    players: [],
    mobs: [],
    projectiles: [],
    pickups: [],
    particles: [],
    platforms: makePlatforms(),
    wave: 0,
    waveState: 'idle', // idle | active | intermission
    waveTimer: 2,
    spawnQueue: [],
    spawnTimer: 0,
    pvp: false,
    over: false,
    chatLog: [],
  };
}

/* ================= player ================= */

function makePlayer(pid, name) {
  return {
    id: uid(), pid, name: String(name || 'Player').slice(0, 16),
    x: 0, y: 0, vx: 0, vy: 0, dir: 1, onGround: false,
    stats: { str: 0, vit: 0, agi: 0, int: 0 }, points: 0,
    weapon: 'stick', hat: 'none',
    ownedW: ['stick'], ownedH: ['none'], arrows: 10,
    gold: 0, level: 1, xp: 0,
    hp: 100, st: 40,
    attackCd: 0, specialCd: 0, swingT: 0, swingHeavy: false,
    hurtT: 0, dead: false, respT: 0,
    input: { left: false, right: false, jump: false, attack: false, special: false, aim: null },
    tx: 0, ty: 0,
    chat: null,
  };
}

function hatMods(p) {
  const m = { str: 0, vit: 0, agi: 0, int: 0, hp: 0, stam: 0, jump: 0 };
  const mods = hatById(p.hat).mods || {};
  for (const k in mods) if (k in m) m[k] += mods[k];
  return m;
}
function effStats(p) {
  const m = hatMods(p);
  return {
    str: p.stats.str + m.str, vit: p.stats.vit + m.vit,
    agi: p.stats.agi + m.agi, int: p.stats.int + m.int,
    hp: m.hp, stam: m.stam, jump: m.jump,
  };
}
function maxHp(p) { const e = effStats(p); return 100 + e.vit * 12 + e.hp; }
function maxSt(p) { const e = effStats(p); return 40 + e.int * 8 + e.stam; }
function meleeDmg(p) { return weaponById(p.weapon).dmg + effStats(p).str * 2; }
function moveSpeed(p) { return 240 * (1 + effStats(p).agi * 0.02); }
function jumpVel(p) { return 560 + effStats(p).jump * 60; }
function xpNext(level) { return Math.floor(30 * Math.pow(level, 1.35)); }

function spawnPlayer(world, p) {
  p.x = rand(WORLD_W * 0.35, WORLD_W * 0.65);
  p.y = GROUND_Y - 60;
  p.vx = 0; p.vy = 0; p.hp = maxHp(p); p.st = maxSt(p);
  p.dead = false; p.respT = 0; p.hurtT = 0;
  p.tx = p.x; p.ty = p.y;
}

function addPlayer(world, pid, name) {
  const p = makePlayer(pid, name);
  spawnPlayer(world, p);
  world.players.push(p);
  return p;
}
function removePlayer(world, pid) {
  world.players = world.players.filter((p) => p.pid !== pid);
}
function byPid(world, pid) { return world.players.find((p) => p.pid === pid); }

/* ---- progression ---- */

function grantXp(world, p, amount) {
  if (p.dead) return;
  p.xp += amount;
  while (p.xp >= xpNext(p.level)) {
    p.xp -= xpNext(p.level);
    p.level++;
    p.points += 5;
    p.hp = maxHp(p); p.st = maxSt(p);
    burst(world, p.x, p.y - 40, '#ffd75e', 24);
    pushChat(world, null, `${p.name} reached level ${p.level}! (+5 stat points)`);
  }
}

function allocPoint(world, pid, stat) {
  const p = byPid(world, pid);
  if (!p || p.dead || p.points <= 0) return false;
  if (!['str', 'vit', 'agi', 'int'].includes(stat)) return false;
  const hpBefore = maxHp(p), stBefore = maxSt(p);
  p.stats[stat]++;
  p.points--;
  p.hp = Math.min(maxHp(p), p.hp + (maxHp(p) - hpBefore));
  p.st = Math.min(maxSt(p), p.st + (maxSt(p) - stBefore));
  return true;
}

/* ---- shop ---- */

function buyWeapon(world, pid, id) {
  const p = byPid(world, pid), w = weaponById(id);
  if (!p || p.dead || p.ownedW.includes(id) || w.dropOnly || p.gold < w.price) return false;
  p.gold -= w.price; p.ownedW.push(id);
  return true;
}
function buyHat(world, pid, id) {
  const p = byPid(world, pid), h = hatById(id);
  if (!p || p.dead || p.ownedH.includes(id) || h.dropOnly || p.gold < h.price) return false;
  p.gold -= h.price; p.ownedH.push(id);
  return true;
}
function buyArrows(world, pid) {
  const p = byPid(world, pid);
  if (!p || p.dead || p.gold < 100 || p.arrows >= 99) return false;
  p.gold -= 100; p.arrows = Math.min(99, p.arrows + 10);
  return true;
}
function sellItem(world, pid, kind, id) {
  const p = byPid(world, pid);
  if (!p || p.dead) return false;
  if (kind === 'weapon') {
    if (id === p.weapon || id === 'stick' || !p.ownedW.includes(id)) return false;
    p.ownedW = p.ownedW.filter((w) => w !== id);
    p.gold += Math.floor(weaponById(id).price * 0.4);
    return true;
  }
  if (id === p.hat || id === 'none' || !p.ownedH.includes(id)) return false;
  p.ownedH = p.ownedH.filter((h) => h !== id);
  p.gold += Math.floor(hatById(id).price * 0.4);
  return true;
}
function equipWeapon(world, pid, id) {
  const p = byPid(world, pid);
  if (!p || !p.ownedW.includes(id)) return false;
  p.weapon = id;
  return true;
}
function equipHat(world, pid, id) {
  const p = byPid(world, pid);
  if (!p || !p.ownedH.includes(id)) return false;
  p.hat = id;
  p.hp = clamp(p.hp, 1, maxHp(p));
  p.st = clamp(p.st, 0, maxSt(p));
  return true;
}

/* ================= mobs ================= */

const MOBS = {
  blob:      { hp: 30,  dmg: 8,  speed: 60,  xp: 8,   gold: [2, 6],    jump: 300, kind: 'hopper', r: 16 },
  skitter:   { hp: 22,  dmg: 6,  speed: 175, xp: 10,  gold: [3, 7],    kind: 'runner', r: 13 },
  gloom:     { hp: 78,  dmg: 12, speed: 45,  xp: 18,  gold: [6, 14],   jump: 220, kind: 'hopper', r: 22 },
  spitter:   { hp: 48,  dmg: 10, speed: 70,  xp: 22,  gold: [8, 16],    kind: 'ranged', r: 16 },
  beetle:    { hp: 135, dmg: 16, speed: 42,  xp: 30,  gold: [12, 24],   kind: 'walker', r: 20 },
  lurker:    { hp: 95,  dmg: 14, speed: 150, xp: 34,  gold: [14, 28],   jump: 380, kind: 'hopper', r: 15 },
  bossblob:  { hp: 460, dmg: 22, speed: 72,  xp: 150, gold: [80, 160],  jump: 320, kind: 'hopper', r: 34, boss: 'bossblob' },
  sandgolem: { hp: 1050,dmg: 30, speed: 55,  xp: 400, gold: [200, 400], kind: 'walker', r: 44, boss: 'sandgolem' },
};

function spawnMob(world, type, x) {
  const def = MOBS[type] || MOBS.blob;
  const scale = 1 + (world.wave - 1) * 0.12;
  const m = {
    id: uid(), type, kind: def.kind, boss: def.boss || null,
    x: x !== undefined ? x : rand(100, WORLD_W - 100), y: GROUND_Y - 60,
    vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, onGround: false,
    hp: Math.floor(def.hp * scale), maxHp: Math.floor(def.hp * scale),
    dmg: Math.floor(def.dmg * (1 + (world.wave - 1) * 0.06)),
    speed: def.speed * rand(0.9, 1.1), r: def.r,
    xp: Math.floor(def.xp * (1 + world.wave * 0.06)),
    gold: def.gold, jump: def.jump || 0,
    aiT: rand(0, 2), atkCd: 0, hurtT: 0, hopT: rand(0.5, 1.5),
    tx: 0, ty: 0, dmgBy: {},
  };
  m.tx = m.x; m.ty = m.y;
  world.mobs.push(m);
  return m;
}

function waveComp(wave) {
  const pool = ['blob'];
  if (wave >= 2) pool.push('skitter');
  if (wave >= 3) pool.push('gloom');
  if (wave >= 4) pool.push('spitter');
  if (wave >= 6) pool.push('beetle');
  if (wave >= 8) pool.push('lurker');
  return pool;
}

function startWave(world) {
  world.wave++;
  world.waveState = 'active';
  const n = 5 + world.wave * 2;
  const pool = waveComp(world.wave);
  world.spawnQueue = [];
  if (world.wave % 5 === 0) {
    const boss = world.wave % 10 === 0 ? 'sandgolem' : 'bossblob';
    world.spawnQueue.push(boss);
    for (let i = 0; i < Math.floor(n / 2); i++) world.spawnQueue.push(pick(pool));
    pushChat(world, null, `⚠ BOSS WAVE ${world.wave}: ${boss === 'sandgolem' ? 'Sand Golem' : 'Boss Blob'} approaches!`);
  } else {
    for (let i = 0; i < n; i++) world.spawnQueue.push(pick(pool));
  }
  world.spawnTimer = 0;
}

/* ================= combat ================= */

function burst(world, x, y, color, n) {
  for (let i = 0; i < (n || 12); i++) {
    world.particles.push({
      x, y, vx: rand(-220, 220), vy: rand(-320, 60),
      life: rand(0.3, 0.7), maxLife: 0.7, color, size: rand(2, 5),
    });
  }
}

function pushChat(world, name, text) {
  world.chatLog.push({ name, text: String(text).slice(0, 120), t: world.time });
  if (world.chatLog.length > 40) world.chatLog.shift();
}

function damageMob(world, mob, dmg, p, heavy) {
  if (mob.hp <= 0) return;
  mob.hp -= dmg;
  mob.hurtT = 0.15;
  if (p) {
    mob.dmgBy[p.pid] = (mob.dmgBy[p.pid] || 0) + dmg;
    mob.vx += p.dir * (heavy ? 420 : 120);
  }
  burst(world, mob.x, mob.y - 20, '#ffffff', 5);
  if (mob.hp <= 0) killMob(world, mob, p);
}

function qualifiers(world, mob) {
  const need = mob.maxHp * 0.15;
  const qs = world.players.filter((p) => !p.dead && (mob.dmgBy[p.pid] || 0) >= need);
  if (qs.length === 0) return world.players.filter((p) => !p.dead);
  return qs;
}

function giveItem(p, kind, id) {
  const arr = kind === 'weapon' ? p.ownedW : p.ownedH;
  if (!arr.includes(id)) { arr.push(id); return true; }
  p.gold += 200; // duplicate converts to gold
  return false;
}

function killMob(world, mob) {
  world.mobs = world.mobs.filter((m) => m !== mob);
  burst(world, mob.x, mob.y - 20, '#8affc1', 18);
  const gems = mob.boss ? 8 : 3;
  for (let i = 0; i < gems; i++) {
    world.pickups.push({
      id: uid(), kind: 'gem', x: mob.x + rand(-24, 24), y: mob.y - rand(10, 50),
      vx: rand(-90, 90), vy: rand(-260, -80), val: Math.ceil(mob.xp / gems), t: 0,
    });
  }
  if (Math.random() < 0.05) {
    world.pickups.push({ id: uid(), kind: 'heart', x: mob.x, y: mob.y - 30, vx: rand(-60, 60), vy: rand(-200, -60), t: 0 });
  }
  // drops: only players who met the damage threshold qualify
  for (const p of qualifiers(world, mob)) {
    p.gold += randi(mob.gold[0], mob.gold[1]);
    p.arrows = Math.min(99, p.arrows + 1);
    let got = null;
    if (mob.boss === 'sandgolem') {
      if (giveItem(p, 'hat', 'beret')) got = 'Green Beret';
      if (Math.random() < 0.5 && giveItem(p, 'weapon', 'sandblade')) got = (got ? got + ' + ' : '') + 'Sand Blade';
    } else if (mob.boss === 'bossblob') {
      const wid = pick(['mace', 'sword', 'pitchfork']);
      if (giveItem(p, 'weapon', wid)) got = weaponById(wid).name;
    } else {
      const r = Math.random();
      if (r < 0.045) {
        const pool = world.wave >= 6 ? ['sword', 'pitchfork', 'greatsword'] : world.wave >= 3 ? ['branch', 'mace', 'sword'] : ['branch', 'mace'];
        const wid = pick(pool);
        if (giveItem(p, 'weapon', wid)) got = weaponById(wid).name;
      } else if (r < 0.09) {
        const hid = pick(['cap', 'bunny', 'frog']);
        if (giveItem(p, 'hat', hid)) got = hatById(hid).name;
      }
    }
    if (got) pushChat(world, null, `✨ ${p.name} looted ${got}!`);
  }
}

function damagePlayer(world, target, dmg, from) {
  if (target.dead || target.hp <= 0) return;
  target.hp -= dmg;
  target.hurtT = 0.2;
  burst(world, target.x, target.y - 40, '#ff6b6b', 6);
  if (target.hp <= 0) {
    target.hp = 0; target.dead = true;
    burst(world, target.x, target.y - 40, '#ff6b6b', 26);
    pushChat(world, null, `💀 ${target.name} was defeated${from ? ' by ' + from.name : ''}.`);
    if (world.mode === 'survival') world.over = true;
    else target.respT = 5;
  }
}

function meleeHit(world, p, dmg, range, maxTargets, heavy) {
  const w = weaponById(p.weapon);
  const hits = [];
  for (const m of world.mobs) {
    if (m.hp <= 0) continue;
    const dx = m.x - p.x;
    if (dx * p.dir <= 0) continue;
    const d = Math.hypot(dx, (m.y - 20) - (p.y - 40));
    if (d <= range + m.r) hits.push({ d, m });
  }
  if (world.pvp) {
    for (const q of world.players) {
      if (q === p || q.dead) continue;
      const dx = q.x - p.x;
      if (dx * p.dir <= 0) continue;
      const d = Math.hypot(dx, (q.y - 40) - (p.y - 40));
      if (d <= range + 16) hits.push({ d, q });
    }
  }
  hits.sort((a, b) => a.d - b.d);
  const n = Math.min(maxTargets, hits.length);
  for (let i = 0; i < n; i++) {
    const h = hits[i];
    if (h.m) damageMob(world, h.m, dmg, p, heavy || w.knock);
    else damagePlayer(world, h.q, dmg, p);
  }
  return n > 0;
}

function fireArrow(world, p, heavy) {
  const count = heavy ? 3 : 1;
  if (p.arrows < count) return false;
  p.arrows -= count;
  const aim = p.input.aim;
  const baseA = aim && aim.aimed ? Math.atan2(aim.y - (p.y - 40), aim.x - p.x) : (p.dir > 0 ? 0 : Math.PI);
  for (let i = 0; i < count; i++) {
    const a = baseA + (i - (count - 1) / 2) * 0.14;
    world.projectiles.push({
      id: uid(), kind: 'arrow', x: p.x + Math.cos(a) * 24, y: p.y - 40 + Math.sin(a) * 24,
      vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
      friendly: true, pid: p.pid, dmg: Math.round(meleeDmg(p) * (heavy ? 2 : 1)), heavy, life: 1.6,
    });
  }
  return true;
}

function tryAttack(world, p) {
  const w = weaponById(p.weapon);
  if (p.attackCd > 0 || p.dead) return;
  if (w.ranged && p.arrows <= 0) return;
  if (p.st < w.stam) return; // stamina out — no swing
  const aim = p.input.aim;
  if (aim && aim.aimed) p.dir = aim.x >= p.x ? 1 : -1;
  p.st -= w.stam;
  p.attackCd = 0.32;
  p.swingT = 0.22; p.swingHeavy = false;
  if (w.ranged) fireArrow(world, p, false);
  else meleeHit(world, p, meleeDmg(p), 80, w.targets, false);
}

function trySpecial(world, p) {
  const w = weaponById(p.weapon);
  if (p.specialCd > 0 || p.dead) return;
  const cost = w.stam * 2;
  if (w.ranged && p.arrows < 3) return;
  if (p.st < cost) return; // stamina out
  const aim = p.input.aim;
  if (aim && aim.aimed) p.dir = aim.x >= p.x ? 1 : -1;
  p.st -= cost;
  p.specialCd = 3;
  p.swingT = 0.3; p.swingHeavy = true;
  if (w.ranged) fireArrow(world, p, true);
  else meleeHit(world, p, Math.round(meleeDmg(p) * 2.5), 90, w.targets, true);
}

/* ================= physics ================= */

function collidePlatforms(e, plats) {
  e.onGround = false;
  for (const pl of plats) {
    const withinX = e.x > pl.x - 8 && e.x < pl.x + pl.w + 8;
    if (withinX && e.vy >= 0) {
      const prevBottom = e.y - e.vy * (1 / 60) + 20;
      if (prevBottom <= pl.y + 14 && e.y + 20 >= pl.y && e.y + 20 <= pl.y + 40) {
        e.y = pl.y - 20; e.vy = 0; e.onGround = true;
      }
    }
  }
  if (e.y > WORLD_H + 200) { e.y = GROUND_Y - 60; e.vy = 0; e.vx = 0; }
  e.x = clamp(e.x, 20, WORLD_W - 20);
}

function updatePlayer(world, p, dt) {
  const inp = p.input;
  if (p.dead) {
    if (world.mode === 'mp') {
      p.respT -= dt;
      if (p.respT <= 0) spawnPlayer(world, p);
    }
    inp.attack = false; inp.special = false; inp.aim = null;
    return;
  }
  const spd = moveSpeed(p);
  if (inp.left) { p.vx = -spd; p.dir = -1; }
  else if (inp.right) { p.vx = spd; p.dir = 1; }
  else p.vx *= Math.pow(0.0001, dt);

  p.vy += 1500 * dt;
  if (inp.jump && p.onGround) { p.vy = -jumpVel(p); p.onGround = false; }
  inp.jump = false; // edge-triggered: consume each tick

  p.x += p.vx * dt; p.y += p.vy * dt;
  collidePlatforms(p, world.platforms);

  p.st = Math.min(maxSt(p), p.st + 12 * dt); // stamina regen

  p.attackCd = Math.max(0, p.attackCd - dt);
  p.specialCd = Math.max(0, p.specialCd - dt);
  p.swingT = Math.max(0, p.swingT - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);

  if (inp.attack) { inp.attack = false; tryAttack(world, p); }
  if (inp.special) { inp.special = false; trySpecial(world, p); }
  inp.aim = null;

  p.tx = p.x; p.ty = p.y;
}

function nearestPlayer(world, x) {
  let best = null, bd = Infinity;
  for (const p of world.players) {
    if (p.dead) continue;
    const d = Math.abs(p.x - x);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function updateMob(world, m, dt) {
  if (m.hp <= 0) return;
  const target = nearestPlayer(world, m.x);
  m.aiT -= dt; m.atkCd = Math.max(0, m.atkCd - dt); m.hurtT = Math.max(0, m.hurtT - dt);

  if (m.kind === 'hopper') {
    m.hopT -= dt;
    if (target) m.dir = target.x >= m.x ? 1 : -1;
    if (m.onGround && m.hopT <= 0) {
      m.vy = -(m.jump || 300);
      m.vx = m.dir * m.speed * rand(0.8, 1.3);
      m.hopT = rand(0.6, 1.4);
    }
  } else if (m.kind === 'runner' || m.kind === 'walker') {
    if (target) {
      m.dir = target.x >= m.x ? 1 : -1;
      m.vx = m.dir * m.speed;
    } else m.vx *= 0.9;
  } else if (m.kind === 'ranged') {
    if (target) {
      const d = Math.abs(target.x - m.x);
      m.dir = target.x >= m.x ? 1 : -1;
      m.vx = d > 420 ? m.dir * m.speed : d < 260 ? -m.dir * m.speed : 0;
      if (d < 560 && m.atkCd <= 0 && Math.abs(target.y - m.y) < 160) {
        m.atkCd = 2.2;
        const dx = target.x - m.x, dy = (target.y - 40) - (m.y - 30);
        const tof = clamp(Math.hypot(dx, dy) / 420, 0.3, 1.4);
        world.projectiles.push({
          id: uid(), kind: 'glob', x: m.x, y: m.y - 30,
          vx: dx / tof, vy: dy / tof - 0.5 * 900 * tof,
          friendly: false, dmg: m.dmg, life: 3,
        });
      }
    }
  }

  m.vy += 1500 * dt;
  m.x += m.vx * dt; m.y += m.vy * dt;
  collidePlatforms(m, world.platforms);

  if (target && m.atkCd <= 0 && m.kind !== 'ranged') {
    const d = Math.hypot(target.x - m.x, (target.y - 40) - (m.y - 20));
    if (d < m.r + 22) {
      damagePlayer(world, target, m.dmg, null);
      m.atkCd = 0.9;
    }
  }
  m.tx = m.x; m.ty = m.y;
}

function updateProjectile(world, pr, dt) {
  pr.life -= dt;
  if (pr.kind === 'glob') pr.vy += 900 * dt;
  pr.x += pr.vx * dt; pr.y += pr.vy * dt;
  let dead = pr.life <= 0 || pr.x < 0 || pr.x > WORLD_W || pr.y > WORLD_H;
  if (!dead) {
    if (pr.friendly) {
      for (const m of world.mobs) {
        if (m.hp <= 0) continue;
        if (Math.hypot(m.x - pr.x, (m.y - 20) - pr.y) < m.r + 8) {
          damageMob(world, m, pr.dmg, byPid(world, pr.pid), pr.heavy);
          dead = true; break;
        }
      }
      if (!dead && world.pvp) {
        for (const q of world.players) {
          if (q.pid === pr.pid || q.dead) continue;
          if (Math.hypot(q.x - pr.x, (q.y - 40) - pr.y) < 24) {
            damagePlayer(world, q, pr.dmg, byPid(world, pr.pid));
            dead = true; break;
          }
        }
      }
    } else {
      for (const p of world.players) {
        if (p.dead) continue;
        if (Math.hypot(p.x - pr.x, (p.y - 40) - pr.y) < 24) {
          damagePlayer(world, p, pr.dmg, null);
          burst(world, pr.x, pr.y, '#b6ff5e', 8);
          dead = true; break;
        }
      }
    }
  }
  if (!dead) {
    for (const pl of world.platforms) {
      if (pr.x > pl.x && pr.x < pl.x + pl.w && pr.y > pl.y && pr.y < pl.y + pl.h + 6) { dead = true; break; }
    }
  }
  if (dead) world.projectiles = world.projectiles.filter((x) => x !== pr);
}

function updatePickup(world, pk, dt) {
  pk.t += dt;
  pk.vy += 900 * dt;
  pk.x += pk.vx * dt; pk.y += pk.vy * dt;
  for (const pl of world.platforms) {
    if (pk.x > pl.x && pk.x < pl.x + pl.w && pk.y > pl.y - 6 && pk.y < pl.y + 20 && pk.vy > 0) {
      pk.y = pl.y - 6; pk.vy = 0; pk.vx *= 0.9;
    }
  }
  let best = null, bd = 130 * 130;
  for (const p of world.players) {
    if (p.dead) continue;
    const d2 = (p.x - pk.x) * (p.x - pk.x) + ((p.y - 40) - pk.y) * ((p.y - 40) - pk.y);
    if (d2 < bd) { bd = d2; best = p; }
  }
  if (best) {
    const dx = best.x - pk.x, dy = (best.y - 40) - pk.y;
    const d = Math.hypot(dx, dy) || 1;
    pk.x += (dx / d) * 320 * dt; pk.y += (dy / d) * 320 * dt;
    if (d < 26) {
      if (pk.kind === 'gem') grantXp(world, best, pk.val);
      else if (pk.kind === 'heart') best.hp = Math.min(maxHp(best), best.hp + 25);
      world.pickups = world.pickups.filter((x) => x !== pk);
      return;
    }
  }
  if (pk.t > 25) world.pickups = world.pickups.filter((x) => x !== pk);
}

/* ================= main update ================= */

function update(world, dt, isHost) {
  if (!isHost || world.over) return;
  world.time += dt;

  if (world.waveState === 'idle') {
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) startWave(world);
  } else if (world.waveState === 'active') {
    if (world.spawnQueue.length > 0) {
      world.spawnTimer -= dt;
      if (world.spawnTimer <= 0) {
        world.spawnTimer = 0.7;
        const type = world.spawnQueue.shift();
        const px = world.players.length ? world.players[0].x : WORLD_W / 2;
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnMob(world, type, clamp(px + side * rand(500, 900), 60, WORLD_W - 60));
      }
    } else if (world.mobs.length === 0) {
      world.waveState = 'intermission';
      world.waveTimer = 6;
      pushChat(world, null, `Wave ${world.wave} cleared!`);
    }
  } else if (world.waveState === 'intermission') {
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) { world.waveState = 'idle'; world.waveTimer = 0.5; }
  }

  for (const p of world.players) updatePlayer(world, p, dt);
  for (const m of [...world.mobs]) updateMob(world, m, dt);
  for (const pr of [...world.projectiles]) updateProjectile(world, pr, dt);
  for (const pk of [...world.pickups]) updatePickup(world, pk, dt);

  for (let i = world.particles.length - 1; i >= 0; i--) {
    const pt = world.particles[i];
    pt.life -= dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 500 * dt;
    if (pt.life <= 0) world.particles.splice(i, 1);
  }

  if (world.mode === 'survival' && world.players.length > 0 && world.players.every((p) => p.dead)) {
    world.over = true;
  }
}

/* cosmetic tick for guests (particles / smoothing targets) */
function clientTick(world, dt) {
  world.time += dt;
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const pt = world.particles[i];
    pt.life -= dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 500 * dt;
    if (pt.life <= 0) world.particles.splice(i, 1);
  }
  for (const p of world.players) {
    p.x += (p.tx - p.x) * Math.min(1, dt * 10);
    p.y += (p.ty - p.y) * Math.min(1, dt * 10);
    p.swingT = Math.max(0, p.swingT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
  }
  for (const m of world.mobs) {
    m.x += (m.tx - m.x) * Math.min(1, dt * 10);
    m.y += (m.ty - m.y) * Math.min(1, dt * 10);
    m.hurtT = Math.max(0, m.hurtT - dt);
  }
}

/* ================= snapshots ================= */

function snapshot(world) {
  return {
    t: world.time, wave: world.wave, ws: world.waveState, wt: world.waveTimer,
    pvp: world.pvp, over: world.over,
    players: world.players.map((p) => ({
      pid: p.pid, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      vx: Math.round(p.vx), vy: Math.round(p.vy), dir: p.dir,
      weapon: p.weapon, hat: p.hat, hp: Math.ceil(p.hp), mhp: maxHp(p),
      st: Math.ceil(p.st), mst: maxSt(p),
      lvl: p.level, xp: p.xp, points: p.points, gold: p.gold, arrows: p.arrows,
      stats: { ...p.stats }, ownedW: [...p.ownedW], ownedH: [...p.ownedH],
      swingT: +p.swingT.toFixed(2), swingHeavy: p.swingHeavy,
      dead: p.dead, chat: p.chat,
    })),
    mobs: world.mobs.map((m) => ({
      id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y),
      vx: Math.round(m.vx), vy: Math.round(m.vy), dir: m.dir,
      hp: Math.ceil(m.hp), mhp: m.maxHp, hurtT: +m.hurtT.toFixed(2),
    })),
    projs: world.projectiles.map((pr) => ({
      kind: pr.kind, x: Math.round(pr.x), y: Math.round(pr.y),
      vx: Math.round(pr.vx), vy: Math.round(pr.vy), friendly: pr.friendly,
    })),
    pickups: world.pickups.map((pk) => ({ kind: pk.kind, x: Math.round(pk.x), y: Math.round(pk.y) })),
    chat: world.chatLog.slice(-8),
  };
}

function applySnapshot(world, snap) {
  world.time = snap.t; world.wave = snap.wave;
  world.waveState = snap.ws; world.waveTimer = snap.wt;
  world.pvp = snap.pvp; world.over = snap.over;
  const seen = new Set();
  for (const s of snap.players) {
    seen.add(s.pid);
    let p = byPid(world, s.pid);
    if (!p) { p = makePlayer(s.pid, s.name); world.players.push(p); }
    p.name = s.name;
    p.tx = s.x; p.ty = s.y; p.vx = s.vx; p.vy = s.vy; p.dir = s.dir;
    if (Math.hypot(p.x - s.x, p.y - s.y) > 120) { p.x = s.x; p.y = s.y; p.tx = s.x; p.ty = s.y; }
    p.weapon = s.weapon; p.hat = s.hat;
    p.hp = s.hp; p.st = s.st;
    p.level = s.lvl; p.xp = s.xp; p.points = s.points;
    p.gold = s.gold; p.arrows = s.arrows;
    p.stats = { ...s.stats }; p.ownedW = [...s.ownedW]; p.ownedH = [...s.ownedH];
    p.swingT = s.swingT; p.swingHeavy = s.swingHeavy;
    p.dead = s.dead; p.chat = s.chat;
  }
  world.players = world.players.filter((p) => seen.has(p.pid));
  const seenM = new Set();
  for (const s of snap.mobs) {
    seenM.add(s.id);
    let m = world.mobs.find((x) => x.id === s.id);
    if (!m) {
      const def = MOBS[s.type] || MOBS.blob;
      m = {
        id: s.id, type: s.type, kind: def.kind, boss: def.boss || null,
        x: s.x, y: s.y, vx: 0, vy: 0, dir: s.dir, onGround: false,
        hp: s.hp, maxHp: s.mhp, dmg: def.dmg, speed: def.speed, r: def.r,
        xp: def.xp, gold: def.gold, jump: def.jump || 0,
        aiT: 0, atkCd: 0, hurtT: 0, hopT: 1, tx: s.x, ty: s.y, dmgBy: {},
      };
      world.mobs.push(m);
    }
    m.tx = s.x; m.ty = s.y; m.vx = s.vx; m.vy = s.vy; m.dir = s.dir;
    m.hp = s.hp; m.hurtT = s.hurtT;
    if (Math.hypot(m.x - s.x, m.y - s.y) > 160) { m.x = s.x; m.y = s.y; }
  }
  world.mobs = world.mobs.filter((m) => seenM.has(m.id));
  world.projectiles = snap.projs.map((s) => ({ ...s, id: uid(), life: 1 }));
  world.pickups = snap.pickups.map((s) => ({ ...s, id: uid(), vx: 0, vy: 0, val: 0, t: 0 }));
  if (snap.chat.length > world.chatLog.length) world.chatLog = snap.chat.map((c) => ({ ...c }));
}

/* ================= exports ================= */

const Sim = {
  WEAPONS, HATS, WORLD_W, WORLD_H, GROUND_Y,
  createWorld, addPlayer, removePlayer, byPid, spawnPlayer,
  update, clientTick, snapshot, applySnapshot,
  grantXp, allocPoint,
  buyWeapon, buyHat, buyArrows, sellItem, equipWeapon, equipHat,
  weaponById, hatById, maxHp, maxSt, meleeDmg, xpNext,
  pushChat,
};
if (typeof module !== 'undefined') module.exports = Sim;
