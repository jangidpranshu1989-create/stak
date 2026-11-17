/**
 * Delight Restaurant — Admin Dashboard
 * Requires authentication; only owner sees data.
 */

// ==========================================================================
// Init
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!window.stak) return;
  try { await stak.ready; } catch {}
  if (!stak.auth.user) { window.location.href = '/'; return; }
  initAuth();
  initNavigation();
  await loadDashboard();
  initMenuManagement();
  initOrdersManagement();
  initReservationsManagement();
  initSettings();
  initDialogs();
});

// ==========================================================================
// Auth
// ==========================================================================
async function initAuth() {
  const user = stak.auth.user;
  $('#admin-user')?.textContent = user?.name || user?.email || 'Admin';
  $('#admin-signout')?.addEventListener('click', async () => {
    await stak.auth.signOut();
    window.location.href = '/';
  });
  stak.auth.onChange(u => { if (!u) window.location.href = '/'; });
}

// ==========================================================================
// Navigation
// ==========================================================================
function initNavigation() {
  const links = $$('.admin-nav a[data-section]');
  const sections = $$('.admin-section');
  const overlay = $('.admin-sidebar-overlay');
  const mobileBtn = $('#mobile-menu-btn');
  const sidebar = $('.admin-sidebar');
  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      links.forEach(l => l.classList.toggle('active', l === link));
      sections.forEach(s => s.classList.toggle('active', s.id === `${section}-section`));
      $('#admin-page-title').textContent = section.charAt(0).toUpperCase() + section.slice(1);
      sidebar?.classList.remove('open');
      overlay?.classList.remove('open');
    });
  });
  mobileBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('open');
  });
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay.classList.remove('open');
  });
}

// ==========================================================================
// Dashboard Stats
// ==========================================================================
async function loadDashboard() {
  if (!stakReady()) return loadDashboardFallback();
  try {
    const [menu, orders, reservations] = await Promise.all([
      stak.db.collection('menu').list({limit: 1000}),
      stak.db.collection('orders').list({sort: '-created', limit: 1000}),
      stak.db.collection('reservations').list({sort: '-created', limit: 1000})
    ]);
    $('#stat-menu').textContent = menu.length;
    $('#stat-orders').textContent = orders.length;
    $('#stat-pending').textContent = orders.filter(o => o.status === 'pending').length;
    $('#stat-reservations').textContent = reservations.length;
    renderRecentOrders(orders.slice(0, 5));
    renderUpcomingReservations(reservations.slice(0, 5));
  } catch (e) { loadDashboardFallback(); }
}

function stakReady() { return window.stak?.db && window.DelightApp?.stakReady(); }

function loadDashboardFallback() {
  const menu = JSON.parse(localStorage.getItem('delight_menu') || '[]');
  const orders = JSON.parse(localStorage.getItem('delight_orders') || '[]');
  const reservations = JSON.parse(localStorage.getItem('delight_reservations') || '[]');
  $('#stat-menu').textContent = menu.length;
  $('#stat-orders').textContent = orders.length;
  $('#stat-pending').textContent = orders.filter(o => o.status === 'pending').length;
  $('#stat-reservations').textContent = reservations.length;
  renderRecentOrders(orders.slice(0, 5));
  renderUpcomingReservations(reservations.slice(0, 5));
}

function renderRecentOrders(orders) {
  const tbody = $('#recent-orders-table');
  if (!tbody) return;
  if (orders.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:2rem">No orders yet</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>#${o.id?.slice(-6) || o.id}</td>
      <td>${esc(o.name)}</td>
      <td>${fmtMoney(o.total)}</td>
      <td><span class="badge-status ${o.status}">${o.status}</span></td>
      <td>${fmtDate(o.created)}</td>
    </tr>
  `).join('');
}

function renderUpcomingReservations(reservations) {
  const tbody = $('#upcoming-reservations-table');
  if (!tbody) return;
  const upcoming = reservations.filter(r => new Date(r.date) >= new Date().setHours(0,0,0,0)).slice(0,5);
  if (upcoming.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="padding:2rem">No upcoming reservations</td></tr>'; return; }
  tbody.innerHTML = upcoming.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${fmtDate(r.date)} ${r.time}</td>
      <td>${r.guests}</td>
      <td><span class="badge-status ${r.status}">${r.status}</span></td>
    </tr>
  `).join('');
}

// ==========================================================================
// Menu Management
// ==========================================================================
async function initMenuManagement() {
  await renderMenuList();
  $('#menu-item-form')?.addEventListener('submit', handleMenuItemSave);
  $('[data-dialog-open="menu-dialog"]')?.addEventListener('click', () => openMenuDialog());
}

