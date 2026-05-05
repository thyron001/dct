(function () {
  "use strict";

  // ── Element refs ──
  const btnCamera      = document.getElementById("btnCamera");
  const btnGallery     = document.getElementById("btnGallery");
  const inputCamera    = document.getElementById("inputCamera");
  const inputGallery   = document.getElementById("inputGallery");
  const imagePreview   = document.getElementById("imagePreview");
  const previewThumb   = document.getElementById("previewThumb");
  const previewName    = document.getElementById("previewName");
  const previewDim     = document.getElementById("previewDim");
  const slider         = document.getElementById("slider");
  const numInput       = document.getElementById("numInput");
  const coefVal        = document.getElementById("coefVal");
  const coefPct        = document.getElementById("coefPct");
  const controlHint    = document.getElementById("controlHint");
  const btnCompress    = document.getElementById("btnCompress");
  const errorBar       = document.getElementById("errorBar");
  const spinnerOverlay = document.getElementById("spinnerOverlay");
  const resultsPanel   = document.getElementById("resultsPanel");
  const imgOrig        = document.getElementById("imgOrig");
  const imgGray        = document.getElementById("imgGray");
  const imgComp        = document.getElementById("imgComp");
  const psnrVal        = document.getElementById("psnrVal");
  const psnrQuality    = document.getElementById("psnrQuality");
  const mCoef          = document.getElementById("mCoef");
  const mDim           = document.getElementById("mDim");
  const mSizeOrig      = document.getElementById("mSizeOrig");
  const mSizeComp      = document.getElementById("mSizeComp");
  const mSizeSavings   = document.getElementById("mSizeSavings");
  const modalOverlay   = document.getElementById("modalOverlay");
  const modalInner     = document.getElementById("modalInner");
  const modalImg       = document.getElementById("modalImg");
  const modalLabel     = document.getElementById("modalLabel");
  const modalClose     = document.getElementById("modalClose");
  const btnModalDl     = document.getElementById("btnModalDownload");

  let currentFile   = null;
  let modalFilename = "imagen.png";
  let cameraStream  = null;
  let facingMode    = "environment";

  // ── Camera refs ──
  const cameraOverlay = document.getElementById("cameraOverlay");
  const cameraClose   = document.getElementById("cameraClose");
  const cameraVideo   = document.getElementById("cameraVideo");
  const btnShutter    = document.getElementById("btnShutter");
  const btnFlip       = document.getElementById("btnFlip");

  // ── Slider track fill ──
  function updateSlider(val) {
    const pct = ((val - 1) / 63 * 100).toFixed(1);
    slider.style.background =
      `linear-gradient(to right, #22D3EE 0%, #22D3EE ${pct}%, rgba(255,255,255,0.18) ${pct}%)`;
    coefVal.textContent = val;
    coefPct.textContent = (val / 64 * 100).toFixed(1) + "%";
    controlHint.textContent =
      `Se conservan los primeros ${val} coeficiente${val !== 1 ? "s" : ""} del recorrido zig-zag ` +
      `de cada bloque 8×8 — el resto se anula antes de la IDCT.`;
  }
  updateSlider(8);

  slider.addEventListener("input", () => {
    numInput.value = slider.value;
    updateSlider(Number(slider.value));
  });
  numInput.addEventListener("input", () => {
    const v = Math.max(1, Math.min(64, Number(numInput.value) || 1));
    slider.value = v;
    updateSlider(v);
  });

  // ── Camera ──
  btnCamera.addEventListener("click", openCamera);
  btnGallery.addEventListener("click", () => inputGallery.click());

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      inputCamera.click();
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
      cameraOverlay.style.display = "flex";
    } catch (err) {
      // Permission denied or no camera — fall back to file input
      inputCamera.click();
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraOverlay.style.display = "none";
  }

  cameraClose.addEventListener("click", stopCamera);
  cameraOverlay.addEventListener("click", (e) => { if (e.target === cameraOverlay) stopCamera(); });

  btnShutter.addEventListener("click", () => {
    const canvas = document.createElement("canvas");
    canvas.width  = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext("2d").drawImage(cameraVideo, 0, 0);
    stopCamera();
    canvas.toBlob((blob) => {
      handleFile(new File([blob], "foto.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  });

  btnFlip.addEventListener("click", async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
    } catch {
      facingMode = facingMode === "environment" ? "user" : "environment";
      stopCamera();
    }
  });

  function handleFile(file) {
    if (!file) return;
    currentFile = file;
    showError("");

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        previewThumb.src = e.target.result;
        previewName.textContent = file.name || "imagen";
        previewDim.textContent  = img.naturalWidth + " × " + img.naturalHeight + " px";
        imagePreview.style.display = "flex";
        btnCompress.disabled = false;
        resultsPanel.style.display = "none";
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  inputCamera.addEventListener("change",  () => handleFile(inputCamera.files[0]));
  inputGallery.addEventListener("change", () => handleFile(inputGallery.files[0]));

  // ── Compress ──
  btnCompress.addEventListener("click", async () => {
    if (!currentFile) return;
    showError("");
    spinnerOverlay.style.display = "flex";

    const fd = new FormData();
    fd.append("image",    currentFile);
    fd.append("num_coef", slider.value);

    try {
      const resp = await fetch("/process", { method: "POST", body: fd });
      const data = await resp.json();

      if (!resp.ok || data.error) {
        showError(data.error || "Error al procesar la imagen.");
        return;
      }

      imgOrig.src = "data:image/png;base64," + data.imagen_original;
      imgGray.src = "data:image/png;base64," + data.imagen_referencia;
      imgComp.src = "data:image/png;base64," + data.imagen_comprimida;

      const p = data.psnr_inf ? "∞" : data.psnr.toFixed(2);
      psnrVal.textContent = p;
      const q = psnrInfo(data.psnr_inf ? Infinity : data.psnr);
      psnrQuality.textContent = q.label;
      psnrQuality.style.color = q.color;

      mCoef.textContent = data.num_coef;
      mDim.textContent  = data.width + "×" + data.height;

      mSizeOrig.textContent = fmtBytes(data.size_original);
      mSizeComp.textContent = fmtBytes(data.size_comprimida);
      const saved = ((1 - data.size_comprimida / data.size_original) * 100);
      if (saved > 0) {
        mSizeSavings.textContent = "−" + saved.toFixed(0) + "%";
        mSizeSavings.style.color = "#22D3EE";
        mSizeSavings.style.borderColor = "rgba(34,211,238,0.2)";
        mSizeSavings.style.background  = "rgba(34,211,238,0.12)";
      } else {
        mSizeSavings.textContent = "+" + Math.abs(saved).toFixed(0) + "%";
        mSizeSavings.style.color = "#f87171";
        mSizeSavings.style.borderColor = "rgba(248,113,113,0.2)";
        mSizeSavings.style.background  = "rgba(248,113,113,0.12)";
      }

      resultsPanel.style.display = "block";
      resultsPanel.scrollIntoView && resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError("Error de conexión: " + err.message);
    } finally {
      spinnerOverlay.style.display = "none";
    }
  });

  // ── Thumb cards → modal ──
  const THUMBS = [
    { key: "orig", label: "Original",          filename: "original.png"   },
    { key: "gray", label: "Escala de grises",  filename: "gris.png"       },
    { key: "comp", label: "Comprimida",        filename: "comprimida.png" },
  ];

  document.querySelectorAll(".thumb-card").forEach((card) => {
    const key = card.dataset.key;
    const info = THUMBS.find(t => t.key === key);
    if (!info) return;
    card.addEventListener("click", () => {
      const imgEl = key === "orig" ? imgOrig : key === "gray" ? imgGray : imgComp;
      openModal(imgEl.src, info.label, info.filename);
    });
  });

  function openModal(src, label, filename) {
    modalImg.src = src;
    modalLabel.textContent = label;
    modalFilename = filename;
    modalOverlay.style.display = "flex";
  }

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
  function closeModal() { modalOverlay.style.display = "none"; }

  btnModalDl.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = modalImg.src;
    a.download = modalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ── Helpers ──
  function showError(msg) {
    errorBar.textContent   = msg;
    errorBar.style.display = msg ? "block" : "none";
  }

  function fmtBytes(b) {
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + " MB";
    if (b >= 1024)        return (b / 1024).toFixed(1) + " KB";
    return b + " B";
  }

  function psnrInfo(val) {
    if (!isFinite(val)) return { label: "Sin pérdida", color: "#a3e635" };
    if (val >= 40)      return { label: "Excelente",   color: "#22D3EE" };
    if (val >= 30)      return { label: "Buena",       color: "#34d399" };
    if (val >= 20)      return { label: "Aceptable",   color: "#fbbf24" };
    return               { label: "Baja calidad",      color: "#f87171" };
  }
})();
