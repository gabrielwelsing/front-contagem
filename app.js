// ===== CONFIGURAÇÃO =====
const API_URL = 'https://back-contagem-production.up.railway.app';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PRECO_PROJETADO = 0.35;
const PRECO_EXISTENTE = 0.20;
const PRECO_RURAL = 1.40;

const CATEGORIAS_DEFAULT = ["AC","EXT.RURAL","EXT.URB","MOD.URB","AFAST/REM","RL/BRT","PASTO","ESTRADA"];
const TOPOGRAFOS_DEFAULT = ["ALEX TEIXEIRA","BRUNO","CAIO","ESMENDIO","FABIANO","FREELANCER","GENIVALDO","HENRIQUE","JUNIOR","KENEDY","MAURICIO","MAURO"];

let CATEGORIAS = [...CATEGORIAS_DEFAULT];
let TOPOGRAFOS = [...TOPOGRAFOS_DEFAULT];

// ===== ESTADO =====
let pages = [];
let currentPage = 0;
let zoom = 1;
let catsSelecionadas = [];
let topoSelecionado = '';
let ambSelecionado = '';
let servSelecionado = '';
let historico = [];
let currentUser = null;

// ===== DOM =====
const $ = id => document.getElementById(id);

// ===== FEEDBACK VISUAL =====
function mostrarFeedback(msg, tipo = 'sucesso') {
    let el = document.getElementById('feedback-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'feedback-toast';
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999;transition:opacity .3s;box-shadow:0 4px 16px rgba(0,0,0,.2)';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = tipo === 'sucesso' ? '#16a34a' : '#dc2626';
    el.style.color = '#fff';
    el.style.opacity = '1';
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ===== INIT =====
function init() {
    $('ns-input').addEventListener('input', function() {
        this.classList.toggle('valid', this.value.length === 10);
    });

    const token = localStorage.getItem('hub_token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            currentUser = payload;
        } catch {}
    }

    carregarConfigsEmpresa().then(() => {
        buildCatsBar();
        buildTopoBar();
        if (currentUser && currentUser.role === 'admin_empresa') {
            $('btn-config').classList.remove('hidden');
        }
        buildAmbBar();
        buildServBar();
        carregarHistorico();
    });
}

// ===== CONFIGS POR EMPRESA =====
async function carregarConfigsEmpresa() {
    if (!currentUser || !currentUser.empresa) return;
    const empresa = encodeURIComponent(currentUser.empresa);
    const token = localStorage.getItem('hub_token');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};

    try {
        const [rCat, rTop] = await Promise.all([
            fetch(`${API_URL}/api/configs/${empresa}/categorias`, { headers }),
            fetch(`${API_URL}/api/configs/${empresa}/topografos`, { headers })
        ]);
        if (rCat.ok) { const d = await rCat.json(); if (d.valores) CATEGORIAS = d.valores; }
        if (rTop.ok) { const d = await rTop.json(); if (d.valores) TOPOGRAFOS = d.valores; }
    } catch {}
}

