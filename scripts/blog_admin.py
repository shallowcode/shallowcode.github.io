from __future__ import annotations

import argparse
import html
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import publish_md


ROOT = Path(__file__).resolve().parents[1]
INBOX_DIR = ROOT / "content" / "inbox"
POSTS_DIR = ROOT / "posts"
UPLOADS_DIR = ROOT / "assets" / "uploads"
PUBLISH_SCRIPT = ROOT / "scripts" / "publish_md_to_github.py"
UNPUBLISH_SCRIPT = ROOT / "scripts" / "unpublish_md_from_github.py"
PUBLISH_LOCK = threading.Lock()


def ensure_inside(path: Path, parent: Path = ROOT) -> Path:
    resolved = path.resolve()
    root = parent.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Unsafe path: {resolved}")
    return resolved


def rel(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT.resolve())).replace("\\", "/")


def run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
    if result.returncode != 0:
        raise RuntimeError(output or f"git {' '.join(args)} failed")
    return output


def git_status() -> str:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    return result.stdout.strip()


def safe_read_post(path: Path) -> dict[str, object]:
    meta, markdown = publish_md.read_markdown(path)
    payload: dict[str, object] = {
        "path": rel(path),
        "name": path.name,
        "mtime": int(path.stat().st_mtime),
        "mtime_text": time.strftime("%Y-%m-%d %H:%M", time.localtime(path.stat().st_mtime)),
        "valid": True,
        "error": "",
    }
    try:
        post = publish_md.build_post(path, copy_images=False)
        post_path = POSTS_DIR / f"{post.slug}.html"
        payload.update({
            "title": post.title,
            "slug": post.slug,
            "date": post.date,
            "category": post.category,
            "category_cn": publish_md.CATEGORIES[post.category][0],
            "summary": post.summary,
            "published": post_path.exists(),
            "post_url": f"/posts/{post.slug}.html",
        })
    except SystemExit as exc:
        payload.update({
            "valid": False,
            "error": str(exc).replace("Error: ", ""),
            "title": meta.get("title") or publish_md.first_heading(markdown) or path.stem,
            "slug": meta.get("slug") or path.stem,
            "date": meta.get("date") or "",
            "category": meta.get("category") or "essay",
            "category_cn": "未识别",
            "summary": publish_md.first_paragraph(markdown)[:86],
            "published": False,
            "post_url": "",
        })
    return payload


def list_markdown_posts() -> list[dict[str, object]]:
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        path for path in INBOX_DIR.rglob("*.md")
        if path.name.lower() != "readme.md" and not path.name.startswith(".")
    ]
    files = sorted(files, key=lambda item: item.stat().st_mtime, reverse=True)
    return [safe_read_post(path) for path in files]


def default_slug(title: str) -> str:
    today = date.today().isoformat()
    slug = publish_md.slugify(title)
    if slug.startswith("post-"):
        return f"{today}-diary-{time.strftime('%H%M%S')}"
    return f"{today}-{slug}"


def create_draft(title: str, category: str) -> Path:
    title = title.strip() or "新的日记"
    category = category if category in publish_md.CATEGORIES else "essay"
    slug = default_slug(title)
    path = ensure_inside(INBOX_DIR / f"{slug}.md", INBOX_DIR)
    if path.exists():
        path = ensure_inside(INBOX_DIR / f"{slug}-{int(time.time())}.md", INBOX_DIR)

    category_cn = publish_md.CATEGORIES[category][0]
    content = f"""---
title: {title}
slug: {path.stem}
date: {date.today().isoformat()}
category: {category}
summary:
---

# {title}

从这里开始写正文。

"""
    path.write_text(content, encoding="utf-8")
    return path


def find_typora() -> Path | None:
    candidates = []
    if os.environ.get("TYPORA_EXE"):
        candidates.append(Path(os.environ["TYPORA_EXE"]))
    candidates.extend([
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Typora" / "Typora.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Typora" / "Typora.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Typora" / "Typora.exe",
    ])
    which_typora = shutil.which("typora")
    if which_typora:
        candidates.append(Path(which_typora))
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return None


