/* ============================================================
   玩家栏 · 现金 / 负债 / 房产 / 持股 分列显示
   用例前缀 TC-PB
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures');

/** 取某个玩家卡片的 HTML */
function card(env, name) {
  const cards = env.document.querySelector('#players').children;
  const el = cards.find(c => c.innerHTML.includes(name));
  assert.ok(el, `找不到 ${name} 的卡片`);
  return el.innerHTML.replace(/\s+/g, ' ');
}

/** 取某一项的值（<i>标签</i><b>值</b>） */
function field(env, name, label) {
  const html = card(env, name);
  const m = html.match(new RegExp(`<i>${label}</i><b[^>]*>([^<]*)</b>`));
  assert.ok(m, `${name} 的「${label}」没渲染出来`);
  return m[1];
}

test('TC-PB-01 卡片分四项显示：现金 / 负债 / 房产 / 持股', () => {
  const env = F.boot();
  env.renderHUD();
  const html = card(env, '杭铁头');
  ['现金', '负债', '房产', '持股'].forEach(label => {
    assert.ok(html.includes(`<i>${label}</i>`), `缺少「${label}」`);
  });
});

test('TC-PB-02 现金与负债显示真实数值', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1200; p.debt = 340;
  env.renderHUD();
  assert.equal(field(env, '杭铁头', '现金'), '1,200');
  assert.equal(field(env, '杭铁头', '负债'), '340');
});

test('TC-PB-03 房产价值 = Σ 地价 ×(1+12%×等级)', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 100; p.debt = 0;
  const a = env.grant(p, env.plotByName('湖滨'), 2);   // 1764 × 1.24
  const b = env.grant(p, env.plotByName('北山'), 1);   // 1323 × 1.12
  env.renderHUD();
  const expect = Math.round(env.value(a) * 1.24 + env.value(b) * 1.12);
  assert.equal(env.estateValue(p), env.value(a) * 1.24 + env.value(b) * 1.12);
  assert.equal(field(env, '杭铁头', '房产'), expect.toLocaleString('en-US'));
});

test('TC-PB-04 持股显示手数与市值', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 5000;
  env.buyStock(p, 3);
  env.renderHUD();
  assert.equal(field(env, '杭铁头', '持股'), `3手·${env.stockValue(p).toLocaleString('en-US')}`);
});

test('TC-PB-05 没有负债时显示占位符而不是 0', () => {
  const env = F.boot();
  env.state.players[0].debt = 0;
  env.renderHUD();
  assert.equal(field(env, '杭铁头', '负债'), '—');
  assert.match(card(env, '杭铁头'), /<i>负债<\/i><b class="muted">—<\/b>/);
});

test('TC-PB-06 没有持仓时显示占位符', () => {
  const env = F.boot();
  env.renderHUD();
  assert.equal(field(env, '杭铁头', '持股'), '—');
  assert.match(card(env, '杭铁头'), /<i>持股<\/i><b class="muted"/);
});

test('TC-PB-07 有负债时用红色标记', () => {
  const env = F.boot();
  env.state.players[0].debt = 100;
  env.renderHUD();
  assert.match(card(env, '杭铁头'), /<i>负债<\/i><b class="neg">100<\/b>/);
});

test('TC-PB-08 四项与净资产自洽：现金 + 房产 + 持股 − 负债', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1500; p.debt = 400; p.stock = 2; p.revalue = 1;
  env.grant(p, env.plotByName('湖滨'), 3);
  env.renderHUD();
  const cash = Number(field(env, '杭铁头', '现金').replace(/,/g, ''));
  const debt = Number(field(env, '杭铁头', '负债').replace(/,/g, ''));
  const estate = Number(field(env, '杭铁头', '房产').replace(/,/g, ''));
  const stockVal = Number(field(env, '杭铁头', '持股').split('·')[1].replace(/,/g, ''));
  assert.equal(cash + estate + stockVal - debt, env.netWorth(p));
});

test('TC-PB-09 估值加成时净资产按同一口径放大', () => {
  const env = F.boot();
  const p = env.state.players[0];
  p.cash = 1000; p.debt = 200; p.stock = 0; p.revalue = 1.05;
  env.grant(p, env.plotByName('湖滨'), 2);
  env.renderHUD();
  const estate = env.estateValue(p);
  assert.equal(env.netWorth(p), Math.round((1000 + estate) * 1.05 - 200));
});

test('TC-PB-10 破产玩家的四项数据仍显示，排名为破折号', () => {
  const env = F.boot();
  const p = env.state.players[1];
  p.bankrupt = true;
  p.cash = -50; p.debt = 800;
  env.renderHUD();
  const html = card(env, '温老板');
  assert.match(html, /<span class="prank">—<\/span>/);
  assert.equal(field(env, '温老板', '现金'), '-50');
  assert.equal(field(env, '温老板', '负债'), '800');
});

test('TC-PB-11 排名徽标与名字仍在卡片头部', () => {
  const env = F.boot();
  env.renderHUD();
  const html = card(env, '杭铁头');
  assert.match(html, /<div class="phead">/);
  assert.match(html, /class="prank r1"/);
  assert.match(html, /class="pname"/);
});

test('TC-PB-12 没有房产时同样显示占位符', () => {
  const env = F.boot();
  env.renderHUD();
  assert.equal(field(env, '杭铁头', '房产'), '—');
  assert.match(card(env, '杭铁头'), /<i>房产<\/i><b class="muted">—<\/b>/);
});
