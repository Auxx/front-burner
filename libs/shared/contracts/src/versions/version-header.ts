/**
 * The response header that carries the instance's version (NF-7.6): every
 * response but the health probes' has it, and a tab left open across an
 * upgrade compares it with its own (A-8.7).
 */
export const VERSION_HEADER = 'X-Front-Burner-Version';
