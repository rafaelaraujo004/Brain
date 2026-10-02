import type { DebtCategory } from '../types';
import { inferCategoryMentions } from './categories';
import { monthlyFromAnnual } from './money';
import { escapeRegExp, hasWord, normalize } from './text';
import type { ConversationContext, Intent, QuestionParams } from './types';

/* --- Números por extenso ---------------------------------------------- */

const WORD_VALUES: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200,
  duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/**
 * Converte números por extenso em dígitos: "cinco mil e quinhentos" vira
 * "5500". Importante para o ditado por voz e para quem escreve como fala.
 * "um"/"uma" sozinhos ficam como estão — são artigo em "um empréstimo".
 */
export function wordsToDigits(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const word = tokens[i];
    // "3 mil": o multiplicador fica como texto e é aplicado na extração.
    const afterDigits = word === 'mil' && i > 0 && /^\d/.test(tokens[i - 1]);
    if ((!(word in WORD_VALUES) && word !== 'mil') || afterDigits) {
      out.push(word);
      i++;
      continue;
    }

    let total = 0;
    let current = 0;
    let j = i;
    let consumed = 0;
    while (j < tokens.length) {
      const w = tokens[j];
      if (w === 'mil') {
        total += (current || 1) * 1000;
        current = 0;
      } else if (w in WORD_VALUES) {
        current += WORD_VALUES[w];
      } else if (w === 'e' && j + 1 < tokens.length && (tokens[j + 1] in WORD_VALUES)) {
        // "mil e quinhentos", "vinte e cinco"
      } else {
        break;
      }
      j++;
      consumed++;
    }

    const isLoneArticle = consumed === 1 && (word === 'um' || word === 'uma');
    if (isLoneArticle) {
      out.push(word);
      i++;
      continue;
    }
    out.push(String(total + current));
    i = j;
  }
  // "2 mil e 500" (dígito + extenso misturados) vira um número só.
  return out
    .join(' ')
    .replace(/(\d+(?:,\d+)?) mil e (\d{1,3})(?![\d.,])/g, (_, thousands: string, rest: string) =>
      String(Number(thousands.replace(',', '.')) * 1000 + Number(rest))
    );
}

/* --- Extração de números ---------------------------------------------- */

export type NumberRole = 'rate' | 'months' | 'principal' | 'monthly' | 'amount';

export interface NumberMention {
  value: number;
  role: NumberRole;
  index: number;
}

const NUMBER_RE =
  /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d+)?)(\s*(?:mil|k)(?![a-z]))?(\s*(?:%|por cento|x(?![a-z])|vezes|parcelas?|prestac(?:oes|ao)|meses|mes(?![a-z])|anos?(?![a-z])|reais|real|dias?(?![a-z])))?/g;

function parseNumber(raw: string): number {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number(raw);
}

const MONTH_NAMES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';

const MONTHLY_AFTER =
  /^\s*(reais\s*|real\s*)?(\/\s*mes|por mes|ao mes|mensa|todo mes|todos os meses|cada mes|de parcela|por parcela|na parcela|a parcela|mes a mes)/;
const MONTHLY_BEFORE =
  /(parcelas?|prestac(oes|ao)|parcelinhas?)( mensa\w*)?( de| no valor de| em)?\s*(r\$\s*)?$|\d+\s*(x|vezes)\s*(de\s*)?(r\$\s*)?$|(guardar|separar|reservar|juntar|poupar|economizar|sobrar|sobram|sobra)\s*(uns\s*|umas\s*)?(r\$\s*)?$/;
const PRINCIPAL_BEFORE =
  /(emprest\w*|pegar|pego|pegasse|pegando|tomar|tomasse|credito( pessoal)?|financiar|levantar|consignado|valor de|pedir|pedisse)\s*(de\s*|uns\s*|umas\s*|um\s*|uma\s*)?(r\$\s*)?$/;
const PRINCIPAL_AFTER = /^\s*(reais\s*)?(emprestad|de emprestimo|no banco|de credito|do banco)/;