async function salvarConfigEmpresa(tipo, valores) {
    if (!currentUser || !currentUser.empresa) return false;
    const empresa = encodeURIComponent(currentUser.empresa);
    const token = localStorage.getItem('hub_token');
    try {
        const res = await fetch(`${API_URL}/api/configs/${empresa}/${tipo}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ valores })
        });
        return res.ok;
    } catch { return false; }
}

// ===== PAINEL DE CONFIGURAÇÃO =====
function abrirConfig() {
    $('config-cats-list').value = CATEGORIAS.join('\n');
    $('config-topos-list').value = TOPOGRAFOS.join('\n');
    $('modal-config').classList.remove('hidden');
}

function fecharConfig() {
    $('modal-config').classList.add('hidden');
}

async function salvarConfig() {
    const novasCats = $('config-cats-list').value
        .split('\n').map(v => v.trim().toUpperCase()).filter(v => v.length > 0);
    const novosTopos = $('config-topos-list').value
        .split('\n').map(v => v.trim().toUpperCase()).filter(v => v.length > 0);

    if (novasCats.length === 0) { alert('Categorias não pode ficar vazia.'); return; }
    if (novosTopos.length === 0) { alert('Topógrafos não pode ficar vazio.'); return; }

    const [okCat, okTop] = await Promise.all([
        salvarConfigEmpresa('categorias', novasCats),
        salvarConfigEmpresa('topografos', novosTopos)
    ]);

    if (okCat && okTop) {
        CATEGORIAS = novasCats;
        TOPOGRAFOS = novosTopos;
        catsSelecionadas = [];
        topoSelecionado = '';
        buildCatsBar();
        buildTopoBar();
        fecharConfig();
    } else {
        alert('Erro ao salvar configurações.');
    }
}

// ===== MENU DE CONTEXTO =====
let ctxMenu = null;

function fecharMenuContexto() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
}

document.addEventListener('click', fecharMenuContexto);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenuContexto(); });

function abrirMenuContexto(e, tipo) {
    e.preventDefault();
    if (!currentUser || currentUser.role !== 'admin_empresa') return;

    fecharMenuContexto();

    const lista = tipo === 'categorias' ? CATEGORIAS
                : tipo === 'topografos' ? TOPOGRAFOS
                : tipo === 'ambiental'  ? AMB_OPCOES
                : SERV_OPCOES;

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    const addItem = (icon, label, fn) => {
        const item = document.createElement('div');
        item.className = 'ctx-item';
        item.innerHTML = `<span class="ctx-icon">${icon}</span>${label}`;
        item.onclick = (ev) => { ev.stopPropagation(); fecharMenuContexto(); fn(); };
        menu.appendChild(item);
    };

    addItem('＋', 'Incluir', () => acaoIncluir(tipo));
    addItem('✏️', 'Editar', () => acaoEditar(tipo, lista));
    addItem('－', 'Remover', () => acaoRemover(tipo, lista));

    document.body.appendChild(menu);
    ctxMenu = menu;
}

function acaoIncluir(tipo) {
    const novo = prompt('Nome do novo item:');
    if (!novo || !novo.trim()) return;
    const val = novo.trim().toUpperCase();
    const lista = obterLista(tipo);
    if (lista.includes(val)) { alert('Item já existe.'); return; }
    lista.push(val);
    persistirESincronizar(tipo, lista);
}

function acaoEditar(tipo, lista) {
    const idx = escolherItem(lista, 'Editar qual item?');
    if (idx === null) return;
    const novo = prompt('Novo nome:', lista[idx]);
    if (!novo || !novo.trim()) return;
    const val = novo.trim().toUpperCase();
    lista[idx] = val;
    persistirESincronizar(tipo, lista);
}

function acaoRemover(tipo, lista) {
    if (lista.length <= 1) { alert('A lista não pode ficar vazia.'); return; }
    const idx = escolherItem(lista, 'Remover qual item?');
    if (idx === null) return;
    lista.splice(idx, 1);
    persistirESincronizar(tipo, lista);
}

function escolherItem(lista, titulo) {
    const opcoes = lista.map((v, i) => `${i + 1}. ${v}`).join('\n');
    const entrada = prompt(`${titulo}\n\n${opcoes}\n\nDigite o número:`);
    if (!entrada) return null;
    const idx = parseInt(entrada) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lista.length) { alert('Número inválido.'); return null; }
    return idx;
}

function obterLista(tipo) {
    if (tipo === 'categorias') return CATEGORIAS;
    if (tipo === 'topografos') return TOPOGRAFOS;
    if (tipo === 'ambiental')  return AMB_OPCOES;
    return SERV_OPCOES;
}

async function persistirESincronizar(tipo, lista) {
    if (tipo === 'ambiental' || tipo === 'servidao') {
        rebuilBarPorTipo(tipo);
        return;
    }
    const ok = await salvarConfigEmpresa(tipo, lista);
    if (!ok) { alert('Erro ao salvar no servidor.'); return; }
    rebuilBarPorTipo(tipo);
}

function rebuilBarPorTipo(tipo) {
    if (tipo === 'categorias') { catsSelecionadas = []; buildCatsBar(); }
    else if (tipo === 'topografos') { topoSelecionado = ''; buildTopoBar(); }
    else if (tipo === 'ambiental') { ambSelecionado = ''; buildAmbBar(); }
    else if (tipo === 'servidao') { servSelecionado = ''; buildServBar(); }
}

// ===== BARRAS =====
let AMB_OPCOES  = ['SIM', 'NÃO'];
let SERV_OPCOES = ['SST', 'SSC', 'SSTC'];

function buildCatsBar() {
    const bar = $('cats-bar');
    bar.querySelectorAll('.bar-btn').forEach(b => b.remove());
    bar.oncontextmenu = e => abrirMenuContexto(e, 'categorias');
    CATEGORIAS.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'bar-btn';
        btn.textContent = cat;
        btn.onclick = () => {
            if (catsSelecionadas.includes(cat)) {
                catsSelecionadas = catsSelecionadas.filter(c => c !== cat);
                btn.classList.remove('active');
            } else {
                catsSelecionadas.push(cat);
                btn.classList.add('active');
            }
        };
        bar.appendChild(btn);
    });
}

function buildTopoBar() {
    const bar = $('topo-bar');
    bar.querySelectorAll('.bar-btn').forEach(b => b.remove());
    bar.oncontextmenu = e => abrirMenuContexto(e, 'topografos');
    TOPOGRAFOS.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'bar-btn';
        btn.textContent = name;
        btn.onclick = () => {
            bar.querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            topoSelecionado = name;
        };
        bar.appendChild(btn);
    });
}

function buildAmbBar() {
    const bar = $('amb-bar');
    bar.querySelectorAll('.bar-btn').forEach(b => b.remove());
    bar.oncontextmenu = e => abrirMenuContexto(e, 'ambiental');
    AMB_OPCOES.forEach(val => {
        const btn = document.createElement('button');
        btn.className = 'bar-btn';
        btn.textContent = val;
        btn.onclick = () => {
            ambSelecionado = val;
            bar.querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-green'));
            btn.classList.add(val === 'SIM' ? 'active-green' : 'active');
        };
        bar.appendChild(btn);
    });
}

function buildServBar() {
    const bar = $('serv-bar');
    bar.querySelectorAll('.bar-btn').forEach(b => b.remove());
    bar.oncontextmenu = e => abrirMenuContexto(e, 'servidao');
    SERV_OPCOES.forEach(val => {
        const btn = document.createElement('button');
        btn.className = 'bar-btn';
        btn.textContent = val;
        btn.onclick = () => {
            servSelecionado = val;
            bar.querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-amber'));
            btn.classList.add('active-amber');
        };
        bar.appendChild(btn);
    });
}

function setAmbiental(val, btn) {
    ambSelecionado = val;
    $('amb-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-green'));
    btn.classList.add(val === 'SIM' ? 'active-green' : 'active');
}

function setServidao(val, btn) {
    servSelecionado = val;
    $('serv-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-amber'));
    btn.classList.add('active-amber');
}

// ===== UPLOAD =====
async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    pages = [];
    currentPage = 0;

    const isSinglePdf = files.length === 1 && files[0].type === 'application/pdf';

    if (isSinglePdf) {
        const data = await readFileAsArrayBuffer(files[0]);
        const pdf = await pdfjsLib.getDocument(new Uint8Array(data)).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            pages.push({ imgData: canvas.toDataURL('image/png'), postes: [], w: vp.width, h: vp.height });
        }
    } else {
        const allImages = [];
        for (const file of files) {
            if (file.type === 'application/pdf') {
                const data = await readFileAsArrayBuffer(file);
                const pdf = await pdfjsLib.getDocument(new Uint8Array(data)).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const vp = page.getViewport({ scale: 2 });
                    const c = document.createElement('canvas');
                    c.width = vp.width; c.height = vp.height;
                    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                    allImages.push({ data: c.toDataURL('image/png'), w: vp.width, h: vp.height });
                }
            } else {
                const imgData = await readFileAsDataURL(file);
                const dim = await getImageDimensions(imgData);
                allImages.push({ data: imgData, w: dim.w, h: dim.h });
            }
        }

        try { generateUnifiedPdf(allImages); } catch(e) { console.warn('Erro ao gerar PDF unificado:', e); }

        for (const img of allImages) {
            pages.push({ imgData: img.data, postes: [], w: img.w, h: img.h });
        }
    }

    if (pages.length > 0) mostrarTelaDesenho();
}

function generateUnifiedPdf(images) {
    const { jsPDF } = window.jspdf;
    let pdf = null;

    images.forEach((img, i) => {
        const pxToMm = 25.4 / 96;
        const pageW = img.w * pxToMm;
        const pageH = img.h * pxToMm;
        const orientation = pageW >= pageH ? 'l' : 'p';

        if (i === 0) {
            pdf = new jsPDF(orientation, 'mm', [pageW, pageH]);
        } else {
            pdf.addPage([pageW, pageH], orientation);
        }

        pdf.addImage(img.data, 'PNG', 0, 0, pageW, pageH);
    });

    if (pdf) pdf.save('Croqui_Unificado.pdf');
}

// ===== NAVIGATION =====
function mostrarTelaDesenho() {
    $('tela-upload').classList.add('hidden');
    $('tela-desenho').classList.remove('hidden');
    $('hdr-row2').classList.remove('hidden');
    $('btn-voltar').classList.remove('hidden');
    $('btn-salvar').classList.remove('hidden');

    zoomReset();
    renderCurrentPage();
    atualizarSidebar();
    atualizarTotal();
}

function voltarUpload() {
    $('tela-upload').classList.remove('hidden');
    $('tela-desenho').classList.add('hidden');
    $('hdr-row2').classList.add('hidden');
    $('btn-voltar').classList.add('hidden');
    $('btn-salvar').classList.add('hidden');
    $('file-input').value = '';
    carregarHistorico();
}

// ===== PAGE NAVIGATION =====
function prevPage() { if (currentPage > 0) { currentPage--; renderCurrentPage(); atualizarSidebar(); } }
function nextPage() { if (currentPage < pages.length - 1) { currentPage++; renderCurrentPage(); atualizarSidebar(); } }
function updatePageInfo() {
    $('page-info').textContent = `${currentPage + 1}/${pages.length}`;
    $('btn-prev').disabled = currentPage === 0;
    $('btn-next').disabled = currentPage >= pages.length - 1;
}

// ===== ZOOM =====
function zoomIn() { zoom = Math.min(zoom + 0.15, 3); applyZoom(); }
function zoomOut() { zoom = Math.max(zoom - 0.15, 0.3); applyZoom(); }
function zoomReset() {
    if (pages.length === 0) { zoom = 1; return; }
    const area = $('canvas-area');
    const p = pages[currentPage];
    const fitW = (area.clientWidth - 100) / p.w;
    const fitH = (area.clientHeight - 100) / p.h;
    zoom = Math.min(fitW, fitH, 1);
    applyZoom();
}
function applyZoom() {
    $('zoom-info').textContent = Math.round(zoom * 100) + '%';
    const wrapper = $('canvas-wrapper');
    wrapper.style.transform = `scale(${zoom})`;
}

// ===== RENDER PAGE =====
function renderCurrentPage() {
    if (pages.length === 0) return;
    const p = pages[currentPage];
    const img = new Image();
    img.onload = () => {
        const baseCanvas = $('canvas-base');
        const overlayCanvas = $('canvas-overlay');
        baseCanvas.width = p.w; baseCanvas.height = p.h;
        overlayCanvas.width = p.w; overlayCanvas.height = p.h;

        const ctx = baseCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, p.w, p.h);
        redesenharOverlay();
    };
    img.src = p.imgData;
    updatePageInfo();
}

function redesenharOverlay() {
    const canvas = $('canvas-overlay');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const postes = pages[currentPage]?.postes || [];
    postes.forEach((p, i) => {
        const globalIdx = getGlobalIndex(currentPage, i);
        const cor = p.tipo === 'existente' ? '#f97316' : (p.tipo === 'rural' ? '#2563eb' : '#10b981');
        const sz = 24;
        ctx.fillStyle = cor;
        ctx.fillRect(p.x - sz/2, p.y - sz/2, sz, sz);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - sz/2, p.y - sz/2, sz, sz);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${globalIdx + 1}`, p.x, p.y);
    });
}

