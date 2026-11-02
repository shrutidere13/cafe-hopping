// Cafe Hopping Journal.
// Cafes live in Firestore (collection "cafes"). Anyone can read; only the
// owner's Google account can write — enforced by Firestore security rules.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const firebase = initializeApp(firebaseConfig);
const db = getFirestore(firebase);
const auth = getAuth(firebase);
const cafesCol = collection(db, 'cafes');

// Firestore documents max out at 1 MiB; keep well under that.
const MAX_DOC_CHARS = 900_000;
const MAX_PHOTOS = 6;
const MAX_PHOTO_CHARS = 130_000;
const PRESET_TAGS = ['Work-friendly', 'Good WiFi', 'Pet-friendly', 'Date spot', 'Rooftop', 'Outdoor seating', 'Brunch', 'Desserts'];
const BREAKDOWN = [['food', 'Food'], ['ambience', 'Ambience'], ['service', 'Service'], ['value', 'Value']];
const $ = (sel) => document.querySelector(sel);

const store = {
  async load() {
    const snap = await getDocs(cafesCol);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async put(cafe) {
    const { id, ...data } = cafe;
    await setDoc(doc(cafesCol, id), data);
  },
  async remove(id) {
    await deleteDoc(doc(cafesCol, id));
  },
  async replaceAll(list) {
    // Firestore batches cap at 500 writes; a personal journal stays well below.
    const batch = writeBatch(db);
    cafes.forEach((c) => batch.delete(doc(cafesCol, c.id)));
    list.forEach(({ id, ...data }) => batch.set(doc(cafesCol, id || crypto.randomUUID()), data));
    await batch.commit();
  },
};

// Runs a write and explains failures in plain words. Returns true on success.
async function attempt(fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    alert(err.code === 'permission-denied'
      ? 'This account isn\'t allowed to change this journal.'
      : 'Could not save — check your internet connection and try again.');
    return false;
  }
}

let cafes = [];
let user = null;
let statusFilter = 'all';
let photos = [];
let pickedTags = new Set();
const pickers = {};

const els = {
  list: $('#list'), empty: $('#empty'), stats: $('#stats'),
  fame: $('#fame'), fameList: $('#fameList'),
  search: $('#search'), sort: $('#sort'), minRating: $('#minRating'),
  priceFilter: $('#priceFilter'), tagFilter: $('#tagFilter'),
  dialog: $('#dialog'), form: $('#form'), formTitle: $('#formTitle'), formError: $('#formError'),
  visitedFields: $('#visitedFields'), tagPicker: $('#tagPicker'),
  photoInput: $('#photoInput'), photoList: $('#photoList'), photoAdd: $('#photoAdd'), photoCount: $('#photoCount'),
  randomDialog: $('#randomDialog'), randomResult: $('#randomResult'),
};

// Older entries (before status existed) were all visited.
// Entries saved before multiple photos had a single `photo` field.
function normalize(c) {
  const { photo, ...rest } = c;
  return { status: 'visited', tags: [], ratings: {}, photos: photo ? [photo] : [], ...rest };
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}

