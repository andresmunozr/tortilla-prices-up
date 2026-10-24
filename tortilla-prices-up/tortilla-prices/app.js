// ─── UTILIDADES ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const money = n => '$' + Number(n).toFixed(2)
const signed = (n, d = 1) => (n >= 0 ? '+' : '') + Number(n).toFixed(d)
const num = n => Number(n).toLocaleString('en-US')
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const S = { state: 'ALL', channel: 'all', horizon: 3 }
let SUMMARY = null
let FORECAST = null
let CHANNELS = null

async function api(path) {
  const response = await fetch(CONFIG.ML_API_URL + path)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === name))
  $(`view-${name}`).classList.add('active')

  $('filter-bar').hidden = name === 'table'
  document.querySelector('main').style.paddingTop = name === 'table' ? '56px' : '100px'
  $('f-channel').hidden = name !== 'dashboard'
  $('f-horizon').hidden = name !== 'dashboard'

  if (name === 'table') renderTable(1)
  if (name === 'channels' && CHANNELS) Charts.lines($('chChart'), CHANNELS)
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.querySelector('.toast')
  if (!t) {
    t = document.createElement('div')
    t.className = 'toast'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2000)
}

// ─── GRÁFICAS (SVG sin dependencias) ─────────────────────────────────────────
const Charts = (() => {
  const C = { primary: '#052215', sec: '#904d00', secC: '#fe932c', grid: '#e6eeff', axis: '#727973', pc: '#1c3829' }
  const W = 900, H = 280, L = 52, R = 24, T = 18, B = 28

  function frame(lo, hi, n, ticks) {
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B)
    const x = i => L + i / (n - 1) * (W - L - R)
    let s = ''
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4
      s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` +
           `<text x="${L - 8}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="${C.axis}">$${v.toFixed(0)}</text>`
    }
    ticks.forEach(([i, t, bold]) => {
      s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.axis}" font-weight="${bold ? 700 : 400}">${t}</text>`
    })
    return { x, y, s }
  }
  const path = (pts, f) => pts.map((p, i) => `${i ? 'L' : 'M'}${f.x(p[0]).toFixed(1)} ${f.y(p[1]).toFixed(1)}`).join(' ')
  const bubble = (cx, cy, txt, fill) =>
    `<g transform="translate(${Math.min(cx - 26, W - R - 56)},${cy - 26})"><rect width="56" height="16" rx="3" fill="${fill}"/>` +
    `<text x="28" y="11" text-anchor="middle" font-size="9" font-weight="600" fill="#fff">${txt}</text></g>`

  function forecast(svg, d, hz) {
    const dates = d.history.dates, vals = d.history.values, m = d.months, last = vals.length - 1, N = vals.length + 12
    const all = vals.concat(m.map(p => p.lo), m.map(p => p.hi))
    const lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1)
    const ticks = []
    dates.forEach((t, i) => { if (t.endsWith('-01') && (+t.slice(0, 4) - 2007) % 3 === 0) ticks.push([i, t.slice(0, 4)]) })
    ticks.push([N - 1, m[11].date.slice(0, 4) + 'P', true])
    const f = frame(lo, hi, N, ticks)
    const hist = vals.map((v, i) => [i, v])
    const fc = [[last, vals[last]]].concat(m.map((p, i) => [last + 1 + i, p.v]))
    const up = m.map((p, i) => [last + 1 + i, p.hi]), dn = m.map((p, i) => [last + 1 + i, p.lo]).reverse()
    const poly = [[last, vals[last]]].concat(up, dn).map(p => `${f.x(p[0]).toFixed(1)},${f.y(p[1]).toFixed(1)}`).join(' ')
    let s = f.s +
      `<line x1="${f.x(last)}" x2="${f.x(last)}" y1="${T}" y2="${H - B}" stroke="#c2c8c1" stroke-dasharray="3 3"/>` +
      `<text x="${f.x(last) - 6}" y="${T + 10}" text-anchor="end" font-size="9.5" fill="${C.axis}">Último dato ${d.last_date}</text>` +
      `<polygon points="${poly}" fill="${C.secC}" fill-opacity="0.2"/>` +
      `<path d="${path(hist, f)}" fill="none" stroke="${C.primary}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="${path(fc, f)}" fill="none" stroke="${C.sec}" stroke-width="2.5" stroke-dasharray="4 3"/>` +
      `<circle cx="${f.x(last)}" cy="${f.y(vals[last])}" r="3.5" fill="${C.primary}"/>`
    ;[3, 6, 12].forEach(k => {
      const p = m[k - 1], on = k === hz, cx = f.x(last + k), cy = f.y(p.v)
      s += `<circle cx="${cx}" cy="${cy}" r="${on ? 5 : 3.5}" fill="${C.sec}" stroke="#fff" stroke-width="1.5"/>`
      if (on) s += bubble(cx, cy, money(p.v), C.sec)
    })
    s += bubble(f.x(last), f.y(vals[last]) + 44, money(d.last_value), C.primary)
    svg.innerHTML = s
  }

  function lines(svg, d) {
    const n = d.dates.length
    const all = d.mp.concat(d.br)
    const lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1)
    const ticks = []
    d.dates.forEach((t, i) => { if (t.endsWith('-12') && (+t.slice(0, 4)) % 2 === 1) ticks.push([i, t.slice(0, 4)]) })
    const f = frame(lo, hi, n, ticks)
    const mp = d.mp.map((v, i) => [i, v]), br = d.br.map((v, i) => [i, v])
    const poly = mp.concat(br.slice().reverse()).map(p => `${f.x(p[0]).toFixed(1)},${f.y(p[1]).toFixed(1)}`).join(' ')
    svg.innerHTML = f.s +
      `<polygon points="${poly}" fill="${C.sec}" fill-opacity="0.1"/>` +
      `<path d="${path(br, f)}" fill="none" stroke="${C.pc}" stroke-width="2.5"/>` +
      `<path d="${path(mp, f)}" fill="none" stroke="${C.sec}" stroke-width="2.5"/>` +
      `<circle cx="${f.x(n - 1)}" cy="${f.y(d.mp[n - 1])}" r="4" fill="${C.sec}" stroke="#fff" stroke-width="1.5"/>` +
      `<circle cx="${f.x(n - 1)}" cy="${f.y(d.br[n - 1])}" r="4" fill="${C.pc}" stroke="#fff" stroke-width="1.5"/>` +
      bubble(f.x(n - 1), f.y(d.mp[n - 1]), money(d.mp[n - 1]), C.sec) +
      bubble(f.x(n - 1), f.y(d.br[n - 1]) + 46, money(d.br[n - 1]), C.pc)
  }
  return { forecast, lines }
})()

