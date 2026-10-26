/* ============================================================
   地图与棋盘 · 需求 3.1 / 3.2 / 3.7 / 3.8
   用例前缀 TC-MAP
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');

test('TC-MAP-01 四环对应四章，环名与年代连续', () => {
  const env = F.boot();
  assert.equal(env.RINGS.length, 4);
  assert.equal(env.CHAPTERS.length, 4);
  env.RINGS.forEach((ring, i) => {
    assert.equal(ring.chapter, i, `第 ${i} 环的 chapter 字段应指向同序号章节`);
    assert.match(ring.years, /^\d{4} — \d{4}$/);
  });
  assert.deepEqual([...env.RINGS.map(r => r.years)], [
    '2010 — 2013', '2014 — 2017', '2018 — 2021', '2022 — 2026',
  ]);
});

test('TC-MAP-02 每环 24 格行走环 + 1 个中心监狱（V2.2 方形布局）', () => {
  const env = F.boot();
  env.RINGS.forEach((ring, i) => {
    const cells = env.state.rings[i].cells;
    assert.equal(cells.length, 25, `第 ${i} 环应为 25 个格子（24 行走 + 1 监狱）`);
    assert.equal(env.WALK_LEN, 24);
    const walk = cells.slice(0, env.WALK_LEN);
    const count = t => walk.filter(c => c.t === t).length;
    assert.equal(count('start'), 1);
    assert.equal(count('plot'), 16);
    assert.equal(walk.length - count('start') - count('plot'), 7, '环上功能格应为 7 个');
    assert.equal(cells[env.JAIL_IDX].t, 'jail', '最后一格是中心监狱');
  });
});

test('TC-MAP-03 功能格构成：机会2 命运1 道具店1 银行1 证券1 监狱1 风景区1', () => {
  const env = F.boot();
  const expected = { chance: 2, fate: 1, shop: 1, bank: 1, stock: 1, jail: 1, scenic: 1 };
  env.state.rings.forEach((ring, i) => {
    const count = t => ring.cells.filter(c => c.t === t).length;
    Object.entries(expected).forEach(([t, n]) => {
      assert.equal(count(t), n, `第 ${i} 环 ${t} 格数量`);
    });
  });
});

test('TC-MAP-04 起点固定在 idx 0 且唯一，首尾不相连', () => {
  const env = F.boot();
  env.state.rings.forEach(ring => {
    assert.equal(ring.cells[0].t, 'start');
    assert.equal(ring.cells.filter(c => c.t === 'start').length, 1);
    // 首尾隔断：idx 25 与 idx 1 不是邻居
    const first = ring.cells[1];
    const last = ring.cells[ring.cells.length - 1];
    assert.ok(!env.neighbors(first).includes(last), 'idx 1 不应把最后一格当作邻居');
    assert.ok(!env.neighbors(last).includes(first), '最后一格不应把 idx 1 当作邻居');
  });
});

test('TC-MAP-05 地价 = 楼面价 ÷ 40（万元）', () => {
  const env = F.boot();
  env.state.rings.forEach(ring => {
    ring.cells.filter(c => c.t === 'plot').forEach(c => {
      assert.equal(c.price, Math.round(c.base / 40), `${c.name} 地价换算`);
    });
  });
});

test('TC-MAP-06 新开地块为 Lv0 空地、无主、未烂尾、无折扣', () => {
  const env = F.boot();
  env.state.rings.forEach(ring => {
    ring.cells.filter(c => c.t === 'plot').forEach(c => {
      assert.equal(c.lv, 0);
      assert.equal(c.owner, null);
      assert.equal(c.broken, false);
      assert.equal(c.discount, 1);
      assert.equal(c.boost, 0);
      assert.equal(c.boughtAt, -99);
    });
  });
});

test('TC-MAP-07 地块解锁：unlock 为 0 的开局即解锁，其余按月份解锁', () => {
  const env = F.boot();
  const cells = env.curCells().filter(c => c.t === 'plot');
  cells.forEach(c => {
    assert.equal(c.unlocked, c.unlock === 0, `${c.name} 初始解锁状态`);
  });
  const locked = cells.filter(c => c.unlock > 0);
  assert.ok(locked.length > 0, '第一章应存在需要解锁的地块');
});

test('TC-MAP-08 到达解锁月份后地块自动出现在棋盘上', async () => {
  const env = F.boot();
  const target = env.curCells().find(c => c.t === 'plot' && c.unlock > 0);
  env.setMonth(target.unlock - 1);
  assert.equal(target.unlocked, false);
  await env.endMonth();            // 月末推进到 unlock 当月
  assert.equal(env.state.absMonth, target.unlock);
  assert.equal(target.unlocked, true, `${target.name} 应在第 ${target.unlock} 月解锁`);
});

test('TC-MAP-09 同一环内地块名不重复', () => {
  const env = F.boot();
  env.state.rings.forEach((ring, i) => {
    const names = ring.cells.filter(c => c.t === 'plot').map(c => c.name);
    assert.equal(new Set(names).size, names.length, `第 ${i} 环存在重名地块`);
  });
});

test('TC-MAP-10 地块所属区域必须存在于区域表', () => {
  const env = F.boot();
  const regions = Object.keys(env.REGIONS);
  env.state.rings.forEach((ring, i) => {
    ring.cells.filter(c => c.t === 'plot').forEach(c => {
      assert.ok(regions.includes(c.region), `第 ${i} 环 ${c.name} 的区域 ${c.region} 未登记`);
    });
  });
});

test('TC-MAP-11 每环至少覆盖 4 个区域，保证"成片"排布', () => {
  const env = F.boot();
  env.state.rings.forEach((ring, i) => {
    const set = new Set(ring.cells.filter(c => c.t === 'plot').map(c => c.region));
    assert.ok(set.size >= 4, `第 ${i} 环只覆盖了 ${set.size} 个区域`);
  });
});

test('TC-MAP-12 风景区随章节换名，机制格位不变', () => {
  const env = F.boot();
  const expected = ['西湖风景区', '运河夜游', '亚运场馆', '良渚遗址'];
  env.state.rings.forEach((ring, i) => {
    const sc = ring.cells.find(c => c.t === 'scenic');
    assert.equal(sc.fullName, expected[i], `第 ${i} 环风景区名称`);
  });
  // 格位一致
  const idx = env.state.rings.map(r => r.cells.findIndex(c => c.t === 'scenic'));
  assert.equal(new Set(idx).size, 1, '各环风景区应位于同一格位');
});

test('TC-MAP-13 监狱每环唯一，且不是起点', () => {
  const env = F.boot();
  env.state.rings.forEach(ring => {
    const jails = ring.cells.filter(c => c.t === 'jail');
    assert.equal(jails.length, 1);
    assert.notEqual(jails[0].idx, 0);
  });
});

test('TC-MAP-14 切换到第二章后，行走环切到中环', () => {
  const env = F.boot();
  assert.equal(env.state.chapter, 0);
  env.state.over = false;
  env.nextChapter();
  assert.equal(env.state.chapter, 1);
  assert.equal(env.curCh().ring, 1);
  assert.equal(env.curCells(), env.state.rings[1].cells);
  assert.equal(env.state.absMonth, 48);
});

test('TC-MAP-15 TRACK_PATTERN 的 p0—p15 与地块数量一一对应', () => {
  const env = F.boot();
  const plots = env.TRACK_PATTERN.filter(t => t[0] === 'p');
  assert.equal(plots.length, 16);
  assert.deepEqual([...plots], Array.from({ length: 16 }, (_, i) => `p${i}`));
  env.RINGS.forEach((ring, i) => {
    assert.equal(ring.plots.length, 16, `第 ${i} 环地块配置应有 16 条`);
  });
});

test('TC-MAP-16 24 格行走环单骰一圈约 6.9 回合（节奏预算）', () => {
  const env = F.boot();
  assert.equal(env.WALK_LEN, 24);
  const laps = 24 / 3.5;   // 单骰期望 3.5
  assert.ok(laps > 6.7 && laps < 7.1, `一圈应约 6.9 回合，实际 ${laps.toFixed(2)}`);
});

test('TC-MAP-17 监狱不在行走路径上，只能靠卡牌送入（V2.2）', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  const cells = env.curCells();
  const jail = cells.findIndex(c => c.t === 'jail');
  assert.equal(jail, env.JAIL_IDX, '监狱是最后一个格子');
  assert.ok(jail >= env.WALK_LEN, '监狱下标在行走范围之外');

  // 连掷 6 点绕一整圈，落点始终在 0—23 之间，不会踩进监狱
  env.put(p, 0);
  for (let i = 0; i < 4; i++){
    p.pos = (p.pos + 6) % env.WALK_LEN;
    assert.ok(p.pos < env.WALK_LEN, `第 ${i} 步落到了监狱`);
  }
  assert.equal(p.pos, 0, '24 步（4×6）正好回到起点');
});

test('TC-MAP-18 机会卡与命运卡都能把人送进监狱', () => {
  const env = F.boot();
  const p = env.state.players[0];
  const jailCards = [...env.CHANCE, ...env.FATE].filter(c => {
    p.inJail = false; p.pos = 0;
    c.act(p);
    return p.inJail;
  });
  assert.ok(jailCards.length >= 2, `应有多张卡能触发进监狱，实际 ${jailCards.length}`);
  assert.equal(p.pos, env.JAIL_IDX, '被送进监狱后位置指到中心格');
});

test('TC-MAP-19 24 格方形环：相邻两格在网格上必须挨着', () => {
  const env = F.boot();
  for (let i = 0; i < env.WALK_LEN; i++){
    const a = env.gridOf(i), b = env.gridOf((i + 1) % env.WALK_LEN);
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    assert.equal(d, 1, `第 ${i} 格与下一格不相邻：${a} → ${b}`);
  }
  // 9×9 外圈共 24 格，每格唯一
  const seen = new Set();
  for (let i = 0; i < env.WALK_LEN; i++){
    const key = env.gridOf(i).join(',');
    assert.ok(!seen.has(key), `格子位置重复：${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, 24);
});

test('TC-MAP-20 功能格落在四角与四边中点，地块不占拐角', () => {
  const env = F.boot();
  const at = (c, r) => env.curCells().findIndex(x => {
    const g = env.gridOf(x.idx);
    return g[0] === c && g[1] === r;
  });
  // 四角
  assert.equal(env.curCells()[at(2, 2)].t, 'chance', '左上角是机会');
  assert.equal(env.curCells()[at(8, 2)].t, 'chance', '右上角是机会');
  assert.equal(env.curCells()[at(2, 8)].t, 'shop', '左下角是道具店');
  assert.equal(env.curCells()[at(8, 8)].t, 'scenic', '右下角是风景区');
  // 四边中点
  assert.equal(env.curCells()[at(5, 2)].t, 'start', '上边中点是起点');
  assert.equal(env.curCells()[at(5, 8)].t, 'stock', '下边中点是证券');
  assert.equal(env.curCells()[at(8, 5)].t, 'fate', '右边中点是命运');
  assert.equal(env.curCells()[at(2, 5)].t, 'bank', '左边中点是银行');
  // 监狱在正中心
  assert.equal(env.curCells()[env.JAIL_IDX].t, 'jail');
  assert.equal(env.gridOf(env.JAIL_IDX).join(','), '5,5', '监狱在正中心');
});

test('TC-MAP-21 每个地块都有一个外侧建筑槽，且不与任何格子重合', () => {
  const env = F.boot();
  const cellKeys = new Set();
  for (let i = 0; i < env.curCells().length; i++) cellKeys.add(env.gridOf(i).join(','));

  let slots = 0;
  env.curCells().forEach(c => {
    if (c.t !== 'plot') return;
    const slot = env.slotOf(c.idx);
    assert.ok(slot, `地块 ${c.name} 没有建筑槽`);
    assert.ok(!cellKeys.has(slot.join(',')), `建筑槽 ${slot} 与格子重叠`);
    // 槽位必须紧贴格子（曼哈顿距离 1）
    const g = env.gridOf(c.idx);
    assert.equal(Math.abs(g[0] - slot[0]) + Math.abs(g[1] - slot[1]), 1);
    slots++;
  });
  assert.equal(slots, 16, '16 个地块各一个建筑槽');
});

test('TC-MAP-22 道具店每环唯一，且落在左下角', () => {
  const env = F.boot();
  env.state.rings.forEach((ring, i) => {
    assert.equal(ring.cells[15].t, 'shop', `第 ${i} 环 15 号格应为道具店`);
    assert.equal(ring.cells[15].name, '道具店');
    assert.equal(env.gridOf(15).join(','), '2,8', '道具店在左下角');
    assert.equal(ring.cells.filter(c => c.t === 'shop').length, 1);
  });
});

test('TC-MAP-23 税务格已移除，12 号是唯一证券格', () => {
  const env = F.boot();
  env.state.rings.forEach((ring, i) => {
    assert.equal(ring.cells.filter(c => c.t === 'tax').length, 0, `第 ${i} 环不应再有税务格`);
    assert.equal(ring.cells[12].t, 'stock', `第 ${i} 环 12 号应为证券`);
    assert.equal(ring.cells.filter(c => c.t === 'stock').length, 1, '证券只保留一个');
  });
});

/* ---------------- 建筑配色跟随玩家（V2.3） ---------------- */