function starString(n) {
  return '<span class="stars" aria-label="' + n + ' out of 5">' +
    '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span></span>';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function areaOf(c) {
  return c.location.split(',')[0].trim();
}

function mostCommon(values) {
  const counts = {};
  values.filter(Boolean).forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function topRated() {
  return cafes
    .filter((c) => c.status === 'visited' && c.rating)
    .sort((a, b) => b.rating - a.rating || (b.visited || '').localeCompare(a.visited || ''));
}

function renderStats() {
  const visited = cafes.filter((c) => c.status === 'visited');
  const wish = cafes.length - visited.length;
  const rated = visited.filter((c) => c.rating);
  const avg = rated.length ? (rated.reduce((s, c) => s + c.rating, 0) / rated.length).toFixed(1) : '—';
  const area = mostCommon(visited.map(areaOf));
  const dish = mostCommon(visited.map((c) => c.favourite));
  const stat = (value, label) => value ? `<div class="stat"><b>${escapeHtml(value)}</b><span>${label}</span></div>` : '';
  els.stats.innerHTML =
    stat(String(visited.length), 'cafes visited') +
    stat(String(wish), 'on the wishlist') +
    stat(avg, 'average rating') +
    stat(area, 'top area') +
    stat(dish, 'favourite dish');
}

function renderFame() {
  const top = topRated().slice(0, 5);
  els.fame.hidden = top.length === 0;
  els.fameList.innerHTML = top.map((c) =>
    `<li>${escapeHtml(c.name)} <small>${c.rating}★ · ${escapeHtml(areaOf(c))}</small></li>`).join('');
}

function renderTagFilter() {
  const all = [...new Set(cafes.flatMap((c) => c.tags))].sort();
  const current = els.tagFilter.value;
  els.tagFilter.innerHTML = '<option value="">Any tag</option>' +
    all.map((t) => `<option ${t === current ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
}

function visibleCafes() {
  const q = els.search.value.trim().toLowerCase();
  const min = Number(els.minRating.value);
  const price = els.priceFilter.value;
  const tag = els.tagFilter.value;
  const sorters = {
    recent: (a, b) => (b.visited || '').localeCompare(a.visited || '') || b.created - a.created,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return cafes
    .filter((c) => statusFilter === 'all' || c.status === statusFilter)
    .filter((c) => !min || (c.rating || 0) >= min)
    .filter((c) => !price || c.price === price)
    .filter((c) => !tag || c.tags.includes(tag))
    .filter((c) => !q || [c.name, c.location, c.specialty, c.mustTry, c.favourite, c.notes, c.with, ...c.tags]
      .some((f) => (f || '').toLowerCase().includes(q)))
    .sort(sorters[els.sort.value]);
}

function fact(label, value, cls = '') {
  return value ? `<div class="${cls}"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>` : '';
}

function breakdownBars(r) {
  const rows = BREAKDOWN.filter(([k]) => r[k]);
  if (!rows.length) return '';
  return '<div class="bars">' + rows.map(([k, label]) =>
    `<span>${label}</span><span class="bar"><i style="width:${r[k] * 20}%"></i></span><span>${r[k]}</span>`).join('') + '</div>';
}

function galleryHtml(c) {
  if (!c.photos.length) return '';
  const imgs = c.photos.map((src, i) =>
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(c.name)} photo ${i + 1}" loading="lazy" data-view="${c.id}" data-index="${i}">`).join('');
  const count = c.photos.length > 1 ? `<span class="photo-count">1 / ${c.photos.length}</span>` : '';
  return `<div class="gallery">${imgs}</div>${count}`;
}

function cardHtml(c) {
  const map = safeUrl(c.mapUrl);
  const loc = map
    ? `<a href="${escapeHtml(map)}" target="_blank" rel="noopener">📍 ${escapeHtml(c.location)}</a>`
    : `📍 ${escapeHtml(c.location)}`;
  const isWish = c.status === 'wishlist';
  const score = isWish ? '<div class="score wish">Wishlist</div>' : `<div class="score">${c.rating}/5</div>`;
  const again = !isWish && c.goAgain
    ? `<span class="again ${c.goAgain}">${c.goAgain === 'yes' ? '↻ Would go again' : '✕ Wouldn\'t go again'}</span>` : '';
  const meta = isWish ? c.price : [formatDate(c.visited), c.price, c.with && `with ${c.with}`].filter(Boolean).join(' · ');
  return `
    <article class="card ${isWish ? 'wish' : c.rating === 5 ? 'top' : ''}">
      ${galleryHtml(c)}
      <div class="card-head">
        <div>
          <h3>${escapeHtml(c.name)}</h3>
          <div class="loc">${loc}</div>
        </div>
        ${score}
      </div>
      ${isWish ? '' : starString(c.rating)}
      ${isWish ? '' : breakdownBars(c.ratings)}
      <dl class="facts">
        ${fact('Speciality', c.specialty)}
        ${fact('Must try', c.mustTry)}
        ${isWish ? '' : fact('My favourite', c.favourite ? '♥ ' + c.favourite : '', 'fav')}
      </dl>
      ${c.tags.length ? `<div class="tags">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${again}
      ${c.notes ? `<p class="notes">“${escapeHtml(c.notes)}”</p>` : ''}
      <div class="meta">
        <span>${escapeHtml(meta || '')}</span>
        <span class="tools owner-only">
          ${isWish ? `<button class="primary-ish" data-visit="${c.id}">Mark visited</button>` : ''}
          <button data-edit="${c.id}">Edit</button>
          <button data-delete="${c.id}">Delete</button>
        </span>
      </div>
    </article>`;
}

function render() {
  renderStats();
  renderFame();
  renderTagFilter();
  const items = visibleCafes();
  els.empty.hidden = cafes.length > 0;
  els.list.innerHTML = items.map(cardHtml).join('');
  if (cafes.length && !items.length) {
    els.list.innerHTML = '<p class="empty">No cafes match these filters.</p>';
  }
}

// ---- Star pickers ----
function makeStarPicker(el) {
  let value = 0;
  const buttons = [];
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '★';
    b.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
    b.addEventListener('click', () => { set(value === i ? 0 : i); els.formError.hidden = true; });
    buttons.push(b);
    el.appendChild(b);
  }
  function set(n) {
    value = n;
    buttons.forEach((b, i) => { b.classList.toggle('on', i < n); b.setAttribute('aria-pressed', String(i < n)); });
  }
  return { get: () => value, set };
}

document.querySelectorAll('.star-picker').forEach((el) => { pickers[el.dataset.key] = makeStarPicker(el); });

// ---- Tag chips ----
function renderTagPicker() {
  els.tagPicker.innerHTML = PRESET_TAGS.map((t) =>
    `<button type="button" aria-pressed="${pickedTags.has(t)}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
}

els.tagPicker.addEventListener('click', (e) => {
  const t = e.target.dataset.tag;
  if (!t) return;
  pickedTags.has(t) ? pickedTags.delete(t) : pickedTags.add(t);
  e.target.setAttribute('aria-pressed', String(pickedTags.has(t)));
});

// ---- Photos (resized in the browser so all of them fit in one Firestore doc) ----
// Re-encoding through a canvas also drops EXIF metadata such as GPS location.
function resizeImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      let quality = 0.72;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > MAX_PHOTO_CHARS && quality > 0.4) {
        quality -= 0.08;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(data);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function renderPhotoList() {
  els.photoList.innerHTML = photos.map((src, i) => `
    <div class="thumb">
      <img src="${escapeHtml(src)}" alt="Photo ${i + 1}">
      ${i === 0 ? '<span class="cover">Cover</span>' : `<button type="button" class="make-cover" data-cover="${i}" aria-label="Make cover photo">★</button>`}
      <button type="button" class="remove" data-remove="${i}" aria-label="Remove photo ${i + 1}">×</button>
    </div>`).join('');
  els.photoAdd.hidden = photos.length >= MAX_PHOTOS;
  els.photoCount.textContent = `${photos.length} / ${MAX_PHOTOS}`;
}

function setPhotos(list) {
  photos = [...(list || [])];
  renderPhotoList();
}

els.photoInput.addEventListener('change', async () => {
  const files = [...els.photoInput.files].slice(0, MAX_PHOTOS - photos.length);
  if (els.photoInput.files.length > files.length) alert(`You can add up to ${MAX_PHOTOS} photos per cafe.`);
  for (const file of files) {
    try { photos.push(await resizeImage(file)); } catch { alert(`Could not read ${file.name}.`); }
  }
  renderPhotoList();
  els.photoInput.value = '';
});

els.photoList.addEventListener('click', (e) => {
  const { remove, cover } = e.target.dataset;
  if (remove !== undefined) photos.splice(Number(remove), 1);
  if (cover !== undefined) photos.unshift(...photos.splice(Number(cover), 1));
  renderPhotoList();
});

// ---- Full-screen photo viewer ----
const viewer = { list: [], index: 0 };
function showViewer() {
  $('#viewerImg').src = viewer.list[viewer.index];
  $('#viewerCount').textContent = viewer.list.length > 1 ? `${viewer.index + 1} / ${viewer.list.length}` : '';
  $('#viewerPrev').hidden = $('#viewerNext').hidden = viewer.list.length < 2;
}
function stepViewer(d) {
  viewer.index = (viewer.index + d + viewer.list.length) % viewer.list.length;
  showViewer();
}
$('#viewerPrev').addEventListener('click', () => stepViewer(-1));
$('#viewerNext').addEventListener('click', () => stepViewer(1));
$('#viewerClose').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') stepViewer(-1);
  if (e.key === 'ArrowRight') stepViewer(1);
});
let touchX = null;
$('#viewer').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#viewer').addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40 && viewer.list.length > 1) stepViewer(dx < 0 ? 1 : -1);
});

