/* =========================================================
   Lector de código de barras (BarcodeDetector nativo)
   Pensado para códigos pequeños: cámara a 1920x1080 + zoom.
   ========================================================= */
(function () {
  'use strict';

  let video = null, stream = null, detector = null, timer = null;
  let active = false, callback = null, lastValue = '';

  const $ = (id) => document.getElementById(id);

  async function open(cb) {
    callback = cb;
    lastValue = '';
    const modal = $('scannerModal');
    const msg = $('scanMsg');
    video = $('scanVideo');
    $('scanManual').value = '';
    modal.hidden = false;
    msg.textContent = 'Iniciando cámara…';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'Este navegador no permite usar la cámara. Usa el ingreso manual.';
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      video.srcObject = stream;
      await video.play();

      // Mejoras para códigos pequeños
      const track = stream.getVideoTracks()[0];
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.zoom && caps.zoom.max) {
          const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, 2));
          await track.applyConstraints({ advanced: [{ zoom: z }] });
        }
      } catch (e) {}
    } catch (err) {
      msg.textContent = 'No se pudo abrir la cámara: ' + (err.message || err.name) +
                        '. Revisa los permisos de Android o usa el ingreso manual.';
      return;
    }

    if (!('BarcodeDetector' in window)) {
      msg.textContent = 'Este navegador no soporta lectura automática. Escribe el código manualmente abajo.';
      $('scanManual').focus();
      return;
    }

    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
                      'code_39', 'code_93', 'itf', 'codabar', 'databar', 'qr_code'];
      const use = wanted.filter((f) => formats.indexOf(f) !== -1);
      detector = use.length
        ? new window.BarcodeDetector({ formats: use })
        : new window.BarcodeDetector();
    } catch (e) {
      msg.textContent = 'No se pudo iniciar el detector. Usa el ingreso manual.';
      return;
    }

    active = true;
    msg.textContent = 'Acerca el código al recuadro.';
    loop();
  }

  async function loop() {
    if (!active || !video) return;
    if (video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length && codes[0].rawValue) {
          handle(codes[0].rawValue);
          return;
        }
      } catch (e) { /* frame no listo */ }
    }
    timer = setTimeout(loop, 160);
  }

  function handle(code) {
    const value = String(code || '').trim();
    if (!value || value === lastValue) return;
    lastValue = value;
    active = false;
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    const cb = callback;
    close();
    if (cb) cb(value);
  }

  function close() {
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      stream = null;
    }
    if (video) { video.srcObject = null; video = null; }
    const modal = $('scannerModal');
    if (modal) modal.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const modal = $('scannerModal');
    if (!modal) return;
    $('scanClose').addEventListener('click', close);
    $('scanManualOk').addEventListener('click', function () {
      const v = $('scanManual').value.trim();
      if (!v) { $('scanManual').focus(); return; }
      handle(v);
    });
    $('scanManual').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('scanManualOk').click();
      }
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
  });

  window.BarcodeScanner = { open: open, close: close };
})();