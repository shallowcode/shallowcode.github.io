const progressBar = document.querySelector(".progress-bar");
const filterButtons = document.querySelectorAll(".filter-button");
const postCards = document.querySelectorAll(".post-card");
const navLinks = document.querySelectorAll(".nav-links a");
const sections = [...document.querySelectorAll("main section[id]")];

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
    const isActive = !!current && link.hash === `#${current.id}`;
    link.classList.toggle("active", isActive);
  });
};

updateScrollState();
window.addEventListener("scroll", updateScrollState, { passive: true });
