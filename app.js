/* ================== CONFIG ================== */
const SHEET_ID   = '1iSRn3PrGgr0F7T-c-mKnEa-nmRU0PH626D3hLe7V7Jw';
const SHEET_NAME = 'data';
const COLS = { ts:0, device:1, devEui:2, ec:3, ph:4, n:5, p:6, k:7, moi:8, rssi:9, snr:10, bat:11 };

/* ================== Helpers ================== */
function sqlQuote(s){ return `'${String(s).replace(/'/g,"''")}'`; }
function gvizURL({limit=100, startDate=null, endDate=null, device=null}={}){
  const where = [];
  if (startDate) where.push(`A >= datetime ${sqlQuote(startDate + ' 00:00:00')}`);
  if (endDate)   where.push(`A <= datetime ${sqlQuote(endDate   + ' 23:59:59')}`);
  if (device)    where.push(`B = ${sqlQuote(device)}`);
  const whereClause = where.length ? ` where ${where.join(' and ')}` : '';
  const limitClause = (limit && Number.isFinite(limit)) ? ` limit ${limit}` : '';
  const query = `select A,B,C,D,E,F,G,H,I,J,K,L${whereClause} order by A desc${limitClause}`;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tqx=out:json&tq=${encodeURIComponent(query)}`;
}
function parseGviz(text){
  const start = text.indexOf('(')+1;
  const end   = text.lastIndexOf(')');
  const json  = JSON.parse(text.slice(start, end));
  const rows  = (json.table.rows || []).map(r => (r.c.map(cell => cell ? cell.v : null)));
  return { rows };
}
function parseDateToken(v){
  if (typeof v === 'string' && v.startsWith('Date(')){
    const m = /Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(v);
    if (m){ const [_,y,mo,d,h,mi,s] = m.map(Number); return new Date(y, mo, d, h, mi, s); }
  }
  if (v instanceof Date) return v;
  return v ? new Date(v) : null;
}
function fmtTime(d){ return d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '–'; }
function toNum(v){ const n=Number(v); return Number.isFinite(n) ? n : null; }
function uniq(arr){ return [...new Set(arr)]; }

/* ================== Feedback / Toast ================== */
function showToast(msg, {timeout=2600}={}){
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  stack.appendChild(div);
  setTimeout(()=>{ div.classList.add('out'); setTimeout(()=> div.remove(), 400); }, timeout);
  const live = document.getElementById('filterAnnouncer');
  if (live){ live.textContent = msg; }
}
function formatDateRange(){
  const s = startDateFilter.value || 'ไม่ระบุ';
  const e = endDateFilter.value || 'ไม่ระบุ';
  return `${s} – ${e}`;
}

/* ================== State / Refs ================== */
let CHART, cache=[], timer;
const ddDevice   = document.getElementById('deviceFilter');
const ddPoints   = document.getElementById('pointFilter');
// Removed refresh select; fixed interval
const REFRESH_SEC = 60;
const startDateFilter = document.getElementById('startDateFilter');
const endDateFilter   = document.getElementById('endDateFilter');
const elUpdated  = document.getElementById('updated');
const elEC = document.getElementById('ec'); const elPH = document.getElementById('ph');
const elN  = document.getElementById('n'); const elP  = document.getElementById('p'); const elK  = document.getElementById('k');
const elMOI = document.getElementById('moi'); const elBAT = document.getElementById('bat');
const elRSSI = document.getElementById('rssi'); const elSNR  = document.getElementById('snr'); const elDev  = document.getElementById('dev');
const summaryGrid = document.getElementById('summaryGrid');
const tbody  = document.getElementById('tableBody');

/* ================== Theme ================== */
function currentTheme(){ return document.documentElement.getAttribute('data-theme') || 'light'; }
function setTheme(theme){ document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('smfarm-theme', theme); applyChartTheme(theme); updateThemeIcon(theme); }
function updateThemeIcon(theme){ const btn = document.getElementById('themeToggle'); if (btn) btn.textContent = theme === 'dark' ? '☾' : '☀'; }
function applyChartTheme(theme){ if (!CHART) return; const legendColor = theme === 'dark' ? '#e5e5e5' : '#111111'; const tickColor = theme === 'dark' ? '#c9c9c9' : '#444'; const gridColor = theme === 'dark' ? '#262626' : '#ececec'; CHART.options.plugins.legend.labels.color = legendColor; CHART.options.scales.x.ticks.color = tickColor; CHART.options.scales.y.ticks.color = tickColor; CHART.options.scales.x.grid.color = gridColor; CHART.options.scales.y.grid.color = gridColor; CHART.update('none'); }

/* ================== Fetch & Build ================== */
async function fetchSheet({limit, startDate, endDate, device}={}){ const res  = await fetch(gvizURL({limit, startDate, endDate, device}), {cache:'no-store'}); const text = await res.text(); const { rows } = parseGviz(text); cache = rows.map(r => ({ ts:  parseDateToken(r[0]), device: r[1] ?? '', devEui: r[2] ?? '', ec:  toNum(r[3]), ph:  toNum(r[4]), n:   toNum(r[5]), p:   toNum(r[6]), k:   toNum(r[7]), moi: toNum(r[8]), rssi:toNum(r[9]), snr: toNum(r[10]), bat: toNum(r[11]), })); elUpdated.textContent = 'updated ' + (cache[0] ? fmtTime(cache[0].ts) : '-'); const devices = uniq(cache.map(d => d.device).filter(Boolean)); const cur = ddDevice.value; ddDevice.innerHTML = `<option value="">ทั้งหมด (${devices.length})</option>` + devices.map(x => `<option ${x===cur?'selected':''} value="${x}">${x}</option>`).join(''); }
function filterRows(){ const device = ddDevice.value; const startDate = startDateFilter.value; const endDate = endDateFilter.value; let filtered = cache.slice(); if (device) filtered = filtered.filter(r => r.device === device); if (startDate || endDate){ filtered = filtered.filter(r => { if (!r.ts) return false; const rowDate = dayjs(r.ts).format('YYYY-MM-DD'); if (startDate && rowDate < startDate) return false; if (endDate && rowDate > endDate) return false; return true; }); } return filtered; }
function updateKPIs(latest){ const NIL='–'; if (!latest){ [elEC,elPH,elN,elP,elK,elMOI,elBAT].forEach(el=>el.textContent=NIL); elRSSI.textContent = elSNR.textContent = elDev.textContent = NIL; return; } elEC.textContent = latest.ec ?? NIL; elPH.textContent = latest.ph ?? NIL; elN.textContent  = latest.n  ?? NIL; elP.textContent  = latest.p  ?? NIL; elK.textContent  = latest.k  ?? NIL; elMOI.textContent = latest.moi ?? NIL; elBAT.textContent = latest.bat ?? NIL; elRSSI.textContent = (latest.rssi ?? NIL); elSNR.textContent = (latest.snr ?? NIL); elDev.textContent  = latest.device && latest.devEui ? `${latest.device} · ${latest.devEui}` : (latest.device || latest.devEui || NIL); }
function updateSummary(rows) { const metrics = ['ec', 'ph', 'n', 'p', 'k', 'moi', 'bat']; summaryGrid.innerHTML = ''; if (!rows.length){ summaryGrid.innerHTML = '<div class="card" style="color:var(--muted)">ไม่มีข้อมูลในช่วงที่เลือก</div>'; return; } metrics.forEach(metric => { const values = rows.map(r => r[metric]).filter(v => v !== null && !isNaN(v)); if (!values.length) return; const sum = values.reduce((a, b) => a + b, 0); const avg = sum / values.length; const min = Math.min(...values); const max = Math.max(...values); summaryGrid.insertAdjacentHTML('beforeend', `<div class="card"><div class="t">${metric.toUpperCase()}</div><div style="font-size:14px; margin-top:4px;">Avg: <span class="v">${avg.toFixed(2)}</span></div><div class="t">Min: ${min.toFixed(2)}</div><div class="t">Max: ${max.toFixed(2)}</div></div>`); }); }
function updateTable(rows){ tbody.innerHTML = rows.slice(0, 60).map(r => `<tr><td>${fmtTime(r.ts)}</td><td>${r.device || ''}</td><td>${r.ec ?? ''}</td><td>${r.ph ?? ''}</td><td>${r.n ?? ''}</td><td>${r.p ?? ''}</td><td>${r.k ?? ''}</td><td>${r.moi ?? ''}</td><td>${r.bat ?? ''}</td><td>${r.rssi ?? ''}</td><td>${r.snr ?? ''}</td></tr>`).join(''); }
function makeChart(ctx){ const colors = { ec:'#1f77b4', ph:'#e45756', n:'#f2af58', p:'#72b7b2', k:'#4c78a8', moi:'#54a24b', bat:'#b279a2' }; return new Chart(ctx, { type:'line', data:{ labels: [], datasets:[ {label:'EC',borderColor:colors.ec,backgroundColor:colors.ec,data:[],tension:.25}, {label:'pH',borderColor:colors.ph,backgroundColor:colors.ph,data:[],tension:.25}, {label:'N',borderColor:colors.n,backgroundColor:colors.n,data:[],tension:.25}, {label:'P',borderColor:colors.p,backgroundColor:colors.p,data:[],tension:.25}, {label:'K',borderColor:colors.k,backgroundColor:colors.k,data:[],tension:.25}, {label:'MOI',borderColor:colors.moi,backgroundColor:colors.moi,data:[],tension:.25}, {label:'BAT',borderColor:colors.bat,backgroundColor:colors.bat,data:[],tension:.25}, ]}, options:{ responsive:true, maintainAspectRatio:false, interaction:{ mode:'nearest', intersect:false }, plugins:{ legend:{ labels:{ color:'#111', usePointStyle:true, pointStyle:'circle', pointRadius:4, boxWidth:10, boxHeight:10 } }, tooltip:{ callbacks:{ title: function(context) { return context[0].parsed.x !== undefined ? CHART.data.meta[context[0].dataIndex] || context[0].label : context[0].label; } } } }, scales:{ x:{ ticks:{ color:'#444' }, grid:{ color:'#ececec' } }, y:{ ticks:{ color:'#444' }, grid:{ color:'#ececec' } } } } }); }
function updateChart(rows){ const labels = rows.map(r => dayjs(r.ts).format('DD/MM/YY')).reverse(); const timeLabels = rows.map(r => dayjs(r.ts).format('DD/MM/YYYY HH:mm:ss')).reverse(); const pick = k => rows.map(r => r[k]).reverse(); CHART.data.labels = labels; CHART.data.meta = timeLabels; CHART.data.datasets[0].data = pick('ec'); CHART.data.datasets[1].data = pick('ph'); CHART.data.datasets[2].data = pick('n'); CHART.data.datasets[3].data = pick('p'); CHART.data.datasets[4].data = pick('k'); CHART.data.datasets[5].data = pick('moi'); CHART.data.datasets[6].data = pick('bat'); CHART.update('none'); }

/* ================== Export ================== */
function exportCSVRange(startISO, endISO){ const device = ddDevice.value; let rows = cache.slice(); if (device) rows = rows.filter(r => r.device === device); const start = startISO ? dayjs(startISO) : null; const end   = endISO ? dayjs(endISO)   : null; if (start || end){ rows = rows.filter(r => { if (!r.ts) return false; const t = dayjs(r.ts); if (start && t.isBefore(start)) return false; if (end && t.isAfter(end)) return false; return true; }); } const header = ['Time','Device','EC','pH','N','P','K','MOI','BAT','RSSI','SNR']; const lines = [header.join(',')].concat(rows.map(r => [ fmtTime(r.ts), r.device || '', r.ec ?? '', r.ph ?? '', r.n ?? '', r.p ?? '', r.k ?? '', r.moi ?? '', r.bat ?? '', r.rssi ?? '', r.snr ?? '' ].map(v => { const s = (v ?? '').toString(); return s.includes(',') ? `"${s.replace(/"/g,'""')}"` : s; }).join(','))); const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); const dev = ddDevice.value || 'all'; const sn = startISO ? dayjs(startISO).format('YYYY-MM-DD_HH-mm') : (startDateFilter.value || 'start'); const en = endISO ? dayjs(endISO).format('YYYY-MM-DD_HH-mm') : (endDateFilter.value || 'end'); a.download = `smfarm-${dev}-${sn}_to_${en}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }

