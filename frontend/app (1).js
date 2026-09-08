const PREFERENCES_STORAGE_KEY = "kryptovault-preferences-v1";
const DEMO_MODE_STORAGE_KEY = "kryptovault-demo-mode-enabled";
const DEMO_STATE_STORAGE_KEY = "kryptovault-demo-state-v1";

const defaultPreferences = () => ({
  requireKyc: true,
  requireWallet: true,
  showProgress: true,
  theme: "dark"
});

const emptyUser = () => ({
  name: "Guest",
  email: "",
  walletAddress: "",
  kycStatus: "PENDING"
});

const emptyAppData = () => ({
  user: emptyUser(),
  folders: [],
  documents: [],
  shared: [],
  activities: []
});

const initialState = () => ({
  user: {
    name: "Rohit Sharma",
    email: "rohit@example.com",
    walletAddress: "",
    kycStatus: "PENDING"
  },
  settings: defaultPreferences(),
  folders: [
    { id: "personal", name: "Personal", createdAt: Date.now() },
    { id: "certificates", name: "Certificates", createdAt: Date.now() },
    { id: "projects", name: "Projects", createdAt: Date.now() }
  ],
  documents: [
    {
      id: "doc-1001",
      name: "Employment_Agreement.pdf",
      size: 428000,
      mimeType: "application/pdf",
      folderId: "personal",
      accessType: "private",
      hash: "a84d11e93f96c55c91708b98b9c5e1abc73d1db1f239d105d1c1dd32b91f167c",
      verified: true,
      txHash: "0x8d5b0f4f726cb29a7b2227e1f4c4c8a713e4189fd7061628b211674ff0119b7a",
      blockNumber: 193244,
      createdAt: Date.now() - 1000 * 60 * 53,
      permissions: [
        {
          id: "perm-a1",
          name: "Ananya Gupta",
          recipient: "ananya@example.com",
          wallet: "0xa17c...81c0",
          role: "VIEW",
          expiresAt: Date.now() + 6 * 86400000,
          reason: "Contract review",
          active: true
        }
      ]
    },
    {
      id: "doc-1002",
      name: "Project_IP_Documentation.docx",
      size: 932000,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      folderId: "projects",
      accessType: "team",
      hash: "b931641c5601510ad08ce4a69db51ae715321c45f9a81e9c89d092c63c08d8fb",
      verified: true,
      txHash: "0xc7de8ae550467e3e4f62ad2bf40fb61a2be1602f9f6d56ed34ff3f11eaed4820",
      blockNumber: 193211,
      createdAt: Date.now() - 1000 * 60 * 60 * 5,
      permissions: []
    }
  ],
  shared: [
    {
      id: "shared-1",
      name: "Research_Paper.pdf",
      owner: "Arjun Mehta",
      access: "VIEW",
      expiresAt: Date.now() + 2 * 86400000,
      verified: true
    },
    {
      id: "shared-2",
      name: "CAD_Prototype_v4.zip",
      owner: "Riya Kapoor",
      access: "DOWNLOAD",
      expiresAt: null,
      verified: true
    }
  ],
  activities: [
    { id: crypto.randomUUID(), action: "Access granted", detail: "Ananya Gupta received VIEW access to Employment_Agreement.pdf", time: Date.now() - 1000 * 60 * 16 },
    { id: crypto.randomUUID(), action: "Document registered", detail: "Project_IP_Documentation.docx fingerprint recorded", time: Date.now() - 1000 * 60 * 60 * 5 },
    { id: crypto.randomUUID(), action: "Document uploaded", detail: "Employment_Agreement.pdf added to secure storage", time: Date.now() - 1000 * 60 * 53 }
  ]
});

let state = loadState();
let currentDocId = null;
let pendingRevoke = null;
let selectedUploadFile = null;

function isDemoModeEnabled() {
  return window.KRYPTO_DEMO_MODE === true || localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "true";
}

function setDemoModeEnabled(enabled) {
  if (enabled) {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");
    return;
  }

  localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
  localStorage.removeItem(DEMO_STATE_STORAGE_KEY);
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        ...defaultPreferences(),
        showProgress: typeof saved.showProgress === "boolean" ? saved.showProgress : defaultPreferences().showProgress,
        theme: saved.theme === "light" ? "light" : "dark"
      };
    }
  } catch (_) {}

  return defaultPreferences();
}

function savePreferences() {
  const safePreferences = {
    showProgress: !!state.settings.showProgress,
    theme: state.settings.theme === "light" ? "light" : "dark"
  };
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(safePreferences));
}

