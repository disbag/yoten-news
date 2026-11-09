"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SettingsGroup } from "./SettingsRows";

type Transfer = { code: string; qr: string; expiresAt: string };
type Device = { label: string; lastSeen: string; current: boolean };

async function postTransfer(path: string, body: object = {}) {
  const response = await fetch(`/api/transfer${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Попробуйте ещё раз");
  return result;
}

export default function TransferSettings({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!/^[A-Z0-9-]{16,19}$/i.test(fragment)) return;
    setInput(fragment);
    // Подтверждение на втором устройстве требуется даже при открытии QR.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (!transfer) return;
    const timer = setTimeout(() => setTransfer(null), Math.max(0, Date.parse(transfer.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [transfer]);

  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Попробуйте ещё раз"); }
    finally { setBusy(false); }
  }

  function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      await postTransfer("/claim", { code: input });
      window.location.reload();
    });
  }

  return (
    <div className="transfer">
      <SettingsGroup title="Связанные устройства">
        {devices.length ? (
          <ul className="devices">
            {devices.map((device, index) => (
              <li key={index}>
                <strong>{device.label}</strong>
                {device.current ? <span className="current">Это устройство</span> : null}
                <span className="last-seen">Последняя активность {device.lastSeen}</span>
              </li>
            ))}
          </ul>
        ) : <p>Пока нет связанных устройств.</p>}
      </SettingsGroup>
      {error ? <p role="alert" className="error">{error}</p> : null}

      <SettingsGroup title="Перенести на другое устройство">
        <p>Откройте Yoten на втором устройстве и введите код или отсканируйте QR. Код действует 10 минут и используется один раз.</p>
        <button type="button" disabled={busy} onClick={() => void perform(async () => {
          setTransfer(await postTransfer(""));
          router.refresh();
        })}>{transfer ? "Создать новый код" : "Показать код и QR"}</button>
        {transfer ? <div className="code" aria-live="polite">
          <strong>{transfer.code}</strong>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR создаётся локально на сервере */}
          <img src={transfer.qr} alt="QR-код для подключения устройства" width={220} height={220} />
        </div> : null}
      </SettingsGroup>

      <SettingsGroup title="Ввести код">
        <p>Прочитанное и выключенные издания объединятся на связанных устройствах.</p>
        <form onSubmit={claim}>
          <label htmlFor="transfer-code">Код с другого устройства</label>
          <input id="transfer-code" value={input} onChange={event => setInput(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} required />
          <button type="submit" disabled={busy || !input.trim()}>Объединить устройства</button>
        </form>
      </SettingsGroup>

      <SettingsGroup title="Начать заново">
        <button type="button" disabled={busy} onClick={() => {
          if (!window.confirm("Начать с чистой истории на этом устройстве?")) return;
          void perform(async () => {
            await postTransfer("/reset");
            window.location.reload();
          });
        }}>Начать заново на этом устройстве</button>
      </SettingsGroup>

      <style jsx>{`
        .transfer, form, .code { display: flex; flex-direction: column; align-items: flex-start; }
        .transfer { gap: 24px; }
        form, .code { gap: 12px; }
        p { margin: 0; }
        .error { color: var(--danger); }
        .devices { list-style: none; padding: 0; margin: 0; }
        .devices li { padding: 8px 0; border-bottom: 1px solid var(--border); }
        .current { margin-inline-start: 8px; color: var(--accent); }
        .last-seen { display: block; color: var(--text-muted); font-size: 13px; }
        button, input {
          max-width: 100%; padding: 10px 12px; border: 1px solid var(--border);
          border-radius: 8px; background: var(--input-bg); color: var(--text); font: inherit;
        }
        button { cursor: pointer; }
        button:disabled { cursor: default; opacity: 0.5; }
        .code strong { font-size: 1.2rem; letter-spacing: 0.04em; }
        img { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}
