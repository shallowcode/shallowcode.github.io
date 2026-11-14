# 浅梦的个人博客

项目位置：`D:\qianmeng-blog`

这是一个可直接部署到 GitHub Pages 的静态个人博客，主页采用“推荐阅读 + 时间线 + 板块入口”的结构，支持深色模式（默认跟随系统，右上角可手动切换）。当前预设了三个板块：

- 感悟与随笔
- 旅行与照片
- 游戏与记录

项目线上只保留静态博客本体；本地额外提供一个发布后台，用来把 Markdown 日记转换成 HTML 并推送到 GitHub Pages。

## 发布到 GitHub Pages

1. 在 GitHub 新建仓库：`YOUR_GITHUB_USERNAME.github.io`
2. 把 `D:\qianmeng-blog` 作为这个仓库的根目录提交：

```bash
cd /d D:\qianmeng-blog
git init
git branch -M main
git add .
git commit -m "Launch personal blog"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_GITHUB_USERNAME.github.io.git
git push -u origin main
```

3. 打开仓库的 `Settings` -> `Pages`，把发布来源设为 `GitHub Actions`。
4. 等待 `Deploy GitHub Pages` 工作流完成，博客地址就是：

```text
https://YOUR_GITHUB_USERNAME.github.io
```

GitHub 官方说明：[创建 GitHub Pages 站点](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)，[使用自定义 workflow 发布 Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 个性化位置

- `index.html`：首页。文章卡片、时间线、板块篇数都在 `<!-- XXX_START -->` / `<!-- XXX_END -->` 标记之间，由脚本自动生成，不要手改标记里面的内容。
- `scripts/rebuild_blog_pages.py`：板块页、文章页的页头/导航/页脚、`sitemap.xml`、`feed.xml` 都由它生成。改了这里的模板后运行 `python scripts\rebuild_blog_pages.py` 即可全站刷新。站点地址 `SITE_URL` 也在这个文件开头。
- `posts/`：新增或修改文章页面，按现有 HTML 文件复制一份再改标题和正文即可。
- `templates/post-template.html`：新文章的 HTML 模板。
- `assets/uploads/`：可以放自己的旅行照片、游戏截图和封面图。
- `styles.css`：调整颜色、布局和移动端样式。浅色配色在 `:root`，深色配色在 `:root[data-theme="dark"]`。
- `favicon.svg`：浏览器标签页图标。

## 项目说明

- 完整目录说明：`docs/PROJECT_GUIDE.md`
- 写作发布流程：`docs/CONTENT_WORKFLOW.md`
- 大模型写作提示词：`prompts/blog-writer-prompt.md`
- 项目内写作 skill：`skills/qianmeng-blog-writer/SKILL.md`
- 新文章模板：`templates/post-template.html`

## 网页端管理（管理员模式）

每个页面左上角「浅梦」旁边有一把小锁，点它进入 `admin/` 管理页。登录后可以直接在网页上：

- 写新文章、编辑和删除已有文章（支持插入图片，大图会自动压缩）
- 浏览、修改、新建、上传、删除网站里的任何文件

### 登录：第一次用令牌，之后用密码

这个网站是纯静态的、没有服务器，能修改网站的“钥匙”只能是 GitHub 的访问令牌。令牌只需要准备一次：

1. 打开 <https://github.com/settings/personal-access-tokens/new>（细粒度令牌）。
2. Repository access 选 **Only select repositories**，只勾选这个仓库。
3. Repository permissions 里把 **Contents** 设为 **Read and write**，其他不用动。
4. 生成后把 `github_pat_` 开头的字符串粘贴到登录框，**同时在下面填一个登录密码**，点登录。

之后在任何设备上，点小锁、输入密码就能登录。管理页的“密码”页可以更换或取消密码。

密码是怎么起作用的：令牌会用你的密码加密（PBKDF2 + AES-GCM），保存成 `admin/credential.json`；登录时在浏览器里用密码解开。密码本身不会出现在仓库里。需要知道的是：

- 这个加密文件是公开的，别人可以下载下来不限次数地猜密码，所以**密码要够长、不要用名字加数字这类容易猜的组合**。
- 登录页连续输错 5 次会锁定 5 分钟，之后每多错一次锁定时间翻倍（最长 24 小时）。锁定记在浏览器里，只能挡住在登录页上乱试的人，挡不住离线猜测。
- 更换密码不会让旧密码失效（旧文件还在仓库历史里）。担心泄露时，要到 GitHub 把令牌删掉重建，再重新设置密码。
- 令牌过期后密码登录会失效，用新令牌登录一次并重新设置密码即可。

工作方式：管理页只把 Markdown 和图片提交到仓库；提交后 GitHub Actions 运行 `scripts/sync_site.py`，生成文章页、首页卡片、板块页、RSS 等，再把生成结果提交回仓库并部署。所以保存后要等 1–2 分钟才会在网站上看到。

注意：网页端提交之后，本地仓库要先 `git pull` 再用本地发布后台，否则推送会被拒绝。

## 写文章

推荐使用本地发布后台：

```powershell
cd /d D:\qianmeng-blog
start-blog-admin.bat
```

启动后会打开本地页面 `http://127.0.0.1:4173/`。你可以在 Typora 里编辑 `content/inbox/` 下的 Markdown，保存后回到这个页面点击“发布到 GitHub”。

## 删除文章

在发布后台每篇文章卡片右下角点“删除”，会先弹出确认再执行：

- 已发布的文章：从 `index.html`、板块页和 `posts/` 中移除，删掉对应的 Markdown 和图片，然后自动提交并推送到 GitHub，线上站点随之更新。
- 未发布的草稿：只删除本地的 Markdown（及它的图片），不动 GitHub。

命令行等价操作：`python scripts\unpublish_md_from_github.py content\inbox\<slug>.md`（加 `--keep-markdown` 可只下线、保留本地草稿；加 `--no-push` 只在本地提交不推送）。

也可以走命令行流程：

1. 复制 `templates/post-template.html` 到 `posts/<slug>.html`。
2. 修改标题、日期、板块、摘要和正文。
3. 如有图片，放到 `assets/uploads/<slug>/` 并在文章里引用。
4. 在 `index.html` 的 `<!-- POST_CARDS_START -->` 后面加一张文章卡片，然后运行 `python scripts\rebuild_blog_pages.py`，时间线、板块页、文章导航、`sitemap.xml` 和 `feed.xml` 会自动更新。
5. 本地打开 `index.html` 和新文章页面检查链接与排版。
