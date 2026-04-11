// ================= CONFIGURATION =================
if (typeof CONFIG === 'undefined') {
  alert('Erreur : fichier de configuration manquant. Créez config.js à partir de config.example.js');
  throw new Error('CONFIG is not defined');
}

const API_BASE = CONFIG.API_URL;
const ACCESS_CODE = CONFIG.ACCESS_CODE;
const AUTO_REFRESH_INTERVAL = 80000; // 30 secondes

// ================= PROXY CORS =================
function getProxiedUrl(action) {
  const target = API_BASE + "?action=" + action;
  return "https://corsproxy.io/?" + encodeURIComponent(target);
}

// ================= ÉTAT GLOBAL =================
let caisseData = [];
let cct1Data = [];
let filtered = { caisse: [], cct1: [] };
let currentEdit = { type: null, rowId: null };
let sortState = {
  caisse: { column: null, direction: 'asc' },
  cct1: { column: null, direction: 'asc' }
};
let autoRefreshTimer = null;
let scrollPositions = { caisse: { left: 0, top: 0 }, cct1: { left: 0, top: 0 } };

// ================= UTILITAIRES =================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function showMessage(text, isError = false) {
  const msg = document.getElementById('message');
  if (!msg) return;
  msg.textContent = text;
  msg.style.backgroundColor = isError ? '#ef4444' : '#10b981';
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 3000);
}

// ================= GESTION SOUS-MENUS =================
function toggleSubmenu(id) {
  const submenu = document.getElementById(id);
  const arrow = submenu.previousElementSibling.querySelector('.submenu-arrow');
  document.querySelectorAll('.submenu').forEach(sm => {
    if (sm.id !== id) {
      sm.style.display = 'none';
      const arr = sm.previousElementSibling.querySelector('.submenu-arrow');
      if (arr) arr.style.transform = 'rotate(0deg)';
    }
  });
  if (submenu.style.display === 'none') {
    submenu.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    submenu.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

// ================= GESTION IFRAME =================
function iframeLoaded() {
  showMessage('Données envoyées avec succès !');
  loadAllData();
  document.querySelectorAll('form').forEach(f => f.reset());
}

function setupIframe() {
  const iframe = document.getElementById('hidden_iframe');
  if (iframe) iframe.addEventListener('load', iframeLoaded);
}

// ================= AUTHENTIFICATION =================
function setupAuth() {
  document.getElementById('loginBtn').onclick = () => {
    if (prompt('Code d\'accès :') === ACCESS_CODE) {
      document.getElementById('app').style.display = 'flex';
      document.getElementById('loginBtn').style.display = 'none';
      document.getElementById('logoutBtn').style.display = 'inline-flex';
      loadAllData();
      startAutoRefresh();
      setTimeout(() => {
        const submenu = document.getElementById('submenuCaisse');
        if (submenu) {
          submenu.style.display = 'block';
          const arrow = submenu.previousElementSibling.querySelector('.submenu-arrow');
          if (arrow) arrow.style.transform = 'rotate(180deg)';
        }
        showForm('caisse');
      }, 100);
    } else {
      alert('Code incorrect');
    }
  };
  document.getElementById('logoutBtn').onclick = () => {
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginBtn').style.display = 'inline-flex';
    document.getElementById('logoutBtn').style.display = 'none';
    stopAutoRefresh();
  };
}

// ================= RAFRAÎCHISSEMENT AUTOMATIQUE =================
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (document.getElementById('app').style.display === 'flex') silentRefresh();
  }, AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function hasDataChanged(oldData, newData) {
  if (oldData.length !== newData.length) return true;
  const sample = Math.min(3, oldData.length);
  for (let i = 0; i < sample; i++) {
    if (JSON.stringify(oldData[i]) !== JSON.stringify(newData[i])) return true;
  }
  if (oldData.length > sample) {
    const last = oldData.length - 1;
    if (JSON.stringify(oldData[last]) !== JSON.stringify(newData[last])) return true;
  }
  return false;
}

async function silentRefresh() {
  try {
    const res = await fetch(getProxiedUrl("getAll"));
    if (!res.ok) return;
    const json = await res.json();
    const payload = json.data || json;
    const newCaisse = (payload.caisse || []).map((r, i) => ({ ...r, _row: i + 1 }));
    const newCct1 = (payload.cct1 || []).map((r, i) => ({ ...r, _row: i + 1 }));

    if (hasDataChanged(caisseData, newCaisse)) {
      caisseData = newCaisse;
      initFilters('caisse');
      if (document.getElementById('consultCaisse').style.display === 'block') {
        saveScroll('caisse');
        applyFilter('caisse');
        setTimeout(() => restoreScroll('caisse'), 30);
      }
    }
    if (hasDataChanged(cct1Data, newCct1)) {
      cct1Data = newCct1;
      initFilters('cct1');
      if (document.getElementById('consultCCT1').style.display === 'block') {
        saveScroll('cct1');
        applyFilter('cct1');
        setTimeout(() => restoreScroll('cct1'), 30);
      }
    }
    console.log('Rafraîchissement silencieux terminé');
  } catch (e) {
    console.warn('Refresh failed:', e);
  }
}

function saveScroll(type) {
  const cont = document.getElementById(type === 'caisse' ? 'tableCaisse' : 'tableCCT1');
  if (cont) {
    scrollPositions[type].left = cont.scrollLeft;
    scrollPositions[type].top = cont.scrollTop;
  }
}
function restoreScroll(type) {
  const cont = document.getElementById(type === 'caisse' ? 'tableCaisse' : 'tableCCT1');
  if (cont) {
    cont.scrollLeft = scrollPositions[type].left;
    cont.scrollTop = scrollPositions[type].top;
  }
}

// ================= CHARGEMENT COMPLET =================
async function loadAllData() {
  const url = "https://script.google.com/macros/s/AKfycbwKCnS8t9sUpOCRKy7qOVWosBm0c2jrMe9iIr_FYxQc_uu7mPlNv7x9kdccky2rleoPMw/exec?action=getAll";

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }

  const data = await res.json();
  console.log(data);
}

