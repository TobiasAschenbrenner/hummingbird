const filterButtons = document.querySelectorAll("[data-filter]");
const articleCards = document.querySelectorAll("[data-category]");
const emptyFilterMessage = document.querySelector("[data-filter-empty]");

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    const category = button.dataset.filter;
    let visibleCount = 0;
    for (const article of articleCards) {
      article.hidden =
        category !== "all" && article.dataset.category !== category;
      if (!article.hidden) visibleCount += 1;
    }
    for (const filter of filterButtons) {
      const selected = filter === button;
      filter.classList.toggle("active-filter", selected);
      filter.setAttribute("aria-pressed", String(selected));
    }
    emptyFilterMessage.hidden = visibleCount > 0 || articleCards.length === 0;
  });
}
