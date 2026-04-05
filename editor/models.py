from django.db import models
from django.contrib.auth.models import User
from projects.models import Project

def upload_path(instance, filename):
    return f'uploads/{instance.user.id}/{filename}'

class Image(models.Model):
    user          = models.ForeignKey(User, on_delete=models.CASCADE, related_name='images')
    project       = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='images')
    file          = models.ImageField(upload_to=upload_path)
    original_name = models.CharField(max_length=255)
    width         = models.IntegerField(null=True, blank=True)
    height        = models.IntegerField(null=True, blank=True)
    edit_params   = models.JSONField(default=dict, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.original_name} ({self.user.username})"