/* =========================================================
   Registro de Inventarios — lógica principal
   Almacenamiento: localStorage (clave registroInventarios.v1)
   ========================================================= */
'use strict';

var APP_VERSION = '1.0.0';
var LS_KEY = 'registroInventarios.v1';

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

/* ---------------- Estado ---------------- */
var state = {
  products: [],   // {id, nombreSistema, codigo, nombreComercial, categoria, bodega, orden, barcode}
  orders: {},     // { bodega: [id, id, ...] }
  records: [],    // { id, ts, date, time, bodega, items: { pid: {c,t,u} } }
  draft: { date: '', values: {} },
  settings: { theme: 'auto' }
};

var ui = {
  catsIngreso: [], bodegaIngreso: '',
  catsCamara: [],  bodegaCamara: '',
  catsHist: [],    bodegaHist: '', tipoHist: 'diario',
  catsCod: [],     bodegaCod: '',
  formato: 'json'
};

var prevCache = new Map();
var saveTimer = null;

/* ---------------- Persistencia ---------------- */
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Almacenamiento lleno. Exporta un respaldo y libera espacio.', 'error');
  }
}
function saveStateDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { saveTimer = null; saveState(); }, 350);
}
function loadState() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    var o = JSON.parse(raw) || {};
    state.products = o.products || [];
    state.orders = o.orders || {};
    state.records = o.records || [];
    state.draft = o.draft || { date: '', values: {} };
    state.settings = Object.assign({ theme: 'auto' }, o.settings || {});
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- Utilidades ---------------- */
function num(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayISO() { return isoOf(new Date()); }
function timeNow() {
  var d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function fmtDate(iso) {
  if (!iso) return '—';
  var p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function toast(msg, type) {
  var box = $('#toasts');
  if (!box) return;
  var el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { el.remove(); }, 320);
  }, 3800);
}
function download(filename, content, mime) {
  var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
}

/* ---------------- Productos ---------------- */
function allCategories() {
  var set = {};
  state.products.forEach(function (p) { set[p.categoria] = 1; });
  return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}
function allBodegas() {
  var set = {};
  state.products.forEach(function (p) { set[p.bodega] = 1; });
  return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}
function productById(id) {
  for (var i = 0; i < state.products.length; i++) if (state.products[i].id === id) return state.products[i];
  return null;
}
function orderedProducts(bodega, cats) {
  var list = state.products.filter(function (p) {
    if (cats && cats.length && cats.indexOf(p.categoria) === -1) return false;
    if (bodega && p.bodega !== bodega) return false;
    return true;
  });
  var ord = state.orders[bodega || ''] || [];
  var idx = new Map();
  ord.forEach(function (id, i) { idx.set(id, i); });
  list.sort(function (a, b) {
    var ia = idx.has(a.id) ? idx.get(a.id) : Infinity;
    var ib = idx.has(b.id) ? idx.get(b.id) : Infinity;
    if (ia !== ib) return ia - ib;
    if ((a.orden || 0) !== (b.orden || 0)) return (a.orden || 0) - (b.orden || 0);
    return String(a.nombreComercial).localeCompare(String(b.nombreComercial), 'es');
  });
  return list;
}

/* ---------------- CSV de productos ---------------- */
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  var firstLine = text.split(/\r?\n/)[0] || '';
  var semi = firstLine.split(';').length;
  var coma = firstLine.split(',').length;
  var delim = semi >= coma ? ';' : ',';

  var rows = [], row = [], cur = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
      else if (ch === '\r') { /* ignorar */ }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
}

function importProductsCSV(text) {
  var rows = parseCSV(text);
  if (!rows.length) throw new Error('El archivo está vacío.');

  var head = rows[0].join(' ').toLowerCase();
  var start = (head.indexOf('nombre') !== -1 || head.indexOf('categor') !== -1) ? 1 : 0;

  function clean(v) {
    v = String(v == null ? '' : v).trim();
    return (v === '' || v.toLowerCase() === 'null') ? '' : v;
  }

  var prods = [];
  for (var i = start; i < rows.length; i++) {
    var r = rows[i];
    var nombreSistema = clean(r[0]);
    var codigo = clean(r[1]);
    var nombreComercial = clean(r[2]);
    var categoria = clean(r[3]) || 'Sin categoría';
    var bodega = clean(r[4]) || 'Sin bodega';
    var orden = num(clean(r[5]));
    if (!nombreComercial && !nombreSistema) continue;

    var id = codigo ? 'c:' + codigo : 'n:' + slug(nombreComercial || nombreSistema);
    prods.push({
      id: id,
      nombreSistema: nombreSistema || nombreComercial,
      codigo: codigo,
      nombreComercial: nombreComercial || nombreSistema,
      categoria: categoria,
      bodega: bodega,
      orden: orden,
      barcode: ''
    });
  }
  if (!prods.length) throw new Error('No se encontraron productos válidos en el CSV.');

  // conservar códigos de barras ya registrados
  var oldBarcode = new Map();
  state.products.forEach(function (p) { if (p.barcode) oldBarcode.set(p.id, p.barcode); });
  prods.forEach(function (p) {
    if (!oldBarcode.has(p.id)) return;
    p.barcode = oldBarcode.get(p.id);
  });

  // conservar orden guardado (solo ids que sigan existiendo)
  var validIds = new Map();
  prods.forEach(function (p) { validIds.set(p.id, 1); });
  Object.keys(state.orders).forEach(function (k) {
    state.orders[k] = state.orders[k].filter(function (id) { return validIds.has(id); });
  });

  state.products = prods;
  prevCache.clear();
  saveState();
  renderAll();
  return prods.length;
}

