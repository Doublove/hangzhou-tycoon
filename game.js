/* ============================================================
   杭州大富翁 · 逻辑层
   ============================================================ */

const $ = s => document.querySelector(s);
const SIM = location.search.indexOf("sim") >= 0;
const SPEED = SIM ? 0.06 : 1;
const sleep = ms => new Promise(r => setTimeout(r, ms * SPEED));
const fmt = n => (n < 0 ? "-" : "") + Math.abs(Math.round(n)).toLocaleString();
const rnd = n => Math.floor(Math.random() * n);

const RENT_RATE = [0, 0.008, 0.011, 0.014, 0.017, 0.020];
const stockLot = () => Math.round(state.stockPrice * 0.1);   // 每手 ≈ 100 万
const TOLL_RATE = [0, 0.040, 0.055, 0.070, 0.085, 0.100];
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
  stockPrice:1000, busy:false, over:false,
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
          price: Math.round(p.b / 20), base:p.b, maxLv:p.mx,
          unlock:p.u, lv:0, owner:null, unlocked:p.u === 0,
          boughtAt:-99, broken:false, boost:0, discount:1
        };
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
const tollOf = c => Math.round(value(c) * TOLL_RATE[c.lv] * (c.boost > 0 ? 1.5 : 1));
const upCost = c => Math.round(value(c) * CFG.upRate);

