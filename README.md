# find-a-book-mcp

An MCP server for finding and downloading books from **LibGen** and **Z-Library**. Works with Claude Code, Claude Desktop, and any MCP-compatible AI agent.

| Source | Tools | Account needed? |
|--------|-------|----------------|
| Open Library | `lookup_metadata` | No |
| Library Genesis | `get_formats`, `search_books`, `download_book` | No |
| Z-Library | `search_zlibrary`, `download_zlibrary` | Yes (free) |

**Quick rule of thumb:** Start with `search_books` (LibGen, no login). If the book isn't there or you want a Chinese novel / recent release, switch to `search_zlibrary` (Z-Library).

---

## Installation

### Claude Desktop / Claude Code

Add to `settings.json` (no install needed — `npx` handles it automatically):

```json
{
  "mcpServers": {
    "find-a-book": {
      "command": "npx",
      "args": ["-y", "find-a-book-mcp"],
      "env": {
        "ZLIBRARY_EMAIL": "you@example.com",
        "ZLIBRARY_PASSWORD": "yourpassword"
      }
    }
  }
}
```

> Omit the `env` block if you only need LibGen (no Z-Library account required).

### Manual

```bash
git clone https://github.com/Xiaochengzi2048/find-a-book-mcp
cd find-a-book-mcp
npm install
node server.js
```

---

## Z-Library Setup

