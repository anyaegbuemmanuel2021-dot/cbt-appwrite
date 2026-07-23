/**
 * SOFTLY DIGITAL V3 — candidate-manager.js (Appwrite edition)
 * Features: No duplicates · Paginated load · Cloudinary passport images
 *           Centre dropdown everywhere · Bulk Excel import · Password toggle
 */
const CandidateManager = (() => {
  'use strict';

  let allCandidates = [];
  let filtered      = [];
  let editingId     = null;
  let centresCache  = [];
  let activeSearch  = '';
  let activeCentre  = 'all';
  let activeStatus  = 'all';
  let currentPage   = 0;
  const PAGE_SIZE   = 50;
  let totalCount    = 0;

  /* ── LOAD (paginated) ────────────────────────────────────────────── */
  async function load(page = 0) {
    const tbody = document.getElementById('candidatesBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" class="loading-placeholder">Loading candidates…</td></tr>';
    try {
      currentPage = page;
      const queries = [SD.Q.orderAsc('fullName'), SD.Q.limit(PAGE_SIZE), SD.Q.offset(page * PAGE_SIZE)];
      if (activeCentre !== 'all') queries.push(SD.Q.equal('centreId', activeCentre));
      if (activeStatus !== 'all') queries.push(SD.Q.equal('status', activeStatus));

      const res = await SD.tablesDB.listRows({ databaseId: SD.DB_ID, tableId: SD.COL.CANDIDATES, queries });
      res.documents = res.rows; // keep old field name working for the rest of this file
      totalCount    = res.total;
      allCandidates = res.documents.map(d => ({ id: d.$id, ...d }));

      await _loadCentreOptions();
      _applyFilters();
      _renderPagination();
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:#dc3545">Error: ${e.message}</td></tr>`;
    }
  }

  async function _loadCentreOptions() {
    if (centresCache.length) return;
    try {
      const res = await DB.list(SD.COL.CENTRES, [SD.Q.equal('status','active'), SD.Q.orderAsc('name')], 500);
      centresCache = res.documents;
    } catch(e) { console.warn('loadCentreOptions', e); }

    ['candCentreFilter','candFormCentre'].forEach(selId => {
      const sel = document.getElementById(selId); if(!sel) return;
      while(sel.options.length > 1) sel.remove(1);
      if (!centresCache.length) {
        const opt = document.createElement('option');
        opt.value=''; opt.textContent='No centres — add one in Centres module first'; opt.disabled=true;
        sel.appendChild(opt);
        return;
      }
      centresCache.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.$id; opt.textContent = c.name;
        sel.appendChild(opt);
      });
    });
  }

  /* ── SEARCH / FILTER ─────────────────────────────────────────────── */
  function search(q) { activeSearch = (q||'').trim().toLowerCase(); _applyFilters(); }
  function filterByCentre(id) { activeCentre = id; load(0); }
  function filterByStatus(s)  { activeStatus = s;  load(0); }

  function _applyFilters() {
    filtered = allCandidates.filter(c => {
      if (activeSearch) {
        const hay = `${c.fullName||''} ${c.candidateId||''} ${c.email||''}`.toLowerCase();
        if (!hay.includes(activeSearch)) return false;
      }
      return true;
    });
    renderTable(filtered);
  }

  function _renderPagination() {
    const wrap = document.getElementById('candidatesPagination'); if(!wrap) return;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    wrap.innerHTML = `
      <div class="pagination-info">Showing ${allCandidates.length} of ${totalCount} candidates</div>
      <div class="pagination-btns">
        <button class="btn-outline-sm" onclick="CandidateManager.load(${currentPage-1})" ${currentPage===0?'disabled':''}>← Prev</button>
        <span>Page ${currentPage+1} / ${Math.max(1,totalPages)}</span>
        <button class="btn-outline-sm" onclick="CandidateManager.load(${currentPage+1})" ${currentPage>=totalPages-1?'disabled':''}>Next →</button>
      </div>`;
  }

  function renderTable(candidates) {
    const tbody = document.getElementById('candidatesBody'); if(!tbody) return;
    if (!candidates.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="loading-placeholder">No candidates found.</td></tr>'; return;
    }
    tbody.innerHTML = candidates.map(c => {
      const centre = centresCache.find(x => x.$id === c.centreId);
      return `<tr>
        <td><img src="${c.passportImageUrl || '../assets/images/default-avatar.png'}" class="table-photo" alt="Photo" loading="lazy"></td>
        <td><strong>${_esc(c.candidateId||'—')}</strong></td>
        <td>${_esc(c.fullName||'—')}</td>
        <td>${_esc(c.email||'—')}</td>
        <td>${_esc(centre?.name||c.centreName||'—')}</td>
        <td>${Array.isArray(c.examIds)?c.examIds.length:0}</td>
        <td><span class="badge ${(c.status||'active')==='active'?'badge-success':'badge-gray'}">${c.status||'active'}</span></td>
        <td class="action-cell">
          <button class="btn-outline-sm" onclick="CandidateManager.showEdit('${c.id}')">✏️ Edit</button>
          <button class="btn-outline-sm" onclick="CandidateManager.viewResults('${c.id}')">📊 Results</button>
          <button class="btn-danger btn-xs" onclick="CandidateManager.delete('${c.id}')">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* ── ADD ─────────────────────────────────────────────────────────── */
  async function showAdd() {
    editingId = null;
    document.getElementById('candidateModalTitle').textContent = 'Add Candidate';
    document.getElementById('candidateForm').reset();
    document.getElementById('candidateModal').style.display = 'flex';
    centresCache = [];
    await _loadCentreOptions();
  }

  /* ── EDIT ────────────────────────────────────────────────────────── */
  async function showEdit(id) {
    editingId = id;
    const c = allCandidates.find(x => x.id === id); if(!c) return;
    document.getElementById('candidateModalTitle').textContent = 'Edit Candidate';
    const form = document.getElementById('candidateForm');
    form.fullName.value    = c.fullName    || '';
    form.email.value       = c.email       || '';
    form.phone.value       = c.phone       || '';
    form.candidateId.value = c.candidateId || '';
    form.candidateId.disabled = true;
    form.email.disabled       = true;
    document.getElementById('candidateModal').style.display = 'flex';
    await _loadCentreOptions();
    const centreSelect = form.querySelector('[name="centreId"]') || document.getElementById('candFormCentre');
    if (centreSelect) centreSelect.value = c.centreId || '';
  }

  /* ── SAVE (create or update) — duplicate guard ───────────────────── */
  async function save(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form       = document.getElementById('candidateForm');
    const fullName   = form.fullName?.value.trim();
    const email      = form.email?.value.trim().toLowerCase();
    const phone      = form.phone?.value.trim();
    const candidateId= form.candidateId?.value.trim().toUpperCase();
    const centreId   = (form.querySelector('[name="centreId"]') || document.getElementById('candFormCentre'))?.value;
    const imageFile  = document.getElementById('candImageInput')?.files?.[0];

    if (!fullName || !email || !candidateId || !centreId) {
      return _toast('Please fill all required fields.', 'danger');
    }

    const saveBtn = document.getElementById('saveCandidateBtn');
    if(saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }

    try {
      if (!editingId) {
        // ── Duplicate checks ──────────────────────────────────────────
        const [byId, byEmail] = await Promise.all([
          DB.list(SD.COL.CANDIDATES, [SD.Q.equal('candidateId', candidateId)], 1),
          DB.list(SD.COL.CANDIDATES, [SD.Q.equal('email', email)], 1),
        ]);
        if (byId.total > 0)    throw new Error(`Candidate ID "${candidateId}" already exists.`);
        if (byEmail.total > 0) throw new Error(`Email "${email}" is already registered.`);

        // ── Appwrite account creation ─────────────────────────────────
        // Password defaults to candidateId (admin can reset later).
        // Appwrite requires 8+ characters — pad short candidate IDs so
        // account creation doesn't silently fail for short IDs.
        const tempPassword = _padPassword(candidateId);

        let newUser, uid;
        try {
          newUser = await _account.create(SD.ID.unique(), email, tempPassword, fullName);
          uid = newUser.$id;
        } catch (accErr) {
          console.error('[CandidateManager] Auth account creation failed:', accErr);
          throw new Error(`Could not create login account: ${accErr.message} (code: ${accErr.code||accErr.type||'?'})`);
        }

        // ── Upload passport image if provided ─────────────────────────
        let passportImageUrl = '';
        try {
          if (imageFile) {
            passportImageUrl = await CLOUD.upload(imageFile, 'candidates', `passport_${uid}`);
          }
        } catch (imgErr) {
          console.error('[CandidateManager] Passport upload failed:', imgErr);
          // Non-fatal — continue without the image rather than losing the whole candidate.
        }

        const centre = centresCache.find(x => x.$id === centreId);
        try {
          await DB.create(SD.COL.CANDIDATES, {
            candidateId, fullName, email, phone: phone||'',
            centreId, centreName: centre?.name||'',
            passportImageUrl, status: 'active',
            examIds: [],
            createdAt: new Date().toISOString(),
          }, uid);
        } catch (dbErr) {
          console.error('[CandidateManager] Database row creation failed (auth account WAS created, uid=' + uid + '):', dbErr);
          throw new Error(`Login account was created but the candidate record failed to save: ${dbErr.message} (code: ${dbErr.code||dbErr.type||'?'}). This candidate ID/email may now be stuck — contact the developer with uid ${uid}.`);
        }

        await audit('CANDIDATE_CREATED', { candidateId, centreId });
        _toast('Candidate created successfully!', 'success');
      } else {
        // ── Update ────────────────────────────────────────────────────
        let passportImageUrl = allCandidates.find(x=>x.id===editingId)?.passportImageUrl || '';
        if (imageFile) {
          passportImageUrl = await CLOUD.upload(imageFile, 'candidates', `passport_${editingId}_${Date.now()}`);
        }
        const centre = centresCache.find(x => x.$id === centreId);
        await DB.update(SD.COL.CANDIDATES, editingId, {
          fullName, phone: phone||'',
          centreId, centreName: centre?.name||'',
          passportImageUrl,
          updatedAt: new Date().toISOString(),
        });
        await audit('CANDIDATE_UPDATED', { id: editingId });
        _toast('Candidate updated!', 'success');
      }

      closeModal('candidateModal');
      await load(currentPage);
    } catch(e) {
      _toast(e.message, 'danger');
    } finally {
      if(saveBtn) { saveBtn.disabled=false; saveBtn.textContent='Save Candidate'; }
    }
  }

  /* ── DELETE ──────────────────────────────────────────────────────── */
  async function deleteCand(id) {
    if (!confirm('Delete this candidate? This cannot be undone.')) return;
    try {
      await DB.delete(SD.COL.CANDIDATES, id);
      await audit('CANDIDATE_DELETED', { id });
      _toast('Candidate deleted.', 'success');
      await load(currentPage);
    } catch(e) { _toast(e.message, 'danger'); }
  }

  /* ── VIEW RESULTS ────────────────────────────────────────────────── */
  function viewResults(id) {
    window.open(`results.html?candidateId=${id}`, '_blank');
  }

  /* ── BULK EXCEL IMPORT ───────────────────────────────────────────── */
  async function importExcel(file) {
    if (!window.XLSX) { _toast('Excel library not loaded.','danger'); return; }
    const statusEl = document.getElementById('importStatus');
    if(statusEl) statusEl.textContent = 'Reading file…';
    try {
      const data  = await file.arrayBuffer();
      const wb    = XLSX.read(data);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval:'' });

      let added=0, skipped=0, errors=[];

      for (const row of rows) {
        const candidateId = (row['Candidate ID'] || row['candidateId'] || '').toString().trim().toUpperCase();
        const fullName    = (row['Full Name']    || row['fullName']    || '').toString().trim();
        const email       = (row['Email']        || row['email']       || '').toString().trim().toLowerCase();
        const phone       = (row['Phone']        || row['phone']       || '').toString().trim();
        const centreName  = (row['Centre']       || row['centre']      || '').toString().trim();

        if (!candidateId || !fullName || !email) { skipped++; continue; }

        // Find centre by name
        let centreId = '';
        const centre = centresCache.find(c => c.name.toLowerCase() === centreName.toLowerCase());
        if (centre) centreId = centre.$id;
        else if (centreName) { errors.push(`Centre "${centreName}" not found for ${candidateId}`); skipped++; continue; }

        // Duplicate check
        const existing = await DB.list(SD.COL.CANDIDATES, [SD.Q.equal('candidateId', candidateId)], 1);
        if (existing.total > 0) { skipped++; continue; }

        try {
          const newUser = await _account.create(SD.ID.unique(), email, _padPassword(candidateId), fullName);
          try {
            await DB.create(SD.COL.CANDIDATES, {
              candidateId, fullName, email, phone,
              centreId, centreName: centre?.name||'',
              passportImageUrl: '', status: 'active', examIds: [],
              createdAt: new Date().toISOString(),
            }, newUser.$id);
            added++;
          } catch (dbErr) {
            console.error(`[CandidateManager] Row creation failed for ${candidateId} (auth uid ${newUser.$id} was created):`, dbErr);
            throw new Error(`record save failed after account was created (uid ${newUser.$id}): ${dbErr.message}`);
          }
        } catch(e) { console.error(`[CandidateManager] Import row failed for ${candidateId}:`, e); errors.push(`${candidateId}: ${e.message}`); skipped++; }

        if(statusEl) statusEl.textContent = `Importing… ${added} added, ${skipped} skipped`;
      }

      const summary = `Import complete: ${added} added, ${skipped} skipped${errors.length?'\nErrors:\n'+errors.slice(0,5).join('\n'):''}`;
      if(statusEl) statusEl.textContent = summary;
      _toast(`Import done: ${added} added, ${skipped} skipped`, added>0?'success':'warning');
      await load(0);
    } catch(e) {
      if(statusEl) statusEl.textContent = 'Import failed: ' + e.message;
      _toast('Import failed: '+e.message, 'danger');
    }
  }

  /* ── helpers ──────────────────────────────────────────────────────── */
  // See window.padPassword in appwrite-config.js — shared with auth.js so
  // creation and login always agree on the default candidate password.
  const _padPassword = window.padPassword;
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _toast(msg, type='info') {
    if(window.Toast) Toast.show(msg, type);
    else alert(msg);
  }

  return {
    load, search, filterByCentre, filterByStatus,
    showAdd, showEdit, save,
    delete: deleteCand,
    viewResults, importExcel,
  };
})();
