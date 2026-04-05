// Auto-dismiss messages after 4s
document.querySelectorAll('.message').forEach(el => {
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; }, 4000);
    setTimeout(() => el.remove(), 4400);
  });
  
  // CSRF token helper for fetch() calls
  function getCsrfToken() {
    return document.cookie.split('; ')
      .find(r => r.startsWith('csrftoken='))
      ?.split('=')[1] ?? '';
  }
  
  // Generic POST helper
  async function apiPost(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
      },
      body: JSON.stringify(data),
    });
    return res.json();
  }