let currentUser = null;
let users = [];
let classes = [];
let assignments = [];
let attendanceRecords = [];
let submissions = [];
let selectedClassId = null;
let selectedDirectUserId = null;
let selectedDirectChatId = null;
let unsubscribers = [];
let directChatUnsub = null;
let classChatUnsub = null;
let editingAccountId = null;
let editingClassId = null;
let editingAssignmentId = null;
let musicPlaying = false;
let messageFeed = [];

const DARK_KEY = "mindx_dark";
const MUSIC_KEY = "mindx_music";
const DIRECT_CHAT_KEY = "mindx_direct_chat";

const roleLabel = { admin: "Admin", teacher: "Giáo viên", student: "Học sinh" };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const slug = (v) => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const chatId = (a, b) => [a, b].sort().join("__");
const xpFromAttendance = (s) => s === "present" ? 10 : s === "late" ? -10 : 0;
const now = () => Date.now();
const dateValue = (v) => {
  if (!v) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00`).getTime();
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? 0 : parsed;
};
const latest = (items, count = 4) => [...items].sort((a, b) => (b.sortValue || 0) - (a.sortValue || 0)).slice(0, count);
const messageSortValue = (m) => {
  if (m?.createdAt?.seconds) return m.createdAt.seconds * 1000;
  return dateValue(m?.createdAtText);
};
const pageTitles = {
  overview: "Tổng quan",
  accounts: "Tài khoản",
  classes: "Lớp học",
  classDetail: "Chi tiết lớp",
  attendance: "Điểm danh",
  assignments: "Bài tập",
  chat: "Trò chuyện"
};

const visibleClasses = () => currentUser?.role === "admin" ? classes : classes.filter((c) => (c.memberIds || []).includes(currentUser.uid));
const visibleAssignments = () => currentUser?.role === "admin" ? assignments : currentUser?.role === "teacher" ? assignments.filter((a) => a.teacherId === currentUser.uid) : assignments.filter((a) => (a.studentIds || []).includes(currentUser.uid));
const visibleSubmissions = () => currentUser?.role === "admin" ? submissions : currentUser?.role === "teacher" ? submissions.filter((s) => s.teacherId === currentUser.uid) : submissions.filter((s) => s.studentId === currentUser.uid);
const userById = (uid) => users.find((u) => u.uid === uid);
const classById = (id) => classes.find((c) => c.id === id);
const userClasses = (uid) => classes.filter((c) => (c.memberIds || []).includes(uid));
const canManageRole = (role) => currentUser.role === "admin" ? ["admin", "teacher", "student"].includes(role) : currentUser.role === "teacher" && role === "student";
const canEditUser = (u) => currentUser.role === "admin" ? u.uid !== currentUser.uid : currentUser.role === "teacher" && u.role === "student";
const canManageClass = (c) => currentUser.role === "admin" || c.teacherId === currentUser.uid;
const canManageAssignment = (assignment) => !!assignment && (currentUser.role === "admin" || assignment.teacherId === currentUser.uid);
const allowedPagesForRole = (role) => ({
  admin: ["overview", "accounts", "classes", "classDetail", "attendance", "assignments", "chat"],
  teacher: ["overview", "accounts", "classes", "classDetail", "attendance", "assignments", "chat"],
  student: ["overview", "classes", "classDetail", "assignments", "chat"]
}[role || "student"]);

function userActivityStatus(user) {
  const activeTime = user?.lastActiveAt?.seconds
    ? user.lastActiveAt.seconds * 1000
    : dateValue(user?.lastActiveText);
  const diff = now() - activeTime;
  if (!activeTime || diff > 1000 * 60 * 60 * 24) return { label: "Offline", tone: "offline" };
  if (diff <= 1000 * 60 * 5) return { label: "Đang hoạt động", tone: "online" };
  if (diff <= 1000 * 60 * 60) return { label: "Vừa hoạt động", tone: "recent" };
  return { label: "Hoạt động hôm nay", tone: "today" };
}

function getAssignmentSubmission(assignment, studentId = currentUser?.uid) {
  if (!assignment || !studentId) return null;
  return submissions.find((s) => s.assignmentId === assignment.id && s.studentId === studentId) || null;
}

function getAssignmentStatus(assignment, submission) {
  const dueTime = dateValue(assignment?.dueDate);
  const submitTime = submission?.submittedAt?.seconds
    ? submission.submittedAt.seconds * 1000
    : submission ? dateValue(submission.submittedAtText) : 0;

  if (submission) {
    if (dueTime && submitTime && submitTime > dueTime + (24 * 60 * 60 * 1000 - 1)) {
      return { label: "Nộp trễ", tone: "late" };
    }
    return { label: "Đã nộp", tone: "submitted" };
  }

  if (!dueTime) return { label: "Chưa nộp", tone: "missing" };
  const remaining = dueTime - now();
  if (remaining < 0) return { label: "Quá hạn", tone: "late" };
  if (remaining <= 1000 * 60 * 60 * 24 * 2) return { label: "Sắp đến hạn", tone: "due" };
  return { label: "Chưa nộp", tone: "missing" };
}

function getAttendanceSummary(record) {
  const summary = { present: 0, late: 0, absent: 0 };
  (record?.records || []).forEach((item) => {
    if (summary[item.status] !== undefined) summary[item.status] += 1;
  });
  return summary;
}

function resetAssignmentForm() {
  editingAssignmentId = null;
  $("assignmentFormTitle").innerText = "Giao bài tập";
  $("saveAssignmentBtn").innerText = "Giao bài";
  $("cancelAssignmentEditBtn").classList.add("hidden");
  $("assignmentTitle").value = "";
  $("assignmentDescription").value = "";
  $("assignmentDueDate").value = "";
}

async function markUserActive() {
  if (!currentUser?.uid || !window.firebaseApp?.db) return;
  try {
    await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "users", currentUser.uid), {
      lastActiveAt: window.firebaseApp.serverTimestamp(),
      lastActiveText: new Date().toLocaleString("vi-VN"),
      active: true
    });
  } catch (e) {
    console.error("markUserActive failed", e);
  }
}

function setupPresenceTracking() {
  markUserActive();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markUserActive();
  });
  window.addEventListener("focus", markUserActive);
}

function syncHash(pageId) {
  const params = new URLSearchParams();
  params.set("page", pageId);
  if (pageId === "classDetail" && selectedClassId) params.set("class", selectedClassId);
  const nextHash = `#${params.toString()}`;
  if (window.location.hash !== nextHash) window.location.hash = nextHash;
}

function applyRouteFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const page = params.get("page");
  const classId = params.get("class");
  if (classId) selectedClassId = classId;
  if (page === "classDetail" && !selectedClassId) {
    navigate("classes", { skipHash: true });
    return;
  }
  navigate(page || allowedPagesForRole(currentUser?.role)[0], { skipHash: true });
}

function navigate(pageId, options = {}) {
  const pages = allowedPagesForRole(currentUser?.role);
  const target = pages.includes(pageId) ? pageId : pages[0];
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === target));
  $(target)?.classList.add("active");
  $("pageHeading").innerText = pageTitles[target] || "Tổng quan";
  if (!options.skipHash) syncHash(target);
  return target;
}

function toggleDarkMode() {
  document.body.classList.toggle("dark");
  localStorage.setItem(DARK_KEY, document.body.classList.contains("dark") ? "1" : "0");
}

function toggleMusic() {
  const audio = $("bgMusic");
  const btn = $("musicBtn");
  if (!musicPlaying) {
    audio.play();
    musicPlaying = true;
    $("musicStatus").innerText = "Bật";
    btn.classList.add("music-on");
    localStorage.setItem(MUSIC_KEY, "1");
  } else {
    audio.pause();
    musicPlaying = false;
    $("musicStatus").innerText = "Tắt";
    btn.classList.remove("music-on");
    localStorage.setItem(MUSIC_KEY, "0");
  }
}

