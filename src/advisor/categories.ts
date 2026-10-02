import type { DebtCategory } from '../types';
import { hasWord, normalize } from './text';

/**
 * O que acontece quando uma dívida de cada tipo fica sem pagar.
 *
 * Multa e juros NÃO entram nas contas por padrão: só quando o usuário
 * cadastra um percentual na própria conta. Os valores "típicos" abaixo
 * aparecem apenas como referência no formulário.
 */
export interface CategoryInfo {
  label: string;
  /** Multa comum para o tipo, em % — só referência */
  typicalLateFeePercent: number;
  /** Juros mensais comuns para o tipo, em % — só referência */
  typicalMonthlyInterestPercent: number;
  /**
   * Juros sobre juros. Crédito (cartão, cheque especial, empréstimo) cobra
   * juros compostos; contas de consumo cobram juros de mora simples.
   */
  compound: boolean;
  /** Gravidade de deixar sem pagar, de 1 (quase nenhuma) a 10 (perder a casa) */
  risk: number;
  /** Ameaça moradia, serviço essencial ou liberdade — vem antes de tudo */
  essential: boolean;
  /** Consequência dita ao usuário: "risco de corte de energia" */
  consequence: string;
}

export const CATEGORY_INFO: Record<DebtCategory, CategoryInfo> = {
  moradia: {
    label: 'Moradia',
    typicalLateFeePercent: 10,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 10,
    essential: true,
    consequence: 'risco de despejo ou de perder o imóvel',
  },
  pensao: {
    label: 'Pensão',
    typicalLateFeePercent: 0,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 10,
    essential: true,
    consequence: 'pensão atrasada pode gerar execução judicial e até prisão civil',
  },
  energia: {
    label: 'Energia',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 9,
    essential: true,
    consequence: 'risco de corte de energia',
  },
  agua: {
    label: 'Água',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 9,
    essential: true,
    consequence: 'risco de corte de água',
  },
  saude: {
    label: 'Saúde',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 8,
    essential: true,
    consequence: 'o plano pode ser suspenso ou cancelado',
  },
  financiamento: {
    label: 'Financiamento',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 3,
    compound: true,
    risk: 8,
    essential: true,
    consequence: 'risco de busca e apreensão do bem',
  },
  gas: {
    label: 'Gás',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 7,
    essential: false,
    consequence: 'risco de corte do gás',
  },
  educacao: {
    label: 'Educação',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 5,
    essential: false,
    consequence: 'pode travar rematrícula e documentos',
  },
  impostos: {
    label: 'Impostos',
    typicalLateFeePercent: 10,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 5,
    essential: false,
    consequence: 'multa crescente e inscrição em dívida ativa',
  },
  telecom: {
    label: 'Internet/telefone',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 4,
    essential: false,
    consequence: 'o serviço pode ser suspenso',
  },
  cartao: {
    label: 'Cartão de crédito',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 14,
    compound: true,
    risk: 4,
    essential: false,
    consequence: 'juros do rotativo altíssimos e nome negativado',
  },
  cheque_especial: {
    label: 'Cheque especial',
    typicalLateFeePercent: 0,
    typicalMonthlyInterestPercent: 8,
    compound: true,
    risk: 4,
    essential: false,
    consequence: 'juros altos todos os dias',
  },
  emprestimo: {
    label: 'Empréstimo',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 5,
    compound: true,
    risk: 4,
    essential: false,
    consequence: 'juros de mora e nome negativado',
  },
  outros: {
    label: 'Outros',
    typicalLateFeePercent: 2,
    typicalMonthlyInterestPercent: 1,
    compound: false,
    risk: 3,
    essential: false,
    consequence: 'multa e juros de mora',
  },
  pessoal: {
    label: 'Pessoa próxima',
    typicalLateFeePercent: 0,
    typicalMonthlyInterestPercent: 0,
    compound: false,
    risk: 3,
    essential: false,
    consequence: 'sem juros, mas pesa na relação — combine um prazo',
  },
  assinatura: {
    label: 'Assinatura',
    typicalLateFeePercent: 0,
    typicalMonthlyInterestPercent: 0,
    compound: false,
    risk: 1,
    essential: false,
    consequence: 'o serviço é cortado — dá para cancelar sem prejuízo',
  },
};

/** Ordem de exibição no seletor do formulário. */
export const CATEGORY_ORDER: DebtCategory[] = [
  'moradia',
  'energia',
  'agua',
  'gas',
  'saude',
  'pensao',
  'financiamento',
  'cartao',
  'cheque_especial',
  'emprestimo',
  'telecom',
  'educacao',
  'impostos',
  'assinatura',
  'pessoal',
  'outros',
];

/**
 * Palavras que denunciam o tipo da conta. As fortes (nome do serviço ou da
 * empresa) são testadas antes das fracas ("fatura", "mensalidade"), que
 * aparecem em contas de vários tipos — "fatura da Vivo" é telefone, não
 * cartão.
 */
