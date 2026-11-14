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
  const CATEGORIES = { essay: "随笔", travel: "旅行", game: "游戏" };
  const TEXT_EXTENSIONS = /\.(md|markdown|txt|html?|css|js|mjs|json|xml|svg|ya?ml|py|bat|sh|toml|ini|csv|gitignore|nojekyll|gitkeep)$/i;
  const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
  const GENERATED_FILES = /^(posts\/[^/]+\.html|boards\/[^/]+\.html|feed\.xml|sitemap\.xml)$/;
  const MAX_IMAGE_SIDE = 2000;

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
    const lines = keys.filter((key) => merged.has(key)).map((key) => `${key}: ${oneLine(merged.get(key))}`.trimEnd());
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
    return output.join("\n");
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

  function renderLogin(message) {
    const input = h("input", {
      type: "password",
      id: "token",
      name: "token",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "github_pat_…",
      required: true,
    });
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
          submit.disabled = true;
          submit.textContent = "正在验证…";
          errorBox.textContent = "";
          try {
            const repo = await gh("", { token });
            // 没带有效令牌时 GitHub 不会返回 permissions，所以这里必须明确看到 push 权限。
            if (!repo.permissions || !repo.permissions.push) {
              throw new Error("这个令牌没有这个仓库的写入权限，请按下面的步骤重新创建一个。");
            }
            state.token = token;
            storeToken(token, remember.checked);
            document.documentElement.setAttribute("data-admin", "1");
            if (!location.hash || location.hash === "#/login") location.hash = "#/posts";
            else route();
          } catch (error) {
            errorBox.textContent =
              error.status === 404 ? "令牌看不到这个仓库。创建令牌时请在 Repository access 里选中它。" : error.message;
            submit.disabled = false;
            submit.textContent = "登录";
          }
        },
      },
      h("label", { class: "field", for: "token" }, h("span", {}, "GitHub 访问令牌"), input),
      h("label", { class: "check", for: "remember" }, remember, h("span", {}, "在这台设备上保持登录")),
      errorBox,
      submit,
    );

    const steps = h(
      "section",
      { class: "admin-card login-help" },
      h("h2", {}, "第一次登录：创建令牌"),
      h(
        "p",
        {},
        "这个网站没有服务器，所以没法用“账号 + 密码”登录——写在网页里的密码任何人都能看到。" +
          "这里用 GitHub 的访问令牌代替密码：只有持有令牌的人才能修改网站。",
      ),
      h(
        "ol",
        {},
        h("li", {}, "打开 ", h("a", { href: tokenUrl, target: "_blank", rel: "noopener" }, "GitHub 的“新建细粒度令牌”页面"), "（需要先登录 GitHub）。"),
        h("li", {}, "Expiration（有效期）按需选择，到期后重新创建一个即可。"),
        h("li", {}, "Repository access 选 ", h("strong", {}, "Only select repositories"), "，然后只勾选 ", h("code", {}, CONFIG.repo), "。"),
        h("li", {}, "Permissions → Repository permissions 里把 ", h("strong", {}, "Contents"), " 设为 ", h("strong", {}, "Read and write"), "，其他都不用动。"),
        h("li", {}, "点 Generate token，把 ", h("code", {}, "github_pat_"), " 开头的那串字符粘贴到上面。"),
      ),
      h("p", { class: "muted" }, "令牌只保存在这台设备的浏览器里，只会发送给 api.github.com。不要在别人的电脑上勾选“保持登录”。"),
    );

    setView(pageHeader("Admin", "管理员登录", "登录后可以在网页上写文章、改文章、管理网站文件。"), form, steps);
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
    };
    const draft = readDraft(draftKey);
    const draftDiffers = draft && ["title", "date", "category", "summary", "body"].some((key) => draft[key] !== saved[key]);
    const initial = draftDiffers ? { ...saved, ...draft } : saved;
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
    const preview = h("div", { class: "article-body editor-preview", "aria-label": "预览" });
    const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only", tabindex: "-1" });

    const resolveSrc = (src) => {
      if (/^(https?:|data:|\/)/.test(src)) return src;
      const repoPath = src.replace(/^(\.\.\/)+/, "");
      const pending = pendingImages.get(repoPath);
      if (pending) return pending.url;
      return repoPath.startsWith("assets/") ? `../${repoPath}` : src;
    };

    let previewTimer = 0;
    const updatePreview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        preview.innerHTML = renderMarkdown(body.value, resolveSrc) || '<p class="empty-note">这里会显示预览。</p>';
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
      }, 150);
    };

    const fields = () => ({
      title: oneLine(title.value).replace(/^#+\s*/, ""),
      date: date.value,
      category: category.value,
      summary: oneLine(summary.value),
      body: body.value,
    });

    const onChange = () => {
      state.dirty = true;
      writeDraft(draftKey, { slug, ...fields(), savedAt: Date.now() });
      updatePreview();
    };
    for (const control of [title, date, category, summary, body]) control.addEventListener("input", onChange);

    const insertAtCursor = (text) => {
      const start = body.selectionStart ?? body.value.length;
      const end = body.selectionEnd ?? body.value.length;
      const before = body.value.slice(0, start);
      const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      body.setRangeText(`${prefix}${text}\n\n`, start, end, "end");
      body.focus();
      onChange();
    };

    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        const image = await prepareImage(file);
        const name = `${Date.now().toString(36)}-${safeFileName(file.name)}.${image.extension}`;
        const repoPath = `${CONFIG.uploads}/${slug}/${name}`;
        const type = image.extension === "jpg" ? "image/jpeg" : file.type;
        pendingImages.set(repoPath, { bytes: image.bytes, url: URL.createObjectURL(new Blob([image.bytes], { type })) });
        insertAtCursor(`![](${repoPath})`);
      }
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
      const missing = missingImages();
      if (missing.length && !window.confirm(`正文里有 ${missing.length} 张图片还没有上传（可能是恢复草稿时丢失的），发布后会显示不出来。\n仍然继续吗？`)) {
        return;
      }
      const markdown = composeMarkdown(
        parsed.entries,
        { title: values.title, slug, date: values.date, category: values.category, summary: values.summary },
        values.body,
      );
      const used = [...pendingImages].filter(([repoPath]) => body.value.includes(repoPath));
      const changes = [{ path, text: markdown }, ...used.map(([repoPath, image]) => ({ path: repoPath, bytes: image.bytes }))];
      const message = `${isNew ? "Publish" : "Update"} post: ${values.title}`;
      if (await runCommit(message, changes, isNew ? "已发布。" : "已保存。")) {
        state.dirty = false;
        clearDraft(draftKey);
        location.hash = "#/posts";
      }
    };

    const showPane = (pane) => {
      grid.dataset.pane = pane;
      paneButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.pane === pane)));
    };
    const paneButtons = ["edit", "preview"].map((pane) =>
      h(
        "button",
        { class: "pane-tab", type: "button", "data-pane": pane, "aria-pressed": String(pane === "edit"), onclick: () => showPane(pane) },
        pane === "edit" ? "编辑" : "预览",
      ),
    );
    const grid = h(
      "div",
      { class: "editor-grid", "data-pane": "edit" },
      h("div", { class: "editor-pane editor-pane-edit" }, body),
      h("div", { class: "editor-pane editor-pane-preview" }, preview),
    );

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
        h("label", { class: "field", for: "post-summary" }, h("span", {}, "摘要（显示在首页卡片上）"), summary),
        h(
          "div",
          { class: "editor-toolbar" },
          h("div", { class: "pane-tabs" }, paneButtons),
          h("button", { class: "btn btn-small", type: "button", onclick: () => fileInput.click() }, "插入图片"),
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
    updatePreview();
    (isNew && !initial.title ? title : body).focus({ preventScroll: true });
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
        setView(tabs(kind === "files" || kind === "file" ? "files" : "posts"), loading("正在读取仓库…"));
        await loadTree();
      }
      if (kind === "new") await renderEditor("");
      else if (kind === "edit") await renderEditor(argument);
      else if (kind === "files") renderFiles(argument);
      else if (kind === "file" && argument) await renderFile(argument);
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