function startApp(profile) {
  currentUser = profile;
  renderShell();
  setupPermissions();
  setupPresenceTracking();
  subscribeData();
}

function renderShell() {
  $("userRoleBadge").innerText = roleLabel[currentUser.role];
  $("userRoleBadge").dataset.role = currentUser.role;
  $("welcomeText").innerText = `Xin chào ${currentUser.name || currentUser.email}`;
  if (currentUser.role === "admin") {
    $("heroLabel").innerText = "Toàn quyền vận hành hệ thống";
    $("heroTitle").innerText = "Admin quản trị tài khoản, lớp học, chat, bài tập và leaderboard của toàn bộ nền tảng.";
    $("heroDescription").innerText = "Tài khoản admin không thuộc lớp. Giáo viên và học sinh chỉ hiện lớp sau khi được gắn vào lớp.";
    $("roleSummary").innerText = "Admin tạo được mọi vai trò, xem toàn bộ dữ liệu, sửa hoặc vô hiệu hóa tài khoản và quản lý mọi lớp.";
    return;
  }
  if (currentUser.role === "teacher") {
    $("heroLabel").innerText = "Không gian điều phối lớp học";
    $("heroTitle").innerText = "Giáo viên là tài khoản tự do, chỉ hiện lớp khi chính họ tạo hoặc được gắn làm giáo viên phụ trách.";
    $("heroDescription").innerText = "Giáo viên tạo học sinh, tạo lớp, giao bài, điểm danh, chat cá nhân và chat nhóm lớp.";
    $("roleSummary").innerText = "Giáo viên chỉ tạo, sửa, vô hiệu hóa học sinh; chỉ quản lý lớp của chính mình.";
    return;
  }
  $("heroLabel").innerText = "Không gian học tập cá nhân";
  $("heroTitle").innerText = "Học sinh chỉ thấy lớp sau khi được giáo viên thêm vào, và có thể xem toàn bộ thông tin lớp của mình.";
  $("heroDescription").innerText = "Học sinh được nộp bài, chat riêng, chat nhóm lớp và xuất hiện trên leaderboard toàn hệ thống lẫn trong lớp.";
  $("roleSummary").innerText = "Nộp bài được +25 XP, điểm danh đúng giờ +10 XP, đi trễ -10 XP.";
}

function renderProfileClassInfo() {
  const profileBox = $("profileClassInfo");
  const joined = userClasses(currentUser.uid);
  if (!profileBox) return;

  if (currentUser.role === "admin") {
    profileBox.innerHTML = '<div class="empty-state">Admin không gắn lớp mặc định nhưng có thể xem và quản lý toàn bộ lớp trong hệ thống.</div>';
    return;
  }

  profileBox.innerHTML = joined.length
    ? joined.map((c) => `
      <div class="list-item compact">
        <div>
          <h4>${esc(c.name)}</h4>
          <p>${esc(c.subject)}</p>
        </div>
        <div class="item-meta">
          <span>${currentUser.role === "teacher" ? "Đang dạy" : "Đang học"}</span>
          <small>${esc(c.teacherName || "---")}</small>
        </div>
      </div>`).join("")
    : `<div class="empty-state">${currentUser.role === "teacher" ? "Giáo viên này chưa được gắn hoặc tạo lớp nào." : "Học sinh này chưa được thêm vào lớp nào."}</div>`;
}

function setupPermissions() {
  const allowed = {
    admin: ["overview", "accounts", "classes", "attendance", "assignments", "chat"],
    teacher: ["overview", "accounts", "classes", "attendance", "assignments", "chat"],
    student: ["overview", "classes", "assignments", "chat"]
  }[currentUser.role];
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("hidden", !allowed.includes(b.dataset.page)));
  document.querySelectorAll(".quick-action-card[data-page]").forEach((button) => {
    const page = button.dataset.page;
    button.classList.toggle("hidden", !allowed.includes(page));
  });
  if (currentUser.role === "student") {
    $("accountFormPanel").classList.add("hidden");
    $("classFormPanel").classList.add("hidden");
    $("assignmentManagerPanel").classList.add("hidden");
  } else {
    $("studentSubmissionPanel").classList.add("hidden");
  }
  $("accountRole").innerHTML = currentUser.role === "admin"
    ? '<option value="student">Học sinh</option><option value="teacher">Giáo viên</option><option value="admin">Admin</option>'
    : '<option value="student">Học sinh</option>';
  applyRouteFromHash();
}

function clearSubscriptions() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (directChatUnsub) directChatUnsub();
  if (classChatUnsub) classChatUnsub();
  directChatUnsub = null;
  classChatUnsub = null;
}

function subscribeData() {
  clearSubscriptions();
  const { db, collection, onSnapshot, query, where } = window.firebaseApp;

  unsubscribers.push(onSnapshot(collection(db, "users"), (snap) => {
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active !== false);
    currentUser = userById(currentUser.uid) || currentUser;
    renderShell();
    renderAccounts();
    renderClassFormOptions();
    renderGlobalLeaderboard();
    renderDirectContacts();
    renderOverview();
    renderProfileClassInfo();
    renderSelectedClass();
    renderSelectedClassEnhancements();
  }));

  const classesRef = currentUser.role === "admin"
    ? collection(db, "classes")
    : query(collection(db, "classes"), where("memberIds", "array-contains", currentUser.uid));

  unsubscribers.push(onSnapshot(classesRef, (snap) => {
    classes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderClasses();
    renderClassFormOptions();
    renderAttendanceClassOptions();
    renderAssignmentClassOptions();
    renderOverview();
    renderProfileClassInfo();
    renderSelectedClass();
    renderSelectedClassEnhancements();
  }));

  const assignmentsRef = currentUser.role === "admin"
    ? collection(db, "assignments")
    : currentUser.role === "teacher"
      ? query(collection(db, "assignments"), where("teacherId", "==", currentUser.uid))
      : query(collection(db, "assignments"), where("studentIds", "array-contains", currentUser.uid));

  unsubscribers.push(onSnapshot(assignmentsRef, (snap) => {
    assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAssignments();
    renderSubmissionAssignmentOptions();
    renderOverview();
    renderSelectedClass();
    renderSelectedClassEnhancements();
  }));

  const attendanceRef = currentUser.role === "admin"
    ? collection(db, "attendance")
    : currentUser.role === "teacher"
      ? query(collection(db, "attendance"), where("teacherId", "==", currentUser.uid))
      : query(collection(db, "attendance"), where("studentIds", "array-contains", currentUser.uid));

  unsubscribers.push(onSnapshot(attendanceRef, (snap) => {
    attendanceRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAttendanceHistory();
    renderAttendanceStudents();
  }));

  const submissionsRef = currentUser.role === "admin"
    ? collection(db, "submissions")
    : currentUser.role === "teacher"
      ? query(collection(db, "submissions"), where("teacherId", "==", currentUser.uid))
      : query(collection(db, "submissions"), where("studentId", "==", currentUser.uid));

  unsubscribers.push(onSnapshot(submissionsRef, (snap) => {
    submissions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSubmissions();
    renderAssignments();
    renderSelectedClassEnhancements();
  }));

  const messagesRef = currentUser.role === "admin"
    ? collection(db, "messages")
    : query(collection(db, "messages"), where("participantIds", "array-contains", currentUser.uid));

  unsubscribers.push(onSnapshot(messagesRef, (snap) => {
    messageFeed = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDirectContacts();
    renderActiveDirectChat();
    renderActiveClassChat();
  }));
}

function renderOverview() {
  $("statStudents").innerText = users.filter((u) => u.role === "student").length;
  $("statTeachers").innerText = users.filter((u) => u.role === "teacher").length;
  $("statClasses").innerText = visibleClasses().length;
  $("statAssignments").innerText = visibleAssignments().length;
  renderOverviewInsight();
  renderTodayPulse();
  renderOverviewClassSpotlight();
  renderRecommendations();
  renderRecentActivity();
}

