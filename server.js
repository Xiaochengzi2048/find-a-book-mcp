#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Mirrors tried in order for both search and download
const SEARCH_MIRRORS = [
  { base: "https://libgen.li", searchPath: "/index.php" },
  { base: "https://libgen.rs", searchPath: "/search.php" },
  { base: "https://libgen.st", searchPath: "/search.php" },
];

const DOWNLOAD_MIRRORS = [
  "https://libgen.li",
  "https://libgen.rs",
  "https://libgen.st",
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// LibGen returns 25 results per server page; we show 5 per display page
const LIBGEN_PAGE_SIZE = 25;
const DISPLAY_PAGE_SIZE = 5;

const server = new McpServer({ name: "libgen", version: "1.2.0" });

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

async function tryMirrors(mirrors, fn) {
  let lastError;
  for (const mirror of mirrors) {
    try {
      return await fn(mirror);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
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

  const { allBooks, totalPages } = await tryMirrors(
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

function detectExt(headers) {
  const combined = (headers["content-type"] || "") + " " + (headers["content-disposition"] || "");
  for (const [pattern, e] of EXT_PATTERNS) {
    if (pattern.test(combined)) return e;
  }
  return "epub";
}

async function downloadFromMirror(base, md5) {
  const adsResp = await axios.get(`${base}/ads.php?md5=${md5}`, {
    headers: { ...HEADERS, Referer: base },
    timeout: 15000,
  });

  const keyMatch = adsResp.data.match(/get\.php\?md5=[A-Fa-f0-9]+&key=([A-Z0-9]+)/i);
  if (!keyMatch) throw new Error(`${base}: could not extract download key`);
  const key = keyMatch[1];

  const dlResp = await axios.get(`${base}/get.php?md5=${md5}&key=${key}`, {
    headers: { ...HEADERS, Referer: base },
    responseType: "arraybuffer",
    timeout: 60000,
    maxRedirects: 5,
  });

  return { buffer: Buffer.from(dlResp.data), ext: detectExt(dlResp.headers) };
}

async function downloadFromLibraryLol(md5) {
  const pageResp = await axios.get(`https://library.lol/main/${md5}`, {
    headers: HEADERS,
    timeout: 15000,
  });
  const dom = new JSDOM(pageResp.data);
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
  // Try standard mirrors first, then library.lol as last resort
  const allAttempts = [
    ...DOWNLOAD_MIRRORS.map(base => () => downloadFromMirror(base, md5)),
    () => downloadFromLibraryLol(md5),
  ];

  let lastError;
  for (const attempt of allAttempts) {
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

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
  },
  async ({ md5, title }) => {
    const { buffer, ext } = await downloadBook(md5.toUpperCase());

    const safeName = (title || md5).replace(/[^\w一-鿿\s\-]/g, "").trim().slice(0, 60) || md5;
    const filename = `${safeName}_${Date.now()}.${ext}`;
    const filePath = path.join(os.tmpdir(), filename);

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
