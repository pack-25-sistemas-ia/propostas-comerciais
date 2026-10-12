'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Input, Select } from '@/components/ui/primitives';
import { publishRevision, saveDraft } from '@/lib/proposals/actions';
import { EMPTY_DOC, SECTION_KINDS, SECTION_LABELS, type PMDoc, type SectionKind } from '@/lib/proposals/content';
import { buildDraftSnapshot } from '@/lib/proposals/draft-snapshot';
import { centsToInput, formatMoney, formatPct, parseDecimalText, parseMoneyToCents } from '@/lib/proposals/format';
import { computePricing, PricingError, totalDiscountPct, type PricingResult } from '@/lib/proposals/pricing';
import type { CatalogRow } from '@/lib/proposals/data';
import type { ProposalStatus } from '@/lib/proposals/filters';
import type { Snapshot, TemplateBase } from '@/lib/proposals/snapshot';
import { newKey, type BuilderClient, type BuilderItem, type BuilderState } from './builder-state';
export type { BuilderCharge, BuilderClient, BuilderItem, BuilderState } from './builder-state';
import { DocumentView, docThemeHref } from './document-view';
import { RichEditor } from './rich-editor';
import { StatusBadge } from './status-badge';

// Construtor de propostas. O navegador mostra uma PRÉVIA dos totais (espelho do motor de cálculo); quem calcula e grava
// é o banco (prop_save_draft / prop_publish_revision). Alterações não salvas ficam sinalizadas e protegidas.

export type BuilderProps = {
  proposalId: string; number: string; status: ProposalStatus; version: number; revisionId: string;
  initial: BuilderState; clients: BuilderClient[]; templates: Array<{ id: string; name: string; base: TemplateBase }>; catalog: CatalogRow[];
  company: Snapshot['company']; limitPct: number | null;
};

const TABS = [['info', 'Informações'], ['items', 'Itens e valores'], ['content', 'Conteúdo'], ['preview', 'Pré-visualização']] as const;
type Tab = (typeof TABS)[number][0];

type Parsed = {
  items: Array<{ catalog_item_id: string | null; item_type: 'product' | 'service'; name: string; description: string | null; unit: string; quantity: string; unit_price_cents: number; discount_kind: 'none' | 'percent' | 'fixed'; discount_value: string }>;
  discount: { kind: 'none' | 'percent' | 'fixed'; value: string };
  charges: Array<{ label: string; kind: 'percent' | 'fixed'; value: string }>;
  errors: { items: Record<number, string>; charges: Record<number, string>; discount?: string };
};

/** Texto digitado -> valores canônicos do payload. Os erros aparecem ao lado do campo. */
function parseState(st: BuilderState): Parsed {
  const errors: Parsed['errors'] = { items: {}, charges: {} };
  const amount = (kind: 'none' | 'percent' | 'fixed', raw: string): string | null => {
    if (kind === 'none') return '0';
    if (kind === 'percent') {
      const t = parseDecimalText(raw || '0', 2);
      return t !== null && Number(t) <= 100 ? t : null;
    }
    const cents = parseMoneyToCents(raw || '0');
    return cents === null ? null : String(cents);
  };
  const items = st.items.map((it, i) => {
    const qty = parseDecimalText(it.quantity, 4);
    const price = parseMoneyToCents(it.price || '0');
    const disc = amount(it.discount_kind, it.discount_value);
    if (!it.name.trim()) errors.items[i] = 'Informe o nome do item.';
    else if (qty === null || Number(qty) <= 0) errors.items[i] = 'Quantidade inválida (até 4 casas decimais, maior que zero).';
    else if (price === null) errors.items[i] = 'Preço inválido (ex.: 1.500,00).';
    else if (disc === null) errors.items[i] = it.discount_kind === 'percent' ? 'Desconto: de 0 a 100, com até 2 casas.' : 'Desconto inválido (ex.: 100,00).';
    return {
      catalog_item_id: it.catalog_item_id, item_type: it.item_type, name: it.name.trim(), description: it.description.trim() || null, unit: it.unit.trim() || 'un',
      quantity: qty ?? '0', unit_price_cents: price ?? 0, discount_kind: it.discount_kind, discount_value: disc ?? '0',
    };
  });
  const gd = amount(st.discountKind, st.discountValue);
  if (gd === null) errors.discount = st.discountKind === 'percent' ? 'Desconto: de 0 a 100, com até 2 casas.' : 'Desconto inválido (ex.: 100,00).';
  const charges = st.charges.map((c, i) => {
    const v = amount(c.kind, c.value);
    if (!c.label.trim()) errors.charges[i] = 'Informe o nome do encargo.';
    else if (v === null) errors.charges[i] = 'Valor inválido.';
    return { label: c.label.trim(), kind: c.kind, value: v ?? '0' };
  });
  return { items, discount: { kind: st.discountKind, value: gd ?? '0' }, charges, errors };
}

