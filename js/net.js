/* Stickhaven networking — WebSocket client for the dedicated server.
   One shared world: connect, join with a name, send inputs at 60Hz,
   receive authoritative snapshots at 60Hz. No lobbies, no room codes. */
'use strict';

const Net = (() => {
  function serverUrl() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'ws://127.0.0.1:8789';
    }
    return 'wss://bladeboxarena.ddns.net/sh';
  }

  function connect(name, handlers) {
    let ws;
    try {
      ws = new WebSocket(serverUrl());
    } catch (e) {
      if (handlers.onError) handlers.onError('Could not reach the server.');
      return { send() {}, close() {} };
    }
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ t: 'join', name })); } catch (e) {}
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { if (handlers.onWelcome) handlers.onWelcome(m.pid); }
      else if (m.t === 'snap') { if (handlers.onSnap) handlers.onSnap(m.snap); }
    };
    ws.onclose = () => { if (handlers.onClose) handlers.onClose(); };
    ws.onerror = () => {};
    return {
      send(obj) {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify(obj)); } catch (e) {}
        }
      },
      close() { try { ws.close(); } catch (e) {} },
    };
  }

  return { connect };
})();
