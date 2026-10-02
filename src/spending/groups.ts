import type { DebtCategory } from '../types';
import { inferCategory } from '../advisor/categories';
import { hasWord, normalize } from '../advisor/text';

/**
 * Para onde o dinheiro vai. É uma classificação diferente da de dívidas
 * (que mede o risco de não pagar): aqui a pergunta é "com o que eu gasto?".
 * Gasolina e parcela do carro são Transporte; faculdade e curso, Educação.
 */
export type SpendingGroup =
  | 'moradia'
  | 'servicos'
  | 'alimentacao'
  | 'transporte'
  | 'educacao'
  | 'saude'
  | 'dividas'
  | 'lazer'
  | 'compras'
  | 'familia'
  | 'pets'
  | 'impostos'
  | 'outros';

export interface SpendingGroupInfo {
  label: string;
  /** Exemplo curto do que entra no grupo, para o seletor */
  hint: string;
}

export const SPENDING_GROUPS: Record<SpendingGroup, SpendingGroupInfo> = {
  moradia: { label: 'Moradia', hint: 'aluguel, condomínio, IPTU' },
  servicos: { label: 'Contas da casa', hint: 'energia, água, gás, internet' },
  alimentacao: { label: 'Alimentação', hint: 'mercado, feira, delivery' },
  transporte: { label: 'Transporte', hint: 'gasolina, carro, Uber, ônibus' },
  educacao: { label: 'Educação', hint: 'faculdade, escola, cursos' },
  saude: { label: 'Saúde', hint: 'plano, farmácia, médico' },
  dividas: { label: 'Dívidas e crédito', hint: 'cartão, empréstimo, agiota' },
  lazer: { label: 'Lazer e assinaturas', hint: 'streaming, academia, passeios' },
  compras: { label: 'Compras pessoais', hint: 'roupas, beleza, lojas' },
  familia: { label: 'Família e filhos', hint: 'pensão, fraldas, mesada' },
  pets: { label: 'Pets', hint: 'ração, veterinário' },
  impostos: { label: 'Impostos e taxas', hint: 'IR, MEI, tarifas' },
  outros: { label: 'Outros', hint: 'o que não se encaixa' },
};

export const SPENDING_ORDER: SpendingGroup[] = [
  'moradia',
  'servicos',
  'alimentacao',
  'transporte',
  'educacao',
  'saude',
  'dividas',
  'lazer',
  'compras',
  'familia',
  'pets',
  'impostos',
  'outros',
];

/**
 * Palavras de cada grupo. Testadas em ordem, com os termos compostos antes
 * dos simples: "seguro do carro" é Transporte, não Outros; "financiamento
 * da casa" é Moradia, não Transporte.
 */
