from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from .models import Project, Album
from editor.models import Image
import json

@login_required
def project_list(request):
    projects = Project.objects.filter(user=request.user).order_by('-created_at')
    return render(request, 'projects/list.html', {'projects': projects})

@login_required
def project_create(request):
    if request.method == 'POST':
        name    = request.POST.get('name', 'Untitled Project')
        project = Project.objects.create(user=request.user, name=name)
        return redirect('projects:detail', pk=project.pk)
    return render(request, 'projects/create.html')

@login_required
def project_detail(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    albums  = project.albums.all()
    images  = Image.objects.filter(project=project, album=None).order_by('-created_at')
    return render(request, 'projects/detail.html', {
        'project': project,
        'albums':  albums,
        'images':  images,
    })

@login_required
@require_POST
def project_delete(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    project.delete()
    return redirect('projects:list')

@login_required
@require_POST
def project_rename(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    try:
        data    = json.loads(request.body)
        name    = data.get('name', '').strip()
        if name:
            project.name = name
            project.save()
        return JsonResponse({'name': project.name})
    except Exception:
        return JsonResponse({'error': 'Invalid request'}, status=400)

@login_required
@require_POST
def album_create(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    name    = request.POST.get('name', 'New Album').strip() or 'New Album'
    album   = Album.objects.create(project=project, name=name)
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({
            'id':   album.pk,
            'name': album.name,
            'url':  f'/projects/{pk}/albums/{album.pk}/',
        })
    return redirect('projects:detail', pk=pk)

@login_required
def album_detail(request, pk, album_pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    album   = get_object_or_404(Album, pk=album_pk, project=project)
    images  = Image.objects.filter(album=album).order_by('-created_at')
    albums  = project.albums.all()
    return render(request, 'projects/album_detail.html', {
        'project': project,
        'album':   album,
        'images':  images,
        'albums':  albums,
    })

@login_required
@require_POST
def album_delete(request, pk, album_pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    album   = get_object_or_404(Album, pk=album_pk, project=project)
    # Move images back to project root
    album.images.update(album=None)
    album.delete()
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({'ok': True})
    return redirect('projects:detail', pk=pk)

@login_required
@require_POST
def album_rename(request, pk, album_pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    album   = get_object_or_404(Album, pk=album_pk, project=project)
    try:
        data = json.loads(request.body)
        name = data.get('name', '').strip()
        if name:
            album.name = name
            album.save()
        return JsonResponse({'name': album.name})
    except Exception:
        return JsonResponse({'error': 'Invalid request'}, status=400)

@login_required
@require_POST
def bulk_move(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    try:
        data      = json.loads(request.body)
        image_ids = data.get('image_ids', [])
        album_id  = data.get('album_id')

        images = Image.objects.filter(pk__in=image_ids, project=project)

        if album_id:
            album = get_object_or_404(Album, pk=album_id, project=project)
            images.update(album=album)
        else:
            images.update(album=None)

        return JsonResponse({'moved': images.count()})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)

@login_required
@require_POST
def bulk_delete(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    try:
        data      = json.loads(request.body)
        image_ids = data.get('image_ids', [])
        images    = Image.objects.filter(pk__in=image_ids, project=project)
        for img in images:
            img.file.delete(save=False)
        count = images.count()
        images.delete()
        return JsonResponse({'deleted': count})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)