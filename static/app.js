const $ = (id) => document.getElementById(id);
let activeView = "overview";
let cameraStream = null;
let registerStream = null;
let recognitionTimer = null;
let busy = false;
let samples = [];
let pendingDeleteId = null;
let lastResults = [];

function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = "toast" + (error ? " error" : "");
  node.textContent = message;
  $("toastArea").appendChild(node);
  setTimeout(() => node.remove(), 4200);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {"Content-Type": "application/json", ...(options.headers || {})},
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "Request failed.");
  return data;
}
function go(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  const titles = {overview:"Overview", recognition:"Live recognition", people:"People registry", activity:"Activity log"};
  $("pageTitle").textContent = titles[view] || "Overview";
  if (view === "overview") refreshDashboard();
  if (view === "people") refreshPeople();
  if (view === "activity") refreshEvents();
}
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
$("refreshBtn").addEventListener("click", refreshDashboard);
$("refreshEvents").addEventListener("click", refreshEvents);
$("openRegister").addEventListener("click", () => {$("registerCard").classList.add("open"); $("personName").focus();});
$("closeRegister").addEventListener("click", () => {$("registerCard").classList.remove("open");});
$("trainBtn").addEventListener("click", async () => {
  try { const d = await api("/api/train", {method:"POST", body:"{}"}); toast(d.message); await refreshDashboard(); }
  catch(e) { toast(e.message, true); }
});
$("startCamera").addEventListener("click", startCamera);
$("stopCamera").addEventListener("click", stopCamera);
$("startRegisterCamera").addEventListener("click", startRegisterCamera);
$("captureSample").addEventListener("click", captureSample);
$("savePerson").addEventListener("click", savePerson);
$("exportBtn").addEventListener("click", exportCsv);
$("cancelDelete").addEventListener("click", () => $("confirmBackdrop").classList.remove("open"));
$("confirmDelete").addEventListener("click", deletePerson);

