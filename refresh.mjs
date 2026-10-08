#!/usr/bin/env node
/**
 * PulseBrief 数据刷新（无 npm 依赖，Node 20+）
 * 抓 tophub.today 公开榜单 / 公开 RSS，每源前 10 条，写 data.json。
 * 每条只留标题、来源、发布时间、原文链接和不超过 120 字的摘要，不抓原文页。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'data.json');
const PER_SOURCE = 10;
// 摘要上限（字）
const SUMMARY_MAX = 120;
// 同一域名两次请求之间至少隔这么久
const HOST_GAP_MS = 800;
// 只保留最近 24 小时的条目：有发布时间按发布时间，没有就按首次抓到的时间
const KEEP_MS = 24 * 3600e3;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 信源目录：与订阅广场一致 */
const CATALOG = [
  { id: 'weibo_hot', name: '微博热搜榜', cat: '综合', color: '#e6162d', icon: '微', hash: 'KqndgxeLl9', defaultOn: true },
  { id: 'zhihu_hot', name: '知乎热榜', cat: '综合', color: '#0084ff', icon: '知', hash: 'mproPpoq6O', defaultOn: true },
  { id: 'douyin_hot', name: '抖音热榜', cat: '娱乐', color: '#111111', icon: '抖', hash: 'DpQvNABoNE', defaultOn: false },
  { id: 'toutiao_hot', name: '今日头条热榜', cat: '综合', color: '#f04142', icon: '头', hash: 'x9ozB4KoXb', defaultOn: true },
  { id: 'thepaper_hot', name: '澎湃新闻热榜', cat: '综合', color: '#e60012', icon: '湃', hash: 'wWmoO5Rd4E', defaultOn: false },
  { id: 'xinwen_lianbo', name: '新闻联播速览', cat: '综合', color: '#c8102e', icon: '联', placeholder: true },
  { id: 'ithome_daily', name: 'IT之家日榜', cat: '科技', color: '#d35400', icon: 'IT', hash: '74Kvx59dkx', defaultOn: true },
  { id: 'ithome_flash', name: 'IT之家快讯', cat: '科技', color: '#e67e22', icon: '讯', rss: 'https://www.ithome.com/rss/', defaultOn: false },
  { id: 'bilibili_hot', name: 'Bilibili热门', cat: '娱乐', color: '#fb7299', icon: 'B', hash: '74KvxwokxM', defaultOn: false },
  { id: 'weixin_tech', name: '微信科技热门', cat: '科技', color: '#07c160', icon: '微', hash: 'WnBe01o371', defaultOn: false },
  { id: 'kr36', name: '36氪热门', cat: '科技', color: '#1a73e8', icon: '36', hash: 'Q1Vd5Ko85R', rss: 'https://www.36kr.com/feed', defaultOn: false },
  { id: 'huxiu', name: '虎嗅精选', cat: '科技', color: '#ff6600', icon: '虎', hash: '5VaobgvAj1', defaultOn: false },
  { id: 'sspai', name: '少数派', cat: '科技', color: '#c45c26', icon: '派', hash: 'Y2KeDGQdNP', rss: 'https://sspai.com/feed', defaultOn: false },
  { id: 'wallstreet', name: '华尔街见闻', cat: '财经', color: '#1a1a2e', icon: '华', hash: 'G2me3ndwjq', defaultOn: false },
  { id: 'caixin', name: '财新网', cat: '财经', color: '#005bac', icon: '财', placeholder: true },
  { id: 'tencent_hot', name: '腾讯新闻热门', cat: '综合', color: '#12b7f5', icon: '腾', hash: '12owgX0oNV', defaultOn: false },
  { id: 'douban_movie', name: '豆瓣电影周榜', cat: '娱乐', color: '#00b51d', icon: '豆', hash: 'mDOvnyBoEB', defaultOn: false },
  { id: 'netease', name: '网易新闻', cat: '综合', color: '#c4302b', icon: '易', placeholder: true },
  { id: 'baidu_hot', name: '百度热搜', cat: '综合', color: '#2932e1', icon: '百', hash: 'Jb0vmloB1G', defaultOn: true },
  { id: 'jiemian', name: '界面新闻', cat: '财经', color: '#e60012', icon: '界', placeholder: true },
  { id: 'yicai', name: '第一财经', cat: '财经', color: '#c8102e', icon: '一', hash: '0MdKam4ow1', defaultOn: false },
  { id: 'sohu', name: '搜狐新闻', cat: '综合', color: '#ffc107', icon: '狐', placeholder: true },
  { id: 'sina_mil', name: '新浪军事新闻点击榜', cat: '综合', color: '#e6162d', icon: '军', placeholder: true },
  { id: 'tieba_hot', name: '贴吧热议', cat: '娱乐', color: '#2d78f4', icon: '贴', hash: 'Om4ejxvxEN', defaultOn: false },
  { id: 'tmtpost', name: '钛媒体', cat: '科技', color: '#e60012', icon: '钛', placeholder: true },
  { id: 'jike', name: '即刻精选', cat: '科技', color: '#ffe300', icon: '即', hash: 'm4ejZz1exE', defaultOn: false },
  { id: 'eeo', name: '经济观察网', cat: '财经', color: '#003366', icon: '经', placeholder: true },
];