/* ---------------- Registros / diferencias ---------------- */
function sortRecords() {
  state.records.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
}
function prevValues(pid) {
  if (prevCache.has(pid)) return prevCache.get(pid);
  var v = null;
  for (var i = state.records.length - 1; i >= 0; i--) {
    var it = state.records[i].items[pid];
    if (it) { v = it; break; }
  }
  prevCache.set(pid, v);
  return v;
}
function previousItemBefore(pid, ts) {
  for (var i = state.records.length - 1; i >= 0; i--) {
    var r = state.records[i];
    if ((r.ts || 0) >= ts) continue;
    if (r.items[pid]) return r.items[pid];
  }
  return null;
}
function lastRecordForBodega(bodega) {
  for (var i = state.records.length - 1; i >= 0; i--) {
    if ((state.records[i].bodega || '') === (bodega || '')) return state.records[i];
  }
  return null;
}

/* ---------------- Valores del borrador ---------------- */
function getVal(pid) {
  var v = state.draft.values[pid];
  if (!v) return { c: '', t: '', u: '' };
  return { c: v.c == null ? '' : v.c, t: v.t == null ? '' : v.t, u: v.u == null ? '' : v.u };
}

/* ---------------- Render: chips y selects ---------------- */
function renderChips(cont, items, selected, onChange) {
  if (!cont) return;
  cont.innerHTML = '';
  var all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip' + (selected.length === 0 ? ' active' : '');
  all.textContent = 'Todas';
  all.onclick = function () { onChange([]); };
  cont.appendChild(all);

  items.forEach(function (it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (selected.indexOf(it) !== -1 ? ' active' : '');
    b.textContent = it;
    b.onclick = function () {
      var i = selected.indexOf(it);
      if (i >= 0) selected.splice(i, 1); else selected.push(it);
      onChange(selected);
    };
    cont.appendChild(b);
  });
}
function fillBodega(sel, value, onChange) {
  if (!sel) return;
  var bodegas = allBodegas();
  sel.innerHTML = '';
  var o0 = document.createElement('option');
  o0.value = ''; o0.textContent = 'Todas las bodegas';
  sel.appendChild(o0);
  bodegas.forEach(function (b) {
    var o = document.createElement('option');
    o.value = b; o.textContent = b;
    sel.appendChild(o);
  });
  sel.value = bodegas.indexOf(value) !== -1 ? value : '';
  sel.onchange = function () { onChange(sel.value); };
}

/* ---------------- Render: filas de inventario ---------------- */
function difCell(prev, f, cur) {
  if (!prev) return { txt: '—', cls: '' };
  var d = num(prev[f]) - num(cur);
  return { txt: String(d), cls: d > 0 ? 'pos' : (d < 0 ? 'neg' : '') };
}

