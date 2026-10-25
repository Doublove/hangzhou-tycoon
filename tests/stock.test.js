/* ============================================================
   证券 K 线 · 实时排名 · 响应式
   用例前缀 TC-STK / TC-RANK
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');

const canvas = env => env.document.querySelector('#kchart');
const text = (env, sel) => env.document.querySelector(sel).textContent;

/* ---------------- 价格历史 ---------------- */

test('TC-STK-01 开局有一条初始 K 线，开收同价', () => {
  const env = F.boot();
  assert.equal(env.state.stockHistory.length, 1);
  const bar = env.state.stockHistory[0];
  assert.equal(bar.m, 0);
  assert.equal(bar.o, 1000);
  assert.equal(bar.c, 1000);
});

test('TC-STK-02 每月末追加一条，开盘等于上月收盘', async () => {
  const env = F.boot();
  env.setRandom([0.999]);              // 接近 +4%
  await env.endMonth();
  await env.endMonth();
  const h = env.state.stockHistory;
  assert.equal(h.length, 3);
  assert.equal(h[1].o, h[0].c, '本月开盘应等于上月收盘');
  assert.equal(h[2].o, h[1].c);
  assert.equal(h[2].c, env.state.stockPrice, '收盘应等于当前指数');
  assert.equal(h[2].m, 2, '月份应记录为当前月');
});

test('TC-STK-03 价格历史最多保留 120 条', async () => {
  const env = F.boot();
  env.setRandom([0.5]);
  for (let i = 0; i < 130; i++) await env.endMonth();
  assert.equal(env.state.stockHistory.length, 120);
  assert.equal(env.state.stockHistory[119].m, env.state.absMonth);
});

test('TC-STK-04 股价有 200 点下限', async () => {
  const env = F.boot();
  env.state.stockPrice = 200;
  env.setRandom([0]);                  // 最坏情况 ×0.96
  await env.endMonth();
  assert.equal(env.state.stockPrice, 200);
});

/* ---------------- 持仓与盈亏 ---------------- */

test('TC-STK-05 买入记录月份、单价与手数', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.setMonth(7);
  env.buyStock(p, 2);
  assert.equal(p.stock, 2);
  assert.equal(p.stockLots.length, 1);
  assert.deepEqual({ ...p.stockLots[0] }, { m: 7, price: 100, lots: 2, idx: 1000 });
  assert.equal(p.cash, 4800);
});

test('TC-STK-06 持仓成本 = 各笔买入价 × 手数之和', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 1);                       // 1 手 @100
  env.state.stockPrice = 1500;
  env.buyStock(p, 2);                       // 2 手 @150
  assert.equal(env.stockCost(p), 100 + 300);
});

test('TC-STK-07 市值按每手价格算，不是按指数点位', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 3);
  assert.equal(env.stockValue(p), 3 * env.stockLot());
  assert.equal(env.stockValue(p), 300, '1000 点每手 100 万，3 手 300 万');
  assert.notEqual(env.stockValue(p), 3 * env.state.stockPrice, '不能直接乘指数点位');
});

test('TC-STK-08 盈亏与盈亏率', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 2);                       // 成本 200
  env.state.stockPrice = 1500;              // 每手 150，市值 300
  const sp = env.stockPnl(p);
  assert.equal(sp.cost, 200);
  assert.equal(sp.value, 300);
  assert.equal(sp.profit, 100);
  assert.ok(Math.abs(sp.rate - 0.5) < 1e-9, '盈亏率应为 50%');
});

test('TC-STK-09 卖出按先进先出扣减', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 1);                       // 100
  env.state.stockPrice = 2000;
  env.buyStock(p, 1);                       // 200
  env.sellStock(p, 1);                      // 卖掉最早那手
  assert.equal(p.stock, 1);
  assert.equal(p.stockLots.length, 1);
  assert.equal(p.stockLots[0].price, 200, '剩下的应是后买的那手');
});

test('TC-STK-10 卖光后持仓记录清空', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 2);
  env.sellStock(p, 2);
  assert.equal(p.stock, 0);
  assert.equal(p.stockLots.length, 0);
  assert.equal(env.stockCost(p), 0);
});

test('TC-STK-11 卖出不超过持有手数', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 1);
  const before = p.cash;
  env.sellStock(p, 5);
  assert.equal(p.stock, 0);
  assert.equal(p.cash, before + env.stockLot(), '只应卖出手上那 1 手');
});

test('TC-STK-12 旧存档没有成本记录时按现价兜底，盈亏为 0', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.stock = 2;
  p.stockLots = [];
  const sp = env.stockPnl(p);
  assert.equal(sp.cost, sp.value);
  assert.equal(sp.profit, 0);
  assert.equal(sp.rate, 0);
});

test('TC-STK-13 存档往返保留价格历史与持仓明细', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.setMonth(3);
  env.buyStock(p, 2);
  env.state.stockHistory.push({ m: 3, o: 1000, c: 1200 });
  env.saveTo(1);

  env.state.stockHistory = [];
  p.stockLots = [];
  assert.equal(env.loadFrom(1), true);
  assert.equal(p.stock, 2);
  assert.equal(p.stockLots.length, 1);
  assert.equal(p.stockLots[0].m, 3);
  assert.equal(p.stockLots[0].price, 100);
  assert.ok(env.state.stockHistory.length >= 2);
});

/* ---------------- 渲染 ---------------- */

