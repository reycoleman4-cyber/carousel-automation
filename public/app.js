const API = '';

let supabaseClient = null;
let authReady = false;

async function initAuth() {
  if (authReady) return supabaseClient;
  try {
    const res = await fetch(`${API}/api/auth/config`);
    if (!res.ok) {
      authReady = true;
      return null;
    }
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    if (!supabaseUrl || !supabaseAnonKey) return null;
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    authReady = true;
    return supabaseClient;
  } catch (e) {
    console.warn('Auth init failed:', e);
    authReady = true;
    return null;
  }
}

function showAuthView() {
  const root = document.getElementById('appRoot') || document.querySelector('.app');
  if (root) {
    root.classList.add('auth-screen');
    root.classList.remove('app-screen');
  }
  const authView = document.getElementById('authView');
  const appShell = document.getElementById('appShell');
  if (authView) authView.hidden = false;
  if (appShell) appShell.hidden = true;
  if ((window.location.hash || '#/').split('/')[0].replace('#', '') !== 'login') {
    window.location.hash = '#/login';
  }
}

function showAppView() {
  const root = document.getElementById('appRoot') || document.querySelector('.app');
  if (root) {
    root.classList.add('app-screen');
    root.classList.remove('auth-screen');
  }
  const authView = document.getElementById('authView');
  const appShell = document.getElementById('appShell');
  if (authView) authView.hidden = true;
  if (appShell) appShell.hidden = false;
  if ((window.location.hash || '#/').split('/')[0].replace('#', '') === 'login') {
    window.location.hash = '#/';
  }
}

async function checkAuthAndRender() {
  const supabase = await initAuth();
  if (!supabase) {
    showAppView();
    render();
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    showAuthView();
    setupAuthForms();
    return;
  }
  showAppView();
  render();
}

function authSwitchTab(isLogin) {
  const loginForm = document.getElementById('authLoginForm');
  const signupForm = document.getElementById('authSignupForm');
  const tabs = document.querySelectorAll('.auth-tab');
  const authError = document.getElementById('authError');
  const authSignupError = document.getElementById('authSignupError');
  const authSignupSuccess = document.getElementById('authSignupSuccess');
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === (isLogin ? 'login' : 'signup')));
  if (loginForm) {
    loginForm.hidden = !isLogin;
    loginForm.style.display = isLogin ? '' : 'none';
  }
  if (signupForm) {
    signupForm.hidden = isLogin;
    signupForm.style.display = isLogin ? 'none' : '';
  }
  if (authError) authError.hidden = true;
  if (authSignupError) authSignupError.hidden = true;
  if (authSignupSuccess) authSignupSuccess.hidden = true;
}

function setupAuthForms() {
  authSwitchTab(true);
}

async function handleAuthLogin(e) {
  e.preventDefault();
  const authError = document.getElementById('authError');
  const email = (document.getElementById('authEmail')?.value || '').trim();
  const password = document.getElementById('authPassword')?.value || '';
  if (authError) authError.hidden = true;
  if (!email || !password) {
    if (authError) { authError.textContent = 'Please enter email and password.'; authError.hidden = false; }
    return;
  }
  if (!supabaseClient) {
    if (authError) { authError.textContent = 'Auth not configured. Please refresh the page.'; authError.hidden = false; }
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.session) {
      window.location.hash = '#/';
      showAppView();
      render();
    } else {
      if (authError) { authError.textContent = 'Login succeeded but no session. Please try again.'; authError.hidden = false; }
    }
  } catch (err) {
    let msg = err.message || 'Login failed';
    if (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('api key')) {
      msg = 'Invalid Supabase anon key. In Supabase Dashboard → Project Settings → API, copy the "anon" "public" key (JWT starting with eyJ) and set SUPABASE_ANON_KEY in your .env, then restart the server.';
    }
    if (authError) { authError.textContent = msg; authError.hidden = false; }
  }
}

async function handleAuthSignup(e) {
  e.preventDefault();
  const authSignupError = document.getElementById('authSignupError');
  const authSignupSuccess = document.getElementById('authSignupSuccess');
  const email = (document.getElementById('authSignupEmail')?.value || '').trim();
  const password = document.getElementById('authSignupPassword')?.value || '';
  const fullName = (document.getElementById('authSignupFullName')?.value || '').trim();
  if (authSignupError) authSignupError.hidden = true;
  if (authSignupSuccess) authSignupSuccess.hidden = true;
  if (!email || !password) {
    if (authSignupError) { authSignupError.textContent = 'Please enter email and password.'; authSignupError.hidden = false; }
    return;
  }
  if (!supabaseClient) {
    if (authSignupError) { authSignupError.textContent = 'Auth not configured. Please refresh the page.'; authSignupError.hidden = false; }
    return;
  }
  if (password.length < 6) {
    if (authSignupError) { authSignupError.textContent = 'Password must be at least 6 characters'; authSignupError.hidden = false; }
    return;
  }
  try {
    const { error } = await supabaseClient.auth.signUp({ email, password, options: fullName ? { data: { full_name: fullName } } : undefined });
    if (error) throw error;
    if (authSignupSuccess) authSignupSuccess.hidden = false;
    if (authSignupError) authSignupError.hidden = true;
  } catch (err) {
    if (authSignupError) { authSignupError.textContent = err.message || 'Sign up failed'; authSignupError.hidden = false; }
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch (_) { return {}; }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Show a non-blocking toast notification. type: 'success' | 'error' | 'info' */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = String(message ?? '');
  container.appendChild(toast);
  const remove = () => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/** Show a centered loading spinner in the main content area */
function showViewLoading(label = 'Loading…') {
  const main = document.getElementById('main');
  if (main) main.innerHTML = `<div class="view-loading"><div class="spinner"></div><span>${escapeHtml(label)}</span></div>`;
}

/** Show an alert in a styled modal (replaces window.alert). Returns a Promise that resolves when dismissed. */
function showAlert(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('appDialog');
    const msgEl = document.getElementById('appDialogMessage');
    const promptWrap = document.getElementById('appDialogPromptWrap');
    const actionsEl = document.getElementById('appDialogActions');
    if (!overlay || !msgEl || !actionsEl) return resolve();
    msgEl.textContent = String(message ?? '');
    promptWrap.hidden = true;
    actionsEl.innerHTML = '<button type="button" class="btn btn-primary" data-result="ok">OK</button>';
    overlay.hidden = false;
    const done = () => { overlay.hidden = true; overlay.onclick = null; resolve(); };
    actionsEl.querySelector('[data-result="ok"]').onclick = done;
    overlay.onclick = (e) => { if (e.target === overlay) done(); };
  });
}

/** Show a confirm dialog in a styled modal (replaces window.confirm). Returns Promise<boolean>. */
function showConfirm(message, options = {}) {
  const { confirmLabel = 'OK', cancelLabel = 'Cancel' } = options;
  return new Promise((resolve) => {
    const overlay = document.getElementById('appDialog');
    const msgEl = document.getElementById('appDialogMessage');
    const promptWrap = document.getElementById('appDialogPromptWrap');
    const actionsEl = document.getElementById('appDialogActions');
    if (!overlay || !msgEl || !actionsEl) return resolve(false);
    msgEl.textContent = String(message ?? '');
    promptWrap.hidden = true;
    actionsEl.innerHTML = `<button type="button" class="btn btn-secondary" data-result="cancel">${escapeHtml(cancelLabel)}</button><button type="button" class="btn btn-primary" data-result="ok">${escapeHtml(confirmLabel)}</button>`;
    overlay.hidden = false;
    const done = (ok) => { overlay.hidden = true; overlay.onclick = null; resolve(ok); };
    actionsEl.querySelector('[data-result="cancel"]').onclick = () => done(false);
    actionsEl.querySelector('[data-result="ok"]').onclick = () => done(true);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
  });
}

/** Show a prompt in a styled modal (replaces window.prompt). Returns Promise<string|null>. */
function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('appDialog');
    const msgEl = document.getElementById('appDialogMessage');
    const promptWrap = document.getElementById('appDialogPromptWrap');
    const inputEl = document.getElementById('appDialogInput');
    const actionsEl = document.getElementById('appDialogActions');
    if (!overlay || !msgEl || !promptWrap || !inputEl || !actionsEl) return resolve(null);
    msgEl.textContent = String(message ?? '');
    inputEl.value = String(defaultValue ?? '');
    promptWrap.hidden = false;
    actionsEl.innerHTML = `<button type="button" class="btn btn-secondary" data-result="cancel">Cancel</button><button type="button" class="btn btn-primary" data-result="ok">OK</button>`;
    overlay.hidden = false;
    inputEl.focus();
    const done = (value) => { overlay.hidden = true; promptWrap.hidden = true; overlay.onclick = null; resolve(value); };
    actionsEl.querySelector('[data-result="cancel"]').onclick = () => done(null);
    actionsEl.querySelector('[data-result="ok"]').onclick = () => done(inputEl.value.trim());
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') done(inputEl.value.trim()); if (e.key === 'Escape') done(null); };
  });
}

// --- Avatar version cache (prevents re-downloading unchanged avatars on every render) ---
const _avatarVersions = {};
function getAvatarVersion(type, id) {
  const key = `${type}-${id}`;
  if (!_avatarVersions[key]) _avatarVersions[key] = 1;
  return _avatarVersions[key];
}
function bumpAvatarVersion(type, id) {
  _avatarVersions[`${type}-${id}`] = Date.now();
}

// --- API response cache (avoids re-fetching project/campaign lists on every tab switch) ---
const _apiCache = {};
function apiCached(key, ttlMs, fetchFn) {
  const hit = _apiCache[key];
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fetchFn().then((data) => { _apiCache[key] = { data, ts: Date.now() }; return data; });
}
function invalidateApiCache(key) { delete _apiCache[key]; }

// --- API ---
function apiProjects() {
  return apiCached('projects', 30000, () => apiWithAuth(`${API}/api/projects`).then((r) => r.json()));
}
function apiProject(projectId) {
  return apiWithAuth(`${API}/api/projects/${projectId}`).then((r) => {
    if (!r.ok) return null;
    return r.json();
  });
}
function apiCreateProject(name) {
  return apiWithAuth(`${API}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || 'New project' }),
  }).then((r) => r.json()).then((d) => { invalidateApiCache('projects'); return d; });
}
function apiUpdateProject(id, data) {
  return apiWithAuth(`${API}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiDeleteProject(id) {
  return apiWithAuth(`${API}/api/projects/${id}`, { method: 'DELETE' }).then((r) => r.json()).then((d) => { invalidateApiCache('projects'); return d; });
}
function apiRecurringPagesGet() {
  return apiWithAuth(`${API}/api/recurring-pages`).then((r) => r.json()).then((d) => d.projectIds || []);
}
function apiRecurringPagesAdd(projectId) {
  return apiWithAuth(`${API}/api/recurring-pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: parseInt(projectId, 10) }),
  }).then((r) => r.json()).then((d) => d.projectIds || []);
}
function apiRecurringPagesRemove(projectId) {
  return apiWithAuth(`${API}/api/recurring-pages/${projectId}`, { method: 'DELETE' }).then((r) => r.json()).then((d) => d.projectIds || []);
}
function apiCampaigns(projectId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns`).then((r) => r.json());
}
function apiCreateCampaign(projectId, name, options) {
  const body = { name: name || 'New campaign' };
  if (options && options.isPageNative) body.isPageNative = true;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).then((d) => { invalidateApiCache('allCampaigns'); return d; });
}
function apiCampaign(projectId, campaignId, postTypeId) {
  const url = postTypeId ? `${API}/api/projects/${projectId}/campaigns/${campaignId}?postTypeId=${encodeURIComponent(postTypeId)}` : `${API}/api/projects/${projectId}/campaigns/${campaignId}`;
  return apiWithAuth(url).then((r) => r.json());
}
function apiUpdateCampaign(projectId, campaignId, data, postTypeId) {
  const body = { ...data };
  if (postTypeId) body.postTypeId = postTypeId;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || json.message || `Request failed (${r.status})`);
    return json;
  });
}
function apiDeleteCampaign(projectId, campaignId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}`, { method: 'DELETE' }).then((r) => r.json()).then((d) => { invalidateApiCache('allCampaigns'); return d; });
}
function apiDeleteCampaignById(campaignId) {
  return apiWithAuth(`${API}/api/campaigns/${campaignId}`, { method: 'DELETE' }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || text || 'Failed to delete campaign');
    invalidateApiCache('allCampaigns');
    return text ? JSON.parse(text) : {};
  });
}
function apiCampaignFolders(projectId, campaignId, postTypeId, opts) {
  let url = postTypeId ? `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders?postTypeId=${encodeURIComponent(postTypeId)}` : `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders`;
  if (opts && opts.cacheBust) url += (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  return apiWithAuth(url).then((r) => r.json());
}
function apiAddFolder(projectId, campaignId, postTypeId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postTypeId: postTypeId || 'default' }),
  }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error((text && tryParse(text).error) || text || 'Failed to add folder');
    return text ? JSON.parse(text) : {};
  });
}
function apiDeleteFolder(projectId, campaignId, folderNum, postTypeId) {
  const url = postTypeId ? `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}?postTypeId=${encodeURIComponent(postTypeId)}` : `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}`;
  return apiWithAuth(url, { method: 'DELETE' }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || text || 'Failed to delete folder');
    return text ? JSON.parse(text) : {};
  });
}
function apiDeleteFolderImage(projectId, campaignId, folderNum, filename, postTypeId) {
  const base = `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}/images/${encodeURIComponent(filename)}`;
  const url = postTypeId ? `${base}?postTypeId=${encodeURIComponent(postTypeId)}` : base;
  return apiWithAuth(url, { method: 'DELETE' }).then((r) => r.json());
}
function apiDeleteFolderMedia(projectId, campaignId, folderNum, filename, postTypeId) {
  const base = `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}/media/${encodeURIComponent(filename)}`;
  const url = postTypeId ? `${base}?postTypeId=${encodeURIComponent(postTypeId)}` : base;
  return apiWithAuth(url, { method: 'DELETE' }).then((r) => r.json());
}
function apiClearFolder(projectId, campaignId, folderNum, postTypeId) {
  const base = `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}/clear`;
  const url = postTypeId ? `${base}?postTypeId=${encodeURIComponent(postTypeId)}` : base;
  return apiWithAuth(url, { method: 'DELETE' }).then((r) => {
    if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Failed to clear folder')));
    return r.json();
  });
}
function folderImageUrl(projectId, campaignId, folderNum, filename, postTypeId) {
  const base = `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}/images/${encodeURIComponent(filename)}`;
  return postTypeId ? `${base}?postTypeId=${encodeURIComponent(postTypeId)}` : base;
}
function folderMediaUrl(projectId, campaignId, folderNum, filename, postTypeId) {
  const base = `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders/${folderNum}/media/${encodeURIComponent(filename)}`;
  return postTypeId ? `${base}?postTypeId=${encodeURIComponent(postTypeId)}` : base;
}
function apiUploadProjectAvatar(projectId, file) {
  const form = new FormData();
  form.append('avatar', file);
  return apiWithAuth(`${API}/api/projects/${projectId}/avatar`, { method: 'POST', body: form }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) {
      const err = tryParse(text);
      throw new Error(err.error || (text.length < 200 ? text : 'Upload failed'));
    }
    return text ? JSON.parse(text) : {};
  });
}
function projectAvatarUrl(projectId) {
  return `${API}/api/projects/${projectId}/avatar?v=${getAvatarVersion('project', projectId)}`;
}

/** Show the global upload progress bar at the bottom; percent 0–100, label e.g. "Uploading videos…" */
function showUploadProgress(percent, label) {
  const wrap = document.getElementById('uploadProgressWrap');
  const fill = document.getElementById('uploadProgressFill');
  const pctEl = document.getElementById('uploadProgressPct');
  const labelEl = document.getElementById('uploadProgressLabel');
  if (!wrap) return;
  const p = Math.min(100, Math.max(0, percent));
  if (fill) fill.style.width = p + '%';
  if (pctEl) pctEl.textContent = Math.round(p) + '%';
  if (labelEl) labelEl.textContent = label || 'Uploading…';
  wrap.hidden = false;
  wrap.setAttribute('data-visible', 'true');
}

/** Hide the upload progress bar */
function hideUploadProgress() {
  const wrap = document.getElementById('uploadProgressWrap');
  if (!wrap) return;
  wrap.setAttribute('data-visible', 'false');
  wrap.hidden = true;
  const fill = document.getElementById('uploadProgressFill');
  if (fill) fill.style.width = '0%';
}

/** XHR-based campaign folder upload with progress. Same args as apiCampaignUpload; returns same Promise result. */
function campaignUploadWithProgress(projectId, campaignId, folderNum, files, postTypeId, mediaType) {
  const form = new FormData();
  const isVideo = mediaType === 'video' || mediaType === 'video_text';
  const videoExt = /\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i;
  for (const file of Array.from(files)) {
    if (isVideo) {
      const name = file.name || '';
      const hasVideoMime = file.type && file.type.startsWith('video/');
      const hasVideoExt = videoExt.test(name);
      const genericMime = !file.type || file.type === 'application/octet-stream';
      if (hasVideoMime || hasVideoExt || (genericMime && /\.(mp4|mov|webm|avi|mkv|m4v)/i.test(name))) form.append('photo', file);
    } else {
      if (file.type.startsWith('image/')) form.append('photo', file);
    }
  }
  const appended = form.getAll ? form.getAll('photo') : [];
  if (!appended.length) {
    const msg = isVideo
      ? 'No valid video files. Use MP4, MOV, WebM, AVI, MKV, or M4V, or try a different file.'
      : 'No valid image files. Use JPEG, PNG, WebP, or GIF.';
    return Promise.reject(new Error(msg));
  }
  let url = `${API}/api/projects/${projectId}/campaigns/${campaignId}/upload?folder=${folderNum}&projectId=${encodeURIComponent(projectId)}&campaignId=${encodeURIComponent(campaignId)}`;
  if (postTypeId) url += `&postTypeId=${encodeURIComponent(postTypeId)}`;
  if (mediaType === 'video') url += `&mediaType=video`;
  if (mediaType === 'video_text') url += `&mediaType=video_text`;
  const label = isVideo ? 'Uploading videos…' : 'Uploading photos…';
  showUploadProgress(0, label);
  return getAuthHeaders().then((headers) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) showUploadProgress((e.loaded / e.total) * 100, label);
        else showUploadProgress(0, label);
      });
      xhr.addEventListener('load', () => {
        hideUploadProgress();
        const text = xhr.responseText || '';
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(text ? JSON.parse(text) : {}); } catch (_) { resolve({}); }
        } else {
          let msg;
          if (xhr.status === 502 || xhr.status === 503 || xhr.status === 504) {
            msg = 'The server took too long or couldn\'t process your upload. Try a smaller or shorter file, or try again in a moment.';
          } else {
            const err = tryParse(text);
            msg = err?.error || (text && text.length < 200 ? text : null) || `Upload failed (${xhr.status})`;
          }
          reject(new Error(msg));
        }
      });
      xhr.addEventListener('error', () => { hideUploadProgress(); reject(new Error('Upload failed. Check your connection and try again.')); });
      xhr.addEventListener('abort', () => { hideUploadProgress(); reject(new Error('Upload cancelled')); });
      xhr.send(form);
    });
  }).catch((err) => { hideUploadProgress(); return Promise.reject(err); });
}

const ENCODING_JOB_POLL_MS = 2500;
const ENCODING_JOB_POLL_MAX = 300000; // 5 min

function pollEncodingJobUntilDone(jobId) {
  const start = Date.now();
  function poll() {
    return apiWithAuth(`${API}/api/encoding/jobs/${jobId}`).then((r) => r.json()).then((job) => {
      if (job.status === 'completed') {
        const url = job.result && job.result.url;
        return {
          webContentUrls: url ? [url] : [],
          webContentBase64: [],
          blotatoSent: !!(job.payload && job.payload.sendToBlotato),
          blotatoSentAsDraft: !!(job.payload && job.payload.draft),
          blotatoError: null,
        };
      }
      if (job.status === 'failed') {
        const err = job.result && job.result.error;
        return Promise.reject(new Error(err || 'Encoding failed'));
      }
      if (Date.now() - start > ENCODING_JOB_POLL_MAX) return Promise.reject(new Error('Encoding timed out'));
      return new Promise((resolve) => setTimeout(resolve, ENCODING_JOB_POLL_MS)).then(poll);
    });
  }
  return poll();
}

function apiCampaignRun(projectId, campaignId, textStylePerFolder, textOptionsPerFolder, sendAsDraft, addMusicToCarousel, postTypeId) {
  const body = {};
  if (postTypeId) body.postTypeId = postTypeId;
  if (Array.isArray(textStylePerFolder) && textStylePerFolder.length) body.textStylePerFolder = textStylePerFolder;
  if (Array.isArray(textOptionsPerFolder) && textOptionsPerFolder.length) body.textOptionsPerFolder = textOptionsPerFolder;
  if (sendAsDraft === true) body.sendAsDraft = true;
  if (addMusicToCarousel === true) body.addMusicToCarousel = true;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).then((data) => {
    if (data.jobId && data.status === 'queued') return pollEncodingJobUntilDone(data.jobId);
    return data;
  });
}
function apiTextStylePreview(projectId, campaignId, folderNum, textStyle, sampleText, textOptionsPerFolder, signal, postTypeId) {
  const body = { folderNum, textStyle, sampleText };
  if (postTypeId) body.postTypeId = postTypeId;
  if (Array.isArray(textOptionsPerFolder)) body.textOptionsPerFolder = textOptionsPerFolder;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }).then((r) => {
    if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Preview failed')));
    return r.json();
  });
}
function apiVideoTextPreview(projectId, campaignId, postTypeId, textStylePerFolder, textOptionsPerFolder, signal) {
  const body = { postTypeId };
  if (Array.isArray(textStylePerFolder)) body.textStylePerFolder = textStylePerFolder;
  if (Array.isArray(textOptionsPerFolder)) body.textOptionsPerFolder = textOptionsPerFolder;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }).then((r) => {
    if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Preview failed')));
    return r.json();
  });
}
function apiCampaignLatest(projectId, campaignId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/latest`).then((r) => r.json());
}
function apiClearCampaignUrls(projectId, campaignId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/latest`, { method: 'DELETE' }).then((r) => r.json());
}
function apiAllCampaigns() {
  return apiCached('allCampaigns', 30000, () => apiWithAuth(`${API}/api/campaigns`).then((r) => r.json()));
}
function apiCreateCampaignWithPages(name, pageIds) {
  return apiWithAuth(`${API}/api/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || 'New campaign', pageIds }),
  }).then((r) => r.json());
}
function apiUpdateCampaignPages(campaignId, pageIds) {
  return apiWithAuth(`${API}/api/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageIds }),
  }).then((r) => r.json());
}
function apiUploadCampaignAvatar(campaignId, file) {
  const form = new FormData();
  form.append('avatar', file);
  return apiWithAuth(`${API}/api/campaigns/${campaignId}/avatar`, { method: 'POST', body: form }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || (text.length < 200 ? text : 'Upload failed'));
    return text ? JSON.parse(text) : {};
  });
}
function campaignAvatarUrl(campaignId) {
  return `${API}/api/campaigns/${campaignId}/avatar?v=${getAvatarVersion('campaign', campaignId)}`;
}
function trendAvatarUrl(trendId) {
  return `${API}/api/trends/${trendId}/avatar?v=${getAvatarVersion('trend', trendId)}`;
}
function apiUploadTrendAvatar(trendId, file) {
  const form = new FormData();
  form.append('avatar', file);
  return apiWithAuth(`${API}/api/trends/${trendId}/avatar`, { method: 'POST', body: form }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || (text.length < 200 ? text : 'Upload failed'));
    return text ? JSON.parse(text) : {};
  });
}

function apiTrends(campaignId) {
  const url = campaignId != null ? `${API}/api/trends?campaignId=${encodeURIComponent(campaignId)}` : `${API}/api/trends`;
  return apiWithAuth(url).then((r) => r.json());
}
function apiTrend(trendId) {
  return apiWithAuth(`${API}/api/trends/${trendId}`).then((r) => r.json());
}
function apiCreateTrend(name, pageIds, campaignId) {
  const body = { name: name || 'New trend', pageIds };
  if (campaignId != null) body.campaignId = String(campaignId);
  return apiWithAuth(`${API}/api/trends`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => {
    return r.json().then((data) => {
      if (!r.ok) return Promise.reject(new Error(data && data.error ? data.error : 'Failed to create trend'));
      return data;
    });
  });
}
function apiUpdateTrend(trendId, data) {
  return apiWithAuth(`${API}/api/trends/${trendId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiDeleteTrend(trendId) {
  return apiWithAuth(`${API}/api/trends/${trendId}`, { method: 'DELETE' }).then((r) => r.json());
}
function apiTrendPageImages(trendId, pageIndex) {
  return apiWithAuth(`${API}/api/trends/${trendId}/pages/${pageIndex}/images`).then((r) => r.json());
}
function apiTrendPageUpload(trendId, pageIndex, files) {
  const form = new FormData();
  for (const f of files) form.append('photo', f);
  return apiWithAuth(`${API}/api/trends/${trendId}/pages/${pageIndex}/upload`, { method: 'POST', body: form }).then((r) => r.json());
}
function apiTrendPageFolders(trendId, pageIndex) {
  return apiWithAuth(`${API}/api/trends/${trendId}/pages/${pageIndex}/folders`).then((r) => r.json());
}
function apiTrendPageFolderImages(trendId, pageIndex, folderNum) {
  return apiWithAuth(`${API}/api/trends/${trendId}/pages/${pageIndex}/folders/${folderNum}/images`).then((r) => r.json());
}
function apiTrendPageFolderUpload(trendId, pageIndex, folderNum, files) {
  const form = new FormData();
  for (const f of files) form.append('photo', f);
  return apiWithAuth(`${API}/api/trends/${trendId}/pages/${pageIndex}/folders/${folderNum}/upload`, { method: 'POST', body: form }).then((r) => {
    if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d && d.error ? d.error : 'Upload failed')));
    return r.json();
  });
}

/** XHR-based trend folder upload with progress bar. */
function trendUploadWithProgress(trendId, pageIndex, folderNum, files) {
  const form = new FormData();
  for (const f of files) form.append('photo', f);
  const url = `${API}/api/trends/${trendId}/pages/${pageIndex}/folders/${folderNum}/upload`;
  showUploadProgress(0, 'Uploading photos…');
  return getAuthHeaders().then((headers) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) showUploadProgress((e.loaded / e.total) * 100, 'Uploading photos…');
        else showUploadProgress(0, 'Uploading photos…');
      });
      xhr.addEventListener('load', () => {
        hideUploadProgress();
        const text = xhr.responseText || '';
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(text ? JSON.parse(text) : {}); } catch (_) { resolve({}); }
        } else {
          let msg;
          if (xhr.status === 502 || xhr.status === 503 || xhr.status === 504) {
            msg = 'The server took too long or couldn\'t process your upload. Try a smaller or shorter file, or try again in a moment.';
          } else {
            try {
              const d = JSON.parse(text);
              msg = d && d.error ? d.error : `Upload failed (${xhr.status})`;
            } catch (_) { msg = `Upload failed (${xhr.status})`; }
          }
          reject(new Error(msg));
        }
      });
      xhr.addEventListener('error', () => { hideUploadProgress(); reject(new Error('Upload failed. Check your connection and try again.')); });
      xhr.addEventListener('abort', () => { hideUploadProgress(); reject(new Error('Upload cancelled')); });
      xhr.send(form);
    });
  }).catch((err) => { hideUploadProgress(); return Promise.reject(err); });
}
function trendFolderImageUrl(trendId, pageIndex, folderNum, filename) {
  return `${API}/api/trends/${trendId}/pages/${pageIndex}/folders/${folderNum}/images/${encodeURIComponent(filename)}`;
}
function apiTrendPreview(trendId, pageIndex, folderNum, textStyle, textOptions) {
  return apiWithAuth(`${API}/api/trends/${trendId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageIndex, folderNum, textStyle, textOptions }),
  }).then((r) => r.json());
}
function apiTrendRun(trendId, textStyle, textOptions, sendAsDraft, addMusicToCarousel) {
  const body = { textStyle: textStyle || null, textOptions: textOptions || null };
  if (sendAsDraft === true) body.sendAsDraft = true;
  if (addMusicToCarousel === true) body.addMusicToCarousel = true;
  return apiWithAuth(`${API}/api/trends/${trendId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText || 'Run failed');
    return data;
  });
}
function apiTrendLatest(trendId) {
  return apiWithAuth(`${API}/api/trends/${trendId}/latest`).then((r) => r.json());
}
function apiTrendClearLatest(trendId) {
  return apiWithAuth(`${API}/api/trends/${trendId}/latest`, { method: 'DELETE' }).then((r) => r.json());
}

function apiCreatePostType(projectId, campaignId, name, mediaType) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/postTypes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || 'New post type', mediaType: mediaType || 'photo' }),
  }).then((r) => r.json());
}
function apiUpdatePostType(projectId, campaignId, postTypeId, data) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/postTypes/${encodeURIComponent(postTypeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof data === 'string' ? { name: data } : data),
  }).then((r) => r.json());
}
function apiTextPresets() {
  return apiWithAuth(`${API}/api/text-presets`).then((r) => r.json());
}
function apiCreateTextPreset(name, file) {
  const form = new FormData();
  form.append('name', name);
  form.append('file', file);
  return apiWithAuth(`${API}/api/text-presets`, { method: 'POST', body: form }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.error || (r.status === 401 ? 'Sign in required' : `Upload failed (${r.status})`);
      throw new Error(msg);
    }
    return data;
  });
}
function apiDeleteTextPreset(presetId) {
  return apiWithAuth(`${API}/api/text-presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' }).then((r) => r.json());
}
function apiDeletePostType(projectId, campaignId, postTypeId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/postTypes/${encodeURIComponent(postTypeId)}`, { method: 'DELETE' }).then((r) => r.json());
}
function apiDuplicatePostType(projectId, campaignId, postTypeId, targetCampaignId, targetPageId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/postTypes/${encodeURIComponent(postTypeId)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetCampaignId, targetPageId }),
  }).then((r) => r.json());
}
function apiDeployedPostsCount(campaignId) {
  return apiWithAuth(`${API}/api/campaigns/${campaignId}/deployed-posts-count`).then((r) => r.json());
}
function apiConfig() {
  return fetch(`${API}/api/config`).then((r) => r.json());
}
function apiSaveConfig(data) {
  return fetch(`${API}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiUserSettings() {
  return apiWithAuth(`${API}/api/settings`).then((r) => r.json());
}
function apiSaveUserSettings(data) {
  return apiWithAuth(`${API}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiLogins() {
  return apiWithAuth(`${API}/api/logins`).then((r) => r.json());
}
function apiCreateLogin(data) {
  return apiWithAuth(`${API}/api/logins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiUpdateLogin(id, data) {
  return apiWithAuth(`${API}/api/logins/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiDeleteLogin(id) {
  return apiWithAuth(`${API}/api/logins/${id}`, { method: 'DELETE' }).then((r) => {
    if (r.status === 204) return;
    return r.json().then((d) => Promise.reject(new Error(d.error || 'Delete failed')));
  });
}
function loginAvatarUrl(loginId) {
  return `${API}/api/logins/${loginId}/avatar?t=${Date.now()}`;
}
function apiUploadLoginAvatar(loginId, file) {
  const form = new FormData();
  form.append('avatar', file);
  return fetch(`${API}/api/logins/${loginId}/avatar`, { method: 'POST', body: form }).then((r) => {
    if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Upload failed')));
    return r.json();
  });
}

async function getAuthHeaders() {
  if (!supabaseClient) return {};
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/** Append access token to URL for GET requests (e.g. img src) so server can identify user. */
async function withAuthQuery(url) {
  const h = await getAuthHeaders();
  const token = h.Authorization?.replace('Bearer ', '');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'access_token=' + encodeURIComponent(token);
}

/** Fetch with auth for scoped API (projects, campaigns, calendar, etc.). */
async function apiWithAuth(url, options = {}) {
  const h = await getAuthHeaders();
  const headers = { ...options.headers, ...h };
  return fetch(url, { ...options, headers });
}

/** Load an image URL with auth and return an object URL so it displays reliably (e.g. in folder detail). */
async function fetchImageAsObjectUrl(url) {
  const res = await apiWithAuth(url);
  if (!res.ok) throw new Error('Image load failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Load a video URL with auth and return an object URL so it plays in a video element (avoids blocked/cross-origin issues). */
async function fetchVideoAsObjectUrl(url) {
  const res = await apiWithAuth(url);
  if (!res.ok) throw new Error('Video load failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function apiProfileLookup(username) {
  return getAuthHeaders().then((h) =>
    fetch(`${API}/api/profiles/lookup?username=${encodeURIComponent(username)}`, { headers: h }).then((r) => {
      if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Not found')));
      return r.json();
    })
  );
}
function apiTeam() {
  return getAuthHeaders().then((h) =>
    fetch(`${API}/api/team`, { headers: h }).then((r) => r.json())
  );
}
function apiTeamAdd(username) {
  return getAuthHeaders().then((h) =>
    fetch(`${API}/api/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ username }),
    }).then((r) => {
      if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Failed')));
      return r.json();
    })
  );
}
function apiTeamRemove(userId) {
  return getAuthHeaders().then((h) =>
    fetch(`${API}/api/team/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: h }).then((r) => {
      if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || 'Failed')));
      return r.json();
    })
  );
}

// --- Router ---
function updateNavActive() {
  const parts = (window.location.hash.slice(1) || '/').split('/').filter(Boolean);
  const first = parts[0] || '';
  const home = document.getElementById('navHome');
  const campaigns = document.getElementById('navCampaigns');
  const trends = document.getElementById('navTrends');
  const pages = document.getElementById('navPages');
  const recurringPages = document.getElementById('navRecurringPages');
  [home, campaigns, trends, pages, recurringPages].forEach((el) => { if (el) el.classList.remove('active'); });
  if (first === '') {
    if (home) home.classList.add('active');
  } else if (first === 'pages' || first === 'project') {
    if (pages) pages.classList.add('active');
  } else if (first === 'campaigns' || first === 'campaign') {
    if (campaigns) campaigns.classList.add('active');
  } else if (first === 'trends' || (first && first.startsWith('trends'))) {
    if (trends) trends.classList.add('active');
  } else if (first === 'recurring-pages') {
    if (recurringPages) recurringPages.classList.add('active');
  }
}

/** When true, campaign/post-type views use project-based URLs (#/project/X/content/Y) and "Back to [page]". Set when resolving project content route. */
let projectContentMode = false;
let projectContentProjectId = null;
/** When true, we are in Recurring Pages flow; back link and content links use #/recurring-pages. */
let fromRecurringPages = false;

function getRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'calendar') {
    const datePart = parts[1];
    if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) return { view: 'calendar', calendarDate: datePart };
    return { view: 'calendar' };
  }
  if (parts[0] === 'logins') return { view: 'logins' };
  if (parts[0] === 'settings') return { view: 'settings' };
  if (parts[0] === 'campaigns') {
    if (parts[1]) return { view: 'campaignDetail', campaignId: parts[1] };
    return { view: 'campaigns' };
  }
  if (parts[0] === 'trends') {
    if (parts[1] === 'new') return { view: 'trendNew', campaignId: parts[2] || null };
    if (parts[1]) return { view: 'trendDetail', trendId: parts[1] };
    return { view: 'trends' };
  }
  if (parts[0] === 'project' && parts[1]) {
    if (parts[2] === 'content') {
      const projectId = parts[1];
      const postTypeId = parts[3] || null;
      if (postTypeId) {
        if (parts[4] === 'folder' && parts[5]) return { view: 'projectContentFolder', projectId, postTypeId, folderNum: parts[5] };
        if (parts[4] === 'photos' && parts[5]) return { view: 'projectContentFolderPhotos', projectId, postTypeId, folderNum: parts[5] };
        if (parts[4] === 'videos' && parts[5]) return { view: 'projectContentFolderVideos', projectId, postTypeId, folderNum: parts[5] };
        return { view: 'projectContent', projectId, postTypeId };
      }
      return { view: 'projectContentList', projectId };
    }
    return { view: 'project', projectId: parts[1] };
  }
  if (parts[0] === 'campaign' && parts[1] && parts[2]) {
    if (parts[3] === 'pt' && parts[4]) {
      if (parts[5] === 'folder' && parts[6]) return { view: 'campaignFolder', projectId: parts[1], campaignId: parts[2], postTypeId: parts[4], folderNum: parts[6] };
      if (parts[5] === 'photos' && parts[6]) return { view: 'campaignFolderPhotos', projectId: parts[1], campaignId: parts[2], postTypeId: parts[4], folderNum: parts[6] };
      if (parts[5] === 'videos' && parts[6]) return { view: 'campaignFolderVideos', projectId: parts[1], campaignId: parts[2], postTypeId: parts[4], folderNum: parts[6] };
      return { view: 'campaign', projectId: parts[1], campaignId: parts[2], postTypeId: parts[4] };
    }
    if (parts[3] === 'folder' && parts[4]) return { view: 'campaignFolder', projectId: parts[1], campaignId: parts[2], postTypeId: 'default', folderNum: parts[4] };
    if (parts[3] === 'photos' && parts[4]) return { view: 'campaignFolderPhotos', projectId: parts[1], campaignId: parts[2], postTypeId: 'default', folderNum: parts[4] };
    return { view: 'campaign', projectId: parts[1], campaignId: parts[2], postTypeId: null };
  }
  if (parts[0] === 'pages') return { view: 'pages' };
  if (parts[0] === 'recurring-pages') {
    if (!parts[1]) return { view: 'recurringPages' };
    const projectId = parts[1];
    if (parts[2] === 'content') {
      const postTypeId = parts[3] || null;
      if (postTypeId) {
        if (parts[4] === 'folder' && parts[5]) return { view: 'recurringPageContentFolder', projectId, postTypeId, folderNum: parts[5] };
        if (parts[4] === 'photos' && parts[5]) return { view: 'recurringPageContentFolderPhotos', projectId, postTypeId, folderNum: parts[5] };
        if (parts[4] === 'videos' && parts[5]) return { view: 'recurringPageContentFolderVideos', projectId, postTypeId, folderNum: parts[5] };
        return { view: 'recurringPageContent', projectId, postTypeId };
      }
      return { view: 'recurringPageContentList', projectId };
    }
    return { view: 'recurringPageDetail', projectId };
  }
  return { view: 'dashboard' };
}

function formatTimeAMPM(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

function formatReleaseDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** True if this campaign is the recurring page's own content (not a shared campaign). */
function isRecurringContentCampaign(project, campaign) {
  return (project.pageType || 'recurring') === 'recurring' && campaign.name === 'Recurring posts';
}

/** Display title for a campaign; for recurring page content shows "Your content". */
function campaignDisplayTitle(project, campaign) {
  return isRecurringContentCampaign(project, campaign) ? 'Your content' : (campaign.name || 'Campaign');
}

/** True when we're viewing this project's content via #/project/X/content/... (post type lives in page profile). */
function isProjectContent(pid) {
  return projectContentMode && projectContentProjectId != null && String(projectContentProjectId) === String(pid);
}

/** Run the appropriate campaign/content view for a recurring-pages route. */
function runRecurringPageContentRoute(route, pid, recurringCampaignId) {
  const ptId = route.postTypeId;
  if (route.view === 'recurringPageContentFolder') renderCampaignFolderText(pid, recurringCampaignId, route.folderNum, ptId);
  else if (route.view === 'recurringPageContentFolderPhotos') renderCampaignFolderPhotos(pid, recurringCampaignId, route.folderNum, ptId);
  else if (route.view === 'recurringPageContentFolderVideos') renderCampaignFolderVideos(pid, recurringCampaignId, route.folderNum, ptId);
  else if (route.view === 'recurringPageContentList' || route.view === 'recurringPageDetail') renderCampaign(pid, recurringCampaignId, null);
  else renderCampaign(pid, recurringCampaignId, ptId);
}

/** Link to post type or sub-route; uses project content URL when in project content mode; uses recurring-pages when fromRecurringPages. */
function contentPostTypeLink(pid, cid, ptId, subPath) {
  const enc = (id) => encodeURIComponent(id);
  if (fromRecurringPages && projectContentProjectId != null && String(projectContentProjectId) === String(pid))
    return `#/recurring-pages/${pid}/content/${enc(ptId)}${subPath ? '/' + subPath : ''}`;
  if (isProjectContent(pid)) return `#/project/${pid}/content/${enc(ptId)}${subPath ? '/' + subPath : ''}`;
  return `#/campaign/${pid}/${cid}/pt/${enc(ptId)}${subPath ? '/' + subPath : ''}`;
}

/** Back link from post type list; to project, recurring pages, or campaign list. */
function contentBackLink(pid, cid) {
  if (fromRecurringPages) return '#/recurring-pages';
  if (isProjectContent(pid)) return `#/project/${pid}`;
  return `#/campaign/${pid}/${cid}`;
}

function getCampaignPostsPerWeek(campaign, deployedOnly) {
  if (deployedOnly && !campaign.deployed) return 0;
  const pts = campaign.postTypes || [];
  if (!pts.length) {
    const times = campaign.scheduleTimes || [];
    const days = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    return times.length * days.length;
  }
  let total = 0;
  pts.forEach((pt) => {
    const times = pt.scheduleTimes || campaign.scheduleTimes || [];
    const days = pt.scheduleDaysOfWeek ?? campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    if (pt.scheduleEnabled !== false) total += times.length * days.length;
  });
  return total;
}

function getCampaignTotalDeployedPosts(campaign, pageCount) {
  const perPage = getCampaignPostsPerWeek(campaign, true);
  return perPage * Math.max(1, pageCount || 1);
}

/** True if this specific post type is deployed (for Deployed checkbox). */
function isPostTypeDeployed(campaign, projectId, postTypeId) {
  const pid = typeof projectId === 'number' ? projectId : parseInt(projectId, 10);
  const byPage = campaign.deployedByPage && campaign.deployedByPage[pid];
  if (byPage === undefined || byPage === null) return !!campaign.deployed;
  if (typeof byPage === 'boolean') return byPage;
  return !!(byPage && byPage[postTypeId]);
}

/** True if any post type on this page is deployed (for page card badge). Pages with 0 post types are never deployed. */
function isPageDeployed(campaign, projectId) {
  const pid = typeof projectId === 'number' ? projectId : parseInt(projectId, 10);
  const postTypesOnPage = (campaign.pagePostTypes && campaign.pagePostTypes[pid]) || (campaign.pageIds && campaign.pageIds.includes(pid) ? (campaign.postTypes || []) : []);
  if (!Array.isArray(postTypesOnPage) || postTypesOnPage.length === 0) return false;
  const byPage = campaign.deployedByPage && campaign.deployedByPage[pid];
  if (byPage === undefined || byPage === null) return !!campaign.deployed;
  if (typeof byPage === 'boolean') return byPage;
  if (typeof byPage === 'object' && byPage !== null) return Object.values(byPage).some((x) => !!x);
  return false;
}

function formatCalendarDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T12:00:00');
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const shortDate = `${d.getMonth() + 1}/${d.getDate()}`;
  if (diff === 0) return `Today (${shortDate})`;
  if (diff === 1) return `Tomorrow (${shortDate})`;
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 6);
  if (d <= weekEnd) return `${dayNames[d.getDay()]} (${shortDate})`;
  return dateStr;
}