// ─── TABLERO EJECUTIVO ───────────────────────────────────────────────────────
function renderDashboard() {
  const { meta, kpis: k, ranking } = SUMMARY
  $('d-intro').textContent = `${num(meta.n_obs)} registros en ${meta.n_states} entidades y ${meta.n_cities} ciudades. Proyección a 3, 6 y 12 meses a partir de la serie de precios.`
  $('rank-title').textContent = `Ranking territorial (${meta.n_states} estados)`
  $('th-mean').textContent = `Media ${meta.y0}–${meta.y1}`
  $('th-gap').textContent = `Brecha vs nacional (${money(k.nat25)})`

  const [a, b] = ranking
  $('d-side').innerHTML = `
    <div>
      <p class="text-label-sm uppercase tracking-wider text-outline">Mayor costo 2025</p>
      <p class="mt-1 text-on-surface">${escapeHtml(a.name)} ${money(a.p2025)} · ${escapeHtml(b.name)} ${money(b.p2025)}</p>
      <p class="text-outline mt-0.5">${signed(a.gap)}% y ${signed(b.gap)}% vs nacional</p>
    </div>
    <div>
      <p class="text-label-sm uppercase tracking-wider text-outline">Canales (nacional)</p>
      <p class="mt-1 text-on-surface">Mom &amp; Pop ${money(k.mp)} · Big Retail ${money(k.br)}</p>
      <p class="text-outline mt-0.5">Brecha ${money(k.gap)} /kg</p>
    </div>`

  $('rankBody').innerHTML = ranking.map(r => {
    const tone = r.gap > 10 ? 'secondary' : (r.gap > 0 ? 'primary' : 'outline')
    const bar = r.gap > 10 ? 'bg-secondary' : (r.gap > 0 ? 'bg-primary' : 'bg-tertiary')
    return `<tr class="state-row hover:bg-surface-container-low/70 transition-colors cursor-pointer" data-state="${escapeHtml(r.state)}" data-cat="${r.cat}">
      <td class="py-2.5 pr-3 text-outline">#${String(r.rank).padStart(2, '0')}</td>
      <td class="py-2.5 px-3 font-semibold text-primary">${escapeHtml(r.name)}</td>
      <td class="py-2.5 px-3 text-right text-outline tabular-nums">${money(r.mean_all)}</td>
      <td class="py-2.5 px-3 text-right font-semibold tabular-nums text-${r.gap > 10 ? 'secondary' : 'primary'}">${money(r.p2025)}</td>
      <td class="py-2.5 px-3"><div class="flex items-center gap-2"><div class="w-16 bg-surface-container h-px overflow-visible relative"><div class="${bar} h-1 -mt-0.5" style="width:${r.bar}%"></div></div><span class="text-label-sm font-semibold text-${tone}">${signed(r.gap)}%</span></div></td>
      <td class="py-2.5 px-3 text-outline">${escapeHtml(r.cov)}</td>
      <td class="py-2.5 pl-3 text-right"><button type="button" class="select-btn text-primary text-label-sm hover:underline">Ver</button></td></tr>`
  }).join('')
  document.querySelectorAll('.state-row').forEach(row => row.addEventListener('click', () => setState(row.dataset.state)))
}

