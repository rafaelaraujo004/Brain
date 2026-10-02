import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from 'lucide-react';
import type { AnswerBlock, Tone } from '../../advisor/types';

export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  bad: 'var(--color-danger)',
  info: 'var(--color-primary)',
};

const TONE_SOFT: Record<Tone, string> = {
  good: 'var(--color-success-soft)',
  warn: 'var(--color-warning-soft)',
  bad: 'var(--color-danger-soft)',
  info: 'var(--color-primary-soft)',
};

const TONE_ICON: Record<Tone, typeof Info> = {
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  info: Info,
};

/** Texto com **negrito** — a única marcação que as respostas usam. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-bold text-[var(--color-text)]">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="label-caps mb-2">{children}</p>;
}

function Block({ block }: { block: AnswerBlock }) {
  switch (block.kind) {
    case 'text':
      return (
        <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          <RichText text={block.text} />
        </p>
      );

    case 'verdict': {
      const Icon = TONE_ICON[block.tone];
      return (
        <div
          className="rounded-2xl p-3.5 flex gap-3 items-start"
          style={{ background: TONE_SOFT[block.tone] }}
        >
          <Icon size={20} className="flex-shrink-0 mt-0.5" style={{ color: TONE_COLOR[block.tone] }} />
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold tracking-tight leading-snug" style={{ color: TONE_COLOR[block.tone] }}>
              {block.title}
            </p>
            {block.text && (
              <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] mt-1">
                <RichText text={block.text} />
              </p>
            )}
          </div>
        </div>
      );
    }

    case 'metrics':
      return (
        <div className="grid grid-cols-2 gap-2">
          {block.items.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl p-3 border"
              style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}
            >
              <p className="label-caps leading-tight">{item.label}</p>
              <p
                className="text-[15px] font-extrabold tnum tracking-tight mt-1 truncate"
                style={{ color: item.tone ? TONE_COLOR[item.tone] : undefined }}
              >
                {item.value}
              </p>
              {item.hint && (
                <p className="text-[10px] text-[var(--color-text-tertiary)] truncate">{item.hint}</p>
              )}
            </div>
          ))}
        </div>
      );

    case 'debts':
      return (
        <div>
          {block.title && <Caption>{block.title}</Caption>}
          <div
            className="rounded-2xl border divide-y overflow-hidden"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {block.items.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className="flex items-start gap-3 px-3 py-2.5"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {block.numbered && (
                  <span
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-extrabold flex-shrink-0 tnum mt-0.5"
                    style={{
                      background: TONE_SOFT[item.tone ?? 'info'],
                      color: TONE_COLOR[item.tone ?? 'info'],
                    }}
                  >
                    {index + 1}
                  </span>
                )}
                {!block.numbered && (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2"
                    style={{ background: TONE_COLOR[item.tone ?? 'info'] }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
                    {item.tag && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}
                      >
                        {item.tag}
                      </span>
                    )}
                  </div>
                  {item.detail && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug mt-0.5">
                      {item.detail}
                    </p>
                  )}
                </div>
                {item.value && (
                  <span className="text-[13px] font-bold tnum flex-shrink-0 whitespace-nowrap">{item.value}</span>
                )}
              </div>
            ))}
          </div>
          {block.footer && (
            <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] mt-1.5 px-1 tnum">
              {block.footer}
            </p>
          )}
        </div>
      );

    case 'bullets':
      return (
        <div>
          {block.title && <Caption>{block.title}</Caption>}
          <ul className="space-y-2">
            {block.items.map((item, index) => (
              <li key={index} className="flex gap-2.5 items-start">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]"
                  style={{ background: TONE_COLOR[item.tone ?? 'info'] }}
                />
                <span className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                  <RichText text={item.text} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'table': {
      // Tabelas largas apertam o espaçamento para caber no celular sem
      // rolagem lateral.
      const dense = block.columns.length >= 4;
      const pad = dense ? 'px-1.5 py-2' : 'px-3 py-2';
      return (
        <div>
          {block.title && <Caption>{block.title}</Caption>}
          <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
            <table className={`w-full tnum ${dense ? 'text-[11px]' : 'text-[12px]'}`}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)' }}>
                  {block.columns.map((col, i) => (
                    <th
                      key={i}
                      className={`${pad} font-semibold text-[var(--color-text-tertiary)] ${
                        i === 0 ? 'text-left' : 'text-right'
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr
                    key={r}
                    className="border-t"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: r === block.highlightRow ? 'var(--color-primary-soft)' : undefined,
                    }}
                  >
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={`${pad} ${c === 0 ? 'text-left font-semibold' : 'text-right'}`}
                        style={{
                          color:
                            cell === 'vale'
                              ? 'var(--color-success)'
                              : cell === 'mais caro'
                              ? 'var(--color-danger)'
                              : undefined,
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case 'note':
      return (
        <details className="group rounded-2xl px-3 py-2.5" style={{ background: 'var(--color-surface-2)' }}>
          <summary className="flex items-center justify-between cursor-pointer list-none text-[12px] font-semibold text-[var(--color-text-secondary)]">
            {block.title}
            <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="mt-2 space-y-1.5">
            {block.items.map((item, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                {item}
              </li>
            ))}
          </ul>
        </details>
      );
  }
}

/** Renderiza a resposta do assistente, bloco a bloco. */
export function AnswerView({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