function rowInventario(p) {
  var v = getVal(p.id);
  var prev = prevValues(p.id);
  var dc = difCell(prev, 'c', v.c);
  var dt = difCell(prev, 't', v.t);
  var du = difCell(prev, 'u', v.u);

  var row = document.createElement('div');
  row.className = 'prow';
  row.dataset.pid = p.id;
  row.innerHTML =
    '<div class="prow-top">' +
      '<div class="ord">' +
        '<button type="button" class="icon-btn" data-act="up" title="Subir">▲</button>' +
        '<button type="button" class="icon-btn" data-act="down" title="Bajar">▼</button>' +
      '</div>' +
      '<div class="pname">' +
        '<span class="ns">' + esc(p.nombreSistema) + '</span>' +
        '<span class="nc">' + esc(p.nombreComercial) + '</span>' +
        (p.codigo ? '<span class="cod">Cód. ' + esc(p.codigo) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="prow-inputs">' +
      '<label class="qty"><span>Cajas</span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-f="c" value="' + esc(v.c) + '"></label>' +
      '<label class="qty"><span>Tiras/Paq.</span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-f="t" value="' + esc(v.t) + '"></label>' +
      '<label class="qty"><span>Unidades</span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-f="u" value="' + esc(v.u) + '"></label>' +
      '<div class="diffs" title="Diferencia vs. último registro">' +
        '<span class="dif ' + dc.cls + '" data-d="c">' + dc.txt + '</span>' +
        '<span class="dif ' + dt.cls + '" data-d="t">' + dt.txt + '</span>' +
        '<span class="dif ' + du.cls + '" data-d="u">' + du.txt + '</span>' +
      '</div>' +
    '</div>';
  return row;
}

function updateRowDiff(pid) {
  var row = document.querySelector('.prow[data-pid="' + pid + '"]');
  if (!row) return;
  var prev = prevValues(pid);
  var v = getVal(pid);
  ['c', 't', 'u'].forEach(function (f) {
    var cell = row.querySelector('.dif[data-d="' + f + '"]');
    if (!cell) return;
    var r = difCell(prev, f, v[f]);
    cell.textContent = r.txt;
    cell.className = 'dif ' + r.cls;
  });
}

/* ---------------- Render: pestañas 1 y 2 ---------------- */
function renderInv(scope) {
  var cfg = scope === 'camara'
    ? { cats: '#catsCamara', bod: '#bodegaCamara', list: '#listCamara',
        sel: ui.catsCamara, bodv: ui.bodegaCamara,
        setCats: function (v) { ui.catsCamara = v; }, setBod: function (v) { ui.bodegaCamara = v; } }
    : { cats: '#catsIngreso', bod: '#bodegaIngreso', list: '#listIngreso',
        sel: ui.catsIngreso, bodv: ui.bodegaIngreso,
        setCats: function (v) { ui.catsIngreso = v; }, setBod: function (v) { ui.bodegaIngreso = v; } };

  renderChips($(cfg.cats), allCategories(), cfg.sel, function (v) { cfg.setCats(v); renderInv(scope); });
  fillBodega($(cfg.bod), cfg.bodv, function (v) { cfg.setBod(v); renderInv(scope); });

  var cont = $(cfg.list);
  if (!cont) return;
  cont.innerHTML = '';

  if (!state.products.length) {
    cont.innerHTML = '<p class="empty">No hay productos cargados.<br>Carga un archivo CSV para comenzar.</p>';
    updateStats();
    return;
  }

  var prods = orderedProducts(cfg.bodv, cfg.sel);
  if (!prods.length) {
    cont.innerHTML = '<p class="empty">No hay productos con los filtros seleccionados.</p>';
    updateStats();
    return;
  }

  var frag = document.createDocumentFragment();
  prods.forEach(function (p) { frag.appendChild(rowInventario(p)); });
  cont.appendChild(frag);
  updateStats();
}

/* ---------------- Render: pestaña 3 (histórico) ---------------- */
function periodRange() {
  var t = ui.tipoHist;
  if (t === 'diario') {
    var v = $('#fechaDia').value;
    if (!v) return null;
    return [v, v];
  }
  if (t === 'semanal') {
    var w = $('#fechaSemana').value; // 2026-W34
    if (!w) return null;
    var parts = w.split('-W');
    var y = parseInt(parts[0], 10), wn = parseInt(parts[1], 10);
    if (!y || !wn) return null;
    var jan4 = new Date(y, 0, 4);
    var dow = (jan4.getDay() + 6) % 7;
    var mon = new Date(jan4.getFullYear(), jan4.getMonth(), jan4.getDate() - dow + (wn - 1) * 7);
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return [isoOf(mon), isoOf(sun)];
  }
  if (t === 'mensual') {
    var m = $('#fechaMes').value; // 2026-08
    if (!m) return null;
    var pm = m.split('-');
    var yy = parseInt(pm[0], 10), mm = parseInt(pm[1], 10);
    var first = new Date(yy, mm - 1, 1);
    var last = new Date(yy, mm, 0);
    return [isoOf(first), isoOf(last)];
  }
  if (t === 'anual') {
    var a = $('#fechaAnio').value;
    if (!a) return null;
    return [a + '-01-01', a + '-12-31'];
  }
  return null;
}

function recordsInRange(from, to, cats, bodega) {
  return state.records.filter(function (r) {
    if (r.date < from || r.date > to) return false;
    if (bodega && (r.bodega || '') !== bodega) return false;
    if (cats && cats.length) {
      var ok = Object.keys(r.items).some(function (pid) {
        var p = productById(pid);
        return p && cats.indexOf(p.categoria) !== -1;
      });
      if (!ok) return false;
    }
    return true;
  });
}

function renderHist() {
  renderChips($('#catsHist'), allCategories(), ui.catsHist, function (v) { ui.catsHist = v; renderHist(); });
  fillBodega($('#bodegaHist'), ui.bodegaHist, function (v) { ui.bodegaHist = v; renderHist(); });

  var cont = $('#histList');
  var summary = $('#histSummary');
  if (!cont) return;
  cont.innerHTML = '';

  var range = periodRange();
  if (!range) { summary.textContent = 'Selecciona un periodo.'; return; }

  var recs = recordsInRange(range[0], range[1], ui.catsHist, ui.bodegaHist);
  if (!recs.length) {
    summary.textContent = 'Sin registros entre ' + fmtDate(range[0]) + ' y ' + fmtDate(range[1]) + '.';
    return;
  }

  var startTs = new Date(range[0] + 'T00:00:00').getTime();

  // productos involucrados
  var pids = [];
  var seen = {};
  recs.forEach(function (r) {
    Object.keys(r.items).forEach(function (pid) { if (!seen[pid]) { seen[pid] = 1; pids.push(pid); } });
  });

  var list = pids.map(function (pid) { return productById(pid); })
    .filter(function (p) {
      if (!p) return false;
      if (ui.catsHist.length && ui.catsHist.indexOf(p.categoria) === -1) return false;
      if (ui.bodegaHist && p.bodega !== ui.bodegaHist) return false;
      return true;
    });

  if (!list.length) { summary.textContent = 'Sin productos con esos filtros en el periodo.'; return; }

  var orderIdx = new Map();
  (state.orders[ui.bodegaHist || ''] || []).forEach(function (id, i) { orderIdx.set(id, i); });
  list.sort(function (a, b) {
    var ia = orderIdx.has(a.id) ? orderIdx.get(a.id) : Infinity;
    var ib = orderIdx.has(b.id) ? orderIdx.get(b.id) : Infinity;
    if (ia !== ib) return ia - ib;
    return String(a.nombreComercial).localeCompare(String(b.nombreComercial), 'es');
  });

  var total = 0;
  var html = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Producto</th><th>Cajas</th><th>Tiras</th><th>Unid.</th>' +
    '<th>Δ Cajas</th><th>Δ Tiras</th><th>Δ Unid.</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (p) {
    var last = null, lastTs = 0;
    for (var i = recs.length - 1; i >= 0; i--) {
      var it = recs[i].items[p.id];
      if (it) { last = it; lastTs = recs[i].ts; break; }
    }
    if (!last) return;
    var prev = previousItemBefore(p.id, startTs);
    var dc = prev ? (num(prev.c) - num(last.c)) : null;
    var dt = prev ? (num(prev.t) - num(last.t)) : null;
    var du = prev ? (num(prev.u) - num(last.u)) : null;
    total += num(last.c) + num(last.t) + num(last.u);

    function d(v) {
      if (v === null) return '<td>—</td>';
      return '<td class="' + (v > 0 ? 'd-pos' : (v < 0 ? 'd-neg' : '')) + '">' + v + '</td>';
    }

    html += '<tr>' +
      '<td><strong>' + esc(p.nombreSistema) + '</strong><br><small>' + esc(p.nombreComercial) + '</small></td>' +
      '<td>' + num(last.c) + '</td><td>' + num(last.t) + '</td><td>' + num(last.u) + '</td>' +
      d(dc) + d(dt) + d(du) +
      '</tr>';
  });

  html += '</tbody></table></div>';
  cont.innerHTML = html;
  summary.textContent = recs.length + ' registro(s) · ' + list.length + ' producto(s) · ' +
    'periodo ' + fmtDate(range[0]) + ' → ' + fmtDate(range[1]) + ' · total ' + total + ' unidades';
}

