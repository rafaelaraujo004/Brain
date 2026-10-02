import { cents, impliedMonthlyRate, monthsToRepay, pmt, simulatePayoff, type PayoffResult } from './money';
import type { DebtTier, DebtTotals, FinancialSnapshot, OpenDebt, RankedDebt } from './types';

/**
 * Juros a partir dos quais a dívida conta como "cara". Separa crédito
 * (cartão, cheque especial, empréstimo) das contas de consumo, que andam
 * em torno de 1% ao mês.
 */
export const EXPENSIVE_RATE_PCT = 3;

function tierOf(debt: OpenDebt): DebtTier {
  if (debt.userLevel === 'baixa') return 3;
  if (debt.userLevel === 'alta' || debt.essential) return 0;
  if (debt.monthlyInterestPercent >= EXPENSIVE_RATE_PCT) return 1;
  return 2;
}

function formatRate(pct: number): string {
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function reasonFor(debt: OpenDebt, tier: DebtTier): string {
  if (tier === 3) return 'você marcou como prioridade baixa';
  if (tier === 0) {
    if (debt.userLevel === 'alta' && !debt.essential) return 'você marcou como prioridade alta';
    return debt.consequence;
  }
  if (tier === 1) return `juros de ~${formatRate(debt.monthlyInterestPercent)} ao mês`;
  if (debt.postponedTimes >= 2) return `já adiada ${debt.postponedTimes}x — está virando bola de neve`;
  if (debt.daysLate > 0) return `vencida ${debt.overdueLabel}`;
  return debt.consequence;
}

/**
 * Coloca as dívidas na ordem em que devem ser pagas.
 *
 * A regra segue o que educadores financeiros recomendam para quem está no
 * vermelho, em camadas que não se misturam:
 *
 *   1. O que ameaça a casa, serviços essenciais ou a liberdade (aluguel,
 *      energia, água, pensão, plano de saúde) — o prejuízo de não pagar
 *      não é medido em juros.
 *   2. O que tem juros altos (cartão, cheque especial, empréstimo): cada mês
 *      parado custa caro. Dentro da camada, os juros mais altos primeiro.
 *   3. O resto, começando pelo que já foi adiado mais vezes.
 *
 * A prioridade que o usuário marcou manda sobre a regra: "alta" sobe para a
 * primeira camada e "baixa" desce para o fim da fila.
 */
export function rankDebts(debts: OpenDebt[]): RankedDebt[] {
  const withTier = debts.map((debt) => ({ debt, tier: tierOf(debt) }));

  withTier.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const x = a.debt;
    const y = b.debt;
    if (a.tier === 0) {
      if (x.risk !== y.risk) return y.risk - x.risk;
      if (x.daysLate !== y.daysLate) return y.daysLate - x.daysLate;
      return x.updatedAmount - y.updatedAmount;
    }
    if (a.tier === 1) {
      if (x.monthlyInterestPercent !== y.monthlyInterestPercent) {
        return y.monthlyInterestPercent - x.monthlyInterestPercent;
      }
      return x.updatedAmount - y.updatedAmount;
    }
    if (x.postponedTimes !== y.postponedTimes) return y.postponedTimes - x.postponedTimes;
    if (x.risk !== y.risk) return y.risk - x.risk;
    if (x.daysLate !== y.daysLate) return y.daysLate - x.daysLate;
    return x.updatedAmount - y.updatedAmount;
  });

  return withTier.map(({ debt, tier }, index) => ({
    ...debt,
    tier,
    reason: reasonFor(debt, tier),
    rank: index + 1,
  }));
}

export function computeTotals(debts: RankedDebt[]): DebtTotals {
  const amount = debts.reduce((s, d) => s + d.amount, 0);
  const updatedAmount = debts.reduce((s, d) => s + d.updatedAmount, 0);
  const weighted = updatedAmount > 0
    ? debts.reduce((s, d) => s + d.monthlyInterestPercent * d.updatedAmount, 0) / updatedAmount
    : 0;
  const essentials = debts.filter((d) => d.essential);
  const oldest = debts.reduce<RankedDebt | undefined>(
    (worst, d) => (!worst || d.daysLate > worst.daysLate ? d : worst),
    undefined
  );

  return {
    count: debts.length,
    amount: cents(amount),
    charges: cents(updatedAmount - amount),
    updatedAmount: cents(updatedAmount),
    monthlyCost: cents(debts.reduce((s, d) => s + d.monthlyCost, 0)),
    essentialCount: essentials.length,
    essentialAmount: cents(essentials.reduce((s, d) => s + d.updatedAmount, 0)),
    weightedRatePct: weighted,
    oldest,
  };
}

