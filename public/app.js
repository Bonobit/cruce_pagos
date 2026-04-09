// ──────────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────────
let currentModulo = 'pagos';
let allRows = [];
let sortKey = 'estadoConciliacion';
let sortAsc = true;
let sortKeyLetras = 'estadoConciliacion'; // Ordenar por estado por defecto
let sortAscLetras = true;
let sortKeyPagos = 'estadoConciliacion'; // Ordenar por estado por defecto
let sortAscPagos = true;
let dataLetras = [];
let dataPagos = [];
let visibleRowsLetras = [];
let visibleRowsPagos = [];

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
    s.resultsVisible = document.getElementById('results-letras-card').style.display !== 'none' || document.getElementById('results-pagos-card').style.display !== 'none';
    s.allRows = allRows;
    // tnsFiles es actualizado directamente en uploadFileObject
}

function restoreState(m) {
    const s = moduleState[m];
    document.getElementById('name-gestor').textContent = s.nameGestor;
    document.getElementById('info-gestor').innerHTML = s.infoGestor;
    document.getElementById('panel-gestor').classList.toggle('loaded', s.panelGestorLoaded);
    document.getElementById('panel-tns').classList.toggle('loaded', s.panelTnsLoaded);
    document.querySelectorAll('.tns-file-list').forEach(el => el.id === 'tns-file-list' && renderTnsList());

    // Mostrar solo tabla del módulo actual si hay datos
    if (s.resultsVisible) {
        if (m === 'letras' && dataLetras.length > 0) {
            document.getElementById('results-letras-card').style.display = 'block';
        } else if (m === 'pagos' && dataPagos.length > 0) {
            document.getElementById('results-pagos-card').style.display = 'block';
        }
    }

    document.getElementById('file-gestor').value = '';
    document.getElementById('file-tns').value = '';
    document.getElementById('excel-letras-btn').disabled = dataLetras.length === 0;
    document.getElementById('excel-pagos-btn').disabled = dataPagos.length === 0;
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
    // Ocultar tablas de ambos módulos antes de restaurar estado
    document.getElementById('results-letras-card').style.display = 'none';
    document.getElementById('results-pagos-card').style.display = 'none';
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

        dataLetras = data.letras?.rows || [];
        dataPagos = data.pagos?.rows || [];

        // Marcar que hay resultados en ambos módulos
        moduleState.letras.resultsVisible = dataLetras.length > 0;
        moduleState.pagos.resultsVisible = dataPagos.length > 0;

        renderResults(data);

        document.getElementById('excel-letras-btn').disabled = dataLetras.length === 0;
        document.getElementById('excel-pagos-btn').disabled = dataPagos.length === 0;

        const totalRows = dataLetras.length + dataPagos.length;
        toast(`Cruce generado: ${totalRows} registros (Letras: ${dataLetras.length}, Pagos: ${dataPagos.length})`, 'success');
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function renderResults(data) {
    // ──── Letras ────
    if (data.letras) {
        const wbL = document.getElementById('warnings-letras-box');
        const wlL = document.getElementById('warnings-letras-list');
        if (data.letras.warnings && data.letras.warnings.length > 0) {
            wlL.innerHTML = data.letras.warnings.map(w => `<li>${w}</li>`).join('');
            wbL.style.display = 'block';
        } else {
            wbL.style.display = 'none';
        }

        const rows = data.letras.rows;
        const ambos = rows.filter(r => r.estadoConciliacion === 'Ambos').length;
        const sg = rows.filter(r => r.estadoConciliacion === 'Solo Gestor').length;
        const st = rows.filter(r => r.estadoConciliacion === 'Solo TNS').length;
        const pagados = rows.filter(r => normalizeEstadoPagoFront(r.estadoPago) === 'Pagado').length;
        const espera = rows.filter(r => normalizeEstadoPagoFront(r.estadoPago) === 'En espera de pago').length;

        document.getElementById('summary-letras').innerHTML = `
        <span class="chip chip-total">📊 Total: ${rows.length}</span>
        <span class="chip chip-ambos">✅ Ambos: ${ambos}</span>
        <span class="chip chip-gestor">🟡 Solo Gestor: ${sg}</span>
        <span class="chip chip-tns">🟠 Solo TNS: ${st}</span>
        ${pagados > 0 ? `<span class="chip" style="background:#c6e0b4;color:#375623;">💰 Pagados: ${pagados}</span>` : ''}
        ${espera > 0 ? `<span class="chip" style="background:#fff2cc;color:#7d6008;">⏳ En espera: ${espera}</span>` : ''}
      `;

        document.getElementById('search-letras').value = '';
        document.getElementById('filter-estado-letras').value = '';
        document.getElementById('filter-tipo-letras').value = '';
        document.getElementById('filter-estadopago-letras').value = '';

        // Reset ordenamiento al estado por defecto
        sortKeyLetras = 'estadoConciliacion';
        sortAscLetras = true;

        filterTableLetras();
        document.getElementById('results-letras-card').style.display = (currentModulo === 'letras' && rows.length > 0) ? 'block' : 'none';
    } else {
        document.getElementById('results-letras-card').style.display = 'none';
    }

    // ──── Pagos ────
    if (data.pagos) {
        const wbP = document.getElementById('warnings-pagos-box');
        const wlP = document.getElementById('warnings-pagos-list');
        if (data.pagos.warnings && data.pagos.warnings.length > 0) {
            wlP.innerHTML = data.pagos.warnings.map(w => `<li>${w}</li>`).join('');
            wbP.style.display = 'block';
        } else {
            wbP.style.display = 'none';
        }

        const rows = data.pagos.rows;
        const ambos = rows.filter(r => r.estadoConciliacion === 'Ambos').length;
        const sg = rows.filter(r => r.estadoConciliacion === 'Solo Gestor').length;
        const st = rows.filter(r => r.estadoConciliacion === 'Solo TNS').length;
        document.getElementById('summary-pagos').innerHTML = `
        <span class="chip chip-total">📊 Total: ${rows.length}</span>
        <span class="chip chip-ambos">✅ Ambos: ${ambos}</span>
        <span class="chip chip-gestor">🟡 Solo Gestor: ${sg}</span>
        <span class="chip chip-tns">🟠 Solo TNS: ${st}</span>
      `;

        document.getElementById('search-pagos').value = '';
        document.getElementById('filter-estado-pagos').value = '';
        document.getElementById('filter-tipo-pagos').value = '';

        // Reset ordenamiento al estado por defecto
        sortKeyPagos = 'estadoConciliacion';
        sortAscPagos = true;

        filterTablePagos();
        document.getElementById('results-pagos-card').style.display = (currentModulo === 'pagos' && rows.length > 0) ? 'block' : 'none';
    } else {
        document.getElementById('results-pagos-card').style.display = 'none';
    }

    if (data.letras?.rows.length > 0 || data.pagos?.rows.length > 0) {
        const cardId = currentModulo === 'letras' ? 'results-letras-card' : 'results-pagos-card';
        setTimeout(() => document.getElementById(cardId).scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
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
function renderTableLetras(rows) {
    const body = document.getElementById('result-body-letras');
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">🔍</div><p>Sin resultados con los filtros aplicados.</p></div></td></tr>`;
        document.getElementById('row-count-letras').textContent = '';
        return;
    }

    const rowsHtml = rows.map(r => {
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
        <td class="center" style="font-weight:600;color:var(--blue-dark);">${formatValor(r.valor)}</td>
        <td class="center">${gx}</td>
        <td class="center">${tx}</td>
        <td><span class="badge-estado ${badgeCls}">${r.estadoConciliacion}</span></td>
        <td class="center" style="color:var(--red-dark);">${formatValor(r.mora)}</td>
        <td>${estadoPagoBadge(r.estadoPago)}</td>
      </tr>`;
    }).join('');

    // Calcular total del saldo
    const totalSaldo = rows.reduce((sum, r) => {
        const num = parseFloat(String(r.valor).replace(/[^0-9.-]/g, '')) || 0;
        return sum + num;
    }, 0);

    const totalRow = `
      <tr style="background:#f5f5f5;border-top:2px solid var(--gray-300);font-weight:600;">
        <td colspan="3" style="text-align:right;padding-right:12px;">TOTAL:</td>
        <td class="center" style="font-weight:600;color:var(--blue-dark);background:#e8f4f8;">$ ${totalSaldo.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td colspan="5"></td>
      </tr>`;

    body.innerHTML = rowsHtml + totalRow;

    document.getElementById('row-count-letras').textContent =
        `Mostrando ${rows.length} de ${dataLetras.length} registros (Mora incluida)`;
}

function renderTablePagos(rows) {
    const body = document.getElementById('result-body-pagos');
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">🔍</div><p>Sin resultados con los filtros aplicados.</p></div></td></tr>`;
        document.getElementById('row-count-pagos').textContent = '';
        return;
    }

    const rowsHtml = rows.map(r => {
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
        <td class="center">${esc(r.fechaCance)}</td>
        <td class="center">${esc(r.fechaVto)}</td>
        <td class="center" style="font-weight:600;color:var(--blue-dark);">${formatValor(r.valor)}</td>
        <td class="center">${gx}</td>
        <td class="center">${tx}</td>
        <td><span class="badge-estado ${badgeCls}">${r.estadoConciliacion}</span></td>
      </tr>`;
    }).join('');

    // Calcular total del saldo
    const totalSaldo = rows.reduce((sum, r) => {
        const num = parseFloat(String(r.valor).replace(/[^0-9.-]/g, '')) || 0;
        return sum + num;
    }, 0);

    const totalRow = `
      <tr style="background:#f5f5f5;border-top:2px solid var(--gray-300);font-weight:600;">
        <td colspan="4" style="text-align:right;padding-right:12px;">TOTAL:</td>
        <td class="center" style="font-weight:600;color:var(--blue-dark);background:#e8f4f8;">$ ${totalSaldo.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td colspan="3"></td>
      </tr>`;

    body.innerHTML = rowsHtml + totalRow;

    document.getElementById('row-count-pagos').textContent =
        `Mostrando ${rows.length} de ${dataPagos.length} registros`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Filter & sort
// ──────────────────────────────────────────────────────────────────────────────
function filterTableLetras() {
    const q = document.getElementById('search-letras').value.toUpperCase().trim();
    const estado = document.getElementById('filter-estado-letras').value;
    const tipo = document.getElementById('filter-tipo-letras').value;
    const estadoPago = document.getElementById('filter-estadopago-letras').value;

    let filtered = dataLetras.filter(r => {
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

    // Ordenar por defecto por estadoConciliacion, o por el ordenamiento seleccionado por el usuario
    filtered = sortRows(filtered, sortKeyLetras, sortAscLetras);
    visibleRowsLetras = filtered;
    renderTableLetras(filtered);
}

function filterTablePagos() {
    const q = document.getElementById('search-pagos').value.toUpperCase().trim();
    const estado = document.getElementById('filter-estado-pagos').value;
    const tipo = document.getElementById('filter-tipo-pagos').value;

    let filtered = dataPagos.filter(r => {
        const matchQ = !q
            || r.registro.toUpperCase().includes(q)
            || r.tipo.toUpperCase().includes(q)
            || (r.valor && String(r.valor).includes(q));
        const matchE = !estado || r.estadoConciliacion === estado;
        const matchT = !tipo || r.tipo === tipo;
        return matchQ && matchE && matchT;
    });

    // Ordenar por defecto por estadoConciliacion, o por el ordenamiento seleccionado por el usuario
    filtered = sortRows(filtered, sortKeyPagos, sortAscPagos);
    visibleRowsPagos = filtered;
    renderTablePagos(filtered);
}

function sortTableLetras(key) {
    if (sortKeyLetras === key) sortAscLetras = !sortAscLetras;
    else { sortKeyLetras = key; sortAscLetras = true; }
    filterTableLetras();
}

function sortTablePagos(key) {
    if (sortKeyPagos === key) sortAscPagos = !sortAscPagos;
    else { sortKeyPagos = key; sortAscPagos = true; }
    filterTablePagos();
}

function sortRows(rows, key, asc) {
    // Si key es 'original', mantener el orden original
    if (key === 'original') {
        return [...rows];
    }

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
async function descargarExcel(modulo) {
    const rowsToExport = modulo === 'letras' ? visibleRowsLetras : visibleRowsPagos;

    // Si no hay datos filtrados (o no hay accum), volver al endpoint default
    if (!rowsToExport || rowsToExport.length === 0) {
        window.location.href = `/api/cruce/excel?modulo=${modulo}`;
        return;
    }

    try {
        const response = await fetch('/api/cruce/excel/filtered', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modulo, rows: rowsToExport }),
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data?.error?.message || 'Error en la descarga');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cruce_${modulo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        toast(`Error al descargar Excel: ${err.message}`, 'error');
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Reset
// ──────────────────────────────────────────────────────────────────────────────
async function resetModulo() {
    if (!confirm(`¿Limpiar el módulo ${currentModulo}? Se borrarán los archivos cargados y toda la data.`)) return;
    try {
        const res = await fetch(`/api/reset?modulo=${currentModulo}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al limpiar');

        // Limpiar data solo del módulo actual
        if (currentModulo === 'letras') {
            dataLetras = [];
            document.getElementById('results-letras-card').style.display = 'none';
            document.getElementById('result-body-letras').innerHTML = '';
            document.getElementById('row-count-letras').textContent = '';
            document.getElementById('summary-letras').innerHTML = '';
        } else {
            dataPagos = [];
            document.getElementById('results-pagos-card').style.display = 'none';
            document.getElementById('result-body-pagos').innerHTML = '';
            document.getElementById('row-count-pagos').textContent = '';
            document.getElementById('summary-pagos').innerHTML = '';
        }

        // Limpiar estado
        moduleState[currentModulo] = createEmptyState();

        // Limpiar UI
        restoreState(currentModulo);

        toast('Módulo limpiado completamente.', 'success');
    } catch (err) {
        toast(`Error al limpiar: ${err.message}`, 'error');
    }
}

function hideResults() {
    document.getElementById('results-letras-card').style.display = 'none';
    document.getElementById('results-pagos-card').style.display = 'none';
    dataLetras = [];
    dataPagos = [];
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