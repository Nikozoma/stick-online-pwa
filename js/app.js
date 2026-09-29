/* Stickhaven — app shell: screens, input, game loops, HUD, shop, stats, chat. */
'use strict';

const App = (() => {
  const $ = (id) => document.getElementById(id);

  let screen = 'home';

  // session
  let world = null, me = null, myPid = null;
  let role = null;             // 'solo' | 'host' | 'guest'
  let net = null;
  let rafId = 0, lastT = 0, acc = 0, snapT = 0, inputT = 0, hudT = 0;
  let camX = 0, camY = 0;
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let chatSeen = 0;
  let shopTab = 'w';
  let lastPoints = 0;

  // input
  const held = { l: false, r: false };
  let edgeJump = false, edgeAtk = false, edgeSpc = false;
  const touch = { l: false, r: false };
  const mouseAim = { x: 0, y: 0, aimed: false };

  /* ---------------------------------------------------------- screens */
  const SCREENS = ['home', 'mp', 'game'];
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
    wireHome(); wireMP(); wireGame(); wireInput(); wirePanels();
    Lifecycle.init(
      { gate: $('orientgate'), gateTitle: $('gatetitle'), gateBody: $('gatebody'), gateHelp: $('gatehelp') },
      { onBlockChange: () => { held.l = held.r = false; touch.l = touch.r = false; edgeJump = edgeAtk = edgeSpc = false; } }
    );
    window.addEventListener('resize', resize);
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

  /* ---------------------------------------------------------- home */
  function wireHome() {
    $('btn-survival').addEventListener('click', startSurvival);
    $('btn-multiplayer').addEventListener('click', () => {
      if (!Net.peerJsReady()) { toast('Multiplayer needs an internet connection (PeerJS failed to load).'); return; }
      resetMP(); showScreen('mp');
    });
    $('btn-how').addEventListener('click', () => $('howto').classList.toggle('hidden'));
  }

  /* ---------------------------------------------------------- multiplayer setup */
  function resetMP() {
    destroyNet();
    $('mp-setup').classList.remove('hidden');
    $('lobby').classList.add('hidden');
    $('mp-error').textContent = '';
    $('btn-start').classList.add('hidden');
    $('lobby-code-row').classList.add('hidden');
  }

  function wireMP() {
    const tabH = $('tab-host'), tabJ = $('tab-join');
    tabH.addEventListener('click', () => {
      tabH.classList.add('sel'); tabJ.classList.remove('sel');
      $('mp-host-panel').classList.remove('hidden');
      $('mp-join-panel').classList.add('hidden');
    });
    tabJ.addEventListener('click', () => {
      tabJ.classList.add('sel'); tabH.classList.remove('sel');
      $('mp-join-panel').classList.remove('hidden');
      $('mp-host-panel').classList.add('hidden');
    });
    $('btn-mp-back').addEventListener('click', () => { destroyNet(); showScreen('home'); });
    $('btn-host').addEventListener('click', doHost);
    $('btn-join').addEventListener('click', doJoin);
    $('btn-start').addEventListener('click', hostStart);
    $('btn-leave').addEventListener('click', () => { destroyNet(); resetMP(); });
  }

  function mpError(msg) { $('mp-error').textContent = msg; }

  function doHost() {
    const name = ($('host-name').value || 'Host').trim().slice(0, 14) || 'Host';
    const code = Net.makeCode();
    $('btn-host').disabled = true;
    net = Net.hostGame(code, name, {
      onReady: (c) => {
        role = 'host';
        $('mp-setup').classList.add('hidden');
        $('lobby').classList.remove('hidden');
        $('lobby-code-row').classList.remove('hidden');
        $('lobby-code').textContent = c;
        $('btn-start').classList.remove('hidden');
        $('lobby-status').textContent = 'Share this code with your friends. You are the host — keep this tab open.';
        renderLobby(net.lobby());
      },
      onLobby: (players) => renderLobby(players),
      onInput: (pid, keys) => {
        const p = world && Sim.byPid(world, pid);
        if (p) {
          p.input.left = !!keys.left; p.input.right = !!keys.right;
          if (keys.jump) p.input.jump = true;
          if (keys.attack) p.input.attack = true;
          if (keys.special) p.input.special = true;
          if (keys.aim) p.input.aim = keys.aim;
        }
      },
      onAct: (pid, msg) => applyAct(pid, msg),
      onChat: (pid, text) => {
        const p = world && Sim.byPid(world, pid);
        if (p) p.chat = { msg: text, until: world.time + 4 };
        net.broadcast({ t: 'chat', id: pid, text });
        chatLog((p ? p.name : '?') + ': ' + text);
      },
      onPeerLeft: (pid) => {
        if (world) Sim.removePlayer(world, pid);
        toast('A player left.');
      },
      onError: (msg) => { mpError(msg); $('btn-host').disabled = false; },
    });
  }

  function renderLobby(players) {
    const ul = $('lobby-players');
    ul.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.innerHTML = '<b>' + escapeHtml(p.name) + '</b>' + (p.isHost ? ' <span class="lp-host">HOST</span>' : '');
      ul.appendChild(li);
    }
    if (role === 'host') {
      const pvp = $('host-pvp').checked ? ' · PvP ON' : '';
      $('lobby-status').textContent = (players.length > 1
        ? players.length + ' players in. Start when ready!'
        : 'Share the code above. Waiting for players… (you can start solo too)') + pvp;
    }
  }

  function hostStart() {
    if (!net || role !== 'host') return;
    world = Sim.createWorld('mp');
    world.pvp = $('host-pvp').checked;
    myPid = 'p0';
    for (const lp of net.lobby()) {
      const p = Sim.addPlayer(world, lp.pid, lp.name);
      if (lp.isHost) p.isLocal = true;
    }
    me = Sim.byPid(world, myPid);
    me.isLocal = true;
    net.start();
    beginGame('host');
    toast(world.pvp ? 'World is live — PvP enabled!' : 'World is live!');
  }

  function doJoin() {
    const code = ($('join-code').value || '').trim().toUpperCase();
    const name = ($('join-name').value || 'Guest').trim().slice(0, 14) || 'Guest';
    if (code.length < 4) { mpError('Enter the room code from the host.'); return; }
    $('btn-join').disabled = true;
    net = Net.joinGame(code, name, {
      onLobby: (players) => {
        role = 'guest';
        $('mp-setup').classList.add('hidden');
        $('lobby').classList.remove('hidden');
        $('lobby-status').textContent = 'Waiting for the host to start…';
        renderLobby(players);
      },
      onStart: (you) => {
        world = Sim.createWorld('mp');
        myPid = you;
        beginGame('guest');
        toast('Joined! Follow the host into battle.');
      },
      onSnapshot: (snap) => {
        if (world && role === 'guest') {
          Sim.applySnapshot(world, snap);
          me = Sim.byPid(world, myPid) || null;
          if (me) me.isLocal = true;
          syncChatLog();
        }
      },
      onChat: (id, text) => {
        const p = world && Sim.byPid(world, id);
        if (p) p.chat = { msg: text, until: world.time + 4 };
        chatLog(((p && p.name) || '?') + ': ' + text);
      },
      onHostLeft: () => {
        toast('Host left — session ended.', 3500);
        leaveGame();
        resetMP(); showScreen('mp');
      },
      onError: (msg) => { mpError(msg); $('btn-join').disabled = false; },
    });
  }

  function destroyNet() {
    if (net) { try { net.destroy(); } catch (e) {} net = null; }
    role = null;
    const b = $('btn-host'); if (b) b.disabled = false;
    const j = $('btn-join'); if (j) j.disabled = false;
  }

  /* ---------------------------------------------------------- game start */
  function startSurvival() {
    destroyNet();
    world = Sim.createWorld('survival');
    myPid = 'me';
    me = Sim.addPlayer(world, myPid, 'You');
    me.isLocal = true;
    beginGame('solo');
  }

  function beginGame(r) {
    role = r;
    acc = 0; snapT = 0; inputT = 0; hudT = 0;
    camX = 0; camY = 0; chatSeen = 0; lastPoints = 0;
    $('gameover').classList.add('hidden');
    $('statpanel').classList.add('hidden');
    $('shoppanel').classList.add('hidden');
    $('chatlog').innerHTML = '';
    $('chatbar').classList.toggle('hidden', r === 'solo');
    showScreen('game');
    lastT = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function leaveGame() {
    cancelAnimationFrame(rafId);
    destroyNet();
    world = null; me = null;
    showScreen('home');
  }

  /* ---------------------------------------------------------- guest/host actions */
  // acts: alloc, buyW, buyH, buyArrows, sellW, sellH, equipW, equipH
  function doAct(act, id) {
    if (!world || !me) return;
    if (role === 'guest') {
      net.send({ t: 'act', act, id });
      return;
    }
    applyAct(myPid, { act, id });
    refreshPanels();
  }

  function applyAct(pid, msg) {
    if (!world) return;
    const { act, id } = msg;
    switch (act) {
      case 'alloc': Sim.allocPoint(world, pid, id); break;
      case 'buyW': Sim.buyWeapon(world, pid, id); break;
      case 'buyH': Sim.buyHat(world, pid, id); break;
      case 'buyArrows': Sim.buyArrows(world, pid); break;
      case 'sellW': Sim.sellItem(world, pid, 'weapon', id); break;
      case 'sellH': Sim.sellItem(world, pid, 'hat', id); break;
      case 'equipW': Sim.equipWeapon(world, pid, id); break;
      case 'equipH': Sim.equipHat(world, pid, id); break;
      default: break;
    }
  }

  /* ---------------------------------------------------------- main loop */
  const STEP = 1 / 60;
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;

    if (Lifecycle.blocked || !world) { draw(); return; }

    sampleLocalInput();

    if (role === 'solo' || role === 'host') {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) { Sim.update(world, STEP, true); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      if (role === 'host') {
        snapT -= dt;
        if (snapT <= 0) {
          snapT = 1 / 12;
          net.broadcast({ t: 'snap', snap: Sim.snapshot(world) });
        }
      }
      me = Sim.byPid(world, myPid);
      if (me) me.isLocal = true;
      syncChatLog();
      if (world.over && role === 'solo') return gameOver();
    } else if (role === 'guest') {
      Sim.clientTick(world, dt);
      inputT -= dt;
      if (inputT <= 0) {
        inputT = 1 / 20;
        const aim = mouseAim.aimed ? { x: mouseAim.x, y: mouseAim.y, aimed: true } : null;
        net.send({ t: 'in', keys: {
          left: held.l || touch.l, right: held.r || touch.r,
          jump: edgeJump, attack: edgeAtk, special: edgeSpc, aim,
        } });
        mouseAim.aimed = false;
        clearEdges();
      }
    }

    clearEdges();
    updateCamera(dt);
    draw();
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.12; updateHUD(); refreshPanels(); }
  }

  function sampleLocalInput() {
    if ((role === 'solo' || role === 'host') && me && world) {
      me.input.left = held.l || touch.l;
      me.input.right = held.r || touch.r;
      if (edgeJump) me.input.jump = true;
      if (edgeAtk) me.input.attack = true;
      if (edgeSpc) me.input.special = true;
      if (mouseAim.aimed) me.input.aim = { x: mouseAim.x, y: mouseAim.y, aimed: true };
      mouseAim.aimed = false;
    }
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
    while (chatSeen < world.chatLog.length) {
      const c = world.chatLog[chatSeen++];
      chatLog(c.name ? c.name + ': ' + c.text : c.text);
    }
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
    $('hud-foes').textContent = (world.mobs.length + world.spawnQueue.length) + ' left';
  }

  function gameOver() {
    cancelAnimationFrame(rafId);
    $('go-stats').innerHTML =
      'Wave reached: <b>' + world.wave + '</b><br>' +
      'Level: <b>' + me.level + '</b> · Gold: <b>' + me.gold + 'g</b>';
    $('gameover').classList.remove('hidden');
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
    if (!text || !world || !me) return;
    if (role === 'host') {
      me.chat = { msg: text, until: world.time + 4 };
      net.broadcast({ t: 'chat', id: myPid, text });
      chatLog(me.name + ': ' + text);
    } else if (role === 'guest') {
      net.chat(text);
    }
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
        case 'KeyT': if (role !== 'solo') $('chatinput').focus(); break;
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

    // touch controls
    const bindHold = (id, set) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
      el.addEventListener('pointerleave', () => set(false));
    };
    bindHold('tc-left', (v) => touch.l = v);
    bindHold('tc-right', (v) => touch.r = v);
    $('tc-jump').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeJump = true; });
    $('tc-atk').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeAtk = true; });
    $('tc-spc').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeSpc = true; });
    if (matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');

    // chat UI
    $('btn-chat').addEventListener('click', () => $('chatinput').focus());
    $('chatinput').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') sendChat();
      e.stopPropagation();
    });
  }

  /* ---------------------------------------------------------- game screen wiring */
  function wireGame() {
    $('btn-menu').addEventListener('click', () => {
      if (role === 'solo' || confirm('Leave this game?')) leaveGame();
    });
    $('btn-retry').addEventListener('click', () => startSurvival());
    $('btn-go-menu').addEventListener('click', () => leaveGame());
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', App.boot);
