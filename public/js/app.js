const els = {
  form: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  resetBtn: document.getElementById("reset-btn"),
  categoryFilters: document.getElementById("category-filters"),
  filterSummaries: document.getElementById("filter-summaries"),
  bookGrid: document.getElementById("book-grid"),
  resultsCount: document.getElementById("results-count"),
  status: document.getElementById("status"),
};

const sessionId = `s_${crypto.randomUUID()}`;
let catalog = { books: [], categories: [], tags: [] };
let currentBooks = [];
const tagNameById = new Map();
const categoryViews = [];

function slug(s) {
  return s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "x";
}

function populateCheckboxPanel(panel, items, prefix, onChange) {
  panel.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const labelText = item.label;
    const value = String(item.value);
    const id = `${prefix}-${slug(value)}`;
    const label = document.createElement("label");
    label.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = prefix;
    input.value = value;
    input.id = id;
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(input);
    label.appendChild(span);
    frag.appendChild(label);
    input.addEventListener("change", onChange);
  }
  panel.appendChild(frag);
}

function getChecked(panel) {
  return [...panel.querySelectorAll('input[type="checkbox"]:checked')].map(
    (cb) => cb.value
  );
}

function matchesQuery(book, q) {
  if (!q) return true;
  const hay = `${book.title} ${book.author} ${book.description || ""}`.toLowerCase();
  return hay.includes(q);
}

function tokenize(s) {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(Boolean);
}

function overlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let common = 0;
  for (const t of aSet) {
    if (bSet.has(t)) common += 1;
  }
  return common / Math.max(aSet.size, bSet.size);
}

function rankBooks() {
  const q = els.searchInput.value.trim().toLowerCase();
  const queryTokens = tokenize(q);
  const selectedTagIds = categoryViews.flatMap((view) =>
    getChecked(view.panel).map((x) => Number(x))
  );

  const ranked = catalog.books
    .map((b) => {
      const text = `${b.title} ${b.author} ${b.description || ""}`;
      const textTokens = tokenize(text);
      const textScore = q
        ? overlapScore(queryTokens, textTokens) + (matchesQuery(b, q) ? 0.25 : 0)
        : 0;
      const tagScore = selectedTagIds.length
        ? selectedTagIds.filter((t) => (b.tagIds || []).includes(t)).length / selectedTagIds.length
        : 1;

      return { book: b, score: tagScore, textScore };
    })
    .filter((x) => !q || x.textScore > 0)
    .sort((a, b) => b.score - a.score || b.textScore - a.textScore);

  return {
    ranked,
    query: q,
    selectedTagIds,
  };
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function renderBooks(rankedBooks) {
  els.bookGrid.innerHTML = "";
  for (const item of rankedBooks) {
    const b = item.book;
    const article = document.createElement("article");
    article.className = "card";
    article.innerHTML = `
      <h3 class="card__title"></h3>
      <p class="card__author"></p>
      <p class="card__year"></p>
      <p class="card__desc"></p>
      <div class="card__meta"></div>
      <div class="card__actions"></div>
    `;
    article.querySelector(".card__title").textContent = b.title;
    article.querySelector(".card__author").textContent = b.author;
    article.querySelector(".card__year").textContent = `Релевантность: ${(item.score * 100).toFixed(0)}%`;
    article.querySelector(".card__desc").textContent = b.description || "";
    const meta = article.querySelector(".card__meta");
    for (const t of b.tags || []) {
      const span = document.createElement("span");
      span.className = "pill pill--tag";
      span.textContent = t;
      meta.appendChild(span);
    }

    const actions = article.querySelector(".card__actions");
    const downloadBtn = document.createElement("a");
    downloadBtn.className = "btn btn--primary card__download";
    downloadBtn.target = "_blank";
    downloadBtn.rel = "noopener noreferrer";
    downloadBtn.textContent = "Скачать";
    downloadBtn.href = b.downloadUrl || "#";
    downloadBtn.addEventListener("click", () => {
      sendMetric("download_click", { bookId: b.id, title: b.title });
    });
    actions.appendChild(downloadBtn);

    els.bookGrid.appendChild(article);
  }
}

function updateSummaries() {
  els.filterSummaries.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const view of categoryViews) {
    const selectedTagNames = getChecked(view.panel).map(
      (id) => tagNameById.get(Number(id)) || `Тег ${id}`
    );
    const p = document.createElement("p");
    p.className = "filter-summary";
    p.textContent =
      selectedTagNames.length === 0
        ? `${view.name}: ничего не выбрано`
        : `${view.name}: выбрано — ${selectedTagNames.join(", ")}.`;
    frag.appendChild(p);
  }
  els.filterSummaries.appendChild(frag);
}

