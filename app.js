/* ===== Aplikasi Wali Santri - Roudhotul Qur'an ===== */
/* Read-only, ambil data LANGSUNG dari tabel Supabase (database bersama dengan
   Aplikasi Pondok/Keuangan/Toko) lewat query per tabel, dibatasi RLS (row level
   security) di server: wali cuma bisa SELECT baris yang santri_id-nya sama
   dengan santri_id di profil_akun miliknya. Tidak pakai IndexedDB/antrean
   offline karena app ini tidak pernah menulis data. */

/* PERUBAHAN (28 Agu 2026) -- login diganti total ke Supabase Auth:
   - Sebelumnya: kirim No.Induk + Kode Wali sebagai parameter ke 1 RPC
     `data_wali_santri` (SECURITY DEFINER yang mencocokkan sendiri lalu
     mengembalikan semua data dalam 1 JSON).
   - Sekarang: No.Induk + Kode Wali dipakai untuk sb.auth.signInWithPassword()
     (email = {no_induk}@pprqsentol.com, password = kode wali -- akun Auth-nya
     sendiri sudah otomatis dibuat/disamakan oleh Edge Function reset-kode-wali
     di Aplikasi Pondok setiap kali kode wali dibuat/direset). Setelah Auth
     berhasil, data ditarik langsung per tabel (santri, mahram, kegiatan,
     absensi, hafalan, transaksi_saldo, transaksi_toko, tagihan, jenis_tagihan,
     iuran_detail) -- RPC data_wali_santri SUDAH TIDAK DIPAKAI lagi.
   - Form login & cara pemakaian wali TIDAK berubah (tetap isi No. Induk +
     Kode Wali yang sama).
   - Proteksi brute-force (dulu: kunci 10x percobaan gagal/15 menit per No.
     Induk lewat tabel percobaan_login) SEKARANG diserahkan ke Supabase Auth
     bawaan (tidak dibuatkan mekanisme sendiri lagi).
   - Kalau ada santri lama yang kode walinya dibuat SEBELUM Edge Function
     reset-kode-wali ada / sebelum di-update untuk membuat akun Auth, wali-nya
     perlu direset dulu kode walinya dari Aplikasi Pondok (tombol "Cabut &
     buat kode baru") supaya akun Auth-nya ikut terbuat.
   - sesi Auth SENGAJA tidak disimpan ke localStorage (persistSession: false),
     supaya perilakunya tetap sama seperti sebelumnya: sesi cuma bertahan
     selama tab/aplikasi terbuka (ME di sessionStorage), bukan tersimpan
     permanen di HP -- penting kalau HP-nya dipakai bergantian antar wali. */
const SUPABASE_URL = 'https://hvivddbhacoppkbtiqpe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BTFxSTrt1vM1seoQaXG_7g_mqYo5aqq';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/* ====== PASANG APLIKASI (PWA) ======
   Chrome/Edge di Android baru menawarkan pasang otomatis setelah kriteria
   & "skor keterlibatan" browser terpenuhi (kadang butuh beberapa kali
   kunjungan), jadi tombol "Pasang Aplikasi" ini dipasang manual supaya
   pengguna bisa memasang kapan saja tanpa menunggu itu. iOS Safari malah
   sama sekali tidak punya prompt otomatis -- di sana harus lewat menu
   Bagikan, jadi tombolnya diarahkan ke instruksi manual. */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  document.querySelectorAll('#btnInstallApp, #btnInstallAppTop').forEach(b=> b.style.display = '');
});
window.addEventListener('appinstalled', ()=>{
  deferredInstallPrompt = null;
  document.querySelectorAll('#btnInstallApp, #btnInstallAppTop').forEach(b=> b.style.display = 'none');
});
function isRunningAsInstalledPwa(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIos(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
async function installApp(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.querySelectorAll('#btnInstallApp, #btnInstallAppTop').forEach(b=> b.style.display = 'none');
    return;
  }
  if(isIos()){
    alert('Cara pasang di iPhone/iPad:\n1. Ketuk ikon Bagikan (kotak dengan panah ke atas) di Safari.\n2. Pilih "Tambah ke Layar Utama".\n\nCatatan: harus dibuka lewat Safari, bukan Chrome, supaya opsi ini muncul.');
    return;
  }
  alert('Kalau tombol "Pasang" tidak muncul sendiri: buka menu titik tiga di pojok browser lalu pilih "Instal aplikasi" / "Tambahkan ke layar utama". Pastikan juga aplikasi dibuka lewat alamat HTTPS.');
}
if(isRunningAsInstalledPwa()){
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('#btnInstallApp, #btnInstallAppTop').forEach(b=> b.style.display = 'none');
  });
} else if(isIos()){
  /* iOS tidak pernah memicu beforeinstallprompt, jadi tombolnya
     ditampilkan dari awal supaya pengguna iPhone tetap dapat instruksi. */
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('#btnInstallApp, #btnInstallAppTop').forEach(b=> b.style.display = '');
  });
}

/* Mengubah karakter khusus HTML (<, >, &, ", ') jadi bentuk aman sebelum
   ditampilkan, supaya teks bebas-ketik dari pengguna lain (mis. keterangan
   transaksi keuangan yang diisi bendahara) tidak bisa dieksekusi sebagai
   kode HTML/JS saat dirender lewat innerHTML di app ini. */
