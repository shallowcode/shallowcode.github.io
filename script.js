(() => {
  const root = document.documentElement;
  const THEME_KEY = "theme";
  const THEME_COLORS = { light: "#f7f1e4", dark: "#1b1713" };
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  const storedTheme = () => {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };

  const toggle = document.querySelector(".theme-toggle");
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    if (themeMeta) themeMeta.content = THEME_COLORS[theme];
    if (toggle) {
      const label = theme === "dark" ? "切换到浅色模式" : "切换到深色模式";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
  };

  // 没有手动选择过时跟随系统；手动选择后记住选择。
  applyTheme(storedTheme() || (systemDark.matches ? "dark" : "light"));

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* 隐私模式下无法保存，只在本次访问生效 */
      }
      applyTheme(next);
    });
  }

  systemDark.addEventListener("change", (event) => {
    if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
  });

  // 管理员：登录过的设备上，品牌旁的入口显示为“管理”，文章页多一个“编辑本文”
  const adminLink = document.querySelector(".admin-link");
  let isAdmin = false;
  try {
    isAdmin = Boolean(localStorage.getItem("qm_admin_token") || sessionStorage.getItem("qm_admin_token"));
  } catch {
    isAdmin = false;
  }
  if (isAdmin && adminLink) {
    root.dataset.admin = "1";
    adminLink.setAttribute("aria-label", "进入管理后台");
    adminLink.title = "进入管理后台";
    const article = document.querySelector(".article-body[data-slug]");
    const meta = document.querySelector(".article-meta");
    if (article && meta) {
      const editLink = document.createElement("a");
      editLink.className = "edit-link";
      editLink.href = `${adminLink.getAttribute("href")}#/edit/${encodeURIComponent(article.dataset.slug)}`;
      editLink.textContent = "编辑本文";
      meta.append(" · ", editLink);
    }
  }

  // 顶部阅读进度条
  const progressBar = document.querySelector(".progress-bar");
  if (progressBar) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const maxScroll = root.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? Math.min(window.scrollY / maxScroll, 1) : 0;
      progressBar.style.transform = `scaleX(${progress})`;
    };
    const requestUpdate = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
  }
})();
