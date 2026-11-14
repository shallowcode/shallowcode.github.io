"""Rebuild every generated page of the blog from the post cards in index.html.

The post cards between ``<!-- POST_CARDS_START -->`` and ``<!-- POST_CARDS_END -->``
in index.html are the single source of truth for post metadata (title, date,
category, summary). From them this script regenerates:

- the homepage card list, timeline and board counts (between their markers)
- boards/<category>.html
- posts/<slug>.html (shared header/footer, sidebar, previous/next navigation)
- sitemap.xml and feed.xml
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
POSTS_DIR = ROOT / "posts"
BOARDS_DIR = ROOT / "boards"
SITEMAP_PATH = ROOT / "sitemap.xml"
FEED_PATH = ROOT / "feed.xml"

SITE_URL = "https://shallowcode.github.io"
SITE_NAME = "浅梦"
SITE_DESCRIPTION = "浅梦的个人博客，记录随笔、旅行、游戏和生活里的片段。"
FEED_TIMEZONE = "+08:00"

CATEGORIES = {
    "essay": ("感悟与随笔", "随笔", "Essay", "写一些不一定完整、但当时很真实的想法。"),
    "travel": ("旅行与照片", "旅行", "Travel", "把照片、路线和路上的片段整理到一起。"),
    "game": ("游戏与记录", "游戏", "Game", "记录游戏里的截图、感受和那些停留很久的瞬间。"),
}

# Sets the theme before first paint so dark mode never flashes light.
THEME_INIT_SCRIPT = (
    '(function(){try{var t=localStorage.getItem("theme");'
    'if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}'
    "document.documentElement.dataset.theme=t}catch(e){}})();"
)

FONT_URL = "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap"

ADMIN_ICON = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
    'stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/>'
    '<path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
)

THEME_TOGGLE = """<button class="theme-toggle" type="button" aria-label="切换深色模式">
            <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></svg>
            <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          </button>"""


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


def esc(value: str, quote: bool = False) -> str:
    return html.escape(value, quote=quote)


def strip_tags(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(re.sub(r"\s+", " ", value).strip())


def category_names(category: str) -> tuple[str, str, str, str]:
    return CATEGORIES.get(category, (category, category, category.title(), ""))


# ---------- reading index.html ----------

def parse_posts(content: str | None = None) -> list[PostInfo]:
    if content is None:
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
        if not link or not meta:
            continue
        href = html.unescape(link.group("href"))
        if href in seen:
            continue
        seen.add(href)
        after_title = body[link.end():]
        paragraphs = re.findall(r"<p(?: [^>]*)?>(.*?)</p>", after_title, flags=re.S)
        meta_text = strip_tags(meta.group("meta"))
        date_text = meta_text.split("·")[-1].strip() if "·" in meta_text else meta_text.strip()
        posts.append(PostInfo(
            category=match.group("category"),
            date_text=date_text,
            date_attr=date_text.replace(".", "-"),
            title=strip_tags(link.group("title")),
            href=href,
            summary=strip_tags(paragraphs[-1]) if paragraphs else "",
        ))
    # Newest first. The sort is stable, so same-day posts keep their order in index.html.
    posts.sort(key=lambda post: post.date_attr, reverse=True)
    return posts


# ---------- shared page pieces ----------

def page_head(title: str, description: str, prefix: str, path: str, og_type: str = "website") -> str:
    canonical = f"{SITE_URL}/{path}"
    return f"""  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(description, True)}">
    <meta name="theme-color" content="#f7f1e4">
    <link rel="canonical" href="{esc(canonical, True)}">
    <meta property="og:site_name" content="{SITE_NAME}">
    <meta property="og:type" content="{og_type}">
    <meta property="og:title" content="{esc(title, True)}">
    <meta property="og:description" content="{esc(description, True)}">
    <meta property="og:url" content="{esc(canonical, True)}">
    <meta property="og:locale" content="zh_CN">
    <link rel="icon" href="{prefix}favicon.svg" type="image/svg+xml">
    <link rel="alternate" type="application/atom+xml" title="{SITE_NAME}" href="{prefix}feed.xml">
    <script>{THEME_INIT_SCRIPT}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="{FONT_URL}" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="{FONT_URL}"></noscript>
    <link rel="stylesheet" href="{prefix}styles.css">
    <script src="{prefix}script.js" defer></script>
  </head>"""


def site_header(prefix: str, current: str = "") -> str:
    links = []
    for category in CATEGORIES:
        _, short_name, _, _ = CATEGORIES[category]
        current_attr = ' aria-current="page"' if category == current else ""
        links.append(f'            <a href="{prefix}boards/{category}.html"{current_attr}>{short_name}</a>')
    nav_links = "\n".join(links)
    return f"""    <a class="skip-link" href="#main">跳到正文</a>
    <div class="progress-bar" aria-hidden="true"></div>

    <header class="site-header">
      <nav class="nav-shell" aria-label="主导航">
        <div class="brand-group">
          <a class="brand" href="{prefix}index.html" aria-label="{SITE_NAME} · 回到首页">
            <span class="brand-mark">{SITE_NAME}</span>
          </a>
          <a class="admin-link" href="{prefix}admin/index.html" aria-label="管理员登录" title="管理员登录">
            {ADMIN_ICON}<span class="admin-link-text">管理</span>
          </a>
        </div>
        <div class="nav-actions">
          <div class="nav-links">
{nav_links}
          </div>
          {THEME_TOGGLE}
        </div>
      </nav>
    </header>"""


def site_footer(prefix: str) -> str:
    return f"""    <footer class="site-footer">
      <span>© {date.today().year} {SITE_NAME}</span>
      <span class="footer-links">
        <a href="{prefix}feed.xml">RSS 订阅</a>
        <a href="#top">回到顶部</a>
      </span>
    </footer>"""


def page_shell(
    title: str,
    description: str,
    body: str,
    path: str,
    prefix: str = "../",
    current: str = "",
    og_type: str = "website",
) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
{page_head(f"{title} | {SITE_NAME}", description, prefix, path, og_type)}
  <body>
{site_header(prefix, current)}

{body}
{site_footer(prefix)}
  </body>
</html>
"""