/** Encontra os números da pergunta e o papel de cada um. */
export function extractNumbers(normalizedText: string): NumberMention[] {
  const text = wordsToDigits(normalizedText);
  const mentions: NumberMention[] = [];
  NUMBER_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = NUMBER_RE.exec(text))) {
    const [full, currency, rawNumber, multiplier, unitRaw] = match;
    let value = parseNumber(rawNumber);
    if (!Number.isFinite(value)) continue;
    if (multiplier) value *= 1000;

    const unit = unitRaw?.trim() ?? '';
    const before = text.slice(Math.max(0, match.index - 45), match.index);
    const after = text.slice(match.index + full.length, match.index + full.length + 45);

    // Datas e dias não são valores: "dia 10", "setembro de 2026", "15/09".
    if (/dia\s*$/.test(before) || /\/\s*$/.test(before) || /^\s*\//.test(after)) continue;
    if (!currency && !multiplier && !unit && Number.isInteger(value) && value >= 1990 && value <= 2100) {
      if (new RegExp(`(${MONTH_NAMES}|ano|em|de)\\s*$`).test(before)) continue;
    }

    if (unit === '%' || unit === 'por cento') {
      const annual = /^\s*(ao ano|a\.?\s?a\.?(?![a-z])|anual|por ano)/.test(after);
      mentions.push({ value: annual ? monthlyFromAnnual(value) : value, role: 'rate', index: match.index });
      continue;
    }
    if (/^(x|vezes|parcelas?|prestac)/.test(unit)) {
      if (value >= 1 && value <= 480) mentions.push({ value: Math.round(value), role: 'months', index: match.index });
      continue;
    }
    if (unit === 'meses' || unit === 'mes') {
      if (value >= 1 && value <= 480) mentions.push({ value: Math.round(value), role: 'months', index: match.index });
      continue;
    }
    if (unit === 'ano' || unit === 'anos') {
      mentions.push({ value: Math.round(value * 12), role: 'months', index: match.index });
      continue;
    }
    if (unit.startsWith('dia')) continue;
    if (value < 1) continue;

    let role: NumberRole = 'amount';
    if (MONTHLY_AFTER.test(after) || MONTHLY_BEFORE.test(before)) role = 'monthly';
    else if (PRINCIPAL_BEFORE.test(before) || PRINCIPAL_AFTER.test(after)) role = 'principal';

    // Número pequeno e solto sem "R$" nem "reais" quase nunca é dinheiro.
    if (role === 'amount' && !currency && !multiplier && unit !== 'reais' && unit !== 'real' && value < 10) continue;

    mentions.push({ value, role, index: match.index });
  }
  return mentions;
}

/* --- Intenção --------------------------------------------------------- */

interface IntentRule {
  intent: Intent;
  weight: number;
  pattern: RegExp;
}

