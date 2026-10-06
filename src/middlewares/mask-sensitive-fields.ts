type AnyRecord = Record<string, unknown>;

interface KoaContext {
  body?: unknown;
}

/** Response fields whose trailing digits are hidden from API consumers. */
const SENSITIVE_FIELDS: readonly string[] = ['Mobile', 'IDcard'];

const MASK = 'xxx';

const isRecord = (value: unknown): value is AnyRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const maskTail = (value: string): string => {
  if (value.endsWith(MASK) || value.length <= MASK.length) {
    return value;
  }

  return `${value.slice(0, -MASK.length)}${MASK}`;
};

/**
 * Masks in place and never reassigns `ctx.body`, so streaming responses are left alone.
 */
const maskInPlace = (node: unknown): void => {
  if (Array.isArray(node)) {
    node.forEach(maskInPlace);
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && SENSITIVE_FIELDS.includes(key)) {
      node[key] = maskTail(value);
      continue;
    }

    maskInPlace(value);
  }
};

/**
 * Hides the last three digits of `Mobile` and `IDcard` in every HTTP response.
 *
 * This runs on the response rather than in a content-type lifecycle because Strapi
 * reuses the same entity object while copying a draft into its published row, and it
 * ignores the return value of `after*` hooks. Masking in a lifecycle therefore writes
 * the masked value straight back into the database.
 */
export default () => {
  return async (ctx: KoaContext, next: () => Promise<void>): Promise<void> => {
    await next();

    maskInPlace(ctx.body);
  };
};