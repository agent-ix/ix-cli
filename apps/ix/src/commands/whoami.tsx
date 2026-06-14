import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { hostSlug } from "@agent-ix/ix-cli-core";
import { Item, Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

import { ixTokenStore, loggedInHostSlugs } from "../auth-engine.js";

/**
 * `ix whoami [--host]` — report which Agent IX services the CLI is logged in
 * to. Reads host-keyed token metadata persisted by `ix login`
 * (ix://agent-ix/ix-cli-core/FR-017). Never renders a token value
 * (ix://agent-ix/ix-cli-core/NFR-006).
 */
export default class Whoami extends BaseCommand {
  static description = "Show which Agent IX services you are logged in to.";
  static examples = ["ix whoami", "ix whoami --host filament.dev.ix"];

  static flags = {
    host: Flags.string({
      description: "Limit output to a single service host.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Whoami);
    const store = ixTokenStore();

    const slugs = flags.host ? [hostSlug(flags.host)] : loggedInHostSlugs();

    if (slugs.length === 0) {
      await renderStatic(
        <Listing header="ix whoami" status="passed" tail="not logged in">
          <Note>Run `ix login &lt;host&gt;` to authenticate.</Note>
        </Listing>,
      );
      return;
    }

    const rows: { slug: string; meta: ReturnType<typeof store.peekMeta> }[] =
      slugs.map((slug) => ({ slug, meta: peekBySlug(store, slug) }));

    const known = rows.filter((r) => r.meta !== undefined);
    if (known.length === 0) {
      await renderStatic(
        <Listing
          header="ix whoami"
          status="passed"
          tail={flags.host ? "not logged in to that host" : "not logged in"}
        >
          <Note>Run `ix login &lt;host&gt;` to authenticate.</Note>
        </Listing>,
      );
      return;
    }

    await renderStatic(
      <Listing
        header="ix whoami"
        status="passed"
        tail={`${known.length} session(s)`}
      >
        {known.map((r) => {
          const expires = new Date(r.meta!.expiresAt);
          const expired = r.meta!.expiresAt <= Date.now();
          const audience = r.meta!.audience ?? "(default)";
          // Prefer the readable host saved at login; fall back to the storage
          // slug for entries written before the host was persisted.
          const name = r.meta!.host ?? r.slug;
          return (
            <Item
              key={r.slug}
              name={name}
              description={`audience=${audience} · ${
                expired ? "expired" : "expires"
              } ${expires.toISOString()}`}
            />
          );
        })}
      </Listing>,
    );
  }
}

/**
 * Read metadata for a stored host slug. The config keys are slugs, so we
 * address the store by slug directly — `peekMeta(host)` would re-slugify
 * (hash) the already-hashed slug and miss the entry.
 */
function peekBySlug(
  store: ReturnType<typeof ixTokenStore>,
  slug: string,
): ReturnType<typeof store.peekMetaBySlug> {
  return store.peekMetaBySlug(slug);
}
