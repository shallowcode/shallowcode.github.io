from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
import sys
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
PUBLISH_SCRIPT = ROOT / "scripts" / "publish_md_to_github.py"


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


def open_file(path: Path) -> None:
    path = ensure_inside(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", str(path)])


def publish_to_github(path: Path, force: bool) -> str:
    path = ensure_inside(path, INBOX_DIR)
    if not path.exists():
        raise FileNotFoundError(path)

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


ADMIN_HTML = """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>浅梦博客本地发布后台</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f5ef;
        --paper: #fffdf8;
        --ink: #25231f;
        --muted: #6e695f;
        --line: #ded8ca;
        --green: #4f6f52;
        --coral: #b65f4a;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }

      header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 16px;
        align-items: end;
        margin-bottom: 22px;
      }

      h1 {
        margin: 0;
        font-size: 1.8rem;
      }

      p {
        color: var(--muted);
      }

      .panel,
      .post {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
      }

      .panel {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 160px auto;
        gap: 10px;
        align-items: end;
        padding: 16px;
        margin-bottom: 18px;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 0.86rem;
        font-weight: 800;
      }

      input,
      select {
        min-height: 40px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px 10px;
        background: #fff;
        color: var(--ink);
        font: inherit;
      }

      button,
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px 12px;
        background: #fff;
        color: var(--ink);
        font: inherit;
        font-weight: 800;
        text-decoration: none;
        cursor: pointer;
      }

      button.primary {
        border-color: var(--green);
        background: var(--green);
        color: #fff;
      }

      button.warn {
        border-color: var(--coral);
        color: var(--coral);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .status {
        min-height: 24px;
        margin: 10px 0 18px;
        white-space: pre-wrap;
        color: var(--muted);
      }

      .status.error {
        color: var(--coral);
      }

      .list {
        display: grid;
        gap: 12px;
      }

      .post {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px;
        padding: 16px;
      }

      .post h2 {
        margin: 0 0 8px;
        font-size: 1.15rem;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .tag {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 2px 8px;
        background: #fff;
      }

      .tag.good {
        border-color: color-mix(in srgb, var(--green) 42%, var(--line));
        color: var(--green);
      }

      .tag.bad {
        border-color: color-mix(in srgb, var(--coral) 42%, var(--line));
        color: var(--coral);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: end;
        gap: 8px;
      }

      code {
        color: var(--muted);
      }

      @media (max-width: 760px) {
        .panel,
        .post {
          grid-template-columns: 1fr;
        }

        .actions {
          justify-content: start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>浅梦博客本地发布后台</h1>
          <p>Typora 写 Markdown，保存后在这里发布到 GitHub Pages。</p>
        </div>
        <a class="button" href="/index.html" target="_blank">打开本地首页</a>
      </header>

      <section class="panel">
        <label>
          新日记标题
          <input id="newTitle" placeholder="例如：今天想留下的一点东西">
        </label>
        <label>
          板块
          <select id="newCategory">
            <option value="essay">随笔</option>
            <option value="travel">旅行</option>
            <option value="game">游戏</option>
          </select>
        </label>
        <button class="primary" id="createBtn">新建并打开</button>
      </section>

      <div class="status" id="status"></div>
      <section class="list" id="postList"></section>
    </main>

    <script>
      const postList = document.querySelector("#postList");
      const statusBox = document.querySelector("#status");
      const createBtn = document.querySelector("#createBtn");
      const newTitle = document.querySelector("#newTitle");
      const newCategory = document.querySelector("#newCategory");

      const setStatus = (text, isError = false) => {
        statusBox.textContent = text || "";
        statusBox.classList.toggle("error", Boolean(isError));
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

      const render = (posts) => {
        if (!posts.length) {
          postList.innerHTML = "<p>还没有 Markdown。先新建一篇，或把 .md 放到 content/inbox/。</p>";
          return;
        }
        postList.innerHTML = "";
        posts.forEach((post) => {
          const card = document.createElement("article");
          card.className = "post";
          const info = document.createElement("div");
          const title = document.createElement("h2");
          title.textContent = post.title;
          const meta = document.createElement("div");
          meta.className = "meta";
          const state = post.valid
            ? (post.published ? '<span class="tag good">已发布</span>' : '<span class="tag">未发布</span>')
            : '<span class="tag bad">需补全</span>';
          meta.innerHTML = `
            <span class="tag">${post.category_cn || post.category}</span>
            <span class="tag">${post.date || "无日期"}</span>
            ${state}
            <span class="tag">${post.mtime_text}</span>
          `;
          const summary = document.createElement("p");
          summary.textContent = post.valid ? (post.summary || "无摘要") : post.error;
          const path = document.createElement("code");
          path.textContent = post.path;
          info.append(title, meta, summary, path);

          const actions = document.createElement("div");
          actions.className = "actions";

          const openBtn = document.createElement("button");
          openBtn.textContent = "用 Typora 打开";
          openBtn.addEventListener("click", async () => {
            try {
              setStatus("正在打开编辑器...");
              await api("/api/open", { path: post.path });
              setStatus("已请求系统打开 Markdown 文件。");
            } catch (error) {
              setStatus(error.message, true);
            }
          });

          const preview = document.createElement("a");
          preview.className = "button";
          preview.textContent = "本地预览";
          preview.href = post.post_url || "#";
          preview.target = "_blank";
          if (!post.published) {
            preview.style.display = "none";
          }

          const publishBtn = document.createElement("button");
          publishBtn.className = post.published ? "warn" : "primary";
          publishBtn.textContent = post.published ? "重新发布到 GitHub" : "发布到 GitHub";
          publishBtn.disabled = !post.valid;
          publishBtn.addEventListener("click", async () => {
            const original = publishBtn.textContent;
            try {
              publishBtn.disabled = true;
              publishBtn.textContent = "发布中...";
              setStatus("正在转换、提交并推送到 GitHub...");
              const result = await api("/api/publish", { path: post.path, force: post.published });
              setStatus(result.output || "发布成功。");
              await loadPosts();
            } catch (error) {
              setStatus(error.message, true);
            } finally {
              publishBtn.disabled = false;
              publishBtn.textContent = original;
            }
          });

          actions.append(openBtn, preview, publishBtn);
          card.append(info, actions);
          postList.append(card);
        });
      };

      const loadPosts = async () => {
        const data = await api("/api/posts");
        render(data.posts);
        if (data.git_status) {
          setStatus(`当前还有未提交改动：\\n${data.git_status}`);
        }
      };

      createBtn.addEventListener("click", async () => {
        try {
          createBtn.disabled = true;
          setStatus("正在创建 Markdown...");
          const data = await api("/api/create", {
            title: newTitle.value,
            category: newCategory.value,
          });
          newTitle.value = "";
          setStatus(`已创建：${data.path}`);
          await loadPosts();
          await api("/api/open", { path: data.path });
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          createBtn.disabled = false;
        }
      });

      loadPosts().catch((error) => setStatus(error.message, true));
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
                open_file(target)
                self.send_json(200, {"ok": True})
                return
            if path == "/api/publish":
                target = ensure_inside(ROOT / str(data.get("path", "")), INBOX_DIR)
                output = publish_to_github(target, force=bool(data.get("force", False)))
                self.send_json(200, {"ok": True, "output": output})
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
