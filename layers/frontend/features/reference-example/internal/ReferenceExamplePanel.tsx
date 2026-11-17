"use client";

import { useState } from "react";
import { useManagedEffect } from "@framework-core/react";
import { scheduleOnce } from "@framework-core/timers";
import {
  CreateReferenceExampleOutputSchema,
  ListReferenceExamplesOutputSchema,
  REFERENCE_EXAMPLE_ROUTES,
  type ReferenceExampleItem,
} from "@contracts/reference-example";

export interface ReferenceExamplePanelProps {
  readonly initialItems?: ReadonlyArray<ReferenceExampleItem>;
}

export function ReferenceExamplePanel({ initialItems = [] }: ReferenceExamplePanelProps) {
  const [items, setItems] = useState<ReadonlyArray<ReferenceExampleItem>>(initialItems);
  const [title, setTitle] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useManagedEffect(() => {
    const cancel = scheduleOnce(() => {
      setStatusMessage("ready");
    }, 0);
    return cancel;
  }, []);

  async function handleRefresh() {
    const response = await fetch(REFERENCE_EXAMPLE_ROUTES.list);
    if (!response.ok) {
      setStatusMessage("error");
      return;
    }
    const parsed = ListReferenceExamplesOutputSchema.safeParse(await response.json());
    if (parsed.success) {
      setItems(parsed.data.items);
      setStatusMessage("refreshed");
    }
  }

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const response = await fetch(REFERENCE_EXAMPLE_ROUTES.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!response.ok) {
      setStatusMessage("error");
      return;
    }
    const parsed = CreateReferenceExampleOutputSchema.safeParse(await response.json());
    if (parsed.success) {
      setItems((prev) => [...prev, parsed.data.item]);
      setTitle("");
      setStatusMessage("created");
    }
  }

  return (
    <section data-feature="reference-example" data-status={statusMessage}>
      <h2>Reference Example</h2>
      <div>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New item title"
          data-action="input-title"
        />
        <button type="button" onClick={handleCreate} data-action="create-item">
          Create
        </button>
        <button type="button" onClick={handleRefresh} data-action="refresh-items">
          Refresh
        </button>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </section>
  );
}
