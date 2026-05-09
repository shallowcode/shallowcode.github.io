from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import publish_md


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


def status_paths() -> list[str]:
    output = run_git(["status", "--porcelain=v1"]).stdout.rstrip("\n")
    paths: list[str] = []
    for line in output.splitlines():
        if not line:
            continue
        value = line[3:].strip()
        if " -> " in value:
            old_path, new_path = value.split(" -> ", 1)
            paths.extend([old_path.strip('"'), new_path.strip('"')])
        else:
            paths.append(value.strip('"'))
    return paths


def local_markdown_assets(md_path: Path, markdown: str, meta: dict[str, str]) -> set[Path]:
    raw_targets = []
    if meta.get("cover"):
        raw_targets.append(meta["cover"])
    raw_targets.extend(match.group(1) for match in re.finditer(r"!\[[^\]]*]\(([^)]+)\)", markdown))

    assets: set[Path] = set()
    for raw in raw_targets:
        src, _ = publish_md.parse_link_target(raw)
        parsed = urlparse(src)
        if parsed.scheme or src.startswith("/") or src.startswith("../"):
            continue
        if src.replace("\\", "/").startswith("assets/"):
            candidate = ROOT / src
        else:
            candidate = md_path.parent / src
        if candidate.exists() and candidate.is_file():
            try:
                assets.add(ensure_inside_root(candidate))
            except SystemExit:
                continue
    return assets


def dirty_paths_not_allowed(allowed_files: set[str], allowed_prefixes: set[str]) -> list[str]:
    blocked = []
    for path in status_paths():
        normalized = path.replace("\\", "/")
        if normalized in allowed_files:
            continue
        if any(normalized == prefix.rstrip("/") or normalized.startswith(prefix.rstrip("/") + "/") for prefix in allowed_prefixes):
            continue
        blocked.append(normalized)
    return blocked


def current_branch() -> str:
    branch = git_output(["branch", "--show-current"])
    if not branch:
        fail("could not determine current Git branch.")
    return branch


def stage_existing(paths: list[Path]) -> None:
    existing = []
    for path in paths:
        if path.exists():
            existing.append(rel(path))
    if existing:
        run_git(["add", "--", *existing], capture=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish one Markdown post and push it to GitHub.")
    parser.add_argument("markdown", help="Path to a Markdown file, usually content/inbox/<slug>.md")
    parser.add_argument("--force", action="store_true", help="Overwrite posts/<slug>.html if it exists")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow unrelated dirty files to exist before publishing")
    parser.add_argument("--dry-run", action="store_true", help="Show the planned publish/commit/push steps without changing files")
    parser.add_argument("--message", "-m", help="Git commit message. Defaults to 'Publish post: <title>'")
    parser.add_argument("--remote", default="origin", help="Git remote to push to. Default: origin")
    parser.add_argument("--branch", help="Git branch to push. Default: current branch")
    args = parser.parse_args()

    md_path = Path(args.markdown)
    if not md_path.is_absolute():
        md_path = ROOT / md_path
    md_path = ensure_inside_root(md_path)
    if not md_path.exists():
        fail(f"markdown file not found: {md_path}")

    meta, markdown = publish_md.read_markdown(md_path)
    preview_post = publish_md.build_post(md_path, copy_images=False)
    post_path = publish_md.POSTS_DIR / f"{preview_post.slug}.html"
    upload_dir = publish_md.UPLOADS_DIR / preview_post.slug
    source_assets = local_markdown_assets(md_path, markdown, meta)
    branch = args.branch or current_branch()
    commit_message = args.message or f"Publish post: {preview_post.title}"

    if post_path.exists() and not args.force:
        fail(f"{rel(post_path)} already exists. Use --force to overwrite.")

    allowed_files = {rel(md_path), *(rel(path) for path in source_assets)}
    allowed_prefixes = {f"assets/uploads/{preview_post.slug}"}
    blocked = []
    if not args.allow_dirty:
        blocked = dirty_paths_not_allowed(allowed_files, allowed_prefixes)

    if args.dry_run:
        print(f"Markdown: {rel(md_path)}")
        print(f"Post: {rel(post_path)}")
        print(f"Uploads: {rel(upload_dir)}")
        print(f"Commit: {commit_message}")
        print(f"Push: {args.remote} {branch}")
        if blocked:
            print("\nWarning: an actual publish would stop because the worktree has unrelated changes:")
            for path in blocked:
                print(f"  {path}")
        return 0

    if blocked:
        print("Refusing to publish because the worktree has unrelated changes:")
        for path in blocked:
            print(f"  {path}")
        print("\nCommit/stash those changes first, or rerun with --allow-dirty if you really want to include nearby changes.")
        return 2

    post = publish_md.build_post(md_path, copy_images=True)
    post_path.write_text(publish_md.render_article(post), encoding="utf-8")
    publish_md.update_index(post)

    stage_paths = [md_path, post_path, publish_md.INDEX_PATH, upload_dir, *source_assets]
    stage_existing(stage_paths)

    diff_check = run_git(["diff", "--cached", "--quiet"], check=False)
    if diff_check.returncode == 0:
        fail("nothing changed, so there is nothing to commit.")

    run_git(["commit", "-m", commit_message], capture=False)
    run_git(["push", "-u", args.remote, branch], capture=False)

    print(f"Published and pushed: posts/{post.slug}.html")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
    except KeyboardInterrupt:
        raise SystemExit(130)
