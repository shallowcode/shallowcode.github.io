const root = document.documentElement;
const progressBar = document.querySelector(".progress-bar");
const themeToggle = document.querySelector(".theme-toggle");
const filterButtons = document.querySelectorAll(".filter-button");
const postCards = document.querySelectorAll(".post-card");
const navLinks = document.querySelectorAll(".nav-links a");
const sections = [...document.querySelectorAll("main section[id]")];

const savedTheme = localStorage.getItem("blog-theme");
if (savedTheme === "dark" || savedTheme === "light") {
  root.dataset.theme = savedTheme;
}

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = nextTheme;
  localStorage.setItem("blog-theme", nextTheme);
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;

    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");

    postCards.forEach((card) => {
      const shouldShow = filter === "all" || card.dataset.category === filter;
      card.classList.toggle("is-hidden", !shouldShow);
    });
  });
});

const updateScrollState = () => {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }

  const current = sections
    .filter((section) => section.getBoundingClientRect().top <= 120)
    .at(-1);

  navLinks.forEach((link) => {
    link.classList.toggle("active", current && link.hash === `#${current.id}`);
  });
};

updateScrollState();
window.addEventListener("scroll", updateScrollState, { passive: true });