// ---- Form ----
function syncStatusFields() {
  els.visitedFields.hidden = els.form.elements.status.value !== 'visited';
}
els.form.addEventListener('change', (e) => { if (e.target.name === 'status') syncStatusFields(); });

function openForm(cafe, { markVisited = false } = {}) {
  els.form.reset();
  els.formError.hidden = true;
  const f = els.form.elements;
  els.formTitle.textContent = markVisited ? 'How was it?' : cafe ? 'Edit cafe' : 'Add a cafe';
  for (const key of ['id', 'name', 'location', 'specialty', 'mustTry', 'favourite', 'visited', 'price', 'notes', 'mapUrl', 'with']) {
    f[key].value = cafe?.[key] || '';
  }
  f.status.value = markVisited ? 'visited' : cafe?.status || 'visited';
  f.goAgain.value = cafe?.goAgain || '';
  if (!f.visited.value) f.visited.value = new Date().toISOString().slice(0, 10);
  pickers.rating.set(cafe?.rating || 0);
  BREAKDOWN.forEach(([k]) => pickers[k].set(cafe?.ratings?.[k] || 0));
  const tags = cafe?.tags || [];
  pickedTags = new Set(tags.filter((t) => PRESET_TAGS.includes(t)));
  f.customTags.value = tags.filter((t) => !PRESET_TAGS.includes(t)).join(', ');
  renderTagPicker();
  setPhotos(cafe?.photos);
  syncStatusFields();
  els.dialog.showModal();
  f.name.focus();
}

