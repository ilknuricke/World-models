# Katkıda bulunanlar

Süspansiyon Laboratuvarı, başkalarının çalışmalarından yararlanır. Bu dosya uygulamadaki katkılar panelini yansıtır (ARCHITECTURE §15).
Görsel ve ses kaynaklarının atıfları `assets-src/ATTRIBUTION.json` dosyasından derleme sırasında kaynak bildirimine kopyalanır.
Kod ve veri katkıları `src/features/credits/code-credits.ts` dosyasındadır. `tests/features/credits.test.ts` bu dosyanın ikisini de kapsadığını denetler.

Araç modelleri yalnızca biçimleri için kullanılır; üretici verilerini temsil etmez. Araç parametreleri örnek niteliğindedir.
Lisansların ve telif bildirimlerinin özgün metinleri korunmuştur.

## Görsel ve ses kaynakları

### Araç gövde modeli — CC BY 4.0

"Aston Martin db11" — Black Snow (https://sketchfab.com/BlackSnow02). CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/) koşullarıyla lisanslanmıştır. Kaynak: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Değişiklikler: optimize edildi ve sıkıştırıldı (meshopt), çokgen sayısı azaltıldı, malzemeler yenilendi, logolar gizlendi.

### Motosiklet sürücüsü — Microsoft Rocketbox, MIT

"Microsoft Rocketbox — Male Adult 04" — Microsoft Research / Rocketbox Studios; GLB dönüşümü: Tanmay (927tanmay). [Özgün model](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Adults/Male_Adult_04), [MIT lisansı](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md).
Kullanılan [GLB dönüşümü](https://github.com/927tanmay/react-ai-voice-avatar/blob/main/assets/avatars/aarav.glb), Tanmay'ın [dönüştürme betiğiyle](https://github.com/927tanmay/react-ai-voice-avatar/blob/main/scripts/convert-rocketbox.py) hazırlanmıştır; [kaynak bildirimi](https://github.com/927tanmay/react-ai-voice-avatar/blob/main/assets/avatars/LICENSE.md).
Kemikler yeniden adlandırıldı; yüz ifadeleri ve dokular paketlendi. Uygulamada motosiklet üzerinde oturma pozu verildi ve model meshopt ile sıkıştırıldı. Özgün telif ve izin bildirimleri aşağıda ve modelle birlikte dağıtılan `rider/ROCKETBOX-LICENSE.txt`, `rider/CONVERSION-LICENSE.txt` ve `rider/CONVERSION-NOTICE.md` dosyalarında korunur.

### HDRI ortamları — Poly Haven, CC0 1.0 (teşekkürle anılır)

- "Derelict Airfield 01" by Alexander Scholten — https://polyhaven.com/a/derelict_airfield_01
- "Evening Road 01" by Sergej Majboroda — https://polyhaven.com/a/evening_road_01
- "Ferndale Studio 03" by Dimitrios Savva, Greg Zaal — https://polyhaven.com/a/ferndale_studio_03

### Dokular — Poly Haven, CC0 1.0 (teşekkürle anılır)

- "Asphalt Track" by Dimitrios Savva — https://polyhaven.com/a/asphalt_track
- "Cobblestone Floor 08" by Rob Tuytel — https://polyhaven.com/a/cobblestone_floor_08
- "Concrete Floor 01" by Rob Tuytel — https://polyhaven.com/a/concrete_floor_01
- "Grass Ground" by Charlotte Baglioni — https://polyhaven.com/a/grass_ground

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

### Sesler — CC0 1.0

- "Starter Kit Racing sounds (engine, motorcycle engine, impact)" by Kenney (https://kenney.nl) —
  https://github.com/KenneyNL/Starter-Kit-Racing/tree/main/audio
- "Skid sound (Starter Kit Racing)" by Landeplage (https://github.com/Landeplage) —
  https://github.com/KenneyNL/Starter-Kit-Racing/tree/main/audio

## Kod, veri ve yazı tipleri

| Ad | Kullanım | Lisans | Telif hakkı |
|---|---|---|---|
| [Project Chrono](https://github.com/projectchrono/chrono) | Başlangıç süspansiyon bağlantı noktaları ve mafsal yapısı (yeniden ölçeklendi); ChPac02Tire kaynaklı lastik eğrisi ve temas alanı deformasyon biçimi (yalnızca fikirler) | BSD-3-Clause | Copyright (c) 2016, Project Chrono Development Team |
| [AxleLab](https://github.com/KRoshanK/AxleLab) | Boru yerleşimi, körük profili ve parça paleti için uyarlanan yardımcı fikirler | MIT | Copyright (c) 2026 KRoshanK |
| [stdlib-js](https://github.com/stdlib-js/stdlib) | Deterministik sin, cos, tan, argüman indirgeme, ln, exp, expm1 ve pow çekirdekleri (uyarlandı; aşağıdaki NOTICE ve değişikliklere bakın) | Apache-2.0 | Copyright (c) 2016-2026 The Stdlib Authors |
| [Go math (exp)](https://github.com/golang/go) | stdlib-js üzerinden exp çekirdeği | BSD-3-Clause | Copyright (c) 2009 The Go Authors. All rights reserved |
| [fdlibm (FreeBSD msun)](https://svnweb.freebsd.org/base/head/lib/msun/) | Uyarlanan atan, atan2, asin, acos ve tanh çekirdekleri; stdlib-js üzerinden sin, cos, tan, ln, exp ve pow çekirdekleri | fdlibm notice | Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved |
| [Jolt Physics](https://github.com/jrouwe/JoltPhysics) | Vites değiştirme durum makinesi ve sınırlı kaymalı diferansiyel formülü (yalnızca fikirler; kod kopyalanmadı) | MIT | Copyright 2021 Jorrit Rouwe |
| [Godot-Easy-Vehicle-Physics](https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics) | Kilitlenme önleyici fren azaltma, patinajda güç kesme ve kontra direksiyon desteği (yalnızca fikirler; kod kopyalanmadı) | MIT | Copyright (c) 2024 David Shoemaker; Copyright (c) 2021 Dechode; Copyright (c) 2024 Baron Wittman |
| [ArcadeCarPhysics](https://github.com/SergeyMakeev/ArcadeCarPhysics) | Hıza göre sınırlanan klavye direksiyonu (yalnızca fikir; kod kopyalanmadı) | MIT | Copyright (c) 2018 Sergey Makeev |
| [PythonRobotics](https://github.com/AtsushiSakai/PythonRobotics) | Otomatik sürüşte Stanley ve pure-pursuit yol izleyicilerinin yapısı (yeniden uygulandı; kod kopyalanmadı) | MIT | Copyright (c) 2016 - now Atsushi Sakai and other contributors |
| [folio-2025](https://github.com/brunosimon/folio-2025) | Lastik izi şeritleri için halka tampon düzeni (Tracks.js; yeniden ifade edildi, kod kopyalanmadı) | MIT | Copyright (c) 2025 Bruno Simon |
| [V8](https://github.com/v8/v8) | Node ve tarayıcıların aynı sonucu vermesi için kesin işlemlerle yeniden ifade edilen Math.hypot algoritması (yalnızca fikir) | BSD-3-Clause | Copyright 2014, the V8 project authors. All rights reserved |
| [1€ Filter (Casiez, Roussel, Vogel, CHI 2012)](https://gery.casiez.net/1euro/) | Telefon eğimiyle direksiyonun yumuşatılması (yayımlanan algoritmadan yazıldı) | Published algorithm | Géry Casiez, Nicolas Roussel, Daniel Vogel |
| [three.js](https://github.com/mrdoob/three.js) | Görüntü oluşturma | MIT | Copyright © 2010-2026 three.js authors |
| [meshoptimizer decoder](https://github.com/zeux/meshoptimizer) | Üç boyutlu model sıkıştırmasını açma (three.js eklentileri üzerinden) | MIT | Copyright (C) 2016-2026, by Arseny Kapoulkine |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Son işleme efektleri | Zlib | Copyright © 2015 Raoul van Rüschen |
| [n8ao](https://github.com/N8python/n8ao) | Ortam gölgelemesi | ISC | N8python (package licence ISC; repository LICENSE file CC0 1.0) |
| [camera-controls](https://github.com/yomotsu/camera-controls) | Yörünge kamerası | MIT | Copyright (c) 2017 @yomotsu |
| [nanostores](https://github.com/nanostores/nanostores) | Uygulama durumu | MIT | Copyright 2020 Andrey Sitnik |
| [mitt](https://github.com/developit/mitt) | Olaylar | MIT | Copyright (c) 2021 Jason Miller |
| [Hono](https://github.com/honojs/hono) | Edge API | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors |
| [Zod](https://github.com/colinhacks/zod) | Doğrulama | MIT | Copyright (c) 2025 Colin McDonnell |
| [PartySocket](https://github.com/partykit/partykit) | Canlı oda bağlantısı | MIT | Copyright (c) 2010-2012, Joe Walnes |
| [uqr](https://github.com/unjs/uqr) | QR kodları | MIT | Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu |
| [stats-gl](https://github.com/RenaudRohlinger/stats-gl) | Hata ayıklama istatistikleri | MIT | Renaud Rohlinger |
| [Geist Sans and Geist Mono](https://github.com/vercel/geist-font) | Yazı tipleri (Fontsource üzerinden yerel olarak barındırılır) | OFL-1.1 | (C) 2023 Vercel, made in collaboration with basement.studio |

Geist fonts: SIL Open Font License 1.1 (https://openfontlicense.org). postprocessing: zlib licence.
n8ao: ISC licence.

Entries marked "ideas only", "re-implemented", "re-expressed" or "written from the published algorithm" contributed
structure or formulas, not copied code; they are credited all the same. The stdlib-js kernels are translated code: the
Apache License 2.0, the stdlib NOTICE, the list of changes and the fdlibm (Sun Microsystems) and Go notices they carry
are reproduced below and in the in-app credits panel; `src/sim-core/math/det.ts` keeps them in its header.
Licence texts re-checked 2026-11-21 for milestone 2: the stdlib-js npm tarballs (LICENSE, NOTICE) and the LICENSE files
of Jolt Physics, Godot-Easy-Vehicle-Physics, ArcadeCarPhysics, PythonRobotics, folio-2025, V8, Go and Project Chrono.

## Licence notices

### Project Chrono (BSD-3-Clause)

The suspension hardpoint sets in `src/sim-core/content/susp-*.ts` start from Project Chrono data (rescaled).

```
Copyright (c) 2016, Project Chrono Development Team
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

 - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 - Neither the name of the nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### MIT licence

Applies to every entry marked MIT above, each with its own copyright line.

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### stdlib-js (Apache-2.0) NOTICE, and what was changed here

```
Copyright (c) 2016-2026 The Stdlib Authors.

(NOTICE file of each @stdlib/math-base-special-* package used: kernel-sin 0.2.4, kernel-cos 0.2.4, kernel-tan 0.2.4,
rempio2 0.3.1, ln 0.2.5, exp 0.2.5, expm1 0.2.4, pow 0.3.1. Source file headers: Copyright (c) 2018 The Stdlib Authors.)

Changes made in Suspension Lab: the kernels were translated from JavaScript into TypeScript and merged into one module
(src/sim-core/math/det.ts); kernelSin/kernelCos use the original fdlibm 5.3 k_sin.c/k_cos.c evaluation order; the pow
core omits stdlib's y = 3/4 shortcuts; expm1 runs through a scratch slot; dsincos returns sin and cos together.
```

### stdlib-js dependencies and attribution (fdlibm via FreeBSD and FDLIBM, Sun Microsystems; Go, BSD-3-Clause)

```
DEPENDENCIES & ATTRIBUTION

The library links against the following external libraries or contains
implementations from the following external libraries, which have their own
licenses:

* FreeBSD <https://svnweb.freebsd.org/>

Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.

Developed at SunPro, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.

* FDLIBM <http://www.netlib.org/fdlibm/>

Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.

Developed at SunPro, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.

* Go <https://raw.githubusercontent.com/golang/go/master/LICENSE>

Copyright (c) 2009 The Go Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### FreeBSD msun (fdlibm), ported directly for datan, datan2, dasin, dacos, dtanh

```
Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

Developed at SunPro, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
```

### Apache License 2.0 (stdlib-js)

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### Microsoft Rocketbox (MIT)

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Rocketbox GLB dönüşümü (MIT)

```
MIT License

Copyright (c) 2026 Tanmay (927tanmay) and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
