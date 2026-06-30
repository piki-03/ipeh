'use strict';

// === IMPORT SUPABASE CLIENT VIA CDN ===
const SUPABASE_URL = "https://zyogoissymtonfkyjqxf.supabase.co";
const SUPABASE_KEY = "sb_publishable_3uDWsaihi6doAxFdmC_VKA_GG-_aD36";

const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

/* ── STATE ── */
let state = {
  profile: null,
  logs: [],
  sensorTemp: null,
  heaterOn: false,    // REVISI 4: Diubah dari heaterTemp (angka) menjadi heaterOn (boolean: true/false)
  vibration: null,
  timerEndAt: null,
  timerInterval: null,
};

const DEVICE_ID = 1;
const TIMER_DURATION = 15 * 60;

/* ── INITIALIZE SUPABASE REALTIME ── */
async function initSupabaseRealtime() {
  if (!supabaseClient) {
    console.error("Supabase SDK gagal dimuat!");
    return;
  }

  const { data, error } = await supabaseClient
    .from('device_status')
    .select('*')
    .eq('id', DEVICE_ID)
    .single();

  if (!error && data) {
    state.sensorTemp = data.sensor_temp;
    // REVISI 4: Jika heater_pwm dari database > 0, maka state heater dianggap true (ON)
    state.heaterOn = data.heater_pwm > 0;
    if (data.vibration_pwm) state.vibration = data.vibration_pwm;
    refreshDash();
  }

  supabaseClient
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'device_status', filter: `id=eq.${DEVICE_ID}` },
      (payload) => {
        const newData = payload.new;
        state.sensorTemp = newData.sensor_temp;
        
        // PERBAIKAN: Amankan dengan null check
        const pageDashboard = document.getElementById('page-dashboard');
        if (pageDashboard && pageDashboard.classList.contains('active')) {
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
    pemanas: state.heaterOn ? 'ON' : 'OFF', // REVISI 4: Log menyimpan status text 'ON' atau 'OFF'
    getaran: state.vibration ? `Volume ${state.vibration}` : '-',
    aksi: aksi
  };

  const { error } = await supabaseClient.from('therapy_logs').insert([logData]);
  if (error) console.error("Gagal menyimpan log ke cloud:", error);

  state.logs.push({
    waktu: nowStr(),
    ...logData,
    suhu: logData.suhu_sensor,
  });
}

/* ── UPDATE REMOTE CONTROL ── */
async function updateDeviceControl() {
  if (!supabaseClient) return;

  // PERBAIKAN: Hardware hanya boleh menerima nilai PWM jika timer sedang berjalan (state.timerEndAt tidak null)
  const isRunning = state.timerEndAt !== null;
  
  const pwmValue = (state.heaterOn && isRunning) ? 255 : 0;
  const vibValue = (state.vibration && isRunning) ? state.vibration : 0;

  const { error } = await supabaseClient
    .from('device_status')
    .update({ 
      heater_pwm: pwmValue, 
      vibration_pwm: vibValue 
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
  // REVISI 3: Logika pemanggilan halaman riwayat dikomentari
  // if (id === 'riwayat')   renderLogs(); 
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

  if (state.profile) {
    resetSessionControls();
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
  const dashHello = document.getElementById('dash-hello');
  if (dashHello) dashHello.textContent = `Hello ${name} 👋`;

  const temp = state.sensorTemp;
  const tempStr = temp !== null ? temp : '--';
  const tempCelciusStr = temp !== null ? `${temp}°C` : '--';

  const gaugeVal = document.getElementById('gauge-val');
  if (gaugeVal) gaugeVal.textContent = tempStr;

  const miniTemp = document.getElementById('mini-temp');
  if (miniTemp) miniTemp.textContent = tempCelciusStr;

  drawGauge(temp);

  const miniVib = document.getElementById('mini-vib');
  if (miniVib) miniVib.textContent = state.vibration ? `Vol ${state.vibration}` : 'OFF';
  
  const miniHeat = document.getElementById('mini-heat');
  if (miniHeat) miniHeat.textContent = state.heaterOn ? 'ON' : 'OFF';
  
  const heaterToggle = document.getElementById('heater-toggle');
  if (heaterToggle) heaterToggle.checked = state.heaterOn;
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
    grd.addColorStop(0,     '#00e5ff');
    grd.addColorStop(0.5,   '#e040fb');
    grd.addColorStop(1,     '#ffd740');

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

/* ── HEATER SWITCH (REVISI 4: Saklar tunggal ON/OFF) ── */
const heaterToggle = document.getElementById('heater-toggle');
if (heaterToggle) {
  heaterToggle.addEventListener('change', function() {
    if (this.checked) {
      state.heaterOn = true;
      pushLogToSupabase('Pemanas diaktifkan');
      showToast('⚡ Pemanas ON');
    } else {
      state.heaterOn = false;
      pushLogToSupabase('Pemanas dimatikan');
      showToast('Pemanas OFF');
    }
    document.getElementById('mini-heat').textContent = state.heaterOn ? 'ON' : 'OFF';
    
    updateDeviceControl();

    if (state.timerEndAt && !state.heaterOn) {
      finishTherapyTimer('manual');
    } else {
      updateTimerButtonState();
    }
  });
}

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

    // REVISI: Hanya memperbarui status tombol Mulai tanpa mematikan timer di tengah jalan
    updateTimerButtonState();
  });
});

