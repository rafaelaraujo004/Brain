import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Mic, MicOff, RotateCcw, SendHorizontal, Sparkles, X } from 'lucide-react';
import { answerQuestion, EXAMPLE_QUESTIONS } from '../../advisor/engine';
import { scopeSnapshot } from '../../advisor/snapshot';
import type { Answer, ConversationContext, FinancialSnapshot } from '../../advisor/types';
import { formatCurrency } from '../../utils/formatters';
import { AnswerView } from './AnswerView';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  answer?: Answer;
  at: number;
}

interface StoredChat {
  messages: ChatMessage[];
  context?: ConversationContext;
}

const STORAGE_KEY = 'paguei_chat_v1';
const MAX_MESSAGES = 40;

function loadChat(): StoredChat {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as StoredChat;
    return Array.isArray(parsed.messages) ? parsed : { messages: [] };
  } catch {
    return { messages: [] };
  }
}

function saveChat(chat: StoredChat): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...chat, messages: chat.messages.slice(-MAX_MESSAGES) })
    );
  } catch {
    // Sem armazenamento (aba anônima, cota cheia): a conversa só não sobrevive ao recarregar.
  }
}

/* --- Voz ---------------------------------------------------------------- */

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Ditado por voz com o reconhecimento do próprio navegador (Chrome, Edge,
 * Safari). Sem custo e sem chave de API; onde não existe, o botão some.
 */
function useSpeech(onFinal: (text: string) => void, onPartial: (text: string) => void) {
  const ctor = useMemo(getSpeechCtor, []);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!ctor) return;
    const recognition = new ctor();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onPartial((finalText + interim).trim());
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText.trim()) onFinal(finalText.trim());
    };
    recognition.onerror = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [ctor, onFinal, onPartial]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported: Boolean(ctor), listening, start, stop };
}

/* --- Painel ------------------------------------------------------------- */