function paintForecast() {
  if (!FORECAST) return
  $('activeName').textContent = FORECAST.name
  const row = SUMMARY.ranking.find(r => r.state === S.state)
  $('activeDetails').textContent = `${row ? row.cov : 'todas las entidades'} · último dato ${FORECAST.last_date}: ${money(FORECAST.last_value)}`
  $('fc-cards').innerHTML = [[3, '3 meses'], [6, '6 meses'], [12, '12 meses']].map(([h, lab]) => {
    const f = FORECAST.horizons[h]
    return `<div class="bg-background px-space-md py-space-sm flex flex-col gap-0.5 ${h === S.horizon ? 'ring-sel' : ''}">
      <div class="flex justify-between text-label-sm text-outline"><span>${lab}</span><span>${f.label}</span></div>
      <div class="flex items-baseline gap-1"><span class="font-headline text-headline-lg text-primary">${money(f.v)}</span><span class="text-body-sm text-outline">MXN/kg</span></div>
      <div class="text-body-sm text-outline">${signed(f.pct)}%</div></div>`
  }).join('')
  Charts.forecast($('fcChart'), FORECAST, S.horizon)
  document.querySelectorAll('.state-row').forEach(row => {
    const on = row.dataset.state === S.state, b = row.querySelector('.select-btn')
    row.classList.toggle('bg-surface-container-low', on)
    b.textContent = on ? 'Activo' : 'Ver proyección'
    b.className = 'select-btn text-label-sm ' +
      (on ? 'font-semibold text-primary' : 'text-outline hover:text-primary hover:underline')
  })
}

async function loadForecast() {
  FORECAST = await api(`/forecast?state=${encodeURIComponent(S.state)}&channel=${S.channel}`)
  paintForecast()
}

async function loadChannels() {
  CHANNELS = await api(`/channels?state=${encodeURIComponent(S.state)}`)
  $('chartName').textContent = CHANNELS.name
  $('corrBadge').textContent = 'r = ' + CHANNELS.corr
  Charts.lines($('chChart'), CHANNELS)
}

function setState(state) {
  S.state = state
  $('stateSelect').value = state
  Promise.all([loadForecast(), loadChannels()]).catch(showApiError)
}

