import { formatCurrency, formatDate, getShortMonthName } from '../utils/formatters';
import { CATEGORY_INFO } from './categories';
import { annualRate, cents, impliedMonthlyRate, monthlyNeededToClear } from './money';
import { parseQuestion, type DebtReference, type ParsedQuestion } from './parser';
import {
  allocateBudget,
  analyzeLoan,
  cheapestPayoff,
  computeTotals,
  describeRate,
  planPayoff,
  rankDebts,
  resolveLoanTerms,
  toPayoffDebts,
  type Allocation,
  type LoanAnalysis,
} from './strategy';
import { joinPt, plural } from './text';
import type {
  Answer,
  AnswerBlock,
  ConversationContext,
  DebtLine,
  FinancialSnapshot,
  Intent,
  QuestionParams,
  RankedDebt,
  Tone,
} from './types';

/* --- Formatação ------------------------------------------------------- */

const brl = (value: number) => formatCurrency(cents(value));

function pct(value: number, digits = 1): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
}

/** "Mar/2027" para daqui a `months` meses. */
function monthFromNow(snapshot: FinancialSnapshot, months: number): string {
  const index = snapshot.year * 12 + (snapshot.month - 1) + months;
  return `${getShortMonthName((index % 12) + 1)}/${Math.floor(index / 12)}`;
}

function cleanName(description: string): string {
  return description.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

function debtTone(debt: RankedDebt): Tone {
  if (debt.tier === 0) return 'bad';
  if (debt.tier === 1) return 'warn';
  return 'info';
}

function debtLine(debt: RankedDebt, extra?: string): DebtLine {
  const parts = [debt.reason];
  parts.push(`venceu ${formatDate(debt.originalDueDate)}`);
  if (debt.postponedTimes > 0 && !debt.reason.includes('adiada')) parts.push(`adiada ${debt.postponedTimes}x`);
  if (extra) parts.push(extra);
  return {
    title: debt.description,
    detail: parts.join(' · '),
    value: brl(debt.updatedAmount),
    tone: debtTone(debt),
    tag: debt.categoryLabel,
  };
}

/** Agrupa as faturas da mesma conta: "Energia ×3 — R$ 450,00". */
function groupLines(debts: RankedDebt[]): DebtLine[] {
  const groups = new Map<string, RankedDebt[]>();
  for (const debt of debts) {
    const list = groups.get(debt.groupKey) ?? [];
    list.push(debt);
    groups.set(debt.groupKey, list);
  }
  return [...groups.values()]
    .map((list) => {
      const total = list.reduce((s, d) => s + d.updatedAmount, 0);
      const first = list[0];
      const oldest = list.reduce((a, b) => (a.daysLate >= b.daysLate ? a : b));
      const name = cleanName(first.description);
      return {
        total,
        line: {
          title: list.length > 1 ? `${name} ×${list.length}` : first.description,
          detail:
            list.length > 1
              ? `${list.length} faturas · a mais antiga é de ${oldest.originLabel} (${oldest.overdueLabel})`
              : `${first.originLabel} · vencida ${first.overdueLabel}${first.postponedTimes ? ` · adiada ${first.postponedTimes}x` : ''}`,
          value: brl(total),
          tone: debtTone(first),
          tag: first.categoryLabel,
        } satisfies DebtLine,
      };
    })
    .sort((a, b) => b.total - a.total)
    .map((g) => g.line);
}

function assumptionsNote(snapshot: FinancialSnapshot, extra: string[] = []): AnswerBlock {
  const items = [
    'Multa e juros só entram nas contas em que você cadastrou um percentual (Contas → Editar → Tipo e encargos). Nas demais, uso o valor da conta como está.',
    'O tipo da conta (energia, aluguel, cartão…) define a urgência: o que ameaça moradia e serviços essenciais vem primeiro.',
  ];
  if (snapshot.incomeConfigured) {
    items.push(
      `Sobra mensal = renda fixa (${brl(snapshot.recurringIncome)}) − contas do mês (${brl(snapshot.fixedMonthly)}${
        snapshot.fixedMonthlySource === 'previous' ? ', estimadas pelo mês passado' : ''
      }). Fundos extras do mês não entram, porque não se repetem.`
    );
  }
  return { kind: 'note', title: 'Como calculei', items: [...extra, ...items] };
}

/* --- Respostas -------------------------------------------------------- */

function noDebtsAnswer(snapshot: FinancialSnapshot, intent: Intent): AnswerBlock[] {
  const blocks: AnswerBlock[] = [
    {
      kind: 'verdict',
      tone: 'good',
      title: snapshot.scoped ? 'Nenhuma dessas dívidas está em atraso' : 'Você não tem dívidas em atraso',
      text: 'Nenhuma conta pendente passou do vencimento. O foco agora é pagar as do mês em dia.',
    },
  ];
  if (intent === 'loan') {
    blocks.push({
      kind: 'text',
      text: 'Sem atrasos para quitar, um empréstimo agora só criaria uma dívida nova com juros. **Não recomendo.**',
    });
  }
  if (snapshot.upcoming.length > 0) {
    const total = snapshot.upcoming.reduce((s, d) => s + d.amount, 0);
    blocks.push({
      kind: 'text',
      text: `Ainda vencem este mês ${plural(snapshot.upcoming.length, 'conta')}, somando **${brl(total)}**.`,
    });
  }
  return blocks;
}

function answerTotal(snapshot: FinancialSnapshot, focus: RankedDebt[], filterLabel?: string): AnswerBlock[] {
  const totals = computeTotals(focus);
  const blocks: AnswerBlock[] = [];
  const subject = filterLabel ? ` de ${filterLabel}` : '';

  blocks.push({
    kind: 'verdict',
    tone: totals.essentialCount > 0 ? 'bad' : 'warn',
    title: `${plural(totals.count, 'dívida')} em atraso${subject}: ${brl(totals.amount)}`,
    text:
      totals.charges > 0
        ? `Com multa e juros estimados até hoje, já são **${brl(totals.updatedAmount)}** — e crescem cerca de **${brl(totals.monthlyCost)} por mês** paradas.`
        : 'Sem encargos estimados para essas contas.',
  });

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Valor das contas', value: brl(totals.amount) },
      { label: 'Com encargos', value: brl(totals.updatedAmount), tone: 'bad', hint: 'estimado' },
      { label: 'Cresce por mês', value: brl(totals.monthlyCost), tone: 'warn' },
      {
        label: 'Mais antiga',
        value: totals.oldest ? totals.oldest.originLabel : '—',
        hint: totals.oldest ? cleanName(totals.oldest.description) : undefined,
      },
    ],
  });

  blocks.push({ kind: 'debts', title: 'Somadas por conta', items: groupLines(focus) });
  blocks.push(...agiotaReminder(snapshot));

  // Por tipo, só quando há mais de um — senão repete a lista.
  const byCategory = new Map<string, { count: number; total: number }>();
  for (const debt of focus) {
    const entry = byCategory.get(debt.categoryLabel) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += debt.updatedAmount;
    byCategory.set(debt.categoryLabel, entry);
  }
  if (byCategory.size > 1) {
    blocks.push({
      kind: 'table',
      title: 'Por tipo',
      columns: ['Tipo', 'Qtde', 'Com encargos'],
      rows: [...byCategory.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([label, v]) => [label, String(v.count), brl(v.total)]),
    });
  }

  if (totals.essentialCount > 0) {
    blocks.push({
      kind: 'text',
      text: `Atenção: ${plural(totals.essentialCount, 'delas é essencial', 'delas são essenciais')} (${brl(totals.essentialAmount)}) — moradia, energia, água ou saúde. Essas vêm primeiro.`,
    });
  }
  blocks.push(assumptionsNote(snapshot));
  return blocks;
}