async function renderMenuList() {
  const container = $('#menu-items-list');
  if (!container) return;
  let items = [];
  if (stakReady()) {
    try { items = await stak.db.collection('menu').list({sort: 'category,name', limit: 200}); } catch { items = getLocalMenu(); }
  } else { items = getLocalMenu(); }
  if (items.length === 0) { container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><p>No menu items yet. Click "Add Menu Item" to create one.</p></div>'; return; }
  container.innerHTML = items.map(item => `
    <div class="menu-item-row">
      ${item.image ? `<img src="${item.image}" alt="" class="menu-item-img">` : '<div class="menu-item-img" style="background:hsl(var(--muted));display:flex;align-items:center;justify-content:center;color:hsl(var(--muted-foreground))"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg></div>'}
      <div class="menu-item-info">
        <span class="menu-item-name">${esc(item.name)}</span>
        <span class="menu-item-category">${item.category}</span>
      </div>
      <div class="menu-item-actions">
        <span class="menu-item-price">${fmtMoney(item.price)}</span>
        <span class="badge-status ${item.available ? 'confirmed' : 'cancelled'}">${item.available ? 'Available' : 'Hidden'}</span>
        ${item.featured ? '<span class="badge badge-primary">Featured</span>' : ''}
        <button class="btn btn-ghost btn-sm action-btn" data-edit="${item.id}" aria-label="Edit ${esc(item.name)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
        <button class="btn btn-ghost btn-sm action-btn btn-destructive" data-delete="${item.id}" aria-label="Delete ${esc(item.name)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
      </div>
    </div>
  `).join('');
  // Attach handlers
  $$('[data-edit]', container).forEach(btn => btn.addEventListener('click', () => openMenuDialog(btn.dataset.edit)));
  $$('[data-delete]', container).forEach(btn => btn.addEventListener('click', () => deleteMenuItem(btn.dataset.delete)));
}

function getLocalMenu() { return JSON.parse(localStorage.getItem('delight_menu') || '[]'); }

function openMenuDialog(id = null) {
  const dialog = $('#menu-dialog');
  const form = $('#menu-item-form');
  if (!dialog || !form) return;
  form.reset();
  $('#menu-item-id').value = '';
  $('#menu-dialog-title').textContent = 'Add Menu Item';
  $('#menu-item-available').checked = true;
  if (id) {
    const item = (stakReady() ? window.DelightApp.menuItems : getLocalMenu()).find(i => i.id === id);
    if (item) {
      $('#menu-item-id').value = item.id;
      $('#menu-item-name').value = item.name;
      $('#menu-item-category').value = item.category;
      $('#menu-item-description').value = item.description || '';
      $('#menu-item-price').value = item.price;
      $('#menu-item-image').value = item.image || '';
      $('#menu-item-featured').checked = item.featured || false;
      $('#menu-item-available').checked = item.available !== false;
      $('#menu-dialog-title').textContent = 'Edit Menu Item';
    }
  }
  dialog.showModal();
}

async function handleMenuItemSave(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  ui.loading(submitBtn, true);
  try {
    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      category: formData.get('category'),
      description: formData.get('description') || '',
      price: parseFloat(formData.get('price')),
      image: formData.get('image') || '',
      featured: formData.get('featured') === 'on',
      available: formData.get('available') === 'on'
    };
    const id = formData.get('id');
    if (stakReady()) {
      if (id) {
        await stak.db.collection('menu').update(id, data);
      } else {
        await stak.db.collection('menu').add(data);
      }
    } else {
      const menu = getLocalMenu();
      if (id) {
        const idx = menu.findIndex(i => i.id === id);
        if (idx >= 0) menu[idx] = {...menu[idx], ...data};
      } else {
        menu.unshift({...data, id: 'menu_' + Date.now()});
      }
      localStorage.setItem('delight_menu', JSON.stringify(menu));
    }
    ui.toast(id ? 'Menu item updated' : 'Menu item added', {type: 'success'});
    $('#menu-dialog').close();
    await renderMenuList();
  } catch (err) {
    console.error(err);
    ui.toast('Failed to save menu item', {type: 'error'});
  } finally {
    ui.loading(submitBtn, false);
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Delete this menu item?')) return;
  try {
    if (stakReady()) {
      await stak.db.collection('menu').remove(id);
    } else {
      const menu = getLocalMenu().filter(i => i.id !== id);
      localStorage.setItem('delight_menu', JSON.stringify(menu));
    }
    ui.toast('Menu item deleted', {type: 'success'});
    await renderMenuList();
  } catch (err) {
    ui.toast('Failed to delete', {type: 'error'});
  }
}

// ==========================================================================
// Orders Management
// ==========================================================================
async function initOrdersManagement() {
  await renderOrdersTable();
  // Real-time subscription
  if (stakReady()) {
    try {
      stak.db.collection('orders').subscribe(items => renderOrdersTable(items), {sort: '-created', limit: 200, interval: 5000});
    } catch {}
  }
}

async function renderOrdersTable(items) {
  const tbody = $('#orders-table');
  if (!tbody) return;
  if (!items) {
    if (stakReady()) {
      try { items = await stak.db.collection('orders').list({sort: '-created', limit: 200}); } catch { items = getLocalOrders(); }
    } else { items = getLocalOrders(); }
  }
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding:2rem">No orders yet</td></tr>'; return; }
  tbody.innerHTML = items.map(o => `
    <tr>
      <td>#${o.id?.slice(-6) || o.id}</td>
      <td>${esc(o.name)}</td>
      <td>${esc(o.phone)}</td>
      <td>${o.orderType === 'delivery' ? 'Delivery' : 'Pickup'}</td>
      <td>${(o.items||[]).map(i => `${i.name} x${i.qty}`).join(', ')}</td>
      <td>${fmtMoney(o.total)}</td>
      <td><span class="badge-status ${o.status}">${o.status}</span></td>
      <td>${fmtDate(o.created)} ${new Date(o.created).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}</td>
      <td>
        <button class="btn btn-ghost btn-sm action-btn" data-view="${o.id}" aria-label="View order"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        <div class="dropdown" style="display:inline-block">
          <button class="btn btn-ghost btn-sm action-btn" data-dropdown aria-label="Change status"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>
          <div class="dropdown-menu">
            <a href="#" data-status="pending" data-order="${o.id}">Pending</a>
            <a href="#" data-status="confirmed" data-order="${o.id}">Confirmed</a>
            <a href="#" data-status="preparing" data-order="${o.id}">Preparing</a>
            <a href="#" data-status="ready" data-order="${o.id}">Ready</a>
            <a href="#" data-status="completed" data-order="${o.id}">Completed</a>
            <a href="#" data-status="cancelled" data-order="${o.id}">Cancelled</a>
          </div>
        </div>
      </td>
    </tr>
  `).join('');
  // View handlers
  $$('[data-view]', tbody).forEach(btn => btn.addEventListener('click', () => openOrderDialog(btn.dataset.view)));
  // Status dropdown handlers
  $$('[data-status]', tbody).forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    updateOrderStatus(a.dataset.order, a.dataset.status);
  }));
}

