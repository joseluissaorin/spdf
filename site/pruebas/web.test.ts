/**
 * Pruebas de la web construida (site/dist): que cada hoja exista en HTML y en
 * Markdown, con lo que leen buscadores y agentes, que los ficheros para agentes
 * estén completos y que el castellano no lleve rayas al estilo inglés.
 * Hay que construir antes: npm run build.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(__dirname, '../dist');
const leer = (r: string) => readFileSync(join(DIST, r), 'utf8');

function todos(d: string, ext: string, fuera: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'reader' && f !== 'assets') todos(p, ext, fuera); } else if (f.endsWith(ext)) fuera.push(p);
  }
  return fuera;
}

describe('la web construida', () => {
  it('existe', () => expect(existsSync(join(DIST, 'index.html'))).toBe(true));

  const html = existsSync(DIST) ? todos(DIST, '.html').filter((f) => !f.endsWith('404.html')) : [];

  it('cada hoja tiene lang, título, descripción, canónica, gemelo .md y JSON-LD válido', () => {
    expect(html.length).toBeGreaterThan(30);
    for (const f of html) {
      const h = readFileSync(f, 'utf8');
      expect(h, f).toMatch(/<html lang="(en|es)">/);
      expect(h, f).toMatch(/<title>[^<]{3,}<\/title>/);
      expect(h, f).toMatch(/<meta name="description" content="[^"]{20,}">/);
      expect(h, f).toMatch(/<link rel="canonical" href="https:\/\/spdf\.joseluissaorin\.com/);
      const md = /<link rel="alternate" type="text\/markdown"[^>]*href="https:\/\/spdf\.joseluissaorin\.com([^"]+)"/.exec(h);
      expect(md, f).not.toBeNull();
      expect(existsSync(join(DIST, md![1]!)), `${f} → ${md![1]}`).toBe(true);
      const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h);
      expect(() => JSON.parse(ld![1]!), f).not.toThrow();
      expect(h, f).toMatch(/<h1[ >]/);
    }
  });

  it('los enlaces internos llevan a hojas que existen', () => {
    const rotos: string[] = [];
    for (const f of html) {
      for (const m of readFileSync(f, 'utf8').matchAll(/href="(\/[^"#?]*)/g)) {
        const r = m[1]!;
        if (r.startsWith('/commons/files/') || r.startsWith('/download/files/')) continue;
        const candidatos = r === '/' ? ['index.html'] : [r.slice(1), `${r.slice(1)}.html`, `${r.slice(1).replace(/\/$/, '')}/index.html`, `${r.slice(1).replace(/\/$/, '')}.html`];
        if (!candidatos.some((c) => existsSync(join(DIST, c)))) rotos.push(`${f.slice(DIST.length)} → ${r}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it('llms.txt, llms-full.txt, robots, sitemap y status.json están completos', () => {
    const llms = leer('llms.txt');
    expect(llms).toMatch(/^# SPDF\n\n> /);
    expect(llms).toContain('/spec.md');
    expect(llms).toContain('/es/especificacion.md');
    const full = leer('llms-full.txt');
    expect(full.length).toBeGreaterThan(30_000);
    expect(full).toMatch(/Anchor URI|URI de ancla/);
    expect(leer('robots.txt')).toContain('ai-train=yes');
    expect(leer('robots.txt')).toContain('Sitemap: https://spdf.joseluissaorin.com/sitemap.xml');
    const sitemap = leer('sitemap.xml');
    expect(sitemap.match(/<url>/g)!.length).toBe(html.length);
    expect(JSON.parse(leer('status.json')).implementations).toHaveLength(12);
  });

  it('el castellano no lleva rayas al estilo inglés ni comillas inglesas sueltas en el texto', () => {
    const es = [...todos(join(DIST, 'es'), '.md'), join(DIST, 'es.md')];
    for (const f of es) {
      const t = readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').split('\n').filter((l) => !l.startsWith('|')).join('\n');
      expect(t, f).not.toMatch(/ [—–] /);
    }
  });
});
