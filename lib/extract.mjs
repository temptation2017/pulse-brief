/**
 * 正文抽取：不依赖 DOM 库，按段落密度找正文
 * 思路：把页面里的 <p>（含 SSR JSON 里转义的 <p>）都拆出来，
 * 按在源码中的位置聚成簇，取汉字最多的一簇。
 */

export function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 把 SSR 数据里转义过的 HTML 还原，便于统一按 <p> 抽取 */
function unescapeJsonHtml(html) {
  return html
    .replace(/\\u003[cC]/g, '<')
    .replace(/\\u003[eE]/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\x3[cC]/g, '<')
    .replace(/\\x3[eE]/g, '>')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '\n');
}

const NOISE = [
  /^(责任编辑|编辑|校对|审核|监制|作者|来源|原标题|图片来源|图源|题图|封面图|本文来源|文章来源|撰文|记者|实习生|通讯员)[：:]/,
  /版权所有|未经授权|不得转载|转载请|禁止转载|All Rights Reserved/i,
  /扫码|二维码|下载.{0,4}(APP|App|客户端)|点击(关注|下载|阅读原文)|关注我们|长按识别|分享到|打开.{0,4}App/,
  /^(相关阅读|相关推荐|推荐阅读|延伸阅读|热门推荐|猜你喜欢|往期回顾|更多精彩)/,
  /广告声明|文内含有的对外跳转链接|IT之家所有文章均包含本声明/,
  /^(返回|首页|上一篇|下一篇|举报|评论|点赞|收藏)$/,
  /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*\d{1,2}:\d{2}/,
  /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/,
  /\d{2}\/\d{2} \d{2}:\d{2}$/,
  /ICP备|ICP证|许可证|备案号|公网安备|违法和不良信息举报/,
  /\{\{[^}]*\}\}/,
  /^(AI生成\s*)?免责声明$/,
];

function cleanText(raw) {
  let t = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  return t
    .split(/\n+/)
    .map((x) => x.replace(/[\s\u3000\u00a0]+/g, ' ').trim())
    .filter(Boolean);
}

function hanCount(s) {
  const m = s.match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

function isNoise(line) {
  if (line.length < 2) return true;
  for (const re of NOISE) if (re.test(line)) return true;
  // 链接或纯符号
  if (/^https?:\/\//i.test(line)) return true;
  if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(line)) return true;
  return false;
}

/** 抽出所有段落及其在源码中的位置 */
function collectParagraphs(html) {
  const out = [];
  const re = /<(p|h[2-4]|blockquote|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[3];
    if (inner.length > 20000) continue;
    const attrs = m[2] || '';
    // 列表标题、时间、作者栏这类带特定 class 的段落不算正文
    const tag = m[1].toLowerCase();
    if ((tag === 'p' || tag === 'li') && /class=["'][^"']*(title|footer|time|date|related|recommend|share|copyright|plc-)/i.test(attrs)) {
      out.push({ pos: m.index, text: '', tag: 'stop' });
      continue;
    }
    const lines = cleanText(inner);
    for (const line of lines) {
      const stop = STOP.test(line);
      out.push({ pos: m.index, text: stop ? '' : line, tag: stop ? 'stop' : m[1].toLowerCase() });
    }
  }
  return out;
}

// 出现这些字样说明正文结束，后面多是推荐列表
const STOP = /^(文章作者|相关(文章|阅读|新闻|推荐|报道)|推荐阅读|延伸阅读|热门(文章|推荐|新闻)|猜你喜欢|更多(文章|精彩|新闻)|关于这篇稿子|本文写作说明|长按关注)/;

/** 位置相近的段落聚成簇，返回汉字最多的簇 */
function bestCluster(paras, gap = 2000) {
  const clusters = [];
  let cur = null;
  let lastPos = -1e9;
  for (const p of paras) {
    if (p.tag === 'stop') {
      cur = null;
      continue;
    }
    if (!cur || p.pos - lastPos > gap) {
      cur = { paras: [], score: 0 };
      clusters.push(cur);
    }
    cur.paras.push(p);
    // li 和标题权重低，避免导航列表胜出
    const w = p.tag === 'p' || p.tag === 'blockquote' ? 1 : 0.3;
    if (p.text.length >= 8) cur.score += hanCount(p.text) * w;
    lastPos = p.pos;
  }
  clusters.sort((a, b) => b.score - a.score);
  return clusters[0] || null;
}

function jsonLdBody(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    const json = b.replace(/^<script[^>]*>|<\/script>$/gi, '');
    try {
      const obj = JSON.parse(json);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        if (o && typeof o.articleBody === 'string' && hanCount(o.articleBody) > 150) {
          return cleanText(o.articleBody.replace(/\n/g, '<br>'));
        }
      }
    } catch {}
  }
  return null;
}

