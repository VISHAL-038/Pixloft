# 🖼️ Pixloft

A powerful, browser-based photo editing web application built with Django and vanilla JavaScript. Pixloft brings professional-grade image editing tools to the web — from tone curves and HSL adjustments to non-destructive edit history and server-side export.

---

## ✨ Features

- **User Authentication** — Secure login, signup, and session management
- **Image Upload & Storage** — Upload images with metadata stored in the database
- **Canvas-Based Editing** — Real-time image editing on an HTML5 Canvas
- **Tone Adjustments** — Brightness, contrast, exposure, highlights, shadows
- **Color Controls** — Saturation, vibrance, hue, and white balance (temperature & tint)
- **Crop & Rotate** — Interactive crop overlay with aspect ratio lock and rotation
- **Sharpening & Noise Reduction** — Convolution kernel sharpening and Gaussian blur
- **Tone Curve Editor** — Interactive Bézier curve editor with RGB + luma channels
- **Histogram Display** — Live RGB histogram that updates with every edit
- **Vignette & Grain Effects** — Radial gradient vignette and film grain overlay
- **Presets / Filters System** — Save, name, and apply edit presets with thumbnails
- **Undo / Redo History** — Stack-based edit history with before/after toggle
- **Server-Side Export** — High-quality JPEG/PNG export powered by Pillow
- **Album Management** — Organise images into albums with bulk select support
- **Keyboard Shortcuts** — Global hotkeys for power users
- **Responsive Design** — Mobile-friendly layout with touch gesture support

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Django |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Image Processing | Pillow (server-side), Canvas API (client-side) |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Auth | Django built-in auth system |
| Version Control | Git |

---

## 📁 Project Structure

```
PIXLOFT/
├── accounts/                   # User auth app
│   ├── migrations/
│   ├── __init__.py
│   ├── admin.py
│   ├── apps.py
│   ├── models.py
│   ├── tests.py
│   ├── urls.py
│   └── views.py
├── config/                     # Django project settings
│   ├── __init__.py
│   ├── asgi.py
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── editor/                     # Image editor app
│   ├── migrations/
│   ├── __init__.py
│   ├── admin.py
│   ├── apps.py
│   ├── models.py
│   ├── tests.py
│   ├── urls.py
│   └── views.py
├── logs/                       # Application logs
├── media/                      # User-uploaded files
│   ├── exports/                # Exported/downloaded images
│   ├── thumbnails/             # Auto-generated thumbnails
│   └── uploads/                # Original uploaded images
├── projects/                   # Album/project management app
│   ├── migrations/
│   ├── __init__.py
│   ├── admin.py
│   ├── apps.py
│   ├── models.py
│   ├── tests.py
│   ├── urls.py
│   └── views.py
├── static/
│   ├── css/
│   │   ├── editor.css          # Editor-specific styles
│   │   └── main.css            # Global styles & dark theme
│   └── js/
│       ├── editor.js           # Canvas, adjustments, tools
│       └── main.js             # Global JS utilities
├── templates/
│   ├── accounts/
│   │   ├── login.html
│   │   ├── profile.html
│   │   └── signup.html
│   ├── editor/
│   │   ├── editor.html
│   │   └── partials/           # Editor UI partials
│   ├── projects/
│   │   ├── album_detail.html
│   │   ├── confirm_delete.html
│   │   ├── create.html
│   │   ├── detail.html
│   │   └── list.html
│   └── base.html               # Base template
├── venv/                       # Virtual environment
├── db.sqlite3
├── manage.py
├── README.md
└── requirements.txt
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- pip
- Git

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/pixloft.git
cd pixloft

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Apply migrations
python manage.py migrate

# 5. Create a superuser (optional)
python manage.py createsuperuser

# 6. Run the development server
python manage.py runserver
```

Visit `http://127.0.0.1:8000` in your browser.

---

## 📸 UI Layout

The editor interface follows a classic three-panel layout:

```
┌─────────────────────────────────────────────────┐
│  🛠 Tools Panel  │  🖼 Canvas Area  │  🎚 Adjustments │
│                  │                 │                  │
│  Crop            │                 │  Exposure        │
│  Rotate          │   [Image Here]  │  Contrast        │
│  Presets         │                 │  Highlights      │
│  Histogram       │  Zoom / Pan     │  Shadows         │
│                  │                 │  HSL / Curve     │
└─────────────────────────────────────────────────┘
```

---

## 📦 Requirements

```
Django>=4.2
Pillow>=10.0
```

> Full list available in `requirements.txt`

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change, then submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Your Name**
- GitHub: [@vishal-038](https://github.com/vishal-038)

---

> Built with ❤️ using Django & Canvas API — **Pixloft**