const KEYWORDS: Array<{ category: DebtCategory; strong: string[]; weak?: string[] }> = [
  { category: 'pensao', strong: ['pensao', 'pensao alimenticia'] },
  {
    category: 'moradia',
    strong: ['aluguel', 'condominio', 'imobiliaria', 'habitacional', 'financiamento da casa', 'financiamento do apartamento', 'prestacao da casa', 'parcela da casa', 'minha casa minha vida'],
    weak: ['casa', 'apartamento', 'apto'],
  },
  { category: 'cheque_especial', strong: ['cheque especial', 'limite da conta', 'limite do banco'], weak: ['cheque'] },
  {
    category: 'assinatura',
    strong: ['netflix', 'spotify', 'amazon prime', 'prime video', 'disney', 'hbo', 'youtube', 'deezer', 'globoplay', 'icloud', 'google one', 'academia', 'smartfit', 'smart fit', 'gympass', 'wellhub', 'assinatura', 'streaming', 'paramount', 'crunchyroll'],
  },
  {
    category: 'energia',
    strong: ['energia', 'luz', 'eletrica', 'eletricidade', 'enel', 'cemig', 'copel', 'celesc', 'light', 'coelba', 'celpe', 'cpfl', 'equatorial', 'energisa', 'neoenergia', 'elektro', 'cosern', 'coelce', 'edp', 'rge', 'eletropaulo'],
  },
  {
    category: 'agua',
    strong: ['agua', 'saneamento', 'esgoto', 'sabesp', 'cedae', 'copasa', 'embasa', 'compesa', 'sanepar', 'caesb', 'cagece', 'casan', 'corsan', 'saae', 'cagepa', 'caern', 'deso', 'agespisa'],
  },
  { category: 'gas', strong: ['gas', 'comgas', 'botijao', 'ultragaz', 'liquigas', 'supergasbras', 'naturgy'] },
  {
    category: 'saude',
    strong: ['plano de saude', 'saude', 'unimed', 'amil', 'hapvida', 'sulamerica', 'notredame', 'odonto', 'odontologico', 'dentista', 'farmacia', 'remedio', 'hospital', 'medico', 'convenio'],
  },
  {
    category: 'cartao',
    strong: ['cartao', 'credicard', 'hipercard', 'itaucard', 'ourocard', 'mastercard', 'visa', 'nubank', 'rotativo'],
    weak: ['fatura'],
  },
  {
    category: 'emprestimo',
    strong: ['emprestimo', 'consignado', 'credito pessoal', 'financeira', 'crefisa', 'agiota', 'antecipacao', 'cdc', 'creditas'],
  },
  {
    category: 'financiamento',
    strong: ['financiamento', 'consorcio', 'veiculo', 'parcela do carro', 'parcela da moto'],
    weak: ['carro', 'moto'],
  },
  {
    category: 'telecom',
    strong: ['internet', 'net', 'vivo', 'claro', 'tim', 'oi', 'fibra', 'telefone', 'celular', 'banda larga', 'sky', 'starlink', 'tv a cabo', 'plano do celular'],
  },
  {
    category: 'impostos',
    strong: ['iptu', 'ipva', 'das mei', 'guia das', 'mei', 'imposto', 'inss', 'darf', 'irpf', 'imposto de renda', 'licenciamento', 'detran', 'multa de transito', 'receita federal', 'simples nacional'],
  },
  {
    category: 'educacao',
    strong: ['escola', 'faculdade', 'curso', 'colegio', 'universidade', 'creche', 'material escolar', 'ead', 'fies'],
    weak: ['mensalidade'],
  },
  {
    category: 'pessoal',
    strong: ['amigo', 'amiga', 'mae', 'pai', 'irmao', 'irma', 'tio', 'tia', 'sogra', 'sogro', 'primo', 'prima', 'vizinho', 'vizinha', 'avo', 'emprestado de', 'devo a'],
  },
];

/**
 * Tipos citados numa frase, para filtros como "quanto devo de energia?".
 * Só as palavras fortes contam — "fatura" sozinha não diz qual conta é.
 */
export function inferCategoryMentions(text: string): DebtCategory[] {
  const normalized = normalize(text);
  return KEYWORDS.filter((entry) => entry.strong.some((term) => hasWord(normalized, term))).map(
    (entry) => entry.category
  );
}

/** Deduz o tipo da conta pela descrição. "outros" quando nada casa. */
export function inferCategory(description: string): DebtCategory {
  const text = normalize(description);
  if (!text) return 'outros';

  for (const entry of KEYWORDS) {
    if (entry.strong.some((term) => hasWord(text, term))) return entry.category;
  }
  for (const entry of KEYWORDS) {
    if (entry.weak?.some((term) => hasWord(text, term))) return entry.category;
  }
  return 'outros';
}

export interface CostProfile extends CategoryInfo {
  category: DebtCategory;
  /** Multa da conta, em %. 0 quando não cadastrada */
  lateFeePercent: number;
  /** Juros mensais da conta, em %. 0 quando não cadastrados */
  monthlyInterestPercent: number;
  /** true quando o tipo foi deduzido da descrição, não escolhido */
  categoryAuto: boolean;
  /** true quando a conta tem multa/juros próprios, não os da categoria */
  customRates: boolean;
}

interface CostSource {
  description: string;
  originalDescription?: string;
  category?: DebtCategory;
  lateFeePercent?: number;
  monthlyInterestPercent?: number;
}

/**
 * Junta categoria (escolhida ou deduzida) com os encargos da própria conta.
 * Sem percentual cadastrado, a conta não tem multa nem juros.
 */
export function resolveCostProfile(source: CostSource): CostProfile {
  const category = source.category ?? inferCategory(source.originalDescription ?? source.description);
  const info = CATEGORY_INFO[category];
  const hasFee = typeof source.lateFeePercent === 'number' && Number.isFinite(source.lateFeePercent);
  const hasInterest =
    typeof source.monthlyInterestPercent === 'number' && Number.isFinite(source.monthlyInterestPercent);

  return {
    ...info,
    category,
    categoryAuto: !source.category,
    customRates: hasFee || hasInterest,
    lateFeePercent: hasFee ? (source.lateFeePercent as number) : 0,
    monthlyInterestPercent: hasInterest ? (source.monthlyInterestPercent as number) : 0,
  };
}
