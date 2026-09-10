const API_URL = "https://script.google.com/macros/s/AKfycbwJzg0F7vrob4_8OZQtnQ47gCoLHC39By9gjEijvELioRuMG9kUVvyCLDi3MJbIBCeAmw/exec"; 
let html5QrcodeScanner;

// ================= ROUTING & INIT =================
document.addEventListener("DOMContentLoaded", () => {
  checkLoginStatus();
  initPWAInstall();
  
  // Toggle password visibility
  document.getElementById('toggle-pwd').addEventListener('click', function() {
    const pwd = document.getElementById('password');
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
  });
});

function navigate(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  
  if(viewId === 'so-view' && html5QrcodeScanner) {
    // Reset scanner state if navigating back
  }
}

// ================= AUTHENTICATION =================
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.innerText = 'Memproses...';
  btn.disabled = true;

  const user = document.getElementById('username').value;
  const pass = document.getElementById('password').value;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username: user, password: pass })
    });
    const res = await response.json();
    
    if(res.status === 'success') {
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.setItem('loginTime', Date.now());
      checkLoginStatus();
    } else {
      alert(res.message);
    }
  } catch (error) {
    alert('Jaringan tidak stabil. Coba lagi.');
  } finally {
    btn.innerText = 'Masuk';
    btn.disabled = false;
  }
});

function checkLoginStatus() {
  const userStr = localStorage.getItem('user');
  const loginTime = localStorage.getItem('loginTime');
  
  // Auto logout 12 jam (43200000 ms)
  if(userStr && loginTime && (Date.now() - parseInt(loginTime) < 43200000)) {
    const user = JSON.parse(userStr);
    document.getElementById('user-display').innerText = user.nama;
    navigate('dashboard-view');
    updateSyncBadge();
  } else {
    logout();
  }
}

function logout() {
  localStorage.removeItem('user');
  localStorage.removeItem('loginTime');
  navigate('login-view');
}

// ================= SCANNER & SO LOGIC =================
document.getElementById('btn-start-scan').addEventListener('click', () => {
  html5QrcodeScanner = new Html5Qrcode("reader");
  const config = { fps: 10, qrbox: { width: 250, height: 100 }, aspectRatio: 1.0 };
  
  html5QrcodeScanner.start({ facingMode: "environment" }, config, (decodedText) => {
    document.getElementById('so-barcode').value = decodedText;
    html5QrcodeScanner.stop();
    lookupBarcode(decodedText);
  }).catch(err => alert("Gagal mengakses kamera."));
});

document.getElementById('so-barcode').addEventListener('blur', (e) => {
  if(e.target.value) lookupBarcode(e.target.value);
});

function lookupBarcode(code) {
  const infoDiv = document.getElementById('product-info');
  // Dummy data master - di production ambil dari cache localStorage yang di pull saat login
  infoDiv.classList.remove('hidden');
  infoDiv.innerHTML = `
    <strong>Kode:</strong> ${code} <br>
    <span class="text-gray-600">Catatan: Pastikan barcode sesuai fisik. Data master akan disinkronkan.</span>
  `;
}

// Save SO (Offline First)
document.getElementById('so-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const lokasi = document.getElementById('so-lokasi').value;
  const barcode = document.getElementById('so-barcode').value;
  const qty = document.getElementById('so-qty').value;
  const ket = document.getElementById('so-ket').value;
  const user = JSON.parse(localStorage.getItem('user'));

  let pendingSO = JSON.parse(localStorage.getItem('pendingSO') || '[]');
  
  // Cek duplikat di lokasi yang sama
  const existIndex = pendingSO.findIndex(item => item.lokasi === lokasi && item.kode_upc === barcode);
  if(existIndex > -1) {
    const action = confirm(`Barcode ini sudah diinput di lokasi ${lokasi}.\nOK = Tambahkan Qty\nCancel = Batal`);
    if(action) {
      pendingSO[existIndex].qty_so = parseInt(pendingSO[existIndex].qty_so) + parseInt(qty);
    } else {
      return;
    }
  } else {
    pendingSO.push({
      timestamp: new Date().toISOString(),
      lokasi: lokasi,
      username: user.username,
      kode_upc: barcode,
      qty_system: 0, // Diisi dari lookup jika ada
      qty_so: qty,
      keterangan: ket
    });
  }

  localStorage.setItem('pendingSO', JSON.stringify(pendingSO));
  
  // Reset Form kecuali lokasi
  document.getElementById('so-barcode').value = '';
  document.getElementById('so-qty').value = '';
  document.getElementById('so-ket').value = '';
  document.getElementById('product-info').classList.add('hidden');
  
  alert('Disimpan (Lokal). Lanjut scan berikutnya.');
  updateSyncBadge();
  autoSync();
});

// ================= SYNC LOGIC =================
function updateSyncBadge() {
  const pending = JSON.parse(localStorage.getItem('pendingSO') || '[]');
  const badge = document.getElementById('sync-badge');
  if(pending.length > 0) {
    badge.classList.remove('hidden');
    badge.innerText = `${pending.length} Data Pending`;
  } else {
    badge.classList.add('hidden');
  }
}

document.getElementById('btn-sync').addEventListener('click', autoSync);

async function autoSync() {
  const pending = JSON.parse(localStorage.getItem('pendingSO') || '[]');
  if(pending.length === 0 || !navigator.onLine) return;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'syncSO', payload: pending })
    });
    const res = await response.json();
    if(res.status === 'success') {
      localStorage.setItem('pendingSO', '[]');
      updateSyncBadge();
      alert('Sinkronisasi berhasil!');
    }
  } catch(e) {
    console.log("Sync tertunda, jaringan bermasalah.");
  }
}

// ================= PWA INSTALL =================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-btn').classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('install-btn').classList.add('hidden');
    }
    deferredPrompt = null;
  }
});
