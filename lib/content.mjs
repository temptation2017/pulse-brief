/**
 * 按来源类型给条目预抓正文
 *  - article  文章页：直接抓原文抽正文，失败再走 r.jina.ai，再不行找相关报道
 *  - keyword  热搜词：先在同批文章里按标题相似度找，找不到去必应资讯搜
 *  - zhihu    知乎问题：页面基本要登录，试一次，不行按相关报道处理
 *  - video    视频：简介 + 相关报道
 *  - douban   豆瓣电影：剧情简介
 *  - jike     即刻：动态正文
 */
import { fetchText } from './net.mjs';
import { extractArticle, tidy, clip, isBadContent, metaContent, decodeEntities, hanCount } from './extract.mjs';

const MAX_CHARS = Number(process.env.MAX_CHARS || 4000);

// 这些站点要登录或靠前端渲染，服务端抓不到正文
const HARD = /zhihu\.com|weibo\.(com|cn)|douyin\.com|toutiao\.com|xiaohongshu|bilibili\.com|tieba\.baidu|baidu\.com\/s|m\.okjike|mp\.weixin|msn\.com|youtube|twitter|x\.com\//i;
// 搜索结果里不采用的站（内容质量或立场问题）
const SKIP = /epochtimes|ntdtv|secretchina|aboluowang|rfa\.org|voachinese|dwnews|kanzhongguo/i;

export const SOURCE_KIND = {
  weibo_hot: 'keyword',
  baidu_hot: 'keyword',
  toutiao_hot: 'keyword',
  tieba_hot: 'keyword',
  zhihu_hot: 'zhihu',
  weixin_tech: 'article',
  douyin_hot: 'video',
  bilibili_hot: 'video',
  douban_movie: 'douban',
  jike: 'jike',
};
export const kindOf = (id) => SOURCE_KIND[id] || 'article';

/* ---------- 文本相似度：字符二元组 ---------- */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[#＃【】\[\]「」《》“”"'‘’！!？?，,。.：:；;、\s|｜()（）—\-_…·]/g, '');
}
function bigrams(s) {
  const t = norm(s);
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
/** 以短的一方为基准算重合比例 */
export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  // ratio 以短的一方为基准；qa 是搜索词自身被覆盖的比例
  return { ratio: shared / Math.min(A.size, B.size), qa: shared / A.size, shared };
}