const CALENDAR_TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern Time (ET) – America/New_York' },
  { id: 'America/Chicago', label: 'Central Time (CT) – America/Chicago' },
  { id: 'America/Denver', label: 'Mountain Time (MT) – America/Denver' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (PT) – America/Los_Angeles' },
  { id: 'America/Anchorage', label: 'Alaska Time – America/Anchorage' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time – Pacific/Honolulu' },
  { id: 'Europe/London', label: 'London (GMT/BST) – Europe/London' },
  { id: 'Europe/Paris', label: 'Central European Time (CET) – Europe/Paris' },
  { id: 'Europe/Athens', label: 'Eastern European Time (EET) – Europe/Athens' },
  { id: 'Europe/Lisbon', label: 'Portugal (WET) – Europe/Lisbon' },
  { id: 'Asia/Kolkata', label: 'India Standard Time (IST) – Asia/Kolkata' },
  { id: 'Asia/Tokyo', label: 'Japan Standard Time (JST) – Asia/Tokyo' },
  { id: 'Asia/Seoul', label: 'Korea Standard Time (KST) – Asia/Seoul' },
  { id: 'Asia/Singapore', label: 'Singapore Time – Asia/Singapore' },
  { id: 'Asia/Bangkok', label: 'Bangkok Time – Asia/Bangkok' },
  { id: 'Asia/Jakarta', label: 'Jakarta Time – Asia/Jakarta' },
  { id: 'Australia/Sydney', label: 'Australian Eastern Time (AET) – Australia/Sydney' },
  { id: 'Australia/Perth', label: 'Australian Western Time (AWT) – Australia/Perth' },
  { id: 'Pacific/Auckland', label: 'New Zealand Time – Pacific/Auckland' },
  { id: 'America/Sao_Paulo', label: 'Brazil Time (BRT) – America/Sao_Paulo' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Argentina Time – America/Argentina/Buenos_Aires' },
  { id: 'America/Santiago', label: 'Chile Time – America/Santiago' },
  { id: 'Asia/Dubai', label: 'Dubai Time – Asia/Dubai' },
  { id: 'Africa/Johannesburg', label: 'South Africa Time – Africa/Johannesburg' },
  { id: 'Africa/Lagos', label: 'Nigeria Time – Africa/Lagos' },
];

const CALENDAR_TZ_STORAGE_KEY = 'calendarTimezone';

function getCalendarDisplayTimezone(serverTimezone) {
  try {
    const stored = localStorage.getItem(CALENDAR_TZ_STORAGE_KEY);
    if (stored && CALENDAR_TIMEZONES.some((z) => z.id === stored)) return stored;
  } catch (_) {}
  return serverTimezone || 'America/New_York';
}

/** Return YYYY-MM-DD for the given ISO date string in the given timezone (for grouping by day). */
function getScheduledDateKey(isoString, tz) {
  if (!isoString || !tz) return null;
  try {
    const scheduled = new Date(isoString);
    const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateParts = dateFormatter.formatToParts(scheduled);
    const get = (type) => (dateParts.find((p) => p.type === type) || {}).value || '';
    return get('year') + '-' + get('month') + '-' + get('day');
  } catch (_) {
    return null;
  }
}

function formatScheduledAtInTz(isoString, tz) {
  if (!isoString || !tz) return null;
  try {
    const scheduled = new Date(isoString);
    const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dateParts = dateFormatter.formatToParts(scheduled);
    const get = (type) => (dateParts.find((p) => p.type === type) || {}).value || '';
    const month = get('month');
    const day = get('day');
    const year = get('year');
    const shortDate = month + '/' + day;
    const now = new Date();
    const todayStr = dateFormatter.format(now);
    const scheduledDateStr = dateFormatter.format(scheduled);
    const tomorrow = new Date(now.getTime() + 86400000);
    const tomorrowStr = dateFormatter.format(tomorrow);
    let dateLabel;
    if (scheduledDateStr === todayStr) dateLabel = 'Today (' + shortDate + ')';
    else if (scheduledDateStr === tomorrowStr) dateLabel = 'Tomorrow (' + shortDate + ')';
    else {
      const dowFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' });
      const weekdayInTz = dowFormatter.format(scheduled);
      const weekEnd = new Date(now.getTime() + 6 * 86400000);
      const weekEndStr = dateFormatter.format(weekEnd);
      if (scheduledDateStr <= weekEndStr) dateLabel = weekdayInTz + ' (' + shortDate + ')';
      else dateLabel = year + '-' + month + '-' + day;
    }
    const timeLabel = timeFormatter.format(scheduled);
    return { dateLabel, timeLabel };
  } catch (_) {
    return null;
  }
}

/** Get YYYY-MM-DD for "today" in the given timezone. */
function getTodayDateStringInTz(tz) {
  if (!tz) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const y = get('year');
    const mo = get('month').padStart(2, '0');
    const d = get('day').padStart(2, '0');
    return `${y}-${mo}-${d}`;
  } catch (_) {
    return null;
  }
}

/** Given (dateStr, timeStr "HH:mm", tz), return a Date for that moment, or null. */
function getDateForTimeInTz(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr || !tz) return null;
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    for (let utcHour = -12; utcHour <= 36; utcHour++) {
      const date = new Date(Date.UTC(y, mo - 1, d, utcHour, min || 0, 0));
      const parts = formatter.formatToParts(date);
      const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
      const fd = get('day').padStart(2, '0');
      const fmo = get('month').padStart(2, '0');
      const fy = get('year');
      const fh = get('hour').padStart(2, '0');
      const fmin = get('minute').padStart(2, '0');
      if (fy === String(y) && fmo === String(mo).padStart(2, '0') && fd === String(d).padStart(2, '0') && fh === String(h).padStart(2, '0') && fmin === String(min || 0).padStart(2, '0')) return date;
    }
  } catch (_) {}
  return null;
}

/** Convert a time from server TZ to user TZ; returns "HH:mm" (24h) for use in time inputs. */
function convertTimeForDisplay(serverTz, userTz, timeStr) {
  if (!serverTz || !userTz || !timeStr) return timeStr;
  const dateStr = getTodayDateStringInTz(serverTz);
  if (!dateStr) return timeStr;
  const date = getDateForTimeInTz(dateStr, timeStr, serverTz);
  if (!date) return timeStr;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = formatter.formatToParts(date);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    return `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`;
  } catch (_) {
    return timeStr;
  }
}

/** Convert a time from user TZ to server TZ; returns "HH:mm" (24h) for sending to API. */
function convertTimeToServer(userTz, serverTz, timeStr) {
  if (!userTz || !serverTz || !timeStr) return timeStr;
  const dateStr = getTodayDateStringInTz(userTz);
  if (!dateStr) return timeStr;
  const date = getDateForTimeInTz(dateStr, timeStr, userTz);
  if (!date) return timeStr;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: serverTz, hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = formatter.formatToParts(date);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    return `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`;
  } catch (_) {
    return timeStr;
  }
}

function setBreadcrumb(route, project, campaign, folderNum) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  const crumbs = [];
  const v = route && route.view;
  if (v === 'dashboard') {
    crumbs.push({ label: 'Home', current: true });
  } else if (v === 'pages') {
    crumbs.push({ label: 'Pages', current: true });
  } else if (v === 'campaigns') {
    crumbs.push({ label: 'Campaigns', current: true });
  } else if (v === 'campaignDetail') {
    crumbs.push({ label: 'Campaigns', href: '#/campaigns' });
    crumbs.push({ label: campaign ? escapeHtml(campaign.name || 'Campaign') : 'Campaign', current: true });
  } else if (v === 'recurringPages') {
    crumbs.push({ label: 'Recurring Pages', current: true });
  } else if (v === 'project') {
    crumbs.push({ label: 'Pages', href: '#/pages' });
    crumbs.push({ label: project ? escapeHtml(project.name || 'Page') : 'Page', current: true });
  } else if (v === 'campaign') {
    crumbs.push({ label: 'Campaigns', href: '#/campaigns' });
    if (campaign) crumbs.push({ label: escapeHtml(campaign.name || 'Campaign'), href: `#/campaigns/${campaign.id}` });
    crumbs.push({ label: project ? escapeHtml(project.name || 'Page') : 'Page', current: true });
  } else if (v === 'campaignFolder' || v === 'campaignFolderPhotos') {
    crumbs.push({ label: 'Campaigns', href: '#/campaigns' });
    if (campaign) crumbs.push({ label: escapeHtml(campaign.name || 'Campaign'), href: `#/campaigns/${campaign.id}` });
    if (project) crumbs.push({ label: escapeHtml(project.name || 'Page'), href: `#/campaigns/${campaign ? campaign.id : ''}/${project.id}` });
    if (folderNum != null) crumbs.push({ label: `Folder ${folderNum}`, current: true });
  } else if (v === 'trends') {
    crumbs.push({ label: 'Trends', current: true });
  } else if (v === 'trendNew') {
    crumbs.push({ label: 'Trends', href: '#/trends' });
    crumbs.push({ label: 'New Trend', current: true });
  } else if (v === 'trendDetail') {
    crumbs.push({ label: 'Trends', href: '#/trends' });
    crumbs.push({ label: campaign ? escapeHtml(campaign.name || 'Trend') : 'Trend', current: true });
  } else if (v === 'calendar') {
    crumbs.push({ label: 'Calendar', current: true });
  } else if (v === 'logins') {
    crumbs.push({ label: 'Logins', current: true });
  }
  if (!crumbs.length) { el.textContent = ''; return; }
  el.innerHTML = crumbs.map((c, i) => {
    if (c.current) return `<span class="breadcrumb-current">${c.label}</span>`;
    return `<a class="breadcrumb-link" href="${c.href || '#'}">${c.label}</a>${i < crumbs.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ''}`;
  }).join('<span class="breadcrumb-sep">›</span>');
}

const PAGE_SECTIONS = ['AI Influencers', 'UGC Pages', 'Fan Pages', 'Genre Pages'];

const AVAILABLE_FONTS = [
  'Arial, sans-serif',
  'Helvetica, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
  'Trebuchet MS, sans-serif',
  'Impact, sans-serif',
  'Comic Sans MS, cursive',
  'Courier New, monospace',
  'DM Sans, sans-serif',
  'JetBrains Mono, monospace',
];

// --- Views ---
function renderDashboard() {
  setBreadcrumb({ view: 'dashboard' });
  showViewLoading();
  Promise.all([
    apiWithAuth(`${API}/api/calendar?_=${Date.now()}`).then((r) => r.json()).catch(() => ({ items: [] })),
    apiAllCampaigns().catch(() => []),
  ]).then(([calData, allCampaigns]) => {
    const main = document.getElementById('main');
    const items = calData.items || [];
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Week range (Mon–Sun containing today)
    const dayOfWeek = now.getDay(); // 0=Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    // Filter to items that have a resolved outcome (posted)
    const postedItems = items.filter((it) => it.postStatus === 'success' || it.postStatus === 'failure');
    const weekPosted = postedItems.filter((it) => {
      const d = new Date(it.scheduledAt || (it.date + 'T12:00:00Z'));
      return d >= weekStart && d < weekEnd;
    });
    const weekSuccess = weekPosted.filter((it) => it.postStatus === 'success').length;
    const successRate = weekPosted.length > 0 ? Math.round((weekSuccess / weekPosted.length) * 100) : null;

    // Pages active this week (distinct projectIds with at least 1 post this week)
    const pagesThisWeek = new Set(weekPosted.map((it) => it.projectId)).size;

    // Upcoming today (not yet posted)
    const todayItems = items.filter((it) => {
      const dateKey = it.scheduledAt ? it.scheduledAt.slice(0, 10) : (it.date || '');
      return dateKey === todayKey && it.postStatus == null;
    }).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // Recent failures (last 48h)
    const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const recentFailures = postedItems.filter((it) => {
      const d = new Date(it.scheduledAt || (it.date + 'T12:00:00Z'));
      return it.postStatus === 'failure' && d >= cutoff48h;
    }).sort((a, b) => (b.scheduledAt || b.date || '').localeCompare(a.scheduledAt || a.date || ''));

    // Campaigns currently active (within date range)
    const todayStr = todayKey;
    const campaigns = Array.isArray(allCampaigns) ? allCampaigns : [];
    const activeCampaigns = campaigns.filter((c) => {
      if (c.paused) return false;
      const start = c.startDate || c.releaseDate || '';
      const end = c.endDate || '';
      if (!start && !end) return false;
      if (start && todayStr < start) return false;
      if (end && todayStr > end) return false;
      return true;
    });

    const fmtTime = (it) => {
      if (it.scheduledAt) {
        const d = new Date(it.scheduledAt);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      return formatTimeAMPM(it.time);
    };

    const todayHtml = todayItems.length
      ? todayItems.map((it) => `<li class="dashboard-event-item"><span class="dashboard-event-time">${escapeHtml(fmtTime(it))}</span><span class="dashboard-event-name">${escapeHtml(it.projectName || '')}</span><span class="dashboard-event-campaign">${escapeHtml(it.campaignName || '')}</span></li>`).join('')
      : '<li class="dashboard-empty">No posts scheduled for today.</li>';

    const failuresHtml = recentFailures.length
      ? recentFailures.slice(0, 5).map((it) => {
        const d = new Date(it.scheduledAt || (it.date + 'T12:00:00Z'));
        const timeAgo = (() => {
          const diff = Math.round((now - d) / 60000);
          if (diff < 60) return `${diff}m ago`;
          return `${Math.round(diff / 60)}h ago`;
        })();
        return `<li class="dashboard-event-item is-failure">
          <span class="dashboard-event-time">${escapeHtml(timeAgo)}</span>
          <div><span class="dashboard-event-name">${escapeHtml(it.projectName || '')} · ${escapeHtml(it.campaignName || '')}</span>${it.postError ? `<div class="dashboard-event-error">${escapeHtml(it.postError)}</div>` : ''}</div>
        </li>`;
      }).join('')
      : '<li class="dashboard-empty">No failures in the last 48 hours.</li>';

    const activeCampaignsHtml = activeCampaigns.length
      ? activeCampaigns.map((c) => `<li class="dashboard-event-item is-success"><span class="dashboard-event-name">${escapeHtml(c.name || 'Campaign')}</span></li>`).join('')
      : '<li class="dashboard-empty">No campaigns currently active.</li>';

    main.innerHTML = `
      <section class="card">
        <h1 class="dashboard-title">Overview</h1>
        <div class="dashboard-stats-grid">
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${weekPosted.length}</div>
            <div class="dashboard-stat-label">Posts this week</div>
          </div>
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${successRate !== null ? successRate + '%' : '—'}</div>
            <div class="dashboard-stat-label">Success rate (7d)</div>
          </div>
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${pagesThisWeek}</div>
            <div class="dashboard-stat-label">Pages active this week</div>
          </div>
          <div class="dashboard-stat">
            <div class="dashboard-stat-value">${activeCampaigns.length}</div>
            <div class="dashboard-stat-label">Campaigns running</div>
          </div>
        </div>

        <div class="dashboard-section">
          <h2>Upcoming today</h2>
          <ul class="dashboard-event-list">${todayHtml}</ul>
        </div>

        <div class="dashboard-section">
          <h2>Recent failures <span style="font-weight:400;font-size:13px;color:var(--text-muted)">(last 48h)</span></h2>
          <ul class="dashboard-event-list">${failuresHtml}</ul>
        </div>

        <div class="dashboard-section">
          <h2>Active campaigns</h2>
          <ul class="dashboard-event-list">${activeCampaignsHtml}</ul>
        </div>

        <p class="hint" style="margin-top:24px;">TikTok analytics (views, followers, likes) will appear here once the TikTok API is connected.</p>
      </section>
    `;
  });
}

function renderPages() {
  setBreadcrumb({ view: 'pages' });
  showViewLoading();
  Promise.all([apiProjects(), apiAllCampaigns()]).then(([projects, campaigns]) => {
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card dashboard-card">
        <div class="card-header dashboard-header">
          <h1 class="dashboard-title">Pages</h1>
        </div>
        <div class="pages-two-column">
          <div class="pages-column">
            <h2 class="pages-column-title">Recurring pages</h2>
            <div id="projectSectionsRecurring"></div>
          </div>
          <div class="pages-column">
            <h2 class="pages-column-title">Campaign pages</h2>
            <div id="projectSectionsCampaign"></div>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="newProjectBtn">New page</button>
        </div>
      </section>
    `;
    const recurring = projects.filter((p) => (p.pageType || 'recurring') === 'recurring');
    const campaignPages = projects.filter((p) => p.pageType === 'campaign');
    const renderSection = (items, sectionOrder) => {
      const grouped = {};
      sectionOrder.forEach((s) => { grouped[s] = items.filter((p) => p.section === s); });
      const unassigned = items.filter((p) => !p.section || !PAGE_SECTIONS.includes(p.section));
      const renderCircle = (p) => {
        const initial = (p.name || 'P').charAt(0).toUpperCase();
        const fallbackSrc = `https://unavatar.io/tiktok/${encodeURIComponent(p.name || '')}`;
        const src = p.hasAvatar ? projectAvatarUrl(p.id) : fallbackSrc;
        const img = `<img src="${src}" alt="" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="project-circle-initial" style="display:none;">${initial}</span>`;
        return `<div class="project-circle-wrap" data-project-id="${p.id}"><a href="#/project/${p.id}" class="project-circle" title="${escapeHtml(p.name)}">${img}</a><span class="project-circle-name">${escapeHtml(p.name)}</span><button type="button" class="project-circle-delete" data-action="delete" data-id="${p.id}">Delete</button></div>`;
      };
      return sectionOrder.map((section) => {
        const sectionItems = grouped[section] || [];
        if (!sectionItems.length) return '';
        return `<div class="page-section"><h3 class="page-section-title">${escapeHtml(section)}</h3><div class="project-circles">${sectionItems.map(renderCircle).join('')}</div></div>`;
      }).join('') + (unassigned.length ? `<div class="page-section"><h3 class="page-section-title">Unassigned</h3><div class="project-circles">${unassigned.map(renderCircle).join('')}</div></div>` : '');
    };
    const sectionOrder = ['AI Influencers', 'UGC Pages', 'Fan Pages', 'Genre Pages'];
    const recEl = document.getElementById('projectSectionsRecurring');
    const campEl = document.getElementById('projectSectionsCampaign');
    if (!projects.length) {
      recEl.innerHTML = '<p class="empty">No pages yet. Create one to get started.</p>';
      campEl.innerHTML = '';
    } else {
      recEl.innerHTML = recurring.length ? renderSection(recurring, sectionOrder) : '<p class="empty">No recurring pages.</p>';
      campEl.innerHTML = campaignPages.length ? renderSection(campaignPages, sectionOrder) : '<p class="empty">No campaign pages.</p>';
    }
    document.getElementById('newProjectBtn').onclick = () => {
      showPrompt('Page name (e.g. account handle):', 'New page').then((name) => {
        if (name == null || !name.trim()) return;
        apiCreateProject(name.trim()).then((p) => {
          location.hash = `#/project/${p.id}`;
          render();
        });
      });
    };
    main.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Delete this page and all its campaigns?').then((ok) => {
          if (!ok) return;
          apiDeleteProject(btn.dataset.id).then(() => render());
        });
      };
    });
  });
}

function renderRecurringPages() {
  setBreadcrumb({ view: 'recurringPages' });
  showViewLoading();
  Promise.all([apiRecurringPagesGet(), apiProjects()]).then(([recurringIds, projects]) => {
    const main = document.getElementById('main');
    const recurringProjects = (recurringIds || []).map((id) => projects.find((p) => String(p.id) === String(id))).filter(Boolean);
    const availableToAdd = projects.filter((p) => !recurringIds || !recurringIds.includes(p.id));
    main.innerHTML = `
      <section class="card dashboard-card">
        <div class="card-header dashboard-header">
          <h1 class="dashboard-title">Recurring Pages</h1>
          <p class="hint" style="margin:8px 0 0 0;">Add pages here to create and manage post types for them. Click a page to add content and schedule.</p>
        </div>
        <div class="actions" style="margin-bottom:1rem;">
          <button type="button" class="btn btn-primary" id="addRecurringPageBtn">Add page</button>
        </div>
        <div id="recurringPagesGrid" class="project-circles recurring-pages-grid"></div>
        <p id="recurringPagesEmpty" class="empty" style="display:none;">No recurring pages yet. Click "Add page" to select a page to add.</p>
      </section>
      <div id="addRecurringPageModal" class="modal-overlay" hidden>
        <div class="modal" style="max-width:360px;">
          <h3 style="margin:0 0 1rem 0;">Add a recurring page</h3>
          <p class="hint" style="margin-bottom:12px;">Select one page to add. You can add more after.</p>
          <label class="field" style="margin-bottom:1rem;">
            <span class="field-label">Page</span>
            <div class="calendar-campaign-picker" id="addRecurringPagePicker" style="width:100%;min-width:0;">
              <button type="button" class="calendar-campaign-picker-trigger field-select" id="addRecurringPagePickerTrigger" style="width:100%;" aria-haspopup="listbox" aria-expanded="false">
                <span class="calendar-campaign-picker-trigger-label" id="addRecurringPagePickerLabel">Select a page…</span>
              </button>
              <div class="calendar-campaign-picker-dropdown" id="addRecurringPagePickerDropdown" role="listbox" hidden></div>
            </div>
          </label>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button type="button" class="btn btn-ghost" id="addRecurringPageCancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="addRecurringPageConfirm">Add</button>
          </div>
        </div>
      </div>
    `;
    const grid = document.getElementById('recurringPagesGrid');
    const emptyEl = document.getElementById('recurringPagesEmpty');
    if (recurringProjects.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      grid.innerHTML = recurringProjects.map((p) => {
        const initial = (p.name || 'P').charAt(0).toUpperCase();
        const fallbackSrc = `https://unavatar.io/tiktok/${encodeURIComponent(p.name || '')}`;
        const src = p.hasAvatar ? projectAvatarUrl(p.id) : fallbackSrc;
        const img = `<img src="${src}" alt="" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="project-circle-initial" style="display:none;">${initial}</span>`;
        return `<div class="project-circle-wrap" data-project-id="${p.id}">
          <a href="#/recurring-pages/${p.id}" class="project-circle" title="${escapeHtml(p.name)}">${img}</a>
          <span class="project-circle-name">${escapeHtml(p.name)}</span>
          <button type="button" class="project-circle-delete" data-action="remove-recurring" data-id="${p.id}" aria-label="Remove from recurring">Remove</button>
        </div>`;
      }).join('');
    }
    grid.querySelectorAll('[data-action="remove-recurring"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Remove this page from Recurring Pages? Post types will not be deleted.').then((ok) => {
          if (!ok) return;
          apiRecurringPagesRemove(btn.dataset.id).then(() => render());
        });
      };
    });
    const addBtn = document.getElementById('addRecurringPageBtn');
    const modal = document.getElementById('addRecurringPageModal');
    const pickerTrigger = document.getElementById('addRecurringPagePickerTrigger');
    const pickerLabel = document.getElementById('addRecurringPagePickerLabel');
    const pickerDropdown = document.getElementById('addRecurringPagePickerDropdown');
    const cancelBtn = document.getElementById('addRecurringPageCancel');
    const confirmBtn = document.getElementById('addRecurringPageConfirm');
    let selectedRecurringPageId = null;
    if (addBtn && modal && pickerTrigger && pickerDropdown) {
      addBtn.onclick = () => {
        selectedRecurringPageId = null;
        pickerDropdown.hidden = true;
        pickerTrigger.setAttribute('aria-expanded', 'false');
        if (pickerLabel) {
          pickerLabel.textContent = 'Select a page…';
          const existingAvatar = pickerTrigger.querySelector('.calendar-campaign-picker-trigger-avatar');
          if (existingAvatar) existingAvatar.remove();
        }
        if (availableToAdd.length) {
          const itemsHtml = availableToAdd.map((p) => {
            const avatarHtml = p.hasAvatar
              ? `<img src="${projectAvatarUrl(p.id)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(p.name || 'P').charAt(0).toUpperCase()}</span>`
              : `<span class="calendar-campaign-picker-avatar-placeholder">${(p.name || 'P').charAt(0).toUpperCase()}</span>`;
            return `<button type="button" class="calendar-campaign-picker-item" data-page-id="${escapeHtml(String(p.id))}" title="${escapeHtml(p.name)}">
              <span class="calendar-campaign-picker-item-avatar">${avatarHtml}</span>
              <span class="calendar-campaign-picker-item-name">${escapeHtml(p.name)}</span>
            </button>`;
          }).join('');
          pickerDropdown.innerHTML = itemsHtml;
          pickerDropdown.querySelectorAll('.calendar-campaign-picker-item[data-page-id]').forEach((btn) => {
            btn.onclick = (e) => {
              e.stopPropagation();
              const id = btn.dataset.pageId;
              selectedRecurringPageId = id || null;
              const p = availableToAdd.find((x) => String(x.id) === String(id));
              if (p && pickerLabel) {
                pickerLabel.textContent = p.name || '';
                const oldAvatar = pickerTrigger.querySelector('.calendar-campaign-picker-trigger-avatar');
                if (oldAvatar) oldAvatar.remove();
                const avatarHtml = p.hasAvatar
                  ? `<img src="${projectAvatarUrl(p.id)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(p.name || 'P').charAt(0).toUpperCase()}</span>`
                  : `<span class="calendar-campaign-picker-avatar-placeholder">${(p.name || 'P').charAt(0).toUpperCase()}</span>`;
                const avatarSpan = document.createElement('span');
                avatarSpan.className = 'calendar-campaign-picker-trigger-avatar';
                avatarSpan.innerHTML = avatarHtml;
                pickerTrigger.insertBefore(avatarSpan, pickerLabel);
              }
              pickerDropdown.hidden = true;
              pickerTrigger.setAttribute('aria-expanded', 'false');
            };
          });
        } else {
          pickerDropdown.innerHTML = '<div class="calendar-campaign-picker-empty">No pages available</div>';
        }
        modal.hidden = false;
      };
      pickerTrigger.onclick = (e) => {
        e.stopPropagation();
        if (availableToAdd.length === 0) return;
        const isOpen = !pickerDropdown.hidden;
        pickerDropdown.hidden = isOpen;
        pickerTrigger.setAttribute('aria-expanded', !isOpen);
        if (!isOpen) {
          const closeHandler = (ev) => {
            if (pickerDropdown && !document.getElementById('addRecurringPagePicker')?.contains(ev.target)) {
              pickerDropdown.hidden = true;
              pickerTrigger.setAttribute('aria-expanded', 'false');
              document.removeEventListener('click', closeHandler);
            }
          };
          setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
      };
      cancelBtn.onclick = () => { modal.hidden = true; pickerDropdown.hidden = true; };
      confirmBtn.onclick = () => {
        const id = selectedRecurringPageId && String(selectedRecurringPageId).trim();
        if (!id || availableToAdd.length === 0) return;
        apiRecurringPagesAdd(id).then(() => {
          modal.hidden = true;
          render();
        }).catch((err) => showAlert(err.message || 'Failed to add'));
      };
      modal.onclick = (e) => { if (e.target.id === 'addRecurringPageModal') modal.hidden = true; };
      modal.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation());
    }
  }).catch((err) => {
    document.getElementById('main').innerHTML = `<section class="card"><p class="back-link-wrap"><a href="#/recurring-pages" class="nav-link">← Back to Recurring Pages</a></p><p>Failed to load.</p></section>`;
  });
}

function renderProject(projectId) {
  const pid = projectId;
  Promise.all([apiProject(pid), apiCampaigns(pid), apiConfig()]).then(([project, campaigns, config]) => {
    if (!project) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/pages" class="nav-link">← Back to Pages</a></p><p>Page not found.</p></section>';
      setBreadcrumb({ view: 'project', projectId: pid }, null, null);
      return;
    }
    setBreadcrumb({ view: 'project', projectId: pid }, project, null);
    const main = document.getElementById('main');
    const avatarImg = project.hasAvatar ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />` : '<span class="project-avatar-placeholder">No photo</span>';
    main.innerHTML = `
      <section class="card project-card">
        <p class="back-link-wrap"><a href="#/pages" class="nav-link">← Back to Pages</a></p>
        <div class="card-header">
          <h1>${escapeHtml(project.name)}</h1>
        </div>
        <div class="project-avatar-section" style="margin-bottom:1rem;">
          <div class="field">
            <span>Profile picture (for page button)</span>
            <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
              <div id="projectAvatarPreview" class="project-avatar-preview">${avatarImg}</div>
              <input type="file" accept="image/*" id="projectAvatarInput" style="display:none;" />
              <button type="button" class="btn btn-secondary" id="projectAvatarBtn">Upload photo</button>
            </div>
          </div>
          <div class="field">
            <span>Page category</span>
            <select id="projectPageTypeSelect" class="field-select">
              <option value="recurring" ${(project.pageType || 'recurring') === 'recurring' ? 'selected' : ''}>Recurring page</option>
              <option value="campaign" ${project.pageType === 'campaign' ? 'selected' : ''}>Campaign page</option>
            </select>
          </div>
          <div class="field">
            <span>Page type</span>
            <select id="projectSectionSelect" class="field-select">
              <option value="">Unassigned</option>
              ${PAGE_SECTIONS.map((s) => `<option value="${escapeHtml(s)}" ${project.section === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <span>Blotato Account ID (TikTok)</span>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <input type="text" id="projectBlotatoAccountId" placeholder="acc_xxxxx" value="${escapeHtml(project.blotatoAccountId || '')}" style="flex:1;min-width:120px;" />
              <button type="button" class="btn btn-secondary btn-sm" id="saveBlotatoAccountBtn">Save</button>
            </div>
          </div>
          <p class="hint">Required for auto-posting. Get from Blotato: GET /v2/users/me/accounts?platform=tiktok</p>
        </div>
        <div class="project-content-section">
          <h2 style="margin:0 0 8px 0;font-size:1.1rem;">${(project.pageType || 'recurring') === 'recurring' ? 'Campaigns' : 'Campaigns'}</h2>
          <p class="hint" style="margin-bottom:12px;">${(project.pageType || 'recurring') === 'recurring' ? 'To create and schedule posts for this page, add it in Recurring Pages.' : 'Campaigns this page belongs to.'}</p>
        </div>
        <div id="recurringPagesCta" style="display:none;margin-bottom:1rem;"><button type="button" class="btn btn-secondary" id="addPageToRecurringPagesBtn">Add this page in Recurring Pages</button></div>
        <div class="campaign-list" id="campaignList"></div>
        <div class="actions" style="flex-wrap:wrap;gap:8px;">
          <button type="button" class="btn ${(project.pageType || 'recurring') === 'recurring' ? 'btn-secondary' : 'btn-primary'}" id="joinCampaignBtn">Join campaign</button>
        </div>
      </section>
    `;
    const avatarInput = document.getElementById('projectAvatarInput');
    const avatarBtn = document.getElementById('projectAvatarBtn');
    const avatarPreview = document.getElementById('projectAvatarPreview');
    const pageTypeSelect = document.getElementById('projectPageTypeSelect');
    if (pageTypeSelect) pageTypeSelect.onchange = () => {
      const val = pageTypeSelect.value === 'campaign' ? 'campaign' : 'recurring';
      apiUpdateProject(project.id, { pageType: val }).then((p) => { project = p; });
    };
    const sectionSelect = document.getElementById('projectSectionSelect');
    if (sectionSelect) sectionSelect.onchange = () => {
      const val = sectionSelect.value || null;
      apiUpdateProject(project.id, { section: val }).then((p) => { project = p; });
    };
    const blotatoAccountInput = document.getElementById('projectBlotatoAccountId');
    const saveBlotatoBtn = document.getElementById('saveBlotatoAccountBtn');
    const saveBlotatoAccount = () => {
      const val = (blotatoAccountInput && blotatoAccountInput.value.trim()) || null;
      apiUpdateProject(project.id, { blotatoAccountId: val })
        .then((p) => {
          project = p;
          if (saveBlotatoBtn) {
            saveBlotatoBtn.textContent = 'Saved';
            setTimeout(() => { saveBlotatoBtn.textContent = 'Save'; }, 2000);
          }
        })
        .catch((err) => showAlert(err.message || 'Failed to save'));
    };
    if (blotatoAccountInput) blotatoAccountInput.onblur = saveBlotatoAccount;
    if (saveBlotatoBtn) saveBlotatoBtn.onclick = saveBlotatoAccount;
    if (avatarBtn && avatarInput) {
      avatarBtn.onclick = (e) => { e.preventDefault(); avatarInput.click(); };
      avatarInput.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        apiUploadProjectAvatar(String(project.id), file).then(() => {
          bumpAvatarVersion('project', project.id);
          if (avatarPreview) {
            avatarPreview.innerHTML = `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />`;
            avatarPreview.style.cursor = 'pointer';
            avatarPreview.title = 'Click to edit';
            avatarPreview.onclick = () => openEditAvatarModal('project', project.id, projectAvatarUrl(project.id), () => {
              if (avatarPreview) avatarPreview.innerHTML = `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />`;
            });
          }
          avatarInput.value = '';
        }).catch((err) => showAlert(err.message || 'Upload failed'));
      };
    }
    if (avatarPreview && project.hasAvatar) {
      avatarPreview.dataset.hasAvatar = '1';
      avatarPreview.style.cursor = 'pointer';
      avatarPreview.title = 'Click to edit';
      avatarPreview.onclick = () => {
        openEditAvatarModal('project', project.id, projectAvatarUrl(project.id), () => {
          if (avatarPreview) avatarPreview.innerHTML = `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img project-avatar-clickable" />`;
        });
      };
    }
    const list = document.getElementById('campaignList');
    const isRecurring = (project.pageType || 'recurring') === 'recurring';
    const ctaEl = document.getElementById('recurringPagesCta');
    if (ctaEl) ctaEl.style.display = isRecurring ? 'block' : 'none';
    const campaignsToShow = isRecurring ? campaigns.filter((c) => c.name !== 'Recurring posts') : campaigns;
    if (!campaignsToShow.length) {
      list.innerHTML = isRecurring
        ? '<p class="empty">No campaigns yet. To create post types for this page, add it in Recurring Pages. Or join a campaign to post with other pages.</p>'
        : '<p class="empty">No campaigns yet. Join a campaign to get started.</p>';
    } else {
      const sorted = [...campaignsToShow].sort((a, b) => {
        const da = a.releaseDate || '';
        const db = b.releaseDate || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
      const serverTz = (config && config.timezone) || 'America/New_York';
      const userTz = getCalendarDisplayTimezone(serverTz);
      list.innerHTML = sorted.map((c) => {
        const rawTimes = c.scheduleTimes || [];
        const displayTimes = rawTimes.map((t) => convertTimeForDisplay(serverTz, userTz, t || '10:00'));
        const timesLabel = displayTimes.map(formatTimeAMPM).filter(Boolean).join(', ') || '—';
        const releaseLabel = c.releaseDate ? `Release: ${formatReleaseDate(c.releaseDate)}` : '';
        const displayName = campaignDisplayTitle(project, c);
        const campAvatar = `<div class="list-card-avatar campaign-avatar campaign-avatar-square"><img src="${campaignAvatarUrl(c.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(displayName || 'C').charAt(0).toUpperCase()}</span></div>`;
        const contentHref = isRecurringContentCampaign(project, c) ? `#/project/${project.id}/content` : `#/campaign/${project.id}/${c.id}`;
        return `
        <div class="list-card" data-campaign-id="${c.id}">
          ${campAvatar}
          <div class="list-card-main">
            <a href="${contentHref}" class="list-card-title">${escapeHtml(displayName)}</a>
            <span class="list-card-meta">
              ${c.deployed ? '<span class="badge badge-deployed">Deployed</span>' : '<span class="badge badge-draft">Draft</span>'}
              ${releaseLabel ? escapeHtml(releaseLabel) + ' · ' : ''}${escapeHtml(timesLabel)}
            </span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm list-card-action" data-action="delete-campaign" data-cid="${c.id}" aria-label="Delete">Delete</button>
        </div>
      `;
      }).join('');
    }
    const addToRecurringBtn = document.getElementById('addPageToRecurringPagesBtn');
    if (addToRecurringBtn) addToRecurringBtn.onclick = () => { location.hash = '#/recurring-pages'; };
    document.getElementById('joinCampaignBtn').onclick = () => {
      apiAllCampaigns().then((all) => {
        const joinable = all.filter((c) => {
          const ids = (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
          return !ids.includes(project.id);
        });
        openJoinCampaignModal(project.id, joinable, () => render());
      }).catch(() => showAlert('Failed to load campaigns'));
    };
    list.querySelectorAll('[data-action="delete-campaign"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Delete this campaign?').then((ok) => {
          if (!ok) return;
          apiDeleteCampaign(project.id, btn.dataset.cid).then(() => render());
        });
      };
    });

  });
}

