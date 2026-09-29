/* Stickhaven — app shell: screens, input, game loops, HUD, chat. */
'use strict';

const App = (() => {
  const $ = (id) => document.getElementById(id);

  let screen = 'home';
  let pendingMode = null;      // 'survival' | 'mp'
  let chosenCls = 'brawler';

  // session
  let world = null, me = null, myPid = null;
  let role = null;             // 'solo' | 'host' | 'guest'
  let net = null;
  let rafId = 0, lastT = 0, acc = 0, snapT = 0, inputT = 0, hudT = 0;
  let camX = 0, camY = 0;
  let canvas, ctx, W = 0, H = 0, dpr = 1;

  // input
  const held = { l: false, r: false };
  let edgeJ = false, edgeAtk = false, edgeSpc = false;
  const touch = { l: false, r: false };

  /* ---------------------------------------------------------- screens */
  const SCREENS = ['home', 'class', 'mp', 'game'];
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
    buildClassCards();
    wireHome(); wireClass(); wireMP(); wireGame(); wireInput();
    Lifecycle.init(
      { gate: $('orientgate'), gateTitle: $('gatetitle'), gateBody: $('gatebody'), gateHelp: $('gatehelp') },
      { onBlockChange: (blocked) => { held.l = held.r = false; touch.l = touch.r = false; edgeJ = edgeAtk = edgeSpc = false; } }
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
    $('btn-survival').addEventListener('click', () => { pendingMode = 'survival'; showScreen('class'); });
    $('btn-multiplayer').addEventListener('click', () => {
      if (!Net.peerJsReady()) { toast('Multiplayer needs an internet connection (PeerJS failed to load).'); return; }
      pendingMode = 'mp'; showScreen('class');
    });
    $('btn-how').addEventListener('click', () => $('howto').classList.toggle('hidden'));
    $('btn-back-home').addEventListener('click', () => showScreen('home'));
  }

  /* ---------------------------------------------------------- class select */
  function buildClassCards() {
    const wrap = $('class-cards');
    wrap.innerHTML = '';
    for (const [key, c] of Object.entries(Sim.CLASSES)) {
      const d = document.createElement('button');
      d.className = 'class-card' + (key === chosenCls ? ' sel' : '');
      d.innerHTML =
        '<span class="cc-hat" style="color:' + c.color + '">' + hatGlyph(key) + '</span>' +
        '<span class="cc-name">' + c.name + '</span>' +
        '<span class="cc-desc">' + c.desc + '</span>' +
        '<span class="cc-stats">HP ' + c.hp + ' · ' + (c.atk === 'melee' ? 'Melee' : 'Ranged') + ' · Special: ' + c.spcName + '</span>';
      d.addEventListener('click', () => {
        chosenCls = key;
        wrap.querySelectorAll('.class-card').forEach(x => x.classList.remove('sel'));
        d.classList.add('sel');
      });
      wrap.appendChild(d);
    }
  }
  function hatGlyph(cls) {
    // tiny text glyphs suggesting each class hat
    return cls === 'brawler' ? '—◠—' : cls === 'archer' ? '◢◣' : '▲';
  }
  function wireClass() {
    $('btn-class-back').addEventListener('click', () => showScreen('home'));
    $('btn-class-go').addEventListener('click', () => {
      if (pendingMode === 'survival') startSurvival();
      else if (pendingMode === 'mp') { resetMP(); showScreen('mp'); }
    });
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
    $('btn-mp-back').addEventListener('click', () => { destroyNet(); showScreen('class'); });
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
    net = Net.hostGame(code, name, chosenCls, {
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
      onInput: (pid, keys) => { if (world) Sim.setInput(world, pid, keys); },
      onChat: (pid, text) => {
        const p = world && world.players.find(p => p.id === pid);
        if (p) { p.chatMsg = text; p.chatT = 4; }
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
      li.innerHTML = '<b>' + escapeHtml(p.name) + '</b> <span class="lp-cls">' +
        Sim.CLASSES[p.cls].name + '</span>' + (p.isHost ? ' <span class="lp-host">HOST</span>' : '');
      ul.appendChild(li);
    }
    if (role === 'host') {
      $('lobby-status').textContent = players.length > 1
        ? players.length + ' players in. Start when ready!'
        : 'Share the code above. Waiting for players… (you can start solo too)';
    }
  }

  function hostStart() {
    if (!net || role !== 'host') return;
    world = Sim.createWorld('mp');
    myPid = 'p0';
    for (const lp of net.lobby()) {
      Sim.addPlayer(world, { id: lp.pid, name: lp.name, cls: lp.cls, isLocal: lp.isHost });
    }
    me = world.players.find(p => p.id === myPid);
    net.start();
    beginGame('host');
    toast('World is live!');
  }

  function doJoin() {
    const code = ($('join-code').value || '').trim().toUpperCase();
    const name = ($('join-name').value || 'Guest').trim().slice(0, 14) || 'Guest';
    if (code.length < 4) { mpError('Enter the room code from the host.'); return; }
    $('btn-join').disabled = true;
    net = Net.joinGame(code, name, chosenCls, {
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
          if (!me) me = world.players.find(p => p.id === myPid) || null;
        }
      },
      onChat: (id, text) => {
        const p = world && world.players.find(p => p.id === id);
        if (p) { p.chatMsg = text; p.chatT = 4; }
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
    me = Sim.addPlayer(world, { id: myPid, name: 'You', cls: chosenCls, isLocal: true });
    beginGame('solo');
  }

  function beginGame(r) {
    role = r;
    acc = 0; snapT = 0; inputT = 0; hudT = 0;
    camX = 0; camY = 0;
    $('gameover').classList.add('hidden');
    $('chatlog').innerHTML = '';
    $('mp-hud').classList.toggle('hidden', r === 'solo');
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
      while (acc >= STEP && n < 5) { Sim.update(world, STEP); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      if (role === 'host') {
        snapT -= dt;
        if (snapT <= 0) {
          snapT = 1 / 12;
          net.broadcast({ t: 'snap', snap: Sim.snapshot(world) });
        }
      }
      if (world.over && role === 'solo') return gameOver();
    } else if (role === 'guest') {
      Sim.clientTick(world, dt);
      inputT -= dt;
      if (inputT <= 0) {
        inputT = 1 / 20;
        net.send({ t: 'in', keys: { l: held.l || touch.l, r: held.r || touch.r, j: edgeJ, atk: edgeAtk, spc: edgeSpc } });
        clearEdges();
      }
    }

    // chat bubbles decay (host authority sets these via sim? chatT decays here for all)
    for (const p of world.players) {
      if (p.chatT > 0) { p.chatT -= dt; if (p.chatT <= 0) p.chatMsg = ''; }
    }

    if (role !== 'guest') clearEdges();
    updateCamera(dt);
    draw();
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.12; updateHUD(); }
  }

  function sampleLocalInput() {
    if ((role === 'solo' || role === 'host') && me && world) {
      Sim.setInput(world, myPid, {
        l: held.l || touch.l, r: held.r || touch.r,
        j: edgeJ, atk: edgeAtk, spc: edgeSpc,
      });
    }
  }
  function clearEdges() { edgeJ = edgeAtk = edgeSpc = false; }

  function updateCamera(dt) {
    if (!me) return;
    const tx = Math.max(0, Math.min(Sim.WORLD_W - W, me.x - W / 2));
    camX += (tx - camX) * Math.min(1, dt * 6);
    const ty = Math.max(-220, Math.min(120, Sim.GROUND_Y + 90 - H));
    camY += (ty - camY) * Math.min(1, dt * 6);
  }

  function draw() {
    if (!world) return;
    Render.draw(ctx, world, { W, H, camX, camY });
  }

  /* ---------------------------------------------------------- HUD */
  function updateHUD() {
    if (!me || !world) return;
    const hpFrac = Math.max(0, me.hp / me.maxhp);
    $('hud-hp-fill').style.width = (hpFrac * 100).toFixed(1) + '%';
    $('hud-hp-fill').style.background = hpFrac > 0.35 ? '#3ddc84' : '#ff5a5a';
    $('hud-hp-text').textContent = Math.ceil(me.hp) + ' / ' + me.maxhp;
    $('hud-xp-fill').style.width = (100 * me.xp / me.xpNeed).toFixed(1) + '%';
    $('hud-level').textContent = 'LV ' + me.level;
    $('hud-wave').textContent = 'WAVE ' + Math.max(1, world.wave);
    const left = world.enemies.length + world.spawnQueue.length;
    $('hud-foes').textContent = left + ' left';
    $('hud-score').textContent = me.score + ' pts';
    const c = Sim.CLASSES[me.cls];
    $('hud-spc').textContent = c.spcName + (me.spcCd > 0 ? ' (' + me.spcCd.toFixed(0) + 's)' : ' ready');
    $('hud-spc').classList.toggle('cool', me.spcCd > 0);
    if (role !== 'solo') {
      $('hud-players').textContent = world.players.length + ' players';
    }
  }

  function gameOver() {
    cancelAnimationFrame(rafId);
    $('go-stats').innerHTML =
      'Wave reached: <b>' + world.wave + '</b><br>' +
      'Score: <b>' + me.score + '</b> · Kills: <b>' + me.kills + '</b> · Level: <b>' + me.level + '</b>';
    $('gameover').classList.remove('hidden');
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
      me.chatMsg = text; me.chatT = 4;
      net.broadcast({ t: 'chat', id: myPid, text });
      chatLog(me.name + ': ' + text);
    } else if (role === 'guest') {
      net.chat(text);
    }
  }

  /* ---------------------------------------------------------- input */
  function wireInput() {
    const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyJ', 'KeyZ', 'KeyK', 'KeyX', 'KeyT'];
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
        case 'ArrowUp': case 'KeyW': case 'Space': edgeJ = true; break;
        case 'KeyJ': case 'KeyZ': edgeAtk = true; break;
        case 'KeyK': case 'KeyX': edgeSpc = true; break;
        case 'KeyT': if (role !== 'solo') $('chatinput').focus(); break;
      }
    });
    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': held.l = false; break;
        case 'ArrowRight': case 'KeyD': held.r = false; break;
      }
    });
    window.addEventListener('blur', () => { held.l = held.r = false; touch.l = touch.r = false; });

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
    $('tc-jump').addEventListener('pointerdown', (e) => { e.preventDefault(); edgeJ = true; });
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