function getGlobalIndex(pageIdx, localIdx) {
    let count = 0;
    for (let i = 0; i < pageIdx; i++) count += pages[i].postes.length;
    return count + localIdx;
}

// ===== CANVAS CLICK =====
$('canvas-overlay').addEventListener('mousedown', function(e) {
    e.preventDefault();
    if (pages.length === 0) return;
    const rect = this.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    let tipo = 'projetado';
    if (e.button === 2) tipo = 'existente';
    else if (e.shiftKey) tipo = 'rural';

    pages[currentPage].postes.push({ x, y, tipo });
    redesenharOverlay();
    atualizarSidebar();
    atualizarTotal();
});

// ===== SIDEBAR =====
function getAllPostes() {
    let all = [];
    pages.forEach((p, pi) => p.postes.forEach((pt, li) => all.push({ ...pt, page: pi, localIdx: li })));
    return all;
}

function atualizarSidebar() {
    const postes = pages[currentPage]?.postes || [];
    const allPostes = getAllPostes();
    const list = $('sb-list');

    const nProj = allPostes.filter(p => p.tipo === 'projetado').length;
    const nExist = allPostes.filter(p => p.tipo === 'existente').length;
    const nRural = allPostes.filter(p => p.tipo === 'rural').length;
    $('sb-summary').innerHTML = `
        <span><div class="dot proj"></div>${nProj} Proj</span>
        <span><div class="dot exist"></div>${nExist} Exist</span>
        <span><div class="dot rur"></div>${nRural} Rural</span>
    `;

    if (postes.length === 0) {
        list.innerHTML = '<div class="sb-empty">Clique na imagem para adicionar</div>';
        return;
    }

    const precos = { projetado: '0,35', existente: '0,20', rural: '1,40' };
    let offset = 0;
    for (let i = 0; i < currentPage; i++) offset += pages[i].postes.length;

    list.innerHTML = postes.map((p, i) => `
        <div class="poste-item">
            <div class="poste-left">
                <div class="poste-num">${offset + i + 1}</div>
                <div>
                    <div class="poste-tipo ${p.tipo}">${p.tipo}</div>
                    <div class="poste-valor">US ${precos[p.tipo]}</div>
                </div>
            </div>
            <button class="poste-del" onclick="removerPoste(${i})">🗑</button>
        </div>
    `).join('');
}

