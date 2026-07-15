/* ============================================================
   รักและใส่ใจ ER JNH  —  main application
   ============================================================ */

/* ---------- Init Firebase ---------- */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// secondary app -> ให้ admin สร้างผู้ใช้ได้โดยไม่ถูกเด้งออกจากระบบ
let secondaryApp = null;
function getSecondaryAuth() {
  if (!secondaryApp) secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");
  return secondaryApp.auth();
}

/* ---------- App state ---------- */
const State = {
  user: null,        // firebase auth user
  profile: null,     // users/{uid} doc
  activeTab: "home",
};

const SHIFT_LABEL = { morning: "เช้า (08:00–16:00)", afternoon: "บ่าย (16:00–00:00)", night: "ดึก (00:00–08:00)" };
const SHIFT_SHORT = { morning: "เช้า", afternoon: "บ่าย", night: "ดึก" };
const FLAG_THRESHOLD = 5;
const APPRECIATE_MAX = 2;

/* ============================================================
   Helpers
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (name) => (name || "?").trim().charAt(0).toUpperCase();

function toast(msg, type = "") {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 3000);
}

function genBarcodeId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "ER" + s;
}

/* shift classification for a JS Date */
function classifyShift(d) {
  const h = d.getHours();
  if (h >= 8 && h < 16) return "morning";
  if (h >= 16) return "afternoon";
  return "night";
}
function shiftKeyFor(d) { return `${ymd(d)}_${classifyShift(d)}`; }

/* shifts that can be acted on now (current + ended within last 3h) */
function getSelectableShifts(now = new Date()) {
  const slots = [];
  const seen = new Set();
  for (const off of [0, -1]) {
    const base = new Date(now);
    base.setDate(base.getDate() + off);
    const y = base.getFullYear(), m = base.getMonth(), da = base.getDate();
    const defs = [
      { shift: "morning", start: new Date(y, m, da, 8, 0), end: new Date(y, m, da, 16, 0) },
      { shift: "afternoon", start: new Date(y, m, da, 16, 0), end: new Date(y, m, da + 1, 0, 0) },
      { shift: "night", start: new Date(y, m, da, 0, 0), end: new Date(y, m, da, 8, 0) },
    ];
    for (const def of defs) {
      const deadline = new Date(def.end.getTime() + 3 * 3600 * 1000);
      if (now >= def.start && now <= deadline) {
        const key = `${ymd(def.start)}_${def.shift}`;
        if (seen.has(key)) continue;
        seen.add(key);
        slots.push({
          key, date: ymd(def.start), shift: def.shift,
          start: def.start, end: def.end, deadline,
          isCurrent: now >= def.start && now <= def.end,
        });
      }
    }
  }
  slots.sort((a, b) => b.start - a.start);
  return slots;
}
function currentShift(now = new Date()) {
  const a = assignShift(now);
  return { key: a.key, date: a.date, shift: a.shift, isCurrent: true };
}

/* ---------- Shift assignment with early(20m) + late(10m) rules ---------- */
const EARLY_MS = 20 * 60 * 1000;   // มาก่อนได้ 20 นาที -> ลงเวรถัดไป
const LATE_MIN = 10;               // สายเกิน 10 นาที -> บันทึกว่าสาย
function shiftEvents(now) {
  const evs = [];
  for (const off of [-1, 0, 1]) {
    const b = new Date(now); b.setDate(b.getDate() + off);
    const y = b.getFullYear(), m = b.getMonth(), d = b.getDate();
    evs.push({ shift: "night", start: new Date(y, m, d, 0, 0) });
    evs.push({ shift: "morning", start: new Date(y, m, d, 8, 0) });
    evs.push({ shift: "afternoon", start: new Date(y, m, d, 16, 0) });
  }
  evs.forEach((e) => {
    e.end = new Date(e.start.getTime() + 8 * 3600 * 1000);
    e.date = ymd(e.start); e.key = `${e.date}_${e.shift}`;
  });
  return evs.sort((a, b) => a.start - b.start);
}
function assignShift(now = new Date()) {
  const evs = shiftEvents(now);
  // 1) มาก่อนเวลาเวรถัดไปไม่เกิน 20 นาที -> ลงเวรถัดไป (ไม่ถือว่าสาย)
  for (const e of evs) {
    if (now < e.start && e.start - now <= EARLY_MS)
      return { ...e, lateMinutes: 0, late: false, early: true };
  }
  // 2) เวรที่กำลังดำเนินอยู่
  for (const e of evs) {
    if (now >= e.start && now < e.end) {
      const lm = Math.floor((now - e.start) / 60000);
      return { ...e, lateMinutes: lm, late: lm > LATE_MIN, early: false };
    }
  }
  const e = [...evs].reverse().find((x) => now >= x.start) || evs[0];
  const lm = Math.max(0, Math.floor((now - e.start) / 60000));
  return { ...e, lateMinutes: lm, late: lm > LATE_MIN, early: false };
}

/* ============================================================
   Rendering root
   ============================================================ */
const app = el("app");

function render() {
  if (!State.user || !State.profile) { renderAuth(); return; }
  if (State.profile.role === "station") { renderStationRedirect(); return; }
  renderShell();
}

function renderStationRedirect() {
  app.innerHTML = `
  <div class="auth-wrap"><div class="auth-card card" style="text-align:center">
    <div class="auth-logo"><div class="heart">📷</div>
      <h1>บัญชีเครื่องสแกน</h1>
      <p>บัญชีนี้ใช้สำหรับ "หน้าสแกนเข้าเวร" ที่ ER เท่านั้น</p></div>
    <a class="btn btn-teal btn-block" href="scan.html">ไปหน้าสแกนเข้าเวร →</a>
    <button class="btn btn-outline btn-block" id="st-logout" style="margin-top:10px">ออกจากระบบ</button>
  </div></div>`;
  el("st-logout").onclick = logout;
}