function escapeHtml(str){
  if(str===null || str===undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Ubah snake_case (dari Postgres/Supabase) jadi camelCase (dipakai di seluruh app.js ini).
function keCamel(s){ return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }
function dalamCamel(obj){
  if(Array.isArray(obj)) return obj.map(dalamCamel);
  if(obj && typeof obj === 'object'){
    const out = {};
    for(const k in obj) out[keCamel(k)] = dalamCamel(obj[k]);
    return out;
  }
  return obj;
}

const CACHE_KEY = 'wali_cache_v1'; // cadangan tampilan terakhir saja (bukan sumber data utama), supaya tetap bisa dilihat sebentar walau lagi tidak ada internet
function simpanCache(db){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(db)); }catch(e){} }
function ambilCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }catch(e){ return null; } }

let DB = { santri: [], mahram: [], kegiatan: [], absensi: [], hafalan: [], murojaah: [], transaksiSaldo: [], transaksiToko: [], tagihan: [], jenisTagihan: [], iuranDetail: [] };
let ME = JSON.parse(sessionStorage.getItem('wali_session') || 'null'); // {noInduk, kodeWali} -- hanya untuk sesi berjalan, tidak dicadangkan ke localStorage

const NAV = [
  {id:'beranda', label:'Beranda', icon:'&#8962;'},
  {id:'info', label:'Info', icon:'&#128100;'},
  {id:'saldo', label:'Saldo', icon:'&#128176;'},
  {id:'riwayat', label:'Riwayat', icon:'&#128203;'},
  {id:'absensi', label:'Absensi', icon:'&#10003;'},
  {id:'hafalan', label:'Hafalan', icon:'&#128214;'},
  {id:'tagihan', label:'Tagihan', icon:'&#128179;'}
];
let currentPage='beranda';

function val(id){ return document.getElementById(id).value; }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function rupiah(n){ return 'Rp ' + (n||0).toLocaleString('id-ID'); }
function totalHalaman(h){ return (h.juz-1)*20 + h.halaman; }

/* ---------- NOTIF GETAR + BUNYI (scan berhasil & login berhasil) ----------
   Getar lewat Vibration API (didukung sebagian besar HP Android; di iPhone/Safari
   API ini memang tidak didukung sama sekali, jadi di iPhone cuma bunyi yang berbunyi).
   Bunyi dibuat langsung lewat Web Audio API (nada pendek), tidak perlu file suara
   terpisah. AudioContext baru boleh dibuat/dijalankan setelah ada interaksi
   pengguna (klik tombol dsb), makanya dibuat sekali saja & disimpan di variabel. */
