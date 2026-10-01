// Web chỉ nói chuyện với Firebase. ESP8266 chịu trách nhiệm đưa lệnh xuống Arduino.
const byId = (id) => document.getElementById(id);
const buttons = ["muteBtn", "unmuteBtn", "normalBtn", "simulateBtn", "simulateNormalBtn"].map(byId);
const DEMO_KEY = "ngoc-iot-doorbell-demo-v2";
const SDK_VERSION = "12.19.0";
const INITIAL_DATA = { ring: false, mute: false, lastRingAt: 0, muteRequestedAt: 0 };
const timeFormat = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateFormat = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
let mode = "boot";
let connected = false;
let validData = false;
let receivedData = false;
let listenerFailed = false;
let pending = false;
let state = {};
let databaseApi;
let doorbellRef;
let connectTimer;
const unsubscribers = [];
const activities = [];

function showNotice(message, kind = "info") {
  const element = byId("notice");
  element.hidden = !message;
  element.dataset.kind = kind;
  element.textContent = message;
}

function connectionStatus(message, kind) {
  byId("connectionText").textContent = message;
  byId("connectionBadge").dataset.kind = kind;
}

function timestampText(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8640000000000000) return "Chưa ghi nhận";
  return timeFormat.format(value) + " · " + dateFormat.format(value);
}

function tickClock() {
  const now = new Date();
  byId("clock").textContent = timeFormat.format(now);
  byId("today").textContent = dateFormat.format(now);
}

// Kiểm tra kiểu chặt: chuỗi "false" không được xem là Boolean false.
function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["Chưa có node /doorbell. Import sample-data.json tại gốc Realtime Database."];
  }
  const errors = [];
  for (const key of ["ring", "mute"]) {
    if (typeof data[key] !== "boolean") errors.push(key + " phải là Boolean true/false");
  }
  for (const key of ["lastRingAt", "muteRequestedAt"]) {
    if (!Number.isSafeInteger(data[key]) || data[key] < 0 || data[key] > 8640000000000000) {
      errors.push(key + " phải là số timestamp mili giây không âm");
    }
  }
  const extraKeys = Object.keys(data).filter((key) => !Object.hasOwn(INITIAL_DATA, key));
  if (extraKeys.length) errors.push("Có trường ngoài quy ước: " + extraKeys.join(", "));
  return errors;
}

function addActivity(message) {
  activities.unshift({ message, at: Date.now() });
  if (activities.length > 6) activities.pop();
  const list = byId("activityList");
  list.replaceChildren();
  for (const item of activities) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const time = document.createElement("time");
    label.textContent = item.message;
    time.textContent = timeFormat.format(item.at);
    time.dateTime = new Date(item.at).toISOString();
    row.append(label, time);
    list.append(row);
  }
}

function render() {
  const knownRing = typeof state.ring === "boolean";
  const ringing = state.ring === true;
  byId("statusCard").dataset.state = knownRing ? (ringing ? "ringing" : "normal") : "unknown";
  byId("ringStatus").textContent = knownRing ? (ringing ? "CÓ KHÁCH" : "BÌNH THƯỜNG") : "CHƯA CÓ DỮ LIỆU";
  byId("statusKicker").textContent = knownRing ? (ringing ? "CHUÔNG CỬA VỪA ĐƯỢC NHẤN" : "CỬA ĐANG YÊN TĨNH") : "CHỜ DỮ LIỆU HỢP LỆ";
  byId("ringDescription").textContent = knownRing ? (ringing ? "Có tín hiệu bấm chuông. Bạn có thể tắt âm báo từ xa." : "Chưa có tín hiệu khách đang chờ.") : "Kiểm tra cấu hình và dữ liệu trong Firebase.";
  byId("lastRingAt").textContent = timestampText(state.lastRingAt);
  byId("muteRequestedAt").textContent = timestampText(state.muteRequestedAt);
  const knownMute = typeof state.mute === "boolean";
  byId("muteStatus").textContent = knownMute ? (state.mute ? "Đã tắt" : "Đang hoạt động") : "Chưa xác định";
  byId("muteDot").dataset.state = knownMute ? (state.mute ? "muted" : "active") : "unknown";
  byId("liveLabel").textContent = mode === "demo" ? "Mô phỏng trên trình duyệt" : (connected && !listenerFailed ? "Web kết nối Firebase" : "Chưa đồng bộ");
  // Giữ trạng thái cuối khi mất mạng nhưng chặn lệnh mới; không báo tắt chuông thành công giả.
  const canWrite = validData && !pending && (mode === "demo" || (mode === "firebase" && connected && !listenerFailed));
  for (const button of buttons) button.disabled = !canWrite;
  byId("muteBtn").disabled = !canWrite || state.mute === true;
  byId("unmuteBtn").disabled = !canWrite || state.mute === false;
}