const RULES: IntentRule[] = [
  // Empréstimo
  { intent: 'loan', weight: 6, pattern: /emprest/ },
  { intent: 'loan', weight: 6, pattern: /\bconsignado\b/ },
  { intent: 'loan', weight: 5, pattern: /\bcredito pessoal\b/ },
  { intent: 'loan', weight: 4, pattern: /\b(pegar|tomar|pedir) (um |uns )?(dinheiro|credito|grana)\b/ },
  { intent: 'loan', weight: 3, pattern: /\b(financeira|refinanc\w*|portabilidade)\b/ },
  { intent: 'loan', weight: 7, pattern: /\b(pegar|pego|pegasse|tomar|pedir|pedisse)\b[^?]{0,40}\bagiot/ },

  // O que pagar
  { intent: 'what_to_pay', weight: 5, pattern: /\b(o que|qual|quais)\b[^?]{0,35}\b(devo|deveria|preciso|tenho que|vale|compensa)\b[^?]{0,20}\b(pag|quit)/ },
  { intent: 'what_to_pay', weight: 5, pattern: /\b(o que|qual|quais)\b[^?]{0,20}\bpag(o|ar|amos)\b/ },
  { intent: 'what_to_pay', weight: 5, pattern: /\bpag\w* primeiro\b|\bprimeiro\b[^?]{0,15}\bpag/ },
  { intent: 'what_to_pay', weight: 4, pattern: /\bprioridad|\bprioriz/ },
  { intent: 'what_to_pay', weight: 4, pattern: /\bpor onde (comec|inici)/ },
  { intent: 'what_to_pay', weight: 5, pattern: /\b(mais urgente|mais importante|urgencia)\b/ },
  { intent: 'what_to_pay', weight: 4, pattern: /\bonde (coloco|ponho|uso|aplico|gasto|invisto)\b/ },
  { intent: 'what_to_pay', weight: 3, pattern: /\b(como|onde) (usar|gastar|dividir|distribuir|aplicar)\b/ },
  { intent: 'what_to_pay', weight: 2, pattern: /\b(tenho|recebi|ganhei|sobrou|sobraram|entrou|entraram)\b[^?]{0,20}\d/ },

  // Quantas dá para quitar
  { intent: 'how_many', weight: 7, pattern: /\bquant[ao]s\b[^?]{0,35}\b(quit|pag|resolv|elimin|zer|liquid|limp)/ },

  // Total
  { intent: 'total', weight: 5, pattern: /\bquanto\b[^?]{0,25}\b(devo|devendo|deve|em divida)\b/ },
  { intent: 'total', weight: 4, pattern: /\b(total|soma|somar|some|somatorio|somando)\b/ },
  { intent: 'total', weight: 4, pattern: /\bquanto\b[^?]{0,30}\b(atrasad|vencid|em atraso|pendente)/ },
  { intent: 'total', weight: 5, pattern: /\bquant[ao]s\b[^?]{0,25}\b(dividas?|contas?|boletos?)\b[^?]{0,25}\b(tenho|existem|estao|ha|atrasad|vencid)/ },
  { intent: 'total', weight: 3, pattern: /\b(lista|listar|mostra|mostrar|ver)\b[^?]{0,20}\b(dividas?|atrasad|contas?)\b/ },

  // Quanto tempo para sair
  { intent: 'payoff_time', weight: 6, pattern: /\bquanto tempo\b/ },
  { intent: 'payoff_time', weight: 6, pattern: /\bem quantos meses\b/ },
  { intent: 'payoff_time', weight: 6, pattern: /\bquando\b[^?]{0,35}\b(quit|sair|saio|livre|zer|fic\w* em dia|termin|acab|limp)/ },
  { intent: 'payoff_time', weight: 5, pattern: /\bsa(ir|io) d[aoe]s? (dividas?|vermelho|buraco|sufoco)/ },
  { intent: 'payoff_time', weight: 3, pattern: /\b(guardar|separar|reservar|juntar|poupar|economizar)\b/ },
  { intent: 'payoff_time', weight: 6, pattern: /\b(melhor|qual|como|que)\b[^?]{0,25}\b(forma|jeito|maneira|estrategia|caminho|plano)\b[^?]{0,25}\b(quit|pag|sair|saio|resolv|zer|limp|acab)/ },
  { intent: 'payoff_time', weight: 5, pattern: /\bcomo (eu )?(quito|quitar|pago|pagar|resolvo|resolver|saio|sair|acabo|acabar|zero|zerar)\b/ },
  { intent: 'payoff_time', weight: 6, pattern: /\bquanto\b[^?]{0,25}\b(preciso|precisaria|tenho que|teria que|devo)\b[^?]{0,25}\b(por mes|mensal|todo mes)/ },

  { intent: 'how_many', weight: 6, pattern: /\b(consigo|da pra|da para|posso|vou conseguir)\b[^?]{0,10}\b(pagar|quitar)\b[^?]{0,10}\b(tudo|todas|todos)\b/ },

  // Quanto sobra
  { intent: 'budget', weight: 5, pattern: /\bquanto\b[^?]{0,25}\b(sobra|sobrou|resta|restou|sobrando|restando|fica|ficou|livre)\b/ },
  { intent: 'budget', weight: 3, pattern: /\b(salario|orcamento|saldo)\b/ },
  { intent: 'budget', weight: 4, pattern: /\bquanto (eu )?(tenho|posso gastar)\b/ },

  // Adiar
  { intent: 'postpone', weight: 6, pattern: /\b(adiar|adio|adiaria|postergar|postergo|empurrar|empurro)\b/ },
  { intent: 'postpone', weight: 5, pattern: /\b(deixar|deixo) (pra|para) (depois|o mes que vem|o proximo mes|proximo mes)\b/ },
  { intent: 'postpone', weight: 4, pattern: /\b(qual|quais|o que)\b[^?]{0,25}\b(nao pagar|deixar de pagar|atrasar|pular)\b/ },

  // Custo / juros
  { intent: 'cost', weight: 4, pattern: /\bjuros\b/ },
  { intent: 'cost', weight: 5, pattern: /\bmais caras?\b/ },
  { intent: 'cost', weight: 4, pattern: /\b(encargos?|multas?)\b/ },
  { intent: 'cost', weight: 5, pattern: /\bquanto\b[^?]{0,30}\b(custa|custando|cresce|crescendo|aumenta|aumentando|perdendo)\b/ },

  // Renegociar
  { intent: 'renegotiate', weight: 7, pattern: /\b(renegoci\w*|negoci\w*|acordo|desconto|feirao|serasa|limpar (o )?nome|nome sujo)\b/ },

  // Diagnóstico / dicas
  { intent: 'diagnosis', weight: 4, pattern: /\b(dicas?|conselhos?|sugest\w*|orient\w*)\b/ },
  { intent: 'diagnosis', weight: 4, pattern: /\bo que (eu )?(faco|fazer|devo fazer|posso fazer)\b/ },
  { intent: 'diagnosis', weight: 4, pattern: /\b(situacao|diagnostic\w*|resumo|panorama|estrategia|plano)\b/ },
  { intent: 'diagnosis', weight: 4, pattern: /\bcomo (estou|esta|anda|estao)\b/ },
  { intent: 'diagnosis', weight: 3, pattern: /\b(me ajud\w*|socorro|desesper\w*|nao sei o que fazer)\b/ },

  // Conversa
  { intent: 'help', weight: 4, pattern: /\b(o que (voce|vc) (sabe|faz|consegue|entende)|como (funciona|te usar|usar)|exemplos?|ajuda)\b/ },
  { intent: 'greeting', weight: 2, pattern: /^(oi+|ola|bom dia|boa tarde|boa noite|e ai|eai|hey|opa)\b/ },
  { intent: 'thanks', weight: 3, pattern: /\b(obrigad\w*|valeu|brigad\w*|agradec\w*)\b/ },
];