let audioCtxNotif = null;
function getarBerhasil(){
  try{ if(navigator.vibrate) navigator.vibrate(150); }catch(e){}
}
function bunyiBerhasil(){
  try{
    audioCtxNotif = audioCtxNotif || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxNotif;
    if(ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }catch(e){}
}
function notifBerhasil(){ getarBerhasil(); bunyiBerhasil(); }

/* ---------- LOGIN (Supabase Auth: email = No.Induk@pprqsentol.com, password = Kode Wali) ---------- */
const EMAIL_DOMAIN_WALI = 'pprqsentol.com';
// Sama persis dengan cara Edge Function reset-kode-wali membentuk email-nya
// (no_induk di-trim, di-lowercase, spasi dibuang) -- supaya selalu cocok.
function emailWaliDari(noInduk){
  return (noInduk||'').trim().toLowerCase().replace(/\s+/g,'') + '@' + EMAIL_DOMAIN_WALI;
}
async function initLogin(){
  if(ME){ await muatDataWali(ME.noInduk, ME.kodeWali, true); }
}
async function doLogin(){
  const noInduk = val('loginNoInduk').trim();
  const kodeWali = val('loginKodeWali').trim();
  const msg = document.getElementById('loginMsg');
  if(!noInduk || !kodeWali){ msg.textContent = 'No. Induk dan Kode Wali wajib diisi.'; return; }
  msg.textContent = 'Memuat data...';
  const ok = await muatDataWali(noInduk, kodeWali, false);
  if(ok){
    ME = { noInduk, kodeWali };
    sessionStorage.setItem('wali_session', JSON.stringify(ME));
    msg.textContent = '';
    notifBerhasil(); // getar + bunyi saat login berhasil
  } else {
    msg.textContent = 'No. Induk / Kode Wali salah, atau sedang tidak ada internet.';
  }
}
/* Login ke Supabase Auth, lalu ambil data langsung per tabel (dibatasi RLS di server
   supaya cuma data santri milik wali yang login yang boleh terbaca). Kalau offline dan
   sebelumnya pernah berhasil login (ME ada), pakai cadangan terakhir supaya tetap bisa
   dilihat -- tapi TIDAK bisa dipakai untuk login pertama kali (harus online dulu sekali). */
async function muatDataWali(noInduk, kodeWali, izinkanCache){
  try{
    const { error: authError } = await sb.auth.signInWithPassword({
      email: emailWaliDari(noInduk), password: kodeWali
    });
    if(authError){
      if(izinkanCache){ const c = ambilCache(); if(c){ DB = c; enterApp(); return true; } }
      return false;
    }

    const { data: s, error: errSantri } = await sb.from('santri').select('*').single();
    if(errSantri || !s){
      if(izinkanCache){ const c = ambilCache(); if(c){ DB = c; enterApp(); return true; } }
      return false;
    }

    const [
      { data: mahramRows }, { data: kegiatanRows }, { data: absensiRows },
      { data: hafalanRows }, murojaahRes, { data: saldoRows }, { data: tokoRows },
      { data: tagihanRows }, { data: jenisTagihanRows }, { data: iuranDetailRows }
    ] = await Promise.all([
      sb.from('mahram').select('*').eq('santri_id', s.id),
      sb.from('kegiatan').select('*').eq('aktif', true),
      sb.from('absensi').select('*').eq('santri_id', s.id),
      sb.from('hafalan').select('*').eq('santri_id', s.id).order('tanggal'),
      sb.from('murojaah').select('*').eq('santri_id', s.id).order('tanggal'),
      sb.from('transaksi_saldo').select('*').eq('santri_id', s.id),
      sb.from('transaksi_toko').select('*').eq('santri_id', s.id),
      sb.from('tagihan').select('*').eq('santri_id', s.id),
      sb.from('jenis_tagihan').select('*'),
      sb.from('iuran_detail').select('id, santri_id, jumlah, status, tgl_bayar, iuran(tanggal, keterangan)').eq('santri_id', s.id)
    ]);

    // Bentuk ulang jadi persis nama field yang dipakai di seluruh app.js ini
    // (sebelumnya dibentuk oleh RPC data_wali_santri di sisi server; sekarang dibentuk di sini).
    const mahram = (mahramRows||[]).map(m=>({ id:m.id, nama:m.nama, hubungan:m.hubungan||'', hp:m.no_hp||'', foto:m.foto_url||'' }));
    DB = {
      santri: [{
        id: s.id, nama: s.nama, noInduk: s.no_induk, foto: s.foto_url||'',
        tetala: s.tetala||'', alamat: s.alamat||'', tglMasuk: s.tanggal_masuk,
        jenisKelamin: s.jenis_kelamin||'L', namaAyah: s.nama_ayah||'', namaIbu: s.nama_ibu||'',
        namaWali: s.nama_wali||'', fotoWali: s.foto_wali||'', kodeWali: s.kode_wali,
        kelas: s.kelas||'', kamar: s.kamar||'', hpWali: s.no_hp_wali||'',
        program: s.program||'Non-Takhossus', hafalanAwal: s.hafalan_awal||0,
        mahram
      }],
      mahram,
      kegiatan: (kegiatanRows||[]).map(k=>({ id:k.id, nama:k.nama, programKhusus:k.program_khusus })),
      // status mentah di tabel absensi berupa teks ('Hadir'/'Izin'/dst), disamakan ke kode
      // singkat h/i/a persis seperti yang dulu dilakukan RPC data_wali_santri.
      absensi: (absensiRows||[]).map(a=>({
        id:a.id, santriId:a.santri_id, kegiatanId:a.kegiatan_id, tanggal:a.tanggal,
        status: a.status==='Hadir' ? 'h' : (a.status==='Izin' ? 'i' : 'a')
      })),
      hafalan: (hafalanRows||[]).map(h=>({ id:h.id, santriId:h.santri_id, tanggal:h.tanggal, juz:h.juz, halaman:h.halaman_sampai, kegiatanId:h.kegiatan_id||null })),
      murojaah: (murojaahRes && !murojaahRes.error) ? (murojaahRes.data||[]).map(m=>({ id:m.id, santriId:m.santri_id, kegiatanId:m.kegiatan_id, tanggal:m.tanggal, juz:m.juz, cakupan:m.cakupan })) : [],
      transaksiSaldo: (saldoRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, jenis:t.jenis, jumlah:t.jumlah, keterangan:t.keterangan, tanggal:t.tanggal })),
      transaksiToko: (tokoRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, items:t.items, total:t.total, metode:t.metode, statusBayar:t.status_bayar, createdAt:t.created_at })),
      tagihan: (tagihanRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, jenisTagihanId:t.jenis_tagihan_id, bulan:t.bulan, jumlah:t.jumlah, status:t.status, tglBayar:t.tgl_bayar })),
      jenisTagihan: (jenisTagihanRows||[]).map(j=>({ id:j.id, nama:j.nama })),
      iuranDetail: (iuranDetailRows||[]).map(d=>({
        id:d.id, santriId:d.santri_id, jumlah:d.jumlah, status:d.status, tglBayar:d.tgl_bayar,
        tanggal: d.iuran ? d.iuran.tanggal : null, keterangan: d.iuran ? d.iuran.keterangan : null
      }))
    };
    // saldo santri = total transaksi_saldo, dihitung persis sama seperti Aplikasi Keuangan
    // (jenis 'setoran' menambah, 'tarik'/'bayar' mengurangi).
    DB.santri[0].saldo = DB.transaksiSaldo.reduce((sum,t)=> sum + (t.jenis==='setoran' ? t.jumlah : -t.jumlah), 0);
    simpanCache(DB);
    enterApp();
    return true;
  }catch(e){
    if(izinkanCache){ const c = ambilCache(); if(c){ DB = c; enterApp(); return true; } }
    return false;
  }
}
/* ---------- TOGGLE LIHAT ISIAN (No. Induk / Kode Wali) ---------- */
function toggleLihat(inputId, btnId){
  const el = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const sedangTersembunyi = el.type === 'password';
  el.type = sedangTersembunyi ? 'text' : 'password';
  btn.textContent = sedangTersembunyi ? 'Sembunyi' : 'Lihat';
}

/* ---------- SCAN KARTU WALI (kamera hp, autofocus + senter/torch) ---------- */
let html5QrCode = null;
let torchNyala = false;