function openFolderModal(projectId, campaignId, folderNum, folderLabel, onClose) {
  const modal = document.getElementById('folderModal');
  const title = document.getElementById('folderModalTitle');
  const photos = document.getElementById('folderModalPhotos');
  const addBtn = document.getElementById('folderModalAddBtn');
  const addInput = document.getElementById('folderModalAddInput');
  const closeBtn = document.getElementById('folderModalClose');
  if (!modal || !title || !photos) return;
  title.textContent = folderLabel;
  modal.hidden = false;

  function refresh() {
    apiCampaignFolders(projectId, campaignId, undefined, { cacheBust: true }).then((data) => {
      const list = (data.folders || {})[`folder${folderNum}`] || [];
      photos.innerHTML = list.map((item) => {
        const filename = typeof item === 'string' ? item : (item && item.filename) || '';
        const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
        return `
        <div class="folder-modal-photo">
          <img data-src="${folderImageUrl(projectId, campaignId, folderNum, filename)}" alt="" loading="lazy" />
          <span class="folder-photo-usage-badge" title="Times used in runs">${usageCount}</span>
          <button type="button" class="folder-modal-delete" data-filename="${escapeHtml(filename)}">×</button>
        </div>
      `}).join('');
      photos.querySelectorAll('img[data-src]').forEach((img) => {
        withAuthQuery(img.dataset.src).then((url) => { img.src = url; img.removeAttribute('data-src'); });
      });
      photos.querySelectorAll('.folder-modal-delete').forEach((btn) => {
        btn.onclick = () => {
          apiDeleteFolderImage(projectId, campaignId, folderNum, btn.dataset.filename).then(refresh).catch(() => showAlert('Delete failed'));
        };
      });
    });
  }
  refresh();

  addBtn.onclick = () => addInput.click();
  addInput.onchange = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    campaignUploadWithProgress(projectId, campaignId, folderNum, files)
      .then(() => { setTimeout(() => { refresh(); if (onClose) onClose(); }, 80); })
      .catch(() => showAlert('Upload failed'));
    addInput.value = '';
  };

  function close() {
    modal.hidden = true;
    if (onClose) onClose();
  }
  closeBtn.onclick = close;
  modal.onclick = (e) => { if (e.target.id === 'folderModal') close(); };
}

function renderMediaTypeSelector(pid, cid, ptId, project, campaign) {
  const main = document.getElementById('main');
  const title = campaignDisplayTitle(project, campaign);
  main.innerHTML = `
    <section class="card campaign-section">
      <p class="back-link-wrap"><a href="${contentBackLink(pid, cid)}" class="nav-link">← Back to post types</a></p>
      <h1>${escapeHtml(title)}</h1>
      <p class="hint" style="margin-bottom:20px;">Select whether this post type will use photos or videos.</p>
      <div class="media-type-selector">
        <label class="field"><span>Media type</span>
          <select id="mediaTypeSelect" class="field-select">
            <option value="">— Select —</option>
            <option value="photo">Photos</option>
            <option value="video">Videos (without text)</option>
            <option value="video_text">Videos (add text)</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary" id="mediaTypeConfirmBtn">Continue</button>
      </div>
    </section>
  `;
  document.getElementById('mediaTypeConfirmBtn').onclick = () => {
    const sel = document.getElementById('mediaTypeSelect');
    const val = sel && sel.value;
    if (!val) { showAlert('Please select a media type'); return; }
    apiUpdatePostType(pid, cid, ptId, { mediaType: val }).then(() => render()).catch((err) => showAlert(err.message || 'Failed'));
  };
}

