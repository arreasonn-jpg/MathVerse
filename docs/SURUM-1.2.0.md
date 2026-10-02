# LABİRENT PROTOKOLÜ — v1.2.0 sürüm notları

**Inferno Protocol görselliğinde, Labirent: Ölümcül Kaçış mantığında birinci şahıs hayatta kalma-korku oyunu.**
Electron masaüstü uygulaması — tarayıcı gerekmez, tek klasörde çalışır.

---

## 1) Grafikler: yazılım raycast yerine gerçek GPU hattı (WebGL)

v1.1.0 hâlâ CPU'da, düşük iç çözünürlükte (384–640p) hesaplanan bir yazılım raycast hattıydı; bu yüzden
görüntü büyütüldüğünde pikselli ve yumuşak görünüyordu. v1.2.0'da dünya artık **GPU'da, ekranın gerçek
çözünürlüğünde** çiziliyor:

| | v1.1.0 | **v1.2.0** |
|---|---|---|
| Çizim | CPU yazılım raycast | **GPU (WebGL) — donanım hızlandırmalı** |
| İç çözünürlük | 384p / 512p / 640p | **Pencere çözünürlüğü ×1.0–1.35 süper örnekleme** |
| Kenar yumuşatma | yok (büyütme bulanıklığı) | **SSAA + çift doğrusal iniş** |
| Doku filtreleme | nokta/çift doğrusal | **mipmap + 8× anizotropik** |
| Duvarlar | 2B sütunlar | **gerçek 3B ağ: yükseklik, tavan, eğimli yüzeyler** |
| Işık | sütun başına | **piksel başına: normal haritası + güneş + fener (nokta ışık) + spekülar** |
| Sis | sabit renk karışımı | **üstel sis + gökyüzüne bağlanan ufuk** |
| Gökyüzü | ekran katmanı | **3B ışın: gradyan + güneş/ay diski ve halesi + yıldız alanı + fbm bulutlar** |
| Son işleme | CSS filtresi | **ACES ton eşleme, eşikli bloom, renk sapması, vinyet, film greni, keskinleştirme** |

Ayrıca:

- **Doku atlası yeniden kuruldu:** tüm karolar (taş, yosun, sarmaşık, tahta, kapı, ızgara, kovan, rune taşları
  dâhil 100+ kimlik) 256 px doku + normal + pürüzlülük katmanıyla GPU'ya yükleniyor; rune taşları ve kapılar
  artık kendi dokularıyla görünüyor (önceki sürümde bazı karolar yanlış dokuya düşüyordu).
- **Duvar dokusu döşemesi düzeltildi:** 4 birim yüksekliğindeki duvarlarda doku dikdörtgen geriliyordu; artık
  her birim yükseklikte bir doku tekrarı var (CPU hattıyla aynı yoğunluk, tuğlalar kare kalıyor).
- **Uçurum/boşluk kuşağı** gerçek geometri olarak karanlık yüzeylerle çiziliyor; dış kuşak artık sisle
  bütünleşiyor.

### Güvenlik ağı (oyun asla siyah ekran vermez)

- GPU hattı açılmazsa (WebGL yok, sürücü kara listede, yazılım GPU) oyun **otomatik olarak CPU hattına döner**
  ve bunu Ayarlar → **GRAFİK HATTI DURUMU** satırında sebebiyle birlikte yazar.
- İlk karede **renkli sonda** ile GPU geri okuması doğrulanır; tutarsızsa yine CPU'ya düşülür.
- Ayarlardan **GRAFİK HATTI: Otomatik / GPU / CPU** seçilebilir (karşılaştırma yapmak isteyenler için).

---

## 2) Kontroller: profesyonel seviye paketi

v1.1.0'un kontrol geçişi reddedilmişti; v1.2.0'da hareket ve nişan baştan yazıldı:

- **120 Hz alt adımlı hareket:** ivme/fren artık kare hızından bağımsız; 30 FPS'te de 144 FPS'te de aynı his.
- **Ham fare girdisi:** pointer lock `unadjustedMovement` ile alınır — işletim sisteminin fare hızlandırması
  devre dışı kalır, nişan birebir takip eder.
- **X ve Y ekseni için ayrı hassasiyet** + **nişan (ADS) hassasiyeti:** mızrak hazırken (sağ tuş veya kol LT)
  hassasiyet %62'ye düşer, görüş alanı daralır, geri tepme azalır.
- **Kol için çift bölgeli tepki eğrisi + radyal ölü bölge:** iç bölgede ince nişan, dış bölgede hızlı dönüş;
  ölü bölge artık daire biçiminde (eksen başına kare değil).
- **Kamera geri bildirimi:** koşarken görüş alanı hafifçe açılır (FOV vuruşu), yana yürürken kamera yatar (roll),
  sert inişte kamera yaylanır (dip). Sallanma şiddeti ayarlanabilir.
