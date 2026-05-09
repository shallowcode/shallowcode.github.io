from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
POSTS_DIR = ROOT / "posts"
BOARDS_DIR = ROOT / "boards"

CATEGORIES = {
    "essay": ("感悟与随笔", "随笔", "Essay", "写一些不一定完整、但当时很真实的想法。"),
    "travel": ("旅行与照片", "旅行", "Travel", "把照片、路线和路上的片段整理到一起。"),
    "game": ("游戏与记录", "游戏", "Game", "记录游戏里的截图、感受和那些停留很久的瞬间。"),
}


@dataclass
class PostInfo:
    category: str
    date_text: str
    date_attr: str
    title: str
    href: str
    summary: str

    @property
    def filename(self) -> str:
        return Path(self.href).name

    @property
    def slug(self) -> str:
        return Path(self.href).stem


def strip_tags(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(re.sub(r"\s+", " ", value).strip())


def parse_posts() -> list[PostInfo]:
    content = INDEX_PATH.read_text(encoding="utf-8")
    matches = re.finditer(
        r'<article class="post-card(?:\s+cover-post)?" data-category="(?P<category>[^"]+)">(?P<body>.*?)</article>',
        content,
        flags=re.S,
    )
    posts: list[PostInfo] = []
    seen: set[str] = set()
    for match in matches:
        body = match.group("body")
        link = re.search(r'<h3>\s*<a href="(?P<href>[^"]+)">(?P<title>.*?)</a>\s*</h3>', body, flags=re.S)
        meta = re.search(r'<p class="post-meta">(?P<meta>.*?)</p>', body, flags=re.S)
        paragraphs = re.findall(r"<p(?: [^>]*)?>(.*?)</p>", body, flags=re.S)
        if not link or not meta:
            continue
        href = html.unescape(link.group("href"))
        if href in seen:
            continue
        seen.add(href)
        title = strip_tags(link.group("title"))
        meta_text = strip_tags(meta.group("meta"))
        date_text = meta_text.split("·")[-1].strip() if "·" in meta_text else meta_text.strip()
        date_attr = date_text.replace(".", "-")
        summary = strip_tags(paragraphs[-1]) if paragraphs else ""
        posts.append(PostInfo(
            category=match.group("category"),
            date_text=date_text,
            date_attr=date_attr,
            title=title,
            href=href,
            summary=summary,
        ))
    return posts


def page_shell(title: str, description: str, body: str, stylesheet_prefix: str = "../") -> str:
    return f"""<!doctype html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{html.escape(description, quote=True)}">
    <title>{html.escape(title, quote=False)} | 浅梦</title>
    <link rel="stylesheet" href="{stylesheet_prefix}styles.css">
  </head>
  <body>
{body}
    <script src="{stylesheet_prefix}script.js"></script>
  </body>
</html>
"""


def board_card(post: PostInfo) -> str:
    category_cn = CATEGORIES.get(post.category, ("", post.category, "", ""))[1]
    return (
        '        <article class="board-post-card">\n'
        f'          <p class="post-meta">{category_cn} · {post.date_text}</p>\n'
        f'          <h2><a href="../{html.escape(post.href, quote=True)}">{html.escape(post.title, quote=False)}</a></h2>\n'
        f"          <p>{html.escape(post.summary, quote=False)}</p>\n"
        "        </article>"
    )


def render_board_page(category: str, posts: list[PostInfo]) -> str:
    title, category_cn, category_en, description = CATEGORIES[category]
    post_list = "\n".join(board_card(post) for post in posts if post.category == category)
    if not post_list:
        post_list = '        <p class="empty-note">这个板块还在等第一篇文章。</p>'
    body = f"""    <main class="board-main">
      <a class="back-link" href="../index.html#boards">返回板块</a>
      <header class="board-page-header">
        <p class="eyebrow">{category_en}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <section class="board-post-list" aria-label="{title}文章列表">
{post_list}
      </section>
    </main>
"""
    return page_shell(title, description, body)


def extract_article_body(content: str) -> str:
    match = re.search(r'<article class="article-body"[^>]*>(?P<body>.*?)</article>', content, flags=re.S)
    if not match:
        raise ValueError("Missing article body")
    return match.group("body").strip()


def sidebar_links(posts: list[PostInfo], current: PostInfo, same_category: bool) -> str:
    selected = [
        post for post in posts
        if post.href != current.href and (post.category == current.category if same_category else True)
    ][:5]
    if not selected:
        selected = [post for post in posts if post.href != current.href][:5]
    return "\n".join(
        f'            <li><a href="{html.escape(post.filename, quote=True)}">{html.escape(post.title, quote=False)}</a></li>'
        for post in selected
    )


def render_article_page(post: PostInfo, posts: list[PostInfo], body_html: str) -> str:
    _, category_cn, category_en, _ = CATEGORIES.get(post.category, ("", post.category, post.category.title(), ""))
    index = next((idx for idx, item in enumerate(posts) if item.href == post.href), -1)
    older = posts[index + 1] if 0 <= index + 1 < len(posts) else None
    newer = posts[index - 1] if index > 0 else None

    older_link = (
        f'          <a class="post-nav-card" href="{html.escape(older.filename, quote=True)}"><span>上一篇</span><strong>{html.escape(older.title, quote=False)}</strong></a>'
        if older
        else '          <span class="post-nav-card is-empty"><span>上一篇</span><strong>没有更早的文章了</strong></span>'
    )
    newer_link = (
        f'          <a class="post-nav-card" href="{html.escape(newer.filename, quote=True)}"><span>下一篇</span><strong>{html.escape(newer.title, quote=False)}</strong></a>'
        if newer
        else '          <span class="post-nav-card is-empty"><span>下一篇</span><strong>已经是最新文章</strong></span>'
    )

    body = f"""    <main class="article-main article-layout">
      <a class="back-link" href="../boards/{post.category}.html">返回{category_cn}板块</a>
      <header class="article-header">
        <p class="eyebrow">{category_en}</p>
        <h1>{html.escape(post.title, quote=False)}</h1>
        <p class="article-meta">{post.date_text} · {category_cn}</p>
      </header>
      <div class="article-content-grid">
        <article class="article-body" data-slug="{html.escape(post.slug, quote=True)}">
{body_html}
        </article>
        <aside class="article-sidebar" aria-label="文章导航">
          <section class="sidebar-panel">
            <h2>同板块文章</h2>
            <ul>
{sidebar_links(posts, post, same_category=True)}
            </ul>
          </section>
          <section class="sidebar-panel">
            <h2>推荐阅读</h2>
            <ul>
{sidebar_links(posts, post, same_category=False)}
            </ul>
          </section>
        </aside>
      </div>
      <nav class="post-nav" aria-label="上一篇和下一篇">
{older_link}
{newer_link}
      </nav>
    </main>
"""
    return page_shell(post.title, post.summary, body)


def rebuild_board_pages(posts: list[PostInfo]) -> None:
    BOARDS_DIR.mkdir(parents=True, exist_ok=True)
    for category in CATEGORIES:
        (BOARDS_DIR / f"{category}.html").write_text(render_board_page(category, posts), encoding="utf-8")


def rebuild_article_pages(posts: list[PostInfo]) -> None:
    for post in posts:
        path = ROOT / post.href
        if not path.exists():
            continue
        original = path.read_text(encoding="utf-8")
        body_html = extract_article_body(original)
        path.write_text(render_article_page(post, posts, body_html), encoding="utf-8")


def rebuild_all() -> list[PostInfo]:
    posts = parse_posts()
    rebuild_board_pages(posts)
    rebuild_article_pages(posts)
    return posts


def main() -> int:
    posts = rebuild_all()
    print(f"Rebuilt {len(posts)} posts and {len(CATEGORIES)} board pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