function renderOverviewInsight() {
  const joinedClasses = userClasses(currentUser.uid);
  let title = "Trung tâm điều phối thông minh";
  let text = "Hệ thống đang tổng hợp dữ liệu lớp học, bài tập và tương tác để gợi ý hành động ưu tiên.";

  if (currentUser.role === "admin") {
    title = "Toàn cảnh hệ thống theo thời gian thực";
    text = `Bạn đang giám sát ${users.length} tài khoản đang hoạt động, ${classes.length} lớp học và ${assignments.length} bài tập trên toàn nền tảng.`;
  } else if (currentUser.role === "teacher") {
    title = "Buồng lái giáo viên";
    text = `Bạn đang tham gia ${joinedClasses.length} lớp học. Hệ thống ưu tiên các lớp có bài tập sắp đến hạn, cần điểm danh hoặc có hoạt động nộp bài mới.`;
  } else {
    title = "Không gian học tập cá nhân hóa";
    text = `Bạn hiện có ${joinedClasses.length} lớp học hiển thị. Dashboard tập trung vào bài tập đang mở, lớp đang học và mức tăng XP gần nhất của bạn.`;
  }

  $("overviewInsightTitle").innerText = title;
  $("overviewInsightText").innerText = text;
}

function renderTodayPulse() {
  const pulse = [];
  const visibleClassItems = visibleClasses();
  const visibleAssignmentItems = visibleAssignments();
  const visibleSubmissionItems = visibleSubmissions();
  const today = new Date().toISOString().slice(0, 10);

  if (currentUser.role === "student") {
    pulse.push({ label: "XP hiện tại", value: `${currentUser.xp || 0} XP`, note: "Tăng từ nộp bài và điểm danh" });
    pulse.push({ label: "Lớp đang tham gia", value: `${visibleClassItems.length}`, note: "Chỉ hiện khi được thêm vào lớp" });
    pulse.push({ label: "Bài có thể nộp", value: `${visibleAssignmentItems.length}`, note: "Các bài tập bạn nhìn thấy hôm nay" });
  } else {
    pulse.push({ label: "Lớp đang vận hành", value: `${visibleClassItems.filter((c) => canManageClass(c)).length}`, note: "Không gian bạn có thể trực tiếp quản lý" });
    pulse.push({ label: "Bài tập đang mở", value: `${visibleAssignmentItems.length}`, note: "Nguồn việc đang hiển thị trong hệ thống của bạn" });
    pulse.push({ label: "Điểm danh hôm nay", value: `${attendanceRecords.filter((a) => a.date === today).length}`, note: "Số phiên điểm danh trùng ngày hiện tại" });
  }

  pulse.push({ label: "Bài nộp gần đây", value: `${visibleSubmissionItems.length}`, note: "Tổng số bài nộp trong vùng dữ liệu hiện tại" });

  $("todayPulse").innerHTML = pulse.map((item) => `
    <div class="metric-card">
      <strong>${esc(item.label)}</strong>
      <span class="metric-value">${esc(item.value)}</span>
      <p>${esc(item.note)}</p>
    </div>
  `).join("");
}

function renderOverviewClassSpotlight() {
  const items = visibleClasses().map((c) => {
    const classAssignments = assignments.filter((a) => a.classId === c.id).length;
    const classSubmissions = submissions.filter((s) => s.classId === c.id).length;
    const classScore = ((c.studentIds || []).length * 3) + (classAssignments * 2) + classSubmissions;
    return { ...c, classAssignments, classSubmissions, classScore };
  }).sort((a, b) => b.classScore - a.classScore).slice(0, 3);

  $("overviewClassSpotlight").innerHTML = items.length
    ? items.map((c) => `
      <div class="list-item compact">
        <div>
          <h4>${esc(c.name)}</h4>
          <p>${esc(c.subject || "Lớp học")}</p>
        </div>
        <div class="item-meta">
          <span>${(c.studentIds || []).length} học sinh</span>
          <small>${c.classAssignments} bài • ${c.classSubmissions} bài nộp</small>
        </div>
      </div>
    `).join("")
    : '<div class="empty-state">Chưa có lớp học nào để hiển thị spotlight.</div>';
}

function renderRecommendations() {
  let cards = [];

  if (currentUser.role === "admin") {
    cards = [
      { tag: "System", title: "Rà soát tài khoản mới", text: `Hiện có ${users.filter((u) => u.role === "student").length} học sinh và ${users.filter((u) => u.role === "teacher").length} giáo viên.` },
      { tag: "Classes", title: "Theo dõi lớp hoạt động mạnh", text: "Mở spotlight lớp để xem nơi đang có nhiều bài tập và nộp bài nhất." },
      { tag: "Realtime", title: "Kiểm tra dòng chat", text: "Khu vực trò chuyện đang là điểm chạm nhanh nhất giữa giáo viên và học sinh." },
      { tag: "Growth", title: "Mở rộng dashboard", text: "Đây là nền phù hợp để nối AI tutor, analytics và recommendation ở vòng tiếp theo." }
    ];
  } else if (currentUser.role === "teacher") {
    cards = [
      { tag: "Teaching", title: "Ưu tiên lớp chưa có bài tập", text: "Tạo một bài tập ngắn để kích hoạt động lực và leaderboard trong lớp." },
      { tag: "Attendance", title: "Điểm danh đúng nhịp", text: "Điểm danh đều giúp dữ liệu lớp rõ hơn và XP phản ánh công bằng hơn." },
      { tag: "Classroom", title: "Mở chat nhóm lớp", text: "Chat nhóm lớp giúp kéo học sinh quay lại với bài tập nhanh hơn." },
      { tag: "Roster", title: "Hoàn thiện thành viên", text: "Thêm học sinh có sẵn vào lớp để hồ sơ lớp hiển thị đầy đủ." }
    ];
  } else {
    cards = [
      { tag: "Focus", title: "Nộp bài để tăng XP", text: "Mỗi bài nộp thành công giúp bạn nhận thêm 25 XP và leo bảng xếp hạng." },
      { tag: "Routine", title: "Điểm danh đúng giờ", text: "Có mặt đúng giờ tăng 10 XP, đi trễ sẽ bị trừ điểm." },
      { tag: "Class", title: "Theo dõi lớp đang học", text: "Mỗi lớp bạn được thêm vào đều hiển thị đủ bài tập, thành viên và chat nhóm." },
      { tag: "Chat", title: "Hỏi giáo viên ngay", text: "Chat cá nhân là cách nhanh nhất để gỡ điểm nghẽn trong lúc học." }
    ];
  }

  $("smartRecommendations").innerHTML = cards.map((card) => `
    <div class="recommendation-card">
      <span class="rec-tag">${esc(card.tag)}</span>
      <strong>${esc(card.title)}</strong>
      <p>${esc(card.text)}</p>
    </div>
  `).join("");
}

function renderRecentActivity() {
  const activity = [];

  latest(visibleAssignments().map((a) => ({
    sortValue: dateValue(a.dueDate),
    time: a.dueDate || "Sắp tới",
    title: `Bài tập: ${a.title}`,
    text: `${a.className || "Lớp học"} • Hạn nộp ${a.dueDate || "---"}`
  })), 2).forEach((item) => activity.push(item));

  latest(visibleSubmissions().map((s) => ({
    sortValue: dateValue(s.submittedAtText),
    time: s.submittedAtText || "Vừa xong",
    title: `Bài nộp: ${s.assignmentTitle}`,
    text: `${s.studentName || "Học sinh"} • ${s.className || "Lớp học"}`
  })), 3).forEach((item) => activity.push(item));

  latest(attendanceRecords.filter((a) => new Set(visibleClasses().map((c) => c.id)).has(a.classId)).map((a) => ({
    sortValue: dateValue(a.date),
    time: a.date || "Hôm nay",
    title: `Điểm danh: ${a.className}`,
    text: `${(a.records || []).length} học sinh • ${a.savedByName || "Người dùng"}`
  })), 2).forEach((item) => activity.push(item));

  const items = latest(activity, 6);
  $("recentActivity").innerHTML = items.length
    ? items.map((item) => `
      <div class="timeline-node">
        <time>${esc(item.time)}</time>
        <strong>${esc(item.title)}</strong>
        <p>${esc(item.text)}</p>
      </div>
    `).join("")
    : '<div class="empty-state">Chưa có hoạt động nào để hiển thị.</div>';
}

