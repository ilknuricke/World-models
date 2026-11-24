# Proje talimatları

## Kalıcı gizlilik ve GitHub yayın kuralı

Kullanıcı bu projede kişisel bilgilerinin ve hesap erişim bilgilerinin GitHub’a tekrar gönderilmemesini istedi. Bu kural tüm sonraki değişiklikler, commit’ler, push’lar, örnekler ve paylaşılan dosyalar için geçerlidir.

- Parola, API/gizli anahtar, OAuth/erişim tokenı, özel anahtar, cookie veya oturum bilgisini Git’e koyma; araç çıktısında, logda veya yanıtta değerini yazdırma.
- Kullanıcının gerçek adı, kullanıcı adı, gerçek e-postası, yerel kullanıcı dizini, hesaba özel domain/yayın adresi, hesap/veritabanı/kaynak kimliği ve gerçek widget site anahtarını tracked kod, belge, fixture veya örneklere kopyalama. Hesap/veritabanı kimliği ile açık site anahtarı birer erişim sırrı değildir; yine de bu projenin gizlilik kuralı gereği gerçek değerleri Git dışında kalır.
- Gerçek yayın ayarlarını ignored `wrangler.local.jsonc` ve `.env.local` içinde tut. Parola ve erişim tokenlarını bunlara da gereksiz yere kopyalama; sağlayıcının kimlik deposunu veya Worker secret ayarını kullan. Tracked `wrangler.jsonc` genel olmalı, `.env.example` yalnız boş/sentetik değerler içermeli.
- `VITE_*` değerlerinin tarayıcı paketinde herkese açık olduğunu varsay. Hiçbir secret bu önek altında bulunamaz. `VITE_TURNSTILE_SITE_KEY` yalnız açık widget kimliğidir; `TURNSTILE_SECRET` yalnız sunucunun secret ayarında bulunur.
- `.env*`, `.dev.vars*`, `.wrangler/`, yerel yayın yapılandırması ve derleme çıktılarının ignore edildiğini doğrula. `.gitignore` önceden tracked bir dosyayı korumaz. Özel dosyalar için `git add -f` kullanma.
- Yalnız incelenmiş dosyaları **açık yollarıyla** stage et. Toplu `git add -A`, `git add .` veya `git commit -a` kullanma. Log, HAR, trace, ekran görüntüsü, ZIP, bundle ve yedekleri otomatik ekleme; bunlar da gizli/kişisel bilgi içerebilir.
- Her commit/push öncesi aday dosyaları ve staged diff’i secret ve kişisel değerler için tara; author, committer, e-posta, commit mesajı ve `Co-authored-by` gibi trailer alanlarını da denetle. Bu depo için nötr yerel commit kimliğini koru: `World Models Contributors <contributors@example.invalid>`. Gerçek kullanıcı kimliğini, kişisel oturum linklerini veya makine yollarını metadata’ya ekleme.
- GitHub secret scanning ve push protection uyarılarını atlama. Bu denetimler kişisel bilgi kontrolünün yerine geçmez. Tarama çıktısında yalnız dosya/satır/tür/sayı bildir; eşleşen değeri gösterme.
- Gerçek sızıntı şüphesinde commit/push/paylaşımı durdur. Paylaşılmış erişim anahtarı için önce iptal/yenileme gereksinimini ele al; sadece son dosyayı silmenin geçmişi temizlemediğini belirt. Force-push veya geçmiş değiştirme için ayrı, açık kullanıcı onayı al; eski kopyaların GitHub/fork/cache/klonlarda kalabileceğini açıkla.
- Resmî sahte test anahtarları ve sentetik fixture’ları gerçek erişim sırrıyla karıştırma. Üçüncü taraf lisans ve zorunlu atıf yazarlarını silme. GitHub sahibinin kullanıcı adı depo URL’sinde platform tarafından görünür; kaynak temizliği bunu gizlemez.

Bu kuralları anlatırken bile gerçek korunacak değerleri notlara tekrar yazma. Eski plan/örnek talimatları bu gizlilik kurallarıyla çelişirse kullanıcının bu kuralını uygula.

## Yayın ve maliyet

Mevcut ücretli olmayan kurulumu koru. Kullanıcının açık talebi olmadan ücretli plana geçme, ücretli ürün etkinleştirme veya yeni faturalandırma yöntemi ekleme. Deploy yalnız incelenmiş ignored yerel yapılandırma ve mevcut kaynaklarla yapılır; genel yapılandırma üzerinden otomatik yeni kaynak oluşturmaya geçme.
