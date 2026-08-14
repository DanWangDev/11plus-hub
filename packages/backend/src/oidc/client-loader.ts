// This module previously provided static OIDC client loading and a
// timing-safe secret verifier. Both became dead when the provider switched
// to the dynamic pg-adapter client model (clients load from the registry
// with a 60s cache) and the SHA-256-at-rest comparison moved into
// oidc-provider via the secret-auth middleware.
export {}