// ================= NAVIGATION =================
function showForm(page) {
  ['formCaisse','formCCT1','consultCaisse','consultCCT1'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  if (page === 'caisse') document.getElementById('formCaisse').style.display = 'block';
  if (page === 'cct1') document.getElementById('formCCT1').style.display = 'block';
  if (page === 'consultCaisse') {
    document.getElementById('consultCaisse').style.display = 'block';
    updateTotalCount('caisse');
  }
  if (page === 'consultCCT1') {
    document.getElementById('consultCCT1').style.display = 'block';
    updateTotalCount('cct1');
  }
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  setTimeout(updateFixedPositions, 60);
}

// ================= FILTRES =================
function initFilters(type) {
  const data = type === 'caisse' ? caisseData : cct1Data;
  const select = document.getElementById(type === 'caisse' ? 'filterSocieteCaisse' : 'filterSocieteCCT1');
  if (!select) return;
  const societes = [...new Set(data.map(r => String(r.SOCIETE || r.SOCIETES || '').trim()).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Toutes les sociétés</option>';
  societes.forEach(s => select.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`);
}

function setupSearch(type) {
  const input = document.getElementById(type === 'caisse' ? 'searchCaisse' : 'searchCCT1');
  if (input) {
    input.replaceWith(input.cloneNode(true));
    document.getElementById(type === 'caisse' ? 'searchCaisse' : 'searchCCT1')
      .addEventListener('input', () => applyFilter(type));
  }
}

function applyFilter(type) {
  const data = type === 'caisse' ? caisseData : cct1Data;
  const search = document.getElementById(type === 'caisse' ? 'searchCaisse' : 'searchCCT1')?.value.toLowerCase() || '';
  const societe = document.getElementById(type === 'caisse' ? 'filterSocieteCaisse' : 'filterSocieteCCT1')?.value.toLowerCase() || '';

  filtered[type] = data.filter(row => {
    const text = type === 'caisse'
      ? `${row.CLIENT||''} ${row.LIBELLE||''} ${row.FACTURE||''}`.toLowerCase()
      : `${row.LIBELLE||''} ${row.COMMENTAIRES||''} ${row.SOCIETES||''}`.toLowerCase();
    const soc = String(row.SOCIETE || row.SOCIETES || '').toLowerCase();
    return (!search || text.includes(search)) && (!societe || soc === societe);
  });
  renderTable(type, filtered[type]);
  updateTotalCount(type, filtered[type].length);
  setTimeout(updateFixedPositions, 30);
}

function resetFilters(type) {
  document.getElementById(type === 'caisse' ? 'searchCaisse' : 'searchCCT1').value = '';
  document.getElementById(type === 'caisse' ? 'filterSocieteCaisse' : 'filterSocieteCCT1').value = '';
  sortState[type] = { column: null, direction: 'asc' };
  applyFilter(type);
}

// ================= TABLEAUX =================
function renderTable(type, dataOverride = null) {
  const data = dataOverride || (type === 'caisse' ? caisseData : cct1Data);
  const body = document.getElementById(type === 'caisse' ? 'tableCaisse' : 'tableCCT1');
  const wrapper = body.closest('.double-table-wrapper');
  if (!wrapper) return;

  const scrollLeft = body.scrollLeft;

  const sortCol = sortState[type].column;
  const sortDir = sortState[type].direction;
  const sorted = sortCol ? [...data].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return sortDir === 'asc' ? na - nb : nb - na;
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  }) : data;

  if (!sorted.length) {
    body.innerHTML = '<table><tbody><tr><td colspan="10" style="text-align:center">Aucune donnée</td></tr></tbody></table>';
    const oldFixed = wrapper.querySelector('.table-fixed-header');
    if (oldFixed) oldFixed.remove();
    return;
  }

  const headers = Object.keys(sorted[0]).filter(h => h !== '_row');

  body.innerHTML = `<table><tbody>${sorted.map(row => `
    <tr>
      <td><button class="edit-btn" onclick="editRow('${type}', ${row._row})"><i class="fas fa-edit"></i></button></td>
      ${headers.map(h => `<td>${escapeHtml(row[h])}</td>`).join('')}
    </tr>`).join('')}</tbody></table>`;
  body.scrollLeft = scrollLeft;

  let fixedDiv = wrapper.querySelector('.table-fixed-header');
  if (!fixedDiv) {
    fixedDiv = document.createElement('div');
    fixedDiv.className = 'table-fixed-header';
    wrapper.insertBefore(fixedDiv, body);
  }
  fixedDiv.innerHTML = `<table><thead><tr>
    <th data-column="_action">Action</th>
    ${headers.map(h => {
      const sortedIcon = (sortCol === h) ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-column="${escapeHtml(h)}" style="cursor:pointer;">${escapeHtml(h)}<span class="sort-indicator">${sortedIcon}</span></th>`;
    }).join('')}
  </tr></thead></table>`;

  fixedDiv.querySelectorAll('th[data-column]').forEach(th => {
    const col = th.dataset.column;
    if (col === '_action') return;
    th.addEventListener('click', e => {
      e.stopPropagation();
      const st = sortState[type];
      if (st.column === col) {
        st.direction = st.direction === 'asc' ? 'desc' : 'asc';
      } else {
        st.column = col;
        st.direction = 'asc';
      }
      applyFilter(type);
    });
  });

  const sync = (src, tgt) => { if (src && tgt) src.onscroll = () => tgt.scrollLeft = src.scrollLeft; };
  sync(body, fixedDiv);
  sync(fixedDiv, body);

  requestAnimationFrame(() => {
    updateFixedPositions();
    syncColumnWidths(type);
  });
}

function syncColumnWidths(type) {
  const body = document.getElementById(type === 'caisse' ? 'tableCaisse' : 'tableCCT1');
  const fixed = body?.closest('.double-table-wrapper')?.querySelector('.table-fixed-header');
  if (!body || !fixed) return;
  const bodyTable = body.querySelector('table');
  const headTable = fixed.querySelector('table');
  if (!bodyTable || !headTable) return;

  const cols = headTable.querySelectorAll('th').length;
  const maxW = new Array(cols).fill(0);

  headTable.querySelectorAll('th').forEach((th, i) => maxW[i] = th.getBoundingClientRect().width);
  bodyTable.querySelectorAll('tbody tr').forEach(tr => {
    tr.querySelectorAll('td').forEach((td, i) => {
      if (i < cols) maxW[i] = Math.max(maxW[i], td.getBoundingClientRect().width);
    });
  });

  [bodyTable, headTable].forEach(t => {
    let cg = t.querySelector('colgroup');
    if (!cg) { cg = document.createElement('colgroup'); t.prepend(cg); }
    cg.innerHTML = maxW.map(w => `<col style="width:${w}px;min-width:${w}px;max-width:${w}px">`).join('');
  });
}

function updateTotalCount(type, filteredLength = null) {
  const span = document.getElementById(`totalCount${type === 'caisse' ? 'Caisse' : 'CCT1'}`);
  if (span) span.textContent = filteredLength ?? (type === 'caisse' ? caisseData.length : cct1Data.length);
}

// ================= MODAL ÉDITION DEUX COLONNES =================
function editRow(type, rowId) {
  const row = (type === 'caisse' ? caisseData : cct1Data).find(r => r._row === rowId);
  if (!row) return;
  currentEdit = { type, rowId };
  const headers = Object.keys(row).filter(h => h !== '_row');
  
  const modalBody = document.querySelector('#modalEdit .modal-body');
  modalBody.innerHTML = '';
  
  headers.forEach((header, index) => {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'edit-field';
    if (header.includes('OBSERVATION') || header.includes('COMMENTAIRES') || header.includes('LIBELLE')) {
      fieldDiv.classList.add('full-width');
    }
    fieldDiv.innerHTML = `
      <label>${escapeHtml(header)}</label>
      <input type="text" id="edit_${index}" value="${escapeHtml(row[header] || '')}" data-header="${escapeHtml(header)}">
    `;
    modalBody.appendChild(fieldDiv);
  });
  
  document.getElementById('modalEdit').editHeaders = headers;
  document.getElementById('modalEdit').style.display = 'flex';
}

function saveEdit() {
  const modal = document.getElementById('modalEdit');
  if (!modal?.editHeaders) return;
  const headers = modal.editHeaders;
  const { type, rowId } = currentEdit;
  const arr = type === 'caisse' ? caisseData : cct1Data;
  const idx = arr.findIndex(r => r._row === rowId);
  if (idx !== -1) {
    headers.forEach((header, index) => {
      const input = document.getElementById(`edit_${index}`);
      if (input) arr[idx][header] = input.value;
    });
    fetch(getProxiedUrl("update"), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', sheet: type, row: arr[idx]._row, data: arr[idx] })
    }).catch(e => console.warn(e));
  }
  closeModal();
  loadAllData();
  showMessage('Modification enregistrée');
}

function closeModal() {
  document.getElementById('modalEdit').style.display = 'none';
  currentEdit = { type: null, rowId: null };
}

// ================= EXPORT =================
function exportExcel(type) {
  const data = filtered[type].length ? filtered[type] : (type === 'caisse' ? caisseData : cct1Data);
  if (!data.length) return showMessage('Aucune donnée', true);
  const headers = Object.keys(data[0]).filter(h => h !== '_row');
  const csv = [headers.join(','), ...data.map(r => headers.map(h => {
    const v = String(r[h] || '');
    return /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${type}_${new Date().toISOString().slice(0,19)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showMessage(`Export ${type} terminé`);
}

// ================= POSITIONS FIXES =================
function updateFixedPositions() {
  const section = document.querySelector('.consult-section[style*="display: block"]');
  if (!section) return;
  const type = section.id.includes('Caisse') ? 'caisse' : 'cct1';
  const header = document.querySelector('.main-header');
  const title = section.querySelector('.section-header');
  const filter = section.querySelector('.filter-bar');
  const fixed = section.querySelector('.table-fixed-header');
  if (!header || !title || !filter || !fixed) return;

  const top = header.offsetHeight + title.offsetHeight;
  filter.style.top = top + 'px';
  fixed.style.top = (top + filter.offsetHeight) + 'px';
  fixed.style.display = 'block';
  section.querySelector('.table-body').style.paddingTop = (top + filter.offsetHeight) + 'px';
  syncColumnWidths(type);
}

// ================= GESTION CONDITIONNELLE CAISSE =================
function setupConditionalCaisse() {
  const form = document.getElementById('formCaisse');
  if (!form) return;
  form.action = API_BASE;

  const modeSelect = form.querySelector('select[name="MODE DE PAIEMENT"]');
  const bqVersement = form.querySelector('input[name="BQ VERSEMENT"]');
  const dateVersement = form.querySelector('input[name="DATE DE VERSEMENT"]');
  const echeanceBanque = form.querySelector('input[name="ECHEANCE BANQUE"]');

  if (!modeSelect || !bqVersement || !dateVersement || !echeanceBanque) return;

  function updateConditionalFields() {
    const mode = modeSelect.value;
    [bqVersement, dateVersement, echeanceBanque].forEach(f => {
      f.disabled = false;
      f.style.backgroundColor = '';
    });

    if (mode === 'chèque') {
      bqVersement.disabled = true;
      bqVersement.style.backgroundColor = '#d1fae5';
      bqVersement.value = '';
    } else if (mode === 'espece') {
      [dateVersement, echeanceBanque, bqVersement].forEach(f => {
        f.disabled = true;
        f.style.backgroundColor = '#d1fae5';
        f.value = '';
      });
    }
  }

  modeSelect.addEventListener('change', updateConditionalFields);
  updateConditionalFields();

  form.addEventListener('submit', (e) => {
    const mode = modeSelect.value;
    const fields = [];
    if (mode === 'chèque') fields.push(bqVersement);
    else if (mode === 'espece') fields.push(dateVersement, echeanceBanque, bqVersement);

    const disabledStates = fields.map(f => f.disabled);
    fields.forEach(f => f.disabled = false);
    setTimeout(() => {
      fields.forEach((f, i) => {
        f.disabled = disabledStates[i];
        if (f.disabled) f.style.backgroundColor = '#d1fae5';
      });
    }, 10);
  });
}

function setupConditionalCCT1() {
  const form = document.getElementById('formCCT1');
  if (form) form.action = API_BASE;
}

// ================= INITIALISATION =================
function init() {
  setupAuth();
  setupIframe();
  setupConditionalCaisse();
  setupConditionalCCT1();
  document.querySelectorAll('form').forEach(f => f.addEventListener('submit', () => showMessage('Envoi...')));
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showForm(b.dataset.page)));
  window.addEventListener('resize', () => requestAnimationFrame(updateFixedPositions));
  window.addEventListener('beforeunload', stopAutoRefresh);
}

document.addEventListener('DOMContentLoaded', init);
window.onerror = (msg, url, line) => {
  console.error(msg, url, line);
  showMessage('Erreur interne', true);
};