async function refreshDashboard() {
  try {
    const [s, events] = await Promise.all([api("/api/status"), api("/api/events?limit=5")]);
    $("peopleCount").textContent = s.people;
    $("todayCount").textContent = s.today_recognitions;
    $("eventCount").textContent = s.events;
    $("modelStatus").textContent = s.model_ready ? "Ready" : "Not trained";
    $("modelHint").textContent = s.model_ready ? "Registered faces loaded" : "Register a person to train";
    $("sideStatus").textContent = s.recognition_available ? "Backend connected" : "LBPH module missing";
    $("recentEvents").innerHTML = events.length ? events.map(recentRow).join("") : '<div class="empty-state">No activity recorded yet.</div>';
  } catch(e) {
    $("sideStatus").textContent = "Backend unavailable";
    toast("Could not connect to the backend. Is app.py running?", true);
  }
}
function recentRow(e) {
  const good = e.status === "Recognized";
  return `<div class="recent-row"><div class="recent-avatar">${escapeHtml(initials(e.person_name))}</div><div class="recent-info"><b>${escapeHtml(e.person_name)}</b><small>${escapeHtml(e.event_time)}</small></div><span class="badge ${good?"good":"unknown"}">${escapeHtml(e.status)}</span></div>`;
}
async function refreshPeople() {
  try {
    const people = await api("/api/people");
    $("registrySub").textContent = `${people.length} enrolled ${people.length===1?"identity":"identities"} in this local system.`;
    if (!people.length) {
      $("peopleTable").innerHTML = '<div class="empty-state">No people registered yet. Use “Register person” to enroll your first participant.</div>';
      return;
    }
    $("peopleTable").innerHTML = `<table class="data-table"><thead><tr><th>PERSON</th><th>ENROLLED</th><th>EVENTS</th><th>ACTION</th></tr></thead><tbody>${people.map(p=>`<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(p.name))}</span>${escapeHtml(p.name)}</div></td><td>${escapeHtml(p.created_at)}</td><td>${p.recognition_count}</td><td><button class="delete-btn" data-delete="${p.id}" data-name="${escapeHtml(p.name)}">Remove</button></td></tr>`).join("")}</tbody></table>`;
    document.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => {
      pendingDeleteId = Number(b.dataset.delete); $("confirmBackdrop").classList.add("open");
    }));
  } catch(e) { toast(e.message, true); }
}
async function refreshEvents() {
  try {
    const events = await api("/api/events?limit=250");
    if (!events.length) {$("eventsTable").innerHTML='<div class="empty-state">No events yet. Start live recognition to create the first event.</div>';return;}
    $("eventsTable").innerHTML = `<table class="data-table"><thead><tr><th>PERSON</th><th>STATUS</th><th>DISTANCE</th><th>DATE & TIME</th></tr></thead><tbody>${events.map(e=>`<tr><td>${escapeHtml(e.person_name)}</td><td><span class="badge ${e.status==="Recognized"?"good":"unknown"}">${escapeHtml(e.status)}</span></td><td>${e.confidence==null?"—":Number(e.confidence).toFixed(1)}</td><td>${escapeHtml(e.event_time)}</td></tr>`).join("")}</tbody></table>`;
  } catch(e) { toast(e.message, true); }
}
async function deletePerson() {
  if (!pendingDeleteId) return;
  try {
    const d = await api("/api/people/delete", {method:"POST", body:JSON.stringify({id:pendingDeleteId})});
    toast(d.message); $("confirmBackdrop").classList.remove("open"); pendingDeleteId = null;
    await refreshPeople(); await refreshDashboard();
  } catch(e) { toast(e.message, true); }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function initials(name) {return String(name||"?").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {toast("Camera access is not available in this browser.", true);return;}
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
    const video = $("video"); video.srcObject = cameraStream; video.style.display="block"; $("cameraPlaceholder").style.display="none";
    $("feedBadge").style.display="block"; $("cameraLabel").textContent="CAMERA ACTIVE"; $("cameraHelp").textContent="Scanning every few moments…";
    $("startCamera").disabled=true; $("stopCamera").disabled=false;
    await video.play();
    recognitionTimer = setInterval(processFrame, 550);
  } catch(e) {toast("Could not start camera. Check browser permission and close other camera apps.", true);}
}
function stopCamera() {
  if (recognitionTimer) clearInterval(recognitionTimer);
  recognitionTimer=null; busy=false;
  if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop());
  cameraStream=null;
  $("video").srcObject=null; $("video").style.display="none"; $("cameraPlaceholder").style.display="flex";
  $("overlay").getContext("2d").clearRect(0,0,$("overlay").width,$("overlay").height);
  $("feedBadge").style.display="none"; $("cameraLabel").textContent="CAMERA OFF"; $("cameraHelp").textContent="Camera is currently off.";
  $("startCamera").disabled=false; $("stopCamera").disabled=true;
}
async function processFrame() {
  if (busy || !cameraStream || $("video").readyState < 2) return;
  busy=true;
  try {
    const video=$("video"), canvas=document.createElement("canvas");
    const scale=Math.min(1,640/video.videoWidth);
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
    const data=await api("/api/recognize",{method:"POST",body:JSON.stringify({image:canvas.toDataURL("image/jpeg",.72)})});
    drawOverlay(data.faces,canvas.width,canvas.height);
    renderDetections(data.faces);
    $("faceCount").textContent=`${data.face_count} ${data.face_count===1?"face":"faces"}`;
    if (!data.model_ready) $("cameraHelp").textContent="Face detection is active; register a person for recognition.";
    else $("cameraHelp").textContent="Recognition active · local processing";
  } catch(e) { $("cameraHelp").textContent=e.message; }
  finally {busy=false;}
}
function drawOverlay(faces,w,h) {
  const canvas=$("overlay"), video=$("video"), rect=video.getBoundingClientRect();
  if (!w||!h) return;
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const ctx=canvas.getContext("2d");
  // Coordinates are scaled to original video dimensions. Canvas is mirrored with video via CSS.
  const sx=canvas.width/w,sy=canvas.height/h;
  faces.forEach(f=>{
    const x=f.x*sx,y=f.y*sy,fw=f.w*sx,fh=f.h*sy;
    ctx.strokeStyle=f.status==="Recognized"?"#46e0aa":"#ffba69";ctx.lineWidth=3;ctx.strokeRect(x,y,fw,fh);
    const label=`${f.name} · ${f.status}`;
    ctx.font="bold 16px sans-serif";const tw=ctx.measureText(label).width;
    ctx.fillStyle=f.status==="Recognized"?"#168b69":"#a76625";ctx.fillRect(x,y-28,tw+16,27);
    ctx.fillStyle="#fff";ctx.fillText(label,x+8,y-10);
  });
}
function renderDetections(faces) {
  if (!faces.length) {$("detectionResults").innerHTML='<div class="empty-illustration">◎</div><b>No face detected</b><p>Face the camera and try better, even lighting.</p>';return;}
  $("detectionResults").innerHTML=faces.map(f=>`<div class="detection-item"><span class="det-icon">◎</span><div style="flex:1"><b>${escapeHtml(f.name)}</b><small>${f.status==="Recognized"?"Matched enrolled identity":"No confident match"}</small></div><span class="badge ${f.status==="Recognized"?"good":"unknown"}">${escapeHtml(f.status)}</span></div>`).join("");
}
async function startRegisterCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {toast("Camera access is not available.",true);return;}
  try {
    registerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
    $("registerVideo").srcObject=registerStream;$("registerVideo").style.display="block";$("registerPlaceholder").style.display="none";
    await $("registerVideo").play();$("captureSample").disabled=false;$("startRegisterCamera").textContent="Camera enabled";
  } catch(e) {toast("Could not enable camera. Check browser permissions.",true);}
}
function captureSample() {
  const video=$("registerVideo");
  if (!registerStream||video.readyState<2) {toast("Enable the camera first.",true);return;}
  if (samples.length>=5) {toast("You already captured 5 samples.");return;}
  const canvas=document.createElement("canvas");
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const ctx=canvas.getContext("2d");ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(video,0,0);
  samples.push(canvas.toDataURL("image/jpeg",.85));
  const img=document.createElement("img");img.src=samples[samples.length-1];img.alt="Face sample";$("sampleThumbs").appendChild(img);
  $("sampleCount").textContent=`${samples.length} / 5 samples`;
  $("sampleProgress").style.width=`${samples.length*20}%`;
  $("savePerson").disabled=samples.length<1;
  if (samples.length>=5) {$("captureSample").disabled=true;toast("Five samples captured. You can save this person.");}
}
async function savePerson() {
  const name=$("personName").value.trim();
  if (!name) {toast("Enter a person's name first.",true);$("personName").focus();return;}
  if (!samples.length) {toast("Capture at least one sample.",true);return;}
  $("savePerson").disabled=true;$("savePerson").textContent="Saving & training…";
  try {
    const d=await api("/api/register",{method:"POST",body:JSON.stringify({name,images:samples})});
    toast(d.message);
    samples=[];$("sampleThumbs").innerHTML="";$("personName").value="";$("sampleCount").textContent="0 / 5 samples";$("sampleProgress").style.width="0%";
    $("captureSample").disabled=!registerStream;$("savePerson").disabled=true;$("savePerson").textContent="Save person & train model";
    await refreshPeople();await refreshDashboard();
  } catch(e) {toast(e.message,true);$("savePerson").disabled=false;$("savePerson").textContent="Save person & train model";}
}
function exportCsv() {
  api("/api/events?limit=500").then(events=>{
    const rows=[["Person","Status","LBPH distance","Date & time"],...events.map(e=>[e.person_name,e.status,e.confidence??"",e.event_time])];
    const csv=rows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="visionid_activity_log.csv";a.click();URL.revokeObjectURL(url);
  }).catch(e=>toast(e.message,true));
}
window.addEventListener("beforeunload",()=>{stopCamera();if(registerStream)registerStream.getTracks().forEach(t=>t.stop());});
refreshDashboard();
