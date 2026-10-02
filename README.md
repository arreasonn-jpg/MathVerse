# LABİRENT PROTOKOLÜ

**Inferno Protocol görselliğinde, Labirent: Ölümcül Kaçış mantığında bir hayatta kalma-korku oyunu.**
Tarayıcıda çalışan, tek bir HTML sayfası + saf JavaScript ile yazılmış, birinci şahıs (FPS) raycast motoru.
Hiçbir harici görsel/ses dosyası yok — tüm dokular, sprite'lar ve sesler çalışma anında kodla üretilir.

![Kayran](docs/kayran.png)

## Neden "Inferno Protocol grafiği + Labirent mantığı"

| Katman | Inferno Protocol'ten | Labirent: Ölümcül Kaçış'tan |
|---|---|---|
| Görsel | Kirli beton/taş, yosun, paslı WICKED çeliği, düşük doygunluklu gri-yeşil palet, CRT tarama çizgileri, film grenli karartma, fener ekonomisi, karanlıkta ufalan görüş | — |
| Ses | Prosedürel rüzgâr, alçak drone, yaklaşan Grievers uğultusu, kalp atışı, devreye giren geçit gıcırtısı | — |
| Mantık | — | Kayran (Glade), Kutu, 4 Geçit, gece kapanan kapılar, her gece **yer değiştiren duvarlar**, Böcek Bıçakları (casus), Grievers (avcı), Uçurum, kovan, rune taşları ve **π kodu (3 1 4 1 5 9 2 6)** |

| | |
|---|---|
| ![Labirent](docs/labirent.png) | ![Gece, fenerle](docs/gece-fener.png) |
| Gündüz labirenti: taş bloklar, gölgeli koridorlar | Gece: fener ekonomisi, sis ve karanlık |
| ![Grievers](docs/griever.png) | ![Rune](docs/rune.png) |
| Grievers — koridorda avcı | Sektör duvarına kazınmış rune taşı (π basamağı) |

Doku atlası: [`docs/doku-atlasi.png`](docs/doku-atlasi.png) — tüm duvarlar ve sprite'lar `js/10-textures.js` içinde kodla üretilir.

## Kurulum / Çalıştırma

Sunucu gerekmez; `index.html` dosyasını tarayıcıda açmak yeterlidir:

```bash
python3 -m http.server 8080     # sonra http://localhost:8080
```

Klavye + fare gerekir. Başlamak için ekrana tıkla (fare kilidi alınır), `ESC` ile menü.

## Kontroller

| Tuş | İşlev |
|---|---|
| `W A S D` | Yürü / yan adım |
| `SHIFT` | Koş (nefes tüketir, gürültü yapar) |
| `C` | Eğil (sessiz, Grievers daha zor bulur) |
| `FARE` | Bakış (yukarı/aşağı dahil) |
| `E` | Etkileşim (Kutu, rune taşı, baraka, kovan, kapak) |
| `F` | Fener aç/kapa (pille çalışır, seni görünür yapar) |
| `1 2 3 4` | Araç seç: FENER / İZLEYİCİ / MIZRAK / SARF |
| `Q` veya `SOL TIK` | Aracı kullan / mızrak savur |
| `M` | Harita (yalnızca yürüdüğün yerleri hatırlar) |
| `TAB` | Günlük (π dizisi, çanta, istatistik) |
| `ESC` | Duraklat (kaydet, ses, görüntü kalitesi) |

## Oyun Akışı

1. **Kayran'ı öğren.** Kutu bir üretim terminalidir; malzemeden fener, izleyici, mızrak, halat üretir.
   Arşiv tabletini oku → iki kural öğrenilir: *geçitler alacakaranlıkta kapanır*, *duvarlar her gece kayar*.
2. **8 rune taşını bul.** Her taşta π dizisinin bir basamağı ve **okunma sırası** kazınmıştır.
   Dizi toplandığında çıkış kodu: `3 1 4 1 5 9 2 6`.
3. **Kovandan anahtarı al.** Dış kuşaktaki Griever yuvasına halatla inilir (uyandırdığın muhafıza dikkat).
4. **Çıkış kapağını aç.** Dış kuşaktaki kapağa 8 haneli kodu gir. 3 yanlış deneme Grievers'i uyandırır.
5. **Kaç.** Beyaz ışık, deney raporu, bölüm 2 verisi.

### Ölüm sebepleri

Grievers iğnesi (zehir), açlık, gece dışarıda donma, uçuruma düşme (WICKED seni geri getirir ama ağır bedelle),
7. günü görememek (protokol temizliği).

## Sistemler

