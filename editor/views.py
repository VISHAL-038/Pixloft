from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from .models import Image
from projects.models import Project
import json, math, io
from PIL import Image as PilImage, ImageEnhance, ImageFilter

ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff']
MAX_SIZE_MB = 20

@login_required
def editor_view(request, image_id):
    image = get_object_or_404(Image, pk=image_id, user=request.user)
    return render(request, 'editor/editor.html', {'image': image})

@login_required
@require_POST
def upload_image(request):
    project_id = request.POST.get('project_id')
    project = get_object_or_404(Project, pk=project_id, user=request.user)

    uploaded = request.FILES.get('image')
    if not uploaded:
        return JsonResponse({'error': 'No file provided'}, status=400)

    # Validate type
    if uploaded.content_type not in ALLOWED_TYPES:
        return JsonResponse({'error': 'Only JPEG, PNG, WEBP and TIFF files are allowed'}, status=400)

    # Validate size
    if uploaded.size > MAX_SIZE_MB * 1024 * 1024:
        return JsonResponse({'error': f'File too large. Max size is {MAX_SIZE_MB}MB'}, status=400)

    image = Image.objects.create(
        user=request.user,
        project=project,
        file=uploaded,
        original_name=uploaded.name,
        file_size=uploaded.size,
    )

    return JsonResponse({
        'id': image.pk,
        'url': image.file.url,
        'name': image.original_name,
        'size': image.file_size_display,
        'resolution': image.resolution,
        'editor_url': f'/editor/{image.pk}/',
    })

@login_required
def delete_image(request, image_id):
    image = get_object_or_404(Image, pk=image_id, user=request.user)
    project_id = image.project.pk if image.project else None
    if request.method == 'POST':
        image.file.delete(save=False)  # delete actual file from disk
        image.delete()
        if project_id:
            return redirect('projects:detail', pk=project_id)
    return redirect('projects:list')

@login_required
@require_POST
def export_image(request, image_id):
    image = get_object_or_404(Image, pk=image_id, user=request.user)

    try:
        body   = json.loads(request.body)
        params = body.get('params', {})
        fmt    = body.get('format', 'jpeg').lower()
        quality = int(body.get('quality', 95))
    except Exception:
        return JsonResponse({'error': 'Invalid request body'}, status=400)

    # Open original image with Pillow
    try:
        img = PilImage.open(image.file.path).convert('RGB')
    except Exception as e:
        return JsonResponse({'error': f'Could not open image: {e}'}, status=500)

    # Apply all adjustments
    img = pillow_apply_all(img, params)

    # Export to bytes
    buf = io.BytesIO()
    if fmt == 'png':
        img.save(buf, format='PNG', optimize=True)
        content_type = 'image/png'
        ext          = 'png'
    elif fmt == 'webp':
        img.save(buf, format='WEBP', quality=quality, method=6)
        content_type = 'image/webp'
        ext          = 'webp'
    else:
        img.save(buf, format='JPEG', quality=quality,
                 optimize=True, progressive=True,
                 subsampling=0)
        content_type = 'image/jpeg'
        ext          = 'jpg'

    buf.seek(0)
    filename = image.original_name.rsplit('.', 1)[0] + f'_edited.{ext}'

    response = HttpResponse(buf.read(), content_type=content_type)
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


