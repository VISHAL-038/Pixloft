from django.db import models
from django.contrib.auth.models import User

class Project(models.Model):
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='projects')
    name       = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.user.username})"

    @property
    def image_count(self):
        return self.images.count()