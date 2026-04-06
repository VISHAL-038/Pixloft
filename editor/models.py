from django.db import models
from django.contrib.auth.models import User
from projects.models import Project
from PIL import Image as PilImage

def upload_path(instance, filename):
    return f'uploads/{instance.user.id}/{filename}'

class Image(models.Model):
    user          = models.ForeignKey(User, on_delete=models.CASCADE, related_name='images')
    project       = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='images')
    file          = models.ImageField(upload_to=upload_path)
    original_name = models.CharField(max_length=255)
    file_size     = models.PositiveIntegerField(null=True, blank=True)  # in bytes
    width         = models.IntegerField(null=True, blank=True)
    height        = models.IntegerField(null=True, blank=True)
    edit_params   = models.JSONField(default=dict, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.original_name} ({self.user.username})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Auto read width & height using Pillow after file is saved
        if self.file and not self.width:
            try:
                img = PilImage.open(self.file.path)
                self.width, self.height = img.size
                Image.objects.filter(pk=self.pk).update(
                    width=self.width,
                    height=self.height
                )
            except Exception:
                pass

    def get_default_params(self):
        return {
            'brightness': 0,
            'contrast': 0,
            'saturation': 0,
            'vibrance': 0,
            'exposure': 0,
            'highlights': 0,
            'shadows': 0,
            'temperature': 0,
            'tint': 0,
            'sharpness': 0,
            'noise_reduction': 0,
            'vignette': 0,
            'grain': 0,
            'rotation': 0,
            'crop': None,
        }

    @property
    def file_size_display(self):
        if not self.file_size:
            return ''
        if self.file_size < 1024 * 1024:
            return f"{self.file_size // 1024} KB"
        return f"{self.file_size / (1024 * 1024):.1f} MB"

    @property
    def resolution(self):
        if self.width and self.height:
            return f"{self.width} × {self.height}"
        return ''