- **Fare yumuşatma varsayılanı 0.05'e indirildi** (gecikme hissi yerine doğrudan takip).
- Varsayılan tuşlar standart FPS düzeni: **WASD**, Shift koş, C/Ctrl eğil, E etkileşim, F fener, 1-4 araç,
  Tab günlük, M harita, F5/F9 hızlı kayıt, F11 tam ekran; **tüm eylemler yeniden atanabilir** (Ayarlar → Tuşlar).

---

## 3) Harita: 500 × 500 karo (labirent alanı ~15.8×)

- Dünya 159 × 159'dan **500 × 500 karo**ya çıktı: 6.28× kenar, **10.8× toplam alan**;
  labirent kuşağı 10.430 → **164.738 karo (15.8×)**, yürünebilir alan ~100.880 karo.
- Kayran (kamp, Kutu, barakalar) ve yarıçap değerleri korundu: yaşam alanı aynı, çevresi çok daha büyük.
- İçerik ölçeklendi: bahçede 420 bitki, labirentte 22 istasyon, dış kuşakta 48 kaynak, 20 böcek bıçağı,
  gün başına `min(34, 16 + gün × 2)` kapı.
- Performans: yol bulma havuzlanmış tamponlara alındı (çöp üretimi yok), sisin ötesi hiç taranmıyor,
  bölüm ağları mesafeye göre kurulup uzaktakiler bellekten düşürülüyor.
- Gece duvarları kayması (shift) ve döngü testleri 500 × 500'de doğrulandı.

---

## 4) Yaşam alanı kuralı (korundu)

Kayran ve çevresinde **hiçbir yaratık yok**; Grievers ve Böcek Bıçakları yalnızca labirent kuşağında avlanır.
Test: 500 × 500 dünyada 1.560 yaratık-kare tarandı, yaşam alanına en yakın mesafe **11.69 karo** (sınır 10.5).

---

## 5) Yeni ayarlar

| Ayar | Ne yapar |
|---|---|
| GRAFİK HATTI | Otomatik / GPU (WebGL) / CPU (yazılım) |
| GRAFİK HATTI DURUMU | Hangi hattın etkin olduğunu ve sebebini yazar |
| KOL EĞRİSİ | Çift bölge (profesyonel) / Klasik |
| YATAY · DİKEY HASSASİYET | Fare eksen çarpanları |
| NİŞAN (ADS) HASSASİYETİ | Mızrak hazırken hassasiyet oranı |

---

## 6) Doğrulama (bu sürümde çalıştırılan testler)

```
node tools/maze-test.js      → TÜM TESTLER GEÇTİ   (500×500 dünya, gece kayması, rune kodu, kapılar)
node tools/glade-test.js     → YAŞAM ALANI TEMİZ   (en yakın yaratık 11.69 > 10.5)
node tools/desktop-test.js   → TÜM MASAÜSTÜ TESTLERİ GEÇTİ (paketleme, ayarlar, tuş atama)
node tools/gl-test.js        → 69/69               (GPU hattı: ağ, atlas, döşeme, sonda, shader denetimi)
node tools/smoke-test.js     → TÜM TESTLER GEÇTİ   (tarayıcı modu)
node tools/smoke-test.js --desktop → TÜM TESTLER GEÇTİ (masaüstü modu)
node tools/render-real.js    → CPU yedeği görüntü üretmeye devam ediyor
```

`tools/gl-test.js` GPU'suz ortamda WebGL1'i taklit ederek hattı gerçekten çalıştırır: 500 × 500 dünyada
36 bölüm, 301.668 köşe, 452.502 indeks, 12 farklı doku, süper örneklemeli hedef, bozuk sürücü sonda testi.

---

## 7) İndirme ve kurulum

| Platform | Dosya |
|---|---|
| Windows | `LabirentProtokolu-Kurulum-1.2.0-x64.exe` — Türkçe kurulum sihirbazı |
| Windows | `LabirentProtokolu-Tasinabilir-1.2.0-x64.exe` — kurulumsuz, USB'den çalışır |
| Windows | `LabirentProtokolu-Klasor-1.2.0-x64.zip` — klasöre çıkar, çalıştır (en az uyarı) |
| macOS | `LabirentProtokolu-1.2.0-arm64.dmg` (Apple Silicon) · `-x64.dmg` (Intel) |
| Linux | `LabirentProtokolu-1.2.0-x86_64.AppImage` · `-amd64.deb` |

Kod imzalama sertifikası olmadığı için Windows SmartScreen "bilinmeyen yayıncı" uyarısı verebilir:
**Ek bilgi → Yine de yükle** ya da PowerShell'de `Unblock-File "<dosya yolu>"`.
Sağlama toplamları sürüm sayfasındaki `SHA256SUMS-*.txt` dosyalarında.

Ayrıntılı kurulum, sorun giderme ve sistem gereksinimleri: `docs/KURULUM.md`
