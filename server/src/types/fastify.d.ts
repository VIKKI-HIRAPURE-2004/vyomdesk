import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthUser } from "../../services/authService.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: (req: FastifyRequest) => Promise<void>;
    errors: typeof import("../../util/errors.js").Errors;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}
