/* Stickhaven — app shell: screens, input, HUD, shop, stats, chat.
   Online-only: one shared world on the dedicated server. The client sends
   inputs and renders authoritative snapshots; it never runs the sim. */
'use strict';

const App = (() => {
  const $ = (id) => document.getElementById(id);

  let screen = 'home';

  // session
  let world = null, me = null, myPid = null;
  let net = null, welcomed = false, wasDead = false;
  let rafId = 0, lastT = 0, inputT = 0, hudT = 0;
  let camX = 0, camY = 0;
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let shopTab = 'w';
  let lastPoints = 0;
  const chatKeys = new Set();

  // input
  const held = { l: false, r: false };
  let edgeJump = false, edgeAtk = false, edgeSpc = false;
  const touch = { l: false, r: false };
  const mouseAim = { x: 0, y: 0, aimed: false };

  /* ---------------------------------------------------------- screens */
  const SCREENS = ['home', 'game'];
  function showScreen(name) {
    screen = name;
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    if (name === 'game') resize();
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  /* ---------------------------------------------------------- boot */
  function boot() {
    canvas = $('game');
    ctx = canvas.getContext('2d');
    wireHome(); wireGame(); wireInput(); wirePanels();
    Lifecycle.init(
      { gate: $('orientgate'), gateTitle: $('gatetitle'), gateBody: $('gatebody'), gateHelp: $('gatehelp') },
      { onBlockChange: () => { held.l = held.r = false; touch.l = touch.r = false; edgeJump = edgeAtk = edgeSpc = false; } }
    );
    window.addEventListener('resize', resize);
    const saved = localStorage.getItem('stickhaven-name');
    if (saved) $('name-input').value = saved;
    showScreen('home');
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------------------------------------------------- home / join */
  function wireHome() {
    $('btn-join-world').addEventListener('click', doJoinWorld);
    $('name-input').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') doJoinWorld();
      e.stopPropagation();
    });
    $('btn-how').addEventListener('click', () => $('howto').classList.toggle('hidden'));
  }

  function joinError(msg) {
    $('join-error').textContent = msg;
    $('btn-join-world').disabled = false;
  }

  function doJoinWorld() {
    const name = ($('name-input').value || 'Player').trim().slice(0, 14) || 'Player';
    localStorage.setItem('stickhaven-name', name);
    $('join-error').textContent = '';
    $('btn-join-world').disabled = true;
    welcomed = false;
    net = Net.connect(name, {
      onWelcome: (pid) => {
        welcomed = true;
        myPid = pid;
        world = Sim.createWorld('mp');
        wasDead = false;
        beginGame();
        toast('Welcome to Stickhaven!');
      },
      onSnap: (snap) => {
        if (!world) return;
        Sim.applySnapshot(world, snap);
        me = Sim.byPid(world, myPid) || null;
        if (me) {
          me.isLocal = true;
          if (me.dead && !wasDead) toast('You were defeated — respawning…');
          wasDead = me.dead;
        }
        syncChatLog();
      },
      onClose: () => {
        if (!welcomed) {
          joinError('Could not connect to the server. Check your connection and try again.');
        } else if (screen === 'game') {
          toast('Disconnected from the server.', 4000);
          leaveGame();
        }
      },
      onError: (msg) => joinError(msg),
    });
  }

  /* ---------------------------------------------------------- game start/end */
  function beginGame() {
    inputT = 0; hudT = 0;
    camX = 0; camY = 0; lastPoints = 0;
    chatKeys.clear();
    $('statpanel').classList.add('hidden');
    $('shoppanel').classList.add('hidden');
    $('chatlog').innerHTML = '';
    showScreen('game');
    lastT = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function leaveGame() {
    cancelAnimationFrame(rafId);
    if (net) { net.close(); net = null; }
    welcomed = false;
    world = null; me = null; myPid = null;
    $('btn-join-world').disabled = false;
    showScreen('home');
  }

  /* ---------------------------------------------------------- shop/stat actions */
  // acts: alloc, buyW, buyH, buyArrows, sellW, sellH, equipW, equipH
  function doAct(act, id) {
    if (!world || !me || !net) return;
    net.send({ t: 'act', act, id });
  }

  /* ---------------------------------------------------------- main loop */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;

    if (Lifecycle.blocked || !world) { draw(); return; }

    Sim.clientTick(world, dt);

    // inputs to the server at 20Hz; edges are consumed only when sent,
    // so a press between sends is never lost
    inputT -= dt;
    if (inputT <= 0) {
      inputT = 1 / 20;
      const aim = mouseAim.aimed ? { x: mouseAim.x, y: mouseAim.y, aimed: true } : null;
      if (net) {
        net.send({ t: 'in', keys: {
          left: held.l || touch.l, right: held.r || touch.r,
          jump: edgeJump, attack: edgeAtk, special: edgeSpc, aim,
        } });
      }
      mouseAim.aimed = false;
      clearEdges();
    }

    updateCamera(dt);
    draw();
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.12; updateHUD(); refreshPanels(); }
  }

  function clearEdges() { edgeJump = edgeAtk = edgeSpc = false; }

  function updateCamera(dt) {
    if (!me) return;
    const tx = Math.max(0, Math.min(Sim.WORLD_W - W, me.x - W / 2));
    camX += (tx - camX) * Math.min(1, dt * 6);
    // Y follows the player (not the ground) so short landscape viewports on
    // phones can't push the player below the visible area. Clamped to keep
    // some sky above and the ground near the bottom when standing on it.
    const ty = Math.max(-220, Math.min(Sim.GROUND_Y + 90 - H, me.y - H * 0.55));
    camY += (ty - camY) * Math.min(1, dt * 6);
  }

  function draw() {
    if (!world) return;
    Render.draw(ctx, world, { W, H, camX, camY });
  }

  function syncChatLog() {
    if (!world) return;
    for (const c of world.chatLog) {
      const key = c.t.toFixed(2) + '|' + (c.name || '') + '|' + c.text;
      if (!chatKeys.has(key)) {
        chatKeys.add(key);
        chatLog(c.name ? c.name + ': ' + c.text : c.text);
      }
    }
    if (chatKeys.size > 80) chatKeys.clear(); // bounds growth; may reprint a line
  }

  /* ---------------------------------------------------------- HUD */
  function updateHUD() {
    if (!me || !world) return;
    const mhp = Sim.maxHp(me), mst = Sim.maxSt(me);
    const hpFrac = Math.max(0, me.hp / mhp);
    $('hud-hp-fill').style.width = (hpFrac * 100).toFixed(1) + '%';
    $('hud-hp-fill').style.background = hpFrac > 0.35 ? '#3ddc84' : '#ff5a5a';
    $('hud-hp-text').textContent = Math.ceil(me.hp) + ' / ' + mhp;
    $('hud-st-fill').style.width = (100 * Math.max(0, me.st) / mst).toFixed(1) + '%';
    $('hud-xp-fill').style.width = (100 * me.xp / Sim.xpNext(me.level)).toFixed(1) + '%';
    $('hud-level').textContent = 'LV ' + me.level;
    $('hud-gold').textContent = me.gold + 'g';
    const pts = $('hud-points');
    pts.classList.toggle('hidden', me.points <= 0);
    pts.textContent = '+' + me.points + ' pts';
    $('hud-wave').textContent = 'WAVE ' + Math.max(1, world.wave);
    $('hud-foes').textContent = world.mobs.length + ' left';
  }

  /* ---------------------------------------------------------- stat panel */
  const STATS = [
    ['str', 'STR', '+2 damage per swing'],
    ['vit', 'VIT', '+12 max HP'],
    ['agi', 'AGI', '+2% move speed'],
    ['int', 'INT', '+8 max stamina'],
  ];
  function refreshPanels() {
    if (!me || screen !== 'game') return;
    // stat panel auto-opens only when new points arrive; user can dismiss/toggle
    const sp = $('statpanel');
    if (me.points > 0 && !me.dead) {
      if (me.points > lastPoints) sp.classList.remove('hidden');
      if (!sp.classList.contains('hidden')) renderStatRows();
    } else {
      sp.classList.add('hidden');
    }
    lastPoints = me.points;
    if (!$('shoppanel').classList.contains('hidden')) renderShop();
  }

  function renderStatRows() {
    $('stat-points').textContent = '+' + me.points;
    const wrap = $('stat-rows');
    wrap.innerHTML = '';
    for (const [key, label, desc] of STATS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = '<span class="sname">' + label + '</span>' +
        '<span class="sdesc">' + desc + '</span>' +
        '<span class="sval">' + me.stats[key] + '</span>';
      const btn = document.createElement('button');
      btn.className = 'stat-plus';
      btn.textContent = '+';
      btn.addEventListener('click', () => doAct('alloc', key));
      row.appendChild(btn);
      wrap.appendChild(row);
    }
  }

  /* ---------------------------------------------------------- shop */
  function weaponDesc(w) {
    return w.dmg + ' dmg · ' + w.stam + ' stam' + (w.targets > 1 ? ' · hits ' + w.targets : '') +
      (w.ranged ? ' · ranged' : '') + (w.knock ? ' · knockback' : '');
  }
  function hatDesc(h) {
    const m = h.mods || {};
    const parts = [];
    if (m.str) parts.push('+' + m.str + ' STR');
    if (m.vit) parts.push('+' + m.vit + ' VIT');
    if (m.agi) parts.push('+' + m.agi + ' AGI');
    if (m.int) parts.push('+' + m.int + ' INT');
    if (m.hp) parts.push('+' + m.hp + ' HP');
    if (m.stam) parts.push('+' + m.stam + ' stam');
    if (m.jump) parts.push('+jump');
    return parts.join(' · ') || 'cosmetic courage';
  }

  function renderShop() {
    if (!me) return;
    $('shop-gold').textContent = me.gold + 'g';
    const list = $('shop-list');
    list.innerHTML = '';
    const isW = shopTab === 'w';
    const items = isW ? Sim.WEAPONS : Sim.HATS;
    const owned = isW ? me.ownedW : me.ownedH;
    const equipped = isW ? me.weapon : me.hat;
    for (const it of items) {
      const has = owned.includes(it.id);
      const eq = equipped === it.id;
      const row = document.createElement('div');
      row.className = 'shop-row' + (eq ? ' equipped' : '');
      const info = document.createElement('div');
      info.className = 'iname';
      info.innerHTML = '<b>' + escapeHtml(it.name) + (eq ? ' <span class="tag">EQUIPPED</span>' : '') + '</b>' +
        '<span>' + escapeHtml(isW ? weaponDesc(it) : hatDesc(it)) + '</span>';
      row.appendChild(info);
      if (has) {
        if (!eq) {
          const b = document.createElement('button');
          b.className = 'mini-btn'; b.textContent = 'Equip';
          b.addEventListener('click', () => doAct(isW ? 'equipW' : 'equipH', it.id));
          row.appendChild(b);
          if (it.price > 0 && it.id !== 'stick' && it.id !== 'none') {
            const s = document.createElement('button');
            s.className = 'mini-btn sell';
            s.textContent = 'Sell ' + Math.floor(it.price * 0.4) + 'g';
            s.addEventListener('click', () => doAct(isW ? 'sellW' : 'sellH', it.id));
            row.appendChild(s);
          }
        }
      } else if (it.dropOnly) {
        const b = document.createElement('button');
        b.className = 'mini-btn'; b.textContent = 'Boss drop'; b.disabled = true;
        row.appendChild(b);
      } else {
        const b = document.createElement('button');
        b.className = 'mini-btn';
        b.textContent = 'Buy ' + it.price + 'g';
        b.disabled = me.gold < it.price;
        b.addEventListener('click', () => doAct(isW ? 'buyW' : 'buyH', it.id));
        row.appendChild(b);
      }
      list.appendChild(row);
    }
  }

  function wirePanels() {
    $('btn-stat-close').addEventListener('click', () => $('statpanel').classList.add('hidden'));
    $('hud-points').addEventListener('click', () => {
      $('statpanel').classList.toggle('hidden');
      renderStatRows();
    });
    $('btn-shop').addEventListener('click', () => {
      const p = $('shoppanel');
      p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) renderShop();
    });
    $('btn-shop-close').addEventListener('click', () => $('shoppanel').classList.add('hidden'));
    $('btn-arrows').addEventListener('click', () => { doAct('buyArrows'); });
    $('shop-tab-w').addEventListener('click', () => {
      shopTab = 'w';
      $('shop-tab-w').classList.add('sel'); $('shop-tab-h').classList.remove('sel');
      renderShop();
    });
    $('shop-tab-h').addEventListener('click', () => {
      shopTab = 'h';
      $('shop-tab-h').classList.add('sel'); $('shop-tab-w').classList.remove('sel');
      renderShop();
    });
  }

  /* ---------------------------------------------------------- chat */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function chatLog(line) {
    const log = $('chatlog');
    const div = document.createElement('div');
    div.innerHTML = escapeHtml(line);
    log.appendChild(div);
    while (log.children.length > 8) log.removeChild(log.firstChild);
    clearTimeout(chatLog._t);
    chatLog._t = setTimeout(() => { log.innerHTML = ''; }, 12000);
  }
  function sendChat() {
    const inp = $('chatinput');
    const text = inp.value.trim().slice(0, 120);
    inp.value = '';
    inp.blur();
    if (!text || !net) return;
    net.send({ t: 'chat', text });
  }

  /* ---------------------------------------------------------- input */
  function aimAt(e, clicked) {
    mouseAim.x = camX + e.clientX;
    mouseAim.y = camY + e.clientY;
    if (clicked) mouseAim.aimed = true;
  }

  function wireInput() {
    const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyJ', 'KeyZ', 'KeyK', 'KeyX', 'KeyT', 'KeyB'];
    document.addEventListener('keydown', (e) => {
      if (screen !== 'game') return;
      if (document.activeElement === $('chatinput')) {
        if (e.code === 'Enter') sendChat();
        else if (e.code === 'Escape') $('chatinput').blur();
        return;
      }
      if (GAME_KEYS.includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': held.l = true; break;
        case 'ArrowRight': case 'KeyD': held.r = true; break;
        case 'ArrowUp': case 'KeyW': case 'Space': edgeJump = true; break;
        case 'KeyJ': case 'KeyZ': edgeAtk = true; break;
        case 'KeyK': case 'KeyX': edgeSpc = true; break;
        case 'KeyB': $('btn-shop').click(); break;
        case 'KeyT': $('chatinput').focus(); break;
        case 'Escape':
          $('statpanel').classList.add('hidden');
          $('shoppanel').classList.add('hidden');
          break;
      }
    });
    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': held.l = false; break;
        case 'ArrowRight': case 'KeyD': held.r = false; break;
      }
    });
    window.addEventListener('blur', () => { held.l = held.r = false; touch.l = touch.r = false; });

    // mouse: left = attack, right = special (aim at cursor)
    canvas.addEventListener('mousedown', (e) => {
      if (screen !== 'game') return;
      if (e.button === 0) { aimAt(e, true); edgeAtk = true; }
      else if (e.button === 2) { aimAt(e, true); edgeSpc = true; }
    });
    canvas.addEventListener('mousemove', (e) => { if (screen === 'game') aimAt(e, false); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // touch buttons: attack / special (bottom-right)
    $('tc-atk').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeAtk = true; });
    $('tc-spc').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeSpc = true; });
    wireJoystick();
    if (matchMedia('(pointer: coarse)').matches) {
      $('touch').classList.remove('hidden');
      $('joyzone').classList.remove('hidden');
    }

    // chat UI
    $('btn-chat').addEventListener('click', () => $('chatinput').focus());
    $('chatinput').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') sendChat();
      e.stopPropagation();
    });
  }

  /* Floating joystick: wherever the finger lands on the left side of the
     screen becomes the stick. Left/right to move; push UP to jump — push up
     a second time mid-air for the double jump. */
  function wireJoystick() {
    const zone = $('joyzone'), base = $('joy-base'), nub = $('joy-nub');
    const joy = { id: null, ox: 0, oy: 0, upLatch: false };
    const R = 46; // max nub travel (px)

    function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
    function end() {
      joy.id = null; joy.upLatch = false;
      touch.l = touch.r = false;
      base.classList.add('hidden');
      nub.classList.add('hidden');
    }
    zone.addEventListener('pointerdown', (e) => {
      if (screen !== 'game' || joy.id !== null) return;
      joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.upLatch = false;
      try { zone.setPointerCapture(e.pointerId); } catch (err) {}
      place(base, joy.ox, joy.oy);
      place(nub, joy.ox, joy.oy);
      base.classList.remove('hidden');
      nub.classList.remove('hidden');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joy.id) return;
      const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      const d = Math.hypot(dx, dy) || 1;
      const cl = Math.min(d, R);
      place(nub, joy.ox + (dx / d) * cl, joy.oy + (dy / d) * cl);
      touch.l = dx < -16;
      touch.r = dx > 16;
      if (dy < -30 && !joy.upLatch) { edgeJump = true; joy.upLatch = true; }
      if (dy > -12) joy.upLatch = false; // release the latch so a second push double-jumps
    });
    zone.addEventListener('pointerup', (e) => { if (e.pointerId === joy.id) end(); });
    zone.addEventListener('pointercancel', (e) => { if (e.pointerId === joy.id) end(); });
  }

  /* ---------------------------------------------------------- game screen wiring */
  function wireGame() {
    $('btn-menu').addEventListener('click', () => {
      if (confirm('Leave the world?')) leaveGame();
    });
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', App.boot);
