/* ============================================================
   配置文件 · 牌堆 · 效果解释器
   用例前缀 TC-CFG
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');

/* ---------------- 配置装载 ---------------- */

test('TC-CFG-01 配置里的键与代码变量一一对应', () => {
  const env = F.boot();
  const raw = env.CONFIG;
  assert.ok(raw, 'CONFIG 未注入');

  const pairs = [
    ['cfg', 'CFG'], ['era', 'ERA'], ['regions', 'REGIONS'], ['items', 'ITEMS'],
    ['itemKeys', 'ITEM_KEYS'], ['chars', 'CHARS'], ['diff', 'DIFF'],
    ['rings', 'RINGS'], ['trackPattern', 'TRACK_PATTERN'], ['scenic', 'SCENIC'],
    ['events', 'EVENTS'], ['chance', 'CHANCE'], ['fate', 'FATE'],
  ];
  pairs.forEach(([key, varName]) => {
    assert.ok(raw[key] !== undefined, `config.json 缺少 ${key}`);
    const v = env.eval(varName);
    assert.ok(v !== undefined, `代码里没有 ${varName}`);
    const same = Array.isArray(v)
      ? Array.isArray(raw[key]) && v.length === raw[key].length
      : typeof v === 'object' && v !== null && Object.keys(v).length === Object.keys(raw[key]).length;
    assert.ok(same, `${varName} 与 config.${key} 规模不一致`);
  });
});

test('TC-CFG-02 关键数值参数齐全，且都是数字', () => {
  const env = F.boot();
  ['passGo', 'passGoRate', 'tollCap', 'mgmtRate', 'upRate',
   'sellRate', 'loanRate', 'loanCap', 'loanStep', 'inheritRate', 'deckSize',
  ].forEach(k => {
    assert.ok(env.CFG[k] !== undefined, `CFG.${k} 缺失`);
    assert.equal(typeof env.CFG[k], 'number', `CFG.${k} 不是数字`);
  });
  assert.equal(env.CFG.chapters.length, 4);
  assert.equal(env.CFG.chapters.reduce((a, b) => a + b, 0), 204);
});

test('TC-CFG-03 四环各有 16 个地块，区域都能在 REGIONS 里找到', () => {
  const env = F.boot();
  assert.equal(env.RINGS.length, 4);
  env.RINGS.forEach((ring, i) => {
    assert.equal(ring.plots.length, 16, `第 ${i} 环地块数不对`);
    ring.plots.forEach(p => {
      assert.ok(env.REGIONS[p.r], `第 ${i} 环地块 ${p.n} 的区域 ${p.r} 未定义`);
      assert.ok(p.b > 0 && p.mx > 0, `${p.n} 的价格或上限非法`);
    });
  });
});

/* ---------------- 效果 DSL ---------------- */

const KNOWN_OPS = new Set([
  'cash', 'debt', 'flag', 'revalue', 'upgrade', 'buyPlot', 'heat', 'jail',
  'policy', 'clearPolicy', 'stock', 'boost', 'repair', 'discount', 'forceSell',
  'cashToPoorest', 'raiseCap', 'freezeBuy', 'freezeRegion', 'stall',
]);

test('TC-CFG-04 每张卡的效果都用解释器认识的 op', () => {
  const env = F.boot();
  [...env.CHANCE, ...env.FATE].forEach(card => {
    assert.ok(Array.isArray(card.fx) && card.fx.length, `${card.t} 没有 fx`);
    card.fx.forEach(f => {
      assert.ok(KNOWN_OPS.has(f.op), `${card.t} 用了未知 op: ${f.op}`);
    });
  });
});

test('TC-CFG-05 每条事件的效果也用已知 op（政策类除外）', () => {
  const env = F.boot();
  env.EVENTS.filter(e => !e.policy).forEach(e => {
    assert.ok(Array.isArray(e.fx) && e.fx.length, `事件 ${e.key} 没有 fx`);
    e.fx.forEach(f => assert.ok(KNOWN_OPS.has(f.op), `事件 ${e.key} 用了未知 op: ${f.op}`));
  });
});