function applyData(data) {
  const errors = validateData(data);
  const previous = state;
  state = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  validData = errors.length === 0;
  receivedData = true;
  byId("dataWarning").hidden = validData;
  byId("dataWarning").textContent = errors.join("; ");
  if (typeof previous.ring === "boolean" && (previous.ring !== state.ring || previous.lastRingAt !== state.lastRingAt)) {
    addActivity(state.ring ? "Nhận tín hiệu có khách" : "Trạng thái trở về bình thường");
  }
  if (typeof previous.mute === "boolean" && previous.mute !== state.mute) {
    addActivity(state.mute ? "Trạng thái yêu cầu: tắt chuông" : "Trạng thái yêu cầu: bật chuông");
  }
  render();
}

function errorMessage(error) {
  const text = String(error.code || "") + " " + String(error.message || error);
  const lower = text.toLowerCase();
  if (lower.includes("permission_denied") || lower.includes("permission denied")) {
    return "Firebase từ chối quyền truy cập. Mở Realtime Database > Rules, dán database.rules.json, Publish rồi tải lại trang. Khi ghi bị từ chối, kiểm tra đủ bốn trường và đúng kiểu dữ liệu.";
  }
  if (lower.includes("databaseurl") || lower.includes("invalid-url") || lower.includes("invalid url")) {
    return "databaseURL không hợp lệ. Copy URL tại Realtime Database > Data; không thêm /doorbell hoặc .json.";
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("module")) {
    return "Không tải được Firebase SDK hoặc không kết nối được mạng. Kiểm tra Internet, F12 > Console/Network và quyền tải từ www.gstatic.com.";
  }
  return "Không hoàn thành thao tác: " + text + ". Xem F12 > Console để kiểm tra.";
}

function startDemo(message) {
  mode = "demo";
  byId("modeBadge").textContent = "CHẾ ĐỘ DEMO";
  connectionStatus("Firebase chưa kết nối", "waiting");
  byId("hardwareNote").textContent = "Demo chỉ mô phỏng trên trình duyệt. Các nút không điều khiển buzzer thật.";
  byId("testDescription").textContent = "Thao tác được lưu trên trình duyệt này. Không cần tạo Firebase để kiểm tra.";
  byId("modeHint").textContent = "Chế độ Demo · Không gửi dữ liệu lên Firebase";
  byId("commandState").textContent = "Sẵn sàng kiểm thử Demo.";
  let data = Object.assign({}, INITIAL_DATA);
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (saved && validateData(saved).length === 0) data = saved;
  } catch (error) { console.warn("Không đọc được dữ liệu Demo; dùng giá trị mặc định.", error); }
  applyData(data);
  showNotice(message || "Demo đang hoạt động. Điền firebase-config.js để chuyển sang Firebase thật.", "info");
  addActivity("Mở chế độ Demo");
  // Hai tab cùng trình duyệt và cùng địa chỉ sẽ nhận thay đổi Demo qua storage.
  window.addEventListener("storage", (event) => {
    if (event.key !== DEMO_KEY || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue);
      if (validateData(next).length === 0) applyData(next);
    } catch (error) { console.warn("Bỏ qua dữ liệu Demo hỏng.", error); }
  });
}

