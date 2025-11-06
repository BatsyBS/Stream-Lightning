// Broadcaster JavaScript for Stream Lightning
// Handles screen sharing, WebRTC connections, and real-time communication

const socket = io();
let localStream = null;
let peerConnections = {};
let roomId = null;
let username = null;
let isStreaming = false;
let latencyInterval = null;
let latencyValues = [];

// ICE Server configuration for better connectivity
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    // Get room ID from URL
    const pathParts = window.location.pathname.split('/');
    roomId = pathParts[pathParts.length - 1];
    
    // Get username from URL params
    const urlParams = new URLSearchParams(window.location.search);
    username = urlParams.get('name') || 'Broadcaster';
    
    document.getElementById('roomName').textContent = roomId;
    
    // Connect to server
    socket.emit('create_room', { room_id: roomId });
    
    // Setup screen capture preview
    setupScreenPreview();
});

// Setup screen capture preview
async function setupScreenPreview() {
    try {
        // Request screen capture with audio
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        // Display local preview
        document.getElementById('localVideo').srcObject = localStream;
        
        // Handle stream end (user stops sharing)
        localStream.getVideoTracks()[0].addEventListener('ended', () => {
            if (isStreaming) {
                stopStreaming();
            }
        });
        
        console.log('Screen capture initialized');
    } catch (err) {
        console.error('Error accessing screen:', err);
        alert('Failed to access screen. Please allow screen sharing permission and try again.');
    }
}

// Start streaming
async function startStreaming() {
    if (isStreaming) return;
    
    if (!localStream) {
        await setupScreenPreview();
        if (!localStream) return;
    }
    
    isStreaming = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('streamStatus').textContent = 'LIVE';
    
    socket.emit('start_stream', { room_id: roomId });
    
    // Start latency monitoring
    startLatencyMonitoring();
    
    console.log('Streaming started');
}

// Stop streaming
function stopStreaming() {
    if (!isStreaming) return;
    
    isStreaming = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('streamStatus').textContent = 'STOPPED';
    
    // Close all peer connections
    Object.keys(peerConnections).forEach(viewerId => {
        if (peerConnections[viewerId]) {
            peerConnections[viewerId].close();
        }
    });
    peerConnections = {};
    
    // Stop latency monitoring
    if (latencyInterval) {
        clearInterval(latencyInterval);
    }
    
    socket.emit('stop_stream', { room_id: roomId });
    
    console.log('Streaming stopped');
}

// Socket event handlers
socket.on('viewer_joined', async (data) => {
    console.log('Viewer joined:', data.viewer_id);
    document.getElementById('viewerCount').textContent = data.viewer_count;
    
    // Update viewers list
    updateViewersList();
    
    // Add chat notification
    addChatMessage('System', `${data.username} joined the stream`, true);
    
    if (isStreaming && localStream) {
        // Create peer connection for new viewer
        await createPeerConnection(data.viewer_id);
    }
});

socket.on('viewer_left', (data) => {
    console.log('Viewer left:', data.viewer_id);
    document.getElementById('viewerCount').textContent = data.viewer_count;
    
    // Close peer connection
    if (peerConnections[data.viewer_id]) {
        peerConnections[data.viewer_id].close();
        delete peerConnections[data.viewer_id];
    }
    
    updateViewersList();
});

socket.on('answer', async (data) => {
    const pc = peerConnections[data.sender_id];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Answer set for viewer:', data.sender_id);
    }
});

socket.on('ice_candidate', async (data) => {
    const pc = peerConnections[data.sender_id];
    if (pc && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('chat_message', (data) => {
    addChatMessage(data.username, data.message, false, data.timestamp);
});

socket.on('latency_pong', (data) => {
    const latency = Date.now() - data.timestamp;
    updateLatencyDisplay(latency);
});

// Create peer connection for a viewer
async function createPeerConnection(viewerId) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[viewerId] = pc;
    
    // Add local stream tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target_id: viewerId,
                candidate: event.candidate
            });
        }
    };
    
    // Monitor connection state
    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${viewerId}:`, pc.connectionState);
        updateConnectionInfo();
    };
    
    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
        room_id: roomId,
        target_id: viewerId,
        offer: offer
    });
    
    console.log('Offer sent to viewer:', viewerId);
}

// Chat functionality
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('chat_message', {
            room_id: roomId,
            username: username,
            message: message
        });
        input.value = '';
    }
}

function handleChatKeypress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function addChatMessage(user, message, isSystem = false, timestamp = null) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (isSystem) {
        messageDiv.style.background = 'rgba(102, 126, 234, 0.2)';
    }
    
    const time = timestamp || new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <div class="message-user">${user}<span class="message-time">${time}</span></div>
        <div>${message}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Latency monitoring
function startLatencyMonitoring() {
    latencyInterval = setInterval(() => {
        socket.emit('latency_ping', { timestamp: Date.now() });
    }, 2000);
}

function updateLatencyDisplay(latency) {
    latencyValues.push(latency);
    if (latencyValues.length > 10) {
        latencyValues.shift();
    }
    
    const avgLatency = Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length);
    
    const displayElement = document.getElementById('latencyDisplay');
    displayElement.textContent = `${avgLatency}`;
    
    const avgElement = document.getElementById('avgLatency');
    avgElement.textContent = `${avgLatency} ms`;
    
    // Color code based on latency
    if (avgLatency < 100) {
        avgElement.className = 'latency-good';
    } else if (avgLatency < 250) {
        avgElement.className = 'latency-medium';
    } else {
        avgElement.className = 'latency-bad';
    }
}

// Tab switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.style.display = 'none';
    });
    
    if (tabName === 'chat') {
        document.getElementById('chatTab').style.display = 'block';
    } else if (tabName === 'viewers') {
        document.getElementById('viewersTab').style.display = 'block';
        updateViewersList();
    } else if (tabName === 'stats') {
        document.getElementById('statsTab').style.display = 'block';
        updateConnectionInfo();
    }
}

function updateViewersList() {
    const viewersList = document.getElementById('viewersList');
    const viewerIds = Object.keys(peerConnections);
    
    if (viewerIds.length === 0) {
        viewersList.innerHTML = '<div class="placeholder">No viewers yet</div>';
        return;
    }
    
    viewersList.innerHTML = '';
    viewerIds.forEach(viewerId => {
        const pc = peerConnections[viewerId];
        const state = pc ? pc.connectionState : 'unknown';
        
        const viewerItem = document.createElement('div');
        viewerItem.className = 'viewer-item';
        viewerItem.innerHTML = `
            <div class="viewer-name">Viewer ${viewerId.substring(0, 8)}</div>
            <div class="viewer-status">${state}</div>
        `;
        viewersList.appendChild(viewerItem);
    });
}

function updateConnectionInfo() {
    const infoDiv = document.getElementById('connectionInfo');
    const activeConnections = Object.keys(peerConnections).length;
    
    infoDiv.innerHTML = `
        Active Connections: ${activeConnections}<br>
        Room ID: ${roomId}<br>
        Stream Status: ${isStreaming ? 'Active' : 'Inactive'}<br>
        Resolution: ${localStream ? `${localStream.getVideoTracks()[0].getSettings().width}x${localStream.getVideoTracks()[0].getSettings().height}` : 'N/A'}
    `;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (isStreaming) {
        stopStreaming();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});