function renderCampaignVideo(pid, cid, ptId, project, campaign, foldersData, latest, config) {
  let campaignData = campaign;
  const serverTz = (config && config.timezone) || 'America/New_York';
  const userTz = getCalendarDisplayTimezone(serverTz);
  const rawTimes = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
  const times = rawTimes.map((t) => convertTimeForDisplay(serverTz, userTz, t || '10:00'));
  const folders = foldersData.folders || {};
  const folderCount = 2;
  const scheduleStart = campaign.scheduleStartDate || '';
  const scheduleEnd = campaign.scheduleEndDate || '';
  const daysOfWeek = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const folderLabels = ['Priority videos', 'Fallback videos'];
  const main = document.getElementById('main');
  const campaignAvatarSection = `<div class="campaign-header-avatar-inner" id="campaignHeaderAvatarInner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div><input type="file" accept="image/*" id="campaignAvatarInput" hidden />`;
  const pageIndicator = project.hasAvatar ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />` : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
  const videoFolders = [1, 2].map((i) => {
    const list = folders[`folder${i}`] || [];
    const count = list.length;
    return `
      <div class="folder" data-folder="${i}">
        <div class="dropzone" id="dropzone${i}" data-folder-num="${i}">
          <span class="dropzone-label">${folderLabels[i - 1]}</span>
          <span class="dropzone-count" id="count${i}">${count} video${count !== 1 ? 's' : ''}</span>
          <button type="button" class="btn btn-secondary btn-sm dropzone-add">Add videos</button>
          <button type="button" class="btn btn-ghost btn-sm dropzone-view">View / manage</button>
          <input type="file" accept="video/*" multiple hidden id="input${i}" />
        </div>
      </div>`;
  }).join('');
  main.innerHTML = `
    <section class="card campaign-section campaign-page-card">
      <p class="back-link-wrap"><a href="${contentBackLink(pid, cid)}" class="nav-link">← Back to post types</a></p>
      <div class="campaign-page-header">
        <div class="campaign-page-header-spacer"></div>
        <div class="campaign-page-header-center">
          <div class="campaign-page-header-avatars">
            <div class="campaign-header-avatar-wrap">${campaignAvatarSection}</div>
            <div class="page-indicator-wrap" title="Editing for ${escapeHtml(project.name)}"><div class="page-indicator-avatar-wrap">${pageIndicator}</div></div>
          </div>
          <div class="campaign-page-title-wrap">
            <h1 id="campaignName" class="campaign-detail-name-editable" title="Double-click to rename">${escapeHtml(campaign.name)}</h1>
            <h2 id="postTypeHeader" class="post-type-header-editable post-type-name-centered" title="Double-click to edit label">${escapeHtml((campaign.postTypes || []).find((p) => p.id === ptId)?.name || ptId)}</h2>
            <label class="deploy-toggle deploy-toggle-under-name">
              <input type="checkbox" id="deployed" ${isPostTypeDeployed(campaign, pid, ptId) ? 'checked' : ''} />
              <span>Deployed</span>
            </label>
          </div>
        </div>
        <div class="campaign-page-header-right"></div>
      </div>
    </section>
    <section class="card">
      <h2>Videos</h2>
      <p class="hint">Add videos the same way as video (add text): upload to Priority (used first) or Fallback (used when Priority is empty). One video with the lowest use number is picked per run; the number on each shows how many times it has been used. No on-screen text is added. Max 50 MB per video.</p>
      <div class="folders" id="foldersContainer">${videoFolders}</div>
    </section>
    <section class="card">
      <h2>Schedule</h2>
      <p class="hint">How often videos will be posted (if deployed). Times use your selected timezone (Settings → Display timezone).</p>
      <div class="schedule-content">
        <label class="checkbox-field"><input type="checkbox" id="scheduleEnabled" ${campaign.scheduleEnabled !== false ? 'checked' : ''} /><span>Run on schedule</span></label>
        <div class="schedule-date-range">
          <label class="field"><span>Start date</span><input type="date" id="scheduleStartDate" value="${scheduleStart}" /></label>
          <label class="field"><span>End date</span><input type="date" id="scheduleEndDate" value="${scheduleEnd}" /></label>
        </div>
        <div class="schedule-days">
          <span class="field-label">Days of week</span>
          <div class="schedule-days-checkboxes">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<label class="checkbox-field checkbox-inline"><input type="checkbox" class="schedule-day" data-day="${d}" ${daysOfWeek.includes(d) ? 'checked' : ''} /><span>${dayNames[d]}</span></label>`).join('')}</div>
        </div>
        <div class="schedule-times-wrap">
          <div class="schedule-times-header"><span class="field-label">Post times (${times.length} per day)</span><button type="button" class="btn btn-ghost btn-sm" id="addScheduleTime">+ Add time</button><button type="button" class="btn btn-ghost btn-sm" id="removeScheduleTime">− Remove</button></div>
          <div class="schedule-times" id="scheduleTimes">${times.map((t, i) => `<label class="time-row"><input type="time" class="time-input" data-index="${i}" value="${t || '10:00'}" /></label>`).join('')}</div>
        </div>
        <button type="button" class="btn btn-secondary" id="saveCampaign">Save campaign</button>
      </div>
    </section>
    <section class="card">
      <h2>Run now & Generated URLs</h2>
      <p class="hint">Run once to pick the least-used video (Priority, then Fallback) and generate its URL. The video is published via Blotato.</p>
      <label class="checkbox-field" style="margin-bottom:12px;"><input type="checkbox" id="sendAsDraft" ${campaign.sendAsDraft ? 'checked' : ''} /><span>Send to Blotato as draft</span></label>
      <p class="hint" style="margin-top:-8px;margin-bottom:12px;">When checked, the post goes to TikTok drafts (mobile app) instead of publishing immediately.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="runNow">Run now</button>
        <button type="button" class="btn btn-secondary" id="clearUrlsBtn">Clear URLs</button>
      </div>
      <div class="run-status" id="runStatus"></div>
      <div class="urls-wrap" id="urlsWrap">
        <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run to generate media URLs.'}</div>
        <ul class="urls-list" id="urlsList"></ul>
        <button type="button" class="btn btn-secondary btn-copy-all" id="copyAllUrls" style="display: none;">Copy all URLs</button>
      </div>
    </section>
  `;
  function updateFolderCounts() {
    apiCampaignFolders(pid, cid, ptId).then((f) => {
      const fol = f.folders || {};
      for (let i = 1; i <= 2; i++) {
        const el = document.getElementById(`count${i}`);
        const list = fol[`folder${i}`] || [];
        if (el) el.textContent = `${list.length} video${list.length !== 1 ? 's' : ''}`;
        const thumbsEl = document.getElementById(`dropzoneThumbs${i}`);
        if (thumbsEl) {
          thumbsEl.innerHTML = list.map((item) => {
            const filename = typeof item === 'string' ? item : (item && item.filename) || '';
            const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
            return `<div class="dropzone-thumb" title="${escapeHtml(filename)}"><span class="dropzone-thumb-media dropzone-thumb-video">vid</span><span class="folder-photo-usage-badge">${usageCount}</span></div>`;
          }).join('');
        }
      }
    });
  }
  for (let num = 1; num <= 2; num++) {
    const dropzone = document.getElementById(`dropzone${num}`);
    const input = document.getElementById(`input${num}`);
    const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
    const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
    if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = contentPostTypeLink(pid, cid, ptId, `videos/${num}`); };
    if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
    if (dropzone && input) {
      dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
      dropzone.ondragleave = () => dropzone.classList.remove('dragover');
      dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); const files = e.dataTransfer.files; if (files?.length) campaignUploadWithProgress(pid, cid, num, files, ptId, 'video').then(updateFolderCounts).catch((err) => showAlert(err.message || 'Upload failed')); };
    }
    if (input) input.onchange = (e) => { const files = e.target.files; if (files?.length) campaignUploadWithProgress(pid, cid, num, files, ptId, 'video').then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => showAlert(err.message || 'Upload failed')); };
  }
  updateFolderCounts();
  document.getElementById('deployed').onchange = (e) => apiUpdateCampaign(pid, cid, { ...campaignData, deployed: e.target.checked }, ptId).then((c) => { campaignData = c; });
  const postTypeHeaderEl = document.getElementById('postTypeHeader');
  if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
    const pt = (campaignData.postTypes || []).find((p) => p.id === ptId);
    const current = pt ? pt.name : ptId;
    showPrompt('Post type label:', current).then((name) => {
      if (name != null && name.trim()) {
        apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => {
          campaignData = c;
          if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim();
        }).catch((err) => showAlert(err.message || 'Failed'));
      }
    });
  };
  const scheduleTimesEl = document.getElementById('scheduleTimes');
  scheduleTimesEl.querySelectorAll('.time-input').forEach((input) => { input.onchange = () => { campaignData.scheduleTimes = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00'); }; });
  document.getElementById('addScheduleTime').onclick = () => {
    const inputs = scheduleTimesEl.querySelectorAll('.time-input');
    const lastVal = inputs.length ? inputs[inputs.length - 1].value : '10:00';
    const [h, m] = lastVal.split(':').map(Number);
    const nextH = (h + 2) % 24;
    const nextVal = `${String(nextH).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    const label = document.createElement('label');
    label.className = 'time-row';
    label.innerHTML = `<input type="time" class="time-input" data-index="${inputs.length}" value="${nextVal}" />`;
    scheduleTimesEl.appendChild(label);
  };
  document.getElementById('removeScheduleTime').onclick = () => { const rows = scheduleTimesEl.querySelectorAll('.time-row'); if (rows.length > 1) rows[rows.length - 1].remove(); };
  document.getElementById('saveCampaign').onclick = () => {
    const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00').map((t) => convertTimeToServer(userTz, serverTz, t));
    const daysChecked = Array.from(document.querySelectorAll('.schedule-day:checked')).map((cb) => parseInt(cb.dataset.day, 10));
    apiUpdateCampaign(pid, cid, { ...campaignData, scheduleEnabled: document.getElementById('scheduleEnabled').checked, scheduleTimes: timesArr, scheduleStartDate: document.getElementById('scheduleStartDate')?.value || null, scheduleEndDate: document.getElementById('scheduleEndDate')?.value || null, scheduleDaysOfWeek: daysChecked }, ptId).then((c) => { campaignData = c; });
    const status = document.getElementById('runStatus');
    status.textContent = 'Campaign saved.';
    status.className = 'run-status success';
    setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000);
  };
  document.getElementById('clearUrlsBtn').onclick = () => {
    showConfirm('Clear all generated URLs?').then((ok) => {
      if (!ok) return;
      apiClearCampaignUrls(pid, cid).then(() => {
        document.getElementById('urlsPlaceholder').style.display = 'block';
        document.getElementById('urlsPlaceholder').textContent = 'Run to generate media URLs.';
        document.getElementById('urlsList').innerHTML = '';
        document.getElementById('copyAllUrls').style.display = 'none';
      });
    });
  };
  function showUrls(urls, base64Images = []) {
    const placeholder = document.getElementById('urlsPlaceholder');
    const list = document.getElementById('urlsList');
    const copyAllBtn = document.getElementById('copyAllUrls');
    if (!urls.length) { placeholder.style.display = 'block'; placeholder.textContent = 'Run to generate media URLs.'; list.innerHTML = ''; copyAllBtn.style.display = 'none'; return; }
    placeholder.style.display = 'none';
    copyAllBtn.style.display = 'inline-block';
    list.innerHTML = urls.map((url) => `<li class="url-item"><span class="url-text">${escapeHtml(url)}</span><button type="button" class="btn btn-secondary btn-copy-url">Copy</button></li>`).join('');
    list.querySelectorAll('.btn-copy-url').forEach((btn, i) => { btn.onclick = () => { navigator.clipboard.writeText(urls[i]); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }; });
    copyAllBtn.onclick = () => { navigator.clipboard.writeText(urls.join('\n')); copyAllBtn.textContent = 'Copied!'; setTimeout(() => { copyAllBtn.textContent = 'Copy all URLs'; }, 1500); };
  }
  document.getElementById('runNow').onclick = () => {
    const btn = document.getElementById('runNow');
    const status = document.getElementById('runStatus');
    if (btn.disabled) return;
    btn.disabled = true;
    status.textContent = 'Running…';
    status.className = 'run-status loading';
    const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
    // Save settings in background — don't block the run on the save completing.
    apiUpdateCampaign(pid, cid, { ...campaignData, sendAsDraft }, ptId).then((c) => { campaignData = c; }).catch(() => {});
    apiCampaignRun(pid, cid, null, null, sendAsDraft, false, ptId)
      .then((data) => {
        if (data.error) throw new Error(data.error);
        let msg = `Done. ${(data.webContentUrls || []).length} URL(s) generated.`;
        if (data.blotatoSent) msg += data.blotatoSentAsDraft ? ' Sent to Blotato as draft.' : ' Sent to Blotato.';
        else if (data.blotatoError) msg += ` Blotato: ${data.blotatoError}`;
        status.textContent = msg;
        status.className = 'run-status success';
        showUrls(data.webContentUrls || [], data.webContentBase64 || []);
      })
      .catch((err) => { status.textContent = err.message || 'Run failed'; status.className = 'run-status error'; })
      .finally(() => { btn.disabled = false; });
  };
  if ((latest.webContentUrls || []).length) showUrls(latest.webContentUrls, latest.webContentBase64 || []);
}

function renderCampaignVideoWithText(pid, cid, ptId, project, campaign, foldersData, latest, config) {
  let campaignData = campaign;
  const serverTz = (config && config.timezone) || 'America/New_York';
  const userTz = getCalendarDisplayTimezone(serverTz);
  const rawTimes = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
  const times = rawTimes.map((t) => convertTimeForDisplay(serverTz, userTz, t || '10:00'));
  const folders = foldersData.folders || {};
  const folderCount = 1;
  const textOptionsPerFolder = campaign.textOptionsPerFolder || [[]];
  const scheduleStart = campaign.scheduleStartDate || '';
  const scheduleEnd = campaign.scheduleEndDate || '';
  const daysOfWeek = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const list = folders.folder1 || [];
  const count = list.length;
  const ts = (campaign.textStylePerFolder && campaign.textStylePerFolder[0]) || campaign.textStyle || {};
  const pt = (campaign.postTypes || []).find((p) => p.id === ptId);
  const initialTextOverlayMode = (pt && ((Array.isArray(pt.textPresetIds) && pt.textPresetIds.length > 0) || pt.textPresetId)) ? 'lyric' : 'onscreen';
  const campaignAvatarSection = `<div class="campaign-header-avatar-inner" id="campaignHeaderAvatarInner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div><input type="file" accept="image/*" id="campaignAvatarInput" hidden />`;
  const pageIndicator = project.hasAvatar ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />` : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
  const main = document.getElementById('main');
  main.innerHTML = `
    <section class="card campaign-section campaign-page-card">
      <p class="back-link-wrap"><a href="${contentBackLink(pid, cid)}" class="nav-link">← Back to post types</a></p>
      <div class="campaign-page-header">
        <div class="campaign-page-header-spacer"></div>
        <div class="campaign-page-header-center">
          <div class="campaign-page-header-avatars">
            <div class="campaign-header-avatar-wrap">${campaignAvatarSection}</div>
            <div class="page-indicator-wrap" title="Editing for ${escapeHtml(project.name)}"><div class="page-indicator-avatar-wrap">${pageIndicator}</div></div>
          </div>
          <div class="campaign-page-title-wrap">
            <h1 id="campaignName" class="campaign-detail-name-editable" title="Double-click to rename">${escapeHtml(campaign.name)}</h1>
            <h2 id="postTypeHeader" class="post-type-header-editable" title="Double-click to edit label">${escapeHtml((campaign.postTypes || []).find((p) => p.id === ptId)?.name || ptId)}</h2>
            <label class="deploy-toggle deploy-toggle-under-name">
              <input type="checkbox" id="deployed" ${isPostTypeDeployed(campaign, pid, ptId) ? 'checked' : ''} />
              <span>Deployed</span>
            </label>
          </div>
        </div>
        <div class="campaign-page-header-right"></div>
      </div>
    </section>
    <section class="card">
      <h2>Videos</h2>
      <p class="hint">Upload videos here. One video with the lowest use number is picked per run (all get used before any is reused); the number on each shows how many times it has been used. Max 50 MB per video.</p>
      <div class="folders" id="foldersContainer">
        <div class="folder" data-folder="1">
          <div class="dropzone" id="dropzone1" data-folder-num="1">
            <span class="dropzone-label">Videos</span>
            <span class="dropzone-count" id="count1">${count} video${count !== 1 ? 's' : ''}</span>
            <button type="button" class="btn btn-secondary btn-sm dropzone-add">Add videos</button>
            <button type="button" class="btn btn-ghost btn-sm dropzone-view">View / manage</button>
            <input type="file" accept="video/*" multiple hidden id="input1" />
          </div>
        </div>
      </div>
    </section>
    <section class="card" id="textOverlayCard">
      <h2>Text overlay</h2>
      <p class="hint">Choose how text appears on your videos: lyric overlay (moving text preset) or on-screen text (static text options).</p>
      <div class="text-overlay-mode-buttons" role="group" aria-label="Text overlay type">
        <button type="button" class="btn ${initialTextOverlayMode === 'lyric' ? 'btn-primary' : 'btn-secondary'}" id="textOverlayModeLyric">Lyric overlay preset</button>
        <button type="button" class="btn ${initialTextOverlayMode === 'onscreen' ? 'btn-primary' : 'btn-secondary'}" id="textOverlayModeOnscreen">On-screen text</button>
      </div>
      <div id="textOverlayLyricPanel" class="text-overlay-panel" style="display:${initialTextOverlayMode === 'lyric' ? 'block' : 'none'};">
        <p class="hint" style="margin-bottom:8px;">Select one or more presets from Settings → Text presets. One is randomly chosen each run. The preview below shows the selected preset on your video.</p>
        <div id="textPresetCheckboxList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
        <p id="textPresetNoPresetsHint" class="hint" style="display:none;">No presets found. Add them in Settings → Text presets.</p>
      </div>
      <div id="textOverlayOnscreenPanel" class="text-overlay-panel" style="display:${initialTextOverlayMode === 'onscreen' ? 'block' : 'none'};">
        <p class="hint">One line from your text options is chosen per run and overlaid using the styling below.</p>
        <a href="${contentPostTypeLink(pid, cid, ptId, 'folder/1')}" class="btn btn-secondary btn-folder-text">Edit on-screen text options</a>
      </div>
    </section>
    <section class="card">
      <h2 id="textStyleSectionTitle">${initialTextOverlayMode === 'lyric' ? 'Preview' : 'Text styling'}</h2>
      <p class="hint" id="textStyleSectionHint">${initialTextOverlayMode === 'lyric' ? 'Preview shows your lyric preset on the video. Click Refresh preview to update.' : 'Position and style of the overlay text. The preview shows your on-screen text on the video. Click Refresh preview to update.'}</p>
      <div class="text-style-folders">
        <div class="text-style-folder-card text-style-folder-card-live" data-folder="1">
          <h4 class="text-style-folder-title" id="textStyleFolderTitle">${initialTextOverlayMode === 'lyric' ? 'Preview' : 'Text overlay'}</h4>
          <div class="text-style-folder-row">
            <div class="text-style-settings-panel" data-folder="1" id="textStyleSettingsPanel" style="display:${initialTextOverlayMode === 'onscreen' ? 'block' : 'none'};">
              <div class="text-style-grid">
                <label class="field"><span>X (%)</span><input type="number" data-folder="1" data-field="x" value="${(ts.x === 50 || ts.x == null) ? 0 : ts.x}" min="0" max="100" title="0 = center" /></label>
                <label class="field"><span>Y (%)</span><input type="number" data-folder="1" data-field="y" value="${(ts.y === 50 || ts.y == null) ? 0 : ts.y}" min="0" max="100" title="0 = center" /></label>
                <label class="field"><span>Size (px)</span><input type="number" data-folder="1" data-field="size" value="${(ts.fontSize != null && ts.fontSize >= 12 && ts.fontSize <= 200) ? Math.round(ts.fontSize) : 60}" min="12" max="200" step="1" title="Font size in pixels" /></label>
                <label class="field"><span>Font</span><select data-folder="1" data-field="font" class="field-select">${(() => { const current = ts.font || 'Arial, sans-serif'; const fonts = AVAILABLE_FONTS.includes(current) ? AVAILABLE_FONTS : [current, ...AVAILABLE_FONTS]; return fonts.map((font) => `<option value="${escapeHtml(font)}" ${current === font ? 'selected' : ''}>${escapeHtml(font)}</option>`).join(''); })()}</select></label>
                <label class="field"><span>Color</span><input type="text" data-folder="1" data-field="color" value="${escapeHtml(ts.color || 'white')}" /></label>
                <label class="field"><span>Stroke</span><input type="number" data-folder="1" data-field="strokeWidth" value="${(ts.strokeWidth ?? 2)}" min="0" max="10" step="0.5" /></label>
              </div>
            </div>
            <div class="text-style-preview-panel" data-folder="1">
              <div class="text-style-preview-wrap">
                <div class="text-style-preview-inner">
                  <video class="text-style-preview-video" data-folder="1" controls style="max-width:100%;max-height:320px;background:#111;display:none;"></video>
                  <div class="text-style-preview-placeholder text-style-preview-video-placeholder" data-folder="1">Click Refresh preview to generate</div>
                  <div class="text-style-preview-loading" data-folder="1" style="display:none;">Generating preview…</div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px;" data-refresh-preview="1">Refresh preview</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-secondary" id="saveTextStyle" style="display:${initialTextOverlayMode === 'onscreen' ? 'inline-block' : 'none'};">Save text styles</button>
    </section>
    <section class="card">
      <h2>Schedule</h2>
      <p class="hint">When this campaign runs (if deployed). Times use your selected timezone (Settings → Display timezone).</p>
      <div class="schedule-content">
        <label class="checkbox-field"><input type="checkbox" id="scheduleEnabled" ${campaign.scheduleEnabled !== false ? 'checked' : ''} /><span>Run on schedule</span></label>
        <div class="schedule-date-range">
          <label class="field"><span>Start date</span><input type="date" id="scheduleStartDate" value="${scheduleStart}" /></label>
          <label class="field"><span>End date</span><input type="date" id="scheduleEndDate" value="${scheduleEnd}" /></label>
        </div>
        <div class="schedule-days">
          <span class="field-label">Days of week</span>
          <div class="schedule-days-checkboxes">
            ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<label class="checkbox-field checkbox-inline"><input type="checkbox" class="schedule-day" data-day="${d}" ${daysOfWeek.includes(d) ? 'checked' : ''} /><span>${dayNames[d]}</span></label>`).join('')}
          </div>
        </div>
        <div class="schedule-times-wrap">
          <div class="schedule-times-header">
            <span class="field-label">Post times (${times.length} per day)</span>
            <button type="button" class="btn btn-ghost btn-sm" id="addScheduleTime">+ Add time</button>
            <button type="button" class="btn btn-ghost btn-sm" id="removeScheduleTime">− Remove</button>
          </div>
          <div class="schedule-times" id="scheduleTimes">
            ${times.map((t, i) => `<label class="time-row"><input type="time" class="time-input" data-index="${i}" value="${t || '10:00'}" /></label>`).join('')}
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-secondary" id="saveCampaign">Save campaign</button>
    </section>
    <section class="card">
      <h2>Run now & Generated URLs</h2>
      <p class="hint">Run once to generate a video with text overlay and get the URL. Send to Blotato/n8n.</p>
      <label class="checkbox-field" style="margin-bottom:12px;">
        <input type="checkbox" id="sendAsDraft" ${campaign.sendAsDraft ? 'checked' : ''} />
        <span>Send to Blotato as draft</span>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="runNow">Run now</button>
        <button type="button" class="btn btn-secondary" id="clearUrlsBtn">Clear URLs</button>
      </div>
      <div class="run-status" id="runStatus"></div>
      <div class="urls-wrap" id="urlsWrap">
        <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run to generate media URLs.'}</div>
        <ul class="urls-list" id="urlsList"></ul>
        <button type="button" class="btn btn-secondary btn-copy-all" id="copyAllUrls" style="display: none;">Copy all URLs</button>
      </div>
    </section>
  `;

  function updateFolderCounts() {
    apiCampaignFolders(pid, cid, ptId).then((f) => {
      const fol = f.folders || {};
      const list1 = fol.folder1 || [];
      const el = document.getElementById('count1');
      if (el) el.textContent = `${list1.length} video${list1.length !== 1 ? 's' : ''}`;
      const thumbsEl = document.getElementById('dropzoneThumbs1');
      if (thumbsEl) {
        thumbsEl.innerHTML = list1.map((item) => {
          const filename = typeof item === 'string' ? item : (item && item.filename) || '';
          const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
          return `<div class="dropzone-thumb" title="${escapeHtml(filename)}"><span class="dropzone-thumb-media dropzone-thumb-video">vid</span><span class="folder-photo-usage-badge">${usageCount}</span></div>`;
        }).join('');
      }
    });
  }
  updateFolderCounts();

  const dropzone = document.getElementById('dropzone1');
  const input = document.getElementById('input1');
  const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
  const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
  if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = contentPostTypeLink(pid, cid, ptId, 'videos/1'); };
  if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
  if (dropzone && input) {
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files?.length) campaignUploadWithProgress(pid, cid, 1, files, ptId, 'video_text').then(updateFolderCounts).catch((err) => showAlert(err.message || 'Upload failed'));
    };
  }
  if (input) input.onchange = (e) => {
    const files = e.target.files;
    if (files?.length) campaignUploadWithProgress(pid, cid, 1, files, ptId, 'video_text').then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => showAlert(err.message || 'Upload failed'));
  };

  document.getElementById('deployed').onchange = (e) => apiUpdateCampaign(pid, cid, { ...campaignData, deployed: e.target.checked }, ptId).then((c) => { campaignData = c; });
  const campaignNameEl = document.getElementById('campaignName');
  if (campaignNameEl) campaignNameEl.ondblclick = () => {
    showPrompt('Campaign name:', campaignData.name).then((name) => {
      if (name != null && name.trim()) apiUpdateCampaign(pid, cid, { ...campaignData, name: name.trim() }, ptId).then((c) => { campaignData = c; if (campaignNameEl) campaignNameEl.textContent = c.name; });
    });
  };
  const postTypeHeaderEl = document.getElementById('postTypeHeader');
  if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
    const pt = (campaignData.postTypes || []).find((p) => p.id === ptId);
    showPrompt('Post type label:', pt ? pt.name : ptId).then((name) => {
      if (name != null && name.trim()) apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => { campaignData = c; if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim(); }).catch((err) => showAlert(err.message || 'Failed'));
    });
  };

  const scheduleTimesEl = document.getElementById('scheduleTimes');
  scheduleTimesEl.querySelectorAll('.time-input').forEach((inputEl) => {
    inputEl.onchange = () => { campaignData.scheduleTimes = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00'); };
  });
  document.getElementById('addScheduleTime').onclick = () => {
    const inputs = scheduleTimesEl.querySelectorAll('.time-input');
    const lastVal = inputs.length ? inputs[inputs.length - 1].value : '10:00';
    const [h, m] = lastVal.split(':').map(Number);
    const nextVal = `${String((h + 2) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    const label = document.createElement('label');
    label.className = 'time-row';
    label.innerHTML = `<input type="time" class="time-input" data-index="${inputs.length}" value="${nextVal}" />`;
    scheduleTimesEl.appendChild(label);
  };
  document.getElementById('removeScheduleTime').onclick = () => {
    const rows = scheduleTimesEl.querySelectorAll('.time-row');
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
  };
  document.getElementById('saveCampaign').onclick = () => {
    const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00').map((t) => convertTimeToServer(userTz, serverTz, t));
    const daysChecked = Array.from(document.querySelectorAll('.schedule-day:checked')).map((cb) => parseInt(cb.dataset.day, 10));
    apiUpdateCampaign(pid, cid, {
      ...campaignData,
      scheduleEnabled: document.getElementById('scheduleEnabled').checked,
      scheduleTimes: timesArr,
      scheduleStartDate: document.getElementById('scheduleStartDate')?.value || null,
      scheduleEndDate: document.getElementById('scheduleEndDate')?.value || null,
      scheduleDaysOfWeek: daysChecked,
    }, ptId).then((c) => { campaignData = c; });
    const status = document.getElementById('runStatus');
    status.textContent = 'Campaign saved.';
    status.className = 'run-status success';
    setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000);
  };

  function getCurrentTextStylePerFolder() {
    const get = (field) => { const el = document.querySelector(`[data-folder="1"][data-field="${field}"]`); return el ? el.value : null; };
    const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(get('size')) || 60)));
    return [{
      x: parseFloat(get('x')) || 0,
      y: parseFloat(get('y')) || 0,
      fontSize: sizePx,
      font: (get('font') || 'Arial, sans-serif').trim(),
      color: (get('color') || 'white').trim(),
      strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
    }];
  }

  document.getElementById('saveTextStyle').onclick = () => {
    const textStylePerFolder = getCurrentTextStylePerFolder();
    const status = document.getElementById('runStatus');
    apiUpdateCampaign(pid, cid, { ...campaignData, textStylePerFolder }, ptId)
      .then((c) => {
        campaignData = c;
        if (status) { status.textContent = 'Text styles saved.'; status.className = 'run-status success'; setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000); }
      })
      .catch((err) => {
        if (status) { status.textContent = err.message || 'Failed to save'; status.className = 'run-status error'; }
        showAlert(err?.message || 'Failed to save text styles.');
      });
  };

  const presetCheckboxList = document.getElementById('textPresetCheckboxList');
  const presetNoPresetsHint = document.getElementById('textPresetNoPresetsHint');
  function saveSelectedPresets() {
    if (!presetCheckboxList) return;
    const checkedIds = [...presetCheckboxList.querySelectorAll('.preset-checkbox:checked')].map((c) => c.value);
    apiUpdatePostType(pid, cid, ptId, { textPresetIds: checkedIds, textPresetId: null })
      .then((c) => { campaignData = c; })
      .catch((err) => showAlert(err.message || 'Failed to update presets'));
  }
  if (presetCheckboxList) {
    apiTextPresets().then((presets) => {
      const currentPt = (campaignData.postTypes || []).find((p) => p.id === ptId);
      const selectedIds = Array.isArray(currentPt?.textPresetIds) && currentPt.textPresetIds.length > 0
        ? currentPt.textPresetIds.map(String)
        : (currentPt?.textPresetId && currentPt.textPresetId !== 'random' ? [String(currentPt.textPresetId)] : []);
      if (!Array.isArray(presets) || presets.length === 0) {
        presetCheckboxList.innerHTML = '';
        if (presetNoPresetsHint) presetNoPresetsHint.style.display = 'block';
        return;
      }
      if (presetNoPresetsHint) presetNoPresetsHint.style.display = 'none';
      presetCheckboxList.innerHTML = presets.map((p) => `
        <label class="checkbox-field" style="margin-bottom:4px;">
          <input type="checkbox" class="preset-checkbox" value="${escapeHtml(String(p.id))}" ${selectedIds.includes(String(p.id)) ? 'checked' : ''} />
          <span>${escapeHtml(p.name || String(p.id))}</span>
        </label>
      `).join('');
      presetCheckboxList.querySelectorAll('.preset-checkbox').forEach((cb) => {
        cb.onchange = saveSelectedPresets;
      });
    }).catch(() => {});
  }

  function setTextOverlayMode(mode) {
    const isLyric = mode === 'lyric';
    const lyricBtn = document.getElementById('textOverlayModeLyric');
    const onscreenBtn = document.getElementById('textOverlayModeOnscreen');
    const lyricPanel = document.getElementById('textOverlayLyricPanel');
    const onscreenPanel = document.getElementById('textOverlayOnscreenPanel');
    const settingsPanel = document.getElementById('textStyleSettingsPanel');
    const sectionTitle = document.getElementById('textStyleSectionTitle');
    const sectionHint = document.getElementById('textStyleSectionHint');
    const folderTitle = document.getElementById('textStyleFolderTitle');
    if (lyricBtn) { lyricBtn.className = isLyric ? 'btn btn-primary' : 'btn btn-secondary'; }
    if (onscreenBtn) { onscreenBtn.className = isLyric ? 'btn btn-secondary' : 'btn btn-primary'; }
    if (lyricPanel) lyricPanel.style.display = isLyric ? 'block' : 'none';
    if (onscreenPanel) onscreenPanel.style.display = isLyric ? 'none' : 'block';
    if (settingsPanel) settingsPanel.style.display = isLyric ? 'none' : 'block';
    if (sectionTitle) sectionTitle.textContent = isLyric ? 'Preview' : 'Text styling';
    if (sectionHint) sectionHint.textContent = isLyric ? 'Preview shows your lyric preset on the video. Click Refresh preview to update.' : 'Position and style of the overlay text. The preview shows your on-screen text on the video. Click Refresh preview to update.';
    if (folderTitle) folderTitle.textContent = isLyric ? 'Preview' : 'Text overlay';
    const saveTextStyleBtn = document.getElementById('saveTextStyle');
    if (saveTextStyleBtn) saveTextStyleBtn.style.display = isLyric ? 'none' : 'inline-block';
  }
  document.getElementById('textOverlayModeLyric').onclick = () => {
    setTextOverlayMode('lyric');
  };
  document.getElementById('textOverlayModeOnscreen').onclick = () => {
    apiUpdatePostType(pid, cid, ptId, { textPresetIds: [], textPresetId: null }).then((c) => { campaignData = c; }).catch(() => {});
    if (presetCheckboxList) presetCheckboxList.querySelectorAll('.preset-checkbox').forEach((cb) => { cb.checked = false; });
    setTextOverlayMode('onscreen');
  };

  const videoEl = main.querySelector('.text-style-preview-video[data-folder="1"]');
  const placeholderEl = main.querySelector('.text-style-preview-video-placeholder[data-folder="1"]');
  const loadingEl = main.querySelector('.text-style-preview-loading[data-folder="1"]');
  let previewAbortController = null;
  main.querySelector('[data-refresh-preview="1"]').onclick = () => {
    if (previewAbortController) previewAbortController.abort();
    previewAbortController = new AbortController();
    const textStylePerFolder = getCurrentTextStylePerFolder();
    const textOptionsPerFolder = campaignData.textOptionsPerFolder || [[]];
    if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = 'Generating preview…'; }
    if (placeholderEl) placeholderEl.style.display = 'none';
    videoEl.style.display = 'none';
    apiVideoTextPreview(pid, cid, ptId, textStylePerFolder, textOptionsPerFolder, previewAbortController.signal)
      .then((data) => {
        if (previewAbortController.signal.aborted) return;
        const url = (data.url || '').trim();
        if (!url) { if (loadingEl) loadingEl.style.display = 'none'; if (placeholderEl) { placeholderEl.style.display = 'block'; placeholderEl.textContent = 'No preview URL'; } return; }
        videoEl.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        videoEl.style.display = 'block';
        if (placeholderEl) placeholderEl.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';
      })
      .catch((err) => {
        if (previewAbortController.signal.aborted) return;
        if (loadingEl) loadingEl.style.display = 'none';
        if (placeholderEl) { placeholderEl.style.display = 'block'; placeholderEl.textContent = err.message || 'Preview failed'; }
      });
  };

  document.getElementById('clearUrlsBtn').onclick = () => {
    showConfirm('Clear all generated URLs?').then((ok) => {
      if (!ok) return;
      apiClearCampaignUrls(pid, cid).then(() => {
        document.getElementById('urlsPlaceholder').style.display = 'block';
        document.getElementById('urlsPlaceholder').textContent = 'Run to generate media URLs.';
        document.getElementById('urlsList').innerHTML = '';
        document.getElementById('copyAllUrls').style.display = 'none';
      });
    });
  };

  function showUrls(urls, base64Images) {
    const placeholder = document.getElementById('urlsPlaceholder');
    const list = document.getElementById('urlsList');
    const copyAllBtn = document.getElementById('copyAllUrls');
    if (!urls.length) { placeholder.style.display = 'block'; placeholder.textContent = 'Run to generate media URLs.'; list.innerHTML = ''; copyAllBtn.style.display = 'none'; return; }
    placeholder.style.display = 'none';
    copyAllBtn.style.display = 'inline-block';
    list.innerHTML = urls.map((url) => `<li class="url-item"><span class="url-text">${escapeHtml(url)}</span><button type="button" class="btn btn-secondary btn-copy-url">Copy</button></li>`).join('');
    list.querySelectorAll('.btn-copy-url').forEach((btn, i) => { btn.onclick = () => { navigator.clipboard.writeText(urls[i]); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }; });
    copyAllBtn.onclick = () => { navigator.clipboard.writeText(urls.join('\n')); copyAllBtn.textContent = 'Copied!'; setTimeout(() => { copyAllBtn.textContent = 'Copy all URLs'; }, 1500); };
  }

  document.getElementById('runNow').onclick = () => {
    const btn = document.getElementById('runNow');
    const status = document.getElementById('runStatus');
    if (btn.disabled) return;
    btn.disabled = true;
    status.textContent = 'Running…';
    status.className = 'run-status loading';
    const textStylePerFolder = getCurrentTextStylePerFolder();
    const textOptionsPerFolder = campaignData.textOptionsPerFolder || [[]];
    const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
    apiUpdateCampaign(pid, cid, { ...campaignData, textStylePerFolder, sendAsDraft }, ptId).then((c) => { campaignData = c; }).catch(() => {});
    apiCampaignRun(pid, cid, textStylePerFolder, textOptionsPerFolder, sendAsDraft, false, ptId)
      .then((data) => {
        if (data.error) throw new Error(data.error);
        let msg = `Done. ${(data.webContentUrls || []).length} URL(s) generated.`;
        if (data.blotatoSent) msg += data.blotatoSentAsDraft ? ' Sent to Blotato as draft.' : ' Sent to Blotato.';
        else if (data.blotatoError) msg += ` Blotato: ${data.blotatoError}`;
        status.textContent = msg;
        status.className = 'run-status success';
        showUrls(data.webContentUrls || [], data.webContentBase64 || []);
      })
      .catch((err) => { status.textContent = err.message || 'Run failed'; status.className = 'run-status error'; })
      .finally(() => { btn.disabled = false; });
  };

  if ((latest.webContentUrls || []).length) showUrls(latest.webContentUrls, latest.webContentBase64 || []);
}

function renderPostTypeSelector(pid, cid, project, campaign) {
  const postTypes = campaign.postTypes || [];
  const main = document.getElementById('main');
  const hasPostTypes = postTypes.length > 0;
  const isPageContent = isRecurringContentCampaign(project, campaign) || isProjectContent(pid);
  const backLink = isPageContent ? contentBackLink(pid, cid) : `#/campaigns/${cid}`;
  const backLabel = fromRecurringPages ? '← Back to Recurring Pages' : (isPageContent ? `← Back to ${escapeHtml(project.name)}` : '← Back to campaign');
  const title = campaignDisplayTitle(project, campaign);
  const ptLink = (ptId) => contentPostTypeLink(pid, cid, ptId, '');
  const campaignAvatarSection = `<div class="campaign-header-avatar-inner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(title || 'C').charAt(0).toUpperCase()}</span></div>`;
  const pageIndicator = project.hasAvatar
    ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />`
    : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
  main.innerHTML = `
    <section class="card campaign-section campaign-page-card">
      <p class="back-link-wrap back-link-wrap-centered"><a href="${backLink}" class="nav-link">${backLabel}</a></p>
      <div class="campaign-page-header">
        <div class="campaign-page-header-spacer"></div>
        <div class="campaign-page-header-center">
          <div class="campaign-page-header-avatars">
            <div class="campaign-header-avatar-wrap">${campaignAvatarSection}</div>
            <div class="page-indicator-wrap" title="Page: ${escapeHtml(project.name)}">
              <div class="page-indicator-avatar-wrap">${pageIndicator}</div>
            </div>
          </div>
          <div class="campaign-page-title-wrap">
            <h1 class="campaign-detail-name-editable">${escapeHtml(title)}</h1>
          </div>
          <p class="hint" style="margin:8px 0 0 0;">${escapeHtml(project.name)} — Select a post type to upload content, set schedule, and run. No campaign required.</p>
        </div>
        <div class="campaign-page-header-right"></div>
      </div>
    </section>
    <section class="card">
      <h2>Post types</h2>
      <p class="hint" style="margin-bottom:20px;">${hasPostTypes ? 'Each post type has its own folders, on-screen text (per folder), text styling, schedule, and run. Content stays in this page profile.' : 'Add a post type to upload content for this page. Each can have different folders and schedules.'}</p>
      <div class="post-type-selector post-type-big-buttons">
        ${postTypes.map((pt) => `
          <div class="post-type-card-wrap">
            <a href="${ptLink(pt.id)}" class="post-type-card post-type-big-btn">
              <span class="post-type-name post-type-name-centered">${escapeHtml(pt.name)}</span>
            </a>
            <button type="button" class="btn btn-secondary btn-sm post-type-duplicate" data-pt-id="${encodeURIComponent(pt.id)}" data-pt-name="${escapeHtml(pt.name)}" data-pid="${pid}" data-cid="${cid}">Duplicate</button>
            <button type="button" class="btn btn-ghost post-type-delete" data-pt-id="${encodeURIComponent(pt.id)}" data-pt-name="${escapeHtml(pt.name)}" aria-label="Delete post type">🗑</button>
          </div>
        `).join('')}
        <button type="button" class="btn btn-primary post-type-add post-type-big-btn" id="addPostTypeBtn">+ Add post type</button>
      </div>
    </section>
  `;
  document.getElementById('addPostTypeBtn').onclick = () => {
    const modal = document.getElementById('addPostTypeModal');
    const nameInput = document.getElementById('addPostTypeName');
    const mediaSelect = document.getElementById('addPostTypeMedia');
    if (nameInput) nameInput.value = 'New post type';
    if (mediaSelect) mediaSelect.value = 'photo';
    if (modal) modal.hidden = false;
  };
  const addPostTypeModal = document.getElementById('addPostTypeModal');
  document.getElementById('addPostTypeCancel').onclick = () => { if (addPostTypeModal) addPostTypeModal.hidden = true; };
  document.getElementById('addPostTypeCreate').onclick = () => {
    const nameInput = document.getElementById('addPostTypeName');
    const mediaSelect = document.getElementById('addPostTypeMedia');
    const name = (nameInput?.value || 'New post type').trim();
    const mediaType = mediaSelect?.value || 'photo';
    apiCreatePostType(pid, cid, name, mediaType).then((c) => {
      if (addPostTypeModal) addPostTypeModal.hidden = true;
      const pts = c.postTypes || [];
      const id = pts.length ? pts[pts.length - 1].id : null;
      if (id) location.hash = isPageContent ? contentPostTypeLink(pid, cid, id, '') : `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(id)}`;
      render();
    }).catch((err) => showAlert(err.message || 'Failed'));
  };
  if (addPostTypeModal) {
    if (!addPostTypeModal._closeSetup) {
      addPostTypeModal._closeSetup = true;
      addPostTypeModal.addEventListener('mousedown', (e) => {
        addPostTypeModal.dataset.mousedownOnOverlay = e.target.id === 'addPostTypeModal' ? '1' : '';
      }, true);
    }
    addPostTypeModal.onclick = (e) => {
      if (e.target.id === 'addPostTypeModal' && addPostTypeModal.dataset.mousedownOnOverlay) addPostTypeModal.hidden = true;
    };
    const modalInner = addPostTypeModal.querySelector('.modal');
    if (modalInner) modalInner.onclick = (e) => e.stopPropagation();
  }
  main.querySelectorAll('.post-type-delete').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ptName = btn.dataset.ptName || 'this post type';
      showConfirm(`Delete post type "${ptName}"? This cannot be undone.`).then((ok) => {
        if (!ok) return;
        apiDeletePostType(pid, cid, btn.dataset.ptId).then(() => render()).catch((err) => showAlert(err.message || 'Failed'));
      });
    };
  });
  main.querySelectorAll('.post-type-duplicate').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ptId = btn.dataset.ptId;
      const sourcePid = parseInt(btn.dataset.pid, 10);
      const sourceCid = parseInt(btn.dataset.cid, 10);
      openDuplicatePostTypeModal(sourcePid, sourceCid, ptId);
    };
  });
}

function openDuplicatePostTypeModal(sourceProjectId, sourceCampaignId, postTypeId) {
  const modal = document.getElementById('duplicatePostTypeModal');
  const targetSelect = document.getElementById('duplicateTargetSelect');
  if (!modal || !targetSelect) return;
  Promise.all([apiProjects(), apiAllCampaigns()]).then(([projects, campaigns]) => {
    const getPageIds = (c) => (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
    targetSelect.innerHTML = '<option value="">— Select campaign and page —</option>';
    campaigns.forEach((c) => {
      const pageIds = getPageIds(c);
      pageIds.forEach((pageId) => {
        if (c.id === sourceCampaignId && pageId === sourceProjectId) return;
        const proj = projects.find((p) => p.id === pageId);
        if (!proj) return;
        const opt = document.createElement('option');
        opt.value = `${c.id}:${pageId}`;
        opt.textContent = `${c.name} → ${proj.name}`;
        targetSelect.appendChild(opt);
      });
    });
    modal.hidden = false;
  });
  document.getElementById('duplicatePostTypeCancel').onclick = () => { modal.hidden = true; };
  document.getElementById('duplicatePostTypeConfirm').onclick = () => {
    const val = targetSelect.value;
    if (!val) { showAlert('Select a campaign and page'); return; }
    const [targetCampaignId, targetPageId] = val.split(':').map(Number);
    apiDuplicatePostType(sourceProjectId, sourceCampaignId, postTypeId, targetCampaignId, targetPageId)
      .then(() => {
        modal.hidden = true;
        location.hash = `#/campaign/${targetPageId}/${targetCampaignId}`;
        render();
      })
      .catch((err) => showAlert(err.message || 'Failed to duplicate'));
  };
  modal.onclick = (e) => { if (e.target.id === 'duplicatePostTypeModal') modal.hidden = true; };
}

function renderCampaign(projectId, campaignId, postTypeId) {
  const pid = projectId;
  const cid = campaignId;
  const ptId = postTypeId || 'default';
  Promise.all([
    apiProjects().then((list) => list.find((p) => p.id === parseInt(pid, 10))),
    apiCampaign(pid, cid, postTypeId ? ptId : null),
    postTypeId ? apiCampaignFolders(pid, cid, ptId) : Promise.resolve({ folders: {}, folderCount: 0 }),
    apiCampaignLatest(pid, cid),
    apiConfig(),
  ]).then(([project, campaign, foldersData, latest, config]) => {
    if (!project || !campaign) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap back-link-wrap-centered"><a href="#/campaigns" class="nav-link">← Back to campaigns</a></p><p>Campaign not found.</p></section>';
      return;
    }
    if (!postTypeId) {
      renderPostTypeSelector(pid, cid, project, campaign);
      return;
    }
    const mediaType = campaign.mediaType;
    if (mediaType !== 'photo' && mediaType !== 'video' && mediaType !== 'video_text') {
      renderMediaTypeSelector(pid, cid, ptId, project, campaign);
      return;
    }
    if (mediaType === 'video') {
      renderCampaignVideo(pid, cid, ptId, project, campaign, foldersData, latest, config);
      return;
    }
    if (mediaType === 'video_text') {
      renderCampaignVideoWithText(pid, cid, ptId, project, campaign, foldersData, latest, config);
      return;
    }
    const serverTz = (config && config.timezone) || 'America/New_York';
    const userTz = getCalendarDisplayTimezone(serverTz);
    const rawTimes = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
    const times = rawTimes.map((t) => convertTimeForDisplay(serverTz, userTz, t || '10:00'));
    const folders = foldersData.folders || {};
    const folderCount = Math.max(1, foldersData.folderCount || (campaign.folderCount || 3));
    const textOptionsPerFolder = campaign.textOptionsPerFolder || Array(folderCount).fill(null).map(() => []);
    const photoPt = (campaign.postTypes || []).find((p) => p.id === ptId);
    setBreadcrumb({ view: 'campaign', projectId: pid, campaignId: cid }, project, campaign);
    const scheduleStart = campaign.scheduleStartDate || '';
    const scheduleEnd = campaign.scheduleEndDate || '';
    const daysOfWeek = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const main = document.getElementById('main');
    const isPageContentHere = isRecurringContentCampaign(project, campaign) || isProjectContent(pid);
    const hideFolderThumbnails = true;
    const folderCards = [];
    const samePhotoEachTime = campaign.samePhotoEachTimePerFolder || [];
    for (let i = 1; i <= folderCount; i++) {
      const list = folders[`folder${i}`] || [];
      const count = list.length;
      const canDelete = folderCount > 1;
      const sameChecked = !!samePhotoEachTime[i - 1];
      folderCards.push(`
        <div class="folder" data-folder="${i}">
          <div class="dropzone" id="dropzone${i}" data-folder-num="${i}">
            <span class="dropzone-label">Folder ${i}</span>
            <span class="dropzone-count" id="count${i}">${count} photo${count !== 1 ? 's' : ''}</span>
            ${hideFolderThumbnails ? '' : `<div class="dropzone-thumbnails" id="dropzoneThumbs${i}" data-folder-num="${i}"></div>`}
            <button type="button" class="btn btn-secondary btn-sm dropzone-add">Add photos</button>
            <button type="button" class="btn btn-ghost btn-sm dropzone-view">View / manage</button>
            ${canDelete ? `<button type="button" class="btn btn-ghost btn-sm dropzone-delete" data-folder-num="${i}">Delete folder</button>` : ''}
            <label class="checkbox-field same-photo-each-time-wrap" style="display:block;margin-top:0.5rem;">
              <input type="checkbox" class="same-photo-each-time" data-folder-num="${i}" ${sameChecked ? 'checked' : ''} />
              <span>Same Photo Each Time</span>
            </label>
            <input type="file" accept="image/*" multiple hidden id="input${i}" />
          </div>
        </div>
      `);
    }

    const textButtons = [];
    for (let i = 1; i <= folderCount; i++) {
      textButtons.push(`<a href="${contentPostTypeLink(pid, cid, ptId, `folder/${i}`)}" class="btn btn-secondary btn-folder-text">Folder ${i} – edit on-screen text</a>`);
    }

    const title = campaignDisplayTitle(project, campaign);
    const backTo = isPageContentHere ? contentBackLink(pid, cid) : `#/campaign/${pid}/${cid}`;
    const backLabel = isPageContentHere ? `← Back to ${escapeHtml(project.name)}` : '← Back to post types';
    const campaignAvatarSection = `<div class="campaign-header-avatar-inner" id="campaignHeaderAvatarInner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div><input type="file" accept="image/*" id="campaignAvatarInput" hidden />`;
    const pageIndicator = project.hasAvatar
      ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />`
      : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
    main.innerHTML = `
      <section class="card campaign-section campaign-page-card">
        <p class="back-link-wrap"><a href="${backTo}" class="nav-link">${backLabel}</a></p>
        <div class="campaign-page-header">
          <div class="campaign-page-header-spacer"></div>
          <div class="campaign-page-header-center">
            <div class="campaign-page-header-avatars">
              <div class="campaign-header-avatar-wrap">${campaignAvatarSection}</div>
              <div class="page-indicator-wrap" title="Editing for ${escapeHtml(project.name)}">
                <div class="page-indicator-avatar-wrap">${pageIndicator}</div>
              </div>
            </div>
            <div class="campaign-page-title-wrap">
              <h1 id="campaignName" class="campaign-detail-name-editable" title="Double-click to rename">${escapeHtml(title)}</h1>
              <h2 id="postTypeHeader" class="post-type-header-editable post-type-name-centered" title="Double-click to edit label">${escapeHtml((campaign.postTypes || []).find((p) => p.id === ptId)?.name || ptId)}</h2>
              <label class="deploy-toggle deploy-toggle-under-name">
                <input type="checkbox" id="deployed" ${isPostTypeDeployed(campaign, pid, ptId) ? 'checked' : ''} />
                <span>Deployed</span>
              </label>
            </div>
          </div>
          <div class="campaign-page-header-right"></div>
        </div>
      </section>

      <section class="card">
        <h2>Photo folders</h2>
        <p class="hint">Click a folder to view, add, or delete photos. One image with the lowest use number is picked from each folder per run (photos stay in the folder; the number on each shows how many times it has been used). Check &quot;Same Photo Each Time&quot; on a folder to reuse that folder&apos;s image for every post—so you can deploy more posts (e.g. 22) even if that folder has only 1 photo.</p>
        <div class="folders" id="foldersContainer">
          ${folderCards.join('')}
          <button type="button" class="btn btn-secondary add-folder-btn" id="addFolderBtn">+ Add folder</button>
        </div>
      </section>

      <section class="card">
        <h2>On-screen text (per folder)</h2>
        <p class="hint">Click a button to edit that folder’s text options.</p>
        <div class="folder-text-buttons">${textButtons.join('')}</div>
      </section>

      <section class="card">
        <h2>Text styling (per folder)</h2>
        <p class="hint">Position and style of the overlay text. Use X=0, Y=0 to center. Preview uses the same rendering as Run now—what you see is what you get.</p>
        <div class="text-style-folders">
          ${Array.from({ length: folderCount }, (_, i) => {
            const f = i + 1;
            const ts = (campaign.textStylePerFolder && campaign.textStylePerFolder[i]) || campaign.textStyle || {};
            const firstItem = (folders[`folder${f}`] || [])[0];
            const firstImg = typeof firstItem === 'string' ? firstItem : (firstItem && firstItem.filename);
            const imgUrl = firstImg ? folderImageUrl(pid, cid, f, firstImg, ptId) : '';
            const displayX = (ts.x === 50 || ts.x == null) ? 0 : ts.x;
            const displayY = (ts.y === 50 || ts.y == null) ? 0 : ts.y;
            const displaySize = (ts.fontSize != null && ts.fontSize >= 12 && ts.fontSize <= 200) ? Math.round(ts.fontSize) : 60;
            return `
          <div class="text-style-folder-card text-style-folder-card-live" data-folder="${f}">
            <h4 class="text-style-folder-title">Folder ${f}</h4>
            <div class="text-style-folder-row">
              <div class="text-style-settings-panel" data-folder="${f}">
                <div class="text-style-grid">
                  <label class="field"><span>X (%)</span><input type="number" data-folder="${f}" data-field="x" value="${displayX}" min="0" max="100" title="0 = center" /></label>
                  <label class="field"><span>Y (%)</span><input type="number" data-folder="${f}" data-field="y" value="${displayY}" min="0" max="100" title="0 = center" /></label>
                  <label class="field"><span>Size (px)</span><input type="number" data-folder="${f}" data-field="size" value="${displaySize}" min="12" max="200" step="1" title="Font size in pixels" /></label>
                  <label class="field"><span>Font</span><select data-folder="${f}" data-field="font" class="field-select">${(() => { const current = ts.font || 'Arial, sans-serif'; const fonts = AVAILABLE_FONTS.includes(current) ? AVAILABLE_FONTS : [current, ...AVAILABLE_FONTS]; return fonts.map((font) => `<option value="${escapeHtml(font)}" ${current === font ? 'selected' : ''}>${escapeHtml(font)}</option>`).join(''); })()}</select></label>
                  <label class="field"><span>Color</span><input type="text" data-folder="${f}" data-field="color" value="${escapeHtml(ts.color || 'white')}" /></label>
                  <label class="field"><span>Stroke</span><input type="number" data-folder="${f}" data-field="strokeWidth" value="${(ts.strokeWidth ?? 2)}" min="0" max="10" step="0.5" /></label>
                </div>
              </div>
              <div class="text-style-preview-panel" data-folder="${f}">
                <div class="text-style-preview-wrap">
                  <div class="text-style-preview-inner">
                    ${imgUrl ? `<img alt="" class="text-style-preview-img" data-folder="${f}" />` : '<div class="text-style-preview-placeholder">Add photos to folder to preview</div>'}
                    <div class="text-style-preview-loading" data-folder="${f}" style="display:none;">Loading…</div>
                  </div>
                  ${imgUrl ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px;" data-refresh-preview="${f}">Refresh preview</button>` : ''}
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
        </div>
        <button type="button" class="btn btn-secondary" id="saveTextStyle">Save text styles</button>
      </section>

      <section class="card">
        <h2>Schedule</h2>
        <p class="hint">When this campaign runs (if deployed). Set date range, times per day, and days of week. Times use your selected timezone (Settings → Display timezone).</p>
        <div class="schedule-content">
          <label class="checkbox-field">
            <input type="checkbox" id="scheduleEnabled" ${campaign.scheduleEnabled !== false ? 'checked' : ''} />
            <span>Run on schedule</span>
          </label>
          <div class="schedule-date-range">
            <label class="field"><span>Start date</span><input type="date" id="scheduleStartDate" value="${scheduleStart}" /></label>
            <label class="field"><span>End date</span><input type="date" id="scheduleEndDate" value="${scheduleEnd}" /></label>
          </div>
          <div class="schedule-days">
            <span class="field-label">Days of week</span>
            <div class="schedule-days-checkboxes">
              ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<label class="checkbox-field checkbox-inline"><input type="checkbox" class="schedule-day" data-day="${d}" ${daysOfWeek.includes(d) ? 'checked' : ''} /><span>${dayNames[d]}</span></label>`).join('')}
            </div>
          </div>
          <div class="schedule-times-wrap">
            <div class="schedule-times-header">
              <span class="field-label">Post times (${times.length} per day)</span>
              <button type="button" class="btn btn-ghost btn-sm" id="addScheduleTime">+ Add time</button>
              <button type="button" class="btn btn-ghost btn-sm" id="removeScheduleTime">− Remove</button>
            </div>
            <div class="schedule-times" id="scheduleTimes">
              ${times.map((t, i) => `
            <label class="time-row">
              <input type="time" class="time-input" data-index="${i}" value="${t || '10:00'}" />
            </label>
          `).join('')}
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary" id="saveCampaign">Save campaign</button>
      </section>

      <section class="card">
        <h2>Run now & Generated URLs</h2>
        <p class="hint">Run once to generate images and URLs. Send these URLs to Blotato/n8n.</p>
        <label class="field" style="margin-bottom:8px;">
          <span>Post title (optional, max 90 chars)</span>
          <input type="text" id="postTitle" value="${escapeHtml(photoPt?.title || '')}" maxlength="90" placeholder="Leave blank for no title" style="max-width:420px;" />
        </label>
        <p class="hint" style="margin-top:-4px;margin-bottom:12px;">Title shown on TikTok carousel posts. No effect on videos.</p>
        <label class="checkbox-field" style="margin-bottom:12px;">
          <input type="checkbox" id="sendAsDraft" ${campaign.sendAsDraft ? 'checked' : ''} />
          <span>Send to Blotato as draft</span>
        </label>
        <p class="hint" style="margin-top:-8px;margin-bottom:12px;">When checked, the post goes to TikTok drafts (mobile app) instead of publishing immediately.</p>
        <label class="checkbox-field" style="margin-bottom:12px;"><input type="checkbox" id="addMusicToCarousel" ${campaign.addMusicToCarousel ? 'checked' : ''} /><span>Add music to carousel</span></label>
        <p class="hint" style="margin-top:-8px;margin-bottom:12px;">When checked, Blotato will auto-add music to the carousel post.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="runNow">Run now</button>
          <button type="button" class="btn btn-secondary" id="clearUrlsBtn">Clear URLs</button>
        </div>
        <div class="run-status" id="runStatus"></div>
        <div class="urls-wrap" id="urlsWrap">
          <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run to generate media URLs.'}</div>
          <ul class="urls-list" id="urlsList"></ul>
          <button type="button" class="btn btn-secondary btn-copy-all" id="copyAllUrls" style="display: none;">Copy all URLs</button>
        </div>
      </section>

    `;

    function updateFolderCounts() {
      apiCampaignFolders(pid, cid, ptId).then((f) => {
        const fol = f.folders || {};
        for (let i = 1; i <= folderCount; i++) {
          const el = document.getElementById(`count${i}`);
          const list = fol[`folder${i}`] || [];
          if (el) el.textContent = `${list.length} photo${list.length !== 1 ? 's' : ''}`;
          if (!hideFolderThumbnails) {
            const thumbsEl = document.getElementById(`dropzoneThumbs${i}`);
            if (thumbsEl) {
              thumbsEl.innerHTML = list.map((item) => {
                const filename = typeof item === 'string' ? item : (item && item.filename) || '';
                const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
                const url = folderImageUrl(pid, cid, i, filename, ptId);
                return `<div class="dropzone-thumb" title="${escapeHtml(filename)}"><img data-src="${url}" alt="" class="dropzone-thumb-img" /><span class="folder-photo-usage-badge">${usageCount}</span></div>`;
              }).join('');
              thumbsEl.querySelectorAll('img[data-src]').forEach((img) => {
                withAuthQuery(img.dataset.src).then((u) => { img.src = u; img.removeAttribute('data-src'); });
              });
            }
          }
        }
      });
    }

    for (let num = 1; num <= folderCount; num++) {
      const dropzone = document.getElementById(`dropzone${num}`);
      const input = document.getElementById(`input${num}`);
      const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
      const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
      if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = contentPostTypeLink(pid, cid, ptId, `photos/${num}`); };
      if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
      if (dropzone && input) {
        dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
        dropzone.ondragleave = () => dropzone.classList.remove('dragover');
        dropzone.ondrop = (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          const files = e.dataTransfer.files;
          if (!files?.length) return;
          campaignUploadWithProgress(pid, cid, num, files, ptId).then(updateFolderCounts).catch((err) => showAlert(err.message || 'Upload failed'));
        };
      }
      if (input) input.onchange = (e) => {
        const files = e.target.files;
        if (!files?.length) return;
        campaignUploadWithProgress(pid, cid, num, files, ptId).then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => showAlert(err.message || 'Upload failed'));
      };
      const deleteBtn = dropzone && dropzone.querySelector('.dropzone-delete');
      if (deleteBtn) deleteBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Delete this folder and its photos?').then((ok) => {
          if (!ok) return;
          apiDeleteFolder(pid, cid, num, ptId).then(() => render()).catch((err) => showAlert(err.message || 'Failed'));
        });
      };
    }

    updateFolderCounts();
    const addFolderBtn = document.getElementById('addFolderBtn');
    if (addFolderBtn) {
      addFolderBtn.onclick = () => {
        apiAddFolder(pid, cid, ptId).then(() => render()).catch((err) => showAlert(err.message || err.error || 'Failed to add folder'));
      };
    }
    function getSamePhotoEachTimePerFolder() {
      const arr = [];
      document.querySelectorAll('.same-photo-each-time').forEach((cb) => {
        const num = parseInt(cb.dataset.folderNum, 10);
        if (num >= 1) {
          while (arr.length < num) arr.push(false);
          arr[num - 1] = cb.checked;
        }
      });
      while (arr.length < folderCount) arr.push(false);
      return arr;
    }
    document.querySelectorAll('.same-photo-each-time').forEach((cb) => {
      cb.addEventListener('change', () => {
        const samePhotoEachTimePerFolder = getSamePhotoEachTimePerFolder();
        apiUpdateCampaign(pid, cid, { ...campaign, samePhotoEachTimePerFolder }, ptId).then((c) => { campaign = c; });
      });
    });
    const campAvatarImg = document.getElementById('campaignAvatarImg');
    const campAvatarPlaceholder = document.getElementById('campaignAvatarPlaceholder');
    const campAvatarInput = document.getElementById('campaignAvatarInput');
    const campAvatarInner = document.getElementById('campaignHeaderAvatarInner');
    if (campAvatarImg && campAvatarImg.complete && campAvatarImg.naturalWidth) campAvatarPlaceholder && (campAvatarPlaceholder.style.display = 'none');
    else campAvatarPlaceholder && (campAvatarPlaceholder.style.display = 'flex');
    if (campAvatarInner && campAvatarInput) { campAvatarInner.onclick = () => campAvatarInput.click(); campAvatarInner.title = 'Click to change image'; }
    if (campAvatarInput) {
      campAvatarInput.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        apiUploadCampaignAvatar(cid, file).then(() => {
          bumpAvatarVersion('campaign', cid);
          if (campAvatarImg) { campAvatarImg.src = campaignAvatarUrl(cid); campAvatarImg.style.display = ''; campAvatarPlaceholder && (campAvatarPlaceholder.style.display = 'none'); }
          campAvatarInput.value = '';
        }).catch((err) => showAlert(err.message || 'Upload failed'));
      };
    }
    const campaignNameEl = document.getElementById('campaignName');
    if (campaignNameEl) campaignNameEl.ondblclick = () => {
      showPrompt('Campaign name:', campaign.name).then((name) => {
        if (name != null && name.trim()) {
          apiUpdateCampaign(pid, cid, { ...campaign, name: name.trim() }, ptId).then((c) => {
            campaign = c;
            if (campaignNameEl) campaignNameEl.textContent = c.name;
          });
        }
      });
    };
    const postTypeHeaderEl = document.getElementById('postTypeHeader');
    if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
      const pt = (campaign.postTypes || []).find((p) => p.id === ptId);
      const current = pt ? pt.name : ptId;
      showPrompt('Post type label:', current).then((name) => {
        if (name != null && name.trim()) {
          apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => {
            campaign = c;
            if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim();
          }).catch((err) => showAlert(err.message || 'Failed'));
        }
      });
    };
    document.getElementById('deployed').onchange = (e) => {
      apiUpdateCampaign(pid, cid, { ...campaign, deployed: e.target.checked }, ptId).then((c) => { campaign = c; });
    };
    document.getElementById('scheduleEnabled').onchange = (e) => {
      campaign.scheduleEnabled = e.target.checked;
    };
    const scheduleTimesEl = document.getElementById('scheduleTimes');
    scheduleTimesEl.querySelectorAll('.time-input').forEach((input) => {
      input.onchange = () => {
        const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00');
        campaign.scheduleTimes = timesArr;
      };
    });
    const addTimeBtn = document.getElementById('addScheduleTime');
    const removeTimeBtn = document.getElementById('removeScheduleTime');
    if (addTimeBtn) addTimeBtn.onclick = () => {
      const inputs = scheduleTimesEl.querySelectorAll('.time-input');
      const lastVal = inputs.length ? inputs[inputs.length - 1].value : '10:00';
      const [h, m] = lastVal.split(':').map(Number);
      const nextH = (h + 2) % 24;
      const nextVal = `${String(nextH).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
      const label = document.createElement('label');
      label.className = 'time-row';
      label.innerHTML = `<input type="time" class="time-input" data-index="${inputs.length}" value="${nextVal}" />`;
      scheduleTimesEl.appendChild(label);
      label.querySelector('input').onchange = () => {
        campaign.scheduleTimes = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00');
      };
    };
    if (removeTimeBtn) removeTimeBtn.onclick = () => {
      const rows = scheduleTimesEl.querySelectorAll('.time-row');
      if (rows.length <= 1) return;
      rows[rows.length - 1].remove();
    };
    document.getElementById('saveCampaign').onclick = () => {
      const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00').map((t) => convertTimeToServer(userTz, serverTz, t));
      const daysChecked = Array.from(document.querySelectorAll('.schedule-day:checked')).map((cb) => parseInt(cb.dataset.day, 10));
      apiUpdateCampaign(pid, cid, {
        ...campaign,
        scheduleEnabled: document.getElementById('scheduleEnabled').checked,
        scheduleTimes: timesArr,
        scheduleStartDate: document.getElementById('scheduleStartDate')?.value || null,
        scheduleEndDate: document.getElementById('scheduleEndDate')?.value || null,
        scheduleDaysOfWeek: daysChecked,
      }, ptId).then((c) => { campaign = c; });
      const status = document.getElementById('runStatus');
      status.textContent = 'Campaign saved.';
      status.className = 'run-status success';
      setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000);
    };

    const saveTextStyleBtn = document.getElementById('saveTextStyle');
    if (saveTextStyleBtn) saveTextStyleBtn.onclick = () => {
      const textStylePerFolder = [];
      for (let f = 1; f <= folderCount; f++) {
        const get = (field) => {
          const el = document.querySelector(`[data-folder="${f}"][data-field="${field}"]`);
          return el ? el.value : null;
        };
        const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(get('size')) || 48)));
        textStylePerFolder.push({
          x: parseFloat(get('x')) ?? 50,
          y: parseFloat(get('y')) ?? 92,
          fontSize: sizePx,
          font: (get('font') || 'Arial, sans-serif').trim(),
          color: (get('color') || 'white').trim(),
          strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
        });
      }
      const status = document.getElementById('runStatus');
      apiUpdateCampaign(pid, cid, { ...campaign, textStylePerFolder }, ptId)
        .then((c) => {
          campaign = c;
          if (status) { status.textContent = 'Text styles saved.'; status.className = 'run-status success'; setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000); }
        })
        .catch((err) => {
          if (status) { status.textContent = err.message || 'Failed to save text styles'; status.className = 'run-status error'; }
          showAlert(err?.message || 'Failed to save text styles.');
        });
    };

    const previewBlobUrls = {};
    const previewAbortControllers = {};
    function fetchTextStylePreview(f) {
      const img = document.querySelector(`.text-style-preview-img[data-folder="${f}"]`);
      const loading = document.querySelector(`.text-style-preview-loading[data-folder="${f}"]`);
      if (!img) return;
      if (previewAbortControllers[f]) previewAbortControllers[f].abort();
      const ac = new AbortController();
      previewAbortControllers[f] = ac;
      const get = (field) => {
        const el = document.querySelector(`[data-folder="${f}"][data-field="${field}"]`);
        return el ? el.value : null;
      };
      const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(get('size')) || 60)));
      const textStyle = {
        x: parseFloat(get('x')) || 0,
        y: parseFloat(get('y')) || 0,
        fontSize: sizePx,
        font: (get('font') || 'Arial, sans-serif').trim(),
        color: (get('color') || 'white').trim(),
        strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
      };
      const opts = (textOptionsPerFolder[f - 1]);
      const sampleText = (opts && opts.length && opts[0]) ? String(opts[0]) : null;
      if (loading) { loading.style.display = 'block'; loading.textContent = 'Loading…'; }
      img.style.opacity = '0.3';
      apiTextStylePreview(pid, cid, f, textStyle, sampleText, textOptionsPerFolder, ac.signal, ptId)
        .then((data) => {
          if (ac.signal.aborted) return;
          if (previewBlobUrls[f]) URL.revokeObjectURL(previewBlobUrls[f]);
          previewBlobUrls[f] = null;
          if (data.base64) {
            img.src = 'data:image/jpeg;base64,' + data.base64;
            img.style.opacity = '1';
            if (loading) { loading.style.display = 'none'; loading.textContent = 'Loading…'; }
            return;
          }
          let url = (data.url || '').trim();
          if (!url) {
            if (loading) { loading.style.display = 'flex'; loading.textContent = 'No preview URL returned'; }
            img.style.opacity = '1';
            return;
          }
          url = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
          if (url.startsWith('/')) url = window.location.origin + url;
          else if (!/^https?:\/\//i.test(url)) url = (window.location.protocol || 'https:') + '//' + url;
          img.onerror = () => {
            if (loading) { loading.style.display = 'flex'; loading.textContent = 'Image failed to load'; }
            img.style.opacity = '1';
          };
          img.onload = () => {
            if (loading) { loading.style.display = 'none'; loading.textContent = 'Loading…'; }
            img.style.opacity = '1';
          };
          img.src = url;
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          img.style.opacity = '1';
          if (loading) { loading.style.display = 'flex'; loading.textContent = err.message || 'Preview failed'; }
        });
    }

    let previewDebounce = {};
    function schedulePreviewRefresh(folder) {
      clearTimeout(previewDebounce[folder]);
      previewDebounce[folder] = setTimeout(() => fetchTextStylePreview(folder), 150);
    }
    main.querySelectorAll('.text-style-folder-card input, .text-style-folder-card select').forEach((el) => {
      const folder = parseInt(el.dataset?.folder, 10);
      if (!folder) return;
      el.addEventListener('input', () => schedulePreviewRefresh(folder));
      el.addEventListener('change', () => schedulePreviewRefresh(folder));
    });

    main.querySelectorAll('[data-refresh-preview]').forEach((btn) => {
      const folder = parseInt(btn.dataset.refreshPreview, 10);
      if (folder) btn.onclick = () => fetchTextStylePreview(folder);
    });

    main.querySelectorAll('.text-style-folder-card').forEach((card) => {
      const folder = parseInt(card?.dataset?.folder, 10);
      if (folder && card.querySelector('.text-style-preview-img')) schedulePreviewRefresh(folder);
    });

    const clearUrlsBtn = document.getElementById('clearUrlsBtn');
    if (clearUrlsBtn) clearUrlsBtn.onclick = () => {
      showConfirm('Clear all generated URLs?').then((ok) => {
        if (!ok) return;
        apiClearCampaignUrls(pid, cid).then(() => {
          const placeholder = document.getElementById('urlsPlaceholder');
          const list = document.getElementById('urlsList');
          const copyAllBtn = document.getElementById('copyAllUrls');
          if (placeholder) { placeholder.style.display = 'block'; placeholder.textContent = 'Run to generate media URLs.'; }
          if (list) list.innerHTML = '';
          if (copyAllBtn) copyAllBtn.style.display = 'none';
        });
      });
    };

    function getCurrentTextStylePerFolder() {
      const textStylePerFolder = [];
      for (let f = 1; f <= folderCount; f++) {
        const get = (field) => {
          const el = document.querySelector(`[data-folder="${f}"][data-field="${field}"]`);
          return el ? el.value : null;
        };
        const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(get('size')) || 60)));
        textStylePerFolder.push({
          x: parseFloat(get('x')) || 0,
          y: parseFloat(get('y')) || 0,
          fontSize: sizePx,
          font: (get('font') || 'Arial, sans-serif').trim(),
          color: (get('color') || 'white').trim(),
          strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
        });
      }
      return textStylePerFolder;
    }

    document.getElementById('runNow').onclick = () => {
      const btn = document.getElementById('runNow');
      const status = document.getElementById('runStatus');
      if (btn.disabled) return;
      btn.disabled = true;
      status.textContent = 'Running…';
      status.className = 'run-status loading';
      const textStylePerFolder = getCurrentTextStylePerFolder();
      const textOptionsPerFolder = campaign.textOptionsPerFolder || [];
      const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
      const addMusicToCarousel = !!document.getElementById('addMusicToCarousel')?.checked;
      apiUpdateCampaign(pid, cid, { ...campaign, textStylePerFolder, sendAsDraft, addMusicToCarousel }, ptId).then((c) => { campaign = c; }).catch(() => {});
      apiCampaignRun(pid, cid, textStylePerFolder, textOptionsPerFolder, sendAsDraft, addMusicToCarousel, ptId)
        .then((data) => {
          if (data.error) throw new Error(data.error);
          let msg = `Done. ${(data.webContentUrls || []).length} URL(s) generated.`;
          if (data.blotatoSent) msg += data.blotatoSentAsDraft ? ' Sent to Blotato as draft.' : ' Sent to Blotato.';
          else if (data.blotatoError) msg += ` Blotato: ${data.blotatoError}`;
          status.textContent = msg;
          status.className = 'run-status success';
          showUrls(data.webContentUrls || [], data.webContentBase64 || []);
        })
        .catch((err) => {
          status.textContent = err.message || 'Run failed';
          status.className = 'run-status error';
        })
        .finally(() => { btn.disabled = false; });
    };

    const postTitleInput = document.getElementById('postTitle');
    if (postTitleInput) {
      postTitleInput.onblur = () => {
        const val = postTitleInput.value.trim().slice(0, 90);
        apiUpdatePostType(pid, cid, ptId, { title: val }).then((c) => { campaign = c; }).catch(() => {});
      };
    }

    function showUrls(urls, base64Images = []) {
      const placeholder = document.getElementById('urlsPlaceholder');
      const list = document.getElementById('urlsList');
      const copyAllBtn = document.getElementById('copyAllUrls');
      if (!urls.length) {
        placeholder.style.display = 'block';
        placeholder.textContent = 'Run to generate media URLs.';
        list.innerHTML = '';
        copyAllBtn.style.display = 'none';
        return;
      }
      placeholder.style.display = 'none';
      copyAllBtn.style.display = 'inline-block';
      list.innerHTML = urls.map((url, i) => {
        const dataUrl = base64Images[i] ? `data:image/jpeg;base64,${base64Images[i]}` : '';
        return `
        <li class="url-item">
          ${dataUrl ? `<img src="${dataUrl}" alt="" class="url-thumb" title="Click to view full size" />` : ''}
          <span class="url-text">${escapeHtml(url)}</span>
          <button type="button" class="btn btn-secondary btn-copy-url">Copy</button>
        </li>
      `}).join('');
      list.querySelectorAll('.url-thumb').forEach((img) => {
        img.onclick = () => window.open(img.src, '_blank');
      });
      list.querySelectorAll('.btn-copy-url').forEach((btn, i) => {
        btn.onclick = () => {
          navigator.clipboard.writeText(urls[i]);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        };
      });
      copyAllBtn.onclick = () => {
        navigator.clipboard.writeText(urls.join('\n'));
        copyAllBtn.textContent = 'Copied!';
        setTimeout(() => { copyAllBtn.textContent = 'Copy all URLs'; }, 1500);
      };
    }
    if ((latest.webContentUrls || []).length) showUrls(latest.webContentUrls, latest.webContentBase64 || []);
  });
}

function renderCampaignFolderPhotos(projectId, campaignId, folderNum, postTypeId) {
  const pid = projectId;
  const cid = campaignId;
  const ptId = postTypeId || 'default';
  const fnum = parseInt(folderNum, 10);
  if (!fnum || fnum < 1) { render(); return; }
  Promise.all([
    apiProjects().then((list) => list.find((p) => p.id === parseInt(pid, 10))),
    apiCampaign(pid, cid, ptId),
    apiCampaignFolders(pid, cid, ptId),
  ]).then(([project, campaign, foldersData]) => {
    if (!project || !campaign) { document.getElementById('main').innerHTML = '<section class="card"><p>Not found.</p></section>'; return; }
    setBreadcrumb({ view: 'campaignFolderPhotos', projectId: pid, campaignId: cid, folderNum: String(fnum) }, project, campaign, fnum);
    const list = (foldersData.folders || {})[`folder${fnum}`] || [];
    const main = document.getElementById('main');
    const folderCount = Math.max(1, foldersData.folderCount || (campaign.folderCount || 3));
    const canDeleteFolder = folderCount > 1;
    main.innerHTML = `
      <section class="card">
        <p class="back-link-wrap"><a href="${contentPostTypeLink(pid, cid, ptId, '')}" class="nav-link">← Back to post type</a></p>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <h1 style="margin:0;">Folder ${fnum} – photos</h1>
          ${canDeleteFolder ? `<button type="button" class="btn btn-ghost" id="folderPhotosDeleteFolderBtn">Delete folder</button>` : ''}
        </div>
        <p class="hint">Add or remove images. One image with the lowest use number is picked per run (all get used before any is reused). The number on each photo shows how many times it has been used.</p>
        <div class="folder-photos-grid" id="folderPhotosGrid"></div>
        <div class="folder-photos-actions" style="margin-top:1rem; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <input type="file" accept="image/*" multiple id="folderPhotosInput" hidden />
          <button type="button" class="btn btn-secondary" id="folderPhotosAddBtn">Add photos</button>
          <button type="button" class="btn btn-ghost" id="folderPhotosClearBtn" data-action="clear-folder-photos">Clear folder</button>
        </div>
      </section>
    `;
    const grid = document.getElementById('folderPhotosGrid');
    const addInput = document.getElementById('folderPhotosInput');
    const addBtn = document.getElementById('folderPhotosAddBtn');
    const clearBtn = document.getElementById('folderPhotosClearBtn');

    function revokeObjectUrlsInGrid() {
      if (!grid) return;
      grid.querySelectorAll('img[data-object-url]').forEach((img) => {
        const u = img.dataset.objectUrl;
        if (u) try { URL.revokeObjectURL(u); } catch (_) {}
      });
    }
    function refresh() {
      apiCampaignFolders(pid, cid, ptId, { cacheBust: true }).then((data) => {
        const imgs = (data.folders || {})[`folder${fnum}`] || [];
        if (!grid) return;
        revokeObjectUrlsInGrid();
        grid.innerHTML = imgs.map((item) => {
          const filename = typeof item === 'string' ? item : (item && item.filename) || '';
          const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
          const apiUrl = folderImageUrl(pid, cid, fnum, filename, ptId);
          return `
          <div class="folder-photo-item">
            <img data-src="${apiUrl}" alt="" loading="lazy" />
            <span class="folder-photo-usage-badge" title="Times used in runs">${usageCount}</span>
            <button type="button" class="folder-photo-delete" data-filename="${escapeHtml(filename)}">×</button>
          </div>
        `}).join('');
        grid.querySelectorAll('img[data-src]').forEach((img) => {
          const url = img.dataset.src;
          img.removeAttribute('data-src');
          withAuthQuery(url).then((authUrl) => {
            img.src = authUrl;
          }).catch(() => { img.alt = 'Failed to load'; });
        });
        grid.querySelectorAll('.folder-photo-delete').forEach((btn) => {
          btn.onclick = () => {
            apiDeleteFolderImage(pid, cid, fnum, btn.dataset.filename, ptId).then(refresh).catch(() => showAlert('Delete failed'));
          };
        });
      });
    }
    refresh();

    addBtn.onclick = () => addInput.click();
    addInput.onchange = (e) => {
      const files = e.target.files;
      if (!files?.length) return;
      campaignUploadWithProgress(pid, cid, fnum, files, ptId)
        .then(() => { setTimeout(refresh, 80); })
        .catch(() => showAlert('Upload failed'));
      addInput.value = '';
    };
    const card = main.querySelector('.card');
    if (card) {
      card.addEventListener('click', (e) => {
        if (e.target.id !== 'folderPhotosClearBtn' && e.target.closest('[data-action="clear-folder-photos"]') === null) return;
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Delete all photos in this folder from the server? This cannot be undone.').then((ok) => {
          if (!ok) return;
          apiClearFolder(pid, cid, fnum, ptId).then((r) => {
            refresh();
            showToast(r.deleted !== undefined ? `Cleared ${r.deleted} photo(s).` : 'Folder cleared.', 'success');
          }).catch(() => showAlert('Failed to clear folder'));
        });
      });
    }
    const deleteFolderBtn = document.getElementById('folderPhotosDeleteFolderBtn');
    if (deleteFolderBtn) deleteFolderBtn.onclick = () => {
      showConfirm(`Delete folder ${fnum} and its photos?`).then((ok) => {
        if (!ok) return;
        apiDeleteFolder(pid, cid, fnum, ptId).then(() => { location.hash = contentPostTypeLink(pid, cid, ptId, ''); render(); }).catch((err) => showAlert(err.message || 'Failed'));
      });
    };
  });
}

function renderCampaignFolderVideos(projectId, campaignId, folderNum, postTypeId) {
  const pid = projectId;
  const cid = campaignId;
  const ptId = postTypeId || 'default';
  const fnum = parseInt(folderNum, 10);
  const folderLabels = { 1: 'Priority videos', 2: 'Fallback videos' };
  if (!fnum || fnum < 1) { render(); return; }
  if (fnum > 2) { render(); return; }
  Promise.all([
    apiProjects().then((list) => list.find((p) => p.id === parseInt(pid, 10))),
    apiCampaign(pid, cid, ptId),
    apiCampaignFolders(pid, cid, ptId),
  ]).then(([project, campaign, foldersData]) => {
    if (!project || !campaign) { document.getElementById('main').innerHTML = '<section class="card"><p>Not found.</p></section>'; return; }
    const isVideoText = campaign.mediaType === 'video_text';
    const title = isVideoText ? 'Videos' : (folderLabels[fnum] || `Folder ${fnum}`) + ' – videos';
    const hint = isVideoText ? 'Add or remove videos. One video with the lowest use number is picked per run (all get used before any is reused). The number on each shows how many times it has been used. Max 50 MB per video.' : 'Add or remove videos. Each video is posted only once. After posting, it stays in the folder for 7 days with a "Video posted" overlay, then is permanently deleted. Only unposted videos are used for new runs.';
    const list = (foldersData.folders || {})[`folder${fnum}`] || [];
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card">
        <p class="back-link-wrap"><a href="${contentPostTypeLink(pid, cid, ptId, '')}" class="nav-link">← Back to post type</a></p>
        <h1 style="margin:0;">${title}</h1>
        <p class="hint">${hint}</p>
        <div class="folder-photos-grid" id="folderVideosGrid"></div>
        <div class="folder-photos-actions" style="margin-top:1rem;">
          <input type="file" accept="video/*" multiple id="folderVideosInput" hidden />
          <button type="button" class="btn btn-secondary" id="folderVideosAddBtn">Add videos</button>
          <button type="button" class="btn btn-secondary" id="folderVideosDownloadZipBtn">Download all as ZIP</button>
          <button type="button" class="btn btn-ghost" id="folderVideosClearBtn" data-action="clear-folder-videos">Clear folder</button>
        </div>
      </section>
    `;
    const grid = document.getElementById('folderVideosGrid');
    const addInput = document.getElementById('folderVideosInput');
    const addBtn = document.getElementById('folderVideosAddBtn');
    const downloadZipBtn = document.getElementById('folderVideosDownloadZipBtn');
    const clearBtn = document.getElementById('folderVideosClearBtn');

    if (downloadZipBtn) {
      downloadZipBtn.onclick = () => {
        const url = `${API}/api/projects/${pid}/campaigns/${cid}/folders/${fnum}/download-zip?postTypeId=${encodeURIComponent(ptId)}`;
        downloadZipBtn.disabled = true;
        downloadZipBtn.textContent = 'Preparing…';
        withAuthQuery(url)
          .then((authUrl) => fetch(authUrl))
          .then((r) => {
            if (!r.ok) throw new Error(r.status === 400 ? 'No videos in this folder.' : 'Download failed');
            return r.blob();
          })
          .then((blob) => {
            const u = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = u;
            a.download = `folder${fnum}-videos.zip`;
            a.click();
            URL.revokeObjectURL(u);
          })
          .catch((err) => showAlert(err.message || 'Download failed'))
          .finally(() => {
            downloadZipBtn.disabled = false;
            downloadZipBtn.textContent = 'Download all as ZIP';
          });
      };
    }

    function revokeVideoObjectUrls() {
      if (!grid) return;
      grid.querySelectorAll('video[data-object-url]').forEach((v) => {
        const u = v.dataset.objectUrl;
        if (u) try { URL.revokeObjectURL(u); } catch (_) {}
      });
    }
    function refresh() {
      apiCampaignFolders(pid, cid, ptId, { cacheBust: true }).then((data) => {
        const videos = (data.folders || {})[`folder${fnum}`] || [];
        if (!grid) return;
        revokeVideoObjectUrls();
        grid.innerHTML = videos.map((item) => {
          const filename = typeof item === 'string' ? item : (item && item.filename) || '';
          const usageCount = typeof item === 'object' && item && 'usageCount' in item ? item.usageCount : 0;
          const postedAt = typeof item === 'object' && item && item.postedAt;
          const daysLeft = typeof item === 'object' && item && typeof item.daysLeft === 'number' ? item.daysLeft : null;
          const mediaUrl = folderMediaUrl(pid, cid, fnum, filename, ptId);
          const overlayHtml = !isVideoText && postedAt
            ? `<div class="folder-video-posted-overlay" title="Posted; will be deleted in ${daysLeft} day(s)">
                <span class="folder-video-posted-label">Video posted</span>
                <span class="folder-video-posted-days">${daysLeft} day${daysLeft !== 1 ? 's' : ''} left before deleted</span>
              </div>`
            : '';
          const badgeHtml = isVideoText
            ? `<span class="folder-photo-usage-badge" title="Times used in runs">${usageCount}</span>`
            : '';
          return `
          <div class="folder-photo-item folder-video-item${postedAt ? ' folder-video-posted' : ''}">
            <div class="folder-video-preview-wrap">
              <video data-src="${escapeHtml(mediaUrl)}" controls preload="metadata" style="max-width:100%;max-height:200px;background:#111;"></video>
              ${overlayHtml}
            </div>
            ${badgeHtml}
            <button type="button" class="folder-photo-delete" data-filename="${escapeHtml(filename)}">×</button>
          </div>
        `;
        }).join('');
        grid.querySelectorAll('video[data-src]').forEach((v) => {
          const url = v.dataset.src;
          if (!url) return;
          withAuthQuery(url).then((authUrl) => {
            v.src = authUrl;
            v.removeAttribute('data-src');
          }).catch(() => {});
        });
        grid.querySelectorAll('.folder-photo-delete').forEach((btn) => {
          btn.onclick = () => {
            apiDeleteFolderMedia(pid, cid, fnum, btn.dataset.filename, ptId).then(refresh).catch(() => showAlert('Delete failed'));
          };
        });
      });
    }
    refresh();

    addBtn.onclick = () => addInput.click();
    addInput.onchange = (e) => {
      const files = e.target.files;
      if (!files?.length) return;
      const pt = (campaign.postTypes || []).find((p) => p.id === ptId);
      const mediaType = (pt && pt.mediaType === 'video_text') ? 'video_text' : 'video';
      campaignUploadWithProgress(pid, cid, fnum, files, ptId, mediaType)
        .then(() => { setTimeout(refresh, 80); })
        .catch((err) => showAlert(err.message || 'Upload failed'));
      addInput.value = '';
    };
    const cardVideos = main.querySelector('.card');
    if (cardVideos) {
      cardVideos.addEventListener('click', (e) => {
        if (e.target.id !== 'folderVideosClearBtn' && e.target.closest('[data-action="clear-folder-videos"]') === null) return;
        e.preventDefault();
        e.stopPropagation();
        showConfirm('Delete all videos in this folder from the server and Supabase? This cannot be undone.').then((ok) => {
          if (!ok) return;
          apiClearFolder(pid, cid, fnum, ptId).then((r) => {
            refresh();
            showToast(r.deleted !== undefined ? `Cleared ${r.deleted} video(s).` : 'Folder cleared.', 'success');
          }).catch(() => showAlert('Failed to clear folder'));
        });
      });
    }
  });
}

function renderCampaignFolderText(projectId, campaignId, folderNum, postTypeId) {
  const pid = projectId;
  const cid = campaignId;
  const ptId = postTypeId || 'default';
  const fnum = parseInt(folderNum, 10);
  if (!fnum || fnum < 1) { render(); return; }
  Promise.all([
    apiProjects().then((list) => list.find((p) => p.id === parseInt(pid, 10))),
    apiCampaign(pid, cid, ptId),
  ]).then(([project, campaign]) => {
    if (!project || !campaign) { document.getElementById('main').innerHTML = '<section class="card"><p>Not found.</p></section>'; return; }
    setBreadcrumb({ view: 'campaignFolder', projectId: pid, campaignId: cid, folderNum }, project, campaign, folderNum);
    const textOptionsPerFolder = campaign.textOptionsPerFolder || [];
    const opts = textOptionsPerFolder[fnum - 1] || [];
    const textUsage = {};
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card" id="folderTextOptionsCard">
        <p class="back-link-wrap"><a href="${contentPostTypeLink(pid, cid, ptId, '')}" class="nav-link">← Back to post type</a></p>
        <h1>Folder ${fnum} – on-screen text options</h1>
        <p class="hint">One option is chosen at random per image from this folder. Long options show two lines; click ⋯ to expand.</p>
        <ul class="text-options-list" id="folderTextList"></ul>
        <div class="text-options-actions">
          <textarea id="folderNewText" class="folder-text-bubble-input" placeholder="New option… (Shift+Enter for new line)" rows="2" style="resize:none;min-height:44px;"></textarea>
          <button type="button" class="btn btn-secondary folder-add-bubble" id="folderAddBtn" name="folderAddBtn">Add</button>
        </div>
      </section>
    `;
    const list = document.getElementById('folderTextList');
    const newInput = document.getElementById('folderNewText');
    const addBtn = document.getElementById('folderAddBtn');

    /** PUT returns campaign with postTypes only; normalize so campaign.textOptionsPerFolder is set from the current post type. */
    function applyCampaignResponse(c) {
      if (!c) return c;
      if (c.textOptionsPerFolder != null && Array.isArray(c.textOptionsPerFolder)) return c;
      const pts = c.postTypes || [];
      const pt = pts.find((p) => p.id === ptId);
      const textOptionsPerFolder = (pt && pt.textOptionsPerFolder) != null ? pt.textOptionsPerFolder : (c.textOptionsPerFolder || []);
      return { ...c, textOptionsPerFolder };
    }

    function renderList(options) {
      if (!list) return;
      const arr = options || [];
      const countEl = document.getElementById('folderTextOptionsCount');
      if (countEl) {
        countEl.textContent = `${arr.length} text option${arr.length !== 1 ? 's' : ''}`;
      }
      list.innerHTML = arr.map((text, i) => {
        const count = textUsage[`${fnum}:${i}`] || 0;
        const safeText = escapeHtml(text);
        const lineCount = (text.match(/\n/g) || []).length + 1;
        const isLong = lineCount > 2 || text.length > 120;
        return `
        <li class="folder-text-option-row${isLong ? ' folder-text-option-long' : ''}" data-index="${i}">
          <span class="folder-text-option-index">${i + 1}</span>
          <span class="folder-text-option-preview">${safeText}</span>
          ${isLong ? '<button type="button" class="folder-text-option-expand" aria-label="Show full text">⋯</button>' : ''}
          ${count > 0 ? `<span class="folder-photo-usage-badge" title="Times used">${count}</span>` : ''}
          <button type="button" class="folder-text-option-remove" aria-label="Remove" data-index="${i}">×</button>
        </li>
      `;
      }).join('');
      list.querySelectorAll('.folder-text-option-remove').forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          if (Number.isNaN(idx) || idx < 0) return;
          const currentOpts = (campaign.textOptionsPerFolder || [])[fnum - 1];
          if (!Array.isArray(currentOpts)) return;
          const next = currentOpts.filter((_, j) => j !== idx);
          const newPerFolder = [...(campaign.textOptionsPerFolder || [])];
          while (newPerFolder.length <= fnum - 1) newPerFolder.push([]);
          newPerFolder[fnum - 1] = next;
          apiUpdateCampaign(pid, cid, { ...campaign, textOptionsPerFolder: newPerFolder }, ptId)
            .then((c) => {
              campaign = applyCampaignResponse(c);
              renderList(campaign.textOptionsPerFolder[fnum - 1] || []);
              return apiCampaign(pid, cid, ptId);
            })
            .then((fresh) => {
              if (fresh) {
                campaign = applyCampaignResponse(fresh);
                renderList(campaign.textOptionsPerFolder[fnum - 1] || []);
              }
            })
            .catch((err) => { showAlert(err?.message || 'Failed to save. Try again.'); });
        };
      });
      list.querySelectorAll('.folder-text-option-expand').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const row = btn.closest('li');
          if (!row) return;
          row.classList.toggle('expanded');
          const isExpanded = row.classList.contains('expanded');
          btn.setAttribute('aria-label', isExpanded ? 'Show less' : 'Show full text');
          btn.textContent = isExpanded ? '▲' : '⋯';
        };
      });
    }
    renderList(opts);

    function submitNewOption() {
      const v = (newInput && newInput.value.trim()) || '';
      if (!v) return;
      const current = campaign.textOptionsPerFolder || [];
      const newPerFolder = current.length >= fnum ? [...current] : [...current, ...Array(fnum - current.length).fill(null).map(() => [])];
      const folderOpts = Array.isArray(newPerFolder[fnum - 1]) ? [...newPerFolder[fnum - 1]] : [];
      folderOpts.push(v);
      newPerFolder[fnum - 1] = folderOpts;
      apiUpdateCampaign(pid, cid, { textOptionsPerFolder: newPerFolder }, ptId)
        .then((c) => {
          campaign = applyCampaignResponse(c);
          renderList(campaign.textOptionsPerFolder[fnum - 1] || []);
          if (newInput) newInput.value = '';
          return apiCampaign(pid, cid, ptId);
        })
        .then((fresh) => {
          if (fresh) {
            campaign = applyCampaignResponse(fresh);
            renderList(campaign.textOptionsPerFolder[fnum - 1] || []);
          }
        })
        .catch((err) => { showAlert(err?.message || 'Failed to save. Try again.'); });
    }
    const card = document.getElementById('folderTextOptionsCard');
    if (card) {
      card.addEventListener('click', (e) => {
        const isAddBtn = e.target.id === 'folderAddBtn' || e.target.closest('#folderAddBtn');
        if (isAddBtn) {
          e.preventDefault();
          e.stopPropagation();
          submitNewOption();
        }
      });
      card.addEventListener('keydown', (e) => {
        if (e.target.id !== 'folderNewText') return;
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        submitNewOption();
      }, true);
    }
  });
}

