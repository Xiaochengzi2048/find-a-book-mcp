#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const axios = require("axios");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE_URL = "https://libgen.li";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL,
};

// LibGen returns 25 results per server page; we show 5 per display page
const LIBGEN_PAGE_SIZE = 25;
const DISPLAY_PAGE_SIZE = 5;

const server = new McpServer({ name: "libgen", version: "1.1.0" });

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

async function searchLibGen(query, displayPage = 1, extensions = []) {
  // Map display page → LibGen server page
  const libgenPage = Math.ceil(displayPage / (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE));
  const startIdx = ((displayPage - 1) % (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE)) * DISPLAY_PAGE_SIZE;

  let url = `${BASE_URL}/index.php?req=${encodeURIComponent(query)}&res=${LIBGEN_PAGE_SIZE}&covers=0&gmode=on&filesuns=all&page=${libgenPage}`;
  if (extensions.length > 0) {
    url += `&ext=${extensions.map(e => e.toLowerCase()).join("+")}`;
  }

  const resp = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  const dom = new JSDOM(resp.data);

  // Extract total pages from paginator JS: new Paginator("id", totalPages, 25, currentPage, ...)
  const paginatorMatch = resp.data.match(/new Paginator\("[^"]+",\s*(\d+),\s*(\d+),\s*(\d+)/);
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

  const books = allBooks.slice(startIdx, startIdx + DISPLAY_PAGE_SIZE);

  // Total display pages = totalPages libgen pages × 5 display pages each
  const totalDisplayPages = totalPages * (LIBGEN_PAGE_SIZE / DISPLAY_PAGE_SIZE);
  const hasMore = displayPage < totalDisplayPages;
  // Approximate total: exact on single page, estimated on multi-page
  const totalCount = totalPages === 1 ? allBooks.length : totalPages * LIBGEN_PAGE_SIZE;

  return {
    books,
    displayPage,
    totalDisplayPages: totalPages > 1 ? totalDisplayPages : 1,
    totalCount,
    hasMore,
    hasPrev: displayPage > 1,
  };
}

async function downloadBook(md5) {
  const adsResp = await axios.get(`${BASE_URL}/ads.php?md5=${md5}`, {
    headers: HEADERS,
    timeout: 15000,
  });

  const keyMatch = adsResp.data.match(/get\.php\?md5=[A-Fa-f0-9]+&key=([A-Z0-9]+)/i);
  if (!keyMatch) throw new Error("Could not extract download key from ads page");
  const key = keyMatch[1];

  const dlResp = await axios.get(`${BASE_URL}/get.php?md5=${md5}&key=${key}`, {
    headers: HEADERS,
    responseType: "arraybuffer",
    timeout: 60000,
    maxRedirects: 5,
  });

  const combined = (dlResp.headers["content-type"] || "") + " " + (dlResp.headers["content-disposition"] || "");
  const extPatterns = [
    [/\.azw3/i, "azw3"], [/\.mobi/i, "mobi"], [/\.epub/i, "epub"],
    [/\.pdf/i, "pdf"],   [/\.fb2/i,  "fb2"],  [/\.djvu/i, "djvu"],
    [/\.doc\b/i, "doc"], [/\.txt/i,  "txt"],
  ];

  let ext = "epub";
  for (const [pattern, e] of extPatterns) {
    if (pattern.test(combined)) { ext = e; break; }
  }

  return { buffer: Buffer.from(dlResp.data), ext };
}

async function downloadBookWithRetry(md5, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await downloadBook(md5);
    } catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
    }
  }
  throw lastError;
}

server.tool(
  "search_books",
  "Search for books on Library Genesis. Returns 5 results per display page (with hasMore/hasPrev for pagination). Each book includes title, author, year, language, format, size, size_bytes, and MD5.",
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
  "Download a book from LibGen by MD5 hash. Retries up to 3 times on failure. Returns local file path, size_bytes, and extension.",
  {
    md5: z.string().describe("MD5 hash of the book from search results"),
    title: z.string().optional().describe("Book title (used for filename)"),
  },
  async ({ md5, title }) => {
    const { buffer, ext } = await downloadBookWithRetry(md5.toUpperCase());

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