- **Geçitler**: gün doğumunda açılır, alacakaranlıkta kapanır. Gece dışarıda kalan, av olur — sinematik mantığın tamamı bu kurala bağlı.
- **Kaydırma (Shifting)**: her yeni günde iç labirent kuşağı yeni tohumla yeniden üretilir (~2.300 hücre yer değiştirir).
  Kayran, geçitler, rune sırası ve sektör düzeni sabit kalır — oyuncu yönünü kaybeder ama hikâye ilerler.
- **Böcek Bıçakları**: seni görür → tarar → WICKED'e konum bildirir → en yakın iki Grievers peşine düşer. Öldürülebilir; çaldıklarını geri bırakır.
- **Grievers**: BFS akış alanı ile gerçek yol bulur, görüş hattı + gürültü + gece çarpanı ile avlanır, koridor köşelerine takılmaz.
  Mızrak onları sersemletir, 4 isabet etkisiz bırakır (kovan muhafızı 10 isabet).
- **Uçurum**: labirentin dış sınırı. İki dar kanal dış kuşağa geçit verir (biri ızgara köprüdür, gürültü yapar).
- **Üretim**: lif, çelik, reçine, konserve, pil, serum, WICKED anahtarı.
- **Kayıt**: her 20 saniyede ve olay bazlı olarak `localStorage`'a yazılır (süreç devam edebilir).

## Teknik

- `js/30-render.js` — yazılım raycaster: DDA duvar izleme, gerçek zemin izdüşümü, değişken duvar yükseklikleri,
  mesafe sisine göre renk karışımı, fener ışığı, sprite derinlik tamponu, baş sallanması (bob).
- `js/10-textures.js` — 19 doku + 8 rune taşı + 22 sprite, hepsi `fbm`/`cel` gürültüsü ve canvas çizimleriyle üretilir.
- `js/20-maze.js` — Kayran, halka yolu, 4 geçit, sektör duvarları, DFS labirenti, örgüleme, bulvarlar,
  kanallar, rune yerleşimi, gizli geçitler ve kaydırma algoritması (dağıtılmış çekirdek, `docs/`'a bakınız).
- `js/50-ai.js` — hücre merkezli BFS yol takibi (duvara takılmaz), görüş hattı denetimi, devriye/hedef akışı.
- `js/40-audio.js` — WebAudio: döngüsel gürültü + filtre + LFO ile prosedürel ortam sesi, eşzamanlı tehdit uğultusu.
- Kare bütçesi: 240×135'te ~2 ms, 480×270'te ~5 ms (yazılım gerçekleyiciyle ölçüldü). Görüntü kalitesi menüden değiştirilebilir.

## Test / doğrulama araçları

Tarayıcı olmadan da tüm mantık ve görüntü doğrulanabilir:

```bash
node tools/maze-test.js      # labirent: bağlantısallık, rune/çıkış erişimi, gece kapanması, kaydırma
node tools/smoke-test.js     # sahte DOM ile 4000+ kare koşu, tüm arayüz ekranları, kayıt/yükleme, kaçış
node tools/render-real.js    # gerçek raycast karelerini tools/out/*.png olarak yazar (görsel denetim)
```

`tools/softcanvas.js` küçük bir yazılım Canvas2D gerçekleyicisidir (yol dolgusu, gradyan, bitmap yazı);
`tools/png.js` zlib ile PNG kodlar. Bu sayede motorun çıktısı CI'da bile PNG olarak incelenebilir.

## Dosya düzeni

```
index.html            giriş noktası
css/style.css         HUD, CRT katmanları, menüler
js/00-core.js         rastgelelik, gürültü, renk, kayıt
js/10-textures.js     prosedürel dokular ve sprite'lar
js/20-maze.js         labirent dünyası + kaydırma
js/30-render.js       raycaster
js/40-audio.js        prosedürel ses
js/50-ai.js           Böcek Bıçağı + Grievers
js/60-game.js         oyun çekirdeği (gün/gece, geçitler, görevler, üretim, savaş)
js/70-ui.js           HUD, harita, günlük, menüler
tools/                test ve görsel doğrulama araçları
```

## Filmden alınan mantık, oyunun kendi kararları

Filmde geçitler her akşam kapanır ve kimse geri dönmez; duvarlar gece yer değiştirir; Grievers geceleri avlanır;
kod ancak labirentin bölümlerindeki harfler/sayılarla çözülür. Bu oyunda:

- Kod, filmin ruhuna uygun olarak öznelerin çocukluktan bildiği bir sabitten — **π** — türetildi ve
  WICKED'in kendisi arşivde bunu açık ediyor.
- Uçurum, filmin sonundaki kaçış hattına gönderme olarak iki dar kanalla geçilebilir.
- Böcek Bıçakları "casus" rolünde oynanabilir bir tehdit hâline getirildi: eşya çalarlar, konumunu bildirirler.
