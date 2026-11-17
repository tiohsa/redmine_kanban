import { z } from "zod";

export const ReferenceExampleItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
});

export type ReferenceExampleItem = z.infer<typeof ReferenceExampleItemSchema>;

export const CreateReferenceExampleInputSchema = z.object({
  title: z.string().min(1).max(120),
});

export type CreateReferenceExampleInput = z.infer<typeof CreateReferenceExampleInputSchema>;

export const ListReferenceExamplesOutputSchema = z.object({
  items: z.array(ReferenceExampleItemSchema),
});

export type ListReferenceExamplesOutput = z.infer<typeof ListReferenceExamplesOutputSchema>;

export const CreateReferenceExampleOutputSchema = z.object({
  item: ReferenceExampleItemSchema,
});

export type CreateReferenceExampleOutput = z.infer<typeof CreateReferenceExampleOutputSchema>;

export const REFERENCE_EXAMPLE_ROUTES = {
  list: "/api/reference-example",
  create: "/api/reference-example",
} as const;
