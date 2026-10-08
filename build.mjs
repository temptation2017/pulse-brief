#!/usr/bin/env node
/**
 * 生成单文件 index.html / standalone.html，内嵌 data.json 的列表数据（秒开）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const data = JSON.parse(read('data.json'));

// JSON 放进 <script> 里，把 < 转义掉，避免提前闭合
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

const html = read('src/template.html')
  .replace('/*__STYLE__*/', () => read('src/styles.css'))
  .replace('/*__DATA__*/', () => `window.INLINE_DATA = ${js(data)};`)
  .replace('/*__APP__*/', () => read('src/app.js'));

writeFileSync(join(root, 'index.html'), html);
writeFileSync(join(root, 'standalone.html'), html);
console.log(`index.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
