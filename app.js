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
const SUPABASE_URL = 'https://liivvueodribjwipmbrl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KKSw-wparSwNbIvR9wHhyQ_Pc1NdcKG';
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

const CACHE_KEY = 'wali_cache_v2'; // cadangan tampilan terakhir saja (bukan sumber data utama), supaya tetap bisa dilihat sebentar walau lagi tidak ada internet
const SYNC_TS_KEY = 'wali_last_sync_v2'; // kapan terakhir kali BERHASIL narik data lengkap dari Supabase -- juga dipakai sebagai "cursor" delta sync (updated_at >= ini)
const FULL_SYNC_TS_KEY = 'wali_last_full_sync_v2'; // kapan terakhir kali sync PENUH (bukan delta) berhasil
const MIN_SYNC_MS = 3 * 60 * 1000; // 3 menit -- jarak minimal antar sync (delta ataupun penuh)
const FULL_RESYNC_MS = 6 * 60 * 60 * 1000; // 6 jam -- jaring pengaman: delta sync (berdasar updated_at) tidak
  // bisa tahu kalau ada baris yang betul-betul DIHAPUS (bukan diedit) di server, atau baris yang
  // status-nya berubah sampai keluar dari filter (misal transaksi_saldo status aktif->dibatalkan).
  // Supaya kasus itu tidak "nyangkut" selamanya di HP, tiap maksimal 6 jam dipaksa sync PENUH lagi
  // (ganti total, bukan gabung) yang otomatis membuang baris yang sudah tidak relevan.
function simpanCache(db){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(db)); localStorage.setItem(SYNC_TS_KEY, String(Date.now())); }catch(e){} }
function ambilCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }catch(e){ return null; } }
function cacheMasihSegar(){
  try{
    const t = parseInt(localStorage.getItem(SYNC_TS_KEY)||'0', 10);
    return t > 0 && (Date.now() - t) < MIN_SYNC_MS;
  }catch(e){ return false; }
}
function waktuSyncTerakhirTs(){ try{ return parseInt(localStorage.getItem(SYNC_TS_KEY)||'0', 10); }catch(e){ return 0; } }
function waktuFullSyncTerakhirTs(){ try{ return parseInt(localStorage.getItem(FULL_SYNC_TS_KEY)||'0', 10); }catch(e){ return 0; } }
function catatFullSync(){ try{ localStorage.setItem(FULL_SYNC_TS_KEY, String(Date.now())); }catch(e){} }
// Gabungkan baris "baru" (hasil delta) ke daftar "lama" (upsert by id), lalu buang baris yang
// tanggalnya sudah keluar dari jendela 30 hari (jendela ini geser tiap hari, jadi perlu di-trim
// ulang tiap sync walau tidak ada perubahan data apapun).
function gabungTrim(lama, baru, cutoffTgl, kolomTgl){
  const map = new Map();
  (lama||[]).forEach(x=>{ if(x && x.id!=null) map.set(x.id, x); });
  (baru||[]).forEach(x=>{ if(x && x.id!=null) map.set(x.id, x); });
  return Array.from(map.values()).filter(x => String(x[kolomTgl]||'').slice(0,10) >= cutoffTgl);
}

let DB = { santri: [], mahram: [], kegiatan: [], tesKenaikanJuz: [], absensi: [], hafalan: [], murojaah: [], transaksiSaldo: [], transaksiToko: [], tagihan: [], jenisTagihan: [], iuranDetail: [], rekapAbsensi: [], rekapHafalan: [], rekapMurojaah: [], rekapSaldo: [], rekapToko: [] };
let ME = JSON.parse(sessionStorage.getItem('wali_session') || 'null'); // {noInduk, kodeWali} -- hanya untuk sesi berjalan, tidak dicadangkan ke localStorage

// Urutan tab: beranda, info, hafalan, absensi, tagihan, riwayat -- tab Saldo
// dihapus (dulu di sini) karena isinya cuma mengulang angka yang sudah
// tampil di Beranda; Saldo saat ini + riwayatnya sekarang cukup diakses
// lewat kartu "Saldo" di Beranda -> tab Riwayat.
const NAV = [
  {id:'beranda', label:'Beranda', icon:'&#8962;'},
  {id:'info', label:'Info', icon:'&#128100;'},
  {id:'hafalan', label:'Hafalan', icon:'&#128214;'},
  {id:'absensi', label:'Absensi', icon:'&#10003;'},
  {id:'tagihan', label:'Tagihan', icon:'&#128179;'},
  {id:'riwayat', label:'Riwayat', icon:'&#128203;'}
];
let currentPage='beranda';

function val(id){ return document.getElementById(id).value; }
// Tanggal "hari ini" di zona waktu Asia/Jakarta (WIB) — BUKAN dari toISOString() (selalu zona UTC).
// Sebelumnya pakai new Date().toISOString(), yang bikin "hari ini" bisa mundur 1 hari kalau dibuka
// jam 00:00-06:59 WIB (di jam itu UTC masih di tanggal kemarin) — bug yang sama seperti yang pernah
// ditemukan & diperbaiki di Aplikasi Pembina & Aplikasi Pondok.
function todayStr(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}
// Geser tanggal (string YYYY-MM-DD) mundur/maju N hari dan/atau N tahun, dengan aritmatika kalender
// murni (lewat Date.UTC) — supaya hasilnya tidak ikut bergeser oleh zona waktu perangkat.
function geserTanggalStr(str, opsi){
  opsi = opsi || {};
  const [y,m,d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y + (opsi.tahun||0), m-1, d));
  if(opsi.hari) dt.setUTCDate(dt.getUTCDate() + opsi.hari);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}
