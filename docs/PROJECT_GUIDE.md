# 浅梦博客项目说明

这个博客位于 `D:\qianmeng-blog`，是一个静态 GitHub Pages 站点，不需要数据库和后台。核心思路是：界面写在 HTML/CSS/JS 里，文章是一个个独立 HTML 文件，照片放到 `assets/` 下。

## 目录怎么读

```text
D:\qianmeng-blog/
  index.html                  # 首页：板块、文章列表、时间线、照片墙
  styles.css                  # 所有界面样式：颜色、布局、手机适配
  script.js                   # 主题切换、文章筛选、导航高亮
  posts/                      # 已发布文章，每篇文章一个 HTML 文件
  assets/uploads/             # 你自己的照片、截图、封面图
  content/inbox/              # 可选：原始素材、零散想法、照片说明
  content/drafts/             # 可选：待审稿或中间草稿
  templates/post-template.html # 新文章 HTML 模板
  prompts/blog-writer-prompt.md # 让大模型起草博客的提示词
  skills/qianmeng-blog-writer/  # 项目内博客写作 skill
  docs/                       # 项目说明和发布流程文档
```

## 在哪里改界面

- 改首页结构：编辑 `index.html`
- 改颜色、字体、卡片、时间线、照片墙：编辑 `styles.css`
- 改筛选按钮、深色模式、滚动进度条：编辑 `script.js`
- 改网站名字：通常在 `index.html` 的 `<title>`、导航栏、页脚，以及文章页 `<title>`
- 改照片墙图片：修改 `index.html` 里 `#album` 区域的 `<img src="...">`

## 在哪里写文章

已发布文章放在 `posts/`。每篇文章是一个 HTML 文件，例如：

```text
posts/travel-seaside.html
posts/quiet-evening.html
posts/game-afterthought.html
```

新文章建议先复制 `templates/post-template.html`，改成自己的标题、日期、分类、正文和图片，再放进 `posts/`。

## 素材和草稿放哪里

- 原始文字可以放进 `content/inbox/`，比如 `2026-05-08-seaside-note.md`。
- 待审稿可以放进 `content/drafts/`，确认后再整理成正式文章。
- 照片或游戏截图可以放进 `assets/uploads/<文章英文名>/`。

这些目录只是辅助整理，不会自动发布内容。发布时仍然需要手动生成文章 HTML，并同步更新首页。

## 首页要同步更新哪里

发布一篇文章后，通常更新三处：

- `#posts`：新增一张文章卡片
- `#timeline`：新增一条时间线记录
- `#album`：如果这篇文章有好看的照片，可以新增照片墙条目

## 板块约定

目前有三个板块：

- `essay`：感悟与随笔
- `travel`：旅行与照片
- `game`：游戏与记录

文章卡片里的 `data-category` 要使用这三个值之一，这样首页筛选按钮才能正常工作。