function showError(msg) {
  els.formError.textContent = msg;
  els.formError.hidden = false;
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = els.form.elements;
  const status = f.status.value;
  if (!f.name.value.trim() || !f.location.value.trim()) return showError('Please add a name and location.');
  if (status === 'visited' && !pickers.rating.get()) return showError('Please pick an overall rating.');
  if (f.mapUrl.value && !safeUrl(f.mapUrl.value.trim())) return showError('Map link should start with https://');

  const text = (k) => f[k].value.trim();
  const custom = text('customTags').split(',').map((t) => t.trim()).filter(Boolean);
  const cafe = {
    status,
    name: text('name'), location: text('location'), price: f.price.value, mapUrl: text('mapUrl'),
    specialty: text('specialty'), mustTry: text('mustTry'), notes: text('notes'),
    tags: [...new Set([...pickedTags, ...custom])],
    photos: [...photos],
    favourite: status === 'visited' ? text('favourite') : '',
    visited: status === 'visited' ? f.visited.value : '',
    with: status === 'visited' ? text('with') : '',
    goAgain: status === 'visited' ? f.goAgain.value : '',
    rating: status === 'visited' ? pickers.rating.get() : 0,
    ratings: status === 'visited' ? Object.fromEntries(BREAKDOWN.map(([k]) => [k, pickers[k].get()])) : {},
  };
  const existing = cafes.find((c) => c.id === f.id.value);
  const saved = existing
    ? { ...existing, ...cafe }
    : { ...cafe, id: crypto.randomUUID(), created: Date.now() };
  if (JSON.stringify(saved).length > MAX_DOC_CHARS) return showError('Too many large photos for one cafe — remove one or two and try again.');

  const submit = els.form.querySelector('[type=submit]');
  submit.disabled = true;
  const ok = await attempt(() => store.put(saved));
  submit.disabled = false;
  if (!ok) return;
  cafes = existing ? cafes.map((c) => (c.id === saved.id ? saved : c)) : [...cafes, saved];
  render();
  els.dialog.close();
});

// ---- Random pick ----
function pickRandom() {
  const wish = cafes.filter((c) => c.status === 'wishlist');
  const favourites = cafes.filter((c) => c.status === 'visited' && c.rating >= 4 && c.goAgain !== 'no');
  const pool = wish.length ? wish : favourites;
  if (!pool.length) {
    els.randomResult.innerHTML = '<p>Add a few cafes (or wishlist some) first!</p>';
  } else {
    const c = pool[Math.floor(Math.random() * pool.length)];
    const map = safeUrl(c.mapUrl);
    els.randomResult.innerHTML = `
      <h3>${escapeHtml(c.name)}</h3>
      <p class="loc">📍 ${escapeHtml(c.location)}</p>
      ${c.mustTry ? `<p>Order: <b>${escapeHtml(c.mustTry)}</b></p>` : ''}
      <p><span class="badge">${wish.length ? 'From your wishlist' : 'An old favourite'}</span></p>
      ${map ? `<p><a class="btn ghost" href="${escapeHtml(map)}" target="_blank" rel="noopener">Open in Maps</a></p>` : ''}`;
  }
  if (!els.randomDialog.open) els.randomDialog.showModal();
}

