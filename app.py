import base64
import io
import math
import os

import numpy as np
from flask import Flask, jsonify, render_template, request
from PIL import Image
from scipy.fftpack import dct, idct

# Inicialización de la aplicación Flask
app = Flask(__name__)
# Límite máximo de tamaño de archivo subido: 16 MB
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

# Dimensión máxima permitida (ancho o alto) antes de redimensionar
MAX_DIM = 720

# Freddy
def _zigzag_indices(n: int = 8):
    """
    Genera el orden de recorrido en zigzag para un bloque n×n.
    Este orden se usa para seleccionar los coeficientes DCT más importantes
    (bajas frecuencias primero) al comprimir cada bloque.
    """
    indices = []
    r, c = 0, 0
    going_up = True  # Dirección actual del recorrido

    for _ in range(n * n):
        indices.append((r, c))  # Registra la posición actual

        if going_up:
            # Llegamos al borde superior: avanzar a la derecha y bajar
            if r == 0 and c < n - 1:
                c += 1
                going_up = False
            # Llegamos al borde derecho: bajar una fila
            elif c == n - 1:
                r += 1
                going_up = False
            else:
                # Movimiento diagonal hacia arriba-derecha
                r -= 1
                c += 1
        else:
            # Llegamos al borde izquierdo: avanzar hacia abajo
            if c == 0 and r < n - 1:
                r += 1
                going_up = True
            # Llegamos al borde inferior: avanzar a la derecha
            elif r == n - 1:
                c += 1
                going_up = True
            else:
                # Movimiento diagonal hacia abajo-izquierda
                r += 1
                c -= 1

    return indices


# Tabla de índices zigzag precalculada para bloques 8×8
ZZ = _zigzag_indices()

# Tyrone
def _resize(img: Image.Image) -> Image.Image:
    """
    Redimensiona la imagen si supera MAX_DIM en alguno de sus lados,
    manteniendo la proporción original.
    """
    w, h = img.size
    if w > MAX_DIM or h > MAX_DIM:
        # Calcula el factor de escala para que ningún lado supere MAX_DIM
        scale = min(MAX_DIM / w, MAX_DIM / h)
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return img

#Freddy
def compress_dct(img_gray: np.ndarray, num_coef: int) -> np.ndarray:
    """
    Comprime una imagen en escala de grises usando la Transformada Discreta
    del Coseno (DCT) por bloques de 8×8.

    Por cada bloque se aplica la DCT 2D, se conservan solo los primeros
    num_coef coeficientes según el orden zigzag (bajas frecuencias), y se
    reconstruye el bloque con la IDCT 2D.
    """
    h, w = img_gray.shape
    data = img_gray.astype(np.float64)  # Convertir a float64 para precisión numérica

    # Calcular dimensiones con padding para que sean múltiplos de 8
    ph = int(np.ceil(h / 8) * 8)
    pw = int(np.ceil(w / 8) * 8)

    # Rellenar los bordes replicando el píxel del borde (evita artefactos)
    padded = np.pad(data, ((0, ph - h), (0, pw - w)), mode="edge")
    result = np.zeros_like(padded)  # Imagen resultado del mismo tamaño que el padding

    # Recorrer la imagen en bloques de 8×8
    for bi in range(0, ph, 8):
        for bj in range(0, pw, 8):
            block = padded[bi : bi + 8, bj : bj + 8]  # Extraer bloque actual

            # Aplicar DCT 2D separable: primero por filas, luego por columnas
            coefs = dct(dct(block, norm="ortho", axis=0), norm="ortho", axis=1)

            # Crear máscara vacía y copiar solo los num_coef primeros coeficientes zigzag
            mask = np.zeros((8, 8), dtype=np.float64)
            for k in range(num_coef):
                r, c = ZZ[k]           # Posición (fila, col) según orden zigzag
                mask[r, c] = coefs[r, c]  # Conservar coeficiente

            # Reconstruir el bloque aplicando la IDCT 2D inversa
            recon = idct(idct(mask, norm="ortho", axis=1), norm="ortho", axis=0)
            result[bi : bi + 8, bj : bj + 8] = recon  # Guardar bloque reconstruido

    # Recortar el padding y limitar valores al rango válido [0, 255]
    cropped = result[:h, :w]
    return np.clip(np.round(cropped), 0, 255).astype(np.uint8)