/** Recomeços de pergunta que pedem para reaproveitar a anterior. */
const FOLLOW_UP_RE =
  /^(e|mas|e se|e com|e em|e para|e pra|e quanto|e quantas|e qual|se fosse|se for|e caso|e no caso|agora com|com)\b/;

export interface DebtReference {
  id: string;
  description: string;
  category: DebtCategory;
  groupKey: string;
}

const GENERIC_WORDS = new Set([
  'conta', 'contas', 'fatura', 'faturas', 'parcela', 'parcelas', 'mensal', 'boleto', 'divida', 'dividas',
  'pagamento', 'valor', 'casa', 'mes', 'meses', 'para', 'pra', 'com', 'sem', 'dos', 'das', 'nos', 'nas',
]);

/**
 * Dívidas citadas pelo nome. Casa a descrição inteira ou qualquer palavra
 * marcante dela (4+ letras, fora as genéricas como "conta" e "fatura").
 */
export function findDebtMentions(normalizedText: string, debts: DebtReference[]): {
  ids: string[];
  terms: string[];
} {
  const ids: string[] = [];
  const terms = new Set<string>();

  for (const debt of debts) {
    const name = normalize(debt.description.replace(/\(\d+\/\d+\)/, ''));
    if (!name) continue;
    if (name.length >= 3 && hasWord(normalizedText, name)) {
      ids.push(debt.id);
      terms.add(name);
      continue;
    }
    const words = name.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
    const hit = words.find((w) => hasWord(normalizedText, w));
    if (hit) {
      ids.push(debt.id);
      terms.add(hit);
    }
  }
  return { ids, terms: [...terms] };
}

export interface ParsedQuestion {
  raw: string;
  text: string;
  intent: Intent;
  score: number;
  params: QuestionParams;
  /** Dívidas que a pergunta citou (pelo nome ou pelo tipo) */
  debtIds: string[];
  /** Tipos citados ("energia", "cartão") */
  categories: DebtCategory[];
  isFollowUp: boolean;
}

/**
 * Lê a pergunta e decide o que está sendo perguntado e com quais números.
 *
 * Não há modelo de linguagem aqui: são regras de palavras-chave com pesos,
 * escritas para o jeito como as pessoas perguntam sobre dinheiro. Isso
 * cobre bem um domínio estreito como este — e tem a vantagem de nunca
 * inventar um número.
 */
