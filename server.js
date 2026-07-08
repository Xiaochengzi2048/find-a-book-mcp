#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Mirrors tried in order for both search and download.
// Override at runtime with LIBGEN_MIRRORS (comma-separated base URLs), e.g.
//   LIBGEN_MIRRORS="https://libgen.is,https://libgen.gs"
// LibGen domains rotate often; this lets you swap mirrors without editing code.
// searchPath is inferred per host: libgen.li uses /index.php, others use /search.php.
const DEFAULT_MIRRORS = ["https://libgen.li", "https://libgen.rs", "https://libgen.st"];

function searchPathFor(base) {
  return /libgen\.li\b/.test(base) ? "/index.php" : "/search.php";
}

const MIRROR_BASES = (process.env.LIBGEN_MIRRORS
  ? process.env.LIBGEN_MIRRORS.split(",").map(s => s.trim()).filter(Boolean)
  : DEFAULT_MIRRORS);

const SEARCH_MIRRORS = MIRROR_BASES.map(base => ({ base, searchPath: searchPathFor(base) }));
const DOWNLOAD_MIRRORS = MIRROR_BASES;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// LibGen returns 25 results per server page; we show 5 per display page
const LIBGEN_PAGE_SIZE = 25;
const DISPLAY_PAGE_SIZE = 5;

const server = new McpServer({ name: "libgen", version: "1.7.1" });

// ---- Z-Library client (optional, requires ZLIBRARY_EMAIL + ZLIBRARY_PASSWORD) ----
// Uses the /eapi/ JSON endpoints directly — no Turnstile, no scraping.
// On first use, logs in and caches remix_userid + remix_userkey for the session.
const ZLIB_BASE = "https://1lib.sk";
const ZLIB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const zlibState = {
  loggedIn: false,
  remix_userid: process.env.ZLIBRARY_REMIX_USERID || null,
  remix_userkey: process.env.ZLIBRARY_REMIX_USERKEY || null,
  cookies: null,  // raw cookie string for download endpoint
};

async function zlibEnsureLogin() {
  // Already have tokens (either from env or previous login)
  if (zlibState.remix_userid && zlibState.remix_userkey) {
    zlibState.loggedIn = true;
    return;
  }

  const email = process.env.ZLIBRARY_EMAIL;
  const password = process.env.ZLIBRARY_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Z-Library credentials not configured. Set ZLIBRARY_EMAIL + ZLIBRARY_PASSWORD " +
      "(or ZLIBRARY_REMIX_USERID + ZLIBRARY_REMIX_USERKEY) environment variables."
    );
  }

  const resp = await axios.post(`${ZLIB_BASE}/eapi/user/login`,
    new URLSearchParams({
      isModal: "true", email, password,
      site_mode: "books", action: "login", redirectUrl: "", gg_json_mode: "1"
    }).toString(),
    {
      headers: { "User-Agent": ZLIB_UA, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: s => s < 400,
    }
  );

  if (!resp.data?.success) {
    throw new Error(`Z-Library login failed: ${resp.data?.error || "unknown error"}`);
  }

  const user = resp.data.user;
  zlibState.remix_userid = String(user.id);
  zlibState.remix_userkey = user.remix_userkey;
  // Save cookies for download endpoint (needs Cookie header, not remix- headers)
  const setCookies = resp.headers["set-cookie"] || [];
  zlibState.cookies = setCookies.map(c => c.split(";")[0]).join("; ");
  zlibState.loggedIn = true;
  process.stderr.write(`[zlibrary] Logged in as ${user.email} (id=${user.id})\n`);
}

function zlibHeaders() {
  return {
    "User-Agent": ZLIB_UA,
    "remix-userid": zlibState.remix_userid,
    "remix-userkey": zlibState.remix_userkey,
  };
}

