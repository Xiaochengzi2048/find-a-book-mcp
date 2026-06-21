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

const server = new McpServer({ name: "libgen", version: "1.0.0" });

async function searchLibGen(query, count = 10, extensions = []) {
  let url = `${BASE_URL}/index.php?req=${encodeURIComponent(query)}&res=${count}&covers=0&gmode=on&filesuns=all`;
  if (extensions.length > 0) {
    url += `&ext=${extensions.map(e => e.toLowerCase()).join("+")}`;
  }

  const resp = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  const dom = new JSDOM(resp.data);
  const doc = dom.window.document;
  const rows = doc.querySelectorAll("table tr");
  const books = [];

  for (const row of rows) {
    const tds = row.querySelectorAll("td");
    if (tds.length < 8) continue;

    const adsEl = row.querySelector('a[href*="ads.php?md5="]');
    if (!adsEl) continue;
    const md5 = adsEl.getAttribute("href").match(/md5=([A-Fa-f0-9]+)/i)?.[1]?.toUpperCase();
    if (!md5) continue;

    const title = tds[0].querySelector('a[href*="edition.php"]')?.textContent?.trim() || "";
    if (!title) continue;

    const author = tds[1].textContent.trim();
    const publisher = tds[2].textContent.trim();
    const year = tds[3].textContent.trim();
    const size = tds[6].textContent.trim();
    const extension = tds[7].textContent.trim().toUpperCase();

    if (extensions.length > 0 && !extensions.map(e => e.toUpperCase()).includes(extension)) continue;

    books.push({
      index: books.length + 1,
      title,
      author,
      publisher,
      year,
      extension,
      size,
      md5,
    });

    if (books.length >= count) break;
  }

  return books;
}

async function downloadBook(md5) {
  // Step 1: Get the download key from ads.php
  const adsResp = await axios.get(`${BASE_URL}/ads.php?md5=${md5}`, {
    headers: HEADERS,
    timeout: 15000,
  });

  const keyMatch = adsResp.data.match(/get\.php\?md5=[A-Fa-f0-9]+&key=([A-Z0-9]+)/i);
  if (!keyMatch) throw new Error("Could not extract download key from ads page");

  const key = keyMatch[1];

  // Step 2: Download the file
  const dlResp = await axios.get(`${BASE_URL}/get.php?md5=${md5}&key=${key}`, {
    headers: HEADERS,
    responseType: "arraybuffer",
    timeout: 60000,
    maxRedirects: 5,
  });

  const contentType = dlResp.headers["content-type"] || "";
  const contentDisposition = dlResp.headers["content-disposition"] || "";

  // Detect extension from headers
  let ext = "epub";
  if (contentType.includes("pdf") || contentDisposition.includes(".pdf")) ext = "pdf";
  else if (contentType.includes("epub") || contentDisposition.includes(".epub")) ext = "epub";
  else if (contentDisposition.includes(".mobi")) ext = "mobi";
  else if (contentDisposition.includes(".fb2")) ext = "fb2";

  return { buffer: Buffer.from(dlResp.data), ext };
}

server.tool(
  "search_books",
  "Search for books on Library Genesis (LibGen). Returns a list with title, author, year, format, size, and MD5 identifier.",
  {
    query: z.string().describe("Book title, author, or keywords"),
    count: z.number().optional().default(10).describe("Number of results (default 10, max 25)"),
    extensions: z.array(z.string()).optional().describe("Filter by format, e.g. ['epub', 'pdf']"),
  },
  async ({ query, count, extensions }) => {
    const books = await searchLibGen(query, Math.min(count || 10, 25), extensions || []);
    return {
      content: [{ type: "text", text: JSON.stringify(books, null, 2) }],
    };
  }
);

server.tool(
  "download_book",
  "Download a book from LibGen by its MD5 hash. Returns the local file path of the downloaded file.",
  {
    md5: z.string().describe("The MD5 hash of the book from search results"),
    title: z.string().optional().describe("Book title (used for filename)"),
  },
  async ({ md5, title }) => {
    const { buffer, ext } = await downloadBook(md5.toUpperCase());

    const safeName = (title || md5).replace(/[^\w一-鿿\s\-]/g, "").trim().slice(0, 60) || md5;
    const filename = `${safeName}.${ext}`;
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
