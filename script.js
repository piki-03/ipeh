'use strict';

// === IMPORT SUPABASE CLIENT VIA CDN ===
const SUPABASE_URL = "https://zyogoissymtonfkyjqxf.supabase.co";
const SUPABASE_KEY = "sb_publishable_3uDWsaihi6doAxFdmC_VKA_GG-_aD36";

// Variabel diubah menjadi supabaseClient agar tidak bentrok dengan objek global CDN
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// /* ── STATE ── */
// let state = {
//   profile: null,
//   logs: [],
//   sensorTemp: null,   // Nilai dibaca live dari database Supabase
//   heaterTemp: 37,     // Default awal aktif
//   vibration: null,    
// };

const DEVICE_ID = 1; // ID Baris status alat pada tabel device_status

/* ── INITIALIZE SUPABASE REALTIME ── */
async function initSupabaseRealtime() {
  if (!supabaseClient) {
    console.error("Supabase SDK gagal dimuat!");
    return;
  }

  // 1. Ambil data awal dari database saat aplikasi dibuka
  const { data, error } = await supabaseClient
    .from('device_status')
    .select('*')
    .eq('id', DEVICE_ID)
    .single();

  if (!error && data) {
    state.sensorTemp = data.sensor_temp;
    if (data.heater_pwm) state.heaterTemp = data.heater_pwm;
    if (data.vibration_pwm) state.vibration = data.vibration_pwm;
    refreshDash();
  }

  // 2. Berlangganan (Subscribe) Perubahan Realtime dari ESP32
  supabaseClient
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'device_status', filter: `id=eq.${DEVICE_ID}` },
      (payload) => {
        const newData = payload.new;
        state.sensorTemp = newData.sensor_temp;
        
        // Auto-refresh jika user sedang di halaman dashboard
        if (document.getElementById('page-dashboard').classList.contains('active')) {
          refreshDash();
        }
      }
    )
    .subscribe();
}

/* ── LOG KE DATABASE CLOUD ── */
async function pushLogToSupabase(aksi) {
  if (!state.profile || !supabaseClient) return;

  const logData = {
    nama: state.profile.nama,
    umur: state.profile.umur,
    tanggal_input: state.profile.tanggal,
    gender: state.profile.gender,
    suhu_sensor: state.sensorTemp !== null ? state.sensorTemp + '°C' : '-',
    pemanas: state.heaterTemp ? state.heaterTemp + '°C' : '-',
    getaran: state.vibration ? `Volume ${state.vibration}` : '-',
    aksi: aksi
  };

  // Simpan ke tabel cloud Supabase
  const { error } = await supabaseClient.from('therapy_logs').insert([logData]);
  if (error) console.error("Gagal menyimpan log ke cloud:", error);

  // Tetap masukkan ke state lokal untuk performa UI instan
  state.logs.push({
    waktu: nowStr(),
    ...logData,
    suhu: logData.suhu_sensor,
  });
}

/* ── UPDATE REMOTE CONTROL (Kirim Data ke ESP32 via DB) ── */
async function updateDeviceControl() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient
    .from('device_status')
    .update({ 
      heater_pwm: state.heaterTemp ? state.heaterTemp : 0, 
      vibration_pwm: state.vibration ? state.vibration : 0 
    })
    .eq('id', DEVICE_ID);

  if (error) console.error("Gagal mengirim perintah kontrol ke database:", error);
}

/* ── CLOCK ── */
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const el = document.getElementById('status-time');
  if (el) el.textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 10000);

/* ── TOAST ── */
let toastTimer;
const toastEl = document.getElementById('toast');
function showToast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ── NAVIGATION ── */
const navBtns = document.querySelectorAll('.nav-btn');
const pages   = document.querySelectorAll('.page');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    if (!state.profile && target !== 'input') {
      showToast('⚠ Isi data profil terlebih dahulu');
      return;
    }
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    switchPage(target);
  });
});

