import React, { useEffect, useRef, useState } from 'react';
import { verifyPin } from '../core/profiles';
import type { UserProfile } from '../core/types';
import { t } from '../i18n';

export function PinPrompt({ profile, onSuccess, onCancel }: {
  profile: UserProfile;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const submit = async (value: string) => {
    if (await verifyPin(profile, value)) {
      onSuccess();
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div style={S.overlay} onClick={onCancel}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
        <p style={S.title}>{t('profiles.enter_pin')}</p>
        <p style={S.subtitle}>{profile.name}</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 4);
            setPin(next);
            setError(false);
            if (next.length === 4) void submit(next);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          style={S.input}
        />
        {error && <p style={S.error}>{t('profiles.pin_incorrect')}</p>}
      </div>
    </div>
  );
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif';

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: 280, borderRadius: 12, background: '#141414', border: '1px solid rgba(255,255,255,0.10)', padding: '28px 24px', textAlign: 'center', fontFamily: FONT },
  title: { margin: 0, color: '#FFFFFF', fontSize: 16, fontWeight: 700 },
  subtitle: { margin: '4px 0 18px', color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  input: { width: '100%', height: 48, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#FFFFFF', textAlign: 'center', fontSize: 24, letterSpacing: 12, outline: 'none', boxSizing: 'border-box' },
  error: { margin: '10px 0 0', color: '#FF8A8A', fontSize: 12 },
};
