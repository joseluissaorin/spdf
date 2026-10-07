// Tema antes del primer pintado: sin destello de papel claro en modo oscuro.
try {
  var p = JSON.parse(localStorage.getItem('spdf-lector:prefs') || '{}');
  var o = p.tema === 'oscuro' || ((!p.tema || p.tema === 'sistema') && matchMedia('(prefers-color-scheme: dark)').matches);
  if (o) document.documentElement.classList.add('oscuro');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('anima');
} catch (e) {}