function netWorth(p){
  const land = owned(p).reduce((s, c) => s + value(c) * (1 + 0.12 * c.lv), 0);
  const stock = (p.stock || 0) * stockLot();
  return Math.round((p.cash + land + stock) * (p.revalue || 1) - p.debt);
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

  const box = $("#players");
  box.innerHTML = "";
  state.players.forEach(p => {
    const d = document.createElement("div");
    d.className = "pcard" + (p.id === state.turnIdx && !state.over ? " active" : "") + (p.bankrupt ? " dead" : "");
    d.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span class="pname">${p.name}</span>
      <span class="pmoney"><span class="pcash">${fmt(p.cash)}万</span>
      ${p.debt > 0 ? `<br><span class="pdebt">负债 ${fmt(p.debt)}</span>` : ""}</span>`;
    box.appendChild(d);
  });

  // 政策条
  const pol = $("#policy");
  pol.innerHTML = "";
  const active = state.mods.filter(m => m.until == null || state.absMonth < m.until);
  if (!active.length){
    const c = document.createElement("span");
    c.className = "chip info"; c.textContent = "政策宽松";
    pol.appendChild(c);
  } else {
    active.forEach(m => {
      const c = document.createElement("span");
      c.className = "chip" + (m.kind === "event" ? " info" : "");
      const rest = m.until == null ? "" : ` · 剩${Math.max(0, m.until - state.absMonth)}月`;
      c.textContent = m.name + rest;
      c.onmouseenter = () => showTip(c, m.key);
      c.onmouseleave = hideTip;
      c.onclick = e => { e.stopPropagation(); showTip(c, m.key); };
      pol.appendChild(c);
    });
  }

  // 旧环资产
  const legacy = $("#legacy");
  if (legacy){
    const rows = state.rings.map((r, i) => {
      const meId = state.players[0] ? state.players[0].charId : null;
      const n = meId ? r.cells.filter(c => c.t === "plot" && c.owner && c.owner.charId === meId).length : 0;
      return i === state.chapter ? null : (n ? `${RINGS[i].name.split(" · ")[0]} ${n} 宗` : null);
    }).filter(Boolean);
    legacy.textContent = rows.length ? "旧环资产：" + rows.join("　") : "";
  }
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
    el.onclick = () => showCell(cell);
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
    if (cell.t !== "plot") return;
    el.classList.toggle("locked", !cell.unlocked);
    el.classList.toggle("broken", !!cell.broken);
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
}

function renderTokens(){
  const wrap = $("#boardWrap");
  wrap.querySelectorAll(".token").forEach(n => n.remove());
  const n = curCells().length, R = 43;
  const by = {};
  state.players.forEach(p => { if (!p.bankrupt) (by[p.pos] = by[p.pos] || []).push(p); });
  Object.keys(by).forEach(idx => {
    const a = (-90 + idx * 360 / n) * Math.PI / 180;
    const bx = 50 + R * Math.cos(a), byy = 50 + R * Math.sin(a);
    const list = by[idx];
    list.forEach((p, k) => {
      const t = document.createElement("div");
      t.className = "token";
      t.style.background = p.color;
      t.textContent = p.name[0];
      const dx = list.length > 1 ? (k - (list.length - 1) / 2) * 13 : 0;
      const dy = list.length > 1 ? 16 : 0;
      t.style.left = `calc(${bx}% + ${dx}px)`;
      t.style.top = `calc(${byy}% + ${dy}px)`;
      wrap.appendChild(t);
    });
  });
}

function log(msg, type=""){
  const box = $("#log");
  const p = document.createElement("p");
  if (type) p.className = type;
  p.innerHTML = msg;
  box.appendChild(p);
  while (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

let toastTimer;
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

function showTip(el, key){
  const m = state.mods.find(x => x.key === key);
  if (!m) return;
  const tip = $("#tip");
  const life = m.until == null ? "永久生效" : `剩余 ${Math.max(0, m.until - state.absMonth)} 个月`;
  tip.innerHTML = `<b>${m.name}</b><div class="t-meta">${monthLabel(m.start)} 起 · ${life}</div>${m.detail}`;
  tip.classList.add("show");
  const bar = $("#hud").getBoundingClientRect();
  tip.style.top = (bar.bottom + 6) + "px";
}
function hideTip(){ $("#tip").classList.remove("show"); }
document.addEventListener("click", hideTip);
window.addEventListener("scroll", hideTip, true);

/* ---------------- 弹窗 ---------------- */
function openSheet(html){ $("#sheet").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeSheet(){ $("#modal").classList.add("hidden"); }

function showCell(c){
  if (c.t !== "plot"){
    let body = "";
    if (c.t === "start") body = `<p class="sub">每次经过领月供 <b>120 万</b>。</p>`;
    else if (c.t === "chance" || c.t === "fate"){
      const deck = c.t === "chance" ? CHANCE : FATE;
      const rows = deck.slice(0, 8).map(k => `<div class="ev"><span class="ev-n">${k.t}</span><span class="ev-d">${k.d}</span></div>`).join("");
      body = `<p class="sub">共 ${deck.length} 张，停在这里随机抽一张（示例）：</p>${rows}`;
    } else if (c.t === "bank"){
      const p = state.players[0];
      body = `<p class="sub">可借款、还款。负债每月计息，计入净资产。</p>
        <div class="kv"><span>当前月息</span><b>${(loanRate() * 100).toFixed(2)}%</b></div>
        <div class="kv"><span>你的可借额度</span><b>${fmt(loanCap(p))} 万</b></div>`;
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
    <div class="kv"><span>过路费</span><b>${c.lv ? fmt(tollOf(c)) + " 万" : "—"}</b></div>
    <div class="kv"><span>月租金</span><b>${c.lv ? fmt(rentOf(c)) + " 万" : "—"}</b></div>
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
    openSheet(`
      <h3>${c.name} <span class="badge" style="background:${REGIONS[c.region].color};color:#fff">${c.region}</span></h3>
      <p class="sub">无主地块 · 热度 ${state.heat[c.region]}${needLottery ? " · 需摇号" : ""}</p>
      <div class="kv"><span>地价</span><b>${fmt(price)} 万</b></div>
      <div class="kv"><span>交易税费</span><b>${fmt(fee)} 万</b></div>
      <div class="kv"><span>Lv1 过路费</span><b>${fmt(Math.round(price * TOLL_RATE[1]))} 万</b></div>
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
      <div class="kv"><span>升级后过路费</span><b>${fmt(Math.round(value(c) * TOLL_RATE[c.lv + 1]))} 万</b></div>
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
    openSheet(`
      <h3>证券交易所</h3>
      <p class="sub">杭州楼市指数 ${fmt(state.stockPrice)} 点　每手 100 股 ≈ ${fmt(price)} 万</p>
      <div class="kv"><span>你的持仓</span><b>${p.stock || 0} 手</b></div>
      <div class="kv"><span>市值</span><b>${fmt((p.stock || 0) * state.stockPrice)} 万</b></div>
      <div class="btns">
        <button class="btn-sub" onclick="__st(0)">不办</button>
        <button class="btn-sub" ${p.stock > 0 ? "" : "disabled"} onclick="__st('sell')">卖一手</button>
        <button class="btn-main" ${canBuy ? "" : "disabled"} onclick="__st('buy')">买一手</button>
      </div>`);
    window.__st = v => { closeSheet(); res(v); };
  });
}

