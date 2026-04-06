from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from .models import Image
from projects.models import Project
import json

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
def export_image(request):
    # Pillow export logic — coming Day 16
    return JsonResponse({'message': 'Export endpoint coming Day 16'})