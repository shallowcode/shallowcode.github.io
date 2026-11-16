/* 浅梦 · 网页端管理
 *
 * 这个网站是纯静态的，没有服务器。管理页直接在浏览器里调用 GitHub API，
 * 用你的访问令牌把改动提交到仓库；提交之后由 GitHub Actions
 * （scripts/sync_site.py）生成文章页、首页卡片等并重新部署。
 *
 * 令牌只保存在本机浏览器里，只会发送给 api.github.com。
 */
(() => {
  "use strict";

  const CONFIG = {
    owner: "shallowcode",
    repo: "shallowcode.github.io",
    branch: "main",
    inbox: "content/inbox",
    uploads: "assets/uploads",
  };
  const API = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`;
  const REPO_URL = `https://github.com/${CONFIG.owner}/${CONFIG.repo}`;
  const RAW_URL = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}`;
  const TOKEN_KEY = "qm_admin_token";
  const DRAFT_PREFIX = "qm_admin_draft:";
  const CATEGORIES = { essay: "日记", travel: "旅行", game: "游戏" };
  // 每个板块自己的字段：[front matter 里的名字, 显示的名字, 输入提示, 是否占一整行]
  const EXTRA_FIELDS = {
    essay: [], // 日记只要标题、日期和正文
    travel: [["place", "地点", "云南 · 大理", true]],
    game: [
      ["game", "游戏名", "空洞骑士 Hollow Knight"],
      ["platform", "平台", "PC / Switch / PS5"],
      ["hours", "游玩时长", "30 小时"],
      ["verdict", "评价", { "": "（不填）", buy: "建议购买", free: "建议不花钱时再玩", skip: "不建议游玩" }],
      ["pros", "优点（多条用 | 隔开）", "手感好 | 音乐出色", true],
      ["cons", "缺点（多条用 | 隔开）", "前期慢热 | 重复度高", true],
    ],
  };
  // status / rating 是旧版游戏字段，保存时会顺手清掉
  const EXTRA_KEYS = ["cover", "status", "rating", "weather", "mood", ...new Set(Object.values(EXTRA_FIELDS).flat().map(([key]) => key))];
  const CATEGORY_HINTS = {
    travel: "旅行：封面图会变成页面顶部的大图；正文里连续放几张照片会自动排成照片墙，点击可以放大。",
    game: "游戏：游戏名、平台、时长、评价和优缺点会排成文章开头的“省流版”，正文接在后面。",
  };
  const BODY_TEMPLATES = {
    essay: "",
    travel:
      "先用一两句话说说这趟旅行。\n\n## 行程\n\n- 第一天：\n- 第二天：\n\n## 路上\n\n（把照片拖到这里，连着放的几张会自动排成照片墙）\n\n## 吃了什么\n\n\n\n## 小贴士\n\n- 交通：\n- 住宿：\n- 花费：",
    game: "先用一两句话说说为什么想写它。\n\n## 玩法\n\n\n\n## 剧情与氛围\n\n\n\n## 画面与音乐\n\n\n\n## 让我记住的瞬间\n\n\n\n## 适合谁玩\n\n",
  };
  const TEXT_EXTENSIONS = /\.(md|markdown|txt|html?|css|js|mjs|json|xml|svg|ya?ml|py|bat|sh|toml|ini|csv|gitignore|nojekyll|gitkeep)$/i;
  const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
  const GENERATED_FILES = /^(posts\/[^/]+\.html|boards\/[^/]+\.html|feed\.xml|sitemap\.xml)$/;
  const MAX_IMAGE_SIDE = 2000;
  // 密码登录：令牌用密码加密后存在这个文件里（密码本身不会出现在任何地方）。
  const CREDENTIAL_PATH = "admin/credential.json";
  const KDF_ITERATIONS = 1000000;
  const MIN_PASSWORD_LENGTH = 10;
  // 输错锁定：连续输错 5 次锁 5 分钟，之后每多错一次时间翻倍，最长 24 小时。
  const LOCK_KEY = "qm_admin_lock";
  const LOCK_AFTER = 5;
  const LOCK_BASE_MS = 5 * 60 * 1000;
  const LOCK_MAX_MS = 24 * 60 * 60 * 1000;

  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toasts");

  const state = {
    token: null,
    head: null,
    tree: [],
    treeLoaded: false,
    blobCache: new Map(),
    dirty: false,
    busy: false,
  };

  /* ---------- small helpers ---------- */

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "html") el.innerHTML = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (["value", "checked", "disabled", "selected", "readOnly"].includes(key)) el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child != null && child !== false) el.append(child);
    }
    return el;
  }

  function notify(message, kind = "info", timeout = 6000) {
    const toast = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message);
    toastRegion.append(toast);
    if (timeout) setTimeout(() => toast.remove(), timeout);
    return toast;
  }

  function escapeHtml(value, quote = false) {
    let out = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (quote) out = out.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    return out;
  }

  const pad = (number) => String(number).padStart(2, "0");

  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function newSlug() {
    const now = new Date();
    return `${todayLocal()}-diary-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function formatSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  const dirname = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
  const routeFor = (kind, path = "") => `#/${kind}/${encodeURI(path)}`;

  /* ---------- token storage ---------- */

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function storeToken(token, remember) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch {
      /* 存不下来也没关系，本次打开页面期间仍然有效 */
    }
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function logout(message) {
    clearToken();
    state.token = null;
    state.treeLoaded = false;
    state.tree = [];
    state.dirty = false;
    document.documentElement.removeAttribute("data-admin");
    renderLogin(message);
  }

  /* ---------- password login (encrypted token) ---------- */

  async function deriveKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password.normalize("NFKC")),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  const credentialContext = () => new TextEncoder().encode(`${CONFIG.owner}/${CONFIG.repo}`);

  async function encryptToken(token, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, KDF_ITERATIONS);
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: credentialContext() },
      key,
      new TextEncoder().encode(JSON.stringify({ token })),
    );
    const credential = {
      version: 1,
      kdf: "PBKDF2-SHA256",
      iterations: KDF_ITERATIONS,
      cipher: "AES-256-GCM",
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(data)),
    };
    return `${JSON.stringify(credential, null, 2)}\n`;
  }

  /* 密码不对时 AES-GCM 校验失败，这里会抛出异常。 */
  async function decryptToken(credential, password) {
    const key = await deriveKey(password, base64ToBytes(credential.salt), credential.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(credential.iv), additionalData: credentialContext() },
      key,
      base64ToBytes(credential.data),
    );
    return JSON.parse(new TextDecoder().decode(plain)).token;
  }

  const isCredential = (value) =>
    Boolean(value) &&
    value.version === 1 &&
    typeof value.salt === "string" &&
    typeof value.iv === "string" &&
    typeof value.data === "string" &&
    Number.isInteger(value.iterations) &&
    value.iterations >= 100000 &&
    value.iterations <= 10000000;

  let credentialRequest = null;

  function loadCredential(force = false) {
    if (!credentialRequest || force) {
      credentialRequest = fetch("credential.json", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => (isCredential(value) ? value : null))
        .catch(() => null);
    }
    return credentialRequest;
  }

  /* ---------- wrong-password lockout (per browser) ---------- */

  let memoryLock = { fails: 0, until: 0 };

  function readLock() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
      if (value && Number.isFinite(value.fails) && Number.isFinite(value.until)) return value;
    } catch {
      /* fall through */
    }
    return memoryLock;
  }

  function writeLock(lock) {
    memoryLock = lock;
    try {
      if (lock.fails) localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
      else localStorage.removeItem(LOCK_KEY);
    } catch {
      /* 存不下来时只在本次打开页面期间生效 */
    }
  }

  const lockRemaining = () => Math.max(0, readLock().until - Date.now());

  function recordFailure() {
    const fails = readLock().fails + 1;
    const until =
      fails >= LOCK_AFTER ? Date.now() + Math.min(LOCK_BASE_MS * 2 ** (fails - LOCK_AFTER), LOCK_MAX_MS) : 0;
    writeLock({ fails, until });
    return Math.max(0, LOCK_AFTER - fails);
  }

  function formatWait(ms) {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  }

  function passwordProblem(password, confirmation) {
    if (password.length < MIN_PASSWORD_LENGTH) return `密码至少要 ${MIN_PASSWORD_LENGTH} 位。`;
    if (password !== confirmation) return "两次输入的密码不一样。";
    return "";
  }

  /* ---------- GitHub API ---------- */

  async function gh(path, { method = "GET", body, token = state.token } = {}) {
    let response;
    try {
      response = await fetch(API + path, {
        method,
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("连不上 GitHub，请检查网络后重试。");
    }
    if (response.ok) return response.status === 204 ? null : response.json();

    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || `GitHub 返回了错误 ${response.status}`);
    error.status = response.status;
    if (response.status === 401) error.message = "令牌无效或已过期，请重新登录。";
    else if (response.status === 403 && /rate limit/i.test(data.message || "")) error.message = "操作太频繁，被 GitHub 暂时限流了，过几分钟再试。";
    else if (response.status === 403 || (response.status === 404 && method !== "GET")) {
      error.message = "令牌没有写入权限。创建令牌时需要把这个仓库的 Contents 设为 Read and write。";
    }
    throw error;
  }

  async function loadTree() {
    const ref = await gh(`/git/ref/heads/${CONFIG.branch}`);
    const commit = await gh(`/git/commits/${ref.object.sha}`);
    const tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
    state.head = { commit: ref.object.sha, tree: commit.tree.sha };
    state.tree = tree.tree.filter((entry) => entry.type === "blob");
    state.treeLoaded = true;
    if (tree.truncated) notify("仓库文件太多，列表可能不完整。", "error");
  }

  const findEntry = (path) => state.tree.find((entry) => entry.path === path);

  async function readBytes(entry) {
    const blob = await gh(`/git/blobs/${entry.sha}`);
    return base64ToBytes(blob.content);
  }

  async function readText(entry) {
    if (!state.blobCache.has(entry.sha)) {
      state.blobCache.set(entry.sha, new TextDecoder("utf-8").decode(await readBytes(entry)));
    }
    return state.blobCache.get(entry.sha);
  }

  /* 一次提交里完成所有新增、修改、删除。changes: [{path, text} | {path, bytes} | {path, remove: true}] */
  async function commitChanges(message, changes) {
    const writes = [];
    for (const change of changes) {
      if (change.remove) continue;
      const bytes = change.bytes || new TextEncoder().encode(change.text);
      const blob = await gh("/git/blobs", { method: "POST", body: { content: bytesToBase64(bytes), encoding: "base64" } });
      writes.push({ path: change.path, sha: blob.sha });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await loadTree();
      const entries = writes.map((write) => ({
        path: write.path,
        mode: (findEntry(write.path) || {}).mode || "100644",
        type: "blob",
        sha: write.sha,
      }));
      for (const change of changes) {
        const existing = change.remove && findEntry(change.path);
        if (existing) entries.push({ path: change.path, mode: existing.mode, type: "blob", sha: null });
      }
      if (!entries.length) return null;

      const tree = await gh("/git/trees", { method: "POST", body: { base_tree: state.head.tree, tree: entries } });
      if (tree.sha === state.head.tree) return null;
      const commit = await gh("/git/commits", {
        method: "POST",
        body: { message, tree: tree.sha, parents: [state.head.commit] },
      });
      try {
        await gh(`/git/refs/heads/${CONFIG.branch}`, { method: "PATCH", body: { sha: commit.sha } });
      } catch (error) {
        // 仓库在这期间有了新提交（比如自动生成页面的那次），基于最新状态重来一遍。
        if (error.status === 422 && attempt < 2) continue;
        throw error;
      }
      await loadTree();
      return commit.sha;
    }
    return null;
  }

  async function runCommit(message, changes, successText) {
    if (state.busy) return false;
    state.busy = true;
    document.body.classList.add("is-busy");
    const progress = notify("正在提交到 GitHub…", "info", 0);
    try {
      const sha = await commitChanges(message, changes);
      progress.remove();
      if (!sha) {
        notify("内容没有变化，不需要提交。");
        return true;
      }
      const toast = notify("", "success", 12000);
      toast.append(
        `${successText} 网站会在 1–2 分钟内自动更新。`,
        h("a", { href: `${REPO_URL}/actions`, target: "_blank", rel: "noopener" }, "查看部署进度"),
      );
      return true;
    } catch (error) {
      progress.remove();
      if (error.status === 401) logout(error.message);
      else notify(`提交失败：${error.message}`, "error", 12000);
      return false;
    } finally {
      state.busy = false;
      document.body.classList.remove("is-busy");
    }
  }

  /* ---------- front matter ---------- */

  function parseMarkdown(text) {
    const match = text.replace(/^﻿/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
    if (!match) return { entries: [], meta: {}, body: text.trim() };
    const entries = [];
    for (const rawLine of match[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes(":")) continue;
      const index = line.indexOf(":");
      const key = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim().replace(/^["']+|["']+$/g, "");
      entries.push([key, value]);
    }
    return { entries, meta: Object.fromEntries(entries), body: match[2].trim() };
  }

  const oneLine = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function composeMarkdown(entries, fields, body) {
    const merged = new Map(entries);
    for (const [key, value] of Object.entries(fields)) merged.set(key, value);
    const order = ["title", "slug", "date", "category", "summary"];
    const keys = [...order, ...[...merged.keys()].filter((key) => !order.includes(key))];
    const lines = keys
      .filter((key) => merged.has(key) && (order.includes(key) || oneLine(merged.get(key)) !== ""))
      .map((key) => `${key}: ${oneLine(merged.get(key))}`.trimEnd());
    return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
  }

  /* ---------- Markdown preview (mirrors scripts/publish_md.py) ---------- */

  function parseLinkTarget(target) {
    const match = target.trim().match(/^(\S+)(?:\s+"([^"]+)")?$/);
    return match ? [match[1], match[2] || ""] : [target.trim(), ""];
  }

  function renderInline(text, resolveSrc, blockImages = false) {
    const stash = [];
    const token = (value) => {
      stash.push(value);
      return `\u0000${stash.length - 1}\u0000`;
    };
    text = text.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, target) => {
      const [src, caption] = parseLinkTarget(target);
      const image = `<img src="${escapeHtml(resolveSrc(src), true)}" data-src="${escapeHtml(src, true)}" alt="${escapeHtml(alt, true)}">`;
      if (!blockImages) return token(image);
      const captionText = caption || alt;
      const figcaption = captionText ? `<figcaption>${escapeHtml(captionText)}</figcaption>` : "";
      return token(`<figure class="article-photo">${image}${figcaption}</figure>`);
    });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, target) => {
      const [href] = parseLinkTarget(target);
      const safeHref = /^\s*javascript:/i.test(href) ? "#" : href;
      return token(`<a href="${escapeHtml(safeHref, true)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
    });
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
  }

  function renderMarkdown(markdown, resolveSrc) {
    const output = [];
    let paragraph = [];
    let listItems = [];
    let listOrdered = false;
    let quoteLines = [];
    let inCode = false;
    let codeLines = [];
    const inline = (text) => renderInline(text, resolveSrc);

    const closeParagraph = () => {
      if (paragraph.length) output.push(`<p>${inline(paragraph.map((line) => line.trim()).join(" ").trim())}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listItems.length) return;
      const taskPattern = /^\[([ xX])\]\s+(.*)$/;
      const isTaskList = !listOrdered && listItems.every((item) => taskPattern.test(item));
      const tag = listOrdered ? "ol" : "ul";
      const items = listItems.map((item) => {
        const task = isTaskList && item.match(taskPattern);
        if (!task) return `<li>${inline(item)}</li>`;
        const done = task[1].toLowerCase() === "x";
        return `<li class="task-item${done ? " is-done" : ""}"><input type="checkbox" disabled${done ? " checked" : ""}><span>${inline(task[2])}</span></li>`;
      });
      output.push(`<${tag}${isTaskList ? ' class="task-list"' : ""}>${items.join("")}</${tag}>`);
      listItems = [];
    };
    const closeQuote = () => {
      if (quoteLines.length) output.push(`<blockquote>${inline(quoteLines.join(" ").trim())}</blockquote>`);
      quoteLines = [];
    };
    const closeAll = () => {
      closeParagraph();
      closeList();
      closeQuote();
    };
    const closeCode = () => {
      output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      inCode = false;
    };

    for (const rawLine of markdown.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/, "");
      if (/^```\s*[A-Za-z0-9_-]*\s*$/.test(line)) {
        if (inCode) closeCode();
        else {
          closeAll();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(rawLine);
        continue;
      }
      const stripped = line.trim();
      if (!stripped) {
        closeAll();
        continue;
      }
      if (/^!\[[^\]]*\]\([^)]+\)$/.test(stripped)) {
        closeAll();
        output.push(renderInline(stripped, resolveSrc, true));
        continue;
      }
      if (/^#{1,6}\s*$/.test(line)) {
        closeAll();
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeAll();
        const level = Math.min(heading[1].length + 1, 6);
        output.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
        continue;
      }
      if (/^---+$/.test(stripped)) {
        closeAll();
        output.push("<hr>");
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        closeParagraph();
        closeList();
        quoteLines.push(quote[1]);
        continue;
      }
      const unordered = line.match(/^[-*+]\s+(.+)$/);
      const ordered = line.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        closeParagraph();
        closeQuote();
        if (listItems.length && Boolean(ordered) !== listOrdered) closeList();
        listOrdered = Boolean(ordered);
        listItems.push((ordered || unordered)[1].trim());
        continue;
      }
      closeList();
      closeQuote();
      paragraph.push(line);
    }
    if (inCode) closeCode();
    closeAll();
    // 连续的照片排成照片墙，和发布后的页面一致
    const grouped = [];
    let run = [];
    const flush = () => {
      if (run.length >= 2) grouped.push(`<div class="photo-grid" data-count="${run.length}">${run.join("")}</div>`);
      else grouped.push(...run);
      run = [];
    };
    for (const block of output) {
      if (block.startsWith('<figure class="article-photo">')) run.push(block);
      else {
        flush();
        grouped.push(block);
      }
    }
    flush();
    return grouped.join("\n");
  }

  /* ---------- images ---------- */

  async function prepareImage(file) {
    const original = new Uint8Array(await file.arrayBuffer());
    const extension = (file.name.match(/\.([A-Za-z0-9]+)$/) || [, "jpg"])[1].toLowerCase();
    const keepAsIs = /^image\/(gif|svg\+xml)$/.test(file.type) || !/^image\//.test(file.type);
    if (keepAsIs) return { bytes: original, extension };

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      // 小图不用动；大照片缩到 2000px 以内并转成 JPEG，手机原图动辄好几 MB。
      if (scale === 1 && original.length < 600 * 1024) return { bytes: original, extension };
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
      if (!blob || (scale === 1 && blob.size >= original.length)) return { bytes: original, extension };
      return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: "jpg" };
    } catch {
      return { bytes: original, extension };
    }
  }

  function safeFileName(name) {
    const stem = name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return stem.slice(0, 40) || "image";
  }

  /* ---------- page chrome ---------- */

  function setView(...nodes) {
    app.replaceChildren(...nodes.flat(Infinity).filter((node) => node != null && node !== false));
    window.scrollTo(0, 0);
  }

  function tabs(active) {
    const tab = (id, label, href) => h("a", { class: "admin-tab", href, "aria-current": active === id ? "page" : null }, label);
    return h(
      "nav",
      { class: "admin-tabs", "aria-label": "管理" },
      tab("posts", "文章", "#/posts"),
      tab("files", "文件", "#/files/"),
      tab("password", "密码", "#/password"),
      h("span", { class: "admin-tabs-spacer" }),
      h("a", { class: "admin-tab", href: "../index.html" }, "查看网站"),
      h("button", { class: "admin-tab", type: "button", onclick: () => confirmLeave() && logout() }, "退出登录"),
    );
  }

  function pageHeader(eyebrow, title, description) {
    return h(
      "header",
      { class: "admin-header" },
      h("p", { class: "eyebrow" }, eyebrow),
      h("h1", {}, title),
      description ? h("p", { class: "admin-lede" }, description) : null,
    );
  }

  const loading = (text = "正在加载…") => h("p", { class: "admin-loading" }, text);

  function confirmLeave() {
    if (!state.dirty) return true;
    if (!window.confirm("有还没保存的修改，确定离开吗？")) return false;
    state.dirty = false;
    return true;
  }

  /* ---------- login ---------- */

  async function verifyToken(token) {
    const repo = await gh("", { token });
    // 没带有效令牌时 GitHub 不会返回 permissions，所以这里必须明确看到 push 权限。
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("这个令牌没有这个仓库的写入权限，请按下面的步骤重新创建一个。");
    }
  }

  function startSession(token, remember) {
    state.token = token;
    storeToken(token, remember);
    document.documentElement.setAttribute("data-admin", "1");
  }

  function enterAdmin() {
    if (!location.hash || location.hash === "#/login") location.hash = "#/posts";
    else route();
  }

  const loginHeader = () => pageHeader("Admin", "管理员登录", "登录后可以在网页上写文章、改文章、管理网站文件。");

  async function renderLogin(message, useToken = false) {
    setView(loginHeader(), loading());
    const credential = await loadCredential(true);
    if (state.token) return;
    if (credential && !useToken) renderPasswordLogin(credential, message);
    else renderTokenLogin(message, Boolean(credential));
  }

  function renderPasswordLogin(credential, message) {
    const input = h("input", { type: "password", id: "password", name: "password", autocomplete: "current-password", required: true });
    const remember = h("input", { type: "checkbox", id: "remember", checked: true });
    const submit = h("button", { class: "btn btn-primary", type: "submit" }, "登录");
    const errorBox = h("p", { class: "form-error", role: "alert" }, message || "");
    const fail = (text) => {
      errorBox.textContent = text;
      submit.disabled = false;
      submit.textContent = "登录";
    };

    // 锁定期间禁用输入并显示倒计时；页面刷新或重新打开后仍然有效。
    let lockTimer = 0;
    const showLock = () => {
      clearInterval(lockTimer);
      const tick = () => {
        if (!input.isConnected) {
          clearInterval(lockTimer);
          return true;
        }
        const remaining = lockRemaining();
        if (remaining > 0) {
          input.disabled = true;
          submit.disabled = true;
          errorBox.textContent = `密码输错次数太多，已暂时锁定。请 ${formatWait(remaining)}后再试。`;
          return false;
        }
        clearInterval(lockTimer);
        input.disabled = false;
        submit.disabled = false;
        errorBox.textContent = "";
        return true;
      };
      if (!tick()) lockTimer = setInterval(tick, 1000);
    };

    const form = h(
      "form",
      {
        class: "admin-card login-card",
        onsubmit: async (event) => {
          event.preventDefault();
          if (!input.value) return;
          if (lockRemaining() > 0) {
            showLock();
            return;
          }
          submit.disabled = true;
          submit.textContent = "正在验证…";
          errorBox.textContent = "";
          let token;
          try {
            token = await decryptToken(credential, input.value);
          } catch {
            const attemptsLeft = recordFailure();
            submit.textContent = "登录";
            input.value = "";
            if (attemptsLeft > 0) {
              fail(`密码不对，还可以再试 ${attemptsLeft} 次。`);
              input.focus();
            } else {
              showLock();
            }
            return;
          }
          writeLock({ fails: 0, until: 0 });
          try {
            await verifyToken(token);
          } catch (error) {
            fail(
              error.status === 401 || error.status === 404
                ? "密码正确，但保存的 GitHub 令牌已经失效（过期或被删除）。请改用新令牌登录，再重新设置一次密码。"
                : error.message,
            );
            return;
          }
          startSession(token, remember.checked);
          enterAdmin();
        },
      },
      h("label", { class: "field", for: "password" }, h("span", {}, "管理员密码"), input),
      h("label", { class: "check", for: "remember" }, remember, h("span", {}, "在这台设备上保持登录")),
      errorBox,
      h(
        "div",
        { class: "admin-actions" },
        submit,
        h("button", { class: "link-button", type: "button", onclick: () => renderLogin("", true) }, "改用 GitHub 令牌登录"),
      ),
    );
    setView(loginHeader(), form);
    if (lockRemaining() > 0) showLock();
    else input.focus();
  }

  function renderTokenLogin(message, hasPassword) {
    const input = h("input", {
      type: "password",
      id: "token",
      name: "token",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "github_pat_…",
      required: true,
    });
    const newPassword = h("input", { type: "password", id: "new-password", autocomplete: "new-password", placeholder: `至少 ${MIN_PASSWORD_LENGTH} 位，可以留空` });
    const confirmPassword = h("input", { type: "password", id: "confirm-password", autocomplete: "new-password", placeholder: "再输入一次" });
    const remember = h("input", { type: "checkbox", id: "remember", checked: true });
    const submit = h("button", { class: "btn btn-primary", type: "submit" }, "登录");
    const errorBox = h("p", { class: "form-error", role: "alert" }, message || "");
    const tokenUrl =
      "https://github.com/settings/personal-access-tokens/new" +
      `?name=${encodeURIComponent("浅梦博客管理")}&target_name=${CONFIG.owner}&contents=write`;

    const form = h(
      "form",
      {
        class: "admin-card login-card",
        onsubmit: async (event) => {
          event.preventDefault();
          const token = input.value.trim();
          if (!token) return;
          errorBox.textContent = "";
          const wantsPassword = Boolean(newPassword.value || confirmPassword.value);
          const problem = wantsPassword ? passwordProblem(newPassword.value, confirmPassword.value) : "";
          if (problem) {
            errorBox.textContent = problem;
            return;
          }
          submit.disabled = true;
          submit.textContent = "正在验证…";
          try {
            await verifyToken(token);
          } catch (error) {
            errorBox.textContent =
              error.status === 404 ? "令牌看不到这个仓库。创建令牌时请在 Repository access 里选中它。" : error.message;
            submit.disabled = false;
            submit.textContent = "登录";
            return;
          }
          startSession(token, remember.checked);
          if (wantsPassword) {
            const text = await encryptToken(token, newPassword.value);
            if (await runCommit("Set admin password", [{ path: CREDENTIAL_PATH, text }], "登录密码已设置。")) loadCredential(true);
          }
          enterAdmin();
        },
      },
      h("label", { class: "field", for: "token" }, h("span", {}, "GitHub 访问令牌"), input),
      h(
        "fieldset",
        { class: "password-setup" },
        h("legend", {}, hasPassword ? "同时更换登录密码（可选）" : "同时设置登录密码（可选）"),
        h("p", { class: "muted" }, "设置之后，以后在任何设备上只输入密码就能登录，不用再找令牌。"),
        h(
          "div",
          { class: "field-row" },
          h("label", { class: "field", for: "new-password" }, h("span", {}, "新密码"), newPassword),
          h("label", { class: "field", for: "confirm-password" }, h("span", {}, "确认密码"), confirmPassword),
        ),
      ),
      h("label", { class: "check", for: "remember" }, remember, h("span", {}, "在这台设备上保持登录")),
      errorBox,
      h(
        "div",
        { class: "admin-actions" },
        submit,
        hasPassword ? h("button", { class: "link-button", type: "button", onclick: () => renderLogin("") }, "改用密码登录") : null,
      ),
    );

    const steps = h(
      "section",
      { class: "admin-card login-help" },
      h("h2", {}, "怎么拿到令牌"),
      h(
        "p",
        {},
        "这个网站没有服务器，能修改网站的“钥匙”是 GitHub 的访问令牌。令牌只需要创建一次：" +
          "在上面顺便设一个密码，令牌就会用密码加密后保存到网站里，之后只用密码登录。",
      ),
      h(
        "ol",
        {},
        h("li", {}, "打开 ", h("a", { href: tokenUrl, target: "_blank", rel: "noopener" }, "GitHub 的“新建细粒度令牌”页面"), "（需要先登录 GitHub）。"),
        h("li", {}, "Expiration（有效期）按需选择。到期后密码登录也会失效，需要用新令牌再登录一次。"),
        h("li", {}, "Repository access 选 ", h("strong", {}, "Only select repositories"), "，然后只勾选 ", h("code", {}, CONFIG.repo), "。"),
        h("li", {}, "Permissions → Repository permissions 里把 ", h("strong", {}, "Contents"), " 设为 ", h("strong", {}, "Read and write"), "，其他都不用动。"),
        h("li", {}, "点 Generate token，把 ", h("code", {}, "github_pat_"), " 开头的那串字符粘贴到上面。"),
      ),
      h("p", { class: "muted" }, "令牌只会发送给 api.github.com。不要在别人的电脑上勾选“保持登录”。"),
    );

    setView(loginHeader(), form, steps);
    input.focus();
  }

  /* ---------- posts ---------- */

  const isPostSource = (entry) =>
    dirname(entry.path) === CONFIG.inbox && /\.md$/i.test(entry.path) && basename(entry.path).toLowerCase() !== "readme.md";

  async function loadPosts() {
    const entries = state.tree.filter(isPostSource);
    const posts = await Promise.all(
      entries.map(async (entry) => {
        const parsed = parseMarkdown(await readText(entry));
        const stem = basename(entry.path).replace(/\.md$/i, "");
        const slug = parsed.meta.slug || stem;
        return {
          entry,
          stem,
          slug,
          title: parsed.meta.title || stem,
          date: parsed.meta.date || "",
          category: parsed.meta.category || "essay",
          published: Boolean(findEntry(`posts/${slug}.html`)),
        };
      }),
    );
    return posts.sort((a, b) => b.date.localeCompare(a.date) || b.stem.localeCompare(a.stem));
  }

  async function renderPosts() {
    const list = h("div", { class: "admin-list" }, loading());
    setView(
      tabs("posts"),
      pageHeader("Posts", "文章"),
      h(
        "div",
        { class: "admin-actions" },
        h("a", { class: "btn btn-primary", href: "#/new" }, "写新文章"),
        h("button", { class: "btn", type: "button", onclick: () => refresh() }, "刷新"),
      ),
      list,
    );
    const posts = await loadPosts();
    if (!posts.length) {
      list.replaceChildren(h("p", { class: "admin-empty" }, "还没有文章，点“写新文章”开始。"));
      return;
    }
    list.replaceChildren(
      ...posts.map((post) =>
        h(
          "article",
          { class: "admin-row" },
          h(
            "div",
            { class: "admin-row-main" },
            h("p", { class: "post-meta" }, `${CATEGORIES[post.category] || post.category} · ${post.date.replace(/-/g, ".")}`),
            h("h2", {}, h("a", { href: routeFor("edit", post.stem) }, post.title)),
            post.published ? null : h("p", { class: "badge" }, "页面生成中，稍后点刷新"),
          ),
          h(
            "div",
            { class: "admin-row-actions" },
            post.published ? h("a", { class: "btn btn-small", href: `../posts/${post.slug}.html`, target: "_blank", rel: "noopener" }, "查看") : null,
            h("a", { class: "btn btn-small", href: routeFor("edit", post.stem) }, "编辑"),
            h("button", { class: "btn btn-small btn-danger", type: "button", onclick: () => deletePost(post) }, "删除"),
          ),
        ),
      ),
    );
  }

  async function deletePost(post) {
    if (!window.confirm(`确定删除《${post.title}》吗？\n文章页面和它的图片会一起删除，网站上也会下线。`)) return;
    const uploadsPrefix = `${CONFIG.uploads}/${post.slug}/`;
    const changes = [
      { path: post.entry.path, remove: true },
      { path: `posts/${post.slug}.html`, remove: true },
      ...state.tree.filter((entry) => entry.path.startsWith(uploadsPrefix)).map((entry) => ({ path: entry.path, remove: true })),
    ];
    if (await runCommit(`Delete post: ${post.title}`, changes, "已删除。")) {
      clearDraft(post.stem);
      renderPosts();
    }
  }

  /* ---------- local drafts ---------- */

  function readDraft(key) {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) || "null");
    } catch {
      return null;
    }
  }

  function writeDraft(key, draft) {
    try {
      localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }

  function clearDraft(key) {
    try {
      localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      /* ignore */
    }
  }

  /* ---------- post editor ---------- */

  async function renderEditor(stem) {
    const isNew = !stem;
    let entry = null;
    let parsed = { entries: [], meta: {}, body: "" };
    if (!isNew) {
      setView(tabs("posts"), loading());
      entry =
        findEntry(`${CONFIG.inbox}/${stem}.md`) ||
        (await loadPosts()).filter((post) => post.slug === stem).map((post) => post.entry)[0];
      if (!entry) {
        setView(tabs("posts"), pageHeader("Posts", "找不到这篇文章", "它可能已经被删除了。"), h("a", { class: "btn", href: "#/posts" }, "返回文章列表"));
        return;
      }
      parsed = parseMarkdown(await readText(entry));
    }

    const draftKey = isNew ? "new" : basename(entry.path).replace(/\.md$/i, "");
    const saved = {
      slug: parsed.meta.slug || (isNew ? newSlug() : draftKey),
      title: parsed.meta.title || "",
      date: parsed.meta.date || todayLocal(),
      category: CATEGORIES[parsed.meta.category] ? parsed.meta.category : "essay",
      summary: parsed.meta.summary || "",
      body: parsed.body,
      extra: JSON.stringify(Object.fromEntries(EXTRA_KEYS.map((key) => [key, parsed.meta[key] || ""]))),
    };
    const draft = readDraft(draftKey);
    const draftDiffers =
      draft && ["title", "date", "category", "summary", "body", "extra"].some((key) => (draft[key] ?? saved[key]) !== saved[key]);
    const initial = draftDiffers ? { ...saved, ...draft } : saved;
    const extra = JSON.parse(initial.extra || saved.extra);
    const slug = initial.slug;
    const path = isNew ? `${CONFIG.inbox}/${slug}.md` : entry.path;
    const pendingImages = new Map(); // path -> { bytes, url }

    const title = h("input", { type: "text", id: "post-title", value: initial.title, placeholder: "给这篇文章起个标题", maxlength: 80 });
    const date = h("input", { type: "date", id: "post-date", value: initial.date });
    const category = h(
      "select",
      { id: "post-category" },
      Object.entries(CATEGORIES).map(([value, label]) => h("option", { value, selected: value === initial.category }, label)),
    );
    const summary = h("input", { type: "text", id: "post-summary", value: initial.summary, placeholder: "留空会自动取正文第一段", maxlength: 120 });
    const body = h("textarea", { id: "post-body", class: "editor-text", value: initial.body, spellcheck: "false", placeholder: "用 Markdown 写正文…\n\n## 小标题\n\n- [ ] 任务列表\n> 引用" });
    // 所见即所得的正文编辑区。保存的仍然是 Markdown：每次改动都会把这里的内容转成 Markdown 写回 body。
    const preview = h("div", {
      class: "article-body rich-editor",
      contenteditable: "true",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": "正文",
      "data-placeholder": "在这里写正文。图片可以直接拖进来或粘贴。",
    });
    const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only", tabindex: "-1" });

    const resolveSrc = (src) => {
      if (/^(https?:|data:|\/)/.test(src)) return src;
      const repoPath = src.replace(/^(\.\.\/)+/, "");
      const pending = pendingImages.get(repoPath);
      if (pending) return pending.url;
      return repoPath.startsWith("assets/") ? `../${repoPath}` : src;
    };

    let mode = "rich";

    const figureButton = (label, title, action) =>
      h("button", { type: "button", title, "aria-label": title, contenteditable: "false", onclick: action }, label);

    const setupFigure = (figure) => {
      figure.contentEditable = "false";
      figure.draggable = true;
      let caption = figure.querySelector("figcaption");
      if (!caption) {
        caption = h("figcaption");
        figure.append(caption);
      }
      caption.contentEditable = "true";
      caption.dataset.placeholder = "添加说明（可不填）";
      if (!figure.querySelector(".figure-tools")) {
        figure.append(
          h(
            "span",
            { class: "figure-tools", contenteditable: "false" },
            figureButton("←", "往前移", () => {
              if (figure.previousElementSibling) figure.previousElementSibling.before(figure);
              syncFromRich();
            }),
            figureButton("→", "往后移", () => {
              if (figure.nextElementSibling) figure.nextElementSibling.after(figure);
              syncFromRich();
            }),
            figureButton("×", "删除这张图", () => {
              figure.remove();
              syncFromRich();
            }),
          ),
        );
      }
    };

    const makeFigure = (repoPath, caption = "") => {
      const figure = h(
        "figure",
        { class: "article-photo" },
        h("img", { src: resolveSrc(repoPath), "data-src": repoPath, alt: caption }),
        h("figcaption", {}, caption),
      );
      setupFigure(figure);
      return figure;
    };

    const normalizeRich = () => {
      // 待办的勾选框是用 CSS 画的（编辑区里放真的 <input> 会让回车换行出问题）
      preview.querySelectorAll("ul.task-list > li").forEach((item) => {
        item.classList.add("task-item");
        // 回车新起的一行会带上“已完成”，空行时去掉
        if (!item.textContent.trim()) item.classList.remove("is-done");
      });
      preview.querySelectorAll("ul:not(.task-list) > li.task-item").forEach((item) => item.classList.remove("task-item", "is-done"));
    };

    const loadRich = () => {
      preview.innerHTML = renderMarkdown(body.value, resolveSrc);
      // 照片墙在编辑时拆成一张张图，方便拖动；发布时连续的图会重新排成照片墙。
      preview.querySelectorAll(".photo-grid").forEach((grid) => grid.replaceWith(...grid.childNodes));
      preview.querySelectorAll("figure.article-photo").forEach(setupFigure);
      preview.querySelectorAll("li.task-item").forEach((item) => {
        const text = item.querySelector("span");
        item.innerHTML = text ? text.innerHTML : "";
      });
      preview.querySelectorAll("a").forEach((link) => link.removeAttribute("target"));
      // 刚提交的图片要等部署完才能从网站读到，先退回到仓库里的原始文件。
      preview.querySelectorAll("img[data-src]").forEach((image) => {
        image.addEventListener(
          "error",
          () => {
            const repoPath = image.dataset.src.replace(/^(\.\.\/)+/, "");
            if (findEntry(repoPath)) image.src = `${RAW_URL}/${encodeURI(repoPath)}`;
          },
          { once: true },
        );
      });
    };

    /* 编辑区 DOM -> Markdown（只用 scripts/publish_md.py 认识的那部分语法） */
    const inlineMarkdown = (node) => {
      let out = "";
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.nodeValue.replace(/ /g, " ");
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const tag = child.tagName;
        if (tag === "BR") out += "\n";
        else if (tag === "INPUT" || child.classList.contains("figure-tools")) out += "";
        else if (tag === "IMG") out += `![${child.alt || ""}](${child.dataset.src || child.getAttribute("src")})`;
        else if (tag === "CODE") out += "`" + child.textContent + "`";
        else {
          const inner = inlineMarkdown(child);
          const text = inner.trim();
          if (!text) out += inner;
          else if (tag === "B" || tag === "STRONG") out += `**${text}**`;
          else if (tag === "I" || tag === "EM") out += `*${text}*`;
          else if (tag === "A" && child.getAttribute("href")) out += `[${text}](${child.getAttribute("href")})`;
          else if (/^(P|DIV|LI)$/.test(tag)) out += `${inner}\n`;
          else out += inner;
        }
      });
      return out;
    };
    const textLines = (text) => text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const BLOCK_TAGS = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|FIGURE|HR|PRE)$/;

    const toMarkdown = (root) => {
      const blocks = [];
      const walk = (parent) => {
        parent.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            blocks.push(...textLines(node.nodeValue));
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = node.tagName;
          if (tag === "FIGURE") {
            const image = node.querySelector("img");
            const caption = node.querySelector("figcaption");
            if (image) blocks.push(`![${oneLine(caption ? caption.textContent : "")}](${image.dataset.src || image.getAttribute("src")})`);
          } else if (tag === "HR") blocks.push("---");
          else if (tag === "PRE") blocks.push("```\n" + node.textContent.replace(/\n$/, "") + "\n```");
          else if (/^H[12]$/.test(tag)) textLines(inlineMarkdown(node)).forEach((line) => blocks.push(`# ${line}`));
          else if (/^H[3-6]$/.test(tag)) textLines(inlineMarkdown(node)).forEach((line) => blocks.push(`## ${line}`));
          else if (tag === "BLOCKQUOTE") {
            const lines = textLines(inlineMarkdown(node));
            if (lines.length) blocks.push(lines.map((line) => `> ${line}`).join("\n"));
          } else if (tag === "UL" || tag === "OL") {
            const items = [...node.children]
              .filter((item) => item.tagName === "LI")
              .map((item, index) => {
                const text = oneLine(inlineMarkdown(item));
                if (!text) return "";
                if (tag === "OL") return `${index + 1}. ${text}`;
                if (!node.classList.contains("task-list")) return `- ${text}`;
                return `- [${item.classList.contains("is-done") ? "x" : " "}] ${text}`;
              })
              .filter(Boolean);
            if (items.length) blocks.push(items.join("\n"));
          } else if ([...node.children].some((child) => BLOCK_TAGS.test(child.tagName))) walk(node);
          else blocks.push(...textLines(inlineMarkdown(node)));
        });
      };
      walk(root);
      return blocks.join("\n\n");
    };

    const syncFromRich = () => {
      normalizeRich();
      body.value = toMarkdown(preview);
      onChange();
    };
    preview.addEventListener("input", syncFromRich);
    // 点待办左边的小方框来勾选 / 取消
    preview.addEventListener("click", (event) => {
      const item = event.target.closest ? event.target.closest("ul.task-list > li") : null;
      if (!item || event.clientX - item.getBoundingClientRect().left > 26) return;
      item.classList.toggle("is-done");
      syncFromRich();
    });

    // 把节点放到光标所在段落的后面；光标不在编辑区时放到最后
    const insertBlocks = (nodes, reference) => {
      if (reference === undefined) {
        const selection = window.getSelection();
        let node = selection.rangeCount && preview.contains(selection.anchorNode) ? selection.anchorNode : null;
        while (node && node.parentNode !== preview) node = node.parentNode;
        reference = node ? node.nextSibling : null;
      }
      nodes.forEach((node) => preview.insertBefore(node, reference));
      if (!preview.lastElementChild || preview.lastElementChild.tagName === "FIGURE") preview.append(h("p", {}, h("br")));
      syncFromRich();
    };

    const addImageFiles = async (files, reference) => {
      const figures = [];
      for (const file of files) {
        if (!/^image\//.test(file.type)) continue;
        const image = await prepareImage(file);
        const name = `${Date.now().toString(36)}-${safeFileName(file.name)}.${image.extension}`;
        const repoPath = `${CONFIG.uploads}/${slug}/${name}`;
        const type = image.extension === "jpg" ? "image/jpeg" : file.type;
        pendingImages.set(repoPath, { bytes: image.bytes, url: URL.createObjectURL(new Blob([image.bytes], { type })) });
        figures.push(makeFigure(repoPath));
      }
      if (!figures.length) return;
      if (mode === "rich") insertBlocks(figures, reference);
      else {
        body.value = `${body.value.trim()}\n\n${figures.map((figure) => `![](${figure.querySelector("img").dataset.src})`).join("\n\n")}\n`;
        onChange();
      }
    };

    // 拖动：从电脑里拖图片进来，或者拖动已有的图片换位置
    let draggedFigure = null;
    let dropMark = null;
    const clearDropMark = () => {
      if (dropMark) dropMark.classList.remove("drop-before", "drop-after");
      dropMark = null;
    };
    const dropPosition = (event) => {
      let target = document.elementFromPoint(event.clientX, event.clientY);
      while (target && target !== preview && target.parentNode !== preview) target = target.parentNode;
      if (!target || target === preview) return { target: null, reference: null, before: false };
      const box = target.getBoundingClientRect();
      const before =
        target.tagName === "FIGURE" ? event.clientX < box.left + box.width / 2 : event.clientY < box.top + box.height / 2;
      return { target, before, reference: before ? target : target.nextSibling };
    };
    const hasFiles = (event) => [...(event.dataTransfer ? event.dataTransfer.types : [])].includes("Files");
    preview.addEventListener("dragstart", (event) => {
      const figure = event.target.closest ? event.target.closest("figure.article-photo") : null;
      if (!figure) return;
      draggedFigure = figure;
      figure.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "");
    });
    preview.addEventListener("dragend", () => {
      if (draggedFigure) draggedFigure.classList.remove("is-dragging");
      draggedFigure = null;
      clearDropMark();
    });
    preview.addEventListener("dragover", (event) => {
      if (!draggedFigure && !hasFiles(event)) return;
      event.preventDefault();
      const { target, before } = dropPosition(event);
      clearDropMark();
      if (target && target !== draggedFigure) {
        dropMark = target;
        target.classList.add(before ? "drop-before" : "drop-after");
      }
    });
    preview.addEventListener("dragleave", (event) => {
      if (!preview.contains(event.relatedTarget)) clearDropMark();
    });
    preview.addEventListener("drop", (event) => {
      if (!draggedFigure && !hasFiles(event)) return;
      event.preventDefault();
      const { reference } = dropPosition(event);
      clearDropMark();
      if (draggedFigure) {
        if (reference !== draggedFigure) preview.insertBefore(draggedFigure, reference);
        syncFromRich();
      } else addImageFiles([...event.dataTransfer.files], reference);
    });
    preview.addEventListener("paste", (event) => {
      const files = [...(event.clipboardData ? event.clipboardData.files : [])].filter((file) => /^image\//.test(file.type));
      event.preventDefault();
      if (files.length) addImageFiles(files);
      // 文字一律按纯文本粘贴，避免把别处的字体、颜色带进来
      else document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    });

    // 工具栏
    const currentBlock = () => {
      const selection = window.getSelection();
      let node = selection.rangeCount && preview.contains(selection.anchorNode) ? selection.anchorNode : null;
      return node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    };
    const command = (name, value) => {
      preview.focus();
      document.execCommand(name, false, value);
      syncFromRich();
    };
    const toggleBlock = (tag) => {
      const block = currentBlock();
      command("formatBlock", block && block.closest(tag) ? "p" : tag);
    };
    // 浏览器把列表建在 <p> 里面，光标还会跳到行首；这里把列表提出来，光标放回行尾
    const tidyList = () => {
      const block = currentBlock();
      const item = block && block.closest("li");
      const list = item && item.closest("ul, ol");
      if (!list) return null;
      const wrapper = list.parentElement;
      if (wrapper !== preview && /^(P|DIV)$/.test(wrapper.tagName) && wrapper.children.length === 1) wrapper.replaceWith(list);
      const range = document.createRange();
      range.selectNodeContents(item);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return list;
    };
    const toggleList = (name) => {
      preview.focus();
      document.execCommand(name);
      const list = tidyList();
      if (list) list.classList.remove("task-list");
      syncFromRich();
    };
    const toggleTasks = () => {
      preview.focus();
      const block = currentBlock();
      if (!block || !block.closest("ul")) document.execCommand("insertUnorderedList");
      const list = tidyList();
      if (list && list.tagName === "UL") list.classList.toggle("task-list");
      syncFromRich();
    };
    const addLink = () => {
      const url = window.prompt("链接地址：", "https://");
      if (url && /^https?:\/\//.test(url)) command("createLink", url);
    };
    const tool = (label, title, action, extraClass = "") =>
      h(
        "button",
        // mousedown 时不让按钮抢走焦点，否则选中的文字会丢
        { class: `tool ${extraClass}`.trim(), type: "button", title, "aria-label": title, onmousedown: (event) => event.preventDefault(), onclick: action },
        label,
      );
    const richTools = h(
      "div",
      { class: "rich-tools", role: "toolbar", "aria-label": "排版" },
      tool("标题", "大标题", () => toggleBlock("h2")),
      tool("小标题", "小标题", () => toggleBlock("h3")),
      tool("B", "加粗", () => command("bold"), "tool-bold"),
      tool("引用", "引用", () => toggleBlock("blockquote")),
      tool("• 列表", "列表", () => toggleList("insertUnorderedList")),
      tool("1. 编号", "编号列表", () => toggleList("insertOrderedList")),
      tool("☑ 待办", "待办清单", toggleTasks),
      tool("分割线", "分割线", () => command("insertHorizontalRule")),
      tool("链接", "给选中的文字加链接", addLink),
      tool("图片", "插入图片（也可以直接拖进来）", () => fileInput.click(), "tool-image"),
    );
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* 老浏览器不支持也没关系 */
    }

    const fields = () => ({
      title: oneLine(title.value).replace(/^#+\s*/, ""),
      date: date.value,
      category: category.value,
      summary: oneLine(summary.value),
      body: body.value,
      extra: JSON.stringify(extra),
    });

    const onChange = () => {
      state.dirty = true;
      writeDraft(draftKey, { slug, ...fields(), savedAt: Date.now() });
    };
    for (const control of [title, date, category, summary, body]) control.addEventListener("input", onChange);

    const summaryField = h("label", { class: "field", for: "post-summary" }, h("span", {}, "摘要（显示在首页卡片上）"), summary);
    // 板块专属的字段和封面图；切换板块时重新画一遍，填过的内容会保留。
    const extraBox = h("div", { class: "extra-fields" });
    const coverInput = h("input", { type: "file", accept: "image/*", class: "sr-only", tabindex: "-1" });
    const renderExtra = () => {
      const kind = category.value;
      const inputs = EXTRA_FIELDS[kind].map(([key, label, placeholder, wide]) => {
        const input =
          typeof placeholder === "object"
            ? h(
                "select",
                { id: `extra-${key}` },
                Object.entries(placeholder).map(([value, text]) => h("option", { value, selected: value === (extra[key] || "") }, text)),
              )
            : h("input", { type: "text", id: `extra-${key}`, value: extra[key] || "", placeholder, maxlength: 200 });
        input.addEventListener("input", () => {
          extra[key] = input.value;
          onChange();
        });
        return h("label", { class: wide ? "field field-wide" : "field", for: `extra-${key}` }, h("span", {}, label), input);
      });
      const cover = extra.cover
        ? h(
            "div",
            { class: "cover-picker" },
            h("img", { src: resolveSrc(extra.cover), alt: "封面图预览" }),
            h("button", { class: "btn btn-small", type: "button", onclick: () => coverInput.click() }, "更换"),
            h(
              "button",
              {
                class: "btn btn-small btn-danger",
                type: "button",
                onclick: () => {
                  extra.cover = "";
                  renderExtra();
                  onChange();
                },
              },
              "移除",
            ),
          )
        : h("div", { class: "cover-picker" }, h("button", { class: "btn btn-small", type: "button", onclick: () => coverInput.click() }, "选择封面图"));
      // 日记：不要摘要、封面和其他字段
      const simple = kind === "essay";
      summaryField.hidden = simple;
      extraBox.hidden = simple;
      if (simple) return;
      extraBox.replaceChildren(
        h("p", { class: "muted field-wide" }, CATEGORY_HINTS[kind]),
        ...inputs,
        h("div", { class: "field field-wide" }, h("span", {}, kind === "travel" ? "封面图（页面顶部的大图）" : "封面图（可选）"), cover),
      );
    };
    category.addEventListener("change", renderExtra);
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files[0];
      coverInput.value = "";
      if (!file) return;
      const image = await prepareImage(file);
      const repoPath = `${CONFIG.uploads}/${slug}/cover-${Date.now().toString(36)}.${image.extension}`;
      const type = image.extension === "jpg" ? "image/jpeg" : file.type;
      pendingImages.set(repoPath, { bytes: image.bytes, url: URL.createObjectURL(new Blob([image.bytes], { type })) });
      extra.cover = repoPath;
      renderExtra();
      onChange();
    });

    fileInput.addEventListener("change", async () => {
      await addImageFiles([...fileInput.files]);
      fileInput.value = "";
    });

    const missingImages = () => {
      const referenced = [...body.value.matchAll(/!\[[^\]]*\]\(\s*((?:\.\.\/)*assets\/uploads\/[^)\s]+)/g)].map((match) =>
        match[1].replace(/^(\.\.\/)+/, ""),
      );
      return referenced.filter((repoPath) => !pendingImages.has(repoPath) && !findEntry(repoPath));
    };

    const save = async () => {
      const values = fields();
      if (!values.title) {
        notify("先写个标题吧。", "error");
        title.focus();
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
        notify("请选择日期。", "error");
        date.focus();
        return;
      }
      if (!values.body.trim()) {
        notify("正文还是空的。", "error");
        body.focus();
        return;
      }
      const kind = values.category;
      // 只保存当前板块用得上的字段，其他板块的清空
      const relevant = new Set([...(kind === "essay" ? [] : ["cover"]), ...EXTRA_FIELDS[kind].map(([key]) => key)]);
      if (kind === "essay") values.summary = "";
      const extraValues = Object.fromEntries(EXTRA_KEYS.map((key) => [key, relevant.has(key) ? oneLine(extra[key]) : ""]));
      const missing = missingImages();
      if (extraValues.cover && /^assets\//.test(extraValues.cover) && !pendingImages.has(extraValues.cover) && !findEntry(extraValues.cover)) {
        missing.push(extraValues.cover);
      }
      if (missing.length && !window.confirm(`正文里有 ${missing.length} 张图片还没有上传（可能是恢复草稿时丢失的），发布后会显示不出来。\n仍然继续吗？`)) {
        return;
      }
      const markdown = composeMarkdown(
        parsed.entries,
        { title: values.title, slug, date: values.date, category: values.category, summary: values.summary, ...extraValues },
        values.body,
      );
      const used = [...pendingImages].filter(([repoPath]) => body.value.includes(repoPath) || extraValues.cover === repoPath);
      const changes = [{ path, text: markdown }, ...used.map(([repoPath, image]) => ({ path: repoPath, bytes: image.bytes }))];
      const message = `${isNew ? "Publish" : "Update"} post: ${values.title}`;
      if (await runCommit(message, changes, isNew ? "已发布。" : "已保存。")) {
        state.dirty = false;
        clearDraft(draftKey);
        location.hash = "#/posts";
      }
    };

    // 默认是所见即所得；想直接改 Markdown 的话可以切到源码
    const modeButton = h("button", { class: "btn btn-small", type: "button" }, "Markdown 源码");
    const setMode = (next) => {
      mode = next;
      if (mode === "rich") loadRich();
      preview.hidden = mode !== "rich";
      richTools.hidden = mode !== "rich";
      body.hidden = mode === "rich";
      modeButton.textContent = mode === "rich" ? "Markdown 源码" : "返回排版模式";
    };
    modeButton.addEventListener("click", () => setMode(mode === "rich" ? "markdown" : "rich"));
    const grid = h("div", { class: "editor-area" }, richTools, preview, body);

    const draftNotice = draftDiffers
      ? h(
          "p",
          { class: "notice" },
          "已恢复这台设备上没保存的草稿。",
          h(
            "button",
            {
              class: "link-button",
              type: "button",
              onclick: () => {
                clearDraft(draftKey);
                state.dirty = false;
                renderEditor(stem);
              },
            },
            "丢弃草稿",
          ),
        )
      : null;

    setView(
      tabs("posts"),
      h("a", { class: "back-link", href: "#/posts" }, "返回文章列表"),
      pageHeader("Posts", isNew ? "写新文章" : "编辑文章"),
      draftNotice,
      h(
        "div",
        { class: "admin-card editor-card" },
        h("label", { class: "field", for: "post-title" }, h("span", {}, "标题"), title),
        h(
          "div",
          { class: "field-row" },
          h("label", { class: "field", for: "post-date" }, h("span", {}, "日期"), date),
          h("label", { class: "field", for: "post-category" }, h("span", {}, "板块"), category),
        ),
        summaryField,
        extraBox,
        coverInput,
        h(
          "div",
          { class: "editor-toolbar" },
          h(
            "div",
            { class: "admin-actions" },
            h(
              "button",
              {
                class: "btn btn-small",
                type: "button",
                onclick: () => {
                  if (!BODY_TEMPLATES[category.value]) {
                    notify("日记没有模板，直接写就好。");
                    return;
                  }
                  if (body.value.trim() && !window.confirm("正文里已经有内容了，要把模板加在最后吗？")) return;
                  body.value = `${body.value.trim()}\n\n${BODY_TEMPLATES[category.value]}`.trim();
                  if (mode === "rich") loadRich();
                  onChange();
                },
              },
              "插入正文模板",
            ),
            modeButton,
          ),
          fileInput,
        ),
        grid,
        h("p", { class: "muted" }, `文章地址：posts/${slug}.html`),
        h(
          "div",
          { class: "admin-actions" },
          h("button", { class: "btn btn-primary", type: "button", onclick: save }, isNew ? "发布" : "保存修改"),
          h("a", { class: "btn", href: "#/posts" }, "取消"),
        ),
      ),
    );
    state.dirty = Boolean(draftDiffers);
    renderExtra();
    setMode("rich");
    (isNew && !initial.title ? title : preview).focus({ preventScroll: true });
  }

  /* ---------- files ---------- */

  function breadcrumbs(path, isFile) {
    const parts = path ? path.split("/") : [];
    const crumbs = [h("a", { href: routeFor("files") }, "网站根目录")];
    parts.forEach((part, index) => {
      const target = parts.slice(0, index + 1).join("/");
      const last = index === parts.length - 1;
      crumbs.push(h("span", { class: "crumb-sep", "aria-hidden": "true" }, "/"));
      crumbs.push(last && isFile ? h("span", {}, part) : h("a", { href: routeFor("files", target) }, part));
    });
    return h("nav", { class: "breadcrumbs", "aria-label": "当前位置" }, crumbs);
  }

  function listDirectory(directory) {
    const prefix = directory ? `${directory}/` : "";
    const folders = new Map();
    const files = [];
    for (const entry of state.tree) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.push(entry);
      else folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) || 0) + 1);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { folders: [...folders].sort((a, b) => a[0].localeCompare(b[0])), files };
  }

  function renderFiles(directory) {
    directory = directory.replace(/^\/+|\/+$/g, "");
    const { folders, files } = listDirectory(directory);
    const prefix = directory ? `${directory}/` : "";
    const uploadInput = h("input", { type: "file", multiple: true, class: "sr-only", tabindex: "-1" });

    uploadInput.addEventListener("change", async () => {
      const selected = [...uploadInput.files];
      uploadInput.value = "";
      if (!selected.length) return;
      const existing = selected.filter((file) => findEntry(prefix + file.name));
      if (existing.length && !window.confirm(`${existing.map((file) => file.name).join("、")} 已经存在，要覆盖吗？`)) return;
      const changes = [];
      for (const file of selected) changes.push({ path: prefix + file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      const label = selected.length === 1 ? selected[0].name : `${selected.length} files`;
      if (await runCommit(`Upload ${label} to ${directory || "/"}`, changes, "已上传。")) renderFiles(directory);
    });

    const createFile = () => {
      const name = window.prompt(`在 ${directory || "网站根目录"} 下新建文件，输入文件名（可以带子文件夹，比如 notes/a.md）：`);
      if (!name) return;
      const clean = name.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) {
        notify("文件名不合法。", "error");
        return;
      }
      location.hash = routeFor("file", prefix + clean);
    };

    const rows = [
      ...folders.map(([name, count]) =>
        h(
          "a",
          { class: "file-row", href: routeFor("files", prefix + name) },
          h("span", { class: "file-icon", "aria-hidden": "true" }, "📁"),
          h("span", { class: "file-name" }, name),
          h("span", { class: "file-size" }, `${count} 个文件`),
        ),
      ),
      ...files.map((entry) =>
        h(
          "a",
          { class: "file-row", href: routeFor("file", entry.path) },
          h("span", { class: "file-icon", "aria-hidden": "true" }, IMAGE_EXTENSIONS.test(entry.path) ? "🖼" : "📄"),
          h("span", { class: "file-name" }, basename(entry.path)),
          h("span", { class: "file-size" }, formatSize(entry.size)),
        ),
      ),
    ];

    setView(
      tabs("files"),
      pageHeader("Files", "文件", "这里能直接修改网站的任何文件。写文章请用“文章”页，会更方便。"),
      breadcrumbs(directory, false),
      h(
        "div",
        { class: "admin-actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: createFile }, "新建文件"),
        h("button", { class: "btn", type: "button", onclick: () => uploadInput.click() }, "上传文件"),
        h("button", { class: "btn", type: "button", onclick: () => refresh() }, "刷新"),
        uploadInput,
      ),
      h("div", { class: "admin-card file-list" }, rows.length ? rows : h("p", { class: "admin-empty" }, "这个文件夹是空的。")),
    );
  }

  async function renderFile(path) {
    path = path.replace(/^\/+/, "");
    const entry = findEntry(path);
    const isNew = !entry;
    const directory = dirname(path);
    const head = [tabs("files"), breadcrumbs(path, true)];
    setView(...head, loading());

    const notices = [];
    if (GENERATED_FILES.test(path)) notices.push("这个文件是自动生成的，手动改动会在下次发布文章时被覆盖。");
    if (dirname(path) === CONFIG.inbox && /\.md$/i.test(path)) notices.push("这是一篇文章的 Markdown 源文件，在“文章”页里编辑会更方便。");
    if (path === CREDENTIAL_PATH) notices.push("这是加密后的登录凭证。要改密码请到“密码”页，不要手动编辑这个文件。");
    if (path.startsWith(".github/")) notices.push("这里是部署配置。当前令牌没有修改它的权限，需要到 GitHub 上改。");
    const noticeNodes = notices.map((text) => h("p", { class: "notice" }, text));

    const remove = async () => {
      if (!window.confirm(`确定删除 ${path} 吗？这个操作会立刻生效。`)) return;
      if (await runCommit(`Delete ${path}`, [{ path, remove: true }], "已删除。")) {
        state.dirty = false;
        location.hash = routeFor("files", directory);
      }
    };
    const deleteButton = isNew ? null : h("button", { class: "btn btn-danger", type: "button", onclick: remove }, "删除文件");
    const githubLink = isNew
      ? null
      : h("a", { class: "btn", href: `${REPO_URL}/blob/${CONFIG.branch}/${encodeURI(path)}`, target: "_blank", rel: "noopener" }, "在 GitHub 上查看");

    let text = "";
    if (!isNew) {
      const bytes = await readBytes(entry);
      const looksBinary = !TEXT_EXTENSIONS.test(path) && (IMAGE_EXTENSIONS.test(path) || bytes.subarray(0, 8000).includes(0));
      if (looksBinary) {
        const view = IMAGE_EXTENSIONS.test(path)
          ? h("img", {
              class: "file-image",
              alt: basename(path),
              src: URL.createObjectURL(new Blob([bytes], /\.svg$/i.test(path) ? { type: "image/svg+xml" } : {})),
            })
          : h("p", { class: "admin-empty" }, "这是二进制文件，不能在线编辑。可以删除后重新上传。");
        setView(
          ...head,
          pageHeader("Files", basename(path), `${formatSize(bytes.length)}`),
          ...noticeNodes,
          h("div", { class: "admin-card" }, view),
          h("div", { class: "admin-actions" }, githubLink, deleteButton),
        );
        return;
      }
      text = new TextDecoder("utf-8").decode(bytes);
    }

    const editor = h("textarea", { class: "editor-text code-text", value: text, spellcheck: "false", "aria-label": `${path} 的内容` });
    editor.addEventListener("input", () => {
      state.dirty = true;
    });
    const save = async () => {
      const message = `${isNew ? "Create" : "Update"} ${path}`;
      if (await runCommit(message, [{ path, text: editor.value }], "已保存。")) {
        state.dirty = false;
        if (isNew) renderFile(path);
      }
    };

    setView(
      ...head,
      pageHeader("Files", isNew ? `新建 ${basename(path)}` : basename(path), isNew ? `保存后会创建 ${path}` : formatSize(entry.size)),
      ...noticeNodes,
      h("div", { class: "admin-card" }, editor),
      h(
        "div",
        { class: "admin-actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: save }, isNew ? "创建文件" : "保存"),
        h("a", { class: "btn", href: routeFor("files", directory) }, "返回"),
        githubLink,
        deleteButton,
      ),
    );
    state.dirty = false;
    if (isNew) editor.focus();
  }

  /* ---------- password settings ---------- */

  function renderPassword() {
    const hasPassword = Boolean(findEntry(CREDENTIAL_PATH));
    const newPassword = h("input", { type: "password", id: "new-password", autocomplete: "new-password", placeholder: `至少 ${MIN_PASSWORD_LENGTH} 位` });
    const confirmPassword = h("input", { type: "password", id: "confirm-password", autocomplete: "new-password", placeholder: "再输入一次" });
    const errorBox = h("p", { class: "form-error", role: "alert" });

    const save = async (event) => {
      event.preventDefault();
      errorBox.textContent = passwordProblem(newPassword.value, confirmPassword.value);
      if (errorBox.textContent) return;
      const text = await encryptToken(state.token, newPassword.value);
      const message = hasPassword ? "Change admin password" : "Set admin password";
      if (await runCommit(message, [{ path: CREDENTIAL_PATH, text }], hasPassword ? "密码已更换。" : "密码已设置。")) {
        loadCredential(true);
        renderPassword();
      }
    };
    const remove = async () => {
      if (!window.confirm("取消后只能用 GitHub 令牌登录。确定吗？")) return;
      if (await runCommit("Remove admin password", [{ path: CREDENTIAL_PATH, remove: true }], "已取消密码登录。")) {
        loadCredential(true);
        renderPassword();
      }
    };

    setView(
      tabs("password"),
      pageHeader(
        "Password",
        "登录密码",
        hasPassword ? "已经设置了登录密码。在这里可以更换或取消。" : "还没有设置密码。设置后，在任何设备上输入密码就能登录。",
      ),
      h(
        "form",
        { class: "admin-card login-card", onsubmit: save },
        h("label", { class: "field", for: "new-password" }, h("span", {}, hasPassword ? "新密码" : "密码"), newPassword),
        h("label", { class: "field", for: "confirm-password" }, h("span", {}, "确认密码"), confirmPassword),
        errorBox,
        h(
          "div",
          { class: "admin-actions" },
          h("button", { class: "btn btn-primary", type: "submit" }, hasPassword ? "更换密码" : "设置密码"),
          hasPassword ? h("button", { class: "btn btn-danger", type: "button", onclick: remove }, "取消密码登录") : null,
        ),
      ),
      h(
        "section",
        { class: "admin-card login-help" },
        h("h2", {}, "密码是怎么起作用的"),
        h(
          "ul",
          {},
          h("li", {}, "你的 GitHub 令牌会用这个密码加密，保存成网站里的一个文件。登录时在浏览器里用密码解开。密码本身不会保存在任何地方。"),
          h("li", {}, "这个加密文件是公开的，任何人都能下载下来慢慢猜密码，而且没有次数限制。", h("strong", {}, "所以密码越长、越不像名字和生日越好"), "，比如一句只有你知道的话。"),
          h("li", {}, "在登录页连续输错 5 次密码会锁定 5 分钟，之后每多错一次锁定时间翻倍。这个锁定记在浏览器里，能挡住在登录页上乱试的人，但挡不住上面说的“下载文件后离线猜”，所以密码强度仍然是关键。"),
          h("li", {}, "更换密码不会让旧密码失效——旧的加密文件还留在仓库历史里。如果担心密码泄露，要到 GitHub 把令牌删掉、重新创建一个，再用新令牌登录并设置密码。"),
          h("li", {}, "令牌过期后密码登录会失效，用新令牌登录一次并重新设置密码即可。"),
        ),
      ),
    );
  }

  /* ---------- router ---------- */

  let currentHash = "";

  async function refresh() {
    state.treeLoaded = false;
    await route();
  }

  async function route() {
    if (!state.token) {
      renderLogin();
      return;
    }
    const hash = location.hash || "#/posts";
    const [, kind = "posts", ...rest] = hash.split("/");
    const argument = decodeURI(rest.join("/"));
    try {
      if (!state.treeLoaded) {
        const activeTab = kind === "files" || kind === "file" ? "files" : kind === "password" ? "password" : "posts";
        setView(tabs(activeTab), loading("正在读取仓库…"));
        await loadTree();
      }
      if (kind === "new") await renderEditor("");
      else if (kind === "edit") await renderEditor(argument);
      else if (kind === "files") renderFiles(argument);
      else if (kind === "file" && argument) await renderFile(argument);
      else if (kind === "password") renderPassword();
      else await renderPosts();
    } catch (error) {
      if (error.status === 401) {
        logout(error.message);
        return;
      }
      setView(
        tabs("posts"),
        pageHeader("Error", "出了点问题", error.message),
        h("button", { class: "btn", type: "button", onclick: () => refresh() }, "重试"),
      );
    }
  }

  window.addEventListener("hashchange", () => {
    if (location.hash === currentHash) return;
    if (!confirmLeave()) {
      history.replaceState(null, "", currentHash || "#/posts");
      return;
    }
    currentHash = location.hash;
    route();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  state.token = readToken();
  if (state.token) document.documentElement.setAttribute("data-admin", "1");
  currentHash = location.hash;
  route();
})();
