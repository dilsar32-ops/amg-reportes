/* ============================================================================
   CARA — el personaje del asistente del manager (Field Reports), 21 oct 2026.
   Un casco blanco con visor azul marino; los ojos y la boca son formas CONTINUAS tipo pantalla OLED
   (paths de 24 nodos con degradado, brillo y bloom) que cambian de forma (morph) para hacer gestos.

   API (window.Cara; también module.exports para las pruebas en Node):
     Cara.montar(el, {tamano:250, color:'celeste'|'menta'|'ambar'|'violeta', silueta:'A'|'B', entrada:true}) -> instancia | null
     Cara.parallax() -> Promise<bool>   giroscopio (solo nativo; pide permiso una vez)
     Cara.desmontar(el)
     Cara.estado('reposo'|'escuchando'|'buscando'|'hablando'|'pregunta'|'contento'|'sorprendido'|
                 'triste'|'confundido'|'exito'|'sin_senal')      (alias: esperando, pensando, confirmar, error…)
     Cara.gesto('contento', ms)      gesto pasajero; al terminar vuelve al estado base
     Cara.nivel(0..1)                nivel del micrófono (orejas y brillo)
     Cara.hablando(true|false, textoOpcional)   boca al ritmo mientras habla
     Cara.limpiarEtiqueta(texto) -> {gesto, texto}   quita "[gesto:contento]" del texto del modelo
     Cara.filtroDeTrozos() -> fn(trozo) -> {texto, gesto}   lo mismo pero por trozos de SSE
     Cara.gestoDe(evento) / Cara.gestoDelTexto(texto)        reglas automáticas sin modelo
     Cara.puntos(nombre, lado) -> 24 nodos [u,v] de la forma del ojo  (para pruebas)
   Sin DOM (Node) nada lanza: montar devuelve null y el estado se guarda igual.

   Batería: nada corre a 60 fps por JS. Las formas cambian por transiciones CSS; el único
   requestAnimationFrame vive mientras HABLA (boca, 18 fps) y se apaga solo.
   ============================================================================ */