async function zlibSearch(query, { page = 1, limit = 10, extensions = [], yearFrom, yearTo, languages } = {}) {
  await zlibEnsureLogin();

  const body = { message: query, page, limit };
  if (extensions.length > 0) body.extensions = extensions;
  if (yearFrom) body.yearFrom = yearFrom;
  if (yearTo) body.yearTo = yearTo;
  if (languages) body.languages = languages;

  // Build form-encoded body (EAPI uses x-www-form-urlencoded, not JSON)
  const params = new URLSearchParams();
  params.append("message", query);
  params.append("page", String(page));
  params.append("limit", String(limit));
  if (extensions.length > 0) extensions.forEach(e => params.append("extensions[]", e.toLowerCase()));
  if (yearFrom) params.append("yearFrom", String(yearFrom));
  if (yearTo) params.append("yearTo", String(yearTo));
  if (languages) params.append("languages[]", languages);

  const resp = await axios.post(`${ZLIB_BASE}/eapi/book/search`, params.toString(), {
    headers: {
      "User-Agent": ZLIB_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "remix-userid": zlibState.remix_userid,
      "remix-userkey": zlibState.remix_userkey,
    },
    timeout: 20000,
  });

  if (!resp.data?.success) {
    throw new Error(`Z-Library search failed: ${resp.data?.error || "unknown error"}`);
  }

  const books = (resp.data.books || []).map(b => ({
    title: b.title || "",
    author: (b.author || "").trim(),
    year: b.year || "",
    language: b.language || "",
    extension: (b.extension || "").toUpperCase(),
    size: b.filesizeString || "",
    publisher: b.publisher || "",
    isbn: b.isbn || b.isbn10 || "",
    cover: b.cover || null,
    zlibrary_id: b.id,
    zlibrary_hash: b.hash,
  }));

  return {
    books,
    page,
    total: resp.data.total || books.length,
    hasMore: books.length === limit,
  };
}

async function zlibDownload(bookId, bookHash, title) {
  await zlibEnsureLogin();

  // Step 1: get the real download link (requires Cookie auth, not remix- headers)
  const linkResp = await axios.get(`${ZLIB_BASE}/eapi/book/${bookId}/${bookHash}/file`, {
    headers: {
      "User-Agent": ZLIB_UA,
      "Cookie": zlibState.cookies,
    },
    timeout: 15000,
  });

  if (!linkResp.data?.success || !linkResp.data?.file?.downloadLink) {
    throw new Error(`Z-Library get download link failed: ${JSON.stringify(linkResp.data)}`);
  }

  const downloadLink = linkResp.data.file.downloadLink;
  process.stderr.write(`[zlibrary] Downloading from: ${downloadLink}\n`);

  // Step 2: download the actual file
  const resp = await axios.get(downloadLink, {
    headers: { "User-Agent": ZLIB_UA, "Cookie": zlibState.cookies },
    responseType: "arraybuffer",
    timeout: 90000,
    maxRedirects: 5,
  });

  const ext = detectExt(resp.headers);
  return { buffer: Buffer.from(resp.data), ext };
}

function parseSizeBytes(sizeStr) {
  const m = sizeStr.match(/([\d.]+)\s*(kb|mb|gb)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "kb") return Math.round(n * 1024);
  if (unit === "mb") return Math.round(n * 1024 * 1024);
  if (unit === "gb") return Math.round(n * 1024 * 1024 * 1024);
  return 0;
}

async function raceMirrors(mirrors, fn) {
  try {
    return await Promise.any(mirrors.map(mirror => fn(mirror)));
  } catch (e) {
    const errors = e instanceof AggregateError ? e.errors : [e];
    errors.forEach(err => process.stderr.write(`Mirror failed: ${err.message}\n`));
    throw errors[errors.length - 1];
  }
}

