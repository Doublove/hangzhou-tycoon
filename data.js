/* ============================================================
   数据层 · 配置加载器

   所有可调内容（数值参数、角色、地块、事件、卡牌）都放在
   config.json 里。本文件只做三件事：

     1. 声明与代码同名的变量（CFG / CHARS / RINGS / CHANCE …）
     2. 启动时读一次 config.json，把数据灌进这些变量
     3. 之后所有游戏逻辑只读内存，不再碰文件

   改数值 → 改 config.json；改逻辑 → 改 game.js。
   ============================================================ */

let CFG = {};
let ERA = {};
let REGIONS = {};
let ITEMS = {};
let ITEM_KEYS = [];
let CHARS = [];
let DIFF = {};
let RINGS = [];
let TRACK_PATTERN = [];
let SCENIC = [];
let EVENTS = [];
let CHANCE = [];
let FATE = [];
let CONFIG = null;              // 原始配置，调试时看整份

const CONFIG_URL = "config.json";

function applyConfig(raw){
  CFG = raw.cfg || {};
  ERA = raw.era || {};
  REGIONS = raw.regions || {};
  ITEMS = raw.items || {};
  ITEM_KEYS = raw.itemKeys || Object.keys(ITEMS);
  CHARS = raw.chars || [];
  DIFF = raw.diff || {};
  RINGS = raw.rings || [];
  TRACK_PATTERN = raw.trackPattern || [];
  SCENIC = raw.scenic || [];
  EVENTS = raw.events || [];
  CHANCE = raw.chance || [];
  FATE = raw.fate || [];
  CONFIG = raw;
  return raw;
}

/* 浏览器走 fetch；测试环境把 JSON 塞进 globalThis.__CONFIG__ 直接注入，
   这样单测不需要起 HTTP 服务。 */
async function loadConfig(url = CONFIG_URL){
  const preset = typeof globalThis !== "undefined" ? globalThis.__CONFIG__ : null;
  if (preset && preset.cfg) return applyConfig(preset);

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`读取 ${url} 失败：HTTP ${res.status}`);
  return applyConfig(await res.json());
}

/* ---------------- 工具 ---------------- */
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
