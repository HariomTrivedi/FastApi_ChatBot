// Chat elements removed - now using dashboard instead
// const messagesEl = document.getElementById("messages");
// const inputEl = document.getElementById("input");
// const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const currentUserNameEl = document.getElementById("currentUserName");
const logoutBtn = document.getElementById("logoutBtn");
const chatCard = document.getElementById("chatCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginCard = document.getElementById("loginCard");
const authCard = document.getElementById("authCard");
const authWrapper = document.getElementById("authWrapper");
const loginStatus = document.getElementById("loginStatus");
const sidebar = document.getElementById("sidebar");
const usersList = document.getElementById("usersList");
const friendsList = document.getElementById("friendsList");
const friendRequestsList = document.getElementById("friendRequestsList");
const hamburgerBtn = document.getElementById('hamburgerBtn');

// Register form
const regEmail = document.getElementById("regEmail");
const regUsername = document.getElementById("regUsername");
const regPassword = document.getElementById("regPassword");
const regFullname = document.getElementById("regFullname");
const registerBtn = document.getElementById("registerBtn");

// Login form
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const refreshUsersBtn = document.getElementById("refreshUsersBtn");
const refreshFriendsBtn = document.getElementById("refreshFriendsBtn");
const checkRequestsBtn = document.getElementById("checkRequestsBtn");

const TOKEN_KEY = "access_token";
const RECENT_CHATS_KEY = "recent_chats_v1";
let socket;
let currentUserId = null;
let cachedFriends = [];
let callState = null;
let pendingIncomingCall = null;
let pendingIceCandidates = [];
let pendingOffer = null;
let pendingLocalStream = null;
let ringtoneInterval = null;
let ringtoneContext = null;
let ringtoneOsc = null;
let vibrationTimer = null;
const typingTimers = new Map();
const typingStates = new Map();

// Edit mode variables - MUTUALLY EXCLUSIVE with reply mode
// Edit mode is for modifying existing messages; takes priority when entering
let isEditMode = false;
let editMessageId = null;
let editFriendId = null;

// Reply mode variables - MUTUALLY EXCLUSIVE with edit mode
// Reply mode is for creating new messages in response to existing ones
let isReplyMode = false;
let replyMessageId = null;
let replyFriendId = null;
let replyMessageData = null;
const pendingReplyJumps = new Map();
const pendingPasteImages = new Map();
const CHAT_PAGE_SIZE = 50;

// Function to generate avatar colors based on username
function getAvatarColor(username) {
  const colors = [
    'linear-gradient(135deg, #667eea, #764ba2)', // Purple
    'linear-gradient(135deg, #f093fb, #f5576c)', // Pink
    'linear-gradient(135deg, #4facfe, #00f2fe)', // Blue
    'linear-gradient(135deg, #43e97b, #38f9d7)', // Green
    'linear-gradient(135deg, #fa709a, #fee140)', // Orange
    'linear-gradient(135deg, #a8edea, #fed6e3)', // Light blue
    'linear-gradient(135deg, #ff9a9e, #fecfef)', // Light pink
    'linear-gradient(135deg, #ffecd2, #fcb69f)'  // Peach
  ];

  // Simple hash function to get consistent color for same username
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}
// Hamburger
hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  hamburgerBtn.classList.toggle('active');

  // Change icon
  hamburgerBtn.textContent = hamburgerBtn.classList.contains('active') ? '✕' : '☰';
});

// Click outside sidebar to close it (mobile only)
document.addEventListener('click', (e) => {
  if (
    window.innerWidth <= 768 &&
    sidebar.classList.contains('open') &&
    !sidebar.contains(e.target) &&
    !hamburgerBtn.contains(e.target)
  ) {
    sidebar.classList.remove('open');

    // Reset hamburger
    hamburgerBtn.classList.remove('active');
    hamburgerBtn.textContent = '☰';
  }
});
// Robust emoji-only detection that handles VS16 (\uFE0F), ZWJ sequences (\u200D),
// the heavy black heart (\u2764) and common modifiers (skin tones).
function isEmojiOnlyText(text) {
  if (!text || String(text).trim().length === 0) return false;
  const t = String(text).trim();

  // Try a modern Unicode-aware regex first (supports Extended_Pictographic)
  try {
    // Matches one or more emoji clusters possibly separated by whitespace.
    const emojiClusterRe = /^[\s]*(?:[\p{Extended_Pictographic}\u2764]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\u2764]\uFE0F?)*)(?:[\s]+(?:[\p{Extended_Pictographic}\u2764]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\u2764]\uFE0F?)*))*[\s]*$/u;
    return emojiClusterRe.test(t);
  } catch (err) {
    // Fallback for environments without \p support: allow common emoji ranges,
    // variation selector (FE0F), ZWJ (200D) and the heart (2764).
    const fallback = /^[\s\u2764\uFE0F\u200D\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\u2600-\u26FF\u2700-\u27BF\u1F000-\u1FAFF]+$/u;
    return fallback.test(t);
  }
}

// Helper: Get actual message content element, skipping reply preview
// Message DOM structure: [message-reply (optional)] -> [actual content] -> [message-footer]
function getMessageContentElement(messageDiv) {
  // Look only at DIRECT children to avoid nested divs in reply preview
  const directChildren = Array.from(messageDiv.children);
  
  // Try emoji-message first (always the actual content if present)
  let contentEl = directChildren.find(el => el.classList?.contains('emoji-message'));
  if (contentEl) return contentEl;
  
  // For non-emoji text, find the direct child div that's NOT a reply preview or footer
  contentEl = directChildren.find(el => 
    el.tagName === 'DIV' &&
    !el.classList.contains('message-reply') && 
    !el.classList.contains('message-footer')
  );
  
  return contentEl;
}

function findMessageElement(friendId, messageId) {
  return document.querySelector(
    `#chat-messages-${friendId} .chat-message[data-message-id="${messageId}"]`
  );
}

async function scrollToRepliedMessage(friendId, messageId) {
  const messagesEl = document.getElementById(`chat-messages-${friendId}`);
  if (!messagesEl || !messageId) return;

  if (pendingReplyJumps.get(friendId)) return;
  pendingReplyJumps.set(friendId, true);

  try {
    let target = findMessageElement(friendId, messageId);
    let attempts = 0;

    while (!target && attempts < 20) {
      const loadedCount = await loadMoreMessages(friendId, { autoJump: true });
      if (!loadedCount || loadedCount < CHAT_PAGE_SIZE) break;
      target = findMessageElement(friendId, messageId);
      attempts += 1;
    }

    if (!target) {
      console.warn('Reply target not found:', messageId);
      return;
    }

    target.classList.add('message-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
      target.classList.remove('message-highlight');
    }, 1600);
  } finally {
    pendingReplyJumps.delete(friendId);
  }
}

function wireReplyJump(messageDiv, friendId, message) {
  if (!message || !message.reply_to_message_id) return;
  const replyEl = messageDiv.querySelector('.message-reply');
  if (!replyEl) return;

  replyEl.dataset.replyToId = String(message.reply_to_message_id);
  replyEl.title = 'Jump to replied message';
  replyEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollToRepliedMessage(friendId, message.reply_to_message_id);
  });
}

async function fetchActiveUsers() {
  const token = await getToken(true);
  if (!token) return;

  try {
    // First get current user info
    const currentUserResp = await fetch("/auth/me", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!currentUserResp.ok) {
      throw new Error(`Failed to fetch current user: ${currentUserResp.status}`);
    }

    const currentUser = await currentUserResp.json();
    currentUserId = currentUser.id;
    if (currentUserNameEl) {
      const displayName = currentUser.full_name || currentUser.username || currentUser.email || "User";
      currentUserNameEl.textContent = displayName;
      currentUserNameEl.title = currentUser.email || displayName;
    }

    // Get all active users
    const usersResp = await fetch("/auth/users/active", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!usersResp.ok) {
      throw new Error(`Failed to fetch users: ${usersResp.status}`);
    }

    const users = await usersResp.json();

    // Get sent requests to determine button states
    const sentRequestsResp = await fetch("/friends/requests/sent", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    let sentRequests = [];
    if (sentRequestsResp.ok) {
      sentRequests = await sentRequestsResp.json();
    }

    // Get friends to determine button states
    const friendsResp = await fetch("/friends/friends", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    let friends = [];
    if (friendsResp.ok) {
      friends = await friendsResp.json();
    }

    // Filter out the current user
    const otherUsers = users.filter(user => user.id !== currentUser.id);
    displayUsers(otherUsers, sentRequests, friends);
  } catch (err) {
    console.error("Error fetching users:", err);
    usersList.innerHTML = '<div class="user-item">Failed to load users</div>';
  }
}

async function fetchFriends() {
  const token = await getToken(true);
  if (!token) return;

  try {
    const resp = await fetch("/friends/friends", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch friends: ${resp.status}`);
    }

    const friends = await resp.json();
    cachedFriends = friends;
    displayFriends(friends);
  } catch (err) {
    console.error("Error fetching friends:", err);
    friendsList.innerHTML = '<div class="user-item">Failed to load friends</div>';
  }
}

async function fetchFriendRequests() {
  const token = await getToken(true);
  if (!token) return;

  try {
    const resp = await fetch("/friends/requests/received", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch friend requests: ${resp.status}`);
    }

    const requests = await resp.json();
    displayFriendRequests(requests);
  } catch (err) {
    console.error("Error fetching friend requests:", err);
    friendRequestsList.innerHTML = '<div class="user-item">Failed to load requests</div>';
  }
}

async function runActionWithButton(buttonEl, busyLabel, action) {
  if (!buttonEl) {
    await action();
    return;
  }
  const originalText = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = busyLabel;
  try {
    await action();
  } finally {
    buttonEl.textContent = originalText;
    buttonEl.disabled = false;
  }
}

async function refreshUsersAction() {
  await runActionWithButton(refreshUsersBtn, "Refreshing...", fetchActiveUsers);
}

async function refreshFriendsAction() {
  await runActionWithButton(refreshFriendsBtn, "Refreshing...", fetchFriends);
}

async function checkRequestsAction() {
  await runActionWithButton(checkRequestsBtn, "Checking...", fetchFriendRequests);
}

function displayFriends(friends) {
  if (!friends || friends.length === 0) {
    friendsList.innerHTML = '<div class="user-item">No friends yet</div>';
    return;
  }

  const recentMap = loadRecentChats();
  const normalized = friends.map(friend => {
    const friendUser = friend.sender;
    return {
      id: friendUser?.id,
      username: friendUser?.username,
      email: friendUser?.email,
      lastTs: friendUser ? (recentMap[String(friendUser.id)] || 0) : 0
    };
  }).filter(f => f.id);

  const sorted = normalized.sort((a, b) => b.lastTs - a.lastTs);

  const renderItem = (friendUser) => `
    <div class="user-item">
      <div class="user-info">
        <div class="user-name">${friendUser.username}</div>
        <div class="user-email">${friendUser.email}</div>
      </div>
      <div class="user-actions">
        <button class="request-btn chat-primary" onclick="startChat(${friendUser.id})">Chat</button>
        <button class="request-btn cancel" onclick="removeFriend(${friendUser.id})">Remove</button>
      </div>
    </div>
  `;

  const listHtml = sorted.map(renderItem).join('');
  friendsList.innerHTML = `
    <div class="friends-list-scroll">
      ${listHtml}
    </div>
  `;
}

function displayFriendRequests(requests) {
  if (!requests || requests.length === 0) {
    friendRequestsList.innerHTML = '<div class="user-item">No pending requests</div>';
    return;
  }

  friendRequestsList.innerHTML = requests.map(request => {
    const senderUser = request.sender;
    if (!senderUser) return '';

    return `
      <div class="user-item">
        <div class="user-info">
          <div class="user-name">${senderUser.username}</div>
          <div class="user-email">${senderUser.email}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="request-btn decline" onclick="declineFriendRequest(${request.id})">Decline</button>
          <button class="request-btn accept" onclick="acceptFriendRequest(${request.id})">Accept</button>
        </div>
      </div>
    `;
  }).join('');
}

function getFriendInfo(friendId) {
  const friend = cachedFriends.find(f => f.sender.id === friendId);
  return friend ? friend.sender : null;
}

function loadRecentChats() {
  try {
    const raw = localStorage.getItem(RECENT_CHATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function saveRecentChats(map) {
  try {
    localStorage.setItem(RECENT_CHATS_KEY, JSON.stringify(map));
  } catch (err) {
    // ignore storage errors
  }
}

function markRecentChat(friendId) {
  const map = loadRecentChats();
  map[String(friendId)] = Date.now();
  saveRecentChats(map);
}

function displayUsers(users, sentRequests = [], friends = []) {
  if (!users || users.length === 0) {
    usersList.innerHTML = '<div class="user-item">No other active users</div>';
    return;
  }

  // Create maps for quick lookup
  const sentRequestMap = new Map(sentRequests.map(req => [req.receiver_id, req]));
  const friendMap = new Map(friends.map(friend => [friend.sender.id, true]));

  usersList.innerHTML = users.map(user => {
    let buttonHtml = '';
    let buttonClass = 'request-btn send';
    let buttonText = 'Request';
    let buttonAction = `sendFriendRequest(${user.id})`;

    // Check if already friends
    if (friendMap.has(user.id)) {
      buttonClass = 'request-btn';
      buttonText = 'Friends';
      buttonAction = `startChat(${user.id})`;
      buttonHtml = `<button class="${buttonClass} chat-primary" onclick="${buttonAction}">${buttonText}</button>`;
    }
    // Check if request already sent
    else if (sentRequestMap.has(user.id)) {
      const request = sentRequestMap.get(user.id);
      if (request.status === 'pending') {
        buttonClass = 'request-btn pending';
        buttonText = 'Pending';
        buttonAction = `cancelFriendRequest(${request.id})`;
        buttonHtml = `<button class="${buttonClass}" onclick="${buttonAction}">${buttonText}</button>`;
      } else {
        // Request was declined or other status, allow sending again
        buttonHtml = `<button class="${buttonClass}" onclick="${buttonAction}">${buttonText}</button>`;
      }
    } else {
      buttonHtml = `<button class="${buttonClass}" onclick="${buttonAction}">${buttonText}</button>`;
    }

    return `
      <div class="user-item">
        <div class="user-info">
          <div class="user-name">${user.username}</div>
          <div class="user-email">${user.email}</div>
        </div>
        ${buttonHtml}
      </div>
    `;
  }).join('');
}

async function sendFriendRequest(receiverId) {
  const token = await getToken(true);
  if (!token) return;

  if (!currentUserId) {
    alert("Please wait for the user list to load before sending requests.");
    return;
  }

  // Don't allow sending request to yourself
  if (receiverId === currentUserId) {
    alert("You cannot send a friend request to yourself!");
    return;
  }

  try {
    const resp = await fetch("/friends/requests", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ receiver_id: receiverId })
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.detail || "Failed to send request");
    }

    alert("Friend request sent!");
    // Refresh all lists
    fetchActiveUsers();
    fetchFriendRequests();
    fetchFriends();
  } catch (err) {
    alert("Error sending friend request: " + err.message);
  }
}

async function acceptFriendRequest(requestId) {
  const token = await getToken(true);
  if (!token) return;

  try {
    const resp = await fetch(`/friends/requests/${requestId}/accept`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.detail || "Failed to accept request");
    }

    alert("Friend request accepted!");
    // Refresh all lists
    fetchActiveUsers();
    fetchFriendRequests();
    fetchFriends();
  } catch (err) {
    alert("Error accepting friend request: " + err.message);
  }
}