function renderGlobalLeaderboard() {
  const ranked = [...users].filter((u) => u.role === "student").sort((a, b) => (b.xp || 0) - (a.xp || 0));
  $("globalLeaderboard").innerHTML = ranked.length
    ? ranked.map((u, i) => `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">${i + 1}</div>
        <div class="leaderboard-user"><h4>${esc(u.name)}</h4><p>${roleLabel[u.role]}</p></div>
        <div class="leaderboard-score">${u.xp || 0} XP</div>
      </div>`).join("")
    : '<div class="empty-state">Chưa có dữ liệu leaderboard.</div>';
}

function renderAccounts() {
  let visible = users;
  if (currentUser.role === "teacher") visible = users.filter((u) => u.role === "student");
  if (currentUser.role === "student") visible = users.filter((u) => u.uid === currentUser.uid);
  const kw = $("accountSearch").value.trim().toLowerCase();
  visible = visible.filter((u) => `${u.name} ${u.email} ${u.role} ${userClasses(u.uid).map((c) => c.name).join(" ")}`.toLowerCase().includes(kw));
  $("accountList").innerHTML = visible.length
    ? visible.map((u) => `
      <article class="account-card">
        <div class="account-card-head">
          <div class="account-card-main">
            <h4>${esc(u.name)}</h4>
            <p>${esc(u.email)}</p>
          </div>
          <div class="account-card-side">
            <span class="account-role">${roleLabel[u.role]}</span>
            <small>${u.xp || 0} XP</small>
          </div>
        </div>
        <div class="account-card-foot">
          <p class="muted-text">${esc(
            u.role === "teacher"
              ? (userClasses(u.uid).map((c) => `Đang dạy: ${c.name}`).join(", ") || "Chưa dạy lớp nào")
              : u.role === "student"
                ? (userClasses(u.uid).map((c) => `Đang học: ${c.name}`).join(", ") || "Chưa học lớp nào")
                : "Admin toàn quyền"
          )}</p>
          <div class="account-card-actions">
            <small class="status-badge ${userActivityStatus(u).tone}">${userActivityStatus(u).label}</small>
            ${canEditUser(u) ? `<div class="item-actions horizontal"><button class="mini-btn" onclick="editAccount('${u.uid}')">Sửa</button><button class="mini-btn danger-btn" onclick="deactivateAccount('${u.uid}')">Vô hiệu hóa</button></div>` : ""}
          </div>
        </div>
      </article>`).join("")
    : '<div class="empty-state">Không có tài khoản phù hợp.</div>';
}

function renderClassFormOptions() {
  const teachers = currentUser.role === "admin"
    ? users.filter((u) => u.role === "teacher")
    : [{ uid: currentUser.uid, name: currentUser.name }];
  $("classTeacher").innerHTML = teachers.length
    ? teachers.map((t) => `<option value="${t.uid}">${esc(t.name)}</option>`).join("")
    : '<option value="">Chưa có giáo viên</option>';
  if (currentUser.role === "teacher") $("classTeacher").value = currentUser.uid;

  const students = users.filter((u) => u.role === "student");
  $("availableStudents").innerHTML = students.length
    ? students.map((s) => `<label class="check-item student-check-item"><input type="checkbox" value="${s.uid}"><div class="check-item-body"><strong>${esc(s.name)}</strong><p>${esc(s.email || "Chưa có email")}</p></div><div class="check-item-meta"><small>${userClasses(s.uid).length ? `${userClasses(s.uid).length} lớp` : "Chưa vào lớp"}</small><span class="status-badge ${userActivityStatus(s).tone}">${userActivityStatus(s).label}</span></div></label>`).join("")
    : '<div class="empty-state">Chưa có học sinh để thêm vào lớp.</div>';
}

function renderClasses() {
  const visible = visibleClasses();
  $("classList").innerHTML = visible.length
    ? visible.map((c) => `
      <div class="class-card">
        <div class="class-card-main" onclick="openClassDetail('${c.id}')">
          <div><p class="class-tag">${esc(c.subject)}</p><h4>${esc(c.name)}</h4><p>${esc(c.description || "Không có mô tả")}</p></div>
          <div class="item-meta"><span>${esc(c.teacherName || "Chưa có giáo viên")}</span><small>${(c.studentIds || []).length} học sinh</small></div>
        </div>
        ${canManageClass(c) ? `<div class="item-actions horizontal"><button class="mini-btn" onclick="editClass('${c.id}')">Sửa</button><button class="mini-btn danger-btn" onclick="deleteClassItem('${c.id}')">Xóa</button></div>` : ""}
      </div>`).join("")
    : '<div class="empty-state">Bạn chưa có lớp học nào.</div>';
}

function openClassDetail(id) {
  selectedClassId = id;
  renderSelectedClass();
  renderSelectedClassEnhancements();
  subscribeToClassChat();
  navigate("classDetail");
}

function renderSelectedClass() {
  const c = classById(selectedClassId);
  if (!c) return;

  $("classDetailTitle").innerText = `${c.name} • ${c.subject}`;
  $("classDetailSubtitle").innerText = c.description || "Lớp học chưa có mô tả.";
  $("classStudentCount").innerText = (c.studentIds || []).length;
  $("classAssignmentCount").innerText = assignments.filter((a) => a.classId === c.id).length;

  const members = (c.memberIds || []).map(userById).filter(Boolean);
  $("classMembers").innerHTML = members.length
    ? members.map((m) => `<div class="list-item compact roster-card"><div><h4>${esc(m.name)}</h4><p>${esc(m.email)}</p><p class="muted-text">${m.role === "teacher" ? "Giáo viên phụ trách" : m.role === "student" ? "Thành viên học tập" : "Quản trị viên"}</p></div><div class="item-meta"><span>${roleLabel[m.role]}</span><small>${m.xp || 0} XP</small><small class="status-badge ${userActivityStatus(m).tone}">${userActivityStatus(m).label}</small></div></div>`).join("")
    : '<div class="empty-state">Chưa có thành viên.</div>';

  const ranked = [...members].filter((m) => m.role === "student").sort((a, b) => (b.xp || 0) - (a.xp || 0));
  $("classLeaderboard").innerHTML = ranked.length
    ? ranked.map((m, i) => `<div class="leaderboard-item"><div class="leaderboard-rank">${i + 1}</div><div class="leaderboard-user"><h4>${esc(m.name)}</h4><p>${roleLabel[m.role]}</p></div><div class="leaderboard-score">${m.xp || 0} XP</div></div>`).join("")
    : '<div class="empty-state">Chưa có leaderboard trong lớp.</div>';

  const classAssignments = assignments.filter((a) => a.classId === c.id);
  $("classAssignments").innerHTML = classAssignments.length
    ? classAssignments.map((a) => `<div class="list-item compact"><div><h4>${esc(a.title)}</h4><p>${esc(a.description || "Không có mô tả")}</p></div><div class="item-meta"><span>Hạn nộp</span><small>${esc(a.dueDate || "---")}</small></div></div>`).join("")
    : '<div class="empty-state">Lớp này chưa có bài tập.</div>';
}

