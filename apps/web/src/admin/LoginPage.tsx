import { useState } from "react";
import { AdminApiError, bootstrap, login, setCsrfToken } from "./api.js";

export function LoginPage(props: { onAuthenticated: (csrfToken: string) => void }) {
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"bootstrap" | "login">("bootstrap");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = mode === "bootstrap" ? await bootstrap(token) : await login(token);
      if (session.csrfToken) {
        setCsrfToken(session.csrfToken);
        props.onAuthenticated(session.csrfToken);
      }
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-login">
      <div className="checkout__banner">SIMULATOR ADMIN -- no real payment data</div>
      <form className="admin-login__form" onSubmit={(e) => void submit(e)}>
        <h1>Sign in</h1>
        <div className="admin-login__mode">
          <label>
            <input type="radio" checked={mode === "bootstrap"} onChange={() => setMode("bootstrap")} />
            First-run bootstrap token (printed once in the server logs)
          </label>
          <label>
            <input type="radio" checked={mode === "login"} onChange={() => setMode("login")} />
            Admin recovery token (SIM_ADMIN_TOKEN)
          </label>
        </div>
        <input
          type="password"
          autoComplete="off"
          placeholder="Paste token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        {error && <p className="checkout__error">{error}</p>}
        <button type="submit" disabled={busy || token.length === 0}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