function switchPage(id) {
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelector('.phone-body').scrollTop = 0;

  if (id === 'dashboard') refreshDash();
  if (id === 'riwayat')   renderLogs();
  if (id === 'profile')   renderProfile();
}

/* ── INPUT PAGE ── */
const inpTanggal = document.getElementById('inp-tanggal');
if (inpTanggal) inpTanggal.value = todayStr();

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }

let selectedGender = 'Pria';
const genderGroup = document.getElementById('gender-group');
genderGroup.querySelectorAll('.gender-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    genderGroup.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedGender = btn.dataset.value;
  });
});

document.getElementById('btn-start').addEventListener('click', () => {
  const nama    = document.getElementById('inp-nama').value.trim();
  const umur    = document.getElementById('inp-umur').value.trim();
  const tanggal = document.getElementById('inp-tanggal').value;

  if (!nama)                         { showToast('⚠ Nama tidak boleh kosong'); return; }
  if (!umur || isNaN(+umur) || +umur < 1) { showToast('⚠ Umur tidak valid'); return; }
  if (!tanggal)                      { showToast('⚠ Tanggal harus diisi'); return; }

  if (state.profile && state.profile.nama !== nama) {
    if (!confirm(`Profil aktif: "${state.profile.nama}". Ganti profil akan hapus semua log. Lanjutkan?`)) return;
    hardReset();
  }

  state.profile = { nama, umur: +umur, tanggal, gender: selectedGender };

  document.getElementById('hero-greeting').textContent = `Halo, ${nama} 👋`;
  document.getElementById('hero-avatar').textContent   = nama.charAt(0).toUpperCase();

  pushLogToSupabase('Sesi dimulai');
  showToast(`✓ Sesi dimulai — ${nama}`);

  navBtns.forEach(b => b.classList.remove('active'));
  navBtns[1].classList.add('active');
  switchPage('dashboard');
  
  updateDeviceControl();
});

/* ── DASHBOARD ── */
function refreshDash() {
  const name = state.profile ? state.profile.nama : 'Tamu';
  document.getElementById('dash-hello').textContent = `Hello ${name} 👋`;

  const temp = state.sensorTemp;
  document.getElementById('gauge-val').textContent = temp !== null ? temp : '--';
  document.getElementById('mini-temp').textContent = temp !== null ? `${temp}°C` : '--';

  drawGauge(temp);

  document.getElementById('mini-vib').textContent  = state.vibration ? `Vol ${state.vibration}` : 'OFF';
  document.getElementById('mini-heat').textContent = state.heaterTemp ? `${state.heaterTemp}°C` : 'OFF';
}