// ─── CANALES & BRECHAS ───────────────────────────────────────────────────────
function renderChannels() {
  const { meta, kpis: k, channel_table: t } = SUMMARY
  $('c-intro').textContent = `Diferencia de precio entre tortillería tradicional (Mom & Pop) y autoservicio (Big Retail). ${num(meta.n_obs)} registros.`
  $('c-kpis').innerHTML = `
    <div class="bg-background px-space-md py-space-sm">
      <p class="text-label-sm uppercase tracking-wider text-outline">Tradicional</p>
      <p class="mt-1 font-headline text-headline-lg">${money(k.mp)} <span class="text-body-sm font-body font-normal text-outline">MXN/kg</span></p>
      <p class="text-body-sm text-outline mt-0.5">${signed(k.vs07)}% vs 2007</p></div>
    <div class="bg-background px-space-md py-space-sm">
      <p class="text-label-sm uppercase tracking-wider text-outline">Autoservicio</p>
      <p class="mt-1 font-headline text-headline-lg">${money(k.br)} <span class="text-body-sm font-body font-normal text-outline">MXN/kg</span></p>
      <p class="text-body-sm text-outline mt-0.5">Media 2025</p></div>
    <div class="bg-background px-space-md py-space-sm">
      <p class="text-label-sm uppercase tracking-wider text-outline">Brecha</p>
      <p class="mt-1 font-headline text-headline-lg text-secondary">+${money(k.gap)} <span class="text-body-sm font-body font-normal text-outline">MXN/kg</span></p>
      <p class="text-body-sm text-outline mt-0.5">${signed(k.gap_pct)}% sobreprecio tradicional</p></div>
    <div class="bg-background px-space-md py-space-sm">
      <p class="text-label-sm uppercase tracking-wider text-outline">Muestra</p>
      <p class="mt-1 font-headline text-headline-lg">${num(meta.n_obs)}</p>
      <p class="text-body-sm text-outline mt-0.5">${k.p_mp.toFixed(0)}% / ${k.p_br.toFixed(0)}% por canal</p></div>`
  $('c-reading').innerHTML = `Las entidades con mayor brecha en pesos son <strong>${escapeHtml(t[0].name)}</strong> (+${money(t[0].gap)}), <strong>${escapeHtml(t[1].name)}</strong> (+${money(t[1].gap)}) y <strong>${escapeHtml(t[2].name)}</strong> (+${money(t[2].gap)}). Son candidatas para analizar con más detalle el acceso al canal de autoservicio.`
  drawGapTable('gap')
}

