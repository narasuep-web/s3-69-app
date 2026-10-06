type AnyRecord = Record<string, unknown>;

interface LifecycleEvent<TParams extends AnyRecord = AnyRecord, TResult = unknown> {
  params?: TParams;
  result?: TResult;
  state?: AnyRecord;
}

const VALUE_OPERATORS = ['$eq', '$ne'];
const LIST_OPERATORS = ['$in', '$notIn'];
const NESTED_OPERATORS = ['$and', '$or', '$not'];

/**
 * Fields stored as Base64 in the database and masked on the way out.
 * `plaintext` is what the value must look like before encoding.
 */
const FIELD_SPECS = {
  Mobile: { plaintext: /^\d{10}$/ },
  IDcard: { plaintext: /^\d{13}$/ },
} as const;

type SensitiveField = keyof typeof FIELD_SPECS;

const SENSITIVE_FIELDS = Object.keys(FIELD_SPECS) as SensitiveField[];

const isSensitiveField = (key: string): key is SensitiveField =>
  Object.prototype.hasOwnProperty.call(FIELD_SPECS, key);

const isRecord = (value: unknown): value is AnyRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

const decode = (value: string): string => Buffer.from(value, 'base64').toString('utf8');

/** True when `value` is a Base64 string that decodes to valid plaintext. */
const isEncoded = (field: SensitiveField, value: string): boolean => {
  const { plaintext } = FIELD_SPECS[field];

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  const decoded = decode(value);

  // Round-tripping guards against false positives on strings that merely look like Base64.
  return plaintext.test(decoded) && encode(decoded) === value;
};

/** Base64-encode plaintext. Anything already encoded (or unrecognised) is left as-is. */
const encodeValue = (field: SensitiveField, value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const { plaintext } = FIELD_SPECS[field];

  return plaintext.test(value) ? encode(value) : value;
};

/** Decode a stored Base64 value back to plaintext. */
const decodeValue = (field: SensitiveField, value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  return isEncoded(field, value) ? decode(value) : value;
};

const encodeCondition = (field: SensitiveField, condition: unknown): unknown => {
  if (Array.isArray(condition)) {
    return condition.map((value) => encodeValue(field, value));
  }

  if (!isRecord(condition)) {
    return encodeValue(field, condition);
  }

  return Object.fromEntries(
    Object.entries(condition).map(([operator, operand]): [string, unknown] => {
      if (VALUE_OPERATORS.includes(operator)) {
        return [operator, encodeValue(field, operand)];
      }

      if (LIST_OPERATORS.includes(operator)) {
        return [
          operator,
          Array.isArray(operand)
            ? operand.map((value) => encodeValue(field, value))
            : encodeValue(field, operand),
        ];
      }

      return [operator, operand];
    })
  );
};

const encodeFilters = (node: unknown): void => {
  if (Array.isArray(node)) {
    node.forEach(encodeFilters);
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (isSensitiveField(key)) {
      node[key] = encodeCondition(key, value);
    } else if (NESTED_OPERATORS.includes(key)) {
      encodeFilters(value);
    }
  }
};

const encodeData = (data: unknown): void => {
  if (Array.isArray(data)) {
    data.forEach(encodeData);
    return;
  }

  if (!isRecord(data)) {
    return;
  }

  for (const field of SENSITIVE_FIELDS) {
    if (field in data) {
      data[field] = encodeValue(field, data[field]);
    }
  }
};

/**
 * Decodes Base64 back to plaintext in place.
 *
 * Strapi ignores the return value of `after*` hooks, so the result object must be
 * mutated. Masking must NOT happen here: the same entity object is reused while
 * Strapi copies a draft into its published row, so a masked value would be written
 * back to the database. Masking belongs on the HTTP response instead.
 */
const decodeResult = (result: unknown): void => {
  if (Array.isArray(result)) {
    result.forEach(decodeResult);
    return;
  }

  if (!isRecord(result)) {
    return;
  }

  for (const field of SENSITIVE_FIELDS) {
    if (field in result) {
      result[field] = decodeValue(field, result[field]);
    }
  }
};

const encodeFilterParams = (params?: AnyRecord): void => {
  if (!params) {
    return;
  }

  if (params.filters) {
    encodeFilters(params.filters);
  }

  if (params.where) {
    encodeFilters(params.where);
  }
};

export default {
  async beforeCreate(event: LifecycleEvent) {
    encodeData(event.params?.data);
  },

  async afterCreate(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeCreateMany(event: LifecycleEvent) {
    encodeData(event.params?.data);
  },

  async afterCreateMany(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeFindOne(event: LifecycleEvent) {
    encodeFilterParams(event.params);
  },

  async afterFindOne(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeFindMany(event: LifecycleEvent) {
    encodeFilterParams(event.params);
  },

  async afterFindMany(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeCount(event: LifecycleEvent) {
    encodeFilterParams(event.params);
  },

  async afterCount() {},

  async beforeUpdate(event: LifecycleEvent) {
    encodeFilterParams(event.params);
    encodeData(event.params?.data);
  },

  async afterUpdate(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeUpdateMany(event: LifecycleEvent) {
    encodeFilterParams(event.params);
    encodeData(event.params?.data);
  },

  async afterUpdateMany(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeDelete(event: LifecycleEvent) {
    encodeFilterParams(event.params);
  },

  async afterDelete(event: LifecycleEvent) {
    decodeResult(event.result);
  },

  async beforeDeleteMany(event: LifecycleEvent) {
    encodeFilterParams(event.params);
  },

  async afterDeleteMany() {},
};