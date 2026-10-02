/**
 * Normaliza texto para comparação: minúsculas, sem acento, espaços simples.
 * "Conta de Água — Sabesp" vira "conta de agua — sabesp".
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapa um termo para uso dentro de uma RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Procura um termo como palavra inteira. Necessário para termos curtos:
 * "oi" (a operadora) não pode casar com "oito", nem "net" com "internet".
 */
export function hasWord(normalizedText: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`).test(normalizedText);
}

/** Plural simples: plural(3, 'dívida') → "3 dívidas". */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = count === 1 ? singular : pluralForm ?? `${singular}s`;
  return `${count} ${word}`;
}

/** Junta itens como em português: "a, b e c". */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
