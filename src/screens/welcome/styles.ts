import type React from 'react';

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Noto Sans", sans-serif';

export const S: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed', inset: 0, zIndex: 9999, background: '#0C0C0C',
    color: '#FFFFFF', overflow: 'auto', fontFamily: FONT,
    display: 'flex', flexDirection: 'column',
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 72,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 44px',
  },
  logo: { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: 2, fontFamily: FONT },
  kicker: {
    margin: '2px 0 0', color: 'rgba(255,255,255,0.28)', fontSize: 10,
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.09em', fontFamily: FONT,
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6, border: 'none',
    background: 'transparent', color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
    padding: '6px 8px', fontFamily: FONT,
  },
  main: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '80px 40px 60px',
  },
  hero: { textAlign: 'center', maxWidth: 560, marginBottom: 48 },
  headline: {
    margin: '0 0 16px', fontSize: 42, fontWeight: 700, lineHeight: 1.1,
    letterSpacing: '-0.03em', fontFamily: FONT,
  },
  subheadline: {
    margin: 0, color: 'rgba(255,255,255,0.50)', fontSize: 16, lineHeight: 1.6, fontFamily: FONT,
  },
  actions: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 12, width: '100%', maxWidth: 320,
  },
  primaryBtn: {
    width: '100%', padding: '14px 24px', borderRadius: 8, border: 'none',
    background: '#FFFFFF', color: '#000000', fontSize: 15, fontWeight: 600,
    fontFamily: FONT, cursor: 'pointer',
  },
  secondaryBtn: {
    width: '100%', padding: '13px 24px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
    color: 'rgba(255,255,255,0.70)', fontSize: 15, fontWeight: 500, fontFamily: FONT, cursor: 'pointer',
  },
  note: {
    marginTop: 32, color: 'rgba(255,255,255,0.25)', fontSize: 12,
    textAlign: 'center', maxWidth: 360, lineHeight: 1.5, fontFamily: FONT,
  },
  authMain: {
    flex: 1, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '100px 24px 60px',
  },
  card: { width: '100%', maxWidth: 400 },
  nuvioBtn: {
    width: '100%', padding: '13px 20px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)',
    color: '#FFFFFF', fontSize: 14, fontWeight: 500, fontFamily: FONT, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 0,
  },
  tabs: {
    display: 'flex', marginBottom: 24,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tabBtn: {
    flex: 1, background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', marginBottom: -1,
    padding: '10px 0 13px', color: 'rgba(255,255,255,0.40)',
    fontSize: 14, fontWeight: 500, fontFamily: FONT, cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabBtnActive: { color: '#FFFFFF', borderBottomColor: '#FFFFFF' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.40)',
    fontFamily: FONT, letterSpacing: '0.07em', textTransform: 'uppercase',
  },
  input: {
    width: '100%', padding: '11px 14px', borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)',
    color: '#FFFFFF', fontSize: 14, fontFamily: FONT, outline: 'none',
    boxSizing: 'border-box', transition: 'border-color 0.15s',
  },
  inputError: { borderColor: 'rgba(255,80,80,0.55)' },
  passwordWrap: { position: 'relative' },
  passwordInput: { paddingRight: 42 },
  eyeBtn: {
    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
  },
  errorText: { margin: 0, fontSize: 11, color: 'rgba(255,100,100,0.85)', fontFamily: FONT },
  globalError: {
    margin: '0 0 16px', padding: '10px 14px', borderRadius: 7,
    background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.20)',
    color: 'rgba(255,140,140,0.90)', fontSize: 13, fontFamily: FONT,
  },
  forgotBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)',
    fontSize: 12, fontFamily: FONT, cursor: 'pointer', padding: 0,
  },
  submitBtn: {
    width: '100%', padding: '13px 24px', borderRadius: 8, border: 'none',
    background: '#FFFFFF', color: '#000000', fontSize: 15, fontWeight: 600,
    fontFamily: FONT, cursor: 'pointer', transition: 'opacity 0.15s',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0',
  },
  dividerLine: { flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' },
  dividerText: { color: 'rgba(255,255,255,0.25)', fontSize: 12, fontFamily: FONT },
  localBtn: {
    width: '100%', padding: '13px 24px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.10)', background: 'transparent',
    color: 'rgba(255,255,255,0.50)', fontSize: 14, fontWeight: 500,
    fontFamily: FONT, cursor: 'pointer', transition: 'opacity 0.15s',
  },
  eyebrow: {
    margin: '0 0 10px', fontSize: 11, fontWeight: 600,
    color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
    letterSpacing: '0.09em', fontFamily: FONT,
  },
  cardTitle: {
    margin: '0 0 8px', fontSize: 26, fontWeight: 700,
    letterSpacing: '-0.02em', fontFamily: FONT,
  },
  cardSubtitle: {
    margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.45)',
    lineHeight: 1.55, fontFamily: FONT,
  },
};
