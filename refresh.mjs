#!/usr/bin/env node
/**
 * 要知简报 · 数据刷新（无 npm 依赖，Node 20+）
 * 1. 抓 tophub.today 公开榜单 / 公开 RSS，每源前 10 条
 * 2. 给每条预抓正文，写进 content.json（data.json 只放列表）
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './lib/net.mjs';
import { contentFor, finalize, kindOf, articlePool } from './lib/content.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'data.json');
const OUT_CONTENT = join(__dirname, 'content.json');
const PER_SOURCE = 10;
// 正文缓存有效期：原文类 3 天，相关报道 6 小时（热点会变）
const TTL_FULL = 72 * 3600e3;
const TTL_RELATED = 6 * 3600e3;
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

async function fetchText(url, headers = {}) {
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

function summarize(text, max = 140) {
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

function bulletsFrom(text, title) {
  const s = summarize(text, 220) || title;
  const parts = s.split(/(?<=[。！？!?；;])/).map((x) => x.trim()).filter(Boolean);
  const bullets = [];
  for (const p of parts) {
    if (bullets.length >= 3) break;
    if (p.length < 6) continue;
    bullets.push(p.length > 80 ? p.slice(0, 79) + '…' : p);
  }
  if (!bullets.length) bullets.push(title);
  return bullets;
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
    const desc =
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] ||
      (block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i) ||
        [])[1] ||
      '';
    const pub =
      (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (!title) continue;
    const summary = summarize(desc) || title;
    items.push({
      title,
      summary,
      bullets: bulletsFrom(desc || summary, title),
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
    const summary = hot ? `当前热度 ${hot}。` : title;
    items.push({
      title,
      summary,
      bullets: hot
        ? [`当前热度 ${hot}`, '来自公开热榜聚合，详情可在页内展开查看。']
        : [title],
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
      summary: hot ? `当前热度 ${hot}。` : title,
      bullets: hot
        ? [`当前热度 ${hot}`, '来自公开热榜聚合。']
        : [title],
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
    const summary =
      summarize(desc) ||
      (hot ? `当前热度 ${hot}。` : it.title);
    items.push({
      title: String(it.title).trim(),
      summary,
      bullets: bulletsFrom(desc || summary, it.title),
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

  const coverage = await attachContent(sources);

  // 早报：从默认订阅源各取若干，凑满 10 条
  const defaultIds = CATALOG.filter((c) => c.defaultOn).map((c) => c.id);
  const morning = [];
  const used = new Set();
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  for (const id of defaultIds) {
    const src = byId[id];
    if (!src?.items?.length) continue;
    // 有正文的排前面，早报点开就能读
    const picks = [...src.items.filter((x) => x.ck), ...src.items.filter((x) => !x.ck)].slice(0, 3);
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
    [...src.items.filter((x) => x.ck), ...src.items.filter((x) => !x.ck)].slice(0, 4).forEach((it, i) => {
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

  data.coverage = coverage;
  writeFileSync(OUT, JSON.stringify(data), 'utf8');
  const liveN = sources.filter((s) => s.live).length;
  const deadN = sources.filter((s) => !s.live).length;
  console.log(`写入 ${OUT}`);
  console.log(`live ${liveN} · 暂不可用 ${deadN} · 早报 ${data.morning.length} · 时间线 ${data.timeline.length}`);
  console.log(
    'live:',
    sources.filter((s) => s.live).map((s) => `${s.name}${s.items.length}`).join(' · ')
  );
  console.log(
    'placeholder:',
    sources.filter((s) => !s.live).map((s) => s.name).join(' · ')
  );
}

/* ---------------- 正文 ---------------- */

function cidOf(it, srcId) {
  return createHash('sha1').update(srcId + '|' + (it.url || it.title)).digest('hex').slice(0, 10);
}

function loadPrevContent() {
  if (process.env.FRESH === '1' || !existsSync(OUT_CONTENT)) return {};
  try {
    return JSON.parse(readFileSync(OUT_CONTENT, 'utf8')).items || {};
  } catch {
    return {};
  }
}