/* ---------------- Render: pestaña 4 (códigos) ---------------- */
function renderCod() {
  renderChips($('#catsCod'), allCategories(), ui.catsCod, function (v) { ui.catsCod = v; renderCod(); });
  fillBodega($('#bodegaCod'), ui.bodegaCod, function (v) { ui.bodegaCod = v; renderCod(); });

  var cont = $('#listCod');
  if (!cont) return;
  cont.innerHTML = '';

  if (!state.products.length) {
    cont.innerHTML = '<p class="empty">No hay productos cargados.</p>';
    return;
  }

  var prods = orderedProducts(ui.bodegaCod, ui.catsCod);
  if (!prods.length) { cont.innerHTML = '<p class="empty">No hay productos con esos filtros.</p>'; return; }

  var frag = document.createDocumentFragment();
  prods.forEach(function (p) {
    var row = document.createElement('div');
    row.className = 'prow';
    row.dataset.pid = p.id;
    var code = p.barcode || '';
    row.innerHTML =
      '<div class="prow-top">' +
        '<div class="pname">' +
          '<span class="ns">' + esc(p.nombreSistema) + '</span>' +
          '<span class="nc">' + esc(p.nombreComercial) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="prow-inputs">' +
        (code
          ? '<span class="bcode">' + esc(code) + '</span>' +
            '<button type="button" class="btn" data-act="scan">Cambiar</button>'
          : '<span class="hint" style="margin:0">Sin código</span>' +
            '<button type="button" class="btn btn-primary" data-act="scan">Escanear</button>') +
        '<button type="button" class="btn" data-act="manual">Manual</button>' +
        (code ? '<button type="button" class="btn" data-act="clear">Quitar</button>' : '') +
      '</div>';
    frag.appendChild(row);
  });
  cont.appendChild(frag);
}

