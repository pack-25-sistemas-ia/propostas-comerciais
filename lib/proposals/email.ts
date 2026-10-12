import 'server-only';

// E-mail desacoplado de provedor. Sem configuração, NADA é enviado e o resultado diz isso com clareza
// ("not_configured"): o usuário copia o link e compartilha por onde preferir. Texto simples, sem HTML.
// Provedor suportado de fábrica: Resend (API HTTP, sem dependência). Para outro provedor, implemente `EmailProvider`.
//   EMAIL_PROVIDER=resend  RESEND_API_KEY=...  EMAIL_FROM="Empresa <propostas@seudominio.com.br>"

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailResult = { status: 'sent' | 'failed' | 'not_configured'; reference?: string; error?: string };
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}

const resend: EmailProvider = {
  async send(message) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) return { status: 'not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        signal: controller.signal,
      });
      if (!res.ok) return { status: 'failed', error: `O provedor recusou o envio (HTTP ${res.status}).` };
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { status: 'sent', reference: typeof body.id === 'string' ? body.id.slice(0, 200) : undefined };
    } catch {
      return { status: 'failed', error: 'Não foi possível falar com o provedor de e-mail.' };
    } finally {
      clearTimeout(timer);
    }
  },
};

export function emailProvider(): EmailProvider | null {
  return process.env.EMAIL_PROVIDER === 'resend' ? resend : null;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = emailProvider();
  return provider ? provider.send(message) : { status: 'not_configured' };
}

/** Texto do e-mail de envio da proposta (simples, sem HTML; o link é o único conteúdo ativo). */
export function proposalEmailText(p: { company: string; client: string; title: string; number: string; url: string; validUntil: string | null }): EmailMessage['text'] {
  return [
    `Olá, ${p.client}.`,
    '',
    `${p.company} enviou a proposta ${p.number} — ${p.title}.`,
    p.validUntil ? `Ela é válida até ${p.validUntil}.` : '',
    '',
    'Acesse, confira os valores e responda pelo link:',
    p.url,
    '',
    'Se você não esperava esta mensagem, pode ignorá-la.',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