const hostNext = new Map();
async function waitHost(url) {
  const host = new URL(url).host;
  const now = Date.now();
  const at = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, at + HOST_GAP_MS);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function fetchText(url, headers = {}) {
  await waitHost(url);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

async function fetchJsonPost(url, form) {
  const body = new URLSearchParams(form).toString();
  await waitHost(url);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://tophub.today/',
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function stripHtml(html) {
  let t = decodeEntities(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/p>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function summarize(text, max = SUMMARY_MAX) {
  const t = stripHtml(text)
    .replace(/^IT之家\s*\d+\s*月\s*\d+\s*日消息[，,：:]?\s*/i, '')
    .replace(/^Matrix首页推荐[\s\S]*?观点。\s*/i, '')
    .replace(/查看全文\s*$/i, '')
    .trim();
  if (!t) return '';
  const parts = t.split(/(?<=[。！？!?])/);
  let out = '';
  for (const p of parts) {
    if (!p.trim()) continue;
    if (!out) {
      out = p.trim();
      continue;
    }
    if ((out + p).length <= max) out += p.trim();
    else break;
  }
  if (out.length > max) out = out.slice(0, max - 1) + '…';
  return out;
}

function parseRssItems(xml, limit = 10) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = decodeEntities(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''
    ).trim();
    const link = decodeEntities(
      (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] ||
        (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] ||
        ''
    ).trim();
    // 只用 description，不读 content:encoded（那是全文）
    const desc =
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const pub =
      (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (!title) continue;
    items.push({
      title,
      summary: summarize(desc),
      url: link,
      publishedAt: pub ? new Date(pub).toISOString() : null,
    });
    if (items.length >= limit) break;
  }
  return items;
}

function parseTophubHtml(html, limit = 12) {
  const items = [];
  // 带热度 ws
  const reWs =
    /<td><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>\s*<td class="ws">([^<]*)<\/td>/g;
  let m;
  while ((m = reWs.exec(html)) && items.length < limit) {
    const title = decodeEntities(m[2]).trim();
    if (!title || title.includes("'+") || title.includes('v.title')) continue;
    const hot = stripHtml(m[3]).trim();
    const summary = hot ? `当前热度 ${hot}。` : '';
    items.push({
      title,
      summary,
      url: m[1],
      hot: hot || undefined,
    });
  }
  if (items.length) return items;

  // 带 item-desc
  const reDesc =
    /<td class="al">\s*<div><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/div>\s*<div class="item-desc">([^<]*)<\/div>/g;
  while ((m = reDesc.exec(html)) && items.length < limit) {
    const title = decodeEntities(m[2]).trim();
    if (!title || title.includes("'+")) continue;
    const hot = stripHtml(m[3]).trim().replace(/热度$/, '');
    items.push({
      title,
      summary: hot ? `当前热度 ${hot}。` : '',
      url: m[1],
      hot: hot || undefined,
    });
  }
  return items;
}

function extractNodeId(html) {
  const m =
    html.match(/window\.nodeId\s*=\s*["']?(\d+)/) ||
    html.match(/nodeid=["'](\d+)["']/);
  return m ? m[1] : null;
}

function todayBJ() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

async function fetchTophub(hash, limit = 12) {
  const html = await fetchText(`https://tophub.today/n/${hash}`, {
    Referer: 'https://tophub.today/',
  });
  let items = parseTophubHtml(html, limit);
  if (items.length >= 3) return items;

  const nodeId = extractNodeId(html);
  if (!nodeId) return items;

  const json = await fetchJsonPost('https://tophub.today/node-items-by-date', {
    p: '1',
    date: todayBJ(),
    nodeid: nodeId,
  });
  const raw = json?.data?.items || json?.data || [];
  if (!Array.isArray(raw)) return items;
  items = [];
  for (const it of raw) {
    if (!it?.title) continue;
    const hot = it.extra || '';
    const desc = it.description || '';
    const summary = summarize(desc) || (hot ? `当前热度 ${hot}。` : '');
    items.push({
      title: String(it.title).trim(),
      summary,
      url: it.url || '',
      hot: hot || undefined,
      publishedAt: null,
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchRss(url, limit = 10) {
  const xml = await fetchText(url);
  return parseRssItems(xml, limit);
}

function relativeMinutes(it, i) {
  // 有发布时间就用真实时间，没有就按榜单名次排
  if (it.publishedAt) {
    const m = Math.floor((Date.now() - new Date(it.publishedAt).getTime()) / 60000);
    if (m >= 0) return Math.max(1, m);
  }
  return i * 3 + 1;
}

function seenKey(srcId, it) {
  return srcId + '|' + (it.url || it.title);
}

/** 上次 data.json 里每条的首次抓取时间，用来判断热榜条目挂了多久 */
function loadPrevSeen() {
  const seen = {};
  if (!existsSync(OUT)) return seen;
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const src of prev.sources || []) {
      for (const it of src.items || []) {
        if (it.fetchedAt) seen[seenKey(src.id, it)] = it.fetchedAt;
      }
    }
  } catch {}
  return seen;
}

function isRecent(it, now) {
  const t = Date.parse(it.publishedAt || it.fetchedAt || '');
  if (!t) return true;
  return now - t <= KEEP_MS;
}

async function safe(label, fn) {
  try {
    const items = await fn();
    console.log(`✓ ${label}: ${items.length} 条`);
    return items;
  } catch (e) {
    console.error(`✗ ${label}: ${e.message}`);
    return null;
  }
}

function buildTechEvents() {
  // 科技大事：无公开日历 API 时用近期/当月已知节点（静态策展）
  const y = 2026;
  return [
    {
      time: `${y}-10-07 17:45`,
      place: '线上',
      title: '诺贝尔化学奖公布日关注',
    },
    {
      time: `${y}-10-08 19:00`,
      place: '线上',
      title: '诺贝尔文学奖公布日关注',
    },
    {
      time: `${y}-10-09 17:00`,
      place: '线上',
      title: '诺贝尔和平奖公布日关注',
    },
    {
      time: `${y}-10-10 10:00`,
      place: '美国旧金山',
      title: '微软 AI PC / Copilot+ 相关发布窗口',
    },
    {
      time: `${y}-10-12 20:00`,
      place: '线上',
      title: '英雄联盟全球总决赛主题曲发布窗口',
    },
    {
      time: `${y}-10-15 14:00`,
      place: '中国',
      title: '国内科技新品与 AI 硬件密集发布周',
    },
  ];
}

async function main() {
  const sources = [];
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const prevSeen = loadPrevSeen();
  let dropped = 0;

  for (const meta of CATALOG) {
    let items = null;
    let live = false;
    let status = 'ok';

    if (meta.placeholder) {
      status = 'unavailable';
      items = [];
    } else if (meta.hash) {
      items = await safe(meta.name, () => fetchTophub(meta.hash, PER_SOURCE));
      if ((!items || !items.length) && meta.rss) {
        items = await safe(meta.name + '(RSS)', () => fetchRss(meta.rss, PER_SOURCE));
      }
    } else if (meta.rss) {
      items = await safe(meta.name, () => fetchRss(meta.rss, PER_SOURCE));
    }

    if (items && items.length) {
      live = true;
      status = 'ok';
      // 记下首次抓到的时间，超过 24 小时的条目直接丢掉
      const before = items.length;
      items = items
        .map((it) => ({ ...it, fetchedAt: prevSeen[seenKey(meta.id, it)] || nowIso }))
        .filter((it) => isRecent(it, now));
      dropped += before - items.length;
      // 补相对时间戳用于时间线
      items = items.map((it, i) => ({
        ...it,
        minsAgo: relativeMinutes(it, i),
        tags: [meta.cat, meta.name.replace(/热榜|日榜|热门|精选|速览|点击榜|周榜/g, '')].filter(Boolean),
      }));
    } else if (!meta.placeholder) {
      status = 'unavailable';
      items = [];
      live = false;
    }

    sources.push({
      id: meta.id,
      name: meta.name,
      cat: meta.cat,
      color: meta.color,
      icon: meta.icon,
      defaultOn: !!meta.defaultOn,
      live,
      status,
      updatedAt: live ? nowIso : null,
      todayCount: items.length,
      items,
    });
  }

  // 拿到的源太少多半是网络被挡，别用残缺数据覆盖线上
  const liveCount = sources.filter((s) => s.live).length;
  if (liveCount < Number(process.env.MIN_LIVE || 6)) {
    throw new Error(`只拿到 ${liveCount} 个源，放弃本次写入`);
  }

  // 早报：从默认订阅源各取若干，凑满 10 条
  const defaultIds = CATALOG.filter((c) => c.defaultOn).map((c) => c.id);
  const morning = [];
  const used = new Set();
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  for (const id of defaultIds) {
    const src = byId[id];
    if (!src?.items?.length) continue;
    const picks = src.items.slice(0, 3);
    for (const it of picks) {
      const key = it.title.slice(0, 24);
      if (used.has(key)) continue;
      used.add(key);
      morning.push({
        ...it,
        sourceId: src.id,
        sourceName: src.name,
      });
      if (morning.length >= 10) break;
    }
    if (morning.length >= 10) break;
  }
  // 不足则从所有 live 源补
  if (morning.length < 10) {
    for (const src of sources) {
      if (!src.live) continue;
      for (const it of src.items) {
        const key = it.title.slice(0, 24);
        if (used.has(key)) continue;
        used.add(key);
        morning.push({ ...it, sourceId: src.id, sourceName: src.name });
        if (morning.length >= 10) break;
      }
      if (morning.length >= 10) break;
    }
  }

  // 24小时热榜时间线：混排各 live 源前几条
  const timeline = [];
  for (const src of sources.filter((s) => s.live)) {
    src.items.slice(0, 4).forEach((it, i) => {
      timeline.push({
        ...it,
        sourceId: src.id,
        sourceName: src.name,
        minsAgo: it.minsAgo || i * 2 + 1,
      });
    });
  }
  timeline.sort((a, b) => (a.minsAgo || 0) - (b.minsAgo || 0));

  const data = {
    updatedAt: nowIso,
    updatedAtLabel: new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    }),
    morning: morning.slice(0, 10),
    timeline: timeline.slice(0, 40),
    techEvents: buildTechEvents(),
    sources,
    catalog: CATALOG.map(({ id, name, cat, color, icon, defaultOn }) => ({
      id,
      name,
      cat,
      color,
      icon,
      defaultOn: !!defaultOn,
    })),
  };

  writeFileSync(OUT, JSON.stringify(data), 'utf8');
  const liveN = sources.filter((s) => s.live).length;
  const deadN = sources.filter((s) => !s.live).length;
  console.log(`写入 ${OUT}`);
  console.log(`live ${liveN} · 暂不可用 ${deadN} · 早报 ${data.morning.length} · 时间线 ${data.timeline.length} · 超过 24 小时丢弃 ${dropped}`);
  console.log(
    'live:',
    sources.filter((s) => s.live).map((s) => `${s.name}${s.items.length}`).join(' · ')
  );
  console.log(
    'placeholder:',
    sources.filter((s) => !s.live).map((s) => s.name).join(' · ')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