/* ---------- Auth screens ---------- */
let authMode = "login";
function renderAuth() {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card card">
      <div class="auth-logo">
        <div class="heart">💗</div>
        <h1>รักและใส่ใจ ER JNH</h1>
        <p>ระบบประเมินการทำงานเพื่อนร่วมงาน</p>
      </div>
      <div id="authForm"></div>
      <div class="auth-switch" id="authSwitch"></div>
    </div>
  </div>`;
  renderAuthForm();
}

function renderAuthForm() {
  const form = el("authForm");
  const sw = el("authSwitch");
  if (authMode === "login") {
    form.innerHTML = `
      <div class="field"><label>รหัสผู้ใช้ (username)</label>
        <input id="li-user" autocomplete="username" placeholder="เช่น pettoo" /></div>
      <div class="field"><label>รหัสผ่าน</label>
        <input id="li-pass" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" /></div>
      <button class="btn btn-primary btn-block" id="li-btn">เข้าสู่ระบบ</button>`;
    sw.innerHTML = `ยังไม่มีบัญชี? <a id="to-register">สมัครสมาชิก</a>`;
    el("li-btn").onclick = doLogin;
    el("li-pass").addEventListener("keydown", (e) => e.key === "Enter" && doLogin());
    el("to-register").onclick = () => { authMode = "register"; renderAuthForm(); };
  } else {
    form.innerHTML = `
      <div class="field"><label>ชื่อ–สกุล (ภาษาไทย)</label>
        <input id="rg-name" placeholder="เช่น สมหญิง ใจดี" /></div>
      <div class="field"><label>รหัสผู้ใช้ (username)</label>
        <input id="rg-user" autocomplete="username" placeholder="ภาษาอังกฤษ/ตัวเลข" /></div>
      <div class="field"><label>รหัสผ่าน</label>
        <input id="rg-pass" type="password" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร" /></div>
      <button class="btn btn-primary btn-block" id="rg-btn">สมัครสมาชิก & รับบาร์โค้ด</button>`;
    sw.innerHTML = `มีบัญชีแล้ว? <a id="to-login">เข้าสู่ระบบ</a>`;
    el("rg-btn").onclick = doRegister;
    el("to-login").onclick = () => { authMode = "login"; renderAuthForm(); };
  }
}

async function doLogin() {
  const u = el("li-user").value.trim().toLowerCase();
  const p = el("li-pass").value;
  if (!u || !p) return toast("กรอกรหัสผู้ใช้และรหัสผ่าน", "err");
  el("li-btn").disabled = true;
  try {
    await auth.signInWithEmailAndPassword(u + "@" + EMAIL_DOMAIN, p);
    // auth listener จะโหลดโปรไฟล์ต่อ
  } catch (e) {
    el("li-btn").disabled = false;
    toast("เข้าสู่ระบบไม่สำเร็จ: " + friendlyErr(e), "err");
  }
}

async function doRegister() {
  const name = el("rg-name").value.trim();
  const u = el("rg-user").value.trim().toLowerCase();
  const p = el("rg-pass").value;
  if (!name) return toast("กรุณากรอกชื่อ–สกุล", "err");
  if (!/^[a-z0-9._-]{3,}$/.test(u)) return toast("username ใช้ a-z, 0-9, . _ - อย่างน้อย 3 ตัว", "err");
  if (p.length < 6) return toast("รหัสผ่านอย่างน้อย 6 ตัวอักษร", "err");
  el("rg-btn").disabled = true;
  try {
    const cred = await auth.createUserWithEmailAndPassword(u + "@" + EMAIL_DOMAIN, p);
    const role = u === SUPERADMIN_USERNAME ? "superadmin" : "member";
    await db.collection("users").doc(cred.user.uid).set({
      username: u, fullName: name, role,
      barcodeId: genBarcodeId(), disabled: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("สมัครสำเร็จ! ยินดีต้อนรับ 💗", "ok");
  } catch (e) {
    el("rg-btn").disabled = false;
    toast("สมัครไม่สำเร็จ: " + friendlyErr(e), "err");
  }
}

function friendlyErr(e) {
  const m = (e && e.code) || "";
  if (m.includes("wrong-password") || m.includes("invalid-credential")) return "รหัสผ่านไม่ถูกต้อง";
  if (m.includes("user-not-found")) return "ไม่พบบัญชีนี้";
  if (m.includes("email-already-in-use")) return "username นี้ถูกใช้แล้ว";
  if (m.includes("network")) return "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต";
  return (e && e.message) || "เกิดข้อผิดพลาด";
}

/* ---------- Auth state ---------- */
auth.onAuthStateChanged(async (user) => {
  if (!user) { State.user = null; State.profile = null; render(); return; }
  try {
    const snap = await db.collection("users").doc(user.uid).get();
    if (!snap.exists) { await auth.signOut(); toast("ไม่พบข้อมูลผู้ใช้", "err"); return; }
    const profile = { id: user.uid, ...snap.data() };
    if (profile.disabled) { await auth.signOut(); toast("บัญชีนี้ถูกระงับการใช้งาน", "err"); return; }
    State.user = user; State.profile = profile;
    render();
    writePresence();
  } catch (e) {
    toast("โหลดข้อมูลผิดพลาด: " + friendlyErr(e), "err");
  }
});

// บันทึกว่าผู้ใช้ล็อกอินอยู่ในเวรใด (ช่วงต่อเวรจะเป็นเวรถัดไป) เพื่อให้เห็นสมาชิกเวรถัดไปที่ล็อกอินแล้ว
async function writePresence() {
  if (!State.profile || State.profile.role === "station") return;
  const cur = currentShift();
  try {
    await db.collection("presence").doc(`${State.user.uid}_${cur.key}`).set({
      uid: State.user.uid, fullName: State.profile.fullName, role: State.profile.role,
      shiftKey: cur.key, date: cur.date, shift: cur.shift,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {}
}

async function logout() { await auth.signOut(); toast("ออกจากระบบแล้ว"); }

/* ============================================================
   App shell + tabs
   ============================================================ */
function tabsForRole(role) {
  const base = [
    { id: "home", label: "หน้าหลัก" },
    { id: "report", label: "รายงาน" },
    { id: "praise", label: "ชื่นชม" },
    { id: "satisfaction", label: "พึงพอใจเวร" },
  ];
  if (role === "member") return base;
  // admin & superadmin
  base.push({ id: "dashboard", label: "Dashboard" });
  base.push({ id: "users", label: "จัดการผู้ใช้" });
  if (role === "superadmin") base.push({ id: "reports", label: "รายงานรายบุคคล" });
  base.push({ id: "barcodes", label: "บาร์โค้ดทุกคน" });
  return base;
}

function renderShell() {
  const p = State.profile;
  const tabs = tabsForRole(p.role);
  if (!tabs.find((t) => t.id === State.activeTab)) State.activeTab = "home";
  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <div class="brand"><span class="heart">💗</span><span class="full">รักและใส่ใจ ER JNH</span></div>
        <div class="user-chip">
          <span>${esc(p.fullName)}</span>
          <span class="role-tag">${roleLabel(p.role)}</span>
          <span style="cursor:pointer" id="logoutBtn" title="ออกจากระบบ">⎋</span>
        </div>
      </div>
      <div class="container">
        <div class="tabbar" id="tabbar">
          ${tabs.map((t) => `<button data-tab="${t.id}" class="${t.id === State.activeTab ? "active" : ""}">${t.label}</button>`).join("")}
        </div>
        <div id="view"></div>
      </div>
    </div>`;
  el("logoutBtn").onclick = logout;
  el("tabbar").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { State.activeTab = b.dataset.tab; renderShell(); };
  });
  renderView();
}

function roleLabel(r) {
  return r === "superadmin" ? "แอดมินใหญ่" : r === "admin" ? "แอดมินร่วม" : r === "station" ? "เครื่องสแกน" : "สมาชิก";
}

function renderView() {
  const v = el("view");
  v.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  switch (State.activeTab) {
    case "home": return viewHome(v);
    case "checkin": return viewCheckin(v);
    case "report": return viewReport(v);
    case "praise": return viewPraise(v);
    case "satisfaction": return viewSatisfaction(v);
    case "dashboard": return viewDashboard(v);
    case "users": return viewUsers(v);
    case "reports": return viewPersonReports(v);
    case "barcodes": return viewBarcodes(v);
  }
}

/* barcode block for current user (shown on top of home) */
function myBarcodeHTML() {
  const p = State.profile;
  return `
    <div class="card mybarcode" id="myBarcodeCard">
      <div class="name">${esc(p.fullName)}</div>
      <svg id="myBarcodeSvg"></svg>
      <div class="code">รหัสบาร์โค้ด: ${esc(p.barcodeId)}</div>
      <div class="code" style="margin-top:6px;color:var(--teal)">แสดงบาร์โค้ดนี้ที่เครื่องสแกนหน้างาน ER เพื่อลงเวร</div>
    </div>`;
}
function drawMyBarcode() {
  try {
    JsBarcode("#myBarcodeSvg", State.profile.barcodeId, {
      format: "CODE128", width: 2.2, height: 70, displayValue: false, margin: 6,
    });
  } catch (e) {}
}

/* ============================================================
   HOME — barcode + coworkers this shift
   ============================================================ */