# ---------- homepage ----------

def post_card(post: PostInfo) -> str:
    _, category_cn, _, _ = category_names(post.category)
    return (
        f'          <article class="post-card" data-category="{esc(post.category, True)}">\n'
        f'            <p class="post-meta">{category_cn} · {post.date_text}</p>\n'
        f'            <h3><a href="{esc(post.href, True)}">{esc(post.title)}</a></h3>\n'
        f"            <p>{esc(post.summary)}</p>\n"
        "          </article>"
    )


def timeline_item(post: PostInfo) -> str:
    _, category_cn, _, _ = category_names(post.category)
    return (
        '          <article class="timeline-item">\n'
        f'            <time datetime="{post.date_attr}">{post.date_text}</time>\n'
        "            <div>\n"
        f'              <h3><a href="{esc(post.href, True)}">{esc(post.title)}</a></h3>\n'
        f"              <p>{category_cn}</p>\n"
        "            </div>\n"
        "          </article>"
    )


def board_entry(category: str, posts: list[PostInfo]) -> str:
    title, _, _, _ = CATEGORIES[category]
    count = sum(1 for post in posts if post.category == category)
    count_text = f"{count} 篇" if count else "还没有文章"
    return (
        f'          <a class="board-card" data-board="{category}" href="boards/{category}.html">\n'
        f"            <h3>{title}</h3>\n"
        f'            <p class="board-count">{count_text}</p>\n'
        "          </a>"
    )


