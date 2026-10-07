/**
 * Lo que dice el CI de cada implementación. El repositorio es privado mientras
 * no pase la conformidad, así que la web no puede enseñar insignias de GitHub:
 * al construir, se pregunta con `gh` por el último run de cada workflow en main
 * (`.github/workflows/<carpeta>.yml`) y, si lo hay, se descarga su artefacto
 * `conformance-<carpeta>` (la salida del runner de conformidad, §11 del
 * contrato) para contar los casos que pasan.
 *
 * Sin `gh` o sin red se usa la última copia (.cache/estado.json) y, si no hay,
 * todo sale como «sin datos». Nunca se inventa un verde.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IMPLEMENTACIONES, OTRAS_PIEZAS, RAIZ, SITIO, type Lengua } from './sitio';

export interface Conformidad { impl?: string; version?: string; pasados: number; fallidos: number; fallos: { id: string; reason: string }[] }

export interface Estado {
  carpeta: string;
  /** success | failure | cancelled | in_progress | queued | none (sin workflow o sin runs) */
  resultado: string;
  url?: string;
  fecha?: string;
  commit?: string;
  conformidad?: Conformidad;
  /** ¿Hay código en la carpeta? (más que un .gitkeep) */
  hayCodigo: boolean;
}

const REPO_GH = 'joseluissaorin/spdf';
const CACHE = resolve(SITIO, '.cache/estado.json');

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 });
}

function hayCodigo(carpeta: string): boolean {
  const d = resolve(RAIZ, carpeta);
  if (!existsSync(d)) return false;
  return readdirSync(d).some((f) => f !== '.gitkeep' && f !== '.DS_Store');
}

function conformidadDe(runId: number, carpeta: string): Conformidad | undefined {
  try {
    const artefactos = JSON.parse(gh(['api', `repos/${REPO_GH}/actions/runs/${runId}/artifacts`])) as { artifacts: { name: string; expired: boolean }[] };
    const a = artefactos.artifacts.find((x) => !x.expired && x.name === `conformance-${carpeta}`);
    if (!a) return undefined;
    const dir = mkdtempSync(join(tmpdir(), 'spdf-conf-'));
    try {
      gh(['run', 'download', String(runId), '-R', REPO_GH, '-n', a.name, '-D', dir]);
      const f = readdirSync(dir, { recursive: true }).map(String).find((n) => n.endsWith('.json'));
      if (!f) return undefined;
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { impl?: string; version?: string; passed?: unknown[]; failed?: { id: string; reason: string }[] };
      return { impl: j.impl, version: j.version, pasados: j.passed?.length ?? 0, fallidos: j.failed?.length ?? 0, fallos: (j.failed ?? []).slice(0, 20) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return undefined;
  }
}

function consultar(): Record<string, Estado> | undefined {
  try {
    gh(['auth', 'status']);
  } catch {
    return undefined;
  }
  const fuera: Record<string, Estado> = {};
  const carpetas = [...IMPLEMENTACIONES.map((i) => i.carpeta), ...OTRAS_PIEZAS.map((o) => o.carpeta)];
  for (const carpeta of carpetas) {
    const base: Estado = { carpeta, resultado: 'none', hayCodigo: hayCodigo(carpeta) };
    try {
      const runs = JSON.parse(gh(['run', 'list', '-R', REPO_GH, '--workflow', `${carpeta}.yml`, '--branch', 'main', '-L', '1', '--json', 'databaseId,conclusion,status,url,updatedAt,headSha'])) as { databaseId: number; conclusion: string; status: string; url: string; updatedAt: string; headSha: string }[];
      const r = runs[0];
      if (r) {
        base.resultado = r.status === 'completed' ? r.conclusion || 'none' : r.status;
        base.url = r.url;
        base.fecha = r.updatedAt;
        base.commit = r.headSha.slice(0, 7);
        base.conformidad = conformidadDe(r.databaseId, carpeta);
      }
    } catch {
      /* sin workflow todavía */
    }
    fuera[carpeta] = base;
  }
  return fuera;
}

export function estados(): Record<string, Estado> {
  if (process.env.SPDF_SIN_RED !== '1') {
    const vivo = consultar();
    if (vivo) {
      mkdirSync(resolve(SITIO, '.cache'), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(vivo, null, 2));
      return vivo;
    }
  }
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, Estado>;
  return {};
}

export function estadoDe(e: Record<string, Estado>, carpeta: string): Estado {
  return e[carpeta] ?? { carpeta, resultado: 'none', hayCodigo: hayCodigo(carpeta) };
}

/** Un punto con su palabra (el color nunca va solo). `md` da la versión en texto. */
export function etiquetaEstado(e: Estado, l: Lengua, md = false): string {
  const c = e.conformidad;
  const conf = c ? (l === 'es' ? ` · ${c.pasados}/${c.pasados + c.fallidos} casos` : ` · ${c.pasados}/${c.pasados + c.fallidos} cases`) : '';
  let clase = '';
  let txt: string;
  switch (e.resultado) {
    case 'success': clase = 'verde'; txt = (l === 'es' ? 'CI en verde' : 'CI passing') + conf; break;
    case 'failure': clase = 'rojo'; txt = (l === 'es' ? 'CI en rojo' : 'CI failing') + conf; break;
    case 'in_progress': case 'queued': case 'pending': case 'waiting': clase = 'ambar'; txt = l === 'es' ? 'CI en marcha' : 'CI running'; break;
    case 'cancelled': clase = 'ambar'; txt = l === 'es' ? 'CI cancelado' : 'CI cancelled'; break;
    default: txt = e.hayCodigo ? (l === 'es' ? 'en desarrollo, sin CI' : 'in progress, no CI yet') : (l === 'es' ? 'por empezar' : 'not started');
  }
  return md ? txt : `<span class="estado ${clase}">${txt}</span>`;
}
