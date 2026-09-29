/* Stickhaven — canvas renderer. Original stick-figure art drawn in code. */
'use strict';

const Render = (() => {

  function draw(ctx, world, view) {
    const { W, H, camX, camY } = view;
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    drawSky(ctx, W, H, camX);
    ctx.translate(-camX, -camY);

    drawPlatforms(ctx);
    drawGround(ctx);

    for (const pk of world.pickups) drawPickup(ctx, pk, world.time);
    for (const e of world.enemies) drawEnemy(ctx, e);
    for (const p of world.players) drawPlayer(ctx, p, world);
    for (const pr of world.projs) drawProj(ctx, pr);
    for (const pt of world.parts) {
      ctx.globalAlpha = Math.max(0, pt.t / pt.maxT);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    for (const ft of world.floatTexts) {
      ctx.globalAlpha = Math.min(1, ft.t);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.txt, ft.x, ft.y);
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
    // stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const sx = ((i * 173.3) % 3000 - camX * 0.08) % 3000;
      const sy = (i * 97.7) % (H * 0.6);
      const x = ((sx % W) + W) % W;
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(i * 7.3));
      ctx.fillRect(x, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    // moon
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath();
    ctx.arc(W - 110 - camX * 0.05, 90, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8d4bd';
    ctx.beginPath();
    ctx.arc(W - 122 - camX * 0.05, 82, 8, 0, Math.PI * 2);
    ctx.arc(W - 100 - camX * 0.05, 100, 5, 0, Math.PI * 2);
    ctx.fill();
    // far hills (parallax)
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

  function drawPlatforms(ctx) {
    for (const pl of Sim.PLATFORMS) {
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
    const c = Sim.CLASSES[p.cls] || Sim.CLASSES.brawler;
    const f = p.face;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.hurtT > 0 && Math.floor(world.time * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    const dead = p.dead;
    const bodyC = dead ? '#6b7280' : '#eef1f6';
    const walk = p.moving ? Math.sin(p.animT * 2.2) : 0;
    const swing = p.atkCd > (c.atkCd - 0.2);

    // legs (angles in screen space; y down)
    const hipY = -22;
    limb(ctx, 0, hipY, Math.PI / 2 + walk * 0.55 * f, 24, 5, bodyC);
    limb(ctx, 0, hipY, Math.PI / 2 - walk * 0.55 * f, 24, 5, bodyC);
    // body
    limb(ctx, 0, hipY, -Math.PI / 2, 26, 6, bodyC);
    // back arm
    limb(ctx, 0, -40, Math.PI / 2 + 0.5 * f - walk * 0.3 * f, 20, 4, bodyC);
    // front arm (attack pose)
    if (c.atk === 'melee' && swing) {
      limb(ctx, 0, -40, -0.5 * f, 30, 5, bodyC);       // extended swing
      // fist spark
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(Math.cos(-0.5 * f) * 30, -40 + Math.sin(-0.5 * f) * 30, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (c.atk === 'ranged' && p.atkCd > c.atkCd - 0.22) {
      limb(ctx, 0, -40, 0 * f, 26, 4, bodyC);            // aim forward
      if (p.cls === 'archer') {                          // bow arc
        ctx.strokeStyle = '#8a6b3f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(26 * f, -40, 12, -1.2, 1.2);
        ctx.stroke();
      }
    } else {
      limb(ctx, 0, -40, Math.PI / 2 - 0.6 * f + walk * 0.3 * f, 20, 4, bodyC);
    }
    // head
    ctx.fillStyle = dead ? '#6b7280' : '#f4f6fa';
    ctx.beginPath();
    ctx.arc(2 * f, -56, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#20242e';
    ctx.beginPath();
    ctx.arc(2 * f + 4 * f, -58, 1.8, 0, Math.PI * 2);
    ctx.fill();
    // class hat (the signature!)
    drawHat(ctx, p.cls, c.color, f);

    ctx.restore();

    // name + hp (untranslated already? no — we're still in world space)
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.textAlign = 'center';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = p.isLocal ? '#7dff9a' : '#ffffff';
    ctx.fillText(p.name, 0, -84);
    if (p.chatT > 0 && p.chatMsg) {
      ctx.font = '13px system-ui, sans-serif';
      const w = ctx.measureText(p.chatMsg).width + 16;
      ctx.fillStyle = 'rgba(10,14,28,0.9)';
      roundRect(ctx, -w / 2, -128, w, 24, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.chatMsg, 0, -111);
    }
    // hp bar
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-26, -80, 52, 6);
    ctx.fillStyle = p.hp / p.maxhp > 0.35 ? '#3ddc84' : '#ff5a5a';
    ctx.fillRect(-26, -80, 52 * Math.max(0, p.hp / p.maxhp), 6);
    // level badge
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
      ctx.fillText('respawning…', 0, 0);
      ctx.restore();
    }
  }

  function drawHat(ctx, cls, color, f) {
    const hx = 2 * f, hy = -56;
    if (cls === 'brawler') {
      // headband with tails
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(hx, hy, 11, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx - 10, hy - 4);
      ctx.quadraticCurveTo(hx - 22, hy + 2, hx - 26, hy + 12);
      ctx.moveTo(hx - 10, hy - 4);
      ctx.quadraticCurveTo(hx - 20, hy + 8, hx - 20, hy + 16);
      ctx.stroke();
    } else if (cls === 'archer') {
      // hood
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hx, hy, 13, Math.PI * 0.9, Math.PI * 2.1);
      ctx.lineTo(hx + 14 * f, hy + 10);
      ctx.closePath();
      ctx.fill();
    } else {
      // pointy mage hat
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(hx - 11, hy - 6);
      ctx.lineTo(hx + 2 * f, hy - 34);
      ctx.lineTo(hx + 12, hy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe27d';
      ctx.beginPath();
      ctx.arc(hx + 2 * f, hy - 34, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
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
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.type === 'blob' || e.type === 'spitter') {
      const wob = 1 + Math.sin(e.animT * 2) * 0.08;
      const w = e.w * wob, h = e.h / wob;
      ctx.fillStyle = flash ? '#ffffff' : (e.type === 'blob' ? '#46c96e' : '#3ec6c6');
      ctx.beginPath();
      ctx.ellipse(0, -h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // eyes
      ctx.fillStyle = '#10231a';
      ctx.beginPath();
      ctx.arc(-8 * e.face + 4 * e.face, -h / 2 - 4, 3.4, 0, Math.PI * 2);
      ctx.arc(6 * e.face + 4 * e.face, -h / 2 - 4, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-8 * e.face + 4 * e.face + 1, -h / 2 - 5, 1.2, 0, Math.PI * 2);
      ctx.arc(6 * e.face + 4 * e.face + 1, -h / 2 - 5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      if (e.type === 'spitter') {  // snout
        ctx.fillStyle = flash ? '#ffffff' : '#2aa3a3';
        ctx.fillRect(4 * e.face + (e.face > 0 ? 8 : -20), -h / 2 - 2, 12, 8);
      }
    } else if (e.type === 'skitter') {
      ctx.strokeStyle = flash ? '#ffffff' : '#c94f46';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const ph = Math.sin(e.animT * 4 + i * 2.1) * 6;
        ctx.beginPath();
        ctx.moveTo(-8 + i * 8, -12);
        ctx.lineTo(-12 + i * 8, -2 + ph * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-8 + i * 8, -12);
        ctx.lineTo(-4 + i * 8, -2 - ph * 0.3);
        ctx.stroke();
      }
      ctx.fillStyle = flash ? '#ffffff' : '#e06a5a';
      ctx.beginPath();
      ctx.ellipse(0, -16, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d0f0c';
      ctx.beginPath();
      ctx.arc(8 * e.face, -18, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'brute') {
      const bc = flash ? '#ffffff' : '#8d93a8';
      ctx.strokeStyle = bc;
      ctx.lineCap = 'round';
      const sway = Math.sin(e.animT) * 0.08;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(-14, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, -30); ctx.lineTo(14, -4); ctx.stroke();
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(0, -30); ctx.stroke();
      ctx.lineWidth = 9;
      const armSwing = e.atkT < 2.6 ? -1.2 : 0.5 + sway;
      ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(30 * e.face, -58 + armSwing * 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(-24 * e.face, -44); ctx.stroke();
      ctx.fillStyle = flash ? '#ffffff' : '#aab0c4';
      ctx.beginPath(); ctx.arc(0, -76, 14, 0, Math.PI * 2); ctx.fill();
      // angry eyes
      ctx.strokeStyle = '#c62f3d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-8 + 4 * e.face, -80); ctx.lineTo(-1 + 4 * e.face, -76);
      ctx.moveTo(8 + 4 * e.face, -80); ctx.lineTo(1 + 4 * e.face, -76);
      ctx.stroke();
    }
    ctx.restore();
    // hp bar for tough enemies
    if ((e.type === 'brute' || e.type === 'spitter') && e.hp < e.maxhp) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.x - 30, e.y - e.h - 16, 60, 6);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(e.x - 30, e.y - e.h - 16, 60 * Math.max(0, e.hp / e.maxhp), 6);
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
    } else if (pr.kind === 'bolt') {
      ctx.fillStyle = '#5aa8ff';
      ctx.shadowColor = '#5aa8ff'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#cfe6ff';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else { // glob
      ctx.fillStyle = '#7dff5a';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b6ff9a';
      ctx.beginPath(); ctx.arc(-2, -2, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPickup(ctx, pk, t) {
    const bob = Math.sin(t * 4 + pk.id) * 5;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    if (pk.kind === 'xp') {
      ctx.fillStyle = '#37e0d8';
      ctx.shadowColor = '#37e0d8'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
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
