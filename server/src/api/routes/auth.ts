import type { FastifyInstance } from "fastify";
import type { AuthService, AuthUser } from "../../services/authService.js";

export async function authRoutes(app: FastifyInstance, auth: AuthService) {
  app.post<{ Body: { email: string; password: string; name?: string } }>(
    "/api/v1/auth/register",
    async (req, reply) => {
      const { email, password, name } = req.body ?? ({} as any);
      if (!email || !password || !name) throw app.errors.badRequest("email, name, password required");
      if (password.length < 8) throw app.errors.badRequest("password must be >= 8 chars");
      const user = await auth.register(email, name, password);
      reply.code(201);
      return { user };
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    async (req) => {
      const { email, password } = req.body ?? ({} as any);
      if (!email || !password) throw app.errors.badRequest("email and password required");
      return auth.login(email, password);
    },
  );

  app.get("/api/v1/auth/me", { preHandler: [app.auth] }, async (req) => {
    return { user: req.user } satisfies { user: AuthUser };
  });

  // User directory (admin-only): search users by email substring so the
  // Groups permission UI can resolve emails -> userId (uuid) without
  // pasting raw uuids. Also usable for future role management.
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/v1/users",
    { preHandler: [app.auth] },
    async (req, reply) => {
      if (req.user?.role !== "admin") throw app.errors.forbidden();
      const { q = "", limit } = req.query as { q?: string; limit?: string };
      const max = Math.min(Math.max(parseInt(limit ?? "50", 10) || 50, 1), 200);
      const rows = await auth.listUsers(q, max);
      reply.send({ users: rows });
    },
  );
}
