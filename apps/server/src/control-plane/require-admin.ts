import { SESSION_COOKIE_NAME, authenticateAdminRequest, type AuthContext } from "./auth.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequest = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReply = any;

export function requireAdmin(ctx: AuthContext) {
  return async (req: AnyRequest, reply: AnyReply) => {
    const sessionToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    const result = authenticateAdminRequest(
      ctx,
      {
        authorization: req.headers.authorization,
        "x-csrf-token": req.headers["x-csrf-token"] as string | undefined,
      },
      sessionToken,
    );
    if (!result.ok) {
      return reply
        .code(result.status)
        .send({ error: { code: result.code, message: "admin authentication required", details: {} } });
    }
  };
}