function answerCost(snapshot: FinancialSnapshot, focus: RankedDebt[]): AnswerBlock[] {
  const totals = computeTotals(focus);
  if (totals.monthlyCost <= 0 && totals.charges <= 0) {
    const loanCost = snapshot.informalLoans.reduce((s, l) => s + l.monthlyInterest, 0);
    return [
      {
        kind: 'verdict',
        tone: 'info',
        title: 'Nenhuma dívida em atraso tem juros cadastrados',
        text: 'Por padrão eu não somo multa nem juros. Se alguma conta cobra, cadastre o percentual em Contas → Editar → Tipo e encargos e eu passo a considerar.',
      },
      ...(loanCost > 0
        ? [
            {
              kind: 'text' as const,
              text: `O que tem juros de verdade hoje é o dinheiro com agiota: **${brl(loanCost)} por mês** só de juros, sem abater nada do valor emprestado.`,
            },
          ]
        : []),
    ];
  }
  const byCost = [...focus].sort((a, b) => b.monthlyCost - a.monthlyCost);
  const priciest = [...focus].sort((a, b) => b.monthlyInterestPercent - a.monthlyInterestPercent)[0];
  const blocks: AnswerBlock[] = [];

  blocks.push({
    kind: 'verdict',
    tone: totals.monthlyCost > 0 ? 'warn' : 'good',
    title: `Seus atrasos custam ~${brl(totals.monthlyCost)} por mês`,
    text: `Já acumularam **${brl(totals.charges)}** em multa e juros estimados. Em um ano parados, seriam mais **${brl(totals.monthlyCost * 12)}** só de encargos.`,
  });

  if (priciest && priciest.monthlyInterestPercent > 0) {
    blocks.push({
      kind: 'text',
      text: `A mais cara é **${cleanName(priciest.description)}**: ~${pct(priciest.monthlyInterestPercent)} ao mês (${pct(annualRate(priciest.monthlyInterestPercent), 0)} ao ano). Cada R$ 100 dela viram ${brl(100 * (1 + priciest.monthlyInterestPercent / 100))} no mês seguinte.`,
    });
  }

  blocks.push({
    kind: 'debts',
    title: 'O que mais pesa por mês',
    numbered: true,
    items: byCost.slice(0, 6).map((d) => ({
      title: d.description,
      detail: `${pct(d.monthlyInterestPercent)} ao mês${d.lateFeePercent ? ` + multa de ${pct(d.lateFeePercent)}` : ''}${d.customRates ? ' (taxa da conta)' : ' (estimado)'}`,
      value: `${brl(d.monthlyCost)}/mês`,
      tone: d.monthlyInterestPercent >= 3 ? 'bad' : 'info',
      tag: d.categoryLabel,
    })),
  });

  blocks.push({
    kind: 'text',
    text: 'Para sair mais barato, o dinheiro que sobrar depois das contas essenciais deve ir primeiro para as de juros mais altos.',
  });
  blocks.push(assumptionsNote(snapshot));
  return blocks;
}

function allocationBlocks(allocation: Allocation, total: number, heading: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const footerParts = [
    `Quita ${allocation.paid.length} de ${total}`,
    `usa ${brl(allocation.used)}`,
  ];
  if (allocation.leftover > 0) footerParts.push(`sobram ${brl(allocation.leftover)}`);

  blocks.push({
    kind: 'debts',
    title: heading,
    numbered: true,
    items: allocation.paid.map((d) => debtLine(d)),
    footer: footerParts.join(' · '),
  });

  if (allocation.partial) {
    blocks.push({
      kind: 'text',
      text: `Com a sobra de **${brl(allocation.partial.amount)}**, abata parte de **${allocation.partial.debt.description}** (${brl(allocation.partial.debt.updatedAmount)}) — ou guarde para completar no mês que vem.`,
    });
  }
  return blocks;
}

function answerWhatToPay(
  snapshot: FinancialSnapshot,
  focus: RankedDebt[],
  params: QuestionParams,
  intent: 'what_to_pay' | 'how_many'
): AnswerBlock[] {
  // "Consigo pagar tudo?" sem valor: responde com a sobra do mês.
  const budget =
    params.amount ??
    params.principal ??
    params.monthly ??
    (intent === 'how_many' && snapshot.surplus > 0 ? snapshot.surplus : undefined);
  const blocks: AnswerBlock[] = [];

  if (!budget) {
    blocks.push({
      kind: 'verdict',
      tone: 'info',
      title: 'A ordem certa para pagar',
      text: 'Primeiro o que ameaça a casa e os serviços essenciais, depois o que tem juros altos, depois o resto — começando pelo que já foi mais adiado.',
    });
    blocks.push({
      kind: 'debts',
      title: 'Sua fila de prioridade',
      numbered: true,
      items: focus.slice(0, 10).map((d) => debtLine(d)),
      footer: focus.length > 10 ? `+ ${focus.length - 10} dívidas depois destas` : undefined,
    });

    if (snapshot.surplus > 0) {
      const allocation = allocateBudget(focus, snapshot.surplus);
      blocks.push({
        kind: 'text',
        text: `Com a sobra mensal de **${brl(snapshot.surplus)}**, dá para quitar ${plural(allocation.paid.length, 'dívida')} já neste mês. Diga um valor (ex.: "tenho 800, o que pago?") que eu monto a lista.`,
      });
    } else {
      blocks.push({
        kind: 'text',
        text: 'Diga quanto você tem disponível (ex.: "tenho 800, o que pago?") que eu digo exatamente quais quitar.',
      });
    }
    blocks.push(assumptionsNote(snapshot));
    return blocks;
  }

  const byPriority = allocateBudget(focus, budget, 'priority');
  const byCount = allocateBudget(focus, budget, 'count');
  const total = focus.length;

  if (intent === 'how_many') {
    blocks.push({
      kind: 'verdict',
      tone: byPriority.paid.length === total ? 'good' : byPriority.paid.length > 0 ? 'warn' : 'bad',
      title:
        byPriority.paid.length === total
          ? `Com ${brl(budget)} você quita todas as ${total}`
          : `Com ${brl(budget)} você quita ${byPriority.paid.length} de ${total} dívidas`,
      text:
        byCount.paid.length > byPriority.paid.length
          ? `Se o objetivo for eliminar o maior número de boletos, dá para quitar **${byCount.paid.length}** (as menores) — mas aí ficam de fora contas mais urgentes.`
          : undefined,
    });
  } else {
    blocks.push({
      kind: 'verdict',
      tone: byPriority.paid.length === total ? 'good' : 'info',
      title: `Com ${brl(budget)}, pague nesta ordem`,
      text:
        byPriority.paid.length === total
          ? 'Dá para quitar todas as dívidas em atraso.'
          : `Dá para quitar ${byPriority.paid.length} de ${total}. ${
              byCount.paid.length > byPriority.paid.length
                ? `(Pagando só as menores seriam ${byCount.paid.length}, mas deixaria as mais urgentes para trás.)`
                : ''
            }`,
    });
  }

  if (byPriority.paid.length > 0) {
    blocks.push(...allocationBlocks(byPriority, total, 'Pague estas'));
  } else {
    const smallest = [...focus].sort((a, b) => a.updatedAmount - b.updatedAmount)[0];
    blocks.push({
      kind: 'text',
      text: `${brl(budget)} não quita nenhuma dívida inteira — a menor é **${smallest.description}** (${brl(smallest.updatedAmount)}). Use o valor para abater **${focus[0].description}**, que é a mais urgente, ou junte com o do mês que vem.`,
    });
  }

  const essentialsLeft = byPriority.unpaid.filter((d) => d.essential);
  if (essentialsLeft.length > 0) {
    blocks.push({
      kind: 'bullets',
      title: 'Fica pendente e é essencial',
      items: essentialsLeft.slice(0, 4).map((d) => ({
        tone: 'bad' as Tone,
        text: `${d.description} — ${brl(d.updatedAmount)} (${d.consequence}). Ligue para negociar antes do corte.`,
      })),
    });
  }

  if (intent === 'how_many' && byCount.paid.length > byPriority.paid.length) {
    blocks.push({
      kind: 'debts',
      title: `As ${byCount.paid.length} menores`,
      items: byCount.paid.map((d) => ({
        title: d.description,
        detail: d.essential ? d.consequence : `vencida ${d.overdueLabel}`,
        value: brl(d.updatedAmount),
        tone: debtTone(d),
      })),
    });
  }
  blocks.push(assumptionsNote(snapshot));
  return blocks;
}

