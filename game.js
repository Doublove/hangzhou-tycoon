/* ============================================================
   杭州大富翁 · 逻辑层
   ============================================================ */

const $ = s => document.querySelector(s);
const SIM = location.search.indexOf("sim") >= 0;
const FAST = location.search.indexOf("fast") >= 0;
const SPEED = FAST ? 0 : (SIM ? 0.06 : 1);
const sleep = ms => new Promise(r => setTimeout(r, ms * SPEED));
const fmt = n => (n < 0 ? "-" : "") + Math.abs(Math.round(n)).toLocaleString();
const rnd = n => Math.floor(Math.random() * n);

const RENT_RATE = [0, 0.008, 0.011, 0.014, 0.017, 0.020];
const stockLot = () => Math.round(state.stockPrice * 0.1);   // 每手 ≈ 100 万

/* ---------------- 证券持仓 ----------------
   stockLots 记录每次买入的月份、单价与手数，卖出按先进先出扣减，
   这样才能在 K 线上标出"什么时候、什么价买的"，并算出真实成本。
----------------------------------------------------- */
function stockCost(p){
  if (!p || !p.stock) return 0;
  const lots = p.stockLots || [];
  /* 旧存档只有手数没有成本记录，按现价兜底，盈亏显示为 0 而不是 NaN */
  if (!lots.length) return (p.stock || 0) * stockLot();
  return lots.reduce((sum, l) => sum + l.price * l.lots, 0);
}
function stockValue(p){ return ((p && p.stock) || 0) * stockLot(); }
function stockPnl(p){
  const cost = stockCost(p);
  const value = stockValue(p);
  const profit = value - cost;
  return { cost, value, profit, rate: cost > 0 ? profit / cost : 0 };
}
function buyStock(p, n = 1){
  const price = stockLot();
  p.cash -= price * n;
  p.stock = (p.stock || 0) + n;
  (p.stockLots = p.stockLots || []).push({
    m: state.absMonth, price, lots: n, idx: state.stockPrice,
  });
  return price;
}
function sellStock(p, n = 1){
  n = Math.min(n, p.stock || 0);
  if (n <= 0) return 0;
  const price = stockLot();
  p.cash += price * n;
  p.stock -= n;
  let left = n;
  while (left > 0 && p.stockLots && p.stockLots.length){
    const lot = p.stockLots[0];
    const take = Math.min(lot.lots, left);
    lot.lots -= take;
    left -= take;
    if (lot.lots <= 0) p.stockLots.shift();
  }
  return price;
}
const TOLL_RATE = [0, 0.10, 0.12, 0.14, 0.16, 0.18];   // V1.1：Lv1 由 4% 上调至 10%
const PIECE = ["♚", "♛", "♜", "♞"];                 // 王 / 后 / 车 / 马
const UP_GATE  = [{}, {}, {m:1, h:30}, {m:2, h:45}, {m:3, h:60}, {m:6, h:75}];

const CHAPTERS = [
  { name:"第一章 · 限购前夜", from:0,   months:48, ring:0 },
  { name:"第二章 · G20 红利", from:48,  months:48, ring:1 },
  { name:"第三章 · 万人摇",   from:96,  months:48, ring:2 },
  { name:"第四章 · 分化时代", from:144, months:60, ring:3 }
];

const SAVE_PREFIX = "hztycoon_v1_";

const state = {
  chapter:0, absMonth:0, turnIdx:0, turnCount:0,
  rings:[], heat:{}, players:[], mods:[], fired:{},
  stockPrice:1000, stockHistory:[], busy:false, over:false,
  freezeBuy:0, freezeRegion:null, started:false,
  charId:"hang", diff:"normal"
};

/* ---------------- 时间 ---------------- */
const year = () => 2010 + Math.floor(state.absMonth / 12);
const monthLabel = m => `${2010 + Math.floor(m / 12)} 年 ${(m % 12) + 1} 月`;
const curCh = () => CHAPTERS[state.chapter];
const chapterMonth = () => state.absMonth - curCh().from;

/* ---------------- 建盘 ---------------- */
function buildRings(){
  state.rings = RINGS.map((ring, ri) => {
    const cells = TRACK_PATTERN.map((token, idx) => {
      if (token === "start") return { t:"start", name:"起点", ring:ri, idx };
      if (token[0] === "p"){
        const p = ring.plots[+token.slice(1)];
        return {
          t:"plot", ring:ri, idx, name:p.n, region:p.r,
          price: Math.round(p.b / 40), base:p.b, maxLv:p.mx,
          unlock:p.u, lv:0, owner:null, unlocked:p.u === 0,
          boughtAt:-99, broken:false, boost:0, discount:1
        };
      }
      if (token === "jail") return { t:"jail", name:"监狱", fullName:"监狱", ring:ri, idx };
      if (token === "scenic"){
        const sc = SCENIC[ri] || SCENIC[0];
        return { t:"scenic", name:sc.short, fullName:sc.full, ring:ri, idx };
      }
      const label = { chance:"机会", fate:"命运", bank:"银行", tax:"税务", stock:"证券" }[token];
      return { t:token, name:label, ring:ri, idx };
    });
    return { cells, name:ring.name, years:ring.years };
  });
}

const curCells = () => state.rings[curCh().ring].cells;
const allCells = () => state.rings.flatMap(r => r.cells);
const owned = p => allCells().filter(c => c.t === "plot" && c.owner === p);

/* ---------------- 数值 ---------------- */
const eraF = () => ERA[year()] || 1;
const heatF = r => 0.6 + 0.8 * (state.heat[r] || 50) / 100;

function value(c){
  let v = c.price * eraF() * heatF(c.region);
  if (c.broken) v *= 0.2;
  if (c.discount) v *= c.discount;
  return Math.round(v);
}
function rentOf(c){
  if (c.broken || c.lv === 0) return 0;
  let r = value(c) * RENT_RATE[c.lv];
  const p = c.owner;
  if (p){
    if (p.charId === "ma" && c.region === "未来科技城") r *= 1.25;
    if (p.charId === "lian" && ["西湖边","之江","滨江"].includes(c.region)) r *= 1.3;
  }
  if (c.boost > 0) r *= 2;
  if (c.boost < 0) r = 0;
  return Math.round(r);
}
/* 连片加成：环上相邻（序号 ±1）同主则 ×2；跨起点不算相邻；不叠乘 */
function neighbors(c){
  const cells = state.rings[c.ring].cells, n = cells.length;
  return [cells[(c.idx - 1 + n) % n], cells[(c.idx + 1) % n]]
    .filter(x => x && x.idx !== 0);          // idx 0 是起点，隔断首尾
}
function adjacentBonus(c){
  if (!c.owner) return 1;
  return neighbors(c).some(x => x.t === "plot" && x.owner === c.owner) ? 2 : 1;
}
function adjCount(p, c){
  return neighbors(c).filter(x => x.t === "plot" && x.owner === p).length;
}
/* 夹在两个同主地块之间的那一格：买下它就拆掉了对手的连片 */
function sandwichedOwner(c){
  const nb = neighbors(c).filter(x => x.t === "plot" && x.owner);
  if (nb.length < 2) return null;
  return nb[0].owner === nb[1].owner ? nb[0].owner : null;
}
function tollParts(c){
  const raw = value(c) * TOLL_RATE[c.lv];
  const adj = adjacentBonus(c);
  const boost = c.boost > 0 ? 1.5 : 1;
  // 只在最后取整一次，避免「先取整再乘 2」带来的 1 万误差
  return { base: Math.round(raw), adj, boost, total: Math.round(raw * adj * boost) };
}
const tollOf = c => (c.lv > 0 && !c.broken ? tollParts(c).total : 0);

/* 杠杆率 = 负债 / 净资产（净资产已扣除负债，所以 > 1 意味着资不抵债） */
function leverage(p){
  const nw = netWorth(p);
  if (nw <= 0) return 9;
  return p.debt / nw;
}
/* 单次上限是否对这名玩家生效：高杠杆玩家不享受保护（V1.2） */
const cappedFor = p => leverage(p) <= CFG.levThreshold;

/* 实际支付：净资产型玩家单次不超过净资产 30%；高杠杆玩家全额支付 */
function tollFor(payer, c){
  const raw = tollOf(c);
  if (!cappedFor(payer)) return { pay: raw, cut: 0, raw, exempt: true };
  const cap = Math.round(Math.max(0, netWorth(payer)) * CFG.tollCap);
  if (raw > cap) return { pay: cap, cut: raw - cap, raw, exempt: false };
  return { pay: raw, cut: 0, raw, exempt: false };
}
const upCost = c => Math.round(value(c) * CFG.upRate);

/* 房产估值：地价 × (1 + 12% × 等级)。净资产与玩家栏共用这一个口径 */
function estateValue(p){
  return owned(p).reduce((s, c) => s + value(c) * (1 + 0.12 * c.lv), 0);
}
function netWorth(p){
  const stock = (p.stock || 0) * stockLot();
  return Math.round((p.cash + estateValue(p) + stock) * (p.revalue || 1) - p.debt);
}
function loanCap(p){
  const rate = hasPolicy("tightLoan") ? CFG.loanCapTight : CFG.loanCap;
  const bonus = p.charId === "wen" ? 1.3 : 1;
  return Math.max(0, Math.round(netWorth(p) * rate * bonus - p.debt));
}
const loanRate = () => (hasPolicy("tightLoan") ? CFG.loanRateTight : CFG.loanRate) * 0.8;

function hasPolicy(k){
  return state.mods.some(m => m.key === k && (m.until == null || state.absMonth < m.until));
}
function setPolicy(k, until){
  if (hasPolicy(k)) return;
  const ev = EVENTS.find(e => e.key === k);
  state.mods.push({
    key:k, kind:"policy", name: ev ? ev.name : k,
    detail: ev ? ev.detail : "政策生效中", start: state.absMonth, until
  });
}
function extendPolicy(k, add){
  const m = state.mods.find(x => x.key === k);
  if (m && m.until != null) m.until += add;
}
function clearPolicy(k){ state.mods = state.mods.filter(m => m.key !== k); }

function heatAdd(regions, delta){
  const list = regions || Object.keys(REGIONS);
  list.forEach(r => {
    if (state.heat[r] == null) return;
    state.heat[r] = Math.max(20, Math.min(95, state.heat[r] + delta));
  });
}
function raiseCap(regions){
  allCells().forEach(c => {
    if (c.t === "plot" && regions.includes(c.region)) c.maxLv = Math.min(5, c.maxLv + 1);
  });
}
function triggerStall(){
  const risky = ["城东","城北","临平","三江汇"];
  let n = 0;
  allCells().forEach(c => {
    if (c.t === "plot" && c.lv >= 1 && c.lv <= 2 && risky.includes(c.region) && Math.random() < 0.25){ c.broken = true; n++; }
  });
  if (n) log(`烂尾：${n} 宗在建地块停工，价值归零`, "bad");
}

/* ---------------- 渲染 ---------------- */
let policySig = "";
let legacySig = "";

function render(){
  renderHUD(); renderBoard(); renderTokens();
}

