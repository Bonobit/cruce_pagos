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
        // TNS: lista de { name, rows }
        tnsFiles: [],
        infoGestor: '',
        panelGestorLoaded: false,
        panelTnsLoaded: false,
        btnExcelDisabled: true,
        resultsVisible: false,
        allRows: [],
        resultsData: null,
        sortKey: 'estadoConciliacion',
        sortAsc: true,
        searchInput: '',
        filterEstado: '',
        filterTipo: '',
        filterEstadoPago: '',
    };
}

function saveState() {
    const s = moduleState[currentModulo];
    s.nameGestor = document.getElementById('name-gestor').textContent;
    s.infoGestor = document.getElementById('info-gestor').innerHTML;
    s.panelGestorLoaded = document.getElementById('panel-gestor').classList.contains('loaded');
    s.panelTnsLoaded = document.getElementById('panel-tns').classList.contains('loaded');
    const btnExcel = document.querySelector('.btn-excel');
    s.btnExcelDisabled = btnExcel ? btnExcel.disabled : true;
    s.resultsVisible = document.getElementById('results-card').style.display !== 'none';
    s.allRows = allRows;
    s.sortKey = sortKey;
    s.sortAsc = sortAsc;
    s.searchInput = document.getElementById('search-input').value;
    s.filterEstado = document.getElementById('filter-estado').value;
    s.filterTipo = document.getElementById('filter-tipo').value;
    s.filterEstadoPago = document.getElementById('filter-estadopago').value;
    // tnsFiles es actualizado directamente en uploadFileObject
}

function restoreState(m) {
    const s = moduleState[m];
    document.getElementById('name-gestor').textContent = s.nameGestor;
    document.getElementById('info-gestor').innerHTML = s.infoGestor;
    document.getElementById('panel-gestor').classList.toggle('loaded', s.panelGestorLoaded);
    document.getElementById('panel-tns').classList.toggle('loaded', s.panelTnsLoaded);
    document.getElementById('file-gestor').value = '';
    document.getElementById('file-tns').value = '';
    document.querySelectorAll('.btn-excel').forEach(b => b.disabled = s.btnExcelDisabled);
    // Controlar visibilidad de columna valor
    const colValor = document.getElementById('col-valor');
    if (colValor) {
        colValor.style.display = m === 'pagos' ? '' : 'none';
    }
    renderTnsList(m);
}

// ──────────────────────────────────────────────────────────────────────────────
// TNS file list rendering
// ──────────────────────────────────────────────────────────────────────────────
function renderTnsList(modulo) {
    const m = modulo || currentModulo;
    const files = moduleState[m].tnsFiles;
    const listEl = document.getElementById('tns-file-list');
    const badge = document.getElementById('tns-count-badge');

    if (files.length === 0) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--gray-400);margin-top:6px;">Sin archivos cargados</div>';
        badge.textContent = '';
        document.getElementById('panel-tns').classList.remove('loaded');
        return;
    }

    badge.textContent = `(${files.length} archivo${files.length > 1 ? 's' : ''})`;
    document.getElementById('panel-tns').classList.add('loaded');

    listEl.innerHTML = files.map((f, i) => `
        <div class="tns-file-item">
            <span>📄</span>
            <span class="tns-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="tns-rows">${f.rows} reg.</span>
            <button onclick="removeTnsFile(${i})" title="Quitar archivo"
                style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:0 2px;line-height:1;">✕</button>
        </div>
    `).join('');
}

async function removeTnsFile(index) {
    const s = moduleState[currentModulo];
    s.tnsFiles.splice(index, 1);
    renderTnsList();
    // Resetear TNS en servidor y re-subir los que quedan
    await fetch(`/api/reset?modulo=${currentModulo}`, { method: 'DELETE' });
    // También limpiar el gestor del estado servidor — se mantiene en moduleState
    // Re-upload gestor si existe (no podemos re-enviar el buffer, así que indicamos al usuario)
    if (s.tnsFiles.length === 0) {
        moduleState[currentModulo].panelTnsLoaded = false;
        saveState();
        toast('Archivo TNS eliminado. Recarga el módulo si necesitas recalcular.', '');
    } else {
        toast(`Archivo eliminado. Quedan ${s.tnsFiles.length} archivo(s) TNS — recarga el cruce.`, '');
    }
    // El servidor fue reseteado, necesitamos indicar al usuario que regenere
    document.querySelectorAll('.btn-excel').forEach(b => b.disabled = true);
    moduleState[currentModulo].btnExcelDisabled = true;
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
    if (!e.currentTarget.contains(e.relatedTarget)) {
        document.getElementById(`panel-${source}`).classList.remove('drag-over');
    }
}