export function AskPanel({
  snapshot,
  scopeIds,
  initialQuestion,
  onClearScope,
}: {
  snapshot: FinancialSnapshot;
  scopeIds: string[];
  initialQuestion?: string;
  onClearScope: () => void;
}) {
  const [chat, setChat] = useState<StoredChat>(loadChat);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const scoped = useMemo(() => scopeSnapshot(snapshot, scopeIds), [snapshot, scopeIds]);
  const scopedRef = useRef(scoped);
  scopedRef.current = scoped;

  useEffect(() => saveChat(chat), [chat]);

  const ask = useCallback((question: string) => {
    const text = question.trim();
    if (!text) return;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text, at: Date.now() };
    setChat((prev) => ({ ...prev, messages: [...prev.messages, userMessage] }));
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '';
    setThinking(true);

    // Uma pausa curta para a resposta não "piscar" antes da pergunta
    // aparecer; o cálculo em si leva milissegundos.
    window.setTimeout(() => {
      setChat((prev) => {
        const answer = answerQuestion(text, scopedRef.current, prev.context);
        const reply: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', answer, at: Date.now() };
        return { messages: [...prev.messages, reply], context: answer.context };
      });
      setThinking(false);
    }, 380);
  }, []);

  // Pergunta vinda de outra tela ("Perguntar sobre as selecionadas"). O ref
  // impede que o StrictMode a envie duas vezes.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (initialQuestion && !sentInitialRef.current) {
      sentInitialRef.current = true;
      ask(initialQuestion);
    }
  }, [initialQuestion, ask]);

  // Leva a pergunta nova e o começo da resposta para a vista.
  useEffect(() => {
    lastMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [chat.messages.length, thinking]);

  const speech = useSpeech(ask, setInput);

  const reset = () => {
    setChat({ messages: [] });
    setInput('');
  };

  const lastAnswer = [...chat.messages].reverse().find((m) => m.role === 'assistant')?.answer;
  const totals = scoped.totals;

  return (
    <div className="space-y-4">
      {scopeIds.length > 0 && (
        <div
          className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 border animate-rise"
          style={{ background: 'var(--color-primary-soft)', borderColor: 'var(--color-primary)' }}
        >
          <Sparkles size={15} className="text-[var(--color-primary)] flex-shrink-0" />
          <p className="text-xs flex-1 min-w-0">
            <span className="font-bold">Respondendo só sobre {scoped.overdue.length} dívida{scoped.overdue.length === 1 ? '' : 's'} selecionada{scoped.overdue.length === 1 ? '' : 's'}</span>{' '}
            <span className="text-[var(--color-text-secondary)] tnum">({formatCurrency(totals.updatedAmount)})</span>
          </p>
          <button
            onClick={onClearScope}
            aria-label="Voltar a considerar todas as dívidas"
            className="btn-icon !w-7 !h-7 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Boas-vindas, quando a conversa está vazia */}
      {chat.messages.length === 0 && (
        <div className="card card-feature animate-rise">
          <div className="flex items-start gap-3">
            <Avatar />
            <div className="min-w-0 space-y-1">
              <p className="font-bold tracking-tight">Pergunte sobre o seu dinheiro</p>
              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                Eu leio as contas, atrasos e a renda que você cadastrou e faço as contas na hora — sem
                internet e sem IA paga. Pergunte com suas palavras, por texto ou por voz.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <MiniStat label="Em atraso" value={formatCurrency(totals.updatedAmount)} tone={totals.count > 0 ? 'var(--color-danger)' : 'var(--color-success)'} />
            <MiniStat label="Dívidas" value={String(totals.count)} />
            <MiniStat
              label="Sobra/mês"
              value={scoped.incomeConfigured ? formatCurrency(scoped.surplus) : '—'}
              tone={scoped.surplus >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
            />
          </div>

          <p className="label-caps mt-5 mb-2">Experimente</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.slice(0, 6).map((q) => (
              <Chip key={q} label={q} onClick={() => ask(q)} />
            ))}
          </div>
        </div>
      )}

      {/* Conversa */}
      <div className="space-y-4">
        {chat.messages.map((message, index) => {
          const isLast = index === chat.messages.length - 1;
          return (
            <div key={message.id} ref={isLast ? lastMessageRef : undefined} className="scroll-mt-4 animate-rise">
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <p
                    className="max-w-[85%] px-4 py-2.5 rounded-3xl rounded-br-lg text-[14px] text-white leading-relaxed whitespace-pre-wrap"
                    style={{
                      background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                      boxShadow: 'var(--shadow-primary)',
                    }}
                  >
                    {message.text}
                  </p>
                </div>
              ) : (
                message.answer && (
                  <div className="flex gap-2.5 items-start">
                    <Avatar small />
                    <div className="card !p-3.5 flex-1 min-w-0 rounded-tl-lg">
                      <AnswerView blocks={message.answer.blocks} />
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })}

        {thinking && (
          <div className="flex gap-2.5 items-center animate-fade">
            <Avatar small />
            <div className="card !py-3 !px-4 flex gap-1.5" aria-label="Calculando">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-bounce"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {!thinking && lastAnswer && lastAnswer.followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-10 animate-rise">
            {lastAnswer.followUps.map((q) => (
              <Chip key={q} label={q} onClick={() => ask(q)} />
            ))}
          </div>
        )}
      </div>

      {/* Campo de pergunta: fica preso acima da navegação no celular */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] md:bottom-4 z-30 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-end gap-2 rounded-3xl border p-2 pl-4"
          style={{ background: 'var(--surface-elevated)', borderColor: 'var(--border-strong)', boxShadow: 'var(--shadow-lg)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              // Cresce com o texto até 4 linhas; depois disso, rola.
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
              el.style.overflowY = el.scrollHeight > 112 ? 'auto' : 'hidden';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder={speech.listening ? 'Ouvindo…' : 'Digite ou fale sua pergunta'}
            aria-label="Sua pergunta"
            className="flex-1 min-w-0 bg-transparent outline-none resize-none overflow-hidden text-[14px] leading-6 py-2 max-h-28 placeholder:text-[var(--color-text-tertiary)]"
          />
          {chat.messages.length > 0 && !input && (
            <button
              type="button"
              onClick={reset}
              aria-label="Nova conversa"
              title="Nova conversa"
              className="btn-icon !w-10 !h-10 rounded-2xl text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)]"
            >
              <RotateCcw size={17} />
            </button>
          )}
          {speech.supported && (
            <button
              type="button"
              onClick={speech.listening ? speech.stop : speech.start}
              aria-label={speech.listening ? 'Parar de ouvir' : 'Perguntar por voz'}
              className={`btn-icon !w-10 !h-10 rounded-2xl ${speech.listening ? 'animate-pulse' : ''}`}
              style={{
                background: speech.listening ? 'var(--color-danger-soft)' : 'var(--color-surface-2)',
                color: speech.listening ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              }}
            >
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="Enviar pergunta"
            className="btn-icon !w-10 !h-10 rounded-2xl text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
          >
            <SendHorizontal size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Avatar({ small }: { small?: boolean }) {
  const size = small ? 'w-8 h-8 rounded-xl' : 'w-11 h-11 rounded-2xl';
  return (
    <span
      className={`${size} flex items-center justify-center flex-shrink-0 text-white`}
      style={{
        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
        boxShadow: 'var(--shadow-primary)',
      }}
    >
      <Brain size={small ? 15 : 20} />
    </span>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-[12px] font-semibold px-3 py-2 rounded-2xl border transition-all duration-150 active:scale-95 hover:border-[var(--color-primary)]"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-primary)',
      }}
    >
      {label}
    </button>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl p-2.5 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}>
      <p className="label-caps !text-[10px] truncate">{label}</p>
      <p className="text-[13px] font-extrabold tnum tracking-tight mt-0.5 truncate" style={{ color: tone }}>
        {value}
      </p>
    </div>
  );
}