async function declineFriendRequest(requestId) {
  const token = await getToken(true);
  if (!token) return;

  try {
    const resp = await fetch(`/friends/requests/${requestId}/decline`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.detail || "Failed to decline request");
    }

    alert("Friend request declined!");
    // Refresh all lists
    fetchActiveUsers();
    fetchFriendRequests();
    fetchFriends();
  } catch (err) {
    alert("Error declining friend request: " + err.message);
  }
}

async function cancelFriendRequest(requestId) {
  const token = await getToken(true);
  if (!token) return;

  try {
    const resp = await fetch(`/friends/requests/${requestId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.detail || "Failed to cancel request");
    }

    alert("Friend request cancelled!");
    // Refresh all lists
    fetchActiveUsers();
    fetchFriendRequests();
    fetchFriends();
  } catch (err) {
    alert("Error cancelling friend request: " + err.message);
  }
}

async function removeFriend(friendId) {
  const token = await getToken(true);
  if (!token) return;

  if (!confirm("Are you sure you want to remove this friend?")) {
    return;
  }

  try {
    const resp = await fetch(`/friends/friends/${friendId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.detail || "Failed to remove friend");
    }

    alert("Friend removed successfully!");
    // Refresh all lists
    fetchActiveUsers();
    fetchFriendRequests();
    fetchFriends();
  } catch (err) {
    alert("Error removing friend: " + err.message);
  }
}

function startChat(friendId) {
  markRecentChat(friendId);
  openChatWindow(friendId);
  fetchFriends();
}

