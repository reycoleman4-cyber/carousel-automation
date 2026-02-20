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
    const { error } = await supabaseClient.auth.signUp({ email, password });
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

// --- API ---
function apiProjects() {
  return apiWithAuth(`${API}/api/projects`).then((r) => r.json());
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
  }).then((r) => r.json());
}
function apiUpdateProject(id, data) {
  return apiWithAuth(`${API}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiDeleteProject(id) {
  return apiWithAuth(`${API}/api/projects/${id}`, { method: 'DELETE' }).then((r) => r.json());
}
function apiCampaigns(projectId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns`).then((r) => r.json());
}
function apiCreateCampaign(projectId, name) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || 'New campaign' }),
  }).then((r) => r.json());
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
  }).then((r) => r.json());
}
function apiDeleteCampaign(projectId, campaignId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}`, { method: 'DELETE' }).then((r) => r.json());
}
function apiDeleteCampaignById(campaignId) {
  return apiWithAuth(`${API}/api/campaigns/${campaignId}`, { method: 'DELETE' }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || text || 'Failed to delete campaign');
    return text ? JSON.parse(text) : {};
  });
}
function apiCampaignFolders(projectId, campaignId, postTypeId) {
  const url = postTypeId ? `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders?postTypeId=${encodeURIComponent(postTypeId)}` : `${API}/api/projects/${projectId}/campaigns/${campaignId}/folders`;
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
  return `${API}/api/projects/${projectId}/avatar?t=${Date.now()}`;
}
function apiCampaignUpload(projectId, campaignId, folderNum, files, postTypeId, mediaType) {
  const form = new FormData();
  const isVideo = mediaType === 'video' || mediaType === 'video_text';
  for (const file of Array.from(files)) {
    if (isVideo && file.type.startsWith('video/')) form.append('photo', file);
    else if (!isVideo && file.type.startsWith('image/')) form.append('photo', file);
  }
  let url = `${API}/api/projects/${projectId}/campaigns/${campaignId}/upload?folder=${folderNum}`;
  if (postTypeId) url += `&postTypeId=${encodeURIComponent(postTypeId)}`;
  if (mediaType === 'video') url += `&mediaType=video`;
  if (mediaType === 'video_text') url += `&mediaType=video_text`;
  return apiWithAuth(url, {
    method: 'POST',
    body: form,
  }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(tryParse(text).error || text || 'Upload failed');
    return text ? JSON.parse(text) : {};
  });
}
function apiCampaignRun(projectId, campaignId, textStylePerFolder, textOptionsPerFolder, sendAsDraft, postTypeId) {
  const body = {};
  if (postTypeId) body.postTypeId = postTypeId;
  if (Array.isArray(textStylePerFolder) && textStylePerFolder.length) body.textStylePerFolder = textStylePerFolder;
  if (Array.isArray(textOptionsPerFolder) && textOptionsPerFolder.length) body.textOptionsPerFolder = textOptionsPerFolder;
  if (sendAsDraft === true) body.sendAsDraft = true;
  return apiWithAuth(`${API}/api/projects/${projectId}/campaigns/${campaignId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
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
function apiProjectUsed(projectId) {
  return apiWithAuth(`${API}/api/projects/${projectId}/used`).then((r) => r.json());
}
function projectUsedImageUrl(projectId, filename) {
  return `${API}/api/projects/${projectId}/used/images/${encodeURIComponent(filename)}`;
}
function apiAllCampaigns() {
  return apiWithAuth(`${API}/api/campaigns`).then((r) => r.json());
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
  return `${API}/api/campaigns/${campaignId}/avatar?t=${Date.now()}`;
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
function apiLogins() {
  return fetch(`${API}/api/logins`).then((r) => r.json());
}
function apiCreateLogin(data) {
  return fetch(`${API}/api/logins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiUpdateLogin(id, data) {
  return fetch(`${API}/api/logins/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}
function apiDeleteLogin(id) {
  return fetch(`${API}/api/logins/${id}`, { method: 'DELETE' }).then((r) => {
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
  const pages = document.getElementById('navPages');
  const campaigns = document.getElementById('navCampaigns');
  const calendar = document.getElementById('navCalendar');
  const logins = document.getElementById('navLogins');
  const settings = document.getElementById('openSettings');
  const settingsModal = document.getElementById('settingsModal');
  [pages, campaigns, calendar, logins].forEach((el) => { if (el) el.classList.remove('active'); });
  if (settings) settings.classList.remove('active');
  if (settingsModal && !settingsModal.hidden && settings) {
    settings.classList.add('active');
  } else if (first === '' || first === 'project') {
    if (pages) pages.classList.add('active');
  } else if (first === 'campaigns' || first === 'campaign') {
    if (campaigns) campaigns.classList.add('active');
  } else if (first === 'calendar') {
    if (calendar) calendar.classList.add('active');
  } else if (first === 'logins') {
    if (logins) logins.classList.add('active');
  }
}

function getRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'calendar') return { view: 'calendar' };
  if (parts[0] === 'logins') return { view: 'logins' };
  if (parts[0] === 'campaigns') {
    if (parts[1]) return { view: 'campaignDetail', campaignId: parts[1] };
    return { view: 'campaigns' };
  }
  if (parts[0] === 'project' && parts[1]) {
    if (parts[2] === 'used') return { view: 'projectUsed', projectId: parts[1] };
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

function setBreadcrumb(route, project, campaign, folderNum) {
  const el = document.getElementById('breadcrumb');
  if (el) el.textContent = '';
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
        const img = p.hasAvatar ? `<img src="${projectAvatarUrl(p.id)}" alt="" />` : `<span class="project-circle-initial">${initial}</span>`;
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
      const name = prompt('Page name (e.g. account handle):', 'New page');
      if (name == null) return;
      apiCreateProject(name.trim()).then((p) => {
        location.hash = `#/project/${p.id}`;
        render();
      });
    };
    main.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Delete this page and all its campaigns?')) return;
        apiDeleteProject(btn.dataset.id).then(() => render());
      };
    });
  });
}

function renderProject(projectId) {
  const pid = projectId;
  Promise.all([apiProject(pid), apiCampaigns(pid)]).then(([project, campaigns]) => {
    if (!project) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/" class="nav-link">← Back to pages</a></p><p>Page not found.</p></section>';
      setBreadcrumb({ view: 'project', projectId: pid }, null, null);
      return;
    }
    setBreadcrumb({ view: 'project', projectId: pid }, project, null);
    const main = document.getElementById('main');
    const avatarImg = project.hasAvatar ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />` : '<span class="project-avatar-placeholder">No photo</span>';
    main.innerHTML = `
      <section class="card project-card">
        <p class="back-link-wrap"><a href="#/" class="nav-link">← Back to pages</a></p>
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
        <div class="field" style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--border);">
          <h2 style="margin:0 0 8px 0;font-size:1.1rem;">Used folder</h2>
          <p class="hint" style="margin-bottom:12px;">Images moved here after being sent to Blotato. Download within 14 days or they will be deleted.</p>
          <a href="#/project/${project.id}/used" class="btn btn-secondary">View used images</a>
        </div>
        <div class="campaign-list" id="campaignList"></div>
        <div class="actions">
          ${(project.pageType || 'recurring') === 'recurring' ? '<button type="button" class="btn btn-primary" id="uploadPostsBtn">Upload posts</button>' : ''}
          <button type="button" class="btn btn-primary" id="joinCampaignBtn">Join campaign</button>
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
        .catch((err) => alert(err.message || 'Failed to save'));
    };
    if (blotatoAccountInput) blotatoAccountInput.onblur = saveBlotatoAccount;
    if (saveBlotatoBtn) saveBlotatoBtn.onclick = saveBlotatoAccount;
    if (avatarBtn && avatarInput) {
      avatarBtn.onclick = (e) => { e.preventDefault(); avatarInput.click(); };
      avatarInput.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        apiUploadProjectAvatar(String(project.id), file).then(() => {
          if (avatarPreview) {
            avatarPreview.innerHTML = `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />`;
            avatarPreview.style.cursor = 'pointer';
            avatarPreview.title = 'Click to edit';
            avatarPreview.onclick = () => openEditAvatarModal('project', project.id, projectAvatarUrl(project.id), () => {
              if (avatarPreview) avatarPreview.innerHTML = `<img src="${projectAvatarUrl(project.id)}" alt="" class="project-avatar-img" />`;
            });
          }
          avatarInput.value = '';
        }).catch((err) => alert(err.message || 'Upload failed'));
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
    if (!campaigns.length) {
      list.innerHTML = '<p class="empty">No campaigns yet. Join a campaign to get started.</p>';
    } else {
      const sorted = [...campaigns].sort((a, b) => {
        const da = a.releaseDate || '';
        const db = b.releaseDate || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
      list.innerHTML = sorted.map((c) => {
        const timesLabel = (c.scheduleTimes || []).map(formatTimeAMPM).filter(Boolean).join(', ') || '—';
        const releaseLabel = c.releaseDate ? `Release: ${formatReleaseDate(c.releaseDate)}` : '';
        const campAvatar = `<div class="list-card-avatar campaign-avatar campaign-avatar-square"><img src="${campaignAvatarUrl(c.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(c.name || 'C').charAt(0).toUpperCase()}</span></div>`;
        return `
        <div class="list-card" data-campaign-id="${c.id}">
          ${campAvatar}
          <div class="list-card-main">
            <a href="#/campaign/${project.id}/${c.id}" class="list-card-title">${escapeHtml(c.name)}</a>
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
    const uploadPostsBtn = document.getElementById('uploadPostsBtn');
    if (uploadPostsBtn) {
      uploadPostsBtn.onclick = () => {
        apiCreateCampaign(project.id, 'Recurring posts').then((campaign) => {
          location.hash = `#/campaign/${project.id}/${campaign.id}`;
          render();
        }).catch((err) => alert(err.message || 'Failed to create'));
      };
    }
    document.getElementById('joinCampaignBtn').onclick = () => {
      apiAllCampaigns().then((all) => {
        const joinable = all.filter((c) => {
          const ids = (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
          return !ids.includes(project.id);
        });
        openJoinCampaignModal(project.id, joinable, () => render());
      }).catch(() => alert('Failed to load campaigns'));
    };
    list.querySelectorAll('[data-action="delete-campaign"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Delete this campaign?')) return;
        apiDeleteCampaign(project.id, btn.dataset.cid).then(() => render());
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
    apiCampaignFolders(projectId, campaignId).then((data) => {
      const list = (data.folders || {})[`folder${folderNum}`] || [];
      photos.innerHTML = list.map((filename) => `
        <div class="folder-modal-photo">
          <img data-src="${folderImageUrl(projectId, campaignId, folderNum, filename)}" alt="" loading="lazy" />
          <button type="button" class="folder-modal-delete" data-filename="${escapeHtml(filename)}">×</button>
        </div>
      `).join('');
      photos.querySelectorAll('img[data-src]').forEach((img) => {
        withAuthQuery(img.dataset.src).then((url) => { img.src = url; img.removeAttribute('data-src'); });
      });
      photos.querySelectorAll('.folder-modal-delete').forEach((btn) => {
        btn.onclick = () => {
          apiDeleteFolderImage(projectId, campaignId, folderNum, btn.dataset.filename).then(refresh).catch(() => alert('Delete failed'));
        };
      });
    });
  }
  refresh();

  addBtn.onclick = () => addInput.click();
  addInput.onchange = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    apiCampaignUpload(projectId, campaignId, folderNum, files).then(() => { refresh(); if (onClose) onClose(); }).catch(() => alert('Upload failed'));
    addInput.value = '';
  };

  function close() {
    modal.hidden = true;
    if (onClose) onClose();
  }
  closeBtn.onclick = close;
  modal.onclick = (e) => { if (e.target.id === 'folderModal') close(); };
}

