import type { TierEntry } from './tier-catalog';

export interface LicenseValidation {
  valid: boolean;
  /** The tier the license entitles the user to, when valid. */
  tier?: TierEntry;
  /** Reason a license was rejected — useful for support tooling. */
  reason?: string;
  /** Optional expiry hint for non-lifetime SKUs. */
  expiresAt?: Date;
}

export interface CheckoutSession {
  /** URL the client redirects to in order to complete payment. */
  url: string;
  /** Provider-specific session id (echoed back on webhook). */
  sessionId: string;
}

/**
 * Pluggable license / checkout provider. Stripe is the default; partners like
 * garamond.ink may handle their own SKUs and report results back via webhook.
 *
 * Implementations are wired in Phase 2 — this interface exists now so the
 * tier catalog has a typed extension point that later work can target.
 */
export interface LicenseProvider {
  readonly id: string;

  /**
   * Validate a license key (or session token) issued by this provider.
   * Implementations may consult their own backend or a cached entitlement.
   */
  validateLicense(license: string): Promise<LicenseValidation>;

  /**
   * Start a checkout flow for `tier`. Returns a URL the user follows to pay.
   * Implementations that don't support self-serve checkout (e.g. enterprise
   * contracts) may return `null` and rely on out-of-band sales.
   */
  createCheckoutSession(
    tier: TierEntry,
    userId: string,
    options?: { seats?: number; successUrl?: string; cancelUrl?: string }
  ): Promise<CheckoutSession | null>;
}

/**
 * Stub provider for the garamond.ink sales integration.
 *
 * Wiring is blocked on the actual sales config — garamond.ink's public pages
 * do not expose SKUs, checkout, or API. Once those land, replace the bodies
 * below with real calls. Until then, this class exists so the rest of the
 * system can be wired against a typed interface without crashing.
 */
export class GaramondLicenseProvider implements LicenseProvider {
  readonly id = 'garamond';

  async validateLicense(_license: string): Promise<LicenseValidation> {
    return {
      valid: false,
      reason:
        'GaramondLicenseProvider not yet wired — sales config from garamond.ink pending',
    };
  }

  async createCheckoutSession(
    _tier: TierEntry,
    _userId: string
  ): Promise<CheckoutSession | null> {
    // Enterprise SKUs go through sales; no self-serve checkout url to return.
    return null;
  }
}