# ═══════════════════════════════════════════
#  PILLOW PROCESSING PIPELINE
# ═══════════════════════════════════════════
def pillow_apply_all(img, params):
    """Apply all edit parameters to a Pillow image. Returns processed image."""
    import numpy as np

    arr = np.array(img, dtype=np.float32)

    # ── Exposure ──
    exposure = params.get('exposure', 0)
    if exposure != 0:
        arr += exposure * 1.0
        arr = np.clip(arr, 0, 255)

    # ── Brightness ──
    brightness = params.get('brightness', 0)
    if brightness != 0:
        arr += brightness * 0.8
        arr = np.clip(arr, 0, 255)

    # ── Contrast ──
    contrast = params.get('contrast', 0)
    if contrast != 0:
        factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
        arr    = factor * (arr - 128) + 128
        arr    = np.clip(arr, 0, 255)

    # ── Highlights & Shadows ──
    highlights = params.get('highlights', 0) * 0.6
    shadows    = params.get('shadows',    0) * 0.6
    if highlights != 0 or shadows != 0:
        luma = 0.299*arr[:,:,0] + 0.587*arr[:,:,1] + 0.114*arr[:,:,2]
        if highlights != 0:
            hw   = np.clip((luma - 128) / 127, 0, 1)[:,:,np.newaxis]
            arr += highlights * hw
        if shadows != 0:
            sw   = np.clip((128 - luma) / 128, 0, 1)[:,:,np.newaxis]
            arr += shadows * sw
        arr = np.clip(arr, 0, 255)

    # ── White Balance (temperature + tint) ──
    temperature = params.get('temperature', 0)
    tint        = params.get('tint',        0)
    if temperature != 0 or tint != 0:
        wb_r, wb_g, wb_b = _build_wb_multipliers(temperature, tint)
        arr[:,:,0] = np.clip(arr[:,:,0] * wb_r, 0, 255)
        arr[:,:,1] = np.clip(arr[:,:,1] * wb_g, 0, 255)
        arr[:,:,2] = np.clip(arr[:,:,2] * wb_b, 0, 255)

    # ── Saturation ──
    saturation = params.get('saturation', 0) / 100
    if saturation != 0:
        grey       = (0.299*arr[:,:,0] + 0.587*arr[:,:,1] + 0.114*arr[:,:,2])[:,:,np.newaxis]
        arr        = grey + (arr - grey) * (1 + saturation)
        arr        = np.clip(arr, 0, 255)

    # ── Vibrance ──
    vibrance = params.get('vibrance', 0) / 100
    if vibrance != 0:
        arr = _apply_vibrance_np(arr, vibrance)

    # ── Tone Curves ──
    curve = params.get('curve', {})
    if curve:
        arr = _apply_curves_np(arr, curve)

    # ── HSL per-hue ──
    hsl_params = params.get('hsl', {})
    if hsl_params and _has_hsl_edits(hsl_params):
        arr = _apply_hsl_np(arr, hsl_params)

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = PilImage.fromarray(arr)

    # ── Sharpening (Pillow UnsharpMask) ──
    sharpness = params.get('sharpness', 0)
    if sharpness > 0:
        radius  = params.get('sharpen_radius', 1) * 1.5
        percent = int(sharpness * 2)
        detail  = int(params.get('sharpen_detail', 25) * 0.3)
        img     = img.filter(ImageFilter.UnsharpMask(
            radius=radius, percent=percent, threshold=detail
        ))

    # ── Noise Reduction (Gaussian blur blend) ──
    nr = params.get('noise_reduction', 0)
    if nr > 0:
        blurred = img.filter(ImageFilter.GaussianBlur(radius=1 + nr/40))
        img     = PilImage.blend(img, blurred, nr / 100 * 0.8)

    return img


def _build_wb_multipliers(temperature, tint):
    """Build R/G/B channel multipliers from temperature + tint sliders."""
    def kelvin_to_rgb(kelvin):
        t = kelvin / 100
        if t <= 66:
            r = 1.0
        else:
            r = 329.698727446 * (t - 60) ** -0.1332047592 / 255
            r = max(0, min(1, r))
        if t <= 66:
            g = (99.4708025861 * math.log(t) - 161.1195681661) / 255
        else:
            g = 288.1221695283 * (t - 60) ** -0.0755148492 / 255
        g = max(0, min(1, g))
        if t >= 66:
            b = 1.0
        elif t <= 19:
            b = 0.0
        else:
            b = (138.5177312231 * math.log(t - 10) - 305.0447927307) / 255
            b = max(0, min(1, b))
        return r, g, b

    kelvin = 6500 + temperature * (55 if temperature >= 0 else 45)
    ref    = kelvin_to_rgb(6500)
    tgt    = kelvin_to_rgb(kelvin)

    rM = tgt[0] / ref[0] if ref[0] else 1
    gM = tgt[1] / ref[1] if ref[1] else 1
    bM = tgt[2] / ref[2] if ref[2] else 1

    ts  = tint / 100 * 0.25
    gM += ts; rM -= ts * 0.5; bM -= ts * 0.5

    avg = (rM + gM + bM) / 3
    if avg > 0:
        rM /= avg; gM /= avg; bM /= avg

    return rM, gM, bM