/* ── TIMER SESI TERAPI 15 MENIT ── */
const btnTimer     = document.getElementById('btn-timer');
const timerDisplay = document.getElementById('timer-display');
const timerHint    = document.getElementById('timer-hint');
const btnTimerIcon  = document.getElementById('btn-timer-icon');
const btnTimerLabel = document.getElementById('btn-timer-label');

function formatMMSS(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function updateTimerButtonState() {
  if (state.timerEndAt) return;
  // REVISI 4: Pengecekan siap timer disesuaikan dengan status boolean heaterOn
  const ready = state.heaterOn && state.vibration !== null;
  btnTimer.disabled = !ready;
  timerHint.textContent = ready
    ? 'Siap memulai sesi terapi 15 menit'
    : 'Pilih pemanas & getaran dahulu';
}

function tickTimer() {
  const remaining = Math.round((state.timerEndAt - Date.now()) / 1000);
  if (remaining <= 0) {
    finishTherapyTimer('auto');
    return;
  }
  timerDisplay.textContent = formatMMSS(remaining);
}

function startTherapyTimer() {
  if (state.timerEndAt) return;
  if (!state.heaterOn || state.vibration === null) {
    showToast('⚠ Pilih pemanas & getaran terlebih dahulu');
    return;
  }

  state.timerEndAt = Date.now() + TIMER_DURATION * 1000;

  timerDisplay.classList.add('running');
  timerHint.textContent = 'Sesi terapi sedang berjalan...';
  btnTimer.classList.add('running');
  btnTimer.disabled = false;
  btnTimerIcon.textContent  = '■';
  btnTimerLabel.textContent = 'Hentikan Sesi';

  pushLogToSupabase(`Mulai sesi terapi 15 menit (Pemanas ON, Getaran Volume ${state.vibration})`);
  showToast('✓ Sesi terapi 15 menit dimulai');

  tickTimer();
  state.timerInterval = setInterval(tickTimer, 1000);
}

function finishTherapyTimer(reason) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerEndAt = null;

  // REVISI 4: Reset status tombol dan state pemanas tunggal
  const hToggle = document.getElementById('heater-toggle');
  if (hToggle) hToggle.checked = false;
  state.heaterOn = false;

  document.querySelectorAll('.vib-sw').forEach(s => s.checked = false);
  state.vibration = null;

  updateDeviceControl();

  document.getElementById('mini-heat').textContent = 'OFF';
  document.getElementById('mini-vib').textContent  = 'OFF';

  timerDisplay.classList.remove('running');
  timerDisplay.textContent = formatMMSS(TIMER_DURATION);
  btnTimer.classList.remove('running');
  btnTimerIcon.textContent  = '▶';
  btnTimerLabel.textContent = 'Mulai 15 Menit';

  pushLogToSupabase(reason === 'auto'
    ? 'Sesi 15 menit selesai — pemanas & getaran otomatis OFF'
    : 'Sesi terapi dihentikan manual — pemanas & getaran OFF');
  showToast(reason === 'auto' ? '⏱ 15 menit selesai, perangkat OFF' : 'Sesi dihentikan, perangkat OFF');

  updateTimerButtonState();
}

btnTimer.addEventListener('click', () => {
  if (state.timerEndAt) {
    finishTherapyTimer('manual');
  } else {
    startTherapyTimer();
  }
});