function drawGapTable(by) {
  const rows = SUMMARY.channel_table.slice()
  rows.sort((a, b) => by === 'gap' ? b.gap - a.gap : a.name.localeCompare(b.name, 'es'))
  $('gapBody').innerHTML = rows.map(r => {
    const badge = r.risk === 'Alto' ? 'bg-error-container text-on-error-container' : (r.risk === 'Medio' ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container text-on-surface-variant')
    return `<tr class="gap-row hover:bg-surface-container-low/50 transition-colors cursor-pointer" data-state="${escapeHtml(r.state)}">
      <td class="py-2.5 pr-3 font-medium">${escapeHtml(r.name)}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${money(r.mp)}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-on-surface-variant">${money(r.br)}</td>
      <td class="py-2.5 px-3 text-right font-semibold text-secondary tabular-nums">+${money(r.gap)}</td>
      <td class="py-2.5 px-3 text-right font-semibold tabular-nums ${r.risk === 'Alto' ? 'text-error' : 'text-on-surface-variant'}">${signed(r.pct)}%</td>
      <td class="py-2.5 px-3 text-right text-outline tabular-nums">${num(r.n)}</td>
      <td class="py-2.5 px-3 text-center text-on-surface-variant">${r.cities}</td>
      <td class="py-2.5 pl-3 text-center"><span class="text-label-sm font-semibold ${badge} px-1.5 py-0.5">${r.risk}</span></td></tr>`
  }).join('')
  document.querySelectorAll('.gap-row').forEach(row => row.addEventListener('click', () => {
    setState(row.dataset.state)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
  $('sortGap').className = 'px-2 py-0.5 ' + (by === 'gap' ? 'text-primary font-semibold border-b-2 border-primary' : 'text-outline hover:text-primary')
  $('sortAlpha').className = 'px-2 py-0.5 ' + (by === 'alpha' ? 'text-primary font-semibold border-b-2 border-primary' : 'text-outline hover:text-primary')
}

// ─── CONTROLES DE FILTRO ─────────────────────────────────────────────────────
function showApiError(err) {
  console.error(err)
  const box = $('api-error')
  box.hidden = false
  box.textContent = `No se pudo conectar con la API (${CONFIG.ML_API_URL}). Inicia el servidor: cd ml-api && uvicorn app.main:app --reload`
}

$('stateSelect').addEventListener('change', e => setState(e.target.value))
$('channelSelect').addEventListener('change', e => { S.channel = e.target.value; loadForecast().catch(showApiError) })
$('horizonBtns').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  S.horizon = +b.dataset.h
  document.querySelectorAll('#horizonBtns button').forEach(x => {
    x.className = 'px-2 py-0.5 text-body-sm ' + (x === b ? 'font-semibold text-primary border-b-2 border-primary' : 'text-outline hover:text-primary')
  })
  paintForecast()
})
let rankFilter = 'all'
function filterRows() {
  const t = $('stateSearch').value.toLowerCase()
  document.querySelectorAll('.state-row').forEach(r => {
    const ok = (rankFilter === 'all' || r.dataset.cat === rankFilter) && r.dataset.state.toLowerCase().includes(t)
    r.style.display = ok ? '' : 'none'
  })
}
$('rankFilters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  rankFilter = b.dataset.f
  document.querySelectorAll('#rankFilters button').forEach(x => {
    x.className = 'px-2 py-0.5 text-label-sm ' + (x === b ? 'font-semibold text-primary border-b-2 border-primary' : 'text-outline hover:text-primary')
  })
  filterRows()
})
$('stateSearch').addEventListener('input', filterRows)
$('sortGap').addEventListener('click', () => drawGapTable('gap'))
$('sortAlpha').addEventListener('click', () => drawGapTable('alpha'))

// ─── REGISTROS (SUPABASE) ────────────────────────────────────────────────────
const TABLE = 'tortilla_prices'
const PAGE_SIZE = 100
let currentPage = 1
let totalPages = 1
let totalRecords = 0

const supabaseConfigured = typeof supabase !== 'undefined' && CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('TU-PROYECTO')
const db = supabaseConfigured ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null

function tableMessage(text) {
  $('table-body').innerHTML = `<tr><td colspan="9" class="loading">${escapeHtml(text)}</td></tr>`
}

async function renderTable(page = 1) {
  if (!db) { tableMessage('Configura SUPABASE_URL y SUPABASE_ANON_KEY en config.js (ver README).'); return }
  currentPage = page
  tableMessage('Cargando...')
  const from = (page - 1) * PAGE_SIZE
  let q = db.from(TABLE).select('*', { count: 'estimated' }).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
  if ($('t-state').value) q = q.eq('state', $('t-state').value)
  if ($('t-store').value) q = q.eq('store_type', $('t-store').value)
  const { data, error, count } = await q
  if (error) { tableMessage(`Error: ${error.message}`); return }

  totalRecords = count || 0
  totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE))
  if (!data.length) { tableMessage('No hay datos disponibles'); updatePagination(); return }

  const tbody = $('table-body')
  tbody.innerHTML = ''
  data.forEach(row => {
    const tr = document.createElement('tr')
    tr.className = 'hover:bg-surface-container-low/50'
    ;['id', 'state', 'city', 'year', 'month', 'day', 'store_type'].forEach(col => {
      const td = document.createElement('td')
      td.className = 'py-2 px-3 ' + (col === 'id' ? 'text-outline' : '')
      td.textContent = row[col]
      tr.appendChild(td)
    })
    const price = document.createElement('td')
    price.className = 'py-2 px-3 text-right font-semibold tabular-nums'
    price.textContent = row.price_per_kilogram ?? ''
    price.contentEditable = 'true'
    price.addEventListener('blur', () => saveCell(row.id, price.textContent.trim(), row.price_per_kilogram))
    tr.appendChild(price)

    const act = document.createElement('td')
    act.className = 'py-2 px-3 text-right whitespace-nowrap'
    const edit = document.createElement('button')
    edit.textContent = 'Editar'
    edit.className = 'px-2 py-1 rounded border border-surface-container text-primary text-label-sm mr-1 hover:bg-surface-container-low'
    edit.addEventListener('click', () => openModal(row.id))
    const del = document.createElement('button')
    del.textContent = 'Eliminar'
    del.className = 'px-2 py-1 rounded border border-surface-container text-error text-label-sm hover:bg-error-container'
    del.addEventListener('click', () => deleteRecord(row.id))
    act.append(edit, del)
    tr.appendChild(act)
    tbody.appendChild(tr)
  })
  updatePagination()
}