function renderProjectUsed(projectId) {
  const pid = projectId;
  Promise.all([apiProject(pid), apiProjectUsed(pid)]).then(([project, data]) => {
    if (!project) {
      document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/" class="nav-link">← Back to pages</a></p><p>Page not found.</p></section>';
      return;
    }
    setBreadcrumb({ view: 'projectUsed', projectId: pid }, project, null);
    const main = document.getElementById('main');
    const items = data.items || [];
    main.innerHTML = `
      <section class="card">
        <p class="back-link-wrap"><a href="#/project/${pid}" class="nav-link">← Back to ${escapeHtml(project.name)}</a></p>
        <h1>Used images</h1>
        <p class="hint">Images moved here after being sent to Blotato. Download within 14 days or they will be deleted.</p>
        <div id="usedImagesContent">
          ${items.length ? `
            <div class="used-images-grid" id="usedImagesGrid"></div>
          ` : '<p class="empty">No used images yet. Images move here after Blotato posts.</p>'}
        </div>
      </section>
    `;
    if (items.length) {
      const grid = document.getElementById('usedImagesGrid');
      if (grid) {
        grid.innerHTML = items.map((it) => {
          const exp = new Date(it.expiresAt);
          const daysLeft = Math.max(0, Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000)));
          const imgUrl = projectUsedImageUrl(pid, it.filename);
          return `
            <div class="used-image-card" style="background:var(--surface);border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border);">
              <div style="aspect-ratio:9/16;overflow:hidden;">
                <img data-src="${imgUrl}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
              </div>
              <div style="padding:10px;font-size:12px;color:var(--text-muted);">Campaign ${it.campaignId} · Folder ${it.folderNum} · ${daysLeft}d left</div>
              <a href="#" data-href="${imgUrl}" data-download="${escapeHtml(it.originalName)}" class="btn btn-secondary" style="margin:0 10px 10px;">Save to Finder</a>
            </div>
          `;
        }).join('');
        grid.querySelectorAll('img[data-src]').forEach((img) => {
          withAuthQuery(img.dataset.src).then((url) => { img.src = url; img.removeAttribute('data-src'); });
        });
        grid.querySelectorAll('a[data-href]').forEach((a) => {
          withAuthQuery(a.dataset.href).then((url) => { a.href = url; a.download = a.dataset.download || ''; a.removeAttribute('data-href'); a.removeAttribute('data-download'); });
        });
      }
    }
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p class="back-link-wrap"><a href="#/" class="nav-link">← Back to pages</a></p><p>Could not load used images.</p></section>';
  });
}