function needsTable(focus: RankedDebt[]): AnswerBlock {
  const debts = toPayoffDebts(focus);
  const rows = [6, 12, 18, 24].map((months) => [
    `${months} meses`,
    `${brl(monthlyNeededToClear(debts, months))}/mês`,
  ]);
  return { kind: 'table', title: 'Quanto separar por mês para zerar em…', columns: ['Prazo', 'Valor mensal'], rows };
}

function answerPayoff(snapshot: FinancialSnapshot, focus: RankedDebt[], params: QuestionParams): AnswerBlock[] {
  const totals = computeTotals(focus);
  const blocks: AnswerBlock[] = [];

  // "Quanto preciso por mês para quitar em 6 meses?": o prazo é a meta.
  if (params.months && params.monthly === undefined && params.amount === undefined) {
    const needed = monthlyNeededToClear(toPayoffDebts(focus), params.months);
    const fits = snapshot.incomeConfigured && snapshot.surplus >= needed;
    blocks.push({
      kind: 'verdict',
      tone: !snapshot.incomeConfigured ? 'info' : fits ? 'good' : 'bad',
      title: `Para zerar em ${plural(params.months, 'mês', 'meses')}: ${brl(needed)} por mês`,
      text: !snapshot.incomeConfigured
        ? 'Cadastre sua renda para eu dizer se esse valor cabe no mês.'
        : fits
        ? `Cabe: sobram ${brl(snapshot.surplus)} por mês depois das contas fixas.`
        : `Hoje sobram ${brl(Math.max(0, snapshot.surplus))} por mês — faltam ${brl(needed - Math.max(0, snapshot.surplus))} para cumprir esse prazo.`,
    });
    const plan = planPayoff(focus, needed);
    blocks.push({
      kind: 'debts',
      title: 'Ordem de pagamento',
      numbered: true,
      items: focus.slice(0, 12).map((d) => {
        const at = plan.clearedAt[d.id];
        return {
          title: d.description,
          detail: at ? `quitada no ${at}º mês (${monthFromNow(snapshot, at)}) · ${d.reason}` : d.reason,
          value: brl(d.updatedAmount),
          tone: debtTone(d),
        };
      }),
    });
    blocks.push(needsTable(focus));
    blocks.push(assumptionsNote(snapshot));
    return blocks;
  }

  const monthly = params.monthly ?? params.amount ?? (snapshot.surplus > 0 ? snapshot.surplus : 0);
  const usingSurplus = params.monthly === undefined && params.amount === undefined;

  if (monthly <= 0) {
    blocks.push({
      kind: 'verdict',
      tone: 'bad',
      title: 'Hoje não sobra nada para atacar os atrasos',
      text: snapshot.incomeConfigured
        ? `A renda fixa (${brl(snapshot.recurringIncome)}) ${snapshot.surplus < 0 ? `não cobre nem as contas do mês — faltam ${brl(-snapshot.surplus)}` : 'empata com as contas do mês'}. Enquanto isso não mudar, os ${brl(totals.updatedAmount)} em atraso só crescem (~${brl(totals.monthlyCost)}/mês).`
        : 'Cadastre sua renda em Configurações para eu calcular a sobra mensal — ou pergunte com um valor, ex.: "quanto tempo para sair das dívidas guardando 300 por mês?".',
    });
    blocks.push(needsTable(focus));
    blocks.push({
      kind: 'bullets',
      title: 'Para abrir espaço',
      items: [
        { text: 'Corte ou pause o que não é essencial (assinaturas, delivery, parcelas de compras).' },
        { text: 'Renegocie dívidas caras pedindo desconto à vista ou parcela menor.' },
        { text: 'Qualquer renda extra vai direto para a primeira da fila de prioridade.' },
      ],
    });
    blocks.push(assumptionsNote(snapshot));
    return blocks;
  }

  const result = planPayoff(focus, monthly);
  if (!result.finished) {
    blocks.push({
      kind: 'verdict',
      tone: 'bad',
      title: `${brl(monthly)} por mês não vence os juros`,
      text: `As dívidas crescem ~${brl(totals.monthlyCost)} por mês. Com esse valor você nunca zera — é preciso mais, renegociar ou cortar juros.`,
    });
    blocks.push(needsTable(focus));
    blocks.push(assumptionsNote(snapshot));
    return blocks;
  }

  const cheapest = cheapestPayoff(focus, monthly);
  blocks.push({
    kind: 'verdict',
    tone: result.months <= 6 ? 'good' : result.months <= 18 ? 'warn' : 'bad',
    title: `Você fica em dia em ${plural(result.months, 'mês', 'meses')} — ${monthFromNow(snapshot, result.months)}`,
    text: `${usingSurplus ? `Usando toda a sobra mensal de **${brl(monthly)}**` : `Separando **${brl(monthly)} por mês**`} e pagando na ordem de prioridade, sem criar atrasos novos.`,
  });

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Prazo', value: plural(result.months, 'mês', 'meses') },
      { label: 'Total pago', value: brl(result.totalPaid) },
      { label: 'Juros pagos', value: brl(result.totalInterest), tone: 'warn' },
      { label: 'Hoje', value: brl(totals.updatedAmount), hint: 'com encargos' },
    ],
  });

  blocks.push({
    kind: 'debts',
    title: 'Quando cada uma sai',
    numbered: true,
    items: focus.slice(0, 12).map((d) => {
      const at = result.clearedAt[d.id];
      return {
        title: d.description,
        detail: at ? `quitada no ${at}º mês (${monthFromNow(snapshot, at)}) · ${d.reason}` : d.reason,
        value: brl(d.updatedAmount),
        tone: debtTone(d),
      };
    }),
  });

  if (cheapest.totalInterest + 5 < result.totalInterest) {
    blocks.push({
      kind: 'text',
      text: `Pagando só pela ordem dos juros (a mais cara primeiro) você economizaria ${brl(result.totalInterest - cheapest.totalInterest)} em juros — mas deixaria as essenciais esperando. A ordem acima protege o que não pode ser cortado.`,
    });
  }
  blocks.push(needsTable(focus));
  blocks.push(assumptionsNote(snapshot, ['A simulação supõe que as contas de cada mês continuam sendo pagas em dia, e que nenhuma dívida nova aparece.']));
  return blocks;
}

function answerBudget(snapshot: FinancialSnapshot): AnswerBlock[] {
  const b = snapshot.monthBudget;
  const blocks: AnswerBlock[] = [];

  if (!snapshot.incomeConfigured && b.income <= 0) {
    return [
      {
        kind: 'verdict',
        tone: 'warn',
        title: 'Sua renda não está cadastrada',
        text: 'Cadastre o salário em Configurações e eu respondo quanto sobra no mês, por dia e depois das dívidas.',
      },
    ];
  }

  blocks.push({
    kind: 'verdict',
    tone: b.isShort ? 'bad' : b.free < b.income * 0.1 ? 'warn' : 'good',
    title: `Ainda te restam ${brl(b.available)} este mês`,
    text: b.isShort
      ? `Mas as contas do mês somam ${brl(b.due)} — **${brl(-b.free)} a mais** do que a renda. Algo vai ter que ser adiado ou negociado.`
      : `Depois de pagar todas as contas do mês, sobram **${brl(b.free)}**${b.daysLeft > 0 && b.perDay > 0 ? ` — cerca de ${brl(b.perDay)} por dia até o fim do mês` : ''}.`,
  });

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Renda do mês', value: brl(b.income) },
      { label: 'Já pago', value: brl(b.paid), tone: 'good' },
      { label: 'Falta pagar', value: brl(b.committed), tone: 'warn' },
      { label: 'Livre no fim', value: brl(b.free), tone: b.free >= 0 ? 'good' : 'bad' },
    ],
  });

  if (snapshot.totals.count > 0) {
    blocks.push({
      kind: 'text',
      text: `Fora do mês, há ${plural(snapshot.totals.count, 'dívida')} em atraso somando **${brl(snapshot.totals.updatedAmount)}** com encargos. ${
        snapshot.surplus > 0
          ? `Pela renda fixa, sobram em média ${brl(snapshot.surplus)} por mês para atacá-las.`
          : 'Pela renda fixa, não sobra nada por mês para atacá-las.'
      }`,
    });
  }
  return blocks;
}