/* --- Distribuir um valor entre as dívidas ----------------------------- */

export interface Allocation {
  budget: number;
  /** Dívidas quitadas por inteiro, na ordem em que devem ser pagas */
  paid: RankedDebt[];
  /** Dívidas que ficaram de fora */
  unpaid: RankedDebt[];
  used: number;
  leftover: number;
  /** Para onde vai a sobra: abater parte da próxima dívida da fila */
  partial?: { debt: RankedDebt; amount: number };
}

/**
 * Quita o máximo possível seguindo a fila de prioridade.
 *
 * Quando uma dívida não cabe, ela é pulada e a próxima é tentada — senão uma
 * conta grande no topo travaria todo o dinheiro. A sobra final é sugerida
 * como abatimento da primeira dívida que ficou de fora.
 *
 * O modo "count" ignora a prioridade e paga as menores primeiro, para
 * responder "quantas eu consigo eliminar".
 */
export function allocateBudget(
  ranked: RankedDebt[],
  budget: number,
  mode: 'priority' | 'count' = 'priority'
): Allocation {
  const queue = mode === 'count'
    ? [...ranked].sort((a, b) => a.updatedAmount - b.updatedAmount)
    : ranked;

  let cash = budget;
  const paid: RankedDebt[] = [];
  const unpaid: RankedDebt[] = [];

  for (const debt of queue) {
    if (debt.updatedAmount <= cash + 0.005) {
      paid.push(debt);
      cash -= debt.updatedAmount;
    } else {
      unpaid.push(debt);
    }
  }

  const leftover = cents(Math.max(0, cash));
  const firstUnpaid = mode === 'priority' ? unpaid[0] : undefined;
  return {
    budget,
    paid,
    unpaid,
    used: cents(budget - leftover),
    leftover,
    partial: firstUnpaid && leftover >= 1 ? { debt: firstUnpaid, amount: leftover } : undefined,
  };
}

/* --- Plano de quitação ------------------------------------------------- */

export function toPayoffDebts(debts: RankedDebt[]) {
  return debts.map((d) => ({ id: d.id, balance: d.updatedAmount, monthlyRatePct: d.monthlyInterestPercent }));
}

/** Simula guardar `monthly` por mês e pagar as dívidas na ordem de prioridade. */
export function planPayoff(debts: RankedDebt[], monthly: number): PayoffResult {
  return simulatePayoff(toPayoffDebts(debts), monthly);
}

/** Avalanche: a mais cara primeiro. É a ordem que minimiza o total de juros. */
export function cheapestPayoff(debts: RankedDebt[], monthly: number): PayoffResult {
  const byRate = [...debts].sort((a, b) => b.monthlyInterestPercent - a.monthlyInterestPercent);
  return simulatePayoff(toPayoffDebts(byRate), monthly);
}

/* --- Empréstimo -------------------------------------------------------- */

export interface LoanTerms {
  principal: number;
  payment: number;
  months: number;
  ratePct: number;
}

/**
 * Completa as condições do empréstimo a partir do que foi informado. Com
 * três dos quatro números (valor, parcela, prazo, taxa) o quarto sai da
 * Tabela Price. Devolve null quando falta informação.
 */
export function resolveLoanTerms(input: {
  principal?: number;
  payment?: number;
  months?: number;
  ratePct?: number;
}): LoanTerms | null {
  const { principal, payment, months, ratePct } = input;

  if (principal && payment && months) {
    return { principal, payment, months, ratePct: impliedMonthlyRate(principal, payment, months) };
  }
  if (principal && ratePct !== undefined && months) {
    return { principal, payment: cents(pmt(principal, ratePct, months)), months, ratePct };
  }
  if (principal && payment && ratePct !== undefined) {
    const n = monthsToRepay(principal, payment, ratePct);
    if (!Number.isFinite(n)) return null;
    return { principal, payment, months: n, ratePct };
  }
  if (payment && months && ratePct !== undefined) {
    const i = ratePct / 100;
    const pv = i === 0 ? payment * months : (payment * (1 - Math.pow(1 + i, -months))) / i;
    return { principal: cents(pv), payment, months, ratePct };
  }
  return null;
}

export type Verdict = 'good' | 'caution' | 'bad';