def _apply_vibrance_np(arr, amount):
    """Vibrance — smart saturation that boosts dull colours more."""
    import numpy as np
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    max_c   = np.maximum(np.maximum(r, g), b)
    min_c   = np.minimum(np.minimum(r, g), b)
    sat     = np.where(max_c > 0, (max_c - min_c) / max_c, 0)
    boost   = amount * (1 - sat)
    grey    = 0.299*r + 0.587*g + 0.114*b
    out     = arr.copy()
    for c in range(3):
        out[:,:,c] = grey + (arr[:,:,c] - grey) * (1 + boost)
    return np.clip(out, 0, 255)


def _catmull_rom(points, x):
    """Catmull-Rom spline interpolation — matches the JS engine exactly."""
    n = len(points)
    if n == 0: return x
    if n == 1: return points[0][1]
    if x <= points[0][0]:  return points[0][1]
    if x >= points[-1][0]: return points[-1][1]

    i = 0
    while i < n - 2 and points[i+1][0] < x:
        i += 1

    p0 = points[max(0, i-1)]
    p1 = points[i]
    p2 = points[i+1]
    p3 = points[min(n-1, i+2)]

    t  = (x - p1[0]) / (p2[0] - p1[0])
    t2 = t * t
    t3 = t2 * t
    m1 = (p2[1] - p0[1]) * 0.5
    m2 = (p3[1] - p1[1]) * 0.5

    y  = ((2*t3 - 3*t2 + 1) * p1[1]
        + (t3 - 2*t2 + t)   * m1
        + (-2*t3 + 3*t2)    * p2[1]
        + (t3 - t2)          * m2)
    return max(0.0, min(1.0, y))


def _build_curve_lut(points):
    """Build a 256-entry LUT from curve control points."""
    lut = [0] * 256
    for i in range(256):
        lut[i] = round(_catmull_rom(points, i / 255) * 255)
    return lut


def _is_default_curve(points):
    default = [[0,0],[0.25,0.25],[0.75,0.75],[1,1]]
    if len(points) != len(default):
        return False
    return all(
        abs(p[0] - d[0]) < 0.001 and abs(p[1] - d[1]) < 0.001
        for p, d in zip(points, default)
    )


def _apply_curves_np(arr, curve):
    """Apply tone curves to numpy array."""
    import numpy as np

    luma_pts = curve.get('luma', [[0,0],[0.25,0.25],[0.75,0.75],[1,1]])
    r_pts    = curve.get('r',    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]])
    g_pts    = curve.get('g',    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]])
    b_pts    = curve.get('b',    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]])

    has_luma = not _is_default_curve(luma_pts)
    has_r    = not _is_default_curve(r_pts)
    has_g    = not _is_default_curve(g_pts)
    has_b    = not _is_default_curve(b_pts)

    if not (has_luma or has_r or has_g or has_b):
        return arr

    out = arr.astype(np.uint8)

    if has_luma:
        lut = np.array(_build_curve_lut(luma_pts), dtype=np.uint8)
        out = lut[out]

    if has_r:
        lut = np.array(_build_curve_lut(r_pts), dtype=np.uint8)
        out[:,:,0] = lut[out[:,:,0]]

    if has_g:
        lut = np.array(_build_curve_lut(g_pts), dtype=np.uint8)
        out[:,:,1] = lut[out[:,:,1]]

    if has_b:
        lut = np.array(_build_curve_lut(b_pts), dtype=np.uint8)
        out[:,:,2] = lut[out[:,:,2]]

    return out.astype(np.float32)


def _has_hsl_edits(hsl_params):
    return any(
        v.get('hue', 0) != 0 or v.get('sat', 0) != 0 or v.get('lum', 0) != 0
        for v in hsl_params.values()
        if isinstance(v, dict)
    )


