const { ipcRenderer } = require('electron');

// 缓存 DOMContentLoaded 之前到达的数据
let pendingMovies = null;
let pickerReady = false;
let pickerRender = null;

// 立即注册 IPC 监听器，防止 DOMContentLoaded 前消息丢失
ipcRenderer.on('screenshot:movie-picker-data', (_event, movies) => {
  if (pickerReady && pickerRender) {
    pickerRender(movies);
  } else {
    pendingMovies = movies;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('list');
  const search = document.getElementById('search');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const cancelBtn = document.getElementById('cancel');

  if (!list || !search || !prev || !next || !cancelBtn) {
    return;
  }

  let allMovies = [];
  let renderToken = 0;

  function updateArrows() {
    const canScroll = list.scrollWidth > list.clientWidth + 1;
    prev.disabled = !canScroll || list.scrollLeft <= 1;
    next.disabled = !canScroll || list.scrollLeft >= list.scrollWidth - list.clientWidth - 1;
  }

  function renderList(movies) {
    list.innerHTML = '';
    list.className = 'list';
    const token = ++renderToken;

    if (!movies.length) {
      list.className = 'empty';
      list.textContent = '暂无影片';
      updateArrows();
      return;
    }

    for (const movie of movies) {
      const btn = document.createElement('button');
      btn.className = 'movie';
      btn.title = movie.title;
      btn.innerHTML =
        '<div class="poster"><div class="fallback">片</div></div>' +
        '<div class="name"></div>' +
        '<div class="meta"></div>';
      btn.querySelector('.name').textContent = movie.title;
      btn.querySelector('.meta').textContent = [movie.year, movie.mediaType].filter(Boolean).join(' · ');
      btn.addEventListener('click', () => ipcRenderer.invoke('screenshot:movie-picker-select', movie.id));
      list.appendChild(btn);

      ipcRenderer.invoke('movie:getPosterUrl', movie.id, true).then((posterDataUrl) => {
        if (!posterDataUrl || token !== renderToken) return;
        if (!btn.isConnected) return;
        const posterEl = btn.querySelector('.poster');
        if (!posterEl) return;
        posterEl.innerHTML = '<img src="' + posterDataUrl + '" draggable="false">';
      }).catch(() => {});
    }

    requestAnimationFrame(updateArrows);
  }

  function applyFilter() {
    const query = search.value.trim().toLowerCase();
    const filtered = query
      ? allMovies.filter((movie) =>
          movie.title.toLowerCase().includes(query) ||
          (movie.titleOriginal || '').toLowerCase().includes(query)
        )
      : allMovies;
    renderList(filtered);
    list.scrollLeft = 0;
    requestAnimationFrame(updateArrows);
  }

  function render(movies) {
    allMovies = Array.isArray(movies) ? movies : [];
    applyFilter();
  }

  const cancel = () => ipcRenderer.invoke('screenshot:movie-picker-cancel');

  pickerReady = true;
  pickerRender = render;
  // 处理 DOMContentLoaded 前到达的缓存数据
  if (pendingMovies) {
    render(pendingMovies);
    pendingMovies = null;
  }
  cancelBtn.addEventListener('click', cancel);
  search.addEventListener('input', applyFilter);
  list.addEventListener('scroll', updateArrows);
  prev.addEventListener('click', () => list.scrollBy({ left: -Math.max(240, list.clientWidth * 0.8), behavior: 'smooth' }));
  next.addEventListener('click', () => list.scrollBy({ left: Math.max(240, list.clientWidth * 0.8), behavior: 'smooth' }));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      cancel();
    }
    if (event.key === 'Enter' && allMovies.length === 1) {
      ipcRenderer.invoke('screenshot:movie-picker-select', allMovies[0].id);
    }
  });

  requestAnimationFrame(updateArrows);
});
