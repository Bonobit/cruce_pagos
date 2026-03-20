
// ──────────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────────
let currentModulo = 'pagos';
let allRows = [];
let sortKey = 'estadoConciliacion';
let sortAsc = true;

// Per-module UI state cache
const moduleState = {
    pagos: createEmptyState(),
    letras: createEmptyState(),
};

function createEmptyState() {
    return {
        nameGestor: 'Sin archivo',
        nameTns: 'Sin archivo',
        infoGestor: '',
        infoTns: '',
        panelGestorLoaded: false,
        panelTnsLoaded: false,
        btnExcelDisabled: true,
        resultsVisible: false,
        allRows: [],
        resultsData: null,   // full data object from /api/cruce
        sortKey: 'estadoConciliacion',
        sortAsc: true,
        searchInput: '',
        filterEstado: '',
        filterTipo: '',
    };
}

function saveState() {
    const s = moduleState[currentModulo];
    s.nameGestor = document.getElementById('name-gestor').textContent;
    s.nameTns = document.getElementById('name-tns').textContent;
    s.infoGestor = document.getElementById('info-gestor').innerHTML;
    s.infoTns = document.getElementById('info-tns').innerHTML;
    s.panelGestorLoaded = document.getElementById('panel-gestor').classList.contains('loaded');
    s.panelTnsLoaded = document.getElementById('panel-tns').classList.contains('loaded');
    s.btnExcelDisabled = document.getElementById('btn-excel').disabled;
    s.resultsVisible = document.getElementById('results-card').style.display !== 'none';
    s.allRows = allRows;
    s.sortKey = sortKey;
    s.sortAsc = sortAsc;
    s.searchInput = document.getElementById('search-input').value;
    s.filterEstado = document.getElementById('filter-estado').value;
    s.filterTipo = document.getElementById('filter-tipo').value;
}

function restoreState(m) {
    const s = moduleState[m];
    document.getElementById('name-gestor').textContent = s.nameGestor;
    document.getElementById('name-tns').textContent = s.nameTns;
    document.getElementById('info-gestor').innerHTML = s.infoGestor;
    document.getElementById('info-tns').innerHTML = s.infoTns;
    document.getElementById('panel-gestor').classList.toggle('loaded', s.panelGestorLoaded);
    document.getElementById('panel-tns').classList.toggle('loaded', s.panelTnsLoaded);
    document.getElementById('file-gestor').value = '';
    document.getElementById('file-tns').value = '';
    document.getElementById('btn-excel').disabled = s.btnExcelDisabled;
    // Results are global (from /api/cruce/all) — do not hide or modify on tab switch
}

// ──────────────────────────────────────────────────────────────────────────────
// Module selection
// ──────────────────────────────────────────────────────────────────────────────
function setModulo(m) {
    if (m === currentModulo) return;
    saveState();
    currentModulo = m;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.modulo === m));
    restoreState(m);
}

// ──────────────────────────────────────────────────────────────────────────────
// Drag & Drop
// ──────────────────────────────────────────────────────────────────────────────
function handleDragOver(e, source) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.getElementById(`panel-${source}`).classList.add('drag-over');
}

function handleDragLeave(e, source) {
    // Only remove if leaving the panel entirely (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget)) {
        document.getElementById(`panel-${source}`).classList.remove('drag-over');
    }
}

function handleDrop(e, source) {
    e.preventDefault();
    document.getElementById(`panel-${source}`).classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
        toast(`Archivo no soportado: .${ext}. Usa .xlsx, .xls o .csv`, 'error');
        return;
    }
    uploadFileObject(source, file);
}

// ──────────────────────────────────────────────────────────────────────────────
// Upload
// ──────────────────────────────────────────────────────────────────────────────
async function uploadFile(source, input) {
    const file = input.files[0];
    if (!file) return;
    await uploadFileObject(source, file);
}