function removerPoste(localIdx) {
    pages[currentPage].postes.splice(localIdx, 1);
    redesenharOverlay();
    atualizarSidebar();
    atualizarTotal();
}

function atualizarTotal() {
    const allPostes = getAllPostes();
    const total = (allPostes.filter(p => p.tipo === 'projetado').length * PRECO_PROJETADO) +
                  (allPostes.filter(p => p.tipo === 'existente').length * PRECO_EXISTENTE) +
                  (allPostes.filter(p => p.tipo === 'rural').length * PRECO_RURAL) +
                  parseKmValue();
    $('total-us').textContent = `US ${fmtVal(total)}`;
}

function parseKmValue() {
    const raw = $('km-input').value.replace(',', '.').trim();
    const val = parseFloat(raw);
    return isNaN(val) ? 0 : val;
}

function fmtVal(v) { return v.toFixed(2).replace('.', ','); }

// ===== SAVE =====
async function salvarProjeto() {
    const ns = $('ns-input').value;
    if (ns.length !== 10) { alert('NS deve ter exatamente 10 dígitos.'); return; }
    if (catsSelecionadas.length === 0) { alert('Selecione pelo menos uma Categoria.'); return; }
    if (!topoSelecionado) { alert('Selecione um Topógrafo.'); return; }
    if (!ambSelecionado) { alert('Selecione Ambiental (SIM ou NÃO).'); return; }
    if (getAllPostes().length === 0) { alert('Adicione pelo menos um poste.'); return; }

    baixarImagemCosturada(ns);

    const allPostes = getAllPostes().map(p => ({ x: p.x, y: p.y, tipo: p.tipo, page: p.page }));
    const total = (allPostes.filter(p => p.tipo === 'projetado').length * PRECO_PROJETADO) +
                  (allPostes.filter(p => p.tipo === 'existente').length * PRECO_EXISTENTE) +
                  (allPostes.filter(p => p.tipo === 'rural').length * PRECO_RURAL) +
                  parseKmValue();

    const projeto = {
        ns,
        data_registro: new Date().toLocaleDateString('pt-BR'),
        postes: allPostes,
        total,
        categorias_globais: catsSelecionadas,
        topografo: topoSelecionado,
        ambiental: ambSelecionado,
        servidao: servSelecionado,
        km_valor: parseKmValue()
    };

    const token = localStorage.getItem('hub_token');
    const btnSalvar = $('btn-salvar');
    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = '⏳ Salvando...';

    try {
        const res = await fetch(`${API_URL}/api/projetos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify(projeto)
        });

        if (res.ok) {
            mostrarFeedback('✅ Projeto salvo com sucesso!', 'sucesso');
        } else {
            const data = await res.json();
            const msg = data.errors ? data.errors.join(', ') : (data.error || 'Erro ao salvar');
            mostrarFeedback('❌ ' + msg, 'erro');
            btnSalvar.disabled = false;
            btnSalvar.textContent = textoOriginal;
            return;
        }
    } catch (err) {
        mostrarFeedback('❌ Backend offline. Projeto não salvo.', 'erro');
        btnSalvar.disabled = false;
        btnSalvar.textContent = textoOriginal;
        return;
    }

    btnSalvar.disabled = false;
    btnSalvar.textContent = textoOriginal;

    pages = []; currentPage = 0;
    catsSelecionadas = [];
    topoSelecionado = ''; ambSelecionado = ''; servSelecionado = '';
    $('ns-input').value = ''; $('ns-input').classList.remove('valid');
    $('km-input').value = '';
    $('cats-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active'));
    $('topo-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active'));
    $('amb-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-green'));
    $('serv-bar').querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active', 'active-amber'));
    voltarUpload();
}

function baixarImagemCosturada(ns) {
    if (pages.length === 0) return;
    const totalH = pages.reduce((s, p) => s + p.h, 0);
    const maxW = Math.max(...pages.map(p => p.w));
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = maxW; finalCanvas.height = totalH;
    const ctx = finalCanvas.getContext('2d');

    (async () => {
        let yOffset = 0;
        for (let pi = 0; pi < pages.length; pi++) {
            await new Promise(resolve => {
                const p = pages[pi];
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, yOffset, p.w, p.h);
                    p.postes.forEach((pt, li) => {
                        const globalIdx = getGlobalIndex(pi, li);
                        const cor = pt.tipo === 'existente' ? '#f97316' : (pt.tipo === 'rural' ? '#2563eb' : '#10b981');
                        ctx.fillStyle = cor;
                        ctx.fillRect(pt.x - 12, yOffset + pt.y - 12, 24, 24);
                        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                        ctx.strokeRect(pt.x - 12, yOffset + pt.y - 12, 24, 24);
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 11px Arial';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText(`${globalIdx + 1}`, pt.x, yOffset + pt.y);
                    });
                    yOffset += p.h;
                    resolve();
                };
                img.src = p.imgData;
            });
        }
        const link = document.createElement('a');
        link.download = `Croqui_${ns}.png`;
        link.href = finalCanvas.toDataURL('image/png');
        link.click();
    })();
}

// ===== HISTÓRICO =====
async function carregarHistorico() {
    try {
        let url = `${API_URL}/api/projetos`;
        const de = $('filtro-de').value;
        const ate = $('filtro-ate').value;
        const params = [];
        if (de) params.push(`de=${formatDateBR(de)}`);
        if (ate) params.push(`ate=${formatDateBR(ate)}`);
        if (params.length > 0) url += '?' + params.join('&');

        const token = localStorage.getItem('hub_token');
        const res = await fetch(url, {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (res.ok) {
            const data = await res.json();
            historico = data.projetos || [];
        } else { historico = []; }
    } catch (err) { console.warn('⚠️ Backend offline.'); historico = []; }
    renderizarHistorico();
}

function formatDateBR(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

function filtroHoje() {
    const today = new Date().toISOString().split('T')[0];
    $('filtro-de').value = today;
    $('filtro-ate').value = today;
    carregarHistorico();
}

function filtroLimpar() {
    $('filtro-de').value = '';
    $('filtro-ate').value = '';
    carregarHistorico();
}

function renderizarHistorico() {
    const list = $('hist-list');
    if (historico.length === 0) {
        list.innerHTML = '<div class="hist-empty">Nenhum projeto salvo</div>';
        return;
    }

    list.innerHTML = historico.map(proj => {
        const cats = (proj.categorias_globais || []).map(c => `<span class="hist-tag cat">${c}</span>`).join('');
        const topoTag = proj.topografo ? `<span class="hist-tag top">${proj.topografo}</span>` : '';
        const ambTag = proj.ambiental === 'SIM' ? '<span class="hist-tag amb">AMB ✓</span>' : '';
        const servTag = proj.servidao ? `<span class="hist-tag ser">${proj.servidao}</span>` : '';
        const kmTag = parseFloat(proj.km_valor) > 0 ? `<span class="hist-tag km">KM ${fmtVal(parseFloat(proj.km_valor))}</span>` : '';
        const postesArr = proj.postes || [];
        const total = parseFloat(proj.total) || 0;

        return `<div class="hist-item">
            <div>
                <div class="hist-ns">NS: ${proj.ns}</div>
                <div class="hist-meta">${postesArr.length} ITENS • ${proj.data_registro}</div>
                <div class="hist-tags">${cats}${topoTag}${ambTag}${servTag}${kmTag}</div>
            </div>
            <div style="text-align:right">
                <div class="hist-total">US ${fmtVal(total)}</div>
            </div>
            <button class="hist-del" onclick="apagarProjeto(${proj.id})">🗑</button>
        </div>`;
    }).join('');
}

async function apagarProjeto(id) {
    const token = localStorage.getItem('hub_token');
    try {
        const res = await fetch(`${API_URL}/api/projetos/${id}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (res.ok) mostrarFeedback('✅ Projeto removido.', 'sucesso');
        else mostrarFeedback('❌ Erro ao remover projeto.', 'erro');
    } catch {
        mostrarFeedback('❌ Backend offline.', 'erro');
    }
    carregarHistorico();
}

// ===== EXPORT EXCEL =====
function exportarExcel() {
    if (typeof XLSX === 'undefined') { alert('Carregando módulo Excel...'); return; }
    if (historico.length === 0) { alert('Nenhum projeto para exportar.'); return; }

    const dados = historico.map(h => ({
        "NS": h.ns,
        "Data": h.data_registro,
        "Topógrafo": h.topografo || '',
        "Ambiental": h.ambiental || 'NÃO',
        "Servidão": h.servidao || '',
        "Itens": (h.postes || []).length,
        "KM (US)": fmtVal(parseFloat(h.km_valor) || 0),
        "Total (US)": fmtVal(parseFloat(h.total) || 0),
        "Categorias": (h.categorias_globais || []).join(', ') || 'Nenhuma'
    }));

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, "Levantamento_ProEng.xlsx");
}