async function bukaScanner(){
  document.getElementById('scannerModal').style.display = 'flex';
  document.getElementById('scanMsg').textContent = 'Membuka kamera...';
  document.getElementById('torchBtn').style.display = 'none';
  document.getElementById('torchBtn').classList.remove('on');
  torchNyala = false;
  try{
    html5QrCode = new Html5Qrcode('qrReader');
    const config = {
      fps: 10,
      qrbox: { width: 240, height: 240 },
      // minta kamera belakang + autofokus berkelanjutan (didukung sebagian besar hp Android/iOS terbaru,
      // kalau tidak didukung browser akan mengabaikannya begitu saja tanpa error)
      videoConstraints: {
        facingMode: { ideal: 'environment' },
        advanced: [{ focusMode: 'continuous' }]
      }
    };
    await html5QrCode.start(
      { facingMode: 'environment' },
      config,
      onScanBerhasil,
      () => {} // gagal baca di 1 frame itu wajar (belum ketemu QR), abaikan saja
    );
    document.getElementById('scanMsg').textContent = 'Arahkan kamera ke kode QR pada kartu wali.';
    setTimeout(cekDukunganTorch, 600);
    setTimeout(pastikanAutofokus, 600);
  }catch(e){
    document.getElementById('scanMsg').textContent = 'Tidak bisa mengakses kamera. Pastikan izin kamera untuk situs ini diaktifkan.';
  }
}
// Sebagian browser/HP mengabaikan constraint fokus yang dikirim lewat html5QrCode.start()
// di atas, tapi menurutinya kalau dikirim ULANG lewat applyVideoConstraints() setelah
// kamera benar-benar menyala. Dicoba beberapa mode berurutan (continuous lebih disukai
// untuk scan QR jarak dekat/berubah-ubah; kalau tidak didukung, browser akan menolaknya
// dengan error dan diabaikan saja di sini, tanpa mengganggu tampilan).
async function pastikanAutofokus(){
  if(!html5QrCode) return;
  try{
    const cap = html5QrCode.getRunningTrackCameraCapabilities();
    const fokus = cap && cap.focusModeFeature && cap.focusModeFeature();
    if(fokus && fokus.isSupported && fokus.isSupported()){
      const tersedia = (fokus.value && fokus.value()) || [];
      const pilihan = ['continuous','single-shot','auto'].find(m=>!tersedia.length || tersedia.includes(m));
      if(pilihan) await fokus.apply(pilihan);
      return;
    }
  }catch(e){}
  // fallback kalau API capabilities di atas tidak tersedia -- coba kirim langsung
  try{ await html5QrCode.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }); }catch(e){}
}
function cekDukunganTorch(){
  try{
    const cap = html5QrCode.getRunningTrackCameraCapabilities();
    const torch = cap && cap.torchFeature && cap.torchFeature();
    if(torch && torch.isSupported && torch.isSupported()){
      document.getElementById('torchBtn').style.display = 'inline-block';
    }
  }catch(e){}
}
async function toggleTorch(){
  try{
    const cap = html5QrCode.getRunningTrackCameraCapabilities();
    const torch = cap.torchFeature();
    torchNyala = !torchNyala;
    await torch.apply(torchNyala);
    document.getElementById('torchBtn').classList.toggle('on', torchNyala);
  }catch(e){}
}
function onScanBerhasil(teks){
  const parsed = uraiKodeKartuWali(teks);
  tutupScanner();
  if(parsed && (parsed.kodeWali || parsed.noInduk)){
    notifBerhasil(); // getar + bunyi begitu QR-nya berhasil terbaca
  }
  if(parsed && parsed.kodeWali){
    // QR berisi No. Induk + Kode Wali lengkap -> langsung login
    document.getElementById('loginNoInduk').value = parsed.noInduk;
    document.getElementById('loginKodeWali').value = parsed.kodeWali;
    doLogin();
  } else if(parsed && parsed.noInduk){
    // QR hanya berisi No. Induk -> isikan No. Induk, minta wali ketik Kode Wali sendiri
    document.getElementById('loginNoInduk').value = parsed.noInduk;
    document.getElementById('loginKodeWali').value = '';
    document.getElementById('loginMsg').textContent = 'No. Induk terisi dari QR. Silakan ketik Kode Wali, lalu tekan "Lihat data".';
    document.getElementById('loginKodeWali').focus();
  } else {
    document.getElementById('loginMsg').textContent = 'Kode QR pada kartu tidak dikenali formatnya.';
  }
}
// Kartu wali bisa berisi salah satu dari:
// 1) JSON {"noInduk":"...","kodeWali":"..."} (boleh kodeWali kosong/tidak ada)
// 2) teks No.Induk + Kode Wali dipisah salah satu dari | : ; ,
// 3) teks polos berisi No. Induk saja (tanpa Kode Wali), misalnya cuma "1001"
function uraiKodeKartuWali(teks){
  teks = (teks || '').trim();
  if(!teks) return null;
  try{
    const o = JSON.parse(teks);
    const ni = o && (o.noInduk || o.no_induk);
    const kw = o && (o.kodeWali || o.kode_wali);
    if(ni) return { noInduk: String(ni), kodeWali: kw ? String(kw) : null };
  }catch(e){}
  for(const pemisah of ['|', ':', ';', ',']){
    if(teks.includes(pemisah)){
      const [a, b] = teks.split(pemisah);
      if(a && b) return { noInduk: a.trim(), kodeWali: b.trim() };
      if(a) return { noInduk: a.trim(), kodeWali: null };
    }
  }
  // Tidak ada format JSON/pemisah yang cocok -> anggap seluruh isi QR adalah No. Induk polos
  return { noInduk: teks, kodeWali: null };
}
async function tutupScanner(){
  document.getElementById('scannerModal').style.display = 'none';
  if(html5QrCode){
    try{ await html5QrCode.stop(); html5QrCode.clear(); }catch(e){}
    html5QrCode = null;
  }
}

async function logout(){
  await sb.auth.signOut();
  sessionStorage.removeItem('wali_session');
  ME = null;
  document.getElementById('app').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}
/* Ukur tinggi topbar sebenarnya lalu simpan ke CSS variable --topbar-h,
   supaya .layout tetap menghitung tinggi sisa layar dengan akurat di
   ukuran topbar berapa pun (topbar dibikin lebih ringkas saat landscape). */
