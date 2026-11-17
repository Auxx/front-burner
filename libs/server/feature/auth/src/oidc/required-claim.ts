import type { RequiredClaim } from '@front-burner/server-core-config';

/**
 * Whether the ID token's claims carry the required claim (LG-69; temporary MVP
 * measure): a string equal to the value, or an array that contains one. Any
 * other type, or a missing claim, does not match.
 */
export function matchesRequiredClaim(
  claims: Readonly<Record<string, unknown>>,
  required: RequiredClaim
): boolean {
  if (!Object.hasOwn(claims, required.name)) {
    return false;
  }
  const claim = claims[required.name];
  if (Array.isArray(claim)) {
    return claim.some(item => item === required.value);
  }
  return claim === required.value;
}
