import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INDEX_HTML = path.join(HERE, '..', '..', 'index.html');

/**
 * Запускает настоящий index.html без браузера: скрипт игры выполняется в node:vm с заглушками
 * документа, канваса и звука. Окно 1519×784 такое же, как в docs/golden-sim.json:
 * геометрия реки зависит от размера окна.
 *
 * Внутренности игры выставляются через `__t`, который добавляет этот харнесс,
 * в самой игре никаких тестовых люков нет (кроме исторического __simProbe).
 */
export function loadGame(file = INDEX_HTML, { weekInfo = null } = {}) {
  const html = fs.readFileSync(file, 'utf8');
  const m = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find((x) => x[1].includes('__simProbe'));
  if (!m) throw new Error('скрипт игры не найден');

  let code = m[1].replace(/^\s*import .*$/gm, '');
  const end = code.lastIndexOf('})();');
  const expose = `globalThis.__t={
    reset, spawn, update, collect, hit, continueRun, finishRun, drawObj, circlesFor,
    beginRun: typeof beginRun === 'undefined' ? null : beginRun,
    get continuesLeft(){ return continuesLeft },
    get state(){ return state },
    get held(){ return held },
    get simT(){ return simT },
    setSimT(v){ simT = v },
    get FINISH_M(){ return typeof FINISH_M === 'undefined' ? null : FINISH_M },
    get level(){ return LV },
    setState(v){ state = v },
    setLevel(v){ LV = v },
    setCont(v){ continuesLeft = v; runFinalized = false },
    get G(){ return G }, get H(){ return H }, get U(){ return U },
    get SIM_DT(){ return SIM_DT },
    get STAGE(){ return typeof STAGE === 'undefined' ? null : STAGE },
    get DIFF(){ return DIFF },
    riverW, cx, place,
  };\n`;
  code = code.slice(0, end) + expose + code.slice(end);

  const proxy = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : proxy),
    set: () => true,
    apply: () => proxy,
    construct: () => proxy,
  });
  const sent = [];
  const ctx = {
    console, Math, Date, JSON, Number, Object, Array, Map, Set, Promise,
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, performance: { now: () => 0 },
    innerWidth: 1519, innerHeight: 784, devicePixelRatio: 1,
    document: proxy, matchMedia: () => ({ matches: false }), addEventListener() {}, $: () => proxy,
    Telegram: undefined, AudioContext: undefined, webkitAudioContext: undefined,
    localStorage: { getItem: () => null, setItem() {} }, navigator: {},
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.onRunEnd = (run) => sent.push(run);
  if (weekInfo) ctx.weekInfo = weekInfo;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: file });
  return { t: ctx.__t, probe: ctx.__simProbe, sent };
}

/** Один шаг симуляции: то же, что делает игровой цикл. */
export const step = (t, n = 1) => {
  for (let i = 0; i < n; i++) {
    t.spawn();
    t.update(t.SIM_DT);
  }
};

/** Метры от старта заплыва. */
export const metersOf = (t) => (t.G.k.s - t.G.k.s0) / (11 * t.U);