/* ---------------- 回合 ---------------- */
async function roll(){
  if (state.busy || state.over || !state.started) return;
  const p = state.players[state.turnIdx];
  state.busy = true; updateButton();

  if (p.charId === "bao" && !p.skipBao){ boostByBao(p); p.skipBao = true; }

  const d1 = 1 + rnd(6), d2 = 1 + rnd(6);
  toast(`${p.name} 掷出 ${d1} + ${d2} = ${d1 + d2}`);
  await sleep(380);

  await move(p, d1 + d2);
  await landOn(p, curCells()[p.pos]);
  await settle(p);

  state.busy = false;
  nextTurn();
}

async function move(p, steps){
  const cells = curCells();
  for (let i = 0; i < steps; i++){
    const prev = p.pos;
    p.pos = (p.pos + 1) % cells.length;
    if (p.pos === 0 && prev !== 0){
      p.cash += CFG.passGo;
      log(`<b>${p.name}</b> 经过起点，领月供 <b>+${CFG.passGo}</b> 万`, "good");
    }
    renderTokens();
    await sleep(130);
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
      const fee = tollOf(c);
      p.cash -= fee; c.owner.cash += fee;
      log(`<b>${p.name}</b> 踩到 ${c.owner.name} 的 ${c.name}，付过路费 <b>-${fmt(fee)}</b> 万`, "bad");
    }
    renderCells(); renderHUD();
    return;
  }

  if (c.t === "chance" || c.t === "fate"){
    return drawCard(p, c.t === "chance" ? CHANCE : FATE, c.t === "chance" ? "机会" : "命运");
  }

  if (c.t === "bank"){
    if (p.human){
      const act = await askBank(p);
      if (act === "loan") doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
      if (act === "repay") doRepay(p, Math.min(p.debt, p.cash));
    } else if (p.cash < 160 && loanCap(p) >= 100 && Math.random() < DIFF[state.diff].lever){
      doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
    }
    renderHUD(); return;
  }

  if (c.t === "stock"){
    if (p.human){
      const act = await askStock(p);
      if (act === "buy"){ p.cash -= stockLot(); p.stock = (p.stock || 0) + 1; log(`<b>${p.name}</b> 买入 1 手指数`, ""); }
      if (act === "sell"){ p.cash += stockLot(); p.stock--; log(`<b>${p.name}</b> 卖出 1 手指数`, ""); }
    } else if (p.cash > 600 && Math.random() < 0.4){
      p.cash -= stockLot(); p.stock = (p.stock || 0) + 1;
      log(`<b>${p.name}</b> 买入 1 手指数`, "");
    }
    renderHUD(); return;
  }

  if (c.t === "tax"){
    const t = Math.round(netWorth(p) * CFG.taxRate);
    p.cash -= t;
    log(`<b>${p.name}</b> 缴税 <b>-${fmt(t)}</b> 万`, "bad");
    renderHUD(); return;
  }
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

