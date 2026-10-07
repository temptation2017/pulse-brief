# 要知简报

参考软媒「要知」做的移动端资讯摘要页：早报、我的订阅、24 小时热榜、科技大事、订阅广场、我。

线上地址：https://temptation2017.github.io/yaozhi-digest/

## 点开就是全文

正文不在浏览器里现抓，而是由 GitHub Actions 每小时在服务器端抓好，写进 `content.json`，页面同源加载，点标题直接在页内读，不跳外站。

不同来源的处理方式：

| 来源类型 | 例子 | 怎么拿正文 |
| --- | --- | --- |
| 文章 | IT之家、澎湃、36氪、少数派、虎嗅、第一财经、华尔街见闻、腾讯新闻 | 直接抓原文页，按段落密度抽正文；抓不到再试 r.jina.ai |
| 热搜词 | 微博、百度、今日头条、贴吧 | 先在同批文章里按标题相似度找，没有就去必应资讯搜一篇能抓的报道，标注「相关报道 · 来源」 |
| 知乎问题 | 知乎热榜 | 知乎要登录，按相关报道处理 |
| 公众号 | 微信科技热门 | 原文页通常给验证页，改找门户转载 |
| 视频 | B站、抖音 | 视频简介 + 相关报道 |
| 其他 | 豆瓣电影、即刻 | 影片简介 / 动态原文 |

登录墙、验证码页、过短内容一律丢弃，不当正文。每条正文最多 4000 字，超出部分节选。实在找不到的条目显示摘要和热度，附原文链接。

## 深浅色

默认「自动」：北京时间 7:00–19:00 浅色，其余时间深色，每分钟检查一次。「我」页可以改成固定浅色或深色，设置只存在本机。

## 本地运行

需要 Node 20+，没有 npm 依赖。

```bash
node refresh.mjs        # 抓榜单和正文，写 data.json、content.json（约 3 分钟）
node build.mjs          # 生成单文件 index.html / standalone.html
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

`FRESH=1 node refresh.mjs` 忽略上次缓存全部重抓。默认会复用上次的正文：原文类 3 天内不重抓，相关报道 6 小时内不重抓。

## 文件

```
refresh.mjs              抓取入口
lib/net.mjs              请求、超时、按域名限速、编码识别
lib/extract.mjs          正文抽取和坏内容过滤
lib/content.mjs          按来源类型找正文、相关报道匹配
build.mjs                拼单页
src/                     页面模板、样式、脚本
.github/workflows/refresh.yml   每小时刷新并提交（见下方「启用定时刷新」）
```

## 启用定时刷新

工作流文件暂放在 `ci/refresh.yml`。推送它需要带 `workflow` 权限的凭据，当前推送用的凭据没有这个权限。启用方法任选其一：

- 在 GitHub 网页上新建文件 `.github/workflows/refresh.yml`，把 `ci/refresh.yml` 的内容粘进去提交；
- 或用带 `workflow` 权限的登录（比如 `gh auth login` 网页授权）在本地 `git mv ci/refresh.yml .github/workflows/refresh.yml` 后推送。

启用后每小时自动跑一次，也可以在 Actions 页手动点 Run workflow。

## 抓取礼仪

每源只取前 10 条；同一域名两次请求至少间隔 0.8 秒；单次请求 12–20 秒超时；有缓存的不重复抓。正文只用于个人阅读，版权归原作者和原媒体，文末都有原文链接。

## 隐私

没有账号、没有统计脚本。订阅、阅读历史、外观设置都只存在浏览器 localStorage。仓库里没有任何密钥，Actions 只用 GitHub 自带的 `GITHUB_TOKEN`。
