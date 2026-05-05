(function () {
  "use strict";

  // ── Referencias a elementos del DOM ──
  const btnCamera      = document.getElementById("btnCamera");       // Botón para abrir la cámara
  const btnGallery     = document.getElementById("btnGallery");      // Botón para cargar desde galería
  const inputCamera    = document.getElementById("inputCamera");     // Input de archivo con captura de cámara
  const inputGallery   = document.getElementById("inputGallery");    // Input de archivo normal
  const imagePreview   = document.getElementById("imagePreview");    // Contenedor de vista previa
  const previewThumb   = document.getElementById("previewThumb");    // Miniatura de la imagen cargada
  const previewName    = document.getElementById("previewName");     // Nombre del archivo
  const previewDim     = document.getElementById("previewDim");      // Dimensiones de la imagen
  const slider         = document.getElementById("slider");          // Slider de coeficientes DCT
  const numInput       = document.getElementById("numInput");        // Campo numérico de coeficientes
  const coefVal        = document.getElementById("coefVal");         // Número de coeficientes mostrado
  const coefPct        = document.getElementById("coefPct");         // Porcentaje de coeficientes
  const controlHint    = document.getElementById("controlHint");     // Texto descriptivo del slider
  const btnCompress    = document.getElementById("btnCompress");     // Botón de compresión
  const errorBar       = document.getElementById("errorBar");        // Barra de mensajes de error
  const spinnerOverlay = document.getElementById("spinnerOverlay");  // Pantalla de carga
  const resultsPanel   = document.getElementById("resultsPanel");    // Panel de resultados
  const imgOrig        = document.getElementById("imgOrig");         // Imagen original
  const imgGray        = document.getElementById("imgGray");         // Imagen en escala de grises
  const imgComp        = document.getElementById("imgComp");         // Imagen comprimida
  const psnrVal        = document.getElementById("psnrVal");         // Valor numérico del PSNR
  const psnrQuality    = document.getElementById("psnrQuality");     // Etiqueta de calidad del PSNR
  const mCoef          = document.getElementById("mCoef");           // Métrica: coeficientes usados
  const mDim           = document.getElementById("mDim");            // Métrica: dimensiones
  const mSizeOrig      = document.getElementById("mSizeOrig");       // Métrica: tamaño original
  const mSizeComp      = document.getElementById("mSizeComp");       // Métrica: tamaño comprimido
  const mSizeSavings   = document.getElementById("mSizeSavings");    // Badge de ahorro de tamaño
  const modalOverlay   = document.getElementById("modalOverlay");    // Fondo del modal de imagen
  const modalInner     = document.getElementById("modalInner");      // Contenedor del modal
  const modalImg       = document.getElementById("modalImg");        // Imagen ampliada en el modal
  const modalLabel     = document.getElementById("modalLabel");      // Título del modal
  const modalClose     = document.getElementById("modalClose");      // Botón para cerrar el modal
  const btnModalDl     = document.getElementById("btnModalDownload"); // Botón de descarga en el modal

  let currentFile   = null;           // Archivo de imagen actualmente cargado
  let modalFilename = "imagen.png";   // Nombre del archivo al descargar desde el modal
  let cameraStream  = null;           // Stream activo de la cámara
  let facingMode    = "environment";  // Cámara trasera por defecto

  // ── Referencias para el modal de cámara ──
  const cameraOverlay = document.getElementById("cameraOverlay");  // Fondo del modal de cámara
  const cameraClose   = document.getElementById("cameraClose");    // Botón de cerrar cámara
  const cameraVideo   = document.getElementById("cameraVideo");    // Elemento de video en vivo
  const btnShutter    = document.getElementById("btnShutter");     // Botón de captura (disparo)
  const btnFlip       = document.getElementById("btnFlip");        // Botón para cambiar de cámara

  // ── Actualiza el slider y los textos asociados ──
  function updateSlider(val) {
    // Calcula el porcentaje de relleno del slider para el degradado visual
    const pct = ((val - 1) / 63 * 100).toFixed(1);
    slider.style.background =
      `linear-gradient(to right, #22D3EE 0%, #22D3EE ${pct}%, rgba(255,255,255,0.18) ${pct}%)`;

    coefVal.textContent = val;                                           // Número actual de coeficientes
    coefPct.textContent = (val / 64 * 100).toFixed(1) + "%";           // Porcentaje respecto a 64
    controlHint.textContent =
      `Se conservan los primeros ${val} coeficiente${val !== 1 ? "s" : ""} del recorrido zig-zag ` +
      `de cada bloque 8×8 — el resto se anula antes de la IDCT.`;
  }
  updateSlider(8); // Valor inicial del slider

  // Sincroniza el slider con el campo numérico
  slider.addEventListener("input", () => {
    numInput.value = slider.value;
    updateSlider(Number(slider.value));
  });

  // Sincroniza el campo numérico con el slider, limitando el rango [1, 64]
  numInput.addEventListener("input", () => {
    const v = Math.max(1, Math.min(64, Number(numInput.value) || 1));
    slider.value = v;
    updateSlider(v);
  });

  // ── Manejo de la cámara ──
  btnCamera.addEventListener("click", openCamera);
  btnGallery.addEventListener("click", () => inputGallery.click());

  // Abre el modal de cámara usando la API getUserMedia; cae en input de archivo si no está disponible
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      inputCamera.click(); // Fallback: abre el selector de archivos con captura
      return;
    }
    try {
      // Solicita acceso a la cámara con la orientación seleccionada
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream; // Muestra el video en vivo
      cameraOverlay.style.display = "flex";
    } catch (err) {
      // Si el permiso es denegado o no hay cámara, usa el input de archivo
      inputCamera.click();
    }
  }

  // Detiene el stream de cámara y cierra el modal
  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop()); // Libera todos los tracks del stream
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraOverlay.style.display = "none";
  }

  cameraClose.addEventListener("click", stopCamera);
  // Cierra el modal si se hace clic fuera del recuadro de la cámara
  cameraOverlay.addEventListener("click", (e) => { if (e.target === cameraOverlay) stopCamera(); });

  // Captura un fotograma del video y lo convierte en archivo JPEG
  btnShutter.addEventListener("click", () => {
    const canvas = document.createElement("canvas");
    canvas.width  = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext("2d").drawImage(cameraVideo, 0, 0); // Dibuja el fotograma actual
    stopCamera();
    // Convierte el canvas a Blob y lo envuelve como archivo
    canvas.toBlob((blob) => {
      handleFile(new File([blob], "foto.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92); // Calidad JPEG: 92%
  });

  // Alterna entre cámara trasera y frontal
  btnFlip.addEventListener("click", async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop()); // Detiene el stream anterior
      cameraStream = null;
    }
    try {
      // Reinicia el stream con la nueva orientación
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
    } catch {
      // Si falla, revierte la orientación y cierra la cámara
      facingMode = facingMode === "environment" ? "user" : "environment";
      stopCamera();
    }
  });

  // ── Carga y previsualización de la imagen seleccionada ──
  function handleFile(file) {
    if (!file) return;
    currentFile = file;
    showError(""); // Limpia cualquier error previo

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        previewThumb.src           = e.target.result;                              // Muestra la miniatura
        previewName.textContent    = file.name || "imagen";                        // Nombre del archivo
        previewDim.textContent     = img.naturalWidth + " × " + img.naturalHeight + " px"; // Dimensiones reales
        imagePreview.style.display = "flex";
        btnCompress.disabled       = false;       // Habilita el botón de comprimir
        resultsPanel.style.display = "none";      // Oculta resultados anteriores
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file); // Lee el archivo como Data URL para previsualizar
  }

  inputCamera.addEventListener("change",  () => handleFile(inputCamera.files[0]));
  inputGallery.addEventListener("change", () => handleFile(inputGallery.files[0]));

  // ── Envío de la imagen al servidor para comprimir ──
  btnCompress.addEventListener("click", async () => {
    if (!currentFile) return;
    showError("");
    spinnerOverlay.style.display = "flex"; // Muestra el indicador de carga

    // Construye el formulario con la imagen y el número de coeficientes
    const fd = new FormData();
    fd.append("image",    currentFile);
    fd.append("num_coef", slider.value);

    try {
      // Envía la imagen al endpoint /process del servidor Flask
      const resp = await fetch("/process", { method: "POST", body: fd });
      const data = await resp.json();

      // Muestra el error si el servidor responde con alguno
      if (!resp.ok || data.error) {
        showError(data.error || "Error al procesar la imagen.");
        return;
      }

      // Actualiza las imágenes con los datos Base64 devueltos por el servidor
      imgOrig.src = "data:image/png;base64," + data.imagen_original;
      imgGray.src = "data:image/png;base64," + data.imagen_referencia;
      imgComp.src = "data:image/png;base64," + data.imagen_comprimida;

      // Muestra el PSNR (∞ si las imágenes son idénticas)
      const p = data.psnr_inf ? "∞" : data.psnr.toFixed(2);
      psnrVal.textContent = p;

      // Determina la etiqueta y color de calidad según el valor de PSNR
      const q = psnrInfo(data.psnr_inf ? Infinity : data.psnr);
      psnrQuality.textContent = q.label;
      psnrQuality.style.color = q.color;

      // Actualiza las métricas de coeficientes y dimensiones
      mCoef.textContent = data.num_coef;
      mDim.textContent  = data.width + "×" + data.height;

      // Muestra los tamaños de archivo formateados
      mSizeOrig.textContent = fmtBytes(data.size_original);
      mSizeComp.textContent = fmtBytes(data.size_comprimida);

      // Calcula el porcentaje de ahorro (negativo = el archivo creció)
      const saved = ((1 - data.size_comprimida / data.size_original) * 100);
      if (saved > 0) {
        // El archivo comprimido es más pequeño: badge en cian
        mSizeSavings.textContent           = "−" + saved.toFixed(0) + "%";
        mSizeSavings.style.color           = "#22D3EE";
        mSizeSavings.style.borderColor     = "rgba(34,211,238,0.2)";
        mSizeSavings.style.background      = "rgba(34,211,238,0.12)";
      } else {
        // El archivo comprimido es más grande: badge en rojo
        mSizeSavings.textContent           = "+" + Math.abs(saved).toFixed(0) + "%";
        mSizeSavings.style.color           = "#f87171";
        mSizeSavings.style.borderColor     = "rgba(248,113,113,0.2)";
        mSizeSavings.style.background      = "rgba(248,113,113,0.12)";
      }

      // Muestra el panel de resultados y hace scroll hasta él
      resultsPanel.style.display = "block";
      resultsPanel.scrollIntoView && resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError("Error de conexión: " + err.message);
    } finally {
      spinnerOverlay.style.display = "none"; // Oculta el indicador de carga
    }
  });

  // ── Miniaturas → modal de imagen ampliada ──
  const THUMBS = [
    { key: "orig", label: "Original",          filename: "original.png"   },
    { key: "gray", label: "Escala de grises",  filename: "gris.png"       },
    { key: "comp", label: "Comprimida",        filename: "comprimida.png" },
  ];

  // Asigna el evento de clic a cada tarjeta para abrir el modal correspondiente
  document.querySelectorAll(".thumb-card").forEach((card) => {
    const key  = card.dataset.key;
    const info = THUMBS.find(t => t.key === key);
    if (!info) return;
    card.addEventListener("click", () => {
      const imgEl = key === "orig" ? imgOrig : key === "gray" ? imgGray : imgComp;
      openModal(imgEl.src, info.label, info.filename);
    });
  });

  // Abre el modal mostrando la imagen a pantalla completa
  function openModal(src, label, filename) {
    modalImg.src            = src;
    modalLabel.textContent  = label;
    modalFilename           = filename;
    modalOverlay.style.display = "flex";
  }

  modalClose.addEventListener("click", closeModal);
  // Cierra el modal si se hace clic en el fondo oscuro
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
  function closeModal() { modalOverlay.style.display = "none"; }

  // Descarga la imagen actualmente visible en el modal
  btnModalDl.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href     = modalImg.src;
    a.download = modalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ── Funciones auxiliares ──

  // Muestra u oculta la barra de error según si hay mensaje
  function showError(msg) {
    errorBar.textContent   = msg;
    errorBar.style.display = msg ? "block" : "none";
  }

  // Formatea un tamaño en bytes a la unidad más legible (B, KB o MB)
  function fmtBytes(b) {
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + " MB";
    if (b >= 1024)        return (b / 1024).toFixed(1) + " KB";
    return b + " B";
  }

  // Devuelve la etiqueta y color de calidad según el valor de PSNR en dB
  function psnrInfo(val) {
    if (!isFinite(val)) return { label: "Sin pérdida", color: "#a3e635" }; // Imágenes idénticas
    if (val >= 40)      return { label: "Excelente",   color: "#22D3EE" }; // Muy alta calidad
    if (val >= 30)      return { label: "Buena",       color: "#34d399" }; // Calidad aceptable para uso general
    if (val >= 20)      return { label: "Aceptable",   color: "#fbbf24" }; // Pérdida visible
    return               { label: "Baja calidad",      color: "#f87171" }; // Pérdida significativa
  }
})();
