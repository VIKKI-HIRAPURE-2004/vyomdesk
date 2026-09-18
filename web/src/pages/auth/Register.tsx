import { FormEvent, useState } from "react";
import { useAuth } from "../../stores/auth.js";
import { ApiError } from "../../api/client.js";

export default function Register() {
  const register = useAuth((s) => s.register);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await register(email, name, password);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">
            Vyom<span className="text-brand-400">Desk</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">Create your free account</p>
        </div>
        <form
          onSubmit={submit}
          className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-slate-300 mb-1" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1" htmlFor="password">
              Password (min 8 chars)
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 py-2 font-medium transition"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
          <p className="text-center text-sm text-slate-400">
            Already have an account?{" "}
            <a href="/login" className="text-brand-400 hover:underline">
              Sign in
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