/* ================== Refresh ================== */
async function refresh(){ const baseLimit = Number(ddPoints.value || 100); const startDate = startDateFilter.value || null; const endDate = endDateFilter.value   || null; const hasRange  = !!(startDate || endDate); const allDevicesSelected = !ddDevice.value; const fetchLimit = hasRange ? null : baseLimit * (allDevicesSelected ? 8 : 1); await fetchSheet({limit: fetchLimit, startDate, endDate}); const rows = filterRows(); updateKPIs(rows[0]); updateChart(rows.slice(0, baseLimit)); updateSummary(rows.slice(0, baseLimit)); updateTable(rows); }
function startAuto(){ if (timer) clearInterval(timer); timer = setInterval(refresh, REFRESH_SEC*1000); }

/* ================== Boot ================== */
window.addEventListener('DOMContentLoaded', async () => { CHART = makeChart(document.getElementById('chart').getContext('2d')); applyChartTheme(currentTheme()); updateThemeIcon(currentTheme()); document.getElementById('themeToggle').addEventListener('click', () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); showToast(`ธีมตอนนี้: ${currentTheme()==='dark' ? 'โหมดมืด' : 'โหมดสว่าง'}`); }); const modal = document.getElementById('exportModal'); document.getElementById('exportCsvBtn').addEventListener('click', () => { const now = dayjs(); document.getElementById('exportEnd').value = now.format('YYYY-MM-DDTHH:mm'); const startHint = startDateFilter.value ? dayjs(startDateFilter.value).startOf('day') : now.subtract(7, 'day').startOf('day'); document.getElementById('exportStart').value = startHint.format('YYYY-MM-DDTHH:mm'); modal.style.display = 'flex'; showToast('เปิดหน้าต่าง Export'); }); document.getElementById('exportCancel').addEventListener('click', ()=> { modal.style.display='none'; showToast('ยกเลิก Export'); }); modal.addEventListener('click', e => { if (e.target === modal) modal.style.display='none'; }); document.getElementById('exportConfirm').addEventListener('click', () => { const sEl = document.getElementById('exportStart'); const eEl = document.getElementById('exportEnd'); const s = sEl.value, e = eEl.value; let invalid = false; [sEl,eEl].forEach(el=>{ el.classList.remove('invalid'); el.closest('.field')?.classList.remove('error-state'); }); if (!s) { sEl.classList.add('invalid'); sEl.closest('.field')?.classList.add('error-state'); invalid = true; } if (!e) { eEl.classList.add('invalid'); eEl.closest('.field')?.classList.add('error-state'); invalid = true; } if (invalid){ showToast('กรุณาเลือกช่วงวันและเวลาให้ครบ'); return; } if (s > e) { eEl.classList.add('invalid'); eEl.closest('.field')?.classList.add('error-state'); showToast('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น'); return; } modal.style.display='none'; exportCSVRange(s, e); showToast('กำลังดาวน์โหลดไฟล์ CSV'); }); ['exportStart','exportEnd'].forEach(id => { const el = document.getElementById(id); el.addEventListener('input', () => { el.classList.remove('invalid'); el.closest('.field')?.classList.remove('error-state'); }); }); const chips = [ 'rangeToday','range7','range30' ].map(id=>document.getElementById(id)); function setActive(btn){ chips.forEach(c=>c.setAttribute('aria-pressed','false')); if (btn) btn.setAttribute('aria-pressed','true'); } document.getElementById('rangeToday').addEventListener('click', () => { setActive(document.getElementById('rangeToday')); const today = dayjs().format('YYYY-MM-DD'); startDateFilter.value = today; endDateFilter.value = today; refresh(); showToast('เลือกช่วง: วันนี้'); }); document.getElementById('range7').addEventListener('click', () => { setActive(document.getElementById('range7')); startDateFilter.value = dayjs().subtract(6,'day').format('YYYY-MM-DD'); endDateFilter.value = dayjs().format('YYYY-MM-DD'); refresh(); showToast('เลือกช่วง: 7 วันล่าสุด'); }); document.getElementById('range30').addEventListener('click', () => { setActive(document.getElementById('range30')); startDateFilter.value = dayjs().subtract(29,'day').format('YYYY-MM-DD'); endDateFilter.value = dayjs().format('YYYY-MM-DD'); refresh(); showToast('เลือกช่วง: 30 วันล่าสุด'); }); ddDevice.addEventListener('change', () => { refresh(); const txt = ddDevice.value ? `Device: ${ddDevice.value}` : 'Device: ทั้งหมด'; showToast(txt); }); ddPoints.addEventListener('change', () => { refresh(); showToast(`กราฟล่าสุด ${ddPoints.value} จุด`); }); startDateFilter.addEventListener('change', () => { if (endDateFilter.value && startDateFilter.value > endDateFilter.value) endDateFilter.value = startDateFilter.value; refresh(); }); endDateFilter.addEventListener('change', () => { if (startDateFilter.value && startDateFilter.value > endDateFilter.value) endDateFilter.value = startDateFilter.value; refresh(); showToast(`ช่วงวันที่: ${formatDateRange()}`); }); document.querySelectorAll('.field[data-click-focus]').forEach(f => { f.addEventListener('click', e => { if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; const ctrl = f.querySelector('select, input, button'); if (ctrl){ ctrl.focus({preventScroll:true}); if (ctrl.tagName === 'INPUT' && (ctrl.type === 'date' || ctrl.type === 'datetime-local')){ if (typeof ctrl.showPicker === 'function') { try { ctrl.showPicker(); } catch {} } else { ctrl.click(); } } } }); }); await refresh(); startAuto(); });