function validateConfig(config) {
  const required = ["apiKey", "projectId", "databaseURL", "appId"];
  const missing = required.filter((key) => typeof config[key] !== "string" || !config[key].trim() || /PASTE_|YOUR_|DAN_|THAY_|\.\.\.|[<>]/i.test(config[key]));
  if (missing.length) return { demo: true, message: "Firebase chưa cấu hình đủ: " + missing.join(", ") + ". Web đang chạy Demo; điền các giá trị thật để kết nối." };
  let url;
  try { url = new URL(config.databaseURL); } catch { throw new Error("databaseURL không phải URL hợp lệ."); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)$/i.test(url.hostname) || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error("databaseURL phải là URL HTTPS gốc của Firebase Realtime Database.");
  }
  return { demo: false };
}

async function startFirebase(config) {
  mode = "firebase";
  byId("modeBadge").textContent = "CHẾ ĐỘ FIREBASE";
  connectionStatus("Đang kết nối Firebase", "waiting");
  byId("hardwareNote").textContent = "Trạng thái trên đây phản ánh yêu cầu gửi tới Firebase. Kiểm tra buzzer thật sau khi ghép ESP8266 và Arduino.";
  byId("testDescription").textContent = "Các nút giả lập sẽ ghi dữ liệu lên Firebase thật. Dùng để kiểm thử và đặt về bình thường sau khi hoàn tất.";
  byId("modeHint").textContent = "Web ↔ Firebase · Trạng thái phần cứng cần kiểm tra riêng";
  byId("commandState").textContent = "Chờ dữ liệu và kết nối Firebase.";
  showNotice("Đang tải Firebase SDK và kết nối cơ sở dữ liệu.");
  // Import động: Demo không phụ thuộc việc tải CDN hay Internet.
  const modules = await Promise.all([
    import("https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-database.js")
  ]);
  databaseApi = modules[1];
  const app = modules[0].initializeApp(config);
  const database = databaseApi.getDatabase(app);
  doorbellRef = databaseApi.ref(database, "doorbell");
  unsubscribers.push(databaseApi.onValue(databaseApi.ref(database, ".info/connected"), (snapshot) => {
    const wasConnected = connected;
    connected = snapshot.val() === true;
    if (!listenerFailed) {
      connectionStatus(connected ? "Web ↔ Firebase: đã kết nối" : "Web ↔ Firebase: mất kết nối", connected ? "ok" : "waiting");
      showNotice(connected ? "" : "Chưa kết nối được Firebase. Dữ liệu đang thấy là dữ liệu gần nhất; kiểm tra Internet và databaseURL. Lệnh mới tạm khóa.", "warning");
    }
    if (wasConnected !== connected) addActivity(connected ? "Web kết nối Firebase" : "Web mất kết nối Firebase");
    if (connected && validData && !pending && !listenerFailed) byId("commandState").textContent = "Sẵn sàng gửi yêu cầu lên Firebase.";
    render();
  }, (error) => { failListener(error); }));
  unsubscribers.push(databaseApi.onValue(doorbellRef, (snapshot) => {
    clearTimeout(connectTimer);
    applyData(snapshot.val());
    if (connected && validData && !pending) byId("commandState").textContent = "Dữ liệu đã đồng bộ với Firebase.";
  }, (error) => { failListener(error); }));
  connectTimer = setTimeout(() => {
    if (!receivedData && !listenerFailed) showNotice("Chưa nhận được dữ liệu sau 15 giây. Kiểm tra Internet, databaseURL và Rules; dùng F12 > Console để xem lỗi.", "warning");
  }, 15000);
}

function failListener(error) {
  listenerFailed = true;
  clearTimeout(connectTimer);
  connectionStatus("Firebase báo lỗi truy cập", "error");
  showNotice(errorMessage(error), "error");
  byId("commandState").textContent = "Sửa cấu hình/Rules rồi tải lại trang để đăng ký listener mới.";
  console.error("Listener Firebase:", error);
  render();
}

