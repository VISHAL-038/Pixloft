from django.urls import path
from . import views

app_name = 'editor'

urlpatterns = [
    path('<int:image_id>/',        views.editor_view,   name='editor'),
    path('api/upload/',            views.upload_image,  name='upload'),
    path('api/delete/<int:image_id>/', views.delete_image, name='delete'),
    path('api/export/<int:image_id>/', views.export_image,  name='export'),
]