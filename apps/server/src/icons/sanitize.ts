/**
 * Validation for instance icon files (#71). SVG is a script vector when
 * navigated to directly, so files are checked once at scan time and anything
 * that fails stays invisible to both the manifest and the serving route.
 * Serving adds sandboxing headers as defense in depth.
 */

export const MAX_ICON_BYTES = 256 * 1024;

export type IconKind = 'mono' | 'color';

export type IconCheck = { ok: true; kind: IconKind } | { ok: false; reason: string };

/** Anything executable or external gets the file rejected, case-insensitive. */
const FORBIDDEN = [
  /<script/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /<foreignobject/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
  /<image/i,
  /<!doctype/i,
  /<!entity/i,
  /@import/i,
];

/** Single-colour artwork is themable via CSS mask (same rule as the fetch script). */
const MONO_PAINTS = ['none', '#000', '#000000', 'black', 'currentcolor'];

export function checkSvg(content: string): IconCheck {
  const body = content
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart();
  if (!body.toLowerCase().startsWith('<svg')) {
    return { ok: false, reason: 'not an svg document' };
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(body)) {
      return { ok: false, reason: `forbidden content (${pattern.source})` };
    }
  }
  // References must stay inside the file: href="#gradient" is fine,
  // anything external (URLs, files, data:) is not.
  for (const match of body.matchAll(/(?:xlink:)?href\s*=\s*["']?([^"'\s>]+)/gi)) {
    if (!(match[1] as string).startsWith('#')) {
      return { ok: false, reason: 'external reference (href)' };
    }
  }
  if (/url\(\s*["']?(?!#)/i.test(body)) {
    return { ok: false, reason: 'external reference (url())' };
  }
  const painted = [...body.matchAll(/(?:fill|stroke)\s*[=:]\s*["']?([^"';)]+)/gi)]
    .map((match) => (match[1] as string).trim().toLowerCase())
    .filter((value) => value !== '' && !MONO_PAINTS.includes(value));
  return { ok: true, kind: painted.length === 0 ? 'mono' : 'color' };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function checkPng(content: Buffer): IconCheck {
  if (content.length < PNG_MAGIC.length || !content.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, reason: 'not a png file' };
  }
  return { ok: true, kind: 'color' };
}

export function checkWebp(content: Buffer): IconCheck {
  if (
    content.length < 12 ||
    content.toString('ascii', 0, 4) !== 'RIFF' ||
    content.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return { ok: false, reason: 'not a webp file' };
  }
  return { ok: true, kind: 'color' };
}