function handleDrop(e, source) {
    e.preventDefault();
    document.getElementById(`panel-${source}`).classList.remove('drag-over');

    if (source === 'tns') {
        // Para TNS, soportar drop de múltiples archivos
        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => {
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
                toast(`Archivo no soportado: .${ext}. Usa .xlsx, .xls o .csv`, 'error');
                return;
            }
            uploadFileObject('tns', file);
        });
    } else {
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
            toast(`Archivo no soportado: .${ext}. Usa .xlsx, .xls o .csv`, 'error');
            return;
        }
        uploadFileObject(source, file);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Upload
// ──────────────────────────────────────────────────────────────────────────────
async function uploadFile(source, input) {
    const files = Array.from(input.files);
    for (const file of files) {
        await uploadFileObject(source, file);
    }
    // Reset input para permitir subir el mismo archivo de nuevo
    input.value = '';
}

async function uploadFileObject(source, file) {
    if (!file) return;

    if (source === 'gestor') {
        document.getElementById('name-gestor').textContent = file.name;
    }

    const fd = new FormData();
    fd.append('file', file);

    try {
        const res = await fetch(`/api/upload/${source}?modulo=${currentModulo}`, {
            method: 'POST', body: fd
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? data.error);

        if (source === 'gestor') {
            document.getElementById('panel-gestor').classList.add('loaded');
            document.getElementById('info-gestor').innerHTML = `✅ ${data.rows} registros cargados.`;
            toast(`GESTOR cargado: ${data.rows} registros`, 'success');
        } else {
            // TNS: agregar al listado
            moduleState[currentModulo].tnsFiles.push({ name: file.name, rows: data.rows });
            renderTnsList();
            document.getElementById('info-tns').innerHTML = '';
            toast(`TNS agregado: ${data.rows} registros (total: ${data.totalTnsFiles} archivo${data.totalTnsFiles > 1 ? 's' : ''})`, 'success');
        }

        saveState();
    } catch (err) {
        toast(`Error cargando ${source}: ${err.message}`, 'error');
        if (source === 'gestor') {
            document.getElementById('panel-gestor').classList.remove('loaded');
        }
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
        document.querySelectorAll('.btn-excel').forEach(b => b.disabled = false);
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
    const wb = document.getElementById('warnings-box');
    const wl = document.getElementById('warnings-list');
    if (data.warnings && data.warnings.length > 0) {
        wl.innerHTML = data.warnings.map(w => `<li>${w}</li>`).join('');
        wb.style.display = 'block';
    } else {
        wb.style.display = 'none';
    }

    document.getElementById('col-info').innerHTML = '';

    const rows = data.rows;
    const ambos = rows.filter(r => r.estadoConciliacion === 'Ambos').length;
    const sg = rows.filter(r => r.estadoConciliacion === 'Solo Gestor').length;
    const st = rows.filter(r => r.estadoConciliacion === 'Solo TNS').length;

    // Contar también por estado de pago
    const pagados = rows.filter(r => normalizeEstadoPagoFront(r.estadoPago) === 'Pagado').length;
    const espera = rows.filter(r => normalizeEstadoPagoFront(r.estadoPago) === 'En espera de pago').length;

    document.getElementById('summary').innerHTML = `
    <span class="chip chip-total">📊 Total: ${rows.length}</span>
    <span class="chip chip-ambos">✅ Ambos: ${ambos}</span>
    <span class="chip chip-gestor">🟡 Solo Gestor: ${sg}</span>
    <span class="chip chip-tns">🟠 Solo TNS: ${st}</span>
    ${pagados > 0 ? `<span class="chip" style="background:#c6e0b4;color:#375623;">💰 Pagados: ${pagados}</span>` : ''}
    ${espera > 0 ? `<span class="chip" style="background:#fff2cc;color:#7d6008;">⏳ En espera: ${espera}</span>` : ''}
  `;

    if (!restoreFilters) {
        document.getElementById('search-input').value = '';
        document.getElementById('filter-estado').value = '';
        document.getElementById('filter-tipo').value = '';
        document.getElementById('filter-estadopago').value = '';
    }

    filterTable();
    document.getElementById('results-card').style.display = 'block';
    if (!restoreFilters) {
        document.getElementById('results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Valor formatting
// ──────────────────────────────────────────────────────────────────────────────
function formatValor(v) {
    if (!v && v !== 0) return '';
    const num = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
    if (isNaN(num)) return esc(String(v));
    return '$ ' + num.toLocaleString('es-CO');
}

function normalizeEstadoPagoFront(raw) {
    if (!raw) return '';
    const upper = String(raw).toUpperCase().trim();
    if (upper === 'PAGADO' || upper === 'PAGADA') return 'Pagado';
    if (upper === 'PENDIENTE' || upper === 'EN ESPERA' || upper === 'EN ESPERA DE PAGO') return 'En espera de pago';
    if (!upper) return '';
    return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function estadoPagoBadge(raw) {
    const norm = normalizeEstadoPagoFront(raw);
    if (!norm) return '<span style="color:var(--gray-400);font-size:11px;">—</span>';
    const upper = norm.toUpperCase();
    if (upper === 'PAGADO' || upper === 'PAGADA') {
        return `<span class="badge-estado badge-ambos">✅ ${norm}</span>`;
    }
    if (upper.startsWith('EN ESPERA') || upper === 'PENDIENTE') {
        return `<span class="badge-estado badge-gestor">⏳ ${norm}</span>`;
    }
    return `<span class="badge-estado" style="background:var(--gray-200);color:var(--gray-600);">${norm}</span>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Table rendering
// ──────────────────────────────────────────────────────────────────────────────
function renderTable(rows) {
    const body = document.getElementById('result-body');
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">🔍</div><p>Sin resultados con los filtros aplicados.</p></div></td></tr>`;
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
        <td class="center" style="font-weight:600;color:var(--blue-dark); ${currentModulo === 'pagos' ? '' : 'display:none;'}">${formatValor(r.valor)}</td>
        <td class="center">${gx}</td>
        <td class="center">${tx}</td>
        <td><span class="badge-estado ${badgeCls}">${r.estadoConciliacion}</span></td>
        <td>${estadoPagoBadge(r.estadoPago)}</td>
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
    const estadoPago = document.getElementById('filter-estadopago').value;

    let filtered = allRows.filter(r => {
        const matchQ = !q
            || r.registro.toUpperCase().includes(q)
            || r.tipo.toUpperCase().includes(q)
            || (r.valor && String(r.valor).includes(q));
        const matchE = !estado || r.estadoConciliacion === estado;
        const matchT = !tipo || r.tipo === tipo;
        const matchP = !estadoPago || normalizeEstadoPagoFront(r.estadoPago) === estadoPago
            || (estadoPago === 'Sin información' && !normalizeEstadoPagoFront(r.estadoPago));
        return matchQ && matchE && matchT && matchP;
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
        let va = a[key] ?? '';
        let vb = b[key] ?? '';
        // Ordenar valor numérico correctamente
        if (key === 'valor') {
            va = parseFloat(String(va).replace(/[^0-9.-]/g, '')) || 0;
            vb = parseFloat(String(vb).replace(/[^0-9.-]/g, '')) || 0;
        } else {
            va = String(va);
            vb = String(vb);
        }
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return asc ? cmp : -cmp;
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Download Excel
// ──────────────────────────────────────────────────────────────────────────────
function descargarExcel(type) {
    window.location.href = `/api/cruce/excel?type=${type}&modulo=${currentModulo}`;
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

// ──────────────────────────────────────────────────────────────────────────────
// Init: render TNS list on load
// ──────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderTnsList('pagos');
});