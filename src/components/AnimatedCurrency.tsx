import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../utils/formatters';

/**
 * Conta o valor até o número final quando ele muda.
 *
 * Não é enfeite: a animação mostra a direção da mudança. Ao marcar uma conta
 * como paga, ver o "ainda me resta" descer até o novo valor diz o que
 * aconteceu melhor do que o número trocar de um quadro para o outro.
 *
 * Usa easing de saída, então o movimento é rápido no começo e desacelera — o
 * olho registra o valor final, não o percurso.
 *
 * O valor final é garantido por um timer independente do requestAnimationFrame.
 * Aba oculta não executa rAF, e sem essa rede o número congelava no valor
 * inicial para sempre: bastava abrir o app e trocar de aba antes do Dexie
 * responder, ou voltar a um PWA que estava em segundo plano, para os totais
 * ficarem em R$ 0,00.
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const settle = () => {
      fromRef.current = target;
      setValue(target);
    };

    const from = fromRef.current;
    const delta = target - from;

    // Nada a animar.
    if (Math.abs(delta) < 0.005) {
      settle();
      return;
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Sem movimento, ou com a aba oculta (onde rAF não roda), vai direto ao
    // valor final.
    if (reduced || (typeof document !== 'undefined' && document.hidden)) {
      settle();
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);

      if (progress < 1) {
        setValue(from + delta * eased);
        frameRef.current = requestAnimationFrame(tick);
      } else {
        settle();
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    // Rede de segurança: se a aba for ocultada no meio do caminho, os quadros
    // param de chegar. Timers continuam (apenas represados), então este snap
    // garante que o número certo sempre aparece.
    timeoutRef.current = window.setTimeout(settle, durationMs + 120);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      frameRef.current = null;
      timeoutRef.current = null;
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}

export function AnimatedCurrency({
  value,
  className = '',
  durationMs,
  style,
}: {
  value: number;
  className?: string;
  durationMs?: number;
  style?: React.CSSProperties;
}) {
  const animated = useCountUp(value, durationMs);
  return (
    <span className={`tnum ${className}`} style={style}>
      {formatCurrency(animated)}
    </span>
  );
}