function renderHUD(){
  const ch = curCh();
  $("#date").textContent = monthLabel(Math.min(state.absMonth, 203));
  $("#chapter").innerHTML = `${ch.name}　<span class="badge">${ch.years || RINGS[ch.ring].years}</span>`;
  const done = chapterMonth();
  $("#turnInfo").textContent = `第 ${Math.min(done + 1, ch.months)} / ${ch.months} 月`;
  $("#bar-fill").style.width = Math.min(100, done / ch.months * 100) + "%";

  /* 实时排名：按净资产，破产者垫底且不参与名次 */
  const alive = state.players.filter(p => !p.bankrupt)
    .slice().sort((a, b) => netWorth(b) - netWorth(a));
  const rankOf = new Map(alive.map((p, i) => [p.id, i + 1]));

  const box = $("#players");
  box.innerHTML = "";
  state.players.forEach(p => {
    const d = document.createElement("div");
    d.className = "pcard" + (p.id === state.turnIdx && !state.over ? " active" : "") + (p.bankrupt ? " dead" : "");
    const r = rankOf.get(p.id);
    const estate = Math.round(estateValue(p));
    const lots = p.stock || 0;
    const holding = lots ? `${lots}手·${fmt(stockValue(p))}` : "—";
    d.innerHTML = `
      <div class="phead">
        <span class="prank${r && r <= 3 ? " r" + r : ""}">${r || "—"}</span>
        <span class="dot" style="background:${p.color}"></span>
        <span class="pname" title="${p.name} · 净资产 ${fmt(netWorth(p))} 万">${p.name}</span>
      </div>
      <div class="pgrid">
        <span class="pkv"><i>现金</i><b>${fmt(p.cash)}</b></span>
        <span class="pkv"><i>负债</i><b class="${p.debt > 0 ? "neg" : "muted"}">${p.debt > 0 ? fmt(p.debt) : "—"}</b></span>
        <span class="pkv"><i>房产</i><b class="${estate ? "" : "muted"}">${estate ? fmt(estate) : "—"}</b></span>
        <span class="pkv"><i>持股</i><b class="${lots ? "" : "muted"}" title="${lots ? `市值 ${fmt(stockValue(p))} 万` : "未持股"}">${holding}</b></span>
      </div>`;
    box.appendChild(d);
  });

  // 政策条
  const pol = $("#policy");
  const meP = state.players[0];
  const active = state.mods.filter(m => m.until == null || state.absMonth < m.until);
  const highLev = state.started && meP && !meP.bankrupt && !cappedFor(meP);
  const liquidating = state.started && meP && !meP.bankrupt && meP.liquidating;

  /* 内容没变就不重建节点。AI 回合每 0.3 秒调一次 renderHUD，
     反复销毁重建会让鼠标下的 chip 不断被替换，悬停提示跟着闪。 */
  const polSig = [
    active.map(m => `${m.name}·${m.until == null ? "永久" : Math.max(0, m.until - state.absMonth)}`).join("|"),
    highLev ? Math.round(leverage(meP) * 100) : "",
    liquidating ? Math.max(0, meP.liqDeadline - state.absMonth) : "",
  ].join("#");

  if (polSig !== policySig){
    policySig = polSig;
    pol.innerHTML = "";
    if (!active.length){
      const c = document.createElement("span");
      c.className = "chip info"; c.textContent = "政策宽松";
      c.dataset.tip = "none";
      pol.appendChild(c);
    } else {
      active.forEach(m => {
        const c = document.createElement("span");
        c.className = "chip" + (m.kind === "event" ? " info" : "");
        const rest = m.until == null ? "" : ` · 剩${Math.max(0, m.until - state.absMonth)}月`;
        c.textContent = m.name + rest;
        c.dataset.tip = "policy";
        c.dataset.key = m.key;
        c.onclick = e => { e.stopPropagation(); showTipHTML(c, policyTip(m)); };
        pol.appendChild(c);
      });
    }

    // 高杠杆警示：超过阈值就不再享受单次上限保护
    if (highLev){
      const w = document.createElement("span");
      w.className = "chip";
      w.style.cssText = "background:#B3261E;color:#fff";
      w.textContent = `高杠杆 ${Math.round(leverage(meP) * 100)}% · 无上限保护`;
      w.dataset.tip = "leverage";
      w.onclick = e => { e.stopPropagation(); showTipHTML(w, leverageTip(meP)); };
      pol.appendChild(w);
    }

    // 清算警示
    if (liquidating){
      const w = document.createElement("span");
      w.className = "chip";
      w.style.cssText = "background:#8E2A20;color:#fff";
      w.textContent = `清算中 · 剩 ${Math.max(0, meP.liqDeadline - state.absMonth)} 月`;
      w.dataset.tip = "liquidation";
      w.onclick = e => { e.stopPropagation(); showTipHTML(w, liquidationTip(meP)); };
      pol.appendChild(w);
    }
  }

  /* 事件委托：chip 被重建也不影响 hover */
  bindTipDelegate(pol, el => {
    if (el.dataset.tip === "none"){
      return `<b>政策宽松</b>
        <div class="t-meta">当前没有生效的政策或事件</div>
        历史事件会按月自动触发，触发后这里会变成政策标签，悬停可查看详情与剩余月数。`;
    }
    if (el.dataset.tip === "policy"){
      const m = activeMod(el.dataset.key);
      return m ? policyTip(m) : "";
    }
    if (el.dataset.tip === "leverage" && meP) return leverageTip(meP);
    if (el.dataset.tip === "liquidation" && meP) return liquidationTip(meP);
    return "";
  });

  // 旧环资产：只显示人类玩家在已沉降环上的持有，悬停看明细
  const legacy = $("#legacy");
  if (legacy){
    const groups = [];
    if (state.started && meP && !meP.bankrupt){
      state.rings.forEach((r, i) => {
        if (i === state.chapter) return;
        const mine = r.cells.filter(c => c.t === "plot" && c.owner && c.owner.id === meP.id);
        if (mine.length) groups.push({ ring: i, count: mine.length });
      });
    }
    const legSig = groups.map(g => `${g.ring}:${g.count}`).join("|") + "@" + state.chapter;
    if (legSig !== legacySig){
      legacySig = legSig;
      legacy.innerHTML = "";
      groups.forEach(g => {
        const c = document.createElement("span");
        c.className = "chip legacy";
        c.dataset.tip = "legacy";
        c.dataset.ring = g.ring;
        c.textContent = `${RINGS[g.ring].name.split(" · ")[0]} ${g.count} 宗`;
        c.onclick = e => { e.stopPropagation(); showTipHTML(c, legacyTip(g.ring, meP)); };
        legacy.appendChild(c);
      });
      // 已经过了第一章却没有任何旧环资产：给个占位，免得这一栏空着让人以为坏了
      if (!groups.length && state.chapter > 0 && state.started && meP && !meP.bankrupt){
        const c = document.createElement("span");
        c.className = "chip legacy empty";
        c.dataset.tip = "legacy-empty";
        c.textContent = "旧环 · 暂无";
        legacy.appendChild(c);
      }
    }
    bindTipDelegate(legacy, el => {
      if (el.dataset.tip === "legacy-empty"){
        return `<b>旧环资产</b>
          <div class="t-meta">暂无</div>
          进入新章节后，上一章持有的地块会沉降为「旧环资产」，只保留持有与收租，不能再买入。`;
      }
      if (el.dataset.tip !== "legacy") return "";
      const i = +el.dataset.ring;
      return meP ? legacyTip(i, meP) : "";
    });
  }

  renderItems();
  renderKline();
  renderSkillBtn();
}

/* ---------------- 道具条与技能按钮 ---------------- */
function renderItems(){
  const box = $("#items");
  if (!box) return;
  if (!state.started || !state.players.length){ box.innerHTML = ""; return; }
  // 始终显示人类玩家自己的道具，而不是当前行动者（AI 回合时不该看到 AI 的库存）
  const p = humanPlayer() || (SIM ? state.players[state.turnIdx] : null);
  if (!p){ box.innerHTML = ""; return; }
  const canUse = p.human && state.turnIdx === p.id && !state.busy && !state.over;
  box.innerHTML = ITEM_KEYS.map(k => {
    const n = itemCount(p, k);
    const on = canUse && n > 0;
    return `<button class="item${on ? "" : " off"}" data-item="${k}" ${on ? "" : "disabled"} title="${ITEMS[k].desc}">
      <span class="ic">${ITEMS[k].icon}</span><b>${n}</b><span class="nm">${ITEMS[k].name}</span>
    </button>`;
  }).join("");
  box.querySelectorAll(".item").forEach(b => {
    b.onclick = () => onItemClick(b.dataset.item);
  });
}

/* ---------------- 证券 K 线 ----------------
   每回合一个数据点：开盘 = 上月收盘，收盘 = 本月结算价。
   涨红跌绿（中国习惯），金色三角标出玩家每次买入的位置与价格。
----------------------------------------------------- */
function klineWindow(limit){
  const hist = state.stockHistory || [];
  return hist.slice(-limit);
}

function renderKline(){
  const p = humanPlayer() || (SIM ? state.players[state.turnIdx] : null);
  const hist = klineWindow(60);
  const price = state.stockPrice;

  const priceEl = $("#k-price");
  if (priceEl) priceEl.textContent = fmt(price);

  const chgEl = $("#k-chg");
  if (chgEl){
    const prev = hist.length > 1 ? hist[hist.length - 2].c : price;
    const chg = prev ? (price - prev) / prev * 100 : 0;
    chgEl.textContent = `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%`;
    chgEl.className = "k-chg" + (chg > 0 ? " up" : chg < 0 ? " down" : "");
  }

  const sp = stockPnl(p);
  const holdEl = $("#k-hold");
  if (holdEl) holdEl.textContent = `持仓 ${(p && p.stock) || 0} 手`;
  const valEl = $("#k-value");
  if (valEl) valEl.textContent = `市值 ${fmt(sp.value)} 万`;
  const pnlEl = $("#k-pnl");
  if (pnlEl){
    if (!p || !p.stock){
      pnlEl.textContent = "盈亏 —";
      pnlEl.className = "";
    } else {
      const sign = sp.profit >= 0 ? "+" : "";
      pnlEl.textContent = `盈亏 ${sign}${fmt(sp.profit)} 万（${sign}${(sp.rate * 100).toFixed(1)}%）`;
      pnlEl.className = sp.profit >= 0 ? "up" : "down";
    }
  }

  drawKline($("#kchart"), hist, p);
}

function drawKline(cv, hist, p){
  if (!cv || typeof cv.getContext !== "function" || !hist.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 320;
  const h = cv.clientHeight || 92;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const padT = 8, padB = 10, padL = 2, padR = 2;
  const prices = hist.flatMap(d => [d.o, d.c]);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo){ hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const yOf = v => padT + (hi - v) / (hi - lo) * (h - padT - padB);

  g.strokeStyle = "#EDE5D6";
  g.lineWidth = 1;
  for (let i = 1; i <= 2; i++){
    const yy = padT + (h - padT - padB) * i / 3;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke();
  }

  const bw = (w - padL - padR) / hist.length;
  const cw = Math.max(1.5, Math.min(9, bw * 0.62));
  hist.forEach((d, i) => {
    const x = padL + bw * i + bw / 2;
    const up = d.c >= d.o;
    const color = up ? "#C0392B" : "#1B7A3E";
    g.fillStyle = color;
    g.strokeStyle = color;
    const top = yOf(Math.max(d.o, d.c));
    const bot = yOf(Math.min(d.o, d.c));
    /* 没有盘中数据，实体即全部；一字板时给 1px 高度以免看不见 */
    g.fillRect(x - cw / 2, top, cw, Math.max(1, bot - top));
  });

  // 买入点：金色三角 + 成本虚线
  if (p && Array.isArray(p.stockLots) && p.stockLots.length){
    const first = hist[0].m, last = hist[hist.length - 1].m;
    p.stockLots.forEach(lot => {
      if (lot.m < first || lot.m > last) return;
      const idx = hist.findIndex(d => d.m === lot.m);
      if (idx < 0) return;
      const x = padL + bw * idx + bw / 2;
      /* 老记录只有每手价，按 ×10 还原成指数点位 */
      const at = lot.idx != null ? lot.idx : lot.price * 10;
      /* 买入价贴顶时把标记压回绘图区，别画到画布外 */
      const yy = Math.max(padT + 9, Math.min(h - padB - 2, yOf(at)));
      g.strokeStyle = "rgba(184,134,11,.55)";
      g.lineWidth = 1;
      g.setLineDash([3, 2]);
      g.beginPath(); g.moveTo(x, yy); g.lineTo(w, yy); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#B8860B";
      g.strokeStyle = "#fff";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, yy - 3);
      g.lineTo(x - 5.5, yy - 11);
      g.lineTo(x + 5.5, yy - 11);
      g.closePath();
      g.fill();
      g.stroke();
    });
  }
}

function renderSkillBtn(){
  const btn = $("#skill");
  if (!btn) return;
  if (!state.started || !state.players.length){ btn.style.display = "none"; return; }
  const p = humanPlayer() || (SIM ? state.players[state.turnIdx] : null);
  const a = p ? activeOf(p) : null;
  if (!a){ btn.style.display = "none"; return; }
  btn.style.display = "";
  const ready = p.skillCd <= 0 && (p.human ? state.turnIdx === p.id : true) && !state.busy && !state.over;
  /* 不用 disabled：Chrome 下 disabled 按钮不派发 mouseenter，
     冷却中反而最需要看说明。改用 .off 控制视觉，点击时再判可用性。 */
  btn.disabled = false;
  btn.classList.toggle("ready", ready);
  btn.classList.toggle("off", !ready);
  btn.innerHTML = p.skillCd > 0
    ? `${a.name}<small>冷却 ${p.skillCd} 月</small>`
    : `${a.name}<small>${p.human ? "点一下发动" : "AI"}</small>`;
  btn.onmouseenter = () => showTipHTML(btn, skillTip(p, a), "above");
  btn.onmouseleave = hideTip;
  btn.onclick = () => {
    if (ready) useSkill(p);
    else showTipHTML(btn, skillTip(p, a), "above");   // 触屏没有 hover，点一下也能看说明
  };
}

function humanPlayer(){ return state.players.find(x => x.human) || null; }

function onItemClick(k){
  const p = humanPlayer();
  if (!p || !p.human || state.busy) return;
  if (state.turnIdx !== p.id){ toast("等你的回合再用"); return; }
  if (p.inJail && k !== "dice"){ toast("关押期间只能用遥控骰子"); return; }
  if (p.scenicTurns > 0){ toast("度假中不能使用道具"); return; }

  if (k === "dice"){
    openSheet(`<h3>遥控骰子</h3>
      <p class="sub">指定下一次掷骰的点数。${p.inJail ? "关押中：选偶数可直接出狱。" : ""}</p>
      <div class="btns" style="flex-wrap:wrap">
        ${[1,2,3,4,5,6].map(n => `<button class="btn-sub" style="min-width:60px" onclick="__pick(${n})">${n}</button>`).join("")}
      </div>
      <div class="btns"><button class="btn-sub" onclick="closeSheet()">取消</button></div>`);
    window.__pick = n => { closeSheet(); useDiceItem(p, n); };
    return;
  }
  if (k === "stay"){ useStayItem(p); return; }
  if (k === "uturn"){ useUturnItem(p); return; }
  if (k === "block"){
    if (state.placing === "block"){ state.placing = null; toast("已取消放置"); return; }
    state.placing = "block";
    toast("点击棋盘上任意格放置路障");
    return;
  }
}

