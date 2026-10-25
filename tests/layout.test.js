/* ============================================================
   布局契约 · 需求 9.1（屏幕与适配）
   用例前缀 TC-LAY
   ------------------------------------------------------------
   纯 CSS 无法在 Node 里渲染，这里退一步做「契约测试」：
   断言 index.html 里关键规则还在。曾经出现过 #boardWrap 被
   flex 压成 4px 高的问题，加这组用例防止再被误删。
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/** 取出某个选择器的规则体（只取第一条） */
function rule(selector) {
  const i = HTML.indexOf(selector + '{');
  assert.ok(i >= 0, `index.html 里找不到选择器 ${selector}`);
  const start = i + selector.length + 1;
  const end = HTML.indexOf('}', start);
  return HTML.slice(start, end);
}

test('TC-LAY-01 棋盘是正方形，靠 aspect-ratio 定高', () => {
  const r = rule('#boardWrap');
  assert.match(r, /aspect-ratio\s*:\s*1\s*\/\s*1/, '棋盘必须保持 1:1');
  assert.match(r, /width\s*:\s*100%/);
});

test('TC-LAY-02 棋盘不参与 flex 压缩（曾经被压成 4px 高）', () => {
  const r = rule('#boardWrap');
  assert.match(r, /flex\s*:\s*0\s+0\s+auto/, '棋盘不能被 flex-shrink 压扁');
});

test('TC-LAY-03 棋盘有最小宽高兜底，且两者一致', () => {
  const r = rule('#boardWrap');
  const minW = r.match(/min-width\s*:\s*(\d+)px/);
  const minH = r.match(/min-height\s*:\s*(\d+)px/);
  assert.ok(minW, '缺少 min-width');
  assert.ok(minH, '缺少 min-height');
  assert.equal(minW[1], minH[1], '最小宽高应一致，避免变成非正方形');
});

test('TC-LAY-04 body 不锁死视口高度，内容多时靠滚动而不是压缩', () => {
  assert.doesNotMatch(HTML, /html\s*,\s*body\s*\{[^}]*height\s*:\s*100%/,
    'html/body 同时 height:100% 会把 #app 限死在视口内');
  const body = rule('body');
  assert.match(body, /min-height\s*:\s*100%/, 'body 应用 min-height 允许内容撑高');
});

test('TC-LAY-05 竖屏所有区块都不被压缩', () => {
  assert.match(HTML, /#app\s*>\s*\*\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/,
    '缺少 #app > * 的防压缩规则');
});

test('TC-LAY-06 存在平板与桌面两级断点', () => {
  assert.match(HTML, /@media\s*\(min-width:760px\)/, '缺少平板断点');
  assert.match(HTML, /@media\s*\(min-width:1180px\)/, '缺少桌面断点');
  assert.match(HTML, /@media\s*\(min-width:760px\)\s*and\s*\(min-height:560px\)/,
    '平板断点应带高度条件，避免手机横屏挤成两列');
});

test('TC-LAY-07 桌面用两列网格，棋盘在右列', () => {
  assert.match(HTML, /grid-template-areas\s*:\s*[\s\S]*?"hud\s+board"/, '缺少两列区域划分');
  assert.match(HTML, /#boardWrap\{grid-area:board/, '棋盘应落在 board 区域');
});

test('TC-LAY-08 K 线面板位于 HUD 之后、棋盘之前', () => {
  const iKline = HTML.indexOf('<section id="kline">');
  const iBoard = HTML.indexOf('<div id="boardWrap">');
  const iHud = HTML.indexOf('<header id="hud">');
  assert.ok(iHud >= 0 && iKline > iHud, 'K 线面板应在 HUD 之后');
  assert.ok(iBoard > iKline, '棋盘应在 K 线面板之后');
});

test('TC-LAY-09 玩家卡片允许收缩，名字用省略号', () => {
  assert.match(HTML, /\.players\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    '网格列必须可压缩，否则内容撑破容器');
  assert.match(HTML, /\.pname\{[^}]*text-overflow\s*:\s*ellipsis/);
});

test('TC-LAY-10 脚本引用带版本串，避免缓存旧代码', () => {
  assert.match(HTML, /src="data\.js\?v=\d+\.\d+\.\d+"/);
  assert.match(HTML, /src="game\.js\?v=\d+\.\d+\.\d+"/);
});

test('TC-LAY-11 涨跌配色符合 A 股习惯（红涨绿跌）', () => {
  const up = HTML.match(/\.k-chg\.up\{[^}]*\}/);
  const down = HTML.match(/\.k-chg\.down\{[^}]*\}/);
  assert.ok(up && down, '缺少涨跌样式');
  assert.match(up[0], /var\(--red\)/, '上涨用红');
  assert.match(down[0], /var\(--green\)/, '下跌用绿');
});