function openNewCampaignModal(projects, onSuccess) {
  const modal = document.getElementById('newCampaignModal');
  const nameInput = document.getElementById('newCampaignName');
  const pagesDiv = document.getElementById('newCampaignPages');
  if (!modal || !nameInput || !pagesDiv) return;
  nameInput.value = 'New campaign';
  pagesDiv.innerHTML = projects.map((p) => `
    <label class="checkbox-field" style="display:flex;align-items:center;gap:8px;margin:6px 0;">
      <input type="checkbox" data-page-id="${p.id}" />
      <span>${escapeHtml(p.name)}</span>
    </label>
  `).join('');
  modal.hidden = false;
  const close = () => { modal.hidden = true; };
  const modalContent = modal.querySelector('.modal');
  if (modalContent) modalContent.onclick = (e) => e.stopPropagation();
  nameInput.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
  document.getElementById('newCampaignCancel').onclick = close;
  const doCreate = (e) => {
    if (e) e.preventDefault();
    const name = nameInput.value.trim() || 'New campaign';
    const ids = Array.from(pagesDiv.querySelectorAll('input:checked')).map((cb) => parseInt(cb.dataset.pageId, 10));
    if (!ids.length) { showAlert('Select at least one page'); return; }
    apiCreateCampaignWithPages(name, ids).then((c) => {
      close();
      location.hash = `#/campaigns/${c.id}`;
      if (onSuccess) onSuccess();
    }).catch((err) => showAlert(err.message || 'Failed to create campaign'));
  };
  const form = document.getElementById('newCampaignForm');
  if (form) form.onsubmit = doCreate;
  modal.onclick = null;
}

function renderCampaigns() {
  setBreadcrumb({ view: 'campaigns' });
  showViewLoading();
  Promise.all([
    apiProjects(),
    apiAllCampaigns(),
    apiWithAuth(`${API}/api/calendar?_=${Date.now()}`).then((r) => r.json()).catch(() => ({ items: [] })),
  ]).then(([projects, campaigns, calData]) => {
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card">
        <h1>Campaigns</h1>
        <p class="hint">Create campaigns and assign them to pages. Multiple pages can share the same campaign.</p>
        <div class="campaigns-list" id="campaignsList"></div>
        <div class="actions" style="margin-top:1rem;">
          <button type="button" class="btn btn-primary" id="newCampaignBtn">Start a new campaign</button>
        </div>
      </section>
    `;
    const list = document.getElementById('campaignsList');
    const projectMap = {};
    projects.forEach((p) => { projectMap[p.id] = p; });
    const getPageIds = (c) => (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);

    // Build per-campaign stats from calendar data
    const calItems = (calData && calData.items) || [];
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const campaignStats = {};
    calItems.forEach((it) => {
      const cid = String(it.campaignId);
      if (!campaignStats[cid]) campaignStats[cid] = { weekPosts: 0, failures24h: 0 };
      const d = new Date(it.scheduledAt || (it.date + 'T12:00:00Z'));
      if (it.postStatus === 'success' && d >= weekStart && d < weekEnd) campaignStats[cid].weekPosts++;
      if (it.postStatus === 'failure' && d >= cutoff24h) campaignStats[cid].failures24h++;
    });

    const fmtDate = (s) => {
      if (!s) return '';
      const d = new Date(s + 'T12:00:00Z');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (!campaigns.length) {
      list.innerHTML = '<p class="empty">No campaigns yet. Start a new campaign and select which pages to post to.</p>';
    } else {
      const sorted = [...campaigns].sort((a, b) => {
        const da = a.releaseDate || '';
        const db = b.releaseDate || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
      const releaseTypeLabels = { single: 'Single', ep: 'EP', feature: 'Feature', album: 'Album' };
      list.innerHTML = sorted.map((c) => {
        const releaseLabel = c.releaseDate ? formatReleaseDate(c.releaseDate) : '';
        const releaseTypeBadge = c.releaseType && releaseTypeLabels[c.releaseType]
          ? `<span class="release-type-badge release-type-${c.releaseType}">${escapeHtml(releaseTypeLabels[c.releaseType])}</span>`
          : '';
        const sharedBadge = c._sharedOwnerId
          ? `<span class="release-type-badge" style="background:#6366f1;color:#fff;font-size:0.7em;">Shared by @${escapeHtml(c._sharedOwnerUsername || c._sharedOwnerId)}</span>`
          : '';
        const pausedBadge = c.paused ? `<span class="release-type-badge" style="background:#6b7280;color:#fff;font-size:0.7em;">Paused</span>` : '';
        const avatarImg = `<img src="${campaignAvatarUrl(c.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(c.name || 'C').charAt(0).toUpperCase()}</span>`;

        // Status line
        const stats = campaignStats[String(c.id)] || {};
        let statusDot = 'inactive';
        let statusText = '';
        if (c.paused) {
          statusDot = 'inactive';
          statusText = 'Paused';
        } else if (stats.failures24h > 0) {
          statusDot = 'warning';
          statusText = `${stats.failures24h} failure${stats.failures24h !== 1 ? 's' : ''} in last 24h`;
        } else {
          const start = c.startDate || c.releaseDate || '';
          const end = c.endDate || '';
          if (start && todayStr < start) {
            statusDot = 'inactive';
            statusText = `Not started · Starts ${escapeHtml(fmtDate(start))}`;
          } else if (end && todayStr > end) {
            statusDot = 'inactive';
            statusText = `Ended · ${escapeHtml(fmtDate(end))}`;
          } else if (stats.weekPosts > 0) {
            statusDot = 'active';
            statusText = `Active · ${stats.weekPosts} post${stats.weekPosts !== 1 ? 's' : ''} this week`;
          } else {
            statusDot = 'inactive';
            statusText = 'No activity this week';
          }
        }
        const statusLine = `<div class="campaign-status-line"><span class="campaign-status-dot ${statusDot}"></span><span>${statusText}</span></div>`;

        return `
          <div class="campaigns-list-item">
            <a href="#/campaigns/${c.id}" class="campaign-card-link">
              <div class="list-card">
                <div class="campaign-avatar campaign-avatar-square">${avatarImg}</div>
                <div class="list-card-main">
                  <div class="list-card-title-row">
                    <span class="list-card-title">${escapeHtml(c.name)}</span>
                    ${releaseTypeBadge ? releaseTypeBadge : ''}
                    ${sharedBadge}
                    ${pausedBadge}
                  </div>
                  <span class="list-card-meta">${releaseLabel ? escapeHtml(releaseLabel) : 'No release date'}</span>
                  ${statusLine}
                </div>
              </div>
            </a>
            ${!c._sharedOwnerId ? `<button type="button" class="btn btn-ghost btn-sm list-card-action" data-action="delete-campaign" data-cid="${c.id}" data-cname="${escapeHtml(c.name)}" aria-label="Delete campaign">Delete</button>` : ''}
          </div>
        `;
      }).join('');
    }
    document.getElementById('newCampaignBtn').onclick = () => {
      openNewCampaignModal(projects, () => render());
    };
    list.querySelectorAll('[data-action="delete-campaign"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = btn.dataset.cname || 'this campaign';
        showConfirm(`Delete campaign "${name}"? This cannot be undone.`).then((ok) => {
          if (!ok) return;
          apiDeleteCampaignById(btn.dataset.cid).then(() => render()).catch((err) => showAlert(err.message || 'Failed to delete'));
        });
      };
    });
  });
}