function applySearch(options = {}) {
  const trackMetric = options.trackMetric !== false;
  els.status.textContent = "";
  const result = rankBooks();
  currentBooks = result.ranked;
  const count80Plus = currentBooks.filter((item) => item.score >= 0.8).length;
  renderBooks(currentBooks);
  els.resultsCount.textContent =
    currentBooks.length === 0
      ? "ничего не найдено"
      : `${currentBooks.length} ${plural(currentBooks.length, "книга", "книги", "книг")}`;
  updateSummaries();
  if (trackMetric) {
    sendMetric("search_quality", {
      query: result.query,
      selectedTagIds: result.selectedTagIds,
      resultCount: currentBooks.length,
      topScore: currentBooks[0]?.score || 0,
      count80Plus,
    });
  }
}

function closeDropdown(view) {
  const { panel, toggle } = view;
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}

function openDropdown(view) {
  const { panel, toggle } = view;
  panel.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
}

function isOpen(view) {
  return !view.panel.hidden;
}

function toggleDropdown(view) {
  const open = isOpen(view);
  closeAllDropdowns();
  if (!open) openDropdown(view);
}

function closeAllDropdowns() {
  categoryViews.forEach((view) => closeDropdown(view));
}

function renderCategoryFilters() {
  els.categoryFilters.innerHTML = "";
  categoryViews.length = 0;

  for (const category of catalog.categories || []) {
    const wrapper = document.createElement("div");
    wrapper.className = "dropdown";
    wrapper.dataset.dropdown = "true";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn--ghost dropdown__toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");
    toggle.innerHTML = `${category.name} <span class="dropdown__chevron" aria-hidden="true">▾</span>`;

    const panel = document.createElement("div");
    panel.className = "dropdown__panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", category.name);
    panel.hidden = true;

    populateCheckboxPanel(
      panel,
      (category.tags || []).map((tag) => ({ value: Number(tag.id), label: tag.name })),
      `tag-${category.id}`,
      updateSummaries
    );

    const view = { categoryId: category.id, name: category.name, toggle, panel };
    categoryViews.push(view);

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown(view);
    });
    panel.addEventListener("click", (e) => e.stopPropagation());

    wrapper.appendChild(toggle);
    wrapper.appendChild(panel);
    els.categoryFilters.appendChild(wrapper);
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMetric("search_submitted", {
    query: els.searchInput.value.trim(),
  });
  applySearch({ trackMetric: true });
});

els.resetBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  categoryViews.forEach((view) => {
    view.panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
  });
  closeAllDropdowns();
  applySearch({ trackMetric: true });
});

document.addEventListener("click", () => {
  closeAllDropdowns();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllDropdowns();
});

async function sendMetric(eventType, payload = {}) {
  try {
    await fetch("/api/metrics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, eventType, payload }),
    });
  } catch {
    // Метрики не должны ломать UX.
  }
}

async function init() {
  const res = await fetch("/api/catalog");
  if (!res.ok) {
    els.status.textContent = "Не удалось загрузить каталог из базы.";
    return;
  }
  catalog = await res.json();
  catalog.tags.forEach((tag) => {
    tagNameById.set(Number(tag.id), tag.name);
  });
  if (!Array.isArray(catalog.categories)) {
    catalog.categories = [];
  }
  if (!catalog.categories.length && Array.isArray(catalog.tags) && catalog.tags.length) {
    // Fallback для старого API без categories: показываем единый список меток.
    catalog.categories = [{ id: "fallback-tags", name: "Метки", tags: catalog.tags }];
  }
  renderCategoryFilters();
  if (!categoryViews.length) {
    els.status.textContent =
      "Фильтры категорий не загружены. Перезапустите сервер, чтобы применились последние изменения API.";
  }
  if (!catalog.books.length) {
    els.status.textContent = "Каталог пуст в подключенной базе.";
    return;
  }

  await sendMetric("entry");
  applySearch({ trackMetric: false });
  updateSummaries();
}

init();
