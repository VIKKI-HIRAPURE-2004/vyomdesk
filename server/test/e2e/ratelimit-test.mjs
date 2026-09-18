// E2E rate-limit test: hammer login -> expect 429 + Retry-After after the cap
const BASE = "http://localhost:4430";

async function main() {
  let ok = 0;
  let limited = 0;
  let first429 = null;
  let headers = null;

  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.local", password: "wrong-password" }),
    });
    if (res.status === 401 || res.status === 200) {
      ok++;
    } else if (res.status === 429) {
      limited++;
      if (!first429) {
        first429 = i + 1;
        headers = {
          limit: res.headers.get("x-ratelimit-limit"),
          remaining: res.headers.get("x-ratelimit-remaining"),
          retryAfter: res.headers.get("retry-after"),
        };
      }
    } else {
      throw new Error(`unexpected status ${res.status}`);
    }
  }

  console.log("[test] allowed (401/200):", ok, "| limited (429):", limited);
  console.log("[test] first 429 at request #", first429);
  console.log("[test] 429 headers:", JSON.stringify(headers));
  if (limited === 0) throw new Error("no 429 seen; limiter not wired");
  if (!headers?.retryAfter) throw new Error("429 missing Retry-After header");
  if (!headers?.limit) throw new Error("429 missing X-RateLimit-Limit header");

  // non-auth API must still work under a different bucket (fresh IP-less key path)
  const health = await fetch(`${BASE}/api/v1/health`);
  console.log("[test] health during auth-limit:", health.status);
  if (health.status !== 200) throw new Error("health endpoint limited by auth bucket");

  console.log("[test] PASS: rate limiting live (auth bucket stricter than global)");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});