// ===== RELATÓRIO 7 DIAS =====
async function gerarRelatorio7Dias() {
    let allProjects = [];
    try {
        const token = localStorage.getItem('hub_token');
        const res = await fetch(`${API_URL}/api/projetos`, {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (res.ok) { const d = await res.json(); allProjects = d.projetos || []; }
    } catch { alert('Backend offline.'); return; }

    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('pt-BR'));
    }

    const data = {};
    TOPOGRAFOS.forEach(t => {
        data[t] = {};
        days.forEach(d => data[t][d] = 0);
    });

    allProjects.forEach(p => {
        const topo = p.topografo || '';
        const dateStr = p.data_registro;
        if (topo && data[topo] && days.includes(dateStr)) {
            data[topo][dateStr] += 1;
        }
    });

    let html = `<table><caption>Relatório 7 Dias — ${days[0]} a ${days[6]}</caption><tr><th>Topógrafo</th>`;
    days.forEach(d => html += `<th>${d}</th>`);
    html += '<th>TOTAL</th></tr>';

    TOPOGRAFOS.forEach(t => {
        html += `<tr><td style="text-align:left;font-weight:700">${t}</td>`;
        let rowTotal = 0;
        days.forEach(d => {
            const v = data[t][d];
            rowTotal += v;
            html += `<td>${v || ''}</td>`;
        });
        html += `<td class="total-cell">${rowTotal}</td></tr>`;
    });

    html += '<tr><td class="total-cell">TOTAL</td>';
    let grandTotal = 0;
    days.forEach(d => {
        let colTotal = 0;
        TOPOGRAFOS.forEach(t => colTotal += data[t][d]);
        grandTotal += colTotal;
        html += `<td class="total-cell">${colTotal || ''}</td>`;
    });
    html += `<td class="total-cell" style="background:#1e293b;color:#fff">${grandTotal}</td></tr></table>`;

    $('rel7-container').innerHTML = html;

    setTimeout(async () => {
        try {
            const canvas = await html2canvas($('rel7-container'), { scale: 2, backgroundColor: '#ffffff' });
            const link = document.createElement('a');
            link.download = 'Relatorio_7Dias.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) { alert('Erro ao gerar relatório.'); console.error(err); }
    }, 300);
}

// ===== UTILS =====
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsArrayBuffer(file);
    });
}
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}
function getImageDimensions(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = dataUrl;
    });
}

// ===== START =====
init();
