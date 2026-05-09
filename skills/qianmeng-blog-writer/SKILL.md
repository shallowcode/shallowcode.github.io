---
name: qianmeng-blog-writer
description: Use when turning 浅梦's notes, photos, travel memories, game screenshots, or personal reflections into reviewed blog drafts and then publishing them into the D:\qianmeng-blog static site after user approval.
---

# 浅梦博客写作流程

Use this skill for the `D:\qianmeng-blog` project when the user wants to create, revise, review, or publish a blog post from notes and images.

## Site Model

- Home page: `index.html`
- Styles: `styles.css`
- Published posts: `posts/`
- Raw inputs: `content/inbox/`
- Drafts for review: `content/drafts/`
- User images: `assets/uploads/<slug>/`
- Post template: `templates/post-template.html`

Sections:

- `essay`: 感悟与随笔
- `travel`: 旅行与照片
- `game`: 游戏与记录

## Workflow

1. Gather the user's text, intended board, date, photos, and review notes.
2. If the board is unclear, infer it conservatively and say why.
3. Create a review draft first. Do not publish without explicit approval.
4. Draft output must include title, slug, board, summary, home-card text, timeline text, photo captions, and body.
5. After approval, create `posts/<slug>.html` from `templates/post-template.html`.
6. Update `index.html`:
   - add a card in `#posts` with `data-category` set to `essay`, `travel`, or `game`
   - add a matching item in `#timeline`
   - add photo-wall entries in `#album` only when useful
7. Verify links with a local preview or HTTP check.

## Writing Rules

- Write in natural Chinese, like a private personal blog.
- Keep concrete details from the user; do not invent private events.
- Use uncertainty for images when needed, such as “这张图适合放在开头”.
- Remove sensitive details before publishing.
- Preserve the user's tone over polished generic prose.

## Review Gate

Before touching `posts/` or `index.html`, ask for or wait for clear approval such as:

- “可以发布”
- “发布到旅行板块”
- “这版就用”

If the user only asks for a draft, write the draft to `content/drafts/` or show it in chat.