function renderMediaTypeSelector(pid, cid, ptId, project, campaign) {
  const main = document.getElementById('main');
  main.innerHTML = `
    <section class="card campaign-section">
      <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}" class="nav-link">← Back to post types</a></p>
      <h1>${escapeHtml(campaign.name)}</h1>
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
    if (!val) { alert('Please select a media type'); return; }
    apiUpdatePostType(pid, cid, ptId, { mediaType: val }).then(() => render()).catch((err) => alert(err.message || 'Failed'));
  };
}

function renderCampaignVideo(pid, cid, ptId, project, campaign, foldersData, latest) {
  let campaignData = campaign;
  const folders = foldersData.folders || {};
  const folderCount = 2;
  const times = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
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
      <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}" class="nav-link">← Back to post types</a></p>
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
          </div>
        </div>
        <div class="campaign-page-header-right">
          <label class="deploy-toggle"><input type="checkbox" id="deployed" ${campaign.deployed ? 'checked' : ''} /><span>Deployed</span></label>
        </div>
      </div>
    </section>
    <section class="card">
      <h2>Video folders</h2>
      <p class="hint">Add videos to Priority (used first) or Fallback (used when Priority is empty). One video is picked per run and published via Blotato.</p>
      <div class="folders" id="foldersContainer">${videoFolders}</div>
    </section>
    <section class="card">
      <h2>Schedule</h2>
      <p class="hint">How often videos will be posted (if deployed).</p>
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
      <h2>Run now & webContentUrls</h2>
      <p class="hint">Run once to pick a video and generate its URL. The video is published via Blotato.</p>
      <label class="checkbox-field" style="margin-bottom:12px;"><input type="checkbox" id="sendAsDraft" ${campaign.sendAsDraft ? 'checked' : ''} /><span>Send to Blotato as draft</span></label>
      <p class="hint" style="margin-top:-8px;margin-bottom:12px;">When checked, the post goes to TikTok drafts (mobile app) instead of publishing immediately.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="runNow">Run now</button>
        <button type="button" class="btn btn-secondary" id="clearUrlsBtn">Clear URLs</button>
      </div>
      <div class="run-status" id="runStatus"></div>
      <div class="urls-wrap" id="urlsWrap">
        <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run once to see URLs.'}</div>
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
      }
    });
  }
  for (let num = 1; num <= 2; num++) {
    const dropzone = document.getElementById(`dropzone${num}`);
    const input = document.getElementById(`input${num}`);
    const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
    const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
    if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}/videos/${num}`; };
    if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
    if (dropzone && input) {
      dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
      dropzone.ondragleave = () => dropzone.classList.remove('dragover');
      dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); const files = e.dataTransfer.files; if (files?.length) apiCampaignUpload(pid, cid, num, files, ptId, 'video').then(updateFolderCounts).catch((err) => alert(err.message || 'Upload failed')); };
    }
    if (input) input.onchange = (e) => { const files = e.target.files; if (files?.length) apiCampaignUpload(pid, cid, num, files, ptId, 'video').then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => alert(err.message || 'Upload failed')); };
  }
  document.getElementById('deployed').onchange = (e) => apiUpdateCampaign(pid, cid, { ...campaignData, deployed: e.target.checked }, ptId).then((c) => { campaignData = c; });
  const postTypeHeaderEl = document.getElementById('postTypeHeader');
  if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
    const pt = (campaignData.postTypes || []).find((p) => p.id === ptId);
    const current = pt ? pt.name : ptId;
    const name = prompt('Post type label:', current);
    if (name != null && name.trim()) {
      apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => {
        campaignData = c;
        if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim();
      }).catch((err) => alert(err.message || 'Failed'));
    }
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
    const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00');
    const daysChecked = Array.from(document.querySelectorAll('.schedule-day:checked')).map((cb) => parseInt(cb.dataset.day, 10));
    apiUpdateCampaign(pid, cid, { ...campaignData, scheduleEnabled: document.getElementById('scheduleEnabled').checked, scheduleTimes: timesArr, scheduleStartDate: document.getElementById('scheduleStartDate')?.value || null, scheduleEndDate: document.getElementById('scheduleEndDate')?.value || null, scheduleDaysOfWeek: daysChecked }, ptId).then((c) => { campaignData = c; });
    const status = document.getElementById('runStatus');
    status.textContent = 'Campaign saved.';
    status.className = 'run-status success';
    setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000);
  };
  document.getElementById('clearUrlsBtn').onclick = () => {
    if (!confirm('Clear all generated URLs?')) return;
    apiClearCampaignUrls(pid, cid).then(() => {
      document.getElementById('urlsPlaceholder').style.display = 'block';
      document.getElementById('urlsPlaceholder').textContent = 'Run once to see URLs.';
      document.getElementById('urlsList').innerHTML = '';
      document.getElementById('copyAllUrls').style.display = 'none';
    });
  };
  function showUrls(urls, base64Images = []) {
    const placeholder = document.getElementById('urlsPlaceholder');
    const list = document.getElementById('urlsList');
    const copyAllBtn = document.getElementById('copyAllUrls');
    if (!urls.length) { placeholder.style.display = 'block'; placeholder.textContent = 'Run once to see URLs.'; list.innerHTML = ''; copyAllBtn.style.display = 'none'; return; }
    placeholder.style.display = 'none';
    copyAllBtn.style.display = 'inline-block';
    list.innerHTML = urls.map((url) => `<li class="url-item"><span class="url-text">${escapeHtml(url)}</span><button type="button" class="btn btn-secondary btn-copy-url">Copy</button></li>`).join('');
    list.querySelectorAll('.btn-copy-url').forEach((btn, i) => { btn.onclick = () => { navigator.clipboard.writeText(urls[i]); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }; });
    copyAllBtn.onclick = () => { navigator.clipboard.writeText(urls.join('\n')); copyAllBtn.textContent = 'Copied!'; setTimeout(() => { copyAllBtn.textContent = 'Copy all URLs'; }, 1500); };
  }
  document.getElementById('runNow').onclick = () => {
    const status = document.getElementById('runStatus');
    status.textContent = 'Running…';
    status.className = 'run-status loading';
    const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
    apiUpdateCampaign(pid, cid, { ...campaignData, sendAsDraft }, ptId).then((c) => { campaignData = c; return apiCampaignRun(pid, cid, null, null, sendAsDraft, ptId); })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        let msg = `Done. ${(data.webContentUrls || []).length} URL(s) generated.`;
        if (data.blotatoSent) msg += data.blotatoSentAsDraft ? ' Sent to Blotato as draft.' : ' Sent to Blotato.';
        else if (data.blotatoError) msg += ` Blotato: ${data.blotatoError}`;
        status.textContent = msg;
        status.className = 'run-status success';
        showUrls(data.webContentUrls || [], data.webContentBase64 || []);
      })
      .catch((err) => { status.textContent = err.message || 'Run failed'; status.className = 'run-status error'; });
  };
  if ((latest.webContentUrls || []).length) showUrls(latest.webContentUrls, latest.webContentBase64 || []);
}