function loadDemoState() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STATE_STORAGE_KEY));
    if (saved && typeof saved === "object") return saved;
  } catch (_) {}

  const fresh = initialState();
  localStorage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function loadState() {
  const settings = loadPreferences();

  if (isDemoModeEnabled()) {
    return { ...loadDemoState(), settings };
  }

  return { ...emptyAppData(), settings };
}

function normalizeKycStatus(status) {
  const normalized = String(status || "PENDING").toUpperCase();
  return ["PENDING", "VERIFIED", "REJECTED"].includes(normalized) ? normalized : "PENDING";
}

function isKycVerified() {
  return normalizeKycStatus(state.user.kycStatus) === "VERIFIED";
}

function saveState() {
  savePreferences();
  if (isDemoModeEnabled()) {
    localStorage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(state));
  }
  renderAll();
}

async function loadAuthenticatedUser() {
  if (!window.KryptoVaultApi) return emptyUser();

  try {
    const profile = await window.KryptoVaultApi.get("/api/users/me");
    return {
      name: profile?.displayName || profile?.walletAddress || "Authenticated User",
      email: profile?.email || "",
      walletAddress: profile?.walletAddress || "",
      kycStatus: normalizeKycStatus(profile?.kycStatus)
    };
  } catch (error) {
    if (error?.status === 401 || error?.status === 404) return emptyUser();
    return emptyUser();
  }
}

async function loadKycStatus() {
  if (!window.KryptoVaultApi || isDemoModeEnabled()) {
    return {
      walletAddress: state.user.walletAddress,
      kycStatus: normalizeKycStatus(state.user.kycStatus),
      verificationMethod: null,
      verifiedAt: null
    };
  }

  const status = await window.KryptoVaultApi.get("/api/kyc/status");
  state.user.kycStatus = normalizeKycStatus(status?.kycStatus);
  if (status?.walletAddress) {
    state.user.walletAddress = status.walletAddress;
  }
  renderAll();
  return status;
}

async function mockVerifyKyc() {
  const file = document.getElementById("kycFile").files[0];
  if (!file) return toast("Choose a demo identity document first.");

  if (isDemoModeEnabled()) {
    state.user.kycStatus = "VERIFIED";
    addActivity("Mock KYC verified", `${document.getElementById("kycType").value} demo KYC completed without uploading file contents`);
    saveState();
    toast("Mock KYC verified. Demo file was not uploaded.");
    return;
  }

  if (!state.user.walletAddress) {
    toast("Connect and authenticate your wallet before mock KYC.");
    return;
  }

  try {
    await window.KryptoVaultApi.post("/api/kyc/mock-verify", {
      kycStatus: "VERIFIED"
    });
    const status = await loadKycStatus();
    addActivity("Mock KYC verified", `Mock verification recorded for ${shortHash(status.walletAddress)}`);
    renderAll();
    toast("Mock KYC verified. Demo file was not uploaded.");
  } catch (error) {
    toast(error?.message || "Mock KYC verification failed.");
  }
}

async function loadOwnedAssets() {
  // Backend listing is not implemented yet. Keep this as the integration boundary.
  return [];
}

async function loadSharedAssets() {
  // Backend shared-asset listing is not implemented yet.
  return [];
}

async function loadFolders() {
  // Folder persistence is not implemented yet; folders are organizational only.
  return [];
}

async function loadAuditActivity() {
  // User-facing activity endpoints are not implemented yet.
  return [];
}

async function loadBlockchainRecords() {
  // Blockchain summary endpoints are not implemented yet.
  return [];
}

async function loadBackendState() {
  if (isDemoModeEnabled()) return;

  const [user, folders, documents, shared, activities] = await Promise.all([
    loadAuthenticatedUser(),
    loadFolders(),
    loadOwnedAssets(),
    loadSharedAssets(),
    loadAuditActivity(),
    loadBlockchainRecords()
  ]);

  state = {
    ...state,
    user,
    folders,
    documents,
    shared,
    activities
  };
  renderAll();
}

function clearAuthenticatedUser() {
  state.user = emptyUser();
  renderAll();
}

async function refreshAuthenticatedUser() {
  state.user = await loadAuthenticatedUser();
  renderAll();
  return state.user;
}

async function saveUserProfile() {
  const displayName = document.getElementById("profileName").value.trim();
  const email = document.getElementById("profileEmail").value.trim();

  if (isDemoModeEnabled()) {
    state.user.name = displayName || state.user.name;
    state.user.email = email;
    saveState();
    toast("Demo profile saved.");
    return;
  }

  if (!state.user.walletAddress) {
    toast("Connect and authenticate your wallet before saving profile.");
    return;
  }

  try {
    const profile = await window.KryptoVaultApi.patch("/api/users/me", {
      displayName,
      email
    });

    state.user = {
      name: profile?.displayName || profile?.walletAddress || "Authenticated User",
      email: profile?.email || "",
      walletAddress: profile?.walletAddress || "",
      kycStatus: normalizeKycStatus(profile?.kycStatus)
    };
    saveState();
    toast("Profile saved.");
  } catch (error) {
    toast(error?.message || "Profile could not be saved.");
    renderAccount();
  }
}