function generateCallId() {
  return `call-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function getIncomingModal() {
  return document.getElementById('incoming-call');
}

function showIncomingCall(fromUserId, callId, metadata = {}) {
  if (callState) {
    // Already in a call; auto-decline new incoming call
    callApi('/calls/decline', { to_user_id: fromUserId, call_id: callId }).catch(() => {});
    sendSignal(fromUserId, 'busy', { reason: 'busy' }, callId);
    return;
  }
  const modal = getIncomingModal();
  const title = document.getElementById('incoming-title');
  const subtitle = document.getElementById('incoming-subtitle');
  const friend = getFriendInfo(fromUserId);
  const kindLabel = metadata?.kind === 'audio' ? 'Audio call' : 'Incoming call';
  title.textContent = friend ? `${kindLabel} from ${friend.username}` : kindLabel;
  subtitle.textContent = friend ? friend.email : `User ${fromUserId}`;
  modal.style.display = 'flex';
  startRingtone();

  pendingIncomingCall = { fromUserId, callId, metadata };
}

function hideIncomingCall() {
  const modal = getIncomingModal();
  modal.style.display = 'none';
  stopRingtone();
  pendingIncomingCall = null;
  if (pendingLocalStream) {
    pendingLocalStream.getTracks().forEach(t => t.stop());
    pendingLocalStream = null;
  }
}

function showCallOverlay() {
  document.getElementById('video-call-overlay').style.display = 'flex';
}

function hideCallOverlay() {
  document.getElementById('video-call-overlay').style.display = 'none';
}

function startRingtone() {
  if (ringtoneInterval) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ringtoneContext = new AudioCtx();
    const playBeep = () => {
      if (!ringtoneContext) return;
      ringtoneOsc = ringtoneContext.createOscillator();
      const gain = ringtoneContext.createGain();
      ringtoneOsc.type = 'sine';
      ringtoneOsc.frequency.value = 620;
      gain.gain.value = 0.08;
      ringtoneOsc.connect(gain).connect(ringtoneContext.destination);
      ringtoneOsc.start();
      ringtoneOsc.stop(ringtoneContext.currentTime + 0.25);
    };
    playBeep();
    ringtoneInterval = setInterval(playBeep, 900);
  } catch (err) {
    console.warn('Ringtone blocked:', err);
  }

  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
    vibrationTimer = setInterval(() => navigator.vibrate([200, 100, 200]), 2000);
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (vibrationTimer) {
    clearInterval(vibrationTimer);
    vibrationTimer = null;
  }
  if (ringtoneOsc) {
    try { ringtoneOsc.stop(); } catch {}
    ringtoneOsc = null;
  }
  if (ringtoneContext) {
    try { ringtoneContext.close(); } catch {}
    ringtoneContext = null;
  }
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

function setCallUIStatus(title, status) {
  const titleEl = document.getElementById('vc-title');
  const statusEl = document.getElementById('vc-status');
  if (titleEl) titleEl.textContent = title || 'Video Call';
  if (statusEl) statusEl.textContent = status || '';
}

async function preflightMediaPermissions(attachToCallState = false, options = {}) {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Media devices not available. Use HTTPS and a supported browser.');
    }
    let stream;
    try {
      if (options.audioOnly) {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setCallUIStatus('Audio call', 'Audio only');
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
    } catch (err) {
      const name = err?.name || '';
      // If camera fails or is busy, fall back to audio-only
      if (!options.audioOnly && (name === 'AbortError' || name === 'NotReadableError' || name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setCallUIStatus('Audio call', 'Video unavailable');
      } else {
        throw err;
      }
    }
    if (attachToCallState && callState) {
      callState.localStream = stream;
      const localVideo = document.getElementById('local-video');
      if (localVideo) localVideo.srcObject = stream;
    } else {
      pendingLocalStream = stream;
    }
    // Update camera button state if no video track
    const camBtn = document.getElementById('vc-cam');
    const camIcon = document.getElementById('vc-cam-icon');
    const camLabel = document.getElementById('vc-cam-label');
    if (camBtn) {
      const hasVideo = stream.getVideoTracks().length > 0;
      camBtn.classList.toggle('active', hasVideo);
      if (camIcon) {
        camIcon.src = hasVideo ? '/Images/video-camera.png' : '/Images/no-video.png';
        camIcon.alt = hasVideo ? 'Camera on' : 'Camera off';
      }
      if (camLabel) camLabel.textContent = hasVideo ? 'Camera on' : 'Camera off';
    }
    return stream;
  } catch (err) {
    const name = err?.name || 'Error';
    const message = err?.message || 'Unknown error';
    setCallUIStatus('Call failed', `${name}: ${message}`);
    throw err;
  }
}

async function callApi(path, body) {
  const token = await getToken(true);
  if (!token) throw new Error('Missing token');
  const resp = await fetch(path, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `Call API failed: ${resp.status}`);
  }
  return resp.json().catch(() => ({}));
}

async function sendSignal(toUserId, type, payload = {}, callId = null) {
  const ws = socket;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type,
      to_user_id: toUserId,
      data: { ...payload, call_id: callId }
    }));
    return;
  }

  try {
    await callApi('/calls/signal', {
      to_user_id: toUserId,
      type,
      call_id: callId,
      payload: payload
    });
  } catch (err) {
    console.error('Signal failed:', type, err);
  }
}

async function startVideoCall(friendId) {
  if (callState) {
    alert('A call is already active.');
    return;
  }

  await ensureSocket();

  const callId = generateCallId();
  callState = {
    friendId,
    callId,
    isCaller: true,
    pc: null,
    localStream: null,
    remoteStream: null
  };

  const friend = getFriendInfo(friendId);
  showCallOverlay();
  setCallUIStatus(friend ? `Calling ${friend.username}` : 'Calling...', 'Ringing...');

  try {
    await preflightMediaPermissions(true);
    await callApi('/calls/start', { to_user_id: friendId, call_id: callId, metadata: { kind: 'video' } });
  } catch (err) {
    console.error(err);
    endCallCleanup();
    alert('Failed to start call.');
  }
}

async function startAudioCall(friendId) {
  if (callState) {
    alert('A call is already active.');
    return;
  }

  await ensureSocket();

  const callId = generateCallId();
  callState = {
    friendId,
    callId,
    isCaller: true,
    pc: null,
    localStream: null,
    remoteStream: null
  };

  const friend = getFriendInfo(friendId);
  showCallOverlay();
  setCallUIStatus(friend ? `Calling ${friend.username}` : 'Calling...', 'Audio call');

  try {
    await preflightMediaPermissions(true, { audioOnly: true });
    await callApi('/calls/start', { to_user_id: friendId, call_id: callId, metadata: { kind: 'audio' } });
  } catch (err) {
    console.error(err);
    endCallCleanup();
    alert('Failed to start audio call.');
  }
}

async function acceptIncomingCall() {
  if (!pendingIncomingCall) return;
  const { fromUserId, callId, metadata } = pendingIncomingCall;
  hideIncomingCall();

  if (callState) {
    alert('A call is already active.');
    return;
  }

  callState = {
    friendId: fromUserId,
    callId,
    isCaller: false,
    pc: null,
    localStream: null,
    remoteStream: null
  };

  const friend = getFriendInfo(fromUserId);
  showCallOverlay();
  setCallUIStatus(friend ? `In call with ${friend.username}` : 'In call', 'Connecting...');

  try {
    await ensureSocket();
    const audioOnly = metadata?.kind === 'audio';
    await preflightMediaPermissions(true, { audioOnly });
    await callApi('/calls/accept', { to_user_id: fromUserId, call_id: callId });
    await setupPeerConnection();
    if (pendingOffer) {
      await handleOffer(pendingOffer);
      pendingOffer = null;
    }
  } catch (err) {
    console.error('Call accept failed:', err);
    const name = err?.name || 'Error';
    const message = err?.message || 'Unable to start call';
    alert(`Unable to start call: ${name} - ${message}`);
    endCallCleanup();
  }
}

async function declineIncomingCall() {
  if (!pendingIncomingCall) return;
  const { fromUserId, callId } = pendingIncomingCall;
  hideIncomingCall();
  try {
    await callApi('/calls/decline', { to_user_id: fromUserId, call_id: callId });
  } catch (err) {
    console.error(err);
  }
}

async function setupPeerConnection() {
  if (!callState) return;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  callState.pc = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate && callState) {
      sendSignal(callState.friendId, 'ice', { candidate: event.candidate }, callState.callId);
    }
  };

  pc.ontrack = (event) => {
    const remoteVideo = document.getElementById('remote-video');
    if (!callState.remoteStream) {
      callState.remoteStream = new MediaStream();
      remoteVideo.srcObject = callState.remoteStream;
    }
    callState.remoteStream.addTrack(event.track);
    setCallUIStatus(
      getFriendInfo(callState.friendId)?.username ? `In call with ${getFriendInfo(callState.friendId).username}` : 'In call',
      'Connected'
    );
  };

  let localStream = callState.localStream;
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      // Fallback to audio-only if camera fails
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setCallUIStatus('Audio call', 'Video unavailable');
      } catch (innerErr) {
        setCallUIStatus('Call failed', 'Camera or mic permission blocked');
        throw innerErr;
      }
    }
    callState.localStream = localStream;
  }
  const localVideo = document.getElementById('local-video');
  localVideo.srcObject = localStream;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Apply any ICE candidates that arrived before the pc was ready
  if (pendingIceCandidates.length) {
    for (const cand of pendingIceCandidates) {
      try {
        await pc.addIceCandidate(cand);
      } catch (err) {
        console.error('Failed to add ICE candidate', err);
      }
    }
    pendingIceCandidates = [];
  }
}

async function startCallerOffer() {
  if (!callState || !callState.isCaller) return;
  await setupPeerConnection();
  const offer = await callState.pc.createOffer();
  await callState.pc.setLocalDescription(offer);
  await sendSignal(callState.friendId, 'offer', { sdp: offer }, callState.callId);
}

async function handleOffer(data) {
  if (!callState) return;
  if (data.call_id && data.call_id !== callState.callId) return;
  if (!callState.pc) {
    await setupPeerConnection();
  }
  await callState.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  const answer = await callState.pc.createAnswer();
  await callState.pc.setLocalDescription(answer);
  await sendSignal(callState.friendId, 'answer', { sdp: answer }, callState.callId);
}

async function handleAnswer(data) {
  if (!callState || !callState.pc) return;
  if (data.call_id && data.call_id !== callState.callId) return;
  await callState.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
}

async function handleIce(data) {
  if (callState && data.call_id && data.call_id !== callState.callId) return;
  const candidate = new RTCIceCandidate(data.candidate);
  if (callState && callState.pc) {
    try {
      await callState.pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('Failed to add ICE candidate', err);
    }
  } else {
    pendingIceCandidates.push(candidate);
  }
}

async function enableCamera() {
  if (!callState || !callState.pc) return;

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const track = videoStream.getVideoTracks()[0];
    if (!track) return;

    if (!callState.localStream) {
      callState.localStream = new MediaStream();
    }
    callState.localStream.addTrack(track);

    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = callState.localStream;

    callState.pc.addTrack(track, callState.localStream);

    const offer = await callState.pc.createOffer();
    await callState.pc.setLocalDescription(offer);
    await sendSignal(callState.friendId, 'offer', { sdp: offer }, callState.callId);

    const camBtn = document.getElementById('vc-cam');
    const camIcon = document.getElementById('vc-cam-icon');
    const camLabel = document.getElementById('vc-cam-label');
    if (camBtn) camBtn.classList.add('active');
    if (camIcon) {
      camIcon.src = '/Images/video-camera.png';
      camIcon.alt = 'Camera on';
    }
    if (camLabel) camLabel.textContent = 'Camera on';
    setCallUIStatus('In call', 'Video enabled');
  } catch (err) {
    console.error('Enable camera failed:', err);
    setCallUIStatus('Audio call', 'Video still unavailable');
  }
}

async function endCall() {
  if (!callState) return;
  try {
    await callApi('/calls/end', { to_user_id: callState.friendId, call_id: callState.callId });
  } catch (err) {
    console.error(err);
  } finally {
    endCallCleanup();
  }
}

function endCallCleanup() {
  stopRingtone();
  if (callState && callState.pc) {
    callState.pc.ontrack = null;
    callState.pc.onicecandidate = null;
    callState.pc.close();
  }
  if (callState && callState.localStream) {
    callState.localStream.getTracks().forEach(t => t.stop());
  }
  if (pendingLocalStream) {
    pendingLocalStream.getTracks().forEach(t => t.stop());
    pendingLocalStream = null;
  }
  const localVideo = document.getElementById('local-video');
  const remoteVideo = document.getElementById('remote-video');
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  callState = null;
  pendingIceCandidates = [];
  pendingOffer = null;
  setCallUIStatus('Video Call', '');
  hideCallOverlay();
}

function handleFriendRequestReceived(data) {
  console.log("Friend request received:", data);
  // Refresh friend requests and user lists
  fetchActiveUsers();
  fetchFriendRequests();
}

function handleFriendRequestAccepted(data) {
  console.log("Friend request accepted:", data);
  // Refresh all lists as friendship status has changed
  fetchActiveUsers();
  fetchFriendRequests();
  fetchFriends();
}

function handleFriendRequestDeclined(data) {
  console.log("Friend request declined:", data);
  // Refresh friend requests and user lists
  fetchActiveUsers();
  fetchFriendRequests();
}

function handleFriendRequestCancelled(data) {
  console.log("Friend request cancelled:", data);
  // Refresh friend requests and user lists
  fetchActiveUsers();
  fetchFriendRequests();
}

function handleFriendRemoved(data) {
  console.log("Friend removed:", data);

  // Close any open chat window with the removed friend
  const chatWindow = document.getElementById(`chat-window-${data.removed_friend_id}`);
  if (chatWindow) {
    chatWindow.style.display = 'none';
    activeChats.delete(data.removed_friend_id);
  }

  // Refresh all lists as friendship status has changed
  fetchActiveUsers();
  fetchFriendRequests();
  fetchFriends();
}

function handleChatMessage(data) {
  console.log("Chat message received:", data);

  // Extract the actual message data from the WebSocket message
  const messageData = data.data || data;
  if (messageData.sender_id) {
    markRecentChat(messageData.sender_id);
    fetchFriends();
  }

  // If we have an active chat with this user, add the message
  const chatWindow = document.getElementById(`chat-window-${messageData.sender_id}`);
  if (chatWindow && chatWindow.style.display !== 'none') {
    addMessageToChat(messageData.sender_id, messageData);
    // Mark messages as read since user is actively viewing the chat
    markMessagesAsRead(messageData.sender_id);
  } else {
    // Show notification for new message
    const notificationText = messageData.message_type === 'image' ? '📷 sent an image' :
                             messageData.message_type === 'file' ? `📎 sent ${messageData.file_name || 'a file'}` :
                             messageData.content;
    showChatNotification(messageData.sender_username, notificationText, messageData.sender_id);
  }
}

function handleMessagesRead(data) {
  console.log("Messages read:", data);

  // Update read receipts for messages sent to this reader
  data.message_ids.forEach(messageId => {
    const readReceipt = document.getElementById(`read-receipt-${messageId}`);
    if (readReceipt) {
      readReceipt.classList.add('read');
      readReceipt.textContent = '✓✓';
      readReceipt.title = `Read by ${data.reader_username}`;
    }
  });
}

// Chat functionality
let activeChats = new Set();
let currentNotificationData = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function openChatWindow(friendId) {
  closeOtherChatWindows(friendId);
  let chatWindow = document.getElementById(`chat-window-${friendId}`);

  if (!chatWindow) {
    chatWindow = createChatWindow(friendId);
    document.getElementById('chat-windows').appendChild(chatWindow);
  }

  chatWindow.style.display = 'flex';
  setTimeout(() => {
    chatWindow.classList.add('show');
    setTimeout(() => {
      if (chatWindow.style.display !== 'none' && activeChats.has(friendId)) {
        markMessagesAsRead(friendId);
      }
    }, 300);
  }, 10);

  activeChats.add(friendId);
  loadChatHistory(friendId);
  hideChatNotification();

  // 🔥 Add body class to hide hamburger
  document.body.classList.add('chat-open');
}

function closeOtherChatWindows(currentFriendId) {
  const chatWindows = document.querySelectorAll('.chat-window');
  chatWindows.forEach((windowEl) => {
    const idPart = windowEl.id?.replace('chat-window-', '');
    const friendId = idPart ? parseInt(idPart, 10) : null;
    if (friendId && friendId !== currentFriendId) {
      windowEl.classList.remove('show');
      windowEl.style.display = 'none';
      activeChats.delete(friendId);
    }
  });
}

function createChatWindow(friendId) {
  const chatWindow = document.createElement('div');
  chatWindow.id = `chat-window-${friendId}`;
  chatWindow.className = 'chat-window';

  // Get friend info for immediate display
  const friendUser = getFriendInfo(friendId);
  const username = friendUser ? friendUser.username : `User ${friendId}`;
  const userInfo = friendUser ? `${friendUser.username} (${friendUser.email})` : `User ${friendId}`;

  chatWindow.innerHTML = `
    <div class="chat-header">
      <div class="chat-title" id="chat-title-${friendId}">Chat with ${username}</div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="chat-upload-btn" title="Start audio call" onclick="startAudioCall(${friendId})" style="width: 36px; height: 36px; border-radius: 10px;">
          <svg class="audio-call-icon" width="20" height="20" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
            <path d="M391 321c-27-9-55 0-73 18l-22 22c-69-37-116-84-153-153l22-22c18-18 27-46 18-73L159 32c-7-20-26-32-47-32H64C29 0 0 29 0 64c0 247 201 448 448 448 35 0 64-29 64-64v-48c0-21-12-40-32-47l-89-32z"/>
          </svg>
        </button>
        <button class="chat-upload-btn" title="Start video call" onclick="startVideoCall(${friendId})" style="width: 36px; height: 36px; border-radius: 10px;">
          <svg viewBox="0 0 24 24">
            <path d="M17 10.5V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3.5l4 4v-11l-4 4z"/>
          </svg>
        </button>
        <button class="chat-close" onclick="closeChatWindow(${friendId})" title="Close chat"></button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages-${friendId}">
      <div class="load-more-wrap" id="load-more-wrap-${friendId}" style="text-align:center; margin: 6px 0;">
        <button class="action-btn" style="padding: 6px 12px;" onclick="loadMoreMessages(${friendId})">Load older messages</button>
      </div>
    </div>
    <div id="reply-indicator-${friendId}" class="reply-indicator" style="display: none;"></div>
    <div class="chat-input-area" style="position: relative;">
      <div class="typing-indicator" id="typing-indicator-${friendId}">
        <span class="typing-text">${username} is typing</span>
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </div>
      <div class="chat-input-row">
        <div class="chat-input-wrap">
          <div class="chat-input-icons">
        <label class="chat-upload-btn" title="Upload file (images, audio, documents, etc.)" for="file-upload-${friendId}">
          <input type="file" id="file-upload-${friendId}" onchange="handleFileUpload(event, ${friendId})" style="display: none;">
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        </label>
        <button class="chat-upload-btn emoji-btn" id="emoji-btn-${friendId}" title="Insert emoji" type="button">
          <span style="font-size: 20px;">😊</span>
        </button>
          </div>
          <input type="text" class="chat-input" id="chat-input-${friendId}" placeholder="Type your message..." onkeypress="handleChatKeyPress(event, ${friendId})">
        </div>
        <button class="chat-send" onclick="sendChatMessage(${friendId})" title="Send message">Send</button>
      </div>
      <simple-emoji-picker id="emoji-picker-${friendId}" class="emoji-picker" style="display: none;"></simple-emoji-picker>
    </div>
    <div class="upload-progress" id="upload-progress-${friendId}"></div>
  `;

  // Add drag functionality to header (desktop only)
  const header = chatWindow.querySelector('.chat-header');
  header.style.cursor = 'move';

  const inputEl = chatWindow.querySelector(`#chat-input-${friendId}`);
  if (inputEl) {
    inputEl.addEventListener('input', () => handleTypingInput(friendId, inputEl));
    inputEl.addEventListener('blur', () => stopTyping(friendId));
  }

  header.addEventListener('mousedown', (e) => {
    if (window.innerWidth <= 768) return; // Disable dragging on mobile

    isDragging = true;
    const rect = chatWindow.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    chatWindow.style.transition = 'none';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const chatWindow = document.getElementById(`chat-window-${friendId}`);
    if (!chatWindow) return;

    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;

    // Keep window within viewport bounds
    const maxX = window.innerWidth - chatWindow.offsetWidth - 20;
    const maxY = window.innerHeight - chatWindow.offsetHeight - 20;

    chatWindow.style.left = Math.max(20, Math.min(newX, maxX)) + 'px';
    chatWindow.style.top = Math.max(20, Math.min(newY, maxY)) + 'px';
    chatWindow.style.right = 'auto';
    chatWindow.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      const chatWindow = document.getElementById(`chat-window-${friendId}`);
      if (chatWindow) {
        chatWindow.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      }
      document.body.style.userSelect = '';
      isDragging = false;
    }
  });

  // Add drag and drop functionality for files
  setupDragAndDropForChat(friendId, chatWindow);

  // Emoji picker wiring
  const emojiBtn = chatWindow.querySelector(`#emoji-btn-${friendId}`);
  const emojiPicker = chatWindow.querySelector(`#emoji-picker-${friendId}`);
  const chatInput = chatWindow.querySelector(`#chat-input-${friendId}`);

  if (emojiBtn && emojiPicker && chatInput) {
    console.log('Setting up emoji picker for friend:', friendId);

    // Toggle emoji picker on button click
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const isVisible = emojiPicker.style.display === 'block';
      emojiPicker.style.display = isVisible ? 'none' : 'block';

      console.log('Emoji picker toggled:', emojiPicker.style.display);
    });

    // Handle emoji selection
    emojiPicker.addEventListener('emoji-click', (event) => {
      console.log('Emoji clicked:', event.detail);
      const emoji = event.detail.unicode;
      chatInput.value += emoji;
      chatInput.focus();
      // Keep picker open for multiple selections
      console.log('Emoji added to input, picker stays open');
    });

    // Close picker when clicking outside the input area
    const closePicker = (event) => {
      // Check if click is inside emoji button
      if (emojiBtn.contains(event.target)) {
        return;
      }

      // Check if click is inside emoji picker (including shadow DOM)
      let target = event.target;
      while (target && target !== emojiPicker) {
        if (target === emojiPicker) {
          return; // Click is inside emoji picker
        }
        target = target.parentElement || target.parentNode?.host;
      }

      // If we get here, click is outside both button and picker
      emojiPicker.style.display = 'none';
    };

    // Add event listener to document but only for this chat window
    document.addEventListener('click', closePicker);

    // Store the close function for cleanup if needed
    chatWindow._closeEmojiPicker = closePicker;
    
    chatInput.addEventListener('paste', (event) => {
      const items = event.clipboardData?.items;
      if (!items || !items.length) return;

      let imageFile = null;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }

      if (!imageFile) return;

      event.preventDefault();

      if (imageFile.size > 10 * 1024 * 1024) {
        alert('Image is too large. Maximum size is 10MB.');
        return;
      }

      pendingPasteImages.set(friendId, imageFile);

      const progressEl = document.getElementById(`upload-progress-${friendId}`);
      if (progressEl) {
        progressEl.textContent = `Image ready to send: ${imageFile.name || 'pasted image'}`;
        progressEl.classList.add('active');
      }
    });
  } else {
    console.error('Emoji picker setup failed - elements not found:', { emojiBtn, emojiPicker, chatInput });
  }

  return chatWindow;
}