def _apply_hsl_np(arr, hsl_params):
    """Apply per-hue HSL adjustments using the same algorithm as the JS engine."""
    import numpy as np

    HUE_BANDS = {
        'red':     {'center': 0,   'range': 30},
        'orange':  {'center': 30,  'range': 25},
        'yellow':  {'center': 60,  'range': 25},
        'green':   {'center': 120, 'range': 40},
        'aqua':    {'center': 180, 'range': 30},
        'blue':    {'center': 220, 'range': 30},
        'purple':  {'center': 280, 'range': 30},
        'magenta': {'center': 320, 'range': 30},
    }

    # Convert to float 0-1
    rgb = arr.astype(np.float32) / 255.0
    r, g, b = rgb[:,:,0], rgb[:,:,1], rgb[:,:,2]

    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    diff  = max_c - min_c

    # Hue
    h = np.zeros_like(r)
    mask_r = (max_c == r) & (diff > 0)
    mask_g = (max_c == g) & (diff > 0)
    mask_b = (max_c == b) & (diff > 0)
    h[mask_r] = ((g[mask_r] - b[mask_r]) / diff[mask_r]) % 6
    h[mask_g] = (b[mask_g] - r[mask_g]) / diff[mask_g] + 2
    h[mask_b] = (r[mask_b] - g[mask_b]) / diff[mask_b] + 4
    h = h / 6 * 360  # 0-360

    # Saturation
    l = (max_c + min_c) / 2
    s = np.where(diff == 0, 0,
        diff / (1 - np.abs(2 * l - 1) + 1e-8))
    s = np.clip(s, 0, 1)

    dHue = np.zeros_like(h)
    dSat = np.zeros_like(h)
    dLum = np.zeros_like(h)

    for band, info in HUE_BANDS.items():
        adj = hsl_params.get(band, {})
        if not isinstance(adj, dict):
            continue
        ah = adj.get('hue', 0)
        asat = adj.get('sat', 0)
        alum = adj.get('lum', 0)
        if ah == 0 and asat == 0 and alum == 0:
            continue

        center, brange = info['center'], info['range']
        diff_h = np.abs(h - center)
        diff_h = np.where(diff_h > 180, 360 - diff_h, diff_h)
        w = np.where(diff_h > brange, 0,
            np.cos(diff_h / brange * (math.pi / 2)))

        dHue += ah   * w
        dSat += asat * w
        dLum += alum * w

        # Red wraps near 360
        if band == 'red':
            diff_h2 = np.abs(h - 360)
            w2 = np.where(diff_h2 > brange, 0,
                np.cos(diff_h2 / brange * (math.pi / 2)))
            dHue += ah   * w2
            dSat += asat * w2
            dLum += alum * w2

    # Only process pixels with edits
    has_edit = (dHue != 0) | (dSat != 0) | (dLum != 0)
    if not np.any(has_edit):
        return arr

    # Apply shifts
    new_h = (h + dHue * 1.8) % 360
    new_s = np.clip(s + dSat / 100, 0, 1)
    new_l = np.clip(l + dLum / 200, 0, 1)

    # HSL → RGB for edited pixels
    def hsl_to_rgb_np(h_deg, s_val, l_val):
        h_n = h_deg / 360
        q   = np.where(l_val < 0.5, l_val * (1 + s_val), l_val + s_val - l_val * s_val)
        p   = 2 * l_val - q

        def hue2rgb(t):
            t = t % 1
            return np.where(t < 1/6, p + (q-p)*6*t,
                   np.where(t < 1/2, q,
                   np.where(t < 2/3, p + (q-p)*(2/3-t)*6, p)))

        r_out = hue2rgb(h_n + 1/3)
        g_out = hue2rgb(h_n)
        b_out = hue2rgb(h_n - 1/3)

        r_out = np.where(s_val == 0, l_val, r_out)
        g_out = np.where(s_val == 0, l_val, g_out)
        b_out = np.where(s_val == 0, l_val, b_out)
        return r_out, g_out, b_out

    nr, ng, nb = hsl_to_rgb_np(new_h, new_s, new_l)

    out = arr.copy()
    out[has_edit, 0] = np.clip(nr[has_edit] * 255, 0, 255)
    out[has_edit, 1] = np.clip(ng[has_edit] * 255, 0, 255)
    out[has_edit, 2] = np.clip(nb[has_edit] * 255, 0, 255)
    return out