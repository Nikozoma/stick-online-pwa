/* Stickhaven — orientation/fullscreen lifecycle.
   Portrait  -> blocking gate: "turn phone sideways"
   Landscape -> fullscreen + landscape lock
   Back to portrait -> exit fullscreen, gate returns
   Only active in a phone browser tab; bypassed in the installed PWA and on desktop.
   Same pattern as Void Wars / Blade Box Arena. */
'use strict';

const Lifecycle = (() => {
  const ORIENT = {
    state: 'bypass',   // bypass | gate | active | interrupt
    entered: false,    // true once landscape play has started
    get blocked() { return this.state === 'gate' || this.state === 'interrupt'; },
  };

  let gateEl, gateTitle, gateBody, gateHelp;
  let onBlockChange = null;   // fn(blocked:boolean)

  function init(els, callbacks) {
    gateEl = els.gate; gateTitle = els.gateTitle; gateBody = els.gateBody; gateHelp = els.gateHelp;
    onBlockChange = (callbacks && callbacks.onBlockChange) || null;

    refresh('start');
    window.addEventListener('orientationchange', () => {
      refresh('orientationchange');
      setTimeout(() => refresh('orientation-settled'), 120);
    });
    document.addEventListener('fullscreenchange', () => refresh('fullscreenchange'));
    // fullscreen retry needs a user gesture — any tap while landscape re-attempts it
    document.addEventListener('pointerdown', () => {
      if (ORIENT.state === 'active' && eligible() && !isPortrait() && !document.fullscreenElement) {
        enterFullscreen();
      }
    });
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', () => refresh('viewport'));
    }
  }

  function isStandalone() {
    try {
      return matchMedia('(display-mode: standalone)').matches ||
             matchMedia('(display-mode: fullscreen)').matches ||
             navigator.standalone === true;
    } catch (e) { return false; }
  }
  function isPhone() {
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    let coarse = false;
    try { coarse = matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return shortSide <= 560 && (coarse || (navigator.maxTouchPoints || 0) > 0);
  }
  function eligible() { return !isStandalone() && isPhone(); }
  function isPortrait() { return window.innerHeight > window.innerWidth; }

  async function lockLandscape() {
    try { await screen.orientation.lock('landscape'); }
    catch (e) { /* fullscreen precondition or platform policy */ }
  }
  async function enterFullscreen() {
    if (document.fullscreenElement) { lockLandscape(); return; }
    const t = document.documentElement;
    if (!t.requestFullscreen || document.fullscreenEnabled === false) { lockLandscape(); return; }
    try { await t.requestFullscreen({ navigationUI: 'hide' }); }
    catch (e) { /* no gesture yet — retry on next tap */ }
    lockLandscape();
  }
  async function exitFullscreen() {
    try { screen.orientation.unlock(); } catch (e) {}
    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch (e) {}
    }
  }

  function setGate(title, body, help) {
    gateTitle.textContent = title;
    gateBody.textContent = body;
    gateHelp.textContent = help;
  }

  function refresh(reason) {
    if (!eligible()) {
      if (ORIENT.state !== 'bypass') {
        ORIENT.state = 'bypass';
        ORIENT.entered = false;
        gateEl.classList.add('hidden');
        if (onBlockChange) onBlockChange(false);
      }
      return;
    }
    if (isPortrait()) {
      const was = ORIENT.state;
      ORIENT.state = ORIENT.entered ? 'interrupt' : 'gate';
      if (ORIENT.state === 'interrupt') {
        setGate('PAUSED', 'Landscape gameplay is paused.', 'Turn your phone sideways to continue.');
      } else {
        setGate('TURN PHONE SIDEWAYS', 'Stickhaven is built for landscape play.', 'Turn your phone sideways to play.');
      }
      gateEl.classList.remove('hidden');
      exitFullscreen();
      if (was !== ORIENT.state && onBlockChange) onBlockChange(true);
      return;
    }
    // landscape — game on
    const was = ORIENT.state;
    ORIENT.entered = true;
    ORIENT.state = 'active';
    gateEl.classList.add('hidden');
    enterFullscreen();
    if (was !== 'active' && onBlockChange) onBlockChange(false);
  }

  return { init, refresh, get blocked() { return ORIENT.blocked; } };
})();
