const adminKey = window.localStorage.getItem("admin_key") || "";

function fmtPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

async function callApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (adminKey) headers["x-admin-key"] = adminKey;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

function renderBadQueries(items) {
  const body = document.getElementById("badQueriesBody");
  body.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    const selectedTags = Array.isArray(item.selected_tag_names) ? item.selected_tag_names.join(", ") : "";
    tr.innerHTML = `
      <td>${item.id}</td>
      <td>${item.query || item.normalized_query}</td>
      <td>${selectedTags || "-"}</td>
      <td>${item.result_count}</td>
      <td>${item.count_80_plus}</td>
      <td>${item.is_ignored ? "yes" : "no"}</td>
      <td class="actions"></td>
    `;
    const actions = tr.querySelector(".actions");
    const ignoreBtn = document.createElement("button");
    ignoreBtn.textContent = "Ignore";
    ignoreBtn.onclick = async () => {
      await callApi(`/api/admin/bad-queries/${item.id}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual_mvp", ignoredBy: "admin" }),
      });
      await loadPage();
    };
    const unignoreBtn = document.createElement("button");
    unignoreBtn.textContent = "Unignore";
    unignoreBtn.onclick = async () => {
      await callApi(`/api/admin/bad-queries/${item.id}/unignore`, { method: "POST" });
      await loadPage();
    };
    actions.appendChild(ignoreBtn);
    actions.appendChild(unignoreBtn);
    body.appendChild(tr);
  }
}

function renderErrors(items) {
  const body = document.getElementById("errorsBody");
  body.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.id}</td>
      <td>${item.route}</td>
      <td>${item.status_code}</td>
      <td>${item.message}</td>
      <td>${new Date(item.ts).toLocaleString()}</td>
    `;
    body.appendChild(tr);
  }
}

async function loadPage() {
  const summary = await callApi("/api/metrics/summary");
  const badQueries = await callApi("/api/admin/bad-queries");
  const apiErrors = await callApi("/api/admin/errors");

  document.getElementById("conversion").textContent = fmtPercent(summary.conversion);
  document.getElementById("emptyCount").textContent = String(
    Number(summary.searchQuality.emptyCount || 0)
  );
  document.getElementById("poorRate").textContent = fmtPercent(summary.searchQuality.poorRate);
  document.getElementById("successfulSearches").textContent = String(
    Number(summary.searchQuality.successfulSearches || 0)
  );
  renderBadQueries(badQueries);
  renderErrors(apiErrors);
}

loadPage().catch((error) => {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<p style="color:red;">Не удалось загрузить метрики: ${error.message}</p>`
  );
});