# Tyrone 
def psnr(original: np.ndarray, reconstructed: np.ndarray, bits: int = 8) -> float:
    """
    Calcula el PSNR (Peak Signal-to-Noise Ratio) entre la imagen original
    y la reconstruida, usando la fórmula:

        PSNR = 10 · log10( (2^n - 1)² / MSE )

    donde n es la profundidad de bits (por defecto 8) y MSE es el error
    cuadrático medio entre ambas imágenes.
    """
    # Error cuadrático medio entre la imagen original y la comprimida
    mse = float(
        np.mean((original.astype(np.float64) - reconstructed.astype(np.float64)) ** 2)
    )

    # Si el MSE es prácticamente cero, las imágenes son idénticas → PSNR infinito
    if mse < 1e-10:
        return float("inf")

    # Valor máximo posible al cuadrado según la profundidad de bits
    max_val = (2 ** bits - 1) ** 2
    return float(10 * np.log10(max_val / mse))


def _to_b64_png(arr: np.ndarray) -> str:
    """
    Convierte un array NumPy (imagen) a una cadena PNG codificada en Base64,
    lista para ser incrustada en una respuesta JSON.
    """
    buf = io.BytesIO()                              # Buffer en memoria
    Image.fromarray(arr).save(buf, format="PNG")    # Guardar como PNG en el buffer
    return base64.b64encode(buf.getvalue()).decode("utf-8")  # Codificar en Base64


@app.route("/")
def index():
    """Sirve la página principal de la aplicación."""
    return render_template("index.html")

# Tyrone
@app.route("/process", methods=["POST"])
def process():
    """
    Recibe una imagen y el número de coeficientes DCT, aplica la compresión
    y devuelve en JSON las imágenes (original, grises, comprimida) junto con
    métricas: PSNR, dimensiones y tamaños de archivo.
    """
    # Verificar que se envió un archivo de imagen
    if "image" not in request.files:
        return jsonify({"error": "No se recibió ninguna imagen."}), 400

    # Leer y validar el número de coeficientes DCT
    try:
        num_coef = int(request.form.get("num_coef", 8))
    except (TypeError, ValueError):
        return jsonify({"error": "num_coef debe ser un entero."}), 400

    if not (1 <= num_coef <= 64):
        return jsonify({"error": "num_coef debe estar entre 1 y 64."}), 400

    # Abrir la imagen y convertirla a RGB
    try:
        img_rgb = Image.open(request.files["image"].stream).convert("RGB")
    except Exception:
        return jsonify({"error": "No se pudo leer la imagen. Formato no soportado."}), 400

    # Redimensionar si supera el tamaño máximo permitido
    img_rgb = _resize(img_rgb)
    width, height = img_rgb.size

    # Convertir a escala de grises para aplicar la DCT
    img_gray = np.array(img_rgb.convert("L"))

    # Aplicar la compresión DCT con el número de coeficientes indicado
    img_comp = compress_dct(img_gray, num_coef)

    # Calcular el PSNR entre la imagen original en grises y la comprimida
    p = psnr(img_gray, img_comp)

    # Medir el tamaño del PNG de la imagen en grises (antes de comprimir)
    buf_orig = io.BytesIO()
    Image.fromarray(img_gray).save(buf_orig, format="PNG")
    size_original = buf_orig.tell()  # Tamaño en bytes

    # Medir el tamaño del PNG de la imagen comprimida
    buf_comp = io.BytesIO()
    Image.fromarray(img_comp).save(buf_comp, format="PNG")
    size_comprimida = buf_comp.tell()  # Tamaño en bytes

    # Devolver todos los resultados como JSON
    return jsonify(
        {
            "imagen_original":   _to_b64_png(np.array(img_rgb)),  # Imagen RGB original
            "imagen_referencia": _to_b64_png(img_gray),           # Imagen en grises
            "imagen_comprimida": _to_b64_png(img_comp),           # Imagen comprimida
            "psnr":              round(p, 2) if math.isfinite(p) else None,
            "psnr_inf":          not math.isfinite(p),            # True si PSNR es infinito
            "num_coef":          num_coef,                        # Coeficientes usados
            "width":             width,                           # Ancho en píxeles
            "height":            height,                          # Alto en píxeles
            "tasa_compresion":   round(num_coef / 64, 4),        # Fracción de coeficientes conservados
            "size_original":     size_original,                   # Bytes antes de comprimir
            "size_comprimida":   size_comprimida,                 # Bytes después de comprimir
        }
    )


if __name__ == "__main__":
    # Leer el puerto desde variable de entorno o usar 8000 por defecto
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