export interface LoanAnalysis extends LoanTerms {
  totalPaid: number;
  interest: number;
  allocation: Allocation;
  /** Pagar a mesma parcela direto nas dívidas, sem pegar empréstimo */
  withoutLoan: PayoffResult;
  /** Custo efetivo do empréstimo para quitar essas dívidas (desconta a sobra) */
  loanCost: number;
  /** Positivo = o empréstimo sai mais barato */
  savings: number;
  /** Prazo máximo em que o empréstimo ainda empata com não pegar */
  breakEvenMonths: number;
  surplusAfter: number;
  fits: boolean;
  tight: boolean;
  /** Parcelas (empréstimo + dívidas parceladas) sobre a renda */
  incomeShare: number;
  essentialsPaid: RankedDebt[];
  essentialsLeft: RankedDebt[];
  verdict: Verdict;
  reasons: Array<{ tone: 'good' | 'warn' | 'bad'; text: string }>;
}

/** Até onde uma taxa mensal é razoável, para dar contexto ao número. */
export function describeRate(ratePct: number): { tone: 'good' | 'warn' | 'bad'; label: string } {
  if (ratePct <= 0.05) return { tone: 'good', label: 'sem juros' };
  if (ratePct <= 2) return { tone: 'good', label: 'taxa baixa, típica de consignado' };
  if (ratePct <= 4) return { tone: 'warn', label: 'taxa moderada' };
  if (ratePct <= 8) return { tone: 'warn', label: 'taxa alta' };
  return { tone: 'bad', label: 'taxa muito alta' };
}

/**
 * Responde "vale a pena pegar esse empréstimo para colocar as dívidas em
 * dia?" comparando dois caminhos com o MESMO dinheiro saindo por mês:
 *
 *   A. Pegar o empréstimo, quitar as dívidas hoje e pagar as parcelas.
 *   B. Não pegar e despejar o valor da parcela direto nas dívidas, que
 *      continuam rendendo juros até acabarem.
 *
 * Comparar com o mesmo fluxo mensal é o que torna a conta justa: o
 * empréstimo só é bom negócio se, pelo mesmo esforço mensal, sai mais barato
 * — ou se resolve agora algo que não pode esperar (corte de energia,
 * despejo). Depois disso vem a pergunta que mais derruba esse tipo de
 * decisão: a parcela cabe no que sobra por mês?
 */