test('TC-CFG-06 所有 op 都能真正跑起来，不会抛错', () => {
  const env = F.boot();
  const p = env.state.players[0];
  const c = env.curCells().find(x => x.t === 'plot');
  c.owner = p; c.lv = 1; c.unlocked = true;

  const samples = [
    { op: 'cash', v: 10 }, { op: 'cash', kind: 'perPlot', v: 5 },
    { op: 'cash', kind: 'perLevel', v: 2 }, { op: 'cash', kind: 'plotValuePct', v: -0.01 },
    { op: 'cash', kind: 'perEmptyPlot', v: -3 },
    { op: 'debt', v: 20 }, { op: 'flag', key: 'risk', v: 1 },
    { op: 'revalue', v: 1.05 }, { op: 'upgrade' }, { op: 'buyPlot', discount: 0.7 },
    { op: 'heat', v: 5 }, { op: 'heat', target: 'curRandom', v: -5 },
    { op: 'heat', target: 'curHottest', n: 2, v: 3 },
    { op: 'jail' }, { op: 'policy', key: 'limitBuy', months: 3 },
    { op: 'clearPolicy', key: 'limitBuy' }, { op: 'stock', mult: 0.9 },
    { op: 'boost', pick: 'first', v: -2 }, { op: 'repair' },
    { op: 'discount', pick: 'first', v: 0.8 }, { op: 'forceSell' },
    { op: 'cashToPoorest', v: 10 }, { op: 'raiseCap', regions: ['城东'] },
    { op: 'freezeBuy', months: 1 }, { op: 'freezeRegion', region: '城东', months: 2 },
    { op: 'stall' },
  ];
  samples.forEach(f => {
    assert.doesNotThrow(() => env.runOp(f, p), `op ${f.op} 抛错`);
  });
});

test('TC-CFG-07 现金类 op 的金额算法正确', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1000; p.debt = 0;

  // 每块地 × 8
  const cells = env.curCells().filter(c => c.t === 'plot').slice(0, 3);
  cells.forEach(c => { c.owner = p; c.lv = 1; c.unlocked = true; });
  env.runOp({ op: 'cash', kind: 'perPlot', v: 8 }, p);
  assert.equal(p.cash, 1024);

  // 每级 × 5，限定区域：只有同区域的地块计入
  p.cash = 1000;
  const sameRegion = cells.filter(c => c.region === cells[0].region);
  env.runOp({ op: 'cash', kind: 'perLevel', regions: [cells[0].region], v: 5 }, p);
  assert.equal(p.cash, 1000 + sameRegion.length * 5, '只有同区域的地块计入');

  // 地块价值的百分比
  p.cash = 1000;
  const total = cells.reduce((s, c) => s + env.value(c), 0);
  env.runOp({ op: 'cash', kind: 'plotValuePct', v: -0.02 }, p);
  assert.equal(p.cash, 1000 - Math.round(total * 0.02));
});

/* ---------------- 牌堆 ---------------- */

test('TC-CFG-08 牌堆上限 25 张：卡池超过就抽样，不足就全用', () => {
  const env = F.boot();
  assert.ok(env.FATE.length > 25, `命运卡池应超过 25 张，实际 ${env.FATE.length}`);
  assert.ok(env.CHANCE.length >= 25, `机会卡池至少 25 张，实际 ${env.CHANCE.length}`);

  env.newGame('hang', 'normal', 0);
  assert.equal(env.state.deck.chance.length, Math.min(25, env.CHANCE.length));
  assert.equal(env.state.deck.fate.length, 25, '命运卡池超过 25，牌堆取 25');
});

test('TC-CFG-09 牌堆内不重复，且都来自卡池', () => {
  const env = F.boot();
  env.newGame('hang', 'normal', 0);
  [['chance', env.CHANCE], ['fate', env.FATE]].forEach(([kind, pool]) => {
    const deck = env.state.deck[kind];
    const titles = deck.map(c => c.t);
    assert.equal(new Set(titles).size, titles.length, `${kind} 牌堆有重复卡`);
    const poolTitles = new Set(pool.map(c => c.t));
    titles.forEach(t => assert.ok(poolTitles.has(t), `${kind} 牌堆出现卡池外的卡：${t}`));
  });
});

test('TC-CFG-10 两局抽到的命运牌堆不同（抽样生效）', () => {
  const env = F.boot();
  const seen = new Set();
  for (let i = 0; i < 8; i++){
    env.newGame('hang', 'normal', 0);
    seen.add(env.state.deck.fate.map(c => c.t).sort().join('|'));
  }
  assert.ok(seen.size > 1, '八局抽出的命运牌堆完全一样，抽样没生效');
});

test('TC-CFG-11 牌堆抽空后自动重洗，不会抽到 undefined', () => {
  const env = F.boot();
  env.newGame('hang', 'normal', 0);
  env.state.deck.chance = [env.CHANCE[0]];
  const first = env.drawFromDeck('chance', env.CHANCE);
  assert.equal(first.t, env.CHANCE[0].t);
  const second = env.drawFromDeck('chance', env.CHANCE);   // 空了，重洗
  assert.ok(second && second.t, '重洗后应能继续抽');
});

test('TC-CFG-12 牌堆写进存档，读档后保持一致', () => {
  const env = F.boot();
  env.newGame('hang', 'normal', 0);
  const before = env.state.deck.chance.map(c => c.t).sort().join('|');
  const payload = env.serialize();
  assert.equal(payload.deck.chance.length, 25, '存档里应带牌堆');

  env.newGame('hang', 'normal', 0);          // 重开一局，牌堆被洗掉
  env.restore(payload);
  assert.equal(env.state.deck.chance.map(c => c.t).sort().join('|'), before, '读档后牌堆应还原');
});