/* 点击棋盘：放置模式下放路障，否则打开详情 */
function onCellClick(cell){
  if (state.placing === "block"){
    const p = humanPlayer();
    if (p && p.human && placeBlock(p, cell)) state.placing = null;
    return;
  }
  showCell(cell);
}

function renderBoard(){
  const wrap = $("#boardWrap");
  wrap.querySelectorAll(".cell,.token,.oldring").forEach(n => n.remove());
  const cells = curCells();
  const n = cells.length, R = 43;

  // 旧环示意
  state.rings.forEach((r, i) => {
    if (i >= state.chapter) return;
    const d = document.createElement("div");
    d.className = "oldring";
    const scale = 62 - i * 12;
    d.style.width = scale + "%"; d.style.height = scale + "%";
    wrap.appendChild(d);
  });

  cells.forEach((cell, i) => {
    const a = (-90 + i * 360 / n) * Math.PI / 180;
    const el = document.createElement("div");
    el.className = "cell " + (cell.t === "plot" ? "land" : "special");
    el.dataset.i = i;
    el.style.left = (50 + R * Math.cos(a)) + "%";
    el.style.top = (50 + R * Math.sin(a)) + "%";
    el.onclick = () => onCellClick(cell);
    el.innerHTML = cell.t === "plot"
      ? `<span class="nm">${cell.name}</span><span class="lv"></span><span class="bar"></span>`
      : `<span class="nm">${cell.name}</span>`;
    wrap.appendChild(el);
  });
  renderCells();
}

function renderCells(){
  const cells = curCells();
  cells.forEach(cell => {
    const el = document.querySelector(`.cell[data-i="${cell.idx}"]`);
    if (!el) return;
    el.classList.toggle("blocked", !!cell.block);
    if (cell.t === "jail" || cell.t === "scenic"){ el.classList.add(cell.t); return; }
    if (cell.t !== "plot") return;
    el.classList.toggle("locked", !cell.unlocked);
    el.classList.toggle("broken", !!cell.broken);
    const chained = !!cell.owner && adjacentBonus(cell) > 1;
    el.classList.toggle("chain", chained);
    el.dataset.chain = chained ? "×2" : "";
    el.style.background = chained ? cell.owner.color + "1F" : "";
    el.querySelector(".lv").textContent = cell.lv ? "●".repeat(cell.lv) : "";
    const bar = el.querySelector(".bar");
    if (cell.owner){
      el.classList.add("owned");
      el.style.setProperty("--owner", cell.owner.color);
      bar.style.background = cell.owner.color;
    } else {
      el.classList.remove("owned");
      el.style.removeProperty("--owner");
      bar.style.background = cell.unlocked ? REGIONS[cell.region].color + "66" : "transparent";
    }
  });
  renderChains();
}

/* 连片特效：沿环外侧画一条同色连接带，把相邻同主的两格串起来
   （格子间距只有 3px，画在格间会完全被遮住，所以外扩到环外） */
