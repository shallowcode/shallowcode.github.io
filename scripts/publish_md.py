from __future__ import annotations

import argparse
import html
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import rebuild_blog_pages


ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "posts"
INDEX_PATH = ROOT / "index.html"
UPLOADS_DIR = ROOT / "assets" / "uploads"

CATEGORIES = {
    "essay": ("日记", "Diary"),
    "travel": ("旅行", "Travel"),
    "game": ("游戏", "Game"),
}


@dataclass
class Post:
    title: str
    slug: str
    date: str
    category: str
    summary: str
    timeline: str
    cover: str
    cover_src: str
    cover_alt: str
    cover_caption: str
    album: bool
    album_class: str
    body_html: str
    place: str = ""
    verdict: str = ""


def fail(message: str) -> None:
    raise SystemExit(f"Error: {message}")


def read_markdown(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8-sig")
    match = re.match(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n?(.*)$", text, re.S)
    if not match:
        return {}, text

    meta: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip().strip('"').strip("'")
        meta[key.strip().lower()] = value
    return meta, match.group(2).strip()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized[:80] or f"post-{date.today().isoformat()}"


def is_true(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on", "是"}


def text_without_markdown(markdown: str) -> str:
    text = re.sub(r"```.*?```", " ", markdown, flags=re.S)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*+]\s+\[[ xX]\]\s*", "", text, flags=re.M)
    text = re.sub(r"[*_`>#-]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def first_heading(markdown: str) -> str:
    match = re.search(r"^#{1,6}\s+(.+)$", markdown, flags=re.M)
    return match.group(1).strip() if match else ""


def first_paragraph(markdown: str) -> str:
    chunks = re.split(r"\n\s*\n", markdown)
    for chunk in chunks:
        stripped = chunk.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("```"):
            continue
        if re.match(r"^[-*+]\s+", stripped):
            continue
        return text_without_markdown(stripped)
    return text_without_markdown(markdown)


TASK_ITEM = re.compile(r"^\[([ xX])\]\s+(.*)$")


def ensure_inside_root(path: Path) -> Path:
    resolved = path.resolve()
    root = ROOT.resolve()
    if resolved != root and root not in resolved.parents:
        fail(f"unsafe path outside project: {resolved}")
    return resolved


def copy_image_if_local(src: str, md_path: Path, slug: str, copy_files: bool = True) -> str:
    parsed = urlparse(src)
    if parsed.scheme in {"http", "https", "data", "mailto", "tel"}:
        return src
    if src.startswith("../"):
        return src
    if src.startswith("/"):
        return src
    src_path = src.replace("\\", "/")
    if src_path.startswith("assets/"):
        return f"../{src_path}"

    candidate = (md_path.parent / src).resolve()
    if candidate.exists() and candidate.is_file():
        dest_dir = UPLOADS_DIR / slug
        dest = ensure_inside_root(dest_dir / candidate.name)
        if copy_files:
            dest_dir.mkdir(parents=True, exist_ok=True)
            if candidate.resolve() != dest.resolve():
                shutil.copy2(candidate, dest)
        return f"../assets/uploads/{slug}/{dest.name}"

    upload_candidate = UPLOADS_DIR / slug / src_path
    if upload_candidate.exists():
        return f"../assets/uploads/{slug}/{src_path}"

    return src


def index_src(article_src: str) -> str:
    if article_src.startswith("../"):
        return article_src[3:]
    return article_src


def parse_link_target(target: str) -> tuple[str, str]:
    match = re.match(r'(\S+)(?:\s+"([^"]+)")?$', target.strip())
    if not match:
        return target.strip(), ""
    return match.group(1), match.group(2) or ""


def inline_markdown(
    text: str,
    md_path: Path,
    slug: str,
    copy_images: bool = True,
    block_images: bool = False,
) -> str:
    stash: list[str] = []

    def token(value: str) -> str:
        stash.append(value)
        return f"\u0000{len(stash) - 1}\u0000"

    def image_repl(match: re.Match[str]) -> str:
        alt = match.group(1)
        raw_src, caption = parse_link_target(match.group(2))
        src = copy_image_if_local(raw_src, md_path, slug, copy_images)
        caption_text = caption or alt
        escaped_alt = html.escape(alt, quote=True)
        escaped_src = html.escape(src, quote=True)
        if block_images:
            caption_html = ""
            if caption_text:
                escaped_caption = html.escape(caption_text, quote=False)
                caption_html = f"          <figcaption>{escaped_caption}</figcaption>\n"
            return token(
                '        <figure class="article-photo">\n'
                f'          <img src="{escaped_src}" alt="{escaped_alt}" loading="lazy" decoding="async">\n'
                f"{caption_html}"
                "        </figure>"
            )
        return token(f'<img src="{escaped_src}" alt="{escaped_alt}" loading="lazy" decoding="async">')

    def code_repl(match: re.Match[str]) -> str:
        return token(f"<code>{html.escape(match.group(1), quote=False)}</code>")

    def link_repl(match: re.Match[str]) -> str:
        label = html.escape(match.group(1), quote=False)
        raw_href, _ = parse_link_target(match.group(2))
        href = html.escape(raw_href, quote=True)
        return token(f'<a href="{href}">{label}</a>')

    text = re.sub(r"`([^`]+)`", code_repl, text)
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", image_repl, text)
    text = re.sub(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)", link_repl, text)
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"<em>\1</em>", text)

    for index, value in enumerate(stash):
        text = text.replace(f"\u0000{index}\u0000", value)
    return text


def close_paragraph(output: list[str], paragraph: list[str], md_path: Path, slug: str, copy_images: bool) -> None:
    if not paragraph:
        return
    text = " ".join(item.strip() for item in paragraph).strip()
    output.append(f"        <p>{inline_markdown(text, md_path, slug, copy_images)}</p>")
    paragraph.clear()


def close_list(output: list[str], list_items: list[str], ordered: bool, md_path: Path, slug: str, copy_images: bool) -> None:
    if not list_items:
        return
    tag = "ol" if ordered else "ul"
    is_task_list = not ordered and all(TASK_ITEM.match(item) for item in list_items)
    output.append(f'        <{tag} class="task-list">' if is_task_list else f"        <{tag}>")
    for item in list_items:
        task = TASK_ITEM.match(item) if is_task_list else None
        if task:
            done = task.group(1).lower() == "x"
            text = inline_markdown(task.group(2), md_path, slug, copy_images)
            item_class = "task-item is-done" if done else "task-item"
            checked = " checked" if done else ""
            output.append(
                f'          <li class="{item_class}"><input type="checkbox" disabled{checked}><span>{text}</span></li>'
            )
        else:
            output.append(f"          <li>{inline_markdown(item, md_path, slug, copy_images)}</li>")
    output.append(f"        </{tag}>")
    list_items.clear()


def close_quote(output: list[str], quote_lines: list[str], md_path: Path, slug: str, copy_images: bool) -> None:
    if not quote_lines:
        return
    text = " ".join(quote_lines).strip()
    output.append(f"        <blockquote>{inline_markdown(text, md_path, slug, copy_images)}</blockquote>")
    quote_lines.clear()


def markdown_to_html(markdown: str, md_path: Path, slug: str, copy_images: bool = True) -> str:
    output: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    quote_lines: list[str] = []
    list_ordered = False
    in_code = False
    code_lang = ""
    code_lines: list[str] = []

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        fence = re.match(r"^```\s*([A-Za-z0-9_-]*)\s*$", line)
        if fence:
            if in_code:
                lang_attr = f' class="language-{html.escape(code_lang, quote=True)}"' if code_lang else ""
                code = html.escape("\n".join(code_lines), quote=False)
                output.append(f"        <pre><code{lang_attr}>{code}</code></pre>")
                code_lines.clear()
                code_lang = ""
                in_code = False
            else:
                close_paragraph(output, paragraph, md_path, slug, copy_images)
                close_list(output, list_items, list_ordered, md_path, slug, copy_images)
                close_quote(output, quote_lines, md_path, slug, copy_images)
                in_code = True
                code_lang = fence.group(1)
            continue

        if in_code:
            code_lines.append(raw_line)
            continue

        if not line.strip():
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            continue

        stripped_line = line.strip()
        standalone_image = re.match(r"^!\[[^\]]*\]\([^)]+\)$", stripped_line)
        if standalone_image:
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            output.append(inline_markdown(stripped_line, md_path, slug, copy_images, block_images=True))
            continue

        if re.match(r"^#{1,6}\s*$", line):
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            level = min(len(heading.group(1)) + 1, 6)
            title = inline_markdown(heading.group(2).strip(), md_path, slug, copy_images)
            output.append(f"        <h{level}>{title}</h{level}>")
            continue

        if re.match(r"^---+$", line.strip()):
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            output.append("        <hr>")
            continue

        quote = re.match(r"^>\s?(.*)$", line)
        if quote:
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            quote_lines.append(quote.group(1))
            continue

        unordered = re.match(r"^[-*+]\s+(.+)$", line)
        ordered = re.match(r"^\d+[.)]\s+(.+)$", line)
        if unordered or ordered:
            close_paragraph(output, paragraph, md_path, slug, copy_images)
            close_quote(output, quote_lines, md_path, slug, copy_images)
            current_ordered = bool(ordered)
            if list_items and current_ordered != list_ordered:
                close_list(output, list_items, list_ordered, md_path, slug, copy_images)
            list_ordered = current_ordered
            list_items.append((ordered or unordered).group(1).strip())
            continue

        close_list(output, list_items, list_ordered, md_path, slug, copy_images)
        close_quote(output, quote_lines, md_path, slug, copy_images)
        paragraph.append(line)

    if in_code:
        lang_attr = f' class="language-{html.escape(code_lang, quote=True)}"' if code_lang else ""
        code = html.escape("\n".join(code_lines), quote=False)
        output.append(f"        <pre><code{lang_attr}>{code}</code></pre>")
    close_paragraph(output, paragraph, md_path, slug, copy_images)
    close_list(output, list_items, list_ordered, md_path, slug, copy_images)
    close_quote(output, quote_lines, md_path, slug, copy_images)
    return "\n\n".join(group_photos(output))


def group_photos(blocks: list[str]) -> list[str]:
    """Wrap runs of two or more standalone photos in a photo wall."""
    grouped: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if len(run) >= 2:
            grouped.append(
                f'        <div class="photo-grid" data-count="{len(run)}">\n' + "\n".join(run) + "\n        </div>"
            )
        else:
            grouped.extend(run)
        run.clear()

    for block in blocks:
        if block.startswith('        <figure class="article-photo">'):
            run.append(block)
        else:
            flush()
            grouped.append(block)
    flush()
    return grouped


def split_points(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[|｜;；\n]", value) if item.strip()]


def review_card(meta: dict[str, str], verdict: str) -> str:
    """The "省流版" box that opens a game post: name, platform, hours, verdict, pros and cons."""
    facts = [
        (label, meta.get(key, "").strip())
        for key, label in (("game", "游戏"), ("platform", "平台"), ("hours", "游玩时长"))
    ]
    facts = [(label, value) for label, value in facts if value]
    pros = split_points(meta.get("pros", ""))
    cons = split_points(meta.get("cons", ""))
    if not verdict and not facts and not pros and not cons:
        return ""
    lines = ['        <aside class="review-card" aria-label="省流版">', '          <p class="review-title">省流版</p>']
    if verdict:
        lines.append(
            f'          <p class="review-verdict" data-verdict="{verdict}">{rebuild_blog_pages.VERDICTS[verdict][0]}</p>'
        )
    if facts:
        lines.append('          <dl class="review-facts">')
        lines.extend(
            f"            <div><dt>{label}</dt><dd>{html.escape(value, quote=False)}</dd></div>" for label, value in facts
        )
        lines.append("          </dl>")
    if pros or cons:
        lines.append('          <div class="review-points">')
        for css_class, heading, items in (("review-pros", "优点", pros), ("review-cons", "缺点", cons)):
            if not items:
                continue
            lines.append(f'            <div class="{css_class}">')
            lines.append(f"              <h3>{heading}</h3>")
            lines.append("              <ul>")
            lines.extend(f"                <li>{html.escape(item, quote=False)}</li>" for item in items)
            lines.append("              </ul>")
            lines.append("            </div>")
        lines.append("          </div>")
    lines.append("        </aside>")
    return "\n".join(lines)


def diary_tags(meta: dict[str, str]) -> str:
    tags = [(label, meta.get(key, "").strip()) for key, label in (("weather", "天气"), ("mood", "心情"))]
    tags = [(label, value) for label, value in tags if value]
    if not tags:
        return ""
    spans = "".join(f"<span><b>{label}</b>{html.escape(value, quote=False)}</span>" for label, value in tags)
    return f'        <div class="diary-tags">{spans}</div>'


def build_post(path: Path, copy_images: bool = True) -> Post:
    meta, markdown = read_markdown(path)
    body_heading = first_heading(markdown)
    title = meta.get("title") or body_heading
    if not title:
        fail("missing title. Add title in front matter or use a top-level # heading.")
    if body_heading and body_heading == title:
        markdown = re.sub(r"^#{1,6}\s+.+\r?\n?", "", markdown, count=1, flags=re.M).strip()

    post_date = meta.get("date") or date.today().isoformat()
    category = meta.get("category", "essay").strip().lower()
    if category not in CATEGORIES:
        fail(f"unknown category '{category}'. Use one of: {', '.join(CATEGORIES)}")

    slug = meta.get("slug") or slugify(path.stem or title)
    summary = meta.get("summary") or first_paragraph(markdown)[:86]
    timeline = meta.get("timeline") or summary
    cover = meta.get("cover", "")
    cover_src = ""
    cover_alt = meta.get("cover_alt") or title
    cover_caption = meta.get("cover_caption", "")
    album = is_true(meta.get("album", "false"))
    album_class = meta.get("album_class", "").strip()
    if album_class not in {"", "tall", "wide"}:
        fail("album_class must be empty, tall, or wide.")

    body_html = markdown_to_html(markdown, path, slug, copy_images)
    # The cover is shown by the page header (a full-width hero on travel posts),
    # so it is not repeated inside the body.
    if cover:
        cover_src = copy_image_if_local(cover, path, slug, copy_images)

    verdict = rebuild_blog_pages.clean_verdict(meta.get("verdict", "")) if category == "game" else ""
    place = meta.get("place", "").strip() if category == "travel" else ""
    if category == "game":
        blocks = [review_card(meta, verdict), body_html]
    else:
        blocks = [body_html]
    body_html = "\n\n".join(block for block in blocks if block)

    return Post(
        title=title,
        slug=slug,
        date=post_date,
        category=category,
        summary=summary,
        timeline=timeline,
        cover=cover,
        cover_src=cover_src,
        cover_alt=cover_alt,
        cover_caption=cover_caption,
        album=album,
        album_class=album_class,
        body_html=body_html,
        place=place,
        verdict=verdict,
    )


def post_info(post: Post) -> rebuild_blog_pages.PostInfo:
    return rebuild_blog_pages.PostInfo(
        category=post.category,
        date_text=post.date.replace("-", "."),
        date_attr=post.date,
        title=post.title,
        href=f"posts/{post.slug}.html",
        summary=post.summary,
        cover=index_src(post.cover_src) if post.cover_src.startswith("../") else "",
        place=post.place,
        verdict=post.verdict,
    )


def render_article(post: Post) -> str:
    """Standalone article page. rebuild_blog_pages.rebuild_all() adds the sidebar and prev/next links."""
    info = post_info(post)
    return rebuild_blog_pages.render_article_page(info, [info], post.body_html)


def insert_after_marker(content: str, marker: str, snippet: str, unique: str) -> str:
    if unique in content:
        return content
    if marker not in content:
        fail(f"missing marker in index.html: {marker}")
    return content.replace(marker, f"{marker}\n{snippet}", 1)


def update_latest_panel(content: str, post: Post, link: str) -> str:
    latest_panel = (
        '        <aside class="hero-note-panel" aria-label="最新文章">\n'
        '          <p class="eyebrow">Latest</p>\n'
        f"          <h2>{html.escape(post.title, quote=False)}</h2>\n"
        f"          <p>{html.escape(post.summary, quote=False)}</p>\n"
        f'          <a class="text-link" href="{html.escape(link, quote=True)}">继续阅读</a>\n'
        "        </aside>"
    )
    updated, count = re.subn(
        r'        <aside class="hero-note-panel" aria-label="最新文章">.*?        </aside>',
        latest_panel,
        content,
        count=1,
        flags=re.S,
    )
    # The homepage may not have a "latest article" panel; that is fine.
    return updated if count else content


def update_index(post: Post) -> None:
    """Insert the post's card into index.html, or refresh it when it is already there.

    The timeline, board pages and article navigation are derived from the cards by
    rebuild_blog_pages.rebuild_all(), which every publish flow runs right after this.
    """
    content = INDEX_PATH.read_text(encoding="utf-8")
    link = f"posts/{post.slug}.html"
    post_card = rebuild_blog_pages.post_card(post_info(post))

    existing = None
    for match in re.finditer(
        r'[ \t]*<article class="post-card(?:[^"]*)" data-category="[^"]*"[^>]*>.*?</article>',
        content,
        flags=re.S,
    ):
        if f'href="{link}"' in match.group(0):
            existing = match
            break
    if existing:
        content = content[:existing.start()] + post_card + content[existing.end():]
    else:
        content = insert_after_marker(content, "          <!-- POST_CARDS_START -->", post_card, f'href="{link}"')
    content = update_latest_panel(content, post, link)

    if post.album and post.cover_src and "          <!-- ALBUM_START -->" in content:
        cover_src = index_src(post.cover_src)
        class_attr = f" {post.album_class}" if post.album_class else ""
        caption = post.cover_caption or post.cover_alt or post.title
        album_item = (
            f'          <figure class="photo-card{class_attr}">\n'
            f'            <img src="{html.escape(cover_src, quote=True)}" alt="{html.escape(post.cover_alt, quote=True)}">\n'
            f"            <figcaption>{html.escape(caption, quote=False)}</figcaption>\n"
            "          </figure>"
        )
        content = insert_after_marker(content, "          <!-- ALBUM_START -->", album_item, cover_src)

    INDEX_PATH.write_text(content, encoding="utf-8")


def _strip_index_blocks(content: str, block_pattern: str, needle: str) -> tuple[str, int]:
    """Remove whole HTML blocks (and their leading indentation) that contain ``needle``."""
    pieces: list[str] = []
    last = 0
    removed = 0
    for match in re.finditer(block_pattern, content, flags=re.S):
        if needle not in match.group(0):
            continue
        start = match.start()
        line_start = content.rfind("\n", 0, start)
        cut = line_start if line_start != -1 else start
        pieces.append(content[last:cut])
        last = match.end()
        removed += 1
    pieces.append(content[last:])
    return "".join(pieces), removed


def _placeholder_latest_panel() -> str:
    return (
        '        <aside class="hero-note-panel" aria-label="最新文章">\n'
        '          <p class="eyebrow">Latest</p>\n'
        "          <h2>还没有文章</h2>\n"
        "          <p>发布第一篇文章后，这里会显示最新内容。</p>\n"
        "        </aside>"
    )


def refresh_latest_panel(content: str) -> str:
    """Point the homepage 'latest article' panel at the newest remaining post-card."""
    card = re.search(
        r'<article class="post-card(?:[^"]*)" data-category="[^"]*"[^>]*>(?P<body>.*?)</article>',
        content,
        flags=re.S,
    )
    link = None
    if card:
        link = re.search(
            r'<h3>\s*<a href="(?P<href>[^"]+)">(?P<title>.*?)</a>\s*</h3>',
            card.group("body"),
            flags=re.S,
        )
    if not card or not link:
        panel = _placeholder_latest_panel()
    else:
        paragraphs = re.findall(r"<p(?: [^>]*)?>(.*?)</p>", card.group("body"), flags=re.S)
        href = link.group("href")
        title = link.group("title").strip()
        summary = paragraphs[-1].strip() if paragraphs else ""
        panel = (
            '        <aside class="hero-note-panel" aria-label="最新文章">\n'
            '          <p class="eyebrow">Latest</p>\n'
            f"          <h2>{title}</h2>\n"
            f"          <p>{summary}</p>\n"
            f'          <a class="text-link" href="{href}">继续阅读</a>\n'
            "        </aside>"
        )
    updated, count = re.subn(
        r'        <aside class="hero-note-panel" aria-label="最新文章">.*?        </aside>',
        lambda _match: panel,
        content,
        count=1,
        flags=re.S,
    )
    return updated if count else content


def remove_from_index(slug: str) -> bool:
    """Remove a post's card, timeline row and album figure from index.html.

    Returns True when index.html actually changed.
    """
    if not INDEX_PATH.exists():
        return False
    content = INDEX_PATH.read_text(encoding="utf-8")
    original = content
    href = f"posts/{slug}.html"
    content, _ = _strip_index_blocks(
        content,
        r'<article class="post-card(?:[^"]*)" data-category="[^"]*"[^>]*>.*?</article>',
        f'href="{href}"',
    )
    content, _ = _strip_index_blocks(
        content,
        r'<article class="timeline-item">.*?</article>',
        f'href="{href}"',
    )
    content, _ = _strip_index_blocks(
        content,
        r'<figure class="photo-card(?:[^"]*)">.*?</figure>',
        f'assets/uploads/{slug}/',
    )
    content = refresh_latest_panel(content)
    if content != original:
        INDEX_PATH.write_text(content, encoding="utf-8")
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish a Markdown file into the static blog.")
    parser.add_argument("markdown", help="Path to a Markdown file, usually content/inbox/<slug>.md")
    parser.add_argument("--force", action="store_true", help="Overwrite posts/<slug>.html if it exists")
    parser.add_argument("--no-index", action="store_true", help="Only write the post HTML, do not update index.html")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be written without changing files")
    args = parser.parse_args()

    md_path = Path(args.markdown)
    if not md_path.is_absolute():
        md_path = ROOT / md_path
    md_path = ensure_inside_root(md_path)
    if not md_path.exists():
        fail(f"markdown file not found: {md_path}")

    post = build_post(md_path, copy_images=not args.dry_run)
    post_path = POSTS_DIR / f"{post.slug}.html"
    if post_path.exists() and not args.force:
        fail(f"{post_path.relative_to(ROOT)} already exists. Use --force to overwrite.")

    article_html = render_article(post)
    if args.dry_run:
        print(f"Post: {post_path.relative_to(ROOT)}")
        print(f"Title: {post.title}")
        print(f"Category: {post.category}")
        print(f"Update index: {not args.no_index}")
        return 0

    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    post_path.write_text(article_html, encoding="utf-8")
    if not args.no_index:
        update_index(post)
        import rebuild_blog_pages
        rebuild_blog_pages.rebuild_all()

    print(f"Published {md_path.relative_to(ROOT)}")
    print(f"Post: {post_path.relative_to(ROOT)}")
    if not args.no_index:
        print("Updated index.html")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