function answerPostpone(snapshot: FinancialSnapshot): AnswerBlock[] {
  const b = snapshot.monthBudget;
  // Candidatas: o que está pendente neste mês, vencido ou não.
  const inMonth = [
    ...snapshot.upcoming.map((d) => rankDebts([d])[0]),
    ...snapshot.overdue.filter((d) => d.month === snapshot.month && d.year === snapshot.year),
  ];
  const blocks: AnswerBlock[] = [];

  if (inMonth.length === 0) {
    return [
      {
        kind: 'verdict',
        tone: 'good',
        title: 'Não há nada pendente neste mês para adiar',
        text: 'Todas as contas do mês já foram pagas ou adiadas.',
      },
    ];
  }

  // Adiar primeiro o que tem menor risco e custa menos esperar; nunca as
  // essenciais que já foram empurradas.
  const candidates = [...inMonth].sort((x, y) => {
    if (x.essential !== y.essential) return x.essential ? 1 : -1;
    if (x.risk !== y.risk) return x.risk - y.risk;
    if (x.postponedTimes !== y.postponedTimes) return x.postponedTimes - y.postponedTimes;
    const rx = x.postponeCost / Math.max(1, x.amount);
    const ry = y.postponeCost / Math.max(1, y.amount);
    return rx - ry;
  });
  const safe = candidates.filter((d) => !d.essential && d.postponedTimes < 2);
  const avoid = inMonth.filter((d) => d.essential || d.postponedTimes >= 2);

  if (b.isShort) {
    const gap = -b.free;
    let covered = 0;
    const pick: RankedDebt[] = [];
    for (const d of safe) {
      if (covered >= gap) break;
      pick.push(d);
      covered += d.amount;
    }
    blocks.push({
      kind: 'verdict',
      tone: covered >= gap ? 'warn' : 'bad',
      title: `Para fechar o mês, faltam ${brl(gap)}`,
      text:
        covered >= gap
          ? `Adiando ${plural(pick.length, 'conta')} abaixo (${brl(covered)}), o mês fecha. O custo de esperar um mês é de ~${brl(pick.reduce((s, d) => s + d.postponeCost, 0))}.`
          : `Mesmo adiando tudo que é seguro adiar (${brl(covered)}), ainda faltam ${brl(gap - covered)}. Vai ser preciso negociar alguma conta essencial.`,
    });
    if (pick.length > 0) {
      blocks.push({
        kind: 'debts',
        title: 'Adie nesta ordem',
        numbered: true,
        items: pick.map((d) => ({
          title: d.description,
          detail: `custa ~${brl(d.postponeCost)} esperar 1 mês · ${d.consequence}`,
          value: brl(d.amount),
          tone: 'warn',
          tag: d.categoryLabel,
        })),
      });
    }
  } else {
    blocks.push({
      kind: 'verdict',
      tone: 'good',
      title: 'Este mês cabe tudo — não precisa adiar',
      text: `Pagando todas as contas ainda sobram ${brl(b.free)}. Adiar agora só aumentaria a dívida do mês que vem.`,
    });
    if (safe.length > 0) {
      blocks.push({
        kind: 'debts',
        title: 'Se mesmo assim precisar, as mais baratas de adiar',
        items: safe.slice(0, 4).map((d) => ({
          title: d.description,
          detail: `custa ~${brl(d.postponeCost)} esperar 1 mês`,
          value: brl(d.amount),
          tone: 'info',
        })),
      });
    }
  }

  if (avoid.length > 0) {
    blocks.push({
      kind: 'bullets',
      title: 'Não adie',
      items: avoid.slice(0, 5).map((d) => ({
        tone: 'bad' as Tone,
        text: `${d.description} — ${d.postponedTimes >= 2 ? `já foi adiada ${d.postponedTimes}x` : d.consequence}.`,
      })),
    });
  }
  return blocks;
}

function answerRenegotiate(snapshot: FinancialSnapshot, focus: RankedDebt[]): AnswerBlock[] {
  const negotiable = focus
    .filter(
      (d) =>
        ['cartao', 'cheque_especial', 'emprestimo', 'financiamento', 'educacao', 'telecom', 'outros', 'impostos'].includes(d.category) ||
        d.postponedTimes >= 2 ||
        d.daysLate >= 60
    )
    .sort((a, b) => b.monthlyInterestPercent - a.monthlyInterestPercent || b.updatedAmount - a.updatedAmount);
  const maxInstallment = Math.max(0, Math.floor(snapshot.surplus * 0.8));
  const blocks: AnswerBlock[] = [];

  blocks.push({
    kind: 'verdict',
    tone: negotiable.length > 0 ? 'info' : 'good',
    title:
      negotiable.length > 0
        ? `${plural(negotiable.length, 'dívida vale', 'dívidas valem')} a pena renegociar`
        : 'Nenhuma dívida pede renegociação agora',
    text:
      negotiable.length > 0
        ? 'Dívidas caras ou que se arrastam há meses são as que mais rendem desconto numa negociação.'
        : undefined,
  });

  if (negotiable.length > 0) {
    blocks.push({
      kind: 'debts',
      title: 'Comece por estas',
      numbered: true,
      items: negotiable.slice(0, 6).map((d) => ({
        title: d.description,
        detail: `${pct(d.monthlyInterestPercent)} ao mês · vencida ${d.overdueLabel}${d.postponedTimes ? ` · adiada ${d.postponedTimes}x` : ''}`,
        value: brl(d.updatedAmount),
        tone: d.monthlyInterestPercent >= 3 ? 'bad' : 'warn',
        tag: d.categoryLabel,
      })),
    });
  }

  blocks.push({
    kind: 'bullets',
    title: 'Como negociar',
    items: [
      { text: 'Peça primeiro o valor **à vista com desconto**: dívidas antigas costumam ter abatimento grande em juros e multa.' },
      {
        text: snapshot.incomeConfigured
          ? `Só aceite parcela que caiba na sobra mensal: hoje, no máximo **${brl(maxInstallment)}** somando todos os acordos. Acordo quebrado volta com os juros cheios.`
          : 'Só aceite parcela que caiba no que sobra por mês — acordo quebrado volta com os juros cheios.',
        tone: 'warn',
      },
      { text: 'No cartão, troque o rotativo por um parcelamento da fatura com juros menores.' },
      { text: 'Feche só pelos canais oficiais do credor e guarde o protocolo — golpes de falso acordo são comuns.', tone: 'warn' },
      { text: 'Contas essenciais (energia, água, aluguel) também negociam: peça parcelamento antes do corte.' },
    ],
  });
  return blocks;
}