// ---- Events ----
els.list.addEventListener('click', async (e) => {
  const { edit, visit, delete: del, view, index } = e.target.dataset;
  if (view) {
    viewer.list = cafes.find((c) => c.id === view).photos;
    viewer.index = Number(index);
    showViewer();
    $('#viewer').showModal();
  }
  if (edit) openForm(cafes.find((c) => c.id === edit));
  if (visit) openForm(cafes.find((c) => c.id === visit), { markVisited: true });
  if (del) {
    const cafe = cafes.find((c) => c.id === del);
    if (confirm(`Delete "${cafe.name}"?`) && await attempt(() => store.remove(del))) {
      cafes = cafes.filter((c) => c.id !== del);
      render();
    }
  }
});

// Keep each card's "2 / 4" badge in sync as you swipe its gallery.
els.list.addEventListener('scroll', (e) => {
  const g = e.target;
  if (!g.classList?.contains('gallery')) return;
  const badge = g.nextElementSibling;
  if (badge?.classList.contains('photo-count')) {
    badge.textContent = `${Math.round(g.scrollLeft / g.clientWidth) + 1} / ${g.children.length}`;
  }
}, true);

$('#statusTabs').addEventListener('click', (e) => {
  const s = e.target.dataset.status;
  if (!s) return;
  statusFilter = s;
  document.querySelectorAll('#statusTabs button').forEach((b) => b.setAttribute('aria-selected', String(b === e.target)));
  render();
});

$('#addBtn').addEventListener('click', () => openForm());
$('#emptyAdd').addEventListener('click', () => openForm());
$('#cancelBtn').addEventListener('click', () => els.dialog.close());
$('#randomBtn').addEventListener('click', pickRandom);
$('#rerollBtn').addEventListener('click', pickRandom);
$('#randomClose').addEventListener('click', () => els.randomDialog.close());
[els.search, els.sort, els.minRating, els.priceFilter, els.tagFilter].forEach((el) => el.addEventListener('input', render));

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cafes, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cafes.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('not a list');
    const list = data.map((c) => normalize({ ...c, id: c.id || crypto.randomUUID() }));
    if (confirm(`Replace your current ${cafes.length} cafes with ${list.length} from the backup?`)
      && await attempt(() => store.replaceAll(list))) {
      cafes = list;
      render();
    }
  } catch {
    alert('That file doesn\'t look like a Cafe Hopping backup.');
  }
  e.target.value = '';
});

// ---- Sign-in ----
const authBtn = $('#authBtn');
authBtn.addEventListener('click', async () => {
  try {
    if (user) await signOut(auth);
    else await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      console.error(err);
      alert('Sign-in failed. Please try again.');
    }
  }
});

// The journal is private: nothing is fetched until the owner signs in,
// and Firestore rules reject reads from any other account.
const gate = $('#gate');
const gateMsg = $('#gateMsg');
$('#gateSignIn').addEventListener('click', () => authBtn.click());

onAuthStateChanged(auth, async (u) => {
  user = u;
  cafes = [];
  document.body.classList.toggle('can-edit', !!u);
  authBtn.textContent = u ? 'Sign out' : 'Sign in';
  if (!u) {
    gate.hidden = false;
    gateMsg.textContent = 'This journal is private. Sign in to open it.';
    return;
  }
  gate.hidden = true;
  els.list.innerHTML = '<p class="empty">Loading cafes…</p>';
  try {
    cafes = (await store.load()).map(normalize);
    render();
  } catch (err) {
    console.error(err);
    if (err.code === 'permission-denied') {
      await signOut(auth);
      gateMsg.textContent = 'That account doesn\'t have access to this journal.';
    } else {
      els.list.innerHTML = '<p class="empty">Could not load cafes. Check your internet connection.</p>';
    }
  }
});