function closeChatWindow(friendId) {
  const chatWindow = document.getElementById(`chat-window-${friendId}`);
  if (chatWindow) {
    stopTyping(friendId);
    chatWindow.classList.remove('show');

    setTimeout(() => {
      chatWindow.style.display = 'none';
      activeChats.delete(friendId);

      // 🔥 Remove chat-open if no chats are open
      if (activeChats.size === 0) {
        document.body.classList.remove('chat-open');
      }
    }, 300);
  }
}


async function loadChatHistory(friendId) {
  const token = await getToken(true);
  if (!token) return;

  // Set username immediately from cached friends data
  const titleEl = document.getElementById(`chat-title-${friendId}`);

  const friendUser = getFriendInfo(friendId);
  if (friendUser) {
    if (titleEl) {
      titleEl.textContent = `Chat with ${friendUser.username}`;
    }
  } else {
    if (titleEl) {
      titleEl.textContent = `Chat with User ${friendId}`;
    }
  }

  try {
    const response = await fetch(`/messages/conversation/${friendId}?limit=${CHAT_PAGE_SIZE}&offset=0`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load chat history');
    }

    const messages = await response.json();

    // Update chat title and user info with more detailed info if available
    if (messages.length > 0 && titleEl) {
      // Find the friend user from the first message
      const friendUserFromMsg = messages[0].sender_id === currentUserId ? messages[0].receiver : messages[0].sender;
      if (friendUserFromMsg && friendUserFromMsg.username) {
        titleEl.textContent = `Chat with ${friendUserFromMsg.username}`;
      }
    }

    // Clear existing messages but keep load more button
    const messagesEl = document.getElementById(`chat-messages-${friendId}`);
    messagesEl.querySelectorAll('.chat-message').forEach(el => el.remove());

    // Add messages to chat
    messages.forEach(message => addMessageToChat(friendId, message));
    // Ensure reactions are hydrated on refresh
    const messageIds = messages.map(m => m.id).filter(Boolean);
    if (messageIds.length) {
      fetchReactionsBulk(messageIds);
    }
    messagesEl.dataset.offset = String(messages.length);
    toggleLoadMore(friendId, messages.length);

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;

  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

function toggleLoadMore(friendId, loadedCount) {
  const wrap = document.getElementById(`load-more-wrap-${friendId}`);
  if (!wrap) return;
  wrap.style.display = loadedCount < CHAT_PAGE_SIZE ? 'none' : 'block';
}

async function loadMoreMessages(friendId, options = {}) {
  const token = await getToken(true);
  if (!token) return;
  const messagesEl = document.getElementById(`chat-messages-${friendId}`);
  if (!messagesEl) return;
  const currentOffset = parseInt(messagesEl.dataset.offset || '0', 10);

  try {
    const response = await fetch(`/messages/conversation/${friendId}?limit=${CHAT_PAGE_SIZE}&offset=${currentOffset}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error('Failed to load more messages');
    }
    const messages = await response.json();
    if (!messages.length) {
      toggleLoadMore(friendId, 0);
      return;
    }

    const previousScrollHeight = messagesEl.scrollHeight;
    const firstMessage = messagesEl.querySelector('.chat-message');
    messages.forEach(message => {
      const messageDiv = renderMessageNode(friendId, message);
      if (firstMessage) {
        messagesEl.insertBefore(messageDiv, firstMessage);
      } else {
        messagesEl.appendChild(messageDiv);
      }
    });
    // Hydrate reactions for newly loaded messages
    const messageIds = messages.map(m => m.id).filter(Boolean);
    if (messageIds.length) {
      fetchReactionsBulk(messageIds);
    }

    messagesEl.dataset.offset = String(currentOffset + messages.length);
    toggleLoadMore(friendId, messages.length);
    messagesEl.scrollTop = messagesEl.scrollHeight - previousScrollHeight;
    return messages.length;
  } catch (err) {
    console.error('Error loading more messages:', err);
  }
}

function formatISTTime(dateString) {
  if (!dateString) return '';

  // Normalize server timestamp:
  // - If it has no explicit timezone (no 'Z' and no +hh:mm / -hh:mm),
  //   treat it as UTC by appending 'Z'
  let normalized = String(dateString);
  if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }

  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '';

  // Format in India Standard Time regardless of browser timezone
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  });
}

function addMessageToChat(friendId, message) {
  const messagesEl = document.getElementById(`chat-messages-${friendId}`);
  if (!messagesEl) return;

  const messageType = message.message_type || 'text';

  // Normalize sender_username for both API and WebSocket data
  if (!message.sender_username && message.sender) {
    message.sender_username = message.sender.username;
  }

  const messageDiv = renderMessageNode(friendId, message);

  // Always display time in IST (manually converted from UTC / server time)
  const timestamp = formatISTTime(message.created_at);

  // Add read receipt for sent messages
  let readReceiptHtml = '';
  if (message.sender_id === currentUserId) {
    const readStatus = message.is_read ? '✓✓' : '✓';
    const readClass = message.is_read ? 'read' : '';
    readReceiptHtml = `<span id="read-receipt-${message.id}" class="read-receipt ${readClass}" title="${message.is_read ? 'Message read' : 'Message sent'}">${readStatus}</span>`;
  }

  // Handle reply context
  let replyHtml = '';
  if (message.reply_to_message_id && message.reply_to_message) {
    // Handle both API response (sender.username) and WebSocket data (sender_username)
    const replySender = message.reply_to_message.sender_username ||
                       (message.reply_to_message.sender && message.reply_to_message.sender.username) ||
                       'Unknown';
    const replyContent = message.reply_to_message.content ?
      (message.reply_to_message.content.length > 50 ? message.reply_to_message.content.substring(0, 50) + '...' : message.reply_to_message.content) :
      'Message';
    const replyAvatarLetter = replySender.charAt(0).toUpperCase();
    const replyAvatarColor = getAvatarColor(replySender);

    replyHtml = `
      <div class="message-reply">
        <div class="reply-line"></div>
        <div class="reply-content">
          <div class="reply-sender">${replySender}</div>
          <div class="reply-text">${replyContent}</div>
        </div>
      </div>
    `;
  }

  // Handle different message types
  let contentHtml = '';
  if (messageType === 'image' && message.file_path) {
    // For images, we'll load them with authentication and use blob URLs
    const imageContainerId = `image-container-${message.id}`;
    contentHtml = `
      ${message.content && message.content !== `📷 ${message.file_name}` ? `<div class="message-content-text">${message.content}</div>` : ''}
      <div id="${imageContainerId}" class="image-loading-container">
        <div style="padding: 20px; text-align: center; color: #999;">Loading image...</div>
      </div>
    `;
    // Load image with authentication after adding to DOM
    setTimeout(() => loadImageWithAuth(message.id, imageContainerId, friendId), 100);
  } else if (messageType === 'file' && message.file_path) {
    // For files, create a download link with authentication
    const fileSize = formatFileSize(message.file_size || 0);
    const fileLinkId = `file-link-${message.id}`;
    contentHtml = `
      ${message.content && message.content !== `📎 ${message.file_name}` ? `<div class="message-content-text">${message.content}</div>` : ''}
      <div id="${fileLinkId}" class="file-link-container">
        <div class="message-file" style="cursor: pointer;" onclick="downloadFileWithAuth(${message.id}, '${message.file_name || 'file'}')">
          <div class="file-icon">
            <svg viewBox="0 0 24 24">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </div>
          <div class="file-info">
            <div class="file-name">${message.file_name || 'File'}</div>
            <div class="file-size">${fileSize}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    // Text message - detect if it's emoji-only for special styling
    const text = message.content || '';
    const isEmojiOnly = isEmojiOnlyText(text);

    if (isEmojiOnly) {
      contentHtml = `<div class="emoji-message">${text}</div>`;
    } else {
      contentHtml = `<div>${text}</div>`;
    }
  }

  messageDiv.innerHTML = `
    ${replyHtml}
    ${contentHtml}
    <div class="message-footer">
      <span class="message-time">${timestamp}</span>
      ${readReceiptHtml}
    </div>
  `;

  wireReplyJump(messageDiv, friendId, message);

  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Right-click and long-press context menu (all messages)
  messageDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, message.id, friendId, messageType, message.content || '', messageDiv, message.sender_id === currentUserId);
  });

  // Enhanced swipe detection for reply functionality (mobile-optimized)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isSwiping = false;
  let longPressTimer;
  let hasMoved = false;

  messageDiv.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return; // Only handle single touch

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    isSwiping = false;
    hasMoved = false;

    // Add touch feedback
    messageDiv.style.transition = 'none';

	  // Start long press timer for context menu (only on mobile)
	  if (window.innerWidth <= 768) {
	    longPressTimer = setTimeout(() => {
	      longPressTimer = null;
	      if (!isSwiping && !hasMoved) {
	        openReactionBar(messageDiv, message.id, friendId);
	      }
	    }, 600); // Slightly longer for better UX
	  }
	}, { passive: true });

  messageDiv.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1 || !touchStartX || !touchStartY) return;

    const touchCurrentX = e.touches[0].clientX;
    const touchCurrentY = e.touches[0].clientY;
    const diffX = touchCurrentX - touchStartX;
    const diffY = touchCurrentY - touchStartY;
    const absDiffX = Math.abs(diffX);
    const absDiffY = Math.abs(diffY);

    hasMoved = absDiffX > 5 || absDiffY > 5; // Consider it moved if > 5px

    // Check if this is a horizontal swipe (more horizontal than vertical movement)
    if (absDiffX > absDiffY && absDiffX > 30 && absDiffY < 50) {
      isSwiping = true;
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      // Prevent scrolling while swiping
      e.preventDefault();

      // Add swipe visual feedback with better mobile UX
      const maxSwipe = window.innerWidth <= 480 ? 80 : 100; // Smaller on mobile
      const swipeDistance = Math.min(absDiffX, maxSwipe);
      const opacity = Math.max(0.8, 1 - swipeDistance / (maxSwipe * 2));

      if (diffX > 0) {
        // Swipe right
        messageDiv.style.transform = `translateX(${swipeDistance}px) rotate(${swipeDistance * 0.1}deg)`;
        messageDiv.style.opacity = opacity;
        messageDiv.style.boxShadow = `${swipeDistance * 0.1}px 4px 20px rgba(102, 126, 234, 0.3)`;
      } else {
        // Swipe left
        messageDiv.style.transform = `translateX(-${swipeDistance}px) rotate(-${swipeDistance * 0.1}deg)`;
        messageDiv.style.opacity = opacity;
        messageDiv.style.boxShadow = `-${swipeDistance * 0.1}px 4px 20px rgba(102, 126, 234, 0.3)`;
      }
    }
  }, { passive: false });

  messageDiv.addEventListener('touchend', (e) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    // Reset styles
    messageDiv.style.transform = '';
    messageDiv.style.opacity = '';
    messageDiv.style.boxShadow = '';
    messageDiv.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

    if (isSwiping) {
      const touchEndX = e.changedTouches[0].clientX;
      const diffX = touchEndX - touchStartX;
      const touchDuration = Date.now() - touchStartTime;
      const absDiffX = Math.abs(diffX);

      // Check if swipe was significant enough for mobile
      const minSwipeDistance = window.innerWidth <= 480 ? 60 : 80; // Smaller threshold on mobile
      const maxDuration = 600; // Allow slightly longer swipes on mobile

      if (absDiffX > minSwipeDistance && touchDuration < maxDuration) {
        // Trigger reply for this message
        const messageData = {
          id: message.id,
          content: message.content,
          sender_username: message.sender_id === currentUserId ? 'You' : (message.sender_username || 'Sender'),
          message_type: messageType
        };

        setReplyMode(message.id, friendId, messageData, document.getElementById(`chat-input-${friendId}`));

        // Enhanced success animation for mobile
        messageDiv.style.transform = 'scale(1.05)';
        messageDiv.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.4)';

        setTimeout(() => {
          messageDiv.style.transform = '';
          messageDiv.style.boxShadow = '';
        }, 200);
      }
    }

    // Reset flags
    isSwiping = false;
    hasMoved = false;
  }, { passive: true });

  // Double-click to reply (desktop alternative to swipe)
  messageDiv.addEventListener('dblclick', (e) => {
    // Don't trigger on mobile (where double-click might not be intended)
    if (window.innerWidth <= 768) return;

    e.preventDefault();

    const messageData = {
      id: message.id,
      content: message.content,
      sender_username: message.sender_id === currentUserId ? 'You' : (message.sender_username || 'Sender'),
      message_type: messageType
    };

    setReplyMode(message.id, friendId, messageData, document.getElementById(`chat-input-${friendId}`));
  });
}

