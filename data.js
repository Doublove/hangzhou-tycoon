/* ============================================================
   杭州大富翁 · 数据层
   所有可配置内容集中在这里：区域、角色、棋盘、事件、卡牌、难度
   ============================================================ */

const CFG = {
  chapters: [48, 48, 48, 60],      // 四章回合数，合计 204
  passGo: 1,                        // 经过起点固定月供（万）——V1.1 由 150 下调
  passGoRate: 0.03,                 // 经过起点额外获得当前现金的比例
  tollCap: 0.30,                    // 单次过路费上限 = 支付方净资产 × 30%
  levThreshold: 0.5,                // 杠杆率超过此值时，不再享受单次上限保护（呼应 8.4 强制平仓）
  mgmtRate: 0.0015,                 // 物业费：每月按地价 0.15% 收取
  mgmtVacantRate: 0.00075,          // 空地减半
  liqMonths: 3,                     // 破产清算后多少个月内未还清债务则出局
  scenicOdds: [50, 25, 12, 7, 5, 1],// 风景区停留 1—6 回合的概率（合计 100）
  items: {
    start: { dice:3, stay:1, uturn:1, block:1 },  // 初始道具
    chanceDrop: 0.35,                             // 落在机会格时额外掉一件随机道具
    taxStay: 0.13,                                // 税务格掉停留卡
    stockUturn: 0.13,                             // 买入指数掉掉头卡
    jailBlock: 0.05                               // 进监狱掉路障
  },
  jailFailMax: 3,                   // 监狱：连续 3 次未掷出偶数后强制出狱
  upRate: 0.6,                      // 升级费 = 地价 × 60%
  sellRate: 0.8,                    // 卖地回笼 = 地价 × 80%
  loanRate: 0.006,                  // 贷款月息
  loanRateTight: 0.0075,            // 限贷期月息
  loanCap: 0.6,                     // 贷款上限 = 净资产 × 60%
  loanCapTight: 0.4,                // 限贷期 40%
  loanStep: 200,                    // 单次借款上限
  inheritRate: 0.4,                 // 章节继承比例
  taxRate: 0.012                    // 税务格：净资产 × 1.2%
};

// 时代系数：还原 2010—2026 的大周期
const ERA = {
  2010:1.00, 2011:0.92, 2012:0.96, 2013:1.06,
  2014:0.95, 2015:1.06, 2016:1.38, 2017:1.52,
  2018:1.62, 2019:1.72, 2020:1.88, 2021:2.10,
  2022:1.86, 2023:1.78, 2024:1.70, 2025:1.63, 2026:1.60
};

// 12 个区域：热度基准决定地价与租金的波动
const REGIONS = {
  "西湖边":    { color:"#2E7D6F", heat:72 },
  "城西":      { color:"#6B4E9B", heat:56 },
  "城北":      { color:"#8D6E63", heat:40 },
  "城东":      { color:"#1B5FA8", heat:45 },
  "滨江":      { color:"#C2185B", heat:52 },
  "钱江新城":  { color:"#00695C", heat:66 },
  "未来科技城":{ color:"#4527A0", heat:60 },
  "钱江世纪城":{ color:"#AD1457", heat:63 },
  "之江":      { color:"#558B2F", heat:44 },
  "临平":      { color:"#6D4C41", heat:38 },
  "云城":      { color:"#0277BD", heat:48 },
  "三江汇":    { color:"#37474F", heat:36 }
};

// 六个角色，各有被动技能
/* ---------------- 道具 ----------------
   遥控骰子：指定下一次点数；停留卡：本回合不动；掉头卡：反向走一次；
   路障：放在格上，下一个经过者被拦停（一次性）
----------------------------------------------------- */
const ITEMS = {
  dice:  { name:"遥控骰子", icon:"🎲", desc:"指定下一次掷骰点数（1—6）" },
  stay:  { name:"停留卡",   icon:"⏸", desc:"本回合不移动，停在原地" },
  uturn: { name:"掉头卡",   icon:"↩", desc:"下一次掷骰改为反向移动" },
  block: { name:"路障",     icon:"⛔", desc:"在指定格放置路障，下一个经过者被拦停" }
};
const ITEM_KEYS = ["dice","stay","uturn","block"];