function renderChains(){
  const wrap = $("#boardWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".chainlink").forEach(n => n.remove());
  const cells = curCells(), n = cells.length, R = 43;
  const W = wrap.clientWidth || 400;
  const Rp = R / 100 * W;              // 环半径（像素）
  const railR = Rp - Math.max(26, W * 0.062);   // 画在环内侧的空白区，不压格子也不出界
  cells.forEach((c, i) => {
    if (c.t !== "plot" || !c.owner) return;
    if (i === n - 1) return;                       // 首尾不连（跨起点）
    const nb = cells[(i + 1) % n];
    if (nb.t !== "plot" || nb.owner !== c.owner) return;

    const a1 = (-90 + i * 360 / n) * Math.PI / 180;
    const a2 = (-90 + (i + 1) * 360 / n) * Math.PI / 180;
    const x1 = W / 2 + railR * Math.cos(a1), y1 = W / 2 + railR * Math.sin(a1);
    const x2 = W / 2 + railR * Math.cos(a2), y2 = W / 2 + railR * Math.sin(a2);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const d = document.createElement("div");
    d.className = "chainlink";
    d.style.cssText = `left:${x1}px;top:${y1}px;width:${len}px;transform:rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg);background:${c.owner.color}`;
    wrap.appendChild(d);
  });
}

function renderTokens(){
  const wrap = $("#boardWrap");
  wrap.querySelectorAll(".token").forEach(n => n.remove());
  const n = curCells().length, R = 43;
  const by = {};
  state.players.forEach(p => { if (!p.bankrupt) (by[p.pos] = by[p.pos] || []).push(p); });
  const cur = state.players[state.turnIdx];
  Object.keys(by).forEach(idx => {
    const a = (-90 + idx * 360 / n) * Math.PI / 180;
    const bx = 50 + R * Math.cos(a), byy = 50 + R * Math.sin(a);
    const list = by[idx], cnt = list.length;
    list.forEach((p, k) => {
      const t = document.createElement("div");
      t.className = "token" + (p === cur && !state.over ? " active" : "");
      t.style.color = p.color;
      t.textContent = PIECE[p.id] || "♟";
      // 同格多人时缩小并横向排开，避免叠在一起看不清
      /* 大屏棋盘放大，棋子按容器宽度等比跟上 */
      const scale = Math.min(1.35, Math.max(1, (wrap.clientWidth || 400) / 400));
      const size = Math.round((cnt === 1 ? 27 : cnt === 2 ? 24 : 21) * scale);
      t.style.fontSize = size + "px";
      const dx = cnt > 1 ? (k - (cnt - 1) / 2) * (size * 0.78) : 0;
      t.style.left = `calc(${bx}% + ${dx}px)`;
      t.style.top = `calc(${byy}% + 11px)`;
      wrap.appendChild(t);
    });
  });
}

let logPinned = true;
function trimLog(){
  const box = $("#log");
  while (box.children.length > 300) box.removeChild(box.firstChild);
}
function scrollLog(force){
  const box = $("#log");
  if (force || logPinned) box.scrollTop = box.scrollHeight;
}
function log(msg, type=""){
  const box = $("#log");
  const p = document.createElement("p");
  if (type) p.className = type;
  p.innerHTML = msg;
  box.appendChild(p);
  trimLog();
  scrollLog();
}
/* 每名玩家开始行动时打一条分隔行；月初第一条带月份 */
function logSep(p, withMonth){
  const box = $("#log");
  const d = document.createElement("p");
  d.className = "sep";
  d.textContent = withMonth ? `${monthLabel(state.absMonth)} · ${p.name}` : p.name;
  box.appendChild(d);
  trimLog();
  scrollLog();
}
$("#log").addEventListener("scroll", () => {
  const box = $("#log");
  logPinned = box.scrollHeight - box.scrollTop - box.clientHeight < 20;
  $("#logJump").classList.toggle("show", !logPinned);
});
$("#logJump").addEventListener("click", () => {
  logPinned = true; scrollLog(true); $("#logJump").classList.remove("show");
});

let toastTimer;
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

/* ---------------- 悬浮提示 ----------------
   统一走 #tip 这个顶部横条：先写内容，再贴到 HUD 下沿。
   内容一律由 *Tip() 生成，方便单测直接断言文案。
----------------------------------------------------- */
function showTipHTML(el, html, anchor){
  if (!html) return;
  const tip = $("#tip");
  tip.innerHTML = html;
  tip.classList.add("show");
  if (anchor === "above" && el && el.getBoundingClientRect){
    /* 底部操作栏的按钮，提示贴在自己上方，视线不用来回跳 */
    const r = el.getBoundingClientRect();
    const h = tip.offsetHeight || 120;
    tip.style.top = Math.max(8, r.top - h - 10) + "px";
  } else {
    const bar = $("#hud").getBoundingClientRect();
    tip.style.top = (bar.bottom + 6) + "px";
  }
}

/* 同一个 key 可能在 mods 里有多条（政策续期、重复 push），优先取生效中的那条 */
function activeMod(key){
  const list = state.mods.filter(m => m.key === key);
  return list.find(m => m.until == null || state.absMonth < m.until) || list[list.length - 1] || null;
}

function policyTip(m){
  const life = m.until == null ? "永久生效" : `剩余 ${Math.max(0, m.until - state.absMonth)} 个月`;
  return `<b>${m.name}</b><div class="t-meta">${monthLabel(m.start)} 起 · ${life}</div>${m.detail || "政策生效中"}`;
}

function leverageTip(p){
  const lev = Math.round(leverage(p) * 100);
  return `<b>高杠杆 ${lev}%</b>
    <div class="t-meta">负债 ${fmt(p.debt)} 万 ÷ 净资产 ${fmt(netWorth(p))} 万</div>
    杠杆率超过 ${CFG.levThreshold * 100}% 后，单次过路费不再享受「净资产 ${CFG.tollCap * 100}%」的上限保护，踩到对手的地要全额支付。`;
}

function liquidationTip(p){
  const left = Math.max(0, p.liqDeadline - state.absMonth);
  return `<b>破产清算中</b>
    <div class="t-meta">剩余 ${left} 个月 · 债务 ${fmt(p.debt)} 万</div>
    清算期内仍可行动、仍收租金。${CFG.liqMonths} 个月内还清债务可退出清算；期满仍有欠款则宣告破产出局，名下资产清空。`;
}

/* 旧环资产：列出该环上属于该玩家的每一宗地，附估值与月租 */
function legacyTip(ringIdx, p){
  const ring = state.rings[ringIdx];
  if (!ring || !p) return "";
  const mine = ring.cells
    .filter(c => c.t === "plot" && c.owner && c.owner.id === p.id)
    .sort((a, b) => value(b) - value(a));
  if (!mine.length) return "";
  const total = mine.reduce((s, c) => s + value(c), 0);
  const rent = mine.reduce((s, c) => s + rentOf(c), 0);
  const rows = mine.slice(0, 6)
    .map(c => `<div>${c.name} · Lv${c.lv} · ${fmt(value(c))} 万</div>`)
    .join("");
  const more = mine.length > 6 ? `<div>…等 ${mine.length} 宗</div>` : "";
  return `<b>${ring.name} · 旧环资产</b>
    <div class="t-meta">${mine.length} 宗 · 估值 ${fmt(total)} 万 · 月租 ${fmt(rent)} 万</div>
    ${rows}${more}
    <div class="t-meta" style="margin-top:5px">旧环只保留持有与收租，不能再买入；可被「旧城改造」升级或征收。</div>`;
}

/* 主动技能说明：名称、冷却、当前状态、效果，以及角色的被动 */
function skillTip(p, a){
  if (!p || !a) return "";
  const ch = CHARS.find(c => c.id === p.charId) || {};
  let now;
  if (p.skillCd > 0) now = `冷却中，剩 ${p.skillCd} 个月`;
  else if (p.human && state.turnIdx !== p.id) now = "等你的回合";
  else if (state.busy) now = "行动中";
  else now = "可用";
  const passive = ch.skill
    ? `<div class="t-meta" style="margin-top:5px">被动 · ${ch.skill.split("：")[0]}</div>${ch.skill.split("：").slice(1).join("：")}`
    : "";
  return `<b>${a.name}</b>
    <div class="t-meta">主动技能 · 冷却 ${a.cd} 个月 · ${now}</div>
    ${a.desc}${passive}`;
}

/* 事件委托：容器上挂一次，内部 chip 重建也不影响 hover */
function bindTipDelegate(container, resolver){
  if (!container) return;
  container.onmouseover = e => {
    const el = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
    if (!el || !container.contains(el)) return;
    showTipHTML(el, resolver(el));
  };
  container.onmouseout = e => {
    const el = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hideTip();
  };
}

function showTip(el, key){
  const m = activeMod(key);
  if (!m) return;
  showTipHTML(el, policyTip(m));
}
function hideTip(){ $("#tip").classList.remove("show"); }
document.addEventListener("click", hideTip);
window.addEventListener("scroll", e => {
  /* 日志会自动滚到底，那个 scroll 不该把提示关掉 */
  if (e && e.target && e.target.id === "log") return;
  hideTip();
}, true);
window.addEventListener("resize", () => { if (state.started) renderChains(); });

/* ---------------- 弹窗 ---------------- */
function openSheet(html){ $("#sheet").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeSheet(){ $("#modal").classList.add("hidden"); }

function showCell(c){
  if (c.t !== "plot"){
    let body = "";
    if (c.t === "start") body = `<p class="sub">每次经过领 <b>月供 1 万 + 当前现金 3%</b>。系统不再按人头发钱，收入主要来自对手踩你的地。</p>`;
    else if (c.t === "chance" || c.t === "fate"){
      const deck = c.t === "chance" ? CHANCE : FATE;
      const rows = deck.slice(0, 8).map(k => `<div class="ev"><span class="ev-n">${k.t}</span><span class="ev-d">${k.d}</span></div>`).join("");
      body = `<p class="sub">共 ${deck.length} 张，停在这里随机抽一张（示例）：</p>${rows}`;
    } else if (c.t === "bank"){
      const p = state.players[0];
      body = `<p class="sub">可借款、还款。负债每月计息，计入净资产。</p>
        <div class="kv"><span>当前月息</span><b>${(loanRate() * 100).toFixed(2)}%</b></div>
        <div class="kv"><span>你的可借额度</span><b>${fmt(loanCap(p))} 万</b></div>`;
    } else if (c.t === "jail"){
      body = `<p class="sub">踩进这里，或抽到「代持被查」「违规套现」「虚假宣传被立案」，都会进来。</p>
        <div class="kv"><span>出狱条件</span><b>掷出偶数点数</b></div>
        <div class="kv"><span>每回合概率</span><b>50%</b></div>
        <div class="kv"><span>保底</span><b>3 次未中，第 4 回合强制释放</b></div>
        <p class="sub" style="margin-top:8px">关押期间不能买卖，但租金照收、利息照付。</p>`;
    } else if (c.t === "scenic"){
      body = `<p class="sub">${c.fullName || c.name}。踩中后掷 1D6，点数就是停留回合数。</p>
        <div class="kv"><span>停留</span><b>1—6 回合</b></div>
        <div class="kv"><span>期间</span><b>不能移动、不能买卖</b></div>
        <div class="kv"><span>现金流</span><b>租金照收，利息照付</b></div>
        <p class="sub" style="margin-top:8px">阿莲的被动让停留回合数减半。这是全作唯一花钱也解决不了的惩罚。</p>`;
    } else if (c.t === "tax"){
      body = `<p class="sub">每次经过按净资产 <b>1.2%</b> 缴税。</p>`;
    } else if (c.t === "stock"){
      body = `<p class="sub">买入或卖出「杭州楼市指数」，每手 100 股，价格随行情波动。</p>
        <div class="kv"><span>当前指数</span><b>${fmt(state.stockPrice)} 点</b></div>`;
    }
    openSheet(`<h3>${c.name}</h3>${body}
      <div class="btns"><button class="btn-sub" onclick="closeSheet()">知道了</button></div>`);
    return;
  }

  if (!c.unlocked){
    openSheet(`<h3>${c.name} <span class="badge">待出让</span></h3>
      <p class="sub">这块地要等到本章第 ${c.unlock + 1} 个月才挂牌。</p>
      <div class="btns"><button class="btn-sub" onclick="closeSheet()">知道了</button></div>`);
    return;
  }

  const mine = c.owner && c.owner.id === 0 && !state.busy && state.turnIdx === 0;
  const sellPrice = Math.round(value(c) * CFG.sellRate);
  openSheet(`
    <h3>${c.name} <span class="badge" style="background:${REGIONS[c.region].color};color:#fff">${c.region}</span></h3>
    <p class="sub">热度 ${state.heat[c.region]}　上限 Lv${c.maxLv}${c.broken ? "　<b style='color:#B3261E'>已烂尾</b>" : ""}</p>
    <div class="kv"><span>当前地价</span><b>${fmt(value(c))} 万</b></div>
    <div class="kv"><span>所有者</span><b>${c.owner ? c.owner.name : "无主"}</b></div>
    <div class="kv"><span>等级</span><b>${c.lv ? "Lv" + c.lv : "空地"}</b></div>
    <div class="kv"><span>过路费${adjacentBonus(c) > 1 ? "（连片 ×2）" : ""}</span><b>${c.lv ? fmt(tollOf(c)) + " 万" : "—"}</b></div>
    <div class="kv"><span>月租金</span><b>${c.lv ? fmt(rentOf(c)) + " 万" : "—"}</b></div>
    ${c.lv ? `<div class="kv"><span>单次上限</span><b>对手净资产的 ${CFG.tollCap * 100}%</b></div>` : ""}
    <div class="btns">
      <button class="btn-sub" onclick="closeSheet()">关闭</button>
      ${mine ? `<button class="btn-red" onclick="__sell(${c.ring},${c.idx})">卖出 ${fmt(sellPrice)} 万</button>` : ""}
    </div>`);
  window.__sell = (ring, idx) => {
    const cell = state.rings[ring].cells[idx];
    if (cell.owner && cell.owner.id === 0) sellLand(cell.owner, cell);
    closeSheet();
  };
}

function askBuy(p, c){
  return new Promise(res => {
    const price = value(c), fee = Math.round(price * (p.charId === "wang" ? 0.015 : 0.03));
    const needLottery = hasPolicy("lottery") && state.heat[c.region] >= 60 && !p.freePass;
    const total = price + fee;
    const ok = p.cash >= total;
    const adjAfter = neighbors(c).some(x => x.t === "plot" && x.owner === p) ? 2 : 1;
    openSheet(`
      <h3>${c.name} <span class="badge" style="background:${REGIONS[c.region].color};color:#fff">${c.region}</span></h3>
      <p class="sub">无主地块 · 热度 ${state.heat[c.region]}${needLottery ? " · 需摇号" : ""}</p>
      <div class="kv"><span>地价</span><b>${fmt(price)} 万</b></div>
      <div class="kv"><span>交易税费</span><b>${fmt(fee)} 万</b></div>
      <div class="kv"><span>Lv1 过路费${adjAfter > 1 ? "（连片 ×2）" : ""}</span><b>${fmt(Math.round(price * TOLL_RATE[1] * adjAfter))} 万</b></div>
      <div class="kv"><span>Lv1 月租金</span><b>${fmt(Math.round(price * RENT_RATE[1]))} 万</b></div>
      <div class="warn">${ok ? "" : "现金不足"}</div>
      <div class="btns">
        <button class="btn-sub" onclick="__buy(false)">放弃</button>
        <button class="btn-main" ${ok ? "" : "disabled"} onclick="__buy(true)">${needLottery ? "参加摇号" : "买入"}</button>
      </div>`);
    window.__buy = v => { closeSheet(); res(v); };
  });
}

function askUpgrade(p, c){
  return new Promise(res => {
    const cost = upCost(c);
    const g = UP_GATE[c.lv + 1] || {};
    const held = state.absMonth - c.boughtAt;
    const okHeld = held >= (g.m || 0), okHeat = state.heat[c.region] >= (g.h || 0);
    const ok = p.cash >= cost && okHeld && okHeat;
    let why = "";
    if (!okHeld) why = `需持有满 ${g.m} 个月`;
    else if (!okHeat) why = `需区域热度 ≥ ${g.h}`;
    else if (p.cash < cost) why = "现金不足";
    openSheet(`
      <h3>${c.name}</h3>
      <p class="sub">当前 Lv${c.lv} / 上限 Lv${c.maxLv}</p>
      <div class="kv"><span>升级费用</span><b>${fmt(cost)} 万</b></div>
      <div class="kv"><span>升级后月租金</span><b>${fmt(Math.round(value(c) * RENT_RATE[c.lv + 1]))} 万</b></div>
      <div class="kv"><span>升级后过路费${adjacentBonus(c) > 1 ? "（连片 ×2）" : ""}</span><b>${fmt(Math.round(value(c) * TOLL_RATE[c.lv + 1] * adjacentBonus(c)))} 万</b></div>
      <div class="warn">${ok ? "" : why}</div>
      <div class="btns">
        <button class="btn-sub" onclick="__up(false)">算了</button>
        <button class="btn-gold" ${ok ? "" : "disabled"} onclick="__up(true)">升级</button>
      </div>`);
    window.__up = v => { closeSheet(); res(v); };
  });
}

function askBank(p){
  return new Promise(res => {
    const cap = loanCap(p);
    openSheet(`
      <h3>银行</h3>
      <p class="sub">月息 ${(loanRate() * 100).toFixed(2)}%　可借 ${fmt(cap)} 万</p>
      <div class="kv"><span>现金</span><b>${fmt(p.cash)} 万</b></div>
      <div class="kv"><span>负债</span><b>${fmt(p.debt)} 万</b></div>
      <div class="kv"><span>净资产</span><b>${fmt(netWorth(p))} 万</b></div>
      <div class="kv"><span>杠杆率</span><b style="${cappedFor(p) ? "" : "color:#B3261E"}">${Math.round(leverage(p) * 100)}%${cappedFor(p) ? "" : "（不受上限保护）"}</b></div>
      <p class="sub" style="margin-top:6px">${cappedFor(p)
        ? `杠杆率超过 ${CFG.levThreshold * 100}% 后，单次过路费将不再封顶。`
        : `<b style="color:#B3261E">已超过 ${CFG.levThreshold * 100}% 杠杆线，被对手踩中时不再有单次上限保护。</b>`}</p>
      <div class="btns">
        <button class="btn-sub" onclick="__bank(0)">不办</button>
        <button class="btn-sub" ${p.debt > 0 ? "" : "disabled"} onclick="__bank('repay')">还款</button>
        <button class="btn-main" ${cap >= 100 ? "" : "disabled"} onclick="__bank('loan')">借款</button>
      </div>`);
    window.__bank = v => { closeSheet(); res(v); };
  });
}

function askStock(p){
  return new Promise(res => {
    const price = stockLot();
    const canBuy = p.cash >= price;
    const sp = stockPnl(p);
    openSheet(`
      <h3>证券交易所</h3>
      <p class="sub">杭州楼市指数 ${fmt(state.stockPrice)} 点　每手 100 股 ≈ ${fmt(price)} 万</p>
      <div class="kv"><span>你的持仓</span><b>${p.stock || 0} 手</b></div>
      <div class="kv"><span>持仓成本</span><b>${fmt(sp.cost)} 万</b></div>
      <div class="kv"><span>市值</span><b>${fmt(sp.value)} 万</b></div>
      <div class="kv"><span>浮动盈亏</span><b style="color:${sp.profit >= 0 ? "var(--red)" : "var(--green)"}">${sp.profit >= 0 ? "+" : ""}${fmt(sp.profit)} 万（${sp.profit >= 0 ? "+" : ""}${(sp.rate * 100).toFixed(1)}%）</b></div>
      <div class="btns">
        <button class="btn-sub" onclick="__st(0)">不办</button>
        <button class="btn-sub" ${p.stock > 0 ? "" : "disabled"} onclick="__st('sell')">卖一手</button>
        <button class="btn-main" ${canBuy ? "" : "disabled"} onclick="__st('buy')">买一手</button>
      </div>`);
    window.__st = v => { closeSheet(); res(v); };
  });
}

/* ---------------- 回合 ---------------- */
/* ---------------- 道具 ---------------- */
function itemCount(p, k){ return (p.items && p.items[k]) || 0; }

function giveItem(p, k, n = 1, quiet){
  if (!p.items) p.items = {};
  p.items[k] = (p.items[k] || 0) + n;
  if (!quiet){
    log(`<b>${p.name}</b> 获得【${ITEMS[k].name}】×${n}`, "good");
    toast(`${p.name} 得到 ${ITEMS[k].name}`);
  }
  renderItems();
}

function takeItem(p, k){
  if (!itemCount(p, k)) return false;
  p.items[k]--;
  renderItems();
  return true;
}

/* 特定格子的小概率掉落 */
function dropItem(p, k, chance, reason){
  if (Math.random() < chance){
    giveItem(p, k, 1);
    log(`　在${reason}掉落【${ITEMS[k].name}】`, "good");
  }
}

/* 机会格的随机道具：遥控骰子最常见，路障最稀有 */
function randomItemKey(){
  const r = Math.random();
  if (r < 0.40) return "dice";
  if (r < 0.70) return "stay";
  if (r < 0.90) return "uturn";
  return "block";
}

function useDiceItem(p, n){
  if (!takeItem(p, "dice")) return false;
  p.nextRoll = n;
  log(`<b>${p.name}</b> 用遥控骰子指定 <b>${n}</b> 点`, "");
  updateButton(); return true;
}
function useStayItem(p){
  if (!takeItem(p, "stay")) return false;
  p.skipMove = true;
  log(`<b>${p.name}</b> 使用停留卡，本回合原地不动`, "");
  updateButton(); return true;
}
function useUturnItem(p){
  if (!takeItem(p, "uturn")) return false;
  p.reverse = true;
  log(`<b>${p.name}</b> 使用掉头卡，下一次反向移动`, "");
  updateButton(); return true;
}
function placeBlock(p, cell){
  if (cell.t === "start" || cell.t === "jail" || cell.t === "scenic"){ toast("这里不能放路障"); return false; }
  if (cell.block){ toast("这一格已经有路障"); return false; }
  if (!takeItem(p, "block")) return false;
  cell.block = true;
  log(`<b>${p.name}</b> 在 <b>${cell.name}</b> 放置路障`, "");
  renderCells();
  return true;
}

/* ---------------- 主动技能 ---------------- */
const activeOf = p => (CHARS.find(c => c.id === p.charId) || {}).active || null;

function topRegionOf(p){
  const cnt = {};
  owned(p).forEach(c => { cnt[c.region] = (cnt[c.region] || 0) + 1; });
  const keys = Object.keys(cnt);
  if (!keys.length) return pick(Object.keys(REGIONS));
  return keys.sort((a, b) => cnt[b] - cnt[a])[0];
}

function useSkill(p, quiet){
  const a = activeOf(p);
  if (!a || p.skillCd > 0 || p.bankrupt) return false;
  let msg = "", ok = true;

  switch (p.charId){
    case "hang": {
      const gain = Math.max(80, Math.round(netWorth(p) * 0.08));
      p.cash += gain; msg = `拆迁款到账 <b>+${fmt(gain)}</b> 万`;
      break;
    }
    case "wen": {
      const amt = Math.round(Math.max(0, netWorth(p)) * 0.30);
      if (amt < 50){ ok = false; break; }
      p.cash += amt; p.debt += amt;
      msg = `配资借入 <b>+${fmt(amt)}</b> 万（负债 ${fmt(p.debt)}）`;
      break;
    }
    case "ma": {
      const gain = Math.round(80 * ((state.heat["未来科技城"] || 50) / 60));
      p.cash += gain; msg = `期权行权 <b>+${fmt(gain)}</b> 万`;
      break;
    }
    case "lian": {
      if (!p.inJail && p.scenicTurns <= 0){ ok = false; break; }
      const was = p.inJail ? "监狱" : (p.scenicName || "景区");
      p.inJail = false; p.jailFail = 0; p.scenicTurns = 0; p.scenicName = "";
      p.bonusRoll = 2;
      msg = `摇橹脱离${was}，下一次掷骰 <b>+2</b>`;
      break;
    }
    case "bao": {
      const r = topRegionOf(p);
      heatAdd([r], 15); msg = `${r} 热度 <b>+15</b>`;
      break;
    }
    case "wang": {
      const list = curCells()
        .filter(c => c.t === "plot" && !c.owner && c.unlocked && !c.broken)
        .sort((a, b) => value(a) - value(b));
      const c = list[0];
      if (!c){ ok = false; break; }
      const price = Math.round(value(c) * 0.85);
      if (p.cash < price){ ok = false; break; }
      p.cash -= price; c.owner = p; c.lv = 1; c.boughtAt = state.absMonth;
      msg = `撮合成交 <b>${c.name}</b>（${fmt(price)} 万）`;
      break;
    }
  }

  if (!ok) return false;
  p.skillCd = a.cd;
  log(`<b>${p.name}</b> 发动【${a.name}】：${msg}`, "good");
  if (!quiet) toast(`${a.name}：${msg.replace(/<[^>]+>/g, "")}`);
  renderCells(); renderHUD(); updateButton();
  return true;
}

async function roll(){
  if (state.busy || state.over || !state.started) return;
  const p = state.players[state.turnIdx];
  state.busy = true; updateButton();

  // 风景区：本回合不动，停留回合数递减
  if (p.scenicTurns > 0){
    p.scenicTurns--;
    log(`<b>${p.name}</b> 还在${p.scenicName || "景区"}，本回合不动（剩 ${p.scenicTurns} 回合）`, "");
    toast(`${p.name} 度假中`);
    await sleep(360);
    state.busy = false; nextTurn(); return;
  }

  if (p.charId === "bao" && !p.skipBao){ boostByBao(p); p.skipBao = true; }

  // 骰子：遥控骰子可指定点数；阿莲的「摇橹」给 +2
  const forced = p.nextRoll || 0;
  const raw = forced || (1 + rnd(6));
  p.nextRoll = 0;
  const bonus = p.bonusRoll || 0; p.bonusRoll = 0;
  const dir = p.reverse ? -1 : 1;
  p.reverse = false;

  // 监狱：掷出偶数出狱；连续 3 次未掷出则第 4 回合强制出狱
  if (p.inJail){
    const forcedOut = p.jailFail >= CFG.jailFailMax;
    const even = raw % 2 === 0;
    if (forcedOut || even){
      const why = forcedOut ? "关押期满，依法释放" : `掷出 ${raw}（偶数），获释`;
      p.inJail = false; p.jailFail = 0;
      log(`<b>${p.name}</b> ${why}，前进 ${raw + bonus} 格`, "good");
      toast(forcedOut ? "关押期满" : "掷出偶数，出狱");
      await sleep(380);
      await move(p, raw + bonus, 1);
      await landOn(p, curCells()[p.pos]);
      await settle(p);
    } else {
      p.jailFail++;
      log(`<b>${p.name}</b> 掷出 ${raw}（奇数），继续关押（${p.jailFail}/${CFG.jailFailMax}）`, "bad");
      toast("奇数，继续关押");
      await sleep(420);
    }
    state.busy = false; nextTurn(); return;
  }

  // 停留卡：本回合不移动，但重新触发脚下的地块（V1.5 改）
  if (p.skipMove){
    p.skipMove = false;
    const here = curCells()[p.pos];
    log(`<b>${p.name}</b> 用停留卡原地不动，重新触发 <b>${here.name}</b>`, "");
    toast(`${p.name} 停留在${here.name}`);
    await sleep(320);
    if (here.t === "start"){
      payPassGo(p, "停在起点");
    } else {
      await landOn(p, here);
      await settle(p);
    }
    renderHUD();
    state.busy = false; nextTurn(); return;
  }

  const sum = raw + bonus;
  toast(`${p.name} 掷出 ${raw}${bonus ? `+${bonus}` : ""} = ${sum}${dir < 0 ? "（反向）" : ""}`);
  await sleep(380);

  await move(p, sum, dir);
  await landOn(p, curCells()[p.pos]);
  await settle(p);

  state.busy = false;
  nextTurn();
}

/* 起点结算：正向经过、反向重回、停在起点，三种情况共用 */
function payPassGo(p, how){
  const extra = Math.round(Math.max(0, p.cash) * CFG.passGoRate);
  const bonus = CFG.passGo + extra;
  p.cash += bonus;
  log(`<b>${p.name}</b> ${how || "经过起点"}，月供 +${CFG.passGo} 万，另按现金 ${CFG.passGoRate * 100}% 得 +${fmt(extra)} 万，共 <b>+${fmt(bonus)}</b> 万`, "good");
  return bonus;
}

async function move(p, steps, dir = 1){
  const cells = curCells(), n = cells.length;
  for (let i = 0; i < steps; i++){
    const prev = p.pos;
    p.pos = (p.pos + dir + n) % n;
    // 正反向经过起点都结算（V1.5 改：反向不再例外）
    if (p.pos === 0 && prev !== 0){
      payPassGo(p, dir > 0 ? "经过起点" : "反向重回起点");
    }
    renderTokens();
    await sleep(130);
    // 路障：拦停并消耗
    const c = cells[p.pos];
    if (c && c.block){
      c.block = false;
      log(`<b>${p.name}</b> 在 ${c.name} 被路障拦停`, "bad");
      toast("被路障拦下");
      renderCells();
      await sleep(240);
      break;
    }
  }
}

async function landOn(p, c){
  if (!c) return;
  if (c.t === "start") return;

  if (c.t === "plot"){
    if (!c.unlocked) return;
    if (c.broken && !c.owner) return;

    if (!c.owner){
      if (state.freezeBuy > 0){ log(`<b>${p.name}</b> 遇交易冻结，本月不能买地`, "bad"); return; }
      if (p.skipBuy){ p.skipBuy = false; log(`<b>${p.name}</b> 遇土拍熔断`, ""); return; }
      if (state.freezeRegion && state.freezeRegion.region === c.region && state.absMonth < state.freezeRegion.until){
        log(`<b>${p.name}</b> ${c.region} 冻结交易中，买不了`, "bad"); return;
      }
      if (hasPolicy("limitBuy") && owned(p).length >= 2){
        log(`<b>${p.name}</b> 名下已有 2 套，限购中不能买地`, "bad"); return;
      }
      if (p.human){
        const ok = await askBuy(p, c);
        if (ok){
          const won = await lotteryCheck(p, c);
          if (won) buy(p, c); else log(`<b>${p.name}</b> 摇号未中，${c.name} 没抢到`, "bad");
        } else log(`<b>${p.name}</b> 放弃 ${c.name}`, "");
      } else {
        await sleep(280);
        if (aiBuy(p, c)){
          if (await lotteryCheck(p, c)) buy(p, c);
        } else log(`<b>${p.name}</b> 看了看 ${c.name}，没出手`, "");
      }
    } else if (c.owner === p){
      if (c.lv < c.maxLv && !c.broken){
        if (p.human){
          const ok = await askUpgrade(p, c);
          if (ok) upgrade(p, c);
        } else {
          await sleep(240);
          if (aiUpgrade(p, c)) upgrade(p, c);
        }
      }
    } else {
      const t = tollFor(p, c);
      p.cash -= t.pay; c.owner.cash += t.pay;
      const chain = t.pay > 0 && adjacentBonus(c) > 1 ? "（连片 ×2）" : "";
      log(`<b>${p.name}</b> 踩到 ${c.owner.name} 的 ${c.name}${chain}，付过路费 <b>-${fmt(t.pay)}</b> 万`, "bad");
      if (t.cut > 0) log(`　单次上限为净资产 ${CFG.tollCap * 100}%，经调解减免 ${fmt(t.cut)} 万`, "sys");
      if (t.exempt) log(`　杠杆率 ${Math.round(leverage(p) * 100)}%，超过 ${CFG.levThreshold * 100}%，不享受上限保护`, "sys");
    }
    renderCells(); renderHUD();
    return;
  }

  if (c.t === "chance" || c.t === "fate"){
    await drawCard(p, c.t === "chance" ? CHANCE : FATE, c.t === "chance" ? "机会" : "命运");
    if (c.t === "chance" && Math.random() < CFG.items.chanceDrop){
      giveItem(p, randomItemKey(), 1);
    }
    return;
  }

  if (c.t === "bank"){
    if (p.human){
      const act = await askBank(p);
      if (act === "loan") doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
      if (act === "repay") doRepay(p, Math.min(p.debt, p.cash));
    } else if (p.cash < aiNeed(p) && loanCap(p) >= 100 && Math.random() < DIFF[state.diff].lever){
      doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
    }
    renderHUD(); return;
  }

  if (c.t === "stock"){
    let bought = false;
    if (p.human){
      const act = await askStock(p);
      if (act === "buy"){ buyStock(p, 1); bought = true; log(`<b>${p.name}</b> 买入 1 手指数 @${fmt(stockLot())} 万`, ""); }
      if (act === "sell"){ sellStock(p, 1); log(`<b>${p.name}</b> 卖出 1 手指数 @${fmt(stockLot())} 万`, ""); }
    } else if (p.cash > aiNeed(p) * 2.2 && Math.random() < 0.4){
      buyStock(p, 1); bought = true;
      log(`<b>${p.name}</b> 买入 1 手指数`, "");
    }
    if (bought) dropItem(p, "uturn", CFG.items.stockUturn, "买入指数");
    renderHUD(); return;
  }

  if (c.t === "jail"){ sendToJail(p, "踩进监狱"); return; }

  if (c.t === "scenic"){
    let n = rollScenicStay();
    if (p.charId === "lian") n = Math.ceil(n / 2);   // 阿莲：景区停留减半
    p.scenicTurns = n; p.scenicName = c.fullName || c.name;
    log(`<b>${p.name}</b> 去了${c.fullName || c.name}，掷出 ${n}，要停留 ${n} 回合`, "bad");
    toast(`${p.name} 在${c.name}停留 ${n} 回合`);
    renderHUD();
    await sleep(420);
    return;
  }

  if (c.t === "tax"){
    const t = Math.round(netWorth(p) * CFG.taxRate);
    p.cash -= t;
    log(`<b>${p.name}</b> 缴税 <b>-${fmt(t)}</b> 万`, "bad");
    dropItem(p, "stay", CFG.items.taxStay, "税务局");
    renderHUD(); return;
  }
}

/* 风景区停留回合：1 回合 50%、2 回合 25%……6 回合 1% */
function rollScenicStay(){
  let r = Math.random() * 100;
  const odds = CFG.scenicOdds;
  for (let i = 0; i < odds.length; i++){
    if (r < odds[i]) return i + 1;
    r -= odds[i];
  }
  return 1;
}

function sendToJail(p, reason){
  const j = curCells().findIndex(x => x.t === "jail");
  if (j >= 0) p.pos = j;
  p.inJail = true; p.jailFail = 0; p.scenicTurns = 0;
  renderTokens(); renderHUD();
  log(`<b>${p.name}</b> ${reason || "被带走调查"}，需掷出偶数才能继续前进`, "bad");
  dropItem(p, "block", CFG.items.jailBlock, "监狱");
}

async function lotteryCheck(p, c){
  if (!hasPolicy("lottery") || state.heat[c.region] < 60 || p.freePass){
    if (p.freePass) p.freePass = false;
    return true;
  }
  const rate = Math.max(0.15, Math.min(0.7, 0.85 - state.heat[c.region] / 150));
  const win = Math.random() < rate;
  if (!win) log(`<b>${p.name}</b> 摇号未中，${c.name} 没抢到（中签率 ${Math.round(rate * 100)}%）`, "bad");
  if (p.human){ toast(win ? "摇号中签！" : "摇号未中"); await sleep(600); }
  return win;
}

async function drawCard(p, deck, kind){
  const card = deck[rnd(deck.length)];
  const res = card.act(p);
  log(`<b>${p.name}</b> 抽到【${kind}·${card.t}】：${res}`, String(res).includes("−") ? "bad" : "good");
  toast(`${kind} · ${card.t}`);
  renderHUD(); renderCells();
  await sleep(380);
}

function buy(p, c){
  const price = value(c);
  const fee = Math.round(price * (p.charId === "wang" ? 0.015 : 0.03));
  p.cash -= price + fee;
  c.owner = p; c.lv = 1; c.boughtAt = state.absMonth;
  log(`<b>${p.name}</b> 买入 <b>${c.name}</b>（${fmt(price)} 万 + 税 ${fmt(fee)}）`, "good");
  renderCells(); renderHUD();
}

function upgrade(p, c){
  const cost = upCost(c);
  p.cash -= cost; c.lv++;
  log(`<b>${p.name}</b> 把 ${c.name} 升到 <b>Lv${c.lv}</b>（${fmt(cost)} 万）`, "good");
  renderCells(); renderHUD();
}

function sellLand(p, c){
  if (hasPolicy("noSell") && state.absMonth - c.boughtAt < 3){ return false; }
  let price = value(c) * CFG.sellRate;
  if (hasPolicy("pricecap")) price = Math.min(price, c.price * eraF() * 1.5);
  price = Math.round(price * (p.charId === "wang" ? 0.985 : 0.97));
  p.cash += price;
  c.owner = null; c.lv = 0; c.broken = false; c.boost = 0;
  log(`<b>${p.name}</b> 卖掉 ${c.name}，回笼 <b>+${fmt(price)}</b> 万`, "bad");
  renderCells(); renderHUD();
  return true;
}

function doLoan(p, amt){
  if (amt <= 0) return;
  p.cash += amt; p.debt += amt;
  log(`<b>${p.name}</b> 借款 <b>+${fmt(amt)}</b> 万（负债 ${fmt(p.debt)}）`, "");
  renderHUD();
}
function doRepay(p, amt){
  amt = Math.min(amt, p.cash, p.debt);
  if (amt <= 0) return;
  p.cash -= amt; p.debt -= amt;
  log(`<b>${p.name}</b> 还款 <b>-${fmt(amt)}</b> 万`, "");
  renderHUD();
}

/* 物业费：每月按地价 0.15%，空地减半 */
function mgmtFee(p){
  return owned(p).reduce((s, c) =>
    s + Math.round(value(c) * (c.lv === 0 ? CFG.mgmtVacantRate : CFG.mgmtRate)), 0);
}

/* 强制拍卖：其他玩家按 85 折接手；无人接手则 7 折抵押给银行，所得先抵债 */
function liquidate(p){
  const plots = owned(p).slice().sort((a, b) => value(b) - value(a));
  if (!plots.length) return 0;
  let raised = 0;
  plots.forEach(c => {
    const price = Math.round(value(c) * 0.85);
    const buyers = state.players
      .filter(x => !x.bankrupt && x !== p && x.cash - price >= aiNeed(x) * 0.5)
      .sort((a, b) => b.cash - a.cash);
    const taker = buyers[0];
    if (taker && Math.random() < 0.7){
      taker.cash -= price;
      c.owner = taker; c.boughtAt = state.absMonth;
      raised += price;
      log(`强制拍卖：<b>${taker.name}</b> 以 ${fmt(price)} 万接手 ${c.name}`, "");
    } else {
      const mv = Math.round(value(c) * 0.7);
      c.owner = null; c.lv = 0; c.broken = false; c.boost = 0;
      raised += mv;
      log(`强制拍卖：${c.name} 无人接手，按 7 折 ${fmt(mv)} 万抵押给银行`, "");
    }
  });
  p.cash += raised;
  const pay = Math.min(Math.max(0, p.cash), p.debt);
  p.cash -= pay; p.debt -= pay;
  return raised;
}

function startLiquidation(p){
  if (p.liquidating) return;
  p.liquidating = true;
  p.liqDeadline = state.absMonth + CFG.liqMonths;
  const n = owned(p).length;
  log(`<b>${p.name}</b> 资不抵债，启动破产清算：名下 ${n} 宗地被强制拍卖`, "bad");
  const raised = liquidate(p);
  if (p.debt <= 0){
    p.liquidating = false;
    log(`<b>${p.name}</b> 拍卖回笼 ${fmt(raised)} 万，债务已清偿，退出清算`, "sys");
  } else {
    log(`<b>${p.name}</b> 仍有 ${fmt(p.debt)} 万债务，${CFG.liqMonths} 个月内未还清将出局`, "bad");
  }
  renderCells(); renderHUD();
}

/* 现金为负：先卖地，再考虑免死，最后出局 */
async function settle(p){
  if (p.cash >= 0 || p.bankrupt) return;
  const list = owned(p).sort((a, b) => value(a) - value(b));
  for (const c of list){
    if (p.cash >= 0) break;
    if (!sellLand(p, c)) log(`<b>${p.name}</b> 想卖 ${c.name}，限售期内卖不掉`, "bad");
    await sleep(180);
  }
  if (p.cash < 0){
    if (p.charId === "hang" && !p.savedOnce){
      p.savedOnce = true; p.cash = 1;
      log(`<b>${p.name}</b> 靠祖宅底气撑住了，免于出局`, "sys");
      return;
    }
    p.bankrupt = true;
    const plots = owned(p);
    plots.forEach(c => { c.owner = null; c.lv = 0; c.broken = false; });
    log(`<b>${p.name}</b> 资金链断裂出局，名下 ${plots.length} 宗地进入法拍`, "bad");
    auction(plots, p);
    renderCells(); renderHUD();
    await sleep(500);
  }
}

/* 法拍：按现金从高到低，愿意且买得起的接盘，6 折 */
function auction(plots, exclude){
  if (!plots.length) return;
  const buyers = state.players.filter(x => !x.bankrupt && x !== exclude).sort((a, b) => b.cash - a.cash);
  plots.forEach(c => {
    const price = Math.round(c.price * eraF() * 0.6);
    const taker = buyers.find(b => b.cash >= price + 100 && Math.random() < 0.6);
    if (taker){
      taker.cash -= price; c.owner = taker; c.lv = 1; c.boughtAt = state.absMonth;
      log(`法拍：<b>${taker.name}</b> 以 ${fmt(price)} 万拍下 ${c.name}`, "");
    }
  });
}

/* ---------------- AI ----------------
   每个角色一套风险偏好：lev = 目标杠杆上限，sellAt = 现金跌到安全垫的多少比例才卖地，
   buy = 买地门槛（越低越敢出手）。温老板低 sellAt + 高 lev，就是「暴富与爆仓」的来源。
   V1.1 经济下的三条原则：
   1. 现金垫按「平均一次过路费」算，不再按「每圈白拿 150 万」算
   2. 连片让过路费翻倍，所以相邻自有地是最高优先级的购买理由
   3. 夹在对手两格中间的地，买下就是拆掉对手的 ×2
*/
const RISK = {
  hang: { lev:0.20, sellAt:0.30, buy:1.00 },   // 稳健：不借多，也不慌着卖
  wen:  { lev:0.55, sellAt:0.10, buy:0.85 },   // 激进：借到上限，几乎不止损
  ma:   { lev:0.35, sellAt:0.25, buy:0.95 },   // 单点重仓
  lian: { lev:0.12, sellAt:0.35, buy:1.05 },   // 收租流：最不爱借钱，但也不乱卖
  bao:  { lev:0.40, sellAt:0.15, buy:0.85 },   // 投机
  wang: { lev:0.25, sellAt:0.28, buy:0.90 }    // 情报流
};
const riskOf = p => RISK[p.charId] || RISK.hang;

function avgToll(p){
  const plots = allCells().filter(c => c.t === "plot" && c.owner && c.owner !== p && c.lv > 0 && !c.broken);
  if (!plots.length) return 0;
  const avg = plots.reduce((s, c) => s + tollOf(c), 0) / plots.length;
  return cappedFor(p) ? Math.min(avg, Math.max(0, netWorth(p)) * CFG.tollCap) : avg;
}
/* 目标现金垫：够付一次平均过路费 + 两个月利息 */
function aiNeed(p){
  const d = DIFF[state.diff];
  const interest = Math.round(p.debt * loanRate());
  return Math.round(avgToll(p) * d.reserve + interest * 2 + 60);
}

function aiBuy(p, c){
  const d = DIFF[state.diff];
  const price = value(c);
  const fee = Math.round(price * (p.charId === "wang" ? 0.015 : 0.03));
  if (p.cash - price - fee < 0) return false;
  if (hasPolicy("limitBuy") && owned(p).length >= 2) return false;

  const adj = adjCount(p, c);
  const need = aiNeed(p);
  // 名下没有地块：只要能负担就买——无地等于没有收入，拖下去必死
  if (!owned(p).length && p.cash - price - fee >= need * 0.3) return true;
  // 若场上还有「贴着我的地」的空地，留钱等它，别把钱花在无关地块上
  const hasAdjTarget = d.vision >= 1 && allCells().some(x =>
    x.t === "plot" && !x.owner && x.unlocked && !x.broken && adjCount(p, x) > 0);
  const reserve = need * (adj ? 0.5 : (hasAdjTarget ? 1.8 : 1)) * (0.55 + 0.45 * riskOf(p).sellAt / 0.6);
  if (p.cash - price - fee < reserve) return false;

  // 跟风型：只看热度，冷区不碰
  if (d.vision === 0 && state.heat[c.region] < 50 && Math.random() < 0.6) return false;

  // 算账型以上：连片必买——过路费直接翻倍，这是新经济里最值钱的一格
  if (adj) return true;
  // 夹在对手两格中间：买下就拆掉对方的 ×2
  const victim = sandwichedOwner(c);
  if (victim && victim !== p && d.vision >= 1) return true;

  // 其余情况：热度够、或者便宜到能顺手拿下
  return state.heat[c.region] >= 48 || price < p.cash * 0.55 || Math.random() < 0.25;
}

function aiUpgrade(p, c){
  const d = DIFF[state.diff];
  const cost = upCost(c);
  const g = UP_GATE[c.lv + 1] || {};
  if (state.absMonth - c.boughtAt < (g.m || 0)) return false;
  if (state.heat[c.region] < (g.h || 0)) return false;
  const adj = adjCount(p, c);
  if (p.cash - cost < aiNeed(p) * (adj ? 0.6 : 1)) return false;
  let prob = 0.45 + 0.35 * d.lever;
  if (d.vision >= 1 && adj) prob += 0.25;   // 连片地块升级，收益是双份
  return Math.random() < prob;
}

/* 市场上在售地块的中位价，用来估算「落地时买得起」需要多少现金 */
function marketPrice(){
  const list = allCells().filter(c => c.t === "plot" && c.unlocked && !c.owner && !c.broken);
  if (!list.length) return 0;
  const arr = list.map(value).sort((a, b) => a - b);
  return arr[Math.floor(arr.length * 0.35)];   // 取偏低价位，AI 不必总盯着最贵的
}

function aiPreTurn(p){
  const d = DIFF[state.diff];
  const need = aiNeed(p);
  const interest = Math.round(p.debt * loanRate());

  const risk = riskOf(p);

  // 1) 保命：现金跌破各自的止损线就卖地，先卖「不连片、单价低」的
  if (p.cash < need * risk.sellAt){
    const list = owned(p)
      .filter(c => !(hasPolicy("noSell") && state.absMonth - c.boughtAt < 3))
      .sort((a, b) => (value(a) * (adjCount(p, a) ? 2 : 1)) - (value(b) * (adjCount(p, b) ? 2 : 1)));
    for (const c of list){
      if (p.cash >= need * 0.7) break;
      sellLand(p, c);
    }
  }

  // 2) 备弹：新经济下「现金主要来自对手」，所以要有钱在落地时出手。
  //    月租 0.8%—2.0% 高于贷款月息 0.48%，借钱买地是正利差，值得加杠杆。
  // 借钱只为「能立刻拿下一块地」，不为囤现金——否则白付利息，净资产会被拖成负数
  const mkt = marketPrice();
  const ammo = need + mkt * (risk.lev >= 0.35 ? 1.6 : 0.5);
  const lev = p.debt / Math.max(1, netWorth(p));
  // 角色风险偏好 × 难度系数：老狐狸比跟风型更敢借
  const maxLev = Math.min(0.6, risk.lev * (0.75 + 0.5 * d.lever));
  if (mkt > 0 && p.cash < ammo && lev < maxLev && loanCap(p) >= 100){
    const want = Math.min(ammo - p.cash, loanCap(p), CFG.loanStep);
    // 借完的现金至少要够买一块市场价的地，否则不借
    if (want >= 80 && p.cash + want >= mkt) doLoan(p, Math.round(want));
  }

  // 3) 现金远超备弹且有利息负担：先还一部分，别为闲置的钱付息
  if (p.debt > 0 && interest > 0 && p.cash > ammo * 2 && Math.random() < 0.6){
    doRepay(p, Math.min(p.debt, Math.round((p.cash - ammo * 1.4) * 0.6)));
  }

  // 4) 主动技能与道具
  aiUseSkill(p);
  aiUseItems(p);
}

/* ---------------- AI 的道具与技能 ----------------
   和人类用同一套接口，只是判据是启发式。不给 AI 用会直接导致人类碾压。
*/
function cellAhead(p, k){
  const cells = curCells(), n = cells.length;
  return cells[((p.pos + k) % n + n) % n];
}
function tollAhead(p, k){
  const c = cellAhead(p, k);
  if (!c || c.t !== "plot" || !c.owner || c.owner === p) return 0;
  return tollFor(p, c).pay;
}

function aiUseSkill(p){
  if (p.skillCd > 0) return;
  if (!activeOf(p)) return;
  const need = aiNeed(p);
  const mkt = marketPrice();
  switch (p.charId){
    // 白拿钱的技能：冷却一好就用
    case "hang": useSkill(p, true); break;
    case "ma":   useSkill(p, true); break;
    // 会产生负债的：只在缺钱时用
    case "wen":  if (p.cash < mkt) useSkill(p, true); break;
    // 解除限制的：只在被限制时用
    case "lian": if (p.inJail || p.scenicTurns > 0) useSkill(p, true); break;
    // 加热度：冷却一好就用
    case "bao":  useSkill(p, true); break;
    // 要花钱买地：现金够才用
    case "wang": if (p.cash > mkt * 1.2) useSkill(p, true); break;
  }
}

function aiUseItems(p){
  if (p.inJail){
    // 关押中：有遥控骰子就指定偶数直接出狱
    if (itemCount(p, "dice")) useDiceItem(p, 2);
    return;
  }
  if (p.scenicTurns > 0) return;

  const need = aiNeed(p);

  // 1) 停留卡：会重新触发脚下地块，所以只在「安全或有赚」的格子上用
  if (itemCount(p, "stay") && !p.skipMove){
    const here = curCells()[p.pos];
    const mine = here.t === "plot" && here.owner === p;
    const free = here.t === "plot" && !here.owner && here.unlocked && !here.broken;
    const safe = here.t === "start" || here.t === "chance" || here.t === "bank" || mine || free;
    if (safe){
      const canUp = mine && here.lv < here.maxLv && p.cash > upCost(here) + need * 0.5;
      const canBuy = free && p.cash > value(here) * 1.35;
      const onStart = here.t === "start" && p.cash < need * 1.5;
      const worst = Math.max(tollAhead(p, 1), tollAhead(p, 2));
      if (canUp || canBuy || onStart || worst > need * 0.8) useStayItem(p);
    }
  }

  // 2) 遥控骰子：挑一个「雷最小、收益最大」的点数
  if (itemCount(p, "dice") && !p.nextRoll){
    let best = 0, bestScore = -Infinity, worst = 0;
    for (let k = 1; k <= 6; k++){
      const c = cellAhead(p, k);
      const toll = tollAhead(p, k);
      worst = Math.max(worst, toll);
      let sc = -toll;
      if (c.t === "plot" && !c.owner && c.unlocked && !c.broken) sc += value(c) * 0.03;
      if (c.t === "plot" && c.owner === p) sc += 30;
      if (c.t === "chance") sc += 25;
      if (c.t === "jail" || c.t === "scenic") sc -= 80;
      if (sc > bestScore){ bestScore = sc; best = k; }
    }
    if (worst > need * 0.7 && bestScore > -worst * 0.4 && Math.random() < 0.6) useDiceItem(p, best);
  }

  // 3) 路障：放在自己过路费最高的地块上，等对手来踩
  if (itemCount(p, "block") && Math.random() < 0.55){
    const mine = owned(p).filter(c => c.lv >= 2 && !c.block).sort((a, b) => tollOf(b) - tollOf(a));
    if (mine.length && tollOf(mine[0]) > need * 0.6) placeBlock(p, mine[0]);
  }

  // 4) 掉头卡：后方有便宜地可捡，或前方连着重雷
  if (itemCount(p, "uturn") && !p.reverse && Math.random() < 0.6){
    const ahead = Math.max(tollAhead(p, 1), tollAhead(p, 2), tollAhead(p, 3));
    const b1 = cellAhead(p, -1), b2 = cellAhead(p, -2);
    const grab = [b1, b2].some(c => c.t === "plot" && !c.owner && c.unlocked && !c.broken && p.cash > value(c) * 1.3);
    if (grab || ahead > need * 0.6) useUturnItem(p);
  }
}

function boostByBao(p){
  const mine = owned(p);
  const region = mine.length ? mine.sort((a, b) => value(b) - value(a))[0].region : pick(Object.keys(REGIONS));
  heatAdd([region], 5);
}

/* ---------------- 月份推进 ---------------- */
function nextTurn(){
  if (state.over) return;
  if (state.players.filter(p => !p.bankrupt).length <= 1) return endChapter(true);

  let guard = 0;
  do {
    state.turnIdx = (state.turnIdx + 1) % state.players.length;
    guard++;
  } while (state.players[state.turnIdx].bankrupt && guard < 10);

  const alive = state.players.filter(p => !p.bankrupt).length;
  state.turnCount++;
  let newMonth = false;
  if (state.turnCount >= alive){ state.turnCount = 0; newMonth = true; endMonth(); }

  renderHUD(); updateButton();
  const p = state.players[state.turnIdx];
  if (!state.over) logSep(p, newMonth);
  if (!p.human && !state.over){
    aiPreTurn(p);
    setTimeout(roll, FAST ? 0 : 380);
  }
}

async function endMonth(){
  state.absMonth++;
  if (state.freezeBuy > 0) state.freezeBuy--;

  // 租金与利息
  state.players.forEach(p => {
    if (p.bankrupt) return;
    const r = owned(p).reduce((s, c) => s + rentOf(c), 0);
    if (r > 0){ p.cash += r; }
    const fee = mgmtFee(p);
    if (fee > 0) p.cash -= fee;
    if (p.human && (r > 0 || fee > 0)){
      log(`　本月租金 <b>+${fmt(r)}</b> 万，物业费 <b>-${fmt(fee)}</b> 万`, "");
    }
    owned(p).forEach(c => {
      if (c.boost > 0) c.boost--;
      else if (c.boost < 0) c.boost++;
      if (c.boost === 0) c.boost = 0;
    });
    if (p.skillCd > 0) p.skillCd--;
    if (p.debt > 0) p.cash -= Math.round(p.debt * loanRate());
    if (p.bridge > 0){ p.bridge--; if (p.bridge === 0) p.cash -= 200; }
    p.revalue = 1;
    if (p.charId === "ma" && state.absMonth % 12 === 0){
      const bonus = Math.round(60 * (state.heat["未来科技城"] / 60));
      p.cash += bonus;
      log(`<b>${p.name}</b> 期权变现 <b>+${fmt(bonus)}</b> 万`, "good");
    }
    if (p.charId === "bao" && state.absMonth % 6 === 0){
      const r2 = pick(Object.keys(REGIONS));
      heatAdd([r2], -12);
      log(`<b>${p.name}</b> 舆情翻车，${r2} 热度 −12`, "bad");
    }
    p.skipBao = false;
  });

  // 股票：月度收盘价，同时留一条 K 线（开盘 = 上月收盘）
  const prevPrice = state.stockPrice;
  state.stockPrice = Math.max(200, Math.round(prevPrice * (0.96 + Math.random() * 0.08)));
  state.stockHistory = state.stockHistory || [];
  state.stockHistory.push({ m: state.absMonth, o: prevPrice, c: state.stockPrice });
  if (state.stockHistory.length > 120) state.stockHistory.shift();

  // 历史事件
  EVENTS.forEach(e => {
    if (e.m === state.absMonth && !state.fired[e.key]){
      state.fired[e.key] = true;
      if (e.fn) e.fn();
      if (e.policy) setPolicy(e.key, e.until == null ? null : e.until);
      state.mods.push({
        key:e.key, kind:e.kind, name:e.name, detail:e.detail,
        start:state.absMonth, until:e.until == null ? null : e.until
      });
      log(`<b>【${monthLabel(e.m)} ${e.name}】</b>${e.desc}`, "sys");
      toast(e.name);
    }
    if (e.until === state.absMonth){
      const before = state.mods.length;
      state.mods = state.mods.filter(m => m.key !== e.key);
      if (state.mods.length !== before) log(`<b>${e.name} 到期解除</b>`, "sys");
    }
  });

  // 地块解锁
  curCells().forEach(c => {
    if (c.t === "plot" && !c.unlocked && c.unlock === chapterMonth()) c.unlocked = true;
  });

  // 资不抵债 → 强制拍卖；清算期内未还清则出局
  state.players.forEach(p => {
    if (p.bankrupt) return;
    if (p.liquidating){
      if (p.debt <= 0){
        p.liquidating = false;
        log(`<b>${p.name}</b> 债务已清偿，解除清算`, "sys");
      } else if (state.absMonth >= p.liqDeadline){
        p.bankrupt = true;
        log(`<b>${p.name}</b> 清算期满仍有 ${fmt(p.debt)} 万债务未还，宣告破产出局`, "bad");
      }
    } else if (netWorth(p) < 0){
      startLiquidation(p);
    }
  });

  // 被关押或度假的玩家不掷骰，负现金不会经过 settle()，这里补一次
  state.players.forEach(p => { if (!p.bankrupt && p.cash < 0) settle(p); });

  renderCells(); renderHUD();

  if (chapterMonth() >= curCh().months) endChapter(false);
}

/* ---------------- 结算 ---------------- */
function endChapter(early){
  if (state.over) return;
  state.over = true;

  const rank = state.players
    .map(p => ({ p, net: p.bankrupt ? -1 : netWorth(p) }))
    .sort((a, b) => b.net - a.net);

  let meIdx = rank.findIndex(r => r.p.human);
  if (meIdx < 0) meIdx = rank.findIndex(r => r.p.id === 0);
  const me = meIdx + 1;
  const mine = netWorth(state.players[0]);
  const grade = me === 1 ? "S" : me === 2 ? "A" : me === 3 ? "B" : "C";

  const rows = rank.map((r, i) => `
    <div class="rank-row">
      <span><span class="medal">${["🥇","🥈","🥉","4"][i]}</span><b style="color:${r.p.color}">${r.p.name}</b>${r.p.bankrupt ? "（出局）" : ""}</span>
      <b>${r.p.bankrupt ? "—" : fmt(r.net) + " 万"}</b>
    </div>`).join("");

  const isLast = state.chapter >= CHAPTERS.length - 1;
  openSheet(`
    <h3>${curCh().name} · 结算</h3>
    <p class="sub">评级 <b style="font-size:20px;color:var(--gold)">${grade}</b>　第 ${me} 名　净资产 ${fmt(mine)} 万${early ? "（提前结束）" : ""}</p>
    ${rows}
    <p class="sub" style="margin-top:10px">${isLast ? "战役结束。十六年走完，你在这座城市留下了什么？" : `下一章起始资金 = 净资产 × ${CFG.inheritRate * 100}%，并保留 1 宗地块作为时代遗产。`}</p>
    <div class="btns">
      <button class="btn-sub" onclick="__close()">看看棋盘</button>
      ${isLast ? `<button class="btn-main" onclick="__restart()">重开一局</button>`
               : `<button class="btn-main" onclick="__next()">进入下一章</button>`}
    </div>`);
  window.__close = () => closeSheet();
  window.__restart = () => { closeSheet(); startScreen(); };
  window.__next = () => { closeSheet(); nextChapter(); };

  log(`<b>${curCh().name}结束</b>：${rank[0].p.name} 以 ${fmt(rank[0].net)} 万净资产胜出。评级 ${grade}。`, "sys");
  updateButton(); renderHUD();
  if (SIM && !isLast) setTimeout(nextChapter, 400);
}

function nextChapter(){
  closeSheet();
  const next = state.chapter + 1;
  if (next >= CHAPTERS.length) return;

  // 资产继承：净资产 × 40%，保留 1 宗最贵地块
  state.players.forEach(p => {
    if (p.bankrupt) return;          // 已出局者不复活：复活后无地无收入，下章必死
    const plots = owned(p).sort((a, b) => value(b) - value(a));
    const keep = plots[0];
    const keepLv = keep ? keep.lv : 0;
    const cash = Math.max(0, Math.round(netWorth(p) * CFG.inheritRate));
    allCells().forEach(c => { if (c.t === "plot" && c.owner === p) { c.owner = null; c.lv = 0; c.broken = false; c.boost = 0; } });
    /* keep.lv 必须在清空之后再写回，否则读到的是刚被清零的 0 */
    if (keep){ keep.owner = p; keep.lv = Math.max(1, keepLv); keep.boughtAt = state.absMonth; }
    p.cash = cash; p.debt = 0; p.pos = 0; p.bankrupt = false;
    p.stock = 0; p.bridge = 0; p.revalue = 1;
    p.inJail = false; p.jailFail = 0; p.scenicTurns = 0; p.scenicName = "";
    p.liquidating = false; p.liqDeadline = 0;
    p.nextRoll = 0; p.reverse = false; p.skipMove = false; p.bonusRoll = 0; p.skillCd = 0;
  });

  state.chapter = next;
  state.absMonth = CHAPTERS[next].from;
  state.turnIdx = 0; state.turnCount = 0; state.over = false; state.busy = false;
  state.mods = []; state.fired = {};
  // 只保留已发生的事件记录，避免重复触发
  EVENTS.forEach(e => { if (e.m < state.absMonth) state.fired[e.key] = true; });

  render();
  $("#log").innerHTML = "";
  log(`<b>${CHAPTERS[next].name}</b> 开始。资产按 40% 折算，保留 1 宗地块。`, "sys");
  updateButton();
  if (!state.players[state.turnIdx].human) setTimeout(roll, FAST ? 0 : 500);
}

/* ---------------- 存档 ---------------- */
function serialize(){
  return {
    v:1, chapter:state.chapter, absMonth:state.absMonth, turnIdx:state.turnIdx, turnCount:state.turnCount,
    heat:state.heat, mods:state.mods, fired:state.fired, stockPrice:state.stockPrice,
    stockHistory: state.stockHistory || [],
    freezeBuy:state.freezeBuy, freezeRegion:state.freezeRegion,
    charId:state.charId, diff:state.diff,
    cells: allCells().filter(c => c.t === "plot").map(c => ({
      ring:c.ring, idx:c.idx, lv:c.lv, owner:c.owner ? c.owner.id : null,
      unlocked:c.unlocked, boughtAt:c.boughtAt, broken:c.broken, boost:c.boost,
      discount:c.discount, maxLv:c.maxLv, block:!!c.block
    })),
    players: state.players.map(p => ({
      id:p.id, cash:p.cash, debt:p.debt, pos:p.pos, bankrupt:p.bankrupt,
      stock:p.stock || 0, stockLots:p.stockLots || [], savedOnce:!!p.savedOnce, bridge:p.bridge || 0, freePass:!!p.freePass,
      inJail:!!p.inJail, jailFail:p.jailFail || 0, scenicTurns:p.scenicTurns || 0, scenicName:p.scenicName || "",
      liquidating:!!p.liquidating, liqDeadline:p.liqDeadline || 0,
      items:p.items || {}, skillCd:p.skillCd || 0
    }))
  };
}

function saveTo(slot){
  try { localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(serialize())); return true; }
  catch(e){ return false; }
}

function loadFrom(slot){
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return false;
    restore(d);
    return true;
  } catch(e){ return false; }
}

