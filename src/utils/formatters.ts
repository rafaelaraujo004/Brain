export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function getMonthName(month: number): string {
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return months[month - 1] || '';
}

export function getShortMonthName(month: number): string {
  const months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ];
  return months[month - 1] || '';
}

export function getCurrentMonthYear() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

export function calculateEndDate(
  startMonth: number,
  startYear: number,
  totalInstallments: number
): { month: number; year: number } {
  let endMonth = startMonth + totalInstallments - 1;
  let endYear = startYear;

  while (endMonth > 12) {
    endMonth -= 12;
    endYear++;
  }

  return { month: endMonth, year: endYear };
}

export function getInstallmentStatus(
  dueDay: number,
  currentMonth: number,
  currentYear: number,
  startMonth: number,
  startYear: number,
  paidInstallments: number,
  totalInstallments: number
): 'paid' | 'pending' | 'overdue' {
  const monthsSinceStart = (currentYear - startYear) * 12 + (currentMonth - startMonth);
  const expectedInstallment = monthsSinceStart + 1;

  if (expectedInstallment > totalInstallments) return 'paid';
  if (paidInstallments >= expectedInstallment) return 'paid';

  const today = new Date();
  if (
    today.getFullYear() === currentYear &&
    today.getMonth() + 1 === currentMonth &&
    today.getDate() > dueDay &&
    paidInstallments < expectedInstallment
  ) {
    return 'overdue';
  }

  return 'pending';
}
