/* Utilidades compartidas */
const ICONS = [
  // 0 rojo: triángulo
  '<svg viewBox="0 0 100 100"><polygon points="50,10 95,90 5,90"/></svg>',
  // 1 azul: rombo
  '<svg viewBox="0 0 100 100"><polygon points="50,4 96,50 50,96 4,50"/></svg>',
  // 2 amarillo: círculo
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/></svg>',
  // 3 verde: cuadrado
  '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="6"/></svg>'
];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
