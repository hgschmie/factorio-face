// Types of locale.mjs for the TypeScript that imports it.
export function parseLocale(text: string, sections: readonly string[]): Record<string, Record<string, string>>;
export function readLocaleSections(dataDir: string, modules: readonly string[], sections: readonly string[], language?: string): Record<string, Record<string, string>>;
