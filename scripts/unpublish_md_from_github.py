from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import publish_md
import rebuild_blog_pages


ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit(f"Error: {message}")


def rel(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT.resolve())).replace("\\", "/")


def ensure_inside_root(path: Path) -> Path:
    resolved = path.resolve()
    root = ROOT.resolve()
    if resolved != root and root not in resolved.parents:
        fail(f"unsafe path outside project: {resolved}")
    return resolved


def run_git(args: list[str], capture: bool = True, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
        check=check,
    )


def git_output(args: list[str]) -> str:
    return run_git(args).stdout.strip()


def current_branch() -> str:
    branch = git_output(["branch", "--show-current"])
    if not branch:
        fail("could not determine current Git branch.")
    return branch


def resolve_slug(md_path: Path, override: str | None) -> str:
    if override:
        return override
    if md_path.exists():
        try:
            return publish_md.build_post(md_path, copy_images=False).slug
        except SystemExit:
            meta, _ = publish_md.read_markdown(md_path)
            if meta.get("slug"):
                return meta["slug"]
    return md_path.stem


def resolve_title(md_path: Path, slug: str) -> str:
    if md_path.exists():
        try:
            return publish_md.build_post(md_path, copy_images=False).title
        except SystemExit:
            meta, markdown = publish_md.read_markdown(md_path)
            return meta.get("title") or publish_md.first_heading(markdown) or slug
    return slug


def stage_if_present(rel_path: str) -> None:
    full = ROOT / rel_path
    tracked = bool(run_git(["ls-files", "--", rel_path]).stdout.strip())
    if full.exists() or tracked:
        run_git(["add", "-A", "--", rel_path], capture=False)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Remove one post from the static blog and push the deletion to GitHub."
    )
    parser.add_argument("markdown", help="Path to the Markdown file, usually content/inbox/<slug>.md")
    parser.add_argument("--slug", help="Override the slug to remove (defaults to the slug derived from the Markdown)")
    parser.add_argument("--keep-markdown", action="store_true", help="Keep the source Markdown draft instead of deleting it")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow unrelated dirty files to exist before removing")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be removed without changing files")
    parser.add_argument("--message", "-m", help="Git commit message. Defaults to 'Delete post: <title>'")
    parser.add_argument("--remote", default="origin", help="Git remote to push to. Default: origin")
    parser.add_argument("--branch", help="Git branch to push. Default: current branch")
    parser.add_argument("--no-push", action="store_true", help="Commit locally but do not push")
    args = parser.parse_args()

    md_path = Path(args.markdown)
    if not md_path.is_absolute():
        md_path = ROOT / md_path
    md_path = ensure_inside_root(md_path)

    if not md_path.exists() and not args.slug:
        fail(f"markdown file not found: {md_path}. Pass --slug to remove a published post anyway.")

    slug = resolve_slug(md_path, args.slug)
    post_path = publish_md.POSTS_DIR / f"{slug}.html"
    uploads_dir = publish_md.UPLOADS_DIR / slug
    branch = args.branch or current_branch()
    title = resolve_title(md_path, slug)
    commit_message = args.message or f"Delete post: {title}"

    if args.dry_run:
        print(f"Slug: {slug}")
        print(f"Markdown: {rel(md_path)} ({'keep' if args.keep_markdown else 'delete'})")
        print(f"Post: {rel(post_path)} ({'exists' if post_path.exists() else 'missing'})")
        print(f"Uploads: {rel(uploads_dir)} ({'exists' if uploads_dir.exists() else 'missing'})")
        print(f"Commit: {commit_message}")
        print(f"Push: {'(skipped)' if args.no_push else args.remote + ' ' + branch}")
        return 0

    # 1. Remove the post's entries from index.html (card, timeline, album, latest panel).
    publish_md.remove_from_index(slug)

    # 2. Delete the generated post HTML.
    if post_path.exists():
        post_path.unlink()

    # 3. Delete uploaded images that belonged to this post.
    if uploads_dir.exists():
        shutil.rmtree(uploads_dir)

    # 4. Delete the source Markdown unless told to keep it.
    if md_path.exists() and not args.keep_markdown:
        md_path.unlink()

    # 5. Rebuild board + article pages from the updated index.
    rebuild_blog_pages.rebuild_all()

    # 6. Stage every path that may have changed (modifications and deletions).
    for rel_path in ["index.html", "posts", "boards", "content/inbox", rel(uploads_dir)]:
        stage_if_present(rel_path)

    diff_check = run_git(["diff", "--cached", "--quiet"], check=False)
    if diff_check.returncode == 0:
        fail("nothing changed, so there is nothing to commit.")

    run_git(["commit", "-m", commit_message], capture=False)
    if args.no_push:
        print(f"Removed locally (not pushed): posts/{slug}.html")
        return 0

    run_git(["push", "-u", args.remote, branch], capture=False)
    print(f"Removed and pushed: posts/{slug}.html")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
    except KeyboardInterrupt:
        raise SystemExit(130)
