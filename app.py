import base64
import io
import math
import os

import numpy as np
from flask import Flask, jsonify, render_template, request
from PIL import Image
from scipy.fftpack import dct, idct

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB

MAX_DIM = 720


def _zigzag_indices(n: int = 8):
    indices = []
    r, c = 0, 0
    going_up = True
    for _ in range(n * n):
        indices.append((r, c))
        if going_up:
            if r == 0 and c < n - 1:
                c += 1
                going_up = False
            elif c == n - 1:
                r += 1
                going_up = False
            else:
                r -= 1
                c += 1
        else:
            if c == 0 and r < n - 1:
                r += 1
                going_up = True
            elif r == n - 1:
                c += 1
                going_up = True
            else:
                r += 1
                c -= 1
    return indices


ZZ = _zigzag_indices()


def _resize(img: Image.Image) -> Image.Image:
    w, h = img.size
    if w > MAX_DIM or h > MAX_DIM:
        scale = min(MAX_DIM / w, MAX_DIM / h)
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return img


def compress_dct(img_gray: np.ndarray, num_coef: int) -> np.ndarray:
    h, w = img_gray.shape
    data = img_gray.astype(np.float64)

    ph = int(np.ceil(h / 8) * 8)
    pw = int(np.ceil(w / 8) * 8)
    padded = np.pad(data, ((0, ph - h), (0, pw - w)), mode="edge")
    result = np.zeros_like(padded)

    for bi in range(0, ph, 8):
        for bj in range(0, pw, 8):
            block = padded[bi : bi + 8, bj : bj + 8]
            coefs = dct(dct(block, norm="ortho", axis=0), norm="ortho", axis=1)
            mask = np.zeros((8, 8), dtype=np.float64)
            for k in range(num_coef):
                r, c = ZZ[k]
                mask[r, c] = coefs[r, c]
            recon = idct(idct(mask, norm="ortho", axis=1), norm="ortho", axis=0)
            result[bi : bi + 8, bj : bj + 8] = recon

    cropped = result[:h, :w]
    return np.clip(np.round(cropped), 0, 255).astype(np.uint8)


def psnr(original: np.ndarray, reconstructed: np.ndarray) -> float:
    mse = float(
        np.mean((original.astype(np.float64) - reconstructed.astype(np.float64)) ** 2)
    )
    if mse < 1e-10:
        return float("inf")
    return float(20 * np.log10(255.0 / math.sqrt(mse)))


def _to_b64_png(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/process", methods=["POST"])
def process():
    if "image" not in request.files:
        return jsonify({"error": "No se recibió ninguna imagen."}), 400

    try:
        num_coef = int(request.form.get("num_coef", 8))
    except (TypeError, ValueError):
        return jsonify({"error": "num_coef debe ser un entero."}), 400

    if not (1 <= num_coef <= 64):
        return jsonify({"error": "num_coef debe estar entre 1 y 64."}), 400

    try:
        img_rgb = Image.open(request.files["image"].stream).convert("RGB")
    except Exception:
        return jsonify({"error": "No se pudo leer la imagen. Formato no soportado."}), 400

    img_rgb = _resize(img_rgb)
    width, height = img_rgb.size

    img_gray = np.array(img_rgb.convert("L"))
    img_comp = compress_dct(img_gray, num_coef)

    p = psnr(img_gray, img_comp)

    return jsonify(
        {
            "imagen_original":   _to_b64_png(np.array(img_rgb)),
            "imagen_referencia": _to_b64_png(img_gray),
            "imagen_comprimida": _to_b64_png(img_comp),
            "psnr":              round(p, 2) if math.isfinite(p) else None,
            "psnr_inf":          not math.isfinite(p),
            "num_coef":          num_coef,
            "width":             width,
            "height":            height,
            "tasa_compresion":   round(num_coef / 64, 4),
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