(function (raiz) {
  'use strict';
  var hayDOM = typeof document !== 'undefined' && !!document.createElementNS;
  var hayWin = typeof window !== 'undefined';
  var quieto = hayWin && window.matchMedia ? (function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })() : false;

  // ---------------------------------------------------------------- geometría (ronda 3: ojos continuos)
  var VB_W = 240, VB_H = 220;
  var OJO_IZQ = { cx: 78, cy: 108 }, OJO_DER = { cx: 162, cy: 108 }, BOCA = { cx: 120, cy: 164 };
  var OJO_SX = 36, OJO_SY = 28;      // 1 unidad (u,v) = 36 × 28 del viewBox: el ojo neutral mide ~65 × 39
  var N_NODOS = 24;                  // TODAS las formas tienen 24 nodos: así el morph es punto a punto

  // ---------------------------------------------------------------- formas (u,v en [-1,1]; u>0 = lado de afuera, v>0 = abajo)
  // Cada forma = { a, top(x), bot(x) } con x en [-a, a]: borde de arriba y de abajo del ojo. Los 24 nodos salen
  // de muestrear x con un coseno (más nodos en las puntas) para arriba y para abajo.
  function supY(b, n) { return function (x, a) { var t = 1 - Math.pow(Math.min(1, Math.abs(x / a)), n); return b * Math.pow(Math.max(0, t), 1 / n); }; }
  function oval(a, b, n, dy) { var f = supY(b, n); return { a: a, top: function (x) { return -f(x, a) + (dy || 0); }, bot: function (x) { return f(x, a) + (dy || 0); } }; }
  var OJOS = {
    neutral:      oval(.9, .7, 2.4, 0),
    atento:       oval(.97, .88, 2.2, -.02),
    sorprendido:  oval(.82, .98, 2, 0),
    buscando:     oval(.76, .6, 2.3, 0),
    pregunta_a:   oval(.82, .34, 3, .04),                                   // el ojo que se entrecierra
    pregunta_b:   oval(.9, .82, 2.3, -.2),                                  // el ojo que se abre y sube
    confundido_a: oval(.86, .9, 2, 0),
    confundido_b: oval(.64, .3, 3, .2),
    punto:        oval(.2, .22, 2, 0),
    parpadeo:     oval(.82, .06, 2, .05),
    // contento: domo arriba y panza cóncava (anime): arriba semicírculo, abajo sube en el centro
    contento:     { a: .95, top: function (x) { return -.98 * Math.sqrt(Math.max(0, 1 - Math.pow(x / .95, 2))) + .06; },
                             bot: function (x) { return .58 - .78 * Math.pow(Math.max(0, 1 - Math.pow(x / .95, 2)), .6); } },
    // triste: párpado que cae hacia afuera (adentro alto, afuera bajo) sobre un óvalo
    triste:       { a: .86, top: function (x) { var o = -supY(.66, 2.6)(x, .86), lid = -.64 + .58 * ((x / .86 + 1) / 2); return Math.max(o, lid); },
                             bot: function (x) { return supY(.62, 2.6)(x, .86); } }
  };
  // 24 nodos: 12 por arriba (de adentro hacia afuera) y 12 por abajo (de regreso). lado 'izq' espeja en x.
  function puntosOjo(nombre, lado) {
    var f = OJOS[nombre] || OJOS.neutral, out = [], i, k = N_NODOS / 2, x, s = lado === 'izq' ? -1 : 1;
    for (i = 0; i < k; i++) { x = -f.a * Math.cos(Math.PI * (i + .5) / k); out.push([s * x, f.top(x)]); }
    for (i = 0; i < k; i++) { x = f.a * Math.cos(Math.PI * (i + .5) / k); out.push([s * x, f.bot(x)]); }
    return out;
  }
  // Boca continua: óvalo que cambia de alto (habla), anillo (o), arco (triste), línea torcida (confundido), rayita.
  function bocaForma(nombre, apertura) {
    var w = 15, c = BOCA.cx, y = BOCA.cy;
    switch (nombre) {
      case 'habla': { var h = Math.max(1.6, (apertura == null ? .5 : apertura) * 12); return { d: 'M' + (c - w) + ' ' + y + 'C' + (c - w) + ' ' + (y - h) + ' ' + (c + w) + ' ' + (y - h) + ' ' + (c + w) + ' ' + y + 'C' + (c + w) + ' ' + (y + h) + ' ' + (c - w) + ' ' + (y + h) + ' ' + (c - w) + ' ' + y + 'Z', relleno: true }; }
      case 'o': return { d: 'M' + (c - 9) + ' ' + y + 'C' + (c - 9) + ' ' + (y - 14) + ' ' + (c + 9) + ' ' + (y - 14) + ' ' + (c + 9) + ' ' + y + 'C' + (c + 9) + ' ' + (y + 14) + ' ' + (c - 9) + ' ' + (y + 14) + ' ' + (c - 9) + ' ' + y + 'Z', relleno: false };
      case 'triste': return { d: 'M' + (c - 14) + ' ' + (y + 6) + 'Q' + c + ' ' + (y - 10) + ' ' + (c + 14) + ' ' + (y + 6), relleno: false };
      case 'confundido': return { d: 'M' + (c - 12) + ' ' + (y - 3) + 'Q' + c + ' ' + (y + 6) + ' ' + (c + 12) + ' ' + (y + 2), relleno: false };
      case 'linea': return { d: 'M' + (c - 9) + ' ' + y + 'L' + (c + 9) + ' ' + y, relleno: false };
      default: return null;
    }
  }
  // ESTADOS: forma de cada ojo (izq, der), boca, y si parpadea.
  var ESTADOS = {
    reposo:      { ojos: ['neutral', 'neutral'],           boca: 'nada',       parpadea: true,  mira: true },
    escuchando:  { ojos: ['atento', 'atento'],             boca: 'nada',       parpadea: true },
    buscando:    { ojos: ['buscando', 'buscando'],         boca: 'corre',      parpadea: false },
    hablando:    { ojos: ['neutral', 'neutral'],           boca: 'habla',      parpadea: true },
    pregunta:    { ojos: ['pregunta_a', 'pregunta_b'],     boca: 'linea',      parpadea: false },
    contento:    { ojos: ['contento', 'contento'],         boca: 'nada',       parpadea: false },
    sorprendido: { ojos: ['sorprendido', 'sorprendido'],   boca: 'o',          parpadea: false },
    triste:      { ojos: ['triste', 'triste'],             boca: 'triste',     parpadea: false },
    confundido:  { ojos: ['confundido_a', 'confundido_b'], boca: 'confundido', parpadea: false },
    exito:       { ojos: ['contento', 'contento'],         boca: 'nada',       parpadea: false },
    sin_senal:   { ojos: ['punto', 'punto'],               boca: 'nada',       parpadea: false }
  };
  var ALIAS = { esperando: 'reposo', neutral: 'reposo', pensando: 'buscando', confirmar: 'pregunta', duda: 'pregunta',
    error: 'triste', lo_siento: 'triste', 'lo siento': 'triste', feliz: 'contento', alegre: 'contento', sorpresa: 'sorprendido',
    confuso: 'confundido', guardado: 'exito', 'éxito': 'exito', offline: 'sin_senal', 'sin señal': 'sin_senal', sin_señal: 'sin_senal', 'sin senal': 'sin_senal' };
  var MS_GESTO = { contento: 1800, sorprendido: 1500, triste: 2400, confundido: 1900, exito: 1700, pregunta: 2600, buscando: 1500, sin_senal: 2600, escuchando: 1500, hablando: 1500 };
  function llano(x) { return String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_'); }
  var ALIAS_LLANO = {}; Object.keys(ALIAS).forEach(function (k) { ALIAS_LLANO[llano(k)] = ALIAS[k]; });
  function normal(n) { n = llano(n); if (ESTADOS[n]) return n; return ALIAS_LLANO[n] || null; }

  function puntos(nombre, lado) { return puntosOjo(nombre, lado || 'der'); }

  // ---------------------------------------------------------------- SVG del personaje (ronda 2: volumen, vidrio, metal)
  // Dos siluetas propias: A (casco redondo con ceja de visor y luz de estado arriba) y B (casco ancho con
  // barbilla plana y antena-luz a un lado). Mismo visor interior, mismos ojos.
  var SILUETAS = {
    A: {
      casco: 'M120 10C182 10 228 52 228 112C228 162 190 202 120 202C50 202 12 162 12 112C12 52 58 10 120 10Z',
      visor: 'M120 32C172 32 212 64 212 114C212 154 180 186 120 186C60 186 28 154 28 114C28 64 68 32 120 32Z',
      ceja: 'M50 66C76 26 164 26 190 66',
      luz: [120, 7],
      antena: '<rect x="106" y="-2" width="28" height="18" rx="9" style="fill:url(#%luzmetal)"/><circle class="cara-luz" cx="120" cy="7" r="5.5" style="fill:var(--cara-aro)"/>'
    },
    B: {
      casco: 'M120 14C188 14 232 50 232 108C232 160 202 194 156 200L84 200C38 194 8 160 8 108C8 50 52 14 120 14Z',
      visor: 'M120 36C176 36 214 66 214 112C214 152 188 182 146 184L94 184C52 182 26 152 26 112C26 66 64 36 120 36Z',
      ceja: '',
      luz: [57, 6],
      antena: '<path d="M70 30L58 8" stroke="#2b2f3a" stroke-width="4.5" stroke-linecap="round"/><path d="M70 30L58 8" stroke="#8a93a6" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".6"/><circle class="cara-luz" cx="57" cy="6" r="6" style="fill:var(--cara-aro)"/>'
    }
  };
  function svgTexto(id, silueta) {
    var S = SILUETAS[silueta] || SILUETAS.A, s = [];
    var U = function (n) { return 'url(#' + id + n + ')'; };
    s.push('<svg viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">');
    s.push('<defs>',
      // casco: luz principal arriba-izquierda (radial), relleno frío abajo-derecha, oclusión hacia el borde
      '<radialGradient id="' + id + 'cascoLuz" cx=".34" cy=".22" r=".9"><stop offset="0" style="stop-color:var(--cara-casco-1)"/><stop offset=".55" style="stop-color:var(--cara-casco-2)"/><stop offset="1" style="stop-color:var(--cara-casco-3)"/></radialGradient>',
      '<linearGradient id="' + id + 'cascoFrio" x1="0" y1="0" x2="1" y2="1"><stop offset=".45" stop-color="#9fb8e8" stop-opacity="0"/><stop offset="1" stop-color="#9fb8e8" stop-opacity=".38"/></linearGradient>',
      '<linearGradient id="' + id + 'cascoBorde" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".7" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>',
      '<linearGradient id="' + id + 'especular" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".6" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
      '<linearGradient id="' + id + 'ceja" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>',
      // bisel de dos tonos
      '<linearGradient id="' + id + 'bisel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4052"/><stop offset=".5" stop-color="#1a1e2a"/><stop offset="1" stop-color="#2b3140"/></linearGradient>',
      // visor: vidrio curvo, fondo profundo
      '<radialGradient id="' + id + 'visor" cx=".5" cy=".15" r="1"><stop offset="0" style="stop-color:var(--cara-visor-1)"/><stop offset=".55" style="stop-color:var(--cara-visor-2)"/><stop offset="1" style="stop-color:var(--cara-visor-3)"/></radialGradient>',
      '<linearGradient id="' + id + 'visorOcl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>',
      '<pattern id="' + id + 'malla" width="2.1" height="2.1" patternUnits="userSpaceOnUse"><path d="M0 0H2.1M0 0V2.1" stroke="#000" stroke-opacity=".16" stroke-width=".35"/></pattern>',
      // orejas: metal cepillado + aro turquesa + luz del aro
      '<linearGradient id="' + id + 'metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5063"/><stop offset=".12" stop-color="#20242f"/><stop offset=".3" stop-color="#3b4150"/><stop offset=".5" stop-color="#171a23"/><stop offset=".7" stop-color="#353b49"/><stop offset=".88" stop-color="#1b1e28"/><stop offset="1" stop-color="#3a3f4e"/></linearGradient>',
      '<linearGradient id="' + id + 'aro" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--cara-aro-2)"/><stop offset=".5" style="stop-color:var(--cara-aro)"/><stop offset="1" style="stop-color:var(--cara-aro-2)"/></linearGradient>',
      '<radialGradient id="' + id + 'aroluz" cx=".5" cy=".5" r=".5"><stop offset="0" style="stop-color:var(--cara-aro)" stop-opacity=".95"/><stop offset=".5" style="stop-color:var(--cara-aro)" stop-opacity=".35"/><stop offset="1" style="stop-color:var(--cara-aro)" stop-opacity="0"/></radialGradient>',
      '<linearGradient id="' + id + 'luzmetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6174"/><stop offset="1" stop-color="#20242f"/></linearGradient>',
      '<radialGradient id="' + id + 'sombra" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
      '</defs>');
    s.push('<ellipse class="cara-sombra" cx="120" cy="207" rx="96" ry="9" fill="' + U('sombra') + '"/>');
    s.push('<g class="cara-cuerpo">');
    s.push(S.antena.replace(/%/g, id));
    // orejas (detrás del casco)
    var oreja = function (lado, x, xa) {
      return '<g class="cara-oreja ' + lado + '"><rect class="cara-aro-luz" x="' + (x - 7) + '" y="80" width="36" height="74" rx="12" fill="' + U('aroluz') + '"/>' +
        '<rect x="' + x + '" y="86" width="22" height="60" rx="7" fill="' + U('metal') + '"/>' +
        '<rect x="' + x + '" y="86" width="22" height="60" rx="7" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1"/>' +
        '<rect class="cara-aro" x="' + xa + '" y="86" width="5" height="60" fill="' + U('aro') + '"/>' +
        '<rect x="' + (x + 2) + '" y="88" width="18" height="2" rx="1" fill="#fff" fill-opacity=".18"/></g>';
    };
    s.push(oreja('izq', 0, 7), oreja('der', 218, 228));
    // casco: base + relleno frío + borde (oclusión arriba, luz de canto abajo) + ceja + especular
    s.push('<path d="' + S.casco + '" fill="' + U('cascoLuz') + '"/>');
    s.push('<path d="' + S.casco + '" fill="' + U('cascoFrio') + '"/>');
    s.push('<path d="' + S.casco + '" fill="none" stroke="' + U('cascoBorde') + '" stroke-width="2.4"/>');
    if (S.ceja) s.push('<path d="' + S.ceja + '" fill="none" stroke="' + U('ceja') + '" stroke-width="4" stroke-linecap="round"/>');
    s.push('<ellipse cx="72" cy="30" rx="34" ry="8" transform="rotate(-24 72 30)" fill="' + U('especular') + '"/>');
    // bisel de dos tonos + oclusión del borde del visor
    s.push('<path d="' + S.visor + '" fill="none" stroke="' + U('bisel') + '" stroke-width="7"/>');
    s.push('<path d="' + S.visor + '" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="2.2"/>');
    // visor: vidrio
    s.push('<path d="' + S.visor + '" fill="' + U('visor') + '"/>');
    s.push('<path d="' + S.visor + '" fill="' + U('malla') + '"/>');
    s.push('<path d="' + S.visor + '" fill="' + U('visorOcl') + '"/>');
    s.push('</g></svg>');
    return s.join('');
  }
  // Capas aparte (cada una un <svg> encima del casco): WebKit repinta TODO el svg donde algo cambia, así
  // que los LED que se mueven (boca al hablar, ojos al buscar) viven en su propio svg chico.
  function defsLed(id) {
    return '<defs>' +
      // cuerpo del ojo: más claro al centro, saturado al borde (objectBoundingBox: se ajusta a cada forma)
      '<radialGradient id="' + id + 'ojo" cx=".5" cy=".42" r=".62"><stop offset="0" style="stop-color:var(--cara-led-claro)"/><stop offset=".55" style="stop-color:rgb(var(--cara-led))"/><stop offset="1" style="stop-color:var(--cara-led-borde)"/></radialGradient>' +
      '<radialGradient id="' + id + 'bloom" cx=".5" cy=".5" r=".5"><stop offset="0" style="stop-color:rgb(var(--cara-led))" stop-opacity=".55"/><stop offset=".6" style="stop-color:rgb(var(--cara-led))" stop-opacity=".18"/><stop offset="1" style="stop-color:rgb(var(--cara-led))" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'brillo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>' +
      // micro-detalle de pantalla: líneas horizontales tenuísimas (≤ .05), nunca puntos
      '<pattern id="' + id + 'lineas" width="2" height="1.6" patternUnits="userSpaceOnUse"><rect width="2" height=".5" fill="#000" fill-opacity=".05"/></pattern>' +
      '</defs>';
  }
  function ojoSvg(id, lado, cx, cy) {
    return '<g class="cara-ojo ' + lado + '" style="transform-origin:' + cx + 'px ' + cy + 'px">' +
      '<path class="cara-ojo-bloom" d="" fill="url(#' + id + 'obloom)"/>' +
      '<path class="cara-ojo-cuerpo" d="" fill="url(#' + id + 'oojo)"/>' +
      '<path class="cara-ojo-lineas" d="" fill="url(#' + id + 'olineas)"/>' +
      '<ellipse class="cara-ojo-brillo" cx="' + cx + '" cy="' + cy + '" rx="3" ry="2" fill="url(#' + id + 'obrillo)"/>' +
      '<path class="cara-destello" d="M0 -7L1.6 -1.6L7 0L1.6 1.6L0 7L-1.6 1.6L-7 0L-1.6 -1.6Z" fill="#fff" style="transform-origin:0 0"/>' +
      '</g>';
  }
  function svgOjos(id, silueta) {
    var S = SILUETAS[silueta] || SILUETAS.A;
    return '<svg class="cara-capa cara-capa-led cara-capa-ojos" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + defsLed(id + 'o') +
      '<defs><clipPath id="' + id + 'clipojos"><path d="' + S.visor + '"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + 'clipojos)"><g class="cara-ojos-sq"><g class="cara-ojos">' +
      ojoSvg(id, 'izq', OJO_IZQ.cx, OJO_IZQ.cy) + ojoSvg(id, 'der', OJO_DER.cx, OJO_DER.cy) +
      '<g class="cara-lagrimas">' +
      '<g class="cara-lagrima"><ellipse cx="104" cy="136" rx="5" ry="6" fill="url(#' + id + 'obloom)"/><ellipse cx="104" cy="136" rx="2.1" ry="2.9" fill="url(#' + id + 'oojo)"/></g>' +
      '<g class="cara-lagrima dos"><ellipse cx="104" cy="136" rx="4" ry="5" fill="url(#' + id + 'obloom)"/><ellipse cx="104" cy="136" rx="1.6" ry="2.2" fill="url(#' + id + 'oojo)"/></g>' +
      '<g class="cara-lagrima"><ellipse cx="136" cy="136" rx="5" ry="6" fill="url(#' + id + 'obloom)"/><ellipse cx="136" cy="136" rx="2.1" ry="2.9" fill="url(#' + id + 'oojo)"/></g>' +
      '<g class="cara-lagrima dos"><ellipse cx="136" cy="136" rx="4" ry="5" fill="url(#' + id + 'obloom)"/><ellipse cx="136" cy="136" rx="1.6" ry="2.2" fill="url(#' + id + 'oojo)"/></g>' +
      '</g></g></g></g></svg>';
  }
  function svgBoca(id) {
    return '<svg class="cara-capa cara-capa-led cara-capa-boca" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + defsLed(id + 'b') +
      '<g class="cara-boca-g"><path class="cara-boca-bloom" d=""/><path class="cara-boca" d=""/></g>' +
      '<rect class="cara-corre" x="' + (BOCA.cx - 7) + '" y="' + (BOCA.cy - 2) + '" width="14" height="4" rx="2" style="fill:rgb(var(--cara-led))"/>' +
      '</svg>';
  }
  function svgReflejo(id, silueta) {
    var S = SILUETAS[silueta] || SILUETAS.A;
    return '<svg class="cara-capa cara-capa-reflejo" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>' +
      '<radialGradient id="' + id + 'vidrio" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".06"/><stop offset=".6" stop-color="#fff" stop-opacity=".025"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'bordeInt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd8ff" stop-opacity=".55"/><stop offset=".5" stop-color="#9fd8ff" stop-opacity=".08"/><stop offset="1" stop-color="#9fd8ff" stop-opacity=".3"/></linearGradient>' +
      '<clipPath id="' + id + 'clipref"><path d="' + S.visor + '"/></clipPath></defs>' +
      // (ronda 2b) sin franja diagonal: al dueño le cruzaba la cara. Queda un brillo suave de vidrio en la esquina
      // superior-izquierda (radial, ≤ .06, sin bordes) que se corre un pelo con el cabeceo, y el borde interior.
      '<g clip-path="url(#' + id + 'clipref)"><g class="cara-reflejo"><ellipse cx="78" cy="52" rx="62" ry="30" transform="rotate(-18 78 52)" fill="url(#' + id + 'vidrio)"/></g></g>' +
      '<path d="' + S.visor + '" fill="none" stroke="url(#' + id + 'bordeInt)" stroke-width="1.4"/></svg>';
  }
  function svgTodo(id, silueta) { return svgTexto(id, silueta) + svgOjos(id, silueta) + svgBoca(id) + svgReflejo(id, silueta); }

  // ---------------------------------------------------------------- instancias
  var instancias = [], seq = 0;
  var ESTADO_BASE = 'reposo', GESTO = null, tmrGesto = null, NIVEL = 0, HABLA = { on: false, periodo: 240, t0: 0, raf: null, tmr: null };

  // Puntos (u,v) → coordenadas del viewBox del ojo; `esc` agranda alrededor del centro (bloom); `fuera` lo infla.
  function aVB(pts, cx, cy, esc, fuera) {
    var out = [], i, p, dx, dy, l; esc = esc || 1; fuera = fuera || 0;
    for (i = 0; i < pts.length; i++) { p = pts[i]; dx = p[0] * OJO_SX * esc; dy = p[1] * OJO_SY * esc; l = Math.sqrt(dx * dx + dy * dy) || 1; out.push([cx + dx + dx / l * fuera, cy + dy + dy / l * fuera]); }
    return out;
  }
  // Catmull-Rom cerrado → cúbicas: siempre 24 nodos, así la forma cambia punto a punto.
  function pathDe(P) {
    var n = P.length, d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1), i, p0, p1, p2, p3;
    for (i = 0; i < n; i++) {
      p0 = P[(i - 1 + n) % n]; p1 = P[i]; p2 = P[(i + 1) % n]; p3 = P[(i + 2) % n];
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + 'Z';
  }
  function mezcla(A, B, t) { var out = [], i; for (i = 0; i < A.length; i++) out.push([A[i][0] + (B[i][0] - A[i][0]) * t, A[i][1] + (B[i][1] - A[i][1]) * t]); return out; }
  function bbox(P) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i; for (i = 0; i < P.length; i++) { if (P[i][0] < x0) x0 = P[i][0]; if (P[i][0] > x1) x1 = P[i][0]; if (P[i][1] < y0) y0 = P[i][1]; if (P[i][1] > y1) y1 = P[i][1]; } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }

  function Ojo(g, lado, cx, cy) {
    this.g = g; this.lado = lado; this.cx = cx; this.cy = cy;
    this.bloom = g.querySelector('.cara-ojo-bloom'); this.cuerpo = g.querySelector('.cara-ojo-cuerpo'); this.lineas = g.querySelector('.cara-ojo-lineas');
    this.brillo = g.querySelector('.cara-ojo-brillo'); this.destello = g.querySelector('.cara-destello');
    this.pts = null; this.nombre = null; this.tmr = null; this.mira = [0, 0];
  }
  Ojo.prototype.pintar = function (pts) {
    this.pts = pts;
    var P = aVB(pts, this.cx, this.cy), d = pathDe(P), B = bbox(P);
    this.cuerpo.setAttribute('d', d); this.lineas.setAttribute('d', d);
    this.bloom.setAttribute('d', pathDe(aVB(pts, this.cx, this.cy, 1.22, 5)));
    // brillo especular: arriba-adentro del ojo, escala con la forma; en "buscando" se corre como pupila
    var s = this.lado === 'izq' ? -1 : 1, bx = B.x + B.w * (s > 0 ? .3 : .7) + this.mira[0], by = B.y + B.h * .3 + this.mira[1];
    var rx = Math.max(1.4, B.w * .085), ry = Math.max(1, B.h * .09);
    this.brillo.setAttribute('cx', bx.toFixed(1)); this.brillo.setAttribute('cy', by.toFixed(1)); this.brillo.setAttribute('rx', rx.toFixed(1)); this.brillo.setAttribute('ry', ry.toFixed(1));
    this.brillo.style.opacity = B.h < 6 ? '0' : '';
    this.destello.setAttribute('transform', 'translate(' + (B.x + B.w * (s > 0 ? .88 : .12)).toFixed(1) + ' ' + (B.y - 2).toFixed(1) + ')');
  };
  // Morph: ≤ 4 pasos en ~220 ms (≈ 15 pasos/s) y SOLO mientras cambia; después, nada se repinta.
  Ojo.prototype.morfar = function (nombre, deGolpe) {
    var self = this, meta = puntosOjo(nombre, this.lado);
    clearTimeout(this.tmr);
    if (deGolpe || !this.pts || quieto) { this.nombre = nombre; this.pintar(meta); return; }
    var desde = this.pts, paso = 0, pasos = 4;
    this.nombre = nombre;
    var tic = function () { paso++; var t = paso / pasos; t = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; self.pintar(paso >= pasos ? meta : mezcla(desde, meta, t)); if (paso < pasos) self.tmr = setTimeout(tic, 55); };
    this.tmr = setTimeout(tic, 20);
  };

  function Instancia(el, op) {
    op = op || {};
    var id = 'cara' + (++seq) + '_';
    this.el = el; this.op = op;
    el.classList.add('cara');
    if (op.tamano) { el.style.width = op.tamano + 'px'; el.style.height = 'auto'; }
    if (op.tamano && op.tamano < 120) el.classList.add('cara-chica');
    if (quieto) el.classList.add('cara-quieta');
    if (op.color) el.setAttribute('data-color', op.color); else el.removeAttribute('data-color');
    el.setAttribute('data-silueta', op.silueta === 'B' ? 'B' : 'A');
    var S = SILUETAS[op.silueta === 'B' ? 'B' : 'A'];
    // HTML: .cara > .cara-resp (respira) > .cara-cabeza (cabeceo 3D) > svg casco + svg ojos + svg boca + svg reflejo + luz.
    // Las transformaciones 3D van en divs HTML (WebKit las aplana en <g>); los ojos y la boca son svg aparte:
    // WebKit repinta TODO el svg donde algo cambia, y así cambiar la boca no repinta el casco.
    el.innerHTML = '<div class="cara-resp"><div class="cara-cabeza">' + svgTexto(id, op.silueta) + svgOjos(id, op.silueta) + svgBoca(id) + svgReflejo(id, op.silueta) +
      '<div class="cara-luz-halo" style="left:' + (S.luz[0] / VB_W * 100).toFixed(2) + '%;top:' + (S.luz[1] / VB_H * 100).toFixed(2) + '%"></div></div></div>';
    this.cabeza = el.querySelector('.cara-cabeza');
    this.capasLed = el.querySelectorAll('.cara-capa-led'); this.capaOjos = el.querySelector('.cara-capa-ojos');
    this.lagrimas = el.querySelectorAll('.cara-lagrima'); this.corre = el.querySelector('.cara-corre');
    this.oIzq = new Ojo(el.querySelector('.cara-ojo.izq'), 'izq', OJO_IZQ.cx, OJO_IZQ.cy);
    this.oDer = new Ojo(el.querySelector('.cara-ojo.der'), 'der', OJO_DER.cx, OJO_DER.cy);
    this.ojos = el.querySelector('.cara-ojos'); this.sq = el.querySelector('.cara-ojos-sq');
    this.bocaG = el.querySelector('.cara-boca-g'); this.boca = el.querySelector('.cara-boca'); this.bocaBloom = el.querySelector('.cara-boca-bloom');
    this.formaBoca = null;
    el.__cara = this;
    if (op.entrada === false || quieto) this.aplicar(estadoVisible(), true);
    else this.encender();
  }
  // Entrada: el casco aparece, los ojos se abren desde una rayita, parpadea y mira al que lo abrió.
  Instancia.prototype.encender = function () {
    var self = this, el = this.el;
    el.classList.add('cara-apagada'); el.setAttribute('data-estado', estadoVisible());
    this.oIzq.pintar(puntosOjo('parpadeo', 'izq')); this.oDer.pintar(puntosOjo('parpadeo', 'der')); this.oIzq.nombre = this.oDer.nombre = 'parpadeo';
    this.bocaA('nada');
    setTimeout(function () { el.classList.remove('cara-apagada'); }, 30);
    setTimeout(function () { if (el.__cara === self) self.aplicar(estadoVisible(), false); }, 420);
    setTimeout(function () { if (el.__cara === self) self.mirar(-6, 3); }, 1000);
    setTimeout(function () { if (el.__cara === self) { self.parpadear(1); self.mirar(0, 0); self.cabecear(); } }, 1450);
  };
  Instancia.prototype.ojosA = function (izq, der, deGolpe) {
    if (this.oIzq.nombre !== izq) this.oIzq.morfar(izq, deGolpe);
    if (this.oDer.nombre !== der) this.oDer.morfar(der, deGolpe);
  };
  Instancia.prototype.bocaA = function (nombre, apertura) {
    var k = nombre + '|' + (nombre === 'habla' ? Math.round((apertura || 0) * 12) : '');
    if (this.formaBoca === k) return; this.formaBoca = k;
    var f = bocaForma(nombre, apertura);
    if (!f) { this.bocaG.style.opacity = '0'; return; }
    this.bocaG.style.opacity = '';
    this.boca.setAttribute('d', f.d); this.bocaBloom.setAttribute('d', f.d);
    this.bocaG.classList.toggle('relleno', !!f.relleno);
  };
  Instancia.prototype.aplicar = function (nombre, deGolpe) {
    var d = ESTADOS[nombre] || ESTADOS.reposo, cambia = this.el.getAttribute('data-estado') !== nombre;
    this.el.setAttribute('data-estado', nombre);
    this.ojosA(d.ojos[0], d.ojos[1], deGolpe);
    this.bocaA(d.boca === 'habla' ? 'habla' : d.boca, d.boca === 'habla' ? (quieto ? .5 : .12) : 0);
    this.ojos.style.transform = '';
    if (cambia && !deGolpe) this.cabecear();
  };
  // Cabeceo: gira 2-4° (perspective en el div) y regresa solo; el reflejo del visor se corre un pelo al revés.
  Instancia.prototype.cabecear = function (ry, rx) {
    if (quieto || !this.cabeza) return;
    var self = this;
    ry = ry == null ? (Math.random() < .5 ? -1 : 1) * (2.2 + Math.random() * 1.8) : ry;
    rx = rx == null ? (Math.random() - .5) * 3 : rx;
    this.el.style.setProperty('--cara-ry', ry.toFixed(1) + 'deg'); this.el.style.setProperty('--cara-rx', rx.toFixed(1) + 'deg');
    this.el.style.setProperty('--cara-rfx', (-ry * 1.1).toFixed(1) + 'px');
    clearTimeout(this.tmrCab);
    this.tmrCab = setTimeout(function () { self.el.style.setProperty('--cara-ry', '0deg'); self.el.style.setProperty('--cara-rx', '0deg'); self.el.style.setProperty('--cara-rfx', '0px'); }, 850);
  };
  // Parpadeo = scaleY de cada ojo (clase CSS con transición corta), con un squash leve del par.
  Instancia.prototype.parpadear = function (veces) {
    var self = this, n = veces || 1;
    if (hayDOM && document.hidden) return;      // pestaña de fondo: los timers se frenan a 1 s y el ojo se quedaría cerrado
    var cerrar = function () {
      self.el.classList.add('cara-cerrando'); if (self.sq) self.sq.style.transform = 'scaleY(.9)';
      setTimeout(function () {
        self.el.classList.remove('cara-cerrando'); if (self.sq) self.sq.style.transform = '';
        if (--n > 0) setTimeout(cerrar, 150);
      }, 120);
    };
    cerrar();
  };
  Instancia.prototype.mirar = function (dx, dy) {
    this.ojos.style.transform = (dx || dy) ? 'translate(' + dx + 'px,' + dy + 'px)' : '';
    if (!quieto && this.cabeza) { this.el.style.setProperty('--cara-ry', (dx * .45).toFixed(1) + 'deg'); this.el.style.setProperty('--cara-rx', (-dy * .4).toFixed(1) + 'deg'); this.el.style.setProperty('--cara-rfx', (-dx * .5).toFixed(1) + 'px'); }
  };
  // Pupila (brillo) corrida: buscando
  Instancia.prototype.pupila = function (dx, dy) { this.oIzq.mira = [dx, dy]; this.oDer.mira = [dx, dy]; if (this.oIzq.pts) this.oIzq.pintar(this.oIzq.pts); if (this.oDer.pts) this.oDer.pintar(this.oDer.pts); };

  // ---------------------------------------------------------------- estado global (todas las caras montadas van juntas)
  function estadoVisible() { return GESTO || ESTADO_BASE; }
  function repintar(deGolpe) {
    var e = estadoVisible();
    for (var i = 0; i < instancias.length; i++) instancias[i].aplicar(e, deGolpe);
    if (e === 'hablando') { if (!HABLA.on) habla(true); } else if (HABLA.on) habla(false);
    programarParpadeo();
    lazo(e);
  }
  // Lazos de buscar / lágrimas / apagado: por temporizador a 5-7 pasos por segundo (se ve "de LED") y
  // NO por animación CSS dentro del svg (WebKit repinta todo el dibujo a 60 fps: 27 % de CPU medido).
  var LAZO = { tmr: null, paso: 0, estado: null };
  var BUSCAR_PASOS = [[0, 0], [-4, -1], [-9, -2], [-13, -3], [-13, -3], [-13, -3], [-9, -2], [-3, -1], [3, -1], [9, -2], [13, -2], [13, -2], [13, -2], [8, -1], [3, 0], [0, 0]];
  function lazo(e) {
    if (LAZO.estado === e && LAZO.tmr) return;
    clearInterval(LAZO.tmr); LAZO.tmr = null; LAZO.estado = e; LAZO.paso = 0;
    var i, k;
    for (i = 0; i < instancias.length; i++) { var I = instancias[i]; I.corre.style.opacity = ''; I.corre.style.transform = ''; for (k = 0; k < I.lagrimas.length; k++) { I.lagrimas[k].style.opacity = ''; I.lagrimas[k].style.transform = ''; } for (k = 0; k < I.capasLed.length; k++) I.capasLed[k].style.opacity = ''; I.capaOjos.style.transform = ''; if (I.oIzq.mira[0] || I.oIzq.mira[1]) I.pupila(0, 0); }
    if (!instancias.length) return;
    if (quieto) {   // sin movimiento: posición fija
      if (e === 'buscando') for (i = 0; i < instancias.length; i++) instancias[i].corre.style.opacity = '.8';
      if (e === 'triste') for (i = 0; i < instancias.length; i++) for (k = 0; k < 4; k++) { instancias[i].lagrimas[k].style.opacity = '.8'; instancias[i].lagrimas[k].style.transform = 'translateY(10px)'; }
      if (e === 'sin_senal') for (i = 0; i < instancias.length; i++) for (k = 0; k < 2; k++) instancias[i].capasLed[k].style.opacity = '.4';
      return;
    }
    var cada = e === 'buscando' ? 160 : e === 'triste' ? 170 : e === 'sin_senal' ? 450 : 0;
    if (!cada) return;
    LAZO.tmr = setInterval(function () {
      if (hayDOM && document.hidden) return;
      var p = ++LAZO.paso, j, n;
      for (j = 0; j < instancias.length; j++) {
        var I = instancias[j];
        if (e === 'buscando') {
          // los ojos miran a los lados (la capa entera se mueve: compositor) y el brillo se corre como pupila
          var d = BUSCAR_PASOS[p % BUSCAR_PASOS.length]; I.capaOjos.style.transform = 'translate(' + (d[0] / VB_W * 100).toFixed(2) + '%,' + (d[1] / VB_H * 100).toFixed(2) + '%)';
          I.pupila(d[0] * .45, d[1] * .3);
          I.corre.style.opacity = '.9'; I.corre.style.transform = 'translateX(' + ((p % 6 < 3 ? (p % 6) : 6 - (p % 6)) * 6 - 9) + 'px)';
        } else if (e === 'triste') {
          for (n = 0; n < 4; n++) { var f = ((p + (n % 2 ? 4 : 0)) % 9) / 8; I.lagrimas[n].style.opacity = f < .1 ? '0' : String((1 - f).toFixed(2)); I.lagrimas[n].style.transform = 'translateY(' + (f * 26).toFixed(1) + 'px)'; }
        } else if (e === 'sin_senal') {
          var o = [.28, .4, .6, .4][p % 4]; for (n = 0; n < I.capasLed.length; n++) I.capasLed[n].style.opacity = String(o);
        }
      }
    }, cada);
  }
  function estado(nombre) {
    var n = normal(nombre); if (!n) return false;
    ESTADO_BASE = n;
    if (GESTO) { clearTimeout(tmrGesto); GESTO = null; }      // un estado nuevo cancela el gesto pasajero
    repintar(false);
    if (n === 'exito') entradaDoble();
    return true;
  }
  function gesto(nombre, ms) {
    var n = normal(nombre);
    if (!n || n === 'reposo') { if (GESTO) { clearTimeout(tmrGesto); GESTO = null; repintar(false); } return !!n; }
    clearTimeout(tmrGesto);
    GESTO = n; repintar(false);
    if (n === 'exito') entradaDoble();
    tmrGesto = setTimeout(function () { GESTO = null; repintar(false); }, ms || MS_GESTO[n] || 1800);
    return true;
  }
  function entradaDoble() { if (quieto) return; for (var i = 0; i < instancias.length; i++) instancias[i].parpadear(2); }
  function nivel(v) {
    v = Math.max(0, Math.min(1, +v || 0)); NIVEL = v;
    for (var i = 0; i < instancias.length; i++) instancias[i].el.style.setProperty('--cara-nivel', v.toFixed(2));
  }

  // ---------------------------------------------------------------- parpadeo y mirada (temporizadores, no rAF)
  var tmrParpadeo = null, tmrMirada = null;
  function programarParpadeo() {
    clearTimeout(tmrParpadeo); clearTimeout(tmrMirada);
    if (!instancias.length || quieto) return;
    var d = ESTADOS[estadoVisible()];
    if (d && d.parpadea) tmrParpadeo = setTimeout(function () {
      if (hayDOM && document.hidden) { programarParpadeo(); return; }
      for (var i = 0; i < instancias.length; i++) instancias[i].parpadear(Math.random() < .12 ? 2 : 1);
      programarParpadeo();
    }, 3000 + Math.random() * 3000);
    // la mirada sigue un punto al azar cada 4-8 s (ojos + un giro leve de la cabeza) y vuelve
    if (d && d.mira) tmrMirada = setTimeout(function () {
      var dx = (Math.random() < .5 ? -1 : 1) * (4 + Math.random() * 6), dy = (Math.random() - .5) * 5;
      for (var i = 0; i < instancias.length; i++) instancias[i].mirar(+dx.toFixed(1), +dy.toFixed(1));
      setTimeout(function () { for (var i = 0; i < instancias.length; i++) instancias[i].mirar(0, 0); }, 900 + Math.random() * 700);
    }, 4000 + Math.random() * 4000);
  }

  // ---------------------------------------------------------------- boca al hablar (rAF a ~18 fps, solo mientras habla)
  function silabas(t) { var m = String(t || '').toLowerCase().match(/[aeiouáéíóúü]+/g); return m ? m.length : 0; }
  function habla(on, texto) {
    if (on && texto) { var n = silabas(texto), ms = Math.max(900, String(texto).length * 62); HABLA.periodo = Math.max(150, Math.min(380, n ? ms / n : 240)); }
    if (on === HABLA.on) return;
    HABLA.on = on;
    if (!on) { if (HABLA.raf && hayWin) cancelAnimationFrame(HABLA.raf); HABLA.raf = null; for (var i = 0; i < instancias.length; i++) instancias[i].bocaA('habla', .12); return; }
    if (quieto || !hayWin || !window.requestAnimationFrame) { for (var j = 0; j < instancias.length; j++) instancias[j].bocaA('habla', .5); return; }
    HABLA.t0 = Date.now(); var ult = 0;
    var paso = function () {
      if (!HABLA.on) return;
      var ahora = Date.now();
      if (ahora - ult >= 80) {   // 12 cuadros/s para la boca: cada cuadro repinta la capa de la boca
        ult = ahora;
        var t = (ahora - HABLA.t0) / HABLA.periodo;
        var a = .22 + .78 * Math.abs(Math.sin(t * Math.PI)) * (.6 + .4 * Math.abs(Math.sin(t * .37 + 1.3)));
        if (NIVEL > 0) a = Math.max(a * .6, Math.min(1, NIVEL * 1.4));
        if (estadoVisible() === 'hablando') for (var i = 0; i < instancias.length; i++) instancias[i].bocaA('habla', a);
      }
      HABLA.raf = requestAnimationFrame(paso);
    };
    HABLA.raf = requestAnimationFrame(paso);
  }
  function hablando(on, texto) {
    if (on) { if (ESTADO_BASE !== 'hablando') estado('hablando'); habla(true, texto); }
    else { habla(false); if (ESTADO_BASE === 'hablando') estado('reposo'); }
  }

  // ---------------------------------------------------------------- parallax con el giroscopio (opcional, solo nativo)
  // Pide permiso UNA vez (iOS lo exige desde un toque) y lo recuerda; sin permiso, nada. 10 lecturas/s como máximo.
  var PARALLAX = { on: false, ult: 0 };
  function parallax(activar) {
    if (!hayWin || !hayDOM) return Promise.resolve(false);
    if (activar === false) { PARALLAX.on = false; try { window.removeEventListener('deviceorientation', alGirar); } catch (e) {} return Promise.resolve(false); }
    var nativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var DOE = window.DeviceOrientationEvent;
    if (!nativo || !DOE || quieto) return Promise.resolve(false);
    var guardado = null; try { guardado = localStorage.getItem('cara_parallax'); } catch (e) {}
    if (guardado === 'no') return Promise.resolve(false);
    var arrancar = function () { if (PARALLAX.on) return true; PARALLAX.on = true; window.addEventListener('deviceorientation', alGirar); return true; };
    if (typeof DOE.requestPermission !== 'function') return Promise.resolve(arrancar());
    if (guardado === 'si') return Promise.resolve(arrancar());
    return DOE.requestPermission().then(function (r) {
      var ok = r === 'granted'; try { localStorage.setItem('cara_parallax', ok ? 'si' : 'no'); } catch (e) {}
      return ok ? arrancar() : false;
    }).catch(function () { return false; });
  }
  function alGirar(ev) {
    var ahora = Date.now(); if (ahora - PARALLAX.ult < 100) return; PARALLAX.ult = ahora;
    var g = (ev.gamma || 0), b = (ev.beta || 0) - 40;      // gamma: izquierda/derecha; beta: inclinación (40° = teléfono en la mano)
    var py = Math.max(-6, Math.min(6, g * .2)), px = Math.max(-5, Math.min(5, -b * .12));
    for (var i = 0; i < instancias.length; i++) { instancias[i].el.style.setProperty('--cara-py', py.toFixed(1) + 'deg'); instancias[i].el.style.setProperty('--cara-px', px.toFixed(1) + 'deg'); }
  }

  // ---------------------------------------------------------------- montar / desmontar
  function montar(el, op) {
    if (!hayDOM || !el || !el.querySelector) return null;
    if (el.__cara) desmontar(el);
    var ins = new Instancia(el, op || {});
    instancias.push(ins);
    if (estadoVisible() === 'hablando' && HABLA.on) ins.bocaA('habla', .3);
    programarParpadeo();
    return {
      el: el,
      estado: estado, gesto: gesto, nivel: nivel, hablando: hablando, parallax: parallax,
      encender: function () { if (el.__cara) el.__cara.encender(); },
      desmontar: function () { desmontar(el); }
    };
  }
  function desmontar(el) {
    if (!el || !el.__cara) return false;
    var i = instancias.indexOf(el.__cara); if (i >= 0) instancias.splice(i, 1);
    clearTimeout(el.__cara.tmrCab);
    el.innerHTML = ''; el.classList.remove('cara', 'cara-chica', 'cara-quieta', 'cara-cerrando', 'cara-apagada'); el.removeAttribute('data-estado'); el.removeAttribute('data-silueta');
    delete el.__cara;
    if (!instancias.length) { clearTimeout(tmrParpadeo); clearTimeout(tmrMirada); clearInterval(LAZO.tmr); LAZO.tmr = null; if (HABLA.on) habla(false); }
    return true;
  }
  if (hayDOM && document.addEventListener) document.addEventListener('visibilitychange', function () { if (!document.hidden) programarParpadeo(); });

  // ---------------------------------------------------------------- la etiqueta del modelo: "[gesto:contento] Hola…"
  var GESTOS_MODELO = ['contento', 'sorprendido', 'triste', 'confundido', 'pregunta', 'neutral', 'buscando'];
  var RE_ETIQ = /\[\s*gesto\s*[:=]\s*([^\]]{0,24})\]/i;
  function limpiarEtiqueta(texto) {
    var t = String(texto == null ? '' : texto), g = null;
    var m = RE_ETIQ.exec(t);
    if (m) { var n = normal(m[1]); g = n ? (n === 'reposo' ? 'neutral' : n) : null; }
    t = t.replace(new RegExp(RE_ETIQ.source, 'gi'), ' ').replace(/[ \t]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
    return { gesto: g, texto: t };
  }
  // Por trozos (SSE): la etiqueta puede llegar partida ("[ges" + "to:con" + "tento] Hola"). Se retiene solo
  // mientras lo recibido PUEDA ser una etiqueta; en cuanto se ve que no lo es, se suelta todo.
  var RE_PREFIJO = /^\[\s*(?:g(?:e(?:s(?:t(?:o(?:\s*[:=]\s*[a-záéíóúñü_ ]{0,24})?)?)?)?)?)?$/i;   // cualquier principio de "[gesto:nombre"
  function filtroDeTrozos() {
    var buf = '', decidido = false, visto = false;
    var fn = function (trozo) {
      var out = { texto: '', gesto: null };
      trozo = String(trozo == null ? '' : trozo);
      if (decidido) {                                   // ya pasó el arranque: los trozos salen tal cual (solo se quita una etiqueta tardía)
        if (!RE_ETIQ.test(trozo)) { out.texto = trozo; return out; }
        var l = limpiarEtiqueta(trozo); out.texto = trozo.replace(new RegExp(RE_ETIQ.source, 'gi'), ' ');
        if (l.gesto && !visto) { visto = true; out.gesto = l.gesto; }
        return out;
      }
      buf += trozo;
      var s = buf.replace(/^\s+/, '');
      if (!s) return out;
      if (s.charAt(0) === '[' && s.indexOf(']') >= 0) {   // etiqueta completa al principio
        decidido = true; var l2 = limpiarEtiqueta(s); visto = !!l2.gesto; out.gesto = l2.gesto;
        out.texto = s.replace(RE_ETIQ, '').replace(/^\s+/, ''); buf = ''; return out;
      }
      if (s.charAt(0) === '[' && s.length <= 32 && RE_PREFIJO.test(s)) return out;   // todavía puede ser "[gesto:…" partido: esperar
      decidido = true; out.texto = buf; buf = ''; return out;   // no era etiqueta: se suelta todo, sin tocar espacios
    };
    fn.vaciar = function () { var t = buf; buf = ''; decidido = true; return { texto: t, gesto: null }; };
    return fn;
  }
  // Reglas automáticas del cliente (sin modelo).
  var EVENTOS = { confirmacion: 'pregunta', tarjeta: 'pregunta', error: 'triste', '429': 'triste', '401': 'triste', sesion: 'triste',
    red: 'sin_senal', sin_nube: 'sin_senal', guardado: 'exito', confirmado: 'exito', no_encontre: 'confundido', no_entendi: 'confundido',
    herramienta: 'buscando', pensando: 'buscando', cancelado: 'reposo', navegar: 'contento' };
  function gestoDe(evento) { return EVENTOS[String(evento || '').toLowerCase()] || null; }
  function gestoDelTexto(texto) {
    var t = String(texto || '').toLowerCase();
    if (!t) return null;
    if (/no (lo |la |los |las )?(encontr|hall|ubic)|no hay (nadie|ning|registro)|no entend|no te entend|¿?qu[ée] quisiste|no s[ée] qu[ée]/.test(t)) return 'confundido';
    if (/no se pudo|no pude|no se registr|lo siento|perd[óo]n|se cort[óo]|venci[óo]|no puedo hacer/.test(t)) return 'triste';
    if (/\b(listo|registrad[oa]|qued[óo] (registrad|guardad)|ya qued[óo]|guardad[oa])\b/.test(t)) return 'exito';
    if (/\?\s*$/.test(t.trim())) return 'pregunta';
    return null;
  }

  var Cara = {
    montar: montar, desmontar: desmontar, estado: estado, gesto: gesto, nivel: nivel, hablando: hablando, parallax: parallax,
    limpiarEtiqueta: limpiarEtiqueta, filtroDeTrozos: filtroDeTrozos, gestoDe: gestoDe, gestoDelTexto: gestoDelTexto,
    puntos: puntos, normal: normal, svg: svgTodo, N_NODOS: N_NODOS,
    path: function (n, lado) { var c = lado === 'izq' ? OJO_IZQ : OJO_DER; return pathDe(aVB(puntosOjo(n, lado || 'der'), c.cx, c.cy)); }, mezcla: mezcla,
    actual: function () { return { base: ESTADO_BASE, gesto: GESTO, visible: estadoVisible(), nivel: NIVEL, hablando: HABLA.on, instancias: instancias.length }; },
    ESTADOS: Object.keys(ESTADOS), GESTOS_MODELO: GESTOS_MODELO, COLORES: ['celeste', 'menta', 'ambar', 'violeta'], SILUETAS: ['A', 'B']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cara;
  if (raiz) raiz.Cara = Cara;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