// Message reactions
let reactionPickerEl = null;
let reactionPickerTarget = null;
let reactionBarEl = null;
let reactionBarTarget = null;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

function ensureReactionPicker() {
  if (reactionPickerEl) return reactionPickerEl;
  reactionPickerEl = document.createElement('simple-emoji-picker');
  reactionPickerEl.id = 'reaction-emoji-picker';
  reactionPickerEl.className = 'reaction-picker';
  reactionPickerEl.style.display = 'none';
  document.body.appendChild(reactionPickerEl);

  reactionPickerEl.addEventListener('emoji-click', async (event) => {
    const emoji = event?.detail?.unicode;
    if (!emoji || !reactionPickerTarget) return;
    const { messageId } = reactionPickerTarget;
    await toggleMessageReaction(messageId, emoji);
    closeReactionPicker();
  });

  document.addEventListener('click', (event) => {
    if (!reactionPickerEl || reactionPickerEl.style.display === 'none') return;
    if (reactionPickerEl.contains(event.target)) return;
    if (reactionPickerTarget?.triggerEl && reactionPickerTarget.triggerEl.contains(event.target)) return;
    closeReactionPicker();
  });

  return reactionPickerEl;
}

function ensureReactionBar() {
  if (reactionBarEl) return reactionBarEl;
  reactionBarEl = document.createElement('div');
  reactionBarEl.id = 'message-reaction-bar';
  reactionBarEl.className = 'reaction-bar';
  reactionBarEl.style.display = 'none';

  reactionBarEl.innerHTML = `
    <div class="reaction-bar-inner">
      <div class="reaction-bar-emojis"></div>
      <button type="button" class="reaction-bar-more" title="More" aria-label="More reactions">+</button>
    </div>
  `;

  document.body.appendChild(reactionBarEl);

  // Fill quick emojis
  const emojisWrap = reactionBarEl.querySelector('.reaction-bar-emojis');
  QUICK_REACTIONS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reaction-bar-emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!reactionBarTarget?.messageId) return;
      await toggleMessageReaction(reactionBarTarget.messageId, emoji);
      closeReactionBar();
    });
    emojisWrap.appendChild(btn);
  });

  const moreBtn = reactionBarEl.querySelector('.reaction-bar-more');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!reactionBarTarget) return;
    openReactionPicker(moreBtn, reactionBarTarget.messageId, reactionBarTarget.friendId);
    closeReactionBar();
  });

  document.addEventListener('click', (event) => {
    if (!reactionBarEl || reactionBarEl.style.display === 'none') return;
    if (reactionBarEl.contains(event.target)) return;
    if (reactionBarTarget?.anchorEl && reactionBarTarget.anchorEl.contains(event.target)) return;
    closeReactionBar();
  });

  // Escape closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeReactionBar();
      closeReactionPicker();
    }
  });

  return reactionBarEl;
}

function openReactionBar(anchorEl, messageId, friendId) {
  const bar = ensureReactionBar();
  reactionBarTarget = { anchorEl, messageId, friendId };
  bar.style.display = 'block';

  // Mobile: center above message; if not enough space, show below
  const rect = anchorEl.getBoundingClientRect();
  const barWidth = 360;
  const barHeight = 56;
  const margin = 10;

  let left = rect.left + (rect.width / 2) - (barWidth / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - barWidth - margin));

  let top = rect.top - barHeight - margin;
  if (top < margin) top = rect.bottom + margin;

  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

function closeReactionBar() {
  if (!reactionBarEl) return;
  reactionBarEl.style.display = 'none';
  reactionBarTarget = null;
}

function openReactionPicker(triggerEl, messageId, friendId) {
  const picker = ensureReactionPicker();
  reactionPickerTarget = { triggerEl, messageId, friendId };

  picker.style.display = 'block';

  // Mobile: bottom-sheet
  if (window.innerWidth <= 480) {
    picker.style.left = '0px';
    picker.style.right = '0px';
    picker.style.bottom = '0px';
    picker.style.top = 'auto';
    return;
  }

  // Desktop: position near trigger
  const rect = triggerEl.getBoundingClientRect();
  const pickerWidth = 360;
  const pickerHeight = 420;
  const margin = 8;

  let left = Math.min(rect.left, window.innerWidth - pickerWidth - margin);
  left = Math.max(margin, left);

  let top = rect.top - pickerHeight - margin;
  if (top < margin) top = rect.bottom + margin;
  top = Math.min(window.innerHeight - margin, top);

  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
  picker.style.bottom = 'auto';
  picker.style.right = 'auto';
}

function closeReactionPicker() {
  if (!reactionPickerEl) return;
  reactionPickerEl.style.display = 'none';
  reactionPickerTarget = null;
}

function renderReactionsInto(messageDiv, reactions) {
  let container = messageDiv.querySelector('.message-reactions');
  if (!container) {
    // Backfill for messages rendered before reactions UI existed
    container = document.createElement('div');
    container.className = 'message-reactions';
    const footer = messageDiv.querySelector('.message-footer');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(container, footer);
    } else {
      messageDiv.appendChild(container);
    }
  }

  container.innerHTML = '';

  if (!Array.isArray(reactions) || reactions.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  reactions.forEach((reaction) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `reaction-chip${reaction.reacted_by_me ? ' mine' : ''}`;
    btn.dataset.emoji = reaction.emoji;

    btn.innerHTML = `
      <span class="reaction-emoji">${reaction.emoji}</span>
      ${reaction.count > 1 ? `<span class="reaction-count">${reaction.count}</span>` : ''}
    `;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const messageId = parseInt(messageDiv.dataset.messageId || '0', 10);
      if (!messageId) return;
      await toggleMessageReaction(messageId, reaction.emoji);
    });

    container.appendChild(btn);
  });
}