function renderSelectedClassEnhancements() {
  const c = classById(selectedClassId);
  if (!c) return;

  const classAssignments = assignments.filter((a) => a.classId === c.id);
  $("classAssignments").innerHTML = classAssignments.length
    ? classAssignments.map((a) => {
      const stats = submissions.filter((s) => s.assignmentId === a.id);
      const ownStatus = currentUser.role === "student" ? getAssignmentStatus(a, getAssignmentSubmission(a)) : null;
      const lateCount = stats.filter((s) => getAssignmentStatus(a, s).tone === "late").length;
      const missingCount = Math.max((a.studentIds || []).length - stats.length, 0);
      return `<div class="assignment-card"><div><h4>${esc(a.title)}</h4><p>${esc(a.description || "Không có mô tả")}</p><div class="assignment-meta-row"><span class="status-badge due">Hạn nộp ${esc(a.dueDate || "---")}</span>${ownStatus ? `<span class="status-badge ${ownStatus.tone}">${ownStatus.label}</span>` : ""}</div></div><div class="item-meta"><span>${stats.length}/${(a.studentIds || []).length} đã nộp</span><small>${lateCount} trễ • ${missingCount} chưa nộp</small></div></div>`;
    }).join("")
    : '<div class="empty-state">Lớp này chưa có bài tập.</div>';

  renderActiveClassChat();
}

function renderAttendanceClassOptions() {
  const manageable = visibleClasses().filter(canManageClass);
  $("attendanceClass").innerHTML = manageable.length
    ? manageable.map((c) => `<option value="${c.id}">${esc(c.name)} - ${esc(c.subject)}</option>`).join("")
    : '<option value="">Chưa có lớp để điểm danh</option>';
  renderAttendanceStudents();
}

function renderAttendanceStudents() {
  const c = classById($("attendanceClass").value);
  if (!c) {
    $("attendanceStudents").innerHTML = '<div class="empty-state">Chọn lớp để điểm danh.</div>';
    return;
  }
  const students = (c.studentIds || []).map(userById).filter(Boolean);
  const existingRecord = attendanceRecords.find((item) => item.classId === c.id && item.date === $("attendanceDate").value);
  const savedMap = {};
  (existingRecord?.records || []).forEach((item) => {
    savedMap[item.studentId] = item.status;
  });
  $("attendanceStudents").innerHTML = students.length
    ? students.map((s) => `<div class="attendance-row"><span>${esc(s.name)}</span><select data-student-id="${s.uid}"><option value="present">Đúng giờ</option><option value="late">Đi trễ</option><option value="absent">Vắng mặt</option></select></div>`).join("")
    : '<div class="empty-state">Lớp này chưa có học sinh.</div>';
}

function renderAttendanceHistory() {
  const ids = new Set(visibleClasses().map((c) => c.id));
  const items = attendanceRecords.filter((a) => ids.has(a.classId)).sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  $("attendanceHistory").innerHTML = items.length
    ? items.map((a) => `<div class="list-item compact"><div><h4>${esc(a.className)}</h4><p>${esc(a.date)}</p></div><div class="item-meta"><span>${(a.records || []).length} học sinh</span><small>${esc(a.savedByName || "---")}</small></div></div>`).join("")
    : '<div class="empty-state">Chưa có lịch sử điểm danh.</div>';
}

function renderAssignmentClassOptions() {
  const manageable = visibleClasses().filter(canManageClass);
  $("assignmentClass").innerHTML = manageable.length
    ? manageable.map((c) => `<option value="${c.id}">${esc(c.name)} - ${esc(c.subject)}</option>`).join("")
    : '<option value="">Chưa có lớp để giao bài</option>';
}

function renderSubmissionAssignmentOptions() {
  if (currentUser.role !== "student") return;
  const items = visibleAssignments();
  $("submissionAssignment").innerHTML = items.length
    ? items.map((a) => `<option value="${a.id}">${esc(a.className)} - ${esc(a.title)}</option>`).join("")
    : '<option value="">Chưa có bài tập để nộp</option>';
}

function renderAssignments() {
  const items = [...visibleAssignments()].sort((a, b) => `${a.dueDate}`.localeCompare(`${b.dueDate}`));
  $("assignmentList").innerHTML = items.length
    ? items.map((a) => `<div class="list-item"><div><h4>${esc(a.title)}</h4><p>${esc(a.className)} • ${esc(a.subject || "")}</p><p>${esc(a.description || "Không có mô tả")}</p></div><div class="item-meta"><span>Hạn nộp</span><small>${esc(a.dueDate || "---")}</small></div></div>`).join("")
    : '<div class="empty-state">Chưa có bài tập nào.</div>';
}

function renderSubmissions() {
  const items = [...visibleSubmissions()].sort((a, b) => `${b.submittedAtText || ""}`.localeCompare(`${a.submittedAtText || ""}`));
  $("submissionList").innerHTML = items.length
    ? items.map((s) => `<div class="list-item"><div><h4>${esc(s.assignmentTitle)}</h4><p>${esc(s.className)} • ${esc(s.studentName)}</p><p>${esc(s.content)}</p></div><div class="item-meta"><span>Đã nộp</span><small>${esc(s.submittedAtText || "Vừa xong")}</small></div></div>`).join("")
    : '<div class="empty-state">Chưa có bài nộp nào.</div>';
}

function renderDirectContacts() {
  const contacts = users.filter((u) => u.uid !== currentUser.uid);
  $("directChatContacts").innerHTML = contacts.length
    ? contacts.map((u) => {
      const hasThread = messageFeed.some((m) => m.chatType === "direct" && m.directChatId === chatId(currentUser.uid, u.uid));
      return `<button class="contact-card ${selectedDirectUserId === u.uid ? "selected" : ""}" onclick="openDirectChat('${u.uid}')"><div><h4>${esc(u.name)}</h4><p>${roleLabel[u.role]}</p></div><span>${hasThread ? "Chat ngay" : `${u.xp || 0} XP`}</span></button>`;
    }).join("")
    : '<div class="empty-state">Chưa có tài khoản để trò chuyện.</div>';
}

function renderMessages(boxId, messages) {
  const box = $(boxId);
  box.innerHTML = messages.length
    ? messages.map((m) => `<div class="chat-bubble ${m.senderId === currentUser.uid ? "own" : ""}"><strong>${esc(m.senderName || "Người dùng")}</strong><p>${esc(m.text)}</p><small>${esc(m.createdAtText || "Vừa xong")}</small></div>`).join("")
    : '<div class="empty-state">Chưa có tin nhắn nào.</div>';
  box.scrollTop = box.scrollHeight;
}

function openDirectChat(uid) {
  selectedDirectUserId = uid;
  selectedDirectChatId = chatId(currentUser.uid, uid);
  localStorage.setItem(DIRECT_CHAT_KEY, uid);
  const user = userById(uid);
  $("directChatTitle").innerText = user ? user.name : "Cuộc trò chuyện";
  $("directChatSubtitle").innerText = user ? `${roleLabel[user.role]} • Chat realtime cá nhân` : "Chat realtime";
  renderDirectContacts();
  renderActiveDirectChat();
  navigate("chat");
}

function subscribeToDirectChat() {
  renderActiveDirectChat();
}

function subscribeToClassChat() {
  renderActiveClassChat();
}

function renderActiveDirectChat() {
  if (!selectedDirectChatId) {
    $("directChatMessages").innerHTML = '<div class="empty-state">Chọn một tài khoản để bắt đầu chat.</div>';
    return;
  }

  const messages = [...messageFeed]
    .filter((m) => m.chatType === "direct" && m.directChatId === selectedDirectChatId)
    .sort((a, b) => messageSortValue(a) - messageSortValue(b));

  renderMessages("directChatMessages", messages);
}

