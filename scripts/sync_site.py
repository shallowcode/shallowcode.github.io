"""Bring the generated site in line with the Markdown sources.

Run by the GitHub Actions deploy workflow on every push, so that a post written
in the web admin (which only commits content/inbox/<slug>.md and its images)
gets its HTML page, homepage card, board entry, feed and sitemap generated.

It is idempotent: when everything is already up to date it changes nothing, so
publishing from the local admin (which commits the generated files itself)
keeps working exactly as before.

Rules:
- every content/inbox/*.md with ``title`` and ``date`` in its front matter is published
- a homepage card whose posts/<slug>.html no longer exists is removed
- a post page that has no Markdown source is left alone
"""
from __future__ import annotations

import re
from pathlib import Path

import publish_md
import rebuild_blog_pages


ROOT = Path(__file__).resolve().parents[1]
INBOX_DIR = ROOT / "content" / "inbox"

SLUG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def warn(message: str) -> None:
    # "::warning::" makes the message show up on the workflow run page.
    print(f"::warning::{message}")


def publishable_posts() -> list[tuple[Path, publish_md.Post]]:
    posts: list[tuple[Path, publish_md.Post]] = []
    seen: dict[str, Path] = {}
    for path in sorted(INBOX_DIR.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        name = path.relative_to(ROOT).as_posix()
        meta, _ = publish_md.read_markdown(path)
        if not meta.get("title") or not meta.get("date"):
            warn(f"{name}: skipped, front matter needs both title and date")
            continue
        if not DATE_PATTERN.match(meta["date"]):
            warn(f"{name}: skipped, date must look like 2026-05-09")
            continue
        try:
            post = publish_md.build_post(path, copy_images=True)
        except SystemExit as error:
            warn(f"{name}: skipped, {error}")
            continue
        if not SLUG_PATTERN.match(post.slug):
            warn(f"{name}: skipped, slug may only contain letters, digits, - and _")
            continue
        if post.slug in seen:
            warn(f"{name}: skipped, slug '{post.slug}' is already used by {seen[post.slug].name}")
            continue
        seen[post.slug] = path
        posts.append((path, post))
    # Oldest first: new cards are inserted at the top, so the newest ends up first.
    posts.sort(key=lambda item: (item[1].date, item[1].slug))
    return posts


def remove_orphan_cards() -> list[str]:
    removed: list[str] = []
    for info in rebuild_blog_pages.parse_posts():
        if not (ROOT / info.href).exists():
            publish_md.remove_from_index(info.slug)
            removed.append(info.slug)
    return removed


def main() -> int:
    posts = publishable_posts()
    publish_md.POSTS_DIR.mkdir(parents=True, exist_ok=True)
    for _, post in posts:
        # rebuild_all() below turns this standalone page into the full article page.
        (publish_md.POSTS_DIR / f"{post.slug}.html").write_text(publish_md.render_article(post), encoding="utf-8")
        publish_md.update_index(post)
    removed = remove_orphan_cards()
    rebuild_blog_pages.rebuild_all()

    print(f"Synced {len(posts)} posts from content/inbox.")
    if removed:
        print("Removed cards without a page: " + ", ".join(removed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
