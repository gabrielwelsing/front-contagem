// ===== CONFIGURAÇÃO =====
const API_URL = window.ENV?.API_URL || 'https://backendearth-production.up.railway.app';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const WGS84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";

// ===== AUTH FETCH =====
function authFetch(url, options = {}) {
    const token = localStorage.getItem('hub_token');
    options.headers = {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token
    };
    return fetch(url, options);
}

// ===== ESTADO GLOBAL =====
let appMode = null; // 'pre_projeto' | 'ambiental' | 'impedimentos'
let sidebarMode = 'empty'; // 'empty' | 'ns_input' | 'list' | 'point_edit'
let selMode = 'text'; // 'text' | 'ocr'
let nsNumber = '';
let utmZone = '23';
const hemisphere = 'S';
let pdfFile = null, pdfDoc = null, pageNum = 1, totalPages = 0, scale = 1.2;
let approvedPoints = [];
let tempPoint = { e: '', n: '', title: '', isDivisa: false, pointNumber: 1 };
let editPointIndex = null;
let isConferencia = false;
let isAutoExtracting = false;
let isDrawing = false, startPos = { x: 0, y: 0 }, currentRect = null;
let mapInstance = null, markersLayer = null, polylineLayer = null;
let showMapFlag = false;
let highlightTimeout = null;

// ===== DOM ELEMENTS =====
const $ = id => document.getElementById(id);

// ===== MODE SELECTION =====
function selectMode(mode) {
    appMode = mode;
    $('mode-screen').style.display = 'none';
    $('app-screen').style.display = 'flex';
    $('app-screen').classList.remove('hidden');

    const isAmb = mode === 'ambiental' || mode === 'impedimentos';
    const badge = $('mode-badge');
    badge.textContent = mode === 'pre_projeto' ? 'Pré Projeto' : mode === 'ambiental' ? 'Ambiental' : 'Impedimentos';
    badge.className = 'badge ' + (mode === 'pre_projeto' ? 'badge-blue' : mode === 'ambiental' ? 'badge-green' : 'badge-amber');

    if (mode === 'impedimentos') $('conferencia-btn').classList.remove('hidden');
    else $('conferencia-btn').classList.add('hidden');

    const uploadBtn = $('main-upload-btn');
    uploadBtn.className = 'upload-btn ' + (isAmb ? 'green' : 'blue');
    $('upload-center').querySelector('.upload-sub').textContent = isAmb ? 'Selecione o arquivo do levantamento' : 'Selecione o arquivo da Nota de Serviço';

    const btnManual = $('btn-add-manual');
    btnManual.className = 'btn-manual ' + (isAmb ? 'green' : 'blue');
    $('btn-export').className = 'btn-export ' + (isAmb ? 'green' : 'blue');
    $('btn-save-point').className = 'btn-save ' + (mode === 'pre_projeto' ? 'blue' : mode === 'ambiental' ? 'green' : 'amber');

    const editHdr = $('edit-header');
    editHdr.className = 'edit-header ' + (mode === 'pre_projeto' ? 'blue' : mode === 'ambiental' ? 'green' : 'amber');

    showSidebar('empty');
}

function changeMode() {
    appMode = null;
    sidebarMode = 'empty';
    nsNumber = '';
    pdfFile = null; pdfDoc = null;
    approvedPoints = [];
    pageNum = 1; totalPages = 0;
    editPointIndex = null;
    isConferencia = false;
    $('mode-screen').style.display = 'flex';
    $('app-screen').style.display = 'none';
    $('pdf-wrapper').classList.add('hidden');
    $('upload-center').classList.remove('hidden');
    $('selection-toggle').classList.add('hidden');
    $('add-pdf-btn').classList.add('hidden');
    $('page-controls').classList.add('hidden');
    $('ns-hdr-badge').classList.add('hidden');
    $('btn-reset').classList.add('hidden');
    $('ns-cross-mode-warning').classList.add('hidden');

    // Reset file inputs
    const mainInput = $('main-upload-btn')?.querySelector('input');
    if (mainInput) mainInput.value = '';
    const addInput = $('add-pdf-btn')?.querySelector('input');
    if (addInput) addInput.value = '';

    destroyMap();
}

function toggleConferencia() {
    isConferencia = !isConferencia;
    const btn = $('btn-conf');
    btn.className = isConferencia ? 'hdr-btn active-yellow' : 'hdr-btn';
}

