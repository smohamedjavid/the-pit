"use client";

import { useState } from "react";

/**
 * Per-slip "verify this yourself" affordance. Hands a judge the on-chain
 * account, its sealed keccak hash, and the exact zero-credential one-liner
 * that audits THIS single commitment — with a wax-stamp copy button. The
 * command mirrors scripts/verify.ts's `--commitment` focus flag.
 */

const short = (s: string): string =>
  s.length > 12 ? `${s.slice(0, 5)}…${s.slice(-5)}` : s;

export function VerifyStrip({
  commitment,
  hashHex,
  link,
}: {
  commitment: string;
  hashHex: string;
  link?: string;
}) {
  const cmd = `npx tsx scripts/verify.ts --commitment ${commitment}`;
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // older/insecure contexts: fall back to a throwaway textarea
      const ta = document.createElement("textarea");
      ta.value = cmd;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable — nothing else to try */
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="verify-strip">
      <div className="vs-head">
        <span className="vs-title">Verify this slip</span>
        <span className="vs-sub">zero credentials</span>
      </div>
      <dl className="vs-facts">
        <div>
          <dt>account</dt>
          <dd>
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {short(commitment)} ↗
              </a>
            ) : (
              short(commitment)
            )}
          </dd>
        </div>
        <div>
          <dt>keccak</dt>
          <dd className="vs-hash">{hashHex}</dd>
        </div>
      </dl>
      <div className="vs-cmd-row">
        <code className="vs-cmd" title={cmd}>
          {cmd}
        </code>
        <button
          type="button"
          className={`vs-copy${copied ? " done" : ""}`}
          onClick={copy}
          aria-live="polite"
          aria-label={copied ? "verify command copied" : "copy verify command"}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}
