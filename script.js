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

  // 点击照片放大，左右切换
  const photos = [...document.querySelectorAll(".zoomable, .article-body .article-photo img")];
  if (photos.length) {
    let box = null;
    let current = 0;
    let lastFocus = null;

    const close = () => {
      if (!box) return;
      box.remove();
      box = null;
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };

    const show = (index) => {
      current = (index + photos.length) % photos.length;
      const photo = photos[current];
      const figure = photo.closest("figure");
      const caption = figure && figure.querySelector("figcaption");
      box.querySelector("img").src = photo.currentSrc || photo.src;
      box.querySelector("img").alt = photo.alt;
      box.querySelector(".lightbox-caption").textContent =
        (caption ? caption.textContent : "") + (photos.length > 1 ? `　${current + 1} / ${photos.length}` : "");
    };

    const open = (index) => {
      lastFocus = document.activeElement;
      box = document.createElement("div");
      box.className = "lightbox";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "查看照片");
      if (photos.length === 1) box.dataset.single = "";
      box.innerHTML =
        '<img alt=""><p class="lightbox-caption"></p>' +
        '<button class="lightbox-close" type="button" aria-label="关闭">×</button>' +
        '<button class="lightbox-prev" type="button" aria-label="上一张">‹</button>' +
        '<button class="lightbox-next" type="button" aria-label="下一张">›</button>';
      box.addEventListener("click", (event) => {
        if (event.target.closest(".lightbox-prev")) show(current - 1);
        else if (event.target.closest(".lightbox-next")) show(current + 1);
        else close();
      });
      document.body.append(box);
      document.body.style.overflow = "hidden";
      show(index);
      box.querySelector(".lightbox-close").focus();
    };

    photos.forEach((photo, index) => {
      photo.tabIndex = 0;
      photo.setAttribute("role", "button");
      photo.setAttribute("aria-label", `${photo.alt || "照片"}，点击放大`);
      photo.addEventListener("click", () => open(index));
      photo.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(index);
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if (!box) return;
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft") show(current - 1);
      else if (event.key === "ArrowRight") show(current + 1);
    });
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
