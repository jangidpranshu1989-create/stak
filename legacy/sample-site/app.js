/**
 * Delight Restaurant — Main Application Logic
 * Handles: theme, navigation, menu rendering, order form, reservation form,
 * live data (weather, cuisine, Nigeria info), map, scroll reveal, toasts.
 */

// ==========================================================================
// Utilities
// ==========================================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (str) => str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMoney = (n) => `£${Number(n).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
const fmtTime = (t) => t; // already formatted HH:MM
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } };

// ==========================================================================
// State
// ==========================================================================
let menuItems = []; // from stak.db
let cart = []; // {id, name, price, qty, image}
let stakReady = false;

// ==========================================================================
// Init
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Stak SDK
  if (window.stak) {
    try { await stak.ready; stakReady = true; } catch {}
  }

  initTheme();
  initNavbar();
  initTabs();
  initScrollReveal();
  initMap();
  loadLiveData();
  await loadMenuFromDB();
  renderMenuTabs();
  initOrderForm();
  initReserveForm();
  initFooterAdminLink();
  registerSW();
});

// ==========================================================================
// Theme
// ==========================================================================
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) document.documentElement.classList.add('dark');
  $('#theme-toggle')?.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  });
}

// ==========================================================================
// Navbar
// ==========================================================================
function initNavbar() {
  const toggle = $('#nav-toggle');
  const mobileNav = $('#mnav');
  if (!toggle || !mobileNav) return;
  toggle.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  $$('.mobile-nav-link').forEach(a => a.addEventListener('click', () => {
    mobileNav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
  // Scroll spy for active link
  const sections = $$('section[id]');
  const navLinks = $$('.nav-link, .mobile-nav-link');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.id;
        navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${id}`));
      }
    });
  }, {rootMargin: '-50% 0px -50% 0px'});
  sections.forEach(s => observer.observe(s));
}

// ==========================================================================
// Tabs (Menu Categories)
// ==========================================================================
function initTabs() {
  const container = $('[data-tabs]');
  if (!container) return;
  const tabs = $$('.tab', container);
  const panels = $$('.tab-panel', container);
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => { t.setAttribute('aria-selected', t === tab); });
      panels.forEach(p => { p.hidden = p.dataset.panel !== target; });
    });
  });
}

// ==========================================================================
// Scroll Reveal (using Stak Motion Kit data attributes)
// ==========================================================================
function initScrollReveal() {
  if (window.StakMotion) return; // kit handles it
  // Fallback simple IntersectionObserver
  const els = $$('[data-reveal]');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'none';
        obs.unobserve(e.target);
      }
    });
  }, {threshold: .1, rootMargin: '0px 0px -50px 0px'});
  els.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity .6s ease, transform .6s ease';
    const delay = el.dataset.delay ? `${el.dataset.delay}ms` : '0ms';
    el.style.transitionDelay = delay;
    obs.observe(el);
  });
  // Stagger
  $$('[data-stagger]').forEach(parent => {
    const children = $$('[data-reveal]', parent);
    children.forEach((c, i) => c.style.transitionDelay = `${parseInt(c.dataset.delay||0) + i * parseInt(parent.dataset.stagger)}ms`);
  });
}

// ==========================================================================
// Live Data: Weather, Cuisine, Nigeria
// ==========================================================================
async function loadLiveData() {
  await Promise.all([loadWeather(), loadCuisine(), loadNigeria()]);
}

async function loadWeather() {
  const el = $('#weather-display');
  const updatedEl = $('#weather-updated');
  if (!el) return;
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=52.586&longitude=-2.128&current_weather=true');
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    const w = data.current_weather;
    const code = w.weathercode;
    const desc = weatherCodeDesc(code);
    el.innerHTML = `
      <span><strong>${w.temperature}°C</strong> ${desc}</span>
      <span>Wind: ${w.windspeed} km/h</span>
      <span>Updated ${new Date(w.time).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})}</span>
    `;
    updatedEl.textContent = `Live data from Open-Meteo • ${new Date().toLocaleTimeString('en-GB')}`;
  } catch (e) {
    el.innerHTML = '<span class="muted">Weather unavailable</span>';
    console.warn('Weather error:', e);
  }
}

function weatherCodeDesc(code) {
  const map = {
    0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
    45:'Fog', 48:'Depositing rime fog', 51:'Light drizzle', 53:'Moderate drizzle',
    55:'Dense drizzle', 56:'Light freezing drizzle', 57:'Dense freezing drizzle',
    61:'Slight rain', 63:'Moderate rain', 65:'Heavy rain', 66:'Light freezing rain',
    67:'Heavy freezing rain', 71:'Slight snow', 73:'Moderate snow', 75:'Heavy snow',
    77:'Snow grains', 80:'Slight rain showers', 81:'Moderate rain showers', 82:'Violent rain showers',
    85:'Slight snow showers', 86:'Heavy snow showers', 95:'Thunderstorm', 96:'Thunderstorm with hail', 99:'Thunderstorm with heavy hail'
  };
  return map[code] || 'Unknown';
}

async function loadCuisine() {
  const el = $('#cuisine-extract');
  if (!el) return;
  try {
    const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/Nigerian_cuisine');
    if (!res.ok) throw new Error('Wikipedia fetch failed');
    const data = await res.json();
    el.textContent = data.extract || 'Nigerian cuisine is rich and diverse, featuring dishes like jollof rice, suya, and egusi soup.';
  } catch (e) {
    el.textContent = 'Nigerian cuisine is rich and diverse, featuring dishes like jollof rice, suya, and egusi soup.';
    console.warn('Cuisine error:', e);
  }
}

async function loadNigeria() {
  const el = $('#nigeria-info');
  if (!el) return;
  try {
    const res = await fetch('https://restcountries.com/v3.1/name/nigeria');
    if (!res.ok) throw new Error('REST Countries fetch failed');
    const [data] = await res.json();
    const flag = data.flags?.svg;
    const name = data.name?.common || 'Nigeria';
    const pop = data.population?.toLocaleString() || '—';
    const currency = data.currencies?.NGN?.name || 'Nigerian Naira';
    el.innerHTML = `
      ${flag ? `<img src="${flag}" alt="" width="48" height="32" style="border-radius:.5rem">` : ''}
      <div>
        <strong>${name}</strong>
        <div class="small muted">Population: ${pop} • Currency: ${currency}</div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<span class="muted">Country data unavailable</span>';
    console.warn('Nigeria error:', e);
  }
}