function renderActiveClassChat() {
  if (!selectedClassId) {
    $("classChatMessages").innerHTML = '<div class="empty-state">Chọn lớp để xem chat nhóm.</div>';
    return;
  }

  const messages = [...messageFeed]
    .filter((m) => m.chatType === "class" && m.classId === selectedClassId)
    .sort((a, b) => messageSortValue(a) - messageSortValue(b));

  renderMessages("classChatMessages", messages);
}

async function sendDirectMessage() {
  const text = $("directChatInput").value.trim();
  const target = userById(selectedDirectUserId);
  if (!text || !target) return;
  await window.firebaseApp.addDoc(window.firebaseApp.collection(window.firebaseApp.db, "messages"), {
    chatType: "direct",
    directChatId: selectedDirectChatId,
    participantIds: [currentUser.uid, target.uid],
    senderId: currentUser.uid,
    senderName: currentUser.name,
    text,
    createdAt: window.firebaseApp.serverTimestamp(),
    createdAtText: new Date().toLocaleString("vi-VN")
  });
  $("directChatInput").value = "";
}

async function sendClassMessage() {
  const text = $("classChatInput").value.trim();
  const c = classById(selectedClassId);
  if (!text || !c || (currentUser.role !== "admin" && !(c.memberIds || []).includes(currentUser.uid))) return;
  const participantIds = Array.from(new Set([...(c.memberIds || []), currentUser.uid]));
  await window.firebaseApp.addDoc(window.firebaseApp.collection(window.firebaseApp.db, "messages"), {
    chatType: "class",
    classId: c.id,
    className: c.name,
    participantIds,
    senderId: currentUser.uid,
    senderName: currentUser.name,
    text,
    createdAt: window.firebaseApp.serverTimestamp(),
    createdAtText: new Date().toLocaleString("vi-VN")
  });
  $("classChatInput").value = "";
}

async function saveAccount() {
  const name = $("accountName").value.trim();
  const email = $("accountEmail").value.trim();
  const role = $("accountRole").value;
  if (!name || !email) return alert("Vui lòng nhập đầy đủ họ tên và email.");
  if (!canManageRole(role)) return alert("Bạn không được phép tạo hoặc sửa vai trò này.");
  try {
    if (editingAccountId) {
      const target = userById(editingAccountId);
      if (!canEditUser(target)) throw new Error("Bạn không có quyền sửa tài khoản này.");
      await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "users", editingAccountId), { name, role });
      $("accountPasswordNote").innerText = "Đã cập nhật tài khoản.";
      cancelAccountEdit();
    } else {
      const password = `${slug(name)}@`;
      if (password.length < 6) throw new Error("Không tạo được mật khẩu mặc định. Vui lòng nhập tên dài hơn.");
      await window.firebaseApp.createManagedAccount({ name, email, password, role });
      $("accountPasswordNote").innerText = `Đã tạo tài khoản. Mật khẩu mặc định: ${password}`;
      resetAccountForm();
    }
  } catch (e) {
    console.error(e);
    alert(e.message || "Không lưu được tài khoản.");
  }
}

function editAccount(uid) {
  const u = userById(uid);
  if (!u || !canEditUser(u)) return;
  editingAccountId = uid;
  $("accountFormTitle").innerText = "Chỉnh sửa tài khoản";
  $("saveAccountBtn").innerText = "Lưu thay đổi";
  $("cancelAccountEditBtn").classList.remove("hidden");
  $("accountName").value = u.name || "";
  $("accountEmail").value = u.email || "";
  $("accountEmail").disabled = true;
  $("accountRole").value = u.role;
  $("accountPasswordNote").innerText = "Email không đổi ở chế độ chỉnh sửa.";
  navigate("accounts");
}

function cancelAccountEdit() {
  editingAccountId = null;
  resetAccountForm();
}

function resetAccountForm() {
  $("accountFormTitle").innerText = "Tạo tài khoản";
  $("saveAccountBtn").innerText = "Tạo tài khoản";
  $("cancelAccountEditBtn").classList.add("hidden");
  $("accountName").value = "";
  $("accountEmail").value = "";
  $("accountEmail").disabled = false;
  $("accountPasswordNote").innerText = "Mật khẩu mặc định sẽ là tên không dấu + @.";
}

async function deactivateAccount(uid) {
  const target = userById(uid);
  if (!target || !canEditUser(target) || !confirm(`Vô hiệu hóa tài khoản ${target.name}?`)) return;
  try {
    await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "users", uid), { active: false });
    for (const c of classes) {
      if ((c.memberIds || []).includes(uid) || (c.studentIds || []).includes(uid)) {
        await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "classes", c.id), {
          memberIds: (c.memberIds || []).filter((id) => id !== uid),
          studentIds: (c.studentIds || []).filter((id) => id !== uid)
        });
      }
    }
  } catch (e) {
    console.error(e);
    alert(e.message || "Không vô hiệu hóa được tài khoản.");
  }
}

async function saveClass() {
  const name = $("className").value.trim();
  const subject = $("classSubject").value.trim();
  const description = $("classDescription").value.trim();
  const teacherId = $("classTeacher").value;
  const teacher = userById(teacherId) || currentUser;
  const studentIds = Array.from(document.querySelectorAll('#availableStudents input[type="checkbox"]:checked')).map((i) => i.value);
  const memberIds = Array.from(new Set([teacherId, ...studentIds]));
  if (!name || !subject || !teacherId) return alert("Vui lòng nhập đủ thông tin lớp học.");
  if (currentUser.role === "teacher" && teacherId !== currentUser.uid) return alert("Giáo viên chỉ được tạo hoặc sửa lớp của chính mình.");
  const payload = { name, subject, description, teacherId, teacherName: teacher.name, studentIds, memberIds };
  try {
    if (editingClassId) {
      const target = classById(editingClassId);
      if (!canManageClass(target)) throw new Error("Bạn không có quyền sửa lớp này.");
      await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "classes", editingClassId), payload);
      cancelClassEdit();
    } else {
      await window.firebaseApp.addDoc(window.firebaseApp.collection(window.firebaseApp.db, "classes"), {
        ...payload,
        createdBy: currentUser.uid,
        createdAt: window.firebaseApp.serverTimestamp()
      });
      resetClassForm();
    }
  } catch (e) {
    console.error(e);
    alert(e.message || "Không lưu được lớp học.");
  }
}

function editClass(id) {
  const c = classById(id);
  if (!c || !canManageClass(c)) return;
  editingClassId = id;
  $("classFormTitle").innerText = "Chỉnh sửa lớp học";
  $("saveClassBtn").innerText = "Lưu thay đổi";
  $("cancelClassEditBtn").classList.remove("hidden");
  $("className").value = c.name || "";
  $("classSubject").value = c.subject || "";
  $("classDescription").value = c.description || "";
  $("classTeacher").value = c.teacherId || "";
  document.querySelectorAll('#availableStudents input[type="checkbox"]').forEach((i) => {
    i.checked = (c.studentIds || []).includes(i.value);
  });
  navigate("classes");
}

function cancelClassEdit() {
  editingClassId = null;
  resetClassForm();
}

function resetClassForm() {
  $("classFormTitle").innerText = "Tạo lớp học";
  $("saveClassBtn").innerText = "Tạo lớp";
  $("cancelClassEditBtn").classList.add("hidden");
  $("className").value = "";
  $("classSubject").value = "";
  $("classDescription").value = "";
  document.querySelectorAll('#availableStudents input[type="checkbox"]').forEach((i) => {
    i.checked = false;
  });
  renderClassFormOptions();
}

async function deleteClassItem(id) {
  const c = classById(id);
  if (!c || !canManageClass(c) || !confirm(`Xóa lớp ${c.name}?`)) return;
  try {
    await window.firebaseApp.deleteDoc(window.firebaseApp.doc(window.firebaseApp.db, "classes", id));
    if (selectedClassId === id) selectedClassId = null;
  } catch (e) {
    console.error(e);
    alert(e.message || "Không xóa được lớp.");
  }
}