const CHARS = [
  { id:"hang", name:"杭铁头", color:"#E65100", cash:960, trait:"稳健",
    tag:"本地拆迁户",
    skill:"祖宅底气：破产判定时免死一次，保留 1 元与 1 块地",
    active:{ name:"拆迁款", cd:12, desc:"立刻获得净资产 8% 的现金（最低 80 万）" },
    tip:"适合新手。现金最多，容错最高。" },
  { id:"wen", name:"温老板", color:"#C62828", cash:820, trait:"激进",
    tag:"炒房团团长",
    skill:"杠杆之王：贷款额度 +30%，利息 −20%，但每次加杠杆舆情 +1",
    active:{ name:"配资", cd:12, desc:"立刻借入净资产 30% 的现金（不受限贷额度限制，利息照付）" },
    tip:"高杠杆快攻。第二章暴富、第四章爆仓的典型。" },
  { id:"ma", name:"码哥", color:"#1565C0", cash:800, trait:"情报",
    tag:"互联网 P8",
    skill:"期权变现：每 12 个月一笔奖金（随未来科技城热度浮动）；该区地块租金 +25%",
    active:{ name:"期权行权", cd:10, desc:"立刻兑现一笔现金，金额随未来科技城热度浮动" },
    tip:"单点重仓。押对产业区，收益翻倍。" },
  { id:"lian", name:"阿莲", color:"#00838F", cash:780, trait:"收租",
    tag:"西湖船娘",
    skill:"景区红利：西湖边、之江、滨江地块租金 +30%；每章多抽 1 张机会卡",
    active:{ name:"摇橹", cd:15, desc:"立刻脱离监狱或风景区，且下一次掷骰点数 +2" },
    tip:"收租流。不追热点，靠租金磨死对手。" },
  { id:"bao", name:"小笼包", color:"#7B1FA2", cash:740, trait:"投机",
    tag:"网红主播",
    skill:"流量即地价：每回合可为任一区域 +5 热度；每 6 个月触发一次负面舆情",
    active:{ name:"带节奏", cd:8, desc:"自己地块最多的区域热度 +15" },
    tip:"操纵舆论。能凭空造出一个热点，也容易被反噬。" },
  { id:"wang", name:"王中介", color:"#455A64", cash:860, trait:"情报",
    tag:"资深中介",
    skill:"信息差：可提前看到下一张事件卡；买卖手续费减半",
    active:{ name:"撮合", cd:12, desc:"以 85 折买下当前环上最便宜的无主地块" },
    items:{ dice:6 },          // 自带 6 个遥控骰子
    tip:"情报流。知道下一步会发生什么，比什么都值钱。" }
];

const DIFF = {
  easy:   { name:"跟风型", reserve:1.6, vision:0, noise:0.30, lever:0.2, note:"保守，留足现金" },
  normal: { name:"算账型", reserve:1.0, vision:1, noise:0.15, lever:0.6, note:"会算回报，也会看政策" },
  hard:   { name:"老狐狸", reserve:0.6, vision:3, noise:0.08, lever:1.0, note:"提前看到三步，敢加杠杆" }
};