/* ---------------- Stats / tema ---------------- */
function updateStats() {
  var sub = $('#headerSub');
  if (!sub) return;
  var last = state.records.length ? state.records[state.records.length - 1] : null;
  sub.textContent = state.products.length + ' productos · ' +
    state.records.length + ' registro(s)' +
    (last ? ' · último: ' + fmtDate(last.date) + ' ' + (last.time || '') : '');
  var info = $('#csvInfo');
  if (info) {
    info.textContent = state.products.length
      ? state.products.length + ' productos cargados'
      : 'Sin productos cargados.';
  }
  var ver = $('#appVersion');
  if (ver) ver.textContent = 'Registro de Inventarios · v' + APP_VERSION;
}

function applyTheme() {
  var t = state.settings.theme || 'auto';
  var dark = t === 'dark' ||
    (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var btn = $('#btnTheme');
  if (btn) btn.textContent = dark ? 'Claro' : 'Oscuro';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e1420' : '#1f4e79');
}

/* ---------------- Guardar registro ---------------- */
function guardarInventario(scope) {
  var cats = scope === 'camara' ? ui.catsCamara : ui.catsIngreso;
  var bod = scope === 'camara' ? ui.bodegaCamara : ui.bodegaIngreso;

  var prods = orderedProducts(bod, cats);
  if (!prods.length) { toast('No hay productos para guardar.', 'warn'); return; }

  var items = {};
  var sinDatos = [];
  var totalNow = 0;

  prods.forEach(function (p) {
    var v = getVal(p.id);
    var c = num(v.c), t = num(v.t), u = num(v.u);
    items[p.id] = { c: c, t: t, u: u };
    totalNow += c + t + u;
    if (c === 0 && t === 0 && u === 0) sinDatos.push(p);
  });

  var lastRec = lastRecordForBodega(bod);
  var totalPrev = null;
  if (lastRec) {
    totalPrev = 0;
    Object.keys(lastRec.items).forEach(function (pid) {
      var it = lastRec.items[pid];
      totalPrev += num(it.c) + num(it.t) + num(it.u);
    });
  }

  var avisos = [];
  if (sinDatos.length) {
    avisos.push('• ' + sinDatos.length + ' producto(s) sin ningún dato.');
  }
  if (totalPrev !== null && totalPrev !== totalNow) {
    avisos.push('• El total (' + totalNow + ') es ' +
      (totalNow < totalPrev ? 'MENOR' : 'MAYOR') +
      ' que el del último registro (' + totalPrev + ') del ' +
      fmtDate(lastRec.date) + ' ' + (lastRec.time || '') + '.');
  }
  if (avisos.length) {
    if (!confirm('Avisos antes de guardar:\n\n' + avisos.join('\n') +
      '\n\nEstas alertas son informativas. ¿Deseas guardar de todas formas?')) return;
  }

  var rec = {
    id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    date: todayISO(),
    time: timeNow(),
    bodega: bod || '',
    items: items
  };
  state.records.push(rec);
  sortRecords();
  prevCache.clear();
  saveState();

  // resaltar productos sin registro (temporal)
  if (sinDatos.length) {
    sinDatos.forEach(function (p) {
      var row = document.querySelector('.prow[data-pid="' + p.id + '"]');
      if (row) {
        row.classList.add('sin-registro');
        setTimeout(function () { row.classList.remove('sin-registro'); }, 4500);
      }
    });
  }

  renderInv('ingreso');
  renderInv('camara');
  toast('Registro guardado: ' + prods.length + ' productos, ' + totalNow + ' unidades.');
}

/* ---------------- Reportes ---------------- */
function rowsFromRecords(recs) {
  var rows = [];
  recs.forEach(function (r) {
    Object.keys(r.items).forEach(function (pid) {
      var it = r.items[pid];
      var p = productById(pid);
      var prev = previousItemBefore(pid, r.ts);
      rows.push({
        fecha: r.date,
        hora: r.time || '',
        bodega: r.bodega || '',
        categoria: p ? p.categoria : '',
        codigo: p ? p.codigo : '',
        nombre_sistema: p ? p.nombreSistema : '',
        nombre_comercial: p ? p.nombreComercial : pid,
        cajas: num(it.c),
        tiras: num(it.t),
        unidades: num(it.u),
        dif_cajas: prev ? num(prev.c) - num(it.c) : '',
        dif_tiras: prev ? num(prev.t) - num(it.t) : '',
        dif_unidades: prev ? num(prev.u) - num(it.u) : ''
      });
    });
  });
  return rows;
}
function rowsToCSV(rows) {
  if (!rows.length) return '';
  var headers = Object.keys(rows[0]);
  function cell(v) {
    var s = String(v == null ? '' : v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var out = [headers.join(';')];
  rows.forEach(function (r) {
    out.push(headers.map(function (h) { return cell(r[h]); }).join(';'));
  });
  return '\uFEFF' + out.join('\r\n');
}
function rowsToTXT(rows, title) {
  if (!rows.length) return title + '\r\n\r\n(sin registros)\r\n';
  var headers = Object.keys(rows[0]);
  var lines = [title, new Array(title.length + 1).join('='), ''];
  lines.push(headers.join('\t'));
  rows.forEach(function (r) {
    lines.push(headers.map(function (h) { return r[h]; }).join('\t'));
  });
  return lines.join('\r\n');
}

function exportDiario() {
  var rows = rowsFromRecords(state.records.filter(function (r) { return r.date === todayISO(); }));
  if (!rows.length) { toast('No hay registros guardados hoy.', 'warn'); return; }
  var name = 'reporte-diario-' + todayISO();
  if (ui.formato === 'json') {
    download(name + '.json', JSON.stringify({
      app: 'registro-inventarios', version: APP_VERSION, tipo: 'diario',
      fecha: todayISO(), generado: new Date().toISOString(), registros: rows
    }, null, 2), 'application/json');
  } else if (ui.formato === 'csv') {
    download(name + '.csv', rowsToCSV(rows), 'text/csv;charset=utf-8');
  } else {
    download(name + '.txt', rowsToTXT(rows, 'Reporte diario ' + fmtDate(todayISO())), 'text/plain;charset=utf-8');
  }
  toast('Reporte diario generado (' + ui.formato.toUpperCase() + ').');
}

function exportHistorico() {
  var name = 'reporte-historico-' + todayISO();
  if (ui.formato === 'json') {
    var backup = {
      app: 'registro-inventarios',
      version: APP_VERSION,
      tipo: 'respaldo',
      exportedAt: new Date().toISOString(),
      products: state.products,
      orders: state.orders,
      records: state.records
    };
    download(name + '.json', JSON.stringify(backup, null, 2), 'application/json');
  } else {
    var rows = rowsFromRecords(state.records);
    if (!rows.length) { toast('No hay registros para exportar.', 'warn'); return; }
    if (ui.formato === 'csv') download(name + '.csv', rowsToCSV(rows), 'text/csv;charset=utf-8');
    else download(name + '.txt', rowsToTXT(rows, 'Reporte histórico'), 'text/plain;charset=utf-8');
  }
  toast('Respaldo generado (incluye orden y códigos de barras si es JSON).');
}

function importarHistorico(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var obj = JSON.parse(String(reader.result));
      if (!obj || !Array.isArray(obj.records)) throw new Error('El archivo no tiene la estructura esperada (falta "records").');

      var nRec = obj.records.length;
      var nProd = (obj.products || []).length;
      if (!confirm('Se importarán ' + nRec + ' registros y ' + nProd + ' productos.\n¿Continuar?')) return;

      var byId = new Map();
      state.products.forEach(function (p) { byId.set(p.id, p); });
      (obj.products || []).forEach(function (p) {
        if (!p || !p.id) return;
        var ex = byId.get(p.id);
        if (ex) {
          if (p.barcode) ex.barcode = p.barcode;
          if (p.orden) ex.orden = p.orden;
        } else {
          state.products.push(p);
          byId.set(p.id, p);
        }
      });

      Object.keys(obj.orders || {}).forEach(function (k) {
        if (Array.isArray(obj.orders[k])) state.orders[k] = obj.orders[k];
      });

      var rids = new Set();
      state.records.forEach(function (r) { rids.add(r.id); });
      var added = 0;
      obj.records.forEach(function (r) {
        if (!r || !r.id || rids.has(r.id)) return;
        if (!r.items) r.items = {};
        state.records.push(r);
        rids.add(r.id);
        added++;
      });

      sortRecords();
      prevCache.clear();
      saveState();
      renderAll();
      toast('Importación completa: ' + added + ' registros nuevos.');
    } catch (err) {
      toast('Error al importar: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/* ---------------- Eventos de listas ---------------- */
function onInvInput(e) {
  var inp = e.target.closest ? e.target.closest('input[data-f]') : null;
  if (!inp) return;
  var row = inp.closest('.prow');
  if (!row) return;
  var list = row.closest('.product-list');
  if (!list || (list.id !== 'listIngreso' && list.id !== 'listCamara')) return;

  var pid = row.dataset.pid;
  var f = inp.dataset.f;
  if (!state.draft.values[pid]) state.draft.values[pid] = { c: '', t: '', u: '' };
  state.draft.values[pid][f] = inp.value;
  state.draft.date = todayISO();

  updateRowDiff(pid);
  saveStateDebounced();
}

function onInvClick(e) {
  var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
  if (!btn) return;
  var row = btn.closest('.prow');
  if (!row) return;
  var list = row.closest('.product-list');
  if (!list || (list.id !== 'listIngreso' && list.id !== 'listCamara')) return;

  var act = btn.dataset.act;
  if (act !== 'up' && act !== 'down') return;

  var ids = $$('.prow', list).map(function (r) { return r.dataset.pid; });
  var pid = row.dataset.pid;
  var i = ids.indexOf(pid);
  var j = i + (act === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= ids.length) return;
  moveProduct(pid, ids[j]);
}

function moveProduct(idA, idB) {
  var pa = productById(idA), pb = productById(idB);
  if (!pa || !pb) return;
  if (pa.bodega !== pb.bodega) return; // no mezclar bodegas

  var full = orderedProducts(pa.bodega, []).map(function (p) { return p.id; });
  var a = full.indexOf(idA), b = full.indexOf(idB);
  if (a < 0 || b < 0) return;
  var tmp = full[a]; full[a] = full[b]; full[b] = tmp;
  state.orders[pa.bodega] = full;
  saveState();
  renderInv('ingreso');
  renderInv('camara');
  renderCod();
}

/* ---------------- Eventos pestaña 4 ---------------- */
function onCodClick(e) {
  var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
  if (!btn) return;
  var row = btn.closest('.prow');
  if (!row) return;
  var list = row.closest('.product-list');
  if (!list || list.id !== 'listCod') return;

  var p = productById(row.dataset.pid);
  if (!p) return;
  var act = btn.dataset.act;

  if (act === 'scan') {
    if (!window.BarcodeScanner) { toast('Escáner no disponible.', 'error'); return; }
    window.BarcodeScanner.open(function (code) {
      p.barcode = String(code).trim();
      saveState();
      renderCod();
      toast('Código asignado a ' + p.nombreComercial + ': ' + p.barcode);
    });
  } else if (act === 'manual') {
    var val = prompt('Código de barras para:\n' + p.nombreComercial, p.barcode || '');
    if (val === null) return;
    p.barcode = String(val).trim();
    saveState();
    renderCod();
    toast(p.barcode ? 'Código guardado.' : 'Código eliminado.');
  } else if (act === 'clear') {
    if (!confirm('¿Quitar el código de barras de ' + p.nombreComercial + '?')) return;
    p.barcode = '';
    saveState();
    renderCod();
    toast('Código eliminado.');
  }
}

/* ---------------- Escaneo en pestaña 2 ---------------- */
function escanearParaInventario() {
  if (!window.BarcodeScanner) { toast('Escáner no disponible.', 'error'); return; }
  window.BarcodeScanner.open(function (code) {
    var found = null;
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].barcode && state.products[i].barcode === code) { found = state.products[i]; break; }
    }
    if (!found) {
      toast('Código ' + code + ' no está registrado en ningún producto.', 'warn');
      return;
    }
    var row = document.querySelector('#listCamara .prow[data-pid="' + found.id + '"]');
    if (!row) {
      toast('"' + found.nombreComercial + '" no está en los filtros actuales.', 'warn');
      return;
    }
    row.classList.add('flash');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var inp = row.querySelector('input[data-f="c"]');
    if (inp) { inp.focus(); inp.select(); }
    setTimeout(function () { row.classList.remove('flash'); }, 2500);
    toast(found.nombreComercial + ' · ' + code);
  });
}

/* ---------------- Render global ---------------- */
function renderAll() {
  renderInv('ingreso');
  renderInv('camara');
  renderHist();
  renderCod();
  updateStats();
}

/* ---------------- Fechas por defecto ---------------- */
function setDefaultDates() {
  var d = new Date();
  var dia = $('#fechaDia'), sem = $('#fechaSemana'), mes = $('#fechaMes'), anio = $('#fechaAnio');
  if (dia) dia.value = todayISO();
  if (mes) mes.value = d.getFullYear() + '-' + pad(d.getMonth() + 1);
  if (anio) anio.value = d.getFullYear();
  if (sem) {
    // semana ISO aproximada
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    sem.value = t.getUTCFullYear() + '-W' + pad(weekNo);
  }
}

function switchPeriodInput() {
  var t = ui.tipoHist;
  $('#fechaDia').hidden = t !== 'diario';
  $('#fechaSemana').hidden = t !== 'semanal';
  $('#fechaMes').hidden = t !== 'mensual';
  $('#fechaAnio').hidden = t !== 'anual';
}

/* ---------------- Pestañas ---------------- */
function bindTabs() {
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      $$('.panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-' + t.dataset.tab);
      });
      if (t.dataset.tab === 'historico') renderHist();
    });
  });
  var q = new URLSearchParams(location.search).get('tab');
  if (q) {
    var btn = document.querySelector('.tab[data-tab="' + q + '"]');
    if (btn) btn.click();
  }
}