async function viewHome(v) {
  const cur = currentShift();
  v.innerHTML = myBarcodeHTML() + `
    <div class="card">
      <div class="section-title">👥 เพื่อนร่วมเวรปัจจุบัน</div>
      <div class="sub">เวร${SHIFT_SHORT[cur.shift]} • ${esc(cur.date)}</div>
      <div id="coworkers" class="person-list"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  drawMyBarcode();
  const members = await getShiftMembers(cur.key);
  const box = el("coworkers");
  if (!members.length) { box.innerHTML = `<div class="empty">ยังไม่มีสมาชิกในเวรนี้<br/>สแกนบาร์โค้ดของคุณที่เครื่องสแกนหน้างาน ER เพื่อลงเวร</div>`; return; }
  box.innerHTML = members.map(personRowHTML).join("");
}

function personRowHTML(c) {
  const timeStr = c.checkedIn && c.ts ? new Date(c.ts.toDate ? c.ts.toDate() : c.ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
  const status = c.uid === State.user.uid
    ? '<span class="badge badge-shift">คุณ</span>'
    : c.checkedIn
      ? (c.late ? `<span class="badge badge-flag">สาย ${c.lateMinutes} น.</span>` : '<span class="badge badge-shift">เข้าเวรแล้ว</span>')
      : '<span class="badge badge-warn">ล็อกอินรอ</span>';
  return `<div class="person-row">
    <div class="avatar" style="${c.checkedIn ? "" : "background:var(--muted)"}">${initials(c.fullName)}</div>
    <div class="meta"><div class="n">${esc(c.fullName)}</div>
      <div class="s">${c.checkedIn ? "เข้าเวร " + timeStr : "ล็อกอินแล้ว • ยังไม่สแกนเข้าเวร"}</div></div>
    ${status}
  </div>`;
}

// รวมสมาชิกเวร: คนที่สแกนเข้าเวรแล้ว (checkins) + คนที่ล็อกอินไว้สำหรับเวรนี้ (presence)
async function getShiftMembers(shiftKey) {
  const [chk, pres] = await Promise.all([
    db.collection("checkins").where("shiftKey", "==", shiftKey).get(),
    db.collection("presence").where("shiftKey", "==", shiftKey).get(),
  ]);
  const map = {};
  pres.docs.forEach((d) => { const x = d.data(); map[x.uid] = { uid: x.uid, fullName: x.fullName, checkedIn: false, ts: null, loginTs: x.ts }; });
  chk.docs.forEach((d) => { const x = d.data(); map[x.uid] = { ...(map[x.uid] || {}), uid: x.uid, fullName: x.fullName, checkedIn: true, ts: x.ts, late: x.late, lateMinutes: x.lateMinutes }; });
  return Object.values(map).sort((a, b) => (a.checkedIn === b.checkedIn ? 0 : a.checkedIn ? -1 : 1));
}

async function getCoworkers(shiftKey) {
  const snap = await db.collection("checkins").where("shiftKey", "==", shiftKey).get();
  const list = snap.docs.map((d) => d.data());
  list.sort((a, b) => (a.ts && b.ts ? (a.ts.seconds || 0) - (b.ts.seconds || 0) : 0));
  return list;
}

/* ============================================================
   CHECK-IN — barcode scan / manual
   ============================================================ */
let html5Scanner = null;
function viewCheckin(v) {
  const cur = currentShift();
  v.innerHTML = myBarcodeHTML() + `
    <div class="card">
      <div class="section-title">📷 สแกนเข้าเวร</div>
      <div class="sub">ระบบจะบันทึกเวรตามเวลาปัจจุบัน — ขณะนี้คือ <b>เวร${SHIFT_SHORT[cur.shift]}</b> (${SHIFT_LABEL[cur.shift]})</div>
      <div id="scan-status" class="scan-status">พร้อมสแกน</div>
      <div id="scanner-region"></div>
      <div class="btn-row">
        <button class="btn btn-teal" id="startScan">เปิดกล้องสแกน</button>
        <button class="btn btn-outline" id="stopScan" style="display:none">ปิดกล้อง</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:16px 0"/>
      <div class="field"><label>หรือกรอกรหัสบาร์โค้ดด้วยมือ</label>
        <input id="manualCode" placeholder="เช่น ${esc(State.profile.barcodeId)}" /></div>
      <button class="btn btn-primary btn-block" id="manualBtn">ยืนยันเข้าเวร</button>
    </div>`;
  drawMyBarcode();
  el("startScan").onclick = startScan;
  el("stopScan").onclick = stopScan;
  el("manualBtn").onclick = () => doCheckin(el("manualCode").value.trim().toUpperCase());
}

function startScan() {
  const region = el("scanner-region");
  region.innerHTML = "";
  html5Scanner = new Html5Qrcode("scanner-region");
  const config = {
    fps: 10, qrbox: { width: 260, height: 120 },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.QR_CODE,
    ],
  };
  html5Scanner.start({ facingMode: "environment" }, config,
    (decoded) => { stopScan(); doCheckin(decoded.trim().toUpperCase()); },
    () => {}
  ).then(() => {
    el("startScan").style.display = "none";
    el("stopScan").style.display = "inline-flex";
  }).catch((e) => {
    setStatus("เปิดกล้องไม่ได้: " + (e.message || e), "err");
  });
}
function stopScan() {
  if (html5Scanner) {
    html5Scanner.stop().then(() => html5Scanner.clear()).catch(() => {});
    html5Scanner = null;
  }
  const s = el("startScan"), t = el("stopScan");
  if (s) s.style.display = "inline-flex";
  if (t) t.style.display = "none";
}
function setStatus(msg, type = "") {
  const s = el("scan-status");
  if (s) { s.textContent = msg; s.className = "scan-status " + type; }
}

async function doCheckin(code) {
  if (!code) return toast("กรุณากรอกรหัสบาร์โค้ด", "err");
  if (code !== State.profile.barcodeId) {
    setStatus("บาร์โค้ดนี้ไม่ใช่ของคุณ — ต้องสแกนบาร์โค้ดของตนเองเท่านั้น", "err");
    return toast("ต้องสแกนบาร์โค้ดของตนเองเท่านั้น", "err");
  }
  const now = new Date();
  const cur = currentShift(now);
  const docId = `${State.user.uid}_${cur.key}`;
  try {
    await db.collection("checkins").doc(docId).set({
      uid: State.user.uid, fullName: State.profile.fullName, barcodeId: State.profile.barcodeId,
      shiftKey: cur.key, date: cur.date, shift: cur.shift,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    });
    setStatus(`เข้าเวร${SHIFT_SHORT[cur.shift]}สำเร็จ ✓`, "ok");
    toast(`บันทึกเข้าเวร${SHIFT_SHORT[cur.shift]}แล้ว 💗`, "ok");
  } catch (e) {
    setStatus("บันทึกไม่สำเร็จ: " + friendlyErr(e), "err");
  }
}

/* ============================================================
   REPORT coworker
   ============================================================ */
async function viewReport(v) {
  const shifts = getSelectableShifts();
  if (!shifts.length) {
    v.innerHTML = emptyShiftCard("รายงานเพื่อนร่วมงาน");
    return;
  }
  v.innerHTML = `
    <div class="card">
      <div class="section-title">📝 รายงานเพื่อนร่วมงาน</div>
      <div class="sub">รายงานได้ 1 ครั้ง/คน/เวร • แก้ไขได้ • ย้อนหลังได้ไม่เกิน 3 ชม.หลังลงเวร</div>
      <div class="field"><label>เลือกเวร</label>
        <select id="rp-shift">${shifts.map((s) => `<option value="${s.key}">${SHIFT_SHORT[s.shift]} • ${s.date}${s.isCurrent ? " (เวรปัจจุบัน)" : " (ย้อนหลัง)"}</option>`).join("")}</select></div>
      <div id="rp-list" class="person-list"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  const load = () => loadReportList(el("rp-shift").value);
  el("rp-shift").onchange = load;
  load();
}

function emptyShiftCard(title) {
  return `<div class="card"><div class="section-title">${title}</div>
    <div class="empty">ขณะนี้ไม่มีเวรที่สามารถดำเนินการได้<br/>(ทำได้เฉพาะเวรปัจจุบัน หรือภายใน 3 ชม.หลังลงเวร)</div></div>`;
}

