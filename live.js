(() => {
  "use strict";

  if (typeof window === "undefined") return;

  const PRODUCTION_API = "https://api.zixy.lol";
  const API_BASE = window.WHISKR_API_URL || (location.protocol === "file:" ? PRODUCTION_API : location.origin);
  const RTC_CONFIG = {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
    iceCandidatePoolSize: 4
  };
  const RELAY_MIME_TYPES = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42e01e,mp4a.40.2",
    "video/mp4"
  ];
  const $ = (selector, root = document) => root.querySelector(selector);

  const els = {
    view: $("#liveView"),
    stage: $("#liveStage"),
    player: $("#livePlayer"),
    offline: $("#liveOffline"),
    statusPill: $("#liveStatusPill"),
    statusText: $("#liveStatusText"),
    title: $("#liveTitle"),
    subtitle: $("#liveSubtitle"),
    programTitle: $("#liveProgramTitle"),
    hostText: $("#liveHostText"),
    description: $("#liveDescription"),
    startedText: $("#liveStartedText"),
    connection: $("#liveConnectionStatus"),
    viewerCount: $("#liveViewerCount"),
    viewerCountStage: $("#liveViewerCountStage"),
    chatList: $("#liveChatList"),
    chatForm: $("#liveChatForm"),
    chatName: $("#liveChatName"),
    chatMessage: $("#liveChatMessage"),
    soundButton: $("#liveSoundButton"),
    openStudioButton: $("#openLiveStudioButton"),
    studioDialog: $("#liveStudioDialog"),
    canvas: $("#studioCanvas"),
    canvasWrap: $("#studioCanvasWrap"),
    selectionBox: $("#studioSelectionBox"),
    selectionLabel: $("#studioSelectionLabel"),
    resizeHandle: $("#studioResizeHandle"),
    resetScene: $("#resetSceneButton"),
    screenVideo: $("#studioScreenSource"),
    cameraVideo: $("#studioCameraSource"),
    chooseScreen: $("#chooseScreenButton"),
    chooseCamera: $("#chooseCameraButton"),
    studioTitle: $("#studioTitle"),
    studioDescription: $("#studioDescription"),
    studioStreamerName: $("#studioStreamerName"),
    layout: $("#studioLayout"),
    cameraPosition: $("#studioCameraPosition"),
    cameraSize: $("#studioCameraSize"),
    cameraSizeOutput: $("#studioCameraSizeOutput"),
    cameraShape: $("#studioCameraShape"),
    overlayText: $("#studioOverlayText"),
    overlayPosition: $("#studioOverlayPosition"),
    overlayColor: $("#studioOverlayColor"),
    textScale: $("#studioTextScale"),
    textScaleOutput: $("#studioTextScaleOutput"),
    chatPosition: $("#studioChatPosition"),
    chatMessageCount: $("#studioChatMessageCount"),
    chatScale: $("#studioChatScale"),
    chatScaleOutput: $("#studioChatScaleOutput"),
    chatVisible: $("#studioChatVisible"),
    chatTts: $("#studioChatTts"),
    ttsStatus: $("#studioTtsStatus"),
    screenVisible: $("#studioScreenVisible"),
    cameraVisible: $("#studioCameraVisible"),
    micEnabled: $("#studioMicEnabled"),
    screenAudio: $("#studioScreenAudio"),
    layerButtons: [...document.querySelectorAll("[data-studio-layer]")],
    screenSourceStatus: $("#studioScreenSourceStatus"),
    cameraSourceStatus: $("#studioCameraSourceStatus"),
    textSourceStatus: $("#studioTextSourceStatus"),
    chatSourceStatus: $("#studioChatSourceStatus"),
    screenState: $("#studioScreenState"),
    cameraState: $("#studioCameraState"),
    textState: $("#studioTextState"),
    chatState: $("#studioChatState"),
    micMuteButton: $("#studioMicMuteButton"),
    desktopMuteButton: $("#studioDesktopMuteButton"),
    micLevel: $("#studioMicLevel"),
    desktopLevel: $("#studioDesktopLevel"),
    micMeter: $("#studioMicMeter"),
    desktopMeter: $("#studioDesktopMeter"),
    studioError: $("#studioError"),
    studioStatus: $("#studioStatusText"),
    studioAir: $("#studioAirStatus"),
    studioViewerCount: $("#studioViewerCount"),
    startBroadcast: $("#startBroadcastButton"),
    endBroadcast: $("#endBroadcastButton"),
    toastRegion: $("#toastRegion")
  };

  if (!els.view) return;

  const live = {
    active: false,
    status: { live: false, title: "Whiskr Live", description: "", streamer: "", startedAt: null, viewerCount: 0 },
    chats: [],
    viewerSocket: null,
    viewerGeneration: 0,
    viewerReconnectTimer: null,
    viewerId: null,
    publisherId: null,
    viewerPeer: null,
    viewerIce: [],
    remoteStream: null,
    publisherSocket: null,
    publisherConnecting: false,
    publishing: false,
    publisherPeers: new Map(),
    mediaRecorder: null,
    mediaQueue: [],
    mediaSending: false,
    mediaRelayGeneration: 0,
    mediaRotateTimer: null,
    relay: {
      active: false,
      mimeType: "",
      transport: "",
      objectUrl: "",
      queue: [],
      queuedBytes: 0,
      started: false,
      playing: false,
      segmentToken: 0,
      reconnectTimer: null
    },
    screenStream: null,
    cameraStream: null,
    outputStream: null,
    drawRequest: 0,
    drawTimer: null,
    lastDrawAt: 0,
    titleTimer: null,
    scene: {
      selected: null,
      drag: null,
      bounds: { camera: null, text: null, chat: null },
      camera: { custom: false, x: .69, y: .69 },
      text: { custom: false, x: .03, y: .82, scale: 1 },
      chat: { custom: false, x: .64, y: .06, scale: 1 }
    },
    tts: {
      queue: [],
      speaking: false,
      voice: null
    },
    audio: {
      context: null,
      destination: null,
      nodes: [],
      micGain: null,
      desktopGain: null,
      micAnalyser: null,
      desktopAnalyser: null,
      micData: null,
      desktopData: null
    }
  };

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function initials(value = "G") {
    return String(value).trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "G";
  }

  function showToast(message) {
    if (!els.toastRegion) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 3400);
  }

  function socketUrl() {
    const url = new URL(`${String(API_BASE).replace(/\/$/, "")}/live/ws`, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  }

  function endpoint(path) {
    return `${String(API_BASE).replace(/\/$/, "")}${path}`;
  }

  function send(socket, payload) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  function parseMessage(event) {
    try { return JSON.parse(event.data); } catch { return null; }
  }

  function formatStarted(timestamp) {
    if (!timestamp) return "Waiting for a broadcaster";
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 60) return "Started just now";
    if (seconds < 3600) return `Live for ${Math.floor(seconds / 60)} min`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `Live for ${hours}h ${minutes}m`;
  }

  function setConnection(label, state = "") {
    els.connection.classList.toggle("connected", state === "connected");
    els.connection.classList.toggle("error", state === "error");
    $("span", els.connection).textContent = label;
  }

  function applyStatus(status = {}) {
    live.status = {
      live: Boolean(status.live),
      title: String(status.title || "Whiskr Live"),
      description: String(status.description || ""),
      streamer: String(status.streamer || ""),
      startedAt: status.startedAt || null,
      viewerCount: Math.max(0, Number(status.viewerCount) || 0)
    };
    const onAir = live.status.live;
    els.stage.classList.toggle("is-live", onAir);
    els.statusPill.classList.toggle("is-live", onAir);
    els.statusText.textContent = onAir ? "On air" : "Offline";
    els.title.textContent = onAir ? live.status.title : "Whiskr Live";
    els.programTitle.textContent = live.status.title;
    els.hostText.textContent = live.status.streamer ? `Streaming as @${live.status.streamer.replace(/^@/, "")}` : "";
    els.hostText.classList.toggle("hidden", !onAir || !live.status.streamer);
    els.description.textContent = live.status.description;
    els.description.classList.toggle("hidden", !onAir || !live.status.description);
    els.startedText.textContent = formatStarted(live.status.startedAt);
    els.subtitle.textContent = onAir ? "Watch live and join the conversation." : "Live streams will appear here the moment they start.";
    els.viewerCount.textContent = String(live.status.viewerCount);
    els.viewerCountStage.textContent = String(live.status.viewerCount);
    els.studioViewerCount.textContent = String(live.status.viewerCount);
    if (!onAir && !live.publishing) {
      cleanupViewerPeer();
      cleanupMediaRelay();
    }
    updateStudioUI();
  }

  async function refreshStatus() {
    try {
      const response = await fetch(endpoint("/live/status"), { cache: "no-store" });
      if (response.ok) applyStatus(await response.json());
    } catch { /* The WebSocket connection reports network state more precisely. */ }
  }

  function renderChats() {
    if (!live.chats.length) {
      els.chatList.innerHTML = '<p class="live-chat-empty">Chat messages will show up here.</p>';
      return;
    }
    els.chatList.innerHTML = live.chats.map(chat => `
      <article class="live-chat-message ${chat.role === "host" ? "host" : ""}">
        <span class="live-chat-avatar">${escapeHTML(initials(chat.name))}</span>
        <div class="live-chat-copy"><div><strong>${escapeHTML(chat.name || "Guest")}</strong><time>${new Date(Number(chat.timestamp) || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div><p>${escapeHTML(chat.text || "")}</p></div>
      </article>`).join("");
    els.chatList.scrollTop = els.chatList.scrollHeight;
  }

  function chooseTtsVoice() {
    if (!window.speechSynthesis?.getVoices) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const priorities = [
      /^brian\b/i,
      /^daniel\b/i,
      /google uk english male/i,
      /microsoft (ryan|george|david)/i,
      /^alex\b/i
    ];
    live.tts.voice = priorities
      .map(pattern => voices.find(voice => pattern.test(voice.name)))
      .find(Boolean)
      || voices.find(voice => /^en[-_](gb|us)/i.test(voice.lang))
      || voices.find(voice => /^en/i.test(voice.lang))
      || voices[0];
    return live.tts.voice;
  }

  function updateTtsStatus() {
    if (!els.ttsStatus) return;
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      els.ttsStatus.textContent = "Chat TTS is not supported by this browser.";
      els.chatTts.disabled = true;
      return;
    }
    const voice = chooseTtsVoice();
    els.chatTts.disabled = false;
    els.ttsStatus.textContent = voice
      ? `Twitch-style voice: ${voice.name}. Reads “user said: message” on the broadcaster.`
      : "Loading an English Twitch-style voice…";
  }

  function stopChatTts() {
    live.tts.queue = [];
    live.tts.speaking = false;
    try { window.speechSynthesis?.cancel(); } catch { /* Speech is already stopped. */ }
  }

  function speakNextChatTts() {
    if (live.tts.speaking) return;
    if (!live.publishing || !els.chatTts.checked || !live.tts.queue.length) {
      live.tts.speaking = false;
      return;
    }
    const phrase = live.tts.queue.shift();
    const utterance = new SpeechSynthesisUtterance(phrase);
    const voice = live.tts.voice || chooseTtsVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    utterance.pitch = .96;
    utterance.volume = 1;
    live.tts.speaking = true;
    const finish = () => {
      live.tts.speaking = false;
      setTimeout(speakNextChatTts, 80);
    };
    utterance.addEventListener("end", finish, { once: true });
    utterance.addEventListener("error", finish, { once: true });
    try { window.speechSynthesis.speak(utterance); }
    catch { finish(); }
  }

  function enqueueChatTts(chat) {
    if (!live.publishing || !els.chatTts.checked || chat?.role === "host") return;
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") return;
    const name = String(chat?.name || "Guest").replace(/\s+/g, " ").trim().slice(0, 24) || "Guest";
    const message = String(chat?.text || "")
      .replace(/https?:\/\/\S+/gi, "link")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    if (!message) return;
    if (live.tts.queue.length >= 8) live.tts.queue.shift();
    live.tts.queue.push(`${name} said: ${message}`);
    speakNextChatTts();
  }

  function acceptChat(chat) {
    if (!chat?.id || live.chats.some(item => item.id === chat.id)) return;
    live.chats.push(chat);
    if (live.chats.length > 100) live.chats.shift();
    renderChats();
    updateSourceButtons();
    enqueueChatTts(chat);
  }

  function loadChatHistory(history) {
    live.chats = Array.isArray(history) ? history.slice(-100) : [];
    renderChats();
    updateSourceButtons();
  }

  function supportedRelayMimes() {
    const video = document.createElement("video");
    if (typeof video.canPlayType !== "function") return [];
    return RELAY_MIME_TYPES.filter(mimeType => video.canPlayType(mimeType) !== "");
  }

  function cleanupMediaRelay({ clearPlayer = true } = {}) {
    const relay = live.relay;
    relay.active = false;
    relay.mimeType = "";
    relay.transport = "";
    relay.queue = [];
    relay.queuedBytes = 0;
    relay.started = false;
    relay.playing = false;
    relay.segmentToken += 1;
    clearTimeout(relay.reconnectTimer);
    relay.reconnectTimer = null;
    if (relay.objectUrl) URL.revokeObjectURL(relay.objectUrl);
    relay.objectUrl = "";
    if (clearPlayer) {
      els.player.oncanplay = null;
      els.player.onplaying = null;
      els.player.onloadeddata = null;
      els.player.onwaiting = null;
      els.player.onstalled = null;
      els.player.onended = null;
      els.player.onerror = null;
      els.player.pause();
      els.player.removeAttribute("src");
      els.player.load();
    }
  }

  function playNextMediaRelaySegment() {
    const relay = live.relay;
    if (!relay.active || relay.playing) return;
    const next = relay.queue.shift();
    if (!next) return;
    relay.queuedBytes -= next.byteLength;
    relay.playing = true;
    const token = ++relay.segmentToken;
    if (relay.objectUrl) URL.revokeObjectURL(relay.objectUrl);
    relay.objectUrl = URL.createObjectURL(new Blob([next], { type: relay.mimeType }));
    const finish = (failed = false) => {
      if (!relay.active || relay.segmentToken !== token) return;
      relay.playing = false;
      if (failed && !relay.queue.length) setConnection("Waiting for next video segment", "error");
      playNextMediaRelaySegment();
    };
    els.player.oncanplay = () => {
      if (!relay.active || relay.segmentToken !== token) return;
      relay.started = true;
      setConnection("Live via relay", "connected");
      updateSoundButton();
      els.player.play().catch(() => {});
    };
    els.player.onplaying = els.player.oncanplay;
    els.player.onended = () => finish(false);
    els.player.onerror = () => finish(true);
    els.player.srcObject = null;
    els.player.src = relay.objectUrl;
    els.player.load();
    els.player.play().catch(() => {});
  }

  function startViewerMediaRelay(mimeType, transport = "websocket") {
    const normalized = String(mimeType || "").toLowerCase();
    if (!supportedRelayMimes().includes(normalized)) return false;
    cleanupViewerPeer();
    cleanupMediaRelay();
    const relay = live.relay;
    relay.active = true;
    relay.mimeType = normalized;
    relay.transport = transport === "http" ? "http" : "websocket";
    els.player.srcObject = null;
    els.player.removeAttribute("src");
    els.player.load();
    if (relay.transport === "http") {
      const token = ++relay.segmentToken;
      const markPlaying = () => {
        if (!relay.active || relay.segmentToken !== token) return;
        relay.started = true;
        setConnection("Live via relay", "connected");
        updateSoundButton();
        els.player.play().catch(() => {});
      };
      const openStream = () => {
        if (!relay.active || relay.segmentToken !== token) return;
        const url = new URL(endpoint("/live/media"), location.href);
        url.searchParams.set("mime", normalized);
        url.searchParams.set("session", String(Date.now()));
        els.player.src = url.href;
        els.player.load();
        els.player.play().catch(() => {});
      };
      const reconnect = () => {
        if (!relay.active || relay.segmentToken !== token || !live.status.live) return;
        clearTimeout(relay.reconnectTimer);
        relay.reconnectTimer = setTimeout(openStream, 650);
      };
      els.player.onloadeddata = markPlaying;
      els.player.oncanplay = markPlaying;
      els.player.onplaying = markPlaying;
      els.player.onwaiting = () => { if (!relay.started) setConnection("Buffering live video"); };
      els.player.onstalled = reconnect;
      els.player.onerror = reconnect;
      els.player.onended = reconnect;
      setConnection("Connecting live video");
      openStream();
    } else {
      setConnection("Buffering relay");
    }
    updateSoundButton();
    return true;
  }

  function handleMediaRelayChunk(data) {
    const relay = live.relay;
    if (!relay.active || relay.transport !== "websocket" || !(data instanceof ArrayBuffer) || !data.byteLength) return;
    relay.queue.push(data);
    relay.queuedBytes += data.byteLength;
    while ((relay.queuedBytes > 8 * 1024 * 1024 || relay.queue.length > 2) && relay.queue.length > 1) {
      const removed = relay.queue.shift();
      relay.queuedBytes -= removed.byteLength;
    }
    playNextMediaRelaySegment();
  }

  function updateSoundButton() {
    const hasMedia = Boolean((els.player.srcObject || live.relay.active) && live.status.live);
    els.soundButton.classList.toggle("hidden", !hasMedia);
    if (!hasMedia) return;
    const icon = els.player.muted ? "volume" : "muted";
    els.soundButton.innerHTML = `<svg><use href="#i-${icon}"/></svg><span>${els.player.muted ? "Tap for sound" : "Mute"}</span>`;
  }

  function cleanupViewerPeer() {
    if (live.viewerPeer) {
      try { live.viewerPeer.close(); } catch { /* Already closed. */ }
    }
    live.viewerPeer = null;
    live.viewerIce = [];
    live.publisherId = null;
    live.remoteStream = null;
    if (!live.relay.active) els.player.srcObject = null;
    updateSoundButton();
  }

  function createViewerPeer(publisherId) {
    if (live.viewerPeer && live.publisherId === publisherId) return live.viewerPeer;
    cleanupViewerPeer();
    const peer = new RTCPeerConnection(RTC_CONFIG);
    live.viewerPeer = peer;
    live.publisherId = publisherId;
    live.remoteStream = new MediaStream();

    peer.onicecandidate = event => send(live.viewerSocket, { type: "ice", to: publisherId, candidate: event.candidate });
    peer.ontrack = event => {
      if (!live.remoteStream.getTracks().some(track => track.id === event.track.id)) live.remoteStream.addTrack(event.track);
      if (live.relay.active) return;
      els.player.srcObject = live.remoteStream;
      els.player.play().catch(() => {});
      setConnection("Receiving peer video");
      updateSoundButton();
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected" && !live.relay.active) setConnection("Live peer-to-peer", "connected");
      if (["failed", "closed"].includes(peer.connectionState) && live.status.live && !live.relay.active) {
        setConnection("Reconnecting", "error");
        setTimeout(() => refresh(), 800);
      }
    };
    return peer;
  }

  async function handleViewerOffer(message) {
    if (!message.sdp || typeof RTCPeerConnection === "undefined") return;
    const peer = createViewerPeer(message.from);
    try {
      await peer.setRemoteDescription(message.sdp);
      for (const candidate of live.viewerIce.splice(0)) await peer.addIceCandidate(candidate);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send(live.viewerSocket, { type: "answer", to: message.from, sdp: peer.localDescription });
    } catch (error) {
      console.error("Could not accept live stream:", error);
      setConnection("Stream negotiation failed", "error");
    }
  }

  async function handleViewerIce(message) {
    if (!live.viewerPeer || !live.viewerPeer.remoteDescription) {
      live.viewerIce.push(message.candidate ?? null);
      return;
    }
    try { await live.viewerPeer.addIceCandidate(message.candidate ?? null); } catch { /* Ignore late ICE from a replaced peer. */ }
  }

  function handleViewerMessage(event) {
    const message = parseMessage(event);
    if (!message) return;
    if (message.type === "hello-ack") {
      live.viewerId = message.id;
      applyStatus(message.status);
      loadChatHistory(message.chatHistory);
      setConnection(message.status?.live ? "Waiting for video" : "Ready", "connected");
    } else if (message.type === "stream-status") applyStatus(message.status);
    else if (message.type === "media-start") startViewerMediaRelay(message.mimeType, message.transport);
    else if (message.type === "offer") handleViewerOffer(message);
    else if (message.type === "ice") handleViewerIce(message);
    else if (message.type === "chat") acceptChat(message.chat);
    else if (message.type === "stream-ended") {
      cleanupViewerPeer();
      cleanupMediaRelay();
      applyStatus({ ...live.status, live: false, startedAt: null });
      setConnection("Ready", "connected");
    } else if (message.type === "error") showToast(message.message || "Live connection error");
  }

  function disconnectViewer() {
    clearTimeout(live.viewerReconnectTimer);
    live.viewerGeneration += 1;
    const socket = live.viewerSocket;
    live.viewerSocket = null;
    live.viewerId = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Leaving live view");
    cleanupViewerPeer();
    cleanupMediaRelay();
  }

  function connectViewer() {
    if (!live.active || live.publishing || live.publisherConnecting) return;
    if (live.viewerSocket && live.viewerSocket.readyState < WebSocket.CLOSING) return;
    if (typeof WebSocket === "undefined" || typeof RTCPeerConnection === "undefined") {
      setConnection("Browser unsupported", "error");
      return;
    }
    clearTimeout(live.viewerReconnectTimer);
    const generation = ++live.viewerGeneration;
    const socket = new WebSocket(socketUrl());
    socket.binaryType = "arraybuffer";
    live.viewerSocket = socket;
    setConnection("Connecting");
    socket.addEventListener("open", () => {
      if (generation !== live.viewerGeneration) return socket.close();
      send(socket, {
        type: "hello",
        role: "viewer",
        name: els.chatName.value.trim() || "Guest",
        relayMimes: supportedRelayMimes(),
        relayTransport: "http"
      });
    });
    socket.addEventListener("message", event => {
      if (typeof event.data === "string") handleViewerMessage(event);
      else handleMediaRelayChunk(event.data);
    });
    socket.addEventListener("close", () => {
      if (generation !== live.viewerGeneration) return;
      live.viewerSocket = null;
      cleanupViewerPeer();
      cleanupMediaRelay();
      if (live.active && !live.publishing && !live.publisherConnecting) {
        setConnection("Reconnecting", "error");
        live.viewerReconnectTimer = setTimeout(connectViewer, 1800);
      }
    });
    socket.addEventListener("error", () => setConnection("Connection interrupted", "error"));
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(x, y, width, height, r);
      return;
    }
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function sourceReady(video) {
    return Boolean(video?.srcObject && video.readyState >= 2 && video.videoWidth && video.videoHeight);
  }

  function drawVideo(context, video, x, y, width, height, cover = false) {
    if (!sourceReady(video)) return false;
    const sourceRatio = video.videoWidth / video.videoHeight;
    const targetRatio = width / height;
    let drawWidth;
    let drawHeight;
    if ((sourceRatio > targetRatio) === cover) {
      drawHeight = height;
      drawWidth = height * sourceRatio;
    } else {
      drawWidth = width;
      drawHeight = width / sourceRatio;
    }
    context.drawImage(video, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    return true;
  }

  function drawCameraCard(context, canvas) {
    if (!els.cameraVisible.checked || !sourceReady(els.cameraVideo)) {
      live.scene.bounds.camera = null;
      return;
    }
    const shape = els.cameraShape.value;
    const size = Number(els.cameraSize.value) / 100;
    let width = canvas.width * size;
    let height = shape === "circle" ? width : width * 9 / 16;
    if (shape === "circle") width = height = Math.min(width, canvas.height * .42);
    const margin = 30;
    const position = els.cameraPosition.value;
    let x = position.endsWith("right") ? canvas.width - width - margin : margin;
    let y = position.startsWith("bottom") ? canvas.height - height - margin : margin;
    if (live.scene.camera.custom || position === "custom") {
      x = live.scene.camera.x * canvas.width;
      y = live.scene.camera.y * canvas.height;
    }
    x = Math.max(0, Math.min(canvas.width - width, x));
    y = Math.max(0, Math.min(canvas.height - height, y));
    live.scene.camera.x = x / canvas.width;
    live.scene.camera.y = y / canvas.height;
    live.scene.bounds.camera = { x, y, width, height };
    const radius = shape === "circle" ? width / 2 : shape === "square" ? 2 : 24;

    context.save();
    context.shadowColor = "rgba(0,0,0,.55)";
    context.shadowBlur = 26;
    roundedRectPath(context, x, y, width, height, radius);
    context.fillStyle = "#111";
    context.fill();
    context.shadowBlur = 0;
    roundedRectPath(context, x, y, width, height, radius);
    context.clip();
    drawVideo(context, els.cameraVideo, x, y, width, height, true);
    context.restore();

    context.save();
    roundedRectPath(context, x, y, width, height, radius);
    context.lineWidth = 4;
    context.strokeStyle = "rgba(255,255,255,.72)";
    context.stroke();
    context.restore();
  }

  function drawTextOverlay(context, canvas) {
    const text = els.overlayText.value.trim();
    if (!text) {
      live.scene.bounds.text = null;
      return;
    }
    const accent = els.overlayColor.value || "#fe2c55";
    let fontSize = Math.round(42 * live.scene.text.scale);
    context.font = `700 ${fontSize}px "DM Sans", sans-serif`;
    const maxWidth = canvas.width * .72;
    while (context.measureText(text).width > maxWidth && fontSize > 24) {
      fontSize -= 2;
      context.font = `700 ${fontSize}px "DM Sans", sans-serif`;
    }
    const textWidth = Math.min(maxWidth, context.measureText(text).width);
    const boxWidth = textWidth + 62;
    const boxHeight = fontSize + 34;
    const placement = els.overlayPosition.value;
    let x = 40;
    let y = canvas.height - boxHeight - 40;
    if (placement === "lower-center") x = (canvas.width - boxWidth) / 2;
    if (placement === "top-left") y = 40;
    if (live.scene.text.custom || placement === "custom") {
      x = live.scene.text.x * canvas.width;
      y = live.scene.text.y * canvas.height;
    }
    x = Math.max(0, Math.min(canvas.width - boxWidth, x));
    y = Math.max(0, Math.min(canvas.height - boxHeight, y));
    live.scene.text.x = x / canvas.width;
    live.scene.text.y = y / canvas.height;
    live.scene.bounds.text = { x, y, width: boxWidth, height: boxHeight };

    context.save();
    context.fillStyle = "rgba(8,8,10,.82)";
    roundedRectPath(context, x, y, boxWidth, boxHeight, 12);
    context.fill();
    context.fillStyle = accent;
    roundedRectPath(context, x, y, 10, boxHeight, 10);
    context.fill();
    context.fillStyle = "white";
    context.textBaseline = "middle";
    context.fillText(text, x + 35, y + boxHeight / 2, maxWidth);
    context.restore();
  }

  function fitCanvasText(context, value, maxWidth) {
    const text = String(value || "");
    if (context.measureText(text).width <= maxWidth) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (context.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return `${text.slice(0, low).trimEnd()}…`;
  }

  function chatAvatarColor(name) {
    const palette = ["#fe2c55", "#8b7cff", "#21a179", "#e18f35", "#3e8ed0", "#d05c9d"];
    let hash = 0;
    for (const character of String(name || "Guest")) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  function drawChatOverlay(context, canvas) {
    if (!els.chatVisible.checked) {
      live.scene.bounds.chat = null;
      return;
    }
    const scale = Math.max(.7, Math.min(1.5, live.scene.chat.scale));
    const messageLimit = Math.max(3, Math.min(6, Number(els.chatMessageCount.value) || 4));
    const messages = live.chats.slice(-messageLimit);
    const visibleRows = Math.max(1, messages.length);
    const width = Math.round(390 * scale);
    const headerHeight = Math.round(44 * scale);
    const rowHeight = Math.round(58 * scale);
    const footerPad = Math.round((messages.length ? 8 : 14) * scale);
    const height = headerHeight + visibleRows * rowHeight + footerPad;
    const margin = 40;
    const placement = els.chatPosition.value;
    let x = placement === "top-left" ? margin : canvas.width - width - margin;
    let y = placement === "bottom-right" ? canvas.height - height - margin : margin;
    if (live.scene.chat.custom || placement === "custom") {
      x = live.scene.chat.x * canvas.width;
      y = live.scene.chat.y * canvas.height;
    }
    x = Math.max(0, Math.min(canvas.width - width, x));
    y = Math.max(0, Math.min(canvas.height - height, y));
    live.scene.chat.x = x / canvas.width;
    live.scene.chat.y = y / canvas.height;
    live.scene.chat.scale = scale;
    live.scene.bounds.chat = { x, y, width, height };

    context.save();
    context.shadowColor = "rgba(0,0,0,.42)";
    context.shadowBlur = Math.round(24 * scale);
    context.fillStyle = "rgba(12,12,15,.88)";
    roundedRectPath(context, x, y, width, height, Math.round(16 * scale));
    context.fill();
    context.shadowBlur = 0;
    context.save();
    roundedRectPath(context, x, y, width, height, Math.round(16 * scale));
    context.clip();
    context.fillStyle = "rgba(255,255,255,.035)";
    context.fillRect(x, y, width, headerHeight);
    context.fillStyle = "#fe2c55";
    context.beginPath();
    context.arc(x + 21 * scale, y + headerHeight / 2, 4.5 * scale, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f4f4f6";
    context.font = `800 ${Math.round(12 * scale)}px "DM Sans", sans-serif`;
    context.textBaseline = "middle";
    context.fillText("LIVE CHAT", x + 34 * scale, y + headerHeight / 2);
    context.fillStyle = "#8a8a94";
    context.font = `650 ${Math.round(10 * scale)}px "DM Sans", sans-serif`;
    context.textAlign = "right";
    context.fillText(messages.length ? `${messages.length} recent` : "waiting", x + width - 18 * scale, y + headerHeight / 2);
    context.textAlign = "left";

    if (!messages.length) {
      context.fillStyle = "#8b8b94";
      context.font = `600 ${Math.round(14 * scale)}px "DM Sans", sans-serif`;
      context.fillText("Messages will appear here", x + 20 * scale, y + headerHeight + rowHeight / 2);
    } else {
      messages.forEach((chat, index) => {
        const rowY = y + headerHeight + index * rowHeight;
        if (index) {
          context.fillStyle = "rgba(255,255,255,.055)";
          context.fillRect(x + 18 * scale, rowY, width - 36 * scale, 1);
        }
        const avatarX = x + 26 * scale;
        const avatarY = rowY + rowHeight / 2;
        context.fillStyle = chatAvatarColor(chat.name);
        context.beginPath();
        context.arc(avatarX, avatarY, 15 * scale, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "white";
        context.font = `800 ${Math.round(9 * scale)}px "DM Sans", sans-serif`;
        context.textAlign = "center";
        context.fillText(initials(chat.name), avatarX, avatarY + .5 * scale);
        context.textAlign = "left";
        const copyX = x + 49 * scale;
        const copyWidth = width - 67 * scale;
        context.fillStyle = chat.role === "host" ? "#ff7893" : "#f2f2f4";
        context.font = `750 ${Math.round(11 * scale)}px "DM Sans", sans-serif`;
        context.fillText(fitCanvasText(context, chat.name || "Guest", copyWidth), copyX, rowY + 19 * scale);
        context.fillStyle = "#b5b5bc";
        context.font = `500 ${Math.round(13 * scale)}px "DM Sans", sans-serif`;
        context.fillText(fitCanvasText(context, chat.text || "", copyWidth), copyX, rowY + 40 * scale);
      });
    }
    context.restore();
    context.strokeStyle = "rgba(255,255,255,.12)";
    context.lineWidth = Math.max(1, scale);
    roundedRectPath(context, x, y, width, height, Math.round(16 * scale));
    context.stroke();
    context.restore();
  }

  function drawPlaceholder(context, canvas) {
    context.fillStyle = "#111114";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255,255,255,.025)";
    context.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 64) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let y = 0; y <= canvas.height; y += 64) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    context.fillStyle = "#f1f1f3";
    context.font = '650 31px "DM Sans", sans-serif';
    context.textAlign = "center";
    context.fillText("No video source", canvas.width / 2, canvas.height / 2 - 8);
    context.fillStyle = "#7d7d86";
    context.font = '500 18px "DM Sans", sans-serif';
    context.fillText("Add a display or camera below", canvas.width / 2, canvas.height / 2 + 28);
    context.textAlign = "left";
  }

  function drawProgramFrame() {
    const canvas = els.canvas;
    const context = canvas.getContext("2d");
    live.scene.bounds.camera = null;
    live.scene.bounds.text = null;
    live.scene.bounds.chat = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#09090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const screenReady = els.screenVisible.checked && sourceReady(els.screenVideo);
    const cameraReady = els.cameraVisible.checked && sourceReady(els.cameraVideo);
    const layout = els.layout.value;

    if (!screenReady && !cameraReady) drawPlaceholder(context, canvas);
    else if (layout === "camera-full") drawVideo(context, cameraReady ? els.cameraVideo : els.screenVideo, 0, 0, canvas.width, canvas.height, true);
    else if (layout === "screen-only") drawVideo(context, screenReady ? els.screenVideo : els.cameraVideo, 0, 0, canvas.width, canvas.height, false);
    else if (layout === "split") {
      context.fillStyle = "#111";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const gap = 8;
      const half = (canvas.width - gap) / 2;
      if (screenReady) drawVideo(context, els.screenVideo, 0, 0, half, canvas.height, false);
      if (cameraReady) drawVideo(context, els.cameraVideo, half + gap, 0, half, canvas.height, true);
      context.fillStyle = els.overlayColor.value || "#fe2c55";
      context.fillRect(half, 0, gap, canvas.height);
    } else {
      drawVideo(context, screenReady ? els.screenVideo : els.cameraVideo, 0, 0, canvas.width, canvas.height, !screenReady);
      if (screenReady) drawCameraCard(context, canvas);
    }

    drawTextOverlay(context, canvas);
    drawChatOverlay(context, canvas);
    if (live.publishing) {
      context.save();
      context.fillStyle = "#fe2c55";
      roundedRectPath(context, canvas.width - 130, canvas.height - 66, 90, 32, 6);
      context.fill();
      context.fillStyle = "white";
      context.font = '800 15px "DM Sans", sans-serif';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("LIVE", canvas.width - 85, canvas.height - 50);
      context.restore();
    }
    updateSelectionBox();
  }

  function selectLayer(layer) {
    live.scene.selected = ["screen", "camera", "text", "chat"].includes(layer) ? layer : null;
    els.layerButtons.forEach(button => button.classList.toggle("selected", button.dataset.studioLayer === live.scene.selected));
    updateSelectionBox();
  }

  function updateSelectionBox() {
    if (!els.studioDialog.open || !["camera", "text", "chat"].includes(live.scene.selected)) {
      els.selectionBox.classList.add("hidden");
      return;
    }
    const bounds = live.scene.bounds[live.scene.selected];
    if (!bounds) {
      els.selectionBox.classList.add("hidden");
      return;
    }
    els.selectionBox.classList.remove("hidden");
    els.selectionLabel.textContent = ({ camera: "Camera", text: "Text overlay", chat: "Live chat" })[live.scene.selected];
    els.selectionBox.style.left = `${bounds.x / els.canvas.width * 100}%`;
    els.selectionBox.style.top = `${bounds.y / els.canvas.height * 100}%`;
    els.selectionBox.style.width = `${bounds.width / els.canvas.width * 100}%`;
    els.selectionBox.style.height = `${bounds.height / els.canvas.height * 100}%`;
  }

  function canvasPoint(event) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * els.canvas.width / rect.width,
      y: (event.clientY - rect.top) * els.canvas.height / rect.height
    };
  }

  function pointInBounds(point, bounds) {
    return Boolean(bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
  }

  function layerAtPoint(point) {
    if (pointInBounds(point, live.scene.bounds.chat)) return "chat";
    if (pointInBounds(point, live.scene.bounds.text)) return "text";
    if (pointInBounds(point, live.scene.bounds.camera)) return "camera";
    return null;
  }

  function nearResizeHandle(point, bounds) {
    if (!bounds) return false;
    const threshold = 28;
    return Math.abs(point.x - (bounds.x + bounds.width)) <= threshold && Math.abs(point.y - (bounds.y + bounds.height)) <= threshold;
  }

  function handleCanvasPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const point = canvasPoint(event);
    const layer = layerAtPoint(point);
    selectLayer(layer);
    if (!layer) return;
    const bounds = { ...live.scene.bounds[layer] };
    live.scene.drag = {
      pointerId: event.pointerId,
      layer,
      mode: nearResizeHandle(point, bounds) ? "resize" : "move",
      start: point,
      bounds,
      textScale: live.scene.text.scale,
      chatScale: live.scene.chat.scale
    };
    els.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleResizePointerDown(event) {
    const layer = live.scene.selected;
    const bounds = live.scene.bounds[layer];
    if (!bounds || !["camera", "text", "chat"].includes(layer)) return;
    live.scene.drag = {
      pointerId: event.pointerId,
      layer,
      mode: "resize",
      start: canvasPoint(event),
      bounds: { ...bounds },
      textScale: live.scene.text.scale,
      chatScale: live.scene.chat.scale
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function handleCanvasPointerMove(event) {
    const point = canvasPoint(event);
    const drag = live.scene.drag;
    if (!drag) {
      const layer = layerAtPoint(point);
      const bounds = layer ? live.scene.bounds[layer] : null;
      els.canvas.classList.toggle("can-resize", Boolean(layer && nearResizeHandle(point, bounds)));
      els.canvas.classList.toggle("can-move", Boolean(layer && !nearResizeHandle(point, bounds)));
      return;
    }
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (drag.mode === "resize") {
      const ratio = Math.max(.5, Math.min(2.5, (drag.bounds.width + dx) / drag.bounds.width));
      if (drag.layer === "camera") {
        const percent = Math.max(16, Math.min(60, drag.bounds.width * ratio / els.canvas.width * 100));
        els.cameraSize.value = String(Math.round(percent));
        els.cameraSizeOutput.value = `${Math.round(percent)}%`;
        live.scene.camera.custom = true;
        els.cameraPosition.value = "custom";
      } else if (drag.layer === "text") {
        live.scene.text.scale = Math.max(.6, Math.min(2.25, drag.textScale * ratio));
        els.textScale.value = String(Math.round(live.scene.text.scale * 100));
        els.textScaleOutput.value = `${Math.round(live.scene.text.scale * 100)}%`;
        live.scene.text.custom = true;
        els.overlayPosition.value = "custom";
      } else {
        live.scene.chat.scale = Math.max(.7, Math.min(1.5, drag.chatScale * ratio));
        els.chatScale.value = String(Math.round(live.scene.chat.scale * 100));
        els.chatScaleOutput.value = `${Math.round(live.scene.chat.scale * 100)}%`;
        live.scene.chat.custom = true;
        els.chatPosition.value = "custom";
      }
    } else {
      const x = Math.max(0, Math.min(els.canvas.width - drag.bounds.width, drag.bounds.x + dx));
      const y = Math.max(0, Math.min(els.canvas.height - drag.bounds.height, drag.bounds.y + dy));
      live.scene[drag.layer].x = x / els.canvas.width;
      live.scene[drag.layer].y = y / els.canvas.height;
      live.scene[drag.layer].custom = true;
      if (drag.layer === "camera") els.cameraPosition.value = "custom";
      else if (drag.layer === "text") els.overlayPosition.value = "custom";
      else els.chatPosition.value = "custom";
    }
    event.preventDefault();
  }

  function finishCanvasDrag(event) {
    if (!live.scene.drag) return;
    try { els.canvas.releasePointerCapture?.(live.scene.drag.pointerId); } catch { /* Pointer capture may already be released. */ }
    try { event?.currentTarget?.releasePointerCapture?.(live.scene.drag.pointerId); } catch { /* Pointer capture may already be released. */ }
    live.scene.drag = null;
    event?.preventDefault();
  }

  function handleCanvasKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const layer = live.scene.selected;
    if (!["camera", "text", "chat"].includes(layer) || !live.scene.bounds[layer]) return;
    const amount = event.shiftKey ? 10 : 2;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    const bounds = live.scene.bounds[layer];
    const x = Math.max(0, Math.min(els.canvas.width - bounds.width, bounds.x + dx));
    const y = Math.max(0, Math.min(els.canvas.height - bounds.height, bounds.y + dy));
    live.scene[layer].x = x / els.canvas.width;
    live.scene[layer].y = y / els.canvas.height;
    live.scene[layer].custom = true;
    if (layer === "camera") els.cameraPosition.value = "custom";
    else if (layer === "text") els.overlayPosition.value = "custom";
    else els.chatPosition.value = "custom";
    event.preventDefault();
  }

  function resetSceneLayout() {
    live.scene.camera = { custom: false, x: .69, y: .69 };
    live.scene.text = { custom: false, x: .03, y: .82, scale: 1 };
    live.scene.chat = { custom: false, x: .64, y: .06, scale: 1 };
    els.cameraPosition.value = "bottom-right";
    els.cameraSize.value = "28";
    els.cameraSizeOutput.value = "28%";
    els.overlayPosition.value = "lower-left";
    els.textScale.value = "100";
    els.textScaleOutput.value = "100%";
    els.chatPosition.value = "top-right";
    els.chatScale.value = "100";
    els.chatScaleOutput.value = "100%";
    selectLayer(null);
    showToast("Scene layout reset.");
  }

  function renderTick(timestamp = performance.now()) {
    if (timestamp - live.lastDrawAt >= 1000 / 60) {
      live.lastDrawAt = timestamp;
      drawProgramFrame();
      updateAudioMeters();
    }
  }

  function renderLoop(timestamp = 0) {
    renderTick(timestamp);
    live.drawRequest = requestAnimationFrame(renderLoop);
  }

  function ensureRenderer() {
    if (live.drawRequest) return;
    live.lastDrawAt = 0;
    drawProgramFrame();
    live.drawRequest = requestAnimationFrame(renderLoop);
    live.drawTimer = setInterval(() => renderTick(performance.now()), 1000 / 60);
  }

  function stopRenderer() {
    if (live.drawRequest) cancelAnimationFrame(live.drawRequest);
    clearInterval(live.drawTimer);
    live.drawRequest = 0;
    live.drawTimer = null;
    live.lastDrawAt = 0;
  }

  function stopStream(stream) {
    stream?.getTracks().forEach(track => track.stop());
  }

  function updateSourceButtons() {
    const screenConnected = Boolean(live.screenStream?.active);
    const cameraConnected = Boolean(live.cameraStream?.active);
    const textConnected = Boolean(els.overlayText.value.trim());
    const chatConnected = els.chatVisible.checked;
    const visibleChatCount = Math.min(live.chats.length, Number(els.chatMessageCount.value) || 4);
    els.chooseScreen.classList.toggle("connected", screenConnected);
    els.chooseCamera.classList.toggle("connected", cameraConnected);
    els.screenSourceStatus.textContent = screenConnected ? (live.screenStream.getVideoTracks()[0]?.label || "Connected") : "Not connected";
    els.cameraSourceStatus.textContent = cameraConnected ? (live.cameraStream.getVideoTracks()[0]?.label || "Connected") : "Not connected";
    els.textSourceStatus.textContent = textConnected ? els.overlayText.value.trim() : "Empty";
    els.chatSourceStatus.textContent = chatConnected ? `Visible · ${visibleChatCount} message${visibleChatCount === 1 ? "" : "s"}` : "Hidden";
    els.screenState.classList.toggle("on", screenConnected && els.screenVisible.checked);
    els.cameraState.classList.toggle("on", cameraConnected && els.cameraVisible.checked);
    els.textState.classList.toggle("on", textConnected);
    els.chatState.classList.toggle("on", chatConnected);
  }

  async function chooseScreen() {
    els.studioError.textContent = "";
    if (!navigator.mediaDevices?.getDisplayMedia) {
      els.studioError.textContent = "Screen sharing requires a current Chrome or Firefox browser over HTTPS.";
      return;
    }
    try {
      await ensureAudioMixer();
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: true });
      stopStream(live.screenStream);
      live.screenStream = stream;
      els.screenVideo.srcObject = stream;
      await els.screenVideo.play();
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (live.screenStream !== stream) return;
        live.screenStream = null;
        els.screenVideo.srcObject = null;
        updateSourceButtons();
        rebuildAudioMixer();
        showToast("Screen sharing stopped.");
      }, { once: true });
      applySourceToggles();
      updateSourceButtons();
      selectLayer("screen");
      await rebuildAudioMixer();
      updateStudioUI();
    } catch (error) {
      if (error.name !== "NotAllowedError") els.studioError.textContent = error.message || "Could not share that screen.";
    }
  }

  async function chooseCamera() {
    els.studioError.textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      els.studioError.textContent = "Camera access requires a current browser over HTTPS.";
      return;
    }
    try {
      await ensureAudioMixer();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      stopStream(live.cameraStream);
      live.cameraStream = stream;
      els.cameraVideo.srcObject = stream;
      await els.cameraVideo.play();
      stream.getAudioTracks().forEach(track => { track.enabled = els.micEnabled.checked; });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (live.cameraStream !== stream) return;
        live.cameraStream = null;
        els.cameraVideo.srcObject = null;
        updateSourceButtons();
        rebuildAudioMixer();
      }, { once: true });
      applySourceToggles();
      updateSourceButtons();
      selectLayer("camera");
      await rebuildAudioMixer();
      updateStudioUI();
    } catch (error) {
      if (error.name !== "NotAllowedError") els.studioError.textContent = error.message || "Could not open the camera and microphone.";
    }
  }

  function desiredAudioTracks() {
    const cameraTracks = live.cameraStream?.getAudioTracks() || [];
    const screenTracks = live.screenStream?.getAudioTracks() || [];
    const micOn = els.micEnabled.checked && els.micMuteButton.getAttribute("aria-pressed") !== "true";
    const desktopOn = els.screenVisible.checked && els.screenAudio.checked && els.desktopMuteButton.getAttribute("aria-pressed") !== "true";
    cameraTracks.forEach(track => { track.enabled = micOn; });
    screenTracks.forEach(track => { track.enabled = desktopOn; });
    return [...cameraTracks, ...screenTracks].filter(track => track.readyState === "live");
  }

  function applySourceToggles() {
    live.cameraStream?.getVideoTracks().forEach(track => { track.enabled = els.cameraVisible.checked; });
    live.screenStream?.getVideoTracks().forEach(track => { track.enabled = els.screenVisible.checked; });
    desiredAudioTracks();
  }

  async function resumeAudioContext(context) {
    if (context.state !== "suspended") return;
    await Promise.race([
      context.resume().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 500))
    ]);
  }

  async function ensureAudioMixer() {
    if (live.audio.context) {
      await resumeAudioContext(live.audio.context);
      return live.audio.context;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    live.audio.context = context;
    live.audio.destination = context.createMediaStreamDestination();
    await resumeAudioContext(context);
    return context;
  }

  function disconnectAudioNodes() {
    live.audio.nodes.forEach(node => {
      try { node.source.disconnect(); } catch { /* Already disconnected. */ }
      try { node.gain.disconnect(); } catch { /* Already disconnected. */ }
      try { node.analyser.disconnect(); } catch { /* Already disconnected. */ }
    });
    live.audio.nodes = [];
    live.audio.micGain = null;
    live.audio.desktopGain = null;
    live.audio.micAnalyser = null;
    live.audio.desktopAnalyser = null;
    live.audio.micData = null;
    live.audio.desktopData = null;
  }

  function connectMixerSource(stream, channel) {
    const tracks = stream?.getAudioTracks().filter(track => track.readyState === "live") || [];
    if (!tracks.length || !live.audio.context || !live.audio.destination) return;
    const source = live.audio.context.createMediaStreamSource(new MediaStream(tracks));
    const gain = live.audio.context.createGain();
    const analyser = live.audio.context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = .72;
    source.connect(gain);
    gain.connect(live.audio.destination);
    gain.connect(analyser);
    live.audio.nodes.push({ source, gain, analyser });
    if (channel === "mic") {
      live.audio.micGain = gain;
      live.audio.micAnalyser = analyser;
      live.audio.micData = new Uint8Array(analyser.fftSize);
    } else {
      live.audio.desktopGain = gain;
      live.audio.desktopAnalyser = analyser;
      live.audio.desktopData = new Uint8Array(analyser.fftSize);
    }
  }

  async function rebuildAudioMixer() {
    const context = await ensureAudioMixer();
    if (!context) {
      await syncOutputAudio();
      return;
    }
    disconnectAudioNodes();
    connectMixerSource(live.cameraStream, "mic");
    connectMixerSource(live.screenStream, "desktop");
    updateAudioGains();
    await syncOutputAudio();
  }

  function updateAudioGains() {
    desiredAudioTracks();
    const now = live.audio.context?.currentTime || 0;
    const micMuted = !els.micEnabled.checked || els.micMuteButton.getAttribute("aria-pressed") === "true";
    const desktopMuted = !els.screenVisible.checked || !els.screenAudio.checked || els.desktopMuteButton.getAttribute("aria-pressed") === "true";
    const micValue = micMuted ? 0 : Number(els.micLevel.value) / 100;
    const desktopValue = desktopMuted ? 0 : Number(els.desktopLevel.value) / 100;
    if (live.audio.micGain) live.audio.micGain.gain.setTargetAtTime(micValue, now, .015);
    if (live.audio.desktopGain) live.audio.desktopGain.gain.setTargetAtTime(desktopValue, now, .015);
  }

  function readAudioLevel(analyser, data) {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.min(100, Math.round(Math.sqrt(sum / data.length) * 360));
  }

  function updateAudioMeters() {
    const micLevel = readAudioLevel(live.audio.micAnalyser, live.audio.micData);
    const desktopLevel = readAudioLevel(live.audio.desktopAnalyser, live.audio.desktopData);
    els.micMeter.style.width = `${micLevel}%`;
    els.desktopMeter.style.width = `${desktopLevel}%`;
  }

  function shutdownAudioMixer() {
    disconnectAudioNodes();
    const context = live.audio.context;
    live.audio.context = null;
    live.audio.destination = null;
    if (context && context.state !== "closed") context.close().catch(() => {});
    els.micMeter.style.width = "0%";
    els.desktopMeter.style.width = "0%";
  }

  async function syncOutputAudio() {
    if (!live.outputStream) return;
    const mixedTrack = live.audio.destination?.stream.getAudioTracks()[0];
    const desired = mixedTrack ? [mixedTrack] : desiredAudioTracks();
    for (const track of live.outputStream.getAudioTracks()) {
      if (!desired.includes(track)) live.outputStream.removeTrack(track);
    }
    for (const track of desired) {
      if (!live.outputStream.getAudioTracks().includes(track)) live.outputStream.addTrack(track);
    }

    for (const [viewerId, entry] of live.publisherPeers) {
      let changed = false;
      for (const sender of entry.peer.getSenders().filter(item => item.track?.kind === "audio")) {
        if (!desired.includes(sender.track)) {
          entry.peer.removeTrack(sender);
          changed = true;
        }
      }
      const senderTracks = entry.peer.getSenders().map(sender => sender.track).filter(Boolean);
      for (const track of desired) {
        if (!senderTracks.includes(track)) {
          entry.peer.addTrack(track, live.outputStream);
          changed = true;
        }
      }
      if (changed) await negotiatePublisher(viewerId, entry);
    }
  }

  async function negotiatePublisher(viewerId, entry) {
    if (!entry || entry.peer.signalingState === "closed") return;
    if (entry.negotiating || entry.peer.signalingState !== "stable") {
      entry.needsNegotiation = true;
      return;
    }
    entry.negotiating = true;
    entry.needsNegotiation = false;
    try {
      const offer = await entry.peer.createOffer();
      await entry.peer.setLocalDescription(offer);
      send(live.publisherSocket, { type: "offer", to: viewerId, sdp: entry.peer.localDescription });
    } catch (error) {
      console.error("Could not create live offer:", error);
    } finally {
      entry.negotiating = false;
    }
  }

  async function createPublisherPeer(viewerId) {
    if (!live.publishing || !live.outputStream || live.publisherPeers.has(viewerId)) return;
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const entry = { peer, ice: [], negotiating: false, needsNegotiation: false };
    live.publisherPeers.set(viewerId, entry);
    for (const track of live.outputStream.getTracks()) {
      const sender = peer.addTrack(track, live.outputStream);
      if (track.kind === "video") {
        try {
          const parameters = sender.getParameters();
          for (const encoding of parameters.encodings || []) {
            encoding.maxBitrate = 8_000_000;
            encoding.maxFramerate = 60;
          }
          await sender.setParameters(parameters);
        } catch { /* Some browsers manage encoder settings automatically. */ }
      }
    }
    peer.onicecandidate = event => send(live.publisherSocket, { type: "ice", to: viewerId, candidate: event.candidate });
    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) removePublisherPeer(viewerId);
    };
    await negotiatePublisher(viewerId, entry);
  }

  function removePublisherPeer(viewerId) {
    const entry = live.publisherPeers.get(viewerId);
    if (!entry) return;
    try { entry.peer.close(); } catch { /* Already closed. */ }
    live.publisherPeers.delete(viewerId);
  }

  function closePublisherPeers() {
    for (const viewerId of [...live.publisherPeers.keys()]) removePublisherPeer(viewerId);
  }

  function choosePublisherRelayMime() {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
    const candidates = live.outputStream?.getAudioTracks().length
      ? RELAY_MIME_TYPES
      : ["video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1.42e01e", "video/mp4"];
    return candidates.find(mimeType => MediaRecorder.isTypeSupported(mimeType)) || "";
  }

  async function flushPublisherMediaQueue() {
    if (live.mediaSending) return;
    live.mediaSending = true;
    try {
      while (live.mediaQueue.length) {
        const socket = live.publisherSocket;
        if (!live.publishing || !socket || socket.readyState !== WebSocket.OPEN) break;
        if (socket.bufferedAmount >= 16 * 1024 * 1024) break;
        const blob = live.mediaQueue[0];
        const data = await blob.arrayBuffer();
        if (!live.publishing || live.publisherSocket !== socket || socket.readyState !== WebSocket.OPEN) break;
        socket.send(data);
        live.mediaQueue.shift();
      }
    } catch (error) {
      console.warn("Could not send a live relay segment:", error);
    } finally {
      live.mediaSending = false;
      if (live.mediaQueue.length && live.publishing) setTimeout(flushPublisherMediaQueue, 35);
    }
  }

  function stopPublisherMediaRelay() {
    live.mediaRelayGeneration += 1;
    clearTimeout(live.mediaRotateTimer);
    live.mediaRotateTimer = null;
    const recorder = live.mediaRecorder;
    live.mediaRecorder = null;
    live.mediaQueue = [];
    live.mediaSending = false;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Recorder already stopped itself. */ }
    }
  }

  function startPublisherMediaRelay() {
    stopPublisherMediaRelay();
    if (!live.outputStream || typeof MediaRecorder === "undefined") return false;
    const mimeType = choosePublisherRelayMime();
    if (!mimeType) return false;
    const generation = live.mediaRelayGeneration;
    try {
      const recorder = new MediaRecorder(live.outputStream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 192_000,
        videoKeyFrameIntervalDuration: 1_000
      });
      live.mediaRecorder = recorder;
      recorder.addEventListener("dataavailable", event => {
        if (generation !== live.mediaRelayGeneration || live.mediaRecorder !== recorder || !event.data?.size) return;
        live.mediaQueue.push(event.data);
        flushPublisherMediaQueue();
      });
      recorder.addEventListener("error", event => {
        if (generation !== live.mediaRelayGeneration) return;
        console.warn("Live media relay recorder stopped:", event.error || event);
        els.studioError.textContent = "The network relay stopped; direct peer delivery is still active.";
        stopPublisherMediaRelay();
      });
      send(live.publisherSocket, { type: "media-start", mimeType, mode: "continuous" });
      recorder.start(250);
      return true;
    } catch (error) {
      console.warn("This browser could not start the continuous live relay:", error);
      stopPublisherMediaRelay();
      return false;
    }
  }

  async function handlePublisherAnswer(message) {
    const entry = live.publisherPeers.get(message.from);
    if (!entry || !message.sdp) return;
    try {
      await entry.peer.setRemoteDescription(message.sdp);
      for (const candidate of entry.ice.splice(0)) await entry.peer.addIceCandidate(candidate);
      if (entry.needsNegotiation) await negotiatePublisher(message.from, entry);
    } catch { /* Viewer may have left during negotiation. */ }
  }

  async function handlePublisherIce(message) {
    const entry = live.publisherPeers.get(message.from);
    if (!entry) return;
    if (!entry.peer.remoteDescription) {
      entry.ice.push(message.candidate ?? null);
      return;
    }
    try { await entry.peer.addIceCandidate(message.candidate ?? null); } catch { /* Ignore stale candidates. */ }
  }

  function updateStudioUI() {
    const busy = live.publisherConnecting;
    els.studioAir.classList.toggle("is-live", live.publishing);
    $("span", els.studioAir).textContent = live.publishing ? "On air" : busy ? "Connecting" : "Preview";
    els.startBroadcast.disabled = live.publishing || busy;
    els.endBroadcast.disabled = !live.publishing && !busy;
    if (live.publishing) els.studioStatus.textContent = "Broadcast is live. Scene edits update instantly.";
    else if (busy) els.studioStatus.textContent = "Connecting securely to Whiskr Live...";
    else if (live.screenStream || live.cameraStream || els.overlayText.value.trim() || els.chatVisible.checked) els.studioStatus.textContent = "Scene ready. Add a title and go live.";
    else els.studioStatus.textContent = "Choose a source or add an overlay to build your scene.";
    els.studioViewerCount.textContent = String(live.status.viewerCount || 0);
    updateSourceButtons();
  }

  function teardownPublisher({ reconnectViewer = true } = {}) {
    live.publisherConnecting = false;
    live.publishing = false;
    stopChatTts();
    stopPublisherMediaRelay();
    const socket = live.publisherSocket;
    live.publisherSocket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Broadcast ended");
    closePublisherPeers();
    if (live.outputStream) {
      live.outputStream.getVideoTracks().forEach(track => track.stop());
      live.outputStream = null;
    }
    updateStudioUI();
    applyStatus({ live: false, title: "Whiskr Live", description: "", streamer: "", startedAt: null, viewerCount: 0 });
    if (reconnectViewer && live.active) setTimeout(connectViewer, 350);
  }

  function handlePublisherMessage(event) {
    const message = parseMessage(event);
    if (!message) return;
    if (message.type === "hello-ack") {
      live.publisherConnecting = false;
      live.publishing = true;
      applyStatus(message.status);
      loadChatHistory(message.chatHistory);
      startPublisherMediaRelay();
      updateStudioUI();
      showToast("You are live on Whiskr.");
    } else if (message.type === "viewer-joined") createPublisherPeer(message.viewerId);
    else if (message.type === "viewer-left") removePublisherPeer(message.viewerId);
    else if (message.type === "answer") handlePublisherAnswer(message);
    else if (message.type === "ice") handlePublisherIce(message);
    else if (message.type === "stream-status") applyStatus(message.status);
    else if (message.type === "chat") acceptChat(message.chat);
    else if (message.type === "replaced") {
      showToast(message.message || "This stream was opened elsewhere.");
      teardownPublisher();
    } else if (message.type === "error") {
      els.studioError.textContent = message.message || "Could not start the broadcast.";
      if (live.publisherConnecting) teardownPublisher();
    }
  }

  async function startBroadcast() {
    els.studioError.textContent = "";
    if (live.publisherConnecting || live.publishing) return;
    const graphicsReady = Boolean(els.overlayText.value.trim() || els.chatVisible.checked);
    if ((!els.screenVisible.checked || !sourceReady(els.screenVideo)) && (!els.cameraVisible.checked || !sourceReady(els.cameraVideo)) && !graphicsReady) {
      els.studioError.textContent = "Choose a screen or camera, or add an overlay before going live.";
      return;
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
      els.studioError.textContent = "Live publishing requires HTTPS. Open Whiskr through its secure public address.";
      return;
    }
    if (typeof els.canvas.captureStream !== "function") {
      els.studioError.textContent = "This browser cannot capture the live editor canvas.";
      return;
    }

    ensureRenderer();
    const sourceAudioTracks = desiredAudioTracks();
    if (sourceAudioTracks.length) {
      await ensureAudioMixer();
      await rebuildAudioMixer();
    }
    const canvasStream = els.canvas.captureStream(60);
    const videoTrack = canvasStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.contentHint = "detail";
    live.outputStream = new MediaStream(canvasStream.getVideoTracks());
    const mixedTrack = live.audio.destination?.stream.getAudioTracks()[0];
    (sourceAudioTracks.length && mixedTrack ? [mixedTrack] : sourceAudioTracks).forEach(track => live.outputStream.addTrack(track));
    live.publisherConnecting = true;
    disconnectViewer();
    updateStudioUI();

    const socket = new WebSocket(socketUrl());
    live.publisherSocket = socket;
    socket.addEventListener("open", () => send(socket, {
      type: "hello",
      role: "publisher",
      title: els.studioTitle.value.trim() || "Whiskr Live",
      description: els.studioDescription.value.trim(),
      streamer: els.studioStreamerName.value.trim(),
      name: els.studioStreamerName.value.trim() || els.chatName.value.trim() || "Host"
    }));
    socket.addEventListener("message", handlePublisherMessage);
    socket.addEventListener("close", event => {
      if (live.publisherSocket !== socket) return;
      live.publisherSocket = null;
      const wasLive = live.publishing;
      teardownPublisher();
      if (wasLive) {
        const reason = event.reason || (event.code === 1006 ? "The network connection closed unexpectedly." : "The live connection ended.");
        els.studioError.textContent = `Broadcast stopped: ${reason}`;
        showToast("The live connection ended.");
        console.warn(`Live publisher socket closed (${event.code}): ${reason}`);
      }
    });
    socket.addEventListener("error", () => { els.studioError.textContent = "Could not connect to the live server."; });
  }

  function endBroadcast() {
    if (!live.publishing && !live.publisherConnecting) return;
    teardownPublisher();
    showToast("Broadcast ended.");
  }

  function releaseSources() {
    stopStream(live.screenStream);
    stopStream(live.cameraStream);
    live.screenStream = null;
    live.cameraStream = null;
    els.screenVideo.srcObject = null;
    els.cameraVideo.srcObject = null;
    updateSourceButtons();
  }

  function openStudio() {
    if (!window.isSecureContext && location.hostname !== "localhost") showToast("Use the HTTPS Whiskr address to share a screen or camera.");
    ensureRenderer();
    if (!els.studioDialog.open) els.studioDialog.showModal();
    document.body.classList.add("dialog-open");
    updateStudioUI();
  }

  function submitChat(event) {
    event.preventDefault();
    const name = els.chatName.value.trim();
    const text = els.chatMessage.value.trim();
    if (name.length < 2) {
      showToast("Enter a nickname with at least 2 characters.");
      els.chatName.focus();
      return;
    }
    if (!text) return;
    localStorage.setItem("whiskr_live_name", name);
    const socket = live.publishing ? live.publisherSocket : live.viewerSocket;
    if (!send(socket, { type: "chat", name, text })) {
      showToast("Chat is reconnecting. Try again in a moment.");
      return;
    }
    els.chatMessage.value = "";
  }

  function enter() {
    live.active = true;
    refreshStatus();
    connectViewer();
  }

  function leave() {
    live.active = false;
    if (!live.publishing && !live.publisherConnecting) disconnectViewer();
  }

  function refresh() {
    refreshStatus();
    if (live.publishing || live.publisherConnecting) return;
    disconnectViewer();
    live.active = true;
    connectViewer();
  }

  function bindEvents() {
    els.openStudioButton.addEventListener("click", openStudio);
    els.chooseScreen.addEventListener("click", chooseScreen);
    els.chooseCamera.addEventListener("click", chooseCamera);
    els.startBroadcast.addEventListener("click", startBroadcast);
    els.endBroadcast.addEventListener("click", endBroadcast);
    els.chatForm.addEventListener("submit", submitChat);
    els.soundButton.addEventListener("click", () => {
      els.player.muted = !els.player.muted;
      els.player.play().catch(() => {});
      updateSoundButton();
    });
    els.resetScene.addEventListener("click", resetSceneLayout);
    els.layerButtons.forEach(button => button.addEventListener("click", () => selectLayer(button.dataset.studioLayer)));
    els.canvas.addEventListener("pointerdown", handleCanvasPointerDown);
    els.canvas.addEventListener("pointermove", handleCanvasPointerMove);
    els.canvas.addEventListener("pointerup", finishCanvasDrag);
    els.canvas.addEventListener("pointercancel", finishCanvasDrag);
    els.canvas.addEventListener("keydown", handleCanvasKeydown);
    els.resizeHandle.addEventListener("pointerdown", handleResizePointerDown);
    els.resizeHandle.addEventListener("pointermove", handleCanvasPointerMove);
    els.resizeHandle.addEventListener("pointerup", finishCanvasDrag);
    els.resizeHandle.addEventListener("pointercancel", finishCanvasDrag);
    els.cameraSize.addEventListener("input", () => {
      els.cameraSizeOutput.value = `${els.cameraSize.value}%`;
      if (els.cameraPosition.value === "custom") live.scene.camera.custom = true;
    });
    els.cameraPosition.addEventListener("change", () => { live.scene.camera.custom = els.cameraPosition.value === "custom"; });
    els.overlayPosition.addEventListener("change", () => { live.scene.text.custom = els.overlayPosition.value === "custom"; });
    els.chatPosition.addEventListener("change", () => { live.scene.chat.custom = els.chatPosition.value === "custom"; });
    els.textScale.addEventListener("input", () => {
      live.scene.text.scale = Number(els.textScale.value) / 100;
      els.textScaleOutput.value = `${els.textScale.value}%`;
      if (els.overlayText.value.trim()) selectLayer("text");
    });
    els.overlayText.addEventListener("input", () => {
      updateSourceButtons();
      if (els.overlayText.value.trim()) selectLayer("text");
    });
    els.chatScale.addEventListener("input", () => {
      live.scene.chat.scale = Number(els.chatScale.value) / 100;
      els.chatScaleOutput.value = `${els.chatScale.value}%`;
      if (els.chatVisible.checked) selectLayer("chat");
    });
    els.chatMessageCount.addEventListener("change", () => {
      updateSourceButtons();
      if (els.chatVisible.checked) selectLayer("chat");
    });
    els.chatVisible.addEventListener("change", () => {
      updateSourceButtons();
      if (els.chatVisible.checked) selectLayer("chat");
      else if (live.scene.selected === "chat") selectLayer(null);
    });
    els.chatTts.addEventListener("change", () => {
      if (!els.chatTts.checked) stopChatTts();
      updateTtsStatus();
    });
    window.speechSynthesis?.addEventListener?.("voiceschanged", updateTtsStatus);
    els.micLevel.addEventListener("input", updateAudioGains);
    els.desktopLevel.addEventListener("input", updateAudioGains);
    els.micMuteButton.addEventListener("click", () => {
      const muted = els.micMuteButton.getAttribute("aria-pressed") !== "true";
      els.micMuteButton.setAttribute("aria-pressed", String(muted));
      els.micEnabled.checked = !muted;
      applySourceToggles();
      updateAudioGains();
    });
    els.desktopMuteButton.addEventListener("click", () => {
      const muted = els.desktopMuteButton.getAttribute("aria-pressed") !== "true";
      els.desktopMuteButton.setAttribute("aria-pressed", String(muted));
      els.screenAudio.checked = !muted;
      applySourceToggles();
      updateAudioGains();
    });
    [els.screenVisible, els.cameraVisible, els.micEnabled, els.screenAudio].forEach(control => control.addEventListener("change", () => {
      if (control === els.micEnabled) els.micMuteButton.setAttribute("aria-pressed", String(!els.micEnabled.checked));
      if (control === els.screenAudio) els.desktopMuteButton.setAttribute("aria-pressed", String(!els.screenAudio.checked));
      applySourceToggles();
      updateAudioGains();
      updateSourceButtons();
      syncOutputAudio();
    }));
    const updateMetadata = () => {
      clearTimeout(live.titleTimer);
      live.titleTimer = setTimeout(() => {
        if (live.publishing) send(live.publisherSocket, {
          type: "stream-meta",
          title: els.studioTitle.value.trim() || "Whiskr Live",
          description: els.studioDescription.value.trim(),
          streamer: els.studioStreamerName.value.trim()
        });
      }, 250);
    };
    [els.studioTitle, els.studioDescription, els.studioStreamerName].forEach(control => control.addEventListener("input", updateMetadata));
    els.studioDialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
      if (!live.publishing && !live.publisherConnecting) {
        releaseSources();
        shutdownAudioMixer();
        stopRenderer();
      }
    });
    window.addEventListener("beforeunload", () => {
      stopChatTts();
      stopPublisherMediaRelay();
      if (live.publisherSocket?.readyState === WebSocket.OPEN) live.publisherSocket.close(1000, "Page closed");
      if (live.viewerSocket?.readyState === WebSocket.OPEN) live.viewerSocket.close(1000, "Page closed");
      stopStream(live.screenStream);
      stopStream(live.cameraStream);
      shutdownAudioMixer();
    });
  }

  els.chatName.value = localStorage.getItem("whiskr_live_name") || "";
  bindEvents();
  renderChats();
  updateSourceButtons();
  updateTtsStatus();
  drawProgramFrame();

  window.WhiskrLive = { enter, leave, refresh, openStudio, endBroadcast };
  if (location.hash.replace(/^#\/?/, "").split("/")[0] === "live") enter();
})();
