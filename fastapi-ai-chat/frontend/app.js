// Chat elements removed - now using dashboard instead
// const messagesEl = document.getElementById("messages");
// const inputEl = document.getElementById("input");
// const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");
const logoutBtn = document.getElementById("logoutBtn");
const chatCard = document.getElementById("chatCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginCard = document.getElementById("loginCard");
const authCard = document.getElementById("authCard");
const loginStatus = document.getElementById("loginStatus");
const sidebar = document.getElementById("sidebar");
const usersList = document.getElementById("usersList");
const friendsList = document.getElementById("friendsList");
const friendRequestsList = document.getElementById("friendRequestsList");

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

const TOKEN_KEY = "access_token";
let socket;
let currentUserId = null;
let cachedFriends = [];

// Edit mode variables
let isEditMode = false;
let editMessageId = null;
let editFriendId = null;

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

function displayFriends(friends) {
  if (!friends || friends.length === 0) {
    friendsList.innerHTML = '<div class="user-item">No friends yet</div>';
    return;
  }

  friendsList.innerHTML = friends.map(friend => {
    // The sender field now contains the friend user
    const friendUser = friend.sender;
    if (!friendUser) return '';

    return `
      <div class="user-item">
        <div class="user-info">
          <div class="user-name">${friendUser.username}</div>
          <div class="user-email">${friendUser.email}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="request-btn" onclick="startChat(${friendUser.id})" style="background: #2196f3;">Chat</button>
          <button class="request-btn cancel" onclick="removeFriend(${friendUser.id})">Remove</button>
        </div>
      </div>
    `;
  }).join('');
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
          <button class="request-btn accept" onclick="acceptFriendRequest(${request.id})">Accept</button>
          <button class="request-btn decline" onclick="declineFriendRequest(${request.id})">Decline</button>
        </div>
      </div>
    `;
  }).join('');
}

function getFriendInfo(friendId) {
  const friend = cachedFriends.find(f => f.sender.id === friendId);
  return friend ? friend.sender : null;
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
      buttonHtml = `<button class="${buttonClass}" onclick="${buttonAction}" style="background: #2196f3;">${buttonText}</button>`;
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
  openChatWindow(friendId);
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

  // If we have an active chat with this user, add the message
  const chatWindow = document.getElementById(`chat-window-${data.sender_id}`);
  if (chatWindow && chatWindow.style.display !== 'none') {
    addMessageToChat(data.sender_id, data);
    // Mark messages as read since user is actively viewing the chat
    markMessagesAsRead(data.sender_id);
  } else {
    // Show notification for new message
    const notificationText = data.message_type === 'image' ? '📷 sent an image' :
                             data.message_type === 'file' ? `📎 sent ${data.file_name || 'a file'}` :
                             data.content;
    showChatNotification(data.sender_username, notificationText, data.sender_id);
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
  // Check if chat window already exists
  let chatWindow = document.getElementById(`chat-window-${friendId}`);

  if (!chatWindow) {
    // Create new chat window
    chatWindow = createChatWindow(friendId);
    document.getElementById('chat-windows').appendChild(chatWindow);
  }

  // Show the chat window with animation
  chatWindow.style.display = 'flex';
  // Trigger animation and mark as read after animation completes
  setTimeout(() => {
    chatWindow.classList.add('show');
    // Mark messages as read only after the window is fully visible
    setTimeout(() => {
      if (chatWindow.style.display !== 'none' && activeChats.has(friendId)) {
        markMessagesAsRead(friendId);
      }
    }, 300); // Wait for animation to complete
  }, 10);

  activeChats.add(friendId);

  // Load chat history (but don't mark as read yet)
  loadChatHistory(friendId);

  // Hide notification if it exists
  hideChatNotification();
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
      <button class="chat-close" onclick="closeChatWindow(${friendId})" title="Close chat"></button>
    </div>
    <div class="chat-messages" id="chat-messages-${friendId}"></div>
    <div class="chat-input-area" style="position: relative;">
      <div class="chat-upload-buttons">
        <label class="chat-upload-btn" title="Upload file (images, audio, documents, etc.)" for="file-upload-${friendId}">
          <input type="file" id="file-upload-${friendId}" onchange="handleFileUpload(event, ${friendId})" style="display: none;">
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        </label>
      </div>
      <button class="chat-upload-btn emoji-btn" id="emoji-btn-${friendId}" title="Insert emoji" type="button">
        <span style="font-size: 20px;">😊</span>
      </button>
      <input type="text" class="chat-input" id="chat-input-${friendId}" placeholder="Type your message..." onkeypress="handleChatKeyPress(event, ${friendId})">
      <button class="chat-send" onclick="sendChatMessage(${friendId})" title="Send message">Send</button>
      <simple-emoji-picker id="emoji-picker-${friendId}" class="emoji-picker" style="display: none;"></simple-emoji-picker>
    </div>
    <div class="upload-progress" id="upload-progress-${friendId}"></div>
  `;

  // Add drag functionality to header (desktop only)
  const header = chatWindow.querySelector('.chat-header');
  header.style.cursor = 'move';

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
  } else {
    console.error('Emoji picker setup failed - elements not found:', { emojiBtn, emojiPicker, chatInput });
  }

  return chatWindow;
}