function isTrivialSummary(it) {
  return !it.summary || it.summary === it.title || /^当前热度/.test(it.summary);
}

function firstSentences(paras, max = 110) {
  const text = paras.join('').replace(/^IT之家\s*\d+\s*月\s*\d+\s*日消息[，,：:]?\s*/, '');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  return end > 30 ? cut.slice(0, end + 1) : cut + '…';
}

async function attachContent(sources) {
  const prev = loadPrevContent();
  const now = Date.now();
  const store = {};
  const started = Date.now();

  const live = sources.filter((s) => s.live);
  const jobs = [];
  for (const src of live) {
    for (const it of src.items) {
      it.cid = cidOf(it, src.id);
      jobs.push({ it, src, kind: kindOf(src.id) });
    }
  }

  const run = async ({ it, src }) => {
    const old = prev[it.cid];
    if (old && old.t) {
      const ttl = old.k === 'related' ? TTL_RELATED : TTL_FULL;
      if (now - old.t < ttl) return old;
    }
    let got = null;
    try {
      got = finalize(await contentFor(it, src));
    } catch (e) {
      got = null;
    }
    if (got) got.t = now;
    return got;
  };

  const save = (job, got) => {
    if (!got) return;
    store[job.it.cid] = got;
    job.it.ck = got.k;
    if (got.via) job.it.via = { name: got.via.name, title: got.via.title };
    if (got.k === 'full' && isTrivialSummary(job.it)) job.it.summary = firstSentences(got.p);
  };

  // 先抓文章型，填好相关报道的匹配池；再处理热搜词、问题、视频
  const first = jobs.filter((j) => ['article', 'douban', 'jike'].includes(j.kind));
  const second = jobs.filter((j) => !['article', 'douban', 'jike'].includes(j.kind));

  const r1 = await pool(first, 6, run);
  first.forEach((j, i) => {
    save(j, r1[i]);
    if (r1[i] && r1[i].k === 'full' && j.kind === 'article') {
      articlePool.push({ title: j.it.title, url: j.it.url, sourceName: j.src.name, paras: r1[i].p });
    }
  });
  console.log(`正文第一轮完成 ${first.length} 条，用时 ${Math.round((Date.now() - started) / 1000)}s`);

  const r2 = await pool(second, 4, run);
  second.forEach((j, i) => save(j, r2[i]));
  console.log(`正文第二轮完成 ${second.length} 条，用时 ${Math.round((Date.now() - started) / 1000)}s`);

  // 覆盖率
  const coverage = {};
  let all = 0;
  let hit = 0;
  for (const src of live) {
    const n = src.items.length;
    const c = src.items.filter((it) => it.ck).length;
    const kinds = {};
    src.items.forEach((it) => {
      if (it.ck) kinds[it.ck] = (kinds[it.ck] || 0) + 1;
    });
    coverage[src.id] = { name: src.name, total: n, withContent: c, kinds };
    all += n;
    hit += c;
  }
  coverage._all = { total: all, withContent: hit, rate: all ? Math.round((hit / all) * 1000) / 10 : 0 };

  const totalChars = Object.values(store).reduce((a, x) => a + x.p.join('').length, 0);
  writeFileSync(
    OUT_CONTENT,
    JSON.stringify({ updatedAt: new Date().toISOString(), items: store }),
    'utf8'
  );
  console.log(`写入 ${OUT_CONTENT}：${Object.keys(store).length} 条，${totalChars} 字`);
  console.log('正文覆盖率：');
  for (const [id, c] of Object.entries(coverage)) {
    if (id === '_all') continue;
    console.log(`  ${c.name.padEnd(10, '　')} ${c.withContent}/${c.total}  ${JSON.stringify(c.kinds)}`);
  }
  console.log(`  合计 ${hit}/${all} = ${coverage._all.rate}%`);
  return coverage;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
