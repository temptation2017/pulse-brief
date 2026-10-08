# PulseBrief · 脉搏简报

移动端资讯简报页：早报、我的订阅、24 小时热榜、科技大事、订阅广场、我。把公开热榜和 RSS 的标题汇在一页，点标题跳转原文阅读。

线上地址：https://temptation2017.github.io/pulse-brief/

## 展示什么

每条只保留：

- 标题
- 来源名
- 发布时间（来源提供时）
- 原文链接
- 简短摘要：取自 RSS 或榜单自带的描述，去掉 HTML，最多 120 字；热榜类条目显示热度

不抓原文页，不保存、不展示正文。点标题直接在新标签页打开原文。

## 数据刷新

GitHub Actions 每小时跑一次 `.github/workflows/refresh.yml`（每小时第 23 分，UTC），抓榜单、生成页面，把 `data.json`、`index.html`、`standalone.html` 提交回 `main`。也可以在 Actions 页手动点 Run workflow。

## 深浅色

默认「自动」：北京时间 7:00–19:00 浅色，其余时间深色，每分钟检查一次。「我」页可以改成固定浅色或深色，设置只存在本机。

## 本地运行

需要 Node 20+，没有 npm 依赖。

```bash
node refresh.mjs        # 抓榜单和 RSS，写 data.json
node build.mjs          # 生成单文件 index.html / standalone.html
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

## 文件

```
refresh.mjs                      抓取入口
build.mjs                        拼单页
src/                             页面模板、样式、脚本
.github/workflows/refresh.yml    每小时刷新并提交
```

## 抓取礼仪

每源只取前 10 条；同一域名两次请求至少间隔 0.8 秒；单次请求 15 秒超时；只请求榜单页和 RSS，不访问文章页。

## 内容与版权

列表中的标题和摘要版权归原媒体和原作者所有。本项目只做链接聚合，不转载正文，阅读全文请前往原文链接。

如果你是权利人，希望移除某个来源或某条内容，请在本仓库提 issue，看到后会尽快处理。

## 许可

代码以 [MIT License](LICENSE) 发布。许可只覆盖本仓库的代码，不覆盖 `data.json` 等文件里来自第三方的标题和摘要。

## 隐私

没有账号、没有统计脚本。订阅、阅读历史、外观设置都只存在浏览器 localStorage。仓库里没有任何密钥，Actions 只用 GitHub 自带的 `GITHUB_TOKEN`。