function restore(d){
  state.charId = d.charId; state.diff = d.diff;
  state.chapter = d.chapter; state.absMonth = d.absMonth;
  state.turnIdx = d.turnIdx; state.turnCount = d.turnCount;
  state.heat = d.heat; state.mods = d.mods; state.fired = d.fired;
  state.stockPrice = d.stockPrice; state.freezeBuy = d.freezeBuy || 0;
  state.stockHistory = Array.isArray(d.stockHistory) && d.stockHistory.length
    ? d.stockHistory
    : [{ m: d.absMonth, o: d.stockPrice, c: d.stockPrice }];
  state.freezeRegion = d.freezeRegion || null;
  state.over = false; state.busy = false; state.started = true;

  state.players.forEach(p => {
    p.cash = 0; p.debt = 0; p.pos = 0; p.bankrupt = false;
    p.stock = 0; p.stockLots = []; p.savedOnce = false; p.bridge = 0; p.freePass = false;
    p.inJail = false; p.jailFail = 0; p.scenicTurns = 0; p.scenicName = "";
    p.liquidating = false; p.liqDeadline = 0;
    p.items = Object.assign({}, CFG.items.start);
    p.skillCd = 0; p.nextRoll = 0; p.reverse = false; p.skipMove = false; p.bonusRoll = 0;
  });
  d.players.forEach(s => {
    const p = state.players[s.id];
    p.cash = s.cash; p.debt = s.debt; p.pos = s.pos; p.bankrupt = s.bankrupt;
    p.stock = s.stock; p.savedOnce = s.savedOnce; p.bridge = s.bridge; p.freePass = s.freePass;
    p.stockLots = Array.isArray(s.stockLots)
      ? s.stockLots.map(l => ({ m: l.m, price: l.price, lots: l.lots, idx: l.idx }))
      : [];
    p.inJail = !!s.inJail; p.jailFail = s.jailFail || 0;
    p.scenicTurns = s.scenicTurns || 0; p.scenicName = s.scenicName || "";
    p.liquidating = !!s.liquidating; p.liqDeadline = s.liqDeadline || 0;
    if (s.items) p.items = Object.assign({}, CFG.items.start, s.items);
    p.skillCd = s.skillCd || 0;
  });
  allCells().forEach(c => { if (c.t === "plot"){ c.owner = null; c.lv = 0; } c.block = false; });
  d.cells.forEach(s => {
    const c = state.rings[s.ring].cells[s.idx];
    if (!c) return;
    c.lv = s.lv; c.unlocked = s.unlocked; c.boughtAt = s.boughtAt;
    c.broken = s.broken; c.boost = s.boost; c.discount = s.discount; c.maxLv = s.maxLv;
    c.block = !!s.block;
    c.owner = s.owner == null ? null : state.players[s.owner];
  });
  render();
  $("#log").innerHTML = "";
  log(`读取存档：${monthLabel(state.absMonth)}，继续。`, "sys");
  updateButton();
  if (!state.players[state.turnIdx].human) setTimeout(roll, FAST ? 0 : 500);
}

