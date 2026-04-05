from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from .models import Project

@login_required
def project_list(request):
    projects = Project.objects.filter(user=request.user).order_by('-created_at')
    return render(request, 'projects/list.html', {'projects': projects})

@login_required
def project_create(request):
    if request.method == 'POST':
        name = request.POST.get('name', 'Untitled Project')
        project = Project.objects.create(user=request.user, name=name)
        return redirect('projects:detail', pk=project.pk)
    return render(request, 'projects/create.html')

@login_required
def project_detail(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    return render(request, 'projects/detail.html', {'project': project})

@login_required
def project_delete(request, pk):
    project = get_object_or_404(Project, pk=pk, user=request.user)
    if request.method == 'POST':
        project.delete()
        return redirect('projects:list')
    return render(request, 'projects/confirm_delete.html', {'project': project})