import { useState } from 'react';
import { Copy } from 'lucide-react';

function Command({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 mt-2.5 text-[10px] font-semibold text-muted">{label}</div>
      <code className="block select-all break-all rounded-md border border-line bg-canvas p-2 text-[11px]">{text}</code>
    </div>
  );
}

export function SetupPanel({ extensionId }: { extensionId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(extensionId); setCopied(true); }
    catch { setCopied(false); }
  };
  return (
    <section className="mb-4 grid gap-4 rounded-xl border border-line bg-paper p-5 md:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">One-time setup</div>
        <h2 className="mb-2 mt-1.5 text-base font-semibold">Connect your local companion</h2>
        <p className="max-w-md text-xs leading-relaxed text-muted">
          The companion reads Chrome’s operating-system memory and CPU statistics. Everything stays on this computer.
        </p>
      </div>
      <div className="text-xs">
        <p className="text-muted">Load this extension, then run the installer from the project folder:</p>
        <Command label="Windows" text={`py -3 scripts/install_host.py ${extensionId}`} />
        <Command label="macOS" text={`python3 scripts/install_host.py ${extensionId}`} />
        <p className="mt-2.5 flex flex-wrap items-center gap-2 text-muted">
          Requires Python 3.10+ for installation.
          <button type="button" onClick={copy} className="flex items-center gap-1 font-semibold text-brand-line underline">
            <Copy size={12} aria-hidden="true" />{copied ? 'Copied' : 'Copy extension ID'}
          </button>
        </p>
      </div>
    </section>
  );
}
