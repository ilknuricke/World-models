/**
 * Code, data and font credits (ARCHITECTURE §15). Mirrored in CREDITS.md (tests/features/credits.test.ts checks
 * the mirror). Copyright lines are copied from each package's LICENSE file.
 */

export interface CodeCredit {
  readonly name: string;
  /** What we use it for. */
  readonly use: string;
  readonly license: string;
  readonly copyright: string;
  readonly url: string;
}

/** Licence texts we must reproduce, keyed by CodeCredit.license. */
export const LICENSE_TEXTS: Readonly<Record<string, string>> = {
  'BSD-3-Clause': `Copyright (c) 2016, Project Chrono Development Team
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

 - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 - Neither the name of the nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
};

/** Apache License 2.0, full text (stdlib-js; Apache-2.0 §4(a) asks for a copy with the work). */
export const APACHE_2_0 = "\n                                 Apache License\n                           Version 2.0, January 2004\n                        http://www.apache.org/licenses/\n\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n\n   1. Definitions.\n\n      \"License\" shall mean the terms and conditions for use, reproduction,\n      and distribution as defined by Sections 1 through 9 of this document.\n\n      \"Licensor\" shall mean the copyright owner or entity authorized by\n      the copyright owner that is granting the License.\n\n      \"Legal Entity\" shall mean the union of the acting entity and all\n      other entities that control, are controlled by, or are under common\n      control with that entity. For the purposes of this definition,\n      \"control\" means (i) the power, direct or indirect, to cause the\n      direction or management of such entity, whether by contract or\n      otherwise, or (ii) ownership of fifty percent (50%) or more of the\n      outstanding shares, or (iii) beneficial ownership of such entity.\n\n      \"You\" (or \"Your\") shall mean an individual or Legal Entity\n      exercising permissions granted by this License.\n\n      \"Source\" form shall mean the preferred form for making modifications,\n      including but not limited to software source code, documentation\n      source, and configuration files.\n\n      \"Object\" form shall mean any form resulting from mechanical\n      transformation or translation of a Source form, including but\n      not limited to compiled object code, generated documentation,\n      and conversions to other media types.\n\n      \"Work\" shall mean the work of authorship, whether in Source or\n      Object form, made available under the License, as indicated by a\n      copyright notice that is included in or attached to the work\n      (an example is provided in the Appendix below).\n\n      \"Derivative Works\" shall mean any work, whether in Source or Object\n      form, that is based on (or derived from) the Work and for which the\n      editorial revisions, annotations, elaborations, or other modifications\n      represent, as a whole, an original work of authorship. For the purposes\n      of this License, Derivative Works shall not include works that remain\n      separable from, or merely link (or bind by name) to the interfaces of,\n      the Work and Derivative Works thereof.\n\n      \"Contribution\" shall mean any work of authorship, including\n      the original version of the Work and any modifications or additions\n      to that Work or Derivative Works thereof, that is intentionally\n      submitted to Licensor for inclusion in the Work by the copyright owner\n      or by an individual or Legal Entity authorized to submit on behalf of\n      the copyright owner. For the purposes of this definition, \"submitted\"\n      means any form of electronic, verbal, or written communication sent\n      to the Licensor or its representatives, including but not limited to\n      communication on electronic mailing lists, source code control systems,\n      and issue tracking systems that are managed by, or on behalf of, the\n      Licensor for the purpose of discussing and improving the Work, but\n      excluding communication that is conspicuously marked or otherwise\n      designated in writing by the copyright owner as \"Not a Contribution.\"\n\n      \"Contributor\" shall mean Licensor and any individual or Legal Entity\n      on behalf of whom a Contribution has been received by Licensor and\n      subsequently incorporated within the Work.\n\n   2. Grant of Copyright License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      copyright license to reproduce, prepare Derivative Works of,\n      publicly display, publicly perform, sublicense, and distribute the\n      Work and such Derivative Works in Source or Object form.\n\n   3. Grant of Patent License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      (except as stated in this section) patent license to make, have made,\n      use, offer to sell, sell, import, and otherwise transfer the Work,\n      where such license applies only to those patent claims licensable\n      by such Contributor that are necessarily infringed by their\n      Contribution(s) alone or by combination of their Contribution(s)\n      with the Work to which such Contribution(s) was submitted. If You\n      institute patent litigation against any entity (including a\n      cross-claim or counterclaim in a lawsuit) alleging that the Work\n      or a Contribution incorporated within the Work constitutes direct\n      or contributory patent infringement, then any patent licenses\n      granted to You under this License for that Work shall terminate\n      as of the date such litigation is filed.\n\n   4. Redistribution. You may reproduce and distribute copies of the\n      Work or Derivative Works thereof in any medium, with or without\n      modifications, and in Source or Object form, provided that You\n      meet the following conditions:\n\n      (a) You must give any other recipients of the Work or\n          Derivative Works a copy of this License; and\n\n      (b) You must cause any modified files to carry prominent notices\n          stating that You changed the files; and\n\n      (c) You must retain, in the Source form of any Derivative Works\n          that You distribute, all copyright, patent, trademark, and\n          attribution notices from the Source form of the Work,\n          excluding those notices that do not pertain to any part of\n          the Derivative Works; and\n\n      (d) If the Work includes a \"NOTICE\" text file as part of its\n          distribution, then any Derivative Works that You distribute must\n          include a readable copy of the attribution notices contained\n          within such NOTICE file, excluding those notices that do not\n          pertain to any part of the Derivative Works, in at least one\n          of the following places: within a NOTICE text file distributed\n          as part of the Derivative Works; within the Source form or\n          documentation, if provided along with the Derivative Works; or,\n          within a display generated by the Derivative Works, if and\n          wherever such third-party notices normally appear. The contents\n          of the NOTICE file are for informational purposes only and\n          do not modify the License. You may add Your own attribution\n          notices within Derivative Works that You distribute, alongside\n          or as an addendum to the NOTICE text from the Work, provided\n          that such additional attribution notices cannot be construed\n          as modifying the License.\n\n      You may add Your own copyright statement to Your modifications and\n      may provide additional or different license terms and conditions\n      for use, reproduction, or distribution of Your modifications, or\n      for any such Derivative Works as a whole, provided Your use,\n      reproduction, and distribution of the Work otherwise complies with\n      the conditions stated in this License.\n\n   5. Submission of Contributions. Unless You explicitly state otherwise,\n      any Contribution intentionally submitted for inclusion in the Work\n      by You to the Licensor shall be under the terms and conditions of\n      this License, without any additional terms or conditions.\n      Notwithstanding the above, nothing herein shall supersede or modify\n      the terms of any separate license agreement you may have executed\n      with Licensor regarding such Contributions.\n\n   6. Trademarks. This License does not grant permission to use the trade\n      names, trademarks, service marks, or product names of the Licensor,\n      except as required for reasonable and customary use in describing the\n      origin of the Work and reproducing the content of the NOTICE file.\n\n   7. Disclaimer of Warranty. Unless required by applicable law or\n      agreed to in writing, Licensor provides the Work (and each\n      Contributor provides its Contributions) on an \"AS IS\" BASIS,\n      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or\n      implied, including, without limitation, any warranties or conditions\n      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A\n      PARTICULAR PURPOSE. You are solely responsible for determining the\n      appropriateness of using or redistributing the Work and assume any\n      risks associated with Your exercise of permissions under this License.\n\n   8. Limitation of Liability. In no event and under no legal theory,\n      whether in tort (including negligence), contract, or otherwise,\n      unless required by applicable law (such as deliberate and grossly\n      negligent acts) or agreed to in writing, shall any Contributor be\n      liable to You for damages, including any direct, indirect, special,\n      incidental, or consequential damages of any character arising as a\n      result of this License or out of the use or inability to use the\n      Work (including but not limited to damages for loss of goodwill,\n      work stoppage, computer failure or malfunction, or any and all\n      other commercial damages or losses), even if such Contributor\n      has been advised of the possibility of such damages.\n\n   9. Accepting Warranty or Additional Liability. While redistributing\n      the Work or Derivative Works thereof, You may choose to offer,\n      and charge a fee for, acceptance of support, warranty, indemnity,\n      or other liability obligations and/or rights consistent with this\n      License. However, in accepting such obligations, You may act only\n      on Your own behalf and on Your sole responsibility, not on behalf\n      of any other Contributor, and only if You agree to indemnify,\n      defend, and hold each Contributor harmless for any liability\n      incurred by, or claims asserted against, such Contributor by reason\n      of your accepting any such warranty or additional liability.\n\n   END OF TERMS AND CONDITIONS";

/** stdlib-js NOTICE (Apache-2.0 §4(d)) and the changes made here (§4(b)). */
export const STDLIB_NOTICE = "Copyright (c) 2016-2026 The Stdlib Authors.\n\n(NOTICE file of each @stdlib/math-base-special-* package used: kernel-sin 0.2.4, kernel-cos 0.2.4, kernel-tan 0.2.4,\nrempio2 0.3.1, ln 0.2.5, exp 0.2.5, expm1 0.2.4, pow 0.3.1. Source file headers: Copyright (c) 2018 The Stdlib Authors.)\n\nChanges made in Suspension Lab: the kernels were translated from JavaScript into TypeScript and merged into one module\n(src/sim-core/math/det.ts); kernelSin/kernelCos use the original fdlibm 5.3 k_sin.c/k_cos.c evaluation order; the pow\ncore omits stdlib's y = 3/4 shortcuts; expm1 runs through a scratch slot; dsincos returns sin and cos together.";

/** "DEPENDENCIES & ATTRIBUTION" of the stdlib-js LICENSE files used (exp 0.2.5 + expm1 0.2.4), verbatim. */
export const STDLIB_ATTRIBUTION = "DEPENDENCIES & ATTRIBUTION\n\nThe library links against the following external libraries or contains\nimplementations from the following external libraries, which have their own\nlicenses:\n\n* FreeBSD <https://svnweb.freebsd.org/>\n\nCopyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.\n\nDeveloped at SunPro, a Sun Microsystems, Inc. business.\nPermission to use, copy, modify, and distribute this\nsoftware is freely granted, provided that this notice\nis preserved.\n\n* FDLIBM <http://www.netlib.org/fdlibm/>\n\nCopyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.\n\nDeveloped at SunPro, a Sun Microsystems, Inc. business.\nPermission to use, copy, modify, and distribute this\nsoftware is freely granted, provided that this notice\nis preserved.\n\n* Go <https://raw.githubusercontent.com/golang/go/master/LICENSE>\n\nCopyright (c) 2009 The Go Authors. All rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are\nmet:\n\n   * Redistributions of source code must retain the above copyright\nnotice, this list of conditions and the following disclaimer.\n   * Redistributions in binary form must reproduce the above\ncopyright notice, this list of conditions and the following disclaimer\nin the documentation and/or other materials provided with the\ndistribution.\n   * Neither the name of Google Inc. nor the names of its\ncontributors may be used to endorse or promote products derived from\nthis software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS\n\"AS IS\" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT\nLIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR\nA PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT\nOWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,\nSPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT\nLIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,\nDATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY\nTHEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.";

/** The fdlibm notice of the FreeBSD msun files ported directly (s_atan.c, e_atan2.c, e_asin.c, e_acos.c, s_tanh.c). */
export const MSUN_NOTICE = "Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.\n\nDeveloped at SunPro, a Sun Microsystems, Inc. business.\nPermission to use, copy, modify, and distribute this\nsoftware is freely granted, provided that this notice\nis preserved.";

/** Every notice reproduced in full, in panel order (CREDITS.md carries each one; tests/features/credits.test.ts). */
export const LICENSE_NOTICES: readonly { readonly title: string; readonly text: string }[] = [
  { title: 'Project Chrono (BSD-3-Clause):', text: LICENSE_TEXTS['BSD-3-Clause']! },
  { title: 'MIT işaretli tüm girdiler için MIT lisansı; telif bilgileri yukarıda verilmiştir:', text: LICENSE_TEXTS.MIT! },
  { title: 'stdlib-js (Apache-2.0) NOTICE bildirimi ve burada yapılan değişiklikler:', text: STDLIB_NOTICE },
  { title: 'stdlib-js bağımlılıkları ve atıfları (FreeBSD ve FDLIBM, Sun Microsystems üzerinden fdlibm; Go, BSD-3-Clause):', text: STDLIB_ATTRIBUTION },
  { title: 'datan, datan2, dasin, dacos, dtanh için doğrudan uyarlanan FreeBSD msun (fdlibm):', text: MSUN_NOTICE },
  { title: 'Apache Lisansı 2.0 (stdlib-js):', text: APACHE_2_0 },
];

export const CODE_CREDITS: readonly CodeCredit[] = [
  {
    name: 'Project Chrono',
    use: 'Başlangıç süspansiyon bağlantı noktaları ve mafsal yapısı (yeniden ölçeklendi); ChPac02Tire kaynaklı lastik eğrisi ve temas alanı deformasyon biçimi (yalnızca fikirler)',
    license: 'BSD-3-Clause',
    copyright: 'Copyright (c) 2016, Project Chrono Development Team',
    url: 'https://github.com/projectchrono/chrono',
  },
  {
    name: 'AxleLab',
    use: 'Boru yerleşimi, körük profili ve parça paleti için uyarlanan yardımcı fikirler',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 KRoshanK',
    url: 'https://github.com/KRoshanK/AxleLab',
  },
  {
    name: 'stdlib-js',
    use: 'Deterministik sin, cos, tan, argüman indirgeme, ln, exp, expm1 ve pow çekirdekleri (uyarlandı; aşağıdaki NOTICE ve değişikliklere bakın)',
    license: 'Apache-2.0',
    copyright: 'Copyright (c) 2016-2026 The Stdlib Authors',
    url: 'https://github.com/stdlib-js/stdlib',
  },
  {
    name: 'Go math (exp)',
    use: 'stdlib-js üzerinden exp çekirdeği',
    license: 'BSD-3-Clause',
    copyright: 'Copyright (c) 2009 The Go Authors. All rights reserved',
    url: 'https://github.com/golang/go',
  },
  {
    name: 'fdlibm (FreeBSD msun)',
    use: 'Uyarlanan atan, atan2, asin, acos ve tanh çekirdekleri; stdlib-js üzerinden sin, cos, tan, ln, exp ve pow çekirdekleri',
    license: 'fdlibm notice',
    copyright: 'Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved',
    url: 'https://svnweb.freebsd.org/base/head/lib/msun/',
  },
  {
    name: 'Jolt Physics',
    use: 'Vites değiştirme durum makinesi ve sınırlı kaymalı diferansiyel formülü (yalnızca fikirler; kod kopyalanmadı)',
    license: 'MIT',
    copyright: 'Copyright 2021 Jorrit Rouwe',
    url: 'https://github.com/jrouwe/JoltPhysics',
  },
  {
    name: 'Godot-Easy-Vehicle-Physics',
    use: 'Kilitlenme önleyici fren azaltma, patinajda güç kesme ve kontra direksiyon desteği (yalnızca fikirler; kod kopyalanmadı)',
    license: 'MIT',
    copyright: 'Copyright (c) 2024 David Shoemaker; Copyright (c) 2021 Dechode; Copyright (c) 2024 Baron Wittman',
    url: 'https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics',
  },
  {
    name: 'ArcadeCarPhysics',
    use: 'Hıza göre sınırlanan klavye direksiyonu (yalnızca fikir; kod kopyalanmadı)',
    license: 'MIT',
    copyright: 'Copyright (c) 2018 Sergey Makeev',
    url: 'https://github.com/SergeyMakeev/ArcadeCarPhysics',
  },
  {
    name: 'PythonRobotics',
    use: 'Otomatik sürüşte Stanley ve pure-pursuit yol izleyicilerinin yapısı (yeniden uygulandı; kod kopyalanmadı)',
    license: 'MIT',
    copyright: 'Copyright (c) 2016 - now Atsushi Sakai and other contributors',
    url: 'https://github.com/AtsushiSakai/PythonRobotics',
  },
  {
    name: 'folio-2025',
    use: 'Lastik izi şeritleri için halka tampon düzeni (Tracks.js; yeniden ifade edildi, kod kopyalanmadı)',
    license: 'MIT',
    copyright: 'Copyright (c) 2025 Bruno Simon',
    url: 'https://github.com/brunosimon/folio-2025',
  },
  {
    name: 'V8',
    use: 'Node ve tarayıcıların aynı sonucu vermesi için kesin işlemlerle yeniden ifade edilen Math.hypot algoritması (yalnızca fikir)',
    license: 'BSD-3-Clause',
    copyright: 'Copyright 2014, the V8 project authors. All rights reserved',
    url: 'https://github.com/v8/v8',
  },
  {
    name: '1€ Filter (Casiez, Roussel, Vogel, CHI 2012)',
    use: 'Telefon eğimiyle direksiyonun yumuşatılması (yayımlanan algoritmadan yazıldı)',
    license: 'Published algorithm',
    copyright: 'Géry Casiez, Nicolas Roussel, Daniel Vogel',
    url: 'https://gery.casiez.net/1euro/',
  },
  { name: 'three.js', use: 'Görüntü oluşturma', license: 'MIT', copyright: 'Copyright © 2010-2026 three.js authors', url: 'https://github.com/mrdoob/three.js' },
  { name: 'meshoptimizer decoder', use: 'Üç boyutlu model sıkıştırmasını açma (three.js eklentileri üzerinden)', license: 'MIT', copyright: 'Copyright (C) 2016-2026, by Arseny Kapoulkine', url: 'https://github.com/zeux/meshoptimizer' },
  { name: 'postprocessing', use: 'Son işleme efektleri', license: 'Zlib', copyright: 'Copyright © 2015 Raoul van Rüschen', url: 'https://github.com/pmndrs/postprocessing' },
  { name: 'n8ao', use: 'Ortam gölgelemesi', license: 'ISC', copyright: 'N8python (package licence ISC; repository LICENSE file CC0 1.0)', url: 'https://github.com/N8python/n8ao' },
  { name: 'camera-controls', use: 'Yörünge kamerası', license: 'MIT', copyright: 'Copyright (c) 2017 @yomotsu', url: 'https://github.com/yomotsu/camera-controls' },
  { name: 'nanostores', use: 'Uygulama durumu', license: 'MIT', copyright: 'Copyright 2020 Andrey Sitnik', url: 'https://github.com/nanostores/nanostores' },
  { name: 'mitt', use: 'Olaylar', license: 'MIT', copyright: 'Copyright (c) 2021 Jason Miller', url: 'https://github.com/developit/mitt' },
  { name: 'Hono', use: 'Edge API', license: 'MIT', copyright: 'Copyright (c) 2021 - present, Yusuke Wada and Hono contributors', url: 'https://github.com/honojs/hono' },
  { name: 'Zod', use: 'Doğrulama', license: 'MIT', copyright: 'Copyright (c) 2025 Colin McDonnell', url: 'https://github.com/colinhacks/zod' },
  { name: 'PartySocket', use: 'Canlı oda bağlantısı', license: 'MIT', copyright: 'Copyright (c) 2010-2012, Joe Walnes', url: 'https://github.com/partykit/partykit' },
  { name: 'uqr', use: 'QR kodları', license: 'MIT', copyright: 'Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu', url: 'https://github.com/unjs/uqr' },
  { name: 'stats-gl', use: 'Hata ayıklama istatistikleri', license: 'MIT', copyright: 'Renaud Rohlinger', url: 'https://github.com/RenaudRohlinger/stats-gl' },
  {
    name: 'Geist Sans and Geist Mono',
    use: 'Yazı tipleri (Fontsource üzerinden yerel olarak barındırılır)',
    license: 'OFL-1.1',
    copyright: '(C) 2023 Vercel, made in collaboration with basement.studio',
    url: 'https://github.com/vercel/geist-font',
  },
];
