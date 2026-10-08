(function () {
  "use strict";
  var SUBS_KEY = "pulse_subs_v1";
  var LAYOUT_KEY = "pulse_layout_v1";
  var HIST_KEY = "pulse_hist_v1";
  var THEME_KEY = "pulse_theme";
  var CATS = ["全部", "综合", "科技", "娱乐", "财经", "汽车"];
  var DATA = null;
  var activeCat = "全部";
  var layout = "horizontal";
  var speaking = false;

  try { layout = localStorage.getItem(LAYOUT_KEY) || "horizontal"; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function defaultSubs() {
    var list = (DATA && DATA.sources) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i].defaultOn) out.push(list[i].id);
    return out.length ? out : ["weibo_hot", "zhihu_hot", "toutiao_hot", "ithome_daily", "baidu_hot"];
  }
  function loadSubs() {
    try {
      var raw = localStorage.getItem(SUBS_KEY);
      if (!raw) return defaultSubs();
      var arr = JSON.parse(raw);
      if (!arr || !arr.length) return defaultSubs();
      var known = {};
      var sources = (DATA && DATA.sources) || [];
      for (var i = 0; i < sources.length; i++) known[sources[i].id] = 1;
      var filtered = [];
      for (var j = 0; j < arr.length; j++) if (!sources.length || known[arr[j]]) filtered.push(arr[j]);
      return filtered.length ? filtered : defaultSubs();
    } catch (e) { return defaultSubs(); }
  }
  function saveSubs(subs) {
    try { localStorage.setItem(SUBS_KEY, JSON.stringify(subs)); } catch (e) {}
  }
  function sourceById(id) {
    var sources = (DATA && DATA.sources) || [];
    for (var i = 0; i < sources.length; i++) if (sources[i].id === id) return sources[i];
    return null;
  }
  function minsLabel(m) {
    if (m == null) return "刚刚";
    if (m < 1) return "刚刚";
    if (m < 60) return m + "分钟前";
    if (m < 1440) return Math.floor(m / 60) + "小时前";
    return Math.floor(m / 1440) + "天前";
  }
  function pushHistory(item) {
    try {
      var arr = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      arr.unshift({ title: item.title, at: Date.now(), source: item.sourceName || "" });
      localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(0, 50)));
    } catch (e) {}
  }

  function setDateHeader() {
    var elBig = $("dateBig"), elSub = $("dateSub");
    if (!elBig || !elSub) return;
    var now = new Date();
    elBig.textContent = now.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
    var week = now.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" });
    var lunar = "";
    try {
      lunar = "农历" + new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
        timeZone: "Asia/Shanghai", month: "long", day: "numeric"
      }).format(now).replace(/\s/g, "");
    } catch (e) {}
    elSub.textContent = lunar ? week + " " + lunar : week;
  }

  var readerOpen = false;
  var readerPopIgnore = false;

  function clearReaderBody() {
    var body = $("readerBody");
    if (body) while (body.firstChild) body.removeChild(body.firstChild);
  }

  function appendParagraph(parent, text) {
    var t = String(text || "").trim();
    if (!t) return;
    var p = document.createElement("p");
    p.textContent = t;
    parent.appendChild(p);
  }

  function setLink(url, label) {
    var a = $("sheetLink");
    var wrap = $("sheetLinkWrap");
    if (!a) return;
    if (url) {
      if (wrap) wrap.hidden = false;
      a.hidden = false;
      a.href = url;
      a.textContent = label || "阅读原文";
    } else {
      if (wrap) wrap.hidden = true;
      a.hidden = true;
      a.removeAttribute("href");
    }
  }

  function isSafeUrl(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  /** 新闻条目：直接去原文 */
  function openItem(item, source) {
    if (!item) return;
    if (!isSafeUrl(item.url)) { openSheet(item, source); return; }
    pushHistory({ title: item.title, sourceName: (source && source.name) || item.sourceName || "" });
    var w = window.open(item.url, "_blank", "noopener,noreferrer");
    if (!w) location.href = item.url;
  }

  /** 说明类内容（关于、设置、科技大事）用页内面板 */
  function openSheet(item, source) {
    $("sheetSource").textContent = (source && source.name) || item.sourceName || "";
    $("sheetHot").textContent = item.hot ? ("热度 " + item.hot) : "";
    $("sheetTitle").textContent = item.title;
    var tags = item.tags || [(source && source.cat), (source && source.name)].filter(Boolean);
    $("sheetTags").innerHTML = tags.filter(Boolean).slice(0, 4).map(function (t) {
      return "<span>" + escapeHtml(t) + "</span>";
    }).join("");
    var body = $("readerBody");
    clearReaderBody();
    if (item.summary && item.summary !== item.title) appendParagraph(body, item.summary);
    var bullets = item.bullets || [];
    if (bullets.length) {
      var ul = document.createElement("ul");
      ul.className = "bullet-block";
      bullets.forEach(function (b) {
        var li = document.createElement("li");
        li.textContent = String(b || "");
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    setLink(isSafeUrl(item.url) ? item.url : "", "阅读原文");
    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    var scroll = $("readerScroll");
    if (scroll) scroll.scrollTop = 0;
    if (!readerOpen) {
      readerOpen = true;
      try {
        history.pushState({ pulseSheet: 1 }, "", location.href);
      } catch (e) {}
    }
  }

  function closeSheet() {
    if ($("sheet")) $("sheet").hidden = true;
    document.body.style.overflow = "";
    if (readerOpen) {
      readerOpen = false;
      if (!readerPopIgnore) {
        try {
          if (history.state && history.state.pulseSheet) history.back();
        } catch (e) {}
      }
    }
    readerPopIgnore = false;
  }

  function closeSourceSheet() { $("sourceSheet").hidden = true; document.body.style.overflow = ""; }

  function itemRow(it, i, withSummary) {
    var nClass = i < 3 ? "n top" : "n";
    var sub = "";
    if (withSummary && it.summary) {
      sub = '<span class="sub">' + escapeHtml(it.summary.slice(0, 72)) + (it.summary.length > 72 ? "…" : "") + "</span>";
    }
    return '<li data-i="' + i + '" role="button" tabindex="0"><span class="' + nClass + '">' + (i + 1) +
      '</span><span class="t">' + escapeHtml(it.title) + sub + "</span></li>";
  }
  function bindItemClicks(root, src) {
    $$("li[data-i]", root).forEach(function (li) {
      li.onclick = function (e) {
        e.preventDefault();
        var it = src.items[Number(li.getAttribute("data-i"))];
        if (it) openItem(it, src);
      };
    });
  }

  function openSourceSheet(src) {
    $("sourceSheetTitle").textContent = src.name;
    var list = $("sourceSheetList");
    if (!src.items || !src.items.length) {
      list.innerHTML = '<li class="empty">暂无条目</li>';
    } else {
      list.innerHTML = src.items.map(function (it, i) { return itemRow(it, i, true); }).join("");
      bindItemClicks(list, src);
    }
    $("sourceSheet").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderMorning() {
    var list = $("morningList");
    if (!list) return;
    var items = (DATA && DATA.morning) || [];
    if (!items.length) { list.innerHTML = '<li class="empty">暂无早报</li>'; return; }
    list.innerHTML = items.map(function (it, i) {
      var nClass = i < 3 ? "n top" : "n";
      return '<li data-mi="' + i + '" role="button"><span class="' + nClass + '">' + (i + 1) +
        '</span><span class="t">' + escapeHtml(it.title) + "</span></li>";
    }).join("");
    $$("li[data-mi]", list).forEach(function (li) {
      li.onclick = function (e) {
        e.preventDefault();
        var it = items[Number(li.getAttribute("data-mi"))];
        if (it) openItem(it, sourceById(it.sourceId) || { name: it.sourceName });
      };
    });
  }

  function renderMine() {
    var wrap = $("mineCards");
    if (!wrap) return;
    var subs = loadSubs();
    wrap.className = "mine-cards " + (layout === "horizontal" ? "horizontal" : "vertical");
    var btnLayout = $("btnLayout");
    if (btnLayout) btnLayout.textContent = layout === "horizontal" ? "转为竖排" : "转为横排";
    var cards = [];
    for (var s = 0; s < subs.length; s++) {
      var src = sourceById(subs[s]);
      if (!src) continue;
      var items = (src.items || []).slice(0, 10);
      var body = items.length
        ? '<ol class="num-list">' + items.map(function (it, i) { return itemRow(it, i, false); }).join("") + "</ol>"
        : '<p class="empty">' + (src.status === "unavailable" ? "暂不可用" : "暂无更新") + "</p>";
      cards.push(
        '<article class="card src-card" data-src="' + src.id + '"><div class="src-head">' +
        '<div class="src-icon" style="background:' + (src.color || "#444") + '">' + escapeHtml(src.icon || src.name.slice(0, 1)) + "</div>" +
        '<div class="src-name">' + escapeHtml(src.name) + "</div>" +
        '<button type="button" class="pill-more btn-all" data-all="' + src.id + '">查看全部 <span>›</span></button></div>' +
        body + "</article>"
      );
    }
    wrap.innerHTML = cards.length ? cards.join("") : '<p class="empty">还没有订阅。去「订阅广场」挑几个吧。</p>';
    $$(".btn-all", wrap).forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var src = sourceById(btn.getAttribute("data-all"));
        if (src) openSourceSheet(src);
      };
    });
    $$(".src-card", wrap).forEach(function (card) {
      var src = sourceById(card.getAttribute("data-src"));
      if (src) bindItemClicks(card, src);
    });
    var c = $("meSubCount");
    if (c) c.textContent = String(subs.length);
  }

  function renderTimeline() {
    var ul = $("hotTimeline");
    if (!ul) return;
    var items = ((DATA && DATA.timeline) || []).slice(0, 20);
    if (!items.length) { ul.innerHTML = '<li class="empty">暂无热榜</li>'; return; }
    ul.innerHTML = items.map(function (it, i) {
      return '<li data-ti="' + i + '"><div class="tl-meta">' + minsLabel(it.minsAgo) + " · " +
        escapeHtml(it.sourceName || "") + '</div><div class="tl-title">' + escapeHtml(it.title) + "</div></li>";
    }).join("");
    $$("li[data-ti]", ul).forEach(function (li) {
      li.onclick = function (e) {
        e.preventDefault();
        var it = items[Number(li.getAttribute("data-ti"))];
        if (it) openItem(it, sourceById(it.sourceId) || { name: it.sourceName });
      };
    });
  }

  function renderTech() {
    var ul = $("techTimeline");
    if (!ul) return;
    var items = (DATA && DATA.techEvents) || [];
    ul.innerHTML = items.map(function (it) {
      return '<li><div class="tl-meta">' + escapeHtml(it.time) + " · " + escapeHtml(it.place || "") +
        '</div><div class="tl-title">' + escapeHtml(it.title) + "</div></li>";
    }).join("");
  }

  function renderChips() {
    var box = $("catChips");
    if (!box) return;
    box.innerHTML = CATS.map(function (c) {
      return '<button type="button" class="chip' + (c === activeCat ? " active" : "") + '" data-cat="' + c + '">' + c + "</button>";
    }).join("");
    $$(".chip", box).forEach(function (btn) {
      btn.onclick = function () {
        activeCat = btn.getAttribute("data-cat");
        renderChips();
        renderPlaza();
      };
    });
  }

  function renderPlaza() {
    var list = $("plazaList");
    if (!list) return;
    var subs = {};
    loadSubs().forEach(function (id) { subs[id] = 1; });
    var rows = (DATA && DATA.sources) || [];
    if (activeCat !== "全部") rows = rows.filter(function (s) { return s.cat === activeCat; });
    if (!rows.length) { list.innerHTML = '<li class="empty">该分类暂无信源</li>'; return; }
    list.innerHTML = rows.map(function (s) {
      var on = !!subs[s.id];
      var unavailable = s.status === "unavailable" || !s.live;
      var meta = unavailable ? "暂不可用" : ("今日" + (s.todayCount || (s.items && s.items.length) || 0) + "条");
      return '<li class="plaza-row"><div class="plaza-icon" style="background:' + (s.color || "#444") + '">' +
        escapeHtml(s.icon || s.name.slice(0, 1)) + '</div><div class="plaza-info"><div class="name">' +
        escapeHtml(s.name) + '</div><div class="meta">' + meta + '</div></div>' +
        '<button type="button" class="btn-sub' + (on ? " on" : "") + '" data-toggle="' + s.id + '">' +
        (on ? "已订阅" : (unavailable ? "暂不可用" : "订阅")) + "</button></li>";
    }).join("");
    $$("[data-toggle]", list).forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-toggle");
        var arr = loadSubs();
        var idx = arr.indexOf(id);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
        saveSubs(arr);
        renderPlaza();
        renderMine();
      };
    });
  }

  function renderAll() {
    try {
      setDateHeader();
      renderMorning();
      renderMine();
      renderTimeline();
      renderTech();
      renderChips();
      renderPlaza();
      var hint = $("updatedHint");
      if (hint) {
        hint.textContent = (DATA && DATA.updatedAtLabel)
          ? ("数据更新于 " + DATA.updatedAtLabel + "（北京时间）· 点标题打开原文")
          : "已加载";
      }
      var meSub = $("meSub");
      if (meSub) meSub.textContent = "已订阅 " + loadSubs().length + " 个源";
    } catch (err) {
      var h = $("updatedHint");
      if (h) h.textContent = "渲染出错：" + (err && err.message ? err.message : String(err));
      if (window.console) console.error(err);
    }
  }

  function applyData(data) {
    if (!data || typeof data !== "object") return;
    if (DATA && DATA.updatedAt && data.updatedAt && data.updatedAt < DATA.updatedAt) return;
    if (!data.sources) data.sources = [];
    if (!data.morning) data.morning = [];
    if (!data.timeline) data.timeline = [];
    if (!data.techEvents) data.techEvents = [];
    DATA = data;
    try { if (!localStorage.getItem(SUBS_KEY)) saveSubs(defaultSubs()); } catch (e) {}
    renderAll();
  }

  function navTo(name) {
    $$(".page").forEach(function (p) {
      var on = p.getAttribute("data-page") === name;
      p.hidden = !on;
      if (on) p.classList.add("active"); else p.classList.remove("active");
    });
    $$(".tabbar .tab").forEach(function (t) {
      if (t.getAttribute("data-nav") === name) t.classList.add("active");
      else t.classList.remove("active");
    });
  }

  function broadcast() {
    var items = (DATA && DATA.morning) || [];
    if (!items.length || !window.speechSynthesis) return;
    if (speaking) {
      speechSynthesis.cancel();
      speaking = false;
      $("btnBroadcast").innerHTML = '<span class="play-dot"></span>一键播报';
      return;
    }
    speaking = true;
    $("btnBroadcast").innerHTML = '<span class="play-dot"></span>停止播报';
    var text = "今日早报。";
    for (var i = 0; i < items.length; i++) text += "第" + (i + 1) + "条，" + items[i].title + "。";
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1.05;
    u.onend = function () {
      speaking = false;
      $("btnBroadcast").innerHTML = '<span class="play-dot"></span>一键播报';
    };
    speechSynthesis.speak(u);
  }

  function bind() {
    $$(".tabbar .tab").forEach(function (t) {
      t.onclick = function () { navTo(t.getAttribute("data-nav")); };
    });
    if ($("btnRefresh")) $("btnRefresh").onclick = function () { loadData(true); };
    if ($("btnBroadcast")) $("btnBroadcast").onclick = broadcast;
    if ($("btnLayout")) $("btnLayout").onclick = function () {
      layout = layout === "horizontal" ? "vertical" : "horizontal";
      try { localStorage.setItem(LAYOUT_KEY, layout); } catch (e) {}
      renderMine();
    };
    if ($("btnManage")) $("btnManage").onclick = function () { navTo("plaza"); };
    if ($("btnTimelineAll")) $("btnTimelineAll").onclick = function () {
      openSourceSheet({
        name: "24 小时热榜",
        items: ((DATA && DATA.timeline) || []).map(function (it) {
          return Object.assign({}, it, { summary: minsLabel(it.minsAgo) + " · " + (it.sourceName || "") });
        }),
        status: "ok"
      });
    };
    if ($("btnTechCal")) $("btnTechCal").onclick = function () {
      openSourceSheet({
        name: "科技大事",
        items: ((DATA && DATA.techEvents) || []).map(function (it) {
          return { title: it.title, summary: it.time + " · " + (it.place || ""), bullets: ["时间：" + it.time] };
        }),
        status: "ok"
      });
    };
    if ($("sheetDismiss")) $("sheetDismiss").onclick = closeSheet;
    if ($("sheetLink")) $("sheetLink").onclick = function (e) { e.stopPropagation(); };
    window.addEventListener("popstate", function () {
      if (readerOpen && $("sheet") && !$("sheet").hidden) {
        readerPopIgnore = true;
        closeSheet();
      }
    });
    if ($("sourceBackdrop")) $("sourceBackdrop").onclick = closeSourceSheet;
    if ($("sourceSheetClose")) $("sourceSheetClose").onclick = closeSourceSheet;
    $$(".me-row").forEach(function (btn) {
      btn.onclick = function () {
        var k = btn.getAttribute("data-me");
        if (k === "subs") navTo("plaza");
        else if (k === "about") openSheet({
          title: "关于 PulseBrief",
          summary: "PulseBrief（脉搏简报）把公开热榜和 RSS 的标题汇在一页，每小时更新一次。点标题跳转原文阅读。",
          bullets: [
            "只展示标题、来源、发布时间、原文链接和不超过 120 字的摘要，不转载正文",
            "标题和摘要的版权归原媒体，本站只做链接聚合；权利人可在 GitHub 提 issue 要求移除",
            "订阅、外观设置只存在本机；没有账号，不收集任何数据"
          ],
          tags: ["关于"]
        }, { name: "PulseBrief" });
        else if (k === "history") {
          try {
            var arr = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
            openSourceSheet({
              name: "阅读历史",
              items: arr.map(function (h) { return { title: h.title, summary: h.source || "" }; }),
              status: "ok"
            });
          } catch (e) { openSourceSheet({ name: "阅读历史", items: [], status: "ok" }); }
        } else if (k === "settings" || k === "fav") {
          openSheet({ title: k === "fav" ? "收藏" : "设置", summary: k === "fav" ? "收藏功能还没做，先用阅读历史。" : "右上角刷新会拉取服务器上最新一次的数据。", bullets: k === "fav" ? [] : ["外观可在本页上方切换：自动 / 浅色 / 深色", "数据大约每小时更新一次"] }, { name: "我" });
        }
      };
    });
    if ($("btnSearch")) $("btnSearch").onclick = function () {
      var q = prompt("搜索当前标题");
      if (!q) return;
      q = q.trim();
      if (!q) return;
      var hits = [];
      var sources = (DATA && DATA.sources) || [];
      for (var i = 0; i < sources.length; i++) {
        var items = sources[i].items || [];
        for (var j = 0; j < items.length; j++) {
          if (items[j].title.indexOf(q) !== -1) {
            hits.push(Object.assign({}, items[j], { sourceName: sources[i].name, sourceId: sources[i].id }));
          }
        }
      }
      openSourceSheet({ name: "搜索：" + q, items: hits.slice(0, 30), status: "ok" });
    };
  }

  /* ---------- 同源加载最新数据 ---------- */
  function getJson(name, ver) {
    var url = name + "?v=" + encodeURIComponent(ver || Date.now());
    return fetch(url, { cache: ver ? "default" : "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadData(manual) {
    var btn = $("btnRefresh");
    if (btn) btn.classList.add("busy");
    getJson("data.json").then(function (d) {
      var newer = !DATA || !DATA.updatedAt || (d.updatedAt && d.updatedAt > DATA.updatedAt);
      if (newer) {
        applyData(d);
      } else if (manual) {
        renderAll();
      }
    }).catch(function () {
      if (manual) renderAll();
    }).then(function () {
      if (btn) btn.classList.remove("busy");
    });
  }

  /* ---------- 深浅色 ---------- */
  function themeMode() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  }
  function bjHour() {
    try {
      return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    } catch (e) {
      return (new Date().getUTCHours() + 8) % 24;
    }
  }
  function applyTheme() {
    var mode = themeMode();
    var t = mode === "light" || mode === "dark" ? mode : (bjHour() >= 7 && bjHour() < 19 ? "light" : "dark");
    var root = document.documentElement;
    if (root.getAttribute("data-theme") !== t) root.setAttribute("data-theme", t);
    var meta = $("metaTheme");
    if (meta) meta.setAttribute("content", t === "light" ? "#f2f2f7" : "#000000");
    $$("#themeSeg button").forEach(function (b) {
      var on = b.getAttribute("data-theme-mode") === mode;
      b.className = on ? "on" : "";
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function bindTheme() {
    $$("#themeSeg button").forEach(function (b) {
      b.onclick = function () {
        try { localStorage.setItem(THEME_KEY, b.getAttribute("data-theme-mode")); } catch (e) {}
        applyTheme();
      };
    });
    applyTheme();
    setInterval(applyTheme, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) applyTheme(); });
  }

  // 启动：先用内嵌数据，随后同源拉最新 data.json
  setDateHeader();
  bind();
  bindTheme();
  applyData(window.INLINE_DATA || { sources: [], morning: [], timeline: [], techEvents: [] });
  try {
    var tab = new URLSearchParams(location.search).get("tab");
    if (tab === "plaza" || tab === "me" || tab === "home") navTo(tab);
  } catch (e) {}
  if (location.protocol !== "file:") loadData(false);
})();