function applyReactionsUpdate(messageId, reactions) {
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;
  renderReactionsInto(messageEl, reactions);
}

async function fetchReactionsBulk(messageIds) {
  const token = await getToken(true);
  if (!token || !messageIds || !messageIds.length) return;

  try {
    const response = await fetch('/messages/reactions/bulk', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message_ids: messageIds })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || 'Failed to load reactions');
    }

    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach(item => {
      if (!item || !item.message_id) return;
      applyReactionsUpdate(item.message_id, item.reactions || []);
    });
  } catch (error) {
    console.error('Failed to load reactions:', error);
  }
}

async function toggleMessageReaction(messageId, emoji) {
  const token = await getToken(true);
  if (!token) return;

  try {
    const response = await fetch(`/messages/${messageId}/reactions/toggle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ emoji })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || 'Failed to react');
    }

    let reactions = Array.isArray(data.reactions) ? data.reactions : [];
    if (reactions.length === 0) {
      // Fallback: optimistic single reaction if server returned empty list
      reactions = [{ emoji, count: 1, reacted_by_me: true }];
    }
    applyReactionsUpdate(messageId, reactions);
  } catch (error) {
    console.error('Reaction failed:', error);
  }
}

function renderMessageNode(friendId, message) {
  const messageType = message.message_type || 'text';
  if (!message.sender_username && message.sender) {
    message.sender_username = message.sender.username;
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${message.sender_id === currentUserId ? 'sent' : 'received'}`;
  messageDiv.dataset.messageId = message.id;
  messageDiv.dataset.friendId = friendId;
  messageDiv.dataset.senderId = message.sender_id;
  messageDiv.dataset.senderUsername = message.sender_id === currentUserId ? 'You' : (message.sender_username || 'Sender');
  messageDiv.dataset.messageType = messageType;
  messageDiv.title = window.innerWidth > 768 ? 'Double-click to reply • Right-click for options' : 'Swipe to reply • Long-press for options';

  const timestamp = formatISTTime(message.created_at);
  let readReceiptHtml = '';
  if (message.sender_id === currentUserId) {
    const readStatus = message.is_read ? '✓✓' : '✓';
    const readClass = message.is_read ? 'read' : '';
    readReceiptHtml = `<span id="read-receipt-${message.id}" class="read-receipt ${readClass}" title="${message.is_read ? 'Message read' : 'Message sent'}">${readStatus}</span>`;
  }

  let replyHtml = '';
  if (message.reply_to_message_id && message.reply_to_message) {
    const replySender = message.reply_to_message.sender_username ||
                       (message.reply_to_message.sender && message.reply_to_message.sender.username) ||
                       'Unknown';
    const replyContent = message.reply_to_message.content ?
      (message.reply_to_message.content.length > 50 ? message.reply_to_message.content.substring(0, 50) + '...' : message.reply_to_message.content) :
      'Message';
    const replyAvatarLetter = replySender.charAt(0).toUpperCase();
    const replyAvatarColor = getAvatarColor(replySender);

    replyHtml = `
      <div class="message-reply">
        <div class="reply-line"></div>
        <div class="reply-content">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <div class="reply-avatar-small" style="background: ${replyAvatarColor}">${replyAvatarLetter}</div>
            <div class="reply-sender">${replySender}</div>
          </div>
          <div class="reply-text">${replyContent}</div>
        </div>
      </div>
    `;
  }

  let contentHtml = '';
  if (messageType === 'image' && message.file_path) {
    const imageContainerId = `image-container-${message.id}`;
    contentHtml = `
      ${message.content && message.content !== `📷 ${message.file_name}` ? `<div class="message-content-text">${message.content}</div>` : ''}
      <div id="${imageContainerId}" class="image-loading-container">
        <div style="padding: 20px; text-align: center; color: #999;">Loading image...</div>
      </div>
    `;
    setTimeout(() => loadImageWithAuth(message.id, imageContainerId, friendId), 100);
  } else if (messageType === 'file' && message.file_path) {
    const fileSize = formatFileSize(message.file_size || 0);
    const fileLinkId = `file-link-${message.id}`;
    contentHtml = `
      ${message.content && message.content !== `📎 ${message.file_name}` ? `<div class="message-content-text">${message.content}</div>` : ''}
      <div id="${fileLinkId}" class="file-link-container">
        <div class="message-file" style="cursor: pointer;" onclick="downloadFileWithAuth(${message.id}, '${message.file_name || 'file'}')">
          <div class="file-icon">
            <svg viewBox="0 0 24 24">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </div>
          <div class="file-info">
            <div class="file-name">${message.file_name || 'File'}</div>
            <div class="file-size">${fileSize}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    const text = message.content || '';
    const isEmojiOnly = isEmojiOnlyText(text);
    if (isEmojiOnly) {
      contentHtml = `<div class="emoji-message">${text}</div>`;
    } else {
      contentHtml = `<div>${text}</div>`;
    }
  }

  messageDiv.innerHTML = `
    ${replyHtml}
    ${contentHtml}
    <div class="message-reactions" id="message-reactions-${message.id}"></div>
    <div class="message-footer">
      <span style="font-size: 10px; opacity: 0.7;">${timestamp}</span>
      ${readReceiptHtml}
    </div>
  `;

  renderReactionsInto(messageDiv, message.reactions || []);

  wireReplyJump(messageDiv, friendId, message);

  messageDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, message.id, friendId, messageType, message.content || '', messageDiv, message.sender_id === currentUserId);
  });

  return messageDiv;
}

let contextMenuTarget = null;

function showMessageContextMenu(
  e,
  messageId,
  friendId,
  messageType,
  content,
  messageDiv,
  isSentMessage
) {
  e.preventDefault();

  // Open reaction bar first
  openReactionBar(messageDiv, messageId, friendId);

  // Then show context menu below message
  const menu = document.getElementById('message-context-menu');
  if (!menu) return;

  contextMenuTarget = { messageId, friendId, messageType, content, messageDiv, isSentMessage };

  const replyBtn = document.getElementById('context-menu-reply');
  const copyBtn = document.getElementById('context-menu-copy');
  const deleteBtn = document.getElementById('context-menu-delete');

  if (replyBtn) replyBtn.style.display = 'block';
  if (copyBtn) copyBtn.style.display = messageType === 'text' ? 'block' : 'none';
  if (deleteBtn) deleteBtn.style.display = isSentMessage ? 'block' : 'none';

  menu.style.display = 'block';

  // Position menu slightly below message
  const rect = messageDiv.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = rect.bottom + 8 + 'px';
}

function hideMessageContextMenu() {
  const menu = document.getElementById('message-context-menu');
  if (menu) menu.style.display = 'none';
  contextMenuTarget = null;
}

document.addEventListener('click', () => hideMessageContextMenu());

document.getElementById('context-menu-reply')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageId, friendId, messageType, content, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();

  // If in edit mode, cancel edit first to avoid state conflicts
  if (isEditMode && editFriendId === friendId) {
    const inputEl = document.getElementById(`chat-input-${friendId}`);
    exitEditMode(inputEl);
  }

  // Set reply mode for this message
  const messageData = {
    id: messageId,
    content: content,
    sender_username: messageDiv.dataset.senderUsername || 'Sender',
    message_type: messageType
  };

  setReplyMode(messageId, friendId, messageData, document.getElementById(`chat-input-${friendId}`));
});

document.getElementById('context-menu-react')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageId, friendId, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();
  openReactionBar(messageDiv, messageId, friendId);
});

// Function to copy text to clipboard
async function copyMessageToClipboard(content) {
  try {
    await navigator.clipboard.writeText(content);
    // Show a brief success indication
    const notification = document.createElement('div');
    notification.textContent = 'Copied to clipboard!';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-size: 14px;
      animation: fadeInOut 2s ease-in-out;
    `;
    document.body.appendChild(notification);
    setTimeout(() => document.body.removeChild(notification), 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = content;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      const notification = document.createElement('div');
      notification.textContent = 'Copied to clipboard!';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-size: 14px;
        animation: fadeInOut 2s ease-in-out;
      `;
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } catch (fallbackErr) {
      console.error('Fallback copy failed: ', fallbackErr);
      alert('Failed to copy to clipboard');
    }
    document.body.removeChild(textArea);
  }
}

document.getElementById('context-menu-copy')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageType, content, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();

  // Only copy text messages
  if (messageType !== 'text') {
    alert('Can only copy text messages');
    return;
  }

  // Get the text content from the message, skipping reply preview
  const contentEl = getMessageContentElement(messageDiv);
  const textToCopy = contentEl ? (contentEl.textContent || contentEl.innerText || content) : content;

  if (textToCopy && textToCopy.trim()) {
    await copyMessageToClipboard(textToCopy.trim());
  } else {
    alert('No text to copy');
  }
});

document.getElementById('context-menu-edit')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageId, friendId, messageType, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();
  if (messageType !== 'text') return;

  // Enter edit mode
  // Get actual message content, skipping any reply preview
  const contentEl = getMessageContentElement(messageDiv);
  const currentContent = (contentEl && contentEl.textContent) || '';
  const inputEl = document.getElementById(`chat-input-${friendId}`);
  if (inputEl) {
    // Clear any active reply mode before entering edit mode
    // Edit mode takes full priority; reply context must be discarded
    if (isReplyMode && replyFriendId === friendId) {
      clearReplyMode(friendId);
    }
    
    // Now enter edit mode with clean state
    isEditMode = true;
    editMessageId = messageId;
    editFriendId = friendId;
    inputEl.value = currentContent;
    inputEl.placeholder = 'Edit your message... (Press ESC to cancel)';
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  }
});

document.getElementById('context-menu-delete')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageId, friendId, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();
  if (!confirm('Delete this message?')) return;
  try {
    const token = await getToken(true);
    if (!token) return;
    const response = await fetch(`/messages/${messageId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to delete');
    messageDiv.remove();
  } catch (err) {
    alert('Error deleting message: ' + err.message);
  }
});

async function sendChatMessage(friendId) {
  const inputEl = document.getElementById(`chat-input-${friendId}`);
  const message = inputEl.value.trim();
  const pendingImage = pendingPasteImages.get(friendId);

  if (pendingImage && !isEditMode) {
    pendingPasteImages.delete(friendId);
    await uploadFile(pendingImage, friendId, true);
    if (isReplyMode && replyFriendId === friendId) {
      clearReplyMode(friendId);
    }
    const progressEl = document.getElementById(`upload-progress-${friendId}`);
    if (progressEl) {
      progressEl.classList.remove('active');
    }
    return;
  }

  if (!message) return;

  const token = await getToken(true);
  if (!token) return;

  try {
    let response;
    let resultMessage;

    if (isEditMode && editMessageId && editFriendId === friendId) {
      // Edit existing message
      response = await fetch(`/messages/${editMessageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: message })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to edit message');
      }

      const updatedMessage = await response.json();

      // Update the message in the chat
      const messageDiv = document.querySelector(`[data-message-id="${editMessageId}"]`);
      if (messageDiv) {
        const contentEl = getMessageContentElement(messageDiv);
        const isEmojiOnly = isEmojiOnlyText(message);
        if (contentEl) {
          if (isEmojiOnly) {
            contentEl.outerHTML = `<div class="emoji-message">${message}</div>`;
          } else {
            contentEl.textContent = message;
            contentEl.classList.remove('emoji-message');
          }
        }
      }

      // Exit edit mode and clear any associated reply mode
      exitEditMode(inputEl);
      if (isReplyMode && replyFriendId === friendId) {
        clearReplyMode(friendId);
      }
      return;
    } else {
      // Send new message (with reply context if in reply mode)
      const requestBody = {
        receiver_id: friendId,
        content: message
      };

      if (isReplyMode && replyMessageId && replyFriendId === friendId) {
        requestBody.reply_to_message_id = replyMessageId;
      }

      response = await fetch('/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to send message');
      }

      resultMessage = await response.json();

      // Add message to chat
      addMessageToChat(friendId, resultMessage);
    }

    // Clear input
    inputEl.value = '';
    stopTyping(friendId);

    // Clear reply mode if it was active
    if (isReplyMode && replyFriendId === friendId) {
      clearReplyMode(friendId);
    }

    // Mark messages as read only if chat window is currently open and visible
    const chatWindow = document.getElementById(`chat-window-${friendId}`);
    if (chatWindow && chatWindow.style.display !== 'none' &&
        chatWindow.classList.contains('show')) {
      markMessagesAsRead(friendId);
    }

  } catch (error) {
    alert('Error sending message: ' + error.message);
  }
}

function exitEditMode(inputEl) {
  isEditMode = false;
  editMessageId = null;
  editFriendId = null;
  if (inputEl) {
    inputEl.value = '';
    inputEl.placeholder = 'Type your message...';
    const idPart = inputEl.id?.replace('chat-input-', '');
    const friendId = idPart ? parseInt(idPart, 10) : null;
    if (friendId) stopTyping(friendId);
  }
}

function setReplyMode(messageId, friendId, messageData, inputEl) {
  isReplyMode = true;
  replyMessageId = messageId;
  replyFriendId = friendId;
  replyMessageData = messageData;
  if (inputEl) {
    inputEl.placeholder = 'Reply to message...';
    inputEl.focus();
  }
  updateReplyIndicator(friendId);
}

function clearReplyMode(friendId) {
  isReplyMode = false;
  replyMessageId = null;
  replyFriendId = null;
  replyMessageData = null;
  updateReplyIndicator(friendId);
}

function updateReplyIndicator(friendId) {
  const replyIndicator = document.getElementById(`reply-indicator-${friendId}`);
  if (!replyIndicator) return;

  if (isReplyMode && replyFriendId === friendId && replyMessageData) {
    const senderName = replyMessageData.sender_username || 'Unknown';
    const previewText = replyMessageData.content ?
      (replyMessageData.content.length > 50 ? replyMessageData.content.substring(0, 50) + '...' : replyMessageData.content) :
      'Message';

    replyIndicator.innerHTML = `
      <div class="reply-indicator-content">
        <div class="reply-line"></div>
        <div class="reply-info">
          <div class="reply-to">${senderName}</div>
          <div class="reply-preview">${previewText}</div>
        </div>
      </div>
      <button class="reply-cancel" onclick="clearReplyMode(${friendId})" title="Cancel reply">×</button>
    `;
    replyIndicator.style.display = 'flex';
  } else {
    replyIndicator.style.display = 'none';
  }
}

function handleChatKeyPress(event, friendId) {
  if (event.key === 'Enter') {
    sendChatMessage(friendId);
  } else if (event.key === 'Escape') {
    const inputEl = document.getElementById(`chat-input-${friendId}`);
    if (isEditMode) {
      exitEditMode(inputEl);
    } else if (isReplyMode && replyFriendId === friendId) {
      clearReplyMode(friendId);
    }
  }
}

function handleTypingInput(friendId, inputEl) {
  const hasText = Boolean(inputEl.value.trim());
  if (hasText) {
    startTyping(friendId);
  } else {
    stopTyping(friendId);
  }
}

async function startTyping(friendId) {
  if (typingStates.get(friendId)) {
    resetTypingTimer(friendId);
    return;
  }
  typingStates.set(friendId, true);
  await sendTypingStatus(friendId, true);
  resetTypingTimer(friendId);
}

function resetTypingTimer(friendId) {
  if (typingTimers.has(friendId)) {
    clearTimeout(typingTimers.get(friendId));
  }
  const timer = setTimeout(() => stopTyping(friendId), 1200);
  typingTimers.set(friendId, timer);
}

async function stopTyping(friendId) {
  if (typingTimers.has(friendId)) {
    clearTimeout(typingTimers.get(friendId));
    typingTimers.delete(friendId);
  }
  if (!typingStates.get(friendId)) return;
  typingStates.set(friendId, false);
  await sendTypingStatus(friendId, false);
}

async function sendTypingStatus(friendId, isTyping) {
  const ws = await ensureSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "typing",
    to_user_id: friendId,
    data: { is_typing: isTyping }
  }));
}

function handleTypingIndicator(data) {
  const fromUserId = data.from_user_id;
  if (!fromUserId) return;
  const indicator = document.getElementById(`typing-indicator-${fromUserId}`);
  if (!indicator) return;
  indicator.classList.toggle('is-active', Boolean(data.is_typing));
}

// File upload handlers
async function handleFileUpload(event, friendId) {
  const file = event.target.files[0];
  if (!file) return;

  // Determine if it's an image or other file type
  const isImage = file.type.startsWith('image/');

  // Validate file size (50MB max for all files)
  if (file.size > 50 * 1024 * 1024) {
    alert('File size must be less than 50MB');
    event.target.value = ''; // Reset input
    return;
  }

  await uploadFile(file, friendId, isImage);
  event.target.value = ''; // Reset input after upload
}

// Drag and drop functionality
function setupDragAndDropForChat(friendId, chatWindow) {
  let dragCounter = 0;

  // Prevent default drag behaviors
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Handle drag enter
  chatWindow.addEventListener('dragenter', (e) => {
    preventDefaults(e);
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) {
      chatWindow.style.border = '3px dashed #667eea';
      chatWindow.style.backgroundColor = 'rgba(102, 126, 234, 0.05)';
    }
  });

  // Handle drag over
  chatWindow.addEventListener('dragover', (e) => {
    preventDefaults(e);
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  // Handle drag leave
  chatWindow.addEventListener('dragleave', (e) => {
    preventDefaults(e);
    dragCounter--;
    if (dragCounter === 0) {
      chatWindow.style.border = '';
      chatWindow.style.backgroundColor = '';
    }
  });

  // Handle drop
  chatWindow.addEventListener('drop', async (e) => {
    preventDefaults(e);
    dragCounter = 0;
    chatWindow.style.border = '';
    chatWindow.style.backgroundColor = '';

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    // Process each dropped file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check if it's an image
      if (file.type.startsWith('image/')) {
        // Validate image size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          alert(`Image "${file.name}" is too large. Maximum size is 10MB.`);
          continue;
        }
        await uploadFile(file, friendId, true);
      } else {
        // It's a regular file
        // Validate file size (50MB max)
        if (file.size > 50 * 1024 * 1024) {
          alert(`File "${file.name}" is too large. Maximum size is 50MB.`);
          continue;
        }
        await uploadFile(file, friendId, false);
      }
    }
  });
}

async function uploadFile(file, friendId, isImage) {
  const token = await getToken(true);
  if (!token) {
    alert('Please login to upload files');
    return;
  }

  const progressEl = document.getElementById(`upload-progress-${friendId}`);
  const endpoint = isImage ? '/messages/send-image' : '/messages/send-file';
  
  // Show progress
  progressEl.textContent = `Uploading ${file.name}...`;
  progressEl.classList.add('active');

  try {
    const formData = new FormData();
    formData.append('receiver_id', friendId);
    formData.append('file', file);
    
    // Optional caption/description
    const inputEl = document.getElementById(`chat-input-${friendId}`);
    if (inputEl && inputEl.value.trim()) {
      formData.append('content', inputEl.value.trim());
      inputEl.value = ''; // Clear input after using
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.detail || 'Failed to upload file');
    }

    const sentMessage = await response.json();
    
    // Add message to chat
    addMessageToChat(friendId, sentMessage);

    // Hide progress
    progressEl.classList.remove('active');
    
    // Mark messages as read if chat window is open
    const chatWindow = document.getElementById(`chat-window-${friendId}`);
    if (chatWindow && chatWindow.style.display !== 'none' &&
        chatWindow.classList.contains('show')) {
      markMessagesAsRead(friendId);
    }

  } catch (error) {
    console.error('Upload error:', error);
    alert('Error uploading file: ' + error.message);
    progressEl.classList.remove('active');
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function loadImageWithAuth(messageId, containerId, friendId) {
  const token = await getToken(true);
  if (!token) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: #f00;">Authentication required</div>';
    }
    return;
  }

  try {
    const response = await fetch(`/messages/file/${messageId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load image');
    }

    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<img src="${imageUrl}" alt="Image" class="message-image" onclick="openImageModal('${imageUrl}')" />`;
    }
  } catch (error) {
    console.error('Error loading image:', error);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: #f00;">Failed to load image</div>';
    }
  }
}

async function downloadFileWithAuth(messageId, fileName) {
  const token = await getToken(true);
  if (!token) {
    alert('Please login to download files');
    return;
  }

  try {
    const response = await fetch(`/messages/file/${messageId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to download file');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading file:', error);
    alert('Failed to download file: ' + error.message);
  }
}

function openImageModal(imageUrl) {
  // Create modal for full-size image view
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: pointer;
  `;
  
  const img = document.createElement('img');
  img.src = imageUrl;
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  `;
  
  modal.appendChild(img);
  document.body.appendChild(modal);
  
  modal.onclick = () => {
    document.body.removeChild(modal);
  };
}

function showChatNotification(username, content, senderId) {
  const notification = document.getElementById('chat-notification');
  const contentEl = document.getElementById('notification-content');
  if (!notification || !contentEl) {
    return;
  }

  contentEl.textContent = `${username}: ${content.length > 30 ? content.substring(0, 30) + '...' : content}`;
  notification.style.display = 'block';

  currentNotificationData = { senderId, username };

  // Auto-hide after 5 seconds
  setTimeout(() => {
    hideChatNotification();
  }, 5000);
}

function hideChatNotification() {
  const notification = document.getElementById('chat-notification');
  if (!notification) {
    currentNotificationData = null;
    return;
  }
  notification.style.display = 'none';
  currentNotificationData = null;
}

function openChatFromNotification() {
  if (currentNotificationData) {
    openChatWindow(currentNotificationData.senderId);
  }
}

async function markMessagesAsRead(friendId) {
  const token = await getToken(true);
  if (!token) return;

  try {
    const response = await fetch(`/messages/mark-read/${friendId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to mark messages as read');
    }
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

// This function is no longer used since we removed the main chat interface
// Keeping it for compatibility but adding null check
function appendMessage(text, role) {
  // Since we removed the main chat interface, this function is deprecated
  // Chat messages are now handled in popup windows
  console.log("appendMessage called but main chat interface is removed:", text, role);
}

async function ensureSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) return socket;

  const token = await getToken(true);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = token ? `${protocol}//${location.host}/chat/ws?token=${token}` : `${protocol}//${location.host}/chat/ws`;
  socket = new WebSocket(wsUrl);
  let botBuffer = "";

  socket.onopen = () => setStatus("Connected");
  socket.onclose = () => setStatus("Disconnected");
  socket.onerror = () => setStatus("Error");

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "token") {
      botBuffer += data.data;
    } else if (data.type === "done") {
      appendMessage(botBuffer.trim(), "bot");
      botBuffer = "";
    } else if (data.type === "friend_request_received") {
      handleFriendRequestReceived(data.data);
    } else if (data.type === "friend_request_accepted") {
      handleFriendRequestAccepted(data.data);
    } else if (data.type === "friend_request_declined") {
      handleFriendRequestDeclined(data.data);
    } else if (data.type === "friend_request_cancelled") {
      handleFriendRequestCancelled(data.data);
    } else if (data.type === "friend_removed") {
      handleFriendRemoved(data.data);
    } else if (data.type === "chat_message") {
      handleChatMessage(data.data);
    } else if (data.type === "messages_read") {
      handleMessagesRead(data.data);
    } else if (data.type === "message_edited") {
      handleMessageEdited(data.data);
    } else if (data.type === "message_deleted") {
      handleMessageDeleted(data.data);
    } else if (data.type === "message_reaction_updated") {
      handleMessageReactionUpdated(data.data);
    } else if (data.type === "typing") {
      handleTypingIndicator(data.data);
    } else if (data.type === "call_start") {
      showIncomingCall(data.data.from_user_id, data.data.call_id, data.data.metadata || {});
    } else if (data.type === "call_accept") {
      if (callState && callState.isCaller) {
        if (!data.data?.call_id || data.data.call_id === callState.callId) {
          startCallerOffer();
        }
      }
    } else if (data.type === "call_decline") {
      if (callState) {
        alert("Call declined");
        endCallCleanup();
      }
    } else if (data.type === "busy") {
      if (callState && data.data?.call_id && data.data.call_id !== callState.callId) return;
      alert("User is busy on another call.");
      endCallCleanup();
    } else if (data.type === "call_end") {
      if (!callState || !data.data?.call_id || data.data.call_id === callState.callId) {
        endCallCleanup();
      }
    } else if (data.type === "offer") {
      if (!callState) {
        pendingOffer = data.data;
        return;
      }
      if (!callState.pc) {
        pendingOffer = data.data;
        return;
      }
      handleOffer(data.data);
    } else if (data.type === "answer") {
      handleAnswer(data.data);
    } else if (data.type === "ice") {
      handleIce(data.data);
    }
  };

  return socket;
}

function handleMessageEdited(data) {
  const friendId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
  const messageEl = document.querySelector(`[data-message-id="${data.id}"]`);
  if (!messageEl || messageEl.closest(`#chat-messages-${friendId}`) === null) return;
  const contentEl = getMessageContentElement(messageEl);
  if (!contentEl) return;
  const text = data.content || '';
  const isEmojiOnly = isEmojiOnlyText(text);
  if (isEmojiOnly) {
    contentEl.outerHTML = `<div class="emoji-message">${text}</div>`;
  } else {
    contentEl.textContent = text;
    contentEl.classList.remove('emoji-message');
  }
}

function handleMessageDeleted(data) {
  const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
  if (messageEl) messageEl.remove();
}

function handleMessageReactionUpdated(data) {
  if (!data || !data.message_id) return;
  applyReactionsUpdate(data.message_id, data.reactions || []);
}

async function showDashboard() {
  dashboardCard.style.display = "block";
  if (authWrapper) authWrapper.style.display = "none";
  sidebar.style.display = "block";

  document.body.classList.remove("auth-view");
  document.body.classList.add("dashboard-view");
  document.body.classList.remove("chat-open");

  try {
    await ensureSocket();
  } catch (error) {
    console.error('WebSocket connection failed:', error);
  }

  fetchActiveUsers();
  fetchFriendRequests();
  fetchFriends();
}

// Video call UI wiring
document.getElementById('incoming-accept')?.addEventListener('click', acceptIncomingCall);
document.getElementById('incoming-decline')?.addEventListener('click', declineIncomingCall);
document.getElementById('vc-end')?.addEventListener('click', endCall);
document.getElementById('vc-mic')?.addEventListener('click', () => {
  if (!callState || !callState.localStream) return;
  callState.localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
  const btn = document.getElementById('vc-mic');
  const icon = document.getElementById('vc-mic-icon');
  const label = document.getElementById('vc-mic-label');
  const enabled = callState.localStream.getAudioTracks().some(t => t.enabled);
  if (btn) {
    btn.classList.toggle('active', enabled);
    if (icon) {
      icon.src = enabled ? '/Images/microphone.png' : '/Images/mute.png';
      icon.alt = enabled ? 'Microphone' : 'Muted';
    }
    if (label) label.textContent = enabled ? 'Unmuted' : 'Muted';
  }
});
document.getElementById('vc-cam')?.addEventListener('click', () => {
  if (!callState) return;
  const btn = document.getElementById('vc-cam');
  const icon = document.getElementById('vc-cam-icon');
  const label = document.getElementById('vc-cam-label');
  const tracks = callState.localStream?.getVideoTracks() || [];
  if (tracks.length === 0) {
    if (btn && label) label.textContent = 'Enabling...';
    enableCamera();
    return;
  }
  tracks.forEach(t => { t.enabled = !t.enabled; });
  const enabled = tracks.some(t => t.enabled);
  if (btn) {
    btn.classList.toggle('active', enabled);
    if (icon) {
      icon.src = enabled ? '/Images/video-camera.png' : '/Images/no-video.png';
      icon.alt = enabled ? 'Camera on' : 'Camera off';
    }
    if (label) label.textContent = enabled ? 'Camera on' : 'Camera off';
  }
});

function showAuth() {
  dashboardCard.style.display = "none";
  if (authWrapper) authWrapper.style.display = "flex";
  sidebar.style.display = "none";

  // ✅ Remove all other layout classes
  document.body.classList.remove("dashboard-view");
  document.body.classList.remove("chat-open");
  document.body.classList.add("auth-view");

  setAuthTab("login");
}

const authTabs = document.querySelectorAll(".auth-tab");

function setAuthTab(mode) {
  const showLogin = mode === "login";
  loginCard.classList.toggle("is-active", showLogin);
  authCard.classList.toggle("is-active", !showLogin);
  authTabs.forEach((tab) => {
    const isActive = tab.dataset.auth === mode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setAuthTab(tab.dataset.auth || "login");
  });
});

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

// Get token synchronously for immediate access
function getTokenSync() {
  return localStorage.getItem(TOKEN_KEY);
}

// Get token with optional refresh (async)
async function getToken(refreshIfNeeded = true) {
  let token = localStorage.getItem(TOKEN_KEY);
  if (token && refreshIfNeeded && isTokenExpiringSoon(token)) {
    token = await refreshTokenIfNeeded();
  }
  return token;
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Check if token is expired or about to expire (within 5 minutes)
function isTokenExpiringSoon(token) {
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;
    const timeUntilExpiry = payload.exp - currentTime;
    // Return true if token expires within 5 minutes
    return timeUntilExpiry < 300;
  } catch (e) {
    return true; // Invalid token
  }
}

// Refresh token if it's about to expire
async function refreshTokenIfNeeded() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !isTokenExpiringSoon(token)) return token;

  try {
    const response = await fetch('/auth/refresh-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem(TOKEN_KEY, data.access_token);
      return data.access_token;
    } else {
      // Token refresh failed, user needs to login again
      clearToken();
      showAuth();
      return null;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    // Don't logout immediately on network errors, just return current token
    return token;
  }
}

async function registerUser() {
  const payload = {
    email: regEmail.value.trim(),
    username: regUsername.value.trim(),
    password: regPassword.value,
    full_name: regFullname.value.trim() || null,
  };

  try {
    registerBtn.disabled = true;
    const resp = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || "Registration failed");
    alert("Registered! Now login with your email & password.");
    loginEmail.value = payload.email;
    loginPassword.value = payload.password;
  } catch (err) {
    alert(err.message);
  } finally {
    registerBtn.disabled = false;
  }
}

async function loginUser() {
  const payload = {
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  };
  loginStatus.textContent = "";
  try {
    loginBtn.disabled = true;

    const resp = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) throw new Error(data.detail || "Login failed");

    saveToken(data.access_token);
    loginStatus.textContent = "Logged in";
    await showDashboard();
    setStatus("Connected");
  } catch (err) {
    console.error('Login error:', err);
    loginStatus.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
  }
}

registerBtn.onclick = registerUser;
loginBtn.onclick = loginUser;

// Periodic token refresh timer
let tokenRefreshTimer = null;

function startTokenRefreshTimer() {
  // Check token every 10 minutes
  tokenRefreshTimer = setInterval(async () => {
    const token = getTokenSync();
    if (token && isTokenExpiringSoon(token)) {
      await refreshTokenIfNeeded();
    }
  }, 10 * 60 * 1000); // 10 minutes
}

function stopTokenRefreshTimer() {
  if (tokenRefreshTimer) {
    clearInterval(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
}

logoutBtn.onclick = () => {
  stopTokenRefreshTimer();
  clearToken();
  if (socket) {
    socket.close();
    socket = null;
  }
  showAuth();
};

// Comment out chat-related event handlers since we removed the chat interface
/*
sendBtn.onclick = () => {
  const text = inputEl.value.trim();
  if (!text) return;
  appendMessage(text, "user");
  inputEl.value = "";
  const ws = ensureSocket();
  ws.send(JSON.stringify({ role: "user", content: text }));
};

inputEl.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendBtn.onclick();
});
*/

// Mark messages as read when page becomes visible (user returns to tab)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && activeChats.size > 0) {
    // Mark messages as read for all active chat windows
    activeChats.forEach(friendId => {
      const chatWindow = document.getElementById(`chat-window-${friendId}`);
      if (chatWindow && chatWindow.style.display !== 'none' &&
          chatWindow.classList.contains('show')) {
        markMessagesAsRead(friendId);
      }
    });
  }
});