// ===== FILE UPLOAD =====
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    pdfFile = file;

    if (!nsNumber) {
        showSidebar('ns_input');
    } else {
        showSidebar('list');
    }

    selMode = 'text';
    updateSelectionToggle();

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const loadedPdf = await pdfjsLib.getDocument(new Uint8Array(e.target.result)).promise;
            pdfDoc = loadedPdf;
            totalPages = loadedPdf.numPages;
            pageNum = 1;
            await renderPage(pageNum);
            fitPdfToScreen();

            $('upload-center').classList.add('hidden');
            $('pdf-wrapper').classList.remove('hidden');
            $('selection-toggle').classList.remove('hidden');
            $('add-pdf-btn').classList.remove('hidden');
            $('page-controls').classList.remove('hidden');
            $('page-controls').style.display = 'flex';
            $('btn-auto-extract').classList.remove('hidden');
            updatePageInfo();
        } catch (err) {
            console.error(err);
            alert('Erro ao abrir PDF.');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ===== PDF RENDERING =====
async function renderPage(num) {
    if (!pdfDoc) return;
    try {
        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale });
        const canvas = $('pdf-canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const textLayerDiv = $('text-layer');
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.height = viewport.height + 'px';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.setProperty('--scale-factor', String(scale));

        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayerDiv, viewport, textDivs: [] });
    } catch (err) { console.error(err); }
}

function fitPdfToScreen() {
    const canvas = $('pdf-canvas');
    if (!canvas || canvas.width === 0) return;
    const availableWidth = window.innerWidth - 400 - 32;
    let newScale = availableWidth / canvas.width;
    newScale = Math.max(0.5, Math.min(1.5, newScale));
    scale = newScale;
    renderPage(pageNum);
    $('zoom-info').textContent = Math.round(scale * 100) + '%';
}

function prevPage() { if (pageNum > 1) { pageNum--; renderPage(pageNum); updatePageInfo(); } }
function nextPage() { if (pageNum < totalPages) { pageNum++; renderPage(pageNum); updatePageInfo(); } }
function zoomIn() { scale = Math.min(scale + 0.2, 3.0); renderPage(pageNum); $('zoom-info').textContent = Math.round(scale * 100) + '%'; }
function zoomOut() { scale = Math.max(scale - 0.2, 0.5); renderPage(pageNum); $('zoom-info').textContent = Math.round(scale * 100) + '%'; }
function updatePageInfo() { $('page-info').textContent = pageNum + '/' + totalPages; }
function setSelectionMode(mode) {
    selMode = mode;
    updateSelectionToggle();
    $('pdf-wrapper').style.cursor = mode === 'ocr' ? 'crosshair' : '';
}
function updateSelectionToggle() {
    $('btn-text').className = 'hdr-btn' + (selMode === 'text' ? ' active' : '');
    $('btn-ocr').className = 'hdr-btn' + (selMode === 'ocr' ? ' active-purple' : '');
}

// ===== TEXT SELECTION =====
$('text-layer').addEventListener('mouseup', () => {
    if (selMode !== 'text') return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text) { processExtractedText(text); sel.removeAllRanges(); }
});

function processExtractedText(text) {
    if (!text) return;
    const cleanText = text.replace(/[^\d:.\-\s]/g, ' ');

    if (sidebarMode === 'ns_input') {
        const digitsOnly = cleanText.replace(/\D/g, '');
        const nsMatch = digitsOnly.match(/(\d{10})/);
        if (nsMatch) { $('ns-input').value = nsMatch[0]; nsNumber = nsMatch[0]; updateNsConfirmBtn(); }
        return;
    }

    const regex = /(\d{6}[.,]?\d{0,3})[\D]{0,15}(\d{7}[.,]?\d{0,3})/;
    const match = regex.exec(cleanText);
    if (match) {
        const eVal = match[1].replace(',', '.');
        const nVal = match[2].replace(',', '.');
        const nextNum = approvedPoints.length > 0 ? Math.max(...approvedPoints.map(p => p.pointNumber || 0)) + 1 : 1;
        tempPoint = { e: eVal, n: nVal, title: '', isDivisa: false, pointNumber: nextNum };
        editPointIndex = null;
        showSidebar('point_edit');
    } else if (selMode === 'ocr') {
        alert('Números não identificados.');
    }
}

// ===== BOTÃO DIREITO: SALVAR PONTO =====
document.addEventListener('contextmenu', (e) => {
    if (sidebarMode !== 'point_edit') return;
    e.preventDefault();
    savePoint();
});