export function analyzeLoan(snapshot: FinancialSnapshot, terms: LoanTerms): LoanAnalysis {
  const { principal, payment, months, ratePct } = terms;
  const totalPaid = cents(payment * months);
  const interest = cents(Math.max(0, totalPaid - principal));

  const allocation = allocateBudget(snapshot.overdue, principal);
  const withoutLoan = cheapestPayoff(allocation.paid, payment);
  const loanCost = cents(totalPaid - allocation.leftover);
  const savings = withoutLoan.finished ? cents(withoutLoan.totalPaid - loanCost) : Infinity;
  const breakEvenMonths = withoutLoan.finished
    ? Math.floor((withoutLoan.totalPaid + allocation.leftover) / payment)
    : Infinity;

  const surplusAfter = cents(snapshot.surplus - payment);
  const fits = snapshot.surplus >= payment;
  const tight = fits && payment > snapshot.surplus * 0.7;
  const incomeShare = snapshot.recurringIncome > 0
    ? (payment + snapshot.installmentsMonthly) / snapshot.recurringIncome
    : 0;

  const essentialsPaid = allocation.paid.filter((d) => d.essential);
  const essentialsLeft = allocation.unpaid.filter((d) => d.essential);

  const reasons: LoanAnalysis['reasons'] = [];
  let bad = false;
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // 1. Cabe no bolso?
  if (!snapshot.incomeConfigured) {
    reasons.push({
      tone: 'warn',
      text: 'Sua renda não está cadastrada, então não consigo dizer se a parcela cabe. Cadastre em Configurações.',
    });
  } else if (snapshot.surplus <= 0) {
    bad = true;
    reasons.push({
      tone: 'bad',
      text: `Hoje a renda já não cobre as contas do mês (faltam ${money(-snapshot.surplus)}). O empréstimo resolve o atraso de agora, mas a parcela de ${money(payment)} vira mais uma conta sem dinheiro — em poucos meses os atrasos voltam, agora com o empréstimo junto.`,
    });
  } else if (!fits) {
    bad = true;
    reasons.push({
      tone: 'bad',
      text: `A parcela de ${money(payment)} é maior do que sobra por mês depois das contas fixas (${money(snapshot.surplus)}). Faltariam ${money(payment - snapshot.surplus)} todo mês.`,
    });
  } else if (tight) {
    reasons.push({
      tone: 'warn',
      text: `A parcela cabe, mas aperta: de ${money(snapshot.surplus)} que sobram por mês, restariam ${money(surplusAfter)} para imprevistos.`,
    });
  } else {
    reasons.push({
      tone: 'good',
      text: `A parcela cabe: sobram ${money(snapshot.surplus)} por mês e ainda restariam ${money(surplusAfter)} depois dela.`,
    });
  }

  if (incomeShare > 0.3 && snapshot.recurringIncome > 0) {
    reasons.push({
      tone: incomeShare > 0.4 ? 'bad' : 'warn',
      text: `Somando as parcelas que você já paga, ${Math.round(incomeShare * 100)}% da renda ficaria comprometida com parcelas. O recomendado é não passar de 30%.`,
    });
  }

  // 2. Sai mais barato do que pagar aos poucos?
  if (allocation.paid.length === 0 && snapshot.overdue.length > 0) {
    bad = true;
    reasons.push({
      tone: 'bad',
      text: `${money(principal)} não quita nenhuma dívida inteira — a menor custa ${money(Math.min(...snapshot.overdue.map((d) => d.updatedAmount)))}. Serviria só para abater, e o atraso continuaria.`,
    });
  }
  if (allocation.paid.length > 0) {
    if (!withoutLoan.finished) {
      reasons.push({
        tone: 'good',
        text: `Sem o empréstimo, ${money(payment)} por mês nem cobre os juros dessas dívidas — elas nunca acabariam. Trocar por uma dívida de juros menores faz sentido.`,
      });
    } else if (savings >= 0) {
      reasons.push({
        tone: 'good',
        text: `Sai mais barato: pagando os mesmos ${money(payment)} por mês direto nas dívidas, você gastaria ${money(withoutLoan.totalPaid)} em ${withoutLoan.months} meses. Com o empréstimo, ${money(loanCost)} — economia de ${money(savings)}.`,
      });
    } else {
      const rescue = essentialsPaid.length > 0;
      reasons.push({
        tone: rescue ? 'warn' : 'bad',
        text: `Sai mais caro: sem o empréstimo, pagando ${money(payment)} por mês direto nas dívidas, você quitaria tudo em ${withoutLoan.months} meses gastando ${money(withoutLoan.totalPaid)}. Com ele, ${money(loanCost)} — ${money(-savings)} a mais.${rescue ? ' A diferença pode valer por resolver agora o que não pode esperar.' : ''}`,
      });
      if (!rescue) bad = true;
    }
  }

  // 3. A taxa em si.
  const rate = describeRate(ratePct);
  if (ratePct > 8) {
    bad = true;
    reasons.push({
      tone: 'bad',
      text: `Juros de ${formatRate(ratePct)} ao mês é ${rate.label}. Desconfie de ofertas assim, principalmente de financeiras desconhecidas.`,
    });
  }

  // 4. O que resolve de fato.
  if (essentialsPaid.length > 0) {
    reasons.push({
      tone: 'good',
      text: `Resolve hoje ${essentialsPaid.length === 1 ? 'a conta essencial' : `as ${essentialsPaid.length} contas essenciais`} (${[...new Set(essentialsPaid.map((d) => d.description))].slice(0, 3).join(', ')}), que têm risco de corte ou despejo.`,
    });
  }
  if (allocation.unpaid.length > 0) {
    const left = allocation.unpaid.reduce((s, d) => s + d.updatedAmount, 0);
    reasons.push({
      tone: essentialsLeft.length > 0 ? 'bad' : 'warn',
      text: `Ficam de fora ${allocation.unpaid.length} dívida${allocation.unpaid.length > 1 ? 's' : ''} (${money(left)})${essentialsLeft.length > 0 ? `, incluindo ${essentialsLeft.map((d) => d.description).slice(0, 2).join(' e ')}` : ''}. O empréstimo não te deixa 100% em dia.`,
    });
  }
  if (allocation.leftover >= Math.max(100, principal * 0.1) && allocation.paid.length > 0) {
    reasons.push({
      tone: 'warn',
      text: `Sobrariam ${money(allocation.leftover)} do empréstimo. Pegue só o necessário (${money(allocation.used)}) — dinheiro emprestado parado custa juros.`,
    });
  }

  let verdict: Verdict;
  if (bad) verdict = 'bad';
  else if (fits && !tight && savings >= 0 && ratePct <= 8 && incomeShare <= 0.3) verdict = 'good';
  else verdict = 'caution';

  return {
    ...terms,
    totalPaid,
    interest,
    allocation,
    withoutLoan,
    loanCost,
    savings,
    breakEvenMonths,
    surplusAfter,
    fits,
    tight,
    incomeShare,
    essentialsPaid,
    essentialsLeft,
    verdict,
    reasons,
  };
}
