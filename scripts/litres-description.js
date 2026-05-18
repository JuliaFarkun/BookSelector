function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractLitresDescription(html) {
  const aboutIdx = html.indexOf("О книге");
  if (aboutIdx !== -1) {
    const section = html.slice(aboutIdx, aboutIdx + 12000);
    const paragraphs = [...section.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    const text = paragraphs
      .map((match) => stripTags(match[1]))
      .filter((part) => part.length > 40)
      .join("\n\n")
      .trim();
    if (text.length >= 120) return text;
  }

  const og = html.match(/property="og:description"\s+content="([^"]+)"/i);
  if (og) {
    const text = stripTags(og[1]);
    if (text.length >= 80) return text;
  }

  return null;
}

async function fetchLitresDescription(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0; +https://github.com/JuliaFarkun/BookSelector)",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const html = await response.text();
  const description = extractLitresDescription(html);
  if (!description) {
    throw new Error(`Description not found for ${url}`);
  }
  return description;
}

function normalizeForMatch(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function scoreSearchResult(title, author, candidateTitle) {
  const t = normalizeForMatch(title);
  const a = normalizeForMatch(author);
  const c = normalizeForMatch(candidateTitle);
  let score = 0;
  if (c.includes(t) || t.split(" ").filter((w) => w.length > 3).some((w) => c.includes(w))) {
    score += 2;
  }
  if (a && c.includes(a.split(" ").pop())) score += 2;
  if (/(роман|повесть|рассказ|книга|фэнтези|детектив)/u.test(c)) score += 1;
  return score;
}

async function fetchOpenLibraryDescription(title, author) {
  const attempts = [
    `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=5`,
    `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=5`,
  ];

  for (const searchUrl of attempts) {
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0)" },
    });
    if (!searchRes.ok) continue;
    const search = await searchRes.json();
    const docs = (search.docs || []).slice().sort((a, b) => {
      const sa = scoreSearchResult(title, author, a.title || "");
      const sb = scoreSearchResult(title, author, b.title || "");
      return sb - sa;
    });

    for (const doc of docs) {
      if (!doc?.key) continue;
      const workRes = await fetch(`https://openlibrary.org${doc.key}.json`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0)" },
      });
      if (!workRes.ok) continue;
      const work = await workRes.json();
      const raw = work.description;
      const text = typeof raw === "string" ? raw : raw?.value;
      if (text && text.length >= 80) return stripTags(text);
      const sentence = doc.first_sentence;
      const s = Array.isArray(sentence) ? sentence.join(" ") : sentence;
      if (s && s.length >= 80) return stripTags(s);
    }
  }

  return null;
}

function wikiSearchQueries(title, author) {
  const lastName = author.trim().split(/\s+/).pop() || "";
  const queries = [
    `${title} ${author}`.trim(),
    title,
    lastName ? `${title} ${lastName}` : "",
    `${title} роман`,
    `${title} книга`,
  ];
  return [...new Set(queries.filter(Boolean))];
}

async function fetchWikipediaDescription(title, author, lang = "ru") {
  const seen = new Set();

  for (const query of wikiSearchQueries(title, author)) {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=8&utf8=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0)" },
    });
    if (!searchRes.ok) continue;

    const search = await searchRes.json();
    const hits = search.query?.search || [];
    const ranked = hits
      .map((hit) => ({
        hit,
        score: scoreSearchResult(title, author, hit.title || ""),
      }))
      .sort((a, b) => b.score - a.score);

    for (const { hit, score } of ranked) {
      if (score < 0) continue;
      const pageTitle = hit.title;
      if (seen.has(pageTitle)) continue;
      seen.add(pageTitle);

      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0)" },
      });
      if (!summaryRes.ok) continue;
      const summary = await summaryRes.json();
      const text = stripTags(summary.extract || "");
      if (text.length >= 80) return text;
    }
  }

  return null;
}

async function fetchGoogleBooksDescription(title, author) {
  const queries = [
    `intitle:"${title}" inauthor:"${author}"`,
    `intitle:"${title}"`,
    `${title} ${author}`,
  ];

  for (const q of queries) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&langRestrict=ru`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BookSelector/1.0)" },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const items = (data.items || []).slice().sort((a, b) => {
      const ta = a.volumeInfo?.title || "";
      const tb = b.volumeInfo?.title || "";
      return scoreSearchResult(title, author, tb) - scoreSearchResult(title, author, ta);
    });

    for (const item of items) {
      const info = item.volumeInfo || {};
      const text = stripTags(info.description || "");
      if (text.length >= 80) return text;
    }
  }

  return null;
}

async function fetchBookDescription({ title, author, downloadUrl }) {
  const wiki =
    (await fetchWikipediaDescription(title, author, "ru")) ||
    (await fetchWikipediaDescription(title, author, "en"));
  if (wiki) return { description: wiki, source: "wikipedia.org" };

  const ol = await fetchOpenLibraryDescription(title, author);
  if (ol) return { description: ol, source: "openlibrary.org" };

  const google = await fetchGoogleBooksDescription(title, author);
  if (google) return { description: google, source: "books.google.com" };

  if (downloadUrl?.includes("litres.ru")) {
    try {
      return { description: await fetchLitresDescription(downloadUrl), source: downloadUrl };
    } catch {
      // fallback exhausted
    }
  }

  throw new Error(`Description not found for «${title}»`);
}

module.exports = {
  decodeHtml,
  stripTags,
  extractLitresDescription,
  fetchLitresDescription,
  fetchOpenLibraryDescription,
  fetchWikipediaDescription,
  fetchGoogleBooksDescription,
  fetchBookDescription,
};