// Responsive enhancements
let currentOrientation = window.orientation || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');

// Handle orientation changes for better mobile experience
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    currentOrientation = window.orientation || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');

    // Update any active reply indicators after orientation change
    if (isReplyMode) {
      const replyIndicator = document.getElementById(`reply-indicator-${replyFriendId}`);
      if (replyIndicator) {
        updateReplyIndicator(replyFriendId);
      }
    }

    // Re-adjust chat window sizes if needed
    const chatWindows = document.querySelectorAll('.chat-window');
    chatWindows.forEach(window => {
      if (window.style.display !== 'none') {
        // Force reflow for proper responsive adjustments
        window.style.display = 'none';
        setTimeout(() => {
          window.style.display = 'flex';
        }, 10);
      }
    });
  }, 300); // Wait for orientation change to complete
});

// Handle window resize for responsive adjustments
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Update tooltips based on screen size
    const messages = document.querySelectorAll('.chat-message');
    messages.forEach(message => {
      message.title = window.innerWidth > 768 ?
        'Double-click to reply • Right-click for options' :
        'Swipe to reply • Long-press for options';
    });

    // Adjust any active reply indicators
    if (isReplyMode) {
      const replyIndicator = document.getElementById(`reply-indicator-${replyFriendId}`);
      if (replyIndicator) {
        updateReplyIndicator(replyFriendId);
      }
    }
  }, 250);
});

