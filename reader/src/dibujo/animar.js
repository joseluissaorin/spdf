/*
 * animar.js: hace que los <svg class="dibujo"> se dibujen solos al entrar en pantalla.
 * Para webs estáticas y sin framework. Ponlo al final del <body> (o con `defer`).
 *
 *  - Añade `anima` a <html> solo si hay IntersectionObserver y el usuario no pide
 *    menos movimiento. Sin `anima`, los dibujos se ven ya terminados.
 *  - Marca `visto` en cada dibujo cuando entra en pantalla, y la pluma corre.
 *  - Láminas diferidas: <span data-lamina="/laminas/x.svg" style="aspect-ratio:w/h">
 *    se rellena con el SVG al acercarse (700 px antes). Así una página con muchos dibujos no pesa al cargar.
 *    Las máscaras llevan ids (mt-…, mc-…); se renombran para que dos copias no se pisen.
 *  - Al imprimir, todo dibujado.
 *
 * Para que el primer pintado no parpadee, conviene poner esto en el <head>, en línea:
 *   <script>try{if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('anima')}catch(e){}</script>
 */
(function () {
  var d = document.documentElement;
  try {
    if (!d.classList.contains('anima') && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.classList.add('anima');
  } catch (e) {}
  var n = 0;
  var io = 'IntersectionObserver' in window;
  var todos = function (q, f) { [].forEach.call(document.querySelectorAll(q), f); };
  var dib = d.classList.contains('anima') && new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('visto'); dib.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
  function mirar(s) { if (dib) dib.observe(s); }
  todos('svg.dibujo', mirar);
  function cargar(el) {
    var u = el.getAttribute('data-lamina');
    if (!u) return;
    el.removeAttribute('data-lamina');
    fetch(u).then(function (r) { return r.text(); }).then(function (t) {
      var k = ++n;
      el.innerHTML = t.replace(/\b(m[tc]-[\w-]+)/g, '$1-' + k);
      var s = el.querySelector('svg');
      if (s) mirar(s);
    });
  }
  if (io) {
    var lz = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { lz.unobserve(e.target); cargar(e.target); } });
    }, { rootMargin: '700px 0px' });
    todos('[data-lamina]', function (e) { lz.observe(e); });
  } else todos('[data-lamina]', cargar);
  addEventListener('beforeprint', function () { todos('svg.dibujo', function (s) { s.classList.add('visto'); }); });
  // Para dibujos que se insertan después (un modal, una ruta nueva): window.mirarDibujos(contenedor).
  window.mirarDibujos = function (raiz) { [].forEach.call((raiz || document).querySelectorAll('svg.dibujo:not(.visto)'), mirar); };
})();