def replace_between_markers(content: str, name: str, lines: list[str]) -> str:
    """Replace everything between <!-- NAME_START --> and <!-- NAME_END -->."""
    pattern = re.compile(
        rf"(?P<indent>[ \t]*)<!-- {name}_START -->.*?<!-- {name}_END -->",
        flags=re.S,
    )
    match = pattern.search(content)
    if not match:
        return content
    indent = match.group("indent")
    block = "\n".join([f"{indent}<!-- {name}_START -->", *lines, f"{indent}<!-- {name}_END -->"])
    return content[:match.start()] + block + content[match.end():]


def rebuild_index(posts: list[PostInfo]) -> None:
    content = INDEX_PATH.read_text(encoding="utf-8")
    original = content
    # A cover-post card carries an image, so leave hand-made card lists alone.
    if "cover-post" not in content:
        content = replace_between_markers(content, "POST_CARDS", [post_card(post) for post in posts])
    content = replace_between_markers(content, "TIMELINE", [timeline_item(post) for post in posts])
    content = replace_between_markers(content, "BOARDS", [board_entry(category, posts) for category in CATEGORIES])
    if content != original:
        INDEX_PATH.write_text(content, encoding="utf-8")


# ---------- board pages ----------

def board_card(post: PostInfo) -> str:
    _, category_cn, _, _ = category_names(post.category)
    return (
        '        <article class="board-post-card">\n'
        f'          <p class="post-meta">{category_cn} · {post.date_text}</p>\n'
        f'          <h2><a href="../{esc(post.href, True)}">{esc(post.title)}</a></h2>\n'
        f"          <p>{esc(post.summary)}</p>\n"
        "        </article>"
    )


def render_board_page(category: str, posts: list[PostInfo]) -> str:
    title, _, category_en, description = CATEGORIES[category]
    post_list = "\n".join(board_card(post) for post in posts if post.category == category)
    if not post_list:
        post_list = '        <p class="empty-note">这个板块还在等第一篇文章。</p>'
    body = f"""    <main id="main" class="board-main">
      <a class="back-link" href="../index.html">返回首页</a>
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
    return page_shell(title, description, body, path=f"boards/{category}.html", current=category)


# ---------- article pages ----------

def extract_article_body(content: str) -> str:
    match = re.search(r'<article class="article-body"[^>]*>(?P<body>.*?)</article>', content, flags=re.S)
    if not match:
        raise ValueError("Missing article body")
    return match.group("body").strip()


def sidebar_panel(heading: str, selected: list[PostInfo]) -> str:
    if not selected:
        return ""
    items = "\n".join(
        f'              <li><a href="{esc(post.filename, True)}">{esc(post.title)}</a><small>{post.date_text}</small></li>'
        for post in selected
    )
    return f"""          <section class="sidebar-panel">
            <h2>{heading}</h2>
            <ul>
{items}
            </ul>
          </section>"""


def render_article_page(post: PostInfo, posts: list[PostInfo], body_html: str) -> str:
    _, category_cn, category_en, _ = category_names(post.category)
    index = next((idx for idx, item in enumerate(posts) if item.href == post.href), -1)
    older = posts[index + 1] if 0 <= index + 1 < len(posts) else None
    newer = posts[index - 1] if index > 0 else None

    older_link = (
        f'        <a class="post-nav-card" href="{esc(older.filename, True)}" rel="prev"><span>上一篇</span><strong>{esc(older.title)}</strong></a>'
        if older
        else '        <span class="post-nav-card is-empty"><span>上一篇</span><strong>没有更早的文章了</strong></span>'
    )
    newer_link = (
        f'        <a class="post-nav-card" href="{esc(newer.filename, True)}" rel="next"><span>下一篇</span><strong>{esc(newer.title)}</strong></a>'
        if newer
        else '        <span class="post-nav-card is-empty"><span>下一篇</span><strong>已经是最新文章</strong></span>'
    )

    others = [item for item in posts if item.href != post.href]
    same_board = [item for item in others if item.category == post.category][:5]
    shown = {item.href for item in same_board}
    elsewhere = [item for item in others if item.href not in shown][:5]
    panels = [
        panel for panel in (
            sidebar_panel("同板块文章", same_board),
            sidebar_panel("其他板块", elsewhere),
        ) if panel
    ]

    article = f"""<article class="article-body" data-slug="{esc(post.slug, True)}">
{body_html}
        </article>"""
    if panels:
        main_class = "article-main article-layout"
        content = f"""      <div class="article-content-grid">
        {article}
        <aside class="article-sidebar" aria-label="更多文章">
{chr(10).join(panels)}
        </aside>
      </div>"""
    else:
        main_class = "article-main"
        content = f"      {article}"

    nav = ""
    if older or newer:
        nav = f"""
      <nav class="post-nav" aria-label="上一篇和下一篇">
{older_link}
{newer_link}
      </nav>"""

    board_href = f"../boards/{post.category}.html"
    body = f"""    <main id="main" class="{main_class}">
      <a class="back-link" href="{board_href}">返回{category_cn}板块</a>
      <header class="article-header">
        <p class="eyebrow">{category_en}</p>
        <h1>{esc(post.title)}</h1>
        <p class="article-meta"><time datetime="{post.date_attr}">{post.date_text}</time> · {category_cn}</p>
      </header>
{content}{nav}
    </main>
