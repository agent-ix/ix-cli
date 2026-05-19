import type * as React from "react";
import { vi } from "vitest";

/**
 * Shared test helper for code that renders final-state listings via
 * `renderStatic(<Listing ...>)`. Replaces ix-ui-cli with string-typed stubs
 * so React elements stay introspectable, and exposes a record of the calls.
 *
 * Usage:
 *   vi.mock("@agent-ix/ix-ui-cli", () => makeListingMock());
 *   import * as ui from "@agent-ix/ix-ui-cli";
 *   const calls = (ui as unknown as ListingMockBag).__calls;
 */
export interface ListingCall {
  header?: string;
  status?: string;
  tail?: unknown;
  tailVariant?: string;
  notes: string[];
  items: { name?: unknown; description?: unknown }[];
  groups: { name?: unknown }[];
  texts: string[];
}

export interface ListingMockBag {
  __calls: ListingCall[];
  __reset: () => void;
}

interface ListingElement {
  type: unknown;
  props: {
    header?: string;
    status?: string;
    tail?: unknown;
    tailVariant?: string;
    children?: unknown;
  };
}

interface ChildElement {
  type: unknown;
  props: { children?: unknown; name?: unknown; description?: unknown };
}

function flattenChildren(children: unknown): ChildElement[] {
  if (children == null || children === false) return [];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  if (typeof children === "object") return [children as ChildElement];
  return [];
}

function childText(child: ChildElement): string {
  const c = child.props.children;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(String).join("");
  return String(c ?? "");
}

export function makeListingMock(extra: Record<string, unknown> = {}) {
  const calls: ListingCall[] = [];

  const Listing = "Listing" as unknown as React.FC;
  const Note = "Note" as unknown as React.FC;
  const Item = "Item" as unknown as React.FC;
  const Group = "Group" as unknown as React.FC;
  const Text = "Text" as unknown as React.FC;
  const FlowLine = "FlowLine" as unknown as React.FC;
  const Box = "Box" as unknown as React.FC;
  const PhaseTable = "PhaseTable" as unknown as React.FC;
  const ConfirmPrompt = "ConfirmPrompt" as unknown as React.FC;
  const PasswordPrompt = "PasswordPrompt" as unknown as React.FC;

  const recordListing = (el: ListingElement): void => {
    if (el == null || el.type !== Listing) return;
    const children = flattenChildren(el.props.children);
    const call: ListingCall = {
      header: el.props.header,
      status: el.props.status,
      tail: el.props.tail,
      tailVariant: el.props.tailVariant,
      notes: [],
      items: [],
      groups: [],
      texts: [],
    };
    for (const c of children) {
      if (c.type === Note) call.notes.push(childText(c));
      else if (c.type === Item)
        call.items.push({
          name: c.props.name,
          description: c.props.description,
        });
      else if (c.type === Group) call.groups.push({ name: c.props.name });
      else if (c.type === Text) call.texts.push(childText(c));
    }
    calls.push(call);
  };

  const renderStatic = vi.fn(async (el: ListingElement) => {
    recordListing(el);
  });
  const render = vi.fn(async () => ({ cancelled: false }));

  return {
    Listing,
    Note,
    Item,
    Group,
    Text,
    FlowLine,
    Box,
    PhaseTable,
    ConfirmPrompt,
    PasswordPrompt,
    renderStatic,
    render,
    useRenderResult: () => ({ exit: () => {}, setResult: () => {} }),
    blue: (s: string) => s,
    colors: {
      dim: (s: string) => s,
      cyan: (s: string) => s,
      bold: (s: string) => s,
    },
    __calls: calls,
    __reset: () => {
      calls.length = 0;
    },
    ...extra,
  };
}
