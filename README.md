# 浅梦的个人博客

项目位置：`D:\qianmeng-blog`

这是一个可直接部署到 GitHub Pages 的静态个人博客，主页采用“板块 + 文章 + 时间线 + 照片墙”的结构。当前预设了三个板块：

- 感悟与随笔
- 旅行与照片
- 游戏与记录

项目现在只保留静态博客本体，不再包含本地写作提交页面或本地发布服务。

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

- `index.html`：修改姓名、简介、GitHub 链接和联系方式。
- `posts/`：新增或修改文章页面，按现有 HTML 文件复制一份再改标题和正文即可。
- `templates/post-template.html`：新文章的 HTML 模板。
- `assets/uploads/`：可以放自己的旅行照片、游戏截图和封面图。
- `styles.css`：调整颜色、布局和移动端样式。

## 项目说明

- 完整目录说明：`docs/PROJECT_GUIDE.md`
- 写作发布流程：`docs/CONTENT_WORKFLOW.md`
- 大模型写作提示词：`prompts/blog-writer-prompt.md`
- 项目内写作 skill：`skills/qianmeng-blog-writer/SKILL.md`
- 新文章模板：`templates/post-template.html`

## 写文章

新文章走普通静态文件流程：

1. 复制 `templates/post-template.html` 到 `posts/<slug>.html`。
2. 修改标题、日期、板块、摘要和正文。
3. 如有图片，放到 `assets/uploads/<slug>/` 并在文章里引用。
4. 同步更新 `index.html` 的文章列表、时间线，必要时更新照片墙。
5. 本地打开 `index.html` 和新文章页面检查链接与排版。