function renderCampaignVideoWithText(pid, cid, ptId, project, campaign, foldersData, latest) {
  let campaignData = campaign;
  const folders = foldersData.folders || {};
  const folderCount = 1;
  const textOptionsPerFolder = campaign.textOptionsPerFolder || [[]];
  const times = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
  const scheduleStart = campaign.scheduleStartDate || '';
  const scheduleEnd = campaign.scheduleEndDate || '';
  const daysOfWeek = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const list = folders.folder1 || [];
  const count = list.length;
  const ts = (campaign.textStylePerFolder && campaign.textStylePerFolder[0]) || campaign.textStyle || {};
  const campaignAvatarSection = `<div class="campaign-header-avatar-inner" id="campaignHeaderAvatarInner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div><input type="file" accept="image/*" id="campaignAvatarInput" hidden />`;
  const pageIndicator = project.hasAvatar ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />` : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
  const main = document.getElementById('main');
  main.innerHTML = `
    <section class="card campaign-section campaign-page-card">
      <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}" class="nav-link">← Back to post types</a></p>
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
              <input type="checkbox" id="deployed" ${(campaign.deployedByPage && campaign.deployedByPage[pid]) || campaign.deployed ? 'checked' : ''} />
              <span>Deployed</span>
            </label>
          </div>
        </div>
        <div class="campaign-page-header-right"></div>
      </div>
    </section>
    <section class="card">
      <h2>Videos folder</h2>
      <p class="hint">Upload videos here. One video is picked at random per run and combined with one random text option.</p>
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
    <section class="card">
      <h2>On-screen text options</h2>
      <p class="hint">One line is chosen at random per run and overlaid on the video.</p>
      <a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}/folder/1" class="btn btn-secondary btn-folder-text">Edit on-screen text options</a>
    </section>
    <section class="card">
      <h2>Text styling</h2>
      <p class="hint">Position and style of the overlay text. Preview runs the full pipeline (picks a random video + text) so you can see the result.</p>
      <div class="text-style-folders">
        <div class="text-style-folder-card text-style-folder-card-live" data-folder="1">
          <h4 class="text-style-folder-title">Text overlay</h4>
          <div class="text-style-folder-row">
            <div class="text-style-settings-panel" data-folder="1">
              <div class="text-style-grid">
                <label class="field"><span>X (%)</span><input type="number" data-folder="1" data-field="x" value="${(ts.x ?? 50)}" min="0" max="100" title="0 = center" /></label>
                <label class="field"><span>Y (%)</span><input type="number" data-folder="1" data-field="y" value="${(ts.y ?? 92)}" min="0" max="100" title="0 = center" /></label>
                <label class="field"><span>Size (%)</span><input type="number" data-folder="1" data-field="size" value="${((ts.fontSize ?? 0.06) * 100)}" min="1" max="100" step="0.5" /></label>
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
      <button type="button" class="btn btn-secondary" id="saveTextStyle">Save text styles</button>
    </section>
    <section class="card">
      <h2>Schedule</h2>
      <p class="hint">When this campaign runs (if deployed).</p>
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
      <h2>Run now & webContentUrls</h2>
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
        <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run once to see URLs.'}</div>
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
    });
  }

  const dropzone = document.getElementById('dropzone1');
  const input = document.getElementById('input1');
  const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
  const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
  if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}/videos/1`; };
  if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
  if (dropzone && input) {
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files?.length) apiCampaignUpload(pid, cid, 1, files, ptId, 'video_text').then(updateFolderCounts).catch((err) => alert(err.message || 'Upload failed'));
    };
  }
  if (input) input.onchange = (e) => {
    const files = e.target.files;
    if (files?.length) apiCampaignUpload(pid, cid, 1, files, ptId, 'video_text').then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => alert(err.message || 'Upload failed'));
  };

  document.getElementById('deployed').onchange = (e) => apiUpdateCampaign(pid, cid, { ...campaignData, deployed: e.target.checked }, ptId).then((c) => { campaignData = c; });
  const campaignNameEl = document.getElementById('campaignName');
  if (campaignNameEl) campaignNameEl.ondblclick = () => {
    const name = prompt('Campaign name:', campaignData.name);
    if (name != null && name.trim()) apiUpdateCampaign(pid, cid, { ...campaignData, name: name.trim() }, ptId).then((c) => { campaignData = c; if (campaignNameEl) campaignNameEl.textContent = c.name; });
  };
  const postTypeHeaderEl = document.getElementById('postTypeHeader');
  if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
    const pt = (campaignData.postTypes || []).find((p) => p.id === ptId);
    const name = prompt('Post type label:', pt ? pt.name : ptId);
    if (name != null && name.trim()) apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => { campaignData = c; if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim(); }).catch((err) => alert(err.message || 'Failed'));
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
    const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00');
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

  document.getElementById('saveTextStyle').onclick = () => {
    const get = (field) => { const el = document.querySelector(`[data-folder="1"][data-field="${field}"]`); return el ? el.value : null; };
    const sizeVal = parseFloat(get('size')) ?? 6;
    const textStylePerFolder = [{
      x: parseFloat(get('x')) ?? 50,
      y: parseFloat(get('y')) ?? 92,
      fontSize: sizeVal / 100,
      font: (get('font') || 'Arial, sans-serif').trim(),
      color: (get('color') || 'white').trim(),
      strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
    }];
    apiUpdateCampaign(pid, cid, { ...campaignData, textStylePerFolder }, ptId).then((c) => { campaignData = c; });
    const status = document.getElementById('runStatus');
    if (status) { status.textContent = 'Text styles saved.'; status.className = 'run-status success'; setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000); }
  };

  const videoEl = main.querySelector('.text-style-preview-video[data-folder="1"]');
  const placeholderEl = main.querySelector('.text-style-preview-video-placeholder[data-folder="1"]');
  const loadingEl = main.querySelector('.text-style-preview-loading[data-folder="1"]');
  let previewAbortController = null;
  main.querySelector('[data-refresh-preview="1"]').onclick = () => {
    if (previewAbortController) previewAbortController.abort();
    previewAbortController = new AbortController();
    const get = (field) => { const el = document.querySelector(`[data-folder="1"][data-field="${field}"]`); return el ? el.value : null; };
    const sizeVal = parseFloat(get('size')) ?? 6;
    const textStylePerFolder = [{
      x: parseFloat(get('x')) ?? 50,
      y: parseFloat(get('y')) ?? 92,
      fontSize: sizeVal / 100,
      font: (get('font') || 'Arial, sans-serif').trim(),
      color: (get('color') || 'white').trim(),
      strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
    }];
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
    if (!confirm('Clear all generated URLs?')) return;
    apiClearCampaignUrls(pid, cid).then(() => {
      document.getElementById('urlsPlaceholder').style.display = 'block';
      document.getElementById('urlsPlaceholder').textContent = 'Run once to see URLs.';
      document.getElementById('urlsList').innerHTML = '';
      document.getElementById('copyAllUrls').style.display = 'none';
    });
  };

  function getCurrentTextStylePerFolder() {
    const get = (field) => { const el = document.querySelector(`[data-folder="1"][data-field="${field}"]`); return el ? el.value : null; };
    const sizeVal = parseFloat(get('size')) ?? 6;
    return [{
      x: parseFloat(get('x')) ?? 50,
      y: parseFloat(get('y')) ?? 92,
      fontSize: sizeVal / 100,
      font: (get('font') || 'Arial, sans-serif').trim(),
      color: (get('color') || 'white').trim(),
      strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
    }];
  }

  function showUrls(urls, base64Images) {
    const placeholder = document.getElementById('urlsPlaceholder');
    const list = document.getElementById('urlsList');
    const copyAllBtn = document.getElementById('copyAllUrls');
    if (!urls.length) { placeholder.style.display = 'block'; placeholder.textContent = 'Run once to see URLs.'; list.innerHTML = ''; copyAllBtn.style.display = 'none'; return; }
    placeholder.style.display = 'none';
    copyAllBtn.style.display = 'inline-block';
    list.innerHTML = urls.map((url) => `<li class="url-item"><span class="url-text">${escapeHtml(url)}</span><button type="button" class="btn btn-secondary btn-copy-url">Copy</button></li>`).join('');
    list.querySelectorAll('.btn-copy-url').forEach((btn, i) => { btn.onclick = () => { navigator.clipboard.writeText(urls[i]); btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }; });
    copyAllBtn.onclick = () => { navigator.clipboard.writeText(urls.join('\n')); copyAllBtn.textContent = 'Copied!'; setTimeout(() => { copyAllBtn.textContent = 'Copy all URLs'; }, 1500); };
  }

  document.getElementById('runNow').onclick = () => {
    const status = document.getElementById('runStatus');
    status.textContent = 'Running…';
    status.className = 'run-status loading';
    const textStylePerFolder = getCurrentTextStylePerFolder();
    const textOptionsPerFolder = campaignData.textOptionsPerFolder || [[]];
    const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
    apiUpdateCampaign(pid, cid, { ...campaignData, textStylePerFolder, sendAsDraft }, ptId)
      .then((c) => { campaignData = c; return apiCampaignRun(pid, cid, textStylePerFolder, textOptionsPerFolder, sendAsDraft, ptId); })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        let msg = `Done. ${(data.webContentUrls || []).length} URL(s) generated.`;
        if (data.blotatoSent) msg += data.blotatoSentAsDraft ? ' Sent to Blotato as draft.' : ' Sent to Blotato.';
        else if (data.blotatoError) msg += ` Blotato: ${data.blotatoError}`;
        status.textContent = msg;
        status.className = 'run-status success';
        showUrls(data.webContentUrls || [], data.webContentBase64 || []);
      })
      .catch((err) => { status.textContent = err.message || 'Run failed'; status.className = 'run-status error'; });
  };

  if ((latest.webContentUrls || []).length) showUrls(latest.webContentUrls, latest.webContentBase64 || []);
}

function renderPostTypeSelector(pid, cid, project, campaign) {
  const postTypes = campaign.postTypes || [];
  const main = document.getElementById('main');
  const hasPostTypes = postTypes.length > 0;
  const campaignAvatarSection = `<div class="campaign-header-avatar-inner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div>`;
  const pageIndicator = project.hasAvatar
    ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />`
    : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
  main.innerHTML = `
    <section class="card campaign-section campaign-page-card">
      <p class="back-link-wrap back-link-wrap-centered"><a href="#/campaigns/${cid}" class="nav-link">← Back to campaign</a></p>
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
            <h1 class="campaign-detail-name-editable">${escapeHtml(campaign.name)}</h1>
          </div>
          <p class="hint" style="margin:8px 0 0 0;">${escapeHtml(project.name)} — Select a post type to configure folders, text, schedule, and run.</p>
        </div>
        <div class="campaign-page-header-right"></div>
      </div>
    </section>
    <section class="card">
      <h2>Post types</h2>
      <p class="hint" style="margin-bottom:20px;">${hasPostTypes ? 'Each post type has its own photo folders, on-screen text (per folder), text styling (per folder), schedule, run now, and webContentUrls.' : 'Add a post type to get started. Each can have different folders and schedules.'}</p>
      <div class="post-type-selector post-type-big-buttons">
        ${postTypes.map((pt) => `
          <div class="post-type-card-wrap">
            <a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(pt.id)}" class="post-type-card post-type-big-btn">
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
      if (id) location.hash = `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(id)}`;
      else render();
    }).catch((err) => alert(err.message || 'Failed'));
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
      if (!confirm(`Delete post type "${ptName}"? This cannot be undone.`)) return;
      apiDeletePostType(pid, cid, btn.dataset.ptId).then(() => render()).catch((err) => alert(err.message || 'Failed'));
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
    if (!val) { alert('Select a campaign and page'); return; }
    const [targetCampaignId, targetPageId] = val.split(':').map(Number);
    apiDuplicatePostType(sourceProjectId, sourceCampaignId, postTypeId, targetCampaignId, targetPageId)
      .then(() => {
        modal.hidden = true;
        location.hash = `#/campaign/${targetPageId}/${targetCampaignId}`;
        render();
      })
      .catch((err) => alert(err.message || 'Failed to duplicate'));
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
  ]).then(([project, campaign, foldersData, latest]) => {
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
      renderCampaignVideo(pid, cid, ptId, project, campaign, foldersData, latest);
      return;
    }
    if (mediaType === 'video_text') {
      renderCampaignVideoWithText(pid, cid, ptId, project, campaign, foldersData, latest);
      return;
    }
    const folders = foldersData.folders || {};
    const folderCount = Math.max(1, foldersData.folderCount || (campaign.folderCount || 3));
    const textOptionsPerFolder = campaign.textOptionsPerFolder || Array(folderCount).fill(null).map(() => []);
    setBreadcrumb({ view: 'campaign', projectId: pid, campaignId: cid }, project, campaign);
    const times = campaign.scheduleTimes || ['10:00', '13:00', '16:00'];
    const scheduleStart = campaign.scheduleStartDate || '';
    const scheduleEnd = campaign.scheduleEndDate || '';
    const daysOfWeek = campaign.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const main = document.getElementById('main');

    const folderCards = [];
    for (let i = 1; i <= folderCount; i++) {
      const list = folders[`folder${i}`] || [];
      const count = list.length;
      const canDelete = folderCount > 1;
      folderCards.push(`
        <div class="folder" data-folder="${i}">
          <div class="dropzone" id="dropzone${i}" data-folder-num="${i}">
            <span class="dropzone-label">Folder ${i}</span>
            <span class="dropzone-count" id="count${i}">${count} photo${count !== 1 ? 's' : ''}</span>
            <button type="button" class="btn btn-secondary btn-sm dropzone-add">Add photos</button>
            <button type="button" class="btn btn-ghost btn-sm dropzone-view">View / manage</button>
            ${canDelete ? `<button type="button" class="btn btn-ghost btn-sm dropzone-delete" data-folder-num="${i}">Delete folder</button>` : ''}
            <input type="file" accept="image/*" multiple hidden id="input${i}" />
          </div>
        </div>
      `);
    }

    const textButtons = [];
    for (let i = 1; i <= folderCount; i++) {
      textButtons.push(`<a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}/folder/${i}" class="btn btn-secondary btn-folder-text">Folder ${i} – edit on-screen text</a>`);
    }

    const campaignAvatarSection = `<div class="campaign-header-avatar-inner" id="campaignHeaderAvatarInner"><img src="${campaignAvatarUrl(cid)}" alt="" class="campaign-avatar-img" id="campaignAvatarImg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" id="campaignAvatarPlaceholder" style="display:none;">${(campaign.name || 'C').charAt(0).toUpperCase()}</span></div><input type="file" accept="image/*" id="campaignAvatarInput" hidden />`;
    const pageIndicator = project.hasAvatar
      ? `<img src="${projectAvatarUrl(project.id)}" alt="" class="page-indicator-avatar" />`
      : `<span class="page-indicator-initial">${(project.name || 'P').charAt(0).toUpperCase()}</span>`;
    main.innerHTML = `
      <section class="card campaign-section campaign-page-card">
        <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}" class="nav-link">← Back to post types</a></p>
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
              <h1 id="campaignName" class="campaign-detail-name-editable" title="Double-click to rename">${escapeHtml(campaign.name)}</h1>
              <h2 id="postTypeHeader" class="post-type-header-editable post-type-name-centered" title="Double-click to edit label">${escapeHtml((campaign.postTypes || []).find((p) => p.id === ptId)?.name || ptId)}</h2>
              <label class="deploy-toggle deploy-toggle-under-name">
                <input type="checkbox" id="deployed" ${(campaign.deployedByPage && campaign.deployedByPage[pid]) || campaign.deployed ? 'checked' : ''} />
                <span>Deployed</span>
              </label>
            </div>
          </div>
          <div class="campaign-page-header-right"></div>
        </div>
      </section>

      <section class="card">
        <h2>Photo folders</h2>
        <p class="hint">Click a folder to view, add, or delete photos. One image is picked at random from each folder per run.</p>
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
            const firstImg = (folders[`folder${f}`] || [])[0];
            const imgUrl = firstImg ? folderImageUrl(pid, cid, f, firstImg, ptId) : '';
            const sampleText = (textOptionsPerFolder[f - 1] && textOptionsPerFolder[f - 1][0]) || 'Sample text';
            return `
          <div class="text-style-folder-card text-style-folder-card-live" data-folder="${f}">
            <h4 class="text-style-folder-title">Folder ${f}</h4>
            <div class="text-style-folder-row">
              <div class="text-style-settings-panel" data-folder="${f}">
                <div class="text-style-grid">
                  <label class="field"><span>X (%)</span><input type="number" data-folder="${f}" data-field="x" value="${(ts.x ?? 50)}" min="0" max="100" title="0 = center" /></label>
                  <label class="field"><span>Y (%)</span><input type="number" data-folder="${f}" data-field="y" value="${(ts.y ?? 92)}" min="0" max="100" title="0 = center" /></label>
                  <label class="field"><span>Size (%)</span><input type="number" data-folder="${f}" data-field="size" value="${((ts.fontSize ?? 0.06) * 100)}" min="1" max="100" step="0.5" /></label>
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
        <p class="hint">When this campaign runs (if deployed). Set date range, times per day, and days of week.</p>
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
        <h2>Run now & webContentUrls</h2>
        <p class="hint">Run once to generate images and URLs. Send these URLs to Blotato/n8n.</p>
        <label class="checkbox-field" style="margin-bottom:12px;">
          <input type="checkbox" id="sendAsDraft" ${campaign.sendAsDraft ? 'checked' : ''} />
          <span>Send to Blotato as draft</span>
        </label>
        <p class="hint" style="margin-top:-8px;margin-bottom:12px;">When checked, the post goes to TikTok drafts (mobile app) instead of publishing immediately.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="runNow">Run now</button>
          <button type="button" class="btn btn-secondary" id="clearUrlsBtn">Clear URLs</button>
        </div>
        <div class="run-status" id="runStatus"></div>
        <div class="urls-wrap" id="urlsWrap">
          <div class="urls-placeholder" id="urlsPlaceholder">${(latest.webContentUrls || []).length ? '' : 'Run once to see URLs.'}</div>
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
        }
      });
    }

    for (let num = 1; num <= folderCount; num++) {
      const dropzone = document.getElementById(`dropzone${num}`);
      const input = document.getElementById(`input${num}`);
      const viewBtn = dropzone && dropzone.querySelector('.dropzone-view');
      const addBtn = dropzone && dropzone.querySelector('.dropzone-add');
      if (viewBtn) viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); location.hash = `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}/photos/${num}`; };
      if (addBtn && input) addBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); input.click(); };
      if (dropzone && input) {
        dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
        dropzone.ondragleave = () => dropzone.classList.remove('dragover');
        dropzone.ondrop = (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          const files = e.dataTransfer.files;
          if (!files?.length) return;
          apiCampaignUpload(pid, cid, num, files, ptId).then(updateFolderCounts).catch((err) => alert(err.message || 'Upload failed'));
        };
      }
      if (input) input.onchange = (e) => {
        const files = e.target.files;
        if (!files?.length) return;
        apiCampaignUpload(pid, cid, num, files, ptId).then(() => { updateFolderCounts(); input.value = ''; }).catch((err) => alert(err.message || 'Upload failed'));
      };
      const deleteBtn = dropzone && dropzone.querySelector('.dropzone-delete');
      if (deleteBtn) deleteBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Delete this folder and its photos?')) return;
        apiDeleteFolder(pid, cid, num, ptId).then(() => render()).catch((err) => alert(err.message || 'Failed'));
      };
    }

    const addFolderBtn = document.getElementById('addFolderBtn');
    if (addFolderBtn) {
      addFolderBtn.onclick = () => {
        apiAddFolder(pid, cid, ptId).then(() => render()).catch((err) => alert(err.message || err.error || 'Failed to add folder'));
      };
    }
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
          if (campAvatarImg) { campAvatarImg.src = campaignAvatarUrl(cid); campAvatarImg.style.display = ''; campAvatarPlaceholder && (campAvatarPlaceholder.style.display = 'none'); }
          campAvatarInput.value = '';
        }).catch((err) => alert(err.message || 'Upload failed'));
      };
    }
    const campaignNameEl = document.getElementById('campaignName');
    if (campaignNameEl) campaignNameEl.ondblclick = () => {
      const name = prompt('Campaign name:', campaign.name);
      if (name != null && name.trim()) {
        apiUpdateCampaign(pid, cid, { ...campaign, name: name.trim() }, ptId).then((c) => {
          campaign = c;
          if (campaignNameEl) campaignNameEl.textContent = c.name;
        });
      }
    };
    const postTypeHeaderEl = document.getElementById('postTypeHeader');
    if (postTypeHeaderEl) postTypeHeaderEl.ondblclick = () => {
      const pt = (campaign.postTypes || []).find((p) => p.id === ptId);
      const current = pt ? pt.name : ptId;
      const name = prompt('Post type label:', current);
      if (name != null && name.trim()) {
        apiUpdatePostType(pid, cid, ptId, { name: name.trim() }).then((c) => {
          campaign = c;
          if (postTypeHeaderEl) postTypeHeaderEl.textContent = name.trim();
        }).catch((err) => alert(err.message || 'Failed'));
      }
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
      const timesArr = Array.from(document.querySelectorAll('.time-input')).map((i) => i.value || '10:00');
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
        const sizeVal = parseFloat(get('size')) ?? 6;
        textStylePerFolder.push({
          x: parseFloat(get('x')) ?? 50,
          y: parseFloat(get('y')) ?? 92,
          fontSize: sizeVal / 100,
          font: (get('font') || 'Arial, sans-serif').trim(),
          color: (get('color') || 'white').trim(),
          strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
        });
      }
      apiUpdateCampaign(pid, cid, { ...campaign, textStylePerFolder }, ptId).then((c) => { campaign = c; });
      const status = document.getElementById('runStatus');
      if (status) { status.textContent = 'Text styles saved.'; status.className = 'run-status success'; setTimeout(() => { status.textContent = ''; status.className = 'run-status'; }, 2000); }
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
      const sizeVal = parseFloat(get('size')) ?? 6;
      const textStyle = {
        x: parseFloat(get('x')) ?? 50,
        y: parseFloat(get('y')) ?? 92,
        fontSize: sizeVal / 100,
        font: (get('font') || 'Arial, sans-serif').trim(),
        color: (get('color') || 'white').trim(),
        strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
      };
      const opts = (textOptionsPerFolder[f - 1]);
      const sampleText = (opts && opts[0]) ? String(opts[0]) : 'Sample text';
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
      if (!confirm('Clear all generated URLs?')) return;
      apiClearCampaignUrls(pid, cid).then(() => {
        const placeholder = document.getElementById('urlsPlaceholder');
        const list = document.getElementById('urlsList');
        const copyAllBtn = document.getElementById('copyAllUrls');
        if (placeholder) { placeholder.style.display = 'block'; placeholder.textContent = 'Run once to see URLs.'; }
        if (list) list.innerHTML = '';
        if (copyAllBtn) copyAllBtn.style.display = 'none';
      });
    };

    function getCurrentTextStylePerFolder() {
      const textStylePerFolder = [];
      for (let f = 1; f <= folderCount; f++) {
        const get = (field) => {
          const el = document.querySelector(`[data-folder="${f}"][data-field="${field}"]`);
          return el ? el.value : null;
        };
        const sizeVal = parseFloat(get('size')) ?? 6;
        textStylePerFolder.push({
          x: parseFloat(get('x')) ?? 50,
          y: parseFloat(get('y')) ?? 92,
          fontSize: sizeVal / 100,
          font: (get('font') || 'Arial, sans-serif').trim(),
          color: (get('color') || 'white').trim(),
          strokeWidth: parseFloat(get('strokeWidth')) ?? 2,
        });
      }
      return textStylePerFolder;
    }

    document.getElementById('runNow').onclick = () => {
      const status = document.getElementById('runStatus');
      status.textContent = 'Running…';
      status.className = 'run-status loading';
      const textStylePerFolder = getCurrentTextStylePerFolder();
      const textOptionsPerFolder = campaign.textOptionsPerFolder || [];
      const sendAsDraft = !!document.getElementById('sendAsDraft')?.checked;
      apiUpdateCampaign(pid, cid, { ...campaign, textStylePerFolder, sendAsDraft }, ptId)
        .then((c) => { campaign = c; return apiCampaignRun(pid, cid, textStylePerFolder, textOptionsPerFolder, sendAsDraft, ptId); })
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
        });
    };

    function showUrls(urls, base64Images = []) {
      const placeholder = document.getElementById('urlsPlaceholder');
      const list = document.getElementById('urlsList');
      const copyAllBtn = document.getElementById('copyAllUrls');
      if (!urls.length) {
        placeholder.style.display = 'block';
        placeholder.textContent = 'Run once to see URLs.';
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
        <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}" class="nav-link">← Back to post type</a></p>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <h1 style="margin:0;">Folder ${fnum} – photos</h1>
          ${canDeleteFolder ? `<button type="button" class="btn btn-ghost" id="folderPhotosDeleteFolderBtn">Delete folder</button>` : ''}
        </div>
        <p class="hint">Add or remove images. One image is picked at random from this folder per run.</p>
        <div class="folder-photos-grid" id="folderPhotosGrid"></div>
        <div class="folder-photos-actions" style="margin-top:1rem;">
          <input type="file" accept="image/*" multiple id="folderPhotosInput" hidden />
          <button type="button" class="btn btn-secondary" id="folderPhotosAddBtn">Add photos</button>
        </div>
      </section>
    `;
    const grid = document.getElementById('folderPhotosGrid');
    const addInput = document.getElementById('folderPhotosInput');
    const addBtn = document.getElementById('folderPhotosAddBtn');

    function refresh() {
      apiCampaignFolders(pid, cid, ptId).then((data) => {
        const imgs = (data.folders || {})[`folder${fnum}`] || [];
        if (!grid) return;
        grid.innerHTML = imgs.map((filename) => `
          <div class="folder-photo-item">
            <img data-src="${folderImageUrl(pid, cid, fnum, filename, ptId)}" alt="" loading="lazy" />
            <button type="button" class="folder-photo-delete" data-filename="${escapeHtml(filename)}">×</button>
          </div>
        `).join('');
        grid.querySelectorAll('img[data-src]').forEach((img) => {
          withAuthQuery(img.dataset.src).then((url) => { img.src = url; img.removeAttribute('data-src'); });
        });
        grid.querySelectorAll('.folder-photo-delete').forEach((btn) => {
          btn.onclick = () => {
            apiDeleteFolderImage(pid, cid, fnum, btn.dataset.filename, ptId).then(refresh).catch(() => alert('Delete failed'));
          };
        });
      });
    }
    refresh();

    addBtn.onclick = () => addInput.click();
    addInput.onchange = (e) => {
      const files = e.target.files;
      if (!files?.length) return;
      apiCampaignUpload(pid, cid, fnum, files, ptId).then(refresh).catch(() => alert('Upload failed'));
      addInput.value = '';
    };
    const deleteFolderBtn = document.getElementById('folderPhotosDeleteFolderBtn');
    if (deleteFolderBtn) deleteFolderBtn.onclick = () => {
      if (!confirm(`Delete folder ${fnum} and its photos?`)) return;
      apiDeleteFolder(pid, cid, fnum, ptId).then(() => { location.hash = `#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}`; render(); }).catch((err) => alert(err.message || 'Failed'));
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
    const hint = isVideoText ? 'Add or remove videos. One video is picked at random per run and combined with a random text option.' : 'Add or remove videos. One video is picked at random from this folder per run (Priority is used first, then Fallback).';
    const list = (foldersData.folders || {})[`folder${fnum}`] || [];
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card">
        <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}" class="nav-link">← Back to post type</a></p>
        <h1 style="margin:0;">${title}</h1>
        <p class="hint">${hint}</p>
        <div class="folder-photos-grid" id="folderVideosGrid"></div>
        <div class="folder-photos-actions" style="margin-top:1rem;">
          <input type="file" accept="video/*" multiple id="folderVideosInput" hidden />
          <button type="button" class="btn btn-secondary" id="folderVideosAddBtn">Add videos</button>
        </div>
      </section>
    `;
    const grid = document.getElementById('folderVideosGrid');
    const addInput = document.getElementById('folderVideosInput');
    const addBtn = document.getElementById('folderVideosAddBtn');

    function refresh() {
      apiCampaignFolders(pid, cid, ptId).then((data) => {
        const videos = (data.folders || {})[`folder${fnum}`] || [];
        if (!grid) return;
        grid.innerHTML = videos.map((filename) => `
          <div class="folder-photo-item">
            <video data-src="${folderMediaUrl(pid, cid, fnum, filename, ptId)}" controls preload="metadata" style="max-width:100%;max-height:200px;"></video>
            <button type="button" class="folder-photo-delete" data-filename="${escapeHtml(filename)}">×</button>
          </div>
        `).join('');
        grid.querySelectorAll('video[data-src]').forEach((v) => {
          withAuthQuery(v.dataset.src).then((url) => { v.src = url; v.removeAttribute('data-src'); });
        });
        grid.querySelectorAll('.folder-photo-delete').forEach((btn) => {
          btn.onclick = () => {
            apiDeleteFolderMedia(pid, cid, fnum, btn.dataset.filename, ptId).then(refresh).catch(() => alert('Delete failed'));
          };
        });
      });
    }
    refresh();

    addBtn.onclick = () => addInput.click();
    addInput.onchange = (e) => {
      const files = e.target.files;
      if (!files?.length) return;
      const mediaType = campaign.mediaType === 'video_text' ? 'video_text' : 'video';
      apiCampaignUpload(pid, cid, fnum, files, ptId, mediaType).then(refresh).catch(() => alert('Upload failed'));
      addInput.value = '';
    };
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
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="card">
        <p class="back-link-wrap"><a href="#/campaign/${pid}/${cid}/pt/${encodeURIComponent(ptId)}" class="nav-link">← Back to post type</a></p>
        <h1>Folder ${fnum} – on-screen text options</h1>
        <p class="hint">One option is chosen at random per image from this folder.</p>
        <ul class="text-options-list" id="folderTextList"></ul>
        <div class="text-options-actions">
          <input type="text" id="folderNewText" placeholder="Add option…" />
          <button type="button" class="btn btn-secondary" id="folderAddBtn">Add</button>
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
      list.innerHTML = arr.map((text, i) => `
        <li>
          <span>${escapeHtml(text)}</span>
          <button type="button" aria-label="Remove" data-index="${i}">×</button>
        </li>
      `).join('');
      list.querySelectorAll('button').forEach((btn) => {
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
            .catch((err) => { alert(err?.message || 'Failed to save. Try again.'); });
        };
      });
    }
    renderList(opts);

    addBtn.onclick = () => {
      const v = (newInput && newInput.value.trim()) || '';
      if (!v) return;
      const newPerFolder = [...(campaign.textOptionsPerFolder || [])];
      while (newPerFolder.length < fnum) newPerFolder.push([]);
      newPerFolder[fnum - 1] = [...(newPerFolder[fnum - 1] || []), v];
      apiUpdateCampaign(pid, cid, { ...campaign, textOptionsPerFolder: newPerFolder }, ptId)
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
        .catch((err) => { alert(err?.message || 'Failed to save. Try again.'); });
    };
    if (newInput) newInput.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
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
      <input type="checkbox" data-page-id="${p.id}" checked />
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
    if (!ids.length) { alert('Select at least one page'); return; }
    apiCreateCampaignWithPages(name, ids).then((c) => {
      close();
      location.hash = `#/campaigns/${c.id}`;
      if (onSuccess) onSuccess();
    }).catch((err) => alert(err.message || 'Failed to create campaign'));
  };
  const form = document.getElementById('newCampaignForm');
  if (form) form.onsubmit = doCreate;
  modal.onclick = null;
}