function renderCampaignDetail(campaignId) {
  const cid = campaignId;
  return Promise.all([
    apiProjects(),
    apiAllCampaigns(),
    apiDeployedPostsCount(campaignId).catch(() => ({ count: 0, byPage: {} })),
    apiTrends(cid).catch(() => []),
  ]).then(([projects, campaigns, countData, campaignTrends]) => {
    let campaign = campaigns.find((c) => String(c.id) === String(cid));
    if (!campaign) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap back-link-wrap-centered"><a href="#/campaigns" class="nav-link">← Back to campaigns</a></p><p>Campaign not found.</p></section>';
      setBreadcrumb({ view: 'campaignDetail', campaignId: cid });
      return;
    }
    const getPageIds = (c) => (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
    const pageIds = getPageIds(campaign);
    const pages = pageIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
    setBreadcrumb({ view: 'campaignDetail', campaignId: cid });
    const main = document.getElementById('main');
    const campaignAvatarEl = `<div class="campaign-detail-avatar-wrap"><div class="campaign-avatar-clickable" id="campaignDetailAvatarClickable" title="Click to change image"><div class="campaign-avatar campaign-avatar-square"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignDetailAvatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignDetailAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div></div><input type="file" accept="image/*" id="campaignDetailAvatarInput" hidden /></div>`;
    const deployedTotal = (countData && countData.count) || 0;
    const deployedByPage = (countData && countData.byPage) || {};
    main.innerHTML = `
      <section class="card campaign-detail-card">
        <p class="back-link-wrap back-link-wrap-centered"><a href="#/campaigns" class="nav-link">← Back to campaigns</a></p>
        <div class="campaign-detail-header">
          <div class="campaign-detail-header-center">
            ${campaignAvatarEl}
            <div class="campaign-detail-title-wrap">
              <h1 id="campaignDetailName" class="campaign-detail-name-editable" title="Double-click to rename">${escapeHtml(campaign.name)}</h1>
              <p class="campaign-release-date" id="campaignDetailReleaseDate" ${campaign.releaseDate ? '' : 'style="display:none;"'}>Release date: ${campaign.releaseDate ? escapeHtml(formatReleaseDate(campaign.releaseDate)) : '—'}</p>
              <p class="campaign-date-range" id="campaignDetailDateRange" ${(campaign.campaignStartDate || campaign.campaignEndDate) ? '' : 'style="display:none;"'}>Campaign Dates: ${(campaign.campaignStartDate && campaign.campaignEndDate) ? `${escapeHtml(formatReleaseDate(campaign.campaignStartDate))} – ${escapeHtml(formatReleaseDate(campaign.campaignEndDate))}` : (campaign.campaignStartDate ? escapeHtml(formatReleaseDate(campaign.campaignStartDate)) : campaign.campaignEndDate ? escapeHtml(formatReleaseDate(campaign.campaignEndDate)) : '')}</p>
              <p class="campaign-scheduled-count" id="campaignDetailScheduledCount">${deployedTotal > 0 ? `${deployedTotal} deployed posts total across all pages` : '0 deployed posts (deploy to schedule)'}</p>
            </div>
            <div class="campaign-detail-actions campaign-detail-actions-below-release">
              <select id="campaignReleaseTypeSelect" class="field-select">
                  <option value="">—</option>
                  <option value="single" ${campaign.releaseType === 'single' ? 'selected' : ''}>Single</option>
                  <option value="ep" ${campaign.releaseType === 'ep' ? 'selected' : ''}>EP</option>
                  <option value="feature" ${campaign.releaseType === 'feature' ? 'selected' : ''}>Feature</option>
                  <option value="album" ${campaign.releaseType === 'album' ? 'selected' : ''}>Album</option>
                </select>
              <button type="button" class="btn btn-secondary" id="addReleaseDayBtn" title="Set release date">${campaign.releaseDate ? 'Change release day' : 'Add release day'}</button>
              <button type="button" class="btn btn-secondary" id="addCampaignDateRangeBtn" title="Set campaign date range">${(campaign.campaignStartDate || campaign.campaignEndDate) ? 'Change campaign dates' : 'Campaign dates'}</button>
              <button type="button" class="btn btn-secondary" id="addPageToCampaignBtn" title="Add page to campaign">+ Add page</button>
              <button type="button" class="btn ${campaign.paused ? 'btn-primary' : 'btn-secondary'}" id="campaignPauseBtn" title="${campaign.paused ? 'Resume campaign' : 'Pause campaign'}">${campaign.paused ? '▶ Resume' : '⏸ Pause'}</button>
            </div>
            ${campaign.paused ? `<div class="campaign-paused-banner">⏸ Campaign paused — no posts will be deployed and this campaign is hidden from the calendar.</div>` : ''}
            <div class="campaign-notes-wrap">
              <label class="field campaign-notes-label">
                <span>Notes</span>
                <textarea id="campaignNotes" class="campaign-notes-input" placeholder="Add notes about this campaign…" rows="3">${escapeHtml(campaign.notes || '')}</textarea>
              </label>
              <button type="button" class="btn btn-secondary btn-sm" id="campaignNotesSave">Save notes</button>
            </div>
          </div>
        </div>
        <div class="campaign-pages-ugc-sections" id="campaignPagesUgcSections">
          <div class="campaign-categories-toolbar">
            <p class="hint">Add custom categories to organize pages. Pages are listed under each category in the order you add them.</p>
            <div class="campaign-add-category-row">
              <input type="text" id="campaignNewCategoryInput" class="field-input campaign-new-category-input" placeholder="Category name" aria-label="New category name" />
              <button type="button" class="btn btn-secondary" id="campaignAddCategoryBtn">Add category</button>
            </div>
          </div>
          <div id="campaignCategorySectionsContainer"></div>
        </div>
        <div class="campaign-detail-team-section" id="campaignTeamSection">
          <h3 class="settings-subtitle">Team members</h3>
          <p class="hint">Add people by username so they can access this campaign.</p>
          <div class="settings-team-add">
            <input type="text" id="campaignTeamUsername" placeholder="Username" class="settings-team-input" />
            <button type="button" class="btn btn-secondary" id="campaignTeamAddBtn">Add</button>
          </div>
          <p id="campaignTeamError" class="auth-error" hidden></p>
          <ul id="campaignTeamList" class="settings-team-list"></ul>
        </div>
        <div class="campaign-detail-trends-section" id="campaignTrendsSection" data-campaign-id="${escapeHtml(String(cid))}">
          <h3 class="settings-subtitle">Trends</h3>
          <p class="hint">One shared on-screen text applies to multiple pages. Set text options and styling, pick pages, then add folder photos and set the calendar for each page.</p>
          <p class="field-label" style="margin-top:1rem;margin-bottom:0.5rem;">Trends in this campaign</p>
          <div class="campaign-trends-list" id="campaignTrendsList"></div>
          <div class="actions" style="margin-top:0.75rem;">
            <button type="button" class="btn btn-secondary" id="campaignNewTrendBtn" data-action="campaign-new-trend" data-campaign-id="${escapeHtml(String(cid))}" data-page-ids="${escapeHtml(JSON.stringify(pageIds || []))}">New trend</button>
          </div>
        </div>
      </section>
    `;
    const pageUgcTypes = campaign.pageUgcTypes && typeof campaign.pageUgcTypes === 'object' ? campaign.pageUgcTypes : {};
    const customCategories = (() => {
      if (Array.isArray(campaign.customCategories) && campaign.customCategories.length) return [...campaign.customCategories];
      const hasLegacy = pages.some((p) => pageUgcTypes[p.id] === 'song_related' || pageUgcTypes[p.id] === 'not_related');
      return hasLegacy ? ['Song related', 'Not related'] : [];
    })();
    function campaignPayload(overrides) {
      return {
        name: campaign.name,
        pageIds,
        releaseDate: campaign.releaseDate,
        releaseType: campaign.releaseType,
        campaignStartDate: campaign.campaignStartDate,
        campaignEndDate: campaign.campaignEndDate,
        memberUsernames: campaign.memberUsernames || [],
        notes: campaign.notes ?? '',
        pageUgcTypes: campaign.pageUgcTypes || {},
        customCategories: overrides.customCategories !== undefined ? overrides.customCategories : customCategories,
        ...overrides,
      };
    }
    function renderPageCard(p, categoryOptions) {
      const pageDeployed = isPageDeployed(campaign, p.id);
      const deployedBadge = pageDeployed ? '<span class="badge badge-deployed">Deployed</span>' : '<span class="badge badge-draft">Draft</span>';
      const postTypeCount = ((campaign.pagePostTypes || {})[p.id] || campaign.postTypes || []).length;
      const postsForPage = deployedByPage[p.id] ?? 0;
      const avatarImg = p.hasAvatar ? `<img src="${projectAvatarUrl(p.id)}" alt="" class="project-avatar-img" />` : `<span class="project-circle-initial">${(p.name || 'P').charAt(0).toUpperCase()}</span>`;
      const currentCategory = pageUgcTypes[p.id] && customCategories.includes(pageUgcTypes[p.id]) ? pageUgcTypes[p.id] : '';
      const optionsHtml = '<option value="">Uncategorized</option>' + categoryOptions.map((cat) => `<option value="${escapeHtml(cat)}" ${currentCategory === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('');
      return `
        <div class="campaign-page-card-wrap">
          <a href="#/campaign/${p.id}/${cid}" class="campaign-page-card">
            <div class="campaign-page-avatar">${avatarImg}</div>
            <span class="campaign-page-name">${escapeHtml(p.name)}</span>
            <span class="campaign-page-meta">${postTypeCount} post type${postTypeCount !== 1 ? 's' : ''} · ${pageDeployed ? `${postsForPage} deployed posts` : '0 deployed posts'}</span>
            ${deployedBadge}
          </a>
          <label class="campaign-page-ugc-label">
            <span class="campaign-page-ugc-label-text">Category</span>
            <select class="campaign-page-category-select field-select" data-page-id="${p.id}" aria-label="Category">
              ${optionsHtml}
            </select>
          </label>
          <button type="button" class="btn btn-ghost campaign-page-remove" data-page-id="${p.id}" data-page-name="${escapeHtml(p.name)}" aria-label="Remove from campaign">🗑</button>
        </div>
      `;
    }
    const container = document.getElementById('campaignCategorySectionsContainer');
    if (container) {
      const sections = [];
      for (const catName of customCategories) {
        const catPages = pages.filter((p) => pageUgcTypes[p.id] === catName);
        sections.push(`
          <div class="campaign-ugc-section" data-category="${escapeHtml(catName)}">
            <div class="campaign-ugc-section-header">
              <h3 class="settings-subtitle">${escapeHtml(catName)}</h3>
              <button type="button" class="btn btn-ghost btn-sm campaign-remove-category" data-category="${escapeHtml(catName)}" aria-label="Remove category">🗑</button>
            </div>
            <div class="campaign-pages-grid campaign-category-grid">${catPages.length ? catPages.map((p) => renderPageCard(p, customCategories)).join('') : '<p class="hint">No pages in this category. Use the Category dropdown on a page to assign one.</p>'}</div>
          </div>
        `);
      }
      const uncategorizedPages = pages.filter((p) => !pageUgcTypes[p.id] || !customCategories.includes(pageUgcTypes[p.id]));
      if (uncategorizedPages.length > 0) {
        sections.push(`
          <div class="campaign-ugc-section" data-category="__uncategorized__">
            <h3 class="settings-subtitle">Uncategorized</h3>
            <div class="campaign-pages-grid campaign-category-grid">${uncategorizedPages.map((p) => renderPageCard(p, customCategories)).join('')}</div>
          </div>
        `);
      }
      container.innerHTML = sections.join('');
      container.querySelectorAll('.campaign-page-category-select').forEach((sel) => {
        sel.onchange = (e) => {
          e.stopPropagation();
          const pageId = parseInt(sel.dataset.pageId, 10);
          const value = sel.value || '';
          const next = { ...(campaign.pageUgcTypes || {}) };
          if (value) next[pageId] = value;
          else delete next[pageId];
          apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload({ pageUgcTypes: next })) })
            .then((r) => r.json())
            .then((c) => { campaign = c; renderCampaignDetail(cid); })
            .catch((err) => showAlert(err.message || 'Failed to update'));
        };
        sel.onclick = (e) => e.stopPropagation();
      });
      container.querySelectorAll('.campaign-page-remove').forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pageName = btn.dataset.pageName || 'this page';
          showConfirm(`Are you sure you want to remove "${pageName}" from the campaign?`).then((ok) => {
            if (!ok) return;
            const removeId = parseInt(btn.dataset.pageId, 10);
            const newPageIds = pageIds.filter((id) => id !== removeId);
            if (newPageIds.length === 0) { showAlert('Campaign must have at least one page.'); return; }
            apiUpdateCampaignPages(cid, newPageIds).then(() => renderCampaignDetail(cid)).catch((err) => showAlert(err.message || 'Failed'));
          });
        };
      });
      container.querySelectorAll('.campaign-remove-category').forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cat = btn.dataset.category;
          showConfirm(`Remove category "${cat}"? Pages in it will become Uncategorized.`).then((ok) => {
            if (!ok) return;
            const nextCats = customCategories.filter((c) => c !== cat);
            const nextUgc = { ...(campaign.pageUgcTypes || {}) };
            for (const [pid, val] of Object.entries(nextUgc)) {
              if (val === cat) delete nextUgc[pid];
            }
            apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload({ customCategories: nextCats, pageUgcTypes: nextUgc })) })
              .then((r) => r.json())
              .then((c) => { campaign = c; renderCampaignDetail(cid); })
              .catch((err) => showAlert(err.message || 'Failed to update'));
          });
        };
      });
    }
    const addCategoryBtn = document.getElementById('campaignAddCategoryBtn');
    const newCategoryInput = document.getElementById('campaignNewCategoryInput');
    if (addCategoryBtn && newCategoryInput) {
      addCategoryBtn.onclick = () => {
        const name = (newCategoryInput.value || '').trim();
        if (!name) { showAlert('Enter a category name.'); return; }
        if (customCategories.includes(name)) { showAlert('That category already exists.'); return; }
        const nextCats = [...customCategories, name];
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignPayload({ customCategories: nextCats })) })
          .then((r) => r.json())
          .then((c) => { campaign = c; newCategoryInput.value = ''; renderCampaignDetail(cid); })
          .catch((err) => showAlert(err.message || 'Failed to add category'));
      };
      newCategoryInput.onkeydown = (e) => { if (e.key === 'Enter') addCategoryBtn.click(); };
    }

    const avatarImg = document.getElementById('campaignDetailAvatar');
    const avatarPlaceholder = document.getElementById('campaignDetailAvatarPlaceholder');
    const avatarInput = document.getElementById('campaignDetailAvatarInput');
    const avatarClickable = document.getElementById('campaignDetailAvatarClickable');
    if (avatarImg && avatarImg.complete && avatarImg.naturalWidth) avatarPlaceholder && (avatarPlaceholder.style.display = 'none');
    else avatarPlaceholder && (avatarPlaceholder.style.display = 'flex');
    if (avatarImg) {
      avatarImg.onload = () => {
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
      };
    }
    if (avatarInput) {
      avatarInput.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        apiUploadCampaignAvatar(cid, file).then(() => {
          bumpAvatarVersion('campaign', cid);
          if (avatarImg) { avatarImg.src = campaignAvatarUrl(cid); avatarImg.style.display = ''; avatarPlaceholder && (avatarPlaceholder.style.display = 'none'); }
          avatarInput.value = '';
        }).catch((err) => showAlert(err.message || 'Upload failed'));
      };
    }
    if (avatarClickable) {
      avatarClickable.onclick = () => {
        if (avatarImg && avatarImg.complete && avatarImg.naturalWidth) {
          openEditAvatarModal('campaign', cid, campaignAvatarUrl(cid), () => {
            if (avatarImg) { avatarImg.src = campaignAvatarUrl(cid); avatarImg.style.display = ''; avatarPlaceholder && (avatarPlaceholder.style.display = 'none'); }
          });
        } else {
          avatarInput?.click();
        }
      };
    }
    const nameEl = document.getElementById('campaignDetailName');
    if (nameEl) nameEl.ondblclick = () => {
      showPrompt('Campaign name:', campaign.name).then((name) => {
        if (name != null && name.trim()) {
          apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, memberUsernames: campaign.memberUsernames || [], notes: campaign.notes ?? '' }) })
            .then((r) => r.json())
            .then((c) => { campaign = c; if (nameEl) nameEl.textContent = c.name; });
        }
      });
    };
    const pauseBtn = document.getElementById('campaignPauseBtn');
    if (pauseBtn) pauseBtn.onclick = () => {
      const nowPaused = !campaign.paused;
      apiUpdateCampaign(pageIds[0] || '', cid, { ...campaign, paused: nowPaused }).then((c) => {
        campaign = c;
        invalidateApiCache('allCampaigns');
        renderCampaignDetail(cid);
      }).catch((err) => showAlert(err.message || 'Failed to update campaign'));
    };

    const addReleaseBtn = document.getElementById('addReleaseDayBtn');
    const releaseDateEl = document.getElementById('campaignDetailReleaseDate');
    if (addReleaseBtn) addReleaseBtn.onclick = () => {
      const modal = document.getElementById('releaseDayModal');
      const input = document.getElementById('releaseDayInput');
      if (modal && input) {
        input.value = campaign.releaseDate || '';
        modal.hidden = false;
      }
    };
    document.getElementById('releaseDayCancel').onclick = () => { document.getElementById('releaseDayModal').hidden = true; };
    document.getElementById('releaseDaySave').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById('releaseDayInput');
      const val = input?.value?.trim() || null;
      apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: val, releaseType: campaign.releaseType, memberUsernames: campaign.memberUsernames || [], notes: campaign.notes ?? '' }) })
        .then((r) => { if (!r.ok) throw new Error('Save failed'); return r.json(); })
        .then((c) => {
          campaign = c;
          document.getElementById('releaseDayModal').hidden = true;
          if (releaseDateEl) {
            releaseDateEl.textContent = c.releaseDate ? `Release: ${formatReleaseDate(c.releaseDate)}` : '';
            releaseDateEl.style.display = c.releaseDate ? '' : 'none';
          }
          if (addReleaseBtn) addReleaseBtn.textContent = c.releaseDate ? 'Change release day' : 'Add release day';
        })
        .catch((err) => showAlert(err.message || 'Failed to save release date'));
    };
    document.getElementById('releaseDayModal').onclick = (e) => { if (e.target.id === 'releaseDayModal') document.getElementById('releaseDayModal').hidden = true; };
    const addCampaignDateRangeBtn = document.getElementById('addCampaignDateRangeBtn');
    const campaignDateRangeModal = document.getElementById('campaignDateRangeModal');
    const campaignDetailDateRange = document.getElementById('campaignDetailDateRange');
    if (addCampaignDateRangeBtn) addCampaignDateRangeBtn.onclick = () => {
      const startInput = document.getElementById('campaignStartDateInput');
      const endInput = document.getElementById('campaignEndDateInput');
      if (startInput) startInput.value = campaign.campaignStartDate || '';
      if (endInput) endInput.value = campaign.campaignEndDate || '';
      if (campaignDateRangeModal) campaignDateRangeModal.hidden = false;
    };
    document.getElementById('campaignDateRangeCancel').onclick = () => { if (campaignDateRangeModal) campaignDateRangeModal.hidden = true; };
    document.getElementById('campaignDateRangeSave').onclick = () => {
      const startInput = document.getElementById('campaignStartDateInput');
      const endInput = document.getElementById('campaignEndDateInput');
      const startVal = startInput?.value?.trim() || null;
      const endVal = endInput?.value?.trim() || null;
      apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, campaignStartDate: startVal, campaignEndDate: endVal, memberUsernames: campaign.memberUsernames || [], notes: campaign.notes ?? '' }) })
        .then((r) => { if (!r.ok) throw new Error('Save failed'); return r.json(); })
        .then((c) => {
          campaign = c;
          if (campaignDateRangeModal) campaignDateRangeModal.hidden = true;
          if (addCampaignDateRangeBtn) addCampaignDateRangeBtn.textContent = (c.campaignStartDate || c.campaignEndDate) ? 'Change campaign dates' : 'Campaign dates';
          if (campaignDetailDateRange) {
            campaignDetailDateRange.style.display = (c.campaignStartDate || c.campaignEndDate) ? '' : 'none';
            campaignDetailDateRange.textContent = 'Campaign Dates: ' + ((c.campaignStartDate && c.campaignEndDate) ? `${formatReleaseDate(c.campaignStartDate)} – ${formatReleaseDate(c.campaignEndDate)}` : (c.campaignStartDate ? formatReleaseDate(c.campaignStartDate) : c.campaignEndDate ? formatReleaseDate(c.campaignEndDate) : ''));
          }
        })
        .catch((err) => showAlert(err.message || 'Failed to save'));
    };
    if (campaignDateRangeModal) campaignDateRangeModal.onclick = (e) => { if (e.target.id === 'campaignDateRangeModal') campaignDateRangeModal.hidden = true; };
    const releaseTypeSelect = document.getElementById('campaignReleaseTypeSelect');
    if (releaseTypeSelect) {
      releaseTypeSelect.onchange = () => {
        const val = releaseTypeSelect.value || null;
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: val, memberUsernames: campaign.memberUsernames || [], notes: campaign.notes ?? '' }) })
          .then((r) => { if (!r.ok) throw new Error('Save failed'); return r.json(); })
          .then((c) => { campaign = c; });
      };
    }
    const campaignNotesEl = document.getElementById('campaignNotes');
    const campaignNotesSaveBtn = document.getElementById('campaignNotesSave');
    if (campaignNotesSaveBtn && campaignNotesEl) {
      const NOTES_HEIGHT_KEY = 'campaign_notes_height_';
      const savedNotesHeight = localStorage.getItem(NOTES_HEIGHT_KEY + cid);
      if (savedNotesHeight) {
        const px = parseInt(savedNotesHeight, 10);
        if (!isNaN(px) && px > 0) campaignNotesEl.style.height = px + 'px';
      }
      const notesResizeObserver = new ResizeObserver(() => {
        const h = campaignNotesEl.offsetHeight;
        if (h > 0) localStorage.setItem(NOTES_HEIGHT_KEY + cid, String(h));
      });
      notesResizeObserver.observe(campaignNotesEl);

      let notesSaveTimeout = null;
      const NOTES_AUTOSAVE_MS = 800;
      function saveNotes(showFeedback = false) {
        const notes = (campaignNotesEl.value || '').trim();
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, campaignStartDate: campaign.campaignStartDate, campaignEndDate: campaign.campaignEndDate, memberUsernames: campaign.memberUsernames || [], notes }) })
          .then((r) => { if (!r.ok) throw new Error('Save failed'); return r.json(); })
          .then((c) => { campaign = c; if (showFeedback) showToast('Notes saved.', 'success'); if (campaignNotesSaveBtn) { campaignNotesSaveBtn.textContent = 'Saved'; campaignNotesSaveBtn.disabled = true; setTimeout(() => { campaignNotesSaveBtn.textContent = 'Save notes'; campaignNotesSaveBtn.disabled = false; }, 2000); } })
          .catch((err) => { showAlert(err.message || 'Failed to save notes'); if (campaignNotesSaveBtn) campaignNotesSaveBtn.textContent = 'Save notes'; campaignNotesSaveBtn.disabled = false; });
      }
      campaignNotesSaveBtn.onclick = () => { if (notesSaveTimeout) clearTimeout(notesSaveTimeout); notesSaveTimeout = null; saveNotes(true); };
      campaignNotesEl.oninput = () => {
        if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
        notesSaveTimeout = setTimeout(() => saveNotes(false), NOTES_AUTOSAVE_MS);
      };
    }
    document.getElementById('addPageToCampaignBtn').onclick = () => {
      const available = projects.filter((p) => !pageIds.includes(p.id));
      if (!available.length) { showAlert('All pages are already in this campaign.'); return; }
      openAddPageModal(cid, pageIds, available, () => renderCampaignDetail(cid));
    };

    // Campaign members (real API — owner can add/remove, members are shown to all)
    const campaignTeamList = document.getElementById('campaignTeamList');
    const campaignTeamError = document.getElementById('campaignTeamError');
    const campaignTeamUsername = document.getElementById('campaignTeamUsername');
    const campaignTeamAddBtn = document.getElementById('campaignTeamAddBtn');
    const isSharedCampaign = !!(campaign._sharedOwnerId);
    async function refreshCampaignMembers() {
      if (!campaignTeamList) return;
      try {
        const members = await apiWithAuth(`${API}/api/campaigns/${cid}/members`).then((r) => r.json());
        if (!Array.isArray(members) || !members.length) {
          campaignTeamList.innerHTML = '<li class="hint">No team members yet. Add by username above.</li>';
          return;
        }
        campaignTeamList.innerHTML = members.map((m) =>
          `<li class="settings-team-item"><span>${escapeHtml(m.full_name || m.username || m.member_id)}</span><span class="hint" style="font-size:0.8em;margin-left:6px;">@${escapeHtml(m.username || '')}</span>${!isSharedCampaign ? ` <button type="button" class="btn btn-ghost btn-sm" data-campaign-remove-member="${escapeHtml(m.member_id)}" aria-label="Remove">Remove</button>` : ''}</li>`
        ).join('');
      } catch (_) {
        campaignTeamList.innerHTML = '<li class="hint">Could not load members.</li>';
      }
    }
    refreshCampaignMembers();
    if (!isSharedCampaign && campaignTeamAddBtn && campaignTeamUsername) {
      campaignTeamAddBtn.onclick = async () => {
        const username = campaignTeamUsername.value.trim();
        if (!username) return;
        if (campaignTeamError) campaignTeamError.hidden = true;
        try {
          const r = await apiWithAuth(`${API}/api/campaigns/${cid}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Failed to add member');
          campaignTeamUsername.value = '';
          refreshCampaignMembers();
        } catch (err) {
          if (campaignTeamError) { campaignTeamError.textContent = err.message || 'Failed'; campaignTeamError.hidden = false; }
        }
      };
    }
    if (!isSharedCampaign && campaignTeamList) {
      campaignTeamList.addEventListener('click', async (e) => {
        const memberId = e.target.dataset.campaignRemoveMember;
        if (!memberId) return;
        try {
          await apiWithAuth(`${API}/api/campaigns/${cid}/members/${memberId}`, { method: 'DELETE' });
          refreshCampaignMembers();
        } catch (err) { showAlert(err.message || 'Failed'); }
      });
    }
    if (isSharedCampaign && campaignTeamAddBtn) campaignTeamAddBtn.style.display = 'none';

    const campaignTrendsList = document.getElementById('campaignTrendsList');
    const trends = Array.isArray(campaignTrends) ? campaignTrends : [];
    if (campaignTrendsList) {
      if (!trends.length) {
        campaignTrendsList.innerHTML = '<p class="hint">No trends in this campaign yet. Click &quot;New trend&quot; below to add one.</p>';
      } else {
        const sorted = [...trends].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        campaignTrendsList.innerHTML = sorted.map((t) => {
          const trendAvatar = `<div class="list-card-avatar campaign-avatar campaign-avatar-square"><img src="${trendAvatarUrl(t.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(t.name || 'T').charAt(0).toUpperCase()}</span></div>`;
          return `
          <div class="campaigns-list-item">
            <a href="#/trends/${t.id}" class="campaign-card-link">
              <div class="list-card">
                ${trendAvatar}
                <div class="list-card-main">
                  <span class="list-card-title">${escapeHtml(t.name)}</span>
                  <span class="list-card-meta">${(t.pageIds && t.pageIds.length) ? t.pageIds.length + ' page(s)' : 'No pages'}</span>
                </div>
              </div>
            </a>
            <button type="button" class="btn btn-ghost btn-sm list-card-action" data-action="delete-campaign-trend" data-tid="${t.id}" data-tname="${escapeHtml(t.name)}" aria-label="Delete">Delete</button>
          </div>
        `;
        }).join('');
        campaignTrendsList.querySelectorAll('[data-action="delete-campaign-trend"]').forEach((btn) => {
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = btn.dataset.tname || 'this trend';
            showConfirm(`Delete trend "${name}"? This cannot be undone.`).then((ok) => {
              if (!ok) return;
              apiDeleteTrend(btn.dataset.tid).then(() => renderCampaignDetail(cid)).catch((err) => showAlert(err.message || 'Failed to delete'));
            });
          };
        });
      }
    }
  });
}

const AVATAR_CROP_SIZE = 400;

function openEditAvatarModal(type, id, imageUrl, onSuccess) {
  const modal = document.getElementById('editAvatarModal');
  const cropBox = document.getElementById('editAvatarCropBox');
  const imgWrap = document.getElementById('editAvatarImgWrap');
  const img = document.getElementById('editAvatarImg');
  const zoomInput = document.getElementById('editAvatarZoom');
  const fileInput = document.getElementById('editAvatarFileInput');
  const changeBtn = document.getElementById('editAvatarChangeBtn');
  const saveBtn = document.getElementById('editAvatarSaveBtn');
  const cancelBtn = document.getElementById('editAvatarCancelBtn');
  if (!modal || !img || !imgWrap || !zoomInput) return;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragStart = null;
  let baseScale = 1;
  const boxSize = 320;

  function applyTransform() {
    const totalScale = baseScale * scale;
    imgWrap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${totalScale})`;
  }

  function loadImage(url) {
    const fullUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    return new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = fullUrl;
    });
  }

  function initFromImage() {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    baseScale = boxSize / Math.min(nw, nh);
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    zoomInput.value = '1';
    applyTransform();
  }

  function getCroppedBlob() {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return Promise.resolve(null);
    const totalScale = baseScale * scale;
    const srcSize = boxSize / totalScale;
    const sx = nw / 2 - srcSize / 2 - offsetX / totalScale;
    const sy = nh / 2 - srcSize / 2 - offsetY / totalScale;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_CROP_SIZE;
    canvas.height = AVATAR_CROP_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, AVATAR_CROP_SIZE, AVATAR_CROP_SIZE);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
    });
  }

  cropBox.onmousedown = (e) => {
    if (!cropBox.contains(e.target)) return;
    dragStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
  };
  cropBox.onmousemove = (e) => {
    if (!dragStart) return;
    offsetX = e.clientX - dragStart.x;
    offsetY = e.clientY - dragStart.y;
    applyTransform();
  };
  cropBox.onmouseup = () => { dragStart = null; };
  cropBox.onmouseleave = () => { dragStart = null; };

  zoomInput.oninput = () => {
    scale = parseFloat(zoomInput.value) || 1;
    applyTransform();
  };

  changeBtn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    loadImage(url).then(() => {
      URL.revokeObjectURL(url);
      initFromImage();
    }).catch(() => {
      URL.revokeObjectURL(url);
      showAlert('Could not load image');
    });
    fileInput.value = '';
  };

  saveBtn.onclick = () => {
    getCroppedBlob().then((blob) => {
      if (!blob) { showAlert('Could not process image'); return; }
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const upload = type === 'project' ? apiUploadProjectAvatar(String(id), file) : apiUploadCampaignAvatar(String(id), file);
      upload.then(() => {
        bumpAvatarVersion(type, id);
        modal.hidden = true;
        if (onSuccess) onSuccess();
      }).catch((err) => showAlert(err.message || 'Upload failed'));
    });
  };

  cancelBtn.onclick = () => { modal.hidden = true; };
  modal.onclick = (e) => { if (e.target.id === 'editAvatarModal') modal.hidden = true; };

  loadImage(imageUrl).then(() => {
    initFromImage();
    modal.hidden = false;
  }).catch(() => {
    showAlert('Could not load image');
  });
}

function openJoinCampaignModal(projectId, joinableCampaigns, onSuccess) {
  const modal = document.getElementById('joinCampaignModal');
  const list = document.getElementById('joinCampaignList');
  const cancelBtn = document.getElementById('joinCampaignCancel');
  if (!modal || !list) return;
  if (!joinableCampaigns.length) {
    showAlert('No campaigns available. All campaigns already include this page.');
    return;
  }
  list.innerHTML = joinableCampaigns.map((c) => {
    const avatarImg = `<img src="${campaignAvatarUrl(c.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(c.name || 'C').charAt(0).toUpperCase()}</span>`;
    return `
    <button type="button" class="btn btn-secondary join-campaign-item" style="width:100%;justify-content:flex-start;margin:4px 0;" data-campaign-id="${c.id}">
      <div class="campaign-page-avatar campaign-avatar campaign-avatar-square">${avatarImg}</div>
      <span>+ ${escapeHtml(c.name)}</span>
    </button>
  `;
  }).join('');
  modal.hidden = false;
  const close = () => { modal.hidden = true; };
  cancelBtn.onclick = close;
  list.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      const campaignId = parseInt(btn.dataset.campaignId, 10);
      const campaign = joinableCampaigns.find((c) => c.id === campaignId);
      if (!campaign) return;
      const pageIds = (campaign.pageIds && campaign.pageIds.length) ? campaign.pageIds : (campaign.projectId != null ? [campaign.projectId] : []);
      const newPageIds = [...pageIds, projectId];
      apiUpdateCampaignPages(campaignId, newPageIds).then(() => { close(); onSuccess(); }).catch((err) => showAlert(err.message || 'Failed'));
    };
  });
  modal.onclick = (e) => { if (e.target.id === 'joinCampaignModal') close(); };
}

function openAddPageModal(campaignId, currentPageIds, availablePages, onSuccess) {
  const modal = document.getElementById('addPageToCampaignModal');
  const list = document.getElementById('addPageToCampaignList');
  const cancelBtn = document.getElementById('addPageToCampaignCancel');
  if (!modal || !list) return;
  list.innerHTML = availablePages.map((p) => {
    const avatarImg = p.hasAvatar ? `<img src="${projectAvatarUrl(p.id)}" alt="" class="project-avatar-img" />` : `<span class="project-circle-initial">${(p.name || 'P').charAt(0).toUpperCase()}</span>`;
    return `
    <button type="button" class="btn btn-secondary add-page-to-campaign-item" data-page-id="${p.id}">
      <div class="campaign-page-avatar">${avatarImg}</div>
      <span>+ ${escapeHtml(p.name)}</span>
    </button>
    `;
  }).join('');
  modal.hidden = false;
  const close = () => { modal.hidden = true; };
  cancelBtn.onclick = close;
  list.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      const newPageIds = [...currentPageIds, parseInt(btn.dataset.pageId, 10)];
      apiUpdateCampaignPages(campaignId, newPageIds).then(() => { close(); onSuccess(); }).catch((err) => showAlert(err.message || 'Failed'));
    };
  });
  modal.onclick = (e) => { if (e.target.id === 'addPageToCampaignModal') close(); };
}

function renderLogins() {
  setBreadcrumb({ view: 'logins' });
  const main = document.getElementById('main');
  main.innerHTML = `
    <section class="card">
      <h1>Logins</h1>
      <p class="hint">Store login info for your pages (TikTok, Instagram, YouTube).</p>
      <div class="logins-table-wrap">
        <table class="logins-table">
          <thead>
            <tr>
              <th class="logins-th-photo">Photo</th>
              <th>Email</th>
              <th>Username</th>
              <th>Password</th>
              <th>Platform</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="loginsTableBody"></tbody>
        </table>
      </div>
      <button type="button" class="btn btn-primary" id="loginsAddBtn">Add login</button>
    </section>
  `;
  const tbody = document.getElementById('loginsTableBody');
  const platformOptions = ['TikTok', 'Instagram', 'YouTube'];
  function renderRow(login) {
    const isNew = !login.id;
    const id = login.id || 'new';
    const email = escapeHtml(login.email || '');
    const username = escapeHtml(login.username || '');
    const platform = login.platform || 'TikTok';
    const photoCell = isNew
      ? '<td class="logins-photo-cell"><div class="logins-photo-placeholder" title="Save login first to add photo">—</div></td>'
      : `<td class="logins-photo-cell"><div class="logins-photo-wrap" data-login-id="${id}" title="Click to add or change photo"><img src="${loginAvatarUrl(id)}" alt="" class="logins-photo-img" onload="this.nextElementSibling.style.display='none';" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="logins-photo-add">+ Photo</span></div><input type="file" accept="image/*" class="logins-photo-input" data-login-id="${id}" hidden /></td>`;
    return `
      <tr data-id="${id}">
        ${photoCell}
        <td><input type="email" class="logins-input" data-field="email" value="${email}" placeholder="Email" /></td>
        <td><input type="text" class="logins-input" data-field="username" value="${username}" placeholder="Username" /></td>
        <td><input type="text" class="logins-input" data-field="password" value="${escapeHtml(login.password || '')}" placeholder="Password" autocomplete="off" /></td>
        <td>
          <select class="logins-select field-select" data-field="platform">
            ${platformOptions.map((p) => `<option value="${p}" ${p === platform ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </td>
        <td class="logins-actions">
          <button type="button" class="btn btn-secondary btn-sm logins-save-row">Save</button>
          ${isNew ? '' : '<button type="button" class="btn btn-ghost btn-sm logins-delete-row">Delete</button>'}
        </td>
      </tr>
    `;
  }
  function refresh() {
    apiLogins().then((items) => {
      tbody.innerHTML = items.map((row) => renderRow(row)).join('');
      tbody.querySelectorAll('.logins-delete-row').forEach((btn) => {
        btn.onclick = () => {
          const tr = btn.closest('tr');
          const id = parseInt(tr.dataset.id, 10);
          showConfirm('Delete this login?').then((ok) => {
            if (!ok) return;
            apiDeleteLogin(id).then(() => refresh()).catch((e) => showAlert(e.message || 'Failed to delete'));
          });
        };
      });
      tbody.querySelectorAll('.logins-save-row').forEach((btn) => {
        btn.onclick = () => {
          const tr = btn.closest('tr');
          const id = tr.dataset.id;
          const get = (f) => (tr.querySelector(`[data-field="${f}"]`) || {}).value;
          const payload = { email: get('email'), username: get('username'), password: get('password'), platform: get('platform') };
          if (id === 'new') {
            apiCreateLogin(payload).then(() => refresh()).catch((e) => showAlert(e.message || 'Failed to save'));
          } else {
            apiUpdateLogin(parseInt(id, 10), payload).then(() => refresh()).catch((e) => showAlert(e.message || 'Failed to save'));
          }
        };
      });
      tbody.querySelectorAll('.logins-photo-wrap[data-login-id]').forEach((wrap) => {
        const lid = wrap.dataset.loginId;
        const input = tbody.querySelector(`.logins-photo-input[data-login-id="${lid}"]`);
        if (!input) return;
        wrap.onclick = () => input.click();
        input.onchange = (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) apiUploadLoginAvatar(lid, file).then(() => refresh()).catch((err) => showAlert(err.message || 'Upload failed'));
          input.value = '';
        };
      });
    }).catch(() => {
      main.querySelector('.logins-table-wrap').innerHTML = '<p class="empty">Could not load logins.</p>';
    });
  }
  document.getElementById('loginsAddBtn').onclick = () => {
    tbody.insertAdjacentHTML('beforeend', renderRow({ id: null, email: '', username: '', password: '', platform: 'TikTok' }));
    const newRow = tbody.querySelector('tr[data-id="new"]');
    newRow.querySelector('.logins-save-row').onclick = () => {
      const get = (f) => (newRow.querySelector(`[data-field="${f}"]`) || {}).value;
      apiCreateLogin({ email: get('email'), username: get('username'), password: get('password'), platform: get('platform') })
        .then(() => refresh())
        .catch((e) => showAlert(e.message || 'Failed to save'));
    };
  };
  refresh();
}

function openNewTrendModal(projects, onSuccess, options) {
  const opts = options || {};
  const campaignId = opts.campaignId != null ? String(opts.campaignId) : null;
  const defaultPageIds = Array.isArray(opts.defaultPageIds) ? opts.defaultPageIds : [];
  const modal = document.getElementById('newTrendModal');
  const nameInput = document.getElementById('newTrendName');
  const pagesDiv = document.getElementById('newTrendPages');
  if (!modal || !nameInput || !pagesDiv) {
    showAlert('Trend modal could not be opened. Please refresh the page.');
    return;
  }
  const projectList = Array.isArray(projects) ? projects : [];
  if (!projectList.length) {
    showAlert('No pages available. Add pages (influencers) first.');
    return;
  }
  nameInput.value = 'New trend';
  pagesDiv.innerHTML = projectList.map((p) => {
    const checked = defaultPageIds.includes(p.id) ? ' checked' : '';
    return `<label class="checkbox-field">
      <input type="checkbox" class="new-trend-page-cb" value="${p.id}"${checked} />
      <span>${escapeHtml(p.name)}</span>
    </label>`;
  }).join('');
  modal.hidden = false;
  const close = () => { modal.hidden = true; };
  document.getElementById('newTrendCancel').onclick = close;
  modal.onclick = (e) => { if (e.target.id === 'newTrendModal') close(); };
  modal.querySelector('.modal').onclick = (e) => e.stopPropagation();
  document.getElementById('newTrendForm').onsubmit = (e) => {
    e.preventDefault();
    const name = (nameInput.value || '').trim() || 'New trend';
    const ids = Array.from(modal.querySelectorAll('.new-trend-page-cb:checked')).map((cb) => parseInt(cb.value, 10)).filter((id) => !isNaN(id));
    if (!ids.length) { showAlert('Select at least one page'); return; }
    apiCreateTrend(name, ids, campaignId).then((t) => {
      close();
      location.hash = `#/trends/${t.id}`;
      render();
      if (onSuccess) onSuccess();
    }).catch((err) => showAlert(err.message || 'Failed to create trend'));
  };
}

