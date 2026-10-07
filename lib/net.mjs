/**
 * 网络请求：超时、按域名限速、自动识别编码
 */
export const UA_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
export const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 同一域名两次请求之间至少隔这么久
const HOST_GAP_MS = Number(process.env.HOST_GAP_MS || 800);
const hostNext = new Map();

async function waitHost(url) {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  const now = Date.now();
  const at = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, at + HOST_GAP_MS);
  if (at > now) await sleep(at - now);
}

function pickCharset(res, buf) {
  const ct = res.headers.get('content-type') || '';
  let m = ct.match(/charset=([\w-]+)/i);
  if (m) return m[1].toLowerCase();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
  m = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  return m ? m[1].toLowerCase() : 'utf-8';
}

export async function fetchText(url, { headers = {}, timeout = 12000, mobile = false, method, body } = {}) {
  await waitHost(url);
  const res = await fetch(url, {
    method: method || 'GET',
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    headers: {
      'User-Agent': mobile ? UA_MOBILE : UA_DESKTOP,
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      ...headers,
    },
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  let cs = pickCharset(res, buf);
  if (cs === 'gb2312') cs = 'gbk';
  let text;
  try {
    text = new TextDecoder(cs).decode(buf);
  } catch {
    text = new TextDecoder('utf-8').decode(buf);
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 300);
    throw err;
  }
  return { text, finalUrl: res.url || url };
}

/** 简单并发池 */
export async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const k = i++;
      try {
        out[k] = await fn(list[k], k);
      } catch (e) {
        out[k] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export { sleep };
