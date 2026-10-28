// Hall of Oddities. Two modes, set by data-oddities on the section:
//   "showcase" (home page): the latest six with reactions and a link to the hall
//   "full" (/oddities/): the whole gallery, uploads for Discord members and the Ringleaders' review queue
// The server re-checks everything; the checks here only save a wasted upload.
(() => {
  const root = document.querySelector('[data-oddities]');
  if (!root) return;
  const full = root.dataset.oddities === 'full';
  const grids = { image: root.querySelector('#odd-pictures'), clip: root.querySelector('#odd-clips') };
  const SHOWCASE = { image: 6, clip: 3 };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const panel = full ? root.querySelector('#odd-panel') : null;
  const queueBox = full ? root.querySelector('#odd-queue') : null;
  const RETURN = full ? '/oddities/' : '/?oddities';
  const REACTIONS = [
    ['like', '👍', 'Like'], ['love', '❤️', 'Love'], ['laugh', '😂', 'Laugh'],
    ['scream', '😱', 'Scream'], ['dead', '💀', 'Dead'], ['angry', '😡', 'Angry']
  ];

  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const CLIP_TYPES = ['video/mp4', 'video/webm'];
  let limits = { imageMB: 10, clipMB: 500, partMB: 25 };
  let me = { signedIn: false, member: false, manager: false };

  function el(tag, attrs = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of [].concat(kids)) if (k) n.append(k);
    return n;
  }

  const sameOriginPath = (p) => typeof p === 'string' && /^\/api\/oddities\/[a-f0-9]{24}\/media$/.test(p);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  async function postJSON(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Try again.');
    return data;
  }

  // ------------------------------------------------------------ gallery

  function mediaFor(o, { eager = false } = {}) {
    if (!sameOriginPath(o.src)) return null;
    if (o.kind === 'clip') return clipBox(o);
    const img = el('img', { src: o.src, alt: o.caption || `Screenshot from ${o.by}`, loading: eager ? 'eager' : 'lazy', decoding: 'async' });
    if (o.width && o.height) {
      img.width = o.width;
      img.height = o.height;
    }
    return el('a', { class: 'odd-media', href: o.src, target: '_blank', rel: 'noopener' }, img);
  }

  // Clips preview silently on hover (or keyboard focus); sound only starts when someone clicks.
  function clipBox(o) {
    const video = el('video', { class: 'odd-video', src: `${o.src}#t=0.1`, preload: 'metadata', playsinline: true, loop: true, 'aria-hidden': 'true' });
    video.muted = true;
    let live = false;
    const play = el('button', { type: 'button', class: 'odd-clip-play', 'aria-label': `Play “${o.caption || 'clip'}” with sound` }, [
      el('span', { class: 'odd-clip-icon', 'aria-hidden': 'true', text: '▶' }),
      el('span', { class: 'odd-clip-hint', text: 'Click for sound' })
    ]);
    const box = el('div', { class: 'odd-media odd-clipbox' }, [video, play]);
    const preview = () => { if (!live && !calm.matches) video.play().catch(() => {}); };
    const stop = () => { if (!live) { video.pause(); video.currentTime = 0.1; } };
    box.addEventListener('mouseenter', preview);
    box.addEventListener('mouseleave', stop);
    play.addEventListener('focus', preview);
    play.addEventListener('blur', stop);
    play.addEventListener('click', () => {
      live = true;
      // Only one clip talks at a time.
      for (const v of document.querySelectorAll('.odd-video')) if (v !== video) { v.pause(); v.muted = true; }
      play.remove();
      video.removeAttribute('aria-hidden');
      video.setAttribute('aria-label', o.caption || 'Clip');
      video.controls = true;
      video.loop = false;
      video.muted = false;
      video.currentTime = 0;
      video.play().catch(() => {});
      video.focus();
    });
    return box;
  }

  function reactionBar(o) {
    const bar = el('div', { class: 'odd-reacts', role: 'group', 'aria-label': 'Reactions' });
    const counts = { ...(o.reactions || {}) };
    let mine = new Set(o.myReactions || []);
    const draw = () => {
      bar.replaceChildren(...REACTIONS.map(([key, emoji, label]) => {
        const n = counts[key] || 0;
        const btn = el('button', {
          type: 'button',
          class: 'odd-react',
          'aria-pressed': me.member ? String(mine.has(key)) : null,
          'aria-label': `${label}${n ? `, ${n}` : ''}`,
          title: me.member ? label : me.signedIn ? 'Only members of the Discord can react' : 'Verify with Discord to react'
        }, [el('span', { 'aria-hidden': 'true', text: emoji }), n ? el('span', { class: 'odd-react-n', 'aria-hidden': 'true', text: String(n) }) : null]);
        btn.addEventListener('click', async () => {
          if (!me.signedIn) return void (location.href = `/auth/login?return=${encodeURIComponent(RETURN)}`);
          if (!me.member) return;
          btn.disabled = true;
          try {
            const r = await postJSON(`/api/oddities/${o.id}/react`, { reaction: key });
            for (const k of Object.keys(counts)) delete counts[k];
            Object.assign(counts, r.reactions || {});
            mine = new Set(r.myReactions || []);
            draw();
            bar.querySelector(`[aria-label^="${label}"]`)?.focus();
          } catch {
            btn.disabled = false;
          }
        });
        return btn;
      }));
    };
    draw();
    return bar;
  }

  function card(o, actions = [], { reactions = true } = {}) {
    const media = mediaFor(o);
    if (!media) return null;
    return el('figure', { class: 'odd-card' }, [
      media,
      el('figcaption', {}, [
        el('h3', { class: 'odd-caption', text: o.caption || 'Untitled' }),
        el('p', { class: 'odd-meta' }, ['Uploaded by ', el('strong', { text: o.by }), ` · ${when(o.at)}`]),
        reactions ? reactionBar(o) : null,
        actions.length ? el('div', { class: 'odd-actions' }, actions) : null
      ])
    ]);
  }

  function actionButton(label, cls, onClick) {
    return el('button', { type: 'button', class: `btn btn-ghost btn-sm ${cls}`, text: label, onclick: onClick });
  }

  const EMPTY = {
    image: 'No grotesques on the walls yet. Be the first to hang one.',
    clip: 'The reel is blank… for now. Bring us a scream.'
  };

  function renderGallery(kind, items) {
    const grid = grids[kind];
    if (!grid) return;
    grid.replaceChildren();
    if (!items.length) {
      grid.append(el('p', { class: 'muted odd-empty', text: EMPTY[kind] }));
      return;
    }
    for (const o of items) {
      const actions = [];
      if (!full) {
        // the showcase only reacts; reporting and removing happen in the hall
      } else if (me.manager || o.mine) {
        actions.push(actionButton('Remove', 'odd-remove', async (e) => {
          if (!confirm('Remove this from the Hall of Oddities? It will be deleted.')) return;
          e.target.disabled = true;
          try { await postJSON(`/api/oddities/${o.id}/remove`); load(); } catch (err) { alert(err.message); e.target.disabled = false; }
        }));
      } else if (me.member) {
        actions.push(actionButton('Report', 'odd-report', async (e) => {
          if (!confirm('Report this to the Ringleaders as breaking the rules?')) return;
          e.target.disabled = true;
          try { const r = await postJSON(`/api/oddities/${o.id}/report`); e.target.textContent = 'Reported'; if (r.hidden) load(); } catch (err) { alert(err.message); e.target.disabled = false; }
        }));
      }
      const c = card(o, actions);
      if (c) grid.append(c);
    }
  }

  function renderQueue(queue) {
    if (!queueBox) return;
    queueBox.replaceChildren();
    if (!me.manager) {
      queueBox.hidden = true;
      return;
    }
    queueBox.hidden = false;
    queueBox.append(el('h3', { text: `Waiting for review (${queue.length})` }));
    queueBox.append(el('p', { class: 'muted small' }, ['This queue is also ', el('a', { href: '/big-tent/#oddities-review', text: 'Backstage on The Big Tent' }), '. Your own uploads go straight up.']));
    if (!queue.length) {
      queueBox.append(el('p', { class: 'muted', text: 'Nothing waiting. The crowd is behaving.' }));
      return;
    }
    const list = el('div', { class: 'odd-grid odd-queue-grid' });
    for (const o of queue) {
      const note = [o.kind === 'clip' ? 'Clip: needs a human look' : `Scan: ${o.scan || 'unknown'}`, o.reports ? `${o.reports} report${o.reports === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      const c = card(o, [
        actionButton('Approve', 'odd-approve', async (e) => { e.target.disabled = true; try { await postJSON(`/api/oddities/${o.id}/approve`); load(); } catch (err) { alert(err.message); e.target.disabled = false; } }),
        actionButton('Remove', 'odd-remove', async (e) => {
          if (!confirm('Delete this upload?')) return;
          e.target.disabled = true;
          try { await postJSON(`/api/oddities/${o.id}/remove`); load(); } catch (err) { alert(err.message); e.target.disabled = false; }
        })
      ]);
      if (c) {
        c.querySelector('.odd-reacts')?.remove();
        c.querySelector('figcaption').prepend(el('p', { class: 'odd-scan', text: note }));
        list.append(c);
      }
    }
    queueBox.append(list);
  }

  // ------------------------------------------------------------ upload panel

  function renderPanel() {
    panel.replaceChildren();
    if (!me.signedIn) {
      panel.append(
        el('p', { text: 'Members of the Belpire Discord can add screenshots and clips.' }),
        el('a', { class: 'btn btn-gold', href: `/auth/login?return=${encodeURIComponent(RETURN)}`, text: 'Verify with Discord' })
      );
      return;
    }
    if (!me.member) {
      panel.append(
        el('p', { text: 'Only members of the Belpire Discord can add oddities.' }),
        el('a', { class: 'btn btn-gold', href: '/join/', text: 'Join the Discord' })
      );
      return;
    }
    panel.append(uploadForm());
  }

  function uploadForm() {
    let chosen = null; // Blob or File
    let previewUrl = null;
    const fileInput = el('input', { type: 'file', id: 'odd-file', class: 'visually-hidden', accept: [...IMAGE_TYPES, ...CLIP_TYPES].join(',') });
    const status = el('p', { class: 'odd-status', role: 'status', 'aria-live': 'polite' });
    const preview = el('div', { class: 'odd-preview', hidden: true });
    const caption = el('input', { type: 'text', id: 'odd-caption', maxlength: '60', required: true, placeholder: 'e.g. The mimic got me', autocomplete: 'off' });
    const progress = el('progress', { class: 'odd-progress', max: '100', value: '0', hidden: true });
    const submit = el('button', { type: 'submit', class: 'btn btn-gold', text: 'Add to the Hall', disabled: true });

    const say = (msg, bad = false) => {
      status.textContent = msg;
      status.classList.toggle('bad', bad);
    };

    function choose(blob, name) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      chosen = null;
      preview.hidden = true;
      preview.replaceChildren();
      submit.disabled = true;
      if (!blob) return;
      const isImage = IMAGE_TYPES.includes(blob.type);
      const isClip = CLIP_TYPES.includes(blob.type);
      if (!isImage && !isClip) return say(blob.type === 'image/bmp' ? 'Bitmap (.bmp) files aren\'t allowed. Save it as PNG or JPEG.' : 'Use a PNG, JPEG or WebP picture, or an MP4 or WebM clip.', true);
      const max = (isImage ? limits.imageMB : limits.clipMB) * 1024 * 1024;
      if (blob.size > max) return say(`${isImage ? 'Pictures' : 'Clips'} can be up to ${isImage ? limits.imageMB : limits.clipMB} MB.`, true);
      chosen = blob;
      previewUrl = URL.createObjectURL(blob);
      preview.append(isImage ? el('img', { src: previewUrl, alt: 'Preview of your upload' }) : el('video', { src: previewUrl, controls: true, muted: true, playsinline: true }));
      preview.append(el('p', { class: 'muted small', text: `${name || 'Screenshot'} · ${(blob.size / 1024 / 1024).toFixed(1)} MB` }));
      preview.hidden = false;
      submit.disabled = false;
      say(isClip ? 'Clips are checked by a Ringleader before they go up.' : 'Pictures are scanned automatically before they go up.');
    }

    fileInput.addEventListener('change', () => choose(fileInput.files[0], fileInput.files[0]?.name));

    const pick = el('label', { for: 'odd-file', class: 'btn btn-ghost', text: 'Choose a file' });
    const shot = navigator.mediaDevices?.getDisplayMedia
      ? el('button', { type: 'button', class: 'btn btn-ghost', text: 'Take a screenshot', onclick: async () => {
        try {
          choose(await captureScreen(), 'Screenshot');
        } catch (err) {
          if (err?.name !== 'NotAllowedError') say('Couldn\'t take a screenshot. Try choosing a file instead.', true);
        }
      } })
      : null;

    async function uploadImage(blob, text) {
      progress.hidden = false;
      progress.removeAttribute('value');
      const res = await fetch(`/api/oddities/image?caption=${encodeURIComponent(text)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Upload failed. Try again.');
      return data;
    }

    async function uploadClip(blob, text) {
      const start = await postJSON('/api/oddities/clip', { size: blob.size, mime: blob.type, caption: text });
      const parts = [];
      progress.hidden = false;
      progress.value = 0;
      try {
        for (let n = 1; n <= start.parts; n++) {
          const slice = blob.slice((n - 1) * start.partSize, n * start.partSize);
          let res;
          for (let attempt = 0; attempt < 2; attempt++) {
            res = await fetch(`/api/oddities/clip/${start.id}/part/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: slice });
            if (res.ok || res.status < 500) break;
          }
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || 'Upload failed. Try again.');
          parts.push({ partNumber: data.partNumber, etag: data.etag });
          progress.value = Math.round((n / start.parts) * 100);
          say(`Uploading… ${progress.value}%`);
        }
        return await postJSON(`/api/oddities/clip/${start.id}/complete`, { parts });
      } catch (err) {
        fetch(`/api/oddities/clip/${start.id}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }
    }

    const form = el('form', { class: 'odd-form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!chosen) return;
      if (!caption.value.trim()) {
        say('Give it a short title first.', true);
        caption.focus();
        return;
      }
      submit.disabled = true;
      say('Uploading and checking…');
      try {
        const data = CLIP_TYPES.includes(chosen.type) ? await uploadClip(chosen, caption.value) : await uploadImage(chosen, caption.value);
        say(data.message || 'Done.');
        choose(null);
        fileInput.value = '';
        caption.value = '';
        load();
      } catch (err) {
        say(err.message, true);
        submit.disabled = false;
      } finally {
        progress.hidden = true;
      }
    } }, [
      el('div', { class: 'odd-pickers' }, [fileInput, pick, shot]),
      preview,
      el('label', { for: 'odd-caption', class: 'odd-label', text: 'Give it a short title' }),
      caption,
      el('div', { class: 'odd-submit' }, [submit, progress]),
      status,
      el('p', { class: 'muted small odd-rules', text: `PNG, JPEG or WebP up to ${limits.imageMB} MB · MP4 or WebM up to ${limits.clipMB} MB. Game and horror gore is welcome; nudity, real-world gore, hate and personal details are not. Location data is stripped from pictures. Your Discord name is shown as the uploader.` })
    ]);
    return form;
  }

  // One frame from a screen, window or tab the person picks, as a WebP (or JPEG) picture.
  async function captureScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      const video = el('video', { muted: true, playsinline: true });
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 300)));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.92));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      return blob;
    } finally {
      for (const t of stream.getTracks()) t.stop();
    }
  }

  // ------------------------------------------------------------ load

  async function load() {
    const get = async (kind) => {
      const limit = full ? 48 : SHOWCASE[kind];
      const res = await fetch(`/api/oddities?kind=${kind}&limit=${limit}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      return res.json();
    };
    try {
      const [pics, clips] = await Promise.all([get('image'), get('clip')]);
      me = pics.me || me;
      limits = pics.limits || limits;
      renderGallery('image', Array.isArray(pics.items) ? pics.items : []);
      renderGallery('clip', Array.isArray(clips.items) ? clips.items : []);
      if (!full) return;
      renderQueue(Array.isArray(pics.queue) ? pics.queue : []);
      if (!panel.dataset.ready) {
        renderPanel();
        panel.dataset.ready = '1';
      }
    } catch {
      for (const g of Object.values(grids)) g?.replaceChildren(el('p', { class: 'muted odd-empty', text: 'The Hall of Oddities is closed right now. Check back soon.' }));
    }
  }

  load();
  if (!full && new URLSearchParams(location.search).has('oddities')) root.scrollIntoView();
})();
