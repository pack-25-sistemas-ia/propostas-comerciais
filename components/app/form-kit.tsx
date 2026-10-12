'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import type { ActionState } from '@/lib/actions/result';

export type SaveResult = ActionState & { id?: string };
export type Opt = { value: string; label: string };

/**
 * Formulário com validação no navegador (React Hook Form + Zod) e envio a uma Server Action.
 * O servidor valida de novo com o MESMO esquema: a validação do cliente é só conforto.
 */
export function useActionForm<TIn extends FieldValues, TOut>(opts: {
  schema: ZodType<TOut, TIn>;
  defaultValues: DefaultValues<TIn>;
  action: (input: TIn) => Promise<SaveResult>;
  onSuccess?: (result: SaveResult) => void;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const form = useForm<TIn, unknown, TOut>({ resolver: zodResolver(opts.schema), defaultValues: opts.defaultValues });
  const [state, setState] = useState<SaveResult>({});
  const [pending, start] = useTransition();

  const submit = form.handleSubmit(() => {
    const raw = form.getValues() as TIn;
    start(async () => {
      const result = await opts.action(raw);
      setState(result);
      if (result.fieldErrors) {
        for (const [key, messages] of Object.entries(result.fieldErrors)) {
          if (key !== '_' && messages[0]) form.setError(key as Path<TIn>, { type: 'server', message: messages[0] });
        }
      }
      if (result.ok) {
        if (opts.resetOnSuccess) form.reset(opts.defaultValues);
        opts.onSuccess?.(result);
        router.refresh();
      }
    });
  });

  return { form, state, pending, submit };
}

type FieldProps<T extends FieldValues> = { form: UseFormReturn<T, unknown, unknown>; name: Path<T>; label: string; hint?: string };

function errorOf<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, name: Path<T>): string[] | undefined {
  const message = (form.formState.errors as Record<string, { message?: string } | undefined>)[name]?.message;
  return message ? [message] : undefined;
}

export function TextField<T extends FieldValues>({ form, name, label, hint, type = 'text', placeholder, inputMode, maxLength }: FieldProps<T> & { type?: string; placeholder?: string; inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel'; maxLength?: number }) {
  const errors = errorOf(form, name);
  const id = useId(); // id único: várias telas têm vários formulários com o mesmo nome de campo
  return (
    <Field label={label} name={id} hint={hint} errors={errors}>
      <Input id={id} type={type} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} aria-invalid={Boolean(errors)} {...form.register(name)} />
    </Field>
  );
}

export function SelectField<T extends FieldValues>({ form, name, label, hint, options, empty }: FieldProps<T> & { options: Opt[]; empty?: string }) {
  const errors = errorOf(form, name);
  const id = useId();
  return (
    <Field label={label} name={id} hint={hint} errors={errors}>
      <Select id={id} aria-invalid={Boolean(errors)} {...form.register(name)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </Field>
  );
}

export function TextAreaField<T extends FieldValues>({ form, name, label, hint, maxLength }: FieldProps<T> & { maxLength?: number }) {
  const errors = errorOf(form, name);
  const id = useId();
  return (
    <Field label={label} name={id} hint={hint} errors={errors}>
      <Textarea id={id} maxLength={maxLength} aria-invalid={Boolean(errors)} {...form.register(name)} />
    </Field>
  );
}

export function CheckField<T extends FieldValues>({ form, name, label }: FieldProps<T>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" {...form.register(name)} />
      <span>{label}</span>
    </label>
  );
}

export function FormShell({ onSubmit, pending, state, submitLabel, children, secondary }: { onSubmit: () => void; pending: boolean; state: SaveResult; submitLabel: string; children: ReactNode; secondary?: ReactNode }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-4" noValidate>
      {children}
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Salvando…' : submitLabel}</Button>
        {secondary}
      </div>
    </form>
  );
}

/** Botão de ação simples (arquivar, concluir, apagar) com confirmação opcional e retorno visível. */
export function ActionButton({ label, pendingLabel = '…', action, confirm, variant = 'secondary', onDone }: { label: string; pendingLabel?: string; action: () => Promise<ActionState>; confirm?: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; onDone?: (result: ActionState) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<ActionState>({});
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setMessage(r);
            if (r.ok) { onDone?.(r); router.refresh(); }
          });
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {message.message && !message.ok ? <span role="alert" className="text-xs text-danger">{message.message}</span> : null}
    </span>
  );
}