export function metaContent(html, name) {
  const re1 = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
    'i'
  );
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : '';
}

export function pageTitle(html) {
  const og = metaContent(html, 'og:title');
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * 从 HTML 抽正文，返回段落数组（已清洗、去重），失败返回 []
 */
export function extractArticle(html) {
  if (!html) return [];
  let src = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(header|footer|nav|aside|noscript|svg|form|select|textarea)[\s\S]*?<\/\1>/gi, ' ');

  const ld = jsonLdBody(src);
  let paras;
  if (ld && ld.length >= 2) {
    paras = ld;
  } else {
    src = src.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    // 普通 <p> 与 SSR 里转义的 <p> 一起参与
    const all = collectParagraphs(src);
    const escaped = /\\u003[cC]p|\\x3[cC]p/.test(src)
      ? collectParagraphs(unescapeJsonHtml(src.replace(/<script(?![^>]*ld\+json)[^>]*>/gi, '<script>')))
      : [];
    const cA = bestCluster(all);
    const cB = escaped.length ? bestCluster(escaped) : null;
    const best = cB && (!cA || cB.score > cA.score * 1.2) ? cB : cA;
    paras = best ? best.paras.map((p) => p.text) : [];
  }
  return tidy(paras);
}

/** 清洗、去重、合并过短行 */
export function tidy(lines) {
  const seen = new Set();
  const out = [];
  for (let line of lines) {
    line = String(line || '').replace(/[\s\u3000]+/g, ' ').trim();
    if (isNoise(line)) continue;
    const key = line.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  // 去掉首尾的零碎短行（作者栏、相关推荐等）
  const short = (l) => l.length < 14 && !/[。！？.!?]$/.test(l);
  while (out.length > 3 && short(out[out.length - 1])) out.pop();
  while (out.length > 3 && short(out[0])) out.shift();
  return out;
}

/** 截断到上限，尽量在段落边界 */
export function clip(paras, max = 4000) {
  const out = [];
  let n = 0;
  let truncated = false;
  for (const p of paras) {
    if (n + p.length > max) {
      const room = max - n;
      if (room > 120) {
        const cut = p.slice(0, room);
        const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
        out.push(end > 60 ? cut.slice(0, end + 1) : cut + '…');
      }
      truncated = true;
      break;
    }
    out.push(p);
    n += p.length;
  }
  return { paras: out, truncated, chars: Math.min(n, max) };
}

/** 与前端 isBadFetchContent 同规则：登录墙、验证码、过短内容都算坏 */
export function isBadContent(paras) {
  const text = (Array.isArray(paras) ? paras.join('\n') : String(paras || '')).trim();
  if (!text) return true;
  const bad = [
    /captcha/i,
    /authorized to access/i,
    /please make sure you are authorized/i,
    /请您登录/,
    /登录后查看/,
    /更多专业优质内容/,
    /请先登录/,
    /该内容需登录/,
    /验证码/,
    /访问异常/,
    /网络环境存在异常/,
    /环境异常/,
    /403 forbidden/i,
    /just a moment/i,
    /cf-browser-verification/i,
    /access denied/i,
    /sign in to continue/i,
    /enable javascript and cookies/i,
  ];
  const head = text.slice(0, 600);
  for (const re of bad) if (re.test(head)) return true;
  const plain = text.replace(/\s+/g, '');
  if (hanCount(plain) < 80 && plain.length < 200) return true;
  if (/登录|验证码|captcha|warning/i.test(text) && plain.length < 220) return true;
  return false;
}

export { hanCount };
