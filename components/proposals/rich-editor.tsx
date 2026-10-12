'use client';

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import { EMPTY_DOC, isDocEmpty, safeHref, sanitizeDoc, type PMDoc } from '@/lib/proposals/content';
import './rich-editor.css';

// Editor do texto comercial (Tiptap, só extensões MIT do núcleo). Só os recursos permitidos pelo conteúdo seguro:
// negrito, itálico, títulos 2/3, listas, link (http/https/mailto) e linha. Tudo que sai passa por sanitizeDoc.
// injectCSS: false — a CSP estrita bloqueia o <style> que o Tiptap injetaria; os estilos vêm de rich-editor.css.

// Forma canônica: documento sem texto (só parágrafos vazios) é o documento vazio. Evita "alterações" fantasma ao abrir o editor.
const canon = (d: unknown): PMDoc => { const c = sanitizeDoc(d); return isDocEmpty(c) ? EMPTY_DOC : c; };

type Props = { value: PMDoc; onChange: (doc: PMDoc) => void; label: string; id: string; disabled?: boolean };

function Btn({ pressed, onClick, label, children, disabled }: { pressed?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`min-h-9 min-w-9 rounded border px-2 text-sm font-medium disabled:opacity-40 ${pressed ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-black/5 dark:hover:bg-white/5'}`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState('');
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), link: e.isActive('link'), canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const applyLink = () => {
    if (href.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const safe = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(href.trim()) ? href.trim() : `https://${href.trim()}`);
    if (!safe) { setLinkError('Use um endereço http, https ou mailto.'); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    setLinkOpen(false);
    setLinkError('');
  };
  return (
    <div className="border-b border-border p-2">
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formatação do texto">
        <Btn label="Negrito" pressed={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><strong>N</strong></Btn>
        <Btn label="Itálico" pressed={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Btn>
        <Btn label="Título" pressed={st.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>T1</Btn>
        <Btn label="Subtítulo" pressed={st.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>T2</Btn>
        <Btn label="Lista com marcadores" pressed={st.ul} onClick={() => editor.chain().focus().toggleBulletList().run()}>• Lista</Btn>
        <Btn label="Lista numerada" pressed={st.ol} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Lista</Btn>
        <Btn label="Link" pressed={st.link} onClick={() => { setHref(editor.getAttributes('link').href ?? ''); setLinkError(''); setLinkOpen((o) => !o); }}>Link</Btn>
        <Btn label="Separador" onClick={() => editor.chain().focus().setHorizontalRule().run()}>—</Btn>
        <Btn label="Desfazer" disabled={!st.canUndo} onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
        <Btn label="Refazer" disabled={!st.canRedo} onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
      </div>
      {linkOpen ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <div className="min-w-56 flex-1">
            <label className="sr-only" htmlFor={`link-${editor.instanceId}`}>Endereço do link</label>
            <input
              id={`link-${editor.instanceId}`} value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://exemplo.com.br"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
              className="min-h-9 w-full rounded border border-border bg-card px-2 text-sm"
            />
            {linkError ? <p role="alert" className="mt-1 text-xs text-danger">{linkError}</p> : null}
          </div>
          <Btn label="Aplicar link" onClick={applyLink}>Aplicar</Btn>
        </div>
      ) : null}
    </div>
  );
}

export function RichEditor({ value, onChange, label, id, disabled }: Props) {
  const [initial] = useState(value);
  const emitted = useRef(JSON.stringify(canon(value)));
  const editor = useEditor({
    immediatelyRender: false,
    injectCSS: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] }, blockquote: false, code: false, codeBlock: false, strike: false, underline: false, trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
    ],
    content: initial.content.length ? initial : undefined,
    editorProps: { attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox', id } },
    onUpdate: ({ editor: e }) => {
      const clean = canon(e.getJSON());
      const json = JSON.stringify(clean);
      if (json === emitted.current) return; // nada mudou de verdade
      emitted.current = json;
      onChange(clean);
    },
  });

  // valor trocado de fora (ex.: restaurar): só atualiza o editor se for diferente do que ele mesmo emitiu
  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(canon(value));
    if (incoming !== emitted.current) {
      emitted.current = incoming;
      editor.commands.setContent(value.content.length ? value : '', { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);

  if (!editor) return <div className="min-h-40 animate-pulse rounded-md border border-border bg-black/5" aria-hidden="true" />;
  return (
    <div className="rich-editor rounded-md border border-border bg-card">
      {disabled ? null : <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