function closeChatWindow(friendId) {
  const chatWindow = document.getElementById(`chat-window-${friendId}`);
  if (chatWindow) {
    // Remove animation class first
    chatWindow.classList.remove('show');
    // Wait for animation to complete before hiding
    setTimeout(() => {
      chatWindow.style.display = 'none';
      activeChats.delete(friendId);
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
    const response = await fetch(`/messages/conversation/${friendId}`, {
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

    // Clear existing messages
    const messagesEl = document.getElementById(`chat-messages-${friendId}`);
    messagesEl.innerHTML = '';

    // Add messages to chat
    messages.forEach(message => {
      addMessageToChat(friendId, message);
    });

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;

  } catch (error) {
    console.error('Error loading chat history:', error);
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

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${message.sender_id === currentUserId ? 'sent' : 'received'}`;
  messageDiv.dataset.messageId = message.id;
  messageDiv.dataset.friendId = friendId;
  messageDiv.dataset.senderId = message.sender_id;
  messageDiv.dataset.messageType = messageType;

  // Always display time in IST (manually converted from UTC / server time)
  const timestamp = formatISTTime(message.created_at);

  // Add read receipt for sent messages
  let readReceiptHtml = '';
  if (message.sender_id === currentUserId) {
    const readStatus = message.is_read ? '✓✓' : '✓';
    const readClass = message.is_read ? 'read' : '';
    readReceiptHtml = `<span id="read-receipt-${message.id}" class="read-receipt ${readClass}" title="${message.is_read ? 'Message read' : 'Message sent'}">${readStatus}</span>`;
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
    let isEmojiOnly = false;
    try {
      // Matches strings that contain only emoji and whitespace
      isEmojiOnly = text.trim().length > 0 &&
        /^[\p{Extended_Pictographic}\s]+$/u.test(text);
    } catch (e) {
      // Fallback: basic emoji range if browser doesn't support \p{Extended_Pictographic}
      isEmojiOnly = text.trim().length > 0 &&
        /^[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\u2600-\u26FF\u2700-\u27BF\u1F000-\u1FAFF\s]+$/.test(text);
    }

    if (isEmojiOnly) {
      contentHtml = `<div class="emoji-message">${text}</div>`;
    } else {
      contentHtml = `<div>${text}</div>`;
    }
  }

  messageDiv.innerHTML = `
    ${contentHtml}
    <div class="message-footer">
      <span style="font-size: 10px; opacity: 0.7;">${timestamp}</span>
      ${readReceiptHtml}
    </div>
  `;

  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Right-click and long-press context menu (sent messages only)
  if (message.sender_id === currentUserId) {
    messageDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMessageContextMenu(e, message.id, friendId, messageType, message.content || '', messageDiv);
    });
    let longPressTimer;
    messageDiv.addEventListener('touchstart', (e) => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        e.preventDefault();
        const touch = e.touches[0] || e.changedTouches[0];
        showMessageContextMenu({ clientX: touch.clientX, clientY: touch.clientY }, message.id, friendId, messageType, message.content || '', messageDiv);
      }, 500);
    }, { passive: true });
    messageDiv.addEventListener('touchend', () => { if (longPressTimer) clearTimeout(longPressTimer); });
    messageDiv.addEventListener('touchmove', () => { if (longPressTimer) clearTimeout(longPressTimer); longPressTimer = null; });
  }
}

let contextMenuTarget = null;

function showMessageContextMenu(e, messageId, friendId, messageType, content, messageDiv) {
  const menu = document.getElementById('message-context-menu');
  if (!menu) return;
  contextMenuTarget = { messageId, friendId, messageType, content, messageDiv };
  const editBtn = document.getElementById('context-menu-edit');
  if (editBtn) {
    editBtn.style.display = messageType === 'text' ? 'block' : 'none';
  }
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
}

function hideMessageContextMenu() {
  const menu = document.getElementById('message-context-menu');
  if (menu) menu.style.display = 'none';
  contextMenuTarget = null;
}

document.addEventListener('click', () => hideMessageContextMenu());

document.getElementById('context-menu-edit')?.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const { messageId, friendId, messageType, messageDiv } = contextMenuTarget;
  hideMessageContextMenu();
  if (messageType !== 'text') return;

  // Enter edit mode
  const contentEl = messageDiv.querySelector('.emoji-message') || messageDiv.firstElementChild;
  const currentContent = (contentEl && contentEl.textContent) || '';
  const inputEl = document.getElementById(`chat-input-${friendId}`);
  if (inputEl) {
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
        const contentEl = messageDiv.querySelector('.emoji-message') || messageDiv.firstElementChild;
        let isEmojiOnly = false;
        try {
          isEmojiOnly = message.trim().length > 0 && /^[\p{Extended_Pictographic}\s]+$/u.test(message);
        } catch (_) {
          isEmojiOnly = message.trim().length > 0 && /^[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\u2600-\u26FF\u2700-\u27BF\u1F000-\u1FAFF\s]+$/.test(message);
        }
        if (contentEl) {
          if (isEmojiOnly) {
            contentEl.outerHTML = `<div class="emoji-message">${message}</div>`;
          } else {
            contentEl.textContent = message;
            contentEl.classList.remove('emoji-message');
          }
        }
      }

      // Exit edit mode
      exitEditMode(inputEl);
      return;
    } else {
      // Send new message
      response = await fetch('/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receiver_id: friendId,
          content: message
        })
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
  }
}

function handleChatKeyPress(event, friendId) {
  if (event.key === 'Enter') {
    sendChatMessage(friendId);
  } else if (event.key === 'Escape' && isEditMode) {
    const inputEl = document.getElementById(`chat-input-${friendId}`);
    exitEditMode(inputEl);
  }
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
    }
  };

  return socket;
}

function handleMessageEdited(data) {
  const friendId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
  const messageEl = document.querySelector(`[data-message-id="${data.id}"]`);
  if (!messageEl || messageEl.closest(`#chat-messages-${friendId}`) === null) return;
  const contentEl = messageEl.querySelector('.emoji-message') || messageEl.firstElementChild;
  if (!contentEl) return;
  const text = data.content || '';
  let isEmojiOnly = false;
  try {
    isEmojiOnly = text.trim().length > 0 && /^[\p{Extended_Pictographic}\s]+$/u.test(text);
  } catch (_) {
    isEmojiOnly = text.trim().length > 0 && /^[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\u2600-\u26FF\u2700-\u27BF\u1F000-\u1FAFF\s]+$/.test(text);
  }
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

async function showDashboard() {
  dashboardCard.style.display = "block";
  loginCard.style.display = "none";
  authCard.style.display = "none";
  sidebar.style.display = "block";

  // Establish WebSocket connection for real-time updates
  try {
    await ensureSocket();
  } catch (error) {
    console.error('WebSocket connection failed:', error);
    // Continue without WebSocket for now
  }

  // Fetch data (don't await these as they can run in parallel)
  fetchActiveUsers();
  fetchFriendRequests();
  fetchFriends();
}

function showAuth() {
  dashboardCard.style.display = "none";
  loginCard.style.display = "block";
  authCard.style.display = "block";
  sidebar.style.display = "none";
}

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
