require("dotenv").config();
const path = require("path");
const express = require("express");
const { pool } = require("./db/pool");

const PORT = Number(process.env.PORT) || 3780;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const app = express();
const BAD_MIN_RESULT_COUNT = 100;
const BAD_MAX_COUNT_80_PLUS = 4;

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  const key = req.get("x-admin-key");
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

function toMetricNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBadSearch(payload = {}) {
  const resultCount = toMetricNumber(payload.resultCount);
  const count80Plus = toMetricNumber(payload.count80Plus);
  if (resultCount === 0) return true;
  return resultCount > BAD_MIN_RESULT_COUNT && count80Plus <= BAD_MAX_COUNT_80_PLUS;
}

function hasSearchIntent(payload = {}) {
  const query = String(payload.query || "").trim();
  const selectedTagIds = Array.isArray(payload.selectedTagIds) ? payload.selectedTagIds : [];
  const excludedTagIds = Array.isArray(payload.excludedTagIds) ? payload.excludedTagIds : [];
  return Boolean(query) || selectedTagIds.length > 0 || excludedTagIds.length > 0;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", requireAdmin, express.static(path.join(__dirname, "admin")));

app.get("/api/catalog", async (_req, res, next) => {
  try {
    const booksQuery = await pool.query(
      `SELECT b.id, b.title, a.name AS author, b.description, b.cover_url, b.download_url,
              COALESCE(json_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL), '[]') AS tag_ids,
              COALESCE(json_agg(DISTINCT t.name) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
       FROM books b
       JOIN authors a ON a.id = b.author_id
       LEFT JOIN book_tags bt ON bt.book_id = b.id
       LEFT JOIN tags t ON t.id = bt.tag_id
       GROUP BY b.id, a.name
       ORDER BY b.title ASC`
    );
    const tagsQuery = await pool.query(
      `SELECT t.id, t.name, t.category_id
       FROM tags t
       ORDER BY t.name ASC`
    );
    const categoriesQuery = await pool.query(
      `SELECT c.id, c.name, t.id AS tag_id, t.name AS tag_name
       FROM categories c
       LEFT JOIN tags t ON t.category_id = c.id
       ORDER BY c.name ASC, t.name ASC`
    );

    const books = booksQuery.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      author: row.author,
      description: row.description || "",
      coverUrl: row.cover_url || "",
      downloadUrl: row.download_url || "",
      tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map((x) => Number(x)) : [],
      tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    }));
    const tags = tagsQuery.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      categoryId: Number(row.category_id),
    }));
    const categoriesById = new Map();
    for (const row of categoriesQuery.rows) {
      const id = Number(row.id);
      if (!categoriesById.has(id)) {
        categoriesById.set(id, { id, name: row.name, tags: [] });
      }
      if (row.tag_id) {
        categoriesById.get(id).tags.push({ id: Number(row.tag_id), name: row.tag_name });
      }
    }

    return res.json({
      books,
      tags,
      categories: [...categoriesById.values()],
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/metrics/event", async (req, res, next) => {
  const { sessionId, eventType, payload = {} } = req.body || {};
  if (!sessionId || typeof eventType !== "string") {
    return res.status(400).json({ error: "sessionId and eventType are required." });
  }

  try {
    await pool.query(
      `INSERT INTO sessions (id, started_at, last_seen_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [sessionId]
    );
    const isSearchQualityEvent = eventType === "search_quality";
    const shouldPersistEvent = eventType !== "search_submitted" && !isSearchQualityEvent;

    if (shouldPersistEvent) {
      await pool.query(
        `INSERT INTO events (session_id, event_type, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [sessionId, eventType, JSON.stringify(payload || {})]
      );
    }

    if (isSearchQualityEvent) {
      if (!hasSearchIntent(payload)) {
        return res.json({ ok: true });
      }
      const query = String(payload.query || "").trim();

      const badSearch = isBadSearch(payload);

      if (!badSearch) {
        await pool.query(
          `INSERT INTO metric_counters (key, value)
           VALUES ('successful_searches', 1)
           ON CONFLICT (key) DO UPDATE SET value = metric_counters.value + 1`
        );
      }

      if (badSearch) {
        await pool.query(
          `INSERT INTO search_quality (
            session_id, query, normalized_query, selected_tag_ids, result_count, top_score, count_80_plus
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            sessionId,
            query,
            String(query).toLowerCase().trim().replace(/\s+/g, " "),
            JSON.stringify(payload.selectedTagIds || []),
            toMetricNumber(payload.resultCount),
            toMetricNumber(payload.topScore),
            toMetricNumber(payload.count80Plus),
          ]
        );
      }
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/metrics/summary", async (_req, res, next) => {
  try {
    const downloadsQuery = await pool.query(
      `SELECT COUNT(*)::INT AS download_clicks
       FROM events
       WHERE event_type = 'download_click'`
    );

    const qualityQuery = await pool.query(
      `SELECT
         COUNT(*)::INT AS total_searches,
         COUNT(*) FILTER (WHERE result_count = 0)::INT AS empty_count,
         COUNT(*) FILTER (WHERE count_80_plus < 5 AND NOT is_ignored)::INT AS poor_count,
         COALESCE(AVG(top_score), 0)::FLOAT AS avg_top_score,
         COALESCE(AVG(result_count), 0)::FLOAT AS avg_result_count
       FROM search_quality`
    );
    const successfulSearchesQuery = await pool.query(
      `SELECT value
       FROM metric_counters
       WHERE key = 'successful_searches'`
    );

    const poorQueriesQuery = await pool.query(
      `SELECT normalized_query, COUNT(*)::INT AS hits, MAX(ts) AS last_seen
       FROM search_quality
       WHERE count_80_plus < 5 AND NOT is_ignored AND normalized_query <> ''
       GROUP BY normalized_query
       ORDER BY hits DESC, last_seen DESC
       LIMIT 50`
    );

    const retentionQuery = await pool.query(
      `WITH session_days AS (
         SELECT id,
                DATE(started_at) AS cohort_day,
                DATE(last_seen_at) AS last_day,
                GREATEST(0, DATE(last_seen_at) - DATE(started_at)) AS day_diff
         FROM sessions
       ),
       grouped AS (
         SELECT cohort_day,
                COUNT(*)::INT AS cohort_size,
                COUNT(*) FILTER (WHERE day_diff >= 1)::INT AS retained_day1plus,
                COUNT(*) FILTER (WHERE day_diff >= 7)::INT AS retained_day7plus
         FROM session_days
         GROUP BY cohort_day
       )
       SELECT cohort_day, cohort_size,
              CASE WHEN cohort_size = 0 THEN 0 ELSE retained_day1plus::FLOAT / cohort_size END AS day1plus,
              CASE WHEN cohort_size = 0 THEN 0 ELSE retained_day7plus::FLOAT / cohort_size END AS day7plus
       FROM grouped
       ORDER BY cohort_day DESC
       LIMIT 14`
    );

    const quality = qualityQuery.rows[0];
    const successfulSearches = Number(successfulSearchesQuery.rows[0]?.value || 0);
    const badSearches = Number(quality.total_searches || 0);
    const totalSearches = successfulSearches + badSearches;
    const downloadClicks = Number(downloadsQuery.rows[0]?.download_clicks || 0);

    return res.json({
      conversion: totalSearches ? downloadClicks / totalSearches : 0,
      totalSessions: totalSearches,
      convertedSessions: downloadClicks,
      searchQuality: {
        emptyCount: Number(quality.empty_count || 0),
        poorRate: totalSearches
          ? Number(quality.poor_count) / totalSearches
          : 0,
        avgTopScore: Number(quality.avg_top_score || 0),
        avgResultCount: Number(quality.avg_result_count || 0),
        poorQueries: poorQueriesQuery.rows,
        successfulSearches,
      },
      rollingRetention: retentionQuery.rows.map((row) => ({
        cohortDate: row.cohort_day,
        cohortSize: Number(row.cohort_size || 0),
        day1plus: Number(row.day1plus || 0),
        day7plus: Number(row.day7plus || 0),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/bad-queries", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, query, normalized_query, selected_tag_ids, result_count, top_score, count_80_plus,
              is_ignored, ignored_reason, ignored_by, ignored_at, ts,
              COALESCE((
                SELECT json_agg(t.name ORDER BY t.name)
                FROM tags t
                WHERE t.id IN (
                  SELECT CAST(value AS BIGINT)
                  FROM jsonb_array_elements_text(search_quality.selected_tag_ids)
                )
              ), '[]'::json) AS selected_tag_names
       FROM search_quality
       WHERE count_80_plus < 5
       ORDER BY ts DESC
       LIMIT 200`
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/errors", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, route, status_code, message, ts
       FROM api_errors
       ORDER BY ts DESC
       LIMIT 100`
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/bad-queries/:id/ignore", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || "manual_moderation");
  const ignoredBy = String(req.body?.ignoredBy || "admin");
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await pool.query(
      `UPDATE search_quality
       SET is_ignored = TRUE, ignored_reason = $2, ignored_by = $3, ignored_at = NOW()
       WHERE id = $1`,
      [id, reason, ignoredBy]
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/bad-queries/:id/unignore", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await pool.query(
      `UPDATE search_quality
       SET is_ignored = FALSE, ignored_reason = NULL, ignored_by = NULL, ignored_at = NULL
       WHERE id = $1`,
      [id]
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use(async (error, req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal server error";
  console.error(error);
  try {
    await pool.query(
      `INSERT INTO api_errors (route, status_code, message, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        `${req.method} ${req.originalUrl}`,
        statusCode,
        message,
        JSON.stringify({
          stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
        }),
      ]
    );
  } catch (dbError) {
    console.error("Failed to persist API error:", dbError);
  }
  res.status(statusCode).json({ error: message });
});

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`Server is running at http://localhost:${PORT}`);
    console.log("Connected to PostgreSQL.");
  } catch (error) {
    console.error("Failed to connect PostgreSQL:", error.message);
  }
});