async function updateUserXp(uid, delta) {
  const u = userById(uid);
  if (!u || delta === 0) return;
  await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "users", uid), { xp: (u.xp || 0) + delta });
}

async function saveAttendance() {
  const c = classById($("attendanceClass").value);
  const date = $("attendanceDate").value;
  if (!c || !canManageClass(c)) return alert("Bạn không có quyền điểm danh lớp này.");
  if (!date) return alert("Vui lòng chọn ngày điểm danh.");
  const records = Array.from(document.querySelectorAll("#attendanceStudents select")).map((s) => ({ studentId: s.dataset.studentId, status: s.value }));
  const id = `${c.id}_${date.replaceAll("-", "")}`;
  try {
    const ref = window.firebaseApp.doc(window.firebaseApp.db, "attendance", id);
    const old = await window.firebaseApp.getDoc(ref);
    const prev = {};
    if (old.exists()) (old.data().records || []).forEach((r) => { prev[r.studentId] = r.status; });
    for (const r of records) await updateUserXp(r.studentId, xpFromAttendance(r.status) - xpFromAttendance(prev[r.studentId]));
    await window.firebaseApp.setDoc(ref, {
      classId: c.id,
      className: c.name,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
      studentIds: c.studentIds || [],
      date,
      records,
      savedBy: currentUser.uid,
      savedByName: currentUser.name,
      createdAt: window.firebaseApp.serverTimestamp()
    });
    alert("Đã lưu điểm danh.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Không lưu được điểm danh.");
  }
}

async function createAssignment() {
  const c = classById($("assignmentClass").value);
  const title = $("assignmentTitle").value.trim();
  const description = $("assignmentDescription").value.trim();
  const dueDate = $("assignmentDueDate").value;
  if (!c || !canManageClass(c)) return alert("Bạn không có quyền giao bài cho lớp này.");
  if (!title || !dueDate) return alert("Vui lòng nhập tiêu đề và hạn nộp.");
  try {
    await window.firebaseApp.addDoc(window.firebaseApp.collection(window.firebaseApp.db, "assignments"), {
      classId: c.id,
      className: c.name,
      subject: c.subject,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
      studentIds: c.studentIds || [],
      title,
      description,
      dueDate,
      createdBy: currentUser.uid,
      createdByName: currentUser.name,
      createdAt: window.firebaseApp.serverTimestamp()
    });
    $("assignmentTitle").value = "";
    $("assignmentDescription").value = "";
    $("assignmentDueDate").value = "";
  } catch (e) {
    console.error(e);
    alert(e.message || "Không giao được bài tập.");
  }
}

async function submitAssignment() {
  if (currentUser.role !== "student") return;
  const assignment = assignments.find((a) => a.id === $("submissionAssignment").value);
  const content = $("submissionContent").value.trim();
  if (!assignment || !content) return alert("Vui lòng chọn bài tập và nhập nội dung nộp bài.");
  const ref = window.firebaseApp.doc(window.firebaseApp.db, "submissions", `${assignment.id}_${currentUser.uid}`);
  try {
    const old = await window.firebaseApp.getDoc(ref);
    await window.firebaseApp.setDoc(ref, {
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      classId: assignment.classId,
      className: assignment.className,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      studentId: currentUser.uid,
      studentName: currentUser.name,
      studentEmail: currentUser.email,
      content,
      submittedAt: window.firebaseApp.serverTimestamp(),
      submittedAtText: new Date().toLocaleString("vi-VN")
    });
    if (!old.exists()) await updateUserXp(currentUser.uid, 25);
    $("submissionContent").value = "";
    alert(old.exists() ? "Đã cập nhật bài nộp." : "Đã nộp bài thành công và nhận 25 XP.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Không nộp được bài.");
  }
}

async function changeOwnPassword() {
  const password = $("newPassword").value.trim();
  if (!password || password.length < 6) {
    return alert("Mật khẩu mới phải có ít nhất 6 ký tự.");
  }

  try {
    await window.firebaseApp.updatePassword(window.firebaseApp.auth.currentUser, password);
    $("securityStatus").innerText = "Đổi mật khẩu thành công.";
    $("newPassword").value = "";
  } catch (e) {
    console.error(e);
    alert(e.message || "Không đổi được mật khẩu.");
  }
}

async function linkGoogleAccount() {
  try {
    await window.firebaseApp.linkWithPopup(window.firebaseApp.auth.currentUser, window.firebaseApp.googleProvider);
    $("securityStatus").innerText = "Đã liên kết tài khoản Google thành công.";
  } catch (e) {
    console.error(e);
    alert(e.message || "Không liên kết được Google.");
  }
}

