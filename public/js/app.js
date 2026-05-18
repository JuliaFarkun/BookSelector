const els = {
  form: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  resetBtn: document.getElementById("reset-btn"),
  categoryFiltersInclude: document.getElementById("category-filters-include"),
  categoryFiltersExclude: document.getElementById("category-filters-exclude"),
  filterSummaries: document.getElementById("filter-summaries"),
  filterSummariesWrap: document.getElementById("filter-summaries-wrap"),
  bookGrid: document.getElementById("book-grid"),
  resultsCount: document.getElementById("results-count"),
  status: document.getElementById("status"),
  bookModal: document.getElementById("book-modal"),
  bookModalTitle: document.getElementById("book-modal-title"),
  bookModalAuthor: document.getElementById("book-modal-author"),
  bookModalScore: document.getElementById("book-modal-score"),
  bookModalTags: document.getElementById("book-modal-tags"),
  bookModalDesc: document.getElementById("book-modal-desc"),
  bookModalDownload: document.getElementById("book-modal-download"),
};

const sessionId = `s_${crypto.randomUUID()}`;
let catalog = { books: [], categories: [], tags: [] };
let currentBooks = [];
const tagNameById = new Map();
const categoryViews = [];
const categoryExcludeViews = [];

function allCategoryDropdownViews() {
  return [...categoryViews, ...categoryExcludeViews];
}

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
  const excludedTagIds = categoryExcludeViews.flatMap((view) =>
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
    .filter((x) => {
      if (!excludedTagIds.length) return true;
      const bookTagIds = x.book.tagIds || [];
      return !excludedTagIds.some((exId) => bookTagIds.includes(exId));
    })
    .sort((a, b) => b.score - a.score || b.textScore - a.textScore);

  return {
    ranked,
    query: q,
    selectedTagIds,
    excludedTagIds,
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
    article.className = "card card--clickable";
    article.innerHTML = `
      <h3 class="card__title"></h3>
      <p class="card__author"></p>
      <p class="card__year"></p>
      <p class="card__desc"></p>
      <div class="card__meta"></div>
      <div class="card__actions">
        <button type="button" class="btn btn--ghost card__more">Подробнее</button>
      </div>
    `;
    article.querySelector(".card__title").textContent = b.title;
    article.querySelector(".card__author").textContent = b.author;
    article.querySelector(".card__year").textContent = `Релевантность: ${(item.score * 100).toFixed(0)}%`;
    const desc = article.querySelector(".card__desc");
    desc.textContent = b.description || "Описание пока не добавлено.";
    if (!b.description) desc.classList.add("card__desc--empty");
    const meta = article.querySelector(".card__meta");
    for (const t of b.tags || []) {
      const span = document.createElement("span");
      span.className = "pill pill--tag";
      span.textContent = t;
      meta.appendChild(span);
    }

    const openDetail = () => openBookModal(b, item.score);
    article.addEventListener("click", (e) => {
      if (e.target.closest(".card__more")) return;
      openDetail();
    });
    article.querySelector(".card__more").addEventListener("click", (e) => {
      e.stopPropagation();
      openDetail();
    });

    els.bookGrid.appendChild(article);
  }
}

function openBookModal(book, score) {
  els.bookModalTitle.textContent = book.title;
  els.bookModalAuthor.textContent = book.author;
  els.bookModalScore.textContent = `Релевантность: ${(score * 100).toFixed(0)}%`;

  els.bookModalTags.innerHTML = "";
  for (const t of book.tags || []) {
    const span = document.createElement("span");
    span.className = "pill pill--tag";
    span.textContent = t;
    els.bookModalTags.appendChild(span);
  }

  els.bookModalDesc.textContent = book.description || "Описание пока не добавлено.";

  els.bookModalDownload.href = book.downloadUrl || "#";
  els.bookModalDownload.onclick = () => {
    sendMetric("download_click", { bookId: book.id, title: book.title });
  };

  els.bookModal.hidden = false;
  document.body.classList.add("modal-open");
  els.bookModal.querySelector(".book-modal__close")?.focus();
}

