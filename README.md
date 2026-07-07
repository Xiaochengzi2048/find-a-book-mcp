# find-a-book-mcp

An MCP (Model Context Protocol) server for searching and downloading books from [Library Genesis](https://libgen.li) and [Z-Library](https://z-lib.id). Works with Claude Code, Claude Desktop, and any MCP-compatible AI agent.

**LibGen tools** (`lookup_metadata`, `get_formats`, `search_books`, `download_book`) require no credentials.  
**Z-Library tools** (`search_zlibrary`, `download_zlibrary`) require a free Z-Library account — set via environment variables.

---

## Z-Library Setup (optional)

Z-Library has wider coverage than LibGen — better for novels, Chinese books, and recent titles.

**Option A — Email + Password** (auto-login on first use):
```bash
export ZLIBRARY_EMAIL=you@example.com
export ZLIBRARY_PASSWORD=yourpassword
```

**Option B — Token (recommended)** — log in once via browser, copy cookies, never re-authenticate:
```bash
export ZLIBRARY_REMIX_USERID=12345678
export ZLIBRARY_REMIX_USERKEY=abcdef1234567890...
```
> To get these: log in at [z-lib.id](https://z-lib.id), open DevTools → Application → Cookies → copy `remix_userid` and `remix_userkey`.

---

## Tools

### `lookup_metadata`
Look up authoritative book metadata from [Open Library](https://openlibrary.org) (free, no API key). Use this **before** searching LibGen to confirm the correct title/author/year/ISBN — LibGen's scraped titles are often noisy ("Summary of ...", pirated re-titles). Returns up to 5 candidate matches, or a single exact match when an ISBN is given.

**Parameters:**
- `query` (string, optional) — Book title, author, or keywords
- `isbn` (string, optional) — ISBN-10 or ISBN-13 for an exact lookup (takes precedence over `query`)

**Returns:** Array of `{ title, author, year, publisher, isbn, cover, openlibrary }` (ISBN lookup also includes `pages`).

### `get_formats`
Search for a book and return all available formats grouped by unique title + author. Instead of many duplicate rows, each book appears once with a list of all available formats (EPUB / MOBI / PDF / AZW3, etc.) and their MD5s. Fetches up to 75 results in parallel for comprehensive coverage.

**Parameters:**
- `query` (string, required) — Book title, author, or keywords

**Returns:**
```json
[
  {
    "title": "Harry Potter and the Philosopher's Stone",
    "author": "J.K. Rowling",
    "publisher": "Bloomsbury",
    "year": "2015",
    "language": "English",
    "formats": [
      { "extension": "EPUB", "size": "920 kB", "size_bytes": 942080, "md5": "D7FF6458..." },
      { "extension": "MOBI", "size": "1.1 MB", "size_bytes": 1153433, "md5": "A3CC9012..." }
    ]
  }
]
```

### `search_books`
Search for books by title, author, or keywords. Returns **5 results per page** with pagination support.

**Parameters:**
- `query` (string, required) — Book title, author, or keywords
- `page` (number, optional, default 1) — Display page number (5 results per page)
- `extensions` (string[], optional) — Filter by format, e.g. `["epub", "pdf", "mobi"]`

**Returns:**
```json
{
  "books": [
    {
      "title": "...",
      "author": "...",
      "publisher": "...",
      "year": "2021",
      "language": "Chinese",
      "extension": "EPUB",
      "size": "920 kB",
      "size_bytes": 942080,
      "md5": "D7FF6458..."
    }
  ],
  "displayPage": 1,
  "totalDisplayPages": 10,
  "totalCount": 50,
  "hasMore": true,
  "hasPrev": false
}
```

### `download_book`
Download a book by its MD5 hash. Automatically tries multiple mirrors in order: `libgen.li` → `libgen.rs` → `libgen.st` → `library.lol`.

**Parameters:**
- `md5` (string, required) — MD5 hash from search results
- `title` (string, optional) — Book title, used for the filename
- `dest_dir` (string, optional) — Destination directory (defaults to system temp dir; created if missing)

**Returns:** Local file path, filename, size in bytes, and format extension.

---

## Installation

### Claude Code / Claude Desktop

Add to your `settings.json`:

```json
{
  "mcpServers": {
    "find-a-book": {
      "command": "npx",
      "args": ["-y", "find-a-book-mcp"]
    }
  }
}
```

### Manual

```bash
git clone https://github.com/Xiaochengzi2048/find-a-book-mcp
cd find-a-book-mcp
npm install
node server.js
```

---

## How It Works

1. **Search** — Scrapes LibGen HTML (no API key or account required); tries `libgen.li` → `libgen.rs` → `libgen.st` automatically
2. **Paginate** — LibGen returns 25 results per server page; this server presents 5 per display page with `hasMore`/`hasPrev` flags for navigation
3. **Download** — Two-step: fetch a one-time key from `ads.php`, then download via `get.php`; falls back through all mirrors then `library.lol` on failure
4. **Save** — File saved to system temp directory (`/tmp/`) with a timestamped filename to avoid collisions

---

## Notes

- No account or API key required
- Supports EPUB, MOBI, PDF, AZW3, FB2, DJVU, and more
- **`LIBGEN_MIRRORS` env var** — override the default mirror list (comma-separated base URLs) when domains rotate, e.g. `LIBGEN_MIRRORS="https://libgen.is,https://libgen.gs"`. `searchPath` is inferred per host (libgen.li → `/index.php`, others → `/search.php`).
- `size_bytes` field lets callers decide delivery method (e.g. direct send vs. link for large files)
- Downloaded files are saved to `/tmp/` — move them as needed
- Mirror failures are logged to stderr for easy debugging

---
---

# find-a-book-mcp（中文说明）

基于 [Library Genesis](https://libgen.li) 的 MCP 工具服务，支持搜索和下载电子书。兼容 Claude Code、Claude Desktop 及所有支持 MCP 协议的 AI Agent。

---

## 工具说明

### `lookup_metadata` — 权威元数据查询
从 [Open Library](https://openlibrary.org) 查询权威书目元数据（免费、无需 API Key）。建议在搜索 LibGen **之前**用它确认正确的书名/作者/年份/ISBN——LibGen 抓取的书名常有噪音（"Summary of ..."、盗印改名等）。返回最多 5 个候选；提供 ISBN 时返回单个精确匹配。

**参数：**
- `query`（可选）— 书名、作者或关键词
- `isbn`（可选）— ISBN-10 或 ISBN-13，精确查询（优先级高于 `query`）

**返回：** `{ title, author, year, publisher, isbn, cover, openlibrary }` 数组（ISBN 查询另含 `pages`）。

### `get_formats` — 按格式汇总
搜索一本书，将所有重复条目按「书名 + 作者」归并，每本书只出现一次，并列出所有可用格式（EPUB / MOBI / PDF / AZW3 等）及其 MD5。并行抓取最多 75 条结果，覆盖更全面。

**参数：**
- `query`（必填）— 书名、作者或关键词

**返回示例：**
```json
[
  {
    "title": "置身事内",
    "author": "兰小欢",
    "year": "2021",
    "language": "Chinese",
    "formats": [
      { "extension": "EPUB", "size": "2.3 MB", "size_bytes": 2411724, "md5": "..." },
      { "extension": "PDF",  "size": "8.1 MB", "size_bytes": 8493466, "md5": "..." }
    ]
  }
]
```

### `search_books` — 搜索书籍
按书名、作者或关键词搜索，每页返回 5 条结果，支持翻页。

**参数：**
- `query`（必填）— 书名、作者或关键词
- `page`（可选，默认 1）— 显示页码，每页 5 条
- `extensions`（可选）— 按格式过滤，如 `["epub", "mobi", "pdf"]`

**返回字段说明：**
- `books` — 当前页书籍列表，含书名、作者、出版社、年份、**语言**、格式、大小、`size_bytes`（字节数）、MD5
- `totalCount` — 总结果数（单页时精确，多页时为估算值）
- `totalDisplayPages` — 总显示页数
- `hasMore` / `hasPrev` — 是否有下一页 / 上一页

### `download_book` — 下载书籍
通过 MD5 下载书籍，自动按顺序尝试多个镜像：`libgen.li` → `libgen.rs` → `libgen.st` → `library.lol`。

**参数：**
- `md5`（必填）— 搜索结果中的 MD5
- `title`（可选）— 书名，用于文件命名
- `dest_dir`（可选）— 保存目录（默认系统临时目录，不存在会自动创建）

**返回：** 本地文件路径、文件名、字节大小、格式。

### `search_zlibrary` — Z-Library 搜索
在 Z-Library 搜索书籍，覆盖面比 LibGen 更广（小说、中文书、近期出版物）。**需要配置账号环境变量**，见上方「Z-Library 配置」。

**参数：**
- `query`（必填）— 书名、作者或关键词
- `page`（可选，默认 1）— 页码，每页 10 条
- `extensions`（可选）— 按格式过滤，如 `["epub", "pdf"]`
- `languages`（可选）— 语言过滤，如 `"chinese"` 或 `"english"`
- `year_from` / `year_to`（可选）— 出版年份范围

**返回：** 书籍列表，含 `zlibrary_id` 和 `zlibrary_hash`（下载用）。

### `download_zlibrary` — Z-Library 下载
通过 `zlibrary_id` + `zlibrary_hash` 下载书籍。**需要配置账号环境变量**。

**参数：**
- `zlibrary_id`（必填）— 来自 `search_zlibrary` 结果
- `zlibrary_hash`（必填）— 来自 `search_zlibrary` 结果
- `title`（可选）— 书名，用于文件命名
- `dest_dir`（可选）— 保存目录

**返回：** 本地文件路径、文件名、字节大小、格式。

---

## Z-Library 配置（可选）

Z-Library 覆盖面比 LibGen 更广，尤其适合小说、中文书和近期出版物。

**方式 A — 邮箱 + 密码**（首次使用时自动登录）：
```bash
export ZLIBRARY_EMAIL=you@example.com
export ZLIBRARY_PASSWORD=yourpassword
```

**方式 B — Token（推荐）**，在浏览器登录一次后复制 Cookie，无需重复登录：
```bash
export ZLIBRARY_REMIX_USERID=12345678
export ZLIBRARY_REMIX_USERKEY=abcdef1234567890...
```
> 获取方式：在 [z-lib.id](https://z-lib.id) 登录后，打开 DevTools → Application → Cookies，复制 `remix_userid` 和 `remix_userkey`。

---

## 安装方式

### Claude Code / Claude Desktop

在 `settings.json` 中添加：

```json
{
  "mcpServers": {
    "find-a-book": {
      "command": "npx",
      "args": ["-y", "find-a-book-mcp"]
    }
  }
}
```

### 手动安装

```bash
git clone https://github.com/Xiaochengzi2048/find-a-book-mcp
cd find-a-book-mcp
npm install
node server.js
```

---

## 工作原理

1. **搜索** — 抓取 LibGen 页面，无需账号或 API Key；自动尝试 `libgen.li` → `libgen.rs` → `libgen.st`
2. **分页** — LibGen 每次返回 25 条，本服务每显示页展示 5 条，通过 `hasMore`/`hasPrev` 驱动翻页
3. **下载** — 两步流程：从 `ads.php` 获取一次性 key，再通过 `get.php` 下载；所有镜像失败后自动切换到 `library.lol`
4. **保存** — 文件存入 `/tmp/`，文件名含时间戳防冲突

---

## 注意事项

- 无需账号或 API Key
- 支持 EPUB、MOBI、PDF、AZW3、FB2、DJVU 等格式
- **`LIBGEN_MIRRORS` 环境变量** — 域名轮换时可覆盖默认镜像列表（逗号分隔的 base URL），如 `LIBGEN_MIRRORS="https://libgen.is,https://libgen.gs"`。`searchPath` 按域名自动推断（libgen.li → `/index.php`，其余 → `/search.php`）。
- `size_bytes` 字段方便调用方判断发送方式（如小文件直发，大文件给链接）
- 文件默认保存在 `/tmp/`，请自行移至目标位置
- 镜像失败时会写入 stderr，便于排查问题