function renderCampaigns() {
  setBreadcrumb({ view: 'campaigns' });
  Promise.all([apiProjects(), apiAllCampaigns()]).then(([projects, campaigns]) => {
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
        const avatarImg = `<img src="${campaignAvatarUrl(c.id)}" alt="" class="campaign-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="campaign-avatar-placeholder" style="display:none;">${(c.name || 'C').charAt(0).toUpperCase()}</span>`;
        return `
          <div class="campaigns-list-item">
            <a href="#/campaigns/${c.id}" class="campaign-card-link">
              <div class="list-card">
                <div class="campaign-avatar campaign-avatar-square">${avatarImg}</div>
                <div class="list-card-main">
                  <div class="list-card-title-row">
                    <span class="list-card-title">${escapeHtml(c.name)}</span>
                    ${releaseTypeBadge ? releaseTypeBadge : ''}
                  </div>
                  <span class="list-card-meta">${releaseLabel ? escapeHtml(releaseLabel) : 'No release date'}</span>
                </div>
              </div>
            </a>
            <button type="button" class="btn btn-ghost btn-sm list-card-action" data-action="delete-campaign" data-cid="${c.id}" data-cname="${escapeHtml(c.name)}" aria-label="Delete campaign">Delete</button>
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
        if (!confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
        apiDeleteCampaignById(btn.dataset.cid).then(() => render()).catch((err) => alert(err.message || 'Failed to delete'));
      };
    });
  });
}

function renderCampaignDetail(campaignId) {
  const cid = campaignId;
  Promise.all([
    apiProjects(),
    apiAllCampaigns(),
    apiDeployedPostsCount(campaignId).catch(() => ({ count: 0, byPage: {} })),
  ]).then(([projects, campaigns, countData]) => {
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
            </div>
          </div>
        </div>
        <div class="campaign-pages-grid" id="campaignPagesGrid"></div>
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
      </section>
    `;
    const grid = document.getElementById('campaignPagesGrid');
    grid.innerHTML = pages.map((p) => {
      const pageDeployed = campaign.deployedByPage?.[p.id] ?? campaign.deployed;
      const deployedBadge = pageDeployed ? '<span class="badge badge-deployed">Deployed</span>' : '<span class="badge badge-draft">Draft</span>';
      const postTypeCount = ((campaign.pagePostTypes || {})[p.id] || campaign.postTypes || []).length;
      const postsForPage = deployedByPage[p.id] ?? 0;
      const avatarImg = p.hasAvatar ? `<img src="${projectAvatarUrl(p.id)}" alt="" class="project-avatar-img" />` : `<span class="project-circle-initial">${(p.name || 'P').charAt(0).toUpperCase()}</span>`;
      return `
        <div class="campaign-page-card-wrap">
          <a href="#/campaign/${p.id}/${cid}" class="campaign-page-card">
            <div class="campaign-page-avatar">${avatarImg}</div>
            <span class="campaign-page-name">${escapeHtml(p.name)}</span>
            <span class="campaign-page-meta">${postTypeCount} post type${postTypeCount !== 1 ? 's' : ''} · ${pageDeployed ? `${postsForPage} deployed posts` : '0 deployed posts'}</span>
            ${deployedBadge}
          </a>
          <button type="button" class="btn btn-ghost campaign-page-remove" data-page-id="${p.id}" data-page-name="${escapeHtml(p.name)}" aria-label="Remove from campaign">🗑</button>
        </div>
      `;
    }).join('');

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
          if (avatarImg) { avatarImg.src = campaignAvatarUrl(cid); avatarImg.style.display = ''; avatarPlaceholder && (avatarPlaceholder.style.display = 'none'); }
          avatarInput.value = '';
        }).catch((err) => alert(err.message || 'Upload failed'));
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
      const name = prompt('Campaign name:', campaign.name);
      if (name != null && name.trim()) {
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, memberUsernames: campaign.memberUsernames || [] }) })
          .then((r) => r.json())
          .then((c) => { campaign = c; if (nameEl) nameEl.textContent = c.name; });
      }
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
      apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: val, releaseType: campaign.releaseType, memberUsernames: campaign.memberUsernames || [] }) })
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
        .catch((err) => alert(err.message || 'Failed to save release date'));
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
      apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, campaignStartDate: startVal, campaignEndDate: endVal, memberUsernames: campaign.memberUsernames || [] }) })
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
        .catch((err) => alert(err.message || 'Failed to save'));
    };
    if (campaignDateRangeModal) campaignDateRangeModal.onclick = (e) => { if (e.target.id === 'campaignDateRangeModal') campaignDateRangeModal.hidden = true; };
    const releaseTypeSelect = document.getElementById('campaignReleaseTypeSelect');
    if (releaseTypeSelect) {
      releaseTypeSelect.onchange = () => {
        const val = releaseTypeSelect.value || null;
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: val, memberUsernames: campaign.memberUsernames || [] }) })
          .then((r) => { if (!r.ok) throw new Error('Save failed'); return r.json(); })
          .then((c) => { campaign = c; });
      };
    }
    document.getElementById('addPageToCampaignBtn').onclick = () => {
      const available = projects.filter((p) => !pageIds.includes(p.id));
      if (!available.length) { alert('All pages are already in this campaign.'); return; }
      openAddPageModal(cid, pageIds, available, () => renderCampaignDetail(cid));
    };
    grid.querySelectorAll('.campaign-page-remove').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pageName = btn.dataset.pageName || 'this page';
        if (!confirm(`Are you sure you want to remove "${pageName}" from the campaign?`)) return;
        const removeId = parseInt(btn.dataset.pageId, 10);
        const newPageIds = pageIds.filter((id) => id !== removeId);
        if (newPageIds.length === 0) { alert('Campaign must have at least one page.'); return; }
        apiUpdateCampaignPages(cid, newPageIds).then(() => renderCampaignDetail(cid)).catch((err) => alert(err.message || 'Failed'));
      };
    });

    const memberUsernames = campaign.memberUsernames || [];
    const campaignTeamList = document.getElementById('campaignTeamList');
    const campaignTeamError = document.getElementById('campaignTeamError');
    const campaignTeamUsername = document.getElementById('campaignTeamUsername');
    const campaignTeamAddBtn = document.getElementById('campaignTeamAddBtn');
    if (campaignTeamList) {
      campaignTeamList.innerHTML = memberUsernames.length
        ? memberUsernames.map((u, i) => `<li class="settings-team-item"><span>${escapeHtml(u)}</span> <button type="button" class="btn btn-ghost btn-sm" data-campaign-remove-index="${i}" aria-label="Remove">Remove</button></li>`).join('')
        : '<li class="hint">No team members yet. Add by username above.</li>';
    }
    if (campaignTeamAddBtn && campaignTeamUsername) {
      campaignTeamAddBtn.onclick = () => {
        const username = campaignTeamUsername.value.trim();
        if (!username) return;
        if (campaignTeamError) campaignTeamError.hidden = true;
        const next = [...(campaign.memberUsernames || []), username];
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, campaignStartDate: campaign.campaignStartDate, campaignEndDate: campaign.campaignEndDate, memberUsernames: next }) })
          .then((r) => r.json())
          .then((c) => { campaign = c; campaignTeamUsername.value = ''; renderCampaignDetail(cid); })
          .catch((err) => { if (campaignTeamError) { campaignTeamError.textContent = err.message || 'Failed'; campaignTeamError.hidden = false; } });
      };
    }
    if (campaignTeamList) {
      campaignTeamList.onclick = (e) => {
        const idx = e.target.dataset.campaignRemoveIndex;
        if (idx === undefined) return;
        const list = campaign.memberUsernames || [];
        const next = list.filter((_, i) => String(i) !== String(idx));
        apiWithAuth(`${API}/api/campaigns/${cid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: campaign.name, pageIds, releaseDate: campaign.releaseDate, releaseType: campaign.releaseType, campaignStartDate: campaign.campaignStartDate, campaignEndDate: campaign.campaignEndDate, memberUsernames: next }) })
          .then((r) => r.json())
          .then((c) => { campaign = c; renderCampaignDetail(cid); })
          .catch((err) => alert(err.message || 'Failed'));
      };
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
      alert('Could not load image');
    });
    fileInput.value = '';
  };

  saveBtn.onclick = () => {
    getCroppedBlob().then((blob) => {
      if (!blob) { alert('Could not process image'); return; }
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const upload = type === 'project' ? apiUploadProjectAvatar(String(id), file) : apiUploadCampaignAvatar(String(id), file);
      upload.then(() => {
        modal.hidden = true;
        if (onSuccess) onSuccess();
      }).catch((err) => alert(err.message || 'Upload failed'));
    });
  };

  cancelBtn.onclick = () => { modal.hidden = true; };
  modal.onclick = (e) => { if (e.target.id === 'editAvatarModal') modal.hidden = true; };

  loadImage(imageUrl).then(() => {
    initFromImage();
    modal.hidden = false;
  }).catch(() => {
    alert('Could not load image');
  });
}

function openJoinCampaignModal(projectId, joinableCampaigns, onSuccess) {
  const modal = document.getElementById('joinCampaignModal');
  const list = document.getElementById('joinCampaignList');
  const cancelBtn = document.getElementById('joinCampaignCancel');
  if (!modal || !list) return;
  if (!joinableCampaigns.length) {
    alert('No campaigns available. All campaigns already include this page.');
    return;
  }
  list.innerHTML = joinableCampaigns.map((c) => `
    <button type="button" class="btn btn-secondary" style="width:100%;justify-content:flex-start;margin:4px 0;" data-campaign-id="${c.id}">+ ${escapeHtml(c.name)}</button>
  `).join('');
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
      apiUpdateCampaignPages(campaignId, newPageIds).then(() => { close(); onSuccess(); }).catch((err) => alert(err.message || 'Failed'));
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
      apiUpdateCampaignPages(campaignId, newPageIds).then(() => { close(); onSuccess(); }).catch((err) => alert(err.message || 'Failed'));
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
          if (!confirm('Delete this login?')) return;
          apiDeleteLogin(id).then(() => refresh()).catch((e) => alert(e.message || 'Failed to delete'));
        };
      });
      tbody.querySelectorAll('.logins-save-row').forEach((btn) => {
        btn.onclick = () => {
          const tr = btn.closest('tr');
          const id = tr.dataset.id;
          const get = (f) => (tr.querySelector(`[data-field="${f}"]`) || {}).value;
          const payload = { email: get('email'), username: get('username'), password: get('password'), platform: get('platform') };
          if (id === 'new') {
            apiCreateLogin(payload).then(() => refresh()).catch((e) => alert(e.message || 'Failed to save'));
          } else {
            apiUpdateLogin(parseInt(id, 10), payload).then(() => refresh()).catch((e) => alert(e.message || 'Failed to save'));
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
          if (file) apiUploadLoginAvatar(lid, file).then(() => refresh()).catch((err) => alert(err.message || 'Upload failed'));
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
        .catch((e) => alert(e.message || 'Failed to save'));
    };
  };
  refresh();
}

function renderCalendar() {
  setBreadcrumb({ view: 'calendar' });
  apiWithAuth(`${API}/api/calendar`).then((r) => r.json()).then((data) => {
    const items = data.items || [];
    const main = document.getElementById('main');
    if (!items.length) {
      main.innerHTML = '<section class="card"><h1>Calendar</h1><p class="hint">Upcoming scheduled posts (deployed campaigns only).</p><p class="empty">No scheduled runs. Deploy campaigns and set times to see them here.</p></section>';
      return;
    }
    main.innerHTML = `
      <section class="card">
        <h1>Calendar</h1>
        <p class="hint">Upcoming scheduled posts across all pages (deployed campaigns only).</p>
        <div class="calendar-header">
          <span class="calendar-date">Date</span>
          <span class="calendar-time">Time</span>
          <span class="calendar-project">Page</span>
          <span class="calendar-campaign">Campaign</span>
        </div>
        <ul class="calendar-list" id="calendarList"></ul>
      </section>
    `;
    const list = document.getElementById('calendarList');
    list.innerHTML = items.map((it) => `
      <li class="calendar-item">
        <span class="calendar-date">${formatCalendarDate(it.date)}</span>
        <span class="calendar-time">${formatTimeAMPM(it.time)}</span>
        <span class="calendar-project">${escapeHtml(it.projectName)}</span>
        <span class="calendar-campaign"><a href="#/campaigns/${it.campaignId}" class="calendar-campaign-link">${escapeHtml(it.campaignName)}</a></span>
      </li>
    `).join('');
  }).catch(() => {
    document.getElementById('main').innerHTML = '<section class="card"><p>Could not load calendar.</p></section>';
  });
}

function render() {
  updateNavActive();
  const route = getRoute();
  if (route.view === 'dashboard') renderDashboard();
  else if (route.view === 'calendar') renderCalendar();
  else if (route.view === 'logins') renderLogins();
  else if (route.view === 'campaigns') renderCampaigns();
  else if (route.view === 'campaignDetail') renderCampaignDetail(route.campaignId);
  else if (route.view === 'project') renderProject(route.projectId);
  else if (route.view === 'projectUsed') renderProjectUsed(route.projectId);
  else if (route.view === 'campaign') renderCampaign(route.projectId, route.campaignId, route.postTypeId);
  else if (route.view === 'campaignFolder') renderCampaignFolderText(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
  else if (route.view === 'campaignFolderPhotos') renderCampaignFolderPhotos(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
  else if (route.view === 'campaignFolderVideos') renderCampaignFolderVideos(route.projectId, route.campaignId, route.folderNum, route.postTypeId);
}

// --- Settings modal (event delegation so buttons always work) ---
function closeSettingsModal() {
  const el = document.getElementById('settingsModal');
  if (el) el.hidden = true;
  const btn = document.getElementById('openSettings');
  if (btn) btn.classList.remove('active');
}

async function openSettingsModal() {
  try {
    const c = await apiConfig();
    const input = document.getElementById('baseUrl');
    if (input) input.value = c.baseUrl || window.location.origin;
    const blotatoInput = document.getElementById('blotatoApiKey');
    if (blotatoInput) blotatoInput.value = c.blotatoApiKey || '';
    const usernameEl = document.getElementById('settingsUsername');
    const teamListEl = document.getElementById('settingsTeamList');
    const teamErrorEl = document.getElementById('settingsTeamError');
    const profileSection = document.getElementById('settingsProfileSection');
    const teamSection = document.getElementById('settingsTeamSection');
    if (profileSection) profileSection.hidden = !supabaseClient;
    if (teamSection) teamSection.hidden = !supabaseClient;
    if (teamErrorEl) teamErrorEl.hidden = true;
    const usernameEditWrap = document.getElementById('settingsUsernameEditWrap');
    const settingsUsernameInput = document.getElementById('settingsUsernameInput');
    const settingsUsernameError = document.getElementById('settingsUsernameError');
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
    const el = document.getElementById('settingsModal');
    if (el) el.hidden = false;
    const btn = document.getElementById('openSettings');
    if (btn) btn.classList.add('active');
  } catch (_) {
    closeSettingsModal();
  }
}

document.getElementById('openSettings').addEventListener('click', openSettingsModal);

document.getElementById('settingsUsernameEdit').addEventListener('click', () => {
  const wrap = document.getElementById('settingsUsernameEditWrap');
  const display = document.getElementById('settingsUsername');
  const input = document.getElementById('settingsUsernameInput');
  const errEl = document.getElementById('settingsUsernameError');
  if (wrap && input) {
    if (errEl) errEl.hidden = true;
    input.value = (display?.textContent || '').trim();
    wrap.hidden = false;
    input.focus();
  }
});

document.getElementById('settingsUsernameCancel').addEventListener('click', () => {
  const wrap = document.getElementById('settingsUsernameEditWrap');
  const errEl = document.getElementById('settingsUsernameError');
  if (wrap) wrap.hidden = true;
  if (errEl) errEl.hidden = true;
});

document.getElementById('settingsUsernameSave').addEventListener('click', async () => {
  const input = document.getElementById('settingsUsernameInput');
  const display = document.getElementById('settingsUsername');
  const wrap = document.getElementById('settingsUsernameEditWrap');
  const errEl = document.getElementById('settingsUsernameError');
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

document.getElementById('settingsTeamAddBtn').addEventListener('click', async () => {
  const input = document.getElementById('settingsTeamUsername');
  const errEl = document.getElementById('settingsTeamError');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (!username) return;
  errEl.hidden = true;
  try {
    await apiTeamAdd(username);
    input.value = '';
    openSettingsModal();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to add';
    errEl.hidden = false;
  }
});

document.getElementById('settingsModal').addEventListener('click', async (e) => {
  if (e.target.id === 'closeSettings') {
    closeSettingsModal();
    return;
  }
  if (e.target.id === 'saveSettings') {
    const input = document.getElementById('baseUrl');
    const blotatoInput = document.getElementById('blotatoApiKey');
    const baseUrl = (input && input.value.trim()) || window.location.origin;
    const blotatoApiKey = (blotatoInput && blotatoInput.value.trim()) || '';
    apiSaveConfig({ baseUrl, blotatoApiKey }).then(closeSettingsModal).catch(() => closeSettingsModal());
    return;
  }
  if (e.target.dataset.removeTeam) {
    const userId = e.target.dataset.removeTeam;
    const errEl = document.getElementById('settingsTeamError');
    if (errEl) errEl.hidden = true;
    try {
      await apiTeamRemove(userId);
      openSettingsModal();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Failed to remove'; errEl.hidden = false; }
    }
    return;
  }
  if (e.target.id === 'settingsModal') {
    closeSettingsModal();
  }
});

// --- Logout ---
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
    checkAuthAndRender();
  }
});

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