function getLocalOrders() { return JSON.parse(localStorage.getItem('delight_orders') || '[]'); }

async function updateOrderStatus(id, status) {
  try {
    if (stakReady()) {
      await stak.db.collection('orders').update(id, {status});
    } else {
      const orders = getLocalOrders();
      const idx = orders.findIndex(o => o.id === id);
      if (idx >= 0) orders[idx].status = status;
      localStorage.setItem('delight_orders', JSON.stringify(orders));
    }
    ui.toast(`Order status updated to ${status}`, {type: 'success'});
    await renderOrdersTable();
  } catch (err) {
    ui.toast('Failed to update status', {type: 'error'});
  }
}

function openOrderDialog(id) {
  const order = (stakReady() ? [] : getLocalOrders()).find(o => o.id === id) || 
                JSON.parse(localStorage.getItem('delight_orders') || '[]').find(o => o.id === id);
  if (!order) return;
  $('#order-detail-id').textContent = `#${order.id?.slice(-6) || order.id}`;
  $('#order-detail-customer').textContent = order.name;
  $('#order-detail-phone').textContent = order.phone;
  $('#order-detail-type').textContent = order.orderType === 'delivery' ? 'Delivery' : 'Pickup';
  $('#order-detail-address').textContent = order.address || '—';
  $('#order-detail-total').textContent = fmtMoney(order.total);
  $('#order-detail-status').className = `badge-status ${order.status}`;
  $('#order-detail-status').textContent = order.status;
  $('#order-detail-time').textContent = new Date(order.created).toLocaleString('en-GB');
  $('#order-detail-notes').textContent = order.notes || '—';
  $('#order-detail-items').innerHTML = (order.items||[]).map(i => `
    <div class="row between" style="padding:.5rem 0; border-bottom:1px solid hsl(var(--border))">
      <span>${esc(i.name)} x${i.qty}</span>
      <span>${fmtMoney(i.price * i.qty)}</span>
    </div>
  `).join('');
  $('#order-dialog').showModal();
}

