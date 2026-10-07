#!/usr/bin/env node
/**
 * 生成单文件 index.html / standalone.html
 * 内嵌：完整列表数据 + 早报和默认订阅源前几条的正文（秒开）
 * 其余正文由页面同源加载 content.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const data = JSON.parse(read('data.json'));
const content = existsSync(join(root, 'content.json')) ? JSON.parse(read('content.json')).items || {} : {};

// 内嵌哪些正文：早报全部 + 默认订阅源前 3 条 + 时间线前 6 条
const want = new Set();
(data.morning || []).forEach((it) => it.cid && want.add(it.cid));
(data.timeline || []).slice(0, 6).forEach((it) => it.cid && want.add(it.cid));
for (const s of data.sources || []) {
  if (!s.defaultOn) continue;
  (s.items || []).slice(0, 3).forEach((it) => it.cid && want.add(it.cid));
}
const inlineContent = {};
for (const id of want) if (content[id]) inlineContent[id] = content[id];

// JSON 放进 <script> 里，把 < 转义掉，避免提前闭合
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

const html = read('src/template.html')
  .replace('/*__STYLE__*/', () => read('src/styles.css'))
  .replace('/*__DATA__*/', () => `window.INLINE_DATA = ${js(data)};\nwindow.INLINE_CONTENT = ${js(inlineContent)};`)
  .replace('/*__APP__*/', () => read('src/app.js'));

writeFileSync(join(root, 'index.html'), html);
writeFileSync(join(root, 'standalone.html'), html);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(
  `index.html ${kb(Buffer.byteLength(html))}，内嵌正文 ${Object.keys(inlineContent).length}/${Object.keys(content).length} 条；content.json ${kb(
    existsSync(join(root, 'content.json')) ? readFileSync(join(root, 'content.json')).length : 0
  )}`
);
