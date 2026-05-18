/**
 * Подставляет описания из data/book-descriptions.json в booksmatch_bd.sql
 */
const fs = require("fs");
const path = require("path");

const DUMP_PATH = path.join(__dirname, "../booksmatch_bd.sql");
const CACHE_PATH = path.join(__dirname, "../data/book-descriptions.json");

function escapeCopyField(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
}

function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error("Нет файла кэша:", CACHE_PATH);
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  let dump = fs.readFileSync(DUMP_PATH, "utf8").replace(/\r\n/g, "\n");

  const startMarker = "COPY public.books (id, title, author_id, description, cover_url, download_url, created_at) FROM stdin;\n";
  const endMarker =
    "\n\\.\n\n\n--\n-- TOC entry 5010 (class 0 OID 41515)\n-- Dependencies: 223\n-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres";

  const start = dump.indexOf(startMarker);
  const end = dump.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    console.error("Не найден блок COPY public.books в дампе");
    process.exit(1);
  }

  const header = dump.slice(0, start + startMarker.length);
  const footer = dump.slice(end);
  const body = dump.slice(start + startMarker.length, end);

  const lines = body.split("\n").map((line) => {
    if (!line.trim() || line.startsWith("\\")) return line;
    const parts = line.split("\t");
    if (parts.length < 7) return line;
    const id = parts[0];
    const entry = cache[id];
    if (!entry?.description) return line;
    parts[3] = escapeCopyField(entry.description);
    return parts.join("\t");
  });

  dump = header + lines.join("\n") + footer;
  fs.writeFileSync(DUMP_PATH, dump, "utf8");
  console.log("Дамп обновлён:", DUMP_PATH);
}

main();
