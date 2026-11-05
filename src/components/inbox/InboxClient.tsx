"use client";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, EyeOff, Mail, MessageCircle, Send, Sparkles } from "lucide-react";
import { convertBrief, hideComment, ignoreBrief, markThreadRead, replyComment, saveGmailDraftAction, sendBrandReply, sendLineReplyAction } from "@/app/actions";
import { btn } from "@/components/ui";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/** Opening a thread marks its inbound messages as read. */
export function MarkRead({ brandId, unread }: { brandId: number; unread: number }) {
  useEffect(() => {
    if (unread > 0) markThreadRead(brandId);
  }, [brandId, unread]);
  return null;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btn.ghost}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy size={14} aria-hidden /> {copied ? t.inbox.copied : t.inbox.copy}
    </button>
  );
}

export function ReplyBox({ brandId, suggestion, channel, canGmail = false, canLine = false }: { brandId: number; suggestion: string; channel: string; canGmail?: boolean; canLine?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState(suggestion);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setText(suggestion);
  }, [suggestion]);
  return (
    <div className="border-t border-line p-4">
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <Sparkles size={12} className="text-accent" aria-hidden /> {t.inbox.reply}
        </span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${btn.input} w-full leading-relaxed`} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton text={text} />
        {canLine && (
          <button
            className={btn.primary}
            disabled={pending || !text.trim()}
            onClick={() =>
              start(async () => {
                const r = await sendLineReplyAction(brandId, text);
                setNote({ ok: r.ok, text: r.ok ? t.connect.sentLine : (r.error ?? "") });
              })
            }
          >
            <MessageCircle size={14} aria-hidden /> {t.connect.sendLine}
          </button>
        )}
        {canGmail && (
          <button
            className={btn.ghost}
            disabled={pending || !text.trim()}
            onClick={() =>
              start(async () => {
                const r = await saveGmailDraftAction(brandId, text);
                setNote({ ok: r.ok, text: r.ok ? t.connect.gmailDraftSaved : (r.error ?? "") });
              })
            }
          >
            <Mail size={14} aria-hidden /> {t.connect.saveGmailDraft}
          </button>
        )}
        <button className={canLine ? btn.ghost : btn.primary} disabled={pending || !text.trim()} onClick={() => start(() => sendBrandReply(brandId, text))}>
          <Send size={14} aria-hidden /> {t.inbox.markSent}
        </button>
        <span className="text-xs text-muted">{fmt(t.inbox.replyHint, { channel })}</span>
      </div>
      {note && (
        <p role="status" className={`mt-2 text-xs ${note.ok ? "text-good" : "text-bad"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

export function BriefActions({ messageId, defaultTitle, defaultValue, deliverables }: { messageId: number; defaultTitle: string; defaultValue: number; deliverables: string }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultTitle);
  const [value, setValue] = useState(String(defaultValue));
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-2 border-t border-accent/20 pt-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <label className="text-xs">
          <span className="mb-1 block text-muted">{t.inbox.dealTitle}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${btn.input} w-full`} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted">{t.inbox.dealValue}</span>
          <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={`${btn.input} tabular w-full`} />
        </label>
      </div>
      <p className="text-xs text-muted">
        {t.inbox.deliverables}: {deliverables}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn.primary} disabled={pending} onClick={() => start(() => convertBrief(messageId, title, Number(value)))}>
          <Check size={14} aria-hidden /> {t.inbox.createDeal}
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => ignoreBrief(messageId))}>
          {t.inbox.notBrief}
        </button>
        <span className="text-xs text-muted">{t.inbox.createDealHint}</span>
      </div>
    </div>
  );
}

export function CommentReply({ commentId, suggestion, spam }: { commentId: number; suggestion: string; spam: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState(suggestion);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-2">
      {!spam && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label={t.inbox.yourReply} className={`${btn.input} w-full leading-relaxed`} />}
      <div className="flex flex-wrap gap-2">
        {!spam && (
          <button
            className={btn.primary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await navigator.clipboard.writeText(text).catch(() => {});
                await replyComment(commentId, text);
              })
            }
          >
            <Check size={14} aria-hidden /> {t.inbox.markReplied}
          </button>
        )}
        <button className={btn.ghost} disabled={pending} onClick={() => start(() => hideComment(commentId))}>
          <EyeOff size={14} aria-hidden /> {t.inbox.hide}
        </button>
      </div>
    </div>
  );
}
