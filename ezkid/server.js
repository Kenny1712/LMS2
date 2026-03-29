require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3000;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "MindX Quantum LMS API" });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "Thiếu file upload." });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(400).json({ ok: false, message: "Thiếu cấu hình Cloudinary trong .env." });
    }

    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: process.env.CLOUDINARY_FOLDER || "mindx-school-hub",
      resource_type: "auto"
    });

    res.json({
      ok: true,
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ ok: false, message: error.message || "Upload thất bại." });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/home", (_req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/app", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.listen(port, () => {
  console.log(`MindX Quantum LMS server running at http://localhost:${port}`);
});
