import { useState } from "react";
import { Lock01 } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { BadgeWithDot } from "@/components/base/badges/badges";
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary px-4">
      <BadgeWithDot type="pill-color" size="md" color="warning">
        Simulator admin -- no real payment data
      </BadgeWithDot>
      <form
        onSubmit={(e) => void submit(e)}
        className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-secondary bg-primary p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-secondary">
            <Lock01 className="size-5 text-brand-secondary" />
          </div>
          <h1 className="text-lg font-semibold text-primary">Sign in</h1>
        </div>

        <RadioGroup value={mode} onChange={(v) => setMode(v as "bootstrap" | "login")} className="gap-3">
          <RadioButton value="bootstrap" label="First-run bootstrap token" hint="Printed once in the server logs" />
          <RadioButton value="login" label="Admin recovery token" hint="SIM_ADMIN_TOKEN" />
        </RadioGroup>

        <Input
          type="password"
          isRequired
          autoComplete="off"
          label="Token"
          placeholder="Paste token"
          value={token}
          onChange={setToken}
        />

        {error && <p className="text-sm text-error-primary">{error}</p>}

        <Button type="submit" size="md" color="primary" isDisabled={busy || token.length === 0} isLoading={busy}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
