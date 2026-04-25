from django.urls import path
from . import views

app_name = 'projects'

urlpatterns = [
    path('',                  views.project_list,   name='list'),
    path('create/',           views.project_create, name='create'),
    path('<int:pk>/',         views.project_detail, name='detail'),
    path('<int:pk>/delete/',  views.project_delete, name='delete'),
    path('<int:pk>/rename/',         views.project_rename,  name='rename'),

    # Albums
    path('<int:pk>/albums/create/',         views.album_create,  name='album_create'),
    path('<int:pk>/albums/<int:album_pk>/delete/', views.album_delete, name='album_delete'),
    path('<int:pk>/albums/<int:album_pk>/rename/', views.album_rename, name='album_rename'),
    path('<int:pk>/albums/<int:album_pk>/',       views.album_detail, name='album_detail'),

    # Bulk actions (AJAX)
    path('<int:pk>/bulk-move/',   views.bulk_move,   name='bulk_move'),
    path('<int:pk>/bulk-delete/', views.bulk_delete, name='bulk_delete'),
]