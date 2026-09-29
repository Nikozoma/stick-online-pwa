/* Stickhaven — canvas renderer. Original stick-figure art drawn in code. */
'use strict';

const Render = (() => {
  let T = 0; // world time for animation

  function draw(ctx, world, view) {
    const { W, H, camX, camY } = view;
    T = world.time;
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    drawSky(ctx, W, H, camX);
    ctx.translate(-camX, -camY);

    drawPlatforms(ctx, world);
    drawGround(ctx);

    for (const pk of world.pickups) drawPickup(ctx, pk);
    for (const e of world.mobs) drawEnemy(ctx, e);
    for (const p of world.players) drawPlayer(ctx, p, world);
    for (const pr of world.projectiles) drawProj(ctx, pr);
    for (const pt of world.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ------------------------------------------------------------ background
  function drawSky(ctx, W, H, camX) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1026');
    g.addColorStop(0.65, '#141b3d');
    g.addColorStop(1, '#1d2547');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const sx = ((i * 173.3) % 3000 - camX * 0.08) % 3000;
      const sy = (i * 97.7) % (H * 0.6);
      const x = ((sx % W) + W) % W;
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(i * 7.3));
      ctx.fillRect(x, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath();
    ctx.arc(W - 110 - camX * 0.05, 90, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8d4bd';
    ctx.beginPath();
    ctx.arc(W - 122 - camX * 0.05, 82, 8, 0, Math.PI * 2);
    ctx.arc(W - 100 - camX * 0.05, 100, 5, 0, Math.PI * 2);
    ctx.fill();
    hillLayer(ctx, W, H, camX, 0.18, '#1a2148', 0.62, 60);
    hillLayer(ctx, W, H, camX, 0.35, '#232c5c', 0.72, 90);
  }

  function hillLayer(ctx, W, H, camX, par, color, baseY, amp) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const off = camX * par;
    for (let x = 0; x <= W; x += 24) {
      const wx = x + off;
      const y = H * baseY - Math.abs(Math.sin(wx * 0.004)) * amp - Math.sin(wx * 0.013) * amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround(ctx) {
    const GY = Sim.GROUND_Y;
    ctx.fillStyle = '#2c3352';
    ctx.fillRect(-200, GY, Sim.WORLD_W + 400, 400);
    ctx.fillStyle = '#3ddc84';
    ctx.fillRect(-200, GY, Sim.WORLD_W + 400, 5);
    ctx.fillStyle = '#232a45';
    for (let x = 0; x < Sim.WORLD_W; x += 90) {
      ctx.fillRect(x + ((x * 7) % 40), GY + 30 + ((x * 13) % 120), 26, 8);
    }
  }

  function drawPlatforms(ctx, world) {
    for (const pl of world.platforms) {
      ctx.fillStyle = '#39415f';
      ctx.fillRect(pl.x, pl.y, pl.w, 16);
      ctx.fillStyle = '#3ddc84';
      ctx.fillRect(pl.x, pl.y, pl.w, 4);
      ctx.fillStyle = '#2a3049';
      ctx.fillRect(pl.x + 8, pl.y + 16, 14, 26);
      ctx.fillRect(pl.x + pl.w - 22, pl.y + 16, 14, 26);
    }
  }

  // ------------------------------------------------------------ stick figure
  function limb(ctx, x1, y1, ang, len, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(ang) * len, y1 + Math.sin(ang) * len);
    ctx.stroke();
  }

  function drawPlayer(ctx, p, world) {
    const f = p.dir || 1;
    const w = Sim.weaponById(p.weapon);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.hurtT > 0 && Math.floor(world.time * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    const dead = p.dead;
    const bodyC = dead ? '#6b7280' : '#eef1f6';
    const moving = Math.abs(p.vx) > 30;
    const walk = moving ? Math.sin(T * 11) * 0.55 : 0;
    const swinging = p.swingT > 0;

    // legs
    const hipY = -22;
    limb(ctx, 0, hipY, Math.PI / 2 + walk * f, 24, 5, bodyC);
    limb(ctx, 0, hipY, Math.PI / 2 - walk * f, 24, 5, bodyC);
    // body
    limb(ctx, 0, hipY, -Math.PI / 2, 26, 6, bodyC);
    // back arm
    limb(ctx, 0, -40, Math.PI / 2 + 0.5 * f - walk * 0.3 * f, 20, 4, bodyC);

    // front arm + weapon
    const hx = 2 * f, hy = -56; // head center (used below too)
    if (swinging) {
      const ext = p.swingHeavy ? 1.25 : 1;
      limb(ctx, 0, -40, -0.35 * f, 30 * ext, 5, bodyC);
      drawWeaponInHand(ctx, w, 0, -40, -0.35 * f, 30 * ext, p.swingHeavy);
      if (p.swingHeavy) {
        // motion arc
        ctx.strokeStyle = 'rgba(255,215,94,0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -40, 44 * ext, f > 0 ? -1.1 : Math.PI - 1.1, f > 0 ? 0.5 : Math.PI + 0.5);
        ctx.stroke();
      }
    } else if (w.ranged) {
      limb(ctx, 0, -40, 0, 26, 4, bodyC);
      // bow arc in hand
      ctx.strokeStyle = '#8a6b3f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(26 * f, -40, 12, -1.2, 1.2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(238,241,246,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(26 * f + Math.cos(-1.2) * 12, -40 + Math.sin(-1.2) * 12);
      ctx.lineTo(26 * f + Math.cos(1.2) * 12, -40 + Math.sin(1.2) * 12);
      ctx.stroke();
    } else {
      limb(ctx, 0, -40, Math.PI / 2 - 0.6 * f + walk * 0.3 * f, 20, 4, bodyC);
      drawWeaponInHand(ctx, w, 0, -40, Math.PI / 2 - 0.6 * f, 20, false);
    }

    // head
    ctx.fillStyle = dead ? '#6b7280' : '#f4f6fa';
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eye
    ctx.fillStyle = '#20242e';
    ctx.beginPath();
    ctx.arc(hx + 4 * f, hy - 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
    // equipped hat
    drawHatGear(ctx, p.hat, hx, hy, f);

    ctx.restore();

    // nameplate / chat / hp / level
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.textAlign = 'center';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = p.isLocal ? '#7dff9a' : '#ffffff';
    ctx.fillText(p.name, 0, -84);
    if (p.chat && world.time < p.chat.until) {
      ctx.font = '13px system-ui, sans-serif';
      const wpx = ctx.measureText(p.chat.msg).width + 16;
      ctx.fillStyle = 'rgba(10,14,28,0.9)';
      roundRect(ctx, -wpx / 2, -128, wpx, 24, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.chat.msg, 0, -111);
    }
    const mhp = Sim.maxHp(p);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-26, -80, 52, 6);
    ctx.fillStyle = p.hp / mhp > 0.35 ? '#3ddc84' : '#ff5a5a';
    ctx.fillRect(-26, -80, 52 * Math.max(0, p.hp / mhp), 6);
    ctx.fillStyle = '#0b1026';
    ctx.beginPath(); ctx.arc(30, -78, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe27d';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(String(p.level), 30, -74);
    ctx.restore();

    if (dead) {
      ctx.save();
      ctx.translate(p.x, p.y - 100);
      ctx.fillStyle = '#ff5a5a';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(world.mode === 'mp' ? 'respawning…' : 'defeated', 0, 0);
      ctx.restore();
    }
  }

  function drawWeaponInHand(ctx, w, x, y, ang, armLen, heavy) {
    const ex = x + Math.cos(ang) * armLen, ey = y + Math.sin(ang) * armLen;
    const perp = ang + Math.PI / 2;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(perp);
    const glow = w.id === 'inferno' || w.id === 'sandblade';
    if (glow) { ctx.shadowColor = w.id === 'inferno' ? '#ff7b3d' : '#ffe27d'; ctx.shadowBlur = 10; }
    switch (w.id) {
      case 'stick': case 'branch':
        ctx.strokeStyle = '#8a6b3f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -(w.id === 'branch' ? 30 : 24)); ctx.stroke();
        break;
      case 'mace':
        ctx.strokeStyle = '#7a5c33'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -20); ctx.stroke();
        ctx.fillStyle = '#9aa2b8';
        ctx.beginPath(); ctx.arc(0, -26, 7, 0, Math.PI * 2); ctx.fill();
        break;
      case 'sword': case 'greatsword': {
        const len = w.id === 'greatsword' ? 40 : 32;
        ctx.strokeStyle = '#8a6b3f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -6); ctx.stroke();
        ctx.fillStyle = '#c7cede';
        ctx.fillRect(-2.5, -6 - len, 5, len);
        ctx.beginPath(); ctx.moveTo(-2.5, -6 - len); ctx.lineTo(2.5, -6 - len); ctx.lineTo(0, -12 - len); ctx.closePath(); ctx.fill();
        break;
      }
      case 'pitchfork':
        ctx.strokeStyle = '#7a5c33'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -22); ctx.stroke();
        ctx.strokeStyle = '#c7cede'; ctx.lineWidth = 2.5;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(i * 5, -22); ctx.lineTo(i * 5, -34); ctx.stroke();
        }
        break;
      case 'inferno':
        ctx.strokeStyle = '#5c3a22'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -6); ctx.stroke();
        ctx.fillStyle = '#ff7b3d';
        ctx.fillRect(-3, -40, 6, 34);
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(-1.5, -40, 3, 34);
        break;
      case 'sandblade':
        ctx.strokeStyle = '#5c3a22'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -6); ctx.stroke();
        ctx.fillStyle = '#e8d28a';
        ctx.fillRect(-3, -42, 6, 36);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  function drawHatGear(ctx, hat, hx, hy, f) {
    ctx.save();
    if (hat === 'cap') {
      ctx.fillStyle = '#4a5a7a';
      ctx.beginPath(); ctx.arc(hx, hy - 2, 11, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - 11, hy - 6, 22, 4);
    } else if (hat === 'bunny') {
      ctx.fillStyle = '#f2f2f2';
      ctx.strokeStyle = '#20242e'; ctx.lineWidth = 1.5;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(hx + s * 6, hy - 22, 4, 12, s * 0.15, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#ffb3c7';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(hx + s * 6, hy - 22, 1.8, 8, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (hat === 'frog') {
      ctx.fillStyle = '#46c96e';
      ctx.beginPath(); ctx.arc(hx, hy - 3, 12, Math.PI, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx - 7, hy - 13, 4.5, 0, Math.PI * 2); ctx.arc(hx + 7, hy - 13, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hx - 7, hy - 14, 2, 0, Math.PI * 2); ctx.arc(hx + 7, hy - 14, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10231a';
      ctx.beginPath(); ctx.arc(hx - 7, hy - 14, 1, 0, Math.PI * 2); ctx.arc(hx + 7, hy - 14, 1, 0, Math.PI * 2); ctx.fill();
    } else if (hat === 'knight') {
      ctx.fillStyle = '#9aa2b8';
      ctx.beginPath(); ctx.arc(hx, hy - 2, 12.5, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillRect(hx - 12.5, hy - 8, 25, 5);
      ctx.fillStyle = '#20242e';
      ctx.fillRect(hx - 8, hy - 6, 16, 3);
    } else if (hat === 'wizard') {
      ctx.fillStyle = '#7a5fd0';
      ctx.beginPath();
      ctx.moveTo(hx - 11, hy - 6);
      ctx.lineTo(hx + 2 * f, hy - 34);
      ctx.lineTo(hx + 12, hy - 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe27d';
      ctx.beginPath(); ctx.arc(hx + 2 * f, hy - 34, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (hat === 'beret') {
      ctx.fillStyle = '#2f8f4e';
      ctx.beginPath();
      ctx.ellipse(hx + 2 * f, hy - 9, 13, 6, -0.18 * f, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ------------------------------------------------------------ enemies
  function drawEnemy(ctx, e) {
    const flash = e.hurtT > 0;
    const f = e.dir || 1;
    const r = e.r || 16;
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.type === 'blob' || e.type === 'gloom' || e.type === 'lurker' || e.type === 'bossblob') {
      const wob = 1 + Math.sin(T * 6 + e.id) * 0.08;
      const w = r * 2 * wob, h = r * 1.7 / wob;
      let col = '#46c96e';
      if (e.type === 'gloom') col = '#6a5fd0';
      else if (e.type === 'lurker') col = '#d8b36a';
      else if (e.type === 'bossblob') col = '#c94f6e';
      ctx.fillStyle = flash ? '#ffffff' : col;
      ctx.beginPath();
      ctx.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (e.type === 'lurker') { // spikes
        ctx.fillStyle = flash ? '#ffffff' : '#a8823f';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * (w / 5), -h + 4);
          ctx.lineTo(i * (w / 5) + 4, -h - 8);
          ctx.lineTo(i * (w / 5) + 8, -h + 4);
          ctx.closePath(); ctx.fill();
        }
      }
      if (e.type === 'bossblob') { // crown spikes
        ctx.fillStyle = flash ? '#ffffff' : '#ffe27d';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 12 - 6, -h + 6);
          ctx.lineTo(i * 12, -h - 12);
          ctx.lineTo(i * 12 + 6, -h + 6);
          ctx.closePath(); ctx.fill();
        }
      }
      // eyes
      const ey = -h / 2 - h * 0.1;
      ctx.fillStyle = '#101418';
      ctx.beginPath();
      ctx.arc(-r * 0.35 + 3 * f, ey, Math.max(2, r * 0.18), 0, Math.PI * 2);
      ctx.arc(r * 0.35 + 3 * f, ey, Math.max(2, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-r * 0.35 + 3 * f + 1, ey - 1, Math.max(1, r * 0.07), 0, Math.PI * 2);
      ctx.arc(r * 0.35 + 3 * f + 1, ey - 1, Math.max(1, r * 0.07), 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'spitter') {
      const wob = 1 + Math.sin(T * 6 + e.id) * 0.08;
      const w = r * 2 * wob, h = r * 1.7 / wob;
      ctx.fillStyle = flash ? '#ffffff' : '#3ec6c6';
      ctx.beginPath();
      ctx.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#2aa3a3'; // snout
      ctx.fillRect(f > 0 ? r * 0.7 : -r * 0.7 - 12, -h / 2 - 4, 12, 8);
      ctx.fillStyle = '#101418';
      ctx.beginPath();
      ctx.arc(3 * f, -h / 2 - 4, 3.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'skitter') {
      ctx.strokeStyle = flash ? '#ffffff' : '#c94f46';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const ph = Math.sin(T * 12 + i * 2.1 + e.id) * 6;
        ctx.beginPath(); ctx.moveTo(-8 + i * 8, -12); ctx.lineTo(-12 + i * 8, -2 + ph * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8 + i * 8, -12); ctx.lineTo(-4 + i * 8, -2 - ph * 0.3); ctx.stroke();
      }
      ctx.fillStyle = flash ? '#ffffff' : '#e06a5a';
      ctx.beginPath(); ctx.ellipse(0, -16, 15, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d0f0c';
      ctx.beginPath(); ctx.arc(8 * f, -18, 2.6, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'beetle') {
      ctx.fillStyle = flash ? '#ffffff' : '#5a4a6a';
      ctx.beginPath(); ctx.arc(0, -r, r, Math.PI, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = flash ? '#ffffff' : '#3d3247';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -r, r * 0.6, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      ctx.fillStyle = flash ? '#ffffff' : '#8a7a9a'; // horn
      ctx.beginPath();
      ctx.moveTo(-4 + 6 * f, -r * 2 + 4);
      ctx.lineTo(6 * f, -r * 2 - 10);
      ctx.lineTo(8 + 6 * f, -r * 2 + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath(); ctx.arc(6 * f, -r - 4, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'sandgolem') {
      const bc = flash ? '#ffffff' : '#b09a6a';
      ctx.strokeStyle = bc;
      ctx.lineCap = 'round';
      const sway = Math.sin(T * 2 + e.id) * 0.08;
      ctx.lineWidth = 16;
      ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(-18, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14, -40); ctx.lineTo(18, -4); ctx.stroke();
      ctx.lineWidth = 20;
      ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(0, -40); ctx.stroke();
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(38 * f, -78 + sway * 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(-30 * f, -60); ctx.stroke();
      ctx.fillStyle = flash ? '#ffffff' : '#c9b384';
      ctx.beginPath(); ctx.arc(0, -104, 18, 0, Math.PI * 2); ctx.fill();
      // rocky cracks
      ctx.strokeStyle = flash ? '#ffffff' : '#8a744f';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-8, -110); ctx.lineTo(-2, -100); ctx.lineTo(-8, -94); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -112); ctx.lineTo(10, -102); ctx.stroke();
      // angry eyes
      ctx.strokeStyle = '#c62f3d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-10 + 5 * f, -108); ctx.lineTo(-2 + 5 * f, -103);
      ctx.moveTo(10 + 5 * f, -108); ctx.lineTo(2 + 5 * f, -103);
      ctx.stroke();
    }
    ctx.restore();

    // hp bar
    const showBar = e.boss || e.hp < e.maxHp;
    if (showBar) {
      const bw = e.boss ? 110 : 56, bh = e.boss ? 8 : 6;
      const top = e.y - (e.boss === 'sandgolem' ? 132 : e.r * 2 + 14);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.x - bw / 2, top, bw, bh);
      ctx.fillStyle = e.boss ? '#ffb13d' : '#ff5a5a';
      ctx.fillRect(e.x - bw / 2, top, bw * Math.max(0, e.hp / e.maxHp), bh);
      if (e.boss) {
        ctx.fillStyle = '#ffb13d';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.boss === 'sandgolem' ? 'SAND GOLEM' : 'BOSS BLOB', e.x, top - 6);
      }
    }
  }

  function drawProj(ctx, pr) {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    if (pr.kind === 'arrow') {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.rotate(a);
      ctx.strokeStyle = '#d8b36a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.fillStyle = '#eef1f6';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(6, -4); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill();
    } else { // glob
      ctx.fillStyle = '#7dff5a';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b6ff9a';
      ctx.beginPath(); ctx.arc(-2, -2, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPickup(ctx, pk) {
    const bob = Math.sin(T * 4 + pk.id) * 5;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    if (pk.kind === 'gem') {
      ctx.fillStyle = '#37e0d8';
      ctx.shadowColor = '#37e0d8'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    } else { // heart
      ctx.fillStyle = '#ff7d9a';
      ctx.shadowColor = '#ff7d9a'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(-4, -2, 5, 0, Math.PI * 2);
      ctx.arc(4, -2, 5, 0, Math.PI * 2);
      ctx.moveTo(-8, 0); ctx.lineTo(0, 10); ctx.lineTo(8, 0);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  return { draw };
})();