// ==========================================================================
// Map (Leaflet via CDN)
// ==========================================================================
function initMap() {
  const mapEl = $('#map');
  if (!mapEl) return;
  // Load Leaflet CSS/JS dynamically
  if (!document.querySelector('link[href*="leaflet.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
  const loadLeaflet = () => new Promise((resolve, reject) => {
    if (window.L) return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  loadLeaflet().then(() => {
    const map = L.map('map').setView([52.586, -2.128], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:32px;height:32px;border-radius:50%;background:hsl(var(--primary));border:3px solid hsl(var(--background));box-shadow:var(--shadow-lg);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary-foreground))" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });
    L.marker([52.586, -2.128], {icon}).addTo(map)
      .bindPopup('<strong>Delight Restaurant</strong><br>14 Market St, Wolverhampton WV1 3AG')
      .openPopup();
  }).catch(e => {
    mapEl.innerHTML = '<div class="empty" style="height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg><p class="muted">Map unavailable</p></div>';
    console.warn('Map error:', e);
  });
}

// ==========================================================================
// Menu: Load from Stak DB, seed if empty, render tabs
// ==========================================================================
async function loadMenuFromDB() {
  if (!stakReady || !window.stak?.db) {
    // Fallback to seed data
    menuItems = getSeedMenu();
    return;
  }
  try {
    const items = await stak.db.collection('menu').list({sort: 'category,name', limit: 200});
    if (items.length === 0) {
      // Seed
      const seed = getSeedMenu();
      for (const item of seed) {
        await stak.db.collection('menu').add(item);
      }
      menuItems = seed;
    } else {
      menuItems = items.map(i => ({...i, id: i.id}));
    }
  } catch (e) {
    console.warn('Menu DB error, using seed:', e);
    menuItems = getSeedMenu();
  }
}

function getSeedMenu() {
  return [
    // Starters
    {name:'Suya Skewers', category:'starters', description:'Grilled beef skewers with yaji spice, onions, tomatoes', price:5.50, image:'assets/img/suya.jpg', featured:true, available:true},
    {name:'Pepper Soup', category:'starters', description:'Aromatic broth with goat meat, uziza leaves, calabash nutmeg', price:6.00, image:'assets/img/pepper-soup.jpg', featured:false, available:true},
    {name:'Moi Moi', category:'starters', description:'Steamed bean pudding with eggs, fish, peppers', price:4.50, image:'assets/img/moi-moi.jpg', featured:false, available:true},
    {name:'Asun', category:'starters', description:'Spicy smoked goat meat with peppers, onions', price:7.00, image:'assets/img/asun.jpg', featured:true, available:true},
    {name:'Akara', category:'starters', description:'Crispy bean fritters with spicy pepper sauce', price:4.00, image:'assets/img/akara.jpg', featured:false, available:true},
    // Mains
    {name:'Ofada Rice & Ayamase', category:'mains', description:'Local Ofada rice with green pepper sauce, boiled egg, assorted meat', price:6.00, image:'assets/img/ofada.jpg', featured:true, available:true},
    {name:'Grilled Whole Catfish', category:'mains', description:'Marinated catfish grilled to perfection, served with jollof rice & plantain', price:18.00, image:'assets/img/catfish.jpg', featured:true, available:true},
    {name:'Jollof Rice & Chicken', category:'mains', description:'Classic party jollof with grilled chicken, coleslaw, fried plantain', price:12.00, image:'assets/img/jollof.jpg', featured:false, available:true},
    {name:'Egusi Soup & Pounded Yam', category:'mains', description:'Melon seed soup with spinach, assorted meat, stockfish', price:14.00, image:'assets/img/egusi.jpg', featured:false, available:true},
    {name:'Efo Riro & Semo', category:'mains', description:'Spinach stew with locust beans, smoked fish, assorted meat', price:13.00, image:'assets/img/efo.jpg', featured:false, available:true},
    {name:'Seafood Okro Soup', category:'mains', description:'Fresh prawns, mussels, fish in silky okro broth', price:16.00, image:'assets/img/okro.jpg', featured:true, available:true},
    // Sides
    {name:'Fried Plantain (Dodo)', category:'sides', description:'Sweet ripe plantain, golden fried', price:3.00, image:'assets/img/plantain.jpg', featured:false, available:true},
    {name:'Coconut Rice', category:'sides', description:'Fragrant rice cooked with coconut milk', price:4.00, image:'assets/img/coconut-rice.jpg', featured:false, available:true},
    {name:'Yam Fries', category:'sides', description:'Crispy yam chips with spicy mayo', price:3.50, image:'assets/img/yam-fries.jpg', featured:false, available:true},
    {name:'Coleslaw', category:'sides', description:'Creamy cabbage & carrot slaw', price:2.50, image:'assets/img/coleslaw.jpg', featured:false, available:true},
    // Drinks
    {name:'Chapman', category:'drinks', description:'Classic Nigerian cocktail: grenadine, bitters, lemon, soda', price:4.50, image:'assets/img/chapman.jpg', featured:true, available:true},
    {name:'Zobo Drink', category:'drinks', description:'Hibiscus infusion with ginger, pineapple, cloves', price:3.50, image:'assets/img/zobo.jpg', featured:false, available:true},
    {name:'Palm Wine', category:'drinks', description:'Fresh traditional palm wine', price:5.00, image:'assets/img/palm-wine.jpg', featured:false, available:true},
    {name:'Maltina', category:'drinks', description:'Malt drink, chilled', price:2.50, image:'assets/img/maltina.jpg', featured:false, available:true},
    {name:'Water (75cl)', category:'drinks', description:'Still or sparkling', price:1.50, image:'', featured:false, available:true},
    // Desserts
    {name:'Puff Puff', category:'desserts', description:'Sweet fried dough balls, dusted with sugar', price:3.50, image:'assets/img/puff-puff.jpg', featured:true, available:true},
    {name:'Chin Chin', category:'desserts', description:'Crunchy sweet biscuit snacks', price:3.00, image:'assets/img/chin-chin.jpg', featured:false, available:true},
    {name:'Coconut Cake', category:'desserts', description:'Moist coconut sponge with cream cheese frosting', price:4.50, image:'assets/img/coconut-cake.jpg', featured:false, available:true},
  ];
}

function renderMenuTabs() {
  const categories = ['starters','mains','sides','drinks','desserts'];
  categories.forEach(cat => {
    const panel = $(`.tab-panel[data-panel="${cat}"]`);
    if (!panel) return;
    const items = menuItems.filter(i => i.category === cat && i.available);
    if (items.length === 0) {
      panel.innerHTML = '<p class="empty muted" style="padding:2rem;text-align:center">No items in this category yet.</p>';
      return;
    }
    panel.innerHTML = `
      <div class="menu-grid" role="list">
        ${items.map(item => `
          <article class="menu-item" role="listitem" data-id="${item.id}">
            ${item.image ? `<img src="${item.image}" alt="" class="menu-item-image" loading="lazy" width="400" height="250">` : ''}
            <div class="menu-item-content">
              <div class="menu-item-header">
                <h3 class="menu-item-name">${esc(item.name)}</h3>
                <span class="menu-item-price">${fmtMoney(item.price)}</span>
              </div>
              <p class="menu-item-desc">${esc(item.description)}</p>
              <div class="menu-item-footer">
                <div class="menu-item-badges">
                  ${item.featured ? '<span class="badge badge-primary">Chef\'s Choice</span>' : ''}
                  ${cat === 'mains' && item.name.includes('Catfish') ? '<span class="badge badge-outline">Signature</span>' : ''}
                </div>
                <button class="btn btn-sm btn-primary menu-item-add" data-add="${item.id}" aria-label="Add ${esc(item.name)} to order">Add to Order</button>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  });
  // Attach add-to-order handlers
  $$('.menu-item-add').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.add));
  });
}

