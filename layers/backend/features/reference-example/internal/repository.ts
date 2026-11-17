import { defineQuery, executeQuery } from "@framework-core/data";
import type {
  CreateReferenceExampleInput,
  ReferenceExampleItem,
} from "@contracts/reference-example";

const itemsStore: ReferenceExampleItem[] = [
  {
    id: "ref-1",
    title: "Golden Reference Item",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const listItemsQuery = defineQuery<void, ReadonlyArray<ReferenceExampleItem>>({
  name: "reference-example.list",
  run: () => [...itemsStore],
});

const createItemQuery = defineQuery<CreateReferenceExampleInput, ReferenceExampleItem>({
  name: "reference-example.create",
  run: (input) => {
    const item: ReferenceExampleItem = {
      id: `ref-${itemsStore.length + 1}`,
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    itemsStore.push(item);
    return item;
  },
});

export async function listReferenceItems(): Promise<ReadonlyArray<ReferenceExampleItem>> {
  return await executeQuery(listItemsQuery, undefined);
}

export async function createReferenceItem(
  input: CreateReferenceExampleInput,
): Promise<ReferenceExampleItem> {
  return await executeQuery(createItemQuery, input);
}
