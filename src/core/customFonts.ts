import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

export interface CustomFont {
  fileName: string;
  family: string;
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  return invoke<CustomFont[]>('custom_fonts_list').catch(() => []);
}

export async function removeCustomFont(fileName: string): Promise<void> {
  return invoke('custom_fonts_remove', { fileName });
}

export async function pickAndAddCustomFont(): Promise<CustomFont | null> {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc'] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return invoke<CustomFont>('custom_fonts_add', { sourcePath: selected });
}