// ==========================================================================
// Cart / Order Form
// ==========================================================================
function initOrderForm() {
  const form = $('#order-form');
  if (!form) return;
  // Delivery address toggle
  $$('input[name="orderType"]').forEach(r => r.addEventListener('change', () => {
    $('#delivery-address-field').style.display = r.value === 'delivery' && r.checked ? 'block' : 'none';
  }));
  // Set min date to today
  // (reservation form handles its own date)
  form.addEventListener('submit', handleOrderSubmit);
  updateCartUI();
}

function addToCart(itemId) {
  const item = menuItems.find(i => i.id === itemId);
  if (!item) return;
  const existing = cart.find(c => c.id === itemId);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({id: item.id, name: item.name, price: item.price, image: item.image, qty: 1});
  }
  updateCartUI();
  ui.toast(`Added ${item.name} to order`, {type: 'success'});
}

function removeFromCart(itemId) {
  cart = cart.filter(c => c.id !== itemId);
  updateCartUI();
}

function changeQty(itemId, delta) {
  const item = cart.find(c => c.id === itemId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromCart(itemId);
  else updateCartUI();
}

function updateCartUI() {
  const container = $('#order-items-container');
  const totalEl = $('#order-total');
  const jsonInput = $('#order-items-json');
  if (!container || !totalEl || !jsonInput) return;
  if (cart.length === 0) {
    container.innerHTML = '<p class="muted small">Add items from the <a href="#menu" style="color:hsl(var(--primary))">Menu</a> above — they\'ll appear here.</p>';
    totalEl.textContent = '£0.00';
    jsonInput.value = '[]';
    return;
  }
  container.innerHTML = cart.map(item => `
    <div class="order-item" data-id="${item.id}">
      <div class="order-item-info">
        <div class="order-item-name">${esc(item.name)}</div>
        <div class="order-item-qty">
          <button class="qty-btn" data-qty="-1" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" data-qty="+1" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="row center" style="gap:1rem">
        <span class="order-item-price">${fmtMoney(item.price * item.qty)}</span>
        <button class="order-item-remove" aria-label="Remove ${esc(item.name)}">×</button>
      </div>
    </div>
  `).join('');
  // Attach qty/remove handlers
  $$('.qty-btn', container).forEach(btn => btn.addEventListener('click', () => changeQty(btn.closest('.order-item').dataset.id, parseInt(btn.dataset.qty))));
  $$('.order-item-remove', container).forEach(btn => btn.addEventListener('click', () => removeFromCart(btn.closest('.order-item').dataset.id)));
  // Total
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = $('input[name="orderType"]:checked')?.value === 'delivery' ? 2.50 : 0;
  totalEl.textContent = fmtMoney(subtotal + deliveryFee);
  jsonInput.value = JSON.stringify(cart.map(i => ({id: i.id, name: i.name, price: i.price, qty: i.qty})));
}

async function handleOrderSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (cart.length === 0) { ui.toast('Your order is empty', {type: 'error'}); return; }
  const submitBtn = form.querySelector('button[type="submit"]');
  ui.loading(submitBtn, true);
  try {
    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      email: formData.get('email') || '',
      orderType: formData.get('orderType'),
      address: formData.get('address') || '',
      items: JSON.parse(formData.get('itemsJson') || '[]'),
      notes: formData.get('notes') || '',
      subtotal: cart.reduce((s, i) => s + i.price * i.qty, 0),
      deliveryFee: formData.get('orderType') === 'delivery' ? 2.50 : 0,
      total: cart.reduce((s, i) => s + i.price * i.qty, 0) + (formData.get('orderType') === 'delivery' ? 2.50 : 0),
      status: 'pending',
      created: new Date().toISOString()
    };
    if (stakReady && window.stak?.db) {
      await stak.db.collection('orders').add(data);
    } else {
      // Fallback: store in localStorage for demo
      const orders = JSON.parse(localStorage.getItem('delight_orders') || '[]');
      orders.unshift({...data, id: 'ord_' + Date.now()});
      localStorage.setItem('delight_orders', JSON.stringify(orders));
    }
    ui.toast('Order placed successfully! We\'ll confirm via WhatsApp shortly.', {type: 'success', title: 'Order Confirmed'});
    cart = [];
    form.reset();
    updateCartUI();
    $('#delivery-address-field').style.display = 'none';
  } catch (err) {
    console.error(err);
    ui.toast('Failed to place order. Please try again.', {type: 'error'});
  } finally {
    ui.loading(submitBtn, false);
  }
}