// ==========================================================================
// Reservations Management
// ==========================================================================
async function initReservationsManagement() {
  await renderReservationsTable();
  if (stakReady()) {
    try {
      stak.db.collection('reservations').subscribe(items => renderReservationsTable(items), {sort: '-created', limit: 200, interval: 5000});
    } catch {}
  }
}

async function renderReservationsTable(items) {
  const tbody = $('#reservations-table');
  if (!tbody) return;
  if (!items) {
    if (stakReady()) {
      try { items = await stak.db.collection('reservations').list({sort: '-created', limit: 200}); } catch { items = getLocalReservations(); }
    } else { items = getLocalReservations(); }
  }
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding:2rem">No reservations yet</td></tr>'; return; }
  tbody.innerHTML = items.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.email) || '—'}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.time}</td>
      <td>${r.guests}</td>
      <td>${r.occasion ? esc(r.occasion) : '—'}</td>
      <td><span class="badge-status ${r.status}">${r.status}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm action-btn" data-edit="${r.id}" aria-label="Edit reservation"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
      </td>
    </tr>
  `).join('');
  $$('[data-edit]', tbody).forEach(btn => btn.addEventListener('click', () => openReservationDialog(btn.dataset.edit)));
}

function getLocalReservations() { return JSON.parse(localStorage.getItem('delight_reservations') || '[]'); }

function openReservationDialog(id) {
  const res = (stakReady() ? [] : getLocalReservations()).find(r => r.id === id) ||
              JSON.parse(localStorage.getItem('delight_reservations') || '[]').find(r => r.id === id);
  if (!res) return;
  $('#reservation-id').value = res.id;
  $('#reservation-name').value = res.name;
  $('#reservation-phone').value = res.phone;
  $('#reservation-datetime').value = `${fmtDate(res.date)} at ${res.time}`;
  $('#reservation-guests').value = `${res.guests} guest${res.guests>1?'s':''}`;
  $('#reservation-status').value = res.status;
  $('#reservation-notes').value = res.notes || '';
  $('#reservation-dialog').showModal();
}

$('#reservation-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  ui.loading(submitBtn, true);
  try {
    const formData = new FormData(form);
    const data = {status: formData.get('status'), notes: formData.get('notes')};
    const id = formData.get('id');
    if (stakReady()) {
      await stak.db.collection('reservations').update(id, data);
    } else {
      const res = getLocalReservations();
      const idx = res.findIndex(r => r.id === id);
      if (idx >= 0) res[idx] = {...res[idx], ...data};
      localStorage.setItem('delight_reservations', JSON.stringify(res));
    }
    ui.toast('Reservation updated', {type: 'success'});
    $('#reservation-dialog').close();
    await renderReservationsTable();
  } catch (err) {
    ui.toast('Failed to update', {type: 'error'});
  } finally {
    ui.loading(submitBtn, false);
  }
});

// ==========================================================================
// Settings
// ==========================================================================
function initSettings() {
  // Load existing settings
  if (stakReady()) {
    stak.db.collection('settings').list({limit: 1}).then(s => {
      if (s[0]) {
        $('#setting-hours').value = JSON.stringify(s[0].hours || {}, null, 2);
      }
    });
  } else {
    const s = JSON.parse(localStorage.getItem('delight_settings') || '{}');
    $('#setting-hours').value = JSON.stringify(s.hours || {}, null, 2);
  }
  $('#settings-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      name: formData.get('name'),
      address: formData.get('address'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      hours: JSON.parse(formData.get('hours') || '{}'),
      ownerId: stak.auth.user?.id
    };
    try {
      if (stakReady()) {
        const existing = await stak.db.collection('settings').list({limit: 1});
        if (existing[0]) await stak.db.collection('settings').update(existing[0].id, data);
        else await stak.db.collection('settings').add(data);
      } else {
        localStorage.setItem('delight_settings', JSON.stringify(data));
      }
      ui.toast('Settings saved', {type: 'success'});
    } catch (err) {
      ui.toast('Failed to save settings', {type: 'error'});
    }
  });
}

// ==========================================================================
// Dialogs (Stak UI handles open/close via data attributes)
// ==========================================================================
function initDialogs() {
  // Close on backdrop click
  $$('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target === d) d.close();
  }));
  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') $$('dialog[open]').forEach(d => d.close());
  });
}

// ==========================================================================
// Shared utils (also in app.js)
// ==========================================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (str) => str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMoney = (n) => `£${Number(n).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