// ===== OCR =====
const pdfWrapper = $('pdf-wrapper');
pdfWrapper.addEventListener('mousedown', (e) => {
    if (selMode !== 'ocr') return;
    const rect = pdfWrapper.getBoundingClientRect();
    isDrawing = true;
    startPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    currentRect = null;
    $('ocr-rect').classList.add('hidden');
});
pdfWrapper.addEventListener('mousemove', (e) => {
    if (!isDrawing || selMode !== 'ocr') return;
    const rect = pdfWrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const w = cx - startPos.x, h = cy - startPos.y;
    currentRect = { x: w > 0 ? startPos.x : cx, y: h > 0 ? startPos.y : cy, w: Math.abs(w), h: Math.abs(h) };
    const ocrRect = $('ocr-rect');
    ocrRect.classList.remove('hidden');
    ocrRect.style.left = currentRect.x + 'px';
    ocrRect.style.top = currentRect.y + 'px';
    ocrRect.style.width = currentRect.w + 'px';
    ocrRect.style.height = currentRect.h + 'px';
});
pdfWrapper.addEventListener('mouseup', async () => {
    if (!isDrawing || !currentRect || selMode !== 'ocr') { isDrawing = false; return; }
    isDrawing = false;
    if (currentRect.w < 5 || currentRect.h < 5) { currentRect = null; $('ocr-rect').classList.add('hidden'); return; }

    $('ocr-overlay').classList.remove('hidden');
    try {
        const canvas = $('pdf-canvas');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = currentRect.w; tempCanvas.height = currentRect.h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, currentRect.x, currentRect.y, currentRect.w, currentRect.h, 0, 0, currentRect.w, currentRect.h);
        const blob = await new Promise(r => tempCanvas.toBlob(r));
        if (!blob) throw new Error('Imagem erro');
        const worker = await Tesseract.createWorker('eng');
        const ret = await worker.recognize(blob);
        await worker.terminate();
        processExtractedText(ret.data.text);
    } catch (err) { alert('Erro no OCR.'); }
    finally { $('ocr-overlay').classList.add('hidden'); $('ocr-rect').classList.add('hidden'); currentRect = null; }
});

// ===== NS CONFIRM =====
$('ns-input').addEventListener('input', function() {
    nsNumber = this.value;
    updateNsConfirmBtn();
});
function updateNsConfirmBtn() {
    $('ns-confirm').disabled = nsNumber.length < 3;
}

async function confirmNS() {
    if (nsNumber.length < 3) { alert('NS deve ter pelo menos 3 caracteres.'); return; }

    const isSharedMode = appMode === 'ambiental' || appMode === 'impedimentos';

    if (isSharedMode) {
        try {
            const resp = await authFetch(`${API_URL}/api/projetos?ns=${encodeURIComponent(nsNumber)}&modo=${appMode}`);
            const data = await resp.json();
            if (data.exists && data.projeto) {
                const pts = data.projeto.pontos;
                const zone = data.projeto.utm_zone;
                if (Array.isArray(pts) && pts.length > 0) {
                    const shouldImport = confirm(`Existem ${pts.length} ponto(s) armazenados desta NS.\nDeseja importar as informações?`);
                    if (shouldImport) {
                        approvedPoints = pts.map((p, i) => ({
                            id: p.id || Date.now().toString(),
                            title: p.title || '', utmE: p.utmE || '', utmN: p.utmN || '',
                            lat: p.lat || 0, lon: p.lon || 0, zone: p.zone || '',
                            fromFile: p.fromFile || 'Importado', isDivisa: p.isDivisa || false,
                            pointNumber: p.pointNumber || (i + 1),
                            pdfPage: p.pdfPage || null, pdfX: p.pdfX || null, pdfY: p.pdfY || null
                        }));
                        if (zone) { utmZone = zone; $('utm-zone-input').value = zone; }
                    }
                }
            }
        } catch (err) { console.error('Erro buscando NS:', err); }
    }

    $('ns-hdr-badge').textContent = 'NS:' + nsNumber;
    $('ns-hdr-badge').classList.remove('hidden');
    $('btn-reset').classList.remove('hidden');
    showSidebar('list');

    if (isSharedMode) {
        try {
            const checkResp = await authFetch(`${API_URL}/api/levantamentos/ns-check?ns=${encodeURIComponent(nsNumber)}`);
            const checkData = await checkResp.json();
            const modeLabels = { ambiental_compartilhado: 'Ambiental/Impedimentos' };
            const outros = (checkData.modos || []).filter(m =>
                m.modo !== 'ambiental_compartilhado' && parseInt(m.total_pontos) > 0
            );
            const warn = $('ns-cross-mode-warning');
            if (outros.length > 0) {
                const lista = outros.map(m => `${modeLabels[m.modo] || m.modo} (${m.total_pontos} ponto${m.total_pontos != 1 ? 's' : ''})`).join(' · ');
                warn.innerHTML = `<b>⚠️ NS ${nsNumber} também possui dados em:</b>${lista}`;
                warn.classList.remove('hidden');
            } else {
                warn.classList.add('hidden');
            }
        } catch (err) { console.error('Erro verificando outros modos:', err); }
    }
}

