# Gestão de Propostas Comerciais

Crie, versione, envie e acompanhe propostas comerciais: cadastro de clientes e catálogo, construtor com cálculo confiável, PDF profissional, link seguro com aceite ou recusa e indicadores reais. Next.js + Supabase, com RLS em todas as tabelas.

**Público:** agências, consultorias, empresas de tecnologia, prestadores de serviço, manutenção, engenharia e arquitetura, distribuidoras, representantes e PMEs B2B.
**Problema:** propostas feitas à mão em Word ou Excel, sem versões, sem controle de desconto, sem status e sem histórico.

## O que tem
- **Clientes** (empresa ou pessoa, CPF/CNPJ validado), arquivar, busca, **importar e exportar CSV**.
- **Catálogo** de produtos e serviços. Ao entrar numa proposta o item é **copiado**: mudar o catálogo depois não altera propostas publicadas.
- **Construtor**: itens, desconto por item e geral, encargos, validade, seções de texto (Tiptap), prévia, aviso de alterações não salvas. Valores **calculados no banco** (centavos, arredondamento documentado).
- **3 modelos visuais** (Corporativo, Agência Criativa, Serviços Técnicos). O conteúdo é independente do modelo.
- **Versões imutáveis**: publicar congela a revisão; mudanças viram nova revisão. Histórico completo.
- **PDF A4** da revisão (idêntico sempre).
- **Link seguro** (token de 256 bits, só o hash no banco), revogação, expiração, **aceite ou recusa** do cliente sem login. Impede dupla decisão, decisão sobre versão antiga e aceite após o vencimento.
- **Limite de desconto por perfil** (vendedor, gestor) aplicado na publicação.
- **Painel**: 8 indicadores, 7 gráficos, filtros (período, vendedor, cliente, status, tipo), alertas (vencendo, vencidas, sem retorno, aceitas recentes) e metas. Fórmulas em [docs/METRICS.md](docs/METRICS.md).
- **Relatórios** (9) com CSV. Configurações da empresa, logotipo e cores.
- Do Core: login, organização, papéis (proprietário, administrador, gestor, vendedor, leitor), verificação em duas etapas, auditoria e privacidade (LGPD).

## Fora do escopo
NF-e/NFS-e · contabilidade · cobrança e pagamento · **assinatura eletrônica certificada** · ERP/CRM completo · WhatsApp · IA paga · entrevista de personalização.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Gestão de Propostas Comerciais: https://github.com/pack-25-sistemas-ia/propostas-comerciais
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local            # preencha com o SEU projeto Supabase
supabase start && supabase db reset   # banco local com dados fictícios
pnpm dev
```
Produção, e-mail, backup e rollback: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Banco e permissões: [docs/DATABASE.md](docs/DATABASE.md). Arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Evidência dos testes: [docs/FEATURES.md](docs/FEATURES.md). Para adaptar a um cliente, abra a pasta no Claude Code ou Codex e peça: «leia o AGENTS.md e o MEMORY.md».

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm test:db` (RLS, cálculo, fluxo e indicadores no banco) · `pnpm test:e2e` (navegador, com Supabase real).

## Privacidade (LGPD)
Risco: **médio**. Dados pessoais: nome, e-mail, telefone, endereço comercial e CPF/CNPJ de clientes; nome e e-mail de quem responde pelo link. Sem IP nem user-agent do cliente. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica. Os dados de demonstração são fictícios.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