/** 去掉搜索引擎不认的符号 */
function cleanQuery(q) {
  return String(q || '')
    .replace(/[#＃【】\[\]「」《》“”"'‘’！!？?|｜()（）…·~～]/g, ' ')
    .replace(/\d+\s*[-:：比]\s*\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从长到短给出几档搜索词 */
export function queryLadder(title) {
  const base = cleanQuery(searchQuery(title));
  const out = [base];
  const first = base.split(/\s+/)[0] || base;
  if (first !== base && first.length >= 4) out.push(first);
  const han = first.replace(/[^\u4e00-\u9fff]/g, '');
  if (han.length > 10) out.push(han.slice(0, 10));
  if (han.length >= 6) out.push(han.slice(0, 6));
  return [...new Set(out)].filter((x) => x.length >= 2);
}

/** 知乎问题、长标题转成适合搜索的关键词 */
export function searchQuery(title) {
  let q = String(title || '')
    .replace(/^#|#$/g, '')
    .replace(/[？?]$/, '');
  q = q.replace(/(，|,)?\s*(如何评价|如何看待|怎么看待|怎么看|你怎么看|为什么|有哪些|是否|会不会|意味着什么|有什么影响|释放了哪些信号|哪些信息值得关注|透露了哪些信息).*$/, '');
  const parts = q.split(/[，,。；;：:]/).filter((x) => x.trim());
  let out = '';
  for (const p of parts) {
    if ((out + p).length > 28 && out) break;
    out += (out ? ' ' : '') + p.trim();
  }
  return (out || q).slice(0, 36);
}

/* ---------- 单页抓取 ---------- */
function jinaToParas(md) {
  let t = String(md || '').replace(/\r/g, '');
  if (/^Warning:/im.test(t)) return [];
  t = t.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gim, '');
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
  const lines = t
    .split(/\n{2,}/)
    .map((b) => b.replace(/\n+/g, ' ').replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim())
    .filter((l) => l && hanCount(l) >= 6);
  return tidy(lines);
}

async function fetchArticleParas(url) {
  // 先用手机 UA（很多站移动版是服务端直出），不行再换桌面 UA
  for (const mobile of [true, false]) {
    try {
      const { text } = await fetchText(url, { mobile, timeout: 20000 });
      const paras = extractArticle(text);
      if (!isBadContent(paras)) return { paras, how: 'direct' };
    } catch (e) {
      if (e.status === 404 || e.status === 410) return null;
    }
  }
  // 服务端走 r.jina.ai（不少站会被挡，失败就算了）
  try {
    const { text } = await fetchText('https://r.jina.ai/' + url, {
      timeout: 20000,
      headers: { Accept: 'text/plain' },
    });
    const paras = jinaToParas(text);
    if (!isBadContent(paras)) return { paras, how: 'jina' };
  } catch (e) {}
  return null;
}

/* ---------- 必应资讯搜索 ---------- */
const searchCache = new Map();
async function bingNews(query) {
  if (searchCache.has(query)) return searchCache.get(query);
  const p = (async () => {
    const url = 'https://www.bing.com/news/search?q=' + encodeURIComponent(query) + '&format=rss';
    let { text } = await fetchText(url, { timeout: 15000 });
    if (!/<item>/i.test(text)) {
      // 偶尔不给 RSS，退到网页版卡片
      try {
        text = (await fetchText(url.replace('&format=rss', ''), { timeout: 15000, mobile: true })).text;
      } catch {}
    }
    const out = [];
    // 先按 RSS 解析；必应目前多半回 HTML 卡片，再按卡片属性解析
    for (const block of text.match(/<item>[\s\S]*?<\/item>/gi) || []) {
      const t = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
      const l = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
      const s = (block.match(/<News:Source>([\s\S]*?)<\/News:Source>/i) || [])[1];
      const d = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
      if (t && l) {
        out.push({
          title: decodeEntities(t),
          url: realUrl(decodeEntities(l)),
          source: decodeEntities(s || ''),
          date: d ? Date.parse(d) || 0 : 0,
        });
      }
    }
    const re = /<div[^>]+class="news-card[^"]*"([^>]*)>/gi;
    let m;
    while ((m = re.exec(text))) {
      const attrs = m[1];
      const u = (attrs.match(/data-url="([^"]+)"/) || [])[1];
      const t = (attrs.match(/data-title="([^"]+)"/) || [])[1];
      const a = (attrs.match(/data-author="([^"]*)"/) || [])[1];
      if (u && t) out.push({ title: decodeEntities(t), url: realUrl(decodeEntities(u)), source: decodeEntities(a || '') });
    }
    return out;
  })().catch(() => []);
  searchCache.set(query, p);
  return p;
}

function realUrl(u) {
  try {
    const x = new URL(u);
    if (/bing\.com$/.test(x.hostname) && x.searchParams.get('url')) return x.searchParams.get('url');
  } catch {}
  return u;
}

// 常见站点的中文名，搜索结果里来源名不全时用
const SITE_NAMES = [
  [/sina\.(com\.cn|cn)$/, '新浪'],
  [/sohu\.com$/, '搜狐'],
  [/qq\.com$/, '腾讯网'],
  [/163\.com$/, '网易'],
  [/china\.com$/, '中华网'],
  [/ifeng\.com$/, '凤凰网'],
  [/thepaper\.cn$/, '澎湃新闻'],
  [/chinanews\.com(\.cn)?$/, '中国新闻网'],
  [/people\.com\.cn$/, '人民网'],
  [/xinhuanet\.com|news\.cn$/, '新华网'],
  [/cctv\.com$/, '央视网'],
  [/ithome\.com$/, 'IT之家'],
  [/36kr\.com$/, '36氪'],
  [/eastmoney\.com$/, '东方财富网'],
  [/yicai\.com$/, '第一财经'],
  [/sciencenet\.cn$/, '科学网'],
  [/ali213\.net$/, '游侠网'],
];
export function prettySource(name, url) {
  const host = hostName(url);
  const n = String(name || '').replace(/\s+on MSN$/i, '').trim();
  // 必应偶尔只给子域名，像 cj、3g.china 这种
  if (n && /[\u4e00-\u9fff]/.test(n)) return n;
  for (const [re, zh] of SITE_NAMES) if (re.test(host)) return zh;
  return n || host;
}

function hostName(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/* ---------- 相关报道 ---------- */
// 同批文章型条目：{ title, url, sourceName, paras }
export const articlePool = [];

const relatedCache = new Map();

/**
 * 找一篇相关报道
 * strict：文章型条目原文抓不到时用，要求标题更接近，基本是同一篇的转载
 */
export async function findRelated(title, { exclude = '', strict = false } = {}) {
  const q = searchQuery(title);
  const key = q + (strict ? '|s' : '');
  if (relatedCache.has(key)) return relatedCache.get(key);
  const minRatio = strict ? 0.55 : 0.35;
  const job = (async () => {
    // 1) 同批已抓到的文章
    let best = null;
    for (const a of articlePool) {
      if (!a.paras || a.url === exclude) continue;
      const s = similarity(q, a.title);
      if (s.shared >= 3 && s.ratio >= Math.max(0.5, minRatio) && s.qa >= 0.4 && (!best || s.ratio > best.score)) {
        best = { ...a, score: s.ratio };
      }
    }
    if (best) {
      return { paras: best.paras, via: { name: best.sourceName, title: best.title, url: best.url }, how: 'pool' };
    }
    // 2) 必应资讯，搜索词从长到短试
    const tried = new Set();
    for (const qq of queryLadder(title)) {
      const results = await bingNews(qq);
      const cands = results
        // 只要 45 天内的报道，太旧的多半是同名旧闻
        .filter((r) => !r.date || Date.now() - r.date < 45 * 86400e3)
        .filter((r) => r.url && !HARD.test(r.url) && !SKIP.test(r.url) && r.url !== exclude && !tried.has(r.url))
        .map((r) => ({ ...r, s: similarity(q, r.title) }))
        .filter((r) => r.s.shared >= 3 && r.s.ratio >= minRatio && r.s.qa >= 0.4)
        .sort((a, b) => b.s.ratio - a.s.ratio)
        .slice(0, 3);
      for (const c of cands) {
        tried.add(c.url);
        const got = await fetchArticleParas(c.url);
        if (got) {
          const via = { name: prettySource(c.source, c.url), title: c.title, url: c.url };
          articlePool.push({ title: c.title, url: c.url, sourceName: via.name, paras: got.paras });
          return { paras: got.paras, via, how: 'search' };
        }
      }
      if (tried.size >= 4) break;
    }
    return null;
  })();
  relatedCache.set(key, job);
  return job;
}

/* ---------- 各类源 ---------- */
async function videoIntro(url) {
  if (!/bilibili\.com/.test(url)) return '';
  try {
    const { text } = await fetchText(url);
    let d = metaContent(text, 'description') || metaContent(text, 'og:description');
    // B 站 description 末尾常带“视频播放量 …”统计，去掉
    d = d.replace(/[,，]?\s*视频播放量[\s\S]*$/, '').replace(/^-+|-+$/g, '').trim();
    return d;
  } catch {
    return '';
  }
}

async function doubanIntro(url) {
  const id = (url.match(/subject\/(\d+)/) || [])[1];
  if (!id) return null;
  try {
    const { text } = await fetchText(`https://m.douban.com/rexxar/api/v2/movie/${id}`, {
      mobile: true,
      headers: { Referer: 'https://m.douban.com/movie/' },
    });
    const j = JSON.parse(text);
    const lines = [];
    const info = [j.year, (j.genres || []).join(' / '), (j.countries || []).join(' / ')].filter(Boolean).join(' · ');
    if (info) lines.push(info);
    if (j.rating && j.rating.value) lines.push(`豆瓣评分 ${j.rating.value}（${j.rating.count || 0} 人评价）`);
    const dir = (j.directors || []).map((x) => x.name).join('、');
    const act = (j.actors || []).slice(0, 5).map((x) => x.name).join('、');
    if (dir) lines.push('导演：' + dir);
    if (act) lines.push('主演：' + act);
    String(j.intro || '')
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => lines.push(x));
    return hanCount(j.intro || '') >= 30 ? lines : null;
  } catch {
    return null;
  }
}

async function jikePost(url) {
  try {
    const { text } = await fetchText(url, { mobile: true });
    const m = text.match(/"content":"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    const body = JSON.parse('"' + m[1] + '"');
    const paras = tidy(body.split(/\n+/));
    return hanCount(body) >= 30 ? paras : null;
  } catch {
    return null;
  }
}

/**
 * 给单条条目找正文
 * 返回 { kind: 'full'|'related'|'intro', paras, via?, how } 或 null
 */
export async function contentFor(item, src) {
  const kind = kindOf(src.id);
  const url = item.url || '';

  if (kind === 'article') {
    if (url && !HARD.test(url)) {
      const got = await fetchArticleParas(url);
      if (got) return { kind: 'full', paras: got.paras, how: got.how };
    } else if (/mp\.weixin/.test(url)) {
      // 公众号文章多半给验证页，试一次
      const got = await fetchArticleParas(url.replace(/#.*$/, ''));
      if (got) return { kind: 'full', paras: got.paras, how: got.how };
    }
    // 公众号文章常被门户转载，标题基本一致；其他文章型源要求更严
    const rel = await findRelated(item.title, { exclude: url, strict: !/mp\.weixin/.test(url) });
    return rel ? { kind: 'related', ...rel } : null;
  }

  if (kind === 'zhihu') {
    // 知乎问题页和接口都要登录，这里不硬抓，直接找相关报道
    const rel = await findRelated(item.title);
    return rel ? { kind: 'related', ...rel } : null;
  }

  if (kind === 'keyword') {
    const rel = await findRelated(item.title);
    return rel ? { kind: 'related', ...rel } : null;
  }

  if (kind === 'video') {
    const intro = await videoIntro(url);
    const rel = await findRelated(item.title);
    if (rel) {
      const paras = intro && hanCount(intro) >= 10 ? ['视频简介：' + intro, ...rel.paras] : rel.paras;
      return { kind: 'related', ...rel, paras };
    }
    if (intro && hanCount(intro) >= 40) return { kind: 'intro', paras: ['视频简介：' + intro], how: 'meta' };
    return null;
  }

  if (kind === 'douban') {
    const lines = await doubanIntro(url);
    if (lines) return { kind: 'intro', paras: lines, how: 'douban' };
    return null;
  }

  if (kind === 'jike') {
    const paras = await jikePost(url);
    if (paras) return { kind: 'full', paras, how: 'jike' };
    return null;
  }
  return null;
}

export function finalize(got) {
  if (!got || !got.paras || !got.paras.length) return null;
  const c = clip(got.paras, MAX_CHARS);
  if (got.kind !== 'intro' && isBadContent(c.paras)) return null;
  const out = { k: got.kind, p: c.paras };
  if (c.truncated) out.cut = 1;
  if (got.via) out.via = got.via;
  return out;
}
