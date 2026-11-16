# 写作与发布流程

## 日常使用方式

当你想发一篇新博客时，可以先准备三类素材：

- 一段原始文字：想法、流水账、旅行路线、游戏感受都可以。
- 照片或截图：放到 `assets/uploads/<文章英文名>/`，或者先写清楚图片文件名和说明。
- 发布倾向：想放到 `日记`、`旅行`、`游戏`，或者让 Codex 帮你判断。

## 在网页上写（最省事）

点网站左上角「浅梦」旁边的小锁进入管理页，用 GitHub 令牌登录（步骤见 `README.md`），点“写新文章”。发布后等 1–2 分钟网站自动更新。手机上也能用。

`content/inbox/` 里的每个 Markdown（需要有 `title` 和 `date`）就是一篇已发布的文章：每次部署都会按 Markdown 重新生成对应的文章页，所以要改文章请改 Markdown，不要直接改 `posts/` 里的 HTML。

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

- [x] 任务列表会显示成勾选框
- [ ] 还没做的事
```

支持的 `category`：

- `essay`：日记
- `travel`：旅行
- `game`：游戏

每个板块有自己的版式和专属字段（在网页管理页里选了板块就会出现对应的输入框，不用手写）：

| 板块 | 版式 | 专属字段 |
| --- | --- | --- |
| `essay` 日记 | 窄栏衬线正文，显示星期；列表里只有日期和标题 | 无（标题、日期、正文即可） |
| `travel` 旅行 | 封面图变成顶部大图；连续的照片自动排成照片墙，点击放大 | `place` 地点、`cover` 封面图 |
| `game` 游戏 | 文章开头是“省流版”：游戏名、平台、时长、评价、优缺点 | `game` 游戏名、`platform` 平台、`hours` 游玩时长、`verdict` 评价（`buy` 建议购买 / `free` 建议不花钱时再玩 / `skip` 不建议游玩）、`pros` 优点、`cons` 缺点（多条用 `|` 隔开） |

照片墙的写法：把几张图片连着写（中间可以空行，但不要夹文字）：

```markdown
![湖边的早晨](assets/uploads/my-trip/1.jpg)
![骑行路上](assets/uploads/my-trip/2.jpg)
![傍晚](assets/uploads/my-trip/3.jpg)
```

常用可选字段：

- `cover`：封面图路径，例如 `cover.jpg` 或 `assets/uploads/2026-05-09-my-post/cover.jpg`。显示在文章标题处（旅行是顶部大图），也用作首页卡片和分享时的配图
- `cover_alt`：封面图替代文本
- `cover_caption`：封面图说明
- `timeline`：首页时间线文案，不写就使用 `summary`
- `album: true`：把封面图同步加到首页照片墙
- `album_class: tall` 或 `wide`：照片墙里的图片样式

## 本地发布后台

双击项目根目录里的 `start-blog-admin.bat`，或者在终端运行：

```powershell
cd /d D:\qianmeng-blog
python scripts\blog_admin.py
```

后台会打开：

```text
http://127.0.0.1:4173/
```

日常流程：

1. 在后台点“新建并打开”，系统会在 `content/inbox/` 创建 Markdown。
2. Typora 打开后，正常写日记并保存。
3. 回到后台页面，点击“发布到 GitHub”。
4. 后台会自动转换 HTML、更新首页、刷新板块页和文章导航、创建 Git commit、推送到 GitHub Pages。

发布命令：

```powershell
cd /d D:\qianmeng-blog
python scripts\publish_md.py content\inbox\2026-05-09-my-post.md
```

这个命令会生成 `posts/<slug>.html`，并更新 `index.html` 的文章列表和时间线，同时刷新 `boards/` 下的板块页、文章页上一篇/下一篇、`feed.xml` 和 `sitemap.xml`。如果文章已存在，需要覆盖时加 `--force`；重新发布时改过的标题、摘要、板块会同步到首页和全站。

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
