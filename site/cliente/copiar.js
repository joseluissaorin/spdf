/* Copiar los bloques de código: el botón dice «Copiado» un momento y vuelve. */
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('.copiar');
  if (!b) return;
  var c = b.parentNode.querySelector('code');
  if (!c || !navigator.clipboard) return;
  navigator.clipboard.writeText(c.innerText).then(function () {
    var o = b.textContent;
    b.textContent = document.documentElement.lang === 'es' ? 'Copiado' : 'Copied';
    b.classList.add('hecho');
    setTimeout(function () { b.textContent = o; b.classList.remove('hecho'); }, 1600);
  });
});
