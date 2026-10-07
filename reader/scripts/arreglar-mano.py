"""Arregla la «é» (y separa los acentos de «ó», «ú» y «É») de la letra de mano.

La fuente de la skill dibujos-a-mano (Nothing You Could Do, OFL) compone la «é»
con un acento que cae a la altura del ojo de la «e» (406-555 frente a 481): se
funden y «léelo», «qué» o «café» se leen sin tilde. Aquí se suben los acentos
hasta que no toquen la letra. Se trabaja sobre el woff2 de la skill y se deja
la copia del lector en public/fuentes/mano.woff2.

Uso: python3 scripts/arreglar-mano.py ~/.claude/skills/dibujos-a-mano/fuente/mano.woff2 public/fuentes/mano.woff2
"""
import sys
from fontTools.ttLib import TTFont

origen, salida = sys.argv[1], sys.argv[2]
f = TTFont(origen)
glyf = f['glyf']
cm = f.getBestCmap()

# letra -> (desplazamiento x, desplazamiento y) del componente «acute»
AJUSTES = {'é': (148, 118), 'ó': (129, 46), 'ú': (243, 40), 'É': (330, 400)}
for ch, (x, y) in AJUSTES.items():
    g = glyf[cm[ord(ch)]]
    for c in g.components:
        if c.glyphName == 'acute':
            c.x, c.y = x, y
    g.recalcBounds(glyf)
    base = glyf[g.components[0].glyphName]; base.recalcBounds(glyf)
    acento = glyf['acute']; acento.recalcBounds(glyf)
    hueco = acento.yMin + y - base.yMax
    print(f'{ch}: acento de y={acento.yMin + y} a {acento.yMax + y}; la letra llega a {base.yMax}; hueco {hueco}')
    assert hueco >= 0, f'{ch}: el acento todavía toca la letra'
f.flavor = 'woff2'
f.save(salida)
print('guardada', salida)