/* ---------------- 开局 ---------------- */
function startScreen(){
  state.over = false; state.started = false;
  const saved = [1,2,3].map(i => localStorage.getItem(SAVE_PREFIX + i) ? i : null).filter(Boolean);

  openSheet(`
    <h3>杭州大富翁</h3>
    <p class="sub">2010—2026，十六年，四章。一回合一个月。</p>

    <p class="sub" style="margin-top:10px"><b>选角色</b></p>
    <div class="pick" id="pickChar">
      ${CHARS.map(c => `<button class="pickbtn" data-char="${c.id}" style="border-color:${c.color}33">
        <b style="color:${c.color}">${c.name}</b><span>${c.tag}</span></button>`).join("")}
    </div>
    <p class="sub" id="charDesc" style="min-height:34px"></p>

    <p class="sub"><b>选难度</b></p>
    <div class="pick" id="pickDiff">
      ${Object.keys(DIFF).map(k => `<button class="pickbtn" data-diff="${k}"><b>${DIFF[k].name}</b><span>${DIFF[k].note}</span></button>`).join("")}
    </div>

    <p class="sub"><b>从哪一章开始</b></p>
    <div class="pick" id="pickCh">
      ${CHAPTERS.map((c, i) => `<button class="pickbtn" data-ch="${i}"><b>${c.name}</b><span>${RINGS[c.ring].years}</span></button>`).join("")}
    </div>

    <div class="btns">
      ${saved.length ? `<button class="btn-sub" onclick="__load()">读档</button>` : ""}
      <button class="btn-main" id="startBtn" onclick="__start()">开始游戏</button>
    </div>`);

  let sel = { char:"hang", diff:"normal", ch:0 };
  const paint = () => {
    document.querySelectorAll("#pickChar .pickbtn").forEach(b => b.classList.toggle("on", b.dataset.char === sel.char));
    document.querySelectorAll("#pickDiff .pickbtn").forEach(b => b.classList.toggle("on", b.dataset.diff === sel.diff));
    document.querySelectorAll("#pickCh .pickbtn").forEach(b => b.classList.toggle("on", +b.dataset.ch === sel.ch));
    const c = CHARS.find(x => x.id === sel.char);
    $("#charDesc").innerHTML = `<b>${c.skill}</b><br>${c.tip}`;
  };
  document.querySelectorAll("#pickChar .pickbtn").forEach(b => b.onclick = () => { sel.char = b.dataset.char; paint(); });
  document.querySelectorAll("#pickDiff .pickbtn").forEach(b => b.onclick = () => { sel.diff = b.dataset.diff; paint(); });
  document.querySelectorAll("#pickCh .pickbtn").forEach(b => b.onclick = () => { sel.ch = +b.dataset.ch; paint(); });
  paint();

  window.__start = () => { closeSheet(); newGame(sel.char, sel.diff, sel.ch); };
  window.__load = () => { closeSheet(); if (!loadFrom(saved[0])) toast("读档失败"); };
}