// ==========================================================================
// Reservation Form
// ==========================================================================
function initReserveForm() {
  const form = $('#reserve-form');
  if (!form) return;
  // Populate time slots based on day
  const dateInput = $('#reserve-date');
  const timeSelect = $('#reserve-time');
  if (dateInput && timeSelect) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
    dateInput.value = today;
    dateInput.addEventListener('change', () => populateTimeSlots(dateInput.value, timeSelect));
    populateTimeSlots(today, timeSelect);
  }
  form.addEventListener('submit', handleReserveSubmit);
}

function populateTimeSlots(dateStr, select) {
  const day = new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun, 1=Mon...
  const isWeekend = day === 5 || day === 6; // Fri, Sat
  const isSunday = day === 0;
  select.innerHTML = '<option value="">Select time</option>';
  if (isSunday) {
    select.innerHTML += '<option value="" disabled>Closed on Sundays</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const openHour = 10;
  const closeHour = isWeekend ? 24 : 22; // 24 = midnight
  for (let h = openHour; h < closeHour; h++) {
    for (let m of [0, 30]) {
      if (h === closeHour - 1 && m === 30) continue;
      const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const label = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
      select.innerHTML += `<option value="${val}">${label}</option>`;
    }
  }
}

async function handleReserveSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  ui.loading(submitBtn, true);
  try {
    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      email: formData.get('email') || '',
      guests: parseInt(formData.get('guests')),
      date: formData.get('date'),
      time: formData.get('time'),
      occasion: formData.get('occasion') || '',
      notes: formData.get('notes') || '',
      status: 'pending',
      created: new Date().toISOString()
    };
    if (stakReady && window.stak?.db) {
      await stak.db.collection('reservations').add(data);
    } else {
      const res = JSON.parse(localStorage.getItem('delight_reservations') || '[]');
      res.unshift({...data, id: 'res_' + Date.now()});
      localStorage.setItem('delight_reservations', JSON.stringify(res));
    }
    ui.toast('Reservation requested! We\'ll confirm within 15 minutes.', {type: 'success', title: 'Reservation Sent'});
    form.reset();
    populateTimeSlots(form.date.value, form.time);
  } catch (err) {
    console.error(err);
    ui.toast('Failed to send reservation. Please try again.', {type: 'error'});
  } finally {
    ui.loading(submitBtn, false);
  }
}

// ==========================================================================
// Footer Admin Link (show if owner)
// ==========================================================================
async function initFooterAdminLink() {
  if (!stakReady || !window.stak?.auth) return;
  try {
    const user = stak.auth.user;
    if (!user) return;
    // Check if owner
    const settings = await stak.db.collection('settings').list({limit: 1});
    const isOwner = settings.length > 0 && settings[0].ownerId === user.id;
    $$('.admin-link, .admin-footer-link').forEach(el => el.style.display = isOwner ? 'block' : 'none');
  } catch {}
}

// ==========================================================================
// Service Worker Registration
// ==========================================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ==========================================================================
// Export for admin.js (shared utils)
// ==========================================================================
window.DelightApp = { menuItems, cart, fmtMoney, fmtDate, esc, stakReady: () => stakReady };