const KEYWORDS: Array<{ group: SpendingGroup; terms: string[] }> = [
  {
    group: 'moradia',
    terms: ['aluguel', 'condominio', 'iptu', 'imobiliaria', 'financiamento da casa', 'financiamento do apartamento', 'financiamento imobiliario', 'prestacao da casa', 'parcela da casa', 'minha casa minha vida', 'reforma', 'material de construcao', 'moveis', 'diarista', 'faxina', 'mudanca'],
  },
  {
    group: 'transporte',
    terms: ['gasolina', 'combustivel', 'etanol', 'diesel', 'abastecimento', 'uber', 'taxi', 'onibus', 'metro', 'trem', 'passagem', 'bilhete unico', 'vale transporte', 'carro', 'moto', 'veiculo', 'estacionamento', 'pedagio', 'sem parar', 'ipva', 'licenciamento', 'detran', 'multa de transito', 'oficina', 'mecanico', 'pneu', 'seguro do carro', 'seguro auto', 'financiamento do carro', 'parcela do carro', 'consorcio', 'revisao', 'lava jato'],
  },
  {
    group: 'educacao',
    terms: ['faculdade', 'escola', 'colegio', 'curso', 'universidade', 'creche', 'mensalidade escolar', 'material escolar', 'livro', 'livros', 'apostila', 'ead', 'fies', 'matricula', 'ingles', 'pos graduacao', 'mba', 'vestibular'],
  },
  {
    group: 'saude',
    terms: ['plano de saude', 'saude', 'unimed', 'amil', 'hapvida', 'sulamerica', 'notredame', 'farmacia', 'drogaria', 'remedio', 'remedios', 'medicamento', 'medico', 'consulta', 'dentista', 'odonto', 'exame', 'exames', 'hospital', 'psicologo', 'terapia', 'otica', 'fisioterapia'],
  },
  {
    group: 'familia',
    terms: ['pensao', 'pensao alimenticia', 'mesada', 'fralda', 'fraldas', 'baba', 'filho', 'filha', 'enxoval'],
  },
  {
    group: 'pets',
    terms: ['pet', 'petshop', 'pet shop', 'racao', 'veterinario', 'vet', 'banho e tosa', 'cachorro', 'gato'],
  },
  {
    group: 'lazer',
    terms: ['netflix', 'spotify', 'amazon prime', 'prime video', 'disney', 'hbo', 'hbo max', 'youtube', 'globoplay', 'deezer', 'paramount', 'crunchyroll', 'streaming', 'assinatura', 'cinema', 'show', 'ingresso', 'bar', 'balada', 'viagem', 'hotel', 'passeio', 'festa', 'academia', 'smartfit', 'smart fit', 'gympass', 'wellhub', 'jogo', 'games', 'steam', 'playstation', 'xbox'],
  },
  {
    group: 'compras',
    terms: ['roupa', 'roupas', 'sapato', 'tenis', 'loja', 'shopping', 'shein', 'shopee', 'mercado livre', 'amazon', 'magalu', 'presente', 'beleza', 'salao', 'cabelo', 'barbearia', 'barbeiro', 'manicure', 'perfume', 'cosmeticos', 'maquiagem', 'eletronico', 'eletronicos'],
  },
  {
    group: 'alimentacao',
    terms: ['mercado', 'supermercado', 'feira', 'padaria', 'acougue', 'hortifruti', 'sacolao', 'ifood', 'rappi', 'restaurante', 'lanche', 'lanchonete', 'pizza', 'comida', 'alimentacao', 'almoco', 'jantar', 'marmita', 'delivery', 'atacadao', 'assai', 'carrefour', 'cesta basica', 'agua mineral'],
  },
  {
    group: 'dividas',
    terms: ['cartao', 'cartao de credito', 'fatura do cartao', 'nubank', 'credicard', 'itaucard', 'emprestimo', 'consignado', 'financeira', 'cheque especial', 'juros', 'agiota', 'acordo', 'renegociacao', 'divida', 'crefisa', 'serasa', 'credito pessoal'],
  },
  {
    group: 'impostos',
    terms: ['imposto', 'imposto de renda', 'irpf', 'das mei', 'guia das', 'mei', 'inss', 'darf', 'receita federal', 'tarifa bancaria', 'tarifa', 'taxa', 'cartorio', 'anuidade'],
  },
];

/** Quando a conta tem um tipo de dívida (escolhido ou deduzido), ele vira gasto assim. */
const FROM_DEBT_CATEGORY: Record<DebtCategory, SpendingGroup> = {
  moradia: 'moradia',
  energia: 'servicos',
  agua: 'servicos',
  gas: 'servicos',
  telecom: 'servicos',
  pensao: 'familia',
  saude: 'saude',
  financiamento: 'transporte',
  educacao: 'educacao',
  impostos: 'impostos',
  cartao: 'dividas',
  cheque_especial: 'dividas',
  emprestimo: 'dividas',
  assinatura: 'lazer',
  pessoal: 'dividas',
  outros: 'outros',
};

/** Chave estável de uma descrição: "Faculdade (3/10)" e "faculdade" são a mesma. */
export function spendingKey(description: string): string {
  return normalize(description.replace(/\s*\((\d+\/\d+|parcela \d+|\d+)\)\s*$/i, ''));
}

/**
 * Deduz o grupo de gasto de uma conta.
 *
 * Ordem de decisão: palavras de gasto ("gasolina") → tipo de dívida que o
 * usuário escolheu na conta → tipo deduzido pela marca ("Enel", "Sabesp")
 * → Outros. A escolha manual feita na aba Gastos passa por cima de tudo e é
 * aplicada antes de chamar esta função.
 */
export function inferSpendingGroup(description: string, category?: DebtCategory): SpendingGroup {
  const text = normalize(description);
  for (const entry of KEYWORDS) {
    if (entry.terms.some((term) => hasWord(text, term))) return entry.group;
  }
  if (category && category !== 'outros') return FROM_DEBT_CATEGORY[category];
  return FROM_DEBT_CATEGORY[inferCategory(description)];
}
