// Giữ nguyên tên biến/export; chỉ điền giá trị trong dấu nháy kép.
// Lấy cấu hình: Firebase Console > Project settings > General > Your apps > Web > Config.
// databaseURL lấy chính xác tại Realtime Database > Data, không thêm /doorbell hay .json.
// Bỏ trống toàn bộ để chạy Demo. Đây là Web config, không phải khóa service account.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