async function searchOnMirror(mirror, query, libgenPage, extensions) {
  let url = `${mirror.base}${mirror.searchPath}?req=${encodeURIComponent(query)}&res=${LIBGEN_PAGE_SIZE}&covers=0&gmode=on&filesuns=all&page=${libgenPage}`;
  if (extensions.length > 0) {
    url += `&ext=${extensions.map(e => e.toLowerCase()).join("+")}`;
  }

  const resp = await axios.get(url, {
    headers: { ...HEADERS, Referer: mirror.base },
    timeout: 20000,
  });
  const dom = new JSDOM(resp.data);

  const paginatorMatch = resp.data.match(/new Paginator\("[^"]+",\s*(\d+)/);
  const totalPages = paginatorMatch ? parseInt(paginatorMatch[1]) : 1;

  const allBooks = [];
  for (const row of dom.window.document.querySelectorAll("table tr")) {
    const tds = row.querySelectorAll("td");
    if (tds.length < 8) continue;

    const adsEl = row.querySelector('a[href*="ads.php?md5="]');
    if (!adsEl) continue;
    const md5 = adsEl.getAttribute("href").match(/md5=([A-Fa-f0-9]+)/i)?.[1]?.toUpperCase();
    if (!md5) continue;

    const title = tds[0].querySelector('a[href*="edition.php"]')?.textContent?.trim() || "";
    if (!title) continue;

    const author    = tds[1].textContent.trim();
    const publisher = tds[2].textContent.trim();
    const year      = tds[3].textContent.trim();
    const language  = tds[4]?.textContent?.trim() || "";
    const size      = tds[6].textContent.trim();
    const extension = tds[7].textContent.trim().toUpperCase();

    if (extensions.length > 0 && !extensions.map(e => e.toUpperCase()).includes(extension)) continue;

    allBooks.push({ title, author, publisher, year, language, extension, size, size_bytes: parseSizeBytes(size), md5 });
  }

  return { allBooks, totalPages };
}

async function searchLibGen(query, displayPage = 1, extensions = []) {
  const libgenPage = Math.ceil(displayPage / (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE));
  const startIdx = ((displayPage - 1) % (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE)) * DISPLAY_PAGE_SIZE;

  const { allBooks, totalPages } = await raceMirrors(
    SEARCH_MIRRORS,
    (mirror) => searchOnMirror(mirror, query, libgenPage, extensions)
  );

  const books = allBooks.slice(startIdx, startIdx + DISPLAY_PAGE_SIZE);
  const totalDisplayPages = totalPages > 1 ? totalPages * (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE) : 1;
  const totalCount = totalPages === 1 ? allBooks.length : totalPages * LIBGEN_PAGE_SIZE;

  return {
    books,
    displayPage,
    totalDisplayPages,
    totalCount,
    hasMore: displayPage < totalDisplayPages,
    hasPrev: displayPage > 1,
  };
}

const EXT_PATTERNS = [
  [/\.azw3/i, "azw3"], [/\.mobi/i, "mobi"], [/\.epub/i, "epub"],
  [/\.pdf/i,  "pdf"],  [/\.fb2/i,  "fb2"],  [/\.djvu/i, "djvu"],
  [/\.doc\b/i,"doc"],  [/\.txt/i,  "txt"],
];

// Map common Content-Type values to extensions (content-type has no dot,
// so the .ext patterns above never match it — this table handles that case).
const CONTENT_TYPE_EXT = [
  [/epub\+zip/i, "epub"], [/x-mobipocket/i, "mobi"], [/vnd\.amazon\.ebook/i, "azw3"],
  [/pdf/i, "pdf"], [/x-fictionbook|fb2/i, "fb2"], [/djvu/i, "djvu"],
  [/msword|vnd\.openxmlformats.*wordprocessing/i, "doc"], [/text\/plain/i, "txt"],
];

function detectExt(headers) {
  // 1) Prefer the real extension from the Content-Disposition filename, e.g.
  //    attachment; filename="Some Book.pdf"  ->  "pdf"
  const disp = headers["content-disposition"] || "";
  const fnMatch = disp.match(/filename\*?=(?:UTF-8''|")?[^"';\n]*\.([A-Za-z0-9]{2,5})/i);
  if (fnMatch) {
    const ext = fnMatch[1].toLowerCase();
    if (EXT_PATTERNS.some(([, e]) => e === ext)) return ext;
  }
  // 2) Fall back to matching the .ext pattern anywhere in the disposition string.
  for (const [pattern, e] of EXT_PATTERNS) {
    if (pattern.test(disp)) return e;
  }
  // 3) Fall back to the Content-Type MIME value.
  const ctype = headers["content-type"] || "";
  for (const [pattern, e] of CONTENT_TYPE_EXT) {
    if (pattern.test(ctype)) return e;
  }
  return "epub";
}


async function downloadFromLibraryLol(md5) {
  const pageUrl = `https://library.lol/main/${md5}`;
  const pageResp = await axios.get(pageUrl, {
    headers: HEADERS,
    timeout: 15000,
  });
  const dom = new JSDOM(pageResp.data, { url: pageUrl });
  const dlLink = dom.window.document.querySelector("#download a, h2 a");
  if (!dlLink) throw new Error("library.lol: could not find download link");

  const dlResp = await axios.get(dlLink.href, {
    headers: HEADERS,
    responseType: "arraybuffer",
    timeout: 60000,
    maxRedirects: 5,
  });

  return { buffer: Buffer.from(dlResp.data), ext: detectExt(dlResp.headers) };
}

async function downloadBook(md5) {
  // Race all mirrors concurrently on the cheap ads.php key-fetch, then download from winner.
  // This avoids parallel file downloads that would waste bandwidth.
  let winner;
  try {
    winner = await Promise.any(
      DOWNLOAD_MIRRORS.map(base =>
        axios.get(`${base}/ads.php?md5=${md5}`, {
          headers: { ...HEADERS, Referer: base },
          timeout: 15000,
        }).then(adsResp => {
          const keyMatch = adsResp.data.match(/get\.php\?md5=[A-Fa-f0-9]+&key=([A-Z0-9]+)/i);
          if (!keyMatch) throw new Error(`${base}: could not extract download key`);
          return { base, key: keyMatch[1] };
        })
      )
    );
  } catch {
    // All standard mirrors failed — fall back to library.lol
    return downloadFromLibraryLol(md5);
  }

  try {
    const { base, key } = winner;
    const dlResp = await axios.get(`${base}/get.php?md5=${md5}&key=${key}`, {
      headers: { ...HEADERS, Referer: base },
      responseType: "arraybuffer",
      timeout: 60000,
      maxRedirects: 5,
    });
    return { buffer: Buffer.from(dlResp.data), ext: detectExt(dlResp.headers) };
  } catch {
    // Winner's download failed — fall back to library.lol
    return downloadFromLibraryLol(md5);
  }
}

function normalizeKey(title, author) {
  const t = title.toLowerCase().replace(/[^\w一-鿿]/g, "").slice(0, 30);
  const a = author.toLowerCase().replace(/[^\w一-鿿]/g, "").slice(0, 20);
  return `${t}|${a}`;
}

server.tool(
  "get_formats",
  "Search for a book and return all available formats grouped by unique title+author. Instead of many duplicate rows, each book appears once with a list of formats (EPUB/MOBI/PDF/AZW3 etc.) and their MD5s.",
  {
    query: z.string().describe("Book title, author, or keywords"),
  },
  async ({ query }) => {
    // Fetch up to 3 LibGen pages (75 results) in parallel for comprehensive format coverage
    const pageResults = await Promise.all(
      [1, 2, 3].map(libgenPage =>
        raceMirrors(SEARCH_MIRRORS, (mirror) => searchOnMirror(mirror, query, libgenPage, []))
          .catch(() => ({ allBooks: [], totalPages: 1 }))
      )
    );
    const allBooks = [];
    for (const { allBooks: pageBooks } of pageResults) {
      allBooks.push(...pageBooks);
    }

    // Group by normalized title + author
    const grouped = new Map();
    for (const book of allBooks) {
      const key = normalizeKey(book.title, book.author);
      if (!grouped.has(key)) {
        grouped.set(key, {
          title: book.title,
          author: book.author,
          publisher: book.publisher,
          year: book.year,
          language: book.language,
          formats: new Map(), // extension → best (largest) entry
        });
      }
      const entry = grouped.get(key);
      const existing = entry.formats.get(book.extension);
      if (!existing || book.size_bytes > existing.size_bytes) {
        entry.formats.set(book.extension, {
          extension: book.extension,
          size: book.size,
          size_bytes: book.size_bytes,
          md5: book.md5,
        });
      }
    }

    const result = Array.from(grouped.values()).map(b => ({
      title: b.title,
      author: b.author,
      publisher: b.publisher,
      year: b.year,
      language: b.language,
      formats: Array.from(b.formats.values()).sort((a, z) => a.extension.localeCompare(z.extension)),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "search_books",
  "Search for books on Library Genesis (tries multiple mirrors automatically). Returns 5 results per display page with pagination support. Each book includes title, author, year, language, format, size, size_bytes, and MD5.",
  {
    query: z.string().describe("Book title, author, or keywords"),
    page: z.number().optional().default(1).describe("Display page number (1-indexed, 5 results per page)"),
    extensions: z.array(z.string()).optional().describe("Filter by format, e.g. ['epub', 'pdf']"),
  },
  async ({ query, page, extensions }) => {
    const result = await searchLibGen(query, page || 1, extensions || []);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "download_book",
  "Download a book from LibGen by MD5 hash. Tries multiple mirrors automatically (libgen.li → libgen.rs → libgen.st → library.lol). Returns local file path, size_bytes, and extension.",
  {
    md5: z.string().describe("MD5 hash of the book from search results"),
    title: z.string().optional().describe("Book title (used for filename)"),
    dest_dir: z.string().optional().describe("Destination directory to save the file (defaults to the system temp directory). Created if it does not exist."),
  },
  async ({ md5, title, dest_dir }) => {
    const { buffer, ext } = await downloadBook(md5.toUpperCase());

    const safeName = (title || md5).replace(/[^\w一-鿿\s\-]/g, "").trim().slice(0, 60) || md5;
    const filename = `${safeName}_${Date.now()}.${ext}`;
    const targetDir = dest_dir || os.tmpdir();
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = path.join(targetDir, filename);

    fs.writeFileSync(filePath, buffer);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          file_path: filePath,
          filename,
          size_bytes: buffer.length,
          extension: ext,
        }),
      }],
    };
  }
);

// ---- Open Library metadata (free, no API key) ----
// Resolves clean, authoritative bibliographic metadata so callers can confirm
// the right book (and get a clean title) before searching LibGen, whose scraped
// titles are often noisy ("Summary of ...", pirated re-titles, etc.).
async function lookupMetadata(query, isbn) {
  const OL = "https://openlibrary.org";
  // ISBN path is exact; fall back to full-text search otherwise.
  if (isbn) {
    const clean = isbn.replace(/[^0-9Xx]/g, "");
    const resp = await axios.get(`${OL}/isbn/${clean}.json`, {
      headers: HEADERS, timeout: 15000, maxRedirects: 5,
    });
    const d = resp.data;
    let author = "";
    if (Array.isArray(d.authors) && d.authors[0]?.key) {
      try {
        const a = await axios.get(`${OL}${d.authors[0].key}.json`, { headers: HEADERS, timeout: 10000 });
        author = a.data?.name || "";
      } catch { /* author lookup is best-effort */ }
    }
    return [{
      title: d.title || "",
      author,
      year: (d.publish_date || "").match(/\d{4}/)?.[0] || "",
      publisher: (d.publishers || [])[0] || "",
      isbn: (d.isbn_13 || d.isbn_10 || [clean])[0],
      pages: d.number_of_pages || null,
      cover: d.covers?.[0] ? `https://covers.openlibrary.org/b/id/${d.covers[0]}-M.jpg` : null,
      openlibrary: d.key ? `${OL}${d.key}` : null,
    }];
  }

  const resp = await axios.get(`${OL}/search.json`, {
    headers: HEADERS,
    timeout: 15000,
    params: {
      q: query,
      limit: 5,
      fields: "title,author_name,first_publish_year,publisher,isbn,cover_i,key",
    },
  });
  return (resp.data.docs || []).map(x => ({
    title: x.title || "",
    author: (x.author_name || [])[0] || "",
    year: x.first_publish_year || "",
    publisher: (x.publisher || [])[0] || "",
    isbn: (x.isbn || [])[0] || null,
    cover: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : null,
    openlibrary: x.key ? `${OL}${x.key}` : null,
  }));
}

server.tool(
  "lookup_metadata",
  "Look up authoritative book metadata from Open Library (free, no API key). Use this to confirm the correct title/author/year/ISBN before searching LibGen — LibGen's scraped titles are often noisy. Returns up to 5 candidate matches (or one exact match when an ISBN is given).",
  {
    query: z.string().optional().describe("Book title, author, or keywords"),
    isbn: z.string().optional().describe("ISBN-10 or ISBN-13 for an exact lookup (takes precedence over query)"),
  },
  async ({ query, isbn }) => {
    if (!query && !isbn) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide either 'query' or 'isbn'." }) }] };
    }
    try {
      const results = await lookupMetadata(query, isbn);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Open Library lookup failed: ${e.message}` }) }] };
    }
  }
);

server.tool(
  "search_zlibrary",
  "Search for books on Z-Library (wider coverage than LibGen — novels, Chinese books, recent titles). Requires ZLIBRARY_EMAIL + ZLIBRARY_PASSWORD environment variables (or ZLIBRARY_REMIX_USERID + ZLIBRARY_REMIX_USERKEY). Returns books with zlibrary_id and zlibrary_hash needed for download_zlibrary.",
  {
    query: z.string().describe("Book title, author, or keywords"),
    page: z.number().optional().default(1).describe("Page number (1-indexed, 10 results per page)"),
    extensions: z.array(z.string()).optional().describe("Filter by format, e.g. ['epub', 'pdf']"),
    languages: z.string().optional().describe("Language filter, e.g. 'english' or 'chinese'"),
    year_from: z.number().optional().describe("Published year from"),
    year_to: z.number().optional().describe("Published year to"),
  },
  async ({ query, page, extensions, languages, year_from, year_to }) => {
    try {
      const result = await zlibSearch(query, {
        page: page || 1,
        extensions: extensions || [],
        languages,
        yearFrom: year_from,
        yearTo: year_to,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

server.tool(
  "download_zlibrary",
  "Download a book from Z-Library using zlibrary_id and zlibrary_hash from search_zlibrary results. Requires ZLIBRARY_EMAIL + ZLIBRARY_PASSWORD (or ZLIBRARY_REMIX_USERID + ZLIBRARY_REMIX_USERKEY). Returns local file path, size_bytes, and extension.",
  {
    zlibrary_id: z.string().describe("Book ID from search_zlibrary results"),
    zlibrary_hash: z.string().describe("Book hash from search_zlibrary results"),
    title: z.string().optional().describe("Book title (used for filename)"),
    dest_dir: z.string().optional().describe("Destination directory (defaults to system temp dir)"),
  },
  async ({ zlibrary_id, zlibrary_hash, title, dest_dir }) => {
    try {
      const { buffer, ext } = await zlibDownload(zlibrary_id, zlibrary_hash, title);

      const safeName = (title || zlibrary_id).replace(/[^\w一-鿿\s\-]/g, "").trim().slice(0, 60) || zlibrary_id;
      const filename = `${safeName}_${Date.now()}.${ext}`;
      const targetDir = dest_dir || os.tmpdir();
      fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, filename);

      fs.writeFileSync(filePath, buffer);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            file_path: filePath,
            filename,
            size_bytes: buffer.length,
            extension: ext,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