// Label bulan dari kolom 'bulan' hasil view rekap_*_bulanan (formatnya date "YYYY-MM-DD",
// selalu tanggal 1) -- beda dari labelBulan() di bawah yang untuk kolom tagihan (string "YYYY-MM").
function labelBulanDate(tgl){
  if(!tgl) return '-';
  try{ return new Date(tgl+'T00:00:00').toLocaleDateString('id-ID',{month:'long', year:'numeric'}); }
  catch(e){ return tgl; }
}
// Kartu keterangan yang dipasang di atas tabel rekap bulanan, supaya wali paham kenapa
// data lama cuma ringkasan (bukan bug/data hilang).
const KET_REKAP_BULANAN = `<p class="muted" style="margin:6px 0 10px">Detail harian tersedia untuk 30 hari terakhir. Untuk periode yang lebih lama, ditampilkan ringkasan per bulan berikut.</p>`;

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
  if(!ME) return;
  const c = ambilCache();
  if(c && cacheMasihSegar()){
    DB = c; enterApp(); // tampilkan cache langsung, tidak perlu narik ulang ke server
    return;
  }
  await muatDataWali(ME.noInduk, ME.kodeWali, true);
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

    const { data: s, error: errSantri } = await sb.from('santri').select('id,nama,no_induk,foto_url,foto_thumb_url,tetala,alamat,tanggal_masuk,jenis_kelamin,nama_ayah,nama_ibu,nama_wali,foto_wali,foto_wali_thumb_url,kode_wali,kelas,kamar,no_hp_wali,program,hafalan_awal').single();
    if(errSantri || !s){
      if(izinkanCache){ const c = ambilCache(); if(c){ DB = c; enterApp(); return true; } }
      return false;
    }

    // 'murojaah' (mengulang hafalan) TETAP diambil -- yang dihapus dulu cuma
    // nama "Setoran 2" di tampilan, bukan datanya. Datanya mencakup semua
    // kegiatan murojaah (Murojaah 1/2/3, atau kegiatan lain yang dicatat
    // sebagai murojaah), sudah dicek langsung ke Supabase kolomnya cocok
    // (juz, cakupan, keterangan, tanggal) dan RLS-nya benar (wali cuma lihat
    // punya anaknya sendiri lewat policy wali_lihat_murojaah_anak_sendiri).
    // Detail lengkap cuma untuk 30 hari terakhir -- lebih lama dari itu, wali tetap bisa
    // lihat datanya tapi dalam bentuk RINGKASAN PER BULAN (lewat view rekap_*_bulanan di
    // Supabase), bukan detail satu-satu lagi. Ini permintaan eksplisit user untuk memangkas
    // egress: riwayat absensi/hafalan/murojaah/transaksi terus bertambah tiap hari tanpa
    // batas kalau ditarik detail penuh setiap kali sinkron.
    const cutoffTgl = geserTanggalStr(todayStr(), { hari: -30 });

    // basis = data lokal yang sudah ada (dari cache tersimpan, atau dari DB di memori kalau
    // baru saja sync di sesi ini) -- dipakai sebagai dasar gabungan kalau sync ini DELTA.
    const basis = ambilCache() || DB;
    const cursorTs = waktuSyncTerakhirTs();
    const perluFull = !waktuFullSyncTerakhirTs() || (Date.now() - waktuFullSyncTerakhirTs() > FULL_RESYNC_MS);
    const cursorIso = (!perluFull && cursorTs) ? new Date(cursorTs).toISOString() : null;

    // 5 query volume terbesar (absensi/hafalan/murojaah/transaksi_saldo/transaksi_toko) dibuat
    // sebagai builder dulu, baru ditambah filter updated_at KALAU ini sync delta -- supaya cuma
    // baris yang baru dibuat/diedit sejak sync terakhir yang ditarik, bukan seluruh isi tabel lagi.
    let qAbsensi = sb.from('absensi').select('id,santri_id,kegiatan_id,tanggal,status').eq('santri_id', s.id).gte('tanggal', cutoffTgl);
    let qHafalan = sb.from('hafalan').select('id,santri_id,tanggal,juz,halaman_sampai,kegiatan_id,keterangan').eq('santri_id', s.id).gte('tanggal', cutoffTgl).order('tanggal');
    let qMurojaah = sb.from('murojaah').select('id,santri_id,kegiatan_id,tanggal,juz,cakupan,keterangan').eq('santri_id', s.id).gte('tanggal', cutoffTgl).order('tanggal');
    let qSaldo = sb.from('transaksi_saldo').select('id,santri_id,jenis,jumlah,keterangan,tanggal,metode').eq('santri_id', s.id).eq('status', 'aktif').gte('tanggal', cutoffTgl);
    // items_ringkas = generated column di Supabase, cuma berisi {nama_produk,qty} per barang
    // (bukan produk_id/harga_beli/harga_jual yang tidak pernah dipakai di app ini)
    let qToko = sb.from('transaksi_toko').select('id,santri_id,items:items_ringkas,total,metode,status_bayar,created_at').eq('santri_id', s.id).gte('created_at', cutoffTgl);
    if(cursorIso){
      qAbsensi = qAbsensi.gte('updated_at', cursorIso);
      qHafalan = qHafalan.gte('updated_at', cursorIso);
      qMurojaah = qMurojaah.gte('updated_at', cursorIso);
      qSaldo = qSaldo.gte('updated_at', cursorIso);
      qToko = qToko.gte('updated_at', cursorIso);
    }

    const [
      { data: mahramRows }, { data: kegiatanRows }, { data: tesJuzRows }, { data: absensiRows },
      { data: hafalanRows }, { data: murojaahRows }, { data: saldoRows }, { data: tokoRows },
      { data: tagihanRows }, { data: jenisTagihanRows }, { data: iuranDetailRows },
      { data: saldoView },
      { data: rekapAbsensiRows }, { data: rekapHafalanRows }, { data: rekapMurojaahRows },
      { data: rekapSaldoRows }, { data: rekapTokoRows }
    ] = await Promise.all([
      sb.from('mahram').select('id,nama,hubungan,no_hp,foto_url,foto_thumb_url').eq('santri_id', s.id),
      sb.from('kegiatan').select('id,nama,program_khusus').eq('aktif', true),
      // Tes Kenaikan Juz -- barisnya sedikit (hanya tiap juz/blok 10 juz tuntas), jadi
      // ditarik PENUH tiap loadAll() (bukan didelta), supaya notice "tes 10 juz, wali harus
      // ke pondok" selalu muncul akurat begitu pembina mencatatnya.
      sb.from('tes_kenaikan_juz').select('id,santri_id,juz_selesai,kategori,syarat_juz,tanggal_mulai,batas_hari,status,tanggal_lulus,wali_hadir').eq('santri_id', s.id),
      qAbsensi, qHafalan, qMurojaah, qSaldo, qToko,
      sb.from('tagihan').select('id,santri_id,jenis_tagihan_id,bulan,jumlah,status,tgl_bayar').eq('santri_id', s.id),
      sb.from('jenis_tagihan').select('id,nama'),
      sb.from('iuran_detail').select('id, santri_id, jumlah, status, tgl_bayar, iuran(tanggal, keterangan)').eq('santri_id', s.id),
      // Saldo SEKARANG dihitung server-side (view saldo_santri, sama seperti dipakai Aplikasi
      // Toko/Kasir) -- bukan lagi dijumlah dari transaksi_saldo di JS, karena transaksi_saldo
      // yang ditarik sekarang cuma 30 hari terakhir (tidak cukup buat hitung total saldo).
      sb.from('saldo_santri').select('saldo').eq('santri_id', s.id).maybeSingle(),
      sb.from('rekap_absensi_bulanan').select('bulan,hadir,izin,sakit,alpha,total').eq('santri_id', s.id).order('bulan', { ascending: false }),
      sb.from('rekap_hafalan_bulanan').select('bulan,jumlah_setoran,juz_akhir,halaman_akhir').eq('santri_id', s.id).order('bulan', { ascending: false }),
      sb.from('rekap_murojaah_bulanan').select('bulan,jumlah_setoran,juz_terakhir').eq('santri_id', s.id).order('bulan', { ascending: false }),
      sb.from('rekap_saldo_bulanan').select('bulan,jenis,jumlah_transaksi,total_nominal').eq('santri_id', s.id).order('bulan', { ascending: false }),
      sb.from('rekap_toko_bulanan').select('bulan,jumlah_transaksi,total_belanja').eq('santri_id', s.id).order('bulan', { ascending: false })
    ]);

    // Bentuk ulang jadi persis nama field yang dipakai di seluruh app.js ini
    // (sebelumnya dibentuk oleh RPC data_wali_santri di sisi server; sekarang dibentuk di sini).
    // Dipakai versi thumbnail (foto_thumb_url / foto_wali_thumb_url) supaya avatar kecil
    // di app ini tidak menarik file full-size dari storage -- ini salah satu penyebab
    // egress v2 membengkak. Fallback ke foto_url/foto_wali kalau thumbnail-nya belum ada.
    const mahram = (mahramRows||[]).map(m=>({ id:m.id, nama:m.nama, hubungan:m.hubungan||'', hp:m.no_hp||'', foto:m.foto_thumb_url||m.foto_url||'' }));
    DB = {
      santri: [{
        id: s.id, nama: s.nama, noInduk: s.no_induk, foto: s.foto_thumb_url||s.foto_url||'',
        tetala: s.tetala||'', alamat: s.alamat||'', tglMasuk: s.tanggal_masuk,
        jenisKelamin: s.jenis_kelamin||'L', namaAyah: s.nama_ayah||'', namaIbu: s.nama_ibu||'',
        namaWali: s.nama_wali||'', fotoWali: s.foto_wali_thumb_url||s.foto_wali||'', kodeWali: s.kode_wali,
        kelas: s.kelas||'', kamar: s.kamar||'', hpWali: s.no_hp_wali||'',
        program: s.program||'Non-Takhossus', hafalanAwal: s.hafalan_awal||0,
        mahram
      }],
      mahram,
      kegiatan: (kegiatanRows||[]).map(k=>({ id:k.id, nama:k.nama, programKhusus:k.program_khusus })),
      tesKenaikanJuz: (tesJuzRows||[]).map(t=>({
        id:t.id, juzSelesai:t.juz_selesai, kategori:t.kategori, syaratJuz:t.syarat_juz,
        tanggalMulai:t.tanggal_mulai, batasHari:t.batas_hari, status:t.status,
        tanggalLulus:t.tanggal_lulus||null, waliHadir: !!t.wali_hadir
      })),
      // status mentah di tabel absensi berupa teks ('Hadir'/'Izin'/dst), disamakan ke kode
      // singkat h/i/a persis seperti yang dulu dilakukan RPC data_wali_santri.
      // Kalau ini sync DELTA: baris hasil query cuma yang berubah sejak sync terakhir, jadi
      // digabung (upsert by id) dengan data lama, bukan menimpa total -- kalau FULL: langsung
      // dipakai apa adanya (menimpa total), sekalian jadi titik "reset" yang membuang baris
      // yang sudah dihapus/berubah status di server (lihat penjelasan FULL_RESYNC_MS di atas).
      absensi: (()=>{
        const barus = (absensiRows||[]).map(a=>({
          id:a.id, santriId:a.santri_id, kegiatanId:a.kegiatan_id, tanggal:a.tanggal,
          status: a.status==='Hadir' ? 'h' : (a.status==='Izin' ? 'i' : 'a')
        }));
        return perluFull ? barus : gabungTrim(basis.absensi, barus, cutoffTgl, 'tanggal');
      })(),
      hafalan: (()=>{
        const barus = (hafalanRows||[]).map(h=>({ id:h.id, santriId:h.santri_id, tanggal:h.tanggal, juz:h.juz, halaman:h.halaman_sampai, kegiatanId:h.kegiatan_id||null, keterangan:h.keterangan||'Lancar' }));
        return perluFull ? barus : gabungTrim(basis.hafalan, barus, cutoffTgl, 'tanggal');
      })(),
      murojaah: (()=>{
        const barus = (murojaahRows||[]).map(m=>({ id:m.id, santriId:m.santri_id, kegiatanId:m.kegiatan_id, tanggal:m.tanggal, juz:m.juz, cakupan:m.cakupan, keterangan:m.keterangan||'Lancar' }));
        return perluFull ? barus : gabungTrim(basis.murojaah, barus, cutoffTgl, 'tanggal');
      })(),
      transaksiSaldo: (()=>{
        const barus = (saldoRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, jenis:t.jenis, jumlah:t.jumlah, keterangan:t.keterangan, tanggal:t.tanggal, metode:t.metode }));
        return perluFull ? barus : gabungTrim(basis.transaksiSaldo, barus, cutoffTgl, 'tanggal');
      })(),
      transaksiToko: (()=>{
        const barus = (tokoRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, items:t.items, total:t.total, metode:t.metode, statusBayar:t.status_bayar, createdAt:t.created_at }));
        return perluFull ? barus : gabungTrim(basis.transaksiToko, barus, cutoffTgl, 'createdAt');
      })(),
      tagihan: (tagihanRows||[]).map(t=>({ id:t.id, santriId:t.santri_id, jenisTagihanId:t.jenis_tagihan_id, bulan:t.bulan, jumlah:t.jumlah, status:t.status, tglBayar:t.tgl_bayar })),
      jenisTagihan: (jenisTagihanRows||[]).map(j=>({ id:j.id, nama:j.nama })),
      iuranDetail: (iuranDetailRows||[]).map(d=>({
        id:d.id, santriId:d.santri_id, jumlah:d.jumlah, status:d.status, tglBayar:d.tgl_bayar,
        tanggal: d.iuran ? d.iuran.tanggal : null, keterangan: d.iuran ? d.iuran.keterangan : null
      })),
      // Rekap per bulan -- dipakai untuk menampilkan riwayat sebelum 30 hari terakhir
      // (lihat cutoffTgl di atas), tanpa perlu narik detail baris satu-satu.
      rekapAbsensi: (rekapAbsensiRows||[]).map(r=>({ bulan:r.bulan, hadir:r.hadir, izin:r.izin, sakit:r.sakit, alpha:r.alpha, total:r.total })),
      rekapHafalan: (rekapHafalanRows||[]).map(r=>({ bulan:r.bulan, jumlahSetoran:r.jumlah_setoran, juzAkhir:r.juz_akhir, halamanAkhir:r.halaman_akhir })),
      rekapMurojaah: (rekapMurojaahRows||[]).map(r=>({ bulan:r.bulan, jumlahSetoran:r.jumlah_setoran, juzTerakhir:r.juz_terakhir })),
      rekapSaldo: (rekapSaldoRows||[]).map(r=>({ bulan:r.bulan, jenis:r.jenis, jumlahTransaksi:r.jumlah_transaksi, totalNominal:r.total_nominal })),
      rekapToko: (rekapTokoRows||[]).map(r=>({ bulan:r.bulan, jumlahTransaksi:r.jumlah_transaksi, totalBelanja:r.total_belanja }))
    };
    // saldo santri = total transaksi_saldo berstatus 'aktif' saja (SEMUA histori, dihitung
    // di server lewat view saldo_santri -- persis logika yang sama dipakai Aplikasi
    // Keuangan/Kasir):
    // - 'setoran' menambah saldo
    // - 'tarik' mengurangi saldo
    // - 'bayar' mengurangi saldo HANYA kalau metode-nya 'saldo' atau kosong (belanja
    //   dibayar pakai saldo). 'bayar' dengan metode 'tunai' (dibayar cash di toko)
    //   TIDAK mengurangi saldo.
    // Kalau view gagal/kosong, fallback ke jumlah dari transaksiSaldo yang sudah ditarik
    // (30 hari terakhir saja -- cuma perkiraan, bukan saldo pasti).
    DB.santri[0].saldo = (saldoView && saldoView.saldo!=null) ? saldoView.saldo : DB.transaksiSaldo.reduce((sum,t)=>{
      if(t.jenis==='setoran') return sum + t.jumlah;
      if(t.jenis==='tarik') return sum - t.jumlah;
      if(t.jenis==='bayar' && (t.metode==='saldo' || !t.metode)) return sum - t.jumlah;
      return sum;
    }, 0);
    simpanCache(DB);
    if(perluFull) catatFullSync();
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
function mySantri(){ return DB.santri[0]; }
function enterApp(){
  document.getElementById('loginScreen').style.display='none';
  // PENTING: harus "flex", bukan "block" -- #app sekarang kolom flex
  // (topbar + .layout + bottomnav dibagi rapi setinggi persis layar lewat
  // CSS #app.screen{display:flex;...}). Kalau di sini dipaksa jadi "block"
  // lewat inline style, itu MENIMPA aturan display:flex dari CSS (inline
  // style menang), dan bottomnav bisa balik lagi jadi hilang/perlu digeser.
  document.getElementById('app').style.display='flex';
  document.getElementById('anakLabel').textContent = mySantri()?.nama || 'Wali Santri';
  renderNav();
  goPage('beranda');
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
  if(p==='riwayat') renderRiwayat();
  if(p==='absensi') renderAbsensi();
  if(p==='hafalan') renderHafalan();
  if(p==='tagihan') renderTagihan();
}
function bulanIni(){ return todayStr().slice(0,7); }