function newGame(charId, diff, chapter){
  state.charId = charId; state.diff = diff; state.chapter = chapter;
  state.absMonth = CHAPTERS[chapter].from;
  state.turnIdx = 0; state.turnCount = 0;
  state.busy = false; state.over = false; state.started = true;
  state.mods = []; state.fired = {}; state.stockPrice = 1000;
  state.stockHistory = [{ m: state.absMonth, o: 1000, c: 1000 }];
  state.freezeBuy = 0; state.freezeRegion = null;

  state.heat = {};
  Object.keys(REGIONS).forEach(k => state.heat[k] = REGIONS[k].heat);

  buildRings();

  const me = CHARS.find(c => c.id === charId);
  const others = CHARS.filter(c => c.id !== charId);
  const roster = [me, ...others.slice(0, 3)];
  // 起始资金随时代系数缩放，否则第四章地价翻倍、起手钱没变，一块也买不起
  const eraAtStart = ERA[2010 + Math.floor(CHAPTERS[chapter].from / 12)] || 1;
  state.players = roster.map((c, i) => ({
    id:i, charId:c.id, name:c.name, color:c.color, trait:c.trait,
    human: SIM ? false : i === 0, cash:Math.round(c.cash * eraAtStart), debt:0, pos:0, stock:0, stockLots:[],
    bankrupt:false, savedOnce:false, skipBuy:false, freePass:false,
    bridge:0, revalue:1, skipBao:false, risk:0,
    inJail:false, jailFail:0, scenicTurns:0, scenicName:"",
    liquidating:false, liqDeadline:0,
    items: Object.assign({}, CFG.items.start, c.items || {}),
    skillCd:0, nextRoll:0, reverse:false, skipMove:false, bonusRoll:0
  }));

  // 从中途章节开局：把此前发生过的事件补演一遍，保证热度、政策、等级上限与历史一致
  EVENTS.filter(e => e.m < state.absMonth).forEach(e => {
    if (e.fn && e.key !== "covid") e.fn();
    if (e.policy) setPolicy(e.key, e.until == null ? null : e.until);
    state.fired[e.key] = true;
  });

  render();
  $("#log").innerHTML = "";
  log(`<b>${curCh().name}</b> 开始。${monthLabel(state.absMonth)}，${me.name} 带着 ${fmt(state.players[0].cash)} 万进场。`, "sys");
  log(`对手：${others.slice(0, 3).map(c => c.name).join("、")}。`, "");
  logSep(state.players[0], true);
  updateButton();
  if (!state.players[0].human) setTimeout(roll, FAST ? 0 : 500);
}