function renderTrends() {
  setBreadcrumb({ view: 'trends' });
  showViewLoading();
  Promise.all([apiProjects(), apiTrends()]).then(([projects, trends]) => {
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card">
        <h1>Trends</h1>
        <p class="hint">Create trends with shared on-screen text at the top. Each page has its own photos, schedule, and run.</p>
        <div class="campaigns-list" id="trendsList"></div>
        <div class="actions" style="margin-top:1rem;">
          <button type="button" class="btn btn-primary" id="newTrendBtn">Start a new trend</button>
        </div>
      </section>
    `;
    const list = document.getElementById('trendsList');
    if (!trends.length) {
      list.innerHTML = '<p class="empty">No trends yet. Start a new trend and select which pages to include.</p>';
    } else {
      const sorted = [...trends].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      list.innerHTML = sorted.map((t) => {
        const trendAvatar = `<div class="list-card-avatar campaign-avatar campaign-avatar-square"><img src="${trendAvatarUrl(t.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(t.name || 'T').charAt(0).toUpperCase()}</span></div>`;
        return `
        <div class="campaigns-list-item">
          <a href="#/trends/${t.id}" class="campaign-card-link">
            <div class="list-card">
              ${trendAvatar}
              <div class="list-card-main">
                <span class="list-card-title">${escapeHtml(t.name)}</span>
                <span class="list-card-meta">${(t.pageIds && t.pageIds.length) ? t.pageIds.length + ' page(s)' : 'No pages'}</span>
              </div>
            </div>
          </a>
          <button type="button" class="btn btn-ghost btn-sm list-card-action" data-action="delete-trend" data-tid="${t.id}" data-tname="${escapeHtml(t.name)}" aria-label="Delete">Delete</button>
        </div>
      `;
      }).join('');
    }
    document.getElementById('newTrendBtn').onclick = () => {
      location.hash = '#/trends/new';
    };
    list.querySelectorAll('[data-action="delete-trend"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = btn.dataset.tname || 'this trend';
        showConfirm(`Delete trend "${name}"? This cannot be undone.`).then((ok) => {
          if (!ok) return;
          apiDeleteTrend(btn.dataset.tid).then(() => render()).catch((err) => showAlert(err.message || 'Failed to delete'));
        });
      };
    });
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/trends" class="nav-link">← Back to trends</a></p><p>Could not load trends.</p></section>';
  });
}

function renderTrendNew(campaignIdFromRoute) {
  setBreadcrumb({ view: 'trendNew' });
  let campaignId = campaignIdFromRoute != null && campaignIdFromRoute !== '' ? String(campaignIdFromRoute) : null;
  let defaultPageIds = [];
  try {
    const stored = sessionStorage.getItem('newTrendContext');
    if (stored) {
      const ctx = JSON.parse(stored);
      if (ctx.campaignId != null) campaignId = String(ctx.campaignId);
      if (Array.isArray(ctx.defaultPageIds)) defaultPageIds = ctx.defaultPageIds;
      sessionStorage.removeItem('newTrendContext');
    }
  } catch (_) {}
  apiProjects().then((projects) => {
    const projectList = Array.isArray(projects) ? projects : [];
    const main = document.getElementById('main');
    const backLink = campaignId
      ? `<p class="back-link-wrap"><a href="#/campaigns/${escapeHtml(campaignId)}" class="nav-link">← Back to campaign</a></p>`
      : '<p class="back-link-wrap"><a href="#/trends" class="nav-link">← Back to trends</a></p>';
    main.innerHTML = `
      <section class="card">
        ${backLink}
        <h1>New trend</h1>
        <p class="hint">Create a trend and select which pages (AI influencers) it applies to. After creating, you can add on-screen text options and styles for those pages.</p>
        <form id="trendNewForm" class="settings-form" style="margin-top:1rem;">
          <label class="field">
            <span>Name</span>
            <input type="text" id="trendNewName" placeholder="New trend" value="New trend" />
          </label>
          <div class="field">
            <span>Pages</span>
            <div id="trendNewPages" class="new-campaign-pages" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;"></div>
          </div>
          <div class="actions" style="margin-top:1rem;">
            <button type="submit" class="btn btn-primary">Create trend</button>
            <a href="#/trends" class="btn btn-ghost">Cancel</a>
          </div>
        </form>
      </section>
    `;
    const nameInput = document.getElementById('trendNewName');
    const pagesDiv = document.getElementById('trendNewPages');
    if (!projectList.length) {
      pagesDiv.innerHTML = '<p class="hint">No pages available. Add pages (influencers) in a campaign first.</p>';
    } else {
      pagesDiv.innerHTML = projectList.map((p) => {
        const checked = defaultPageIds.includes(p.id) ? ' checked' : '';
        return `<label class="checkbox-field" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" class="trend-new-page-cb" value="${p.id}"${checked} />
          <span>${escapeHtml(p.name)}</span>
        </label>`;
      }).join('');
    }
    document.getElementById('trendNewForm').onsubmit = (e) => {
      e.preventDefault();
      const name = (nameInput && nameInput.value || '').trim() || 'New trend';
      const ids = Array.from(main.querySelectorAll('.trend-new-page-cb:checked')).map((cb) => parseInt(cb.value, 10)).filter((id) => !isNaN(id));
      if (!ids.length) { showAlert('Select at least one page'); return; }
      apiCreateTrend(name, ids, campaignId).then((t) => {
        location.hash = `#/trends/${t.id}`;
        render();
      }).catch((err) => showAlert(err.message || 'Failed to create trend'));
    };
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/trends" class="nav-link">← Back to trends</a></p><p>Could not load pages.</p></section>';
  });
}

function renderTrendDetail(trendId) {
  const tid = trendId;
  Promise.all([apiProjects(), apiTrend(tid), apiTrendLatest(tid), apiAllCampaigns(), apiConfig()]).then(([projects, trend, latest, campaigns, config]) => {
    if (!trend) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap back-link-wrap-centered"><a href="#/trends" class="nav-link">← Back to trends</a></p><p>Trend not found.</p></section>';
      return;
    }
    setBreadcrumb({ view: 'trendDetail', trendId: tid });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    const pages = pageIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
    const textOptions = Array.isArray(trend.textOptions) && trend.textOptions.length ? trend.textOptions : ['Follow for more'];
    const textStyle = trend.textStyle || { x: 0, y: 0, fontSize: 48, font: 'Arial, sans-serif', color: 'white', strokeWidth: 2 };
    const latestUrls = (latest && latest.webContentUrls) ? latest.webContentUrls : [];
    const campaignId = trend.campaignId != null ? String(trend.campaignId) : null;
    const backLink = campaignId
      ? `<p class="back-link-wrap back-link-wrap-centered"><a href="#/campaigns/${escapeHtml(campaignId)}" class="nav-link">← Back to campaign</a></p>`
      : '<p class="back-link-wrap back-link-wrap-centered"><a href="#/trends" class="nav-link">← Back to trends</a></p>';

    const campaignOptions = (campaigns || []).map((c) => {
      const selected = campaignId === String(c.id) ? ' selected' : '';
      return `<option value="${c.id}"${selected}>${escapeHtml(c.name)}</option>`;
    }).join('');

    const main = document.getElementById('main');
    const trendAvatarEl = `<div class="campaign-detail-avatar-wrap"><div class="campaign-avatar-clickable" id="trendDetailAvatarClickable" title="Click to change image"><div class="campaign-avatar campaign-avatar-square"><img src="${trendAvatarUrl(tid)}" alt="" class="campaign-avatar-img" id="trendDetailAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="trendDetailAvatarPlaceholder" style="display:none;">${(trend.name || 'T').charAt(0).toUpperCase()}</span></div></div><input type="file" accept="image/*" id="trendDetailAvatarInput" hidden /></div>`;
    main.innerHTML = `
      <section class="card">
        ${backLink}
        <div class="trend-detail-header" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
          ${trendAvatarEl}
          <div>
            <h1 id="trendDetailName" title="Double-click to rename" style="margin:0;">${escapeHtml(trend.name)}</h1>
          </div>
        </div>

        <section class="card" style="margin-top:1rem;">
          <h2>Campaign</h2>
          <p class="hint">Optionally link this trend to a campaign. When linked, posting (Run now) is only allowed within the campaign's date window.</p>
          <div class="trend-campaign-select-wrap" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label class="field" style="min-width:200px;">
              <span class="field-label">Connected campaign</span>
              <select id="trendCampaignSelect" class="field-select">
                <option value="">None</option>
                ${campaignOptions}
              </select>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="trendSaveCampaignBtn" style="margin-top:1.25rem;">Save campaign link</button>
          </div>
        </section>

        <section class="card" style="margin-top:1rem;">
          <h2>On-screen text &amp; text styling</h2>
          <p class="hint">Shared across all pages in this trend. Position and style of the overlay text on images.</p>
          <div class="text-style-folder-card text-style-folder-card-live" data-folder="trend-shared">
            <div class="text-style-settings-panel">
              <div class="text-style-grid">
                <label class="field"><span>X (%)</span><input type="number" id="trendTextX" value="${textStyle.x ?? 0}" step="1" /></label>
                <label class="field"><span>Y (%)</span><input type="number" id="trendTextY" value="${textStyle.y ?? 0}" step="1" /></label>
                <label class="field"><span>Size (px)</span><input type="number" id="trendTextSize" value="${(textStyle.fontSize >= 12 && textStyle.fontSize <= 200) ? textStyle.fontSize : 48}" min="12" max="200" step="1" /></label>
                <label class="field"><span>Font</span><select id="trendTextFont" class="field-select">${AVAILABLE_FONTS.map((f) => `<option value="${escapeHtml(f)}" ${(textStyle.font || 'Arial, sans-serif') === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}</select></label>
                <label class="field"><span>Color</span><input type="text" id="trendTextColor" value="${escapeHtml(textStyle.color || 'white')}" /></label>
                <label class="field"><span>Stroke</span><input type="number" id="trendTextStroke" value="${textStyle.strokeWidth ?? 2}" min="0" max="10" step="0.5" /></label>
              </div>
            </div>
            <div class="trend-text-options-wrap">
              <h4 class="field-label">Text options (one per line, used randomly)</h4>
              <textarea id="trendTextOptions" rows="4" class="field-input" placeholder="Follow for more\nLike &amp; Save">${escapeHtml((textOptions || []).join('\n'))}</textarea>
            </div>
          </div>
          <label class="checkbox-field" style="margin-top:12px;display:block;"><input type="checkbox" id="trendSendAsDraft" ${trend.sendAsDraft ? 'checked' : ''} /><span>Send to Blotato as draft</span></label>
          <label class="checkbox-field" style="margin-top:8px;display:block;"><input type="checkbox" id="trendAddMusicToCarousel" ${trend.addMusicToCarousel ? 'checked' : ''} /><span>Add music to carousel</span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button type="button" class="btn btn-secondary" id="trendSaveTextStyle">Save text styles</button>
            <button type="button" class="btn btn-primary" id="trendRunNow">Run now</button>
            <button type="button" class="btn btn-ghost" id="trendClearUrls">Clear URLs</button>
          </div>
        </section>

        <section class="card" style="margin-top:1rem;">
          <h2>Pages</h2>
          <p class="hint">Select which pages this trend applies to. For each page below: photo folders, schedule, run now, and generated URLs.</p>
          <div class="trend-pages-select-wrap" id="trendPagesSelectWrap" style="margin-bottom:1rem;">
            <span class="field-label">Attached pages</span>
            <div id="trendPagesCheckboxes" class="new-campaign-pages" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="trendSavePagesBtn" style="margin-top:8px;">Save pages</button>
          </div>
          <div class="trend-folders-control" style="margin-bottom:1rem;">
            <span class="field-label">Folders per page</span>
            <span id="trendFolderCountDisplay" style="margin-right:8px;">${Math.max(1, parseInt(trend.folderCount, 10) || 3)}</span>
            <button type="button" class="btn btn-ghost btn-sm" id="trendAddFolderBtn">+ Add folder</button>
            <button type="button" class="btn btn-ghost btn-sm" id="trendDeleteFolderBtn">− Delete folder</button>
          </div>
          <div class="trend-pages-grid" id="trendPagesGrid"></div>
          <input type="file" accept="image/*" multiple id="trendFolderUploadInput" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;" />
        </section>
      </section>
    `;

    let trendUploadTarget = null;
    const trendFolderUploadInput = document.getElementById('trendFolderUploadInput');
    if (trendFolderUploadInput) {
      trendFolderUploadInput.onchange = (e) => {
        const files = e.target.files;
        e.target.value = '';
        if (!files || !files.length || !trendUploadTarget) return;
        const { pageIndex, folderNum, refreshPageFolders } = trendUploadTarget;
        trendUploadTarget = null;
        trendUploadWithProgress(tid, pageIndex, folderNum, Array.from(files))
          .then(() => { if (typeof refreshPageFolders === 'function') refreshPageFolders(); showToast('Photos added.', 'success'); })
          .catch((err) => showAlert(err.message || 'Upload failed'));
      };
    }

    document.getElementById('trendDetailName').ondblclick = () => {
      showPrompt('Trend name:', trend.name).then((name) => {
        if (name != null && name.trim()) apiUpdateTrend(tid, { name: name.trim() }).then((t) => { trend = t; document.getElementById('trendDetailName').textContent = t.name; });
      });
    };

    const pagesCheckboxesEl = document.getElementById('trendPagesCheckboxes');
    const savePagesBtn = document.getElementById('trendSavePagesBtn');
    if (pagesCheckboxesEl && Array.isArray(projects)) {
      const currentPageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
      pagesCheckboxesEl.innerHTML = projects.map((p) => {
        const checked = currentPageIds.includes(p.id) ? ' checked' : '';
        return `<label class="checkbox-field" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" class="trend-page-cb" value="${p.id}"${checked} />
          <span>${escapeHtml(p.name)}</span>
        </label>`;
      }).join('');
    }
    if (savePagesBtn) {
      savePagesBtn.onclick = () => {
        const selectedIds = Array.from(main.querySelectorAll('.trend-page-cb:checked')).map((cb) => parseInt(cb.value, 10)).filter((id) => !isNaN(id));
        if (!selectedIds.length) { showAlert('Select at least one page'); return; }
        apiUpdateTrend(tid, { pageIds: selectedIds })
          .then((t) => { trend = t; showToast('Pages saved.', 'success'); renderTrendDetail(tid); })
          .catch((err) => showAlert(err.message || 'Failed to save pages'));
      };
    }

    const trendCampaignSelect = document.getElementById('trendCampaignSelect');
    const trendSaveCampaignBtn = document.getElementById('trendSaveCampaignBtn');
    if (trendSaveCampaignBtn && trendCampaignSelect) {
      trendSaveCampaignBtn.onclick = () => {
        const val = trendCampaignSelect.value;
        const campaignId = val ? String(val) : null;
        apiUpdateTrend(tid, { campaignId })
          .then((t) => { trend = t; showToast('Campaign link saved.', 'success'); renderTrendDetail(tid); })
          .catch((err) => showAlert(err.message || 'Failed to save campaign link'));
      };
    }

    const trendFolderCountDisplay = document.getElementById('trendFolderCountDisplay');
    const addFolderBtn = document.getElementById('trendAddFolderBtn');
    const deleteFolderBtn = document.getElementById('trendDeleteFolderBtn');
    if (addFolderBtn) {
      addFolderBtn.onclick = () => {
        const next = Math.min(20, (parseInt(trend.folderCount, 10) || 3) + 1);
        apiUpdateTrend(tid, { folderCount: next }).then((t) => { trend = t; renderTrendDetail(tid); }).catch((err) => showAlert(err.message || 'Failed'));
      };
    }
    if (deleteFolderBtn) {
      deleteFolderBtn.onclick = () => {
        const current = Math.max(1, parseInt(trend.folderCount, 10) || 3);
        if (current <= 1) { showAlert('At least one folder is required.'); return; }
        apiUpdateTrend(tid, { folderCount: current - 1 }).then((t) => { trend = t; renderTrendDetail(tid); }).catch((err) => showAlert(err.message || 'Failed'));
      };
    }

    document.getElementById('trendSaveTextStyle').onclick = () => {
      const textOptionsArr = (document.getElementById('trendTextOptions').value || '').trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
      const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(document.getElementById('trendTextSize').value) || 48)));
      const textStyleObj = {
        x: parseFloat(document.getElementById('trendTextX').value) ?? 0,
        y: parseFloat(document.getElementById('trendTextY').value) ?? 0,
        fontSize: sizePx,
        font: (document.getElementById('trendTextFont').value || 'Arial, sans-serif').trim(),
        color: (document.getElementById('trendTextColor').value || 'white').trim(),
        strokeWidth: parseFloat(document.getElementById('trendTextStroke').value) ?? 2,
      };
      apiUpdateTrend(tid, { textOptions: textOptionsArr.length ? textOptionsArr : ['Follow for more'], textStyle: textStyleObj })
        .then((t) => { trend = t; showToast('Text styles saved.', 'success'); })
        .catch((err) => showAlert(err.message || 'Failed to save'));
    };

    const grid = document.getElementById('trendPagesGrid');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
    const serverTz = (config && config.timezone) || 'America/New_York';
    const userTz = getCalendarDisplayTimezone(serverTz);
    pages.forEach((p, idx) => {
      const pageIndex = idx + 1;
      const schedule = (trend.pageSchedules && trend.pageSchedules[p.id]) || {};
      const rawTimes = schedule.scheduleTimes || ['10:00', '13:00', '16:00'];
      const times = rawTimes.map((t) => convertTimeForDisplay(serverTz, userTz, t || '10:00'));
      const daysOfWeek = schedule.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
      const scheduleStart = schedule.scheduleStartDate || '';
      const scheduleEnd = schedule.scheduleEndDate || '';
      const folderCardsHtml = Array.from({ length: folderCount }, (_, i) => {
        const f = i + 1;
        const isLast = f === folderCount;
        const canDelete = folderCount > 1 && isLast;
        return `
          <div class="folder trend-folder" data-folder="${f}">
            <div class="dropzone trend-dropzone" data-trend-id="${tid}" data-page-index="${pageIndex}" data-folder-num="${f}">
              <span class="dropzone-label">Folder ${f}</span>
              <span class="trend-folder-count" data-page-index="${pageIndex}" data-folder-num="${f}">0 photos</span>
              <div class="trend-folder-photos" data-folder-num="${f}"></div>
              <button type="button" class="btn btn-secondary btn-sm dropzone-add">Add photos</button>
              <button type="button" class="btn btn-ghost btn-sm trend-folder-preview" data-page-index="${pageIndex}" data-folder-num="${f}">Preview</button>
              ${canDelete ? `<button type="button" class="btn btn-ghost btn-sm trend-delete-folder" data-folder-num="${f}" aria-label="Delete folder">Delete folder</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
      const card = document.createElement('div');
      card.className = 'card trend-page-card';
      card.innerHTML = `
        <h3>${escapeHtml(p.name)}</h3>
        <div class="trend-page-photos">
          <p class="hint">Photos for this page. One image per folder is used per run. Add photos and use Preview to see the result.</p>
          <div class="trend-folders folders" data-page-index="${pageIndex}">${folderCardsHtml}</div>
        </div>
        <div class="trend-page-schedule schedule-content">
          <h4>Schedule</h4>
          <p class="hint" style="margin-top:0;">Times use your selected timezone (Settings → Display timezone).</p>
          <label class="checkbox-field"><input type="checkbox" class="trend-schedule-enabled" data-page-id="${p.id}" ${schedule.scheduleEnabled !== false ? 'checked' : ''} /><span>Run on schedule</span></label>
          <div class="schedule-date-range" style="margin-top:8px;">
            <label class="field"><span>Start date</span><input type="date" class="trend-schedule-start" data-page-id="${p.id}" value="${scheduleStart}" /></label>
            <label class="field"><span>End date</span><input type="date" class="trend-schedule-end" data-page-id="${p.id}" value="${scheduleEnd}" /></label>
          </div>
          <div class="schedule-days" style="margin-top:8px;">
            <span class="field-label">Days of week</span>
            <div class="schedule-days-checkboxes">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<label class="checkbox-field checkbox-inline"><input type="checkbox" class="trend-schedule-day" data-page-id="${p.id}" data-day="${d}" ${daysOfWeek.includes(d) ? 'checked' : ''} /><span>${dayNames[d]}</span></label>`).join('')}</div>
          </div>
          <div class="schedule-times-wrap" style="margin-top:8px;">
            <div class="schedule-times-header"><span class="field-label">Post times (${times.length} per day)</span><button type="button" class="btn btn-ghost btn-sm trend-add-time" data-page-id="${p.id}">+ Add time</button><button type="button" class="btn btn-ghost btn-sm trend-remove-time" data-page-id="${p.id}">− Remove</button></div>
            <div class="schedule-times trend-schedule-times" data-page-id="${p.id}">${times.map((t, i) => `<label class="time-row"><input type="time" class="trend-time-input" data-page-id="${p.id}" data-index="${i}" value="${t || '10:00'}" /></label>`).join('')}</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm trend-save-schedule-btn" data-page-id="${p.id}" style="margin-top:8px;">Save schedule</button>
        </div>
        <div class="trend-page-run">
          <h4>Run &amp; generated URLs</h4>
          <button type="button" class="btn btn-primary btn-sm trend-page-run-now" data-page-id="${p.id}" style="margin-bottom:8px;">Run now</button>
          <p class="hint">Generates one image per folder for this trend (shared text). URLs appear below.</p>
          <div class="trend-urls-list" data-page-id="${p.id}"></div>
        </div>
      `;
      grid.appendChild(card);

      function refreshPageFolders() {
        apiTrendPageFolders(tid, pageIndex).then((data) => {
          const fc = data.folderCount || folderCount;
          const folders = data.folders || {};
          card.querySelectorAll('.trend-folder').forEach((el, i) => {
            const f = i + 1;
            const items = folders[`folder${f}`] || [];
            const count = items.length;
            const countEl = el.querySelector('.trend-folder-count');
            if (countEl) countEl.textContent = `${count} photo${count !== 1 ? 's' : ''}`;
            const photosEl = el.querySelector('.trend-folder-photos');
            if (photosEl) {
              const filenames = items.map((it) => typeof it === 'string' ? it : (it && it.filename) || '');
              if (filenames.length === 0) {
                photosEl.innerHTML = '';
                photosEl.style.display = 'none';
              } else {
                photosEl.style.display = '';
                photosEl.innerHTML = filenames.map((name) => `
                  <div class="trend-folder-photo-item">
                    <img alt="" loading="lazy" data-src="${trendFolderImageUrl(tid, pageIndex, f, name)}" />
                  </div>
                `).join('');
                photosEl.querySelectorAll('img[data-src]').forEach((img) => {
                  withAuthQuery(img.dataset.src).then((url) => { img.src = url; img.removeAttribute('data-src'); });
                });
              }
            }
          });
        }).catch(() => {});
      }
      refreshPageFolders();

      card.querySelectorAll('.trend-dropzone').forEach((dz) => {
        const folderNum = parseInt(dz.dataset.folderNum, 10);
        const addBtn = dz.querySelector('button.dropzone-add');
        const previewBtn = dz.querySelector('.trend-folder-preview');
        if (addBtn && trendFolderUploadInput) {
          addBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            trendUploadTarget = { pageIndex, folderNum, refreshPageFolders };
            trendFolderUploadInput.click();
          };
        }
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
        dz.ondragleave = () => dz.classList.remove('dragover');
        dz.ondrop = (e) => {
          e.preventDefault();
          dz.classList.remove('dragover');
          const files = e.dataTransfer.files;
          if (files && files.length) trendUploadWithProgress(tid, pageIndex, folderNum, Array.from(files)).then(() => refreshPageFolders()).catch((err) => showAlert(err.message || 'Upload failed'));
        };
        dz.onclick = (e) => {
          if (e.target === previewBtn || addBtn?.contains(e.target) || dz.querySelector('.trend-folder-photos')?.contains(e.target)) return;
          if (trendFolderUploadInput) {
            trendUploadTarget = { pageIndex, folderNum, refreshPageFolders };
            trendFolderUploadInput.click();
          }
        };
        if (previewBtn) previewBtn.onclick = (e) => {
          e.stopPropagation();
          const textOptionsArr = (document.getElementById('trendTextOptions') && document.getElementById('trendTextOptions').value || '').trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
          const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat((document.getElementById('trendTextSize') || {}).value) || 48)));
          const textStyleObj = {
            x: parseFloat((document.getElementById('trendTextX') || {}).value) ?? 0,
            y: parseFloat((document.getElementById('trendTextY') || {}).value) ?? 0,
            fontSize: sizePx,
            font: ((document.getElementById('trendTextFont') || {}).value || 'Arial, sans-serif').trim(),
            color: ((document.getElementById('trendTextColor') || {}).value || 'white').trim(),
            strokeWidth: parseFloat((document.getElementById('trendTextStroke') || {}).value) ?? 2,
          };
          apiTrendPreview(tid, pageIndex, folderNum, textStyleObj, textOptionsArr.length ? textOptionsArr : null)
            .then((r) => { if (r.url) window.open(r.url, '_blank'); else showAlert('Preview failed'); })
            .catch((err) => showAlert(err.message || 'Preview failed'));
        };
      });

      const timesWrap = card.querySelector('.trend-schedule-times');
      card.querySelector('.trend-add-time').onclick = () => {
        const inputs = timesWrap.querySelectorAll('.trend-time-input');
        const lastVal = inputs.length ? inputs[inputs.length - 1].value : '10:00';
        const [h, m] = lastVal.split(':').map(Number);
        const nextVal = `${String((h + 2) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
        const label = document.createElement('label');
        label.className = 'time-row';
        label.innerHTML = `<input type="time" class="trend-time-input" data-page-id="${p.id}" data-index="${inputs.length}" value="${nextVal}" />`;
        timesWrap.appendChild(label);
      };
      card.querySelector('.trend-remove-time').onclick = () => {
        const rows = timesWrap.querySelectorAll('.time-row');
        if (rows.length > 1) rows[rows.length - 1].remove();
      };

      card.querySelector('.trend-save-schedule-btn').onclick = () => {
        const enabled = !!card.querySelector('.trend-schedule-enabled').checked;
        const scheduleStartVal = (card.querySelector('.trend-schedule-start') || {}).value || null;
        const scheduleEndVal = (card.querySelector('.trend-schedule-end') || {}).value || null;
        const daysChecked = Array.from(card.querySelectorAll('.trend-schedule-day:checked')).map((cb) => parseInt(cb.dataset.day, 10));
        const displayTimes = Array.from(card.querySelectorAll('.trend-time-input')).map((inp) => inp.value || '10:00');
        const scheduleTimes = displayTimes.map((t) => convertTimeToServer(userTz, serverTz, t));
        const newSchedules = { ...(trend.pageSchedules || {}) };
        newSchedules[p.id] = { scheduleEnabled: enabled, scheduleStartDate: scheduleStartVal, scheduleEndDate: scheduleEndVal, scheduleDaysOfWeek: daysChecked, scheduleTimes };
        apiUpdateTrend(tid, { pageSchedules: newSchedules }).then((t) => { trend = t; showToast('Schedule saved.', 'success'); }).catch((err) => showAlert(err.message || 'Failed to save'));
      };

      const urlListEl = card.querySelector('.trend-urls-list');
      const urlsForPage = latestUrls.filter((u) => u.pageId === p.id).map((u) => u.url);
      urlListEl.innerHTML = urlsForPage.length ? urlsForPage.map((u) => `<p class="url-item"><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></p>`).join('') : '<p class="hint">Run to generate media URLs.</p>';

      const runNowBtn = card.querySelector('.trend-page-run-now');
      if (runNowBtn) {
        runNowBtn.onclick = () => {
          const textOptionsArr = (document.getElementById('trendTextOptions') && document.getElementById('trendTextOptions').value || '').trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
          const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat((document.getElementById('trendTextSize') || {}).value) || 48)));
          const textStyleObj = {
            x: parseFloat((document.getElementById('trendTextX') || {}).value) ?? 0,
            y: parseFloat((document.getElementById('trendTextY') || {}).value) ?? 0,
            fontSize: sizePx,
            font: ((document.getElementById('trendTextFont') || {}).value || 'Arial, sans-serif').trim(),
            color: ((document.getElementById('trendTextColor') || {}).value || 'white').trim(),
            strokeWidth: parseFloat((document.getElementById('trendTextStroke') || {}).value) ?? 2,
          };
          const sendAsDraft = !!document.getElementById('trendSendAsDraft')?.checked;
          const addMusicToCarousel = !!document.getElementById('trendAddMusicToCarousel')?.checked;
          apiUpdateTrend(tid, { ...trend, sendAsDraft, addMusicToCarousel }).then((t) => { trend = t; return apiTrendRun(tid, textStyleObj, textOptionsArr.length ? textOptionsArr : null, sendAsDraft, addMusicToCarousel); }).then(() => renderTrendDetail(tid)).catch((err) => showAlert(err.message || 'Run failed'));
        };
      }

      card.querySelectorAll('.trend-delete-folder').forEach((delBtn) => {
        delBtn.onclick = () => {
          const current = Math.max(1, parseInt(trend.folderCount, 10) || 3);
          if (current <= 1) { showAlert('At least one folder is required.'); return; }
          apiUpdateTrend(tid, { folderCount: current - 1 }).then((t) => { trend = t; renderTrendDetail(tid); }).catch((err) => showAlert(err.message || 'Failed'));
        };
      });
    });

    document.getElementById('trendRunNow').onclick = () => {
      const textOptionsArr = (document.getElementById('trendTextOptions').value || '').trim().split(/\n/).map((s) => s.trim()).filter(Boolean);
      const sizePx = Math.max(12, Math.min(200, Math.round(parseFloat(document.getElementById('trendTextSize').value) || 48)));
      const textStyleObj = {
        x: parseFloat(document.getElementById('trendTextX').value) ?? 0,
        y: parseFloat(document.getElementById('trendTextY').value) ?? 0,
        fontSize: sizePx,
        font: (document.getElementById('trendTextFont').value || 'Arial, sans-serif').trim(),
        color: (document.getElementById('trendTextColor').value || 'white').trim(),
        strokeWidth: parseFloat(document.getElementById('trendTextStroke').value) ?? 2,
      };
      const sendAsDraft = !!document.getElementById('trendSendAsDraft')?.checked;
      const addMusicToCarousel = !!document.getElementById('trendAddMusicToCarousel')?.checked;
      apiUpdateTrend(tid, { ...trend, sendAsDraft, addMusicToCarousel }).then((t) => { trend = t; return apiTrendRun(tid, textStyleObj, textOptionsArr.length ? textOptionsArr : null, sendAsDraft, addMusicToCarousel); }).then(() => renderTrendDetail(tid)).catch((err) => showAlert(err.message || 'Run failed'));
    };

    document.getElementById('trendClearUrls').onclick = () => {
      showConfirm('Clear all generated URLs for this trend?').then((ok) => {
        if (!ok) return;
        apiTrendClearLatest(tid).then(() => renderTrendDetail(tid));
      });
    };
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap back-link-wrap-centered"><a href="#/trends" class="nav-link">← Back to trends</a></p><p>Could not load trend.</p></section>';
  });
}

function renderCalendar() {
  setBreadcrumb({ view: 'calendar' });
  showViewLoading();
  apiWithAuth(`${API}/api/calendar?_=${Date.now()}`).then((r) => r.json()).then((data) => {
    const allItems = data.items || [];
    const recurringTodo = Array.isArray(data.recurringTodo) ? data.recurringTodo : (data.todo || []).filter((t) => t.type === 'recurring').sort((a, b) => ((a.daysUntil ?? 999) - (b.daysUntil ?? 999)) || (a.stopDate || '').localeCompare(b.stopDate || ''));
    const campaignGapTodo = Array.isArray(data.campaignGapTodo) ? data.campaignGapTodo : (data.todo || []).filter((t) => t.type === 'campaign_gap').sort((a, b) => (a.daysBefore ?? 999) - (b.daysBefore ?? 999));
    const main = document.getElementById('main');
    const serverTz = data.timezone || 'America/New_York';
    const displayTz = getCalendarDisplayTimezone(serverTz);
    const tzLabel = data.timezoneLabel || data.timezone || '';
    const tzHint = tzLabel ? ` Schedule runs in ${tzLabel}; times below use your selected timezone.` : '';
    const campaigns = [];
    const seenCampaign = new Set();
    allItems.forEach((it) => {
      const id = it.campaignId;
      if (id != null && !seenCampaign.has(id)) { seenCampaign.add(id); campaigns.push({ id, name: it.campaignName || ('Campaign ' + id) }); }
    });
    campaigns.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const pages = [];
    const seenPage = new Set();
    allItems.forEach((it) => {
      const id = it.projectId;
      if (id != null && !seenPage.has(id)) { seenPage.add(id); pages.push({ id, name: it.projectName || ('Page ' + id) }); }
    });
    pages.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    let scopeFilter = 'all';
    let selectedCampaignId = null;
    let selectedProjectId = null;
    let viewMode = 'list';
    let selectedDay = null;
    let calendarMonth = new Date();
    const route = getRoute();
    if (route.calendarDate) {
      selectedDay = route.calendarDate;
      const [y, m] = selectedDay.split('-');
      calendarMonth = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    }

    function getFilteredItems() {
      if (scopeFilter === 'campaign') {
        if (selectedCampaignId == null) return [];
        return allItems.filter((it) => String(it.campaignId) === String(selectedCampaignId));
      }
      if (scopeFilter === 'page') {
        if (selectedProjectId == null) return [];
        return allItems.filter((it) => String(it.projectId) === String(selectedProjectId));
      }
      return allItems;
    }

    function doExportCsv() {
      const items = getFilteredItems();
      const escapeCsv = (val) => {
        const s = String(val == null ? '' : val);
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const header = 'Date,Time,Page,Campaign';
      const rows = items.map((it) => {
        const inTz = it.scheduledAt ? formatScheduledAtInTz(it.scheduledAt, displayTz) : null;
        const dateDisplay = inTz ? inTz.dateLabel : formatCalendarDate(it.date);
        const timeDisplay = inTz ? inTz.timeLabel : formatTimeAMPM(it.time);
        return [escapeCsv(dateDisplay), escapeCsv(timeDisplay), escapeCsv(it.projectName), escapeCsv(it.campaignName)].join(',');
      });
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `calendar-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function render() {
      const items = getFilteredItems();
      const total = items.length;
      const itemsByDateKey = {};
      items.forEach((it) => {
        const key = it.scheduledAt ? getScheduledDateKey(it.scheduledAt, displayTz) : (it.date || '');
        if (key) {
          if (!itemsByDateKey[key]) itemsByDateKey[key] = [];
          itemsByDateKey[key].push(it);
        }
      });
      const monthYear = calendarMonth.getFullYear();
      const monthIndex = calendarMonth.getMonth();
      const firstDay = new Date(monthYear, monthIndex, 1);
      const lastDay = new Date(monthYear, monthIndex + 1, 0);
      const startWeekday = firstDay.getDay();
      const daysInMonth = lastDay.getDate();
      const monthName = firstDay.toLocaleString('en-US', { month: 'long' });
      const today = new Date();
      const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

      const selectedCampaign = selectedCampaignId != null ? campaigns.find((c) => String(c.id) === String(selectedCampaignId)) : null;
      const campaignPickerTriggerLabel = selectedCampaign ? escapeHtml(selectedCampaign.name) : 'Select campaign';
      const campaignPickerTriggerAvatar = selectedCampaign
        ? `<span class="calendar-campaign-picker-trigger-avatar"><img src="${campaignAvatarUrl(selectedCampaign.id)}" alt="" class="calendar-campaign-picker-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(selectedCampaign.name || 'C').charAt(0).toUpperCase()}</span></span>`
        : '';
      const campaignPickerItems = campaigns.length ? campaigns.map((c) => {
        const sel = selectedCampaignId != null && String(c.id) === String(selectedCampaignId);
        return `<button type="button" class="calendar-campaign-picker-item ${sel ? 'calendar-campaign-picker-item-selected' : ''}" data-campaign-id="${escapeHtml(String(c.id))}" title="${escapeHtml(c.name)}">
          <span class="calendar-campaign-picker-item-avatar"><img src="${campaignAvatarUrl(c.id)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(c.name || 'C').charAt(0).toUpperCase()}</span></span>
          <span class="calendar-campaign-picker-item-name">${escapeHtml(c.name)}</span>
        </button>`;
      }).join('') : '<div class="calendar-campaign-picker-empty">No campaigns</div>';
      const selectedPage = selectedProjectId != null ? pages.find((p) => String(p.id) === String(selectedProjectId)) : null;
      const pagePickerTriggerLabel = selectedPage ? escapeHtml(selectedPage.name) : 'Select page';
      const pagePickerTriggerAvatar = selectedPage
        ? `<span class="calendar-campaign-picker-trigger-avatar"><img src="${projectAvatarUrl(selectedPage.id)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(selectedPage.name || 'P').charAt(0).toUpperCase()}</span></span>`
        : '';
      const pagePickerItems = pages.length ? pages.map((p) => {
        const sel = selectedProjectId != null && String(p.id) === String(selectedProjectId);
        return `<button type="button" class="calendar-campaign-picker-item ${sel ? 'calendar-campaign-picker-item-selected' : ''}" data-page-id="${escapeHtml(String(p.id))}" title="${escapeHtml(p.name)}">
          <span class="calendar-campaign-picker-item-avatar"><img src="${projectAvatarUrl(p.id)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-campaign-picker-avatar-placeholder" style="display:none;">${(p.name || 'P').charAt(0).toUpperCase()}</span></span>
          <span class="calendar-campaign-picker-item-name">${escapeHtml(p.name)}</span>
        </button>`;
      }).join('') : '<div class="calendar-campaign-picker-empty">No pages</div>';
      const scopeFilterHtml = `
        <div class="calendar-scope-wrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:0.75rem;margin-bottom:1rem;">
          <label class="field" style="display:inline-flex;align-items:center;gap:0.5rem;">
            <span>Show:</span>
            <select id="calendarScopeFilter" class="field-select" style="min-width:11rem;">
              <option value="all" ${scopeFilter === 'all' ? 'selected' : ''}>All posts</option>
              <option value="campaign" ${scopeFilter === 'campaign' ? 'selected' : ''}>Per campaign</option>
              <option value="page" ${scopeFilter === 'page' ? 'selected' : ''}>Per page</option>
            </select>
          </label>
          <label class="field calendar-scope-campaign" id="calendarScopeCampaignWrap" style="display:${scopeFilter === 'campaign' ? 'inline-flex' : 'none'};align-items:center;gap:0.5rem;">
            <span>Campaign:</span>
            <div class="calendar-campaign-picker" id="calendarCampaignPicker">
              <button type="button" class="calendar-campaign-picker-trigger field-select" id="calendarCampaignPickerTrigger" aria-haspopup="listbox" aria-expanded="false">
                ${campaignPickerTriggerAvatar ? `<span class="calendar-campaign-picker-trigger-avatar">${campaignPickerTriggerAvatar}</span>` : ''}
                <span class="calendar-campaign-picker-trigger-label">${campaignPickerTriggerLabel}</span>
              </button>
              <div class="calendar-campaign-picker-dropdown" id="calendarCampaignPickerDropdown" role="listbox" hidden>
                ${campaignPickerItems}
              </div>
            </div>
          </label>
          <label class="field calendar-scope-page" id="calendarScopePageWrap" style="display:${scopeFilter === 'page' ? 'inline-flex' : 'none'};align-items:center;gap:0.5rem;">
            <span>Page:</span>
            <div class="calendar-campaign-picker calendar-page-picker" id="calendarPagePicker">
              <button type="button" class="calendar-campaign-picker-trigger field-select" id="calendarPagePickerTrigger" aria-haspopup="listbox" aria-expanded="false">
                ${pagePickerTriggerAvatar || ''}
                <span class="calendar-campaign-picker-trigger-label">${pagePickerTriggerLabel}</span>
              </button>
              <div class="calendar-campaign-picker-dropdown" id="calendarPagePickerDropdown" role="listbox" hidden>
                ${pagePickerItems}
              </div>
            </div>
          </label>
        </div>`;

      let contentHtml = '';
      if (selectedDay) {
        const dayItems = (itemsByDateKey[selectedDay] || []).slice().sort((a, b) => {
          const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
          const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
          return ta - tb;
        });
        const [y, m, d] = selectedDay.split('-');
        const dayDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        const dayLabel = dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        contentHtml = `
          <div class="calendar-day-detail">
            <p class="back-link-wrap"><button type="button" class="btn btn-ghost btn-sm" id="calendarDayBack">← Back to calendar</button></p>
            <h2>Posts on ${escapeHtml(dayLabel)}</h2>
            <p class="hint">${dayItems.length} post${dayItems.length !== 1 ? 's' : ''} scheduled. <span class="calendar-legend calendar-legend-success">Green</span> = posted successfully, <span class="calendar-legend calendar-legend-failure">red</span> = failed to post.</p>
            <div class="calendar-header calendar-header-day">
              <span class="calendar-time">Time</span>
              <span class="calendar-project">Page</span>
              <span class="calendar-campaign">Campaign</span>
            </div>
            <ul class="calendar-list" id="calendarList">${dayItems.map((it, idx) => {
              const inTz = it.scheduledAt ? formatScheduledAtInTz(it.scheduledAt, displayTz) : null;
              const timeDisplay = inTz ? inTz.timeLabel : formatTimeAMPM(it.time);
              const pageAvatar = it.projectId ? `<span class="calendar-page-avatar"><img src="${projectAvatarUrl(it.projectId)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-page-avatar-placeholder" style="display:none;">${(it.projectName || 'P').charAt(0).toUpperCase()}</span></span>` : '';
              const statusClass = it.postStatus === 'success' ? ' calendar-item-success' : it.postStatus === 'failure' ? ' calendar-item-failure' : '';
              const hasDetail = it.postStatus === 'failure' && it.postError;
              const expandable = hasDetail ? ' calendar-item-expandable' : '';
              const detailId = `calItemDetail-${idx}`;
              const detailHtml = hasDetail ? `<div class="calendar-item-detail is-error" id="${detailId}" hidden>${escapeHtml(it.postError)}</div>` : '';
              return `<li class="calendar-item${statusClass}${expandable}"${hasDetail ? ` data-detail="${detailId}"` : ''}><span class="calendar-time">${timeDisplay}</span><span class="calendar-project">${pageAvatar}<span class="calendar-page-name">${escapeHtml(it.projectName)}</span></span><span class="calendar-campaign"><a href="#/campaigns/${it.campaignId}" class="calendar-campaign-link">${escapeHtml(it.campaignName)}</a></span>${detailHtml}</li>`;
            }).join('')}</ul>
          </div>`;
      } else if (viewMode === 'calendar') {
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const cells = [];
        for (let i = 0; i < startWeekday; i++) cells.push({ empty: true });
        for (let d = 1; d <= daysInMonth; d++) {
          const dateKey = monthYear + '-' + String(monthIndex + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const count = (itemsByDateKey[dateKey] || []).length;
          const isToday = dateKey === todayKey;
          cells.push({ dateKey, day: d, count, isToday });
        }
        const totalCells = 42;
        while (cells.length < totalCells) cells.push({ empty: true });
        contentHtml = `
          <div class="calendar-month-nav" style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
            <button type="button" class="btn btn-ghost btn-sm" id="calendarMonthPrev">← Prev</button>
            <span class="calendar-month-title" style="font-weight:600;min-width:180px;text-align:center;">${monthName} ${monthYear}</span>
            <button type="button" class="btn btn-ghost btn-sm" id="calendarMonthNext">Next →</button>
          </div>
          <div class="calendar-grid-wrap">
            <div class="calendar-grid-header">${weekDays.map((w) => `<span class="calendar-cell calendar-cell-head">${w}</span>`).join('')}</div>
            <div class="calendar-grid-body">${cells.map((c) => {
              if (c.empty) return '<span class="calendar-cell calendar-cell-empty"></span>';
              const clickable = c.count > 0 ? ' calendar-cell-clickable' : '';
              const todayClass = c.isToday ? ' calendar-cell-today' : '';
              return `<button type="button" class="calendar-cell calendar-cell-day${clickable}${todayClass}" data-date-key="${escapeHtml(c.dateKey)}"><span class="calendar-cell-day-num">${c.day}</span>${c.count > 0 ? `<span class="calendar-cell-count">${c.count} post${c.count !== 1 ? 's' : ''}</span>` : ''}</button>`;
            }).join('')}</div>
          </div>`;
      } else {
        contentHtml = `
          <div class="calendar-header">
            <span class="calendar-date">Date</span>
            <span class="calendar-time">Time</span>
            <span class="calendar-project">Page</span>
            <span class="calendar-campaign">Campaign</span>
          </div>
          <ul class="calendar-list" id="calendarList">${items.map((it) => {
            const inTz = it.scheduledAt ? formatScheduledAtInTz(it.scheduledAt, displayTz) : null;
            const dateDisplay = inTz ? inTz.dateLabel : formatCalendarDate(it.date);
            const timeDisplay = inTz ? inTz.timeLabel : formatTimeAMPM(it.time);
            const pageAvatar = it.projectId ? `<span class="calendar-page-avatar"><img src="${projectAvatarUrl(it.projectId)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="calendar-page-avatar-placeholder" style="display:none;">${(it.projectName || 'P').charAt(0).toUpperCase()}</span></span>` : '';
            return `<li class="calendar-item"><span class="calendar-date">${dateDisplay}</span><span class="calendar-time">${timeDisplay}</span><span class="calendar-project">${pageAvatar}<span class="calendar-page-name">${escapeHtml(it.projectName)}</span></span><span class="calendar-campaign"><a href="#/campaigns/${it.campaignId}" class="calendar-campaign-link">${escapeHtml(it.campaignName)}</a></span></li>`;
          }).join('')}</ul>`;
      }

      const formatTodoDate = (isoStr) => {
        if (!isoStr) return '';
        const d = new Date(isoStr + 'T12:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      };
      const recurringListHtml = recurringTodo.length ? recurringTodo.map((t) => {
        const dateStr = formatTodoDate(t.stopDate);
        const daysText = t.daysUntil != null && t.daysUntil <= 365 ? (t.daysUntil === 0 ? 'today' : t.daysUntil === 1 ? '1 day' : `${t.daysUntil} days`) : '';
        const suffix = daysText ? ` (${daysText})` : '';
        return `<li class="calendar-todo-item"><span class="calendar-todo-text"><span class="calendar-todo-page">${escapeHtml(t.pageName || 'Page')}</span> will stop posting on <strong>${escapeHtml(dateStr)}</strong>${escapeHtml(suffix)}.</span></li>`;
      }).join('') : '<li class="calendar-todo-empty">All recurring pages are scheduled.</li>';
      const campaignGapListHtml = campaignGapTodo.length ? campaignGapTodo.map((t) => {
        const days = t.daysBefore;
        const dayText = days === 1 ? '1 day' : `${days} days`;
        return `<li class="calendar-todo-item"><span class="calendar-todo-text"><span class="calendar-todo-page">${escapeHtml(t.pageName || 'Page')}</span> stops posting <strong>${dayText} before the campaign is over</strong>.</span></li>`;
      }).join('') : '<li class="calendar-todo-empty">No campaign pages missing posts.</li>';
      const todoSectionHtml = `
        <section class="card calendar-todo-card">
          <h2>To do</h2>
          <p class="hint">Keep recurring pages scheduled and add posts to campaigns so pages don’t stop before campaign end. Lists are ordered by urgency (soonest first).</p>
          <div class="calendar-todo-columns">
            <div class="calendar-todo-column">
              <h3 class="calendar-todo-column-title">Recurring pages</h3>
              <ol class="calendar-todo-list calendar-todo-list-numbered" id="calendarTodoRecurring">${recurringListHtml}</ol>
            </div>
            <div class="calendar-todo-column">
              <h3 class="calendar-todo-column-title">Missing posts (campaigns)</h3>
              <ol class="calendar-todo-list calendar-todo-list-numbered" id="calendarTodoCampaignGap">${campaignGapListHtml}</ol>
            </div>
          </div>
        </section>`;

      main.innerHTML = `
        <section class="card">
          <h1>Calendar</h1>
          <p class="calendar-total">Total scheduled: <strong>${total}</strong></p>
          <p class="hint">Upcoming scheduled posts across all pages (deployed campaigns only). Each campaign is capped by its smallest photo folder.${tzHint}</p>
          ${scopeFilterHtml}
          <div class="calendar-actions">
            <button type="button" class="btn btn-secondary" id="calendarExportCsvBtn">Export CSV</button>
            <div class="calendar-view-toggle" role="group" aria-label="View">
              <button type="button" class="btn btn-icon ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}" id="calendarViewList" title="List view" aria-label="List view"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
              <button type="button" class="btn btn-icon ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}" id="calendarViewCalendar" title="Calendar view" aria-label="Calendar view"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>
            </div>
          </div>
          <div id="calendarContent">${contentHtml}</div>
        </section>
        ${todoSectionHtml}`;

      main.querySelector('#calendarScopeFilter')?.addEventListener('change', (e) => {
        scopeFilter = e.target.value || 'all';
        if (scopeFilter === 'campaign' && campaigns.length) selectedCampaignId = selectedCampaignId != null ? selectedCampaignId : (campaigns[0] && campaigns[0].id);
        else if (scopeFilter === 'campaign') selectedCampaignId = null;
        if (scopeFilter === 'page' && pages.length) selectedProjectId = selectedProjectId != null ? selectedProjectId : (pages[0] && pages[0].id);
        else if (scopeFilter === 'page') selectedProjectId = null;
        if (scopeFilter !== 'campaign') selectedCampaignId = null;
        if (scopeFilter !== 'page') selectedProjectId = null;
        selectedDay = null;
        render();
      });
      const pickerTrigger = main.querySelector('#calendarCampaignPickerTrigger');
      const pickerDropdown = main.querySelector('#calendarCampaignPickerDropdown');
      if (pickerTrigger && pickerDropdown) {
        pickerTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = !pickerDropdown.hidden;
          pickerDropdown.hidden = isOpen;
          pickerTrigger.setAttribute('aria-expanded', !isOpen);
          if (!isOpen) {
            setTimeout(() => {
              const closeHandler = (ev) => {
                const dd = document.getElementById('calendarCampaignPickerDropdown');
                const picker = document.getElementById('calendarCampaignPicker');
                if (dd && picker && !picker.contains(ev.target)) {
                  dd.hidden = true;
                  pickerTrigger.setAttribute('aria-expanded', 'false');
                  document.removeEventListener('click', closeHandler);
                }
              };
              document.addEventListener('click', closeHandler);
            }, 0);
          }
        });
        main.querySelector('#calendarCampaignPickerDropdown')?.querySelectorAll('.calendar-campaign-picker-item[data-campaign-id]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.campaignId;
            selectedCampaignId = id || null;
            pickerDropdown.hidden = true;
            pickerTrigger.setAttribute('aria-expanded', 'false');
            selectedDay = null;
            render();
          });
        });
      }
      const pagePickerTrigger = main.querySelector('#calendarPagePickerTrigger');
      const pagePickerDropdown = main.querySelector('#calendarPagePickerDropdown');
      if (pagePickerTrigger && pagePickerDropdown) {
        pagePickerTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = !pagePickerDropdown.hidden;
          pagePickerDropdown.hidden = isOpen;
          pagePickerTrigger.setAttribute('aria-expanded', !isOpen);
          if (!isOpen) {
            setTimeout(() => {
              const closeHandler = (ev) => {
                const dd = document.getElementById('calendarPagePickerDropdown');
                const picker = document.getElementById('calendarPagePicker');
                if (dd && picker && !picker.contains(ev.target)) {
                  dd.hidden = true;
                  pagePickerTrigger.setAttribute('aria-expanded', 'false');
                  document.removeEventListener('click', closeHandler);
                }
              };
              document.addEventListener('click', closeHandler);
            }, 0);
          }
        });
        main.querySelector('#calendarPagePickerDropdown')?.querySelectorAll('.calendar-campaign-picker-item[data-page-id]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.pageId;
            selectedProjectId = id || null;
            pagePickerDropdown.hidden = true;
            pagePickerTrigger.setAttribute('aria-expanded', 'false');
            selectedDay = null;
            render();
          });
        });
      }
      main.querySelector('#calendarViewList')?.addEventListener('click', () => {
        history.replaceState(null, '', '#/calendar');
        viewMode = 'list';
        selectedDay = null;
        render();
      });
      main.querySelector('#calendarViewCalendar')?.addEventListener('click', () => {
        history.replaceState(null, '', '#/calendar');
        viewMode = 'calendar';
        selectedDay = null;
        render();
      });
      main.querySelector('#calendarExportCsvBtn')?.addEventListener('click', doExportCsv);
      main.querySelector('#calendarMonthPrev')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1); render(); });
      main.querySelector('#calendarMonthNext')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1); render(); });
      main.querySelector('#calendarDayBack')?.addEventListener('click', () => {
        history.replaceState(null, '', '#/calendar');
        selectedDay = null;
        render();
      });
      main.querySelectorAll('.calendar-item-expandable[data-detail]').forEach((li) => {
        li.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          const detailEl = document.getElementById(li.dataset.detail);
          if (detailEl) detailEl.hidden = !detailEl.hidden;
        });
      });
      main.querySelectorAll('.calendar-cell-day[data-date-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.dateKey;
          if (key && (itemsByDateKey[key] || []).length > 0) {
            history.replaceState(null, '', `#/calendar/${key}`);
            selectedDay = key;
            render();
          }
        });
      });
    }

    if (!allItems.length) {
      const formatTodoDateEmpty = (isoStr) => { if (!isoStr) return ''; const d = new Date(isoStr + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
      const recurringEmptyHtml = recurringTodo.length ? recurringTodo.map((t) => `<li class="calendar-todo-item"><span class="calendar-todo-text"><span class="calendar-todo-page">${escapeHtml(t.pageName || 'Page')}</span> will stop posting on <strong>${escapeHtml(formatTodoDateEmpty(t.stopDate))}</strong>.</span></li>`).join('') : '<li class="calendar-todo-empty">All recurring pages are scheduled.</li>';
      const campaignGapEmptyHtml = campaignGapTodo.length ? campaignGapTodo.map((t) => { const days = t.daysBefore; const dayText = days === 1 ? '1 day' : `${days} days`; return `<li class="calendar-todo-item"><span class="calendar-todo-text"><span class="calendar-todo-page">${escapeHtml(t.pageName || 'Page')}</span> stops posting <strong>${dayText} before the campaign is over</strong>.</span></li>`; }).join('') : '<li class="calendar-todo-empty">No campaign pages missing posts.</li>';
      const emptyTodoSection = `<section class="card calendar-todo-card"><h2>To do</h2><p class="hint">Keep recurring pages scheduled and add posts to campaigns. Lists are ordered by urgency (soonest first).</p><div class="calendar-todo-columns"><div class="calendar-todo-column"><h3 class="calendar-todo-column-title">Recurring pages</h3><ol class="calendar-todo-list calendar-todo-list-numbered">${recurringEmptyHtml}</ol></div><div class="calendar-todo-column"><h3 class="calendar-todo-column-title">Missing posts (campaigns)</h3><ol class="calendar-todo-list calendar-todo-list-numbered">${campaignGapEmptyHtml}</ol></div></div></section>`;
      main.innerHTML = '<section class="card"><h1>Calendar</h1><p class="calendar-total">Total scheduled: <strong>0</strong></p><p class="hint">Upcoming scheduled posts (deployed campaigns only). Set your timezone in Settings to see times in your preferred zone.</p><div class="calendar-actions"><button type="button" class="btn btn-secondary" id="calendarExportCsvBtn">Export CSV</button><div class="calendar-view-toggle" role="group"><button type="button" class="btn btn-icon btn-secondary" id="calendarViewList" title="List view" aria-label="List view"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button><button type="button" class="btn btn-icon btn-secondary" id="calendarViewCalendar" title="Calendar view" aria-label="Calendar view"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></div><p class="empty">No scheduled runs. Deploy campaigns and set times to see them here.</p></section>' + emptyTodoSection;
      main.querySelector('#calendarViewList')?.addEventListener('click', () => {});
      main.querySelector('#calendarViewCalendar')?.addEventListener('click', () => {});
      return;
    }
    render();
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p>Could not load calendar.</p></section>';
  });
}