/* ---------------- 四环棋盘（年轮） ----------------
   每环 24 格：起点 1 + 地块 16 + 功能格 7
   地块顺序即环上的顺序，按区域成片排布
----------------------------------------------------- */
const RINGS = [
  {
    name:"内环 · 老城时代", years:"2010 — 2013", chapter:0,
    plots:[
      { n:"湖滨", r:"西湖边",   b:60000, mx:3, u:0 },
      { n:"北山", r:"西湖边",   b:45000, mx:3, u:0 },
      { n:"黄龙", r:"西湖边",   b:28000, mx:4, u:0 },
      { n:"文三", r:"城西",     b:22000, mx:4, u:0 },
      { n:"申花", r:"城西",     b:14000, mx:4, u:14 },
      { n:"蒋村", r:"城西",     b:12000, mx:4, u:0 },
      { n:"三墩", r:"城西",     b:9000,  mx:3, u:20 },
      { n:"拱宸", r:"城北",     b:11000, mx:3, u:0 },
      { n:"祥符", r:"城北",     b:8000,  mx:3, u:0 },
      { n:"半山", r:"城北",     b:6000,  mx:3, u:0 },
      { n:"彭埠", r:"城东",     b:10000, mx:4, u:0 },
      { n:"九堡", r:"城东",     b:8500,  mx:3, u:0 },
      { n:"丁桥", r:"城东",     b:7000,  mx:3, u:44 },
      { n:"下沙", r:"城东",     b:7500,  mx:3, u:34 },
      { n:"区府", r:"滨江",     b:13000, mx:4, u:0 },
      { n:"江南", r:"滨江",     b:12000, mx:4, u:0 }
    ]
  },
  {
    name:"中环 · 环线时代", years:"2014 — 2017", chapter:1,
    plots:[
      { n:"市民中心", r:"钱江新城",   b:25000, mx:5, u:0 },
      { n:"富春路",   r:"钱江新城",   b:30000, mx:5, u:0 },
      { n:"江河汇",   r:"钱江新城",   b:22000, mx:5, u:24 },
      { n:"奥体",     r:"钱江世纪城", b:16000, mx:5, u:0 },
      { n:"市心",     r:"钱江世纪城", b:15000, mx:5, u:0 },
      { n:"亚运村",   r:"钱江世纪城", b:14000, mx:5, u:12 },
      { n:"西溪园区", r:"未来科技城", b:10000, mx:5, u:0 },
      { n:"梦想小镇", r:"未来科技城", b:8000,  mx:4, u:0 },
      { n:"海创园",   r:"未来科技城", b:9000,  mx:4, u:18 },
      { n:"仓前",     r:"未来科技城", b:7000,  mx:4, u:30 },
      { n:"之江",     r:"之江",       b:12000, mx:4, u:0 },
      { n:"转塘",     r:"之江",       b:9000,  mx:3, u:0 },
      { n:"白马湖",   r:"滨江",       b:10000, mx:4, u:0 },
      { n:"城东新城", r:"城东",       b:11000, mx:4, u:0 },
      { n:"艮北",     r:"城东",       b:9500,  mx:4, u:8 },
      { n:"运河湾",   r:"城北",       b:9000,  mx:4, u:0 }
    ]
  },
  {
    name:"外环 · 盛会时代", years:"2018 — 2021", chapter:2,
    plots:[
      { n:"五堡",     r:"钱江新城",   b:26000, mx:5, u:0 },
      { n:"四季青",   r:"钱江新城",   b:24000, mx:5, u:0 },
      { n:"莲花",     r:"钱江世纪城", b:17000, mx:5, u:0 },
      { n:"博览",     r:"钱江世纪城", b:15000, mx:5, u:0 },
      { n:"南湖",     r:"未来科技城", b:11000, mx:5, u:0 },
      { n:"闲林",     r:"未来科技城", b:9500,  mx:4, u:12 },
      { n:"西站",     r:"云城",       b:10000, mx:4, u:0 },
      { n:"云谷",     r:"云城",       b:9000,  mx:4, u:18 },
      { n:"临平新城", r:"临平",       b:7500,  mx:4, u:0 },
      { n:"东湖",     r:"临平",       b:7000,  mx:3, u:10 },
      { n:"河庄",     r:"城东",       b:6500,  mx:3, u:0 },
      { n:"闻堰",     r:"三江汇",     b:8000,  mx:4, u:0 },
      { n:"双浦",     r:"之江",       b:8500,  mx:4, u:0 },
      { n:"运河新城", r:"城北",       b:9500,  mx:4, u:0 },
      { n:"智慧城",   r:"城东",       b:9000,  mx:4, u:16 },
      { n:"物联网",   r:"滨江",       b:11000, mx:4, u:0 }
    ]
  },
  {
    name:"最外环 · 分化时代", years:"2022 — 2026", chapter:3,
    plots:[
      { n:"云谷北",   r:"云城",       b:9500,  mx:4, u:6 },
      { n:"西站北",   r:"云城",       b:9000,  mx:4, u:0 },
      { n:"义桥",     r:"三江汇",     b:7500,  mx:4, u:0 },
      { n:"戴村",     r:"三江汇",     b:6000,  mx:3, u:12 },
      { n:"下沙南",   r:"城东",       b:7000,  mx:3, u:0 },
      { n:"大江东",   r:"城东",       b:5500,  mx:3, u:0 },
      { n:"乔司",     r:"临平",       b:7000,  mx:3, u:0 },
      { n:"超山",     r:"临平",       b:5500,  mx:3, u:14 },
      { n:"中泰",     r:"未来科技城", b:8500,  mx:4, u:0 },
      { n:"莲花东",   r:"钱江世纪城", b:16000, mx:5, u:0 },
      { n:"江河汇东", r:"钱江新城",   b:25000, mx:5, u:0 },
      { n:"杭钢",     r:"城北",       b:8000,  mx:4, u:0 },
      { n:"双桥",     r:"城西",       b:9000,  mx:4, u:0 },
      { n:"龙坞",     r:"之江",       b:10000, mx:4, u:0 },
      { n:"小和山",   r:"西湖边",     b:14000, mx:3, u:0 },
      { n:"九堡北",   r:"城东",       b:8500,  mx:4, u:0 }
    ]
  }
];