/* ── GAUGE GRAPHIC ── */
function drawGauge(value) {
  const canvas = document.getElementById('gaugeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H - 12;
  const r  = 100;
  const startA = Math.PI;
  const endA   = 2 * Math.PI;

  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA);
  ctx.strokeStyle = '#1e2238';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (value !== null) {
    const min = 20, max = 50;
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const curA  = startA + ratio * Math.PI;

    const grd = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grd.addColorStop(0,    '#00e5ff');
    grd.addColorStop(0.5,  '#e040fb');
    grd.addColorStop(1,    '#ffd740');

    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, curA);
    ctx.strokeStyle = grd;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    const nx = cx + r * Math.cos(curA);
    const ny = cy + r * Math.sin(curA);
    ctx.beginPath();
    ctx.arc(nx, ny, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const min = 20, max = 50;
  [20, 25, 30, 35, 40, 45, 50].forEach(t => {
    const ratio = (t - min) / (max - min);
    const a  = startA + ratio * Math.PI;
    const r1 = r + 8, r2 = r + 14;
    const x1 = cx + r1 * Math.cos(a);
    const y1 = cy + r1 * Math.sin(a);
    const x2 = cx + r2 * Math.cos(a);
    const y2 = cy + r2 * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = t % 10 === 0 ? '#3a4060' : '#272a3d';
    ctx.lineWidth = t % 10 === 0 ? 2 : 1;
    ctx.stroke();
  });

  ctx.fillStyle = '#3a4060';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  [[20,'20'],[35,'35'],[50,'50']].forEach(([t, lbl]) => {
    const a  = startA + ((t - min) / (max - min)) * Math.PI;
    const lr = r + 22;
    const lx = cx + lr * Math.cos(a);
    const ly = cy + lr * Math.sin(a);
    ctx.fillText(lbl, lx, ly + 4);
  });
}

/* ── HEATER SWITCHES ── */
document.querySelectorAll('.heater-sw').forEach(sw => {
  sw.addEventListener('change', () => {
    const temp = +sw.dataset.temp;
    if (sw.checked) {
      document.querySelectorAll('.heater-sw').forEach(s => {
        if (s !== sw) s.checked = false;
      });
      state.heaterTemp = temp;
      pushLogToSupabase(`Pemanas diaktifkan ${temp}°C`);
      showToast(`⚡ Pemanas ${temp}°C ON`);
    } else {
      state.heaterTemp = null;
      pushLogToSupabase('Pemanas dimatikan');
      showToast('Pemanas OFF');
    }
    document.getElementById('mini-heat').textContent = state.heaterTemp ? `${state.heaterTemp}°C` : 'OFF';
    
    updateDeviceControl();
  });
});

/* ── VIBRATION SWITCHES ── */
document.querySelectorAll('.vib-sw').forEach(sw => {
  sw.addEventListener('change', () => {
    const vol = +sw.dataset.vol;
    if (sw.checked) {
      document.querySelectorAll('.vib-sw').forEach(s => {
        if (s !== sw) s.checked = false;
      });
      state.vibration = vol;
      pushLogToSupabase(`Getaran diaktifkan Volume ${vol}`);
      showToast(`〜 Getaran Volume ${vol} ON`);
    } else {
      state.vibration = null;
      pushLogToSupabase('Getaran dimatikan');
      showToast('Getaran OFF');
    }
    document.getElementById('mini-vib').textContent = state.vibration ? `Vol ${state.vibration}` : 'OFF';
    
    updateDeviceControl();
  });
});

/* ── RENDER LOG CARDS ── */
function renderLogs() {
  const list  = document.getElementById('log-list');
  const count = document.getElementById('log-count');
  count.textContent = `${state.logs.length} entri`;

  if (state.logs.length === 0) {
    list.innerHTML = `
      <div class="log-empty">
        <div class="empty-ico">📋</div>
        <p>Belum ada log.<br/>Mulai sesi dari menu Input.</p>
      </div>`;
    return;
  }

  list.innerHTML = state.logs.map((log, i) => `
    <div class="log-card">
      <div class="log-card-top">
        <span class="log-num">#${i + 1}</span>
        <span class="log-time">${log.waktu}</span>
        <button class="log-del" data-idx="${i}">Hapus</button>
      </div>
      <div class="log-name">${log.nama}</div>
      <div class="log-meta">
        <div class="log-meta-item">
          <span class="lm-lbl">Umur</span>
          <span class="lm-val">${log.umur} th</span>
        </div>
        <div class="log-meta-item">
          <span class="lm-lbl">Gender</span>
          <span class="lm-val">${log.gender}</span>
        </div>
        <div class="log-meta-item">
          <span class="lm-lbl">Suhu Sensor</span>
          <span class="lm-val cyan">${log.suhu}</span>
        </div>
        <div class="log-meta-item">
          <span class="lm-lbl">Pemanas</span>
          <span class="lm-val cyan">${log.pemanas}</span>
        </div>
        <div class="log-meta-item">
          <span class="lm-lbl">Getaran</span>
          <span class="lm-val magenta">${log.getaran}</span>
        </div>
        <div class="log-meta-item">
          <span class="lm-lbl">Tgl Input</span>
          <span class="lm-val">${log.tanggal_input || log.tanggal}</span>
        </div>
      </div>
      <div class="log-aksi">${log.aksi}</div>
    </div>
  `).join('');

  list.querySelectorAll('.log-del').forEach(btn => {
    btn.addEventListener('click', () => {
      state.logs.splice(+btn.dataset.idx, 1);
      renderLogs();
      showToast('Entri dihapus');
    });
  });
}

function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ── DOWNLOAD EXCEL ── */
document.getElementById('btn-download').addEventListener('click', () => {
  if (state.logs.length === 0) { showToast('⚠ Tidak ada data'); return; }

  const headers = ['No','Waktu','Nama','Umur','Tgl Input','Gender','Suhu Sensor','Pemanas','Getaran','Aksi'];
  const esc = v => `"${String(v).replace(/"/g,'""')}"`;

  const profileInfo = state.profile
    ? `Profil: ${state.profile.nama} | Umur: ${state.profile.umur} | Gender: ${state.profile.gender} | Tgl: ${state.profile.tanggal}`
    : '-';

  const rows = state.logs.map((l, i) => [
    i+1, l.waktu, l.nama, l.umur, l.tanggal_input || l.tanggal, l.gender, l.suhu, l.pemanas, l.getaran, l.aksi
  ]);

  const lines = [
    esc('G-Genumax Dashboard — Log Data'),
    esc(profileInfo),
    esc(`Digenerate: ${nowStr()}`),
    '',
    headers.map(esc).join(','),
    ...rows.map(r => r.map(esc).join(',')),
    '',
    esc(`Total: ${state.logs.length} entri`),
  ];

  const csv  = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `s-home-log-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ File Excel diunduh');
});

/* ── PROFILE RENDER ── */
function renderProfile() {
  const p = state.profile;
  if (!p) {
    document.getElementById('profile-avatar').textContent = '?';
    document.getElementById('profile-name').textContent   = 'Belum ada profil';
    document.getElementById('profile-badge').textContent  = '—';
    document.getElementById('pstat-umur').textContent     = '—';
    document.getElementById('pstat-tgl').textContent      = '—';
    document.getElementById('pstat-log').textContent      = 0;
    return;
  }
  document.getElementById('profile-avatar').textContent = p.nama.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent   = p.nama;
  document.getElementById('profile-badge').textContent  = p.gender;
  document.getElementById('pstat-umur').textContent     = `${p.umur} th`;
  document.getElementById('pstat-tgl').textContent      = p.tanggal;
  document.getElementById('pstat-log').textContent      = state.logs.length;
}

/* ── RESET ── */
document.getElementById('btn-reset-profile').addEventListener('click', () => {
  if (!state.profile) { showToast('⚠ Belum ada profil aktif'); return; }
  if (!confirm('Semua log akan dihapus dan profil direset. Lanjutkan?')) return;
  hardReset();
  showToast('✓ Profil & log direset');
  navBtns.forEach(b => b.classList.remove('active'));
  navBtns[0].classList.add('active');
  switchPage('input');
});

function hardReset() {
  state.profile    = null;
  state.logs       = [];
  state.sensorTemp = null;
  state.heaterTemp = 37;
  state.vibration  = null;

  document.getElementById('inp-nama').value    = '';
  document.getElementById('inp-umur').value    = '';
  const inpTgl = document.getElementById('inp-tanggal');
  if (inpTgl) inpTgl.value = todayStr();
  document.getElementById('hero-greeting').textContent = 'Halo, Siapa kamu?';
  document.getElementById('hero-avatar').textContent   = '👤';

  genderGroup.querySelectorAll('.gender-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  selectedGender = 'Pria';

  document.querySelectorAll('.heater-sw').forEach((s,i) => s.checked = (i===0));
  document.querySelectorAll('.vib-sw').forEach(s => s.checked = false);

  drawGauge(null);
  updateDeviceControl();
}

/* ── INIT ON LOAD ── */
drawGauge(null);
initSupabaseRealtime();