/* ---------------- AI ---------------- */
function aiBuy(p, c){
  const d = DIFF[state.diff];
  const price = value(c);
  const fee = Math.round(price * 0.03);
  const monthly = owned(p).reduce((s, x) => s + rentOf(x), 0);
  const burn = owned(p).reduce((s, x) => s + Math.round(value(x) * 0.002), 0) + 40;
  const reserve = burn * 10 * d.reserve + 120;
  if (p.cash - price - fee < reserve) return false;
  if (hasPolicy("limitBuy") && owned(p).length >= 2) return false;

  let bias = 1;
  if (p.charId === "lian" && ["西湖边","之江","滨江"].includes(c.region)) bias = 1.25;
  if (p.charId === "ma" && c.region === "未来科技城") bias = 1.3;
  if (p.trait === "激进" && ["城北","城东","临平"].includes(c.region)) bias = 1.2;

  const score = (state.heat[c.region] / 60) * bias * (1 - d.noise + Math.random() * d.noise * 2);
  return score > 0.9;
}

function aiUpgrade(p, c){
  const d = DIFF[state.diff];
  const cost = upCost(c);
  const g = UP_GATE[c.lv + 1] || {};
  if (state.absMonth - c.boughtAt < (g.m || 0)) return false;
  if (state.heat[c.region] < (g.h || 0)) return false;
  const reserve = 260 * d.reserve;
  if (p.cash - cost < reserve) return false;
  return Math.random() < 0.5 + 0.4 * d.lever;
}