async function uploadFileObject(source, file) {
    if (!file) return;

    document.getElementById(`name-${source}`).textContent = file.name;
    const fd = new FormData();
    fd.append('file', file);

    try {
        const res = await fetch(`/api/upload/${source}?modulo=${currentModulo}`, {
            method: 'POST', body: fd
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? data.error);

        document.getElementById(`panel-${source}`).classList.add('loaded');
        document.getElementById(`info-${source}`).innerHTML = `✅ Archivo cargado.`;
        toast(`${source.toUpperCase()} cargado: ${data.rows} registros`, 'success');
        // Persist upload state immediately so switching tabs doesn't lose it
        saveState();
    } catch (err) {
        toast(`Error cargando ${source}: ${err.message}`, 'error');
        document.getElementById(`panel-${source}`).classList.remove('loaded');
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Generate cruce
// ──────────────────────────────────────────────────────────────────────────────
async function generarCruce() {
    const btn = document.getElementById('btn-cruce');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const res = await fetch('/api/cruce/all');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? data.error);

        allRows = data.rows;
        renderResults(data);
        document.getElementById('btn-excel').disabled = false;
        // Cache results so they survive tab switches
        moduleState[currentModulo].resultsData = data;
        saveState();
        toast(`Cruce generado: ${data.rows.length} registros`, 'success');
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function renderResults(data, restoreFilters = false) {
    // Warnings
    const wb = document.getElementById('warnings-box');
    const wl = document.getElementById('warnings-list');
    if (data.warnings && data.warnings.length > 0) {
        wl.innerHTML = data.warnings.map(w => `<li>${w}</li>`).join('');
        wb.style.display = 'block';
    } else {
        wb.style.display = 'none';
    }

    // Column info (not shown in combined view)
    document.getElementById('col-info').innerHTML = '';

    // Summary
    const rows = data.rows;
    const ambos = rows.filter(r => r.estadoConciliacion === 'Ambos').length;
    const sg = rows.filter(r => r.estadoConciliacion === 'Solo Gestor').length;
    const st = rows.filter(r => r.estadoConciliacion === 'Solo TNS').length;
    document.getElementById('summary').innerHTML = `
    <span class="chip chip-total">📊 Total: ${rows.length}</span>
    <span class="chip chip-ambos">✅ Ambos: ${ambos}</span>
    <span class="chip chip-gestor">🟡 Solo Gestor: ${sg}</span>
    <span class="chip chip-tns">🟠 Solo TNS: ${st}</span>
  `;

    // Only reset filters if NOT restoring from state
    if (!restoreFilters) {
        document.getElementById('search-input').value = '';
        document.getElementById('filter-estado').value = '';
        document.getElementById('filter-tipo').value = '';
    }

    filterTable();
    document.getElementById('results-card').style.display = 'block';
    if (!restoreFilters) {
        document.getElementById('results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderTable(rows) {
    const body = document.getElementById('result-body');
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">🔍</div><p>Sin resultados con los filtros aplicados.</p></div></td></tr>`;
        document.getElementById('row-count').textContent = '';
        return;
    }

    body.innerHTML = rows.map(r => {
        const cls = r.estadoConciliacion === 'Ambos' ? 'row-ambos'
            : r.estadoConciliacion === 'Solo Gestor' ? 'row-gestor' : 'row-tns';
        const badgeCls = r.estadoConciliacion === 'Ambos' ? 'badge-ambos'
            : r.estadoConciliacion === 'Solo Gestor' ? 'badge-gestor' : 'badge-tns';
        const gx = r.gestor ? '<span class="mark-x">X</span>' : '<span class="mark-empty"></span>';
        const tx = r.tns ? '<span class="mark-x">X</span>' : '<span class="mark-empty"></span>';
        return `
      <tr class="${cls}">
        <td><code style="font-size:12px">${esc(r.registro)}</code></td>
        <td>${esc(r.tipo)}</td>
        <td class="center">${esc(r.fechaVto)}</td>
        <td class="center">${gx}</td>
        <td class="center">${tx}</td>
        <td><span class="badge-estado ${badgeCls}">${r.estadoConciliacion}</span></td>
      </tr>`;
    }).join('');

    document.getElementById('row-count').textContent =
        `Mostrando ${rows.length} de ${allRows.length} registros`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Filter & sort
// ──────────────────────────────────────────────────────────────────────────────
function filterTable() {
    const q = document.getElementById('search-input').value.toUpperCase().trim();
    const estado = document.getElementById('filter-estado').value;
    const tipo = document.getElementById('filter-tipo').value;

    let filtered = allRows.filter(r => {
        const matchQ = !q || r.registro.toUpperCase().includes(q) || r.tipo.toUpperCase().includes(q);
        const matchE = !estado || r.estadoConciliacion === estado;
        const matchT = !tipo || r.tipo === tipo;
        return matchQ && matchE && matchT;
    });

    filtered = sortRows(filtered, sortKey, sortAsc);
    renderTable(filtered);
}

function sortTable(key) {
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
    filterTable();
}

function sortRows(rows, key, asc) {
    return [...rows].sort((a, b) => {
        const va = a[key] || ''; const vb = b[key] || '';
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return asc ? cmp : -cmp;
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Download Excel
// ──────────────────────────────────────────────────────────────────────────────
function descargarExcel() {
    window.location.href = `/api/cruce/excel?modulo=${currentModulo}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reset
// ──────────────────────────────────────────────────────────────────────────────
async function resetModulo() {
  if (!confirm(`¿Limpiar el módulo ${currentModulo}? Se borrarán los archivos cargados.`)) return;
  try {
    const res = await fetch(`/api/reset?modulo=${currentModulo}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al limpiar');
    moduleState[currentModulo] = createEmptyState();
    restoreState(currentModulo);
    toast('Módulo limpiado.', 'success');
  } catch (err) {
    toast(`Error al limpiar: ${err.message}`, 'error');
  }
}

function hideResults() {
    document.getElementById('results-card').style.display = 'none';
    allRows = [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Toast
// ──────────────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// ──────────────────────────────────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}