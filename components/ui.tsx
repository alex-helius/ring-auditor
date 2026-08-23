"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, Copy, ShieldCheck, X } from "@phosphor-icons/react";
import { explorerAddressUrl, explorerTokenUrl } from "@/lib/config";
import { shortKey } from "@/lib/format";

const CONTROL = "rounded border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent";

export function Caption({ children }: { children: ReactNode }) {
  return <span className="text-muted uppercase tracking-wide text-xs">{children}</span>;
}

export function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <Caption>{text}</Caption>
      {children}
    </label>
  );
}

export function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Label text={label}>
      <input {...input} className={`${CONTROL} font-mono`} />
    </Label>
  );
}

export function Select({ label, ...select }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Label text={label}>
      <select {...select} className={CONTROL} />
    </Label>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 disabled:hover:bg-accent"
    />
  );
}

export function IconButton({
  title,
  framed = false,
  ...props
}: { title: string; framed?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...props}
      className={`inline-flex items-center justify-center text-muted hover:text-text disabled:opacity-40 ${framed ? "rounded border border-line px-3 py-2.5 text-sm" : "text-xs"}`}
    />
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-accent-ground px-2 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

export function Success({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
      {children}
    </span>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      {title && <h2 className="text-sm font-medium">{title}</h2>}
      {children}
    </section>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-full max-w-xl rounded-lg border border-line bg-surface p-0 text-text backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{title}</h2>
          <IconButton title="close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function useCopied(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
  };
  return [copied, copy];
}

/** Middle-truncated, a click copies the full value. */
export function Key({ value, head = 6, tail = 6 }: { value: string; head?: number; tail?: number }) {
  const [copied, copy] = useCopied();
  const plain = head + tail === 0;
  return (
    <button
      type="button"
      title={copied ? "copied" : `${value}\nclick to copy`}
      aria-label={plain ? "copy" : undefined}
      onClick={() => copy(value)}
      className={`inline-flex items-center gap-1 font-mono text-xs ${copied ? "text-emerald-400" : plain ? "text-muted hover:text-text" : "hover:text-accent"}`}
    >
      {plain ? (
        copied ? (
          <Check size={14} weight="bold" />
        ) : (
          <Copy size={14} />
        )
      ) : (
        <>
          {shortKey(value, head, tail)}
          {copied && <Check size={12} weight="bold" />}
        </>
      )}
    </button>
  );
}

export function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Caption>{label}</Caption>
      <div className="flex items-center gap-2 rounded border border-line bg-bg px-3 py-2">
        <Mono>{value}</Mono>
        <Key value={value} head={0} tail={0} />
      </div>
    </div>
  );
}

/** A shell snippet, the button copies the whole thing. */
export function Code({ children }: { children: string }) {
  const [copied, copy] = useCopied();
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded border border-line bg-bg py-2 pl-3 pr-10 font-mono text-xs leading-5">
        {children}
      </pre>
      <button
        type="button"
        title={copied ? "copied" : "copy"}
        aria-label="copy"
        onClick={() => copy(children)}
        className={`absolute right-2 top-2 ${copied ? "text-emerald-400" : "text-muted hover:text-text"}`}
      >
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/**
 * A value kept behind an icon, a click copies it.
 *
 * The audit table names a recipient by its registered address, and the viewing
 * key behind it is the raw identity, too long to read and still worth copying.
 */
export function ViewingKey({ value, children }: { value: string; children: ReactNode }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      title={copied ? "copied" : `${value}\nviewing key, click to copy`}
      aria-label="copy the viewing key"
      onClick={() => copy(value)}
      className={`inline-flex items-center ${copied ? "text-emerald-400" : "text-muted hover:text-text"}`}
    >
      {copied ? <Check size={13} weight="bold" /> : children}
    </button>
  );
}

/** `shielded` marks an address recovered from a shielded owner, and names it on hover. */
export function Address({
  value,
  token = false,
  shielded,
}: {
  value: string;
  token?: boolean;
  shielded?: string | boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {shielded && (
        <span
          className="inline-flex shrink-0 text-accent"
          title={
            typeof shielded === "string"
              ? `${shielded}\nthe shielded address behind this owner`
              : "shielded owner"
          }
        >
          <ShieldCheck size={13} weight="fill" aria-label="shielded owner" />
        </span>
      )}
      <a
        href={token ? explorerTokenUrl(value) : explorerAddressUrl(value)}
        target="_blank"
        rel="noreferrer"
        title={value}
        className="font-mono text-xs underline decoration-line underline-offset-2 hover:text-accent"
      >
        {shortKey(value, 6, 6)}
      </a>
      <Key value={value} head={0} tail={0} />
    </span>
  );
}