// 每环的格位排列：起点 1 + 地块 16 + 功能格 9（V1.1 新增监狱、风景区）
const TRACK_PATTERN = [
  "start","p0","p1","chance","p2","p3","fate","p4","p5",
  "chance","p6","p7","tax","p8","p9","fate","p10","p11",
  "bank","p12","p13","jail","p14","p15","scenic","stock"
];

// 各章的风景区格：机制相同，只换地名（西湖只在第一章的地理范围内成立）
const SCENIC = [
  { short:"西湖", full:"西湖风景区" },
  { short:"运河", full:"运河夜游" },
  { short:"亚运", full:"亚运场馆" },
  { short:"良渚", full:"良渚遗址" }
];

/* ---------------- 30 条历史事件 ----------------
   m = 绝对月份序号（2010.01 = 0），until = 解除月份
--------------------------------------------------- */
const EVENTS = [
  { m:2,   key:"hot",      kind:"event",  name:"热钱涌入",       desc:"投资客扫楼，城东、城北热度 +20",
    detail:"温州、台州投资客集中入场，城东、城北板块热度 +20。永久生效。",
    fn:() => heatAdd(["城东","城北"], 20) },
  { m:8,   key:"peak10",   kind:"event",  name:"成交量创新高",   desc:"全城地价 +8%",
    detail:"2010 年成交量创阶段新高，全城板块热度 +8。永久生效。",
    fn:() => heatAdd(null, 8) },
  { m:13,  key:"limitBuy", kind:"policy", name:"限购令落地",     desc:"持有 2 套以上暂停买地，持续 12 个月",
    detail:"名下持有 2 套及以上时，不能再买入新地块。到期自动解除。",
    policy:true, until:25 },
  { m:21,  key:"drop11",   kind:"event",  name:"降价潮",         desc:"全城热度 −20，城东额外 −10",
    detail:"降价从城东蔓延至全城，各板块热度 −20，城东再额外 −10。永久生效。",
    fn:() => { heatAdd(null, -20); heatAdd(["城东"], -10); } },
  { m:34,  key:"metro1",   kind:"event",  name:"地铁 1 号线开通", desc:"城东、滨江热度 +25，等级上限 +1",
    detail:"地铁 1 号线通车，城东、滨江板块热度 +25，沿线地块等级上限 +1。永久生效。",
    fn:() => { heatAdd(["城东","滨江"], 25); raiseCap(["城东","滨江"]); } },
  { m:38,  key:"noSell",   kind:"policy", name:"限售政策",       desc:"持有不满 3 个月不得出售，持续 12 个月",
    detail:"持有不满 3 个月的地块不得卖出，被动卖地同样受限。到期自动解除。",
    policy:true, until:50 },
  { m:44,  key:"cbd13",    kind:"event",  name:"钱江新城 CBD 成型", desc:"钱江新城热度 +30，上限升至 Lv5",
    detail:"市民中心、万象城一带成型，钱江新城热度 +30，等级上限 +1。永久生效。",
    fn:() => { heatAdd(["钱江新城"], 30); raiseCap(["钱江新城"]); } },

  { m:49,  key:"drop14",   kind:"event",  name:"马年第一降",     desc:"城北、城东热度 −20",
    detail:"某盘直降引发连锁反应，城北、城东热度 −20。永久生效。",
    fn:() => heatAdd(["城北","城东"], -20) },
  { m:55,  key:"free14",   kind:"event",  name:"限购全面取消",   desc:"全城热度 +18",
    detail:"压抑三年的需求集中释放，全城板块热度 +18。永久生效。",
    fn:() => heatAdd(null, 18) },
  { m:62,  key:"future15", kind:"event",  name:"未来科技城崛起", desc:"该区热度 +40，上限升至 Lv5",
    detail:"电商巨头总部入驻，未来科技城热度 +40，等级上限 +1。永久生效。",
    fn:() => { heatAdd(["未来科技城"], 40); raiseCap(["未来科技城"]); } },
  { m:70,  key:"g20pre",   kind:"event",  name:"盛会预期升温",   desc:"钱江新城、钱江世纪城 +25",
    detail:"峰会筹备进入冲刺，钱江新城、钱江世纪城热度 +25。永久生效。",
    fn:() => heatAdd(["钱江新城","钱江世纪城"], 25) },
  { m:80,  key:"g20",      kind:"event",  name:"G20 峰会举办",   desc:"全城 +15，两江板块再 +45",
    detail:"峰会落地，全城热度 +15，钱江新城、钱江世纪城额外 +45。永久生效。",
    fn:() => { heatAdd(null, 15); heatAdd(["钱江新城","钱江世纪城"], 45); } },
  { m:82,  key:"limit16",  kind:"policy", name:"限购重启",       desc:"持有 2 套以上暂停买地，持续 24 个月",
    detail:"认房又认贷，名下 2 套以上不能再买地。到期自动解除。",
    policy:true, until:106 },
  { m:86,  key:"asian17",  kind:"event",  name:"亚运村选址公布", desc:"钱江世纪城 +50",
    detail:"亚运村落址，钱江世纪城热度 +50，上限升至 Lv5。永久生效。",
    fn:() => { heatAdd(["钱江世纪城"], 50); raiseCap(["钱江世纪城"]); } },

  { m:99,  key:"lottery",  kind:"policy", name:"摇号购房",       desc:"高热板块买地需摇号，长期生效",
    detail:"板块热度 ≥ 60 时，买地需要摇号：热度越高，中签率越低。永久生效。",
    policy:true, until:null },
  { m:113, key:"metro5",   kind:"event",  name:"地铁 5 / 16 号线", desc:"未来科技城、城北 +20",
    detail:"两条线路开通，未来科技城、城北热度 +20，上限 +1。永久生效。",
    fn:() => { heatAdd(["未来科技城","城北"], 20); raiseCap(["未来科技城","城北"]); } },
  { m:121, key:"covid",    kind:"event",  name:"疫情停摆",       desc:"全城 −12，交易冻结 1 个月",
    detail:"售楼处关闭，全城热度 −12，本月无法买地。",
    fn:() => { heatAdd(null, -12); state.freezeBuy = 1; } },
  { m:125, key:"school",   kind:"event",  name:"学区房行情",     desc:"西湖边、城西 +35",
    detail:"学区房被爆炒，西湖边、城西热度 +35。永久生效。",
    fn:() => heatAdd(["西湖边","城西"], 35) },
  { m:130, key:"ipo",      kind:"event",  name:"上市暂缓",       desc:"未来科技城 −30",
    detail:"某金融科技公司上市暂缓，未来科技城热度 −30。永久生效。",
    fn:() => heatAdd(["未来科技城"], -30) },
  { m:136, key:"peak21",   kind:"event",  name:"周期顶点",       desc:"全城 +30，历史最高",
    detail:"楼市到达本轮周期顶点，全城热度 +30。此后进入下行通道。永久生效。",
    fn:() => heatAdd(null, 30) },
  { m:139, key:"pricecap", kind:"policy", name:"二手房指导价",   desc:"卖出收益封顶，长期生效",
    detail:"卖地价格不得超过买入价的 1.5 倍，超出部分归零。永久生效。",
    policy:true, until:null },
  { m:142, key:"aoti",     kind:"event",  name:"奥体代持风波",   desc:"钱江世纪城 −25，交易冻结 3 个月",
    detail:"自媒体曝光代持链条，钱江世纪城热度 −25，该区 3 个月内无法交易。永久生效。",
    fn:() => { heatAdd(["钱江世纪城"], -25); state.freezeRegion = { region:"钱江世纪城", until:state.absMonth + 3 }; } },

  { m:148, key:"stall",    kind:"event",  name:"停工与交付风险", desc:"工地地块 20% 概率烂尾",
    detail:"部分开发商资金链断裂，等级 Lv1 的地块有 20% 概率烂尾，价值归零且不再产生租金。",
    fn:() => triggerStall() },
  { m:152, key:"asiandelay", kind:"event", name:"亚运延期",      desc:"钱江世纪城 −25",
    detail:"亚运会延期，钱江世纪城热度 −25。永久生效。",
    fn:() => heatAdd(["钱江世纪城"], -25) },
  { m:164, key:"asian23",  kind:"event",  name:"亚运会举办",     desc:"钱江世纪城 +40，全城 +10",
    detail:"亚运会如期举办，钱江世纪城热度 +40，全城 +10。永久生效。",
    fn:() => { heatAdd(["钱江世纪城"], 40); heatAdd(null, 10); } },
  { m:164, key:"easy23",   kind:"event",  name:"认房不认贷",     desc:"全城 +12",
    detail:"改善需求释放，全城热度 +12。永久生效。",
    fn:() => heatAdd(null, 12) },
  { m:172, key:"free24",   kind:"event",  name:"全面取消限购",   desc:"全城 +15，限购解除",
    detail:"杭州全面取消住房限购，全城热度 +15，限购类政策立即失效。永久生效。",
    fn:() => { heatAdd(null, 15); clearPolicy("limitBuy"); clearPolicy("limit16"); } },
  { m:176, key:"trade24",  kind:"event",  name:"以旧换新",       desc:"城北、城东 +10",
    detail:"收储与以旧换新落地，城北、城东热度 +10。永久生效。",
    fn:() => heatAdd(["城北","城东"], 10) },
  { m:181, key:"ai25",     kind:"event",  name:"AI 六小龙出圈",  desc:"未来科技城、滨江 +25",
    detail:"产业叙事切换，未来科技城、滨江热度 +25，上限 +1。永久生效。",
    fn:() => { heatAdd(["未来科技城","滨江"], 25); raiseCap(["未来科技城","滨江"]); } },
  { m:187, key:"split25",  kind:"event",  name:"分化加剧",       desc:"核心区 +8，远郊 −20",
    detail:"市场彻底分化：西湖边、钱江新城、滨江 +8；临平、三江汇、云城 −20。永久生效。",
    fn:() => { heatAdd(["西湖边","钱江新城","滨江"], 8); heatAdd(["临平","三江汇","云城"], -20); } },
  { m:197, key:"unknown26", kind:"event", name:"未知事件",       desc:"随机利好或利空",
    detail:"2026 年的市场没有人能预测。本次随机触发一次全城 ±15 的热度变化。",
    fn:() => heatAdd(null, Math.random() < 0.5 ? 15 : -15) }
];

