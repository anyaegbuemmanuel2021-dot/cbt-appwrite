/**
 * SOFTLY DIGITAL V3 — exam-portal-ui.js
 * Cosmetic/chrome behavior ONLY for the Examina-style exam UI:
 * mobile sidebar, dark mode, fullscreen button, network banner,
 * and question-palette filter chips.
 *
 * All actual exam logic (loading, timing, answers, submission,
 * anti-cheat) lives in exam-engine.js / exam-timer.js / exam-sync.js /
 * anti-cheat.js — this file never touches exam state.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);

  /* ── MOBILE SIDEBAR ────────────────────────────────────────────── */
  const sidebar = el('sidebar');
  let scrim = document.querySelector('.sidebar-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    document.body.appendChild(scrim);
  }
  function openSidebar()  { sidebar?.classList.add('is-open');    scrim.classList.add('is-visible'); }
  function closeSidebar() { sidebar?.classList.remove('is-open'); scrim.classList.remove('is-visible'); }
  el('mobileMenuBtn')?.addEventListener('click', openSidebar);
  el('sidebarToggle')?.addEventListener('click', openSidebar);
  scrim.addEventListener('click', closeSidebar);

  /* ── DARK MODE ─────────────────────────────────────────────────── */
  el('darkModeToggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  /* ── FULLSCREEN BUTTON ─────────────────────────────────────────── */
  el('fullscreenBtn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  /* ── LOGOUT / END SESSION ──────────────────────────────────────── */
  el('logoutBtn')?.addEventListener('click', () => {
    if (confirm('End this session? Your answers are already saved — you can resume this exam by logging in again before time runs out.')) {
      location.href = 'candidate-login.html';
    }
  });

  /* ── NETWORK STATUS BANNER ─────────────────────────────────────── */
  function updateNetworkStatus() {
    const banner = el('networkBanner');
    const status = el('networkStatus');
    if (!banner || !status) return;
    if (navigator.onLine) {
      banner.classList.remove('is-visible');
      status.innerHTML = '<span class="pulse-dot"></span> Online';
      status.className = 'status-badge status-badge-ok';
    } else {
      banner.classList.add('is-visible');
      status.textContent = 'Offline';
      status.className = 'status-badge status-badge-warn';
    }
  }
  window.addEventListener('online',  updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  document.addEventListener('DOMContentLoaded', updateNetworkStatus);

  /* ── QUESTION PALETTE FILTER CHIPS ─────────────────────────────── */
  let activeFilter = 'all';
  function applyPaletteFilter() {
    const grid = el('paletteGrid');
    if (!grid) return;
    grid.querySelectorAll('.palette-cell').forEach(cell => {
      let visible = true;
      if (activeFilter === 'answered')   visible = cell.classList.contains('is-answered');
      if (activeFilter === 'unanswered') visible = !cell.classList.contains('is-answered');
      if (activeFilter === 'flagged')    visible = cell.classList.contains('is-flagged');
      cell.classList.toggle('is-filtered-out', !visible);
    });
  }
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      activeFilter = chip.dataset.filter;
      applyPaletteFilter();
    });
  });
  // Re-apply the active filter every time exam-engine.js re-renders the palette
  const paletteObserver = new MutationObserver(applyPaletteFilter);
  document.addEventListener('DOMContentLoaded', () => {
    const grid = el('paletteGrid');
    if (grid) paletteObserver.observe(grid, { childList: true });
  });

  /* ── PREVENT COPY/PASTE/RIGHT-CLICK (exam integrity) ───────────── */
  document.addEventListener('copy',  e => e.preventDefault());
  document.addEventListener('cut',   e => e.preventDefault());
  document.addEventListener('paste', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());

  /* ── WARN BEFORE LEAVING ───────────────────────────────────────── */
  window.onbeforeunload = () => 'Leaving now may affect your exam progress. Are you sure?';
})();