function answerCompare(snapshot: FinancialSnapshot, ids: string[]): AnswerBlock[] {
  const mentioned = snapshot.overdue.filter((d) => ids.includes(d.id));
  // Uma por conta: a mais urgente de cada grupo representa o grupo.
  const byGroup = new Map<string, RankedDebt>();
  for (const debt of mentioned) {
    if (!byGroup.has(debt.groupKey)) byGroup.set(debt.groupKey, debt);
  }
  const [first, second] = [...byGroup.values()].sort((a, b) => a.rank - b.rank);
  if (!first || !second) {
    return [
      {
        kind: 'text',
        text: 'Não encontrei as duas dívidas em atraso que você citou. Use o nome como está cadastrado, por exemplo: "pago a energia ou o cartão?".',
      },
    ];
  }

  const sum = (key: string) => mentioned.filter((d) => d.groupKey === key).reduce((s, d) => s + d.updatedAmount, 0);
  const why: string[] = [];
  if (first.tier < second.tier) {
    if (first.tier === 0) why.push(`${cleanName(first.description)} é essencial: ${first.consequence}`);
    else if (first.tier === 1) why.push(`${cleanName(first.description)} tem juros bem maiores (${pct(first.monthlyInterestPercent)} contra ${pct(second.monthlyInterestPercent)} ao mês)`);
    else if (second.tier === 3) why.push(`você marcou ${cleanName(second.description)} como prioridade baixa`);
  } else {
    if (first.risk > second.risk) why.push(`o risco de não pagar ${cleanName(first.description)} é maior (${first.consequence})`);
    if (first.monthlyInterestPercent > second.monthlyInterestPercent) why.push(`ela custa mais por mês parada (${pct(first.monthlyInterestPercent)} ao mês)`);
    if (first.postponedTimes > second.postponedTimes) why.push(`já foi adiada ${first.postponedTimes}x`);
    if (why.length === 0) why.push('as duas pesam parecido; ela vence há mais tempo');
  }

  return [
    {
      kind: 'verdict',
      tone: 'info',
      title: `Pague primeiro: ${cleanName(first.description)}`,
      text: `Porque ${joinPt(why)}.`,
    },
    {
      kind: 'table',
      columns: ['', cleanName(first.description), cleanName(second.description)],
      rows: [
        ['Em atraso', brl(sum(first.groupKey)), brl(sum(second.groupKey))],
        ['Juros/mês', pct(first.monthlyInterestPercent), pct(second.monthlyInterestPercent)],
        ['Custo/mês', brl(first.monthlyCost), brl(second.monthlyCost)],
        ['Se não pagar', first.consequence, second.consequence],
        ['Posição na fila', `${first.rank}º`, `${second.rank}º`],
      ],
      highlightRow: 4,
    },
  ];
}

function answerDiagnosis(snapshot: FinancialSnapshot): AnswerBlock[] {
  const t = snapshot.totals;
  const blocks: AnswerBlock[] = [];

  let tone: Tone = 'good';
  let title = 'Sua situação está sob controle';
  let text = 'Nenhuma dívida em atraso. Mantenha as contas do mês em dia.';
  if (snapshot.incomeConfigured && snapshot.surplus < 0) {
    tone = 'bad';
    title = 'A renda não fecha as contas do mês';
    text = `Faltam **${brl(-snapshot.surplus)} por mês** só para as contas fixas${t.count > 0 ? `, e há ${brl(t.updatedAmount)} em atraso crescendo ~${brl(t.monthlyCost)}/mês` : ''}. Sem mudar essa conta, a dívida só cresce.`;
  } else if (t.count > 0) {
    const plan = snapshot.surplus > 0 ? planPayoff(snapshot.overdue, snapshot.surplus) : null;
    tone = plan?.finished && plan.months <= 12 ? 'warn' : 'bad';
    title = plan?.finished
      ? `Dá para ficar em dia em ${plural(plan.months, 'mês', 'meses')}`
      : `${brl(t.updatedAmount)} em atraso`;
    text = plan?.finished
      ? `Usando a sobra de ${brl(snapshot.surplus)} por mês com disciplina, você zera os ${brl(t.updatedAmount)} em atraso até ${monthFromNow(snapshot, plan.months)}.`
      : `Os atrasos crescem ~${brl(t.monthlyCost)} por mês.${snapshot.incomeConfigured ? '' : ' Cadastre sua renda para eu montar um prazo.'}`;
  }
  blocks.push({ kind: 'verdict', tone, title, text });

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Renda fixa', value: snapshot.incomeConfigured ? brl(snapshot.recurringIncome) : '—' },
      { label: 'Contas do mês', value: brl(snapshot.fixedMonthly) },
      { label: 'Sobra mensal', value: brl(snapshot.surplus), tone: snapshot.surplus >= 0 ? 'good' : 'bad' },
      { label: 'Em atraso', value: brl(t.updatedAmount), tone: t.count > 0 ? 'bad' : 'good', hint: plural(t.count, 'dívida') },
    ],
  });

  const steps: Array<{ text: string; tone?: Tone }> = [];
  const essentials = snapshot.overdue.filter((d) => d.essential);
  if (essentials.length > 0) {
    steps.push({
      tone: 'bad',
      text: `**Proteja o essencial:** ${joinPt([...new Set(essentials.map((d) => cleanName(d.description)))].slice(0, 4))} — ${brl(essentials.reduce((s, d) => s + d.updatedAmount, 0))}. É o primeiro dinheiro que sai.`,
    });
  }
  for (const loan of snapshot.informalLoans) {
    const months = snapshot.surplus > 0
      ? Math.ceil(loan.principal / snapshot.surplus)
      : 0;
    steps.push({
      tone: 'bad',
      text: `**Saia do agiota:** ${brl(loan.principal)} a ${pct(loan.ratePct)} custam **${brl(loan.monthlyInterest)} todo mês** sem abater nada — em um ano, ${brl(loan.monthlyInterest * 12)} só de juros. ${
        months > 0
          ? `Separando a sobra de ${brl(snapshot.surplus)} por mês, você junta o valor cheio em ${plural(months, 'mês', 'meses')}.`
          : 'Hoje não sobra dinheiro para juntar o valor cheio — qualquer renda extra deve ir para isso.'
      }`,
    });
  }
  const expensive = snapshot.overdue.filter((d) => d.tier === 1);
  if (expensive.length > 0) {
    const top = expensive[0];
    steps.push({
      tone: 'warn',
      text: `**Ataque o mais caro:** ${cleanName(top.description)} cobra ~${pct(top.monthlyInterestPercent)} ao mês. Cada mês parada custa ${brl(top.monthlyCost)}.`,
    });
  }
  const snowball = snapshot.overdue.filter((d) => d.postponedTimes >= 2);
  if (snowball.length > 0) {
    steps.push({
      tone: 'warn',
      text: `**Pare a bola de neve:** ${joinPt([...new Set(snowball.map((d) => cleanName(d.description)))].slice(0, 3))} já ${snowball.length > 1 ? 'foram adiadas' : 'foi adiada'} 2x ou mais. Adiar de novo só soma faturas.`,
    });
  }
  if (snapshot.incomeConfigured && snapshot.surplus < 0) {
    steps.push({
      tone: 'bad',
      text: `**Feche o buraco mensal:** é preciso cortar ou ganhar ${brl(-snapshot.surplus)} por mês. Comece por assinaturas e gastos que não são contas.`,
    });
  }
  const credit = snapshot.overdue.filter((d) => ['cartao', 'cheque_especial', 'emprestimo'].includes(d.category));
  if (credit.length > 0) {
    steps.push({ text: `**Negocie o crédito:** peça desconto à vista em ${joinPt([...new Set(credit.map((d) => cleanName(d.description)))].slice(0, 3))}.` });
  }
  if (t.count > 0 && snapshot.surplus > 0) {
    const maxRate = Math.max(0.5, Math.min(t.weightedRatePct, 8));
    steps.push({
      text: `**Empréstimo só se:** a taxa for menor que ~${pct(maxRate)} ao mês (a média das suas dívidas) e a parcela couber em ${brl(snapshot.surplus)}. Pergunte "vale pegar X emprestado em N vezes de Y?" que eu calculo.`,
    });
  }
  if (steps.length > 0) blocks.push({ kind: 'bullets', title: 'O que fazer, em ordem', items: steps });
  blocks.push(assumptionsNote(snapshot));
  return blocks;
}

/* --- Empréstimo ------------------------------------------------------- */

const SCENARIO_MONTHS = [6, 10, 12, 15, 18, 24, 36, 48];

