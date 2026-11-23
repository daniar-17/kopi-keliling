# Arah Desain CarTuLing

## Identitas

Peta direktori tukang keliling untuk konsumen dan pedagang. Antarmuka
harus terasa seperti papan pengumuman jalanan: tegas, mudah dipindai dari
kejauhan, dan tidak takut terlihat kasar.

Dial: **ENERGY 3 / RHYTHM 2 / MOTION 1**

- ENERGY 3: border tebal dan blok warna besar, karena pengguna memindai peta
  sambil berjalan, bukan membaca halaman pemasaran.
- RHYTHM 2: susunan mengikuti fungsi (peta, filter, daftar) dalam bentuk
  mosaic tile berukuran berbeda. Peta jadi tile terbesar, kartu pedagang jadi
  tile kecil, jadi hierarki terbaca tanpa section berganti-ganti gaya.
- MOTION 1: hanya umpan balik tekan dan transisi kecil. Tidak ada animasi
  berulang, karena layar ini dipakai sambil bergerak.

## Palet

| Token | Nilai | Alasan |
| --- | --- | --- |
| `ink` | `#111111` | Border, teks, dan bayangan. Kontras 17.1:1 di atas putih. |
| `canvas` | `#FFFFFF` | Putih bersih sebagai dasar halaman, supaya border dan bayangan tinta terbaca paling tegas. |
| `mist` | `#F2F2F2` | Panel sekunder dan latar peta, abu netral tanpa kesan kekuningan. |
| `brand` | `#0C9B62` | Identitas hijau yang sudah dipakai produk. Teks di atasnya selalu hitam (5.29:1). |
| `accent` | `#FFC93C` | Penanda pedagang terpilih. Satu aksen, satu momen. |
| `accent-soft` | `#FFE58A` | Versi lembut aksen untuk tombol aksi utama (lokasi dan rute), supaya tidak bersaing dengan penanda terpilih. Teks hitam. |
| `danger` | `#B00020` | Hanya untuk teks galat, bukan blok dekoratif. |
| `muted` | `#4B4B45` | Teks sekunder, 7.96:1, bukan abu-abu tipis. |

Putih tidak dipakai sebagai teks di atas hijau karena hanya 3.57:1 dan gagal
WCAG AA. Tombol hijau memakai teks hitam.

## Tipografi

- Display: **Archivo Black**, untuk nama brand dan judul. Bobot poster cocok
  dengan border tebal.
- Body: **Plus Jakarta Sans** 400 sampai 700, sudah dipakai produk dan tetap
  nyaman untuk teks kecil di peta dan kartu.

## Bentuk

- Radius 16px untuk tile dan kartu pedagang, 12px untuk kotak logo, avatar,
  dan bingkai peta, 10px untuk tombol dan input, 6px untuk chip kecil.
- Bayangan keras tanpa blur: 2px, 4px, dan 6px ke kanan bawah, warna `ink`.
- Border 2px untuk kontrol, 3px untuk pemisah header dan footer.

## Susunan Bento

Halaman depan disusun sebagai mosaic tile dengan jarak yang sama:

- Tile filter dan lokasi, kecil, di kiri atas.
- Tile peta, tile terbesar, membentang dua baris di kolom kiri.
- Tile judul dan jumlah pedagang, lebar, di kanan atas.
- Kartu pedagang sebagai tile kecil dua kolom di bawahnya.
- Tile pagination di bawah kartu.

Di layar di bawah `sm`, daftar pedagang tetap grid dua kolom tanpa
scroll-snap, jadi enam kartu per halaman tampil sebagai tiga baris dan
halaman digulir seperti situs biasa. Kartunya dipadatkan: logo 32px,
tombol hanya ikon (label muncul di layar lebar), dan baris "Titik
diperbarui" disembunyikan.

Peta mendapat area terbesar karena itu yang dicari pengguna lebih dulu.
Bento dipilih oleh pemilik produk, dicatat sebagai arahan sadar meskipun
layout mosaic termasuk pola yang mudah jatuh jadi template (R-05). Karena itu
tile mengikuti kepentingan konten, bukan variasi ukuran tanpa alasan.

## Gerak

- Hover mengangkat elemen 2px dan menambah bayangan.
- Tekan mengembalikan elemen ke posisi awal dan menghapus bayangan.
- `prefers-reduced-motion` mematikan transform.

## Yang Sengaja Tidak Dipakai

- Pola grid atau titik di latar, karena tidak membantu pembacaan peta.
- Glow, blur, gradient, dan glassmorphism.
- Logo atau ilustrasi baru: identitas sementara memakai teks.
- Warna marker brand dari database dipakai pada marker peta dan ikon gerobak di kartu pedagang; kotaknya tetap netral supaya warna brand yang terang tidak hilang.
