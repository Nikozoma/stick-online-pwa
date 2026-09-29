/* Stickhaven — shared world simulation.
   Runs full-speed on: survival mode (local) and multiplayer HOST.
   Guests receive snapshots and render them (no local sim). */

'use strict';

const Sim = (() => {

  // ---------------------------------------------------------------- classes
  const CLASSES = {
    brawler: {
      name: 'Brawler', desc: 'Close-range brawler. Tough, fast fists.',
      hp: 120, speed: 350, jumpV: 880,
      atk: 'melee', dmg: 16, range: 80, atkCd: 0.32,
      spc: 'dash', spcCd: 6, spcName: 'Dash Strike',
      color: '#ff5a5a', hat: 'headband',
    },
    archer: {
      name: 'Archer', desc: 'Ranged fighter. Fast arrows, keeps distance.',
      hp: 90, speed: 370, jumpV: 900,
      atk: 'ranged', dmg: 10, range: 0, atkCd: 0.38, projSpeed: 800,
      spc: 'triple', spcCd: 8, spcName: 'Triple Shot',
      color: '#5aff8a', hat: 'hood',
    },
    mage: {
      name: 'Mage', desc: 'Slow heavy bolts with slight homing. Fragile.',
      hp: 80, speed: 320, jumpV: 860,
      atk: 'ranged', dmg: 24, range: 0, atkCd: 0.72, projSpeed: 540, homing: 3.2,
      spc: 'nova', spcCd: 10, spcName: 'Nova Burst',
      color: '#5aa8ff', hat: 'pointhy',
    },
  };

  // ---------------------------------------------------------------- enemies
  const ETYPES = {
    blob:    { name: 'Blob',    hp: 30,  speed: 150, dmg: 8,  xp: 2,  w: 44, h: 36, score: 10 },
    skitter: { name: 'Skitter', hp: 16,  speed: 330, dmg: 6,  xp: 1,  w: 34, h: 30, score: 10 },
    spitter: { name: 'Spitter', hp: 26,  speed: 170, dmg: 7,  xp: 3,  w: 44, h: 44, score: 15 },
    brute:   { name: 'Brute',   hp: 240, speed: 110, dmg: 20, xp: 12, w: 84, h: 96, score: 100 },
  };

  const GRAV = 2400;
  const WORLD_W = 2600;
  const GROUND_Y = 620;          // y-down coords; ground line
  const PLATFORMS = [            // {x, y, w} thin platforms (y = top surface)
    { x: 520,  y: 430, w: 220 },
    { x: 1860, y: 430, w: 220 },
    { x: 1120, y: 300, w: 260 },
  ];

  // ---------------------------------------------------------------- world
  function createWorld(mode) {
    return {
      mode,                      // 'survival' | 'mp'
      time: 0,
      players: [], enemies: [], projs: [], pickups: [], parts: [],
      wave: 0, waveState: 'idle', spawnQueue: [], spawnT: 0, breatherT: 0,
      nextId: 1, over: false,
      floatTexts: [],
    };
  }

  function addPlayer(world, { id, name, cls, isLocal }) {
    const c = CLASSES[cls] || CLASSES.brawler;
    const p = {
      id, name: String(name || 'Player').slice(0, 14), cls,
      x: 900 + Math.random() * 800, y: GROUND_Y, vx: 0, vy: 0,
      w: 36, h: 66, face: 1,
      hp: c.hp, maxhp: c.hp, level: 1, xp: 0, xpNeed: xpNeedFor(1),
      atkMul: 1, atkCd: 0, spcCd: 0, hurtT: 0, dead: false, deadT: 0,
      kills: 0, score: 0,
      dashT: 0, dashDx: 0,
      onGround: true, coyote: 0, jumpBuf: 0,
      animT: Math.random() * 10, moving: false,
      input: { l: false, r: false, j: false, atk: false, spc: false },
      isLocal: !!isLocal,
      chatT: 0, chatMsg: '',
    };
    world.players.push(p);
    return p;
  }

  function removePlayer(world, id) {
    world.players = world.players.filter(p => p.id !== id);
  }

  function setInput(world, playerId, input) {
    const p = world.players.find(p => p.id === playerId);
    if (p && !p.dead) Object.assign(p.input, input);
  }

  function xpNeedFor(level) { return 10 + level * 7; }

  // ---------------------------------------------------------------- spawner
  function startWave(world) {
    world.wave += 1;
    const n = world.wave;
    const scale = world.mode === 'mp'
      ? 1 + 0.6 * Math.max(0, world.players.length - 1) : 1;
    const q = [];
    const blobs = Math.round((3 + n) * scale);
    const skitters = Math.round(n * scale);
    const spitters = Math.round(Math.floor(n / 2) * scale);
    for (let i = 0; i < blobs; i++) q.push('blob');
    for (let i = 0; i < skitters; i++) q.push('skitter');
    for (let i = 0; i < spitters; i++) q.push('spitter');
    if (n % 5 === 0) for (let i = 0; i < Math.round(scale); i++) q.push('brute');
    // shuffle
    for (let i = q.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [q[i], q[j]] = [q[j], q[i]];
    }
    world.spawnQueue = q;
    world.spawnT = 0.5;
    world.waveState = 'spawning';
  }

  function spawnEnemy(world, type) {
    const t = ETYPES[type];
    const mul = 1 + (world.wave - 1) * 0.09;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side < 0 ? 60 + Math.random() * 200 : WORLD_W - 60 - Math.random() * 200;
    world.enemies.push({
      id: world.nextId++, type,
      x, y: GROUND_Y - t.h / 2, vx: 0, vy: 0,
      w: t.w, h: t.h,
      hp: Math.round(t.hp * mul), maxhp: Math.round(t.hp * mul),
      dmg: Math.round(t.dmg * (1 + (world.wave - 1) * 0.05)),
      t: Math.random() * 10, atkT: 1 + Math.random(), hopT: 0,
      hitCd: 0, hurtT: 0, face: side < 0 ? 1 : -1,
      animT: Math.random() * 10,
    });
  }

  // ---------------------------------------------------------------- combat
  function nearestPlayer(world, x) {
    let best = null, bd = 1e9;
    for (const p of world.players) {
      if (p.dead) continue;
      const d = Math.abs(p.x - x);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function damageEnemy(world, e, dmg, from) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.hurtT = 0.18;
    burst(world, e.x, e.y - e.h / 2, '#ffd23f', 6, 220);
    if (e.hp <= 0) killEnemy(world, e, from);
  }

  function killEnemy(world, e, from) {
    const t = ETYPES[e.type];
    burst(world, e.x, e.y - e.h / 2, '#ffffff', 14, 320);
    burst(world, e.x, e.y - e.h / 2, '#9aa4b2', 8, 200);
    // xp gems
    const gems = Math.max(1, Math.round(t.xp));
    for (let i = 0; i < gems; i++) {
      world.pickups.push({
        id: world.nextId++, kind: 'xp',
        x: e.x + (Math.random() - 0.5) * 40, y: e.y - 20,
        vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 380,
        val: Math.max(1, Math.round(t.xp / gems)), t: 0,
      });
    }
    if (Math.random() < 0.09) {
      world.pickups.push({
        id: world.nextId++, kind: 'heart',
        x: e.x, y: e.y - 30, vx: (Math.random() - 0.5) * 160, vy: -260, val: 0, t: 0,
      });
    }
    if (from) {
      from.kills += 1;
      from.score += t.score;
      if (world.mode === 'survival') from.score += world.wave * 2;
    }
    world.enemies = world.enemies.filter(x => x !== e);
  }

  function damagePlayer(world, p, dmg) {
    if (p.dead || p.hurtT > 0 || p.dashT > 0) return;
    p.hp -= dmg;
    p.hurtT = 0.5;
    burst(world, p.x, p.y - 40, '#ff5a5a', 8, 260);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; p.deadT = 0;
      burst(world, p.x, p.y - 40, '#ffffff', 18, 380);
      if (world.mode === 'survival') world.over = true;
    }
  }

  function gainXP(world, p, v) {
    p.xp += v;
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level += 1;
      p.xpNeed = xpNeedFor(p.level);
      p.maxhp += 14;
      p.hp = Math.min(p.maxhp, p.hp + p.maxhp * 0.35);
      p.atkMul += 0.12;
      burst(world, p.x, p.y - 70, '#7dff9a', 16, 300);
      world.floatTexts.push({ x: p.x, y: p.y - 90, txt: 'LEVEL ' + p.level, t: 1.4, color: '#7dff9a' });
    }
  }

  function burst(world, x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.4 + Math.random() * 0.8);
      world.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
        t: 0.5 + Math.random() * 0.4, maxT: 0.9, color,
        size: 2 + Math.random() * 3,
      });
    }
    if (world.parts.length > 400) world.parts.splice(0, world.parts.length - 400);
  }

  function fireProj(world, owner, x, y, vx, vy, dmg, kind, homing) {
    world.projs.push({
      id: world.nextId++, owner: owner ? owner.id : 'enemy',
      x, y, vx, vy, dmg, kind: kind || 'bolt', t: 0,
      homing: homing || 0,
    });
  }

  function playerAttack(world, p) {
    const c = CLASSES[p.cls];
    if (p.atkCd > 0 || p.dead) return;
    p.atkCd = c.atkCd;
    p.face = p.input.l && !p.input.r ? -1 : (p.input.r && !p.input.l ? 1 : p.face);
    const dmg = Math.round(c.dmg * p.atkMul);
    if (c.atk === 'melee') {
      p.animT = 0; // restart swing anim
      const hx = p.x + p.face * c.range * 0.55;
      for (const e of [...world.enemies]) {
        if (Math.abs(e.x - hx) < c.range * 0.6 && Math.abs((e.y - e.h / 2) - (p.y - 34)) < 70) {
          damageEnemy(world, e, dmg, p);
          e.vx += p.face * 260;
        }
      }
      burst(world, hx, p.y - 40, '#ffffff', 4, 160);
    } else {
      const y = p.y - 46;
      fireProj(world, p, p.x + p.face * 20, y, p.face * c.projSpeed, 0, dmg,
        p.cls === 'archer' ? 'arrow' : 'bolt', c.homing || 0);
    }
  }

  function playerSpecial(world, p) {
    const c = CLASSES[p.cls];
    if (p.spcCd > 0 || p.dead) return;
    p.spcCd = c.spcCd;
    if (c.spc === 'dash') {
      p.dashT = 0.22; p.dashDx = p.face;
      burst(world, p.x, p.y - 40, c.color, 10, 300);
    } else if (c.spc === 'triple') {
      const dmg = Math.round(c.dmg * 1.2 * p.atkMul);
      for (const a of [-0.22, 0, 0.22]) {
        const sp = c.projSpeed;
        fireProj(world, p, p.x + p.face * 20, p.y - 46,
          Math.cos(a) * sp * p.face, Math.sin(a) * sp, dmg, 'arrow', 0);
      }
    } else if (c.spc === 'nova') {
      const dmg = Math.round(42 * p.atkMul);
      burst(world, p.x, p.y - 40, c.color, 26, 520);
      for (const e of [...world.enemies]) {
        const dx = e.x - p.x, dy = (e.y - e.h / 2) - (p.y - 40);
        if (dx * dx + dy * dy < 170 * 170) damageEnemy(world, e, dmg, p);
      }
    }
  }

  // ---------------------------------------------------------------- update
  function collideGround(e, prevY) {
    // returns ground y the entity should rest on, or null
    let g = GROUND_Y;
    for (const pl of PLATFORMS) {
      if (e.x > pl.x - e.w * 0.3 && e.x < pl.x + pl.w + e.w * 0.3) {
        if (prevY <= pl.y + 1 && e.y >= pl.y) return pl.y;
      }
    }
    if (e.y >= GROUND_Y) return GROUND_Y;
    return e.y < g ? null : g;
  }

  function updatePlayer(world, p, dt) {
    const c = CLASSES[p.cls];
    if (p.dead) {
      p.deadT += dt;
      if (world.mode === 'mp' && p.deadT > 5) {
        // respawn
        p.dead = false; p.hp = p.maxhp;
        p.x = 900 + Math.random() * 800; p.y = GROUND_Y; p.vx = 0; p.vy = 0;
        burst(world, p.x, p.y - 40, '#7dff9a', 14, 300);
      }
      return;
    }
    const inp = p.input;
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.spcCd = Math.max(0, p.spcCd - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.coyote = Math.max(0, p.coyote - dt);
    p.jumpBuf = Math.max(0, p.jumpBuf - dt);

    // dash (brawler special)
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDx * 900;
      p.vy = 0;
      // damage enemies in path
      for (const e of [...world.enemies]) {
        if (Math.abs(e.x - p.x) < 60 && Math.abs((e.y - e.h / 2) - (p.y - 36)) < 70) {
          damageEnemy(world, e, Math.round(30 * p.atkMul), p);
          e.vx += p.dashDx * 420;
        }
      }
    } else {
      const ax = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
      const target = ax * c.speed;
      p.vx += (target - p.vx) * Math.min(1, dt * 14);
      if (ax !== 0) p.face = ax;
      p.moving = Math.abs(p.vx) > 40;
      if (inp.j) { p.jumpBuf = 0.12; inp.j = false; }
      if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
        p.vy = -c.jumpV; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
        burst(world, p.x, p.y, '#9aa4b2', 5, 140);
      }
    }

    if (inp.atk) { playerAttack(world, p); inp.atk = false; }
    if (inp.spc) { playerSpecial(world, p); inp.spc = false; }

    // integrate
    const prevY = p.y;
    p.vy += GRAV * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(24, Math.min(WORLD_W - 24, p.x));
    const g = collideGround({ x: p.x, y: p.y, w: p.w }, prevY);
    if (g !== null && p.vy >= 0 && p.y >= g) {
      p.y = g; p.vy = 0;
      if (!p.onGround) burst(world, p.x, p.y, '#9aa4b2', 3, 100);
      p.onGround = true; p.coyote = 0.1;
    } else if (p.y < (g === null ? GROUND_Y : g) - 2) {
      p.onGround = false;
    }
    if (p.y > 900) { p.y = GROUND_Y; p.vy = 0; damagePlayer(world, p, 10); }

    p.animT += dt * (p.moving ? Math.abs(p.vx) / 60 : 1);
  }

  function updateEnemy(world, e, dt) {
    const t = ETYPES[e.type];
    e.t += dt; e.animT += dt * 3;
    e.hurtT = Math.max(0, e.hurtT - dt);
    e.hitCd = Math.max(0, e.hitCd - dt);
    e.atkT -= dt;
    const target = nearestPlayer(world, e.x);

    if (e.type === 'blob') {
      e.hopT -= dt;
      if (e.onGround) {
        e.vx *= Math.max(0, 1 - dt * 6);
        if (e.hopT <= 0 && target) {
          e.face = target.x > e.x ? 1 : -1;
          e.vx = e.face * t.speed * (0.9 + Math.random() * 0.4);
          e.vy = -560;
          e.onGround = false;
          e.hopT = 0.7 + Math.random() * 0.7;
        }
      }
    } else if (e.type === 'skitter') {
      if (target) {
        e.face = target.x > e.x ? 1 : -1;
        e.vx += (e.face * t.speed - e.vx) * Math.min(1, dt * 8);
      }
    } else if (e.type === 'spitter') {
      if (target) {
        const dx = target.x - e.x;
        e.face = dx > 0 ? 1 : -1;
        const want = Math.abs(dx) > 380 ? e.face * t.speed : (Math.abs(dx) < 220 ? -e.face * t.speed : 0);
        e.vx += (want - e.vx) * Math.min(1, dt * 6);
        if (e.atkT <= 0 && Math.abs(dx) < 560) {
          e.atkT = 2.1 + Math.random();
          const dy = (target.y - 40) - (e.y - e.h / 2);
          const dist = Math.max(80, Math.abs(dx));
          const tof = dist / 420;
          // launch so the glob lands on the target: vy = dy/tof - 0.5*g*tof (y-down)
          fireProj(world, null, e.x, e.y - e.h / 2, (dx / dist) * 420,
            dy / tof - 0.5 * GRAV * 0.55 * tof, e.dmg, 'glob', 0);
        }
      }
    } else if (e.type === 'brute') {
      if (target) {
        e.face = target.x > e.x ? 1 : -1;
        e.vx += (e.face * t.speed - e.vx) * Math.min(1, dt * 5);
        if (e.atkT <= 0 && Math.abs(target.x - e.x) < 150) {
          e.atkT = 3;
          burst(world, e.x, e.y, '#ffb03a', 12, 300);
          for (const pl of world.players) {
            if (!pl.dead && Math.abs(pl.x - e.x) < 150 && Math.abs(pl.y - e.y) < 120) {
              damagePlayer(world, pl, e.dmg);
              pl.vx += (pl.x > e.x ? 1 : -1) * 500;
              pl.vy = -400;
            }
          }
        }
      }
    }

    const prevY = e.y;
    e.vy += GRAV * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.x = Math.max(20, Math.min(WORLD_W - 20, e.x));
    const g = collideGround({ x: e.x, y: e.y, w: e.w }, prevY);
    if (g !== null && e.vy >= 0 && e.y >= g) {
      e.y = g; e.vy = 0; e.onGround = true;
    } else e.onGround = false;

    // contact damage
    if (e.hitCd <= 0 && target) {
      const dx = Math.abs(target.x - e.x);
      const dy = Math.abs((target.y - 34) - (e.y - e.h / 2));
      if (dx < (e.w / 2 + 22) && dy < (e.h / 2 + 44)) {
        damagePlayer(world, target, e.dmg);
        e.hitCd = 0.9;
      }
    }
  }

  function updateProjs(world, dt) {
    for (const pr of [...world.projs]) {
      pr.t += dt;
      if (pr.homing > 0) {
        // home toward nearest enemy (player-owned) 
        let best = null, bd = 1e9;
        for (const e of world.enemies) {
          const dx = e.x - pr.x, dy = (e.y - e.h / 2) - pr.y;
          const d = dx * dx + dy * dy;
          if (d < bd && d < 420 * 420) { bd = d; best = e; }
        }
        if (best) {
          const want = Math.atan2((best.y - best.h / 2) - pr.y, best.x - pr.x);
          const cur = Math.atan2(pr.vy, pr.vx);
          let d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const na = cur + Math.max(-pr.homing * dt, Math.min(pr.homing * dt, d));
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
        }
      }
      if (pr.kind === 'glob') pr.vy += GRAV * 0.55 * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      let dead = pr.t > 3 || pr.x < 0 || pr.x > WORLD_W || pr.y > GROUND_Y + 40;

      if (!dead) {
        if (pr.owner === 'enemy') {
          for (const p of world.players) {
            if (p.dead) continue;
            if (Math.abs(p.x - pr.x) < 24 && Math.abs((p.y - 36) - pr.y) < 48) {
              damagePlayer(world, p, pr.dmg);
              dead = true; break;
            }
          }
        } else {
          const owner = world.players.find(p => p.id === pr.owner);
          for (const e of [...world.enemies]) {
            if (Math.abs(e.x - pr.x) < e.w / 2 + 8 && Math.abs((e.y - e.h / 2) - pr.y) < e.h / 2 + 10) {
              damageEnemy(world, e, pr.dmg, owner || null);
              dead = true; break;
            }
          }
        }
      }
      if (dead) {
        burst(world, pr.x, pr.y, pr.kind === 'glob' ? '#7dff5a' : '#ffe27d', 4, 140);
        world.projs = world.projs.filter(x => x !== pr);
      }
    }
  }

  function updatePickups(world, dt) {
    for (const pk of [...world.pickups]) {
      pk.t += dt;
      pk.vy += GRAV * 0.6 * dt;
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (pk.y > GROUND_Y - 8) { pk.y = GROUND_Y - 8; pk.vy *= -0.4; pk.vx *= 0.8; }
      // magnet to nearest living player
      let best = null, bd = 1e9;
      for (const p of world.players) {
        if (p.dead) continue;
        const dx = p.x - pk.x, dy = (p.y - 40) - pk.y;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { p, dx, dy, d }; }
      }
      if (best && best.d < 190) {
        const pull = 1400 * dt;
        pk.vx += (best.dx / best.d) * pull;
        pk.vy += (best.dy / best.d) * pull;
      }
      if (best && best.d < 34) {
        if (pk.kind === 'xp') gainXP(world, best.p, pk.val);
        else { best.p.hp = Math.min(best.p.maxhp, best.p.hp + best.p.maxhp * 0.25); burst(world, pk.x, pk.y, '#ff7d9a', 8, 180); }
        world.pickups = world.pickups.filter(x => x !== pk);
        continue;
      }
      if (pk.t > 25) world.pickups = world.pickups.filter(x => x !== pk);
    }
  }

  function update(world, dt) {
      world.time += dt;
      if (world.over) return;

      // wave spawner
      if (world.waveState === 'idle') {
        startWave(world);
      } else if (world.waveState === 'spawning') {
        world.spawnT -= dt;
        if (world.spawnT <= 0) {
          const alive = world.players.some(p => !p.dead);
          if (world.spawnQueue.length && alive) {
            spawnEnemy(world, world.spawnQueue.pop());
            world.spawnT = Math.max(0.25, 1.1 - world.wave * 0.05);
          } else if (!world.spawnQueue.length) {
            world.waveState = 'fighting';
          } else {
            world.spawnT = 0.5;
          }
        }
      } else if (world.waveState === 'fighting') {
        if (!world.enemies.length) {
          world.waveState = 'breather';
          world.breatherT = 3.2;
          for (const p of world.players) {
            if (!p.dead) {
              p.score += world.wave * 50;
              world.floatTexts.push({ x: p.x, y: p.y - 110, txt: 'WAVE ' + world.wave + ' CLEAR', t: 2, color: '#ffe27d' });
            }
          }
        }
      } else if (world.waveState === 'breather') {
        world.breatherT -= dt;
        if (world.breatherT <= 0) startWave(world);
      }

      for (const p of world.players) updatePlayer(world, p, dt);
      for (const e of [...world.enemies]) updateEnemy(world, e, dt);
      updateProjs(world, dt);
      updatePickups(world, dt);

      // particles & float texts (cosmetic, both sides run these)
      for (const pt of [...world.parts]) {
        pt.t -= dt;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.vy += GRAV * 0.5 * dt;
        if (pt.t <= 0) world.parts = world.parts.filter(x => x !== pt);
      }
      for (const ft of [...world.floatTexts]) {
        ft.t -= dt; ft.y -= 34 * dt;
        if (ft.t <= 0) world.floatTexts = world.floatTexts.filter(x => x !== ft);
      }
  }

  // cosmetic-only tick for net guests (no authority).
  // Render positions ease toward the latest snapshot targets.
  function clientTick(world, dt) {
    const k = Math.min(1, dt * 14);
    for (const p of world.players) {
      if (p.tx !== undefined) {
        if (Math.abs(p.tx - p.x) > 260 || Math.abs(p.ty - p.y) > 260) { p.x = p.tx; p.y = p.ty; }
        else { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
      }
      p.animT += dt * 2;
      p.hurtT = Math.max(0, p.hurtT - dt);
      p.dashT = Math.max(0, (p.dashT || 0) - dt);
    }
    for (const e of world.enemies) {
      if (e.tx !== undefined) {
        if (Math.abs(e.tx - e.x) > 260) { e.x = e.tx; e.y = e.ty; }
        else { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; }
      }
      e.animT = (e.animT || 0) + dt * 3;
    }
    for (const pt of [...world.parts]) {
      pt.t -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += GRAV * 0.5 * dt;
      if (pt.t <= 0) world.parts = world.parts.filter(x => x !== pt);
    }
    for (const ft of [...world.floatTexts]) {
      ft.t -= dt; ft.y -= 34 * dt;
      if (ft.t <= 0) world.floatTexts = world.floatTexts.filter(x => x !== ft);
    }
  }

  // ---------------------------------------------------------------- net
  function snapshot(world) {
    return {
      t: world.time, wave: world.wave, ws: world.waveState,
      over: world.over, nextId: world.nextId,
      players: world.players.map(p => ({
        id: p.id, name: p.name, cls: p.cls, x: r2(p.x), y: r2(p.y),
        vx: r2(p.vx), vy: r2(p.vy), face: p.face,
        hp: Math.ceil(p.hp), maxhp: p.maxhp, level: p.level,
        xp: p.xp, xpNeed: p.xpNeed, atkCd: r2(p.atkCd), spcCd: r2(p.spcCd),
        hurtT: r2(p.hurtT), dead: p.dead, kills: p.kills, score: p.score,
        dashT: r2(p.dashT || 0), dashDx: p.dashDx || 0, moving: p.moving,
        chatT: r2(p.chatT || 0), chatMsg: p.chatMsg || '',
      })),
      enemies: world.enemies.map(e => ({
        id: e.id, type: e.type, x: r2(e.x), y: r2(e.y), vx: r2(e.vx), vy: r2(e.vy),
        hp: Math.ceil(e.hp), maxhp: e.maxhp, face: e.face, hurtT: r2(e.hurtT),
      })),
      projs: world.projs.map(pr => ({
        id: pr.id, x: r2(pr.x), y: r2(pr.y), kind: pr.kind,
        vx: r2(pr.vx), vy: r2(pr.vy),
      })),
      pickups: world.pickups.map(pk => ({
        id: pk.id, kind: pk.kind, x: r2(pk.x), y: r2(pk.y),
      })),
    };
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // guest: wholesale replace dynamic state, keeping nothing local
  function applySnapshot(world, snap) {
    world.time = snap.t; world.wave = snap.wave; world.waveState = snap.ws;
    world.over = snap.over; world.nextId = snap.nextId;
    const pmap = new Map(world.players.map(p => [p.id, p]));
    world.players = snap.players.map(sp => {
      let p = pmap.get(sp.id);
      const isNew = !p;
      if (isNew) {
        p = addPlayer(world, { id: sp.id, name: sp.name, cls: sp.cls, isLocal: false });
        p.x = sp.x; p.y = sp.y;
      }
      p.tx = sp.x; p.ty = sp.y;
      Object.assign(p, {
        name: sp.name, cls: sp.cls, vx: sp.vx, vy: sp.vy,
        face: sp.face, hp: sp.hp, maxhp: sp.maxhp, level: sp.level,
        xp: sp.xp, xpNeed: sp.xpNeed, atkCd: sp.atkCd, spcCd: sp.spcCd,
        hurtT: sp.hurtT, dead: sp.dead, kills: sp.kills, score: sp.score,
        dashT: sp.dashT, dashDx: sp.dashDx, moving: sp.moving,
        chatT: sp.chatT, chatMsg: sp.chatMsg,
      });
      if (isNew) { p.x = sp.x; p.y = sp.y; }
      return p;
    });
    const emap = new Map();
    world.enemies = snap.enemies.map(se => {
      const e = {
        id: se.id, type: se.type, vx: se.vx, vy: se.vy,
        w: ETYPES[se.type].w, h: ETYPES[se.type].h,
        hp: se.hp, maxhp: se.maxhp, face: se.face, hurtT: se.hurtT,
        t: 0, atkT: 1, hopT: 0, hitCd: 0, animT: Math.random() * 10, onGround: true,
        tx: se.x, ty: se.y, x: se.x, y: se.y,
      };
      emap.set(se.id, e);
      return e;
    });
    world.projs = snap.projs.map(sp => ({
      id: sp.id, owner: 'x', x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy,
      kind: sp.kind, dmg: 0, t: 0, homing: 0,
    }));
    const seen = new Set(world.pickups.map(pk => pk.id));
    for (const sk of snap.pickups) {
      if (!seen.has(sk.id)) {
        world.pickups.push({ id: sk.id, kind: sk.kind, x: sk.x, y: sk.y, vx: 0, vy: 0, val: 0, t: 0 });
      }
    }
    world.pickups = world.pickups.filter(pk => snap.pickups.some(sk => sk.id === pk.id));
  }

  return {
    CLASSES, ETYPES, GRAV, WORLD_W, GROUND_Y, PLATFORMS,
    createWorld, addPlayer, removePlayer, setInput, update,
    snapshot, applySnapshot, clientTick, burst,
  };
})();