async function loadReportList(shiftKey) {
  const box = el("rp-list");
  box.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  const coworkers = (await getCoworkers(shiftKey)).filter((c) => c.uid !== State.user.uid);
  const existing = await getMyRecords("reports", shiftKey);
  const map = {}; existing.forEach((r) => (map[r.toUid] = r));
  if (!coworkers.length) { box.innerHTML = `<div class="empty">ยังไม่มีเพื่อนร่วมเวรคนอื่นในเวรนี้</div>`; return; }
  box.innerHTML = coworkers.map((c) => {
    const done = map[c.uid];
    return `<div class="person-row">
      <div class="avatar" style="background:var(--pink)">${initials(c.fullName)}</div>
      <div class="meta"><div class="n">${esc(c.fullName)}</div>
        <div class="s">${done ? "รายงานแล้ว: " + esc((done.detail || "").slice(0, 40)) : "ยังไม่ได้รายงาน"}</div></div>
      <div class="acts">
        <button class="btn btn-sm ${done ? "btn-outline" : "btn-primary"}" data-uid="${c.uid}" data-name="${esc(c.fullName)}">${done ? "แก้ไข" : "รายงาน"}</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("button[data-uid]").forEach((b) => {
    b.onclick = () => openReportModal(shiftKey, b.dataset.uid, b.dataset.name, map[b.dataset.uid]);
  });
}

function openReportModal(shiftKey, toUid, toName, existing) {
  showModal(`
    <h3>รายงาน: ${esc(toName)}</h3>
    <div class="field"><label>รายละเอียดที่รายงาน</label>
      <textarea id="rp-detail" placeholder="อธิบายเหตุการณ์/พฤติกรรมที่ต้องการรายงาน">${esc(existing ? existing.detail : "")}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="rp-save">บันทึกรายงาน</button>
      ${existing ? '<button class="btn btn-danger" id="rp-del">ลบรายงาน</button>' : ""}
      <button class="btn btn-outline" id="rp-cancel">ยกเลิก</button>
    </div>`);
  el("rp-cancel").onclick = closeModal;
  el("rp-save").onclick = async () => {
    const detail = el("rp-detail").value.trim();
    if (!detail) return toast("กรุณากรอกรายละเอียด", "err");
    const docId = `${State.user.uid}_${toUid}_${shiftKey}`;
    try {
      await db.collection("reports").doc(docId).set({
        fromUid: State.user.uid, fromName: State.profile.fullName,
        toUid, toName, shiftKey, ym: shiftKey.slice(0, 7),
        detail, cleared: false,
        createdAt: existing ? existing.createdAt : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      closeModal(); toast("บันทึกรายงานแล้ว", "ok");
      loadReportList(shiftKey);
    } catch (e) { toast("บันทึกไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
  if (existing) el("rp-del").onclick = async () => {
    try {
      await db.collection("reports").doc(`${State.user.uid}_${toUid}_${shiftKey}`).delete();
      closeModal(); toast("ลบรายงานแล้ว"); loadReportList(shiftKey);
    } catch (e) { toast("ลบไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
}

/* ============================================================
   PRAISE / appreciate
   ============================================================ */
async function viewPraise(v) {
  const shifts = getSelectableShifts();
  if (!shifts.length) { v.innerHTML = emptyShiftCard("ชื่นชมเพื่อนร่วมงาน"); return; }
  v.innerHTML = `
    <div class="card">
      <div class="section-title">🌟 ชื่นชมเพื่อนร่วมงาน</div>
      <div class="sub">ชื่นชมได้ 1–2 คน/เวร • ใส่เหตุผลหรือไม่ก็ได้ • ภายใน 3 ชม.หลังลงเวร</div>
      <div class="field"><label>เลือกเวร</label>
        <select id="pr-shift">${shifts.map((s) => `<option value="${s.key}">${SHIFT_SHORT[s.shift]} • ${s.date}${s.isCurrent ? " (เวรปัจจุบัน)" : " (ย้อนหลัง)"}</option>`).join("")}</select></div>
      <div id="pr-list" class="person-list"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  const load = () => loadPraiseList(el("pr-shift").value);
  el("pr-shift").onchange = load;
  load();
}

async function loadPraiseList(shiftKey) {
  const box = el("pr-list");
  box.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  const coworkers = (await getCoworkers(shiftKey)).filter((c) => c.uid !== State.user.uid);
  const mine = await getMyRecords("appreciations", shiftKey);
  const map = {}; mine.forEach((r) => (map[r.toUid] = r));
  const usedCount = mine.length;
  if (!coworkers.length) { box.innerHTML = `<div class="empty">ยังไม่มีเพื่อนร่วมเวรคนอื่นในเวรนี้</div>`; return; }
  box.innerHTML = `<div class="sub" style="margin-bottom:6px">ชื่นชมไปแล้ว ${usedCount}/${APPRECIATE_MAX} คนในเวรนี้</div>` +
    coworkers.map((c) => {
      const done = map[c.uid];
      const disabled = !done && usedCount >= APPRECIATE_MAX;
      return `<div class="person-row">
        <div class="avatar" style="background:var(--amber)">${initials(c.fullName)}</div>
        <div class="meta"><div class="n">${esc(c.fullName)}</div>
          <div class="s">${done ? "ชื่นชมแล้ว 🌟 " + esc((done.reason || "").slice(0, 40)) : "ยังไม่ได้ชื่นชม"}</div></div>
        <div class="acts">
          <button class="btn btn-sm ${done ? "btn-outline" : "btn-amber"}" data-uid="${c.uid}" data-name="${esc(c.fullName)}" ${disabled ? "disabled" : ""}>${done ? "แก้ไข" : "ชื่นชม"}</button>
        </div>
      </div>`;
    }).join("");
  box.querySelectorAll("button[data-uid]").forEach((b) => {
    b.onclick = () => openPraiseModal(shiftKey, b.dataset.uid, b.dataset.name, map[b.dataset.uid]);
  });
}

function openPraiseModal(shiftKey, toUid, toName, existing) {
  showModal(`
    <h3>ชื่นชม: ${esc(toName)} 🌟</h3>
    <div class="field"><label>เหตุผล (ไม่บังคับ)</label>
      <textarea id="pr-reason" placeholder="สิ่งดีๆ ที่อยากชื่นชม (จะเว้นว่างก็ได้)">${esc(existing ? existing.reason : "")}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-amber" id="pr-save">บันทึกคำชื่นชม</button>
      ${existing ? '<button class="btn btn-danger" id="pr-del">ลบ</button>' : ""}
      <button class="btn btn-outline" id="pr-cancel">ยกเลิก</button>
    </div>`);
  el("pr-cancel").onclick = closeModal;
  el("pr-save").onclick = async () => {
    const reason = el("pr-reason").value.trim();
    const docId = `${State.user.uid}_${toUid}_${shiftKey}`;
    try {
      await db.collection("appreciations").doc(docId).set({
        fromUid: State.user.uid, fromName: State.profile.fullName,
        toUid, toName, shiftKey, ym: shiftKey.slice(0, 7), reason,
        createdAt: existing ? existing.createdAt : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      closeModal(); toast("บันทึกคำชื่นชมแล้ว 🌟", "ok");
      loadPraiseList(shiftKey);
    } catch (e) { toast("บันทึกไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
  if (existing) el("pr-del").onclick = async () => {
    try {
      await db.collection("appreciations").doc(`${State.user.uid}_${toUid}_${shiftKey}`).delete();
      closeModal(); toast("ลบแล้ว"); loadPraiseList(shiftKey);
    } catch (e) { toast("ลบไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
}

async function getMyRecords(coll, shiftKey) {
  const snap = await db.collection(coll).where("shiftKey", "==", shiftKey).where("fromUid", "==", State.user.uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ============================================================
   SATISFACTION — ความพึงพอใจในการอยู่เวร (1–10)
   ============================================================ */
async function viewSatisfaction(v) {
  const shifts = getSelectableShifts();
  if (!shifts.length) { v.innerHTML = emptyShiftCard("ความพึงพอใจในการอยู่เวร"); return; }
  v.innerHTML = `
    <div class="card">
      <div class="section-title">😊 ความพึงพอใจในการอยู่เวร</div>
      <div class="sub">ให้คะแนน 1–10 (10 = พึงพอใจมากที่สุด) • ใส่ข้อเสนอแนะได้ • แก้ไขได้ภายใน 3 ชม.หลังลงเวร</div>
      <div class="field"><label>เลือกเวร</label>
        <select id="st-shift">${shifts.map((s) => `<option value="${s.key}">${SHIFT_SHORT[s.shift]} • ${s.date}${s.isCurrent ? " (เวรปัจจุบัน)" : " (ย้อนหลัง)"}</option>`).join("")}</select></div>
      <div id="st-body"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  const load = () => loadSatisfaction(el("st-shift").value);
  el("st-shift").onchange = load;
  load();
}

async function loadSatisfaction(shiftKey) {
  const body = el("st-body");
  body.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  const docRef = db.collection("satisfaction").doc(`${State.user.uid}_${shiftKey}`);
  const snap = await docRef.get();
  const existing = snap.exists ? snap.data() : null;
  let selected = existing ? existing.rating : 0;
  body.innerHTML = `
    <div class="field"><label>คะแนนความพึงพอใจ (1 = น้อยที่สุด, 10 = มากที่สุด)</label>
      <div id="rate-row" class="rate-row"></div>
      <div id="rate-label" class="sub" style="margin-top:6px"></div></div>
    <div class="field"><label>ข้อเสนอแนะ (ไม่บังคับ)</label>
      <textarea id="st-sug" placeholder="สิ่งที่อยากเสนอแนะ/ปรับปรุงในเวรนี้">${esc(existing ? existing.suggestion : "")}</textarea></div>
    <button class="btn btn-primary btn-block" id="st-save">${existing ? "อัปเดต" : "บันทึก"}ความพึงพอใจ</button>`;
  const row = el("rate-row"), lbl = el("rate-label");
  const draw = () => {
    row.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1)
      .map((n) => `<button class="rate-btn ${n <= selected ? "on" : ""} ${n === selected ? "sel" : ""}" data-n="${n}">${n}</button>`).join("");
    lbl.textContent = selected ? `เลือก ${selected}/10` : "ยังไม่ได้ให้คะแนน";
    row.querySelectorAll("button").forEach((b) => b.onclick = () => { selected = +b.dataset.n; draw(); });
  };
  draw();
  el("st-save").onclick = async () => {
    if (!selected) return toast("กรุณาเลือกคะแนน 1–10", "err");
    try {
      await docRef.set({
        uid: State.user.uid, fullName: State.profile.fullName,
        shiftKey, ym: shiftKey.slice(0, 7), date: shiftKey.slice(0, 10), shift: shiftKey.split("_")[1],
        rating: selected, suggestion: el("st-sug").value.trim(),
        createdAt: existing ? existing.createdAt : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      toast("บันทึกความพึงพอใจแล้ว 😊", "ok");
      loadSatisfaction(shiftKey);
    } catch (e) { toast("บันทึกไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
}

/* ============================================================
   DASHBOARD — monthly ranking
   ============================================================ */
async function viewDashboard(v) {
  const showEval = State.profile.role === "superadmin";
  const nowYm = ym(new Date());
  v.innerHTML = `
    <div class="card">
      <div class="section-title">📊 Dashboard การถูกประเมิน (รายเดือน)</div>
      <div class="sub">จัดอันดับผู้ถูกรายงาน/คอมเมนต์มากสุด → น้อยสุด${showEval ? "" : " • ไม่แสดงชื่อผู้ประเมิน"}</div>
      <div class="field" style="max-width:220px"><label>เลือกเดือน</label>
        <input type="month" id="db-month" value="${nowYm}" /></div>
      <div id="db-stats" class="stat-grid" style="margin-bottom:16px"></div>
      <div id="db-body"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  const load = () => loadDashboard(el("db-month").value, showEval);
  el("db-month").onchange = load;
  load();
}

async function loadDashboard(month, showEval) {
  const body = el("db-body");
  body.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  const [repSnap, appSnap, chkSnap, satSnap] = await Promise.all([
    db.collection("reports").where("ym", "==", month).get(),
    db.collection("appreciations").where("ym", "==", month).get(),
    db.collection("checkins").where("ym", "==", month).get(),
    db.collection("satisfaction").where("ym", "==", month).get(),
  ]);
  const reports = repSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const apps = appSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const checkins = chkSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const sats = satSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const agg = {};
  const ensure = (uid, name) => (agg[uid] = agg[uid] || { uid, name, reports: 0, praises: 0, active: 0 });
  reports.forEach((r) => { const a = ensure(r.toUid, r.toName); a.reports++; if (!r.cleared) a.active++; });
  apps.forEach((r) => { ensure(r.toUid, r.toName).praises++; });
  const rows = Object.values(agg).sort((a, b) => b.reports - a.reports || b.praises - a.praises);

  // ---- รวมสถิติการมาสาย ----
  const lateAgg = {};
  const ensureL = (uid, name) => (lateAgg[uid] = lateAgg[uid] || { uid, name, lateCount: 0, totalMin: 0, shifts: 0, records: [] });
  checkins.forEach((c) => {
    const L = ensureL(c.uid, c.fullName); L.shifts++;
    if (c.late) { L.lateCount++; L.totalMin += (c.lateMinutes || 0); L.records.push(c); }
  });
  const lateRows = Object.values(lateAgg).filter((r) => r.lateCount > 0)
    .sort((a, b) => b.lateCount - a.lateCount || b.totalMin - a.totalMin);
  const totalLate = checkins.filter((c) => c.late).length;

  // ---- ความพึงพอใจ ----
  const satAvg = sats.length ? (sats.reduce((s, r) => s + (r.rating || 0), 0) / sats.length) : 0;
  const satWithSug = sats.filter((r) => (r.suggestion || "").trim()).sort((a, b) => (b.updatedAt && a.updatedAt ? (b.updatedAt.seconds || 0) - (a.updatedAt.seconds || 0) : 0));

  el("db-stats").innerHTML = `
    <div class="stat"><div class="num">${reports.length}</div><div class="lbl">รายงานทั้งหมด</div></div>
    <div class="stat"><div class="num">${apps.length}</div><div class="lbl">คำชื่นชม</div></div>
    <div class="stat"><div class="num">${rows.filter((r) => r.active >= FLAG_THRESHOLD).length}</div><div class="lbl">ต้องพบแอดมิน</div></div>
    <div class="stat"><div class="num" style="color:var(--amber)">${totalLate}</div><div class="lbl">มาสาย (ครั้ง)</div></div>
    <div class="stat"><div class="num" style="color:var(--teal)">${sats.length ? satAvg.toFixed(1) : "-"}</div><div class="lbl">พึงพอใจเฉลี่ย /10</div></div>`;

  const rankTable = !rows.length ? `<div class="empty">ยังไม่มีข้อมูลการประเมินในเดือนนี้</div>` : `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>ชื่อ</th><th>ถูกรายงาน</th><th>ได้รับชื่นชม</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="rank-num">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td><b>${r.reports}</b></td>
        <td>${r.praises}</td>
        <td>${r.active >= FLAG_THRESHOLD ? '<span class="badge badge-flag">พบแอดมิน</span>' : r.reports > 0 ? '<span class="badge badge-warn">มีรายงาน</span>' : "-"}</td>
        <td><button class="btn btn-sm btn-outline" data-uid="${r.uid}" data-name="${esc(r.name)}">รายละเอียด</button></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="btn-row no-print" style="margin-top:14px">
      <button class="btn btn-ghost" id="db-pdf">📄 ออกรายงานการประเมิน PDF</button>
    </div>`;

  const lateTable = `
    <div class="section-title" style="margin-top:22px">⏰ รายชื่อคนมาสาย (สายเกิน ${LATE_MIN} นาที)</div>
    ${!lateRows.length ? '<div class="empty">เดือนนี้ไม่มีคนมาสายเกินกำหนด 🎉</div>' : `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>ชื่อ</th><th>มาสาย (ครั้ง)</th><th>รวมนาทีสาย</th><th>เข้าเวรรวม</th><th></th></tr></thead>
      <tbody>${lateRows.map((r, i) => `<tr>
        <td class="rank-num">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td><b style="color:var(--amber)">${r.lateCount}</b></td>
        <td>${r.totalMin} นาที</td>
        <td>${r.shifts}</td>
        <td><button class="btn btn-sm btn-outline" data-late="${r.uid}" data-name="${esc(r.name)}">รายละเอียด</button></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="btn-row no-print" style="margin-top:14px">
      <button class="btn btn-amber" id="late-pdf">📄 ออกรายงานคนมาสาย PDF</button>
    </div>`}`;

  const satTable = `
    <div class="section-title" style="margin-top:22px">😊 ความพึงพอใจในการอยู่เวร ${sats.length ? `(เฉลี่ย ${satAvg.toFixed(1)}/10 จาก ${sats.length} ครั้ง)` : ""}</div>
    ${!sats.length ? '<div class="empty">เดือนนี้ยังไม่มีการให้คะแนนความพึงพอใจ</div>' : `
    <div class="sub" style="margin-bottom:8px">ข้อเสนอแนะ (${satWithSug.length})</div>
    ${satWithSug.length ? satWithSug.map((r) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
        <div class="n">${esc(r.fullName)} — ${r.rating}/10 <span class="s">(${esc(r.date)} เวร${SHIFT_SHORT[r.shift] || r.shift})</span></div>
        <div class="s">💬 ${esc(r.suggestion)}</div></div></div>`).join("") : '<div class="empty">ไม่มีข้อเสนอแนะ</div>'}
    <div class="btn-row no-print" style="margin-top:14px">
      <button class="btn btn-teal" id="sat-pdf">📄 ออกรายงานความพึงพอใจ PDF</button>
    </div>`}`;

  body.innerHTML = rankTable + lateTable + satTable;

  body.querySelectorAll("button[data-uid]").forEach((b) => {
    b.onclick = () => showDetailModal(b.dataset.uid, b.dataset.name, month, reports, apps, showEval);
  });
  body.querySelectorAll("button[data-late]").forEach((b) => {
    b.onclick = () => showLateDetailModal(b.dataset.name, month, lateAgg[b.dataset.late]);
  });
  const pdfBtn = el("db-pdf");
  if (pdfBtn) pdfBtn.onclick = () => printDashboard(month, rows, showEval);
  const latePdf = el("late-pdf");
  if (latePdf) latePdf.onclick = () => printLateReport(month, lateRows);
  const satPdf = el("sat-pdf");
  if (satPdf) satPdf.onclick = () => printSatisfactionReport(month, sats, satAvg);
}

function showLateDetailModal(name, month, agg) {
  const recs = (agg && agg.records) || [];
  recs.sort((a, b) => (a.shiftStart || "").localeCompare(b.shiftStart || ""));
  showModal(`
    <h3>${esc(name)} <span class="badge badge-warn">มาสาย ${recs.length} ครั้ง</span></h3>
    <div class="sub">เดือน ${month} • รวม ${agg ? agg.totalMin : 0} นาที</div>
    ${recs.length ? recs.map((c) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
        <div class="n">${esc(c.date)} • เวร${SHIFT_SHORT[c.shift] || c.shift}</div>
        <div class="s" style="color:var(--amber)">มาสาย ${c.lateMinutes} นาที</div>
      </div></div>`).join("") : '<div class="empty">ไม่มี</div>'}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-amber" id="ld-pdf">📄 PDF</button>
      <button class="btn btn-outline" id="ld-close">ปิด</button>
    </div>`);
  el("ld-close").onclick = closeModal;
  el("ld-pdf").onclick = () => printLateReport(month, [{ name, lateCount: recs.length, totalMin: agg ? agg.totalMin : 0, shifts: agg ? agg.shifts : 0, records: recs }]);
}

function showDetailModal(uid, name, month, reports, apps, showEval) {
  const rs = reports.filter((r) => r.toUid === uid);
  const as = apps.filter((r) => r.toUid === uid);
  const active = rs.filter((r) => !r.cleared).length;
  const canClear = State.profile.role === "superadmin"; // เฉพาะแอดมินใหญ่ยกเลิกแจ้งเตือน
  showModal(`
    <h3>${esc(name)} <span class="badge ${active >= FLAG_THRESHOLD ? "badge-flag" : "badge-shift"}">${active >= FLAG_THRESHOLD ? "ครบ " + active + " ต้องพบแอดมิน" : "รายงานค้าง " + active}</span></h3>
    <div class="sub">เดือน ${month}</div>
    <h4 style="margin:10px 0 6px">รายงาน (${rs.length})</h4>
    ${rs.length ? rs.map((r) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
        <div class="n">${esc(r.shiftKey)} ${r.cleared ? '<span class="badge badge-shift">ยกเลิกแล้ว</span>' : ""}</div>
        <div class="s">${esc(r.detail || "")}</div>
        ${showEval ? `<div class="s" style="color:var(--pink)">โดย: ${esc(r.fromName)}</div>` : ""}
      </div></div>`).join("") : '<div class="empty">ไม่มี</div>'}
    <h4 style="margin:12px 0 6px">คำชื่นชม (${as.length})</h4>
    ${as.length ? as.map((r) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
        <div class="n">🌟 ${esc(r.shiftKey)}</div><div class="s">${esc(r.reason || "(ไม่ระบุเหตุผล)")}</div>
        ${showEval ? `<div class="s" style="color:var(--amber)">โดย: ${esc(r.fromName)}</div>` : ""}
      </div></div>`).join("") : '<div class="empty">ไม่มี</div>'}
    <div class="btn-row" style="margin-top:14px">
      ${canClear && active >= FLAG_THRESHOLD ? `<button class="btn btn-teal" id="clearFlag">ยกเลิกแจ้งเตือน (รีเซ็ตตัวนับ)</button>` : ""}
      <button class="btn btn-ghost" id="detail-pdf">📄 PDF</button>
      <button class="btn btn-outline" id="detail-close">ปิด</button>
    </div>`);
  el("detail-close").onclick = closeModal;
  el("detail-pdf").onclick = () => printPersonReport(name, month, rs, as, showEval);
  const cf = el("clearFlag");
  if (cf) cf.onclick = async () => {
    if (!confirm(`ยืนยันยกเลิกแจ้งเตือนของ ${name}? (รายงานค้างจะถูกล้าง)`)) return;
    await clearFlags(uid);
    closeModal(); toast("ยกเลิกแจ้งเตือนแล้ว", "ok");
    loadDashboard(month, showEval);
  };
}

async function clearFlags(uid) {
  const snap = await db.collection("reports").where("toUid", "==", uid).get();
  const batch = db.batch();
  snap.docs.forEach((d) => {
    if (!d.data().cleared) batch.update(d.ref, {
      cleared: true, clearedBy: State.profile.fullName,
      clearedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
}

/* ============================================================
   PERSON REPORTS (superadmin) — per person, per month
   ============================================================ */
async function viewPersonReports(v) {
  v.innerHTML = `
    <div class="card">
      <div class="section-title">🧾 รายงานการประเมินรายบุคคล</div>
      <div class="sub">เลือกบุคคลและเดือนเพื่อดูรายละเอียดทั้งหมด (แอดมินใหญ่เห็นชื่อผู้ประเมิน)</div>
      <div class="btn-row">
        <div class="field" style="flex:1;min-width:160px"><label>บุคคล</label><select id="pr-user"></select></div>
        <div class="field" style="min-width:140px"><label>เดือน</label><input type="month" id="pr-month" value="${ym(new Date())}"/></div>
      </div>
      <div id="pr-out"><div class="empty">เลือกบุคคล…</div></div>
    </div>`;
  const users = await getAllUsers();
  el("pr-user").innerHTML = `<option value="">— เลือก —</option>` +
    users.map((u) => `<option value="${u.id}" data-name="${esc(u.fullName)}">${esc(u.fullName)} (${esc(u.username)})</option>`).join("");
  const load = () => {
    const sel = el("pr-user");
    const uid = sel.value; const name = sel.selectedOptions[0]?.dataset.name || "";
    if (uid) loadPersonReport(uid, name, el("pr-month").value);
  };
  el("pr-user").onchange = load;
  el("pr-month").onchange = load;
}

async function loadPersonReport(uid, name, month) {
  const out = el("pr-out");
  out.innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  const [repSnap, appSnap] = await Promise.all([
    db.collection("reports").where("ym", "==", month).get(),
    db.collection("appreciations").where("ym", "==", month).get(),
  ]);
  const rs = repSnap.docs.map((d) => d.data()).filter((r) => r.toUid === uid);
  const as = appSnap.docs.map((d) => d.data()).filter((r) => r.toUid === uid);
  out.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat"><div class="num">${rs.length}</div><div class="lbl">ถูกรายงาน</div></div>
      <div class="stat"><div class="num">${as.length}</div><div class="lbl">ได้รับชื่นชม</div></div>
    </div>
    <h4 style="margin:6px 0">รายงาน</h4>
    ${rs.length ? rs.map((r) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
      <div class="n">${esc(r.shiftKey)}</div><div class="s">${esc(r.detail || "")}</div>
      <div class="s" style="color:var(--pink)">โดย: ${esc(r.fromName)}</div></div></div>`).join("") : '<div class="empty">ไม่มี</div>'}
    <h4 style="margin:12px 0 6px">คำชื่นชม</h4>
    ${as.length ? as.map((r) => `<div class="person-row" style="margin-bottom:8px"><div class="meta">
      <div class="n">🌟 ${esc(r.shiftKey)}</div><div class="s">${esc(r.reason || "(ไม่ระบุ)")}</div>
      <div class="s" style="color:var(--amber)">โดย: ${esc(r.fromName)}</div></div></div>`).join("") : '<div class="empty">ไม่มี</div>'}
    <div class="btn-row no-print" style="margin-top:14px">
      <button class="btn btn-ghost" id="pr-pdf">📄 ออกรายงาน PDF</button>
    </div>`;
  el("pr-pdf").onclick = () => printPersonReport(name, month, rs, as, true);
}

/* ============================================================
   USER MANAGEMENT
   ============================================================ */
async function getAllUsers() {
  const snap = await db.collection("users").get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "th"));
  return list;
}

async function viewUsers(v) {
  const isSuper = State.profile.role === "superadmin";
  v.innerHTML = `
    <div class="card">
      <div class="section-title">⚙️ จัดการผู้ใช้งาน</div>
      <div class="sub">เพิ่ม/แก้ไข/ปรับสิทธิ์/ระงับผู้ใช้</div>
      <div class="btn-row no-print"><button class="btn btn-primary" id="add-user">+ เพิ่มผู้ใช้</button></div>
      <div id="user-list" style="margin-top:14px"><div class="empty">กำลังโหลด…</div></div>
    </div>`;
  el("add-user").onclick = () => openUserModal(null, isSuper);
  loadUsers(isSuper);
}

async function loadUsers(isSuper) {
  const box = el("user-list");
  const users = await getAllUsers();
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>ชื่อ–สกุล</th><th>username</th><th>สิทธิ์</th><th>บาร์โค้ด</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr>
      <td>${esc(u.fullName)}</td>
      <td>${esc(u.username)}</td>
      <td>${roleLabel(u.role)}</td>
      <td style="font-family:monospace;font-size:.8rem">${esc(u.barcodeId)}</td>
      <td>${u.disabled ? '<span class="badge badge-flag">ระงับ</span>' : '<span class="badge badge-shift">ใช้งาน</span>'}</td>
      <td><button class="btn btn-sm btn-outline" data-edit="${u.id}">แก้ไข</button></td>
    </tr>`).join("")}</tbody></table></div>`;
  box.querySelectorAll("button[data-edit]").forEach((b) => {
    b.onclick = () => {
      const u = users.find((x) => x.id === b.dataset.edit);
      openUserModal(u, isSuper);
    };
  });
}

function openUserModal(u, isSuper) {
  const editing = !!u;
  const targetIsSuper = u && u.role === "superadmin";
  const lockSuper = targetIsSuper && !isSuper; // แอดมินร่วมห้ามแก้แอดมินใหญ่
  const roleOptions = ["member", "admin"].concat(isSuper ? ["superadmin", "station"] : [])
    .map((r) => `<option value="${r}" ${u && u.role === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("");
  showModal(`
    <h3>${editing ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้ใหม่"}</h3>
    ${lockSuper ? '<div class="empty">ไม่มีสิทธิ์แก้ไขบัญชีแอดมินใหญ่</div>' : `
    <div class="field"><label>ชื่อ–สกุล</label><input id="u-name" value="${esc(u ? u.fullName : "")}"/></div>
    <div class="field"><label>username</label><input id="u-user" value="${esc(u ? u.username : "")}" ${editing ? "disabled" : ""}/></div>
    ${editing ? "" : '<div class="field"><label>รหัสผ่าน</label><input id="u-pass" type="text" placeholder="อย่างน้อย 6 ตัว"/></div>'}
    <div class="field"><label>สิทธิ์</label><select id="u-role" ${targetIsSuper ? "disabled" : ""}>${roleOptions}</select></div>
    ${editing ? `<div class="field"><label>สถานะ</label><select id="u-dis"><option value="false" ${!u.disabled ? "selected" : ""}>ใช้งาน</option><option value="true" ${u.disabled ? "selected" : ""}>ระงับการใช้งาน</option></select></div>` : ""}
    <div class="btn-row">
      <button class="btn btn-primary" id="u-save">บันทึก</button>
      ${editing && !targetIsSuper ? '<button class="btn btn-danger" id="u-del">ลบผู้ใช้</button>' : ""}
      <button class="btn btn-outline" id="u-cancel">ยกเลิก</button>
    </div>`}
    ${lockSuper ? '<div class="btn-row"><button class="btn btn-outline" id="u-cancel">ปิด</button></div>' : ""}`);
  el("u-cancel").onclick = closeModal;
  if (lockSuper) return;

  el("u-save").onclick = async () => {
    const name = el("u-name").value.trim();
    if (!name) return toast("กรอกชื่อ–สกุล", "err");
    try {
      if (editing) {
        const upd = { fullName: name };
        if (!targetIsSuper) upd.role = el("u-role").value;
        upd.disabled = el("u-dis").value === "true";
        await db.collection("users").doc(u.id).update(upd);
        toast("บันทึกแล้ว", "ok");
      } else {
        const uname = el("u-user").value.trim().toLowerCase();
        const pass = el("u-pass").value;
        if (!/^[a-z0-9._-]{3,}$/.test(uname)) return toast("username ไม่ถูกต้อง", "err");
        if (pass.length < 6) return toast("รหัสผ่านอย่างน้อย 6 ตัว", "err");
        const sAuth = getSecondaryAuth();
        const cred = await sAuth.createUserWithEmailAndPassword(uname + "@" + EMAIL_DOMAIN, pass);
        await db.collection("users").doc(cred.user.uid).set({
          username: uname, fullName: name, role: el("u-role").value,
          barcodeId: genBarcodeId(), disabled: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await sAuth.signOut();
        toast("เพิ่มผู้ใช้แล้ว", "ok");
      }
      closeModal(); loadUsers(isSuper);
    } catch (e) { toast("ไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
  const del = el("u-del");
  if (del) del.onclick = async () => {
    if (!confirm(`ลบผู้ใช้ ${u.fullName}? (ข้อมูลโปรไฟล์จะถูกลบ)`)) return;
    try {
      await db.collection("users").doc(u.id).delete();
      closeModal(); toast("ลบแล้ว"); loadUsers(isSuper);
    } catch (e) { toast("ลบไม่สำเร็จ: " + friendlyErr(e), "err"); }
  };
}

/* ============================================================
   BARCODES — view & print everyone's barcode
   ============================================================ */
async function viewBarcodes(v) {
  v.innerHTML = `
    <div class="card">
      <div class="section-title">🏷️ บาร์โค้ดของทุกคน</div>
      <div class="sub">กดปริ้นเพื่อบันทึกเป็น PDF หรือพิมพ์แจกได้</div>
      <div class="btn-row no-print"><button class="btn btn-primary" id="print-bc">🖨️ ปริ้นบาร์โค้ดทั้งหมด</button></div>
      <div id="bc-grid" class="barcode-grid" style="margin-top:14px"></div>
    </div>`;
  const users = await getAllUsers();
  const grid = el("bc-grid");
  grid.innerHTML = users.map((u) => `
    <div class="barcode-cell">
      <div class="name">${esc(u.fullName)}</div>
      <svg class="bc-svg" data-code="${esc(u.barcodeId)}"></svg>
      <div class="code" style="font-size:.75rem;color:var(--muted)">${esc(u.barcodeId)}</div>
    </div>`).join("");
  grid.querySelectorAll(".bc-svg").forEach((svg) => {
    try { JsBarcode(svg, svg.dataset.code, { format: "CODE128", width: 1.8, height: 55, displayValue: false, margin: 4 }); } catch (e) {}
  });
  el("print-bc").onclick = () => window.print();
}

/* ============================================================
   Modal helpers
   ============================================================ */
function showModal(html) {
  closeModal();
  const bd = document.createElement("div");
  bd.className = "modal-backdrop"; bd.id = "modalBackdrop";
  bd.innerHTML = `<div class="modal"><span class="close-x" id="modalX">×</span>${html}</div>`;
  document.body.appendChild(bd);
  el("modalX").onclick = closeModal;
  bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(); });
}
function closeModal() { const m = el("modalBackdrop"); if (m) m.remove(); }

/* ============================================================
   PDF / print (opens print-ready window -> Save as PDF)
   ============================================================ */
function openPrintWindow(title, bodyHtml) {
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
    <title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet"/>
    <style>
      body{font-family:'Sarabun',sans-serif;color:#2a2333;padding:28px;max-width:800px;margin:0 auto;}
      h1{color:#c1355a;font-size:20px;margin-bottom:4px;} .muted{color:#7a7385;font-size:13px;margin-bottom:18px;}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}
      th,td{border:1px solid #ddd;padding:7px 9px;text-align:left;} th{background:#fce7ee;}
      .rec{border:1px solid #eee;border-radius:8px;padding:10px;margin-bottom:8px;}
      .rec .h{font-weight:600;} .rec .d{font-size:13px;color:#444;} .rec .by{font-size:12px;color:#c1355a;}
      h3{margin:16px 0 8px;} .foot{margin-top:28px;font-size:11px;color:#999;text-align:center;}
    </style></head><body>
    <h1>💗 รักและใส่ใจ ER JNH</h1>
    ${bodyHtml}
    <div class="foot">พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")} • โดย ${esc(State.profile.fullName)}</div>
    </body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}

function printDashboard(month, rows, showEval) {
  const body = `<div class="muted">Dashboard การถูกประเมิน • เดือน ${esc(month)}${showEval ? "" : " • ไม่แสดงผู้ประเมิน"}</div>
    <table><thead><tr><th>#</th><th>ชื่อ</th><th>ถูกรายงาน</th><th>ได้รับชื่นชม</th><th>สถานะ</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.reports}</td><td>${r.praises}</td><td>${r.active >= FLAG_THRESHOLD ? "ต้องพบแอดมิน" : r.reports ? "มีรายงาน" : "-"}</td></tr>`).join("")}</tbody></table>`;
  openPrintWindow("Dashboard " + month, body);
}

function printPersonReport(name, month, rs, as, showEval) {
  const body = `<div class="muted">รายงานการประเมินรายบุคคล • เดือน ${esc(month)}</div>
    <h3>${esc(name)}</h3>
    <p>ถูกรายงาน ${rs.length} ครั้ง • ได้รับชื่นชม ${as.length} ครั้ง</p>
    <h3>รายงาน</h3>
    ${rs.length ? rs.map((r) => `<div class="rec"><div class="h">${esc(r.shiftKey)}</div><div class="d">${esc(r.detail || "")}</div>${showEval ? `<div class="by">โดย: ${esc(r.fromName)}</div>` : ""}</div>`).join("") : "<p>—</p>"}
    <h3>คำชื่นชม</h3>
    ${as.length ? as.map((r) => `<div class="rec"><div class="h">🌟 ${esc(r.shiftKey)}</div><div class="d">${esc(r.reason || "(ไม่ระบุ)")}</div>${showEval ? `<div class="by">โดย: ${esc(r.fromName)}</div>` : ""}</div>`).join("") : "<p>—</p>"}`;
  openPrintWindow(`รายงาน ${name} ${month}`, body);
}

function printLateReport(month, lateRows) {
  const totalLate = lateRows.reduce((s, r) => s + r.lateCount, 0);
  const totalMin = lateRows.reduce((s, r) => s + r.totalMin, 0);
  const detail = lateRows.map((r) => {
    const recs = (r.records || []).slice().sort((a, b) => (a.shiftStart || "").localeCompare(b.shiftStart || ""));
    return `<div class="rec"><div class="h">${esc(r.name)} — มาสาย ${r.lateCount} ครั้ง / รวม ${r.totalMin} นาที</div>
      ${recs.map((c) => `<div class="d">• ${esc(c.date)} เวร${SHIFT_SHORT[c.shift] || c.shift} — สาย ${c.lateMinutes} นาที</div>`).join("")}</div>`;
  }).join("");
  const body = `<div class="muted">รายงานการมาสาย (สายเกิน ${LATE_MIN} นาที) • เดือน ${esc(month)}</div>
    <p>ผู้มาสาย ${lateRows.length} คน • รวม ${totalLate} ครั้ง • รวม ${totalMin} นาที</p>
    <table><thead><tr><th>#</th><th>ชื่อ</th><th>มาสาย (ครั้ง)</th><th>รวมนาที</th><th>เข้าเวรรวม</th></tr></thead>
    <tbody>${lateRows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.lateCount}</td><td>${r.totalMin}</td><td>${r.shifts || "-"}</td></tr>`).join("")}</tbody></table>
    <h3>รายละเอียดรายคน</h3>${detail}`;
  openPrintWindow("รายงานคนมาสาย " + month, body);
}

function printSatisfactionReport(month, sats, avg) {
  const withSug = sats.filter((r) => (r.suggestion || "").trim());
  const rows = sats.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const body = `<div class="muted">รายงานความพึงพอใจในการอยู่เวร • เดือน ${esc(month)}</div>
    <p>จำนวน ${sats.length} ครั้ง • คะแนนเฉลี่ย ${sats.length ? avg.toFixed(2) : "-"}/10 • มีข้อเสนอแนะ ${withSug.length} รายการ</p>
    <table><thead><tr><th>วันที่</th><th>เวร</th><th>ชื่อ</th><th>คะแนน</th><th>ข้อเสนอแนะ</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${SHIFT_SHORT[r.shift] || esc(r.shift || "")}</td><td>${esc(r.fullName)}</td><td>${r.rating}/10</td><td>${esc(r.suggestion || "")}</td></tr>`).join("")}</tbody></table>`;
  openPrintWindow("รายงานความพึงพอใจ " + month, body);
}