function closeBookModal() {
  els.bookModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function appendSummaryChips(container, names, kind) {
  if (!names.length) {
    const empty = document.createElement("span");
    empty.className = "filter-summary-empty";
    empty.textContent = "—";
    container.appendChild(empty);
    return;
  }
  for (const name of names) {
    const chip = document.createElement("span");
    chip.className = `filter-summary-chip filter-summary-chip--${kind}`;
    chip.textContent = name;
    container.appendChild(chip);
  }
}

function updateSummaries() {
  els.filterSummaries.innerHTML = "";
  const frag = document.createDocumentFragment();
  let hasAnySelection = false;

  for (const category of catalog.categories || []) {
    const incView = categoryViews.find((v) => v.categoryId === category.id);
    const excView = categoryExcludeViews.find((v) => v.categoryId === category.id);
    if (!incView || !excView) continue;

    const includeNames = getChecked(incView.panel).map(
      (id) => tagNameById.get(Number(id)) || `Тег ${id}`
    );
    const excludeNames = getChecked(excView.panel).map(
      (id) => tagNameById.get(Number(id)) || `Тег ${id}`
    );

    if (!includeNames.length && !excludeNames.length) continue;
    hasAnySelection = true;

    const card = document.createElement("article");
    card.className = "filter-summary-card";

    const title = document.createElement("h4");
    title.className = "filter-summary-card__title";
    title.textContent = category.name;
    card.appendChild(title);

    const includeRow = document.createElement("div");
    includeRow.className = "filter-summary-row filter-summary-row--include";
    const includeLabel = document.createElement("span");
    includeLabel.className = "filter-summary-row__label";
    includeLabel.textContent = "Нужны";
    const includeChips = document.createElement("div");
    includeChips.className = "filter-summary-chips";
    appendSummaryChips(includeChips, includeNames, "include");
    includeRow.appendChild(includeLabel);
    includeRow.appendChild(includeChips);
    card.appendChild(includeRow);

    const excludeRow = document.createElement("div");
    excludeRow.className = "filter-summary-row filter-summary-row--exclude";
    const excludeLabel = document.createElement("span");
    excludeLabel.className = "filter-summary-row__label";
    excludeLabel.textContent = "Без";
    const excludeChips = document.createElement("div");
    excludeChips.className = "filter-summary-chips";
    appendSummaryChips(excludeChips, excludeNames, "exclude");
    excludeRow.appendChild(excludeLabel);
    excludeRow.appendChild(excludeChips);
    card.appendChild(excludeRow);

    frag.appendChild(card);
  }

  els.filterSummariesWrap.hidden = !hasAnySelection;
  if (hasAnySelection) {
    els.filterSummaries.appendChild(frag);
  }
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
  updateCrossPanelLocks();
  if (trackMetric) {
    sendMetric("search_quality", {
      query: result.query,
      selectedTagIds: result.selectedTagIds,
      excludedTagIds: result.excludedTagIds,
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
  allCategoryDropdownViews().forEach((view) => closeDropdown(view));
}

function updateCrossPanelLocks() {
  const includeSelected = new Set(
    categoryViews.flatMap((view) => getChecked(view.panel).map((x) => Number(x)))
  );
  const excludeSelected = new Set(
    categoryExcludeViews.flatMap((view) => getChecked(view.panel).map((x) => Number(x)))
  );
  for (const view of categoryViews) {
    for (const cb of view.panel.querySelectorAll('input[type="checkbox"]')) {
      const id = Number(cb.value);
      const blocked = excludeSelected.has(id);
      cb.disabled = blocked;
      cb.closest(".check-row")?.classList.toggle("check-row--blocked", blocked);
    }
  }
  for (const view of categoryExcludeViews) {
    for (const cb of view.panel.querySelectorAll('input[type="checkbox"]')) {
      const id = Number(cb.value);
      const blocked = includeSelected.has(id);
      cb.disabled = blocked;
      cb.closest(".check-row")?.classList.toggle("check-row--blocked", blocked);
    }
  }
}

function onFilterCheckboxChange() {
  updateSummaries();
  updateCrossPanelLocks();
}

function buildCategoryDropdown(category, checkboxPrefix) {
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
    checkboxPrefix,
    onFilterCheckboxChange
  );

  const view = { categoryId: category.id, name: category.name, toggle, panel };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown(view);
  });
  panel.addEventListener("click", (e) => e.stopPropagation());

  wrapper.appendChild(toggle);
  wrapper.appendChild(panel);
  return { view, wrapper };
}

function renderCategoryFilters() {
  els.categoryFiltersInclude.innerHTML = "";
  els.categoryFiltersExclude.innerHTML = "";
  categoryViews.length = 0;
  categoryExcludeViews.length = 0;

  for (const category of catalog.categories || []) {
    const { view: incView, wrapper: incWrap } = buildCategoryDropdown(
      category,
      `tag-inc-${category.id}`
    );
    categoryViews.push(incView);
    els.categoryFiltersInclude.appendChild(incWrap);

    const { view: excView, wrapper: excWrap } = buildCategoryDropdown(
      category,
      `tag-exc-${category.id}`
    );
    categoryExcludeViews.push(excView);
    els.categoryFiltersExclude.appendChild(excWrap);
  }

  updateCrossPanelLocks();
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
  allCategoryDropdownViews().forEach((view) => {
    view.panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
  });
  closeAllDropdowns();
  updateCrossPanelLocks();
  applySearch({ trackMetric: true });
});

els.bookModal.querySelectorAll("[data-modal-close]").forEach((el) => {
  el.addEventListener("click", closeBookModal);
});

document.addEventListener("click", () => {
  closeAllDropdowns();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllDropdowns();
    if (!els.bookModal.hidden) closeBookModal();
  }
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
  if (!categoryViews.length || !categoryExcludeViews.length) {
    els.status.textContent =
      "Фильтры категорий не загружены. Перезапустите сервер, чтобы применились последние изменения API.";
  }
  if (!catalog.books.length) {
    els.status.textContent = "Каталог пуст в подключенной базе.";
    return;
  }

  await sendMetric("entry");
  applySearch({ trackMetric: false });
}

init();
