import { formatCurrency } from '../utils/formatters';
import type { SpendingReport } from './collect';

function pct(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * Leituras curtas do relatório, em frases. Só aparece o que é verdade e
 * relevante para o período — nada de frase genérica.
 */
export function spendingInsights(report: SpendingReport, periodLabel: string): string[] {
  const lines: string[] = [];
  const byPaid = [...report.groups].sort((a, b) => b.paid - a.paid);
  const byProjected = [...report.groups].sort((a, b) => b.projected - a.projected);

  if (report.paid <= 0) {
    if (report.open > 0) {
      lines.push(
        `Nada foi pago ainda ${periodLabel}. A projeção abaixo mostra para onde vão os **${formatCurrency(report.open)}** em aberto.`
      );
    }
    return lines;
  }

  const top = byPaid[0];
  lines.push(
    `Seu maior gasto é **${top.label}**: ${pct(top.paid, report.paid)} do que você pagou (${formatCurrency(top.paid)}).`
  );

  if (report.income > 0) {
    lines.push(`Você já pagou **${pct(report.paid, report.income)}** da sua renda ${periodLabel}.`);
  }

  const debts = report.groups.find((g) => g.group === 'dividas');
  if (debts && debts.paid / report.paid >= 0.2) {
    lines.push(
      `**${pct(debts.paid, report.paid)}** do que você pagou foi para dívidas e crédito — dinheiro que não vira serviço nem bem.`
    );
  }

  if (report.open > 0 && byProjected[0] && byProjected[0].group !== top.group) {
    lines.push(`Pagando o que está em aberto, **${byProjected[0].label}** passa a ser o maior gasto.`);
  }

  const other = report.groups.find((g) => g.group === 'outros');
  if (other && other.projected > 0 && other.projected / report.projected >= 0.1) {
    lines.push(
      `**${formatCurrency(other.projected)}** estão em Outros. Toque no grupo e reclassifique — o retrato fica mais fiel.`
    );
  }
  return lines;
}
