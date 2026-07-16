(() => {
  "use strict";

  // Some deployment pipelines rename or execute this browser bundle as
  // server.js. In Node, hand off to the real Express application before any
  // browser globals are accessed.
  if (typeof window === "undefined") {
    const { app } = require("./server (1).js");
    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => console.log(`Server running on port ${port}`));
    server.keepAliveTimeout = 10 * 60 * 1000;
    server.headersTimeout = 10 * 60 * 1000 + 1000;
    server.requestTimeout = 0;
    return;
  }

  const PRODUCTION_API = "https://api.zixy.lol";
  const API_BASE = window.WHISKR_API_URL || (location.protocol === "file:" ? PRODUCTION_API : location.origin);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const anonymousClientId = localStorage.getItem("whiskr_client_id") || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  localStorage.setItem("whiskr_client_id", anonymousClientId);
  localStorage.removeItem("whiskr_nickname");
  let savedVideoIds = [];
  let locallyLikedIds = [];
  let locallyStoredComments = {};
  let locallyStoredReplies = {};
  let locallyStoredVideoTypes = {};
  try { savedVideoIds = JSON.parse(localStorage.getItem("whiskr_saved") || "[]"); } catch { savedVideoIds = []; }
  try { locallyLikedIds = JSON.parse(localStorage.getItem("whiskr_local_likes") || "[]"); } catch { locallyLikedIds = []; }
  try { locallyStoredComments = JSON.parse(localStorage.getItem("whiskr_local_comments") || "{}"); } catch { locallyStoredComments = {}; }
  try { locallyStoredReplies = JSON.parse(localStorage.getItem("whiskr_local_replies") || "{}"); } catch { locallyStoredReplies = {}; }
  try { locallyStoredVideoTypes = JSON.parse(localStorage.getItem("whiskr_video_types") || "{}"); } catch { locallyStoredVideoTypes = {}; }

  const state = {
    mode: "long",
    feeds: { long: [], short: [] },
    loaded: { long: false, short: false },
    loading: { long: false, short: false },
    query: "",
    currentVideo: null,
    commentsVideo: null,
    nickname: "",
    pendingComment: null,
    pendingReply: null,
    saved: new Set(Array.isArray(savedVideoIds) ? savedVideoIds : []),
    localLikes: new Set(Array.isArray(locallyLikedIds) ? locallyLikedIds : []),
    localComments: locallyStoredComments && typeof locallyStoredComments === "object" ? locallyStoredComments : {},
    localReplies: locallyStoredReplies && typeof locallyStoredReplies === "object" ? locallyStoredReplies : {},
    videoTypes: locallyStoredVideoTypes && typeof locallyStoredVideoTypes === "object" ? locallyStoredVideoTypes : {},
    shortTab: "for-you",
    drawerTrigger: null,
    thumbnailFrames: [],
    selectedThumbnail: null,
    selectedThumbnailSource: null,
    thumbnailGenerationToken: 0,
    muted: localStorage.getItem("whiskr_muted") !== "false",
    shortObserver: null,
    viewed: new Set()
  };

  const els = {
    longView: $("#longView"), shortsView: $("#shortsView"), liveView: $("#liveView"), watchView: $("#watchView"),
    videoGrid: $("#videoGrid"), shortsFeed: $("#shortsFeed"), longStatus: $("#longStatus"),
    modeButtons: $$("[data-mode-target]"), searchInput: $("#searchInput"), searchForm: $("#searchForm"),
    nicknameDialog: $("#nicknameDialog"), nicknameForm: $("#nicknameForm"), nicknameError: $("#nicknameError"),
    uploadDialog: $("#uploadDialog"), uploadForm: $("#uploadForm"), uploadError: $("#uploadError"),
    thumbnailGenerator: $("#thumbnailGenerator"), thumbnailOptions: $("#thumbnailOptions"),
    commentsDrawer: $("#commentsDrawer"), drawerBackdrop: $("#drawerBackdrop"),
    drawerCommentsList: $("#drawerCommentsList"), drawerCommentCount: $("#drawerCommentCount"),
    watchPlayer: $("#watchPlayer"), watchTitle: $("#watchTitle"), watchDescription: $("#watchDescription"),
    watchLikeButton: $("#watchLikeButton"), watchCommentCount: $("#watchCommentCount"),
    watchCommentsList: $("#watchCommentsList"), relatedVideos: $("#relatedVideos"),
    toastRegion: $("#toastRegion")
  };

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function initials(value = "W") {
    return String(value).trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "W";
  }

  function formatCount(value = 0) {
    const count = Number(value) || 0;
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1).replace(".0", "")}K`;
    return String(count);
  }

  function formatDuration(seconds) {
    const duration = Math.max(0, Math.floor(Number(seconds) || 0));
    if (!duration) return "";
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const secs = duration % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function relativeTime(timestamp) {
    if (!timestamp || Number(timestamp) < 946_684_800_000) return "Recently";
    const elapsed = Math.max(0, Date.now() - Number(timestamp));
    const units = [[31_536_000_000, "year"], [2_592_000_000, "month"], [604_800_000, "week"], [86_400_000, "day"], [3_600_000, "hour"], [60_000, "minute"]];
    for (const [size, label] of units) {
      if (elapsed >= size) {
        const value = Math.floor(elapsed / size);
        return `${value} ${label}${value === 1 ? "" : "s"} ago`;
      }
    }
    return "Just now";
  }

  function videoUrl(id) { return `${API_BASE}/${encodeURIComponent(id)}/video`; }
  function thumbnailUrl(id) { return `${API_BASE}/${encodeURIComponent(id)}/thumbnail`; }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (method !== "GET" && method !== "HEAD" && body == null) body = { clientId: anonymousClientId };
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      body = { ...body, clientId: anonymousClientId };
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    if (method === "GET" || method === "HEAD") {
      path += `${path.includes("?") ? "&" : "?"}clientId=${encodeURIComponent(anonymousClientId)}`;
    }
    const response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, body });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function normalizeVideo(raw) {
    const stats = raw.stats || {};
    const id = String(raw.id);
    const explicitType = ["short", "long"].includes(raw.type) ? raw.type : (["short", "long"].includes(raw.kind) ? raw.kind : null);
    const type = state.videoTypes[id] || explicitType || "long";
    const locallyLiked = state.localLikes.has(id);
    const localCommentCount = countLocalComments(id);
    return {
      id,
      title: raw.title || "Untitled video",
      description: raw.description || "",
      type: type === "short" ? "short" : "long",
      needsTypeDetection: !state.videoTypes[id] && !explicitType,
      uploadedAt: raw.uploadedAt || 0,
      duration: raw.duration || 0,
      stats: {
        likes: Number(stats.likes ?? raw.likeCount ?? 0) + (locallyLiked && !raw.liked ? 1 : 0),
        comments: Number(stats.comments ?? raw.commentCount ?? 0) + localCommentCount,
        views: Number(stats.views ?? raw.viewCount ?? 0)
      },
      liked: Boolean(raw.liked || locallyLiked)
    };
  }

  function useLocalFallback(error) {
    return !error?.status || [404, 405, 501].includes(error.status);
  }

  function persistLocalLikes() {
    localStorage.setItem("whiskr_local_likes", JSON.stringify([...state.localLikes]));
  }

  function persistLocalComments() {
    localStorage.setItem("whiskr_local_comments", JSON.stringify(state.localComments));
  }

  function persistLocalReplies() {
    localStorage.setItem("whiskr_local_replies", JSON.stringify(state.localReplies));
  }

  function countLocalComments(videoId) {
    const topLevel = Array.isArray(state.localComments[videoId]) ? state.localComments[videoId].length : 0;
    const replyGroups = state.localReplies[videoId] && typeof state.localReplies[videoId] === "object"
      ? Object.values(state.localReplies[videoId])
      : [];
    return topLevel + replyGroups.reduce((total, replies) => total + (Array.isArray(replies) ? replies.length : 0), 0);
  }

  function mergeLocalReplies(videoId, comments) {
    const groups = state.localReplies[videoId] || {};
    return comments.map(comment => ({
      ...comment,
      replies: [...(Array.isArray(groups[comment.id]) ? groups[comment.id] : []), ...(Array.isArray(comment.replies) ? comment.replies : [])]
    }));
  }

  function rememberVideoType(videoId, type) {
    if (!videoId) return;
    state.videoTypes[String(videoId)] = type === "short" ? "short" : "long";
    localStorage.setItem("whiskr_video_types", JSON.stringify(state.videoTypes));
  }

  function detectVideoType(video) {
    if (!video.needsTypeDetection) return Promise.resolve();
    return new Promise(resolve => {
      const probe = document.createElement("video");
      let settled = false;
      const finish = detectedType => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        probe.removeAttribute("src");
        probe.load();
        if (detectedType) {
          video.type = detectedType;
          video.needsTypeDetection = false;
          rememberVideoType(video.id, detectedType);
        }
        resolve();
      };
      const timeout = setTimeout(() => finish(null), 5000);
      probe.preload = "metadata";
      probe.muted = true;
      probe.playsInline = true;
      probe.addEventListener("loadedmetadata", () => finish(probe.videoHeight > probe.videoWidth ? "short" : "long"), { once: true });
      probe.addEventListener("error", () => finish(null), { once: true });
      probe.src = videoUrl(video.id);
      probe.load();
    });
  }

  function findVideo(id) {
    return [...state.feeds.long, ...state.feeds.short].find(video => video.id === id) || null;
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 3300);
  }

  function showSkeletons() {
    els.longStatus.innerHTML = "";
    els.videoGrid.innerHTML = Array.from({ length: 8 }, () => `
      <article class="skeleton-card">
        <div class="thumbnail"></div>
        <div class="card-body"><div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>
      </article>`).join("");
  }

  async function loadFeed(type, { refresh = false } = {}) {
    if (state.loading[type] || (state.loaded[type] && !refresh)) return state.feeds[type];
    state.loading[type] = true;
    if (type === "long") showSkeletons();
    else els.shortsFeed.innerHTML = `<div class="shorts-empty"><div class="empty-state"><p>Loading Shorts…</p></div></div>`;

    try {
      const data = await api(`/feed?type=${type}&limit=50`);
      const normalizedVideos = (data.feed || []).map(normalizeVideo);
      await Promise.allSettled(normalizedVideos.map(detectVideoType));
      const videos = normalizedVideos.filter(video => video.type === type);
      state.feeds[type] = videos;
      state.loaded[type] = true;
      if (type === "long") renderLongFeed();
      else renderShortsFeed();
      return videos;
    } catch (error) {
      if (type === "long") {
        els.videoGrid.innerHTML = "";
        els.longStatus.innerHTML = emptyState("refresh", "Couldn’t load videos", error.message, "Try again", "refresh");
      } else {
        els.shortsFeed.innerHTML = `<div class="shorts-empty">${emptyState("refresh", "Couldn’t load Shorts", error.message, "Try again", "refresh-shorts")}</div>`;
      }
      return [];
    } finally {
      state.loading[type] = false;
    }
  }

  function emptyState(iconName, title, copy, buttonLabel = "", action = "") {
    return `<div class="empty-state"><div class="empty-icon">${icon(iconName)}</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(copy)}</p>${buttonLabel ? `<button type="button" data-empty-action="${action}">${escapeHTML(buttonLabel)}</button>` : ""}</div>`;
  }

  function filteredLongVideos() {
    const query = state.query.trim().toLowerCase();
    if (!query || query === "recently uploaded") return state.feeds.long;
    return state.feeds.long.filter(video => `${video.title} ${video.description}`.toLowerCase().includes(query));
  }

  function renderLongFeed() {
    const videos = filteredLongVideos();
    els.longStatus.innerHTML = "";
    if (!videos.length) {
      els.videoGrid.innerHTML = "";
      els.longStatus.innerHTML = state.feeds.long.length
        ? emptyState("search", "No matches", `Nothing in your feed matches “${state.query}”.`, "Clear search", "clear-search")
        : emptyState("upload", "Your stage is ready", "Upload the first long-form video and it’ll appear here.", "Upload a video", "upload");
      return;
    }

    els.videoGrid.innerHTML = videos.map((video, index) => {
      const duration = formatDuration(video.duration);
      return `<article class="video-card" data-video-id="${escapeHTML(video.id)}" tabindex="0" style="animation-delay:${Math.min(index * 35, 280)}ms">
        <div class="thumbnail">
          <img src="${thumbnailUrl(video.id)}" alt="" loading="lazy">
          ${duration ? `<span class="duration">${duration}</span>` : ""}
          <div class="hover-play"><span>${icon("play")}</span></div>
        </div>
        <div class="card-body">
          <div><h2 class="card-title">${escapeHTML(video.title)}</h2><span class="card-stats">${formatCount(video.stats.views)} views · ${relativeTime(video.uploadedAt)}</span></div>
          <button class="card-menu" type="button" aria-label="More options">${icon("more")}</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderShortsFeed() {
    cleanupShortObserver();
    if (!state.feeds.short.length) {
      els.shortsFeed.innerHTML = `<div class="shorts-empty">${emptyState("shorts", "Shorts start here", "Upload a vertical clip to create a separate swipeable Shorts feed.", "Upload a Short", "upload-short")}</div>`;
      return;
    }
    const videos = state.shortTab === "latest"
      ? [...state.feeds.short].sort((a, b) => b.uploadedAt - a.uploadedAt)
      : state.feeds.short;
    els.shortsFeed.innerHTML = videos.map(video => `
      <article class="short-slide" data-video-id="${escapeHTML(video.id)}">
        <div class="short-stage">
          <video class="short-video" src="${videoUrl(video.id)}" poster="${thumbnailUrl(video.id)}" preload="metadata" loop playsinline ${state.muted ? "muted" : ""}></video>
          <img class="short-poster" src="${thumbnailUrl(video.id)}" alt="">
          <button class="short-center-control" type="button" aria-label="Play video">${icon("play")}</button>
          <p class="short-playback-error" role="status" aria-live="polite"></p>
          <div class="short-top-controls"><button type="button" data-short-action="mute" aria-label="${state.muted ? "Unmute" : "Mute"}">${icon(state.muted ? "muted" : "volume")}</button></div>
          <div class="short-info">
            <p class="short-caption">${escapeHTML(video.title)}${video.description ? ` · ${escapeHTML(video.description)}` : ""}</p>
            <div class="short-sound"><span class="sound-disc"></span><span>original audio</span></div>
          </div>
          <div class="short-progress"><span></span></div>
        </div>
        <div class="short-actions">
          <button class="short-action ${video.liked ? "liked" : ""}" type="button" data-short-action="like" aria-label="Like video" aria-pressed="${video.liked}"><span class="action-icon">${icon("heart")}</span><span data-count>${formatCount(video.stats.likes)}</span></button>
          <button class="short-action" type="button" data-short-action="comments" aria-label="Open comments"><span class="action-icon">${icon("comment")}</span><span data-count>${formatCount(video.stats.comments)}</span></button>
          <button class="short-action ${state.saved.has(video.id) ? "liked" : ""}" type="button" data-short-action="bookmark" aria-label="Save video" aria-pressed="${state.saved.has(video.id)}"><span class="action-icon">${icon("bookmark")}</span><span>Save</span></button>
          <button class="short-action" type="button" data-short-action="share" aria-label="Share video"><span class="action-icon">${icon("share")}</span><span>Share</span></button>
        </div>
      </article>`).join("");
    setupShorts();
  }

  function cleanupShortObserver() {
    state.shortObserver?.disconnect();
    state.shortObserver = null;
    $$(".short-video").forEach(video => video.pause());
  }

  function syncShortMuteUI() {
    localStorage.setItem("whiskr_muted", String(state.muted));
    $$(".short-video", els.shortsFeed).forEach(video => { video.muted = state.muted; });
    $$('[data-short-action="mute"]', els.shortsFeed).forEach(button => {
      button.innerHTML = icon(state.muted ? "muted" : "volume");
      button.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
    });
  }

  function activeShortSlide() {
    const feedBounds = els.shortsFeed.getBoundingClientRect();
    let bestSlide = null;
    let bestVisibleHeight = -1;
    $$(".short-slide", els.shortsFeed).forEach(slide => {
      const bounds = slide.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, feedBounds.bottom) - Math.max(bounds.top, feedBounds.top));
      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        bestSlide = slide;
      }
    });
    return bestSlide;
  }

  function setShortPlaybackError(slide, message = "This video could not be played.") {
    const stage = $(".short-stage", slide);
    const center = $(".short-center-control", slide);
    const status = $(".short-playback-error", slide);
    stage.classList.remove("playing");
    stage.classList.add("playback-error");
    center.classList.add("visible");
    center.tabIndex = 0;
    center.setAttribute("aria-label", "Retry video");
    status.textContent = `${message} Select play to retry.`;
  }

  function clearShortPlaybackError(slide) {
    $(".short-stage", slide).classList.remove("playback-error");
    $(".short-playback-error", slide).textContent = "";
  }

  function waitForShortMedia(video) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("canplay", ready);
        video.removeEventListener("error", failed);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("The video could not be loaded.")); };
      timer = setTimeout(() => { cleanup(); reject(new Error("The video took too long to load.")); }, 8000);
      video.addEventListener("canplay", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
      video.load();
    });
  }

  async function playShort(video, slide) {
    if (!video || !slide) return false;
    if (video._shortPlayPromise) return video._shortPlayPromise;

    video._shortPlayPromise = (async () => {
      $$(".short-video", els.shortsFeed).forEach(other => { if (other !== video) other.pause(); });
      clearShortPlaybackError(slide);
      video.muted = state.muted;

      const attempt = async allowNetworkRetry => {
        try {
          await video.play();
          delete video.dataset.reloadAttempted;
          return true;
        } catch (error) {
          if (!state.muted && error?.name === "NotAllowedError") {
            state.muted = true;
            syncShortMuteUI();
            await video.play();
            delete video.dataset.reloadAttempted;
            return true;
          }
          if (allowNetworkRetry && video.error?.code === MediaError.MEDIA_ERR_NETWORK && video.dataset.reloadAttempted !== "1") {
            video.dataset.reloadAttempted = "1";
            await waitForShortMedia(video);
            return attempt(false);
          }
          throw error;
        }
      };

      try {
        return await attempt(true);
      } catch (error) {
        const message = video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? "This video format is not supported by your browser."
          : "This video could not be played.";
        setShortPlaybackError(slide, message);
        console.warn("Short playback failed", error);
        return false;
      }
    })();

    try {
      return await video._shortPlayPromise;
    } finally {
      delete video._shortPlayPromise;
    }
  }

  function setupShorts() {
    $$(".short-slide", els.shortsFeed).forEach(slide => {
      const video = $(".short-video", slide);
      const stage = $(".short-stage", slide);
      const center = $(".short-center-control", slide);
      const progress = $(".short-progress span", slide);
      center.classList.add("visible");
      video.addEventListener("playing", () => { clearShortPlaybackError(slide); stage.classList.add("playing"); center.classList.remove("visible"); center.tabIndex = -1; center.setAttribute("aria-label", "Pause video"); });
      video.addEventListener("pause", () => { if (stage.classList.contains("playback-error")) return; center.classList.add("visible"); center.tabIndex = 0; center.setAttribute("aria-label", "Play video"); });
      video.addEventListener("error", () => {
        if (video._shortPlayPromise) return;
        if (video.error?.code === MediaError.MEDIA_ERR_NETWORK && video.dataset.reloadAttempted !== "1") {
          video.dataset.reloadAttempted = "1";
          waitForShortMedia(video).then(() => {
            if (activeShortSlide() === slide && state.mode === "short") playShort(video, slide);
          }).catch(() => setShortPlaybackError(slide, "The video could not be loaded."));
          return;
        }
        setShortPlaybackError(slide);
      });
      video.addEventListener("timeupdate", () => { progress.style.width = video.duration ? `${video.currentTime / video.duration * 100}%` : "0"; });
      center.addEventListener("click", () => { if (video.paused) playShort(video, slide); else video.pause(); });
      center.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        center.click();
      });
      stage.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        if (video.paused) playShort(video, slide); else video.pause();
      });
      stage.addEventListener("dblclick", event => {
        const model = findVideo(slide.dataset.videoId);
        if (!model) return;
        burstHeart(stage, event);
        if (!model.liked) toggleLike(model, $("[data-short-action='like']", slide));
      });
    });

    state.shortObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const slide = entry.target;
        const video = $(".short-video", slide);
        if (entry.isIntersecting && entry.intersectionRatio >= .72 && state.mode === "short") {
          playShort(video, slide);
          recordView(slide.dataset.videoId);
        } else video.pause();
      });
    }, { root: els.shortsFeed, threshold: [.2, .72, .95] });
    $$(".short-slide", els.shortsFeed).forEach(slide => state.shortObserver.observe(slide));
  }

  function burstHeart(stage, event) {
    const burst = document.createElement("span");
    burst.className = "heart-burst";
    burst.innerHTML = icon("heart");
    if (event) {
      const bounds = stage.getBoundingClientRect();
      burst.style.left = `${event.clientX - bounds.left}px`;
      burst.style.top = `${event.clientY - bounds.top}px`;
    }
    stage.appendChild(burst);
    setTimeout(() => burst.remove(), 760);
  }

  async function recordView(id) {
    if (state.viewed.has(id)) return;
    state.viewed.add(id);
    try {
      const data = await api(`/videos/${encodeURIComponent(id)}/view`, { method: "POST" });
      const video = findVideo(id);
      if (video && Number.isFinite(Number(data.viewCount))) video.stats.views = Number(data.viewCount);
    } catch { /* Optional on legacy servers. */ }
  }

  function setMode(mode, { updateHash = true } = {}) {
    if (!["long", "short", "live"].includes(mode)) mode = "long";
    state.mode = mode;
    document.body.dataset.mode = mode;
    els.modeButtons.forEach(button => button.classList.toggle("active", button.dataset.modeTarget === mode));
    $$('[data-nav]').forEach(link => link.classList.toggle("active", link.dataset.nav === mode));
    els.longView.classList.toggle("active", mode === "long");
    els.shortsView.classList.toggle("active", mode === "short");
    els.liveView.classList.toggle("active", mode === "live");
    els.watchView.classList.remove("active");
    els.watchPlayer.pause();
    if (mode !== "short") cleanupShortObserver();
    const modeHash = mode === "short" ? "shorts" : mode;
    if (updateHash && location.hash !== `#/${modeHash}`) location.hash = `#/${modeHash}`;
    if (mode === "live") window.WhiskrLive?.enter();
    else {
      window.WhiskrLive?.leave();
      loadFeed(mode).then(() => { if (mode === "short" && state.feeds.short.length && !state.shortObserver) setupShorts(); });
    }
    if (mode === "long") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "watch" && parts[1]) {
      await showWatch(decodeURIComponent(parts[1]));
    } else setMode(parts[0] === "shorts" ? "short" : parts[0] === "live" ? "live" : "long", { updateHash: !parts.length });
  }

  async function showWatch(id) {
    cleanupShortObserver();
    let video = findVideo(id);
    if (!video) {
      await Promise.all([loadFeed("long"), loadFeed("short")]);
      video = findVideo(id);
    }
    if (!video) {
      showToast("That video isn’t available.");
      location.hash = "#/long";
      return;
    }
    state.currentVideo = video;
    state.mode = "long";
    document.body.dataset.mode = "long";
    els.longView.classList.remove("active");
    els.shortsView.classList.remove("active");
    els.liveView.classList.remove("active");
    els.watchView.classList.add("active");
    window.WhiskrLive?.leave();
    els.modeButtons.forEach(button => button.classList.toggle("active", button.dataset.modeTarget === "long"));
    els.watchPlayer.src = videoUrl(video.id);
    els.watchPlayer.poster = thumbnailUrl(video.id);
    els.watchTitle.textContent = video.title;
    updateWatchLike();
    els.watchDescription.innerHTML = `<strong>${formatCount(video.stats.views)} views · ${relativeTime(video.uploadedAt)}</strong>${escapeHTML(video.description || "Thanks for watching on Whiskr.")}`;
    renderRelated(video.id);
    els.watchCommentsList.innerHTML = `<div class="comments-placeholder">Loading comments…</div>`;
    els.watchCommentCount.textContent = formatCount(video.stats.comments);
    loadComments(video.id, els.watchCommentsList);
    recordView(video.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderRelated(currentId) {
    const related = state.feeds.long.filter(video => video.id !== currentId).slice(0, 10);
    els.relatedVideos.innerHTML = related.length ? related.map(video => `<article class="related-card" data-video-id="${escapeHTML(video.id)}" tabindex="0"><div class="thumbnail"><img src="${thumbnailUrl(video.id)}" alt="" loading="lazy"></div><div><h3>${escapeHTML(video.title)}</h3><span>${formatCount(video.stats.views)} views · ${relativeTime(video.uploadedAt)}</span></div></article>`).join("") : `<p class="comments-placeholder">More recommendations will appear here.</p>`;
  }

  function updateWatchLike() {
    const video = state.currentVideo;
    if (!video) return;
    els.watchLikeButton.classList.toggle("liked", video.liked);
    els.watchLikeButton.setAttribute("aria-pressed", String(video.liked));
    $("span", els.watchLikeButton).textContent = video.stats.likes ? formatCount(video.stats.likes) : "Like";
  }

  async function toggleLike(video, button) {
    const previous = video.liked;
    video.liked = !previous;
    video.stats.likes = Math.max(0, video.stats.likes + (video.liked ? 1 : -1));
    if (video.liked) state.localLikes.add(video.id); else state.localLikes.delete(video.id);
    persistLocalLikes();
    syncLikeUI(video);
    try {
      const data = await api(`/videos/${encodeURIComponent(video.id)}/like`, { method: "POST", body: { liked: video.liked } });
      video.liked = data.liked ?? video.liked;
      video.stats.likes = Number(data.likeCount ?? data.likes ?? video.stats.likes);
      if (video.liked) state.localLikes.add(video.id); else state.localLikes.delete(video.id);
      persistLocalLikes();
      syncLikeUI(video);
    } catch (error) {
      if (useLocalFallback(error)) {
        syncLikeUI(video);
        return;
      }
      video.liked = previous;
      video.stats.likes = Math.max(0, video.stats.likes + (previous ? 1 : -1));
      if (previous) state.localLikes.add(video.id); else state.localLikes.delete(video.id);
      persistLocalLikes();
      syncLikeUI(video);
      showToast(error.message);
    }
  }

  function syncLikeUI(video) {
    $$(`[data-video-id="${CSS.escape(video.id)}"] [data-short-action="like"]`).forEach(button => {
      button.classList.toggle("liked", video.liked);
      button.setAttribute("aria-pressed", String(video.liked));
      const count = $("[data-count]", button);
      if (count) count.textContent = formatCount(video.stats.likes);
    });
    if (state.currentVideo?.id === video.id) updateWatchLike();
  }

  async function shareVideo(video) {
    const url = `${location.origin}${location.pathname}#/watch/${encodeURIComponent(video.id)}`;
    try {
      if (navigator.share) await navigator.share({ title: video.title, text: `Watch ${video.title} on Whiskr`, url });
      else { await navigator.clipboard.writeText(url); showToast("Link copied to clipboard"); }
    } catch (error) {
      if (error.name !== "AbortError") showToast("Couldn’t share this video.");
    }
  }

  async function loadComments(videoId, target) {
    const localComments = Array.isArray(state.localComments[videoId]) ? state.localComments[videoId] : [];
    try {
      const data = await api(`/videos/${encodeURIComponent(videoId)}/comments`);
      renderComments(mergeLocalReplies(videoId, [...localComments, ...(data.comments || [])]), target);
    } catch (error) {
      if (useLocalFallback(error)) renderComments(mergeLocalReplies(videoId, localComments), target);
      else target.innerHTML = `<div class="comments-placeholder">${escapeHTML(error.message)}</div>`;
    }
  }

  function renderComments(comments, target) {
    if (!comments.length) { target.innerHTML = `<div class="comments-placeholder">No comments yet. Start the conversation.</div>`; return; }
    target.innerHTML = comments.map(comment => {
      const user = comment.user || comment.author || {};
      const name = user.displayName || user.username || "Guest";
      const replies = (comment.replies || []).map(reply => {
        const replyUser = reply.user || reply.author || {};
        const replyName = replyUser.displayName || replyUser.username || "Guest";
        return `<article class="reply-item"><div class="comment-header"><strong>${escapeHTML(replyName)}</strong><time>${relativeTime(reply.createdAt)}</time></div><p>${escapeHTML(reply.text || reply.body || "")}</p></article>`;
      }).join("");
      return `<article class="comment-item" data-comment-id="${escapeHTML(comment.id)}">
        <div class="comment-body">
          <div class="comment-header"><strong>${escapeHTML(name)}</strong><time>${relativeTime(comment.createdAt)}</time></div>
          <p>${escapeHTML(comment.text || comment.body || "")}</p>
          <button class="reply-trigger" type="button" data-reply-trigger>Reply</button>
          ${replies ? `<div class="replies-list">${replies}</div>` : ""}
          <form class="reply-form hidden" data-reply-form>
            <input type="text" name="reply" aria-label="Reply to ${escapeHTML(name)}" placeholder="Reply to ${escapeHTML(name)}…" maxlength="500" autocomplete="off">
            <button type="submit">Reply</button>
            <button type="button" data-cancel-reply>Cancel</button>
          </form>
        </div>
      </article>`;
    }).join("");
  }

  async function openComments(video) {
    state.commentsVideo = video;
    state.drawerTrigger = document.activeElement;
    els.drawerCommentCount.textContent = formatCount(video.stats.comments);
    els.drawerCommentsList.innerHTML = `<div class="comments-placeholder">Loading comments…</div>`;
    document.body.classList.add("drawer-open");
    $(".app-shell").inert = true;
    els.commentsDrawer.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#closeComments").focus(), 40);
    await loadComments(video.id, els.drawerCommentsList);
  }

  function closeComments() {
    document.body.classList.remove("drawer-open");
    $(".app-shell").inert = false;
    els.commentsDrawer.setAttribute("aria-hidden", "true");
    state.drawerTrigger?.focus?.();
    state.drawerTrigger = null;
  }

  async function submitComment(event, context) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.comment;
    const text = input.value.trim();
    const video = context === "drawer" ? state.commentsVideo : state.currentVideo;
    if (!text || !video) return;
    state.pendingComment = { form, context };
    state.pendingReply = null;
    state.nickname = "";
    els.nicknameForm.reset();
    els.nicknameError.textContent = "";
    if (!els.nicknameDialog.open) els.nicknameDialog.showModal();
    document.body.classList.add("dialog-open");
    setTimeout(() => els.nicknameForm.elements.nickname.focus(), 50);
  }

  async function postComment(form, context, video, text) {
    const input = form.elements.comment;
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      const data = await api(`/videos/${encodeURIComponent(video.id)}/comments`, { method: "POST", body: { text, nickname: state.nickname } });
      input.value = "";
      video.stats.comments = Number(data.commentCount ?? data.count ?? video.stats.comments + 1);
      const target = context === "drawer" ? els.drawerCommentsList : els.watchCommentsList;
      await loadComments(video.id, target);
      syncCommentCounts(video);
    } catch (error) {
      if (useLocalFallback(error)) {
        const localComment = {
          id: `local-comment-${Date.now()}`,
          text,
          createdAt: Date.now(),
          author: { displayName: state.nickname, username: state.nickname },
          isOwn: true
        };
        const comments = Array.isArray(state.localComments[video.id]) ? state.localComments[video.id] : [];
        state.localComments[video.id] = [localComment, ...comments].slice(0, 100);
        persistLocalComments();
        input.value = "";
        video.stats.comments += 1;
        renderComments(mergeLocalReplies(video.id, state.localComments[video.id]), context === "drawer" ? els.drawerCommentsList : els.watchCommentsList);
        syncCommentCounts(video);
      } else showToast(error.message);
    }
    finally { button.disabled = false; }
  }

  async function submitReply(event, context) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.reply;
    const text = input.value.trim();
    const commentId = form.closest("[data-comment-id]")?.dataset.commentId;
    const video = context === "drawer" ? state.commentsVideo : state.currentVideo;
    if (!text || !commentId || !video) return;
    state.pendingReply = { form, context };
    state.pendingComment = null;
    state.nickname = "";
    els.nicknameForm.reset();
    els.nicknameError.textContent = "";
    if (!els.nicknameDialog.open) els.nicknameDialog.showModal();
    document.body.classList.add("dialog-open");
    setTimeout(() => els.nicknameForm.elements.nickname.focus(), 50);
  }

  async function postReply(form, context, video, commentId, text) {
    const input = form.elements.reply;
    const submit = $("button[type='submit']", form);
    submit.disabled = true;
    const target = context === "drawer" ? els.drawerCommentsList : els.watchCommentsList;
    try {
      const data = await api(`/videos/${encodeURIComponent(video.id)}/comments/${encodeURIComponent(commentId)}/replies`, {
        method: "POST",
        body: { text, nickname: state.nickname }
      });
      input.value = "";
      video.stats.comments = Number(data.count ?? video.stats.comments + 1);
      await loadComments(video.id, target);
      syncCommentCounts(video);
    } catch (error) {
      if (useLocalFallback(error)) {
        const localReply = {
          id: `local-reply-${Date.now()}`,
          text,
          createdAt: Date.now(),
          author: { displayName: state.nickname, username: state.nickname },
          isOwn: true
        };
        const videoReplies = state.localReplies[video.id] || (state.localReplies[video.id] = {});
        const replies = Array.isArray(videoReplies[commentId]) ? videoReplies[commentId] : [];
        videoReplies[commentId] = [localReply, ...replies].slice(0, 100);
        persistLocalReplies();
        input.value = "";
        video.stats.comments += 1;
        await loadComments(video.id, target);
        syncCommentCounts(video);
      } else showToast(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  function syncCommentCounts(video) {
    $$(`[data-video-id="${CSS.escape(video.id)}"] [data-short-action="comments"] [data-count]`).forEach(element => { element.textContent = formatCount(video.stats.comments); });
    if (state.currentVideo?.id === video.id) els.watchCommentCount.textContent = formatCount(video.stats.comments);
    if (state.commentsVideo?.id === video.id) els.drawerCommentCount.textContent = formatCount(video.stats.comments);
  }

  async function submitNickname(event) {
    event.preventDefault();
    const nickname = String(els.nicknameForm.elements.nickname.value || "").trim();
    if (nickname.length < 2 || nickname.length > 24) {
      els.nicknameError.textContent = "Use a nickname between 2 and 24 characters.";
      return;
    }
    state.nickname = nickname;
    els.nicknameDialog.close();
    document.body.classList.remove("dialog-open");
    const pending = state.pendingComment;
    state.pendingComment = null;
    if (pending) {
      const input = pending.form.elements.comment;
      const video = pending.context === "drawer" ? state.commentsVideo : state.currentVideo;
      const text = input.value.trim();
      if (video && text) await postComment(pending.form, pending.context, video, text);
    }
    const pendingReply = state.pendingReply;
    state.pendingReply = null;
    if (pendingReply) {
      const input = pendingReply.form.elements.reply;
      const video = pendingReply.context === "drawer" ? state.commentsVideo : state.currentVideo;
      const commentId = pendingReply.form.closest("[data-comment-id]")?.dataset.commentId;
      const text = input.value.trim();
      if (video && commentId && text) await postReply(pendingReply.form, pendingReply.context, video, commentId, text);
    }
    state.nickname = "";
    els.nicknameForm.reset();
  }

  function clearThumbnailFrames({ hide = true } = {}) {
    state.thumbnailFrames.forEach(frame => URL.revokeObjectURL(frame.previewUrl));
    state.thumbnailFrames = [];
    state.selectedThumbnail = null;
    state.selectedThumbnailSource = null;
    els.uploadForm.elements.thumbnail.value = "";
    $('[data-file-name="thumbnail"]', els.uploadForm).textContent = "Use an image instead";
    els.thumbnailOptions.innerHTML = "";
    els.thumbnailGenerator.classList.toggle("hidden", hide);
    els.thumbnailGenerator.removeAttribute("data-orientation");
    $("#customThumbnailDrop").classList.remove("custom-selected");
  }

  function selectGeneratedThumbnail(index) {
    const frame = state.thumbnailFrames[index];
    if (!frame) return;
    state.selectedThumbnail = frame.blob;
    state.selectedThumbnailSource = "generated";
    const customInput = els.uploadForm.elements.thumbnail;
    customInput.value = "";
    $('[data-file-name="thumbnail"]', els.uploadForm).textContent = "Use an image instead";
    $("#customThumbnailDrop").classList.remove("custom-selected");
    $$(".thumbnail-option", els.thumbnailOptions).forEach((button, buttonIndex) => {
      const selected = buttonIndex === index;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  function renderThumbnailFrames() {
    els.thumbnailOptions.innerHTML = state.thumbnailFrames.map((frame, index) => `
      <button class="thumbnail-option" type="button" role="radio" aria-checked="false" aria-label="Use thumbnail ${index + 1} at ${formatDuration(Math.max(1, frame.time))}" data-thumbnail-index="${index}">
        <img src="${frame.previewUrl}" alt="Thumbnail option ${index + 1}">
        <span class="thumbnail-check" aria-hidden="true">✓</span>
        <time>${formatDuration(Math.max(1, frame.time))}</time>
      </button>`).join("");
    $$(".thumbnail-option", els.thumbnailOptions).forEach(button => button.addEventListener("click", () => selectGeneratedThumbnail(Number(button.dataset.thumbnailIndex))));
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      const target = Math.max(0, Math.min(time, Math.max(0, video.duration - .05)));
      if (Math.abs(video.currentTime - target) < .001) { resolve(); return; }
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("Couldn’t read this moment in the video.")); };
      const cleanup = () => { video.removeEventListener("seeked", onSeeked); video.removeEventListener("error", onError); };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = target;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn’t create this thumbnail.")), "image/jpeg", .88));
  }

  async function generateThumbnailChoices(file) {
    if (!file?.size) return;
    const token = ++state.thumbnailGenerationToken;
    state.thumbnailFrames.forEach(frame => URL.revokeObjectURL(frame.previewUrl));
    state.thumbnailFrames = [];
    state.selectedThumbnail = null;
    state.selectedThumbnailSource = null;
    els.uploadForm.elements.thumbnail.value = "";
    $('[data-file-name="thumbnail"]', els.uploadForm).textContent = "Use an image instead";
    els.thumbnailGenerator.classList.remove("hidden");
    els.thumbnailOptions.innerHTML = '<div class="thumbnail-loading"></div><div class="thumbnail-loading"></div><div class="thumbnail-loading"></div>';
    $("#regenerateThumbnails").disabled = true;
    $("#customThumbnailDrop").classList.remove("custom-selected");
    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = sourceUrl;
    const frames = [];
    try {
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("This video couldn’t be previewed.")), { once: true });
        video.load();
      });
      if (token !== state.thumbnailGenerationToken) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error("This video doesn’t contain previewable frames.");
      els.thumbnailGenerator.dataset.orientation = video.videoHeight > video.videoWidth ? "portrait" : "landscape";
      const ranges = [[.08, .30], [.36, .63], [.70, .94]];
      const times = ranges.map(([start, end]) => Math.max(.01, video.duration * (start + Math.random() * (end - start))));
      for (const time of times) {
        await seekVideo(video, time);
        if (token !== state.thumbnailGenerationToken) { frames.forEach(frame => URL.revokeObjectURL(frame.previewUrl)); return; }
        const maxDimension = 720;
        const scale = Math.min(maxDimension / video.videoWidth, maxDimension / video.videoHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas);
        frames.push({ blob, time, previewUrl: URL.createObjectURL(blob) });
      }
      if (token !== state.thumbnailGenerationToken) { frames.forEach(frame => URL.revokeObjectURL(frame.previewUrl)); return; }
      state.thumbnailFrames = frames;
      renderThumbnailFrames();
      if (state.selectedThumbnailSource !== "custom") selectGeneratedThumbnail(0);
    } catch (error) {
      frames.forEach(frame => URL.revokeObjectURL(frame.previewUrl));
      if (token === state.thumbnailGenerationToken) {
        els.thumbnailOptions.innerHTML = `<p class="thumbnail-error">${escapeHTML(error.message)} Choose a custom image instead.</p>`;
        els.uploadError.textContent = error.message;
      }
    } finally {
      URL.revokeObjectURL(sourceUrl);
      if (token === state.thumbnailGenerationToken) $("#regenerateThumbnails").disabled = false;
    }
  }

  function openUpload(type) {
    els.uploadError.textContent = "";
    els.uploadForm.reset();
    state.thumbnailGenerationToken += 1;
    clearThumbnailFrames();
    const progress = $("#uploadProgress");
    progress.classList.add("hidden");
    $("span", progress).style.width = "0";
    $("p", progress).textContent = "Preparing your upload…";
    $('[data-file-name="video"]', els.uploadForm).textContent = "No file selected";
    $('[data-file-name="thumbnail"]', els.uploadForm).textContent = "Use an image instead";
    if (type) {
      const radio = $(`input[name="type"][value="${type}"]`, els.uploadForm);
      if (radio) radio.checked = true;
    }
    if (!els.uploadDialog.open) els.uploadDialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function readFileAsDataURI(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Couldn’t read this file."));
      reader.readAsDataURL(file);
    });
  }

  async function waitForUpload(jobId, onProgress) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const job = await api(`/upload/status/${encodeURIComponent(jobId)}`);
      onProgress?.(job, attempt);
      if (job.status === "complete") return job.result;
      if (job.status === "error") throw new Error(job.error || "The upload could not be processed.");
    }
    throw new Error("The upload is still processing. Refresh the feed in a moment.");
  }

  async function submitUpload(event) {
    event.preventDefault();
    const formData = new FormData(els.uploadForm);
    const video = formData.get("video");
    const thumbnail = state.selectedThumbnail || formData.get("thumbnail");
    const type = formData.get("type") === "short" ? "short" : "long";
    if (!video?.size) { els.uploadError.textContent = "Choose an MP4 video first."; return; }
    if (!thumbnail?.size) { els.uploadError.textContent = "Choose one of the generated thumbnails or upload a custom image."; return; }
    if (video.size > 500 * 1024 * 1024) { els.uploadError.textContent = "Please choose a video under 500 MB."; return; }
    const submit = $(".primary-submit", els.uploadForm);
    const progress = $("#uploadProgress");
    const progressBar = $("span", progress);
    const progressCopy = $("p", progress);
    submit.disabled = true;
    progress.classList.remove("hidden");
    els.uploadError.textContent = "";
    try {
      progressBar.style.width = "24%";
      progressCopy.textContent = "Preparing your files…";
      const [videoData, thumbnailData] = await Promise.all([readFileAsDataURI(video), readFileAsDataURI(thumbnail)]);
      progressBar.style.width = "62%";
      progressCopy.textContent = "Publishing to Whiskr…";
      const queuedUpload = await api("/upload", { method: "POST", body: {
        videoData, thumbnailData,
        title: String(formData.get("title") || "").trim(),
        description: String(formData.get("description") || "").trim(),
        type
      }});
      let completedUpload = queuedUpload;
      if (queuedUpload.jobId) {
        progressCopy.textContent = "Processing your video…";
        completedUpload = await waitForUpload(queuedUpload.jobId, (job, attempt) => {
          progressBar.style.width = `${Math.min(94, 64 + attempt * .35)}%`;
          if (job.status === "queued") progressCopy.textContent = "Your upload is queued…";
          if (job.status === "processing") progressCopy.textContent = typeof job.progress === "string" ? job.progress : "Processing your video…";
        });
      }
      rememberVideoType(completedUpload?.id || queuedUpload.id, type);
      progressBar.style.width = "100%";
      progressCopy.textContent = "Published!";
      state.loaded.long = false;
      state.loaded.short = false;
      await loadFeed(type, { refresh: true });
      setTimeout(() => {
        els.uploadDialog.close();
        document.body.classList.remove("dialog-open");
        setMode(type);
        showToast(type === "short" ? "Your Short is live." : "Your video is live.");
      }, 450);
    } catch (error) { els.uploadError.textContent = error.message; }
    finally { submit.disabled = false; }
  }

  function moveShort(direction) {
    const slides = $$(".short-slide", els.shortsFeed);
    if (!slides.length) return;
    const feedBounds = els.shortsFeed.getBoundingClientRect();
    let index = slides.findIndex(slide => {
      const bounds = slide.getBoundingClientRect();
      return Math.abs(bounds.top - feedBounds.top) < feedBounds.height * .35;
    });
    if (index < 0) index = 0;
    const target = slides[Math.max(0, Math.min(slides.length - 1, index + direction))];
    els.shortsFeed.scrollTop = target.offsetTop;
    clearTimeout(state.shortNavigationTimer);
    state.shortNavigationTimer = setTimeout(() => playShort($(".short-video", target), target), 350);
  }

  function handleShortAction(button, slide) {
    const video = findVideo(slide.dataset.videoId);
    if (!video) return;
    switch (button.dataset.shortAction) {
      case "like": toggleLike(video, button); break;
      case "comments": openComments(video); break;
      case "share": shareVideo(video); break;
      case "bookmark":
        if (state.saved.has(video.id)) state.saved.delete(video.id); else state.saved.add(video.id);
        localStorage.setItem("whiskr_saved", JSON.stringify([...state.saved]));
        button.classList.toggle("liked", state.saved.has(video.id));
        button.setAttribute("aria-pressed", String(state.saved.has(video.id)));
        showToast(state.saved.has(video.id) ? "Saved on this device" : "Removed from saved videos");
        break;
      case "mute":
        state.muted = !state.muted;
        syncShortMuteUI();
        break;
    }
  }

  function bindEvents() {
    window.addEventListener("hashchange", route);
    els.modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.modeTarget)));
    $("#menuButton").addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
      localStorage.setItem("whiskr_sidebar_collapsed", document.body.classList.contains("sidebar-collapsed") ? "1" : "0");
    });
    els.searchForm.addEventListener("submit", event => { event.preventDefault(); state.query = els.searchInput.value; if (state.mode !== "long") setMode("long"); else renderLongFeed(); });
    els.searchInput.addEventListener("input", () => { if (!els.searchInput.value && state.query) { state.query = ""; renderLongFeed(); } });
    $("#categoryStrip").addEventListener("click", event => {
      const button = event.target.closest("[data-query]");
      if (!button) return;
      $$(".category").forEach(item => item.classList.toggle("active", item === button));
      state.query = button.dataset.query;
      els.searchInput.value = state.query && state.query !== "Recently uploaded" ? state.query : "";
      renderLongFeed();
    });
    $$(".topic-chip").forEach(button => button.addEventListener("click", () => { state.query = button.dataset.query; els.searchInput.value = state.query; setMode("long"); renderLongFeed(); }));
    $("[data-scroll-explore]").addEventListener("click", () => $("#categoryStrip").scrollIntoView({ behavior: "smooth" }));
    $("#refreshFeedButton").addEventListener("click", () => loadFeed("long", { refresh: true }));

    els.videoGrid.addEventListener("click", event => {
      if (event.target.closest(".card-menu")) { showToast("More options are coming soon."); return; }
      const card = event.target.closest(".video-card");
      if (card) location.hash = `#/watch/${encodeURIComponent(card.dataset.videoId)}`;
    });
    els.videoGrid.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key) && event.target.matches(".video-card")) { event.preventDefault(); event.target.click(); } });
    els.relatedVideos.addEventListener("click", event => { const card = event.target.closest(".related-card"); if (card) location.hash = `#/watch/${encodeURIComponent(card.dataset.videoId)}`; });
    els.relatedVideos.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key) && event.target.matches(".related-card")) event.target.click(); });
    $("#backButton").addEventListener("click", () => history.length > 1 ? history.back() : (location.hash = "#/long"));
    els.watchLikeButton.addEventListener("click", () => state.currentVideo && toggleLike(state.currentVideo, els.watchLikeButton));
    $("#watchShareButton").addEventListener("click", () => state.currentVideo && shareVideo(state.currentVideo));

    els.shortsFeed.addEventListener("click", event => { const button = event.target.closest("[data-short-action]"); const slide = event.target.closest(".short-slide"); if (button && slide) { event.stopPropagation(); handleShortAction(button, slide); } });
    $$("[data-short-tab]").forEach(button => button.addEventListener("click", () => {
      state.shortTab = button.dataset.shortTab;
      $$("[data-short-tab]").forEach(item => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); item.tabIndex = active ? 0 : -1; });
      renderShortsFeed();
      els.shortsFeed.scrollTop = 0;
    }));
    $(".shorts-tabs").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$("[data-short-tab]");
      const next = tabs[(tabs.indexOf(document.activeElement) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.click();
      next.focus();
    });
    $("#previousShort").addEventListener("click", () => moveShort(-1));
    $("#nextShort").addEventListener("click", () => moveShort(1));
    document.addEventListener("keydown", event => {
      if (document.body.classList.contains("drawer-open")) {
        if (event.key === "Escape") { event.preventDefault(); closeComments(); return; }
        if (event.key === "Tab") {
          const focusable = $$("button:not([disabled]), input:not([disabled])", els.commentsDrawer).filter(element => element.offsetParent !== null);
          if (focusable.length) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }
        return;
      }
      if (state.mode !== "short" || document.body.classList.contains("drawer-open") || $("dialog[open]")) return;
      if (event.target.closest?.("button, input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      if (["ArrowDown", "PageDown"].includes(event.key)) { event.preventDefault(); moveShort(1); }
      if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); moveShort(-1); }
      if (event.key === " ") {
        event.preventDefault();
        const slide = activeShortSlide();
        const video = slide && $(".short-video", slide);
        if (!video) return;
        if (video.paused) playShort(video, slide); else video.pause();
      }
    });

    $("#closeComments").addEventListener("click", closeComments);
    els.drawerBackdrop.addEventListener("click", closeComments);
    $("#drawerCommentForm").addEventListener("submit", event => submitComment(event, "drawer"));
    $("#watchCommentForm").addEventListener("submit", event => submitComment(event, "watch"));
    [[els.drawerCommentsList, "drawer"], [els.watchCommentsList, "watch"]].forEach(([list, context]) => {
      list.addEventListener("click", event => {
        const comment = event.target.closest("[data-comment-id]");
        if (!comment) return;
        const form = $("[data-reply-form]", comment);
        if (event.target.closest("[data-reply-trigger]")) {
          $$("[data-reply-form]", list).forEach(item => item.classList.add("hidden"));
          form.classList.remove("hidden");
          $("input", form).focus();
        }
        if (event.target.closest("[data-cancel-reply]")) {
          form.reset();
          form.classList.add("hidden");
        }
      });
      list.addEventListener("submit", event => {
        if (!event.target.matches("[data-reply-form]")) return;
        submitReply(event, context);
      });
    });
    els.nicknameForm.addEventListener("submit", submitNickname);

    $("#openUploadButton").addEventListener("click", () => openUpload());
    $$('[data-open-upload]').forEach(button => button.addEventListener("click", () => openUpload()));
    $("[data-mobile-explore]")?.addEventListener("click", () => { setMode("long"); setTimeout(() => $("#categoryStrip").scrollIntoView({ behavior: "smooth" }), 50); });
    $("[data-mobile-refresh]").addEventListener("click", () => state.mode === "live" ? window.WhiskrLive?.refresh() : loadFeed(state.mode, { refresh: true }));
    els.uploadForm.addEventListener("submit", submitUpload);
    const uploadVideoInput = els.uploadForm.elements.video;
    const customThumbnailInput = els.uploadForm.elements.thumbnail;
    uploadVideoInput.addEventListener("change", () => {
      const file = uploadVideoInput.files[0];
      $('[data-file-name="video"]', els.uploadForm).textContent = file?.name || "No file selected";
      if (file) generateThumbnailChoices(file);
      else { state.thumbnailGenerationToken += 1; clearThumbnailFrames(); }
    });
    customThumbnailInput.addEventListener("change", () => {
      const file = customThumbnailInput.files[0];
      $('[data-file-name="thumbnail"]', els.uploadForm).textContent = file?.name || "Use an image instead";
      if (!file?.size) return;
      state.selectedThumbnail = file;
      state.selectedThumbnailSource = "custom";
      $("#customThumbnailDrop").classList.add("custom-selected");
      $$(".thumbnail-option", els.thumbnailOptions).forEach(button => { button.classList.remove("selected"); button.setAttribute("aria-checked", "false"); });
    });
    $("#regenerateThumbnails").addEventListener("click", () => {
      const file = uploadVideoInput.files[0];
      if (file) generateThumbnailChoices(file);
    });
    $$("[data-close-dialog]").forEach(button => button.addEventListener("click", () => { const dialog = button.closest("dialog"); dialog.close(); document.body.classList.remove("dialog-open"); }));
    $$("dialog").forEach(dialog => {
      dialog.addEventListener("click", event => { if (event.target === dialog) { dialog.close(); document.body.classList.remove("dialog-open"); } });
      dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
    });

    document.addEventListener("click", event => {
      const action = event.target.closest("[data-empty-action]")?.dataset.emptyAction;
      if (!action) return;
      if (action === "refresh") loadFeed("long", { refresh: true });
      if (action === "refresh-shorts") loadFeed("short", { refresh: true });
      if (action === "clear-search") { state.query = ""; els.searchInput.value = ""; renderLongFeed(); }
      if (action === "upload") openUpload("long");
      if (action === "upload-short") openUpload("short");
    });
  }

  async function init() {
    if (localStorage.getItem("whiskr_sidebar_collapsed") === "1" && innerWidth > 1040) document.body.classList.add("sidebar-collapsed");
    bindEvents();
    await route();
  }

  init();
})();
