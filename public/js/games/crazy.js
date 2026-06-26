import trivia from './trivia.js';
import drawguess from './drawguess.js';

// Crazy Mode renders whichever sub-game the current round needs. The server's
// view.game carries a `mode` ('trivia' | 'draw') plus all the fields that the
// matching sub-renderer already expects, so we just delegate to it.
let root = null;
let api = null;
let currentMode = null;
let current = null;

function teardown() {
  if (current && current.unmount) {
    try { current.unmount(); } catch { /* ignore */ }
  }
  current = null;
  currentMode = null;
}

export default {
  id: 'crazy',

  mount(r, a) {
    root = r;
    api = a;
    currentMode = null;
    current = null;
    root.innerHTML = '';
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    if (g.mode !== currentMode) {
      teardown();
      currentMode = g.mode;
      current = g.mode === 'draw' ? drawguess : trivia;
      root.innerHTML = '';
      if (current.mount) current.mount(root, api);
    }
    if (current && current.update) current.update(view, api);
  },

  unmount() {
    teardown();
    root = null;
  },
};
