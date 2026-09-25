const socket = io(); 

const dropZone = document.getElementById('dropZone');
const browseBtn = document.getElementById('browseBtn');
const fileInput = document.getElementById('fileInput');
const transferStatus = document.getElementById('transferStatus');
const fileNameDisplay = document.getElementById('fileName');
const fileSizeDisplay = document.getElementById('fileSize');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const linkContainer = document.getElementById('linkContainer');
const shareLinkInput = document.getElementById('shareLink');
const copyBtn = document.getElementById('copyBtn');

let selectedFile = null;
let peerConnection;
let dataChannel;
let isSender = false;

const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');

if (!roomId) {
    isSender = true;
    roomId = Math.random().toString(36).substring(2, 8); 
    window.history.replaceState('', '', '?room=' + roomId);
    shareLinkInput.value = window.location.href;
    linkContainer.classList.remove('hidden');
}

socket.emit('join-room', roomId);

copyBtn.addEventListener('click', () => {
    shareLinkInput.select();
    document.execCommand('copy');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
});

if (isSender) {
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#8b5cf6';
    });
    dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = 'rgba(255, 255, 255, 0.2)');
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
} else {
    dropZone.innerHTML = `<h2>Ready to receive file</h2><p>Waiting for sender...</p>`;
}

function handleFile(file) {
    if (!file) return;
    selectedFile = file;
    dropZone.classList.add('hidden');
    linkContainer.classList.add('hidden'); 
    transferStatus.classList.remove('hidden');
    
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);
    statusText.textContent = "Waiting for receiver to join...";
}

const configuration = { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] };

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { roomId, candidate: event.candidate });
        }
    };

    peerConnection.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        receiveChannel.binaryType = "arraybuffer";
        
        let receivedBuffers = [];
        let receivedSize = 0;

        dropZone.classList.add('hidden');
        transferStatus.classList.remove('hidden');
        statusText.textContent = "Receiving file...";

        receiveChannel.onmessage = (e) => {
            receivedBuffers.push(e.data);
            receivedSize += e.data.byteLength;
            
            if (e.data.byteLength < 64000) { 
                saveReceivedFile(receivedBuffers);
            }
        };
    };
}

socket.on('user-joined', async () => {
    if (isSender && selectedFile) {
        statusText.textContent = "Receiver joined! Connecting...";
        createPeerConnection();

        dataChannel = peerConnection.createDataChannel("fileTransfer");
        dataChannel.binaryType = "arraybuffer";
        
        dataChannel.onopen = () => {
            statusText.textContent = "Connected! Sending...";
            sendFileInChunks(selectedFile);
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId, offer });
    }
});

socket.on('offer', async (offer) => {
    if (!isSender) {
        createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { roomId, answer });
    }
});

socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error('Error adding received ice candidate', e);
    }
});

function sendFileInChunks(file) {
    const chunkSize = 64 * 1024; 
    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;

        const progress = (offset / file.size) * 100;
        progressBar.style.width = progress + '%';
        
        if (offset < file.size) {
            readSlice(offset);
        } else {
            statusText.textContent = "File Sent Successfully!";
            progressBar.style.background = "#22c55e";
        }
    };

    const readSlice = (o) => {
        const slice = file.slice(offset, o + chunkSize);
        reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
}

function saveReceivedFile(buffers) {
    const blob = new Blob(buffers);
    const downloadUrl = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = "VayuDrop_File"; 
    document.body.appendChild(a);
    a.click();
    
    statusText.textContent = "File Downloaded!";
    progressBar.style.width = '100%';
    progressBar.style.background = "#22c55e";
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
