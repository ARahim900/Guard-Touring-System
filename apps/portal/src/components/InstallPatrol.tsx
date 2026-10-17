import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPatrol() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } catch { setError('Use your browser menu to add MB Security to your home screen.'); }
  }
  if (installed) return null;
  return (
    <details className="rounded-md border border-border bg-white p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-primary">Install on your phone</summary>
      <div className="mt-3 space-y-2 text-muted-foreground">
        {prompt ? <Button type="button" icon={Download} onClick={() => void install()}>Install MB Security</Button> : null}
        <p><strong>iPhone:</strong> open this site in Safari → Share → Add to Home Screen. Keep “Open as Web App” enabled if shown.</p>
        <p><strong>Android:</strong> open in Chrome → menu → Add to Home screen / Install app.</p>
        <p>Sign in and start your shift with internet access. Keep the app open while scanning and uploading.</p>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </details>
  );
}
