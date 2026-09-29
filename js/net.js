/* Stickhaven — player-hosted multiplayer over WebRTC (PeerJS).
   The HOST's browser is the server: it runs the sim and broadcasts snapshots.
   Guests send inputs + chat. No dedicated game server involved. */
'use strict';

const Net = (() => {
  const PREFIX = 'stickhaven-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function makeCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }

  function peerJsReady() { return typeof Peer !== 'undefined'; }

  /* ------------------------------------------------------------------ */
  /* HOST                                                               */
  /* ------------------------------------------------------------------ */
  function hostGame(code, hostName, events) {
    const peer = new Peer(PREFIX + code);
    const guests = new Map();   // peerId -> { conn, pid, name }
    let pidSeq = 1;
    const lobby = [];           // {pid, name, isHost}

    lobby.push({ pid: 'p0', name: hostName, isHost: true });

    peer.on('open', () => events.onReady && events.onReady(code));

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        // wait for hello
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello') {
          const pid = 'p' + (pidSeq++);
          guests.set(conn.peer, { conn, pid, name: String(msg.name || 'Guest').slice(0, 14) });
          lobby.push({ pid, name: guests.get(conn.peer).name, isHost: false });
          broadcastLobby();
          events.onLobby && events.onLobby(lobby.slice());
        } else if (msg.t === 'in') {
          const g = guests.get(conn.peer);
          if (g) events.onInput && events.onInput(g.pid, msg.keys);
        } else if (msg.t === 'act') {
          const g = guests.get(conn.peer);
          if (g) events.onAct && events.onAct(g.pid, msg);
        } else if (msg.t === 'chat') {
          const g = guests.get(conn.peer);
          if (g) events.onChat && events.onChat(g.pid, String(msg.text || '').slice(0, 120));
        }
      });
      const drop = () => {
        const g = guests.get(conn.peer);
        if (!g) return;
        guests.delete(conn.peer);
        const i = lobby.findIndex(x => x.pid === g.pid);
        if (i >= 0) lobby.splice(i, 1);
        events.onPeerLeft && events.onPeerLeft(g.pid);
        broadcastLobby();
        events.onLobby && events.onLobby(lobby.slice());
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });

    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'unavailable-id') {
        events.onError && events.onError('That room code is taken — try hosting again for a fresh code.');
      } else if (type === 'peer-unavailable') {
        // not expected for host
      } else {
        events.onError && events.onError('Connection error: ' + type);
      }
    });

    function broadcastLobby() {
      const msg = { t: 'lobby', players: lobby.slice(), code };
      for (const g of guests.values()) {
        try { g.conn.send(msg); } catch (e) {}
      }
    }

    return {
      role: 'host',
      code,
      peer,
      lobby: () => lobby.slice(),
      guests,
      pidFor: (peerId) => { const g = guests.get(peerId); return g && g.pid; },
      broadcast(obj) {
        for (const g of guests.values()) {
          try { g.conn.send(obj); } catch (e) {}
        }
      },
      broadcastLobby,
      start() {
        for (const g of guests.values()) {
          try { g.conn.send({ t: 'start', you: g.pid }); } catch (e) {}
        }
      },
      destroy() {
        try { peer.destroy(); } catch (e) {}
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* GUEST                                                              */
  /* ------------------------------------------------------------------ */
  function joinGame(code, name, events) {
    code = String(code || '').trim().toUpperCase();
    const peer = new Peer();
    let conn = null;
    let helloSent = false;

    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => {
        conn.send({ t: 'hello', name });
        helloSent = true;
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'lobby') events.onLobby && events.onLobby(msg.players, msg.code);
        else if (msg.t === 'start') events.onStart && events.onStart(msg.you);
        else if (msg.t === 'snap') events.onSnapshot && events.onSnapshot(msg.snap);
        else if (msg.t === 'chat') events.onChat && events.onChat(msg.id, msg.text);
      });
      conn.on('close', () => events.onHostLeft && events.onHostLeft());
      conn.on('error', () => events.onHostLeft && events.onHostLeft());
    });

    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        events.onError && events.onError('Room not found — check the code and try again.');
      } else {
        events.onError && events.onError('Connection error: ' + type);
      }
    });

    // safety: if hello never goes out, bail
    setTimeout(() => {
      if (!helloSent && !conn) events.onError && events.onError('Could not reach the network. Check your connection.');
    }, 12000);

    return {
      role: 'guest',
      code,
      send(obj) { try { conn && conn.send(obj); } catch (e) {} },
      chat(text) { this.send({ t: 'chat', text }); },
      destroy() { try { peer.destroy(); } catch (e) {} },
    };
  }

  return { makeCode, peerJsReady, hostGame, joinGame };
})();
