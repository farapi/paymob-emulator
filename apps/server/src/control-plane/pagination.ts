// Opaque cursor pagination (spec 16.1: "Never use offset pagination for
// timeline tables" -- the cursor is base64-encoded, callers never see or
// construct an offset directly, and the return shape hides pagination
// implementation details).

export interface PageParams {
  limit: number;
  cursorOffset: number;
}

export function parsePageParams(query: { limit?: string; cursor?: string }): PageParams {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? "50", 10) || 50));
  let cursorOffset = 0;
  if (query.cursor) {
    try {
      cursorOffset = Number.parseInt(Buffer.from(query.cursor, "base64url").toString("utf-8"), 10) || 0;
    } catch {
      cursorOffset = 0;
    }
  }
  return { limit, cursorOffset };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf-8").toString("base64url");
}

export interface PagedResult<T> {
  data: T[];
  page: { nextCursor: string | null };
}

export function paginate<T>(rows: T[], params: PageParams): PagedResult<T> {
  const page = rows.slice(params.cursorOffset, params.cursorOffset + params.limit);
  const nextOffset = params.cursorOffset + params.limit;
  return {
    data: page,
    page: { nextCursor: nextOffset < rows.length ? encodeCursor(nextOffset) : null },
  };
}