async function logoutWalletSession() {
  if (window.KryptoVaultApi) {
    try {
      await window.KryptoVaultApi.post("/api/auth/logout");
    } catch (_) {}
  }

  clearAuthenticatedUser();
}

async function requestWalletAccount() {
  if (!window.ethereum?.request) {
    throw new Error("MetaMask is required for wallet authentication.");
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) {
    throw new Error("No MetaMask account was selected.");
  }

  return accounts[0];
}

async function requestLoginChallenge() {
  if (!window.KryptoVaultApi) {
    throw new Error("API client is not available.");
  }

  return window.KryptoVaultApi.get("/api/auth/challenge");
}

async function signLoginChallenge(account, challenge) {
  if (!challenge?.message || !challenge?.nonce) {
    throw new Error("Backend returned an invalid login challenge.");
  }

  return window.ethereum.request({
    method: "personal_sign",
    params: [challenge.message, account]
  });
}

async function verifySignedChallenge(challenge, signature) {
  return window.KryptoVaultApi.post("/api/auth/verify", {
    message: challenge.message,
    nonce: challenge.nonce,
    signature
  });
}

async function authenticateWallet(account) {
  const walletAddress = account || await requestWalletAccount();
  const challenge = await requestLoginChallenge();
  const signature = await signLoginChallenge(walletAddress, challenge);
  await verifySignedChallenge(challenge, signature);
  const user = await refreshAuthenticatedUser();
  if (!window.KryptoVaultCrypto) {
    throw new Error("Document encryption identity support is not available.");
  }
  if (user.walletAddress) {
    await window.KryptoVaultCrypto.ensureDocumentEncryptionIdentityRegistered(user.walletAddress);
  }
  addActivity("Wallet authenticated", `Verified wallet session for ${shortHash(user.walletAddress)}`);
  renderAll();
  return user;
}

async function handleWalletAccountChanged(accounts) {
  if (isDemoModeEnabled()) return;

  await logoutWalletSession();

  if (!accounts?.[0]) {
    toast("MetaMask account disconnected.");
    return;
  }

  try {
    await authenticateWallet(accounts[0]);
    toast("MetaMask account changed. Session re-authenticated.");
  } catch (_) {
    await logoutWalletSession();
    toast("MetaMask account changed. Please sign in again.");
  }
}

async function handleWalletChainChanged() {
  if (isDemoModeEnabled()) return;

  await logoutWalletSession();
  toast("Network changed. Please sign in again.");
}

function registerWalletEvents() {
  if (!window.ethereum?.on) return;

  window.ethereum.on("accountsChanged", handleWalletAccountChanged);
  window.ethereum.on("chainChanged", handleWalletChainChanged);
}

window.KryptoVaultState = {
  isDemoModeEnabled,
  loadAuthenticatedUser,
  loadKycStatus,
  loadOwnedAssets,
  loadSharedAssets,
  loadFolders,
  loadAuditActivity,
  loadBlockchainRecords,
  loadBackendState
};

window.KryptoVaultAuth = {
  authenticateWallet,
  logout: logoutWalletSession,
  refreshAuthenticatedUser,
  saveUserProfile,
  mockVerifyKyc
};

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function fmtDate(ts) {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function shortHash(h) {
  if (!h) return "—";
  return `${h.slice(0, 10)}...${h.slice(-8)}`;
}
function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return "0x" + [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256File(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function addActivity(action, detail) {
  state.activities.unshift({
    id: crypto.randomUUID(),
    action, detail, time: Date.now()
  });
}
function folderName(id) {
  return state.folders.find(f => f.id === id)?.name || "Unfiled";
}

function switchPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === name));
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add("active");
  document.getElementById("pageTitle").textContent = ({
    dashboard: "Dashboard",
    documents: "My Documents",
    shared: "Shared With Me",
    folders: "Folders",
    activity: "Activity",
    blockchain: "Blockchain Records",
    account: "Account",
    security: "Security",
    settings: "Settings"
  })[name] || "KryptoVault";
}

function applyTheme() {
  const theme = state.settings?.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.checked = theme === "light";
}

function renderAll() {
  applyTheme();
  renderHeader();
  renderDashboard();
  renderDocuments();
  renderShared();
  renderFolders();
  renderActivity();
  renderBlockchain();
  renderAccount();
  renderSecurity();
  renderSettings();
  populateFolderSelect();
  if (currentDocId) renderDocumentModal();
}