Z-Library has wider coverage than LibGen — especially for **novels, Chinese books, and recent titles**. Requires a free account at [z-library.sk](https://z-library.sk).

**Option A — Email + password** (auto-login on first use):
```bash
export ZLIBRARY_EMAIL=you@example.com
export ZLIBRARY_PASSWORD=yourpassword
```

**Option B — Token** (skip login, slightly faster):
```bash
export ZLIBRARY_REMIX_USERID=12345678
export ZLIBRARY_REMIX_USERKEY=abcdef1234567890...
```
> To get your token: log in at [z-library.sk](https://z-library.sk), open DevTools → Application → Cookies → copy `remix_userid` and `remix_userkey`.

---

## Tools

### `lookup_metadata` — Verify book info before searching

Looks up authoritative metadata from [Open Library](https://openlibrary.org) (free, no login). Use this **before** searching LibGen when you're not sure about the exact title or author — LibGen's scraped titles are often noisy ("Summary of…", alternate editions, etc.).

**Parameters:**
- `query` (string, optional) — Title, author, or keywords
- `isbn` (string, optional) — ISBN-10 or ISBN-13 for exact lookup (takes precedence over `query`)

**Returns:** Up to 5 candidates: `{ title, author, year, publisher, isbn, cover, openlibrary }`. ISBN lookups also include `pages`.

**When to use:** You have a rough title/author and want to confirm the canonical version before searching. Or you have an ISBN and want clean metadata.

---

### `search_books` — Search LibGen

Search by title, author, or keywords. Returns 5 results per page with pagination.

**Parameters:**
- `query` (string, required) — Title, author, or keywords
- `page` (number, optional, default `1`) — Page number (5 results per page)
- `extensions` (string[], optional) — Format filter, e.g. `["epub", "pdf", "mobi"]`

**Returns:**
```json
{
  "books": [
    {
      "title": "The Psychology of Money",
      "author": "Morgan Housel",
      "year": "2020",
      "language": "English",
      "extension": "EPUB",
      "size": "920 kB",
      "size_bytes": 942080,
      "md5": "D7FF6458..."
    }
  ],
  "displayPage": 1,
  "totalDisplayPages": 4,
  "totalCount": 18,
  "hasMore": true,
  "hasPrev": false
}
```

**When to use:** Most non-fiction, English books, older titles. No account needed.

---

### `get_formats` — See all available formats for a book

Same search as `search_books`, but deduplicates by title + author and groups all formats together. Fetches up to 75 results in parallel.

**Parameters:**
- `query` (string, required) — Title, author, or keywords

**Returns:**
```json
[
  {
    "title": "The Psychology of Money",
    "author": "Morgan Housel",
    "year": "2020",
    "language": "English",
    "formats": [
      { "extension": "EPUB", "size": "920 kB", "size_bytes": 942080, "md5": "D7FF6458..." },
      { "extension": "MOBI", "size": "1.1 MB", "size_bytes": 1153433, "md5": "A3CC9012..." },
      { "extension": "PDF",  "size": "3.2 MB", "size_bytes": 3355443, "md5": "B9DE3F21..." }
    ]
  }
]
```

**When to use:** You want to pick a specific format (e.g. EPUB for e-reader, PDF for reference), or you want to see everything available in one call.

---

### `download_book` — Download from LibGen

Download a book by its MD5 hash. Automatically tries multiple mirrors in parallel: `libgen.li` → `libgen.rs` → `libgen.st` → `library.lol`.

**Parameters:**
- `md5` (string, required) — MD5 from `search_books` or `get_formats` results
- `title` (string, optional) — Used for the filename
- `dest_dir` (string, optional) — Save directory (defaults to system temp dir; created if missing)

**Returns:** `{ file_path, filename, size_bytes, extension }`

---

### `search_zlibrary` — Search Z-Library

Search Z-Library's catalog. Better than LibGen for novels, Chinese books, and recently published titles.

**Requires:** `ZLIBRARY_EMAIL` + `ZLIBRARY_PASSWORD` (or token env vars).

**Parameters:**
- `query` (string, required) — Title, author, or keywords
- `page` (number, optional, default `1`) — Page number (10 results per page)
- `extensions` (string[], optional) — Format filter, e.g. `["epub", "pdf"]`
- `languages` (string, optional) — Language filter, e.g. `"chinese"` or `"english"`
- `year_from` / `year_to` (number, optional) — Publication year range

**Returns:** Book list with `zlibrary_id` and `zlibrary_hash` (needed for `download_zlibrary`), plus title, author, year, language, format, and size.

**When to use:** LibGen doesn't have the book; it's a Chinese novel or recent release; you want to filter by language.

---

### `download_zlibrary` — Download from Z-Library

Download a book using the `zlibrary_id` and `zlibrary_hash` from `search_zlibrary` results.

**Requires:** `ZLIBRARY_EMAIL` + `ZLIBRARY_PASSWORD` (or token env vars).

> Free Z-Library accounts have a **10 downloads/day** limit.

**Parameters:**
- `zlibrary_id` (string, required) — From `search_zlibrary` results
- `zlibrary_hash` (string, required) — From `search_zlibrary` results
- `title` (string, optional) — Used for the filename
- `dest_dir` (string, optional) — Save directory

**Returns:** `{ file_path, filename, size_bytes, extension }`

---

## Recommended Workflow

```
1. lookup_metadata("book title")        ← confirm exact title/author (optional but recommended)
2a. search_books("exact title")         ← try LibGen first (no login)
    → download_book(md5)
2b. search_zlibrary("exact title")      ← if not on LibGen, or want Chinese/recent
    → download_zlibrary(id, hash)
```

**Tips for better results:**
- Use `lookup_metadata` first when the title might be ambiguous — it normalizes spelling and finds the right edition
- Use `get_formats` to pick EPUB over PDF when both exist (EPUB is better on e-readers)
- Use `languages: "chinese"` in `search_zlibrary` to filter out English translations of Chinese books
- If `search_books` returns noisy results (summaries, study guides), add the author name to narrow it down

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZLIBRARY_EMAIL` | Z-Library account email |
| `ZLIBRARY_PASSWORD` | Z-Library account password |
| `ZLIBRARY_REMIX_USERID` | Token auth: user ID from cookie (alternative to email/password) |
| `ZLIBRARY_REMIX_USERKEY` | Token auth: user key from cookie |
| `LIBGEN_MIRRORS` | Override LibGen mirror list (comma-separated URLs) when default domains rotate, e.g. `https://libgen.is,https://libgen.gs` |

---

## Notes

- Downloaded files are saved to the system temp directory (`/tmp/`) by default — move them as needed
- `size_bytes` lets you decide delivery method (direct send vs. link for large files)
- Mirror failures are logged to stderr
- Supports EPUB, MOBI, PDF, AZW3, FB2, DJVU, and more

---
---

# find-a-book-mcp（中文说明）

从 **LibGen** 和 **Z-Library** 搜索、下载电子书的 MCP 服务，兼容 Claude Code、Claude Desktop 及所有支持 MCP 协议的 AI Agent。

| 数据源 | 工具 | 需要账号？ |
|--------|------|-----------|
| Open Library | `lookup_metadata` | 否 |
| Library Genesis | `get_formats`, `search_books`, `download_book` | 否 |
| Z-Library | `search_zlibrary`, `download_zlibrary` | 是（免费） |

**简单判断原则：** 先用 `search_books`（LibGen，无需登录）。找不到，或要搜中文小说、近期出版物，再切 `search_zlibrary`（Z-Library）。

---

## 安装

### Claude Desktop / Claude Code

在 `settings.json` 中添加（无需手动安装，`npx` 自动处理）：

```json
{
  "mcpServers": {
    "find-a-book": {
      "command": "npx",
      "args": ["-y", "find-a-book-mcp"],
      "env": {
        "ZLIBRARY_EMAIL": "你的邮箱",
        "ZLIBRARY_PASSWORD": "你的密码"
      }
    }
  }
}
```

> 只用 LibGen 的话可以省略 `env` 部分，无需账号。

### 手动安装

```bash
git clone https://github.com/Xiaochengzi2048/find-a-book-mcp
cd find-a-book-mcp
npm install
node server.js
```

---

## Z-Library 配置

Z-Library 覆盖面比 LibGen 更广，尤其适合**小说、中文书、近期出版物**。需要在 [z-library.sk](https://z-library.sk) 注册免费账号。

**方式 A — 邮箱 + 密码**（首次使用时自动登录）：
```bash
export ZLIBRARY_EMAIL=you@example.com
export ZLIBRARY_PASSWORD=yourpassword
```

**方式 B — Token**（跳过登录，稍快）：
```bash
export ZLIBRARY_REMIX_USERID=12345678
export ZLIBRARY_REMIX_USERKEY=abcdef1234567890...
```
> 获取方式：在 [z-library.sk](https://z-library.sk) 登录后，打开 DevTools → Application → Cookies，复制 `remix_userid` 和 `remix_userkey`。

---

## 工具说明

### `lookup_metadata` — 搜索前校验书目信息

从 [Open Library](https://openlibrary.org) 查询权威元数据（免费，无需账号）。在搜 LibGen **之前**用它确认准确的书名/作者——LibGen 抓取的书名经常有噪音（"Summary of…"、不同版次等）。

**参数：**
- `query`（可选）— 书名、作者或关键词
- `isbn`（可选）— ISBN-10 或 ISBN-13，精确查询（优先级高于 `query`）

**返回：** 最多 5 个候选：`{ title, author, year, publisher, isbn, cover, openlibrary }`。ISBN 查询另含 `pages`。

**适用场景：** 书名不确定时先校验规范写法；有 ISBN 时直接拿干净元数据。

---

### `search_books` — LibGen 搜索

按书名、作者或关键词搜索，每页返回 5 条，支持翻页。

**参数：**
- `query`（必填）— 书名、作者或关键词
- `page`（可选，默认 1）— 页码，每页 5 条
- `extensions`（可选）— 格式过滤，如 `["epub", "pdf", "mobi"]`

**返回字段：** 书名、作者、出版社、年份、语言、格式、大小（含 `size_bytes`）、MD5，以及翻页信息（`hasMore` / `hasPrev` / `totalCount`）。

**适用场景：** 大多数非虚构类书籍、英文书、早期出版物。无需账号。

---

### `get_formats` — 查看所有可用格式

与 `search_books` 搜索逻辑相同，但将同一书名+作者的所有格式归并展示。并行抓取最多 75 条结果，覆盖更全面。

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

**适用场景：** 想选特定格式（如 EPUB 用于阅读器，PDF 用于查阅），或想一次看全所有可用格式。

---

### `download_book` — LibGen 下载

通过 MD5 下载书籍，自动并行尝试多个镜像：`libgen.li` → `libgen.rs` → `libgen.st` → `library.lol`。

**参数：**
- `md5`（必填）— 来自 `search_books` 或 `get_formats` 的 MD5
- `title`（可选）— 书名，用于文件命名
- `dest_dir`（可选）— 保存目录（默认系统临时目录，不存在会自动创建）

**返回：** `{ file_path, filename, size_bytes, extension }`

---

### `search_zlibrary` — Z-Library 搜索

在 Z-Library 搜索书籍，覆盖面比 LibGen 更广，尤其适合小说、中文书和近期出版物。

**需要：** `ZLIBRARY_EMAIL` + `ZLIBRARY_PASSWORD`（或 Token 环境变量）。

**参数：**
- `query`（必填）— 书名、作者或关键词
- `page`（可选，默认 1）— 页码，每页 10 条
- `extensions`（可选）— 格式过滤，如 `["epub", "pdf"]`
- `languages`（可选）— 语言过滤，如 `"chinese"` 或 `"english"`
- `year_from` / `year_to`（可选）— 出版年份范围

**返回：** 书籍列表，含 `zlibrary_id` 和 `zlibrary_hash`（下载用），以及书名、作者、年份、语言、格式、大小。

**适用场景：** LibGen 没有该书；中文小说或近期出版物；需要按语言过滤。

---

### `download_zlibrary` — Z-Library 下载

用 `search_zlibrary` 返回的 `zlibrary_id` + `zlibrary_hash` 下载书籍。

**需要：** `ZLIBRARY_EMAIL` + `ZLIBRARY_PASSWORD`（或 Token 环境变量）。

> 免费账号每天限下载 **10 本**。

**参数：**
- `zlibrary_id`（必填）— 来自 `search_zlibrary` 结果
- `zlibrary_hash`（必填）— 来自 `search_zlibrary` 结果
- `title`（可选）— 书名，用于文件命名
- `dest_dir`（可选）— 保存目录

**返回：** `{ file_path, filename, size_bytes, extension }`

---

## 推荐使用流程

```
1. lookup_metadata("书名")              ← 确认准确书名/作者（可选但推荐）
2a. search_books("准确书名")            ← 先试 LibGen（无需登录）
    → download_book(md5)
2b. search_zlibrary("准确书名")         ← LibGen 没有，或要搜中文/近期出版物
    → download_zlibrary(id, hash)
```

**用好这个工具的几个技巧：**
- 书名有歧义时先用 `lookup_metadata` 校准——它能找到规范拼写和正确版次
- `get_formats` 可以选格式：有 EPUB 时优先选 EPUB（阅读器更友好）
- 搜中文书时加 `languages: "chinese"` 过滤掉英译本
- `search_books` 结果有噪音（摘要版、学习指南）时，加上作者名再搜

---

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `ZLIBRARY_EMAIL` | Z-Library 账号邮箱 |
| `ZLIBRARY_PASSWORD` | Z-Library 账号密码 |
| `ZLIBRARY_REMIX_USERID` | Token 认证：Cookie 中的 userid（可替代邮箱/密码） |
| `ZLIBRARY_REMIX_USERKEY` | Token 认证：Cookie 中的 userkey |
| `LIBGEN_MIRRORS` | 覆盖默认 LibGen 镜像列表（逗号分隔的 URL），域名轮换时使用，如 `https://libgen.is,https://libgen.gs` |

---

## 注意事项

- 文件默认保存在系统临时目录（`/tmp/`），请自行移至目标位置
- `size_bytes` 字段方便判断发送方式（小文件直发，大文件给链接）
- 镜像失败时写入 stderr，便于排查
- 支持 EPUB、MOBI、PDF、AZW3、FB2、DJVU 等格式