function loanFullBlocks(snapshot: FinancialSnapshot, a: LoanAnalysis): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const rate = describeRate(a.ratePct);
  const titles = {
    good: 'Vale a pena',
    caution: 'Pode valer, mas com cuidado',
    bad: 'Não recomendo',
  } as const;
  const tones = { good: 'good', caution: 'warn', bad: 'bad' } as const;

  blocks.push({
    kind: 'verdict',
    tone: tones[a.verdict],
    title: titles[a.verdict],
    text: `Empréstimo de **${brl(a.principal)}** em **${a.months}x de ${brl(a.payment)}**: juros de ${pct(a.ratePct, 2)} ao mês (${pct(annualRate(a.ratePct), 0)} ao ano) — ${rate.label}.`,
  });

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Você devolve', value: brl(a.totalPaid), hint: `${a.months}x de ${brl(a.payment)}` },
      { label: 'Juros', value: brl(a.interest), tone: 'warn' },
      { label: 'Quita', value: `${a.allocation.paid.length} de ${snapshot.overdue.length}`, tone: a.allocation.unpaid.length === 0 ? 'good' : 'warn' },
      {
        label: 'Sobra depois',
        value: snapshot.incomeConfigured ? brl(a.surplusAfter) : '—',
        tone: a.surplusAfter >= 0 ? 'good' : 'bad',
      },
    ],
  });

  blocks.push({ kind: 'bullets', title: 'Por quê', items: a.reasons.map((r) => ({ tone: r.tone, text: r.text })) });

  if (a.allocation.paid.length > 0) {
    blocks.push(...allocationBlocks(a.allocation, snapshot.overdue.length, `O que quitar com os ${brl(a.principal)}`));
  }

  if (a.withoutLoan.finished && a.allocation.paid.length > 0) {
    blocks.push({
      kind: 'table',
      title: `Mesmo esforço: ${brl(a.payment)} por mês`,
      columns: ['', 'Com empréstimo', 'Sem empréstimo'],
      rows: [
        ['Prazo', `${a.months} meses`, `${a.withoutLoan.months} meses`],
        ['Total pago', brl(a.loanCost), brl(a.withoutLoan.totalPaid)],
        ['Em dia', 'já no 1º mês', `no ${a.withoutLoan.months}º mês`],
      ],
      highlightRow: 1,
    });
  }

  if (a.allocation.leftover >= Math.max(100, a.principal * 0.1) && a.allocation.paid.length > 0) {
    const smaller = resolveLoanTerms({ principal: a.allocation.used, months: a.months, ratePct: a.ratePct });
    if (smaller) {
      blocks.push({
        kind: 'text',
        text: `Pegando só **${brl(smaller.principal)}** nas mesmas condições, a parcela cai para **${brl(smaller.payment)}**.`,
      });
    }
  }

  blocks.push(
    assumptionsNote(snapshot, [
      'A comparação usa o mesmo valor saindo do seu bolso por mês nos dois caminhos: com o empréstimo você paga as parcelas; sem ele, paga o mesmo valor direto nas dívidas (a mais cara primeiro).',
      'Taxa calculada pela Tabela Price, sem IOF e seguros. Peça sempre o CET (Custo Efetivo Total) ao banco: ele inclui tudo.',
    ])
  );
  return blocks;
}

function loanPartialBlocks(snapshot: FinancialSnapshot, params: QuestionParams): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const totals = snapshot.totals;
  const principal = params.principal;
  const payment = params.monthly;

  // Sem valor: o que custaria ficar em dia.
  if (!principal) {
    blocks.push({
      kind: 'verdict',
      tone: 'info',
      title: `Para ficar em dia você precisaria de ${brl(totals.updatedAmount)}`,
      text: `É o total das ${plural(totals.count, 'dívida')} em atraso com encargos estimados. Me diga o valor, a parcela e o número de parcelas que eu digo se vale a pena — ex.: "pegar 5 mil em 12x de 500".`,
    });
    const scenarios = [2, 4, 6].map((rate) => {
      const t12 = resolveLoanTerms({ principal: totals.updatedAmount, months: 12, ratePct: rate });
      const t24 = resolveLoanTerms({ principal: totals.updatedAmount, months: 24, ratePct: rate });
      return [`${pct(rate)} ao mês`, t12 ? brl(t12.payment) : '—', t24 ? brl(t24.payment) : '—'];
    });
    blocks.push({
      kind: 'table',
      title: `Parcela de um empréstimo de ${brl(totals.updatedAmount)}`,
      columns: ['Taxa (exemplo)', '12x', '24x'],
      rows: scenarios,
    });
    if (snapshot.incomeConfigured) {
      blocks.push({
        kind: 'text',
        text: snapshot.surplus > 0
          ? `A parcela precisa caber na sua sobra mensal de **${brl(snapshot.surplus)}**.`
          : `Hoje não sobra nada por mês (faltam ${brl(-snapshot.surplus)}), então qualquer parcela vira um atraso novo.`,
      });
    }
    return blocks;
  }

  const allocation = allocateBudget(snapshot.overdue, principal);
  blocks.push({
    kind: 'verdict',
    tone: allocation.unpaid.length === 0 ? 'good' : 'info',
    title: `Com ${brl(principal)} você quita ${allocation.paid.length} de ${snapshot.overdue.length} dívidas`,
    text: payment
      ? `Para dizer se ${brl(payment)} por mês é um bom negócio, falta o **número de parcelas** — ele define os juros.`
      : 'Para dizer se vale a pena, preciso da **parcela** e do **número de parcelas** (ou da taxa de juros).',
  });

  if (allocation.paid.length > 0) {
    blocks.push(...allocationBlocks(allocation, snapshot.overdue.length, 'O que quitar'));
  }

  if (allocation.paid.length > 0 && allocation.leftover >= Math.max(100, principal * 0.1)) {
    blocks.push({
      kind: 'verdict',
      tone: 'warn',
      title: `Você só precisa de ${brl(allocation.used)}`,
      text: `Pegando ${brl(principal)}, sobrariam **${brl(allocation.leftover)}** parados — e você pagaria juros sobre eles também. Se for pegar, peça só o necessário.`,
    });
  }

  if (payment) {
    if (snapshot.incomeConfigured) {
      blocks.push({
        kind: 'text',
        text: snapshot.surplus >= payment
          ? `Pelo lado do orçamento, a parcela de ${brl(payment)} **cabe**: sobram ${brl(snapshot.surplus)} por mês.`
          : `Pelo lado do orçamento, a parcela de ${brl(payment)} **não cabe**: sobram só ${brl(snapshot.surplus)} por mês. Isso já é um sinal vermelho.`,
      });
    }

    const withoutLoan = cheapestPayoff(allocation.paid, payment);
    const rows: string[][] = [];
    let highlight: number | undefined;
    for (const n of SCENARIO_MONTHS) {
      if (payment * n <= principal) continue;
      const rate = impliedMonthlyRate(principal, payment, n);
      if (rate > 15) continue;
      const loanCost = payment * n - allocation.leftover;
      const verdict = !withoutLoan.finished || loanCost <= withoutLoan.totalPaid ? 'vale' : 'mais caro';
      if (verdict === 'vale') highlight = rows.length;
      rows.push([`${n}x`, `${pct(rate, 2)}`, brl(payment * n), verdict]);
    }
    if (rows.length > 0) {
      blocks.push({
        kind: 'table',
        title: `${brl(principal)} pagando ${brl(payment)} por mês`,
        columns: ['Prazo', 'Juros', 'Devolve', 'Compensa?'],
        rows,
        highlightRow: highlight,
      });
    }

    if (withoutLoan.finished && allocation.paid.length > 0) {
      const breakEven = Math.floor((withoutLoan.totalPaid + allocation.leftover) / payment);
      blocks.push({
        kind: 'text',
        text: `Regra prática: **só vale se forem até ${breakEven} parcelas** de ${brl(payment)}. Acima disso, você pagaria mais do que gastaria quitando as mesmas dívidas com ${brl(payment)} por mês por conta própria (${withoutLoan.months} meses, ${brl(withoutLoan.totalPaid)}).`,
      });
    } else if (!withoutLoan.finished && allocation.paid.length > 0) {
      blocks.push({
        kind: 'text',
        text: `Sem o empréstimo, ${brl(payment)} por mês nem cobriria os juros dessas dívidas — então qualquer prazo razoável sai mais barato do que deixá-las correndo.`,
      });
    }
  }
  return blocks;
}

