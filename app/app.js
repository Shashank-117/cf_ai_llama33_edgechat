const API_BASE = localStorage.getItem("API_BASE") || (location.origin.includes(".pages.dev") ? "https://"+location.host.replace(".pages.dev", ".workers.dev") : location.origin);
document.getElementById("apiBase").textContent = API_BASE;

const chatEl = document.getElementById("chat");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const roomIdEl = document.getElementById("roomId");
const modelEl = document.getElementById("model");
const clearBtn = document.getElementById("clearBtn");

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const roomId = roomIdEl.value || "demo";
  const model = modelEl.value;
  input.value = "";
  addMsg("user", text);
  const btn = form.querySelector("button"); btn.disabled = true;

  try {
    const res = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, text, model })
    });
    const data = await res.json();
    addMsg("assistant", data.text || "(no response)");
  } catch (e) {
    addMsg("system", "Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

// Voice: send audio file to /api/voice
document.getElementById("sendAudio").addEventListener("click", async () => {
  const fileInput = document.getElementById("audioFile");
  if (!fileInput.files?.length) {
    alert("Please choose a short audio recording first.");
    return;
  }
  const roomId = roomIdEl.value || "demo";
  const model = modelEl.value;
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("roomId", roomId);
  fd.append("model", model);
  const player = document.getElementById("player");
  try {
    const res = await fetch(API_BASE + "/api/voice", { method: "POST", body: fd });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const transcript = decodeURIComponent(res.headers.get("X-Transcript") || "");
    const answer = decodeURIComponent(res.headers.get("X-Answer-Text") || "");
    if (transcript) addMsg("user", transcript);
    if (answer) addMsg("assistant", answer);
    player.src = url;
    player.play().catch(()=>{});
  } catch (e) {
    addMsg("system", "Voice error: " + e.message);
  }
});

clearBtn.addEventListener("click", () => {
  chatEl.innerHTML = "";
  localStorage.clear();
  addMsg("system", "Cleared local chat view. (Server memory persists until you change roomId.)");
});
