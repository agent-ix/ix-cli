/**
 * FR-042 — `ix local auth tenant {list,add,set-default,remove}`
 *
 * Membership administration via identity FR-033
 * (`/admin/users/{user_id}/memberships`). All four verbs share the
 * email → user_id resolver and surface one `Listing` per command.
 *
 * Per FR-033-CON-6 the runtime gate is K8s RBAC on pods/exec; the in-pod
 * handler is JWT-blind. `kubectlRaw` calls go through that path; no public
 * ingress.
 *
 * Email → user_id resolution uses identity FR-036
 * (`POST /internal/users/lookup`), which shares the same runtime gate.
 * The earlier JWT-gated `GET /admin/users?q=` path was wrong for this
 * command suite — see `resolveUserIdByEmail` below.
 */

import {
  FlowLine,
  Group,
  Info,
  Item,
  Listing,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import {
  IX_AUTH_NAMESPACE,
  identityServicePath,
  kubectlRaw,
} from "./auth-identity.js";

type RawFn = typeof kubectlRaw;

export interface TenantDeps {
  kubectlRaw?: RawFn;
}

interface UserLookupResponse {
  user_id: string;
  email: string;
  username: string;
  display_name?: string | null;
  status: string;
  default_tenant_id?: string | null;
}

interface MembershipRead {
  tenant_id: string;
  tenant_name?: string | null;
  role: string;
  is_default: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MembershipListResponse {
  memberships: MembershipRead[];
}

interface ErrorBody {
  error?: string;
  hint?: string;
  detail?: string | { error?: string; detail?: string; hint?: string };
}

async function renderFailure(header: string, msg: string): Promise<void> {
  await renderStatic(
    <Listing
      header={header}
      status="failed"
      tail={`${header} failed: ${msg}`}
      tailVariant="error"
    />,
  );
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as ErrorBody;
    let code: string | undefined;
    let hint: string | undefined;
    let detail: string | undefined;
    if (typeof b.error === "string") code = b.error;
    if (typeof b.hint === "string") hint = b.hint;
    if (b.detail && typeof b.detail === "object") {
      code = code ?? b.detail.error;
      hint = hint ?? b.detail.hint;
      detail = detail ?? b.detail.detail;
    } else if (typeof b.detail === "string") {
      detail = b.detail;
    }
    const friendly = (() => {
      switch (code) {
        case "membership_exists":
          return "Membership already exists for this user+tenant.";
        case "membership_not_found":
          return "No such membership for this user+tenant.";
        case "tenant_not_found":
          return "Tenant does not exist or is not active.";
        case "user_not_found":
          return "User does not exist.";
        case "bad_request":
          return "Invalid lookup request (expected exactly one of email or username).";
        case "target_rate_limited":
          return "Lookup rate limit exceeded for this email/username; back off and retry.";
        case "suspended_cannot_set_default":
          return "Cannot promote a suspended membership to default in a single call.";
        case "would_violate_default_invariant":
          return (
            "Refusing to leave the user with no active default membership." +
            (hint ? ` Hint: ${hint}` : "")
          );
        case "cross_tenant_admin_forbidden":
          return "Caller is not authorized to assign admin/owner in this tenant.";
        default:
          break;
      }
      return undefined;
    })();
    if (friendly) return friendly;
    return `HTTP ${status}: ${code ?? detail ?? "unknown_error"}`;
  }
  return `HTTP ${status}`;
}

/**
 * Resolve an email (or username) to a user_id via identity FR-036
 * (`POST /internal/users/lookup`). Uses the same in-pod-exec runtime gate
 * (FR-034 RBAC on pods/exec) as the FR-033 membership endpoints called by
 * the rest of this module — keeping the whole FR-042 command suite on a
 * single auth mechanism. The prior JWT-gated `GET /admin/users?q=` path
 * would have required a different gate and 401'd on real clusters.
 *
 * Heuristic: if the input contains an `@`, treat it as an email; otherwise
 * treat it as a username. The endpoint requires exactly one of the two.
 */
async function resolveUserIdByEmail(
  raw: RawFn,
  emailOrUsername: string,
): Promise<string> {
  const isEmail = emailOrUsername.includes("@");
  const reqBody: { email?: string; username?: string } = isEmail
    ? { email: emailOrUsername }
    : { username: emailOrUsername };
  const { status, body } = await raw<UserLookupResponse | ErrorBody>(
    IX_AUTH_NAMESPACE,
    identityServicePath("/internal/users/lookup"),
    "POST",
    reqBody,
  );
  if (status === 404) {
    throw new Error(`No user matched "${emailOrUsername}".`);
  }
  if (status !== 200) {
    throw new Error(
      `Could not resolve user "${emailOrUsername}": ${errorMessage(status, body)}`,
    );
  }
  return (body as UserLookupResponse).user_id;
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface TenantListOptions {
  emailOrUsername: string;
}

export async function runAuthTenantList(
  _config: IxConfig,
  opts: TenantListOptions,
  deps?: TenantDeps,
): Promise<void> {
  const HEADER = "ix local auth tenant list";
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  try {
    const userId = await resolveUserIdByEmail(_raw, opts.emailOrUsername);
    const { status, body } = await _raw<MembershipListResponse | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath(`/admin/users/${userId}/memberships`),
      "GET",
    );
    if (status !== 200) {
      throw new Error(errorMessage(status, body));
    }
    const memberships = (body as MembershipListResponse).memberships ?? [];

    await renderStatic(
      <Listing
        header={HEADER}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Listing memberships for ${blue(opts.emailOrUsername)}`}</FlowLine>
        }
        tail={`${memberships.length} membership(s).`}
      >
        {memberships.map((m) => (
          <Item
            key={`${m.tenant_id}`}
            name={`${blue(m.tenant_name ?? m.tenant_id)} (${m.role}${m.is_default ? ", default" : ""}, ${m.status})`}
          />
        ))}
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(HEADER, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

export interface TenantAddOptions {
  emailOrUsername: string;
  tenantId: string;
  role: "member" | "admin" | "owner";
  isDefault: boolean;
}

export async function runAuthTenantAdd(
  _config: IxConfig,
  opts: TenantAddOptions,
  deps?: TenantDeps,
): Promise<void> {
  const HEADER = "ix local auth tenant add";
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  try {
    const userId = await resolveUserIdByEmail(_raw, opts.emailOrUsername);
    const { status, body } = await _raw<MembershipRead | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath(`/admin/users/${userId}/memberships`),
      "POST",
      {
        tenant_id: opts.tenantId,
        role: opts.role,
        is_default: opts.isDefault,
      },
    );
    if (status !== 200 && status !== 201) {
      throw new Error(errorMessage(status, body));
    }
    const m = body as MembershipRead;
    await renderStatic(
      <Listing
        header={HEADER}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Adding ${blue(opts.role)} membership for ${blue(opts.emailOrUsername)} → ${blue(opts.tenantId)}`}</FlowLine>
        }
        tail="Membership added."
      >
        <Info name="Tenant" description={blue(m.tenant_id)} />
        <Info name="Role" description={m.role} />
        <Info name="Default" description={String(m.is_default)} />
        <Info name="Status" description={m.status} />
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(HEADER, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// set-default
// ---------------------------------------------------------------------------

export interface TenantSetDefaultOptions {
  emailOrUsername: string;
  tenantId: string;
}

export async function runAuthTenantSetDefault(
  _config: IxConfig,
  opts: TenantSetDefaultOptions,
  deps?: TenantDeps,
): Promise<void> {
  const HEADER = "ix local auth tenant set-default";
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  try {
    const userId = await resolveUserIdByEmail(_raw, opts.emailOrUsername);
    const { status, body } = await _raw<MembershipRead | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath(
        `/admin/users/${userId}/memberships/${opts.tenantId}`,
      ),
      "PATCH",
      { is_default: true },
    );
    if (status !== 200) {
      throw new Error(errorMessage(status, body));
    }
    const m = body as MembershipRead;
    await renderStatic(
      <Listing
        header={HEADER}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Setting default tenant for ${blue(opts.emailOrUsername)} → ${blue(opts.tenantId)}`}</FlowLine>
        }
        tail="Default tenant updated."
      >
        <Info name="Tenant" description={blue(m.tenant_id)} />
        <Info name="Default" description={String(m.is_default)} />
        <Info name="Status" description={m.status} />
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(HEADER, msg);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export interface TenantRemoveOptions {
  emailOrUsername: string;
  tenantId: string;
}

export async function runAuthTenantRemove(
  _config: IxConfig,
  opts: TenantRemoveOptions,
  deps?: TenantDeps,
): Promise<void> {
  const HEADER = "ix local auth tenant remove";
  const _raw = deps?.kubectlRaw ?? kubectlRaw;
  try {
    const userId = await resolveUserIdByEmail(_raw, opts.emailOrUsername);
    const { status, body } = await _raw<unknown | ErrorBody>(
      IX_AUTH_NAMESPACE,
      identityServicePath(
        `/admin/users/${userId}/memberships/${opts.tenantId}`,
      ),
      "DELETE",
    );
    if (status !== 204 && status !== 200) {
      throw new Error(errorMessage(status, body));
    }
    await renderStatic(
      <Listing
        header={HEADER}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`Removing membership ${blue(opts.emailOrUsername)} ✕ ${blue(opts.tenantId)}`}</FlowLine>
        }
        tail="Membership removed."
      >
        <Group name="removed">
          <Item name={`${opts.emailOrUsername} → ${opts.tenantId}`} />
        </Group>
      </Listing>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderFailure(HEADER, msg);
    throw err;
  }
}