/** Lembrete do agiota nas respostas de total: é dívida, mesmo sem atraso. */
function agiotaReminder(snapshot: FinancialSnapshot): AnswerBlock[] {
  if (snapshot.informalLoans.length === 0) return [];
  const principal = snapshot.informalLoans.reduce((s, l) => s + l.principal, 0);
  const interest = snapshot.informalLoans.reduce((s, l) => s + l.monthlyInterest, 0);
  return [
    {
      kind: 'text',
      text: `Fora dos atrasos, você deve **${brl(principal)}** ao agiota, que cobra **${brl(interest)} por mês** só de juros. Os juros só param quando o valor cheio for devolvido.`,
    },
  ];
}

/** "Quanto devo ao agiota?" */
function answerAgiotaStatus(snapshot: FinancialSnapshot): AnswerBlock[] {
  if (snapshot.informalLoans.length === 0) {
    return [
      {
        kind: 'verdict',
        tone: 'good',
        title: 'Nenhum dinheiro com agiota registrado',
        text: 'Se você pegou, registre em Configurações → Pegar dinheiro com agiota para eu acompanhar os juros.',
      },
    ];
  }
  return snapshot.informalLoans.flatMap((loan) => [
    {
      kind: 'verdict' as const,
      tone: 'bad' as const,
      title: `${loan.lender}: você deve ${brl(loan.principal)}`,
      text: `Desde ${loan.takenLabel}, a ${pct(loan.ratePct)} ao mês = **${brl(loan.monthlyInterest)} de juros todo mês**. Já pagou ${brl(loan.interestPaid)} de juros${loan.pendingCharges > 0 ? ` e há ${plural(loan.pendingCharges, 'cobrança', 'cobranças')} de juros em aberto (${brl(loan.pendingAmount)})` : ''}.`,
    },
    {
      kind: 'metrics' as const,
      items: [
        { label: 'Para quitar', value: brl(loan.principal), tone: 'bad' as const },
        { label: 'Juros/mês', value: brl(loan.monthlyInterest), tone: 'warn' as const },
        { label: 'Juros pagos', value: brl(loan.interestPaid) },
        { label: 'Em 12 meses', value: brl(loan.monthlyInterest * 12), hint: 'só de juros' },
      ],
    },
  ]);
}

/**
 * Empréstimo só de juros (agiota): todo mês sai o percentual e o valor pego
 * continua inteiro. A pergunta certa não é a taxa, é quanto tempo até
 * conseguir devolver tudo — e quanto de juros sai até lá.
 */
function agiotaLoanBlocks(snapshot: FinancialSnapshot, params: QuestionParams): AnswerBlock[] {
  const principal = params.principal ?? snapshot.totals.amount;
  const ratePct = params.ratePct ?? 10;
  const monthly = cents((principal * ratePct) / 100);
  const allocation = allocateBudget(snapshot.overdue, principal);
  const freeAfter = snapshot.surplus - monthly;
  const monthsToReturn = freeAfter > 0 ? Math.ceil(principal / freeAfter) : Infinity;
  const blocks: AnswerBlock[] = [];

  // Se a própria sobra resolve as dívidas em um mês, o agiota só traria juros.
  const withoutAgiota = snapshot.surplus > 0 ? planPayoff(allocation.paid, snapshot.surplus) : null;
  const solvableAlone = Boolean(withoutAgiota?.finished && withoutAgiota.months <= 1);
  let tone: Tone = 'bad';
  let title = 'Não recomendo';
  if (!solvableAlone && Number.isFinite(monthsToReturn) && monthsToReturn <= 3 && allocation.paid.some((d) => d.essential)) {
    tone = 'warn';
    title = 'Só se for por pouquíssimo tempo';
  }

  blocks.push({
    kind: 'verdict',
    tone,
    title,
    text: `Pegando **${brl(principal)}** a ${pct(ratePct)} ao mês, você paga **${brl(monthly)} todo mês só de juros**, e continua devendo os ${brl(principal)} inteiros até devolver tudo de uma vez.`,
  });

  blocks.push({
    kind: 'table',
    title: 'Quanto sai só de juros',
    columns: ['Tempo', 'Juros pagos', 'Ainda deve'],
    rows: [3, 6, 12, 24].map((m) => [`${m} meses`, brl(monthly * m), brl(principal)]),
  });

  const reasons: Array<{ text: string; tone?: Tone }> = [];
  if (!snapshot.incomeConfigured) {
    reasons.push({ tone: 'warn', text: 'Cadastre sua renda para eu dizer se os juros cabem no mês.' });
  } else if (freeAfter < 0) {
    reasons.push({
      tone: 'bad',
      text: `Os juros de ${brl(monthly)} não cabem: sobram só ${brl(Math.max(0, snapshot.surplus))} por mês. Você atrasaria o próprio agiota.`,
    });
  } else {
    reasons.push({
      tone: Number.isFinite(monthsToReturn) && monthsToReturn <= 6 ? 'warn' : 'bad',
      text: Number.isFinite(monthsToReturn)
        ? `Depois dos juros sobram ${brl(freeAfter)} por mês. Juntando tudo isso, você devolveria os ${brl(principal)} em **${plural(monthsToReturn, 'mês', 'meses')}** — pagando ${brl(monthly * monthsToReturn)} de juros até lá.`
        : `Depois dos juros não sobra nada para juntar os ${brl(principal)}: a dívida não teria fim.`,
    });
  }
  if (allocation.paid.length > 0) {
    reasons.push({
      tone: 'info',
      text: `Com o dinheiro você quitaria ${allocation.paid.length} de ${snapshot.overdue.length} dívidas em atraso (${brl(allocation.used)}).${
        allocation.paid.some((d) => d.essential) ? ' Inclui contas essenciais com risco de corte.' : ''
      }`,
    });
  }
  if (allocation.leftover >= Math.max(100, principal * 0.1) && allocation.paid.length > 0) {
    reasons.push({
      tone: 'warn',
      text: `Você só precisa de ${brl(allocation.used)}. Cada real a mais pego com agiota custa ${pct(ratePct)} por mês.`,
    });
  }
  const withoutMonths = withoutAgiota;
  if (withoutMonths?.finished && allocation.paid.length > 0) {
    reasons.push({
      tone: 'info',
      text: `Sem o agiota, usando a sobra de ${brl(snapshot.surplus)} por mês direto nas dívidas, você quitaria as mesmas em ${plural(withoutMonths.months, 'mês', 'meses')}, sem juros de agiota.`,
    });
  }
  blocks.push({ kind: 'bullets', title: 'Por quê', items: reasons });
  blocks.push({
    kind: 'text',
    text: 'Se pegar, registre em **Configurações → Pegar dinheiro com agiota**: os juros passam a aparecer todo mês em Contas até você marcar a devolução.',
  });
  return blocks;
}

function answerLoan(snapshot: FinancialSnapshot, params: QuestionParams): AnswerBlock[] {
  if (params.interestOnly) return agiotaLoanBlocks(snapshot, params);
  if (snapshot.overdue.length === 0) return noDebtsAnswer(snapshot, 'loan');

  const terms = resolveLoanTerms({
    principal: params.principal,
    payment: params.monthly,
    months: params.months,
    ratePct: params.ratePct,
  });
  if (terms) return loanFullBlocks(snapshot, analyzeLoan(snapshot, terms));
  return loanPartialBlocks(snapshot, params);
}

/* --- Conversa --------------------------------------------------------- */

export const EXAMPLE_QUESTIONS = [
  'Se eu pegar 5 mil emprestado pagando 500 por mês em 12 vezes, vale a pena?',
  'Quais dívidas devo pagar primeiro?',
  'Vale a pena pegar 3 mil com agiota a 10%?',
  'Tenho 1.500, quantas dívidas consigo quitar?',
  'Quanto eu devo ao agiota?',
  'Quanto eu devo no total?',
  'Em quanto tempo saio das dívidas?',
  'Qual conta posso adiar este mês?',
  'Quais dívidas estão me custando mais juros?',
  'Como renegociar minhas dívidas?',
  'Me dá um diagnóstico da minha situação',
];

