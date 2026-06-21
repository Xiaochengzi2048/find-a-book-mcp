# find-a-book-mcp

An MCP (Model Context Protocol) server for searching and downloading books from [Library Genesis](https://libgen.li). Works with Claude Code, Claude Desktop, and any MCP-compatible AI agent.

---

## Tools

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
Download a book by its MD5 hash. Retries up to 3 times on failure.

**Parameters:**
- `md5` (string, required) — MD5 hash from search results
- `title` (string, optional) — Book title, used for the filename

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
      "args": ["-y", "github:Xiaochengzi2048/find-a-book-mcp"]
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

1. **Search** — Scrapes `libgen.li` search results (no API key or account required)
2. **Paginate** — LibGen returns 25 results per server page; this server presents 5 per display page with `hasMore`/`hasPrev` flags for navigation
3. **Download** — Two-step: fetch a one-time key from `ads.php`, then download via `get.php`; retries up to 3× on failure
4. **Save** — File saved to system temp directory (`/tmp/`) with a timestamped filename to avoid collisions

---

## Notes

- No account or API key required
- Supports EPUB, MOBI, PDF, AZW3, FB2, DJVU, and more
- `size_bytes` field lets callers decide delivery method (e.g. direct send vs. link for large files)
- Downloaded files are saved to `/tmp/` — move them as needed

---
---

# find-a-book-mcp（中文说明）

基于 [Library Genesis](https://libgen.li) 的 MCP 工具服务，支持搜索和下载电子书。兼容 Claude Code、Claude Desktop 及所有支持 MCP 协议的 AI Agent。

---

## 工具说明

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
通过 MD5 下载书籍，失败自动重试最多 3 次。

**参数：**
- `md5`（必填）— 搜索结果中的 MD5
- `title`（可选）— 书名，用于文件命名

**返回：** 本地文件路径、文件名、字节大小、格式。

---

## 安装方式

### Claude Code / Claude Desktop

在 `settings.json` 中添加：

```json
{
  "mcpServers": {
    "find-a-book": {
      "command": "npx",
      "args": ["-y", "github:Xiaochengzi2048/find-a-book-mcp"]
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

1. **搜索** — 抓取 `libgen.li` 页面，无需账号或 API Key
2. **分页** — LibGen 每次返回 25 条，本服务每显示页展示 5 条，通过 `hasMore`/`hasPrev` 驱动翻页
3. **下载** — 两步流程：从 `ads.php` 获取一次性 key，再通过 `get.php` 下载；失败自动重试最多 3 次
4. **保存** — 文件存入 `/tmp/`，文件名含时间戳防冲突

---

## 注意事项

- 无需账号或 API Key
- 支持 EPUB、MOBI、PDF、AZW3、FB2、DJVU 等格式
- `size_bytes` 字段方便调用方判断发送方式（如小文件直发，大文件给链接）
- 文件默认保存在 `/tmp/`，请自行移至目标位置
