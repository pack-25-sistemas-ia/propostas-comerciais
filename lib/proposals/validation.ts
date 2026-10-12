// Validação dos formulários (cliente e servidor usam o MESMO esquema).
// As entradas chegam como texto; a saída já vem normalizada para gravar no banco (dinheiro em CENTAVOS).
import { z } from 'zod';
import { isValidDocument, parseDecimalText, parseMoneyToCents } from './format';

export const text = (min: number, max: number) =>
  z.string().trim().min(min, min <= 1 ? 'Campo obrigatório.' : `Informe ao menos ${min} caracteres.`).max(max, `Máximo de ${max} caracteres.`);

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres.`).transform((v) => (v === '' ? null : v));

export const optionalUuid = z.union([z.literal(''), z.uuid('Seleção inválida.')]).transform((v) => (v === '' ? null : v));

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo.')
  .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido.')
  .transform((v) => (v === '' ? null : v));

export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}
const requiredDate = z.string().trim().refine(isRealDate, 'Data inválida.');

/** Valor em reais digitado -> centavos inteiros. */
export const moneyCents = z
  .string()
  .trim()
  .refine((v) => parseMoneyToCents(v) !== null, 'Informe um valor válido (ex.: 1.500,00).')
  .transform((v) => parseMoneyToCents(v) as number);

const percent = (label: string) =>
  z.string().trim().refine((v) => {
    const t = parseDecimalText(v, 2);
    return t !== null && Number(t) <= 100;
  }, `${label}: informe de 0 a 100, com até 2 casas.`).transform((v) => parseDecimalText(v, 2) as string);

const intInRange = (min: number, max: number, label: string) =>
  z.string().trim().regex(/^\d+$/, `${label}: informe um número inteiro.`).transform(Number).refine((n) => n >= min && n <= max, `${label}: de ${min} a ${max}.`);

const hexColor = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Use o formato #RRGGBB.').transform((v) => v.toUpperCase());

const documentField = z
  .string()
  .trim()
  .max(20, 'Documento muito longo.')
  .refine((v) => isValidDocument(v), 'CPF ou CNPJ inválido.')
  .transform((v) => (v.replace(/\D/g, '') === '' ? null : v.replace(/\D/g, '')));

// ---------------------------------------------------------------- clientes
export const CLIENT_TYPES = ['company', 'person'] as const;
export const CLIENT_TYPE_LABELS: Record<(typeof CLIENT_TYPES)[number], string> = { company: 'Empresa', person: 'Pessoa física' };

export const clientSchema = z.object({
  type: z.enum(CLIENT_TYPES, 'Tipo inválido.'),
  name: text(2, 160),
  legal_name: optionalText(160),
  document_number: documentField,
  email: optionalEmail,
  phone: optionalText(30),
  address: optionalText(300),
  notes: optionalText(4000),
});
export type ClientInput = z.input<typeof clientSchema>;
export type ClientData = z.output<typeof clientSchema>;

// ---------------------------------------------------------------- catálogo
export const catalogItemSchema = z.object({
  type: z.enum(['product', 'service'], 'Tipo inválido.'),
  name: text(2, 160),
  description: optionalText(2000),
  sku: z.string().trim().max(40, 'Máximo de 40 caracteres.').transform((v) => (v === '' ? null : v)),
  unit: text(1, 20),
  default_price: moneyCents,
  active: z.boolean(),
});
export type CatalogInput = z.input<typeof catalogItemSchema>;

// ---------------------------------------------------------------- propostas
export const proposalCreateSchema = z.object({
  client_id: z.uuid('Selecione o cliente.'),
  title: text(2, 160),
  template_id: optionalUuid,
});
export type ProposalCreateInput = z.input<typeof proposalCreateSchema>;

export const draftItemSchema = z.object({
  catalog_item_id: z.uuid().nullable(),
  item_type: z.enum(['product', 'service']),
  name: text(1, 160),
  description: z.string().trim().max(2000).nullable(),
  unit: text(1, 20),
  /** texto decimal canônico, até 4 casas */
  quantity: z.string().trim().refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0 && Number(v) <= 99_999_999, 'Quantidade inválida.'),
  unit_price_cents: z.number().int().min(0).max(99_999_999_999),
  discount_kind: z.enum(['none', 'percent', 'fixed']),
  /** percentual (texto) ou centavos (texto inteiro) */
  discount_value: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Desconto inválido.'),
});

export const draftChargeSchema = z.object({
  label: text(1, 60),
  kind: z.enum(['percent', 'fixed']),
  value: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Encargo inválido.'),
});

export const draftSchema = z.object({
  title: text(2, 160),
  client_id: z.uuid('Selecione o cliente.'),
  template_id: z.uuid().nullable(),
  issue_date: requiredDate,
  valid_until: z.string().trim().refine((v) => v === '' || isRealDate(v), 'Data inválida.').transform((v) => (v === '' ? null : v)),
  discount: z.object({ kind: z.enum(['none', 'percent', 'fixed']), value: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Desconto inválido.') }),
  charges: z.array(draftChargeSchema).max(10, 'No máximo 10 encargos.'),
  items: z.array(draftItemSchema).max(200, 'No máximo 200 itens.'),
  /** conteúdo bruto; é sanitizado no servidor (lib/proposals/content.ts) */
  content: z.unknown(),
});
export type DraftInput = z.input<typeof draftSchema>;
export type DraftData = z.output<typeof draftSchema>;

export const shareLinkSchema = z.object({
  proposal_id: z.uuid(),
  days: intInRange(1, 365, 'Validade do link'),
});

// ---------------------------------------------------------------- decisão do cliente (público)
export const decisionSchema = z.object({
  decision: z.enum(['accepted', 'declined']),
  name: text(2, 120),
  email: z.string().trim().toLowerCase().max(254, 'E-mail muito longo.').pipe(z.email('E-mail inválido.')),
  comment: optionalText(1000),
  confirm: z.literal(true, 'Marque a confirmação para continuar.'),
});
export type DecisionInput = z.input<typeof decisionSchema>;

// ---------------------------------------------------------------- configurações, modelos, metas
export const settingsSchema = z.object({
  legal_name: optionalText(160),
  document_number: documentField,
  email: optionalEmail,
  phone: optionalText(30),
  address: optionalText(300),
  footer_text: optionalText(400),
  number_prefix: z.string().trim().regex(/^[A-Za-z0-9-]{0,10}$/, 'Até 10 letras, números ou hífen.'),
  default_validity_days: intInRange(1, 365, 'Validade padrão'),
  default_terms: optionalText(4000),
  primary_color: hexColor,
  secondary_color: hexColor,
  max_discount_member_pct: percent('Limite do vendedor'),
  max_discount_manager_pct: percent('Limite do gestor'),
  alert_expiring_days: intInRange(1, 90, 'Alerta de vencimento'),
  alert_no_reply_days: intInRange(1, 90, 'Alerta de falta de retorno'),
  alert_recent_accept_days: intInRange(1, 90, 'Aceites recentes'),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export const templateSchema = z.object({
  name: text(2, 80),
  description: optionalText(300),
});
export type TemplateInput = z.input<typeof templateSchema>;

export const goalSchema = z
  .object({
    user_id: z.uuid('Selecione o vendedor.'),
    period_start: requiredDate,
    period_end: requiredDate,
    target: moneyCents.refine((v) => v > 0, 'A meta precisa ser maior que zero.'),
  })
  .refine((v) => v.period_end >= v.period_start, { path: ['period_end'], message: 'O fim não pode ser anterior ao início.' });
export type GoalInput = z.input<typeof goalSchema>;

export const MAX_LOGO_BYTES = 300_000;
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpeg' } as const;