"""
    return page_shell(
        post.title,
        post.summary or post.title,
        body,
        path=post.href,
        current=post.category,
        og_type="article",
    )


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


# ---------- sitemap + feed ----------

def render_sitemap(posts: list[PostInfo]) -> str:
    latest = posts[0].date_attr if posts else ""
    entries: list[tuple[str, str]] = [(f"{SITE_URL}/", latest)]
    for category in CATEGORIES:
        board_posts = [post for post in posts if post.category == category]
        entries.append((f"{SITE_URL}/boards/{category}.html", board_posts[0].date_attr if board_posts else ""))
    entries.extend((f"{SITE_URL}/{post.href}", post.date_attr) for post in posts)

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod in entries:
        lastmod_xml = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
        lines.append(f"  <url><loc>{esc(loc)}</loc>{lastmod_xml}</url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def render_feed(posts: list[PostInfo]) -> str:
    def stamp(day: str) -> str:
        return f"{day}T00:00:00{FEED_TIMEZONE}"

    updated = stamp(posts[0].date_attr) if posts else stamp("1970-01-01")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">',
        f"  <title>{SITE_NAME}</title>",
        f"  <subtitle>{esc(SITE_DESCRIPTION)}</subtitle>",
        f'  <link href="{SITE_URL}/"/>',
        f'  <link rel="self" type="application/atom+xml" href="{SITE_URL}/feed.xml"/>',
        f"  <id>{SITE_URL}/</id>",
        f"  <updated>{updated}</updated>",
        f"  <author><name>{SITE_NAME}</name></author>",
    ]
    for post in posts[:30]:
        url = f"{SITE_URL}/{post.href}"
        _, category_cn, _, _ = category_names(post.category)
        lines.extend([
            "  <entry>",
            f"    <title>{esc(post.title)}</title>",
            f'    <link href="{esc(url, True)}"/>',
            f"    <id>{esc(url)}</id>",
            f"    <published>{stamp(post.date_attr)}</published>",
            f"    <updated>{stamp(post.date_attr)}</updated>",
            f'    <category term="{esc(category_cn, True)}"/>',
            f"    <summary>{esc(post.summary or post.title)}</summary>",
            "  </entry>",
        ])
    lines.append("</feed>")
    return "\n".join(lines) + "\n"


def rebuild_all() -> list[PostInfo]:
    posts = parse_posts()
    rebuild_index(posts)
    rebuild_board_pages(posts)
    rebuild_article_pages(posts)
    SITEMAP_PATH.write_text(render_sitemap(posts), encoding="utf-8")
    FEED_PATH.write_text(render_feed(posts), encoding="utf-8")
    return posts


def main() -> int:
    posts = rebuild_all()
    print(f"Rebuilt {len(posts)} posts, {len(CATEGORIES)} board pages, sitemap.xml and feed.xml.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