function helpBlocks(intro?: string): AnswerBlock[] {
  return [
    {
      kind: 'text',
      text:
        intro ??
        'Eu analiso só o que está cadastrado aqui — renda, contas, atrasos e parcelas — e faço as contas na hora, sem internet e sem IA paga.',
    },
    {
      kind: 'bullets',
      title: 'Você pode perguntar, por exemplo',
      items: EXAMPLE_QUESTIONS.map((q) => ({ text: `“${q}”` })),
    },
    {
      kind: 'note',
      title: 'O que eu entendo',
      items: [
        'Empréstimos: valor, parcela, número de parcelas e juros ("5 mil em 12x de 500", "3 mil a 4% ao mês em 10 vezes").',
        'Valores: "1.500", "R$ 800,00", "2 mil", "cinco mil e quinhentos".',
        'Nomes das suas contas: "quanto devo de energia?", "pago o cartão ou o aluguel?".',
        'Continuações: depois de uma resposta, "e se fossem 24 vezes?" ou "e com 3 mil?".',
      ],
    },
  ];
}

function followUpsFor(intent: Intent, snapshot: FinancialSnapshot, params: QuestionParams): string[] {
  const roundedTotal = Math.max(500, Math.ceil(snapshot.totals.updatedAmount / 500) * 500);
  const hint = snapshot.surplus > 0 ? Math.max(100, Math.floor(snapshot.surplus / 50) * 50) : 300;
  switch (intent) {
    case 'loan':
      if (params.principal && params.monthly && !params.months) return ['Em 12 vezes', 'Em 18 vezes', 'Em 24 vezes'];
      if (params.principal && params.months) {
        return [
          `E se fossem ${params.months >= 24 ? 12 : params.months + 6} vezes?`,
          'Quais dívidas pagar primeiro?',
          'Em quanto tempo saio sem empréstimo?',
        ];
      }
      return [`Se eu pegar ${brl(roundedTotal)} em 12x de ${brl(Math.ceil(roundedTotal / 10 / 10) * 10)}?`, 'Quais dívidas pagar primeiro?'];
    case 'what_to_pay':
    case 'how_many':
      return ['Em quanto tempo saio das dívidas?', `Vale pegar ${brl(roundedTotal)} emprestado?`, 'Qual a mais cara?'];
    case 'total':
      return ['Quais devo pagar primeiro?', 'Em quanto tempo saio das dívidas?', 'Quanto estou pagando de juros?'];
    case 'payoff_time':
      return [`E se eu guardar ${brl(hint + 200)} por mês?`, 'Quais pagar primeiro?', `Vale pegar ${brl(roundedTotal)} emprestado?`];
    case 'budget':
      return ['Qual conta posso adiar?', 'Quanto eu devo no total?'];
    case 'postpone':
      return ['Quais devo pagar primeiro?', 'Quanto sobra este mês?'];
    case 'cost':
      return ['Como renegociar?', 'Quais pagar primeiro?', 'Em quanto tempo saio das dívidas?'];
    case 'renegotiate':
      return ['Qual a mais cara?', 'Em quanto tempo saio das dívidas?'];
    case 'diagnosis':
      return ['Quais pagar primeiro?', 'Em quanto tempo saio das dívidas?', `Vale pegar ${brl(roundedTotal)} emprestado?`];
    case 'compare':
      return ['Quais pagar primeiro?', 'Quanto eu devo no total?'];
    default:
      return EXAMPLE_QUESTIONS.slice(0, 3);
  }
}

/** Intenções que respeitam um filtro por nome ou tipo de conta. */
const FILTERABLE: Intent[] = ['total', 'cost', 'what_to_pay', 'how_many', 'payoff_time', 'renegotiate'];

function focusFor(snapshot: FinancialSnapshot, parsed: ParsedQuestion): { focus: RankedDebt[]; label?: string } {
  if (!FILTERABLE.includes(parsed.intent)) return { focus: snapshot.overdue };
  let focus: RankedDebt[] = [];
  if (parsed.debtIds.length > 0) {
    const ids = new Set(parsed.debtIds);
    focus = snapshot.overdue.filter((d) => ids.has(d.id));
  } else if (parsed.categories.length > 0) {
    focus = snapshot.overdue.filter((d) => parsed.categories.includes(d.category));
  }
  if (focus.length === 0) return { focus: snapshot.overdue };
  const names = [...new Set(focus.map((d) => cleanName(d.description)))];
  const label = parsed.debtIds.length > 0
    ? joinPt(names.slice(0, 3))
    : joinPt(parsed.categories.map((c) => CATEGORY_INFO[c].label.toLowerCase()));
  return { focus: rankDebts(focus), label };
}

export function debtReferences(snapshot: FinancialSnapshot): DebtReference[] {
  return [...snapshot.overdue, ...snapshot.upcoming].map((d) => ({
    id: d.id,
    description: d.description,
    category: d.category,
    groupKey: d.groupKey,
  }));
}

/**
 * Responde uma pergunta em linguagem natural sobre as finanças do usuário.
 *
 * Tudo roda no aparelho: a pergunta é interpretada por regras (parser.ts), os
 * números saem do banco local (snapshot.ts) e as contas são matemática
 * financeira comum (money.ts, strategy.ts). Nenhum dado sai do celular.
 */
export function answerQuestion(
  question: string,
  snapshot: FinancialSnapshot,
  context?: ConversationContext
): Answer {
  const parsed = parseQuestion(question, debtReferences(snapshot), context);
  let intent = parsed.intent;
  const params = parsed.params;

  // Sem assunto reconhecido: um valor solto vira "o que pagar com isso";
  // um nome de conta vira "quanto devo dela".
  if (intent === 'unknown') {
    if (params.amount || params.principal) intent = 'what_to_pay';
    else if (parsed.debtIds.length > 0 || parsed.categories.length > 0) intent = 'total';
  }
  const effective: ParsedQuestion = { ...parsed, intent };
  const { focus, label } = focusFor(snapshot, effective);

  const needsDebts: Intent[] = ['total', 'cost', 'what_to_pay', 'how_many', 'payoff_time', 'renegotiate', 'compare'];
  let blocks: AnswerBlock[];

  if (params.interestOnly && intent !== 'loan') {
    blocks = answerAgiotaStatus(snapshot);
  } else if (needsDebts.includes(intent) && snapshot.overdue.length === 0) {
    blocks = noDebtsAnswer(snapshot, intent);
  } else {
    switch (intent) {
      case 'loan':
        blocks = answerLoan(snapshot, params);
        break;
      case 'what_to_pay':
      case 'how_many':
        blocks = answerWhatToPay(snapshot, focus, params, intent);
        break;
      case 'total':
        blocks = answerTotal(snapshot, focus, label);
        break;
      case 'payoff_time':
        blocks = answerPayoff(snapshot, focus, params);
        break;
      case 'budget':
        blocks = answerBudget(snapshot);
        break;
      case 'postpone':
        blocks = answerPostpone(snapshot);
        break;
      case 'cost':
        blocks = answerCost(snapshot, focus);
        break;
      case 'renegotiate':
        blocks = answerRenegotiate(snapshot, focus);
        break;
      case 'compare':
        blocks = answerCompare(snapshot, parsed.debtIds);
        break;
      case 'diagnosis':
        blocks = answerDiagnosis(snapshot);
        break;
      case 'greeting':
        blocks = [
          {
            kind: 'text',
            text: snapshot.totals.count > 0
              ? `Oi! Você tem ${plural(snapshot.totals.count, 'dívida')} em atraso somando ${brl(snapshot.totals.updatedAmount)}. Quer que eu monte um plano?`
              : 'Oi! Você está sem dívidas em atraso. Posso ajudar com o orçamento do mês.',
          },
        ];
        break;
      case 'thanks':
        blocks = [{ kind: 'text', text: 'Por nada! Estou aqui sempre que precisar refazer as contas.' }];
        break;
      case 'help':
        blocks = helpBlocks();
        break;
      default:
        blocks = helpBlocks(
          'Não entendi essa pergunta. Eu respondo sobre as suas dívidas, empréstimos, prioridades e prazos — de preferência com números.'
        );
    }
  }

  return {
    intent,
    blocks,
    followUps: followUpsFor(intent, snapshot, params),
    context: { intent, params },
  };
}