function updateButton(){
  const btn = $("#roll");
  if (!state.started){ btn.disabled = true; btn.innerHTML = "选择角色开始"; return; }
  if (state.over){ btn.disabled = false; btn.innerHTML = "重新开始<small>回到开局</small>"; return; }
  const p = state.players[state.turnIdx];
  btn.disabled = state.busy || !p.human;
  if (state.busy){ btn.innerHTML = "行动中…<small>请稍候</small>"; return; }
  if (!p.human){ btn.innerHTML = `${p.name}行动中<small>稍等片刻</small>`; return; }
  if (p.inJail){ btn.innerHTML = `掷骰出狱<small>偶数可出，已关 ${p.jailFail}/${CFG.jailFailMax}</small>`; return; }
  if (p.scenicTurns > 0){ btn.innerHTML = `跳过本回合<small>${p.scenicName || "景区"}，剩 ${p.scenicTurns} 回合</small>`; return; }
  btn.innerHTML = "掷 骰<small>点一下，走一步</small>";
}

/* ---------------- 菜单 ---------------- */
function openMenu(){
  const p = state.players[0];
  openSheet(`
    <h3>菜单</h3>
    <p class="sub">${curCh().name}　${monthLabel(state.absMonth)}</p>
    <div class="kv"><span>现金</span><b>${fmt(p.cash)} 万</b></div>
    <div class="kv"><span>负债</span><b>${fmt(p.debt)} 万</b></div>
    <div class="kv"><span>净资产</span><b>${fmt(netWorth(p))} 万</b></div>
    <div class="kv"><span>持有地块</span><b>${owned(p).length} 宗</b></div>
    <div class="btns">
      <button class="btn-sub" onclick="__close()">继续</button>
      <button class="btn-gold" onclick="__bank()">去银行</button>
      <button class="btn-sub" onclick="__save()">存档</button>
    </div>
    <div class="btns">
      <button class="btn-sub" onclick="__loadMenu()">读档</button>
      <button class="btn-red" onclick="__restart()">重开</button>
    </div>`);
  window.__close = () => closeSheet();
  window.__bank = async () => {
    const act = await askBank(p);
    if (act === "loan") doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
    if (act === "repay") doRepay(p, Math.min(p.debt, p.cash));
  };
  window.__save = () => { closeSheet(); saveTo("auto"); saveTo(1); toast("已存档"); };
  window.__loadMenu = () => { closeSheet(); if (!loadFrom("auto")) toast("没有存档"); };
  window.__restart = () => { closeSheet(); startScreen(); };
}

/* ---------------- 启动 ---------------- */
$("#roll").addEventListener("click", () => {
  if (state.over){ startScreen(); return; }
  roll();
});
$("#menu").addEventListener("click", () => { if (state.started) openMenu(); });

buildRings();
state.players = [];
render();
if (SIM){
  const ch = +(new URLSearchParams(location.search).get("ch") || 0);
  newGame("hang", "normal", ch);
} else {
  startScreen();
  updateButton();
}
