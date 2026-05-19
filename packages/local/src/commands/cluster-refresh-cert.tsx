/**
 * Re-issue the cluster's wildcard + ingress TLS certs to cover the
 * currently-configured `domain.hosts`. Always re-applies and waits;
 * useful when `domain.hosts` was changed after `init-cluster`.
 */

import {
  FlowLine,
  Item,
  Listing,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";
import type { IxConfig } from "../config.js";
import {
  applyClusterCerts,
  ensureClusterCertCoversHosts,
  getCertSans,
} from "../cluster-cert.js";

const HEADER = "ix local cluster refresh-cert";
const INGRESS_TLS_SECRET = "ix-tls";
const INGRESS_TLS_NAMESPACE = "ingress-nginx";

export interface ClusterRefreshCertOpts {
  /** When true, only re-issue if the existing cert is missing or stale. */
  ifNeeded?: boolean;
}

export async function runClusterRefreshCert(
  config: IxConfig,
  opts: ClusterRefreshCertOpts = {},
): Promise<void> {
  const before = await getCertSans(INGRESS_TLS_SECRET, INGRESS_TLS_NAMESPACE);

  let refreshed: boolean;
  try {
    const certOpts = { waitTimeoutSeconds: config.certWaitTimeoutSeconds };
    if (opts.ifNeeded) {
      ({ refreshed } = await ensureClusterCertCoversHosts(
        config.hosts,
        certOpts,
      ));
    } else {
      await applyClusterCerts(config.hosts, certOpts);
      refreshed = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={HEADER}
        status="failed"
        tail={msg}
        tailVariant="error"
      />,
    );
    throw err;
  }

  const after = refreshed
    ? await getCertSans(INGRESS_TLS_SECRET, INGRESS_TLS_NAMESPACE)
    : before;
  const sans = after ?? [];
  const tail = refreshed
    ? `Re-issued ${INGRESS_TLS_SECRET} for hosts: ${config.hosts.join(", ")}`
    : `Cert already covers configured hosts (${config.hosts.join(", ")}); no action.`;

  await renderStatic(
    <Listing
      header={HEADER}
      status="passed"
      variant="flow"
      pre={
        <FlowLine>{`${refreshed ? "Re-issuing" : "Verifying"} ${blue(INGRESS_TLS_SECRET)} for ${blue(config.hosts.join(", "))}`}</FlowLine>
      }
      tail={tail}
    >
      {sans.map((dns) => (
        <Item key={dns} name={dns} description="DNS SAN" />
      ))}
    </Listing>,
  );
}