function renderHeader() {
  document.getElementById("welcomeName").textContent = state.user.name;
  const kycPill = document.getElementById("kycPill");
  kycPill.textContent = `Mock KYC: ${isKycVerified() ? "Verified" : "Pending"}`;
  kycPill.classList.toggle("verified", isKycVerified());

  const walletBtn = document.getElementById("walletBtn");
  walletBtn.textContent = state.user.walletAddress
    ? `${state.user.walletAddress.slice(0, 6)}...${state.user.walletAddress.slice(-4)}`
    : "Connect Wallet";
}

function renderDashboard() {
  document.getElementById("statDocs").textContent = state.documents.length;
  document.getElementById("statShared").textContent = state.shared.length;
  const verified = state.documents.filter(d => d.verified).length;
  document.getElementById("statVerified").textContent = `${verified}/${state.documents.length}`;
  document.getElementById("statStorage").textContent = fmtSize(state.documents.reduce((a, d) => a + d.size, 0));
  document.getElementById("recentDocs").innerHTML = documentsTable(state.documents.slice(0, 5), true);
}

function documentsTable(docs, compact = false) {
  if (!docs.length) return `<div class="empty-state">No documents yet.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>Folder</th><th>Access</th><th>Uploaded</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${docs.map(d => `
            <tr>
              <td><span class="file-name">${escapeHtml(d.name)}</span><br><span class="muted">${fmtSize(d.size)}</span></td>
              <td><span class="badge ${d.verified ? "green" : "red"}">${d.verified ? "Verified ✓" : "Unverified"}</span></td>
              <td>${escapeHtml(folderName(d.folderId))}</td>
              <td>${d.permissions.filter(p => p.active).length ? `${d.permissions.filter(p=>p.active).length} user(s)` : "Private"}</td>
              <td>${fmtDate(d.createdAt)}</td>
              <td class="actions-cell">
                <button class="btn secondary small" onclick="openDocument('${d.id}')">Open</button>
                ${compact ? "" : `<button class="btn ghost small" onclick="moveDocument('${d.id}')">Move</button>`}
                ${compact ? "" : `<button class="btn ghost small" onclick="openShare('${d.id}')">Share</button>`}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDocuments() {
  const q = (document.getElementById("docSearch")?.value || "").toLowerCase();
  const docs = state.documents.filter(d => d.name.toLowerCase().includes(q));
  document.getElementById("documentsList").innerHTML = documentsTable(docs);
}

function renderShared() {
  const el = document.getElementById("sharedList");
  if (!state.shared.length) {
    el.innerHTML = `<div class="empty-state">Nothing has been shared with this demo user yet.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Document</th><th>Owner</th><th>Permission</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${state.shared.map(s => `
            <tr>
              <td class="file-name">${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.owner)}</td>
              <td><span class="badge blue">${s.access}</span></td>
              <td>${fmtDate(s.expiresAt)}</td>
              <td><span class="badge green">Verified ✓</span></td>
              <td><button class="btn secondary small" onclick="simulateSharedOpen('${s.id}')">Open</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFolders() {
  const el = document.getElementById("foldersGrid");
  if (!state.folders.length) {
    el.innerHTML = `<div class="empty-state">No folders yet. Create your first folder.</div>`;
    return;
  }
  el.innerHTML = state.folders.map(f => {
    const count = state.documents.filter(d => d.folderId === f.id).length;
    return `
      <button class="folder-card" type="button" onclick="openFolder('${f.id}')">
        <div class="folder-icon">📁</div>
        <strong>${escapeHtml(f.name)}</strong>
        <small>${count} document${count === 1 ? "" : "s"}</small>
        <span class="folder-open-label">Open folder →</span>
      </button>
    `;
  }).join("");
}

window.openFolder = function(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  const docs = state.documents.filter(d => d.folderId === folderId);
  document.getElementById("folderViewTitle").textContent = folder.name;
  document.getElementById("folderViewMeta").textContent = `${docs.length} document${docs.length === 1 ? "" : "s"}`;
  document.getElementById("folderDocuments").innerHTML = documentsTable(docs);
  openModal("folderViewModal");
};

function renderActivity() {
  const el = document.getElementById("activityTimeline");
  if (!state.activities.length) {
    el.innerHTML = `<div class="empty-state">No activity yet.</div>`;
    return;
  }
  el.innerHTML = state.activities.map(a => `
    <div class="timeline-item">
      <div class="timeline-time">${fmtDate(a.time)}</div>
      <div class="timeline-line"><div class="timeline-dot"></div></div>
      <div class="timeline-content"><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.detail)}</span></div>
    </div>
  `).join("");
}

function renderBlockchain() {
  const el = document.getElementById("blockchainList");
  if (!state.documents.length) {
    el.innerHTML = `<div class="empty-state">No blockchain records.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Document</th><th>Owner</th><th>Hash</th><th>Transaction</th><th>Block</th><th>Status</th></tr></thead>
        <tbody>
          ${state.documents.map(d => `
            <tr>
              <td class="file-name">${escapeHtml(d.name)}</td>
              <td>${state.user.walletAddress ? shortHash(state.user.walletAddress) : "Demo Owner"}</td>
              <td class="hash-text">${shortHash(d.hash)}</td>
              <td class="hash-text">${shortHash(d.txHash)}</td>
              <td>${d.blockNumber}</td>
              <td><span class="badge green">Confirmed</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAccount() {
  document.getElementById("profileName").value = state.user.name;
  document.getElementById("profileEmail").value = state.user.email;
  document.getElementById("profileWallet").value = state.user.walletAddress || "Not connected";
  document.getElementById("kycDescription").textContent = isKycVerified()
    ? "Mock KYC verified for this demo account."
    : "Select a demo document, then run mock KYC. The file is never uploaded.";
}

function calculateSecurityScore() {
  let score = 30; // Base score for SHA-256 integrity + protected workflow.
  if (isKycVerified()) score += 20;
  if (state.user.walletAddress) score += 20;
  if (state.settings.requireKyc) score += 10;
  if (state.settings.requireWallet) score += 10;
  if (!state.documents.length || state.documents.every(d => d.verified && !d.tampered)) score += 10;
  return Math.min(score, 100);
}

function renderSecurity() {
  const kyc = document.getElementById("securityKycStatus");
  const wallet = document.getElementById("securityWalletStatus");
  const hash = document.getElementById("securityHashStatus");
  const docs = document.getElementById("securityDocumentStatus");
  const scoreEl = document.getElementById("securityScore");
  const scoreText = document.getElementById("securityScoreText");
  if (!kyc || !wallet || !hash || !docs || !scoreEl || !scoreText) return;

  const kycVerified = isKycVerified();
  kyc.textContent = kycVerified
    ? "Mock KYC verified"
    : "Mock KYC pending";
  kyc.parentElement?.classList.toggle("secure", kycVerified);
  kyc.parentElement?.classList.toggle("warning", !kycVerified);

  const walletConnected = !!state.user.walletAddress;
  wallet.textContent = walletConnected
    ? `✓ Connected: ${shortHash(state.user.walletAddress)}`
    : "⚠ Wallet not connected";
  wallet.parentElement?.classList.toggle("secure", walletConnected);
  wallet.parentElement?.classList.toggle("warning", !walletConnected);

  hash.textContent = "✓ SHA-256 browser verification active";
  hash.parentElement?.classList.add("secure");

  const verifiedDocs = state.documents.filter(d => d.verified && !d.tampered).length;
  const documentsSecure = !state.documents.length || verifiedDocs === state.documents.length;
  docs.textContent = `${verifiedDocs}/${state.documents.length} documents currently verified`;
  docs.parentElement?.classList.toggle("secure", documentsSecure);
  docs.parentElement?.classList.toggle("warning", !documentsSecure);

  const score = calculateSecurityScore();
  scoreEl.textContent = `${score}%`;
  scoreText.textContent = score >= 90
    ? "Strong protection"
    : score >= 70
      ? "Good protection"
      : "Security setup incomplete";

  const fill = document.getElementById("securityScoreFill");
  if (fill) fill.style.width = `${score}%`;
}

function renderSettings() {
  document.getElementById("requireKyc").checked = !!state.settings.requireKyc;
  document.getElementById("requireWallet").checked = !!state.settings.requireWallet;
  document.getElementById("showProgress").checked = !!state.settings.showProgress;
}

function populateFolderSelect() {
  const sel = document.getElementById("uploadFolder");
  sel.innerHTML = state.folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
}

function resetUploadModal() {
  selectedUploadFile = null;
  document.getElementById("uploadFile").value = "";
  document.getElementById("selectedFileLabel").textContent = "No file selected";
  document.getElementById("uploadPassword").value = "";
  document.getElementById("uploadStepForm").classList.remove("hidden");
  document.getElementById("uploadProgress").classList.add("hidden");
  document.getElementById("uploadSuccess").classList.add("hidden");
}

async function startSecureUpload() {
  const file = selectedUploadFile;
  if (!file) return toast("Choose a file first.");

  document.getElementById("uploadStepForm").classList.add("hidden");
  document.getElementById("uploadProgress").classList.remove("hidden");

  const steps = [
    "Reading file metadata",
    "Generating SHA-256 fingerprint",
    "Simulating AES-256 encryption layer",
    "Saving protected file record",
    "Registering mock blockchain ownership",
    "Completing audit log"
  ];

  const progressEl = document.getElementById("progressSteps");
  progressEl.innerHTML = steps.map((s, i) => `<div class="progress-step" id="prog-${i}"><span class="marker">○</span><span>${s}</span></div>`).join("");

  let hash = "";
  for (let i = 0; i < steps.length; i++) {
    const row = document.getElementById(`prog-${i}`);
    row.classList.add("active");
    row.querySelector(".marker").textContent = "…";

    if (i === 1) hash = await sha256File(file);
    await delay(state.settings.showProgress ? 420 : 50);

    row.classList.remove("active");
    row.classList.add("done");
    row.querySelector(".marker").textContent = "✓";
  }

  const doc = {
    id: `doc-${Date.now()}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    folderId: document.getElementById("uploadFolder").value,
    accessType: document.getElementById("uploadAccess").value,
    hash,
    verified: true,
    txHash: randomHex(32),
    blockNumber: 190000 + Math.floor(Math.random() * 9999),
    createdAt: Date.now(),
    permissions: []
  };

  state.documents.unshift(doc);
  addActivity("Document uploaded", `${doc.name} added to protected storage`);
  addActivity("Blockchain proof registered", `${doc.name} fingerprint ${shortHash(doc.hash)} recorded`);
  saveState();

  document.getElementById("uploadProgress").classList.add("hidden");
  document.getElementById("uploadSuccess").classList.remove("hidden");
  document.getElementById("successHash").textContent = hash;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.openDocument = function(id) {
  currentDocId = id;
  renderDocumentModal();
  openModal("documentModal");
};

function renderDocumentModal() {
  const d = state.documents.find(x => x.id === currentDocId);
  if (!d) return;
  document.getElementById("docModalName").textContent = d.name;

  document.getElementById("doc-tab-overview").innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Status</span><strong>Verified ✓</strong></div>
      <div class="detail-card"><span>Folder</span><strong>${escapeHtml(folderName(d.folderId))}</strong></div>
      <div class="detail-card"><span>File Size</span><strong>${fmtSize(d.size)}</strong></div>
      <div class="detail-card"><span>Uploaded</span><strong>${fmtDate(d.createdAt)}</strong></div>
      <div class="detail-card" style="grid-column:1/-1"><span>SHA-256 Fingerprint</span><code>${d.hash}</code></div>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn secondary" onclick="verifyIntegrity('${d.id}')">Verify Integrity</button>
      <button class="btn primary" onclick="openShare('${d.id}')">Share</button>
      <button class="btn ghost" onclick="simulateTamper('${d.id}')">Simulate Tampering</button>
    </div>
    <div class="inline-note" style="margin-top:14px">
      This demo does not upload plaintext file bytes to a server. It calculates a real SHA-256 hash in your browser and keeps mock records local to explicit demo mode.
    </div>
  `;

  const activePerms = d.permissions.filter(p => p.active);
  document.getElementById("doc-tab-access").innerHTML = activePerms.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>User</th><th>Recipient</th><th>Role</th><th>Expires</th><th></th></tr></thead>
        <tbody>
          ${activePerms.map(p => `
            <tr>
              <td class="file-name">${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.recipient)}</td>
              <td><span class="badge blue">${p.role}</span></td>
              <td>${fmtDate(p.expiresAt)}</td>
              <td><button class="btn danger small" onclick="openRevoke('${d.id}','${p.id}')">Revoke</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="empty-state">This document is private. <br><br><button class="btn primary" onclick="openShare('${d.id}')">Grant Access</button></div>`;

  const acts = state.activities.filter(a => a.detail.includes(d.name));
  document.getElementById("doc-tab-activity").innerHTML = acts.length
    ? acts.map(a => `<div class="detail-card" style="margin-bottom:8px"><strong>${escapeHtml(a.action)}</strong><br><span class="muted">${escapeHtml(a.detail)} • ${fmtDate(a.time)}</span></div>`).join("")
    : `<div class="empty-state">No document-specific activity yet.</div>`;

  document.getElementById("doc-tab-blockchain").innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Record Status</span><strong>Confirmed</strong></div>
      <div class="detail-card"><span>Block Number</span><strong>${d.blockNumber}</strong></div>
      <div class="detail-card" style="grid-column:1/-1"><span>Transaction Hash</span><code>${d.txHash}</code></div>
      <div class="detail-card" style="grid-column:1/-1"><span>Document Hash</span><code>${d.hash}</code></div>
    </div>
  `;
}

window.openShare = function(docId) {
  currentDocId = docId;
  if (state.settings.requireKyc && !isKycVerified()) {
    toast("Demo policy: complete KYC before sharing.");
    switchPage("account");
    return;
  }
  if (state.settings.requireWallet && !state.user.walletAddress) {
    toast("Demo policy: connect wallet before blockchain actions.");
    return;
  }
  document.getElementById("shareName").value = "";
  document.getElementById("shareRecipient").value = "";
  document.getElementById("shareReason").value = "";
  openModal("shareModal");
};

function grantAccess() {
  const d = state.documents.find(x => x.id === currentDocId);
  if (!d) return;
  const name = document.getElementById("shareName").value.trim();
  const recipient = document.getElementById("shareRecipient").value.trim();
  if (!name || !recipient) return toast("Enter recipient name and email/wallet.");

  const duration = Number(document.getElementById("shareDuration").value);
  const p = {
    id: crypto.randomUUID(),
    name,
    recipient,
    wallet: recipient.startsWith("0x") ? recipient : randomHex(20),
    role: document.getElementById("shareRole").value,
    expiresAt: duration ? Date.now() + duration * 86400000 : null,
    reason: document.getElementById("shareReason").value.trim(),
    active: true
  };
  d.permissions.push(p);
  d.txHash = randomHex(32);
  addActivity("Access granted", `${name} received ${p.role} access to ${d.name}`);
  addActivity("Blockchain permission recorded", `Mock permission transaction created for ${d.name}`);
  closeModal("shareModal");
  saveState();
  toast("Access granted and mock transaction recorded.");
}

window.openRevoke = function(docId, permId) {
  const d = state.documents.find(x => x.id === docId);
  const p = d?.permissions.find(x => x.id === permId);
  if (!d || !p) return;
  pendingRevoke = { docId, permId };
  document.getElementById("revokeText").textContent = `Revoke ${p.name}'s access to ${d.name}?`;
  openModal("revokeModal");
};

function confirmRevoke() {
  if (!pendingRevoke) return;
  const d = state.documents.find(x => x.id === pendingRevoke.docId);
  const p = d?.permissions.find(x => x.id === pendingRevoke.permId);
  if (!d || !p) return;
  p.active = false;
  const mode = document.querySelector('input[name="revokeMode"]:checked').value;
  addActivity("Access revoked", `${p.name} lost access to ${d.name}`);
  if (mode === "strong") {
    addActivity("Encryption key rotated", `Strong revocation simulated for ${d.name}`);
  }
  d.txHash = randomHex(32);
  closeModal("revokeModal");
  saveState();
  toast(mode === "strong" ? "Access revoked + key rotation simulated." : "Access revoked.");
}

window.verifyIntegrity = function(docId) {
  const d = state.documents.find(x => x.id === docId);
  if (!d) return;
  toast(d.tampered ? "Integrity FAILED: hash mismatch detected." : "Integrity verified: blockchain hash matches.");
  addActivity(d.tampered ? "Integrity check failed" : "Integrity verified", `${d.name} ${d.tampered ? "hash mismatch detected" : "matched its recorded fingerprint"}`);
  saveState();
};

window.simulateTamper = function(docId) {
  const d = state.documents.find(x => x.id === docId);
  if (!d) return;
  d.tampered = !d.tampered;
  addActivity(d.tampered ? "Tampering simulated" : "Tampering simulation cleared", `${d.name} demo integrity state changed`);
  saveState();
  toast(d.tampered ? "Tamper mode ON. Integrity checks will fail." : "Tamper mode cleared.");
};

window.simulateSharedOpen = async function(sharedId) {
  const s = state.shared.find(x => x.id === sharedId);
  if (!s) return;
  toast("Checking wallet → permission → decryption simulation...");
  await delay(800);
  addActivity("Shared document opened", `${s.name} opened after simulated access verification`);
  saveState();
  toast("Access granted. Document decryption simulated.");
};

window.moveDocument = function(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;
  currentDocId = docId;
  const select = document.getElementById("moveFolderSelect");
  select.innerHTML = state.folders.map(folder => `
    <option value="${folder.id}" ${folder.id === doc.folderId ? "selected" : ""}>${escapeHtml(folder.name)}</option>
  `).join("");
  document.getElementById("moveDocumentName").textContent = doc.name;
  openModal("moveFolderModal");
};

function confirmMoveDocument() {
  const doc = state.documents.find(d => d.id === currentDocId);
  if (!doc) return;
  const newFolderId = document.getElementById("moveFolderSelect").value;
  if (!newFolderId) return toast("Choose a folder.");
  const oldFolder = folderName(doc.folderId);
  doc.folderId = newFolderId;
  addActivity("Document moved", `${doc.name} moved from ${oldFolder} to ${folderName(newFolderId)}`);
  closeModal("moveFolderModal");
  saveState();
  toast("Document moved successfully.");
}

function createFolder() {
  const name = document.getElementById("folderNameInput").value.trim();
  if (!name) return toast("Enter a folder name.");
  state.folders.push({ id: `folder-${Date.now()}`, name, createdAt: Date.now() });
  document.getElementById("folderNameInput").value = "";
  closeModal("folderModal");
  addActivity("Folder created", `${name} created`);
  saveState();
}

async function connectWallet() {
  if (window.ethereum?.request && !isDemoModeEnabled()) {
    try {
      const user = await authenticateWallet();
      saveState();
      toast(`Wallet authenticated: ${shortHash(user.walletAddress)}`);
      return;
    } catch (err) {
      await logoutWalletSession();
      toast(err?.message || "Wallet authentication was cancelled.");
      return;
    }
  }

  if (!isDemoModeEnabled()) {
    toast("MetaMask is required for wallet authentication.");
    return;
  }

  // Explicit demo fallback so the site can be presented without MetaMask.
  state.user.walletAddress = randomHex(20);
  addActivity("Demo wallet connected", `Generated demo wallet ${shortHash(state.user.walletAddress)}`);
  saveState();
  toast("MetaMask not found — connected a demo wallet instead.");
}

function verifyKyc() {
  mockVerifyKyc();
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  loadBackendState();
  registerWalletEvents();

  document.getElementById("themeToggle")?.addEventListener("change", e => {
    state.settings.theme = e.target.checked ? "light" : "dark";
    saveState();
    toast(e.target.checked ? "Light mode enabled." : "Dark mode enabled.");
  });

  document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.page)));
  document.querySelectorAll("[data-page-jump]").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.pageJump)));
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => closeModal(btn.dataset.close)));

  document.getElementById("openUploadBtn").addEventListener("click", () => { resetUploadModal(); openModal("uploadModal"); });
  document.getElementById("uploadFromDocs").addEventListener("click", () => { resetUploadModal(); openModal("uploadModal"); });
  document.getElementById("secureUploadBtn").addEventListener("click", startSecureUpload);
  document.getElementById("closeUploadSuccess").addEventListener("click", () => { closeModal("uploadModal"); switchPage("documents"); });

  const uploadInput = document.getElementById("uploadFile");
  uploadInput.addEventListener("change", () => {
    selectedUploadFile = uploadInput.files[0] || null;
    document.getElementById("selectedFileLabel").textContent = selectedUploadFile ? `${selectedUploadFile.name} • ${fmtSize(selectedUploadFile.size)}` : "No file selected";
  });

  const drop = document.getElementById("dropZone");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragging"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("dragging");
    selectedUploadFile = e.dataTransfer.files[0] || null;
    document.getElementById("selectedFileLabel").textContent = selectedUploadFile ? `${selectedUploadFile.name} • ${fmtSize(selectedUploadFile.size)}` : "No file selected";
  });

  document.getElementById("walletBtn").addEventListener("click", connectWallet);
  document.getElementById("verifyKycBtn").addEventListener("click", verifyKyc);
  document.getElementById("grantAccessBtn").addEventListener("click", grantAccess);
  document.getElementById("confirmRevokeBtn").addEventListener("click", confirmRevoke);

  document.getElementById("newFolderBtn").addEventListener("click", () => openModal("folderModal"));
  document.getElementById("createFolderBtn").addEventListener("click", createFolder);
  document.getElementById("confirmMoveFolderBtn").addEventListener("click", confirmMoveDocument);

  document.getElementById("docSearch").addEventListener("input", renderDocuments);

  document.querySelectorAll("[data-doc-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-doc-tab]").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".doc-tab").forEach(p => p.classList.remove("active"));
      document.getElementById(`doc-tab-${tab.dataset.docTab}`).classList.add("active");
    });
  });

  document.getElementById("saveProfileBtn").addEventListener("click", saveUserProfile);

  ["requireKyc","requireWallet","showProgress"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      state.settings[id] = e.target.checked;
      saveState();
    });
  });

  document.getElementById("clearActivityBtn").addEventListener("click", () => {
    state.activities = [];
    saveState();
  });

  document.getElementById("seedDemoBtn").addEventListener("click", () => {
    setDemoModeEnabled(true);
    state = { ...initialState(), settings: { ...defaultPreferences(), ...loadPreferences() } };
    saveState();
    toast("Demo data restored.");
  });

  document.getElementById("resetAllBtn").addEventListener("click", () => {
    setDemoModeEnabled(false);
    state = { ...emptyAppData(), settings: { ...defaultPreferences(), ...loadPreferences() } };
    saveState();
    toast("Workspace reset.");
  });

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
});