/* ---------- FILTER PERIODE (Hari ini / Pekan / Bulan / Tahun) ---------- */
const LABEL_PERIODE = { hari:'Hari ini', pekan:'Pekan ini', bulan:'Bulan ini', tahun:'Tahun ini' };
function rentangPeriode(mode){
  const hariIni = todayStr();
  let dari;
  if(mode==='hari'){
    dari = hariIni;
  } else if(mode==='pekan'){
    const [y,m,d] = hariIni.split('-').map(Number);
    const dow = (new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7; // Senin=0 ... Minggu=6
    dari = geserTanggalStr(hariIni, {hari:-dow});
  } else if(mode==='tahun'){
    dari = `${hariIni.slice(0,4)}-01-01`;
  } else { // 'bulan' (default)
    dari = `${hariIni.slice(0,7)}-01`;
  }
  return { dari, sampai: hariIni };
}
function tabsPeriode(mode, fnSet){
  return `<div class="tabs">${Object.keys(LABEL_PERIODE).map(m=>
    `<button class="tab ${mode===m?'active':''}" onclick="${fnSet}('${m}')">${LABEL_PERIODE[m]}</button>`
  ).join('')}</div>`;
}

/* ---------- Data ringkasan bersama (dipakai Beranda & Tagihan) ---------- */
// Gabungan tagihan (SPP dsb) + iuran milik satu santri, sudah diberi label &
// dipisah belum-bayar/lunas -- dipakai renderTagihan() dan kartu ringkasan
// di Beranda supaya angkanya SELALU sama persis, tidak dihitung 2x dengan
// cara berbeda di 2 tempat.
function dataTagihanIuran(s){
  const semuaTagihan = DB.tagihan.filter(t=>t.santriId===s.id).map(t=>{
    const jenis = DB.jenisTagihan.find(j=>j.id===t.jenisTagihanId);
    const lbl = labelBulan(t.bulan);
    return { nama: (jenis?jenis.nama:'Tagihan') + (lbl?` (${lbl})`:''), jumlah:t.jumlah, status:t.status, tglBayar:t.tglBayar, urut:t.bulan||'' };
  });
  const semuaIuran = DB.iuranDetail.map(it=>{
    const lbl = it.tanggal ? labelBulan(it.tanggal.slice(0,7)) : '';
    return { nama:'Iuran' + (it.keterangan?(': '+it.keterangan):'') + (lbl?` (${lbl})`:''), jumlah:it.jumlah, status:it.status, tglBayar:it.tglBayar, urut:it.tanggal||'' };
  });
  const semua = [...semuaTagihan, ...semuaIuran];
  const belum = semua.filter(r=>r.status==='belum').sort((a,b)=>a.urut.localeCompare(b.urut));
  const lunas = semua.filter(r=>r.status==='lunas').sort((a,b)=>b.urut.localeCompare(a.urut));
  return { semua, belum, lunas };
}
// Ringkasan persentase kehadiran bulan berjalan, dipakai di kartu Beranda.
function ringkasanAbsensiBulanIni(s){
  const r = rentangPeriode('bulan');
  const items = DB.absensi.filter(a=>a.santriId===s.id && a.tanggal>=r.dari && a.tanggal<=r.sampai);
  if(items.length===0) return { pct:null, hadir:0, total:0 };
  const hadir = items.filter(a=>a.status==='h').length;
  return { pct: Math.round(hadir/items.length*100), hadir, total: items.length };
}

/* ---------- BERANDA ---------- */
// Kartu profil di atas (gradasi hijau) + daftar ringkasan tersusun ke bawah
// (bukan grid 2 kolom lagi) supaya masing-masing kartu lebih lega dibaca dan
// tiap kategori (saldo/hafalan/absensi/tagihan) punya warna ikon sendiri.
// Tiap kartu ringkasan bisa diketuk untuk langsung pindah ke tab detailnya
// (kartu Saldo mengarah ke tab Riwayat, karena tab Saldo tersendiri sudah
// dihapus -- isinya dulu cuma mengulang angka yang sama).
/* Urutan hafalan pondok TIDAK 1-30 berurutan, tapi 29,30,1,2,...,28 -- SAMA
   PERSIS dengan Aplikasi Pembina (JUZ_ORDER). Dipakai HANYA untuk menghitung
   rentang "Juz X sampai Y" pada tes kategori '10juz' di bawah. */
const JUZ_ORDER = [29, 30, ...Array.from({length:28}, (_,i)=>i+1)];
function posisiJuz(juz){ return JUZ_ORDER.indexOf(juz) + 1; }
/* Baris nilai utama kartu Tes Kenaikan -- "Juz 25" untuk tes 1 juz, atau
   "Juz 9 sampai 18" untuk tes 10 juz (rentang syaratJuz juz terakhir yang
   berakhir di juzSelesai, dihitung lewat JUZ_ORDER supaya benar walau
   melewati batas 28->29/30). */
function labelJuzTes(tes){
  if(tes.kategori !== '10juz') return `Juz ${tes.juzSelesai}`;
  const posAkhir = posisiJuz(tes.juzSelesai);
  const posAwal = Math.max(1, posAkhir - tes.syaratJuz + 1);
  const juzAwal = JUZ_ORDER[posAwal - 1];
  return juzAwal === tes.juzSelesai ? `Juz ${tes.juzSelesai}` : `Juz ${juzAwal} sampai ${tes.juzSelesai}`;
}
/* Kartu Tes Kenaikan Juz di Beranda -- SELALU ditampilkan (bukan cuma
   kalau sedang menunggu), dibuat SERINGKAS mungkin (judul, juz, batas hari
   saja) supaya tidak memenuhi Beranda -- detail lengkap tetap ada di tab
   Hafalan/Riwayat kalau wali butuh:
   - Tidak ada tes yang menunggu -> tampilkan info netral "Belum ada".
   - Kategori '10juz' (santri Takhossus tuntas 1 blok hafalan) -> tes besar,
     WAJIB disimak langsung oleh wali di pondok -- diberi badge merah kecil
     supaya tetap menonjol walau ringkas.
   - Kategori '1juz' (baca ulang 1 juz yang baru tuntas) -> tes reguler oleh
     pembina, wali tidak wajib hadir.
   Nilai kategori PERSIS '1juz'/'10juz' ini dibatasi CHECK constraint di
   database (tes_kenaikan_juz_kategori_check) -- SAMA PERSIS dengan
   Aplikasi Pembina (function tentukanTesKenaikanJuz) & Aplikasi Pondok --
   jangan diubah sendiri-sendiri di salah satu app tanpa menyamakan yang
   lain. */
function kartuTesKenaikan(){
  const tes = DB.tesKenaikanJuz.find(t=>t.status==='menunggu');
  if(!tes){
    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Tes Kenaikan Juz</div>
      <p class="muted" style="margin:2px 0 0">Belum ada</p>
    </div>`;
  }
  const mulai = new Date(tes.tanggalMulai);
  const batas = new Date(mulai.getTime() + tes.batasHari*86400000);
  const sisa = Math.ceil((batas - new Date(todayStr()))/86400000);
  const batasTeks = sisa<0 ? `Lewat ${Math.abs(sisa)} hari` : `Batas ${sisa} hari`;
  const wajibHadir = tes.kategori === '10juz';
  return `
    <div class="card" style="margin-bottom:14px${wajibHadir ? ';border:2px solid var(--danger,#d33)' : ''}">
      <div class="card-title">Tes Kenaikan Juz${wajibHadir ? ' <span class="tag tag-belum">Wali wajib hadir</span>' : ''}</div>
      <div style="font-size:19px;font-weight:800;margin:2px 0">${labelJuzTes(tes)}</div>
      <p class="muted" style="margin:0">${batasTeks}</p>
    </div>`;
}
function renderBeranda(){
  const s = mySantri();
  const lastHafalan = DB.hafalan.filter(h=>h.santriId===s.id).sort((a,b)=>b.tanggal.localeCompare(a.tanggal))[0];
  // Kalau tidak ada setoran hafalan dalam 30 hari terakhir, pakai posisi akhir dari
  // rekap bulan paling baru (sudah urut bulan terbaru dulu) supaya kartu ini tidak
  // tiba-tiba kosong walau sebenarnya santri punya riwayat hafalan.
  const rekapTerbaru = (!lastHafalan && DB.rekapHafalan && DB.rekapHafalan[0]) ? DB.rekapHafalan[0] : null;
  const labelHafalanTerakhir = lastHafalan
    ? `Juz ${lastHafalan.juz} &middot; Hal. ${lastHafalan.halaman}`
    : (rekapTerbaru ? `Juz ${rekapTerbaru.juzAkhir} &middot; Hal. ${rekapTerbaru.halamanAkhir}` : 'Belum ada data');
  const abs = ringkasanAbsensiBulanIni(s);
  const tg = dataTagihanIuran(s);
  document.getElementById('content').innerHTML = `
    <div class="profile-card">
      ${s.foto?`<img src="${s.foto}" class="avatar-lg">`:`<div class="avatar avatar-lg" style="font-size:24px">${escapeHtml((s.nama||'?').slice(0,2).toUpperCase())}</div>`}
      <h2>${escapeHtml(s.nama)}</h2>
      <p class="muted-invert">No. induk ${escapeHtml(s.noInduk)} &middot; ${escapeHtml(s.kelas)||'-'}</p>
      <span class="tag ${s.program==='Takhossus'?'tag-takhossus':'tag-nontakhossus'}">${escapeHtml(s.program)||'-'}</span>
    </div>

    ${kartuTesKenaikan()}

    <div class="stat-list">
      <button class="stat-item green" onclick="goPage('riwayat')">
        <span class="icon-circle">&#128176;</span>
        <span class="stat-text"><span class="num">${rupiah(s.saldo)}</span><span class="label">Saldo saat ini</span></span>
        <span class="chev">&#8250;</span>
      </button>
      <button class="stat-item purple" onclick="goPage('hafalan')">
        <span class="icon-circle">&#128214;</span>
        <span class="stat-text"><span class="num">${labelHafalanTerakhir}</span><span class="label">Hafalan terakhir</span></span>
        <span class="chev">&#8250;</span>
      </button>
      <button class="stat-item amber" onclick="goPage('absensi')">
        <span class="icon-circle">&#10003;</span>
        <span class="stat-text"><span class="num">${abs.pct===null?'-':abs.pct+'%'}</span><span class="label">Kehadiran bulan ini${abs.total?` (${abs.hadir}/${abs.total})`:''}</span></span>
        <span class="chev">&#8250;</span>
      </button>
      <button class="stat-item rose" onclick="goPage('tagihan')">
        <span class="icon-circle">&#128179;</span>
        <span class="stat-text"><span class="num">${tg.belum.length} tagihan</span><span class="label">Belum dibayar</span></span>
        <span class="chev">&#8250;</span>
      </button>
    </div>

    <p class="muted" style="margin-top:6px">Data ini hasil sinkron terakhir. Untuk data terbaru, minta admin melakukan sinkron ulang.</p>
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

/* ---------- RIWAYAT (juga menggantikan tab Saldo yang dihapus) ---------- */
let riwPeriode='bulan', riwFrom='', riwTo=todayStr(), riwJenis='semua';
const LABEL_JENIS_RIWAYAT = {setoran:'Top Up', tarik:'Tarik Tunai', bayar:'Bayar (saldo)'};
function setRiwPeriode(mode){
  riwPeriode = mode;
  if(mode!=='custom'){ const r=rentangPeriode(mode); riwFrom=r.dari; riwTo=r.sampai; }
  renderRiwayat();
}
function renderRiwayat(){
  if(!riwFrom){ const r=rentangPeriode(riwPeriode); riwFrom=r.dari; riwTo=r.sampai; }
  const s = mySantri();
  // Hanya transaksi yang benar-benar memengaruhi saldo yang ditampilkan di sini
  // (samakan dengan logika perhitungan saldo): 'bayar' dengan metode tunai tidak
  // dihitung di sini karena tidak memotong saldo -- itu sudah tercatat sendiri
  // di tabel "Belanja di Toko" di bawah. Tiap baris diberi "kategori" (setoran/
  // tarik/bayar) supaya bisa disaring lewat dropdown Jenis Transaksi.
  const sd = DB.transaksiSaldo.filter(t=>t.santriId===s.id && t.tanggal>=riwFrom && t.tanggal<=riwTo
      && (t.jenis!=='bayar' || t.metode==='saldo' || !t.metode))
    .map(t=>({tanggal:t.tanggal, jenis:LABEL_JENIS_RIWAYAT[t.jenis]||t.jenis, kategori:t.jenis, jumlah:t.jenis==='setoran'?t.jumlah:-t.jumlah, ket:t.keterangan}));
  // Pembayaran iuran lewat saldo dikelompokkan sebagai "Bayar" juga di dropdown.
  const iu = DB.iuranDetail.filter(it=>it.tanggal>=riwFrom && it.tanggal<=riwTo && it.status==='lunas')
    .map(it=>({tanggal:it.tglBayar||it.tanggal, jenis:'Iuran', kategori:'bayar', jumlah:-it.jumlah, ket:it.keterangan}));
  let all = [...sd, ...iu].sort((a,b)=>a.tanggal.localeCompare(b.tanggal));
  if(riwJenis!=='semua') all = all.filter(t=>t.kategori===riwJenis);
  const belanja = DB.transaksiToko.filter(t=>t.santriId===s.id && (t.createdAt||'').slice(0,10)>=riwFrom && (t.createdAt||'').slice(0,10)<=riwTo)
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  document.getElementById('content').innerHTML = `
    <h2>Riwayat &amp; Saldo</h2>
    <div class="card stat green" style="text-align:center;margin-bottom:12px">
      <div class="num" style="font-size:26px">${rupiah(s.saldo)}</div>
      <div class="label">Saldo saat ini</div>
    </div>
    <div class="card grid2">
      <div>
        <label>Periode</label>
        <select onchange="setRiwPeriode(this.value)">
          <option value="hari" ${riwPeriode==='hari'?'selected':''}>Hari ini</option>
          <option value="pekan" ${riwPeriode==='pekan'?'selected':''}>Pekan ini</option>
          <option value="bulan" ${riwPeriode==='bulan'?'selected':''}>Bulan ini</option>
          <option value="custom" ${riwPeriode==='custom'?'selected':''}>Tanggal dari - sampai</option>
        </select>
      </div>
      <div>
        <label>Jenis Transaksi</label>
        <select onchange="riwJenis=this.value; renderRiwayat()">
          <option value="semua" ${riwJenis==='semua'?'selected':''}>Semua</option>
          <option value="setoran" ${riwJenis==='setoran'?'selected':''}>Top Up</option>
          <option value="bayar" ${riwJenis==='bayar'?'selected':''}>Bayar</option>
          <option value="tarik" ${riwJenis==='tarik'?'selected':''}>Tarik Tunai</option>
        </select>
      </div>
      ${riwPeriode==='custom'?`
      <div><label>Dari tanggal</label><input type="date" value="${riwFrom}" onchange="riwFrom=this.value; renderRiwayat()"></div>
      <div><label>Sampai tanggal</label><input type="date" value="${riwTo}" onchange="riwTo=this.value; renderRiwayat()"></div>
      `:''}
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
    <div class="card">
      <div class="card-title">Rekap Transaksi Saldo per Bulan</div>
      ${KET_REKAP_BULANAN}
      ${(!DB.rekapSaldo || DB.rekapSaldo.length===0)?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Bulan</th><th>Jenis</th><th class="c">Jumlah</th><th>Total</th></tr>
      ${DB.rekapSaldo.map(r=>`<tr><td>${labelBulanDate(r.bulan)}</td><td>${LABEL_JENIS_RIWAYAT[r.jenis]||r.jenis}</td><td class="c">${r.jumlahTransaksi}x</td><td>${rupiah(r.totalNominal)}</td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Rekap Belanja Toko per Bulan</div>
      ${KET_REKAP_BULANAN}
      ${(!DB.rekapToko || DB.rekapToko.length===0)?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Bulan</th><th class="c">Jumlah Transaksi</th><th>Total Belanja</th></tr>
      ${DB.rekapToko.map(r=>`<tr><td>${labelBulanDate(r.bulan)}</td><td class="c">${r.jumlahTransaksi}x</td><td>${rupiah(r.totalBelanja)}</td></tr>`).join('')}</table>`}
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
    <div class="card">
      <div class="card-title">Rekap per Bulan</div>
      ${KET_REKAP_BULANAN}
      ${(!DB.rekapAbsensi || DB.rekapAbsensi.length===0)?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Bulan</th><th class="c">Hadir</th><th class="c">Izin</th><th class="c">Sakit</th><th class="c">Alpha</th><th class="c">%</th></tr>
      ${DB.rekapAbsensi.map(r=>`<tr><td>${labelBulanDate(r.bulan)}</td><td class="c num-hadir">${r.hadir}</td><td class="c ${r.izin>0?'num-izin':'num-zero'}">${r.izin}</td><td class="c">${r.sakit}</td><td class="c ${r.alpha>0?'num-alpha':'num-zero'}">${r.alpha}</td><td class="c">${r.total?Math.round(r.hadir/r.total*100):0}%</td></tr>`).join('')}</table>`}
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
  // Catatan: "Setoran 2" cuma nama lama yang dihapus dari tampilan -- data
  // Murojaah (mengulang hafalan) sendiri tetap ditampilkan, diambil dari
  // semua kegiatan murojaah (Murojaah 1/2/3, dst).
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
      <div class="card-title">Riwayat Hafalan</div>
      ${items.length===0?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Tanggal</th><th>Kegiatan</th><th>Juz</th><th>Halaman</th><th>Keterangan</th></tr>${items.slice().reverse().map(h=>`<tr><td>${h.tanggal}</td><td>${escapeHtml(namaKegiatan(h.kegiatanId))}</td><td>${h.juz}</td><td>${h.halaman}</td><td><span class="tag ${h.keterangan==='Ulang'?'tag-izin':'tag-hadir'}">${escapeHtml(h.keterangan||'Lancar')}</span></td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Riwayat Murojaah</div>
      ${murojaahItems.length===0?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Tanggal</th><th>Kegiatan</th><th>Juz</th><th>Cakupan</th><th>Keterangan</th></tr>${murojaahItems.map(m=>`<tr><td>${m.tanggal}</td><td>${escapeHtml(namaKegiatan(m.kegiatanId))}</td><td>${m.juz}</td><td>${escapeHtml(m.cakupan)}</td><td><span class="tag ${m.keterangan==='Ulang'?'tag-izin':'tag-hadir'}">${escapeHtml(m.keterangan||'Lancar')}</span></td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Rekap Hafalan per Bulan</div>
      ${KET_REKAP_BULANAN}
      ${(!DB.rekapHafalan || DB.rekapHafalan.length===0)?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Bulan</th><th class="c">Jumlah Setoran</th><th>Posisi Akhir Bulan</th></tr>
      ${DB.rekapHafalan.map(r=>`<tr><td>${labelBulanDate(r.bulan)}</td><td class="c">${r.jumlahSetoran}</td><td>Juz ${r.juzAkhir} &middot; Hal. ${r.halamanAkhir}</td></tr>`).join('')}</table>`}
    </div>
    <div class="card">
      <div class="card-title">Rekap Murojaah per Bulan</div>
      ${KET_REKAP_BULANAN}
      ${(!DB.rekapMurojaah || DB.rekapMurojaah.length===0)?'<p class="muted">Belum ada data.</p>':`<table><tr><th>Bulan</th><th class="c">Jumlah Setoran</th><th>Juz Terakhir</th></tr>
      ${DB.rekapMurojaah.map(r=>`<tr><td>${labelBulanDate(r.bulan)}</td><td class="c">${r.jumlahSetoran}</td><td>${r.juzTerakhir}</td></tr>`).join('')}</table>`}
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
  const { semua, belum, lunas } = dataTagihanIuran(s);

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
async function muatUlang(){
  const ok = await muatDataWali(ME.noInduk, ME.kodeWali, false);
  if(ok) goPage(currentPage);
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState!=='visible' || !ME) return;
  if(document.getElementById('app').style.display==='none') return;
  if(cacheMasihSegar()) return; // baru saja sync (<3 menit lalu), tidak perlu tarik ulang
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

/* ---------- TOMBOL "KEMBALI" HP/BROWSER ----------
   Aplikasi ini SPA satu halaman (tidak pernah ganti URL), jadi kalau
   dibiarkan apa adanya, tombol kembali fisik/gestur di HP (atau tombol
   back browser) tidak punya riwayat untuk di-mundurkan -- hasilnya
   LANGSUNG menutup/keluar dari aplikasi, walau pengguna cuma bermaksud
   menutup modal atau pindah dari satu tab ke tab sebelumnya.
   Solusinya: setiap kali masuk aplikasi & setiap kali pindah "layar"
   (tab, atau buka modal/scanner), sebuah riwayat kosong ditambahkan
   (history.pushState). Begitu tombol kembali ditekan, yang kepicu
   duluan adalah event 'popstate' ini -- BUKAN langsung menutup aplikasi
   -- lalu ditentukan sendiri harus ngapain:
   1. Kalau ada modal/scanner terbuka -> tutup itu saja.
   2. Kalau sedang di tab selain Beranda -> pindah ke tab Beranda dulu.
   3. Kalau sudah di Beranda -> minta ditekan sekali lagi sebelum benar-benar
      keluar (pola "tekan sekali lagi untuk keluar"), supaya tidak ke-keluar
      tanpa sengaja gara-gara sekali pijit. */
let sudahSiapKeluar = false;
let timerSiapKeluar = null;
function pasangPenjagaKembali(){
  history.pushState({ penjagaWali: true }, '');
}
function adaModalTerbuka(){
  const scannerTerbuka = document.getElementById('scannerModal').style.display !== 'none';
  const modalLainTerbuka = document.getElementById('modalRoot').innerHTML.trim() !== '';
  return scannerTerbuka || modalLainTerbuka;
}
function tampilkanPesanSekaliLagi(){
  const p = document.createElement('div');
  p.textContent = 'Tekan kembali sekali lagi untuk keluar dari aplikasi';
  p.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0) + 74px);transform:translateX(-50%);background:#232821;color:#fff;padding:9px 16px;border-radius:20px;font-size:12.5px;z-index:999;box-shadow:0 2px 10px rgba(0,0,0,.25);white-space:nowrap;';
  document.body.appendChild(p);
  setTimeout(()=> p.remove(), 1800);
}
window.addEventListener('popstate', ()=>{
  if(adaModalTerbuka()){
    tutupScanner();
    closeModal();
    pasangPenjagaKembali();
    return;
  }
  const appTerlihat = document.getElementById('app').style.display !== 'none';
  if(appTerlihat && currentPage !== 'beranda'){
    goPage('beranda');
    pasangPenjagaKembali();
    return;
  }
  if(appTerlihat && currentPage === 'beranda'){
    if(sudahSiapKeluar){
      logout(); // sesi ditutup rapi dulu, baru boleh benar-benar keluar dari aplikasi
      return;
    }
    sudahSiapKeluar = true;
    tampilkanPesanSekaliLagi();
    pasangPenjagaKembali();
    clearTimeout(timerSiapKeluar);
    timerSiapKeluar = setTimeout(()=>{ sudahSiapKeluar = false; }, 2000);
    return;
  }
  // Masih di halaman login (belum masuk aplikasi): biarkan tombol kembali
  // bekerja seperti biasa (boleh menutup aplikasi dari sini).
});

/* ---------- INIT ---------- */
pasangPenjagaKembali();
initLogin();