function render() {
  projectContentMode = false;
  projectContentProjectId = null;
  fromRecurringPages = false;
  updateNavActive();
  const route = getRoute();
  if (route.view === 'dashboard') renderDashboard();
  else if (route.view === 'pages') renderPages();
  else if (route.view === 'recurringPages') renderRecurringPages();
  else if (route.view === 'calendar') renderCalendar();
  else if (route.view === 'logins') renderLogins();
  else if (route.view === 'settings') renderSettings();
  else if (route.view === 'campaigns') renderCampaigns();
  else if (route.view === 'campaignDetail') renderCampaignDetail(route.campaignId);
  else if (route.view === 'trends') renderTrends();
  else if (route.view === 'trendNew') renderTrendNew(route.campaignId);
  else if (route.view === 'trendDetail') renderTrendDetail(route.trendId);
  else if (route.view === 'project') renderProject(route.projectId);
  else if (route.view === 'recurringPageDetail' || route.view === 'recurringPageContentList' || route.view === 'recurringPageContent' || route.view === 'recurringPageContentFolder' || route.view === 'recurringPageContentFolderPhotos' || route.view === 'recurringPageContentFolderVideos') {
    const pid = route.projectId;
    apiRecurringPagesGet().then((recurringIds) => {
      if (!recurringIds || !recurringIds.some((id) => String(id) === String(pid))) {
        window.location.hash = '#/recurring-pages';
        render();
        return;
      }
      fromRecurringPages = true;
      projectContentMode = true;
      projectContentProjectId = pid;
      apiCampaigns(pid).then((campaigns) => {
        let recurring = Array.isArray(campaigns) ? campaigns.find((c) => c.name === 'Recurring posts') : null;
        if (!recurring) {
          apiCreateCampaign(pid, 'Recurring posts', { isPageNative: true }).then((c) => {
            recurring = c;
            runRecurringPageContentRoute(route, pid, recurring.id);
          }).catch(() => {
            window.location.hash = '#/recurring-pages';
            render();
          });
        } else {
          runRecurringPageContentRoute(route, pid, recurring.id);
        }
      }).catch(() => {
        window.location.hash = '#/recurring-pages';
        render();
      });
    }).catch(() => {
      window.location.hash = '#/recurring-pages';
      render();
    });
  }
  else if (route.view === 'projectContentList' || route.view === 'projectContent' || route.view === 'projectContentFolder' || route.view === 'projectContentFolderPhotos' || route.view === 'projectContentFolderVideos') {
    const pid = route.projectId;
    const ptId = route.postTypeId;
    apiCampaigns(pid).then((campaigns) => {
      const recurring = Array.isArray(campaigns) ? campaigns.find((c) => c.name === 'Recurring posts') : null;
      if (!recurring) {
        window.location.hash = `#/project/${pid}`;
        render();
        return;
      }
      projectContentMode = true;
      projectContentProjectId = pid;
      if (route.view === 'projectContentFolder') renderCampaignFolderText(pid, recurring.id, route.folderNum, ptId);
      else if (route.view === 'projectContentFolderPhotos') renderCampaignFolderPhotos(pid, recurring.id, route.folderNum, ptId);
      else if (route.view === 'projectContentFolderVideos') renderCampaignFolderVideos(pid, recurring.id, route.folderNum, ptId);
      else if (route.view === 'projectContentList') renderCampaign(pid, recurring.id, null);
      else renderCampaign(pid, recurring.id, ptId);
    }).catch(() => {
      window.location.hash = `#/project/${pid}`;
      render();
    });
  }
  else if (route.view === 'campaign') renderCampaign(route.projectId, route.campaignId, route.postTypeId);
  else if (route.view === 'campaignFolder') renderCampaignFolderText(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
  else if (route.view === 'campaignFolderPhotos') renderCampaignFolderPhotos(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
  else if (route.view === 'campaignFolderVideos') renderCampaignFolderVideos(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
}

// --- Settings page (full page, not modal) ---
async function populateSettingsPage(main) {
  if (!main) return;
  try {
    const [c, userSettings] = await Promise.all([apiConfig(), apiUserSettings().catch(() => ({}))]);
    const blotatoInput = main.querySelector('#settingsBlotatoApiKey');
    if (blotatoInput) blotatoInput.value = userSettings.blotatoApiKey || c.blotatoApiKey || '';
    const tzSelect = main.querySelector('#settingsTimezoneSelect');
    if (tzSelect) {
      const serverTz = c.timezone || 'America/New_York';
      const current = getCalendarDisplayTimezone(serverTz);
      tzSelect.innerHTML = CALENDAR_TIMEZONES.map((z) => `<option value="${escapeHtml(z.id)}" ${z.id === current ? 'selected' : ''}>${escapeHtml(z.label)}</option>`).join('');
    }
    const presetsListEl = main.querySelector('#settingsPresetsList');
    if (presetsListEl) {
      try {
        const presets = await apiTextPresets();
        presetsListEl.innerHTML = Array.isArray(presets) && presets.length
          ? presets.map((p) => `<li class="settings-presets-item"><span>${escapeHtml(p.name || p.id)}</span> <button type="button" class="btn btn-ghost btn-sm" data-delete-preset="${escapeHtml(p.id)}" aria-label="Delete">Delete</button></li>`).join('')
          : '<li class="hint">No presets yet. Add a video file above.</li>';
      } catch (_) {
        presetsListEl.innerHTML = '<li class="hint">Could not load presets.</li>';
      }
    }
    const presetErr = main.querySelector('#settingsPresetError');
    if (presetErr) presetErr.hidden = true;
    const usernameEl = main.querySelector('#settingsUsername');
    const teamListEl = main.querySelector('#settingsTeamList');
    const teamErrorEl = main.querySelector('#settingsTeamError');
    const profileSection = main.querySelector('#settingsProfileSection');
    const teamSection = main.querySelector('#settingsTeamSection');
    if (profileSection) profileSection.hidden = !supabaseClient;
    if (teamSection) teamSection.hidden = !supabaseClient;
    if (teamErrorEl) teamErrorEl.hidden = true;
    const usernameEditWrap = main.querySelector('#settingsUsernameEditWrap');
    const settingsUsernameInput = main.querySelector('#settingsUsernameInput');
    const settingsUsernameError = main.querySelector('#settingsUsernameError');
    if (usernameEditWrap) usernameEditWrap.hidden = true;
    if (settingsUsernameError) settingsUsernameError.hidden = true;
    if (supabaseClient && usernameEl) {
      const { data: profile } = await supabaseClient.from('profiles').select('username').maybeSingle();
      usernameEl.textContent = profile?.username || '—';
      if (settingsUsernameInput) settingsUsernameInput.value = profile?.username || '';
    }
    if (teamListEl && supabaseClient) {
      teamListEl.innerHTML = '';
      try {
        const team = await apiTeam();
        team.forEach((m) => {
          const li = document.createElement('li');
          li.className = 'settings-team-item';
          li.innerHTML = `<span>${escapeHtml(m.username)}</span> <button type="button" class="btn btn-ghost btn-sm" data-remove-team="${m.id}" aria-label="Remove">Remove</button>`;
          teamListEl.appendChild(li);
        });
      } catch (_) {
        teamListEl.innerHTML = '<li class="hint">Could not load team.</li>';
      }
    }
  } catch (_) {}
}

function renderSettings() {
  setBreadcrumb({ view: 'settings' });
  const main = document.getElementById('main');
  main.innerHTML = `
    <section class="card">
      <p class="back-link-wrap"><a href="#/" class="nav-link">← Back to Home</a></p>
      <h1>Settings</h1>
      <div id="settingsProfileSection" class="settings-section">
        <h3 class="settings-subtitle">Your username</h3>
        <div class="settings-username-row">
          <span id="settingsUsername" class="settings-username"></span>
          <button type="button" class="btn btn-secondary btn-sm" id="settingsUsernameEdit">Edit</button>
        </div>
        <div id="settingsUsernameEditWrap" class="settings-username-edit-wrap" hidden>
          <input type="text" id="settingsUsernameInput" placeholder="Username" class="settings-team-input" maxlength="50" />
          <div class="settings-username-edit-actions">
            <button type="button" class="btn btn-primary" id="settingsUsernameSave">Save</button>
            <button type="button" class="btn btn-ghost" id="settingsUsernameCancel">Cancel</button>
          </div>
          <p id="settingsUsernameError" class="auth-error" hidden></p>
        </div>
        <p class="hint">Share this username so others can add you as a team member or to a campaign.</p>
      </div>
      <div id="settingsTeamSection" class="settings-section">
        <h3 class="settings-subtitle">Team members</h3>
        <p class="hint">Add people by their username to give them access to your account.</p>
        <div class="settings-team-add">
          <input type="text" id="settingsTeamUsername" placeholder="Username" class="settings-team-input" />
          <button type="button" class="btn btn-secondary" id="settingsTeamAddBtn">Add</button>
        </div>
        <p id="settingsTeamError" class="auth-error" hidden></p>
        <ul id="settingsTeamList" class="settings-team-list"></ul>
      </div>
      <div class="settings-section" id="settingsTextPresetsSection">
        <h3 class="settings-subtitle">Text presets (lyric overlays)</h3>
        <p class="hint">Upload short video clips with moving text (e.g. from CapCut). They can be applied on top of videos in post types for lyric-style content. Use MP4/MOV with transparency for best results.</p>
        <div class="settings-presets-add">
          <input type="text" id="settingsPresetName" placeholder="Preset name" class="settings-team-input" maxlength="80" />
          <input type="file" id="settingsPresetFile" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" style="max-width:220px;" />
          <button type="button" class="btn btn-secondary" id="settingsPresetAddBtn">Add preset</button>
        </div>
        <p id="settingsPresetError" class="auth-error" hidden></p>
        <ul id="settingsPresetsList" class="settings-presets-list"></ul>
      </div>
      <div class="settings-section">
        <h3 class="settings-subtitle">Display timezone</h3>
        <label class="field">
          <span>Timezone for calendar and schedule times</span>
          <select id="settingsTimezoneSelect" class="field-select" style="min-width:100%;max-width:320px;"></select>
        </label>
        <p class="hint">Calendar and campaign schedule times will be shown in this timezone.</p>
      </div>
      <div class="settings-section">
        <h3 class="settings-subtitle">Blotato</h3>
        <label class="field">
          <span>Blotato API Key</span>
          <input type="password" id="settingsBlotatoApiKey" placeholder="Your Blotato API key" autocomplete="off" />
        </label>
        <p class="hint">Required for auto-posting to TikTok. Get it from your Blotato dashboard.</p>
      </div>
      <div class="settings-page-actions">
        <button type="button" class="btn btn-primary" id="saveSettings">Save</button>
      </div>
    </section>
  `;
  populateSettingsPage(main);

  main.querySelector('#settingsUsernameEdit')?.addEventListener('click', () => {
    const wrap = main.querySelector('#settingsUsernameEditWrap');
    const display = main.querySelector('#settingsUsername');
    const input = main.querySelector('#settingsUsernameInput');
    const errEl = main.querySelector('#settingsUsernameError');
    if (wrap && input) {
      if (errEl) errEl.hidden = true;
      input.value = (display?.textContent || '').trim();
      wrap.hidden = false;
      input.focus();
    }
  });
  main.querySelector('#settingsUsernameCancel')?.addEventListener('click', () => {
    const wrap = main.querySelector('#settingsUsernameEditWrap');
    const errEl = main.querySelector('#settingsUsernameError');
    if (wrap) wrap.hidden = true;
    if (errEl) errEl.hidden = true;
  });
  main.querySelector('#settingsUsernameSave')?.addEventListener('click', async () => {
    const input = main.querySelector('#settingsUsernameInput');
    const display = main.querySelector('#settingsUsername');
    const wrap = main.querySelector('#settingsUsernameEditWrap');
    const errEl = main.querySelector('#settingsUsernameError');
    if (!supabaseClient || !input || !display || !wrap) return;
    const raw = (input.value || '').trim();
    const username = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!username) {
      if (errEl) { errEl.textContent = 'Username is required (letters, numbers, underscore).'; errEl.hidden = false; }
      return;
    }
    if (username.length < 2) {
      if (errEl) { errEl.textContent = 'Username must be at least 2 characters.'; errEl.hidden = false; }
      return;
    }
    if (errEl) errEl.hidden = true;
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabaseClient.from('profiles').update({ username, updated_at: new Date().toISOString() }).eq('id', user.id).select('username').maybeSingle();
      if (error) throw error;
      if (display) display.textContent = (data && data.username) ? data.username : username;
      wrap.hidden = true;
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message?.includes('unique') || err.code === '23505' ? 'That username is already taken.' : (err.message || 'Failed to update username');
        errEl.hidden = false;
      }
    }
  });
  main.querySelector('#settingsTeamAddBtn')?.addEventListener('click', async () => {
    const input = main.querySelector('#settingsTeamUsername');
    const errEl = main.querySelector('#settingsTeamError');
    if (!input || !errEl) return;
    const username = input.value.trim();
    if (!username) return;
    errEl.hidden = true;
    try {
      await apiTeamAdd(username);
      input.value = '';
      populateSettingsPage(main);
    } catch (err) {
      errEl.textContent = err.message || 'Failed to add';
      errEl.hidden = false;
    }
  });
  main.querySelector('#saveSettings')?.addEventListener('click', () => {
    const tzSelect = main.querySelector('#settingsTimezoneSelect');
    if (tzSelect) try { localStorage.setItem(CALENDAR_TZ_STORAGE_KEY, tzSelect.value); } catch (_) {}
    const blotatoInput = main.querySelector('#settingsBlotatoApiKey');
    const blotatoApiKey = (blotatoInput && blotatoInput.value.trim()) || '';
    apiSaveUserSettings({ blotatoApiKey }).then(() => {
      const btn = main.querySelector('#saveSettings');
      if (btn) { btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save'; }, 2000); }
    }).catch(() => {});
  });
  main.addEventListener('click', async (e) => {
    if (e.target.dataset.removeTeam) {
      const userId = e.target.dataset.removeTeam;
      const errEl = main.querySelector('#settingsTeamError');
      if (errEl) errEl.hidden = true;
      try {
        await apiTeamRemove(userId);
        populateSettingsPage(main);
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to remove'; errEl.hidden = false; }
      }
      return;
    }
    if (e.target.dataset.deletePreset) {
      const id = e.target.dataset.deletePreset;
      const errEl = main.querySelector('#settingsPresetError');
      if (errEl) errEl.hidden = true;
      apiDeleteTextPreset(id).then(() => populateSettingsPage(main)).catch((err) => {
        const el = main.querySelector('#settingsPresetError');
        if (el) { el.textContent = err.message || 'Failed to delete'; el.hidden = false; }
      });
    }
  });
  main.querySelector('#settingsPresetAddBtn')?.addEventListener('click', async () => {
    const nameInput = main.querySelector('#settingsPresetName');
    const fileInput = main.querySelector('#settingsPresetFile');
    const errEl = main.querySelector('#settingsPresetError');
    if (!nameInput || !fileInput || !errEl) return;
    const name = (nameInput.value || '').trim() || 'Text preset';
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      errEl.textContent = 'Choose a video file (MP4, MOV, or WebM).';
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    try {
      await apiCreateTextPreset(name, file);
      nameInput.value = '';
      fileInput.value = '';
      populateSettingsPage(main);
    } catch (err) {
      errEl.textContent = err.message || 'Upload failed';
      errEl.hidden = false;
    }
  });
}

// --- Logout ---
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
    checkAuthAndRender();
  }
});

// --- Waffle menu ---
(function () {
  const btn = document.getElementById('navWaffleBtn');
  const popup = document.getElementById('wafflePopup');
  if (!btn || !popup) return;
  function closeWaffle() {
    popup.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  function openWaffle() {
    popup.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function toggleWaffle() {
    if (popup.hidden) openWaffle(); else closeWaffle();
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWaffle();
  });
  document.addEventListener('click', (e) => {
    if (!popup.hidden && !popup.contains(e.target) && !btn.contains(e.target)) closeWaffle();
  });
  window.addEventListener('hashchange', closeWaffle);
  popup.querySelectorAll('.waffle-popup-item').forEach((link) => {
    link.addEventListener('click', () => { closeWaffle(); });
  });
})();

// --- Init ---
async function init() {
  const supabase = await initAuth();
  if (supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        showAuthView();
        setupAuthForms();
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const addPostTypeModal = document.getElementById('addPostTypeModal');
        if (addPostTypeModal && !addPostTypeModal.hidden) return;
        showAppView();
        render();
      }
    });
  }
  await checkAuthAndRender();
}

window.addEventListener('hashchange', () => {
  const appShell = document.getElementById('appShell');
  if (appShell && appShell.hidden) return;
  const hash = (window.location.hash || '#/').replace(/^#\/?/, '') || '';
  if (hash === 'login' && supabaseClient) {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.hash = '#/';
        showAppView();
        render();
      }
    });
    return;
  }
  render();
});

document.addEventListener('click', (e) => {
  const newTrendBtn = e.target.closest('[data-action="campaign-new-trend"]');
  if (newTrendBtn) {
    e.preventDefault();
    e.stopPropagation();
    const cid = newTrendBtn.getAttribute('data-campaign-id');
    let pageIds = [];
    try {
      const raw = newTrendBtn.getAttribute('data-page-ids');
      if (raw) pageIds = JSON.parse(raw);
    } catch (_) {}
    if (!cid) { showAlert('Missing campaign'); return; }
    apiCreateTrend('New trend', Array.isArray(pageIds) ? pageIds : [], cid)
      .then((t) => {
        if (!t || t.id == null) {
          showAlert(t && t.error ? t.error : 'Failed to create trend');
          return;
        }
        return renderCampaignDetail(cid).then(() => {
          window.location.hash = '#/trends/' + t.id;
          render();
        });
      })
      .catch((err) => showAlert(err && err.message ? err.message : 'Failed to create trend'));
    return;
  }
  if (e.target.closest('.campaign-page-remove') || e.target.closest('.campaign-page-ugc-select')) return;
  const link = e.target.closest('.campaign-pages-grid a.campaign-page-card');
  if (!link) return;
  e.preventDefault();
  e.stopPropagation();
  const href = link.getAttribute('href') || link.href || '';
  const hash = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : (href ? '#' + href : '');
  if (hash) {
    window.location.hash = hash;
    render();
  }
}, true);

function bindAuthTabClicks() {
  const authView = document.getElementById('authView');
  if (!authView) return;
  authView.addEventListener('click', (e) => {
    const tab = e.target.closest('.auth-tab');
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    authSwitchTab(tab.dataset.tab === 'login');
  }, true);
}

document.addEventListener('submit', (e) => {
  if (e.target.id === 'authLoginForm') {
    e.preventDefault();
    handleAuthLogin(e);
    return;
  }
  if (e.target.id === 'authSignupForm') {
    e.preventDefault();
    handleAuthSignup(e);
    return;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  bindAuthTabClicks();
  init();
});

// staging test comment