function syncTopbarHeight(){
  const tb = document.querySelector('.topbar');
  if(tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
}
window.addEventListener('resize', syncTopbarHeight);
window.addEventListener('orientationchange', ()=> setTimeout(syncTopbarHeight, 300));

function mySantri(){ return DB.santri[0]; }
function enterApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('anakLabel').textContent = mySantri()?.nama || 'Wali Santri';
  renderNav();
  goPage('beranda');
  syncTopbarHeight();
}

/* ---------- NAV ---------- */
// Ikon keluar dipakai sbg SVG (bukan karakter panah U+21B7 spt sebelumnya)
// supaya tampil tajam & konsisten di semua HP, dan warnanya ikut currentColor
// (ikut warna teks tombol) lewat stroke="currentColor".
const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`;

function renderNav(){
  const html = NAV.map(i=>`<button class="navitem" data-p="${i.id}" onclick="goPage('${i.id}')"><span class="ic">${i.icon}</span><span>${i.label}</span></button>`).join('')
    + `<button class="navitem navitem-logout" onclick="konfirmasiLogout()"><span class="ic">${LOGOUT_ICON}</span><span>Keluar</span></button>`;
  document.getElementById('bottomnav').innerHTML = html;
  document.getElementById('sidebar').innerHTML = html;
}
// Tab "Keluar" sekarang duduk di antara tab-tab lain, jadi dikasih konfirmasi
// dulu supaya tidak ke-logout tanpa sengaja waktu jari meleset pas navigasi.
function konfirmasiLogout(){
  if(confirm('Keluar dari aplikasi ini?')) logout();
}
function goPage(p){
  currentPage=p;
  document.querySelectorAll('.navitem').forEach(el=>el.classList.toggle('active', el.dataset.p===p));
  if(p==='beranda') renderBeranda();
  if(p==='info') renderInfo();
  if(p==='saldo') renderSaldo();
  if(p==='riwayat') renderRiwayat();
  if(p==='absensi') renderAbsensi();
  if(p==='hafalan') renderHafalan();
  if(p==='tagihan') renderTagihan();
}
function bulanIni(){ return new Date().toISOString().slice(0,7); }

/* ---------- FILTER PERIODE (Hari ini / Pekan / Bulan / Tahun) ---------- */
const LABEL_PERIODE = { hari:'Hari ini', pekan:'Pekan ini', bulan:'Bulan ini', tahun:'Tahun ini' };
function rentangPeriode(mode){
  const now = new Date();
  const hariIni = todayStr();
  let dari;
  if(mode==='hari'){
    dari = new Date(now);
  } else if(mode==='pekan'){
    dari = new Date(now);
    const dow = (dari.getDay()+6)%7; // Senin=0 ... Minggu=6
    dari.setDate(dari.getDate()-dow);
  } else if(mode==='tahun'){
    dari = new Date(now.getFullYear(), 0, 1);
  } else { // 'bulan' (default)
    dari = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { dari: dari.toISOString().slice(0,10), sampai: hariIni };
}
function tabsPeriode(mode, fnSet){
  return `<div class="tabs">${Object.keys(LABEL_PERIODE).map(m=>
    `<button class="tab ${mode===m?'active':''}" onclick="${fnSet}('${m}')">${LABEL_PERIODE[m]}</button>`
  ).join('')}</div>`;
}

/* ---------- BERANDA ---------- */
function renderBeranda(){
  const s = mySantri();
  const lastHafalan = DB.hafalan.filter(h=>h.santriId===s.id).sort((a,b)=>b.tanggal.localeCompare(a.tanggal))[0];
  document.getElementById('content').innerHTML = `
    <div class="card" style="text-align:center">
      ${s.foto?`<img src="${s.foto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover">`:`<div class="avatar" style="width:80px;height:80px;font-size:24px;margin:0 auto">${escapeHtml((s.nama||'?').slice(0,2).toUpperCase())}</div>`}
      <h2 style="margin-top:10px">${escapeHtml(s.nama)}</h2>
      <p class="muted">No. induk ${escapeHtml(s.noInduk)} &middot; ${escapeHtml(s.kelas)||'-'}</p>
      <span class="tag ${s.program==='Takhossus'?'tag-takhossus':'tag-nontakhossus'}">${escapeHtml(s.program)||'-'}</span>
    </div>
    <div class="grid2">
      <div class="stat"><div class="num">${rupiah(s.saldo)}</div><div class="label">Saldo saat ini</div></div>
      <div class="stat"><div class="num">${lastHafalan?`J${lastHafalan.juz} H${lastHafalan.halaman}`:'-'}</div><div class="label">Hafalan terakhir</div></div>
    </div>
    <p class="muted" style="margin-top:10px">Data ini hasil sinkron terakhir. Untuk data terbaru, minta admin melakukan sinkron ulang.</p>
  `;
}

/* ---------- INFO ---------- */
function renderInfo(){
  const s = mySantri();
  document.getElementById('content').innerHTML = `
    <h2>Informasi Santri</h2>
    <div class="card">
      <table>
        <tr><th>Nama</th><td>${escapeHtml(s.nama)}</td></tr>
        <tr><th>No. Induk</th><td>${escapeHtml(s.noInduk)}</td></tr>
        <tr><th>Tetala</th><td>${escapeHtml(s.tetala)||'-'}</td></tr>
        <tr><th>Alamat</th><td>${escapeHtml(s.alamat)||'-'}</td></tr>
        <tr><th>Tanggal masuk</th><td>${s.tglMasuk||'-'}</td></tr>
        <tr><th>Kelas</th><td>${escapeHtml(s.kelas)||'-'}</td></tr>
        <tr><th>Kamar</th><td>${escapeHtml(s.kamar)||'-'}</td></tr>
        <tr><th>Program</th><td>${escapeHtml(s.program)||'-'}</td></tr>
      </table>
    </div>
    <div class="card">
      <div class="card-title">Mahram</div>
      ${(s.mahram||[]).length===0?'<p class="muted">Belum ada data.</p>':s.mahram.map(m=>`
        <div class="list-item">
          ${m.foto?`<img class="avatar" src="${m.foto}">`:`<div class="avatar">${escapeHtml((m.nama||'?').slice(0,2).toUpperCase())}</div>`}
          <div><div class="name">${escapeHtml(m.nama)}</div><div class="sub">${escapeHtml(m.hubungan)} &middot; ${escapeHtml(m.hp)}</div></div>
        </div>`).join('')}
    </div>
  `;
}

/* ---------- SALDO ---------- */
function renderSaldo(){
  const s = mySantri();
  document.getElementById('content').innerHTML = `
    <h2>Saldo</h2>
    <div class="card stat" style="text-align:center">
      <div class="num" style="font-size:28px">${rupiah(s.saldo)}</div>
      <div class="label">Saldo saat ini</div>
    </div>
  `;
}

/* ---------- RIWAYAT ---------- */
let riwFrom='', riwTo=todayStr();
function renderRiwayat(){
  if(!riwFrom){ const d=new Date(); d.setDate(d.getDate()-30); riwFrom=d.toISOString().slice(0,10); }
  const s = mySantri();
  const labelJenis = {setoran:'Setoran', tarik:'Tarik Tunai', bayar:'Bayar (saldo)'};
  const sd = DB.transaksiSaldo.filter(t=>t.santriId===s.id && t.tanggal>=riwFrom && t.tanggal<=riwTo)
    .map(t=>({tanggal:t.tanggal, jenis:labelJenis[t.jenis]||t.jenis, jumlah:t.jenis==='setoran'?t.jumlah:-t.jumlah, ket:t.keterangan}));
  const iu = DB.iuranDetail.filter(it=>it.tanggal>=riwFrom && it.tanggal<=riwTo && it.status==='lunas')
    .map(it=>({tanggal:it.tglBayar||it.tanggal, jenis:'Iuran', jumlah:-it.jumlah, ket:it.keterangan}));
  const all = [...sd, ...iu].sort((a,b)=>a.tanggal.localeCompare(b.tanggal));
  const belanja = DB.transaksiToko.filter(t=>t.santriId===s.id && (t.createdAt||'').slice(0,10)>=riwFrom && (t.createdAt||'').slice(0,10)<=riwTo)
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  document.getElementById('content').innerHTML = `
    <h2>Riwayat Transaksi</h2>
    <div class="card grid2">
      <div><label>Dari tanggal</label><input type="date" value="${riwFrom}" onchange="riwFrom=this.value; renderRiwayat()"></div>
      <div><label>Sampai tanggal</label><input type="date" value="${riwTo}" onchange="riwTo=this.value; renderRiwayat()"></div>
    </div>
    <div class="card">
      ${all.length===0?'<p class="muted">Tidak ada transaksi pada periode ini.</p>':`<table><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th>Nominal</th></tr>
      ${all.map(t=>`<tr><td>${t.tanggal}</td><td>${t.jenis}</td><td>${escapeHtml(t.ket)||'-'}</td><td style="color:${t.jumlah<0?'#c0392b':'#2f7d4f'}">${t.jumlah<0?'-':'+'}${rupiah(Math.abs(t.jumlah))}</td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Belanja di Toko</div>
      ${belanja.length===0?'<p class="muted">Belum ada transaksi belanja di Toko pada periode ini.</p>':`<table><tr><th>Tanggal</th><th>Item</th><th>Total</th><th>Metode</th><th>Status</th></tr>
      ${belanja.map(t=>`<tr><td>${(t.createdAt||'').slice(0,10)}</td><td>${(t.items||[]).map(i=>`${escapeHtml(i.nama_produk||i.namaProduk)} x${i.qty}`).join(', ')||'-'}</td><td>${rupiah(t.total)}</td><td>${escapeHtml(t.metode)}</td><td>${t.statusBayar==='lunas'?'Lunas':'Hutang'}</td></tr>`).join('')}</table>`}
    </div>
  `;
}

/* ---------- ABSENSI ---------- */
let absMode='bulan', absFrom='', absTo=todayStr();
const LABEL_STATUS_ABSEN = { h:'Hadir', i:'Izin', a:'Alpha' };
const TAG_STATUS_ABSEN = { h:'tag-hadir', i:'tag-izin', a:'tag-alpha' };
function setAbsPeriode(mode){ absMode=mode; const r=rentangPeriode(mode); absFrom=r.dari; absTo=r.sampai; renderAbsensi(); }
function renderAbsensi(){
  if(!absFrom){ const r=rentangPeriode(absMode); absFrom=r.dari; absTo=r.sampai; }
  const s = mySantri();
  const items = DB.absensi.filter(a=>a.santriId===s.id && a.tanggal>=absFrom && a.tanggal<=absTo);
  const byKegiatan = {};
  items.forEach(a=>{ byKegiatan[a.kegiatanId] = byKegiatan[a.kegiatanId]||[]; byKegiatan[a.kegiatanId].push(a); });
  // Daftar lengkap tiap catatan (semua status: Hadir/Izin/Alpha), diurutkan tanggal
  // terbaru dulu -- supaya Izin/Alpha tidak "hilang" dan wali bisa lihat rincian
  // per kegiatan per tanggal, tidak cuma rekap persentase hadir saja.
  const rincian = items.slice().sort((a,b)=> b.tanggal.localeCompare(a.tanggal) || (a.kegiatanId||'').localeCompare(b.kegiatanId||''));
  document.getElementById('content').innerHTML = `
    <h2>Absensi</h2>
    ${tabsPeriode(absMode, 'setAbsPeriode')}
    <div class="card grid2">
      <div><label>Dari tanggal</label><input type="date" value="${absFrom}" onchange="absFrom=this.value; absMode=''; renderAbsensi()"></div>
      <div><label>Sampai tanggal</label><input type="date" value="${absTo}" onchange="absTo=this.value; absMode=''; renderAbsensi()"></div>
    </div>
    <div class="card">
      <div class="card-title">Ringkasan per kegiatan</div>
      ${Object.keys(byKegiatan).length===0?'<p class="muted">Belum ada data absensi pada periode ini.</p>':`<table class="tbl-absensi">
      <tr><th>Kegiatan</th><th class="c">Hadir</th><th class="c">Izin</th><th class="c">Alpha</th><th class="c">%</th></tr>
      ${Object.keys(byKegiatan).map(kid=>{
        const kg = DB.kegiatan.find(k=>k.id===kid);
        const arr = byKegiatan[kid];
        const hadir = arr.filter(a=>a.status==='h').length;
        const izin = arr.filter(a=>a.status==='i').length;
        const alpha = arr.filter(a=>a.status==='a').length;
        const pct = Math.round(hadir/arr.length*100);
        return `<tr>
          <td>${kg?escapeHtml(kg.nama):'-'}</td>
          <td class="c num-hadir">${hadir}</td>
          <td class="c ${izin>0?'num-izin':'num-zero'}">${izin}</td>
          <td class="c ${alpha>0?'num-alpha':'num-zero'}">${alpha}</td>
          <td class="c">${pct}%</td>
        </tr>`;
      }).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Rincian per tanggal</div>
      ${rincian.length===0?'<p class="muted">Belum ada data absensi pada periode ini.</p>':`<table><tr><th>Tanggal</th><th>Kegiatan</th><th>Status</th></tr>
      ${rincian.map(a=>{
        const kg = DB.kegiatan.find(k=>k.id===a.kegiatanId);
        const label = LABEL_STATUS_ABSEN[a.status] || a.status;
        const tagClass = TAG_STATUS_ABSEN[a.status] || 'tag-nontakhossus';
        return `<tr><td>${a.tanggal}</td><td>${kg?escapeHtml(kg.nama):'-'}</td><td><span class="tag ${tagClass}">${label}</span></td></tr>`;
      }).join('')}</table>`}
    </div>
  `;
}

/* ---------- HAFALAN ---------- */
let hfMode='bulan', hfFrom='', hfTo=todayStr();
function setHfPeriode(mode){ hfMode=mode; const r=rentangPeriode(mode); hfFrom=r.dari; hfTo=r.sampai; renderHafalan(); }
function renderHafalan(){
  if(!hfFrom){ const r=rentangPeriode(hfMode); hfFrom=r.dari; hfTo=r.sampai; }
  const s = mySantri();
  const namaKegiatan = kid => (DB.kegiatan.find(k=>k.id===kid)||{}).nama || '-';
  const items = DB.hafalan.filter(h=>h.santriId===s.id && h.tanggal>=hfFrom && h.tanggal<=hfTo).sort((a,b)=>a.tanggal.localeCompare(b.tanggal));
  const murojaahItems = (DB.murojaah||[]).filter(m=>m.santriId===s.id && m.tanggal>=hfFrom && m.tanggal<=hfTo).sort((a,b)=>b.tanggal.localeCompare(a.tanggal));
  const tambah = items.length>=2 ? totalHalaman(items[items.length-1])-totalHalaman(items[0]) : 0;
  document.getElementById('content').innerHTML = `
    <h2>Hafalan</h2>
    ${tabsPeriode(hfMode, 'setHfPeriode')}
    <div class="card grid2">
      <div><label>Dari tanggal</label><input type="date" value="${hfFrom}" onchange="hfFrom=this.value; hfMode=''; renderHafalan()"></div>
      <div><label>Sampai tanggal</label><input type="date" value="${hfTo}" onchange="hfTo=this.value; hfMode=''; renderHafalan()"></div>
    </div>
    <div class="card stat"><div class="num">${tambah}</div><div class="label">Tambahan halaman pada periode ini</div></div>
    <div class="card">
      <div class="card-title">Grafik tren</div>
      <canvas id="chartHafalan" width="600" height="200" style="width:100%;height:170px"></canvas>
    </div>
    <div class="card">
      <div class="card-title">Riwayat Setoran (menambah hafalan baru)</div>
      ${items.length===0?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Tanggal</th><th>Kegiatan</th><th>Juz</th><th>Halaman</th></tr>${items.slice().reverse().map(h=>`<tr><td>${h.tanggal}</td><td>${escapeHtml(namaKegiatan(h.kegiatanId))}</td><td>${h.juz}</td><td>${h.halaman}</td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Riwayat Setoran 2 / Murojaah (mengulang hafalan)</div>
      ${murojaahItems.length===0?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Tanggal</th><th>Kegiatan</th><th>Juz</th><th>Cakupan</th></tr>${murojaahItems.map(m=>`<tr><td>${m.tanggal}</td><td>${escapeHtml(namaKegiatan(m.kegiatanId))}</td><td>${m.juz}</td><td>${escapeHtml(m.cakupan)}</td></tr>`).join('')}</table>`}
    </div>
  `;
  drawTrend(items);
}
function drawTrend(items){
  const canvas = document.getElementById('chartHafalan');
  const ctx = canvas.getContext('2d');
  const W=canvas.width, H=canvas.height, pad=30;
  ctx.clearRect(0,0,W,H);
  if(items.length<2){ ctx.fillStyle='#888'; ctx.font='13px sans-serif'; ctx.fillText('Belum cukup data untuk grafik tren.',10,H/2); return; }
  const vals = items.map(totalHalaman);
  const maxV = Math.max(1,...vals);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(pad,H-pad); ctx.lineTo(W-10,H-pad); ctx.stroke();
  ctx.strokeStyle='#3b5940'; ctx.beginPath();
  items.forEach((h,i)=>{
    const x = pad + (i/(items.length-1))*(W-pad-20);
    const y = H-pad - (totalHalaman(h)/maxV)*(H-pad-20);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

/* ---------- TAGIHAN & IURAN ---------- */
// Label bulan dari string "YYYY-MM" (kalau ada), contoh "September 2026". Kalau tidak ada / gagal parse, kembalikan ''.
function labelBulan(bln){
  if(!bln) return '';
  try{ return new Date(bln+'-01').toLocaleDateString('id-ID',{month:'long', year:'numeric'}); }
  catch(e){ return ''; }
}
function renderTagihan(){
  const s = mySantri();

  // Semua tagihan (SPP, dsb) milik santri ini, apa pun bulannya -- supaya tidak ada
  // yang "hilang" hanya karena sudah dibuat lebih awal untuk bulan mendatang.
  const semuaTagihan = DB.tagihan.filter(t=>t.santriId===s.id).map(t=>{
    const jenis = DB.jenisTagihan.find(j=>j.id===t.jenisTagihanId);
    const lbl = labelBulan(t.bulan);
    return { nama: (jenis?jenis.nama:'Tagihan') + (lbl?` (${lbl})`:''), jumlah:t.jumlah, status:t.status, tglBayar:t.tglBayar, urut:t.bulan||'' };
  });

  // Iuran (insidental) milik santri ini -- RPC sudah filter per santri, jadi ambil semua
  const semuaIuran = DB.iuranDetail.map(it=>{
    const lbl = it.tanggal ? labelBulan(it.tanggal.slice(0,7)) : '';
    return { nama:'Iuran' + (it.keterangan?(': '+it.keterangan):'') + (lbl?` (${lbl})`:''), jumlah:it.jumlah, status:it.status, tglBayar:it.tglBayar, urut:it.tanggal||'' };
  });

  const semua = [...semuaTagihan, ...semuaIuran];
  const belum = semua.filter(r=>r.status==='belum').sort((a,b)=>a.urut.localeCompare(b.urut));
  const lunas = semua.filter(r=>r.status==='lunas').sort((a,b)=>b.urut.localeCompare(a.urut));

  document.getElementById('content').innerHTML = `
    <h2>Tagihan &amp; Iuran</h2>
    <p class="muted" style="margin-top:-6px">Semua tagihan &amp; iuran, apa pun periodenya</p>
    ${semua.length===0?`<div class="card"><p class="muted">Tidak ada tagihan atau iuran.</p></div>`:`
    <div class="card">
      <div class="card-title">Belum bayar (${belum.length})</div>
      ${belum.length===0?'<p class="muted">Semua tagihan sudah lunas. &#127881;</p>':`<table><tr><th>Nama</th><th>Nominal</th><th>Status</th></tr>
      ${belum.map(r=>`<tr><td>${escapeHtml(r.nama)}</td><td>${rupiah(r.jumlah)}</td><td><span class="tag tag-belum">Belum bayar</span></td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Sudah lunas (${lunas.length})</div>
      ${lunas.length===0?'<p class="muted">Belum ada yang lunas.</p>':`<table><tr><th>Nama</th><th>Nominal</th><th>Tgl. bayar</th><th>Status</th></tr>
      ${lunas.map(r=>`<tr><td>${escapeHtml(r.nama)}</td><td>${rupiah(r.jumlah)}</td><td>${r.tglBayar||'-'}</td><td><span class="tag tag-lunas">Lunas</span></td></tr>`).join('')}</table>`}
    </div>`}
  `;
}

/* ---------- MUAT ULANG (tarik data terbaru dari Supabase) ----------
   Sebelumnya lewat tombol di header. Sekarang header sudah dibersihkan
   dari tombol, jadi diganti otomatis & senyap: setiap kali pengguna
   kembali ke app ini (mis. balik dari app lain / kunci layar), data
   ditarik ulang di belakang layar tanpa mengganggu tampilan. Dibatasi
   jarak minimal 60 detik antar-refresh supaya tidak memanggil RPC
   berkali-kali kalau pengguna gonta-ganti app dengan cepat. Kalau gagal
   (mis. lagi tidak ada internet), dibiarkan saja -- data lama yang sudah
   tampil tetap dipakai, tidak perlu mengganggu dengan alert. */
let lastAutoRefresh = 0;
async function muatUlang(){
  const ok = await muatDataWali(ME.noInduk, ME.kodeWali, false);
  if(ok) goPage(currentPage);
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState!=='visible' || !ME) return;
  if(document.getElementById('app').style.display==='none') return;
  const now = Date.now();
  if(now - lastAutoRefresh < 60000) return;
  lastAutoRefresh = now;
  muatUlang();
});

/* ---------- MODAL ---------- */
function showModal(title, bodyHtml){
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
        ${bodyHtml}
      </div>
    </div>
  `;
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }

/* ---------- INIT ---------- */
initLogin();