def open_file(path: Path) -> str:
    path = ensure_inside(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if os.name == "nt":
        typora = find_typora()
        if typora:
            subprocess.Popen([str(typora), str(path)], cwd=ROOT)
            return "已用 Typora 打开 Markdown 文件。"
        try:
            os.startfile(str(path))  # type: ignore[attr-defined]
            return "未找到 Typora，已尝试用系统默认程序打开。"
        except OSError as exc:
            raise RuntimeError(
                "没有找到 Typora，也没有可用的 .md 默认打开方式。"
                "请安装 Typora，或在 start-blog-admin.bat 里设置 TYPORA_EXE。"
            ) from exc
    else:
        subprocess.Popen(["xdg-open", str(path)])
        return "已请求系统打开 Markdown 文件。"


def reveal_file(path: Path) -> str:
    path = ensure_inside(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])
    return "已打开文件所在位置。"


def publish_to_github(path: Path, force: bool) -> str:
    path = ensure_inside(path, INBOX_DIR)
    if not path.exists():
        raise FileNotFoundError(path)
    if not PUBLISH_LOCK.acquire(blocking=False):
        raise RuntimeError("已有发布任务正在运行，请等它结束后再点一次。")

    try:
        command = [
            sys.executable,
            str(PUBLISH_SCRIPT),
            rel(path),
            "--allow-dirty",
        ]
        if force:
            command.append("--force")

        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
        )
        output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
        if result.returncode != 0:
            raise RuntimeError(output or "发布失败")
        return output
    finally:
        PUBLISH_LOCK.release()


def delete_post(path: Path) -> dict[str, object]:
    """Delete a draft. Published posts are removed from GitHub too; unpublished
    drafts are only removed locally. Returns a small result dict."""
    path = ensure_inside(path, INBOX_DIR)
    if not path.exists():
        raise FileNotFoundError(path)
    if not PUBLISH_LOCK.acquire(blocking=False):
        raise RuntimeError("已有发布或删除任务正在运行，请等它结束后再试。")

    try:
        try:
            slug = publish_md.build_post(path, copy_images=False).slug
        except SystemExit:
            meta, _ = publish_md.read_markdown(path)
            slug = meta.get("slug") or path.stem
        post_path = POSTS_DIR / f"{slug}.html"
        published = post_path.exists()

        if published:
            command = [
                sys.executable,
                str(UNPUBLISH_SCRIPT),
                rel(path),
                "--slug",
                slug,
                "--allow-dirty",
            ]
            result = subprocess.run(
                command,
                cwd=ROOT,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
            )
            output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
            if result.returncode != 0:
                raise RuntimeError(output or "删除失败")
            return {"published": True, "output": output, "message": "已从博客删除并推送到 GitHub。"}

        uploads_dir = UPLOADS_DIR / slug
        path.unlink()
        removed_images = False
        if uploads_dir.exists():
            shutil.rmtree(uploads_dir)
            removed_images = True
        message = "已删除未发布的草稿，并一并删除它的图片。" if removed_images else "已删除未发布的草稿。"
        return {"published": False, "output": "", "message": message}
    finally:
        PUBLISH_LOCK.release()


