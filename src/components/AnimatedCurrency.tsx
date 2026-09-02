import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../utils/formatters';

/**
 * Conta o valor até o número final quando ele muda.
 *
 * Não é enfeite: a animação mostra a direção da mudança. Ao marcar uma conta
 * como paga, ver o "ainda me resta" descer até o novo valor diz o que
 * aconteceu melhor do que o número trocar de um quadro para o outro.
 *
 * Usa easing de saída, então o movimento é rápido no começo e desacelera —
 * o olho registra o valor final, não o percurso.
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const delta = target - from;

    if (Math.abs(delta) < 0.005) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    // Quem pediu menos movimento recebe o valor direto.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      setValue(next);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setValue(target);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
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
