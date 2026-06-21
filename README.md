# find-a-book-mcp

An MCP (Model Context Protocol) server for searching and downloading books from [Library Genesis](https://libgen.li). Works with Claude Code, Claude Desktop, and any MCP-compatible AI agent.

---

## Tools

### `search_books`
Search for books by title, author, or keywords.

**Parameters:**
- `query` (string, required) — Book title, author, or keywords
- `count` (number, optional) — Number of results, default 10, max 25
- `extensions` (string[], optional) — Filter by format, e.g. `["epub", "pdf", "mobi"]`

**Returns:** List of books with title, author, publisher, year, format, size, and MD5 hash.

### `download_book`
Download a book by its MD5 hash (from search results).

**Parameters:**
- `md5` (string, required) — MD5 hash of the book
- `title` (string, optional) — Book title, used for the filename

**Returns:** Local file path, filename, file size, and format.

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

1. **Search** — Scrapes `libgen.li` search results (no API key required)
2. **Download** — Two-step process: fetch a one-time key from `ads.php`, then download the file via `get.php`
3. **Save** — File is saved to the system temp directory (`/tmp/`)

---

## Notes

- No account or API key required
- Supports EPUB, MOBI, PDF, AZW3, and more
- Downloaded files are saved to `/tmp/` — move them as needed

---

---

# find-a-book-mcp（中文说明）

基于 [Library Genesis](https://libgen.li) 的 MCP 工具服务，支持搜索和下载电子书。兼容 Claude Code、Claude Desktop 及所有支持 MCP 协议的 AI Agent。

---

## 工具说明

### `search_books` — 搜索书籍
按书名、作者或关键词搜索。

**参数：**
- `query`（必填）— 书名、作者或关键词
- `count`（可选）— 返回结果数量，默认 10，最多 25
- `extensions`（可选）— 按格式过滤，如 `["epub", "mobi", "pdf"]`

**返回：** 书籍列表，包含书名、作者、出版社、年份、格式、大小和 MD5。

### `download_book` — 下载书籍
通过搜索结果中的 MD5 下载书籍。

**参数：**
- `md5`（必填）— 书籍的 MD5 哈希值
- `title`（可选）— 书名，用于文件命名

**返回：** 本地文件路径、文件名、大小和格式。

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

1. **搜索** — 直接抓取 `libgen.li` 页面，无需注册或 API Key
2. **下载** — 两步流程：先从 `ads.php` 获取一次性 key，再通过 `get.php` 下载文件
3. **保存** — 文件存入系统临时目录（`/tmp/`）

---

## 注意事项

- 无需账号或 API Key
- 支持 EPUB、MOBI、PDF、AZW3 等格式
- 文件默认保存在 `/tmp/`，请自行移至目标位置