ADMIN_HTML = """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>浅梦博客 · 发布后台</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f4f6;
        --card: #ffffff;
        --ink: #1f2329;
        --muted: #6b7280;
        --faint: #9ca3af;
        --line: #e7e9ee;
        --line-strong: #d7dae1;
        --accent: #3d7a63;
        --accent-soft: #e8f1ec;
        --danger: #c0533b;
        --danger-soft: #fbeae6;
        --amber: #b3812f;
        --shadow: 0 1px 2px rgba(20, 24, 31, 0.06), 0 6px 18px rgba(20, 24, 31, 0.05);
        --radius: 14px;
      }

      * { box-sizing: border-box; }

      [hidden] { display: none !important; }

      html, body { height: 100%; }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        background: rgba(243, 244, 246, 0.86);
        backdrop-filter: saturate(180%) blur(10px);
        border-bottom: 1px solid var(--line);
      }

      .topbar-inner {
        width: min(900px, calc(100% - 40px));
        margin: 0 auto;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .brand { display: flex; align-items: center; gap: 12px; }

      .brand-dot {
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: linear-gradient(140deg, var(--accent), #5a9b81);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
      }

      .brand strong { display: block; font-size: 0.98rem; letter-spacing: 0.01em; }
      .brand-sub { display: block; font-size: 0.76rem; color: var(--muted); }

      .topbar-actions { display: flex; gap: 8px; }

      .wrap {
        width: min(900px, calc(100% - 40px));
        margin: 0 auto;
        padding: 26px 0 80px;
      }

      .btn {
        --btn-bg: var(--card);
        --btn-fg: var(--ink);
        --btn-line: var(--line-strong);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid var(--btn-line);
        border-radius: 10px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        font: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.05s ease, opacity 0.15s ease;
        white-space: nowrap;
      }

      .btn:hover { border-color: var(--faint); }
      .btn:active { transform: translateY(1px); }

      .btn.primary {
        --btn-bg: var(--accent);
        --btn-fg: #fff;
        --btn-line: var(--accent);
      }
      .btn.primary:hover { filter: brightness(1.05); border-color: var(--accent); }

      .btn.ghost {
        --btn-bg: transparent;
        --btn-line: transparent;
        color: var(--muted);
        font-weight: 600;
      }
      .btn.ghost:hover { background: rgba(0,0,0,0.04); border-color: transparent; }

      .btn.mini {
        min-height: 32px;
        padding: 0 10px;
        font-size: 0.84rem;
        font-weight: 600;
        color: var(--muted);
        --btn-line: var(--line);
        background: var(--card);
      }
      .btn.mini:hover { color: var(--ink); border-color: var(--line-strong); }

      .btn.danger { color: var(--danger); --btn-line: var(--line); }
      .btn.danger:hover { background: var(--danger-soft); border-color: var(--danger); }
      .btn.danger.solid { background: var(--danger); color: #fff; --btn-line: var(--danger); }
      .btn.danger.solid:hover { filter: brightness(1.05); }

      .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

      /* Composer */
      .composer {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 16px;
        margin-bottom: 24px;
      }

      .composer-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 130px auto;
        gap: 12px;
        align-items: end;
      }

      .field { display: grid; gap: 6px; min-width: 0; }
      .field.grow { min-width: 0; }

      label {
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--muted);
        letter-spacing: 0.01em;
      }

      input, select {
        width: 100%;
        min-height: 40px;
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        padding: 8px 11px;
        background: #fff;
        color: var(--ink);
        font: inherit;
        font-size: 0.92rem;
      }
      input:focus, select:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      input::placeholder { color: var(--faint); }

      /* Git banner */
      .git-banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: #fffaf0;
        border: 1px solid #f0e2c2;
        color: #8a6d2f;
        border-radius: 12px;
        padding: 11px 14px;
        margin-bottom: 20px;
        font-size: 0.85rem;
        white-space: pre-wrap;
      }
      .git-banner::before { content: "●"; color: var(--amber); font-size: 0.7rem; line-height: 1.7; }

      .list-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 4px 2px 14px;
      }
      .list-head h2 { margin: 0; font-size: 1.05rem; }
      .count { color: var(--faint); font-size: 0.85rem; }

      .list { display: grid; gap: 14px; }

      .empty {
        text-align: center;
        color: var(--muted);
        background: var(--card);
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius);
        padding: 44px 24px;
      }
      .empty strong { display: block; color: var(--ink); margin-bottom: 6px; }

      /* Card */
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 16px 18px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px;
        align-items: start;
      }

      .card-main { min-width: 0; }

      .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }

      .card-title {
        margin: 0;
        font-size: 1.08rem;
        font-weight: 700;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .badge {
        flex: none;
        font-size: 0.72rem;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        color: var(--muted);
        background: #fff;
      }
      .badge.live { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 36%, var(--line)); background: var(--accent-soft); }
      .badge.draft { color: var(--amber); border-color: #ecd9af; background: #fdf6e7; }
      .badge.broken { color: var(--danger); border-color: #eccabe; background: var(--danger-soft); }

      .card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .chip {
        font-size: 0.76rem;
        color: var(--muted);
        background: #f5f6f8;
        border: 1px solid var(--line);
        border-radius: 7px;
        padding: 2px 8px;
      }

      .card-summary {
        margin: 0 0 10px;
        color: #404652;
        font-size: 0.92rem;
        overflow-wrap: anywhere;
      }
      .card-summary.error { color: var(--danger); }

      .card-path {
        font-size: 0.76rem;
        color: var(--faint);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        overflow-wrap: anywhere;
      }

      .card-side {
        width: 188px;
        display: grid;
        gap: 10px;
        align-content: start;
      }

      .card-actions { display: grid; gap: 10px; }
      .card-actions .publish { width: 100%; }

      .mini-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mini-actions .btn.mini { flex: 1 1 auto; }

      .card-confirm {
        border: 1px solid var(--danger-soft);
        background: var(--danger-soft);
        border-radius: 11px;
        padding: 11px;
        display: grid;
        gap: 9px;
      }
      .confirm-text { margin: 0; font-size: 0.82rem; color: #7a3829; font-weight: 600; }
      .confirm-actions { display: flex; gap: 6px; }
      .confirm-actions .btn { flex: 1 1 auto; }

      /* Toasts */
      .toast-wrap {
        position: fixed;
        left: 50%;
        bottom: 26px;
        transform: translateX(-50%);
        display: grid;
        gap: 10px;
        z-index: 60;
        width: min(520px, calc(100% - 32px));
      }
      .toast {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: #1f2329;
        color: #f3f4f6;
        border-radius: 12px;
        padding: 12px 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.22);
        font-size: 0.88rem;
        white-space: pre-wrap;
        animation: toast-in 0.18s ease;
      }
      .toast.success { background: #1f3b30; }
      .toast.error { background: #4a241c; }
      .toast .toast-msg { flex: 1; overflow-wrap: anywhere; }
      .toast .toast-close {
        flex: none;
        cursor: pointer;
        opacity: 0.7;
        background: none;
        border: none;
        color: inherit;
        font-size: 1.05rem;
        line-height: 1;
        padding: 0 2px;
      }
      .toast .toast-close:hover { opacity: 1; }
      @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

      .spinner {
        width: 14px; height: 14px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        display: inline-block;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      @media (max-width: 680px) {
        .composer-row { grid-template-columns: 1fr; }
        .composer-row .btn.primary { width: 100%; }
        .card { grid-template-columns: 1fr; }
        .card-side { width: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <span class="brand-dot" aria-hidden="true"></span>
          <div>
            <strong>发布后台</strong>
            <span class="brand-sub">浅梦的个人博客</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="btn ghost" id="refreshBtn" type="button">刷新</button>
          <a class="btn ghost" href="/index.html" target="_blank" rel="noopener">查看博客 ↗</a>
        </div>
      </div>
    </div>

    <main class="wrap">
      <section class="composer">
        <div class="composer-row">
          <div class="field grow">
            <label for="newTitle">新文章标题</label>
            <input id="newTitle" placeholder="例如：今天想留下的一点东西" autocomplete="off">
          </div>
          <div class="field">
            <label for="newCategory">板块</label>
            <select id="newCategory">
              <option value="essay">随笔</option>
              <option value="travel">旅行</option>
              <option value="game">游戏</option>
            </select>
          </div>
          <button class="btn primary" id="createBtn" type="button">新建并编辑</button>
        </div>
      </section>

      <div class="git-banner" id="gitBanner" hidden></div>

      <div class="list-head">
        <h2>我的文章</h2>
        <span class="count" id="count"></span>
      </div>

      <section class="list" id="postList"></section>
    </main>

    <div class="toast-wrap" id="toastWrap"></div>

    <script>
      const postList = document.querySelector("#postList");
      const toastWrap = document.querySelector("#toastWrap");
      const gitBanner = document.querySelector("#gitBanner");
      const countEl = document.querySelector("#count");
      const createBtn = document.querySelector("#createBtn");
      const refreshBtn = document.querySelector("#refreshBtn");
      const newTitle = document.querySelector("#newTitle");
      const newCategory = document.querySelector("#newCategory");

      const esc = (value) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const toast = (message, type = "info") => {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        const msg = document.createElement("div");
        msg.className = "toast-msg";
        msg.textContent = message;
        const close = document.createElement("button");
        close.className = "toast-close";
        close.type = "button";
        close.textContent = "×";
        const remove = () => el.remove();
        close.addEventListener("click", remove);
        el.append(msg, close);
        toastWrap.append(el);
        const life = type === "error" ? 8000 : 3600;
        setTimeout(remove, life);
        return el;
      };

      const api = async (url, body = null) => {
        const response = await fetch(url, {
          method: body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "操作失败");
        }
        return data;
      };

      const statusBadge = (post) => {
        if (!post.valid) return '<span class="badge broken">需补全</span>';
        return post.published
          ? '<span class="badge live">已发布</span>'
          : '<span class="badge draft">草稿</span>';
      };

      const cardMarkup = (post) => {
        const previewBtn = post.published
          ? `<a class="btn mini preview" href="${esc(post.post_url)}" target="_blank" rel="noopener">预览</a>`
          : "";
        const publishLabel = post.published ? "更新到 GitHub" : "发布到 GitHub";
        const summary = post.valid ? (post.summary || "（暂无摘要）") : post.error;
        const confirmText = post.published
          ? "确认删除？会从 GitHub 线上移除，并删除本地文件。"
          : "确认删除这篇未发布的草稿？";

        return `
          <div class="card-main">
            <div class="card-top">
              <h3 class="card-title">${esc(post.title)}</h3>
              ${statusBadge(post)}
            </div>
            <div class="card-meta">
              <span class="chip">${esc(post.category_cn || post.category)}</span>
              <span class="chip">${esc(post.date || "无日期")}</span>
              <span class="chip">改于 ${esc(post.mtime_text)}</span>
            </div>
            <p class="card-summary ${post.valid ? "" : "error"}">${esc(summary)}</p>
            <code class="card-path">${esc(post.path)}</code>
          </div>
          <div class="card-side">
            <div class="card-actions" data-role="actions">
              <button class="btn primary publish" type="button" ${post.valid ? "" : "disabled"}>${publishLabel}</button>
              <div class="mini-actions">
                <button class="btn mini edit" type="button">编辑</button>
                ${previewBtn}
                <button class="btn mini reveal" type="button">文件夹</button>
                <button class="btn mini danger del" type="button">删除</button>
              </div>
            </div>
            <div class="card-confirm" data-role="confirm" hidden>
              <p class="confirm-text">${confirmText}</p>
              <div class="confirm-actions">
                <button class="btn mini danger solid confirm-del" type="button">确认删除</button>
                <button class="btn mini cancel-del" type="button">取消</button>
              </div>
            </div>
          </div>`;
      };

      const render = (posts) => {
        countEl.textContent = posts.length ? `${posts.length} 篇` : "";
        if (!posts.length) {
          postList.innerHTML = `
            <div class="empty">
              <strong>还没有文章</strong>
              在上面新建一篇，或把 .md 放进 content/inbox/。
            </div>`;
          return;
        }
        postList.innerHTML = "";
        posts.forEach((post) => {
          const card = document.createElement("article");
          card.className = "card";
          card.innerHTML = cardMarkup(post);

          const actions = card.querySelector('[data-role="actions"]');
          const confirm = card.querySelector('[data-role="confirm"]');
          const publishBtn = card.querySelector(".publish");
          const editBtn = card.querySelector(".edit");
          const revealBtn = card.querySelector(".reveal");
          const delBtn = card.querySelector(".del");
          const confirmDelBtn = card.querySelector(".confirm-del");
          const cancelDelBtn = card.querySelector(".cancel-del");

          editBtn.addEventListener("click", async () => {
            try {
              const result = await api("/api/open", { path: post.path });
              toast(result.message || "已请求打开编辑器。", "success");
            } catch (error) {
              toast(error.message, "error");
            }
          });

          revealBtn.addEventListener("click", async () => {
            try {
              const result = await api("/api/reveal", { path: post.path });
              toast(result.message || "已打开文件所在位置。", "success");
            } catch (error) {
              toast(error.message, "error");
            }
          });

          publishBtn.addEventListener("click", async () => {
            const label = publishBtn.textContent;
            try {
              publishBtn.disabled = true;
              publishBtn.innerHTML = '<span class="spinner"></span> 发布中…';
              await api("/api/publish", { path: post.path, force: post.published });
              toast(post.published ? "已更新并推送到 GitHub。" : "已发布到 GitHub。", "success");
              await loadPosts();
            } catch (error) {
              toast(error.message, "error");
              publishBtn.disabled = false;
              publishBtn.textContent = label;
            }
          });

          delBtn.addEventListener("click", () => {
            actions.hidden = true;
            confirm.hidden = false;
          });
          cancelDelBtn.addEventListener("click", () => {
            confirm.hidden = true;
            actions.hidden = false;
          });

          confirmDelBtn.addEventListener("click", async () => {
            try {
              confirmDelBtn.disabled = true;
              cancelDelBtn.disabled = true;
              confirmDelBtn.innerHTML = '<span class="spinner"></span> 删除中…';
              const result = await api("/api/delete", { path: post.path });
              toast(result.message || "已删除。", "success");
              await loadPosts();
            } catch (error) {
              toast(error.message, "error");
              confirmDelBtn.disabled = false;
              cancelDelBtn.disabled = false;
              confirmDelBtn.textContent = "确认删除";
            }
          });

          postList.append(card);
        });
      };

      const loadPosts = async () => {
        const data = await api("/api/posts");
        render(data.posts);
        if (data.git_status) {
          gitBanner.hidden = false;
          gitBanner.textContent = `有未提交的本地改动：\n${data.git_status}`;
        } else {
          gitBanner.hidden = true;
          gitBanner.textContent = "";
        }
      };

      createBtn.addEventListener("click", async () => {
        try {
          createBtn.disabled = true;
          createBtn.innerHTML = '<span class="spinner"></span> 新建中…';
          const data = await api("/api/create", {
            title: newTitle.value,
            category: newCategory.value,
          });
          newTitle.value = "";
          await loadPosts();
          try {
            const result = await api("/api/open", { path: data.path });
            toast(result.message || `已创建：${data.path}`, "success");
          } catch (openError) {
            toast(`已创建草稿，但打开编辑器失败：${openError.message}`, "error");
          }
        } catch (error) {
          toast(error.message, "error");
        } finally {
          createBtn.disabled = false;
          createBtn.textContent = "新建并编辑";
        }
      });

      newTitle.addEventListener("keydown", (event) => {
        if (event.key === "Enter") createBtn.click();
      });

      refreshBtn.addEventListener("click", () => {
        loadPosts().catch((error) => toast(error.message, "error"));
      });

      loadPosts().catch((error) => toast(error.message, "error"));
    </script>
  </body>
</html>
"""


class BlogAdminHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in {"/", "/admin"}:
            body = ADMIN_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if path == "/api/posts":
            self.send_json(200, {"ok": True, "posts": list_markdown_posts(), "git_status": git_status()})
            return
        super().do_GET()

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            data = self.read_json()
            if path == "/api/create":
                draft = create_draft(str(data.get("title", "")), str(data.get("category", "essay")))
                self.send_json(200, {"ok": True, "path": rel(draft)})
                return
            if path == "/api/open":
                target = ensure_inside(ROOT / str(data.get("path", "")), INBOX_DIR)
                message = open_file(target)
                self.send_json(200, {"ok": True, "message": message})
                return
            if path == "/api/reveal":
                target = ensure_inside(ROOT / str(data.get("path", "")), INBOX_DIR)
                message = reveal_file(target)
                self.send_json(200, {"ok": True, "message": message})
                return
            if path == "/api/publish":
                target = ensure_inside(ROOT / str(data.get("path", "")), INBOX_DIR)
                output = publish_to_github(target, force=bool(data.get("force", False)))
                self.send_json(200, {"ok": True, "output": output})
                return
            if path == "/api/delete":
                target = ensure_inside(ROOT / str(data.get("path", "")), INBOX_DIR)
                result = delete_post(target)
                self.send_json(200, {"ok": True, **result})
                return
            self.send_json(404, {"ok": False, "error": "Unknown endpoint"})
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the local blog publishing backend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), BlogAdminHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Qianmeng blog admin: {url}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
