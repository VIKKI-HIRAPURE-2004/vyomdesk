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
}
