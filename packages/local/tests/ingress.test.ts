import { describe, expect, it } from "vitest";
import { ingressUrlsFromManifest } from "../src/ingress.js";

describe("ingressUrlsFromManifest", () => {
  it("collects TLS ingress hosts in rendered order", () => {
    const manifest = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: auth
spec:
  tls:
    - hosts:
        - auth.dev.ix
        - auth.luna.ix
      secretName: ix-wildcard-tls
  rules:
    - host: auth.dev.ix
      http: { paths: [] }
    - host: auth.luna.ix
      http: { paths: [] }
`;

    expect(ingressUrlsFromManifest(manifest)).toEqual([
      "https://auth.dev.ix",
      "https://auth.luna.ix",
    ]);
  });

  it("uses http for non-TLS hosts and de-dupes repeated rules", () => {
    const manifest = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
spec:
  rules:
    - host: api.dev.ix
      http: { paths: [] }
    - host: api.dev.ix
      http: { paths: [] }
---
apiVersion: v1
kind: Service
metadata:
  name: ignored
`;

    expect(ingressUrlsFromManifest(manifest)).toEqual(["http://api.dev.ix"]);
  });

  it("returns an empty list when no ingress hosts are rendered", () => {
    expect(
      ingressUrlsFromManifest(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: no-ingress
`),
    ).toEqual([]);
  });
});
