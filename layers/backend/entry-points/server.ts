import Fastify, { type FastifyInstance } from "fastify";
import { registerReferenceExampleRoutes } from "../features/reference-example";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(registerReferenceExampleRoutes);
  return app;
}

export async function startServer(port = 3001): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.listen({ port, host: "127.0.0.1" });
  return app;
}
