/**
 * Matemática financeira do assistente. Tudo em reais e em % ao mês.
 *
 * Funções puras e sem dependência do banco: é aqui que mora a parte que
 * precisa estar certa, então é a parte mais testada.
 */

/** Arredonda para centavos. */
export function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Parcela fixa (Tabela Price) de um empréstimo. */
export function pmt(principal: number, monthlyRatePct: number, months: number): number {
  if (months <= 0) return principal;
  const i = monthlyRatePct / 100;
  if (i === 0) return principal / months;
  return (principal * i) / (1 - Math.pow(1 + i, -months));
}

/** Valor presente de uma série de parcelas iguais. */
function presentValue(payment: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return payment * months;
  return (payment * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;
}

/**
 * Taxa de juros embutida num empréstimo, em % ao mês.
 *
 * É a pergunta que o banco raramente responde direto: "pego 5 mil e pago 12x
 * de 500" — quanto isso custa por mês? Resolve PV = PMT·(1−(1+i)^−n)/i por
 * bisseção, que converge sempre (a função é monótona em i).
 *
 * Devolve 0 quando o total pago não passa do valor emprestado.
 */
export function impliedMonthlyRate(principal: number, payment: number, months: number): number {
  if (principal <= 0 || payment <= 0 || months <= 0) return 0;
  if (payment * months <= principal) return 0;

  let low = 0;
  let high = 1; // 100% ao mês — acima disso não é empréstimo, é assalto
  if (presentValue(payment, high, months) > principal) return 100;

  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    if (presentValue(payment, mid, months) > principal) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}

/**
 * Quantos meses leva para pagar `principal` com parcelas de `payment` a uma
 * taxa mensal. Infinity quando a parcela não cobre nem os juros.
 */
export function monthsToRepay(principal: number, payment: number, monthlyRatePct: number): number {
  if (principal <= 0) return 0;
  if (payment <= 0) return Infinity;
  const i = monthlyRatePct / 100;
  if (i === 0) return Math.ceil(principal / payment);
  if (payment <= principal * i) return Infinity;
  return Math.ceil(-Math.log(1 - (principal * i) / payment) / Math.log(1 + i));
}

/** Converte % ao mês em % ao ano (juros compostos). */
export function annualRate(monthlyRatePct: number): number {
  return (Math.pow(1 + monthlyRatePct / 100, 12) - 1) * 100;
}

/** Converte % ao ano em % ao mês (juros compostos). */
export function monthlyFromAnnual(annualRatePct: number): number {
  return (Math.pow(1 + annualRatePct / 100, 1 / 12) - 1) * 100;
}

export interface PayoffDebt {
  id: string;
  balance: number;
  /** Juros mensais enquanto a dívida não é paga, em % */
  monthlyRatePct: number;
}

export interface PayoffResult {
  /** Meses até zerar tudo (ou até o limite, se não zerar) */
  months: number;
  totalPaid: number;
  /** Quanto do que foi pago foi só juros */
  totalInterest: number;
  /** false quando o pagamento mensal não vence os juros */
  finished: boolean;
  /** Mês (1, 2, 3…) em que cada dívida foi quitada */
  clearedAt: Record<string, number>;
}

/**
 * Simula pagar um valor fixo por mês numa lista de dívidas, na ordem dada.
 *
 * A cada mês as dívidas em aberto rendem juros e o pagamento é despejado na
 * primeira da fila; o que sobra dela passa para a próxima. É o mesmo que uma
 * pessoa disciplinada faria com um envelope mensal.
 */
export function simulatePayoff(
  debts: PayoffDebt[],
  monthlyPayment: number,
  maxMonths = 360
): PayoffResult {
  const balances = debts.map((d) => ({ ...d }));
  const clearedAt: Record<string, number> = {};
  let totalPaid = 0;
  let totalInterest = 0;

  const open = () => balances.filter((d) => d.balance > 0.005);
  if (open().length === 0) {
    return { months: 0, totalPaid: 0, totalInterest: 0, finished: true, clearedAt };
  }
  if (monthlyPayment <= 0) {
    return { months: maxMonths, totalPaid: 0, totalInterest: 0, finished: false, clearedAt };
  }

  for (let month = 1; month <= maxMonths; month++) {
    for (const debt of balances) {
      if (debt.balance <= 0.005) continue;
      const interest = debt.balance * (debt.monthlyRatePct / 100);
      debt.balance += interest;
      totalInterest += interest;
    }

    let cash = monthlyPayment;
    for (const debt of balances) {
      if (cash <= 0) break;
      if (debt.balance <= 0.005) continue;
      const paid = Math.min(cash, debt.balance);
      debt.balance -= paid;
      cash -= paid;
      totalPaid += paid;
      if (debt.balance <= 0.005) {
        debt.balance = 0;
        clearedAt[debt.id] = month;
      }
    }

    if (open().length === 0) {
      return {
        months: month,
        totalPaid: cents(totalPaid),
        totalInterest: cents(totalInterest),
        finished: true,
        clearedAt,
      };
    }
  }

  return {
    months: maxMonths,
    totalPaid: cents(totalPaid),
    totalInterest: cents(totalInterest),
    finished: false,
    clearedAt,
  };
}

/**
 * Menor valor mensal que zera as dívidas em até `months` meses. Bisseção
 * sobre simulatePayoff — a simulação é barata para as dezenas de dívidas que
 * uma pessoa tem.
 */
export function monthlyNeededToClear(debts: PayoffDebt[], months: number): number {
  const total = debts.reduce((s, d) => s + d.balance, 0);
  if (total <= 0) return 0;

  let low = 0;
  let high = total * 2;
  while (!simulatePayoff(debts, high, months).finished) high *= 2;

  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (simulatePayoff(debts, mid, months).finished) high = mid;
    else low = mid;
  }
  return Math.ceil(high);
}