test('TC-STK-14 K 线栏显示价格、涨跌幅、持仓、市值与盈亏', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 2);
  env.state.stockPrice = 1500;
  env.state.stockHistory = [
    { m: 0, o: 1000, c: 1000 },
    { m: 1, o: 1000, c: 1500 },
  ];
  env.renderKline();

  assert.equal(text(env, '#k-price'), '1,500');
  assert.equal(text(env, '#k-chg'), '+50.0%');
  assert.equal(text(env, '#k-hold'), '持仓 2 手');
  assert.equal(text(env, '#k-value'), '市值 300 万');
  assert.match(text(env, '#k-pnl'), /盈亏 \+100 万（\+50\.0%）/);
});

test('TC-STK-15 上涨用红、下跌用绿（A 股习惯）', () => {
  const env = F.boot();
  env.state.stockHistory = [{ m: 0, o: 1000, c: 1000 }, { m: 1, o: 1000, c: 1100 }];
  env.state.stockPrice = 1100;
  env.renderKline();
  assert.match(env.document.querySelector('#k-chg').className, /up/);

  env.state.stockHistory = [{ m: 0, o: 1000, c: 1000 }, { m: 1, o: 1000, c: 900 }];
  env.state.stockPrice = 900;
  env.renderKline();
  assert.match(env.document.querySelector('#k-chg').className, /down/);
});

test('TC-STK-16 无持仓时盈亏显示为占位符', () => {
  const env = F.boot();
  env.renderKline();
  assert.equal(text(env, '#k-pnl'), '盈亏 —');
  assert.equal(text(env, '#k-hold'), '持仓 0 手');
});

test('TC-STK-17 每根 K 线画一个实体', () => {
  const env = F.boot();
  env.state.stockHistory = [
    { m: 0, o: 1000, c: 1010 },
    { m: 1, o: 1010, c: 990 },
    { m: 2, o: 990, c: 1020 },
  ];
  env.state.stockPrice = 1020;
  const cv = canvas(env);
  cv._calls.length = 0;
  env.renderKline();
  assert.equal(cv._calls.length, 3, '三个数据点应画三个实体');
});

test('TC-STK-18 买入点在窗口内会额外标记，窗口外不标记', () => {
  const env = F.boot();
  const p = env.state.players[0];
  env.state.stockHistory = [{ m: 0, o: 1000, c: 1000 }, { m: 1, o: 1000, c: 1000 }];
  const cv = canvas(env);

  p.stockLots = [{ m: 1, price: 100, lots: 1 }];
  cv._calls.length = 0;
  env.renderKline();
  const withMark = cv._calls.length;

  p.stockLots = [{ m: 999, price: 100, lots: 1 }];   // 不在窗口里
  cv._calls.length = 0;
  env.renderKline();
  assert.equal(cv._calls.length, withMark, '窗口外的买入点不应改变实体数量');
});

test('TC-STK-19 K 线只取最近 60 个数据点', () => {
  const env = F.boot();
  env.state.stockHistory = Array.from({ length: 100 }, (_, i) => ({ m: i, o: 1000, c: 1000 + i }));
  assert.equal(env.klineWindow(60).length, 60);
  assert.equal(env.klineWindow(60)[59].m, 99);
});

/* ---------------- 实时排名 ---------------- */

test('TC-RANK-01 玩家栏按净资产从高到低排名', () => {
  const env = F.boot();
  env.state.players.forEach((p, i) => { p.cash = 1000 + i * 500; });
  env.renderHUD();
  const cards = env.document.querySelector('#players').children;
  const of = name => cards.find(c => c.innerHTML.includes(name));
  assert.equal(cards.length, 4);
  assert.match(of('阿莲').innerHTML, /prank r1/, '现金最多的阿莲应排第一');
  assert.match(of('杭铁头').innerHTML, /prank">4/, '现金最少的杭铁头应排第四');
});

test('TC-RANK-02 破产者不参与名次，显示为破折号', () => {
  const env = F.boot();
  env.state.players[1].bankrupt = true;
  env.renderHUD();
  const cards = env.document.querySelector('#players').children;
  const dead = cards.find(c => c.innerHTML.includes('温老板'));
  assert.match(dead.innerHTML, /<span class="prank">—<\/span>/);
  const alive = cards.filter(c => /prank r\d/.test(c.innerHTML));
  assert.equal(alive.length, 3, '存活三人占据 1—3 名');
});

test('TC-RANK-03 净资产变化后排名实时更新', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 100;
  env.renderHUD();
  assert.match(env.document.querySelector('#players').children.find(c => c.innerHTML.includes('杭铁头')).innerHTML, /prank">4/);

  p.cash = 99999;
  env.renderHUD();
  assert.match(env.document.querySelector('#players').children.find(c => c.innerHTML.includes('杭铁头')).innerHTML, /prank r1/);
});

test('TC-RANK-04 地块计入排名，不只看现金', () => {
  const env = F.boot();
  const poor = env.state.players[0];
  const rich = env.state.players[1];
  poor.cash = 200; rich.cash = 1000;
  env.grant(poor, env.plotByName('湖滨'), 5);   // 一块 Lv5 地值 2,000 万上下
  env.renderHUD();
  const cards = env.document.querySelector('#players').children;
  const hang = cards.find(c => c.innerHTML.includes('杭铁头'));
  assert.match(hang.innerHTML, /prank r1/, '有地的杭铁头净资产更高，应排第一');
});

/* ---------------- 回归：证券弹窗市值 ---------------- */

test('TC-STK-20 证券弹窗的市值不再放大 10 倍', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 2);
  const pr = env.askStock(p);
  const html = env.document.querySelector('#sheet').innerHTML;
  env.window.__st(0);
  await pr;
  assert.match(html, /持仓成本/);
  assert.match(html, /市值/);
  assert.match(html, /200 万/, '2 手 × 100 万 = 200 万，不应是 2,000 万');
  assert.doesNotMatch(html, /2,000 万/);
});