/* ---------------- 24 张机会卡 ---------------- */
const CHANCE = [
  { t:"拆迁通知",   d:"自有地块被征收，补偿 180 万", act:p => { p.cash += 180; return "获得补偿 180 万"; } },
  { t:"老破小改造", d:"随机一块自有地块免费升一级", act:p => {
      const c = owned(p).filter(x => x.lv < x.maxLv && !x.broken);
      if (!c.length) return "没有可升级的地块";
      const one = c[rnd(c.length)]; one.lv++;
      return `${one.name} 免费升到 Lv${one.lv}`;
  }},
  { t:"茶水费",     d:"现金 +60 万", act:p => { p.cash += 60; return "现金 +60 万"; } },
  { t:"中介佣金",   d:"现金 +45 万", act:p => { p.cash += 45; return "现金 +45 万"; } },
  { t:"法拍捡漏",   d:"以 7 折买入一块无主地块", act:p => {
      const free = allCells().filter(c => c.t === "plot" && !c.owner && c.unlocked && !c.broken);
      if (!free.length) return "没有在拍的地块";
      const c = free[rnd(free.length)];
      const cost = Math.round(value(c) * 0.7);
      if (p.cash < cost) return "现金不够，错过法拍";
      p.cash -= cost; c.owner = p; c.lv = 1; c.boughtAt = state.absMonth;
      return `${c.name} 以 7 折（${cost} 万）拍下`;
  }},
  { t:"人才补贴",   d:"现金最少者获得 120 万补贴", act:p => {
      const poor = state.players.filter(x => !x.bankrupt).sort((a,b) => a.cash - b.cash)[0];
      poor.cash += 120; return `${poor.name} 获得补贴 120 万`;
  }},
  { t:"温州老乡",   d:"获得一笔无息借款 150 万", act:p => { p.cash += 150; p.debt += 150; return "借入 150 万（仍计负债）"; } },
  { t:"摇号中签",   d:"免费获得一次购买资格", act:p => { p.freePass = true; return "本回合买地免摇号"; } },
  { t:"地铁规划泄露", d:"指定区域热度 +15", act:p => {
      const r = pick(Object.keys(REGIONS)); heatAdd([r], 15); return `${r} 热度 +15`; } },
  { t:"直播带看",   d:"现金 +80 万，但下月舆情风险", act:p => { p.cash += 80; p.risk = 1; return "现金 +80 万"; } },
  { t:"老客户介绍", d:"现金 +35 万", act:p => { p.cash += 35; return "现金 +35 万"; } },
  { t:"车位热销",   d:"每块自有地块 +8 万", act:p => {
      const n = owned(p).length; p.cash += n * 8; return `车位收入 +${n * 8} 万`; } },
  { t:"精装溢价",   d:"随机一块自有地块免费升一级", act:p => {
      const c = owned(p).filter(x => x.lv < x.maxLv && !x.broken);
      if (!c.length) return "没有可升级的地块";
      const one = c[rnd(c.length)]; one.lv++;
      return `${one.name} 升到 Lv${one.lv}`;
  }},
  { t:"政策解读",   d:"下个月事件提前可知", act:p => { p.vision = 2; return "获得 2 个月视野"; } },
  { t:"团购大单",   d:"现金 +110 万", act:p => { p.cash += 110; return "现金 +110 万"; } },
  { t:"旧改补偿",   d:"城北、城东地块各 +5 万/级", act:p => {
      const list = owned(p).filter(x => (x.region === "城北" || x.region === "城东"));
      const sum = list.reduce((s,x) => s + x.lv * 5, 0);
      p.cash += sum; return sum ? `补偿 +${sum} 万` : "没有相关地块"; } },
  { t:"学区挂牌",   d:"西湖边、城西热度 +10", act:p => { heatAdd(["西湖边","城西"], 10); return "两地热度 +10"; } },
  { t:"网红打卡",   d:"随机一块自有地块租金翻倍 3 个月", act:p => {
      const c = owned(p).filter(x => x.lv > 0);
      if (!c.length) return "没有可出租的地块";
      const one = c[rnd(c.length)]; one.boost = 3;
      return `${one.name} 租金翻倍 3 个月`;
  }},
  { t:"过桥资金",   d:"立即获得 200 万，3 个月后归还", act:p => { p.cash += 200; p.bridge = 3; return "获得过桥资金 200 万"; } },
  { t:"顺利交付",   d:"随机一块烂尾地块恢复", act:p => {
      const c = allCells().filter(x => x.broken && x.owner === p);
      if (!c.length) return "没有烂尾地块";
      c[0].broken = false; return `${c[0].name} 恢复交付`;
  }},
  { t:"物业升值",   d:"随机一块自有地块 +1 级（不超上限）", act:p => {
      const c = owned(p).filter(x => x.lv < x.maxLv && !x.broken);
      if (!c.length) return "没有可升级的地块";
      const one = c[rnd(c.length)]; one.lv++; return `${one.name} 升到 Lv${one.lv}`;
  }},
  { t:"尾盘甩卖",   d:"以 6 折买入一块无主地块", act:p => {
      const free = allCells().filter(c => c.t === "plot" && !c.owner && c.unlocked);
      if (!free.length) return "没有可买的地块";
      const c = free[rnd(free.length)];
      const cost = Math.round(value(c) * 0.6);
      if (p.cash < cost) return "现金不够";
      p.cash -= cost; c.owner = p; c.lv = 1; c.boughtAt = state.absMonth;
      return `${c.name} 以 6 折（${cost} 万）买下`;
  }},
  { t:"评估上调",   d:"净资产估值 +5%（现金不变）", act:p => { p.revalue = 1.05; return "名下地块估值 +5%"; } },
  { t:"返乡置业",   d:"现金 +70 万", act:p => { p.cash += 70; return "现金 +70 万"; } },
  { t:"虚假宣传被立案", d:"被带走调查，直接进监狱", act:p => { sendToJail(p); return "被带走调查，进了监狱"; } }
];