/* ── RENDER LOG CARDS (REVISI 3: Dikomen fungsinya jika diperlukan) ── */
function renderLogs() {
  // Fungsi ini tetap dibiarkan ada kodenya agar tidak error saat pemanggilan sistem internal, 
  // namun halamannya sudah disembunyikan dari Navigasi.
  const list  = document.getElementById('log-list');
  const count = document.getElementById('log-count');
  if (count) count.textContent = `${state.logs.length} entri`;
  if (!list) return;

  if (state.logs.length === 0) {
    list.innerHTML = `
      <div class="log-empty">
        <div class="empty-ico">📋</div>
        <p>Belum ada log.<br/>Mulai sesi dari menu Input.</p>
      </div>`;
    return;
  }

  const total = state.logs.length;
  list.innerHTML = state.logs.slice().reverse().map((log, revIdx) => {
    const i = total - 1 - revIdx;
    return `
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
      <div class="log-aksi ${log.aksi === 'Pencatatan berkala otomatis' ? 'system-log' : ''}">
        ${log.aksi === 'Pencatatan berkala otomatis' ? '🕒 ' + log.aksi : log.aksi}
      </div>    </div>
  `;
  }).join('');

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
const btnDownload = document.getElementById('btn-download');
if (btnDownload) {
  btnDownload.addEventListener('click', () => {
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
}

/* ── PROFILE RENDER ── */
function renderProfile() {
  const p = state.profile;
  if (!p) {
    if(document.getElementById('profile-avatar')) document.getElementById('profile-avatar').textContent = '?';
    if(document.getElementById('profile-name')) document.getElementById('profile-name').textContent = 'Belum ada profil';
    if(document.getElementById('profile-badge')) document.getElementById('profile-badge').textContent = '—';
    if(document.getElementById('pstat-umur')) document.getElementById('pstat-umur').textContent = '—';
    if(document.getElementById('pstat-tgl')) document.getElementById('pstat-tgl').textContent = '—';
    
    const pstatLog = document.getElementById('pstat-log');
    if (pstatLog) pstatLog.textContent = state.logs.length;
    return;
  }
  if(document.getElementById('profile-avatar')) document.getElementById('profile-avatar').textContent = p.nama.charAt(0).toUpperCase();
  if(document.getElementById('profile-name')) document.getElementById('profile-name').textContent = p.nama;
  if(document.getElementById('profile-badge')) document.getElementById('profile-badge').textContent = p.gender;
  if(document.getElementById('pstat-umur')) document.getElementById('pstat-umur').textContent = `${p.umur} th`;
  if(document.getElementById('pstat-tgl')) document.getElementById('pstat-tgl').textContent = p.tanggal;
  
  const pstatLog = document.getElementById('pstat-log');
  if (pstatLog) pstatLog.textContent = state.logs.length;
}

/* ── RESET KONTROL SESI ── */
function resetSessionControls() {
  if (state.timerEndAt) {
    finishTherapyTimer('manual');
  }
  state.heaterOn = false; // REVISI 4: Menggunakan boolean reset
  state.vibration  = null;
  const hToggle = document.getElementById('heater-toggle');
  if (hToggle) hToggle.checked = false;
  document.querySelectorAll('.vib-sw').forEach(s => s.checked = false);
  document.getElementById('mini-heat').textContent = 'OFF';
  document.getElementById('mini-vib').textContent  = 'OFF';
  updateTimerButtonState();
  updateDeviceControl();
}

/* ── RESET PROFIL ── */
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
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerEndAt    = null;

  state.profile    = null;
  state.logs       = [];
  state.sensorTemp = null;
  state.heaterOn = false; // REVISI 4: Menggunakan boolean reset
  state.vibration  = null;

  document.getElementById('inp-nama').value    = '';
  document.getElementById('inp-umur').value    = '';
  const inpTgl = document.getElementById('inp-tanggal');
  if (inpTgl) inpTgl.value = todayStr();
  document.getElementById('hero-greeting').textContent = 'Halo, Siapa kamu?';
  document.getElementById('hero-avatar').textContent   = '👤';

  genderGroup.querySelectorAll('.gender-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  selectedGender = 'Pria';

  const hToggle = document.getElementById('heater-toggle');
  if (hToggle) hToggle.checked = false;
  document.querySelectorAll('.vib-sw').forEach(s => s.checked = false);
  document.getElementById('mini-heat').textContent = 'OFF';
  document.getElementById('mini-vib').textContent  = 'OFF';

  timerDisplay.classList.remove('running');
  timerDisplay.textContent = formatMMSS(TIMER_DURATION);
  btnTimer.classList.remove('running');
  btnTimerIcon.textContent  = '▶';
  btnTimerLabel.textContent = 'Mulai 15 Menit';
  updateTimerButtonState();

  drawGauge(null);
  updateDeviceControl();
}

/* ── INIT ON LOAD ── */
drawGauge(null);
updateTimerButtonState();
initSupabaseRealtime();

/* ── AUTOMATIC PERIODIC LOGGING ── */
const LOG_INTERVAL_MS = 5 * 60 * 1000; 

setInterval(() => {
  if (state.profile) {
    pushLogToSupabase('Pencatatan berkala otomatis');
    
    const pageRiwayat = document.getElementById('page-riwayat');
    if (pageRiwayat && pageRiwayat.classList.contains('active')) {
      renderLogs();
    }
  }
}, LOG_INTERVAL_MS);