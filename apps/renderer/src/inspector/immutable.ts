// Immutable edits for the settings forms.
export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((existing, i) => (i === index ? item : existing));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Sets an optional property, or removes it when `value` is undefined. The model treats "absent" as the unset state. */
export function setOptional<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined): T {
  const copy = { ...object };
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy;
}