test('TC-MAP-24 每个角色的建筑配色都不同，且保持自己的色相', () => {
  const env = F.boot();
  const seen = new Map();
  env.CHARS.forEach(ch => {
    const sh = env.playerShades(ch.color);
    const src = env.hexToHsl(ch.color);
    // 屋顶是主色，色相必须与角色色一致
    const rf = env.hexToHsl(sh.RF);
    assert.ok(Math.abs(rf.h - src.h) < 2, `${ch.name} 屋顶色相应贴近角色色`);
    // 墙面是同一色相的浅调
    const wr = env.hexToHsl(sh.WR);
    assert.ok(wr.l > src.l + 20, `${ch.name} 受光墙应明显更浅`);
    seen.set(sh.RF, ch.name);
  });
  assert.equal(seen.size, env.CHARS.length, '每个角色的屋顶色不能撞车');
});

test('TC-MAP-25 建筑 SVG 用占位符染色，不再写死墙面色', () => {
  const env = F.boot();
  // lv1—lv5 都要有占位符，lv0（空地）不需要
  [1, 2, 3, 4, 5].forEach(lv => {
    assert.match(env.BUILDING_SVG[lv], /__WL__/, `lv${lv} 缺少左墙占位符`);
    assert.match(env.BUILDING_SVG[lv], /__WR__/, `lv${lv} 缺少右墙占位符`);
    assert.match(env.BUILDING_SVG[lv], /__RF__/, `lv${lv} 缺少屋顶占位符`);
  });
  // 染色后不应残留占位符
  const sh = env.playerShades(env.CHARS[0].color);
  [1, 2, 3, 4, 5].forEach(lv => {
    const out = env.tintSvg(env.BUILDING_SVG[lv], sh);
    assert.doesNotMatch(out, /__[A-Z0-9]+__/, `lv${lv} 染色后仍有占位符`);
    assert.match(out, /<svg/);
  });
  // 不同角色染出来的图必须不同
  const a = env.tintSvg(env.BUILDING_SVG[3], env.playerShades(env.CHARS[0].color));
  const b = env.tintSvg(env.BUILDING_SVG[3], env.playerShades(env.CHARS[2].color));
  assert.notEqual(a, b, '不同角色应得到不同配色的建筑');
});
