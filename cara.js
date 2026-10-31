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
   Ronda 4 (cabeza viva):
     Cara.asentir(veces)             "sí" con la cabeza (también solo al guardar: gesto 'exito')
     Cara.negar()                    "no" suave (cancelar)
     Cara.ladear('izq'|'der'|grados, ms)   ladea la cabeza (pregunta / confundido lo hacen solos)
     Cara.mirar('izq'|'der'|'arriba'|'abajo'|'frente', ms)   voltea la cabeza 10-18° y los ojos se van a ese lado
     Cara.voltear()                  regresa al frente con un rebote (escuchar/hablar lo hace solo)
     Cara.guinar()                   guiño (solo: ~1 de cada 10 'contento' sin dinero; ver gesto(…, ms, {texto|dinero}))
     Cara.sorpresa(ms, luego, msLuego)   sorpresa breve con saltito (p. ej. tarjeta grande) y después otro gesto
     Cara.config({sueno: ms, azar: fn})  para pruebas (sueño tras 60 s en reposo)
   Sin DOM (Node) nada lanza: montar devuelve null y el estado se guarda igual.

   Batería: nada corre a 60 fps por JS. Las formas cambian por morph a ≤ 15 pasos/s solo mientras cambian; la
   cabeza, las orejas, las ondas y las luces son capas HTML que mueve el compositor; el único
   requestAnimationFrame vive mientras HABLA (boca, 12 fps) y se apaga solo.
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
    sueno:        oval(.86, .3, 2.6, .2),                                   // entrecerrados, caídos (lleva rato sin nada)
    apretado:     oval(.8, .1, 2, .08),                                     // bostezo
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
      case 'bostezo': { var hb = Math.max(2, (apertura == null ? 1 : apertura) * 13), wb = 9; return { d: 'M' + (c - wb) + ' ' + y + 'C' + (c - wb) + ' ' + (y - hb) + ' ' + (c + wb) + ' ' + (y - hb) + ' ' + (c + wb) + ' ' + y + 'C' + (c + wb) + ' ' + (y + hb) + ' ' + (c - wb) + ' ' + (y + hb) + ' ' + (c - wb) + ' ' + y + 'Z', relleno: true }; }
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
    sin_senal:   { ojos: ['punto', 'punto'],               boca: 'nada',       parpadea: false },
    sueno:       { ojos: ['sueno', 'sueno'],               boca: 'nada',       parpadea: false }     // interno: no se pide, llega solo
  };
  var PUBLICOS = ['reposo', 'escuchando', 'buscando', 'hablando', 'pregunta', 'contento', 'sorprendido', 'triste', 'confundido', 'exito', 'sin_senal'];
  // Pose de la cabeza que acompaña a cada estado (grados): bx = hacia adelante(-)/atrás(+), bz = ladeo.
  var POSE_ESTADO = { escuchando: { bx: -4, bz: 5 }, pregunta: { bz: 7 }, confundido: { bz: -8 }, triste: { bx: -7 }, sorprendido: { bx: 5 },
    contento: { bx: 2 }, exito: { bx: 2 }, sueno: { bx: -6, bz: 3 }, sin_senal: { bx: -5 } };
  var ALIAS = { esperando: 'reposo', neutral: 'reposo', pensando: 'buscando', confirmar: 'pregunta', duda: 'pregunta',
    error: 'triste', lo_siento: 'triste', 'lo siento': 'triste', feliz: 'contento', alegre: 'contento', sorpresa: 'sorprendido',
    confuso: 'confundido', guardado: 'exito', 'éxito': 'exito', offline: 'sin_senal', 'sin señal': 'sin_senal', sin_señal: 'sin_senal', 'sin senal': 'sin_senal' };
  var MS_GESTO = { contento: 1800, sorprendido: 1500, triste: 2400, confundido: 1900, exito: 1700, pregunta: 2600, buscando: 1500, sin_senal: 2600, escuchando: 1500, hablando: 1500 };
  function llano(x) { return String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_'); }
  var ALIAS_LLANO = {}; Object.keys(ALIAS).forEach(function (k) { ALIAS_LLANO[llano(k)] = ALIAS[k]; });
  function normal(n) { n = llano(n); if (PUBLICOS.indexOf(n) >= 0) return n; return ALIAS_LLANO[n] || null; }

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
    s.push('<svg class="cara-casco" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">');
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
      '<linearGradient id="' + id + 'luzmetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6174"/><stop offset="1" stop-color="#20242f"/></linearGradient>',
      '<radialGradient id="' + id + 'sombra" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
      '</defs>');
    s.push('<ellipse class="cara-sombra" cx="120" cy="207" rx="96" ry="9" fill="' + U('sombra') + '"/>');
    s.push('<g class="cara-cuerpo">');
    s.push(S.antena.replace(/%/g, id));
    // (ronda 4) las orejas ya no van aquí: son capas HTML aparte (svgOreja) para moverlas y encenderlas con la
    // voz sin repintar el casco.
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
  // Oreja en su propio svg chico (viewBox recortado alrededor de la oreja): metal cepillado + aro turquesa.
  var OREJA = { izq: { vb: -8, x: 0, xa: 7 }, der: { vb: 210, x: 218, xa: 228 } };
  function svgOreja(id, lado) {
    var O = OREJA[lado], k = id + 'or' + lado;
    return '<svg viewBox="' + O.vb + ' 78 38 76" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="' + k + 'metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5063"/><stop offset=".12" stop-color="#20242f"/><stop offset=".3" stop-color="#3b4150"/><stop offset=".5" stop-color="#171a23"/><stop offset=".7" stop-color="#353b49"/><stop offset=".88" stop-color="#1b1e28"/><stop offset="1" stop-color="#3a3f4e"/></linearGradient>' +
      '<linearGradient id="' + k + 'aro" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--cara-aro-2)"/><stop offset=".5" style="stop-color:var(--cara-aro)"/><stop offset="1" style="stop-color:var(--cara-aro-2)"/></linearGradient></defs>' +
      '<rect x="' + O.x + '" y="86" width="22" height="60" rx="7" fill="url(#' + k + 'metal)"/>' +
      '<rect x="' + O.x + '" y="86" width="22" height="60" rx="7" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1"/>' +
      '<rect class="cara-aro" x="' + O.xa + '" y="86" width="5" height="60" fill="url(#' + k + 'aro)"/>' +
      '<rect x="' + (O.x + 2) + '" y="88" width="18" height="2" rx="1" fill="#fff" fill-opacity=".18"/></svg>';
  }
  function svgReflejo(id, silueta) {
    var S = SILUETAS[silueta] || SILUETAS.A;
    return '<svg class="cara-capa cara-capa-reflejo" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="' + id + 'bordeInt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd8ff" stop-opacity=".55"/><stop offset=".5" stop-color="#9fd8ff" stop-opacity=".08"/><stop offset="1" stop-color="#9fd8ff" stop-opacity=".3"/></linearGradient>' +
      '</defs>' +
      // (ronda 2b) sin franja diagonal. (ronda 4) el brillo suave de vidrio (≤ .06) es un div HTML (.cara-brillo) que se
      // corre con el giro de la cabeza sin repintar; aquí solo queda el borde interior del visor.
      '<path d="' + S.visor + '" fill="none" stroke="url(#' + id + 'bordeInt)" stroke-width="1.4"/></svg>';
  }
  function pct(v, de) { return (v / de * 100).toFixed(2) + '%'; }
  // HTML: .cara > .cara-resp (respira) > .cara-gesto (asentir/negar/saltito) > .cara-cabeza (giro 3D) >
  //   orejas (capas HTML detrás) + casco (svg) + .cara-rostro (ojos y boca: se corren hacia donde voltea) +
  //   brillo del vidrio + borde del visor + luz de estado + ondas de escuchar.
  // Las transformaciones 3D van en divs HTML (WebKit las aplana en <g>); todo lo que se mueve seguido es un
  // elemento HTML con transform/opacity (compositor): nada de eso repinta un svg.
  function htmlCara(id, silueta) {
    var S = SILUETAS[silueta] || SILUETAS.A, luz = 'left:' + pct(S.luz[0], VB_W) + ';top:' + pct(S.luz[1], VB_H);
    var oreja = function (lado) { return '<div class="cara-oreja-caja ' + lado + '"><div class="cara-oreja-luz"></div>' + svgOreja(id, lado) + '<div class="cara-aro-on"></div></div>'; };
    var ondas = function (lado) { return '<div class="cara-ondas ' + lado + '"><i class="cara-onda"></i><i class="cara-onda"></i><i class="cara-onda"></i></div>'; };
    return '<div class="cara-resp"><div class="cara-gesto"><div class="cara-cabeza">' + oreja('izq') + oreja('der') + svgTexto(id, silueta) +
      '<div class="cara-rostro">' + svgOjos(id, silueta) + svgBoca(id) + '</div>' +
      '<div class="cara-brillo"></div>' + svgReflejo(id, silueta) +
      '<div class="cara-luz-halo" style="' + luz + '"></div><div class="cara-luz-on" style="' + luz + '"></div>' +
      ondas('izq') + ondas('der') + '</div></div></div>';
  }
  function svgTodo(id, silueta) { return htmlCara(id, silueta); }

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
    el.innerHTML = htmlCara(id, op.silueta === 'B' ? 'B' : 'A');
    this.cabeza = el.querySelector('.cara-cabeza');
    this.capasLed = el.querySelectorAll('.cara-capa-led'); this.capaOjos = el.querySelector('.cara-capa-ojos');
    this.lagrimas = el.querySelectorAll('.cara-lagrima'); this.corre = el.querySelector('.cara-corre');
    this.oIzq = new Ojo(el.querySelector('.cara-ojo.izq'), 'izq', OJO_IZQ.cx, OJO_IZQ.cy);
    this.oDer = new Ojo(el.querySelector('.cara-ojo.der'), 'der', OJO_DER.cx, OJO_DER.cy);
    this.ojos = el.querySelector('.cara-ojos'); this.sq = el.querySelector('.cara-ojos-sq');
    this.bocaG = el.querySelector('.cara-boca-g'); this.boca = el.querySelector('.cara-boca'); this.bocaBloom = el.querySelector('.cara-boca-bloom');
    this.formaBoca = null;
    // lo que se mueve con la voz (solo capas HTML; ver pintarNivel)
    this.nv = { cajas: el.querySelectorAll('.cara-oreja-caja'), luces: el.querySelectorAll('.cara-oreja-luz'), aros: el.querySelectorAll('.cara-aro-on'),
      halo: el.querySelector('.cara-luz-halo'), ondas: el.querySelectorAll('.cara-ondas'), puesto: false };
    el.__cara = this;
    escribirPoseEn(this);
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
    setTimeout(function () { if (el.__cara === self) { self.parpadear(1); self.mirar(0, 0); cabecear(); } }, 1450);
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
    return cambia;
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
  // Mirada de los ojos (viewBox): mueve la capa entera de los ojos (elemento HTML: compositor, no repinta).
  Instancia.prototype.mirar = function (dx, dy) {
    this.capaOjos.style.transform = (dx || dy) ? 'translate(' + pct(dx, VB_W) + ',' + pct(dy, VB_H) + ')' : '';
  };
  Instancia.prototype.anim = function (nombre, ms) {
    var g = this.el.querySelector('.cara-gesto'), el = this.el; if (!g) return;
    clearTimeout(this.tmrAnim);
    g.className = 'cara-gesto'; void g.offsetWidth;          // reinicia la animación aunque sea la misma
    g.className = 'cara-gesto cara-g-' + nombre;
    this.tmrAnim = setTimeout(function () { g.className = 'cara-gesto'; }, ms + 60);
    return el;
  };
  // Pupila (brillo) corrida: buscando
  Instancia.prototype.pupila = function (dx, dy) { this.oIzq.mira = [dx, dy]; this.oDer.mira = [dx, dy]; if (this.oIzq.pts) this.oIzq.pintar(this.oIzq.pts); if (this.oDer.pts) this.oDer.pintar(this.oDer.pts); };

  // ---------------------------------------------------------------- estado global (todas las caras montadas van juntas)
  var SUENO = false, BOSTEZANDO = false;
  function estadoVisible() { return GESTO || (SUENO && ESTADO_BASE === 'reposo' ? 'sueno' : ESTADO_BASE); }
  function repintar(deGolpe) {
    var e = estadoVisible(), cambio = false;
    for (var i = 0; i < instancias.length; i++) cambio = instancias[i].aplicar(e, deGolpe) || cambio;
    if (e === 'hablando') { if (!HABLA.on) habla(true); } else if (HABLA.on) habla(false);
    var b = POSE_ESTADO[e] || {}; POSE.bx = b.bx || 0; POSE.bz = b.bz || 0;
    if (cambio && !deGolpe) cabecear(); else escribirPose();
    for (var k = 0; k < instancias.length; k++) pintarNivel(instancias[k], NIVEL);
    programarParpadeo();
    lazo(e);
    armarSueno();
  }

  // ---------------------------------------------------------------- la cabeza (ronda 4)
  // POSE (grados): ry/rx = hacia dónde voltea (mirar), rz = ladeo pedido, cy/cx = cabeceo chico al cambiar de gesto,
  // bx/bz = la pose del estado (escuchando se inclina hacia el que habla). Todo se escribe como variables CSS en .cara
  // y lo mueve el compositor (transiciones de transform en divs HTML).
  var POSE = { ry: 0, rx: 0, rz: 0, cy: 0, cx: 0, bx: 0, bz: 0 }, MODO = { ult: null, tmr: null }, ULT_ANIM = null;
  var CFG = { sueno: 60000, azar: Math.random };
  var tmrMiraLado = null, tmrLadeo = null, tmrCab = null, tmrSueno = null, tmrBostezo = null, GUINOS = 0, ULT_GUINO = -1e9;
  function azar() { try { return CFG.azar(); } catch (e) { return Math.random(); } }
  function poseTotal() { return { ry: POSE.ry + POSE.cy, rx: POSE.rx + POSE.cx + POSE.bx, rz: POSE.rz + POSE.bz }; }
  function escribirPoseEn(I) {
    var t = poseTotal(), st = I.el.style;
    st.setProperty('--cara-ry', t.ry.toFixed(1) + 'deg'); st.setProperty('--cara-rx', t.rx.toFixed(1) + 'deg'); st.setProperty('--cara-rz', t.rz.toFixed(1) + 'deg');
    // el rostro (ojos y boca) se corre hacia donde voltea, como dibujado sobre un vidrio curvo; el brillo, al revés
    st.setProperty('--cara-fx', pct(t.ry * .6, VB_W)); st.setProperty('--cara-fy', pct(-t.rx * .5, VB_H));
    st.setProperty('--cara-rfx', (-t.ry * .7).toFixed(1) + 'px');
  }
  function escribirPose(modo) {
    if (modo) {
      MODO.ult = modo; clearTimeout(MODO.tmr);
      for (var i = 0; i < instancias.length; i++) { instancias[i].el.classList.remove('cara-rebote', 'cara-lento'); instancias[i].el.classList.add('cara-' + modo); }
      MODO.tmr = setTimeout(function () { for (var j = 0; j < instancias.length; j++) instancias[j].el.classList.remove('cara-rebote', 'cara-lento'); }, 1300);
    }
    for (var k = 0; k < instancias.length; k++) escribirPoseEn(instancias[k]);
  }
  // Cabeceo chico (2-4°) al cambiar de gesto; regresa solo.
  function cabecear() {
    if (quieto) { escribirPose(); return; }
    POSE.cy = (azar() < .5 ? -1 : 1) * (2.2 + azar() * 1.8); POSE.cx = (azar() - .5) * 3; escribirPose();
    clearTimeout(tmrCab); tmrCab = setTimeout(function () { POSE.cy = 0; POSE.cx = 0; escribirPose(); }, 850);
  }
  var LADOS = { izq: [-1, 0], der: [1, 0], arriba: [0, 1], abajo: [0, -1] };
  // Voltea la cabeza 10-18° hacia un lado (los ojos se van para allá) y regresa sola después de `ms` (0 = se queda).
  function mirarLado(lado, ms, grados, modo) {
    despertar();
    lado = String(lado || 'frente').toLowerCase();
    if (lado === 'izquierda') lado = 'izq'; if (lado === 'derecha') lado = 'der';
    if (lado === 'frente' || !LADOS[lado]) { voltear(); return lado === 'frente'; }
    var L = LADOS[lado], g = grados || (10 + azar() * 8);
    clearTimeout(tmrMiraLado);
    POSE.ry = L[0] * g; POSE.rx = L[1] * g * .6;
    escribirPose(modo || 'lento');
    for (var i = 0; i < instancias.length; i++) instancias[i].mirar(L[0] * 7, -L[1] * 6);
    if (ms !== 0) tmrMiraLado = setTimeout(function () { regresar(false); }, ms || 2000);
    return true;
  }
  function regresar(rebote) {
    clearTimeout(tmrMiraLado);
    var habia = POSE.ry || POSE.rx;
    POSE.ry = 0; POSE.rx = 0;
    if (LAZO.estado !== 'buscando') for (var i = 0; i < instancias.length; i++) instancias[i].mirar(0, 0);
    escribirPose(habia ? (rebote ? 'rebote' : 'lento') : null);
  }
  // Regresa al frente con un rebote, como quien voltea a ver al que le habla.
  function voltear() { despertar(); regresar(true); return true; }
  function ladear(lado, ms) {
    despertar();
    var g = typeof lado === 'number' ? lado : (String(lado || '').toLowerCase().indexOf('izq') === 0 ? -9 : 9);
    POSE.rz = Math.max(-16, Math.min(16, g)); escribirPose();
    clearTimeout(tmrLadeo); tmrLadeo = setTimeout(function () { POSE.rz = 0; escribirPose(); }, ms || 1600);
    return true;
  }
  var MS_ANIM = { asentir: 760, negar: 900, salto: 560, bostezo: 2000 };
  function anim(nombre, veces) {
    ULT_ANIM = nombre;
    if (quieto) return true;
    var ms = MS_ANIM[nombre] || 700;
    for (var i = 0; i < instancias.length; i++) instancias[i].anim(nombre, ms);
    if (veces > 1) setTimeout(function () { anim(nombre, veces - 1); }, ms);
    return true;
  }
  function asentir(veces) { despertar(); return anim('asentir', Math.max(1, Math.min(3, veces || 1))); }
  function negar() { despertar(); return anim('negar', 1); }
  function guinar() {
    GUINOS++; ULT_GUINO = Date.now();
    for (var i = 0; i < instancias.length; i++) (function (I) { I.el.classList.add('cara-guino'); setTimeout(function () { I.el.classList.remove('cara-guino'); }, 240); })(instancias[i]);
    return true;
  }
  // El guiño: solo en 'contento', ~1 de cada 10, nunca con dinero ni errores, y no dos seguidos (20 s).
  var RE_DINERO = /\$\s?\d|\bd[oó]lares?\b|\bpag(o|a|ue|aste|ar)\b|adelanto|descuento|tarifa|\bdebe|cobr|monto|zelle|cheque|efectivo/i;
  function tocaGuino(n, op) {
    if (n !== 'contento') return false;
    op = op || {};
    if (op.dinero || op.error || op.guino === false) return false;
    if (RE_DINERO.test(String(op.texto || ''))) return false;
    if (Date.now() - ULT_GUINO < 20000) return false;
    return op.guino === true || azar() < .1;
  }
  function sorpresa(ms, luego, msLuego) {
    ms = ms || 900;
    gesto('sorprendido', ms); anim('salto', 1);
    if (luego) { clearTimeout(tmrGesto); tmrGesto = setTimeout(function () { gesto(luego, msLuego); }, ms); }
    return true;
  }
  // Sueño: tras 60 s en reposo sin nada, los ojos se entrecierran y bosteza de vez en cuando; cualquier cosa lo despierta.
  function armarSueno() {
    clearTimeout(tmrSueno);
    if (SUENO || GESTO || ESTADO_BASE !== 'reposo') return;
    tmrSueno = setTimeout(dormir, CFG.sueno);
  }
  function dormir() {
    if (GESTO || ESTADO_BASE !== 'reposo') return;
    SUENO = true; repintar(false); bostezar();
  }
  function bostezar() {
    clearTimeout(tmrBostezo);
    if (!SUENO) return;
    BOSTEZANDO = true; anim('bostezo', 1);
    var pasos = [.35, .7, 1, 1, 1, 1, 1, 1, .6, .3], k = 0;
    for (var i = 0; i < instancias.length; i++) instancias[i].ojosA('apretado', 'apretado');
    var tic = function () {
      if (!SUENO) { BOSTEZANDO = false; return; }
      if (k < pasos.length) { for (var j = 0; j < instancias.length; j++) instancias[j].bocaA('bostezo', pasos[k]); k++; tmrBostezo = setTimeout(tic, 150); return; }
      BOSTEZANDO = false; repintar(false);
      tmrBostezo = setTimeout(bostezar, 20000 + azar() * 15000);
    };
    tmrBostezo = setTimeout(tic, 120);
  }
  function despertar() {
    clearTimeout(tmrSueno);
    if (!SUENO) return false;
    SUENO = false; BOSTEZANDO = false; clearTimeout(tmrBostezo);
    return true;
  }
  // Lazos de buscar / lágrimas / apagado: por temporizador a 5-7 pasos por segundo (se ve "de LED") y
  // NO por animación CSS dentro del svg (WebKit repinta todo el dibujo a 60 fps: 27 % de CPU medido).
  var LAZO = { tmr: null, paso: 0, estado: null };
  // Buscando = pensar: primero mira ARRIBA, luego a un lado y al otro, arriba-derecha y de regreso.
  // [ojos dx, ojos dy (viewBox), cabeza ry, cabeza rx (grados), pasos de 160 ms]
  var BUSCAR_FASES = [[0, -9, 0, 7, 6], [-12, -3, -9, 2, 6], [12, -3, 9, 2, 6], [5, -8, 4, 6, 4], [0, 0, 0, 0, 2]];
  function lazo(e) {
    if (LAZO.estado === e && LAZO.tmr) return;
    clearInterval(LAZO.tmr); LAZO.tmr = null; LAZO.estado = e; LAZO.paso = 0;
    var i, k;
    for (i = 0; i < instancias.length; i++) { var I = instancias[i]; I.corre.style.opacity = ''; I.corre.style.transform = ''; for (k = 0; k < I.lagrimas.length; k++) { I.lagrimas[k].style.opacity = ''; I.lagrimas[k].style.transform = ''; } for (k = 0; k < I.capasLed.length; k++) I.capasLed[k].style.opacity = ''; I.capaOjos.style.transform = ''; if (I.oIzq.mira[0] || I.oIzq.mira[1]) I.pupila(0, 0); }
    if (LAZO.cabeza) { LAZO.cabeza = false; POSE.ry = 0; POSE.rx = 0; escribirPose(); }      // buscando movía la cabeza: regresa
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
          // al empezar cada fase: los ojos (capa HTML, con transición) y la cabeza van a su lugar; el brillo se corre
          // como pupila (un repintado por fase, no por paso)
          var fase = faseBuscar(p);
          if (fase) { I.mirar(fase[0], fase[1]); I.pupila(fase[0] * .45, fase[1] * .3); if (j === 0) { LAZO.cabeza = true; POSE.ry = fase[2]; POSE.rx = fase[3]; escribirPose(); } }
          I.corre.style.opacity = '.9'; I.corre.style.transform = 'translateX(' + ((p % 6 < 3 ? (p % 6) : 6 - (p % 6)) * 6 - 9) + 'px)';
        } else if (e === 'triste') {
          for (n = 0; n < 4; n++) { var f = ((p + (n % 2 ? 4 : 0)) % 9) / 8; I.lagrimas[n].style.opacity = f < .1 ? '0' : String((1 - f).toFixed(2)); I.lagrimas[n].style.transform = 'translateY(' + (f * 26).toFixed(1) + 'px)'; }
        } else if (e === 'sin_senal') {
          var o = [.28, .4, .6, .4][p % 4]; for (n = 0; n < I.capasLed.length; n++) I.capasLed[n].style.opacity = String(o);
        }
      }
    }, cada);
  }
  function faseBuscar(p) {
    var total = 0, i; for (i = 0; i < BUSCAR_FASES.length; i++) total += BUSCAR_FASES[i][4];
    var q = (p - 1) % total, acc = 0;
    for (i = 0; i < BUSCAR_FASES.length; i++) { if (q === acc) return BUSCAR_FASES[i]; acc += BUSCAR_FASES[i][4]; }
    return null;
  }
  function estado(nombre) {
    var n = normal(nombre); if (!n) return false;
    despertar();
    ESTADO_BASE = n;
    if (GESTO) { clearTimeout(tmrGesto); GESTO = null; }      // un estado nuevo cancela el gesto pasajero
    // escuchar o hablar con la cabeza volteada: regresa al frente con un rebote, como quien voltea a ver
    if ((n === 'escuchando' || n === 'hablando') && (POSE.ry || POSE.rx) && !LAZO.cabeza) regresar(true);
    repintar(false);
    if (n === 'exito') { entradaDoble(); asentir(1); }
    return true;
  }
  // op (opcional): {texto, dinero, error, guino} — solo decide el guiño de 'contento'.
  function gesto(nombre, ms, op) {
    var n = normal(nombre);
    despertar();
    if (!n || n === 'reposo') { if (GESTO) { clearTimeout(tmrGesto); GESTO = null; repintar(false); } return !!n; }
    clearTimeout(tmrGesto);
    GESTO = n; repintar(false);
    if (n === 'exito') { entradaDoble(); asentir(1); }
    if (tocaGuino(n, op)) { ULT_GUINO = Date.now(); GUINO_PEND++; setTimeout(guinar, 380); }
    tmrGesto = setTimeout(function () { GESTO = null; repintar(false); }, ms || MS_GESTO[n] || 1800);
    return true;
  }
  var GUINO_PEND = 0;
  function entradaDoble() { if (quieto) return; for (var i = 0; i < instancias.length; i++) instancias[i].parpadear(2); }
  // El nivel del micrófono llega ~15 veces/s: solo se escribe si cambió de verdad (≥ .03) y como mucho 20 veces/s.
  // MEDIDO (simulador, ronda 4): poner el nivel como variable CSS en la raíz .cara costaba 6-8 % de CPU, porque al
  // cambiar una variable heredada WebKit recalcula y REPINTA todos los svg de adentro aunque no la usen. Por eso el
  // nivel se escribe como opacity/transform en línea SOLO en las 6 capas HTML que lo usan (orejas, aros, luz, ondas).
  var NIVEL_ESCRITO = -1, NIVEL_T = 0;
  function pintarNivel(I, v) {
    var N = I.nv, k;
    if (!N) return;
    if (estadoVisible() !== 'escuchando') {
      if (!N.puesto) return;
      N.puesto = false;
      for (k = 0; k < N.cajas.length; k++) N.cajas[k].style.transform = '';
      for (k = 0; k < N.luces.length; k++) N.luces[k].style.opacity = '';
      for (k = 0; k < N.aros.length; k++) N.aros[k].style.opacity = '';
      for (k = 0; k < N.ondas.length; k++) N.ondas[k].style.opacity = '';
      if (N.halo) { N.halo.style.opacity = ''; N.halo.style.transform = ''; }
      return;
    }
    N.puesto = true;
    if (!quieto) for (k = 0; k < N.cajas.length; k++) N.cajas[k].style.transform = 'translateX(' + ((k === 0 ? -9 : 9) * v).toFixed(1) + '%) scale(' + (1.04 + .14 * v).toFixed(3) + ')';
    for (k = 0; k < N.luces.length; k++) N.luces[k].style.opacity = (.35 + .65 * v).toFixed(2);
    for (k = 0; k < N.aros.length; k++) N.aros[k].style.opacity = (.7 + .3 * v).toFixed(2);
    for (k = 0; k < N.ondas.length; k++) N.ondas[k].style.opacity = (.45 + .55 * v).toFixed(2);
    if (N.halo) { N.halo.style.opacity = (.65 + .35 * v).toFixed(2); if (!quieto) N.halo.style.transform = 'translate(-50%,-50%) scale(' + (1.15 + .8 * v).toFixed(3) + ')'; }
  }
  function nivel(v) {
    v = Math.max(0, Math.min(1, +v || 0)); NIVEL = v;
    if (v > .1 && despertar()) repintar(false);
    if (v > .15 && (POSE.ry || POSE.rx) && !LAZO.cabeza && estadoVisible() === 'escuchando') regresar(true);
    var ahora = Date.now();
    if (Math.abs(v - NIVEL_ESCRITO) < .03 && v !== 0) return;
    if (ahora - NIVEL_T < 50 && v !== 0) return;
    NIVEL_ESCRITO = v; NIVEL_T = ahora;
    for (var i = 0; i < instancias.length; i++) pintarNivel(instancias[i], v);
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
    // en reposo, cada 5-9 s: la mitad de las veces voltea la cabeza 10-18° a un lado (y regresa sola), las otras
    // solo mira con los ojos a un punto al azar. Todo por transiciones del compositor.
    if (d && d.mira) tmrMirada = setTimeout(function () {
      if (hayDOM && document.hidden) { programarParpadeo(); return; }
      var r = azar();
      if (r < .5) mirarLado(azar() < .5 ? 'izq' : 'der', 1500 + azar() * 1700, 10 + azar() * 8, 'lento');
      else if (r < .58) mirarLado('arriba', 1200, 8, 'lento');
      else {
        var dx = (azar() < .5 ? -1 : 1) * (4 + azar() * 6), dy = (azar() - .5) * 5;
        for (var i = 0; i < instancias.length; i++) instancias[i].mirar(+dx.toFixed(1), +dy.toFixed(1));
        setTimeout(function () { if (!POSE.ry && !POSE.rx) for (var i = 0; i < instancias.length; i++) instancias[i].mirar(0, 0); }, 900 + azar() * 700);
      }
      programarParpadeo();
    }, 5000 + azar() * 4000);
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
      asentir: asentir, negar: negar, ladear: ladear, mirar: mirarLado, voltear: voltear, guinar: guinar, sorpresa: sorpresa,
      encender: function () { if (el.__cara) el.__cara.encender(); },
      desmontar: function () { desmontar(el); }
    };
  }
  function desmontar(el) {
    if (!el || !el.__cara) return false;
    var i = instancias.indexOf(el.__cara); if (i >= 0) instancias.splice(i, 1);
    clearTimeout(el.__cara.tmrAnim);
    el.innerHTML = ''; el.classList.remove('cara', 'cara-chica', 'cara-quieta', 'cara-cerrando', 'cara-apagada', 'cara-rebote', 'cara-lento', 'cara-guino'); el.removeAttribute('data-estado'); el.removeAttribute('data-silueta');
    delete el.__cara;
    if (!instancias.length) { clearTimeout(tmrParpadeo); clearTimeout(tmrMirada); clearTimeout(tmrMiraLado); clearTimeout(tmrBostezo); clearInterval(LAZO.tmr); LAZO.tmr = null; if (HABLA.on) habla(false); }
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
    asentir: asentir, negar: negar, ladear: ladear, mirar: mirarLado, voltear: voltear, guinar: guinar, sorpresa: sorpresa,
    config: function (c) { c = c || {}; if (c.sueno) CFG.sueno = +c.sueno; if (typeof c.azar === 'function') CFG.azar = c.azar; if (c.azar === null) CFG.azar = Math.random; if (c.reiniciarGuino) ULT_GUINO = -1e9; armarSueno(); return { sueno: CFG.sueno }; },
    actual: function () { var t = poseTotal(); return { base: ESTADO_BASE, gesto: GESTO, visible: estadoVisible(), nivel: NIVEL, hablando: HABLA.on, instancias: instancias.length,
      pose: { ry: POSE.ry, rx: POSE.rx, rz: POSE.rz, bx: POSE.bx, bz: POSE.bz, total: t }, sueno: SUENO, guinos: GUINO_PEND, ultimoAnim: ULT_ANIM, ultimoModo: MODO.ult }; },
    ESTADOS: PUBLICOS.slice(), GESTOS_MODELO: GESTOS_MODELO, COLORES: ['celeste', 'menta', 'ambar', 'violeta'], SILUETAS: ['A', 'B']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cara;
  if (raiz) raiz.Cara = Cara;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
