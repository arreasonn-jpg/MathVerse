# LABİRENT PROTOKOLÜ — Kurulum Kılavuzu

Bu kılavuz oyunu **Windows, macOS ve Linux** bilgisayarlara kurmak, taşımak ve kaldırmak için
gereken her adımı içerir. Oyun gerçek bir masaüstü uygulamasıdır; tarayıcı gerekmez, internet
bağlantısı kullanmaz.

---

## 1. Sistem gereksinimleri

| | En düşük | Önerilen |
|---|---|---|
| İşletim sistemi | Windows 10 (64-bit) / macOS 11 / Ubuntu 20.04 dengi | Windows 11 (64-bit) / macOS 13+ / güncel Linux |
| İşlemci | Çift çekirdek 2.0 GHz | Dört çekirdek 2.8 GHz |
| Bellek | 4 GB RAM | 8 GB RAM |
| Disk | 400 MB boş alan | 800 MB |
| Ekran | 1024×640 | 1920×1080 tam ekran |
| Ek donanım | Klavye + fare | Oyun kolu (Xbox / DualSense / 8BitDo) |
| Ek yazılım | — (Windows'ta ek çalışma zamanı gerekmez) | — |

> Uygulama çevrimdışıdır: ilk kurulumdan sonra internet bağlantısı istemez, hiçbir veri göndermez.

---

## 2. Windows

### 2.1 Kurulumlu sürüm (NSIS)

1. `Labirent Protokolu Setup x.y.z.exe` dosyasına çift tıkla.
2. Windows "Bilinmeyen yayıncı" uyarısı gösterirse: **Ek bilgi → Yine de yükle**
   (dosya imzalı bir sertifikayla değil, topluluk sürümü olarak üretilmiştir).
3. Kurulum klasörünü seç → **Kur**.
4. Kurulum bitince masaüstü ve Başlat menüsü kısayolları oluşur; oyun istenirse hemen açılır.

Kurulum yeri (varsayılan): `%LOCALAPPDATA%\Programs\Labirent Protokolu`

### 2.2 Taşınabilir sürüm (portable)

`Labirent Protokolu x.y.z.exe` kurulum gerektirmez: dosyayı bir klasöre ya da USB belleğe kopyala ve
çift tıkla. Kayıtlar ve ayarlar yine bilgisayarın kullanıcı klasörüne yazılır (bkz. bölüm 5);
taşınabilir çalıştırılabilir dosyanın yanına veri bırakmaz.

### 2.3 Kaldırma

**Ayarlar → Uygulamalar → Labirent Protokolü → Kaldır**, ya da
`%LOCALAPPDATA%\Programs\Labirent Protokolu\Uninstall Labirent Protokolu.exe`.
Kaldırma, kayıt dosyalarını **silmez** (bölüm 5'teki klasörü elle silebilirsin).

---

## 3. macOS

1. `Labirent Protokolu-x.y.z.dmg` dosyasını aç.
2. İçindeki **Labirent Protokolu** simgesini **Applications** klasörüne sürükle.
3. İlk açılışta "geliştirici doğrulanamadı" uyarısı çıkarsa:
   **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** ya da uygulamaya sağ tık → **Aç**.
4. Apple Silicon (M serisi) ve Intel Mac'ler için ayrı paketler üretilir.

---

## 4. Linux

### 4.1 AppImage (kurulumsuz, önerilen)

```bash
chmod +x "Labirent Protokolu-x.y.z.AppImage"
./"Labirent Protokolu-x.y.z.AppImage"
```

Sanal ekranda çalıştırıyorsan: `--no-sandbox` gerekebilir (`./AppImage --no-sandbox`).

### 4.2 deb paketi (Debian / Ubuntu / Mint)

```bash
sudo dpkg -i labirent-protokolu_x.y.z_amd64.deb
# eksik bağımlılık olursa:
sudo apt-get -f install
```

Kurulumdan sonra oyunu uygulama menüsünden ya da terminalden `labirent-protokolu` ile başlatabilirsin.

### 4.3 Kaldırma

```bash
sudo apt remove labirent-protokolu        # deb
rm ~/.local/share/applications/*labirent*  # AppImage kısayolu varsa
```

---

## 5. Kayıt dosyaları, ayarlar ve günlük

| | Windows | macOS | Linux |
|---|---|---|---|
| Kayıtlar | `%APPDATA%\LABİRENT PROTOKOLÜ\saves\slot-0…3.json` | `~/Library/Application Support/LABİRENT PROTOKOLÜ/saves/` | `~/.config/LABİRENT PROTOKOLÜ/saves/` |
| Ayarlar | `…\LABİRENT PROTOKOLÜ\settings.json` | `…/settings.json` | `…/settings.json` |
| Pencere durumu | `…\window-state.json` | `…/window-state.json` | `…/window-state.json` |
| Günlük | `…\LABİRENT PROTOKOLÜ\labirent.log` | `…/labirent.log` | `…/labirent.log` |
| Ekran görüntüleri | `%USERPROFILE%\Pictures\Labirent Protokolu\` | `~/Pictures/Labirent Protokolu/` | `~/Pictures/Labirent Protokolu/` |

- **Slot 0** otomatik kayıttır (20 saniyede bir ve çıkışta). **1–3** elle kayıttır.
- Oyun içinden **Ayarlar → Kayıt klasörü** satırındaki `AÇ` düğmesi ilgili klasörü dosya
  yöneticisinde açar.
- Bir kaydı yedeklemek için `.json` dosyasını kopyalamak yeterlidir; başka bilgisayara taşımak için
  aynı klasöre koy.
- Sıfırdan başlamak için `saves` klasörünü sil (ayarlar korunur), tüm veriyi sıfırlamak için
  `LABİRENT PROTOKOLÜ` klasörünün tamamını sil.
- Günlük dosyası hata ayıklama içindir; oyunla ilgili bir sorun bildirirken bu dosyayı eklemek yeterlidir.

---

## 6. Ayarlar

Ayarlar ana menüden ya da `ESC → AYARLAR` ile açılır ve anında uygulanır, `settings.json` içine yazılır.

| Ayar | Seçenekler | Etki |
|---|---|---|
| Görüntü kalitesi | Yüksek / Orta / Performans | İç ölçekleme (1× / 2× / 3× piksel) — düşük donanımda FPS |
| Ses | 0 – 100 | Tüm prosedürel seslerin ana sesi |
| Fare hassasiyeti | 0.3 – 2.5 | Bakış hızı |
| Ters Y ekseni | Açık / Kapalı | Fare ve kol dikey bakışı |
| Ekran sarsıntısı | Açık / Kapalı | Hasar ve koşu sarsıntısı |
| Odak kaybında duraklat | Açık / Kapalı | Alt+Tab'da oyun durur (varsayılan: açık) |
| Tam ekran | Aç / Kapat | F11 ile aynı |
| Ekran görüntüsü | Çek | F12 ile aynı, PNG olarak Resimler'e yazar |
| Sistem bilgisi | — | Sürüm, platform, Electron/Chromium sürümü, kayıt klasörü |

---

## 7. Kontroller

| İşlev | Klavye + fare | Oyun kolu |
|---|---|---|
| Yürü / yan adım | `W A S D` | Sol çubuk |
| Koş | `SHIFT` | Çubuğu sonuna kadar it |
| Bakış | Fare | Sağ çubuk |
| Eğil (sessiz) | `C` | `LT` |
| Etkileşim | `E` | `A` |
| Fener | `F` | `B` |
| Mızrak / saldırı | `Q` / Sol tık | `X` / `RT` |
| Araç kullan | `Q` / Sol tık | `Y` |
| Araç değiştir | `1 2 3 4` | `LB` / `RB` |
| Harita | `M` | `BACK` |
| Günlük | `TAB` | — |
| Duraklat | `ESC` | `START` |
| Tam ekran | `F11` | — |
| Ekran görüntüsü | `F12` | — |
| Kaydet / Yükle | `Ctrl+S` / `Ctrl+O` | — |

Kol bağlandığında otomatik algılanır ve ekranda bildirilir; ayrıca bir şey kurmak gerekmez.

---

## 8. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Oyun hiç açılmıyor | `labirent.log` dosyasını aç, hata satırını incele. Windows'ta ekran kartı sürücüsünü güncelle. |
| "Bilinmeyen yayıncı" / "geliştirici doğrulanamadı" | Bölüm 2.1 (Ek bilgi → Yine de yükle) / Bölüm 3 (Yine de Aç). |
| Siyah ekran, ses var | Tam ekranı kapat (`F11`), görüntü kalitesini **Performans** yap. |
| Düşük FPS | Ayarlar → Görüntü kalitesi → Performans; pencereyi küçült; diğer GPU uygulamalarını kapat. |
| Fare dönmüyor | Oyun penceresine bir kez tıkla (fare kilidi alınır). `Alt+Tab` sonrası pencere yine kilitlenir. |
| Kayıtlar görünmüyor | Bölüm 5'teki klasörün yazılabilir olduğundan emin ol; antivirüsün klasörü engellemediğini kontrol et. |
| Linux'ta AppImage açılmıyor | `chmod +x` yaptığından emin ol; Wayland'da `--no-sandbox` dene. |
| Kol algılanmıyor | Kolu oyun açıkken tak/çıkar — anında algılanır. Windows'ta Xbox kol sürücüsü güncel olmalı. |
| Bozuk kayıt dosyası | Oyun bozuk slotu yüklerken uyarır ve o slotu yok sayar; `saves` klasöründeki ilgili `.json` dosyasını silip yeniden kaydet. |
| Ayarlar bozuldu / oyun tuhaf davranıyor | `settings.json` dosyasını sil — oyun bir sonraki açılışta güvenli varsayılanlarla başlar (geçersiz değerler zaten otomatik düzeltilir). |
| Ekran görüntüsü alınmıyor | `Pictures/Labirent Protokolu` klasörünün oluşturulabildiğini kontrol et (izinler). |

Sorun devam ederse: `labirent.log` + işletim sistemi sürümü + ekran kartı bilgisi ile bildir.

---

## 9. Kaynaktan derleme

```bash
git clone https://github.com/arreasonn-jpg/MathVerse.git
cd MathVerse
npm install              # Electron + electron-builder (ilk seferde ~200 MB indirir)
npm start                # oyunu geliştirme kipinde açar
npm run dist:win         # Windows: NSIS kurulum + taşınabilir exe
npm run dist:mac         # macOS: dmg (x64 + arm64)
npm run dist:linux       # Linux: AppImage + deb
npm run icons            # build/ ve docs/ simgelerini yeniden üretir
npm run verify           # labirent, masaüstü katmanı ve oyun testleri (tarayıcı + masaüstü kipi)
```

Üretilen paketler `dist/` klasörüne yazılır. Notlar:

- macOS dmg'yi imzalamak için `CSC_LINK` / `CSC_KEY_PASSWORD`, Windows'ta kod imzalama için
  `WIN_CSC_LINK` ortam değişkenleri kullanılır; tanımlı değilse paket imzasız üretilir (uyarı verir).
- `electron-builder` ilk çalıştırmada Electron binary'sini indirir; çevrimdışı bir makinede
  `node_modules` klasörünü kopyalamak gerekir.
- Paket içeriği `package.json → build.files` ile sınırlıdır: yalnızca `app/`, `electron/` ve simgeler.
  `tools/`, `docs/` ve test dosyaları dağıtıma girmez.