/* ---------------- 24 张命运卡 ---------------- */
const FATE = [
  { t:"业主维权",   d:"有房者现金 −40 万", act:p => {
      if (!owned(p).length) return "无房一身轻";
      p.cash -= 40; return "现金 −40 万"; } },
  { t:"房贷利率上调", d:"现金 −55 万", act:p => { p.cash -= 55; return "现金 −55 万"; } },
  { t:"土拍熔断",   d:"本回合无法买地", act:p => { p.skipBuy = true; return "本回合不能买地"; } },
  { t:"股市跳水",   d:"现金 −70 万，持仓缩水", act:p => {
      const loss = Math.round((p.stock || 0) * stockLot() * 0.1);
      p.cash -= 70; state.stockPrice *= 0.9;
      return `现金 −70 万，股票缩水 ${loss} 万`; } },
  { t:"中介带看",   d:"现金 +30 万", act:p => { p.cash += 30; return "现金 +30 万"; } },
  { t:"限价传闻",   d:"下月起卖地收益封顶", act:p => { setPolicy("pricecap", state.absMonth + 6); return "限价预期升温"; } },
  { t:"学区调整",   d:"西湖边、城西 −25", act:p => { heatAdd(["西湖边","城西"], -25); return "两地热度 −25"; } },
  { t:"交付延期",   d:"Lv1 地块暂停收租 3 个月", act:p => {
      owned(p).filter(x => x.lv === 1).forEach(x => x.boost = -3);
      return "工地暂缓"; } },
  { t:"房产税传闻", d:"每块地 −2% 现金", act:p => {
      const list = owned(p);
      const t = Math.round(list.reduce((s, c) => s + value(c), 0) * 0.02);
      p.cash -= t; return `现金 −${t} 万`; } },
  { t:"降价维权",   d:"现金 −35 万", act:p => { p.cash -= 35; return "现金 −35 万"; } },
  { t:"银行抽贷",   d:"负债超过净资产一半则强制卖地", act:p => {
      if (p.debt > netWorth(p) * 0.5 && owned(p).length){
          const c = owned(p).sort((a,b) => value(a) - value(b))[0];
          sellLand(p, c); return `${c.name} 被强制处置`;
      }
      return "暂未触及红线"; } },
  { t:"舆情反噬",   d:"随机区域热度 −15", act:p => {
      const r = pick(Object.keys(REGIONS)); heatAdd([r], -15); return `${r} 热度 −15`; } },
  { t:"中介跑路",   d:"现金 −60 万", act:p => { p.cash -= 60; return "现金 −60 万"; } },
  { t:"工期延误",   d:"最贵的地块暂停收租 2 个月", act:p => {
      const c = owned(p).sort((a,b) => value(b) - value(a))[0];
      if (!c) return "没有地块";
      c.boost = -2; return `${c.name} 暂缓收租`; } },
  { t:"租金下跌",   d:"全城热度 −8", act:p => { heatAdd(null, -8); return "全城热度 −8"; } },
  { t:"资金链紧张", d:"现金 −90 万", act:p => { p.cash -= 90; return "现金 −90 万"; } },
  { t:"政策加码",   d:"限购延长 6 个月", act:p => {
      if (hasPolicy("limitBuy")) extendPolicy("limitBuy", 6);
      else setPolicy("limitBuy", state.absMonth + 6);
      return "限购加码"; } },
  { t:"合作方违约", d:"现金 −50 万", act:p => { p.cash -= 50; return "现金 −50 万"; } },
  { t:"评估下调",   d:"名下地块估值 −5%", act:p => { p.revalue = 0.95; return "估值 −5%"; } },
  { t:"罚单",       d:"现金 −25 万", act:p => { p.cash -= 25; return "现金 −25 万"; } },
  { t:"空置税",     d:"空地每块 −10 万", act:p => {
      const n = owned(p).filter(x => x.lv === 0).length;
      p.cash -= n * 10; return n ? `空置税 −${n * 10} 万` : "没有空地"; } },
  { t:"竞品入市",   d:"同区域地块租金 −20%（3 个月）", act:p => {
      const c = owned(p)[0];
      if (!c) return "没有地块";
      c.boost = -3; return `${c.name} 租金下调`; } },
  { t:"法拍冲击",   d:"随机自有地块价值 −20%", act:p => {
      const c = owned(p)[0];
      if (!c) return "没有地块";
      c.discount = 0.8; return `${c.name} 估值下调`; } },
  { t:"断供",       d:"现金 −100 万", act:p => { p.cash -= 100; return "现金 −100 万"; } },
  { t:"代持被查",   d:"违规代持曝光，直接进监狱", act:p => { sendToJail(p); return "违规代持曝光，进了监狱"; } },
  { t:"违规套现",   d:"经营贷流入楼市被查，直接进监狱", act:p => { sendToJail(p); return "经营贷被查，进了监狱"; } }
];

/* ---------------- 工具 ---------------- */
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