async function command(action) {
  if (pending || !validData || (mode !== "demo" && (!connected || listenerFailed || mode !== "firebase"))) return;
  const payload = {};
  const timestamp = () => mode === "demo" ? Date.now() : databaseApi.serverTimestamp();
  let label;
  if (action === "mute") { payload.mute = true; payload.muteRequestedAt = timestamp(); label = "Tắt chuông"; }
  if (action === "unmute") { payload.mute = false; label = "Bật lại chuông"; }
  if (action === "ring") { payload.ring = true; payload.lastRingAt = timestamp(); label = "Giả lập có khách"; }
  if (action === "normal") { payload.ring = false; label = "Đặt về bình thường"; }
  if (!label) return;
  pending = true;
  render();
  byId("commandState").textContent = mode === "demo" ? "Đang cập nhật Demo." : "Đang gửi yêu cầu; chờ Firebase xác nhận.";
  let slowTimer;
  try {
    if (mode === "demo") {
      const next = Object.assign({}, state, payload);
      applyData(next);
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(next)); } catch (error) { console.warn("Demo vẫn chạy nhưng không lưu được khi đóng trang.", error); }
    } else {
      slowTimer = setTimeout(() => {
        byId("commandState").textContent = "Yêu cầu chưa được Firebase xác nhận. Nếu mất mạng, SDK sẽ gửi lại khi kết nối trở lại. Chưa xác nhận còi thật.";
      }, 12000);
      // update chỉ thay các trường cần thiết; không ghi đè mute khi có tín hiệu RING.
      // Promise hoàn thành sau xác nhận của server, không phải ngay khi giao diện đổi cục bộ.
      await databaseApi.update(doorbellRef, payload);
    }
    byId("commandState").textContent = mode === "demo" ? label + ": Demo đã cập nhật." : label + ": Firebase đã xác nhận yêu cầu.";
    if (mode === "firebase") showNotice(connected ? "" : "Firebase đã nhận yêu cầu, nhưng Web hiện mất kết nối.", "warning");
    addActivity(label + (mode === "demo" ? " trong Demo" : " được Firebase xác nhận"));
  } catch (error) {
    showNotice(errorMessage(error), "error");
    byId("commandState").textContent = "Gửi yêu cầu thất bại; Firebase chưa chấp nhận thay đổi.";
    console.error("Ghi Firebase:", error);
  } finally {
    clearTimeout(slowTimer);
    pending = false;
    render();
  }
}

byId("muteBtn").addEventListener("click", () => command("mute"));
byId("unmuteBtn").addEventListener("click", () => command("unmute"));
byId("normalBtn").addEventListener("click", () => command("normal"));
byId("simulateBtn").addEventListener("click", () => command("ring"));
byId("simulateNormalBtn").addEventListener("click", () => command("normal"));
tickClock();
setInterval(tickClock, 1000);
window.addEventListener("beforeunload", () => { for (const unsubscribe of unsubscribers) unsubscribe(); });
window.addEventListener("offline", () => {
  if (mode !== "firebase") return;
  connected = false;
  if (!listenerFailed) {
    connectionStatus("Thiết bị đang mất Internet", "waiting");
    showNotice("Thiết bị đang mất Internet. Dữ liệu đang thấy là dữ liệu gần nhất; lệnh mới tạm khóa.", "warning");
  }
  render();
});

async function boot() {
  if (location.protocol === "file:") return;
  try {
    // Bắt được cả lỗi cú pháp/404 trong file cấu hình mà không làm trắng giao diện.
    const configModule = await import("./firebase-config.js");
    const config = configModule.firebaseConfig;
    if (!config || typeof config !== "object") throw new Error("firebase-config.js phải export const firebaseConfig.");
    const result = validateConfig(config);
    if (result.demo) startDemo(result.message);
    else await startFirebase(config);
  } catch (error) {
    mode = "error";
    byId("modeBadge").textContent = "LỖI CẤU HÌNH";
    connectionStatus("Chưa kết nối Firebase", "error");
    showNotice(errorMessage(error), "error");
    byId("commandState").textContent = "Kiểm tra firebase-config.js rồi tải lại trang. Xóa giá trị cấu hình để trở về Demo.";
    console.error("Khởi động ứng dụng:", error);
    render();
  }
}
boot();