// ===== SYNC TO POSTGRESQL =====
async function syncToDatabase() {
    if (!nsNumber || nsNumber.length < 3) return;
    try {
        await authFetch(`${API_URL}/api/projetos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ns: nsNumber, modo: appMode, utm_zone: utmZone,
                pontos: approvedPoints.map((p, i) => ({
                    id: p.id, title: p.title, utmE: p.utmE, utmN: p.utmN,
                    lat: p.lat, lon: p.lon, zone: p.zone, fromFile: p.fromFile,
                    isDivisa: p.isDivisa, pointNumber: p.pointNumber || (i + 1),
                    pdfPage: p.pdfPage || null, pdfX: p.pdfX || null, pdfY: p.pdfY || null
                }))
            })
        });
    } catch (err) { console.error('Erro ao sincronizar:', err); }
}

// ===== SAVE POINT =====
function savePoint() {
    try {
        const e = parseFloat($('edit-e').value);
        const n = parseFloat($('edit-n').value);
        if (isNaN(e) || isNaN(n)) throw new Error('Inválido');
        const utmProj = `+proj=utm +zone=${utmZone} +south +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
        const [lon, lat] = proj4(utmProj, WGS84, [e, n]);

        const pNum = parseInt($('edit-num').value) || 1;
        let finalTitle = '';
        if (appMode === 'ambiental' || appMode === 'impedimentos') {
            finalTitle = `P${pNum} ${utmZone}k ${$('edit-e').value}:${$('edit-n').value}`;
        } else {
            const customTitle = $('edit-title-input') ? $('edit-title-input').value : '';
            finalTitle = `${customTitle} - ${$('edit-e').value}:${$('edit-n').value} - NS: ${nsNumber}`;
        }

        const pointData = {
            title: finalTitle, utmE: $('edit-e').value, utmN: $('edit-n').value,
            lat, lon, zone: `${utmZone}${hemisphere}`,
            fromFile: pdfFile?.name || 'Manual',
            isDivisa: tempPoint.isDivisa, pointNumber: pNum
        };

        if (editPointIndex !== null) {
            approvedPoints[editPointIndex] = { ...approvedPoints[editPointIndex], ...pointData };
        } else {
            approvedPoints.push({ id: Date.now().toString(), ...pointData });
        }
        approvedPoints.sort((a, b) => (a.pointNumber || 0) - (b.pointNumber || 0));

        editPointIndex = null;
        showSidebar('list');
        syncToDatabase();
    } catch (err) { alert('Erro na Conversão. Verifique coordenadas e fuso UTM.'); }
}

// ===== DELETE POINT =====
function handleDeletePoint(idx) {
    approvedPoints.splice(idx, 1);
    if (approvedPoints.length > 0 && idx <= approvedPoints.length) {
        const doReseq = confirm('Deseja renumerar os pontos seguintes?');
        if (doReseq) {
            for (let i = idx; i < approvedPoints.length; i++) {
                const old = approvedPoints[i].pointNumber || (i + 2);
                const newN = old - 1;
                approvedPoints[i].title = approvedPoints[i].title.replace(new RegExp(`\\bP${old}\\b`, 'i'), `P${newN}`);
                approvedPoints[i].pointNumber = newN;
            }
        }
    }
    renderPointsList();
    updateMap();
    syncToDatabase();
}

// ===== EDIT POINT =====
function handleEditPoint(idx) {
    const p = approvedPoints[idx];
    let editTitle = p.title;
    if (appMode === 'pre_projeto') { const s = p.title.split(' - '); if (s.length > 0) editTitle = s[0]; }
    tempPoint = { e: p.utmE, n: p.utmN, title: editTitle, isDivisa: p.isDivisa, pointNumber: p.pointNumber || (idx + 1) };
    editPointIndex = idx;
    showSidebar('point_edit');
}

function handleManualAdd() {
    const nextNum = approvedPoints.length > 0 ? Math.max(...approvedPoints.map(p => p.pointNumber || 0)) + 1 : 1;
    tempPoint = { e: '', n: '', title: '', isDivisa: false, pointNumber: nextNum };
    editPointIndex = null;
    showSidebar('point_edit');
}

function cancelEdit() { editPointIndex = null; showSidebar('list'); }

function toggleDivisa() {
    tempPoint.isDivisa = !tempPoint.isDivisa;
    const btn = $('btn-divisa');
    btn.className = 'btn-divisa ' + (tempPoint.isDivisa ? 'on' : 'off');
    btn.innerHTML = tempPoint.isDivisa ? '📍 ✓ DIVISA ATIVA' : '📍 Marcar como Divisa';
    $('divisa-hint').textContent = tempPoint.isDivisa ? 'Pino será: shaded_dot (divisória)' : 'Pino será: placemark_circle (padrão ambiental)';
}

// ===== HIGHLIGHT POINT ON PDF =====
function highlightPoint(point) {
    if (!point.pdfPage || !point.pdfX || !point.pdfY || !pdfDoc) return;
    pageNum = point.pdfPage;
    renderPage(pageNum);
    updatePageInfo();

    (async () => {
        const page = await pdfDoc.getPage(point.pdfPage);
        const viewport = page.getViewport({ scale });
        const cx = point.pdfX * scale;
        const cy = viewport.height - (point.pdfY * scale);

        const box = $('highlight-box');
        box.classList.remove('hidden');
        box.style.left = (cx - 50) + 'px';
        box.style.top = (cy - 30) + 'px';
        box.style.width = '100px';
        box.style.height = '60px';

        const pdfArea = $('pdf-area');
        setTimeout(() => {
            pdfArea.scrollTo({ left: Math.max(0, cx - pdfArea.clientWidth / 2), top: Math.max(0, cy - pdfArea.clientHeight / 2), behavior: 'smooth' });
        }, 300);

        if (highlightTimeout) clearTimeout(highlightTimeout);
        highlightTimeout = setTimeout(() => box.classList.add('hidden'), 4000);
    })();
}

// ===== AUTO EXTRACT =====
async function autoExtractFromPdf() {
    if (!pdfDoc) return;
    if (!nsNumber || nsNumber.length < 3) { alert('Informe a NS antes de extrair.'); showSidebar('ns_input'); return; }
    isAutoExtracting = true;
    $('btn-auto-extract').disabled = true;
    $('btn-auto-extract').innerHTML = '⏳ Extraindo...';

    try {
        const utmProj = `+proj=utm +zone=${utmZone} +south +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
        const allNodes = [];
        for (let p = 1; p <= pdfDoc.numPages; p++) {
            const page = await pdfDoc.getPage(p);
            const tc = await page.getTextContent();
            for (const item of tc.items) {
                if (!item.str || !item.str.trim()) continue;
                allNodes.push({ str: item.str.trim(), x: item.transform[4], y: item.transform[5], page: p });
            }
        }

        const pxRegex = /^P(\d+)$/i;
        const pxNodes = [];
        for (const node of allNodes) {
            const m = pxRegex.exec(node.str);
            if (m) pxNodes.push({ num: parseInt(m[1]), x: node.x, y: node.y, page: node.page });
        }

        const coordNodes = [];
        const combinedRegex = /(\d{6}[.,]?\d{0,3})[:\s\/\-;](\d{7}[.,]?\d{0,3})/;
        for (const node of allNodes) {
            const m = combinedRegex.exec(node.str);
            if (m) coordNodes.push({ e: m[1].replace(',', '.'), n: m[2].replace(',', '.'), x: node.x, y: node.y, page: node.page });
        }

        const eRegex = /^(\d{6}[.,]?\d{0,3})$/;
        const nRegex = /^(\d{7}[.,]?\d{0,3})$/;
        const eNodes = allNodes.filter(n => eRegex.test(n.str));
        const nNodes = allNodes.filter(n => nRegex.test(n.str));

        for (const en of eNodes) {
            let bestN = null, bestDist = 200;
            for (const nn of nNodes) {
                if (nn.page !== en.page) continue;
                const d = Math.sqrt((en.x - nn.x) ** 2 + (en.y - nn.y) ** 2);
                if (d < bestDist) { bestDist = d; bestN = nn; }
            }
            if (bestN) {
                const ev = en.str.replace(',', '.'), nv = bestN.str.replace(',', '.');
                if (!coordNodes.some(c => c.e === ev && c.n === nv && c.page === en.page)) {
                    coordNodes.push({ e: ev, n: nv, x: (en.x + bestN.x) / 2, y: (en.y + bestN.y) / 2, page: en.page });
                }
            }
        }

        if (pxNodes.length === 0 && coordNodes.length === 0) { alert('Nenhum ponto ou coordenada encontrada.'); return; }

        const matched = [];
        const usedCoords = new Set();

        if (pxNodes.length > 0 && coordNodes.length > 0) {
            for (const px of pxNodes) {
                let bestIdx = -1, bestDist = Infinity;
                for (let i = 0; i < coordNodes.length; i++) {
                    if (usedCoords.has(i)) continue;
                    const c = coordNodes[i];
                    const penalty = c.page === px.page ? 0 : 10000;
                    const d = Math.sqrt((px.x - c.x) ** 2 + (px.y - c.y) ** 2) + penalty;
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                if (bestIdx >= 0) {
                    usedCoords.add(bestIdx);
                    matched.push({ pNum: px.num, e: coordNodes[bestIdx].e, n: coordNodes[bestIdx].n, pdfX: px.x, pdfY: px.y, pdfPage: px.page });
                }
            }
        } else {
            coordNodes.forEach((c, i) => matched.push({ pNum: i + 1, e: c.e, n: c.n, pdfX: c.x, pdfY: c.y, pdfPage: c.page }));
        }

        matched.sort((a, b) => a.pNum - b.pNum);

        const newPoints = [];
        for (const m of matched) {
            try {
                const x = parseFloat(m.e), y = parseFloat(m.n);
                if (isNaN(x) || isNaN(y)) continue;
                const [lon, lat] = proj4(utmProj, WGS84, [x, y]);
                const title = (appMode === 'ambiental' || appMode === 'impedimentos')
                    ? `P${m.pNum} ${utmZone}k ${m.e}:${m.n}`
                    : `P${m.pNum} - ${m.e}:${m.n} - NS: ${nsNumber}`;
                newPoints.push({
                    id: `auto_${m.pNum}_${Date.now()}`, title, utmE: m.e, utmN: m.n, lat, lon,
                    zone: `${utmZone}${hemisphere}`, fromFile: pdfFile?.name || 'Auto', isDivisa: false,
                    pdfPage: m.pdfPage, pdfX: m.pdfX, pdfY: m.pdfY, pointNumber: m.pNum
                });
            } catch {}
        }

        if (newPoints.length === 0) { alert('Coordenadas não puderam ser convertidas. Verifique o Fuso UTM.'); return; }

        approvedPoints = [...approvedPoints, ...newPoints];
        renderPointsList();
        updateMap();
        syncToDatabase();
        alert(`✅ ${newPoints.length} ponto(s) extraídos!`);
    } catch (err) { console.error(err); alert('Erro na extração automática.'); }
    finally {
        isAutoExtracting = false;
        $('btn-auto-extract').disabled = false;
        $('btn-auto-extract').innerHTML = '✨ Extrair Automaticamente';
    }
}

// ===== EXPORT KML =====
function exportKML() {
    const docName = appMode === 'ambiental' ? 'Levantamento Ambiental' : appMode === 'impedimentos' ? 'Levantamento Impedimentos' : `Levantamento NS ${nsNumber}`;

    let kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${docName}</name>`;

    approvedPoints.forEach((p, idx) => {
        let iconUrl;
        if (appMode === 'ambiental' || appMode === 'impedimentos') {
            if (p.isDivisa) iconUrl = 'http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png';
            else if (isConferencia) iconUrl = 'http://maps.google.com/mapfiles/kml/paddle/ltblu-blank.png';
            else iconUrl = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';
        } else {
            const iconNum = p.pointNumber || (idx + 1);
            iconUrl = iconNum <= 10 ? `http://maps.google.com/mapfiles/kml/paddle/${iconNum}.png` : 'http://maps.google.com/mapfiles/kml/paddle/wht-blank.png';
        }

        const desc = (appMode === 'ambiental' || appMode === 'impedimentos')
            ? `E:${p.utmE} N:${p.utmN}${p.isDivisa ? ' | DIVISA' : ''}`
            : `NS: ${nsNumber} | E:${p.utmE} N:${p.utmN}`;

        kml += `<Placemark><name>${escXml(p.title)}</name><description>${escXml(desc)}</description><Style><IconStyle><scale>1.1</scale><Icon><href>${iconUrl}</href></Icon></IconStyle></Style><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`;
    });

    if (appMode === 'ambiental' && approvedPoints.length >= 2) {
        const coords = approvedPoints.map(p => `${p.lon},${p.lat},0`).join('\n');
        kml += `<Placemark><name>Caminho Ambiental</name><Style><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }

    kml += '</Document></kml>';

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nsNumber ? `NS_${nsNumber}.kml` : `${appMode}_${new Date().toISOString().split('T')[0]}.kml`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);

    // Log KML generation
    authFetch(`${API_URL}/api/kml-log`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ns: nsNumber, modo: appMode, quantidade_pontos: approvedPoints.length })
    }).catch(() => {});
}

function escXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ===== SIDEBAR MANAGEMENT =====
function showSidebar(mode) {
    sidebarMode = mode;
    $('ns-panel').classList.add('hidden'); $('ns-panel').style.display = 'none';
    $('list-panel').classList.add('hidden'); $('list-panel').style.display = 'none';
    $('edit-panel').classList.add('hidden'); $('edit-panel').style.display = 'none';

    if (mode === 'ns_input') {
        const isAmb = appMode === 'ambiental', isImp = appMode === 'impedimentos';
        const panel = $('ns-panel');
        panel.classList.remove('hidden'); panel.style.display = 'flex';
        panel.className = 'ns-panel ' + (isAmb ? 'bg-green' : isImp ? 'bg-amber' : 'bg-blue');
        $('ns-icon').className = 'ns-icon ' + (isAmb ? 'green' : isImp ? 'amber' : 'blue');
        $('ns-confirm').className = 'ns-confirm ' + (isAmb ? 'green' : isImp ? 'amber' : 'blue');
        $('ns-input').value = nsNumber;
        updateNsConfirmBtn();
        setTimeout(() => $('ns-input').focus(), 100);
    } else if (mode === 'list') {
        $('list-panel').classList.remove('hidden'); $('list-panel').style.display = 'flex';
        renderPointsList();
        updateMap();
    } else if (mode === 'point_edit') {
        $('edit-panel').classList.remove('hidden'); $('edit-panel').style.display = 'flex';
        populateEditPanel();
    }
}

function populateEditPanel() {
    $('edit-num').value = tempPoint.pointNumber;
    $('edit-e').value = tempPoint.e;
    $('edit-n').value = tempPoint.n;
    $('edit-title').textContent = editPointIndex !== null ? `Editar Ponto #${editPointIndex + 1}` : `Novo Ponto #${approvedPoints.length + 1}`;
    $('edit-sub').textContent = (appMode === 'ambiental' || appMode === 'impedimentos') ? 'Edite os dados geográficos' : 'Edite os dados do ponto';

    // Title section (pre_projeto only)
    if (appMode === 'pre_projeto') {
        $('title-section').classList.remove('hidden');
        const presets = ['INICIO CONSTRUCAO CABO', 'FINAL CONSTRUCAO CABO', 'INICIO CONVERSAO CABO', 'FINAL CONVERSAO CABO'];
        $('title-presets').innerHTML = presets.map(t =>
            `<button class="title-preset${tempPoint.title === t ? ' active' : ''}" onclick="setTitle('${t}')">${t}</button>`
        ).join('');
        $('edit-title-input').value = tempPoint.title;
    } else {
        $('title-section').classList.add('hidden');
    }

    // Divisa section
    if (appMode === 'ambiental' || appMode === 'impedimentos') {
        $('divisa-section').classList.remove('hidden');
        $('btn-divisa').className = 'btn-divisa ' + (tempPoint.isDivisa ? 'on' : 'off');
        $('btn-divisa').innerHTML = tempPoint.isDivisa ? '📍 ✓ DIVISA ATIVA' : '📍 Marcar como Divisa';
        $('divisa-hint').textContent = tempPoint.isDivisa ? 'Pino será: shaded_dot (divisória)' : 'Pino será: placemark_circle (padrão ambiental)';
    } else {
        $('divisa-section').classList.add('hidden');
    }

    // Preview
    updateEditPreview();
}

function setTitle(t) {
    tempPoint.title = t;
    if ($('edit-title-input')) $('edit-title-input').value = t;
    const btns = $('title-presets').querySelectorAll('.title-preset');
    btns.forEach(b => b.className = 'title-preset' + (b.textContent === t ? ' active' : ''));
}

function updateEditPreview() {
    const e = $('edit-e').value || '---';
    const n = $('edit-n').value || '---';
    const prev = $('edit-preview-val');
    if (appMode === 'ambiental' || appMode === 'impedimentos') {
        prev.className = 'val green';
        prev.textContent = `${utmZone} k ${e}:${n}`;
    } else {
        prev.className = 'val blue';
        const t = $('edit-title-input') ? $('edit-title-input').value : '---';
        prev.textContent = `${t || '---'} - ${e}:${n} - NS: ${nsNumber}`;
    }
}

// Live preview updates
document.addEventListener('input', (e) => {
    if (['edit-e', 'edit-n', 'edit-title-input'].includes(e.target?.id)) updateEditPreview();
});

// ===== RENDER POINTS LIST =====
function renderPointsList() {
    const list = $('points-list');
    $('points-count').textContent = approvedPoints.length;
    $('btn-export').disabled = approvedPoints.length === 0;

    if (approvedPoints.length === 0) {
        list.innerHTML = '<div class="points-empty">Lista Vazia</div>';
        $('map-section').classList.add('hidden');
        return;
    }

    $('map-section').classList.remove('hidden');
    const isAmb = appMode === 'ambiental' || appMode === 'impedimentos';

    list.innerHTML = approvedPoints.map((p, idx) => {
        const numClass = p.isDivisa ? 'divisa' : (isAmb ? 'green' : 'blue');
        const cardClass = p.isDivisa ? 'point-card divisa' : 'point-card';
        const numLabel = p.isDivisa ? 'D' : (p.pointNumber || (idx + 1));
        return `<div class="${cardClass}" onclick="highlightPoint(approvedPoints[${idx}])">
            <div class="point-num ${numClass}">${numLabel}</div>
            <div class="point-info">
                <div class="point-title">${escHtml(p.title)}</div>
                <div class="point-coords">E: ${p.utmE} N: ${p.utmN}${p.isDivisa ? '<span class="point-divisa">DIVISA</span>' : ''}</div>
                ${p.pdfPage ? `<div class="point-page">📄 Pág. ${p.pdfPage}</div>` : ''}
            </div>
            <button class="point-btn edit" onclick="event.stopPropagation();handleEditPoint(${idx})" title="Editar">✏️</button>
            <button class="point-btn del" onclick="event.stopPropagation();handleDeletePoint(${idx})" title="Excluir">🗑</button>
        </div>`;
    }).join('');
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ===== MAP =====
function toggleMap() {
    showMapFlag = !showMapFlag;
    $('map-toggle-text').textContent = showMapFlag ? 'Ocultar Mapa' : 'Mostrar Mapa';
    const mc = $('map-container');
    if (showMapFlag) { mc.classList.remove('hidden'); initMap(); updateMap(); }
    else { mc.classList.add('hidden'); }
}

function initMap() {
    if (mapInstance) return;
    mapInstance = L.map('map-container', { center: [-19.92, -43.94], zoom: 12, zoomControl: true, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(mapInstance);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(mapInstance);
    markersLayer = L.layerGroup().addTo(mapInstance);
    setTimeout(() => mapInstance.invalidateSize(), 200);
}

function updateMap() {
    if (!mapInstance || !markersLayer) return;
    markersLayer.clearLayers();
    if (polylineLayer) { mapInstance.removeLayer(polylineLayer); polylineLayer = null; }
    if (approvedPoints.length === 0) return;

    const latLngs = [];
    approvedPoints.forEach((p, idx) => {
        if (!p.lat || !p.lon) return;
        const ll = L.latLng(p.lat, p.lon);
        latLngs.push(ll);

        let color = '#3b82f6';
        if (appMode === 'ambiental') color = '#10b981';
        if (appMode === 'impedimentos') color = '#f59e0b';
        if (p.isDivisa) color = '#f97316';

        L.circleMarker(ll, { radius: 8, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9 })
            .bindTooltip(`${p.isDivisa ? 'D - Divisa' : '#' + (p.pointNumber || idx + 1)}<br/><small>E:${p.utmE} N:${p.utmN}</small>`, { direction: 'top', offset: [0, -8] })
            .addTo(markersLayer);

        const numIcon = L.divIcon({
            className: '', iconSize: [18, 18], iconAnchor: [9, 9],
            html: `<span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:white;font-size:10px;font-weight:800;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);pointer-events:none">${p.isDivisa ? 'D' : (p.pointNumber || idx + 1)}</span>`
        });
        L.marker(ll, { icon: numIcon, interactive: false }).addTo(markersLayer);
    });

    if (appMode === 'ambiental' && latLngs.length >= 2) {
        polylineLayer = L.polyline(latLngs, { color: '#ef4444', weight: 3, opacity: 0.8, dashArray: '8, 6' }).addTo(mapInstance);
    }

    if (latLngs.length === 1) mapInstance.setView(latLngs[0], 16);
    else if (latLngs.length > 1) mapInstance.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30], maxZoom: 17 });
}

function destroyMap() {
    if (mapInstance) { mapInstance.remove(); mapInstance = null; markersLayer = null; polylineLayer = null; }
    showMapFlag = false;
}

// ===== RESET PROJETO =====
function resetProjeto() {
    if (approvedPoints.length > 0) {
        const ok = confirm('Deseja iniciar um novo projeto?\nOs pontos atuais já estão salvos no banco.');
        if (!ok) return;
    }
    nsNumber = '';
    approvedPoints = [];
    editPointIndex = null;
    pdfFile = null; pdfDoc = null;
    pageNum = 1; totalPages = 0;
    $('ns-input').value = '';
    $('ns-hdr-badge').classList.add('hidden');
    $('btn-reset').classList.add('hidden');
    $('ns-cross-mode-warning').classList.add('hidden');
    $('pdf-wrapper').classList.add('hidden');
    $('upload-center').classList.remove('hidden');
    $('selection-toggle').classList.add('hidden');
    $('add-pdf-btn').classList.add('hidden');
    $('page-controls').classList.add('hidden');

    // Reset file inputs
    const mainInput = $('main-upload-btn')?.querySelector('input');
    if (mainInput) mainInput.value = '';
    const addInput = $('add-pdf-btn')?.querySelector('input');
    if (addInput) addInput.value = '';

    destroyMap();
    showSidebar('ns_input');
}
