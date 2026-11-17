import type { FastifyInstance } from "fastify";
import {
  CreateReferenceExampleInputSchema,
  REFERENCE_EXAMPLE_ROUTES,
} from "@contracts/reference-example";
import { createReferenceItem, listReferenceItems } from "./repository";

export async function registerReferenceExampleHandlers(app: FastifyInstance): Promise<void> {
  app.get(REFERENCE_EXAMPLE_ROUTES.list, async () => {
    const items = await listReferenceItems();
    return { items };
  });

  app.post(REFERENCE_EXAMPLE_ROUTES.create, async (request, reply) => {
    const parsed = CreateReferenceExampleInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request payload",
        issues: parsed.error.issues,
      });
    }
    const item = await createReferenceItem(parsed.data);
    return reply.code(201).send({ item });
  });
}
