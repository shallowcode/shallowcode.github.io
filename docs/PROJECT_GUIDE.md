# 浅梦博客项目说明

这个博客位于 `D:\qianmeng-blog`，是一个静态 GitHub Pages 站点，不需要数据库和后台。核心思路是：界面写在 HTML/CSS/JS 里，文章是一个个独立 HTML 文件，照片放到 `assets/` 下。

## 目录怎么读

```text
D:\qianmeng-blog/
  index.html                  # 首页：推荐阅读、时间线、板块入口
  styles.css                  # 所有界面样式：颜色、布局、手机适配
  script.js                   # 深色模式切换、顶部阅读进度条
  favicon.svg                 # 浏览器标签页图标
  feed.xml / sitemap.xml      # RSS 订阅和站点地图，脚本自动生成，不要手改
  robots.txt                  # 搜索引擎抓取规则
  boards/                     # 三个板块页，脚本自动生成
  admin/                      # 网页端管理页（登录、写文章、管理文件），见 README
  scripts/                    # 发布脚本；rebuild_blog_pages.py 负责生成全站页面，
                              # sync_site.py 在部署时把 Markdown 同步成页面
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
- 改深色模式、滚动进度条：编辑 `script.js`
- 改板块页/文章页的页头、导航、页脚：编辑 `scripts/rebuild_blog_pages.py` 里的模板，然后运行 `python scripts\rebuild_blog_pages.py`
- 改网站名字或网址：`index.html`、`404.html`，以及 `scripts/rebuild_blog_pages.py` 开头的 `SITE_NAME` / `SITE_URL`
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

这些目录只是辅助整理，不会自动发布内容。发布请用本地发布后台或 `scripts/publish_md.py`（见 `docs/CONTENT_WORKFLOW.md`）。

## 首页要同步更新哪里

用发布脚本时首页会自动更新。`#posts` 里的文章卡片是全站文章信息（标题、日期、板块、摘要）的唯一来源：

- `#posts`：发布脚本新增或更新文章卡片
- `#timeline`、`#boards` 的篇数、板块页、文章页的侧栏和上一篇/下一篇、`feed.xml`、`sitemap.xml`：都由 `scripts/rebuild_blog_pages.py` 根据文章卡片重新生成

手动改了卡片（比如改标题或摘要）之后，运行一次 `python scripts\rebuild_blog_pages.py` 即可同步到全站。

## 板块约定

目前有三个板块：

- `essay`：日记
- `travel`：旅行
- `game`：游戏

文章卡片里的 `data-category` 要使用这三个值之一，这样文章才会出现在对应的板块页里。