/* ---------------- Bind general ---------------- */
function bindEvents() {
  bindTabs();

  // Tema
  $('#btnTheme').addEventListener('click', function () {
    var dark = document.documentElement.dataset.theme === 'dark';
    state.settings.theme = dark ? 'light' : 'dark';
    saveState();
    applyTheme();
  });
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (state.settings.theme === 'auto') applyTheme();
      });
    } catch (e) {}
  }

  // CSV productos
  $('#btnCsv').addEventListener('click', function () { $('#fileCsv').click(); });
  $('#fileCsv').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var n = importProductsCSV(String(r.result));
        toast(n + ' productos importados.');
      } catch (err) {
        toast('Error al leer CSV: ' + err.message, 'error');
      }
    };
    r.readAsText(f, 'UTF-8');
    e.target.value = '';
  });

  // Listas de inventario
  document.addEventListener('input', onInvInput);
  document.addEventListener('click', onInvClick);
  document.addEventListener('click', onCodClick);

  // Guardar
  $('#btnGuardarIngreso').addEventListener('click', function () { guardarInventario('ingreso'); });
  $('#btnGuardarCamara').addEventListener('click', function () { guardarInventario('camara'); });

  // Formato
  ['#fmtIngreso', '#fmtCamara'].forEach(function (sel) {
    var el = $(sel);
    if (!el) return;
    el.value = ui.formato;
    el.addEventListener('change', function () {
      ui.formato = el.value;
      $$('.fmt').forEach(function (x) { x.value = ui.formato; });
    });
  });

  // Reportes
  $('#btnDiarioIngreso').addEventListener('click', exportDiario);
  $('#btnDiarioCamara').addEventListener('click', exportDiario);
  $('#btnHistIngreso').addEventListener('click', exportHistorico);
  $('#btnHistCamara').addEventListener('click', exportHistorico);

  // Importar
  $('#btnImportIngreso').addEventListener('click', function () { $('#fileImportIngreso').click(); });
  $('#btnImportCamara').addEventListener('click', function () { $('#fileImportCamara').click(); });
  $('#fileImportIngreso').addEventListener('change', function (e) {
    importarHistorico(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
  $('#fileImportCamara').addEventListener('change', function (e) {
    importarHistorico(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  // Escáner pestaña 2
  $('#btnScanCamara').addEventListener('click', escanearParaInventario);

  // Histórico
  $('#tipoHist').addEventListener('change', function () {
    ui.tipoHist = this.value;
    switchPeriodInput();
    renderHist();
  });
  ['#fechaDia', '#fechaSemana', '#fechaMes', '#fechaAnio'].forEach(function (s) {
    var el = $(s);
    if (el) el.addEventListener('change', renderHist);
  });
  switchPeriodInput();
}

/* ---------------- Autocarga del CSV de ejemplo ---------------- */
function tryAutoLoadCSV() {
  fetch('./data/productos.csv', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('sin archivo'); return r.text(); })
    .then(function (txt) {
      var n = importProductsCSV(txt);
      toast('Catálogo inicial cargado: ' + n + ' productos.');
    })
    .catch(function () { /* silencioso */ });
}

/* ---------------- Service Worker ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* offline no crítico */ });
  });
}

/* ---------------- Init ---------------- */
function init() {
  loadState();
  if (!state.draft) state.draft = { date: '', values: {} };
  if (!state.draft.values) state.draft.values = {};
  if (state.draft.date !== todayISO()) {
    state.draft = { date: todayISO(), values: {} };
  }
  sortRecords();
  applyTheme();
  bindEvents();
  setDefaultDates();
  renderAll();
  if (!state.products.length) tryAutoLoadCSV();
  registerSW();
}

document.addEventListener('DOMContentLoaded', init);