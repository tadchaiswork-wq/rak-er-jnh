// ============================================================
//  Firebase configuration
//  ------------------------------------------------------------
//  แทนที่ค่าด้านล่างด้วยค่าจริงจากโปรเจกต์ Firebase ของคุณ
//  (Project settings → General → Your apps → SDK setup and configuration → Config)
//  ดูขั้นตอนแบบละเอียดในไฟล์ README.md
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDFMRjlLg216dcMREc3Jh6kpIg-Ky5VaIE",
  authDomain: "rak-er-jnh.firebaseapp.com",
  projectId: "rak-er-jnh",
  storageBucket: "rak-er-jnh.firebasestorage.app",
  messagingSenderId: "747222687934",
  appId: "1:747222687934:web:844c72066338eab9fc7eef",
  measurementId: "G-3XBLCV7G4S"
};

// อีเมลปลอมที่ใช้ผูกกับ username (ผู้ใช้ไม่ต้องกรอกอีเมลจริง)
// ระบบจะแปลง username -> username@erjnh.web ให้อัตโนมัติ
const EMAIL_DOMAIN = "erjnh.web";

// บัญชี admin ใหญ่ (superadmin) — สร้างอัตโนมัติครั้งแรกที่สมัคร/ล็อกอิน
const SUPERADMIN_USERNAME = "pettoo";