function aiPreTurn(p){
  const d = DIFF[state.diff];
  const burn = owned(p).reduce((s, x) => s + Math.round(value(x) * 0.002), 0) + 40;
  if (p.cash < burn * 5 * d.reserve && loanCap(p) >= 100 && Math.random() < d.lever){
    doLoan(p, Math.min(CFG.loanStep, loanCap(p)));
  }
  if (p.cash < burn * 3){
    const worst = owned(p).sort((a, b) => value(a) - value(b))[0];
    if (worst && Math.random() < 0.7) sellLand(p, worst);
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
  if (state.turnCount >= alive){ state.turnCount = 0; endMonth(); }

  renderHUD(); updateButton();
  const p = state.players[state.turnIdx];
  if (!p.human && !state.over){
    aiPreTurn(p);
    setTimeout(roll, 380);
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
    owned(p).forEach(c => {
      if (c.boost > 0) c.boost--;
      else if (c.boost < 0) c.boost++;
      if (c.boost === 0) c.boost = 0;
    });
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

  // 股票
  state.stockPrice = Math.max(200, Math.round(state.stockPrice * (0.96 + Math.random() * 0.08)));

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
    const plots = owned(p).sort((a, b) => value(b) - value(a));
    const keep = plots[0];
    const cash = Math.max(0, Math.round(netWorth(p) * CFG.inheritRate));
    allCells().forEach(c => { if (c.t === "plot" && c.owner === p) { c.owner = null; c.lv = 0; c.broken = false; c.boost = 0; } });
    if (keep){ keep.owner = p; keep.lv = Math.max(1, keep.lv); keep.boughtAt = state.absMonth; }
    p.cash = cash; p.debt = 0; p.pos = 0; p.bankrupt = false;
    p.stock = 0; p.bridge = 0; p.revalue = 1;
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
  if (!state.players[state.turnIdx].human) setTimeout(roll, 500);
}

/* ---------------- 存档 ---------------- */
function serialize(){
  return {
    v:1, chapter:state.chapter, absMonth:state.absMonth, turnIdx:state.turnIdx, turnCount:state.turnCount,
    heat:state.heat, mods:state.mods, fired:state.fired, stockPrice:state.stockPrice,
    freezeBuy:state.freezeBuy, freezeRegion:state.freezeRegion,
    charId:state.charId, diff:state.diff,
    cells: allCells().filter(c => c.t === "plot").map(c => ({
      ring:c.ring, idx:c.idx, lv:c.lv, owner:c.owner ? c.owner.id : null,
      unlocked:c.unlocked, boughtAt:c.boughtAt, broken:c.broken, boost:c.boost,
      discount:c.discount, maxLv:c.maxLv
    })),
    players: state.players.map(p => ({
      id:p.id, cash:p.cash, debt:p.debt, pos:p.pos, bankrupt:p.bankrupt,
      stock:p.stock || 0, savedOnce:!!p.savedOnce, bridge:p.bridge || 0, freePass:!!p.freePass
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
  state.freezeRegion = d.freezeRegion || null;
  state.over = false; state.busy = false; state.started = true;

  state.players.forEach(p => {
    p.cash = 0; p.debt = 0; p.pos = 0; p.bankrupt = false;
    p.stock = 0; p.savedOnce = false; p.bridge = 0; p.freePass = false;
  });
  d.players.forEach(s => {
    const p = state.players[s.id];
    p.cash = s.cash; p.debt = s.debt; p.pos = s.pos; p.bankrupt = s.bankrupt;
    p.stock = s.stock; p.savedOnce = s.savedOnce; p.bridge = s.bridge; p.freePass = s.freePass;
  });
  allCells().forEach(c => { if (c.t === "plot"){ c.owner = null; c.lv = 0; } });
  d.cells.forEach(s => {
    const c = state.rings[s.ring].cells[s.idx];
    if (!c) return;
    c.lv = s.lv; c.unlocked = s.unlocked; c.boughtAt = s.boughtAt;
    c.broken = s.broken; c.boost = s.boost; c.discount = s.discount; c.maxLv = s.maxLv;
    c.owner = s.owner == null ? null : state.players[s.owner];
  });
  render();
  $("#log").innerHTML = "";
  log(`读取存档：${monthLabel(state.absMonth)}，继续。`, "sys");
  updateButton();
  if (!state.players[state.turnIdx].human) setTimeout(roll, 500);
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
  state.freezeBuy = 0; state.freezeRegion = null;

  state.heat = {};
  Object.keys(REGIONS).forEach(k => state.heat[k] = REGIONS[k].heat);

  buildRings();

  const me = CHARS.find(c => c.id === charId);
  const others = CHARS.filter(c => c.id !== charId);
  const roster = [me, ...others.slice(0, 3)];
  state.players = roster.map((c, i) => ({
    id:i, charId:c.id, name:c.name, color:c.color, trait:c.trait,
    human: SIM ? false : i === 0, cash:c.cash, debt:0, pos:0, stock:0,
    bankrupt:false, savedOnce:false, skipBuy:false, freePass:false,
    bridge:0, revalue:1, skipBao:false, risk:0
  }));

  // 从中途章节开局：把此前发生过的事件补演一遍，保证热度、政策、等级上限与历史一致
  EVENTS.filter(e => e.m < state.absMonth).forEach(e => {
    if (e.fn && e.key !== "covid") e.fn();
    if (e.policy) setPolicy(e.key, e.until == null ? null : e.until);
    state.fired[e.key] = true;
  });

  render();
  $("#log").innerHTML = "";
  log(`<b>${curCh().name}</b> 开始。${monthLabel(state.absMonth)}，${me.name} 带着 ${me.cash} 万进场。`, "sys");
  log(`对手：${others.slice(0, 3).map(c => c.name).join("、")}。`, "");
  updateButton();
  if (!state.players[0].human) setTimeout(roll, 500);
}

function updateButton(){
  const btn = $("#roll");
  if (!state.started){ btn.disabled = true; btn.innerHTML = "选择角色开始"; return; }
  if (state.over){ btn.disabled = false; btn.innerHTML = "重新开始<small>回到开局</small>"; return; }
  const p = state.players[state.turnIdx];
  btn.disabled = state.busy || !p.human;
  btn.innerHTML = state.busy ? "行动中…<small>请稍候</small>"
    : (p.human ? "掷 骰<small>点一下，走一步</small>" : `${p.name}行动中<small>稍等片刻</small>`);
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
