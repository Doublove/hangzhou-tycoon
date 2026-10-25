/* ============================================================
   道具商店 · 15 号格（v1.8 新增）
   用例前缀 TC-SHOP
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');

const total = p => Object.values(p.items || {}).reduce((a, b) => a + b, 0);

test('TC-SHOP-01 售价 = 当前净资产的 3%', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1000; p.debt = 0;
  assert.equal(env.shopPrice(p), Math.round(env.netWorth(p) * 0.03));
  assert.equal(env.shopPrice(p), 30);
});

test('TC-SHOP-02 净资产很低或为负时按 20 万保底', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 300; p.debt = 0;            // 3% = 9
  assert.equal(env.shopPrice(p), 20);
  p.cash = 100; p.debt = 5000;         // 净资产为负
  assert.equal(env.shopPrice(p), 20);
});

test('TC-SHOP-03 价格随净资产上涨，领先者买得更贵', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1000; p.debt = 0;
  const cheap = env.shopPrice(p);
  p.cash = 5000;
  const dear = env.shopPrice(p);
  assert.ok(dear > cheap * 4, `净资产 5 倍，价格应接近 5 倍：${cheap} → ${dear}`);
});

test('TC-SHOP-04 买一件扣钱、道具 +1', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  const before = p.items.dice;
  const price = env.shopPrice(p);

  const pr = env.askShop(p);
  env.window.__buyItem('dice');
  env.window.__shopDone();
  await pr;

  assert.equal(p.items.dice, before + 1);
  assert.equal(p.cash, 5000 - price);
});

test('TC-SHOP-05 四种道具都能买', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 50000;
  const before = { ...p.items };

  const pr = env.askShop(p);
  ['dice', 'stay', 'uturn', 'block'].forEach(k => env.window.__buyItem(k));
  env.window.__shopDone();
  await pr;

  Object.keys(before).forEach(k => {
    assert.equal(p.items[k], before[k] + 1, `${k} 应 +1`);
  });
});

test('TC-SHOP-06 现金不足时买不了', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5;                          // 低于 20 万保底价
  const before = total(p);
  const pr = env.askShop(p);
  env.window.__buyItem('dice');
  env.window.__shopDone();
  await pr;
  assert.equal(total(p), before, '不应买到任何东西');
  assert.equal(p.cash, 5);
});

test('TC-SHOP-07 弹窗列出四种道具、价格与持有数', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  const pr = env.askShop(p);
  const html = env.document.querySelector('#sheet').innerHTML;
  env.window.__shopDone();
  await pr;

  ['遥控骰子', '停留卡', '掉头卡', '路障'].forEach(name => {
    assert.ok(html.includes(name), `弹窗缺少 ${name}`);
  });
  assert.match(html, /持有 \d+/);
  assert.ok(html.includes(`${env.shopPrice(p)} 万`), '应显示单价');
});

test('TC-SHOP-08 详情页显示当前价格与持有数', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  const shop = env.curCells().find(c => c.t === 'shop');
  env.showCell(shop);
  const html = env.document.querySelector('#sheet').innerHTML;
  assert.match(html, /道具店/);
  assert.ok(html.includes(`${env.shopPrice(p)} 万`));
  assert.match(html, /持有/);
});

test('TC-SHOP-09 AI 现金宽裕时会买一件', async () => {
  const env = F.boot();
  const ai = env.state.players[1];
  ai.human = false;
  ai.cash = 5000;
  const before = total(ai);
  await env.enterShop(ai);
  assert.equal(total(ai), before + 1);
  assert.ok(ai.cash < 5000);
});

test('TC-SHOP-10 AI 现金紧张时不买', async () => {
  const env = F.boot();
  const ai = env.state.players[1];
  ai.human = false;
  ai.cash = 30;                        // 低于 3 倍单价
  const before = total(ai);
  await env.enterShop(ai);
  assert.equal(total(ai), before);
  assert.equal(ai.cash, 30);
});

test('TC-SHOP-11 AI 不会把同一种道具囤过 2 件', async () => {
  const env = F.boot();
  const ai = env.state.players[1];
  ai.human = false;
  ai.cash = 50000;
  ai.items = { dice: 2, stay: 2, uturn: 2, block: 2 };
  const before = total(ai);
  await env.enterShop(ai);
  assert.equal(total(ai), before, '全都够 2 件就不再买');
});

test('TC-SHOP-12 踩到道具店只进店，不触发其他结算', async () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.human = true;
  p.cash = 5000;
  const shop = env.curCells().find(c => c.t === 'shop');
  env.put(p, shop.idx);
  const cash = p.cash;
  await env.landOn(p, shop);
  assert.equal(p.pos, shop.idx, '位置不变');
  assert.equal(p.cash, cash, '不买东西就不扣钱');
});

test('TC-SHOP-13 商店格可以放路障', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.items.block = 1;
  const shop = env.curCells().find(c => c.t === 'shop');
  assert.equal(env.placeBlock(p, shop), true);
  assert.equal(shop.block, true);
});