export function parseQuestion(
  raw: string,
  debts: DebtReference[] = [],
  context?: ConversationContext
): ParsedQuestion {
  // Pontuação sai, mas o ponto de milhar fica: "5.000" continua cinco mil.
  const text = normalize(raw)
    .replace(/[!?;:]+/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mentions = findDebtMentions(text, debts);

  // O nome de uma dívida não pode virar intenção: "devo pagar o empréstimo
  // do Itaú ou a energia?" é uma comparação, não um pedido de empréstimo.
  let intentText = text;
  for (const term of mentions.terms) {
    intentText = intentText.replace(new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}(?=$|[^a-z0-9])`, 'g'), '$1 divida_citada ');
  }

  const scores = new Map<Intent, number>();
  for (const rule of RULES) {
    if (rule.pattern.test(intentText)) {
      scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
    }
  }

  const numbers = extractNumbers(text);
  const params: QuestionParams = {};
  const byRole = (role: NumberRole) => numbers.filter((n) => n.role === role).map((n) => n.value);
  const rates = byRole('rate');
  const months = byRole('months');
  const principals = byRole('principal');
  const monthlies = byRole('monthly');
  const amounts = byRole('amount');

  if (rates.length) params.ratePct = rates[0];
  if (months.length) params.months = months[0];
  if (principals.length) params.principal = Math.max(...principals);
  if (monthlies.length) params.monthly = monthlies[0];
  if (amounts.length) params.amount = Math.max(...amounts);

  // Números que só fazem sentido num empréstimo puxam a intenção para ele.
  if (params.principal) scores.set('loan', (scores.get('loan') ?? 0) + 2);
  if (params.ratePct !== undefined && !scores.has('cost')) scores.set('loan', (scores.get('loan') ?? 0) + 2);

  // "Vale pegar o empréstimo? Quais dívidas eu pagaria?" — a resposta do
  // empréstimo já diz o que quitar com o dinheiro, então ela vence.
  if ((scores.get('loan') ?? 0) >= 6) {
    scores.delete('what_to_pay');
    scores.delete('how_many');
  }

  // Duas dívidas citadas com "ou" no meio: comparação.
  const distinctGroups = new Set(
    mentions.ids.map((id) => debts.find((d) => d.id === id)?.groupKey).filter(Boolean)
  );
  if (distinctGroups.size >= 2 && /\b(ou|versus|vs|contra)\b/.test(intentText)) {
    scores.set('compare', (scores.get('compare') ?? 0) + 8);
  }

  // Cumprimento e agradecimento só valem quando a frase não pede mais nada.
  const substantive = [...scores.entries()].filter(
    ([intent]) => intent !== 'greeting' && intent !== 'thanks' && intent !== 'help'
  );
  if (substantive.length > 0) {
    scores.delete('greeting');
    scores.delete('thanks');
  }

  let intent: Intent = 'unknown';
  let score = 0;
  for (const [candidate, value] of scores) {
    if (value > score) {
      intent = candidate;
      score = value;
    }
  }

  const categories = inferCategoryMentions(text).filter(
    // "pegar um empréstimo" cita o tipo empréstimo, mas não é filtro.
    (c) => !(intent === 'loan' && (c === 'emprestimo' || c === 'financiamento'))
  );

  // Continuação da conversa: "e se fossem 24 vezes?", "e com 3 mil?".
  // Só é continuação quando a frase pede isso ("e se…") sem trazer outro
  // assunto, ou quando ela é só um número solto.
  const followUpCue = FOLLOW_UP_RE.test(text);
  const canContinue =
    context !== undefined && !['unknown', 'help', 'greeting', 'thanks'].includes(context.intent);
  let isFollowUp = false;
  if (
    context &&
    canContinue &&
    ((followUpCue && (score < 4 || intent === context.intent)) || (score === 0 && numbers.length > 0))
  ) {
    isFollowUp = true;
    intent = context.intent;
    score = Math.max(score, 3);
    const merged: QuestionParams = { ...context.params };

    if (intent === 'loan') {
      // Um valor solto numa continuação de empréstimo troca o valor pedido;
      // se a conversa ainda não tinha a parcela, ele é a parcela.
      if (params.amount !== undefined && params.principal === undefined && params.monthly === undefined) {
        if (merged.principal && !merged.monthly && params.amount < merged.principal) params.monthly = params.amount;
        else params.principal = params.amount;
        delete params.amount;
      }
      // Mudou o prazo sem dizer a parcela: a parcela antiga não vale mais
      // se a conversa tinha juros (a parcela é recalculada).
      if (params.months !== undefined && merged.ratePct !== undefined && params.monthly === undefined) {
        delete merged.monthly;
      }
    }
    if (intent === 'payoff_time' && params.amount !== undefined && params.monthly === undefined) {
      params.monthly = params.amount;
      delete params.amount;
    }
    Object.assign(merged, params);
    Object.assign(params, merged);
  }

  if (/agiot/.test(text)) params.interestOnly = true;

  // Empréstimo sem papéis explícitos: o maior valor é o empréstimo e o
  // menor é a parcela ("5000 em 12x de 500" já vem resolvido acima).
  if (intent === 'loan') {
    if (params.principal === undefined && params.amount !== undefined) {
      params.principal = params.amount;
      delete params.amount;
    }
    if (params.monthly === undefined && amounts.length >= 2) {
      params.monthly = Math.min(...amounts);
    }
  }

  return {
    raw,
    text,
    intent,
    score,
    params,
    debtIds: mentions.ids,
    categories,
    isFollowUp,
  };
}