// Touch device detection for better UX
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Initialize view based on token
async function initializeApp() {
  try {
    const token = getTokenSync(); // Use sync version for initial check
    if (token) {
      await showDashboard();
      // Start periodic token refresh
      startTokenRefreshTimer();
    } else {
      showAuth();
    }
  } catch (error) {
    console.error('Error during app initialization:', error);
    // Fallback to auth screen on error
    showAuth();
  }
}

initializeApp();

function setupMadeForJModal() {
  const footer = document.getElementById('footer');
  const modal = document.getElementById('madeForJModal');
  const closeBtn = document.getElementById('madeForJClose');
  if (!footer || !modal) return;

  let pressTimer = null;
  let mouseDownTime = 0;

  const openMadeForJModal = () => {
    modal.classList.add('show');
  };

  const closeMadeForJModal = () => {
    modal.classList.remove('show');
  };

  footer.addEventListener('touchstart', () => {
    pressTimer = setTimeout(openMadeForJModal, 600);
  }, { passive: true });

  footer.addEventListener('touchend', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }, { passive: true });

  footer.addEventListener('touchmove', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }, { passive: true });

  footer.addEventListener('mousedown', () => {
    mouseDownTime = Date.now();
  });

  footer.addEventListener('mouseup', () => {
    const pressDuration = Date.now() - mouseDownTime;
    if (pressDuration > 600) {
      openMadeForJModal();
    }
  });

  footer.addEventListener('mouseleave', () => {
    mouseDownTime = 0;
  });

  closeBtn?.addEventListener('click', closeMadeForJModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeMadeForJModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMadeForJModal();
    }
  });
}


setupMadeForJModal();