const hasErrors = (p: Parsed) => Object.keys(p.errors.items).length > 0 || Object.keys(p.errors.charges).length > 0 || Boolean(p.errors.discount);

export function ProposalBuilder(props: BuilderProps) {
  const router = useRouter();
  const uid = useId();
  const [st, setSt] = useState<BuilderState>(props.initial);
  const [tab, setTab] = useState<Tab>('info');
  const [busy, setBusy] = useState<'save' | 'publish' | 'pdf' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [catalogPick, setCatalogPick] = useState('');
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(props.initial));
  const dirty = JSON.stringify(st) !== savedJson;

  const parsed = useMemo(() => parseState(st), [st]);
  const pricing: { ok: true; result: PricingResult } | { ok: false; error: string } = useMemo(() => {
    if (hasErrors(parsed)) return { ok: false, error: 'Corrija os campos destacados para ver os totais.' };
    try {
      return { ok: true, result: computePricing(parsed.items.map((i) => ({ quantity: i.quantity, unit_price_cents: i.unit_price_cents, discount_kind: i.discount_kind, discount_value: i.discount_value })), parsed.discount, parsed.charges) };
    } catch (e) {
      return { ok: false, error: e instanceof PricingError ? e.message : 'Valores inválidos.' };
    }
  }, [parsed]);

  const patch = useCallback((p: Partial<BuilderState>) => setSt((s) => ({ ...s, ...p })), []);

  // proteção contra perda: fechar/recarregar com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const payload = useCallback(() => ({
    title: st.title, client_id: st.clientId, template_id: st.templateId || null, issue_date: st.issueDate, valid_until: st.validUntil,
    discount: parsed.discount, charges: parsed.charges, items: parsed.items, content: { sections: st.sections },
  }), [st, parsed]);

  const save = useCallback(async (): Promise<boolean> => {
    if (hasErrors(parsed)) { setMessage({ tone: 'error', text: 'Corrija os campos destacados antes de salvar.' }); setTab('items'); return false; }
    setBusy('save'); setMessage(null);
    const r = await saveDraft(props.revisionId, payload());
    setBusy(null);
    if (!r.ok) {
      const first = r.fieldErrors ? Object.values(r.fieldErrors)[0]?.[0] : null;
      setMessage({ tone: 'error', text: first ? `${r.message ?? 'Não foi possível salvar.'} ${first}` : r.message ?? 'Não foi possível salvar.' });
      return false;
    }
    setSavedJson(JSON.stringify(st));
    setSavedAt(new Date());
    setMessage({ tone: 'success', text: 'Rascunho salvo.' });
    return true;
  }, [parsed, payload, props.revisionId, st]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const publish = async () => {
    if (!window.confirm('Publicar esta versão? Depois de publicada ela não pode mais ser alterada (você poderá criar uma nova revisão).')) return;
    if (!(await save())) return;
    setBusy('publish'); setMessage(null);
    const r = await publishRevision(props.revisionId);
    setBusy(null);
    if (!r.ok) { setMessage({ tone: 'error', text: r.message ?? 'Não foi possível publicar.' }); return; }
    setSavedJson(JSON.stringify(st));
    router.push(`/propostas/${props.proposalId}?published=1`);
  };

  const pdf = async () => {
    if (dirty && !(await save())) return;
    setBusy('pdf');
    const link = document.createElement('a'); // download do PDF (rota de arquivo, não é página)
    link.href = `/propostas/${props.proposalId}/pdf?rev=${props.revisionId}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => setBusy(null), 1500);
  };

  // ------------------------------------------------------------ itens
  const addItem = (partial?: Partial<BuilderItem>) => patch({ items: [...st.items, { key: newKey(), catalog_item_id: null, item_type: 'service', name: '', description: '', unit: 'un', quantity: '1', price: '0,00', discount_kind: 'none', discount_value: '', ...partial }] });
  const setItem = (i: number, p: Partial<BuilderItem>) => patch({ items: st.items.map((it, n) => (n === i ? { ...it, ...p } : it)) });
  const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  };

  // ------------------------------------------------------------ prévia
  const client = props.clients.find((c) => c.id === st.clientId) ?? null;
  const tpl = props.templates.find((t) => t.id === st.templateId) ?? props.templates[0];
  const draftSnap = useMemo(() => {
    if (!client || hasErrors(parsed) || parsed.items.length === 0) return null;
    const built = buildDraftSnapshot({
      number: props.number, title: st.title || 'Sem título', version: props.version, issueDate: st.issueDate, validUntil: st.validUntil || null,
      templateBase: tpl?.base ?? 'corporate', templateName: tpl?.name ?? null, content: { sections: st.sections },
      items: parsed.items, discount: parsed.discount, charges: parsed.charges, company: props.company,
      client: { type: client.type, name: client.name, legal_name: client.legal_name, document_number: client.document_number, email: client.email, phone: client.phone, address: client.address },
    });
    return built.ok ? built.snapshot : null;
  }, [client, parsed, props.company, props.number, props.version, st.issueDate, st.sections, st.title, st.validUntil, tpl]);

  const discountPct = pricing.ok ? totalDiscountPct(pricing.result) : null;
  const overLimit = props.limitPct !== null && discountPct !== null && discountPct > props.limitPct;
  const statusNote = savedAt ? `Salvo às ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Sem alterações';

  return (
    <div>
      {/* barra superior */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">Proposta {props.number} <span className="text-sm font-normal text-muted">· versão {props.version}</span></p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge status={props.status} />
              <span role="status" aria-live="polite">{dirty ? <Badge tone="warning">Alterações não salvas</Badge> : statusNote}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void save()} disabled={busy !== null} aria-busy={busy === 'save'}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</Button>
            <Button type="button" variant="secondary" onClick={() => setTab('preview')}>Visualizar</Button>
            <Button type="button" variant="secondary" onClick={() => void pdf()} disabled={busy !== null}>Exportar PDF</Button>
            <Button type="button" onClick={() => void publish()} disabled={busy !== null || overLimit} aria-busy={busy === 'publish'}>{busy === 'publish' ? 'Publicando…' : 'Publicar'}</Button>
          </div>
        </div>
        <div role="tablist" aria-label="Seções do construtor" className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button
              key={id} type="button" role="tab" id={`${uid}-tab-${id}`} aria-selected={tab === id} aria-controls={`${uid}-panel-${id}`}
              onClick={() => setTab(id)}
              className={`min-h-10 shrink-0 rounded-md px-3 text-sm font-medium ${tab === id ? 'bg-primary text-primary-foreground' : 'border border-border bg-card hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {message ? <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div> : null}
      {overLimit ? <div className="mb-4"><Alert tone="warning">O desconto total ({formatPct(discountPct)}) passa do limite do seu perfil ({formatPct(props.limitPct)}). Reduza o desconto para poder publicar.</Alert></div> : null}

      {/* informações */}
      <div role="tabpanel" id={`${uid}-panel-info`} aria-labelledby={`${uid}-tab-info`} hidden={tab !== 'info'}>
        <Card title="Informações">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${uid}-title`} className="mb-1.5 block text-sm font-medium">Título da proposta</label>
              <Input id={`${uid}-title`} value={st.title} maxLength={160} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-client`} className="mb-1.5 block text-sm font-medium">Cliente</label>
              <Select id={`${uid}-client`} value={st.clientId} disabled={props.status !== 'draft'} onChange={(e) => patch({ clientId: e.target.value })}>
                {props.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {props.status !== 'draft' ? <p className="mt-1 text-xs text-muted">O cliente só pode ser trocado antes da primeira publicação.</p> : null}
            </div>
            <div>
              <label htmlFor={`${uid}-tpl`} className="mb-1.5 block text-sm font-medium">Modelo visual</label>
              <Select id={`${uid}-tpl`} value={st.templateId} onChange={(e) => patch({ templateId: e.target.value })}>
                {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <p className="mt-1 text-xs text-muted">Trocar o modelo muda só a aparência; o conteúdo não se perde.</p>
            </div>
            <div>
              <label htmlFor={`${uid}-issue`} className="mb-1.5 block text-sm font-medium">Data de emissão</label>
              <Input id={`${uid}-issue`} type="date" value={st.issueDate} onChange={(e) => patch({ issueDate: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-valid`} className="mb-1.5 block text-sm font-medium">Válida até</label>
              <Input id={`${uid}-valid`} type="date" value={st.validUntil} onChange={(e) => patch({ validUntil: e.target.value })} />
              <p className="mt-1 text-xs text-muted">Obrigatória para publicar. Depois dessa data o cliente não consegue mais aceitar.</p>
            </div>
          </div>
        </Card>
      </div>

      {/* itens */}
      <div role="tabpanel" id={`${uid}-panel-items`} aria-labelledby={`${uid}-tab-items`} hidden={tab !== 'items'} className="space-y-4">
        <Card title="Itens" description="Os valores são calculados no servidor ao salvar; aqui você vê uma prévia.">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor={`${uid}-cat`} className="mb-1.5 block text-sm font-medium">Adicionar do catálogo</label>
              <Select id={`${uid}-cat`} value={catalogPick} onChange={(e) => setCatalogPick(e.target.value)}>
                <option value="">Selecione um item…</option>
                {props.catalog.map((c) => <option key={c.id} value={c.id}>{c.name} — {formatMoney(c.default_price_cents)}</option>)}
              </Select>
            </div>
            <Button type="button" variant="secondary" disabled={!catalogPick} onClick={() => {
              const c = props.catalog.find((x) => x.id === catalogPick);
              if (c) addItem({ catalog_item_id: c.id, item_type: c.type, name: c.name, description: c.description ?? '', unit: c.unit, price: centsToInput(c.default_price_cents) });
              setCatalogPick('');
            }}>Adicionar</Button>
            <Button type="button" variant="secondary" onClick={() => addItem()}>Item avulso</Button>
          </div>

          {st.items.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">Nenhum item. Adicione do catálogo ou crie um item avulso.</p> : null}
          <ol className="space-y-3">
            {st.items.map((it, i) => {
              const line = pricing.ok ? pricing.result.items[i] : null;
              const err = parsed.errors.items[i];
              return (
                <li key={it.key} className="rounded-lg border border-border p-3" aria-label={`Linha do item ${i + 1}`}>
                  <div className="grid gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-6">
                      <label htmlFor={`${it.key}-n`} className="mb-1 block text-xs font-medium text-muted">Item {i + 1}</label>
                      <Input id={`${it.key}-n`} value={it.name} maxLength={160} onChange={(e) => setItem(i, { name: e.target.value })} aria-invalid={Boolean(err)} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`${it.key}-t`} className="mb-1 block text-xs font-medium text-muted">Tipo</label>
                      <Select id={`${it.key}-t`} value={it.item_type} onChange={(e) => setItem(i, { item_type: e.target.value as 'product' | 'service' })}>
                        <option value="service">Serviço</option><option value="product">Produto</option>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`${it.key}-q`} className="mb-1 block text-xs font-medium text-muted">Quantidade</label>
                      <Input id={`${it.key}-q`} value={it.quantity} inputMode="decimal" onChange={(e) => setItem(i, { quantity: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`${it.key}-u`} className="mb-1 block text-xs font-medium text-muted">Unidade</label>
                      <Input id={`${it.key}-u`} value={it.unit} maxLength={20} onChange={(e) => setItem(i, { unit: e.target.value })} />
                    </div>
                    <div className="sm:col-span-3">
                      <label htmlFor={`${it.key}-p`} className="mb-1 block text-xs font-medium text-muted">Preço unitário (R$)</label>
                      <Input id={`${it.key}-p`} value={it.price} inputMode="decimal" onChange={(e) => setItem(i, { price: e.target.value })} />
                    </div>
                    <div className="sm:col-span-3">
                      <label htmlFor={`${it.key}-dk`} className="mb-1 block text-xs font-medium text-muted">Desconto</label>
                      <div className="flex gap-2">
                        <Select id={`${it.key}-dk`} value={it.discount_kind} onChange={(e) => setItem(i, { discount_kind: e.target.value as BuilderItem['discount_kind'], discount_value: '' })} className="w-28">
                          <option value="none">Nenhum</option><option value="percent">%</option><option value="fixed">R$</option>
                        </Select>
                        {it.discount_kind !== 'none' ? <Input aria-label={`Valor do desconto do item ${i + 1}`} value={it.discount_value} inputMode="decimal" onChange={(e) => setItem(i, { discount_value: e.target.value })} /> : null}
                      </div>
                    </div>
                    <div className="sm:col-span-6">
                      <label htmlFor={`${it.key}-d`} className="mb-1 block text-xs font-medium text-muted">Descrição (opcional)</label>
                      <Input id={`${it.key}-d`} value={it.description} maxLength={2000} onChange={(e) => setItem(i, { description: e.target.value })} />
                    </div>
                  </div>
                  {err ? <p role="alert" className="mt-2 text-xs text-danger">{err}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">Total do item: <strong className="tabular-nums">{line ? formatMoney(line.total_cents) : '—'}</strong>{line && line.discount_cents > 0 ? <span className="ml-2 text-xs text-muted">(desconto de {formatMoney(line.discount_cents)})</span> : null}</p>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" aria-label={`Mover item ${i + 1} para cima`} disabled={i === 0} onClick={() => patch({ items: move(st.items, i, -1) })}>↑</Button>
                      <Button type="button" variant="ghost" aria-label={`Mover item ${i + 1} para baixo`} disabled={i === st.items.length - 1} onClick={() => patch({ items: move(st.items, i, 1) })}>↓</Button>
                      <Button type="button" variant="ghost" aria-label={`Duplicar item ${i + 1}`} onClick={() => patch({ items: [...st.items.slice(0, i + 1), { ...it, key: newKey() }, ...st.items.slice(i + 1)] })}>Duplicar</Button>
                      <Button type="button" variant="ghost" aria-label={`Remover item ${i + 1}`} onClick={() => patch({ items: st.items.filter((_, n) => n !== i) })}>Remover</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card title="Desconto geral e encargos">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-gd`} className="mb-1.5 block text-sm font-medium">Desconto geral</label>
              <div className="flex gap-2">
                <Select id={`${uid}-gd`} value={st.discountKind} onChange={(e) => patch({ discountKind: e.target.value as BuilderState['discountKind'], discountValue: '' })} className="w-32">
                  <option value="none">Nenhum</option><option value="percent">%</option><option value="fixed">R$</option>
                </Select>
                {st.discountKind !== 'none' ? <Input aria-label="Valor do desconto geral" value={st.discountValue} inputMode="decimal" onChange={(e) => patch({ discountValue: e.target.value })} /> : null}
              </div>
              {parsed.errors.discount ? <p role="alert" className="mt-1 text-xs text-danger">{parsed.errors.discount}</p> : <p className="mt-1 text-xs text-muted">Aplicado sobre o subtotal, depois dos descontos dos itens.</p>}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Encargos <span className="font-normal text-muted">(frete, taxas… calculados sobre o valor após o desconto geral)</span></p>
            {st.charges.map((c, i) => (
              <div key={c.key} className="flex flex-wrap items-start gap-2">
                <Input aria-label={`Nome do encargo ${i + 1}`} placeholder="Ex.: Frete" value={c.label} maxLength={60} onChange={(e) => patch({ charges: st.charges.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) })} className="min-w-40 flex-1" />
                <Select aria-label={`Tipo do encargo ${i + 1}`} value={c.kind} onChange={(e) => patch({ charges: st.charges.map((x, n) => (n === i ? { ...x, kind: e.target.value as 'percent' | 'fixed', value: '' } : x)) })} className="w-24">
                  <option value="fixed">R$</option><option value="percent">%</option>
                </Select>
                <Input aria-label={`Valor do encargo ${i + 1}`} value={c.value} inputMode="decimal" onChange={(e) => patch({ charges: st.charges.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)) })} className="w-32" />
                <Button type="button" variant="ghost" aria-label={`Remover encargo ${i + 1}`} onClick={() => patch({ charges: st.charges.filter((_, n) => n !== i) })}>Remover</Button>
                {parsed.errors.charges[i] ? <p role="alert" className="w-full text-xs text-danger">{parsed.errors.charges[i]}</p> : null}
              </div>
            ))}
            {st.charges.length < 10 ? <Button type="button" variant="secondary" onClick={() => patch({ charges: [...st.charges, { key: newKey(), label: '', kind: 'fixed', value: '' }] })}>Adicionar encargo</Button> : null}
          </div>
        </Card>

        <Card title="Totais (prévia)">
          {pricing.ok ? (
            <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" aria-live="polite">
              <dt className="text-muted">Valor bruto dos itens</dt><dd className="text-right tabular-nums">{formatMoney(pricing.result.gross_cents)}</dd>
              {pricing.result.items_discount_cents > 0 ? <><dt className="text-muted">Descontos dos itens</dt><dd className="text-right tabular-nums">− {formatMoney(pricing.result.items_discount_cents)}</dd></> : null}
              <dt className="text-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatMoney(pricing.result.subtotal_cents)}</dd>
              {pricing.result.discount_cents > 0 ? <><dt className="text-muted">Desconto geral</dt><dd className="text-right tabular-nums">− {formatMoney(pricing.result.discount_cents)}</dd></> : null}
              {pricing.result.charges.map((c, i) => <Fragment key={i}><dt className="text-muted">{c.label}</dt><dd className="text-right tabular-nums">+ {formatMoney(c.amount_cents)}</dd></Fragment>)}
              <dt className="border-t border-border pt-1 text-base font-semibold">Total</dt><dd className="border-t border-border pt-1 text-right text-base font-bold tabular-nums" data-testid="total">{formatMoney(pricing.result.total_cents)}</dd>
              {discountPct !== null ? <><dt className="pt-2 text-xs text-muted">Desconto total sobre o bruto</dt><dd className="pt-2 text-right text-xs tabular-nums">{formatPct(discountPct)}{props.limitPct !== null ? ` (limite ${formatPct(props.limitPct)})` : ''}</dd></> : null}
            </dl>
          ) : <p className="text-sm text-muted">{pricing.error}</p>}
        </Card>
      </div>

      {/* conteúdo */}
      <div role="tabpanel" id={`${uid}-panel-content`} aria-labelledby={`${uid}-tab-content`} hidden={tab !== 'content'} className="space-y-4">
        <p className="text-sm text-muted">Monte o texto da proposta em seções. Nem toda seção precisa aparecer: desmarque «Exibir» para ocultar sem apagar.</p>
        {st.sections.map((sec, i) => (
          <Card key={sec.id}>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor={`${sec.id}-t`} className="mb-1 block text-xs font-medium text-muted">Título da seção</label>
                <Input id={`${sec.id}-t`} value={sec.title} maxLength={160} onChange={(e) => patch({ sections: st.sections.map((s, n) => (n === i ? { ...s, title: e.target.value } : s)) })} />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={sec.enabled} onChange={(e) => patch({ sections: st.sections.map((s, n) => (n === i ? { ...s, enabled: e.target.checked } : s)) })} />Exibir</label>
              <div className="flex gap-1 pb-0.5">
                <Button type="button" variant="ghost" aria-label={`Mover seção ${sec.title} para cima`} disabled={i === 0} onClick={() => patch({ sections: move(st.sections, i, -1) })}>↑</Button>
                <Button type="button" variant="ghost" aria-label={`Mover seção ${sec.title} para baixo`} disabled={i === st.sections.length - 1} onClick={() => patch({ sections: move(st.sections, i, 1) })}>↓</Button>
                <Button type="button" variant="ghost" aria-label={`Remover seção ${sec.title}`} onClick={() => { if (window.confirm('Remover esta seção e o texto dela?')) patch({ sections: st.sections.filter((_, n) => n !== i) }); }}>Remover</Button>
              </div>
            </div>
            <RichEditor id={`${sec.id}-ed`} label={`Texto da seção ${sec.title}`} value={sec.content} onChange={(doc: PMDoc) => setSt((s) => ({ ...s, sections: s.sections.map((x, n) => (n === i ? { ...x, content: doc } : x)) }))} />
          </Card>
        ))}
        {st.sections.length < 30 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${uid}-newsec`} className="mb-1.5 block text-sm font-medium">Adicionar seção</label>
              <Select id={`${uid}-newsec`} defaultValue="" onChange={(e) => {
                const kind = e.target.value as SectionKind;
                if (!kind) return;
                patch({ sections: [...st.sections, { id: newKey(), kind, title: SECTION_LABELS[kind], enabled: true, content: EMPTY_DOC }] });
                e.target.value = '';
              }}>
                <option value="">Escolha o tipo…</option>
                {SECTION_KINDS.map((k) => <option key={k} value={k}>{SECTION_LABELS[k]}</option>)}
              </Select>
            </div>
          </div>
        ) : null}
        {st.sections.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">Sem seções. Adicione apresentação, escopo, condições… ou publique só com a tabela de valores.</p> : null}
      </div>

      {/* prévia */}
      <div role="tabpanel" id={`${uid}-panel-preview`} aria-labelledby={`${uid}-tab-preview`} hidden={tab !== 'preview'}>
        {draftSnap ? (
          <>
            <link rel="stylesheet" href={docThemeHref(draftSnap.company.primary_color, draftSnap.company.secondary_color)} precedence="doc-theme" />
            <p className="mb-3 text-sm text-muted">Prévia do que será publicado (modelo «{tpl?.name}»). Valores recalculados a cada alteração; os definitivos são gravados pelo servidor.</p>
            <DocumentView snapshot={draftSnap} />
          </>
        ) : (
          <Alert tone="info">Para ver a prévia, selecione o cliente, adicione ao menos um item e corrija eventuais campos destacados.</Alert>
        )}
      </div>

      <p className="mt-6 text-xs text-muted">
        <Link className="underline" href={`/propostas/${props.proposalId}`}>Voltar para a proposta</Link> · Atalho: Ctrl+S salva.
      </p>
    </div>
  );
}

