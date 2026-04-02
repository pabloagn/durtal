# Task 0081: Comments System for Works and Authors

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0080
**Blocks**: None

## Overview

Add a persistent comment system to both Work detail pages and Author detail pages, inspired by Linear's comment UX. Users can leave rich-text comments with file attachments on any Work or Author. Comments appear chronologically in the same activity section introduced in Task 0079, interleaved with system-generated activity events. Posting a comment is itself an activity event (`work.comment_added` / `author.comment_added`).

Comments serve as a personal annotation layer -- research notes, acquisition context, condition observations, reading impressions, provenance leads, or any freeform thought the user wants to permanently attach to an item.

---

## Rich Text Editor

### Editor Choice: Tiptap

Use [Tiptap](https://tiptap.dev/) (headless, ProseMirror-based) as the rich text editor. Tiptap provides:

- Full control over the toolbar and rendering (no opinionated UI to fight against)
- Extension-based architecture (only load what we need)
- First-class support for code blocks, inline formatting, and custom nodes
- Works well with React and server-side HTML serialization

### Supported Formatting

The editor must support the following inline and block formats. Headers and font size changes are explicitly **excluded** -- all text renders at a single base size.

| Format | Shortcut | Toolbar Button |
| --- | --- | --- |
| **Bold** | `Ctrl+B` | Yes |
| *Italic* | `Ctrl+I` | Yes |
| Underline | `Ctrl+U` | Yes |
| ~~Strikethrough~~ | `Ctrl+Shift+X` | Yes |
| `Inline code` | `Ctrl+E` | Yes |
| Code block (with syntax highlighting) | ` ``` ` then language | Yes (dropdown or toggle) |
| Bulleted list | `- ` at line start | Yes |
| Numbered list | `1. ` at line start | Yes |
| Blockquote | `> ` at line start | Yes |
| Horizontal rule | `---` | No (markdown only) |
| Link | `Ctrl+K` | Yes |

### Explicitly NOT Supported

- Headers (h1-h6) -- no font size hierarchy within comments
- Font size changes
- Font family changes
- Text color changes
- Tables
- Embeds (YouTube, tweets, etc.)

### Code Block Syntax Highlighting

Code blocks must support syntax highlighting for common languages. Use Tiptap's `CodeBlockLowlight` extension with `lowlight` (tree-shakeable highlight.js). Register languages on demand, not all at once.

Default highlighted languages: `javascript`, `typescript`, `python`, `rust`, `go`, `sql`, `bash`, `json`, `yaml`, `html`, `css`.

Code blocks render with:
- Monospace font (system monospace stack or JetBrains Mono if already loaded)
- Muted background (`rgba(255,255,255,0.03)`)
- 2px border radius (matching design system)
- Language label in top-right corner (subtle, muted text)

### Editor UI

The comment input area sits below the activity timeline. It has two states:

**Collapsed (default)**:
```
+------------------------------------------------------------------+
|  Leave a comment...                                [clip] [send] |
+------------------------------------------------------------------+
```
A single-line placeholder. Clicking anywhere expands to the full editor.

**Expanded (on focus)**:
```
+------------------------------------------------------------------+
|  B  I  U  S  <>  Code  List  OL  Quote  Link                    |
+------------------------------------------------------------------+
|                                                                  |
|  [Rich text editing area, min-height ~100px, grows with content] |
|                                                                  |
+------------------------------------------------------------------+
|  attached-file.pdf  x                          [clip] [send]     |
+------------------------------------------------------------------+
```

- Toolbar appears at the top on focus
- Attachment list appears at the bottom (if any)
- Clip icon (paperclip) opens file picker
- Send button (arrow-up in circle) submits the comment
- `Ctrl+Enter` also submits
- `Escape` collapses back to placeholder (if empty)
- Editor auto-grows vertically with content (no fixed max-height, but scrollable after ~300px)

### Markdown Shortcuts

Tiptap supports input rules that convert markdown-like syntax on the fly:
- `**bold**` -> **bold**
- `*italic*` -> *italic*
- `` `code` `` -> `code`
- ` ``` ` -> code block
- `- ` -> bullet list
- `1. ` -> numbered list
- `> ` -> blockquote
- `---` -> horizontal rule

These work automatically via Tiptap's `StarterKit` and custom input rules.

---

## File Attachments

### Supported Attachment Types

Any file type is accepted. Common types with special treatment:

| Category | Extensions | Preview |
| --- | --- | --- |
| Images | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg` | Inline thumbnail (clickable to expand in lightbox) |
| Documents | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx` | File icon + filename + size |
| Code/text | `.txt`, `.md`, `.py`, `.ts`, `.js`, `.json`, etc. | File icon + filename + size |
| Archives | `.zip`, `.tar`, `.gz` | File icon + filename + size |
| Other | anything else | File icon + filename + size |

### Attachment Storage

Attachments are uploaded to the existing S3 bucket under a dedicated prefix:

```
comments/{entityType}/{entityId}/{commentId}/{filename}
```

Example: `comments/work/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4/research-notes.pdf`

Reuse the existing media upload infrastructure (`src/app/api/media/upload/route.ts`) with a new `purpose: "comment_attachment"` parameter.

### Attachment Limits

- Max file size: 25MB per file
- Max attachments per comment: 10
- Max total attachment size per comment: 100MB

### Drag-and-Drop

The editor area accepts drag-and-drop for files. Dropping a file:
1. Triggers upload immediately (shows progress indicator)
2. Adds the file to the attachment list at the bottom of the editor
3. Images are also inserted inline at the cursor position (as a thumbnail)

### Paste Support

Pasting an image from clipboard (e.g., screenshots) triggers the same upload flow as drag-and-drop.

---

## Database Schema Changes

### New Table: `comments`

```typescript
// src/lib/db/schema/comments.ts
export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Polymorphic target: either a work or an author
  entityType: text("entity_type").notNull(),       // "work" | "author"
  entityId: uuid("entity_id").notNull(),            // FK to works.id or authors.id

  // Content
  contentHtml: text("content_html").notNull(),      // Rendered HTML from Tiptap (stored for display)
  contentJson: jsonb("content_json"),               // Tiptap JSON document (stored for re-editing)

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("comments_entity_idx").on(table.entityType, table.entityId),
  createdAtIdx: index("comments_created_at_idx").on(table.createdAt),
}));
```

### New Table: `comment_attachments`

```typescript
// src/lib/db/schema/comment-attachments.ts
export const commentAttachments = pgTable("comment_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  commentId: uuid("comment_id")
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),

  // File metadata
  fileName: text("file_name").notNull(),            // Original filename
  fileSize: integer("file_size").notNull(),          // Size in bytes
  mimeType: text("mime_type").notNull(),             // e.g. "image/png", "application/pdf"
  s3Key: text("s3_key").notNull(),                   // Full S3 object key

  // Display
  isImage: boolean("is_image").notNull().default(false),
  thumbnailUrl: text("thumbnail_url"),               // Pre-signed or public URL (for image previews)

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Update `docs/02_DATA_MODEL.md`

Add `comments` and `comment_attachments` tables to the data model documentation.

---

## File Structure

### New Files

```
src/
  lib/
    db/schema/
      comments.ts                            -- Drizzle schema for comments table
      comment-attachments.ts                 -- Drizzle schema for comment_attachments table
    comments/
      queries.ts                             -- CRUD: createComment, getCommentsForEntity, updateComment, deleteComment
      attachments.ts                         -- Upload + delete attachment helpers (wraps existing S3 logic)
  components/
    comments/
      comment-editor.tsx                     -- Tiptap editor wrapper (collapsed/expanded states)
      comment-editor-toolbar.tsx             -- Formatting toolbar (bold, italic, code, etc.)
      comment-item.tsx                       -- Single rendered comment (HTML content + attachments + timestamp)
      comment-attachment-list.tsx            -- Attachment display: thumbnails for images, file cards for others
      comment-attachment-upload.tsx          -- Upload progress indicator + drag-and-drop zone
      comment-delete-dialog.tsx              -- Confirmation dialog for comment deletion
  app/
    api/comments/
      route.ts                               -- POST: create comment, GET: list comments for entity
      [commentId]/
        route.ts                             -- PATCH: update comment, DELETE: delete comment
      [commentId]/attachments/
        route.ts                             -- POST: upload attachment to comment
        [attachmentId]/route.ts              -- DELETE: remove attachment
```

### Modified Files

```
src/lib/db/schema/index.ts                   -- Export comments and commentAttachments
src/app/library/[slug]/page.tsx              -- Integrate comment editor below activity timeline
src/app/authors/[slug]/page.tsx              -- Integrate comment editor below activity timeline
src/app/api/media/upload/route.ts            -- Add "comment_attachment" purpose handling (or create separate route)
```

### NPM Dependencies

| Package | Purpose |
| --- | --- |
| `@tiptap/react` | React integration for Tiptap editor |
| `@tiptap/starter-kit` | Core extensions (bold, italic, lists, code block, blockquote, etc.) |
| `@tiptap/extension-underline` | Underline support (not in starter-kit) |
| `@tiptap/extension-link` | Link support with auto-detection |
| `@tiptap/extension-code-block-lowlight` | Code blocks with syntax highlighting |
| `@tiptap/extension-placeholder` | Placeholder text ("Leave a comment...") |
| `@tiptap/extension-image` | Inline image rendering for pasted/dropped images |
| `lowlight` | Tree-shakeable syntax highlighting (highlight.js compatible) |

---

## UI Design

### Comment Display (within Activity Timeline)

Comments are rendered inline within the activity timeline from Task 0079. They appear as richer items compared to system events:

```
Activity
------------------------------------------------------------------------
|  [Pencil]  Changed title from "The Aleph" to "El Aleph"   2d ago   |
|     |                                                                |
|  [MessageSquare]  Left a comment                           3d ago   |
|     |  +----------------------------------------------------------+ |
|     |  | This edition has a misprint on page 47. The original     | |
|     |  | Spanish text reads "el Zahir" but this translation       | |
|     |  | renders it as "the Zaheer" -- possibly confusing it      | |
|     |  | with the proper noun.                                    | |
|     |  |                                                          | |
|     |  | See also: research-notes.pdf                             | |
|     |  +----------------------------------------------------------+ |
|     |  [Edit] [Delete]                                              |
|     |                                                                |
|  [ImagePlus]  Uploaded poster image                        1w ago   |
------------------------------------------------------------------------
```

Comments show:
- The full rich-text content (rendered HTML)
- Attachment previews (inline images as thumbnails, files as labeled cards)
- Edit and Delete actions (small text buttons, muted, appear on hover)
- Relative timestamp (same format as activity events)

### Comment Editing

Clicking "Edit" on a comment replaces the rendered HTML with the Tiptap editor pre-loaded with the comment's `contentJson`. The editor shows in expanded state with the existing content. Save/Cancel buttons replace the Edit/Delete buttons.

### Comment Deletion

Clicking "Delete" opens a small confirmation dialog ("Delete this comment? This action cannot be undone."). On confirmation:
1. All associated attachments are deleted from S3
2. The `comment_attachments` rows are cascade-deleted
3. The `comments` row is deleted
4. The corresponding `activity_events` entry for `comment_added` is also deleted (keeping the timeline clean)

---

## Integration with Activity Timeline (Task 0079)

### How Comments Appear in the Timeline

The activity timeline query (Task 0079) fetches both `activity_events` and `comments` for the given entity and merges them into a single chronological list, sorted by `created_at` descending.

Two approaches (decide during implementation):

**Option A -- Unified query**: When a comment is created, an `activity_events` row is also created with `event_key = "work.comment_added"` (or `author.comment_added`) and `metadata.commentId` pointing to the comment. The timeline renders system events normally, and when it encounters a comment event, it fetches and renders the full comment inline.

**Option B -- Merged streams**: The timeline component fetches `activity_events` and `comments` separately, then merges by `created_at` in the client. This avoids the JOIN but requires client-side interleaving.

**Recommendation**: Option A. A single `activity_events` query with a conditional JOIN to `comments` when `event_key` ends in `.comment_added` keeps the timeline logic clean and paginated in one query.

### Comment Input Placement

The comment editor is placed at the very top of the activity section (above the timeline), so the most natural flow is: write a comment at the top, see it appear as the most recent item in the timeline below.

```
+------------------------------------------------------------------+
|  Leave a comment...                                [clip] [send] |
+------------------------------------------------------------------+

Activity
------------------------------------------------------------------------
|  [MessageSquare]  Left a comment                     just now       |
|     | ...                                                           |
```

---

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/comments` | POST | Create a new comment. Body: `{ entityType, entityId, contentHtml, contentJson }` |
| `/api/comments` | GET | List comments for entity. Query: `?entityType=work&entityId=...&limit=20&offset=0` |
| `/api/comments/[commentId]` | PATCH | Update comment content. Body: `{ contentHtml, contentJson }` |
| `/api/comments/[commentId]` | DELETE | Delete comment + cascade attachments from S3 and DB |
| `/api/comments/[commentId]/attachments` | POST | Upload attachment (multipart form). Returns attachment metadata |
| `/api/comments/[commentId]/attachments/[attachmentId]` | DELETE | Delete single attachment from S3 and DB |

---

## Security and Validation

- **HTML sanitization**: Even though Tiptap generates trusted HTML, sanitize `contentHtml` on the server before storage using a whitelist-based sanitizer (e.g., `sanitize-html` or `isomorphic-dompurify`). Allow only the tags Tiptap can produce: `p`, `strong`, `em`, `u`, `s`, `code`, `pre`, `ul`, `ol`, `li`, `blockquote`, `a`, `hr`, `br`, `img`.
- **File upload validation**: Check MIME type against an allowlist on the server. Reject executable files (`.exe`, `.sh`, `.bat`, etc.).
- **S3 key construction**: Sanitize filenames to prevent path traversal. Use UUID-based keys with original filename stored only in the database.
- **Content size limit**: Max `contentHtml` size: 50KB. Max `contentJson` size: 100KB. Reject comments exceeding these limits.

---

## Completion Notes

Implemented as planned with Tiptap editor and full CRUD API routes.

### New files
- `src/lib/db/schema/comments.ts` -- comments + comment_attachments tables with relations
- `src/lib/validations/comments.ts` -- Zod schemas for create/update
- `src/lib/utils/sanitize.ts` -- sanitize-html config (allowlist: p, strong, em, u, s, code, pre, ul, ol, li, blockquote, a, hr, br, img)
- `src/app/api/comments/route.ts` -- POST (create + recordActivity) and GET (list with attachments)
- `src/app/api/comments/[commentId]/route.ts` -- PATCH (update) and DELETE (cascade + remove activity event via JSONB match)
- `src/app/api/comments/[commentId]/attachments/route.ts` -- POST (upload to S3, 25MB max, 10 per comment)
- `src/app/api/comments/[commentId]/attachments/[attachmentId]/route.ts` -- DELETE (remove S3 + DB)
- `src/components/activity/comment-editor.tsx` -- Tiptap editor with collapsed/expanded states, toolbar, Ctrl+Enter submit
- `src/components/activity/comment-item.tsx` -- Comment rendering in timeline with edit/delete actions
- `src/components/activity/comment-attachment-list.tsx` -- Attachment thumbnails for images, file cards for non-images

### Dependencies added
- @tiptap/react, @tiptap/pm, @tiptap/starter-kit, @tiptap/extension-underline, @tiptap/extension-link, @tiptap/extension-code-block-lowlight, @tiptap/extension-placeholder
- lowlight (syntax highlighting), sanitize-html, @types/sanitize-html

### Integration
- Comments interleave with activity events in the timeline via Option A (activity_events row with metadata.commentId)
- Comment editor sits above the timeline for natural write-then-see flow
- Tiptap CSS styles added to globals.css under `.tiptap-content`
- S3 keys at `gold/comments/{entityType}/{entityId}/{commentId}/{fileId}.{ext}`
