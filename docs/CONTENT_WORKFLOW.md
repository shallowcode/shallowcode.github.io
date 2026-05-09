# 写作与发布流程

## 日常使用方式

当你想发一篇新博客时，可以先准备三类素材：

- 一段原始文字：想法、流水账、旅行路线、游戏感受都可以。
- 照片或截图：放到 `assets/uploads/<文章英文名>/`，或者先写清楚图片文件名和说明。
- 发布倾向：想放到 `随笔`、`旅行`、`游戏`，或者让 Codex 帮你判断。

## 用 Markdown 写作

新文章可以先写成 Markdown，放在 `content/inbox/`。文件开头用 front matter 写清楚发布信息：

```markdown
---
title: 今天想留下的一点东西
slug: 2026-05-09-my-post
date: 2026-05-09
category: essay
summary: 这是一篇首页摘要，会显示在文章卡片和时间线里。
---

正文第一段。

## 小标题

继续写正文。
```

支持的 `category`：

- `essay`：随笔
- `travel`：旅行
- `game`：游戏

常用可选字段：

- `cover`：封面图路径，例如 `cover.jpg` 或 `assets/uploads/2026-05-09-my-post/cover.jpg`
- `cover_alt`：封面图替代文本
- `cover_caption`：封面图说明
- `timeline`：首页时间线文案，不写就使用 `summary`
- `album: true`：把封面图同步加到首页照片墙
- `album_class: tall` 或 `wide`：照片墙里的图片样式

发布命令：

```powershell
cd /d D:\qianmeng-blog
python scripts\publish_md.py content\inbox\2026-05-09-my-post.md
```

这个命令会生成 `posts/<slug>.html`，并更新 `index.html` 的文章列表和时间线。如果文章已存在，需要覆盖时加 `--force`。

一键发布并推送到 GitHub：

```powershell
cd /d D:\qianmeng-blog
python scripts\publish_md_to_github.py content\inbox\2026-05-09-my-post.md
```

这个命令会完成 Markdown 转 HTML、更新首页、创建 Git commit、推送到 GitHub。默认会检查工作区，发现无关改动时会停止，避免把别的修改一起提交。

常用参数：

- `--dry-run`：只查看将要发布什么，不写文件、不提交
- `--force`：覆盖已经存在的同名文章 HTML
- `-m "Publish post: 标题"`：自定义 commit message
- `--allow-dirty`：允许工作区存在其他改动

发布到 GitHub：

```powershell
git add .
git commit -m "Add post: 今天想留下的一点东西"
git push
```

## 起草

你可以直接手写文章，也可以让 Codex 先出待审稿。

如果让 Codex 帮忙，在当前对话里直接贴素材，或者让它读取 `content/inbox/` 里的素材。可以这样说：

```text
请根据 D:\qianmeng-blog\content\inbox\2026-05-08-seaside-note.md 起草一篇博客。
先给我待审稿，不要发布。板块倾向是旅行。
```

待审稿建议包含：

- 标题
- slug 文件名建议
- 板块
- 摘要
- 首页卡片文案
- 时间线文案
- 照片说明
- 正文

## 审阅后怎么发布

确认稿子后，可以让 Codex 或自己手动完成发布：

```text
这版可以，发布到旅行板块。slug 用 seaside-2026，更新首页最近更新、时间线和照片墙。
```

发布时需要完成这些动作：

1. 从 `templates/post-template.html` 复制结构，生成 `posts/<slug>.html`。
2. 如有本地照片，放在 `assets/uploads/<slug>/`。
3. 更新 `index.html` 中 `#posts` 的文章卡片。
4. 更新 `index.html` 中 `#timeline` 的时间线。
5. 如有适合照片墙的素材，更新 `index.html` 中 `#album`。
6. 本地检查首页和新文章链接。

## 审稿标准

发布前建议检查：

- 标题是否像你会说的话
- 是否误判板块
- 照片说明是否准确
- 有没有把你没说过的细节写得太确定
- 是否包含不适合公开的个人信息
- 日期、文件名、链接是否正确