function updatePagination() {
  $('current-page').textContent = currentPage
  $('total-pages').textContent = totalPages
  $('total-records').textContent = num(totalRecords)
  $('prev-btn').disabled = currentPage === 1
  $('next-btn').disabled = currentPage >= totalPages
}
function prevPage() { if (currentPage > 1) renderTable(currentPage - 1) }
function nextPage() { if (currentPage < totalPages) renderTable(currentPage + 1) }
$('t-state').addEventListener('change', () => renderTable(1))
$('t-store').addEventListener('change', () => renderTable(1))

async function saveCell(id, value, previous) {
  if (String(previous ?? '') === value) return
  const price = value === '' ? null : Number(value)
  if (price !== null && (isNaN(price) || price < 0 || price > 100)) { showToast('Valor inválido (0–100)'); renderTable(currentPage); return }
  const { error } = await db.from(TABLE).update({ price_per_kilogram: price }).eq('id', id)
  if (error) { showToast('Error al guardar'); console.error(error); return }
  showToast('Guardado ✓')
}

// Modal agregar / editar (un solo formulario)
async function openModal(id = null) {
  if (!db) { showToast('Configura Supabase en config.js'); return }
  $('record-form').reset()
  $('rec-id').value = ''
  $('modal-title').textContent = id ? 'Editar registro' : 'Agregar registro'
  if (id) {
    const { data, error } = await db.from(TABLE).select('*').eq('id', id).single()
    if (error) { showToast('Error al cargar registro'); return }
    $('rec-id').value = data.id
    $('rec-state').value = data.state
    $('rec-city').value = data.city
    $('rec-year').value = data.year
    $('rec-month').value = data.month
    $('rec-day').value = data.day
    $('rec-store').value = data.store_type
    $('rec-price').value = data.price_per_kilogram ?? ''
  }
  $('record-modal').classList.add('show')
}
function closeModal() { $('record-modal').classList.remove('show'); $('record-form').reset() }

async function nextId() {
  const { data, error } = await db.from(TABLE).select('id').order('id', { ascending: false }).limit(1)
  return error || !data.length ? 1 : data[0].id + 1
}

$('record-form').addEventListener('submit', async e => {
  e.preventDefault()
  const f = new FormData(e.target)
  const record = {
    state: f.get('state'), city: f.get('city').trim(),
    year: Number(f.get('year')), month: Number(f.get('month')), day: Number(f.get('day')),
    store_type: f.get('store_type'),
    price_per_kilogram: f.get('price_per_kilogram') === '' ? null : Number(f.get('price_per_kilogram')),
  }
  const id = f.get('id')
  const { error } = id
    ? await db.from(TABLE).update(record).eq('id', id)
    : await db.from(TABLE).insert({ id: await nextId(), ...record })
  if (error) { showToast('Error al guardar registro'); console.error(error); return }
  showToast(id ? 'Cambios guardados ✓' : 'Registro agregado ✓')
  closeModal()
  renderTable(currentPage)
})

async function deleteRecord(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer.')) return
  const { error } = await db.from(TABLE).delete().eq('id', id)
  if (error) { showToast('Error al eliminar registro'); console.error(error); return }
  showToast('Registro eliminado ✓')
  if (currentPage === totalPages && totalRecords % PAGE_SIZE === 1) currentPage = Math.max(1, currentPage - 1)
  renderTable(currentPage)
}

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  $('f-channel').hidden = false
  try {
    SUMMARY = await api('/summary')
  } catch (err) { showApiError(err); return }
  const opts = SUMMARY.states.map(s => `<option value="${escapeHtml(s.value)}">${escapeHtml(s.name)}</option>`).join('')
  $('stateSelect').insertAdjacentHTML('beforeend', opts)
  $('t-state').insertAdjacentHTML('beforeend', opts)
  $('rec-state').innerHTML = opts
  renderDashboard()
  renderChannels()
  setState('ALL')
}
init()