function exportClassStudents() {
  const c = classById(selectedClassId);
  if (!c) return;

  const students = (c.studentIds || []).map(userById).filter(Boolean);
  const rows = [
    ["Họ tên", "Email", "Lớp", "XP"],
    ...students.map((s) => [s.name || "", s.email || "", c.name, String(s.xp || 0)])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(c.name || "lop-hoc")}-danh-sach-hoc-sinh.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function cancelAssignmentEdit() {
  resetAssignmentForm();
}

function resetAccountForm() {
  $("accountFormTitle").innerText = "Tạo tài khoản";
  $("saveAccountBtn").innerText = "Tạo tài khoản";
  $("cancelAccountEditBtn").classList.add("hidden");
  $("accountName").value = "";
  $("accountEmail").value = "";
  $("accountEmail").disabled = false;
  $("accountPasswordNote").innerText = "Mật khẩu mặc định sẽ là tên không dấu + @.";
}

function renderAttendanceStudents() {
  const c = classById($("attendanceClass").value);
  if (!c) {
    $("attendanceStudents").innerHTML = '<div class="empty-state">Chọn lớp để điểm danh.</div>';
    return;
  }
  const students = (c.studentIds || []).map(userById).filter(Boolean);
  const existingRecord = attendanceRecords.find((item) => item.classId === c.id && item.date === $("attendanceDate").value);
  const savedMap = {};
  (existingRecord?.records || []).forEach((item) => { savedMap[item.studentId] = item.status; });
  $("attendanceStudents").innerHTML = students.length
    ? students.map((s) => `
      <div class="attendance-row">
        <div class="attendance-user">
          <strong>${esc(s.name)}</strong>
          <p>${esc(s.email || "Chưa có email")}</p>
          <small class="status-badge ${userActivityStatus(s).tone}">${userActivityStatus(s).label}</small>
        </div>
        <div class="attendance-controls">
          <select data-student-id="${s.uid}">
            <option value="present" ${savedMap[s.uid] === "present" || !savedMap[s.uid] ? "selected" : ""}>Đúng giờ (+10 XP)</option>
            <option value="late" ${savedMap[s.uid] === "late" ? "selected" : ""}>Đi trễ (-10 XP)</option>
            <option value="absent" ${savedMap[s.uid] === "absent" ? "selected" : ""}>Vắng mặt (0 XP)</option>
          </select>
        </div>
      </div>`).join("")
    : '<div class="empty-state">Lớp này chưa có học sinh.</div>';
}

function renderAttendanceHistory() {
  const ids = new Set(visibleClasses().map((c) => c.id));
  const items = attendanceRecords.filter((a) => ids.has(a.classId)).sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  $("attendanceHistory").innerHTML = items.length
    ? items.map((a) => {
      const summary = getAttendanceSummary(a);
      return `<div class="assignment-card compact-card"><div><h4>${esc(a.className)}</h4><p>${esc(a.date)}</p><div class="assignment-meta-row"><span class="status-badge submitted">Đúng giờ ${summary.present}</span><span class="status-badge late">Trễ ${summary.late}</span><span class="status-badge missing">Vắng ${summary.absent}</span></div></div><div class="item-meta"><span>${(a.records || []).length} học sinh</span><small>${esc(a.savedByName || "---")}</small></div></div>`;
    }).join("")
    : '<div class="empty-state">Chưa có lịch sử điểm danh.</div>';
}

function renderAssignments() {
  const items = [...visibleAssignments()].sort((a, b) => dateValue(a.dueDate) - dateValue(b.dueDate));
  $("assignmentList").innerHTML = items.length
    ? items.map((a) => {
      const ownSubmission = getAssignmentSubmission(a);
      const status = currentUser.role === "student" ? getAssignmentStatus(a, ownSubmission) : null;
      const assignmentSubs = submissions.filter((s) => s.assignmentId === a.id);
      const lateCount = assignmentSubs.filter((s) => getAssignmentStatus(a, s).tone === "late").length;
      const missingCount = Math.max((a.studentIds || []).length - assignmentSubs.length, 0);
      return `<article class="assignment-card assignment-card-polished"><div class="assignment-main"><div class="assignment-header-row"><h4>${esc(a.title)}</h4>${status ? `<span class="status-badge ${status.tone}">${status.label}</span>` : ""}</div><p>${esc(a.className)} • ${esc(a.subject || "")}</p><p>${esc(a.description || "Không có mô tả")}</p><div class="assignment-meta-row"><span class="status-badge due">Hạn nộp ${esc(a.dueDate || "---")}</span>${currentUser.role !== "student" ? `<span class="status-badge submitted">${assignmentSubs.length} đã nộp</span><span class="status-badge late">${lateCount} trễ</span><span class="status-badge missing">${missingCount} chưa nộp</span>` : ""}</div></div><div class="item-meta assignment-side"><span>${esc(a.teacherName || "Giáo viên")}</span><small>${esc(a.className || "---")}</small>${canManageAssignment(a) ? `<div class="item-actions horizontal"><button class="mini-btn" onclick="editAssignment('${a.id}')">Sửa</button><button class="mini-btn danger-btn" onclick="deleteAssignmentItem('${a.id}')">Xóa</button></div>` : ""}</div></article>`;
    }).join("")
    : '<div class="empty-state">Chưa có bài tập nào.</div>';
}

function renderSubmissions() {
  const items = [...visibleSubmissions()].sort((a, b) => `${b.submittedAtText || ""}`.localeCompare(`${a.submittedAtText || ""}`));
  $("submissionList").innerHTML = items.length
    ? items.map((s) => {
      const assignment = assignments.find((item) => item.id === s.assignmentId);
      const status = getAssignmentStatus(assignment, s);
      return `<article class="assignment-card compact-card assignment-card-polished"><div class="assignment-main"><div class="assignment-header-row"><h4>${esc(s.assignmentTitle)}</h4><span class="status-badge ${status.tone}">${status.label}</span></div><p>${esc(s.className)} • ${esc(s.studentName)}</p><p>${esc(s.content)}</p></div><div class="item-meta assignment-side"><span>Đã nộp</span><small>${esc(s.submittedAtText || "Vừa xong")}</small></div></article>`;
    }).join("")
    : '<div class="empty-state">Chưa có bài nộp nào.</div>';
}

async function saveAssignment() {
  const c = classById($("assignmentClass").value);
  const title = $("assignmentTitle").value.trim();
  const description = $("assignmentDescription").value.trim();
  const dueDate = $("assignmentDueDate").value;
  if (!c || !canManageClass(c)) return alert("Bạn không có quyền giao bài cho lớp này.");
  if (!title || !dueDate) return alert("Vui lòng nhập tiêu đề và hạn nộp.");
  const payload = { classId: c.id, className: c.name, subject: c.subject, teacherId: c.teacherId, teacherName: c.teacherName, studentIds: c.studentIds || [], title, description, dueDate, createdBy: currentUser.uid, createdByName: currentUser.name };
  try {
    if (editingAssignmentId) {
      const target = assignments.find((a) => a.id === editingAssignmentId);
      if (!canManageAssignment(target)) throw new Error("Bạn không có quyền sửa bài tập này.");
      await window.firebaseApp.updateDoc(window.firebaseApp.doc(window.firebaseApp.db, "assignments", editingAssignmentId), payload);
    } else {
      await window.firebaseApp.addDoc(window.firebaseApp.collection(window.firebaseApp.db, "assignments"), { ...payload, createdAt: window.firebaseApp.serverTimestamp() });
    }
    resetAssignmentForm();
  } catch (e) {
    console.error(e);
    alert(e.message || "Không lưu được bài tập.");
  }
}

function editAssignment(id) {
  const assignment = assignments.find((item) => item.id === id);
  if (!canManageAssignment(assignment)) return;
  editingAssignmentId = id;
  $("assignmentFormTitle").innerText = "Chỉnh sửa bài tập";
  $("saveAssignmentBtn").innerText = "Lưu thay đổi";
  $("cancelAssignmentEditBtn").classList.remove("hidden");
  $("assignmentClass").value = assignment.classId || "";
  $("assignmentTitle").value = assignment.title || "";
  $("assignmentDescription").value = assignment.description || "";
  $("assignmentDueDate").value = assignment.dueDate || "";
  navigate("assignments");
}

async function deleteAssignmentItem(id) {
  const assignment = assignments.find((item) => item.id === id);
  if (!canManageAssignment(assignment) || !confirm(`Xóa bài tập ${assignment.title}?`)) return;
  try {
    await window.firebaseApp.deleteDoc(window.firebaseApp.doc(window.firebaseApp.db, "assignments", id));
    resetAssignmentForm();
  } catch (e) {
    console.error(e);
    alert(e.message || "Không xóa được bài tập.");
  }
}

function restoreUi() {
  if (localStorage.getItem(DARK_KEY) === "1") document.body.classList.add("dark");
  if (localStorage.getItem(MUSIC_KEY) === "1") {
    setTimeout(() => {
      $("bgMusic").play().then(() => {
        musicPlaying = true;
        $("musicStatus").innerText = "Bật";
        $("musicBtn").classList.add("music-on");
      }).catch(() => {});
    }, 300);
  }
}

function restoreDirectChat() {
  const uid = localStorage.getItem(DIRECT_CHAT_KEY);
  if (uid && userById(uid)) openDirectChat(uid);
}

document.addEventListener("DOMContentLoaded", () => {
  $("attendanceDate").value = new Date().toISOString().slice(0, 10);
  restoreUi();
});

window.bootstrapApp = (profile) => {
  startApp(profile);
  setTimeout(restoreDirectChat, 700);
};
window.addEventListener("hashchange", () => {
  if (currentUser) applyRouteFromHash();
});
window.navigate = navigate;
window.toggleDarkMode = toggleDarkMode;
window.toggleMusic = toggleMusic;
window.renderAccounts = renderAccounts;
window.renderAttendanceStudents = renderAttendanceStudents;
window.saveAccount = saveAccount;
window.cancelAccountEdit = cancelAccountEdit;
window.editAccount = editAccount;
window.deactivateAccount = deactivateAccount;
window.saveClass = saveClass;
window.cancelClassEdit = cancelClassEdit;
window.editClass = editClass;
window.deleteClassItem = deleteClassItem;
window.openClassDetail = openClassDetail;
window.saveAttendance = saveAttendance;
window.saveAssignment = saveAssignment;
window.editAssignment = editAssignment;
window.cancelAssignmentEdit = cancelAssignmentEdit;
window.deleteAssignmentItem = deleteAssignmentItem;
window.submitAssignment = submitAssignment;
window.changeOwnPassword = changeOwnPassword;
window.linkGoogleAccount = linkGoogleAccount;
window.exportClassStudents = exportClassStudents;
window.openDirectChat = openDirectChat;
window.sendDirectMessage = sendDirectMessage;
window.sendClassMessage = sendClassMessage;


