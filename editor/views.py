from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from .models import Image

@login_required
def editor_view(request, image_id):
    image = get_object_or_404(Image, pk=image_id, user=request.user)
    return render(request, 'editor/editor.html', {'image': image})

@login_required
def upload_image(request):
    if request.method == 'POST' and request.FILES.get('image'):
        f = request.FILES['image']
        image = Image.objects.create(
            user=request.user,
            file=f,
            original_name=f.name,
        )
        return JsonResponse({'id': image.pk, 'url': image.file.url, 'name': image.original_name})
    return JsonResponse({'error': 'No image provided'}, status=400)

@login_required
def export_image(request):
    return JsonResponse({'message': 'Export endpoint — coming Day 16'})