import express, { Request, Response, NextFunction } from "express";
import path from "path";
import dns from "dns";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import db from "./db";
import { User, UserRole, Applicant, ServiceRequest, ServiceTracking, TrackingMode, TrackingStatus, Notice, ActivityLog, SystemSettings } from "./types";

dotenv.config();

// Setup DNS caching fallback to prevent timeout bugs inside container envs
dns.setDefaultResultOrder?.("ipv4first");

const app = express();
const PORT = Number(process.env.PORT) || 8000;
const JWT_SECRET = process.env.JWT_SECRET || "NS_MANPOWER_SECRET_KEY_JWT_2026";

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "https://tranzobd.netlify.app",
  "https://tranzobd.vercel.app",
  "https://tranzobd.com",
  ...configuredOrigins
]);
const allowAnyOrigin = allowedOrigins.has("*");
const vercelPreviewOriginPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;
const localDevOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true;
  return (
    allowAnyOrigin ||
    allowedOrigins.has(origin) ||
    vercelPreviewOriginPattern.test(origin) ||
    localDevOriginPattern.test(origin)
  );
};

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// SMTP Email dispatcher helper
async function sendNotificationEmail(subject: string, htmlContent: string) {
  try {
    const settings = db.getSettings();
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      console.log("⚠️ SMTP not configured on backend. Skipping email dispatch for:", subject);
      return;
    }

    const host = settings.smtp_host;
    const port = Number(settings.smtp_port) || 587;
    const secure = settings.smtp_secure ?? (port === 465);
    const user = settings.smtp_user;
    const pass = settings.smtp_pass;
    const senderName = settings.smtp_sender_name || settings.company_name || "Tranzo Manpower Provider Ltd.";
    const senderEmail = settings.smtp_sender_email || settings.email || "noreply@exprogroupbd.com";
    
    // Fallback recipient to the system email if none specific are added
    const recipeList = settings.smtp_recipient_emails
      ? settings.smtp_recipient_emails.split(",").map(e => e.trim()).filter(Boolean)
      : [settings.email || "info@exprogroupbd.com"].filter(Boolean);

    if (recipeList.length === 0) {
      console.log("⚠️ No recipient list is configured. Skipping email dispatch.");
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
         rejectUnauthorized: false // allows self-signed dev boxes
      }
    });

    let tagline = "Operational Security & Resource Dispatch Alerts";
    let subHeaderBgColor = "#183A72";
    
    const lowerSubject = subject.toLowerCase();
    if (lowerSubject.includes("security") || lowerSubject.includes("login") || lowerSubject.includes("alert")) {
      tagline = "Operational Security & Authentication Alerts";
      subHeaderBgColor = "#DC2626"; // Red warning
    } else if (lowerSubject.includes("candidate") || lowerSubject.includes("applied") || lowerSubject.includes("registration") || lowerSubject.includes("worker")) {
      tagline = "Career Registrations & Background Vettings";
      subHeaderBgColor = "#2563EB"; // Blue careers
    } else if (lowerSubject.includes("notice") || lowerSubject.includes("published") || lowerSubject.includes("announcement")) {
      tagline = "Notice Board & Public Announcements";
      subHeaderBgColor = "#D97706"; // Amber notice
    } else if (lowerSubject.includes("hire") || lowerSubject.includes("order") || lowerSubject.includes("booking") || lowerSubject.includes("request")) {
      tagline = "Manpower Staffing & Order Placements";
      subHeaderBgColor = "#059669"; // Green staffing orders
    } else {
      tagline = "Enterprise Communications Portal";
      subHeaderBgColor = "#1E3A8A";
    }

    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: recipeList.join(", "),
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
          <div style="background-color: ${subHeaderBgColor}; color: #ffffff; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 600; font-family: 'Plus Jakarta Sans', sans-serif;">${senderName}</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.85;">${tagline}</p>
          </div>
          <div style="padding: 24px; background-color: #ffffff; color: #1e293b; line-height: 1.6;">
            ${htmlContent}
          </div>
          <div style="padding: 16px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;">
            <p style="margin: 0;">This email is automatically generated by the ${settings.company_name || 'Tranzo'} Admin Engine.</p>
            <p style="margin: 4px 0 0 0;">${settings.office_address || "Dhaka, Bangladesh"}</p>
          </div>
        </div>
      `
    });

    console.log("SMTP notification delivered successfully:", info.messageId, "To:", recipeList);
  } catch (err: any) {
    if (err?.code === "EAUTH" || err?.responseCode === 535) {
      console.error("SMTP authentication failed. For Gmail, use a Google App Password, not the normal account password.");
      return;
    }

    console.error("Failed to broadcast SMTP notification:", err?.message || err);
  }
}

// User-Agent parser for security auditing
function parseUserAgent(uaStr: string = ""): { browser: string; device: string } {
  let browser = "Web Browser";
  let device = "Desktop Windows/Linux";
  const ua = uaStr.toLowerCase();

  if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("chrome") && !ua.includes("safari")) browser = "Chrome";
  else if (ua.includes("chrome") && ua.includes("safari")) browser = "Chrome / Safari";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("edge") || ua.includes("edg/")) browser = "Microsoft Edge";
  else if (ua.includes("opr") || ua.includes("opera")) browser = "Opera";

  if (ua.includes("iphone") || ua.includes("ipod")) device = "Apple iPhone";
  else if (ua.includes("ipad")) device = "Apple iPad";
  else if (ua.includes("android")) {
    if (ua.includes("mobile")) device = "Android Mobile Phone";
    else device = "Android Tablet";
  } else if (ua.includes("macintosh")) device = "Apple Mac Notebook";
  else if (ua.includes("windows")) device = "Microsoft Windows PC";
  else if (ua.includes("linux")) device = "Linux Workstation";

  return { browser, device };
}

// Middlewares
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db.ready();
    next();
  } catch (err) {
    console.error("MongoDB startup failure", err);
    res.status(500).json({ error: "Database unavailable" });
  }
});

const allowedImageMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (allowedImageMimeTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JPG, JPEG, PNG, and WEBP formats are allowed."));
  }
};

const memoryStorage = (multer as any).memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

const uploadImageToCloudinary = async (file: Express.Multer.File & { buffer: Buffer }) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (!cloudName) {
    throw new Error("CLOUDINARY_CLOUD_NAME is not configured");
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const folder = process.env.CLOUDINARY_FOLDER?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  const params = new URLSearchParams();
  params.set("file", `data:${file.mimetype};base64,${file.buffer.toString("base64")}`);

  if (folder) {
    params.set("folder", folder);
  }

  if (apiKey && apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    params.set("timestamp", timestamp);
    params.set("api_key", apiKey);

    if (uploadPreset) {
      params.set("upload_preset", uploadPreset);
    }

    const signatureBase = Array.from(params.entries())
      .filter(([key]) => key !== "file" && key !== "api_key")
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    params.set("signature", crypto.createHash("sha1").update(signatureBase + apiSecret).digest("hex"));
  } else {
    if (!uploadPreset) {
      throw new Error("CLOUDINARY_UPLOAD_PRESET is not configured");
    }

    params.set("upload_preset", uploadPreset);
  }

  const fetchFn = globalThis.fetch as typeof fetch;
  const response = await fetchFn(endpoint, {
    method: "POST",
    body: params
  });

  const result = await response.json() as any;
  if (!response.ok) {
    throw new Error(result?.error?.message || "Cloudinary upload failed");
  }

  return result as { secure_url: string; public_id: string; bytes: number; format: string };
};

// Express Custom Request Interface for Authentication Context
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
}

// Authentication Middleware
const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: "Access token is required" });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(403).json({ error: "Invalid or expired session token" });
      return;
    }
    req.user = decoded as { id: string; name: string; email: string; role: UserRole };
    next();
  });
};

// RBAC Guard
const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Access denied. Insufficient privileges." });
      return;
    }

    next();
  };
};

const trackingClients = new Map<string, Set<any>>();
const trackingStatuses: TrackingStatus[] = ["pending", "accepted", "on_the_way", "arrived", "in_progress", "completed"];
const trackingModes: TrackingMode[] = ["active", "paused", "stopped"];

const normalizeContact = (value = "") => value.trim().toLowerCase();
const phoneSuffix = (value = "") => value.replace(/[^0-9]/g, "").slice(-10);

const canAccessTracking = (request: ServiceRequest, contact: string) => {
  const cleanContact = normalizeContact(contact);
  if (!cleanContact) return false;

  const suffix = phoneSuffix(cleanContact);
  const requestPhone = phoneSuffix(request.phone || "");
  const emailMatches = !!request.email && normalizeContact(request.email) === cleanContact;
  const phoneMatches = !!suffix && !!requestPhone && requestPhone.endsWith(suffix);

  return emailMatches || phoneMatches;
};

const buildEmbedUrl = (rawLink = "") => {
  const link = rawLink.trim();
  if (!link) return "";
  if (link.includes("/maps/embed")) return link;

  const atMatch = link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    return `https://www.google.com/maps?q=${atMatch[1]},${atMatch[2]}&z=15&output=embed`;
  }

  try {
    const parsed = new URL(link);
    const query = parsed.searchParams.get("q") || parsed.searchParams.get("query");
    if (query) {
      return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
    }
  } catch {
    // Keep handling as a free-form Maps query below.
  }

  return `https://www.google.com/maps?q=${encodeURIComponent(link)}&output=embed`;
};

const defaultTrackingForRequest = (request: ServiceRequest): ServiceTracking => {
  const now = new Date().toISOString();
  return {
    id: `trk_${request.id}`,
    booking_id: request.id,
    service_name: request.service_type,
    assigned_worker_id: request.assigned_worker_id || "",
    assigned_worker_name: request.assigned_worker_name || "Awaiting assignment",
    status: request.status === "completed" ? "completed" : request.status === "in_progress" ? "in_progress" : "pending",
    eta: "Pending dispatch",
    google_maps_link: "",
    embed_url: "",
    notes: "",
    mode: "paused",
    last_updated: now,
    created_at: now
  };
};

const getTrackingPayload = (bookingId: string) => {
  const request = db.getServiceRequestById(bookingId);
  if (!request) return null;
  const tracking = db.getServiceTrackingByBookingId(bookingId) || defaultTrackingForRequest(request);
  return { booking: request, tracking };
};

const publishTrackingUpdate = (bookingId: string) => {
  const payload = getTrackingPayload(bookingId);
  const clients = trackingClients.get(bookingId);
  if (!payload || !clients) return;

  const message = `event: tracking-update\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client) => client.write(message));
};

const sanitizeTrackingUpdates = (body: any, existing: ServiceTracking, request: ServiceRequest, userId: string) => {
  const nextStatus = trackingStatuses.includes(body.status) ? body.status : existing.status;
  const nextMode = trackingModes.includes(body.mode) ? body.mode : existing.mode;
  const googleMapsLink = typeof body.google_maps_link === "string" ? body.google_maps_link.trim() : existing.google_maps_link;
  const now = new Date().toISOString();

  return {
    ...existing,
    service_name: request.service_type,
    assigned_worker_id: request.assigned_worker_id || existing.assigned_worker_id || "",
    assigned_worker_name: (typeof body.assigned_worker_name === "string" && body.assigned_worker_name.trim())
      || request.assigned_worker_name
      || existing.assigned_worker_name
      || "Awaiting assignment",
    status: nextStatus,
    eta: typeof body.eta === "string" ? body.eta.trim() : existing.eta,
    google_maps_link: googleMapsLink,
    embed_url: buildEmbedUrl(googleMapsLink),
    notes: typeof body.notes === "string" ? body.notes.trim() : existing.notes,
    mode: nextMode,
    last_updated: now,
    updated_by: userId
  };
};

app.post("/api/upload", authenticateToken, upload.single("image"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const result = await uploadImageToCloudinary(req.file as Express.Multer.File & { buffer: Buffer });
    res.json({ url: result.secure_url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

app.post("/api/upload-public", upload.single("image"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const result = await uploadImageToCloudinary(req.file as Express.Multer.File & { buffer: Buffer });
    res.json({ url: result.secure_url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

/* ==========================================================================
   PUBLIC API ENDPOINTS
   ========================================================================== */

// 1. Get Live settings (Language switcher configurations, office numbers)
app.get("/api/public/settings", (req: Request, res: Response) => {
  try {
    const settings = db.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to load public settings" });
  }
});

// 2. Try simple diagnostic server health route
app.get("/api/public/health", (req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 3. Get published notices for the notice board
app.get("/api/public/notices", (req: Request, res: Response) => {
  try {
    const notices = db.getNotices()
      .filter((n) => n.status === "published")
      .sort((a, b) => {
        // Pinned notices go to the top
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // Then sort by date (newest first)
        return new Date(b.published_date).getTime() - new Date(a.published_date).getTime();
      });
    res.json(notices);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notices" });
  }
});

// 4. Get approved personnel/listings (helpers, security guards, pickup drivers)
app.get("/api/public/applicants", (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    let list = db.getApplicants().filter((a) => a.status === "approved");

    if (category) {
      list = list.filter((a) => a.category === category);
    }

    res.json(list);
  } catch (error) {
    res.status(500).json({ error: "Failed to load service listings" });
  }
});

// 5. Get a specific approved personnel profile details
app.get("/api/public/applicants/:id", (req: Request, res: Response) => {
  try {
    const applicant = db.getApplicantById(req.params.id);
    if (!applicant || applicant.status !== "approved") {
      res.status(404).json({ error: "Profile not found or not yet approved" });
      return;
    }
    res.json(applicant);
  } catch (error) {
    res.status(500).json({ error: "Failed to load details" });
  }
});

// Added Public API endpoints for full synchronization
app.get("/api/public/services", (req: Request, res: Response) => {
  try {
    const services = db.getServices().filter(s => s.enabled !== false).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: "Failed to load services" });
  }
});

app.get("/api/public/reviews", (req: Request, res: Response) => {
  try {
    const reviews = db.getReviews(); // In production you'd filter by .approved
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

app.get("/api/public/gallery", (req: Request, res: Response) => {
  try {
    res.json(db.getGallery());
  } catch (error) {
    res.status(500).json({ error: "Failed to load gallery" });
  }
});

app.get("/api/public/posts", (req: Request, res: Response) => {
  try {
    const posts = db.getPosts().filter(p => p.status === "published");
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: "Failed to load blog posts" });
  }
});

app.post("/api/public/contact", async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Required fields missing" });
    }
    const msg = await db.addMessage({
      id: "msg_" + Date.now(),
      name,
      email,
      subject: subject || "No Subject",
      message,
      status: "unread",
      created_at: new Date().toISOString()
    });
    
    // Notify admin
    sendNotificationEmail(
      `[Contact Form] New Message from ${name}`,
      `<p><strong>Sender:</strong> ${name} (${email})</p>
       <p><strong>Subject:</strong> ${subject}</p>
       <p><strong>Message:</strong></p>
       <blockquote style="background: #f1f5f9; padding: 12px; border-left: 4px solid #183a72;">${message}</blockquote>`
    );

    res.json({ success: true, message: msg });
  } catch (error) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

// 6. Submit a Worker Application
app.post("/api/public/apply", async (req: Request, res: Response) => {
  try {
    const {
      full_name, father_name, mother_name, dob, nid, phone, email, address,
      category, experience, skills, photo, documents,
      helper_type, security_type, location,
      vehicle_type, route, capacity, schedule, area, description,
      front_nid, back_nid, car_type, car_number_plate, license_number, car_photo, license_card_photo
    } = req.body;

    if (!full_name || !phone || !nid || !category) {
      res.status(400).json({ error: "Full Name, Phone Number, National ID, and Category are required." });
      return;
    }

    // Process Date of Birth to calculate Age
    let ageComputed = 25; // fallback
    if (dob) {
      const birthDate = new Date(dob);
      const difference = Date.now() - birthDate.getTime();
      const ageDate = new Date(difference);
      ageComputed = Math.abs(ageDate.getUTCFullYear() - 1970);
    }

    const newApplicant: Applicant = {
      id: "app_" + Math.random().toString(36).substr(2, 9),
      full_name,
      father_name: father_name || "N/A",
      mother_name: mother_name || "N/A",
      dob: dob || "1995-01-01",
      age: ageComputed,
      nid,
      phone,
      email: email || "",
      address: address || "N/A",
      category,
      experience: experience || "Fresher",
      skills: skills || "",
      photo: photo || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=400",
      front_nid: front_nid || "",
      back_nid: back_nid || "",
      documents: documents || "NID Verification pending",
      car_type: car_type || "",
      car_number_plate: car_number_plate || "",
      license_number: license_number || "",
      car_photo: car_photo || "",
      license_card_photo: license_card_photo || "",
      status: "pending", // Always pending initially
      created_at: new Date().toISOString(),
      helper_type,
      security_type,
      location: location || "Dhaka",
      vehicle_type,
      route,
      capacity: capacity ? Number(capacity) : undefined,
      schedule,
      area: area || location || "Dhaka",
      description: description || ""
    };

    const saved = await db.addApplicant(newApplicant);
    
    // Log user activity
    await db.addActivityLog({
      id: "log_" + Math.random().toString(36).substr(2, 9),
      user_id: "public",
      user_name: "Visitor Form",
      action: `New candidate application submitted online: ${full_name} (${category})`,
      created_at: new Date().toISOString()
    });

    // SMTP dispatch on registration
    const settings = db.getSettings();
    if (settings.notify_new_candidate !== false) {
      sendNotificationEmail(
        `[Portal Alert] New Candidate Applied: ${full_name}`,
        `<h2>New Manpower Registration Received</h2>
         <p>A new worker has applied online and is awaiting administrative screening.</p>
         <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold; width: 150px;">Full Name:</td><td style="padding: 8px;">${full_name}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Category:</td><td style="padding: 8px; text-transform: capitalize;">${category}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Experience:</td><td style="padding: 8px;">${experience}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Phone Number:</td><td style="padding: 8px;">${phone}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Location:</td><td style="padding: 8px;">${location || "Dhaka"}</td></tr>
         </table>
         <p>Verify records and documents in the Admin Panel to approve this candidate.</p>`
      );
    }

    res.status(201).json({ success: true, applicant: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit application. Please check input formats." });
  }
});

// Safe tracking coordinates search endpoint
app.post("/api/public/requests/track", (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: "Phone number is required." });
      return;
    }
    const cleanPhone = phone.trim().toLowerCase();
    const allRequests = db.getServiceRequests();
    
    // Support matching by phone suffix to bypass country prefix variations
    const suffix = cleanPhone.replace(/[^0-9]/g, "").slice(-10);
    if (!suffix) {
      res.status(400).json({ error: "Invalid phone number format." });
      return;
    }

    const matches = allRequests.filter(r => {
      if (!r.phone) return false;
      const parsed = r.phone.replace(/[^0-9]/g, "");
      return parsed.endsWith(suffix);
    });
    
    const trackingResponse = matches.map(r => ({
      id: r.id,
      customer_name: r.customer_name,
      phone: r.phone,
      service_type: r.service_type,
      status: r.status,
      created_at: r.created_at,
      live_lat: (r as any).live_lat !== undefined ? Number((r as any).live_lat) : 23.8103, // default Dhaka Lat
      live_lng: (r as any).live_lng !== undefined ? Number((r as any).live_lng) : 90.4125, // default Dhaka Lng
      dispatch_status: (r as any).dispatch_status || "Pending Allocation",
      eta: (r as any).eta || "N/A",
      vehicle_no: (r as any).vehicle_no || "Awaiting Assignment",
      driver_name: (r as any).driver_name || "Assigned Driver",
      driver_phone: (r as any).driver_phone || "",
      pickup_location: (r as any).pickup_location || r.address,
      destination: (r as any).destination || r.address
    }));
    
    res.json(trackingResponse);
  } catch (error) {
    res.status(500).json({ error: "Tracking retrieval error." });
  }
});

app.post("/api/public/tracking/:bookingId/access", async (req: Request, res: Response) => {
  try {
    const bookingId = req.params.bookingId;
    const { contact } = req.body;
    const request = db.getServiceRequestById(bookingId);

    if (!request) {
      res.status(404).json({ error: "Booking was not found." });
      return;
    }

    if (!canAccessTracking(request, String(contact || ""))) {
      res.status(403).json({ error: "Enter the phone number or email used for this booking." });
      return;
    }

    const tracking = db.getServiceTrackingByBookingId(bookingId) || await db.upsertServiceTracking(defaultTrackingForRequest(request));
    res.json({ booking: request, tracking });
  } catch (error) {
    res.status(500).json({ error: "Tracking access failed." });
  }
});

app.get("/api/public/tracking/:bookingId/events", (req: Request, res: Response) => {
  const streamRes = res as any;
  const streamReq = req as any;
  const bookingId = req.params.bookingId;
  const contact = String(req.query.contact || "");
  const request = db.getServiceRequestById(bookingId);

  if (!request) {
    streamRes.status(404).end();
    return;
  }

  if (!canAccessTracking(request, contact)) {
    streamRes.status(403).end();
    return;
  }

  streamRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  if (!trackingClients.has(bookingId)) {
    trackingClients.set(bookingId, new Set());
  }
  trackingClients.get(bookingId)!.add(streamRes);

  const payload = getTrackingPayload(bookingId);
  streamRes.write(`event: tracking-update\ndata: ${JSON.stringify(payload)}\n\n`);

  const heartbeat = setInterval(() => {
    streamRes.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 25000);

  streamReq.on("close", () => {
    clearInterval(heartbeat);
    trackingClients.get(bookingId)?.delete(streamRes);
    if (trackingClients.get(bookingId)?.size === 0) {
      trackingClients.delete(bookingId);
    }
  });
});

// 7. Submit a Customer Service Request
app.post("/api/public/request", async (req: Request, res: Response) => {
  try {
    const { customer_name, phone, email, address, service_type, duration, budget, notes } = req.body;

    if (!customer_name || !phone || !service_type || !address) {
      res.status(400).json({ error: "Name, Phone Number, Service Type, and Address are required." });
      return;
    }

    const newRequest: ServiceRequest = {
      id: "req_" + Math.random().toString(36).substr(2, 9),
      customer_name,
      phone,
      email: email || "",
      address,
      service_type,
      duration: duration || "1 Month",
      budget: budget || "Negotiable",
      notes: notes || "",
      status: "new",
      created_at: new Date().toISOString()
    };

    const saved = await db.addServiceRequest(newRequest);
    await db.upsertServiceTracking(defaultTrackingForRequest(saved));

    await db.addActivityLog({
      id: "log_" + Math.random().toString(36).substr(2, 9),
      user_id: "public",
      user_name: "Visitor Form",
      action: `New service request placed by customer: ${customer_name} for ${service_type}`,
      created_at: new Date().toISOString()
    });

    // SMTP dispatch on service order
    const settings = db.getSettings();
    if (settings.notify_new_request !== false) {
      sendNotificationEmail(
        `[Portal Alert] New Service Order: ${customer_name}`,
        `<h2>New Customer Service Booking</h2>
         <p>A client has requested manpower staffing details.</p>
         <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold; width: 150px;">Client Name:</td><td style="padding: 8px;">${customer_name}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Service Field:</td><td style="padding: 8px;">${service_type}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Duration Contract:</td><td style="padding: 8px;">${duration}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Indicated Budget:</td><td style="padding: 8px;">${budget}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Contact Details:</td><td style="padding: 8px;">${phone} / ${email || "No Email"}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Site Address:</td><td style="padding: 8px;">${address}</td></tr>
         </table>
         <blockquote style="background: #f1f5f9; padding: 12px; border-left: 4px solid #183a72; margin: 10px 0; font-style: italic;"><strong>Customer Notes:</strong><br />${notes || "None"}</blockquote>`
      );
    }

    res.status(201).json({ success: true, request: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save request" });
  }
});

// 8. Secure Admin Login Endpoint
app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await db.getUserByEmailFresh(email);
    if (!user) {
      res.status(401).json({ error: "Account with this email does not exist" });
      return;
    }

    const isMatch = await db.verifyPasswordFresh(user.id, password);
    if (!isMatch) {
      res.status(401).json({ error: "Incorrect password. Please try again." });
      return;
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Detect device change signature
    const userAgent = req.headers["user-agent"] || "";
    const { browser, device } = parseUserAgent(userAgent);
    const rawIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || "127.0.0.1";
    const ip = rawIp === "::1" || rawIp === "::ffff:127.0.0.1" ? "127.0.0.1" : rawIp;
    const location = ip === "127.0.0.1" ? "Local Developer Instance / Loopback" : "Incoming Gateway, Dhaka";
    const signature = `${browser} on ${device} (IP: ${ip})`;

    const knownDevices = (user as any).known_devices || [];
    const isNewDevice = !knownDevices.includes(signature);

    if (isNewDevice) {
      // Register device security flag
      (user as any).known_devices = [...knownDevices, signature];
      
      // Save alert log
      await db.addActivityLog({
        id: "log_" + Math.random().toString(36).substr(2, 9),
        user_id: user.id,
        user_name: user.name,
        action: `🚨 SECURITY ALERT: Login initiated from anomalous terminal / browser user-agent: ${signature}`,
        created_at: new Date().toISOString()
      });

      const settings = db.getSettings();
      if (settings.notify_security_alerts !== false) {
        sendNotificationEmail(
          `🚨 Security Notice: New Device Login Alert`,
          `<h3>Security Access Alert</h3>
           <p>An administrative user session has logged in from an unrecognized terminal environment or browser user-agent signature.</p>
           <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
             <tr style="background-color: #fef2f2;"><td style="padding: 8px; font-weight: bold; width: 150px; color: #ef4444;">Account:</td><td style="padding: 8px; font-weight: bold;">${user.name} (${user.email})</td></tr>
             <tr><td style="padding: 8px; font-weight: bold;">Assigned Role:</td><td style="padding: 8px; text-transform: uppercase;">${user.role}</td></tr>
             <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Browser:</td><td style="padding: 8px;">${browser}</td></tr>
             <tr><td style="padding: 8px; font-weight: bold;">Device Platform:</td><td style="padding: 8px;">${device}</td></tr>
             <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Client Net IP:</td><td style="padding: 8px;">${ip}</td></tr>
             <tr><td style="padding: 8px; font-weight: bold;">Est. Location:</td><td style="padding: 8px;">${location}</td></tr>
           </table>
           <p style="font-size: 12px; color: #64748b; font-style: italic;">If this logon was completed by you, no action is requested. If this session was unauthorized, revoke this password instantly.</p>`
        );
      }
    } else {
      // Normal activity login log
      await db.addActivityLog({
        id: "log_" + Math.random().toString(36).substr(2, 9),
        user_id: user.id,
        user_name: user.name,
        action: `User logged in securely (${user.role}) on trusted terminal/dev: ${browser} / ${device}`,
        created_at: new Date().toISOString()
      });
    }

    await db.ready();
    db.save();

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: "System login processing error" });
  }
});

app.post("/api/admin/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await db.getUserByEmailFresh(email);
    if (!user) {
      // Return a positive response to prevent user enumeration
      res.json({ message: "If tracking is valid, a reset link will be sent to the email." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600000);
    await db.createPasswordResetToken(token, user.id, expiresAt);

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    const settingsResponse = db.getSettings();
    if (settingsResponse?.smtp_host && settingsResponse?.smtp_user) {
      const transporter = nodemailer.createTransport({
        host: settingsResponse.smtp_host,
        port: Number(settingsResponse.smtp_port) || 465,
        secure: Number(settingsResponse.smtp_port) === 465,
        auth: {
          user: settingsResponse.smtp_user,
          pass: settingsResponse.smtp_pass,
        },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: `"${settingsResponse.smtp_sender_name || 'System Administrations'}" <${settingsResponse.smtp_sender_email || settingsResponse.smtp_user}>`,
        to: email,
        subject: "[Portal Alert] Password Reset Request",
        html: `<h2>Password Reset Request</h2>
               <p>Hello ${user.name},</p>
               <p>We received a request to reset your administration password.</p>
               <p>Click the secure link below to proceed:</p>
               <p><a href="${resetLink}" style="padding:10px 15px;background:#1E3566;color:white;text-decoration:none;border-radius:5px;">Reset Password</a></p>
               <p>This link expires in 1 hour.</p>
               <p>If you did not request this, you can safely ignore this email.</p>`
      });
    }

    await db.addActivityLog({
      id: crypto.randomUUID(),
      user_id: user.id,
      user_name: user.name,
      action: "Requested password reset link.",
      created_at: new Date().toISOString()
    });
    res.json({ message: "Reset link sent to your email." });

  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to process reset request." });
  }
});

app.post("/api/admin/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: "Token and new password required" });
      return;
    }

    const resetData = await db.getPasswordResetToken(token);
    if (!resetData || new Date(resetData.expiresAt).getTime() < Date.now()) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }

    const user = await db.getUserByIdFresh(resetData.userId);
    if (!user) {
      res.status(400).json({ error: "User not found" });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.updatePassword(user.id, hashedPassword);
    await db.deletePasswordResetToken(token);
    await db.addActivityLog({
      id: crypto.randomUUID(),
      user_id: user.id,
      user_name: user.name,
      action: "Successfully reset password via recovery link.",
      created_at: new Date().toISOString()
    });

    res.json({ success: true, message: "Password updated" });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to reset password" });
  }
});

/* ==========================================================================
   SECURE ADMIN DASHBOARD ROUTING (AUTHENTICATED)
   ========================================================================== */

// Verify session authenticity
app.get("/api/auth/me", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

// 1. Diagnostics & Stats Card Values
app.get("/api/admin/stats", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const applicants = db.getApplicants();
    const requests = db.getServiceRequests();
    const notices = db.getNotices();

    const stats = {
      totalApplicants: applicants.length,
      approvedApplicants: applicants.filter((a) => a.status === "approved").length,
      pendingApplicants: applicants.filter((a) => a.status === "pending").length,
      rejectedApplicants: applicants.filter((a) => a.status === "rejected").length,
      totalRequests: requests.length,
      requestStatusNew: requests.filter((r) => r.status === "new").length,
      requestStatusInProgress: requests.filter((r) => r.status === "in_progress").length,
      requestStatusCompleted: requests.filter((r) => r.status === "completed").length,
      requestStatusCancelled: requests.filter((r) => r.status === "cancelled").length,
      totalNotices: notices.length,
      categoryDistribution: {
        helper: applicants.filter((a) => a.category === "helper").length,
        security: applicants.filter((a) => a.category === "security").length,
        pickup: applicants.filter((a) => a.category === "pickup").length,
      },
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to compile admin stats" });
  }
});

// 2. Applicant Management API Route
app.get("/api/applicants", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getApplicants());
});

app.get("/api/users", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  res.json(await db.getUsersFresh());
});

app.post("/api/users", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, role, password } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: "Name, email, role, and password are required" });
  }

  const existing = await db.getUserByEmailFresh(email);
  if (existing) return res.status(400).json({ error: "Email already exists" });

  const newUser: User = {
    id: "user_" + Date.now(),
    name,
    email: email.trim().toLowerCase(),
    role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await db.addUser(newUser, password);
  res.json({ success: true, user: newUser });
});

app.put("/api/users/:id", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, role, password } = req.body;
  const user = await db.getUserByIdFresh(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const updates: Partial<User> & { password?: string } = { name, email, role };
  const updatedUser = await db.updateUser(req.params.id, updates, password);
  res.json({ success: true, user: updatedUser });
});

app.delete("/api/users/:id", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const user = await db.getUserByIdFresh(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === req.user!.id) return res.status(400).json({ error: "Cannot delete yourself" });
  await db.deleteUser(req.params.id);
  res.json({ success: true });
});

app.put("/api/applicants/:id", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  const applicantId = req.params.id;
  const updates = req.body;

  // Let's implement Editor boundaries (RBAC): Editors cannot delete, but can edit
  const applicant = db.getApplicantById(applicantId);
  if (!applicant) {
    res.status(404).json({ error: "Candidate profile not found" });
    return;
  }

  const formerStatus = applicant.status;
  const updated = await db.updateApplicant(applicantId, updates);
  
  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Updated applicant profile ${applicant.full_name} (Status to: ${updates.status || applicant.status})`,
    created_at: new Date().toISOString()
  });

  if (updated && updates.status && updates.status !== formerStatus) {
    const settings = db.getSettings();
    if (settings.notify_candidate_status !== false) {
      sendNotificationEmail(
        `[Portal Alert] Candidate status changed to: ${updated.status}`,
        `<h2>Candidate Verification Status Updated</h2>
         <p>An administrator has audited candidate records and modified their listing status.</p>
         <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold; width: 150px;">Candidate Name:</td><td style="padding: 8px;">${updated.full_name}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Category:</td><td style="padding: 8px; text-transform: capitalize;">${updated.category}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Previous Status:</td><td style="padding: 8px; text-transform: uppercase; color: #64748b;">${formerStatus}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold; color: #183a72;">New Status:</td><td style="padding: 8px; text-transform: uppercase; font-weight: bold; color: ${updated.status === "approved" ? "#10b981" : updated.status === "rejected" ? "#ef4444" : "#f59e0b"};">${updated.status}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Audited By:</td><td style="padding: 8px;">${req.user!.name} (${req.user!.role})</td></tr>
         </table>`
      );
    }
  }

  res.json({ success: true, applicant: updated });
});

app.delete("/api/applicants/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const applicant = db.getApplicantById(req.params.id);
  if (!applicant) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  await db.deleteApplicant(req.params.id);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Deleted candidate application: ${applicant.full_name}`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true });
});

// 3. Customer Service Request Management API
app.get("/api/requests", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getServiceRequests());
});

app.put("/api/requests/:id", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  const requestId = req.params.id;
  const updates = req.body;

  const request = db.getServiceRequestById(requestId);
  if (!request) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  const formerWorkerId = request.assigned_worker_id;
  const formerStatus = request.status;
  const updated = await db.updateServiceRequest(requestId, updates);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Updated Service Request or assigned a worker for ${request.customer_name}. Status: ${updates.status || request.status}`,
    created_at: new Date().toISOString()
  });

  // Hire Notification Logic
  if (updated && (
    (updated.assigned_worker_id && updated.assigned_worker_id !== formerWorkerId) ||
    (updated.status === "completed" && formerStatus !== "completed")
  )) {
    const worker = updated.assigned_worker_id ? db.getApplicantById(updated.assigned_worker_id) : null;
    const settings = db.getSettings();
    
    // 1. Notify Admin
    if (settings.notify_new_request !== false) {
      sendNotificationEmail(
        `[Hire Confirmed] ${updated.customer_name} ↔ ${updated.assigned_worker_name || "Assigned Worker"}`,
        `<h2>Worker Assignment & Hire Confirmation</h2>
         <p>A placement contract has been successfully initialized on the portal.</p>
         <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold; width: 150px;">Customer:</td><td style="padding: 8px;">${updated.customer_name}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Assigned Personnel:</td><td style="padding: 8px; font-weight: bold; color: #183a72;">${updated.assigned_worker_name || "N/A"}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Service Category:</td><td style="padding: 8px;">${updated.service_type}</td></tr>
           <tr><td style="padding: 8px; font-weight: bold;">Placement Status:</td><td style="padding: 8px; text-transform: uppercase;">${updated.status}</td></tr>
           <tr style="background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold;">Authorized By:</td><td style="padding: 8px;">${req.user!.name}</td></tr>
         </table>`
      );
    }

    // 2. Notify Customer (if email exists)
    if (updated.email) {
      // In a real system, we'd use a different transporter or configuration for customer emails
      // but here we proxy it through the same delivery engine
      const customerSubject = `Contract Initiated: Your ${updated.service_type} Assignment - Tranzo`;
      const customerBody = `
        <h3>Dear ${updated.customer_name},</h3>
        <p>Thank you for choosing <strong>Tranzo</strong>. We are pleased to inform you that a professional has been assigned to your service request.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
          <h4 style="margin-top: 0; color: #1e293b;">Assignment Details:</h4>
          <p><strong>Assigned Worker:</strong> ${updated.assigned_worker_name}</p>
          <p><strong>Service:</strong> ${updated.service_type}</p>
          <p><strong>Contract Duration:</strong> ${updated.duration}</p>
        </div>
        <p>Our representative will contact you shortly to coordinate the physical deployment and contract signing.</p>
        <p>If you have any questions, please contact our hotline at ${settings.contact_number}.</p>
      `;
      // We send this to the customer's email
      const host = settings.smtp_host;
      const port = Number(settings.smtp_port) || 587;
      const secure = settings.smtp_secure ?? (port === 465);
      const user = settings.smtp_user;
      const pass = settings.smtp_pass;
      if (host && user && pass) {
        const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: false } });
        transporter.sendMail({
          from: `"${settings.company_name}" <${settings.smtp_sender_email || settings.email}>`,
          to: updated.email,
          subject: customerSubject,
          html: customerBody
        }).catch(err => console.error("Failed to notify customer:", err));
      }
    }

    // 3. Notify Worker (if email exists)
    if (worker && worker.email) {
      const workerSubject = `New Job Assignment: Placement for ${updated.customer_name} - NS Manpower`;
      const workerBody = `
        <h3>Hello ${worker.full_name},</h3>
        <p>You have been assigned to a new service deployment via NS Manpower.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
          <h4 style="margin-top: 0; color: #1e293b;">Client Information:</h4>
          <p><strong>Client Name:</strong> ${updated.customer_name}</p>
          <p><strong>Location:</strong> ${updated.address}</p>
          <p><strong>Duties:</strong> ${updated.service_type}</p>
        </div>
        <p>Please report to the office or contact your supervisor immediately for the deployment brief.</p>
      `;
      const host = settings.smtp_host;
      const port = Number(settings.smtp_port) || 587;
      const secure = settings.smtp_secure ?? (port === 465);
      const user = settings.smtp_user;
      const pass = settings.smtp_pass;
      if (host && user && pass) {
        const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: false } });
        transporter.sendMail({
          from: `"${settings.company_name}" <${settings.smtp_sender_email || settings.email}>`,
          to: worker.email,
          subject: workerSubject,
          html: workerBody
        }).catch(err => console.error("Failed to notify worker:", err));
      }
    }
  }

  if (updated) {
    const existingTracking = db.getServiceTrackingByBookingId(requestId) || defaultTrackingForRequest(updated);
    const trackingStatus: TrackingStatus =
      updated.status === "completed" ? "completed" :
      updated.status === "in_progress" ? "in_progress" :
      existingTracking.status;

    await db.upsertServiceTracking({
      ...existingTracking,
      service_name: updated.service_type,
      assigned_worker_id: updated.assigned_worker_id || existingTracking.assigned_worker_id || "",
      assigned_worker_name: updated.assigned_worker_name || existingTracking.assigned_worker_name,
      status: trackingStatus,
      last_updated: new Date().toISOString(),
      updated_by: req.user!.id
    });
    publishTrackingUpdate(requestId);
  }

  res.json({ success: true, request: updated });
});

app.get("/api/admin/tracking", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const rows = db.getServiceRequests()
    .filter((request) => request.status !== "cancelled" && request.status !== "completed")
    .map((request) => ({
      booking: request,
      tracking: db.getServiceTrackingByBookingId(request.id) || defaultTrackingForRequest(request)
    }));

  res.json(rows);
});

app.get("/api/admin/tracking/:bookingId", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const payload = getTrackingPayload(req.params.bookingId);
  if (!payload) {
    res.status(404).json({ error: "Booking was not found." });
    return;
  }
  res.json(payload);
});

app.put("/api/admin/tracking/:bookingId", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  const bookingId = req.params.bookingId;
  const request = db.getServiceRequestById(bookingId);

  if (!request) {
    res.status(404).json({ error: "Booking was not found." });
    return;
  }

  const existing = db.getServiceTrackingByBookingId(bookingId) || defaultTrackingForRequest(request);
  const tracking = await db.upsertServiceTracking(sanitizeTrackingUpdates(req.body, existing, request, req.user!.id));

  const requestStatus =
    tracking.status === "completed" ? "completed" :
    tracking.status === "in_progress" || tracking.status === "arrived" || tracking.status === "on_the_way" ? "in_progress" :
    request.status;

  if (requestStatus !== request.status) {
    await db.updateServiceRequest(bookingId, { status: requestStatus });
  }

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Updated service tracking for ${request.customer_name} (${bookingId}) to ${tracking.status}`,
    created_at: new Date().toISOString()
  });

  publishTrackingUpdate(bookingId);
  res.json({ success: true, tracking, booking: db.getServiceRequestById(bookingId) });
});

app.delete("/api/requests/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const request = db.getServiceRequestById(req.params.id);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  await db.deleteServiceRequest(req.params.id);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Deleted customer request from ${request.customer_name}`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true });
});

// 4. Notice CRUD Operations
app.get("/api/notices", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getNotices());
});

app.post("/api/notices", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, content, priority, status, is_pinned } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: "Title and content are required" });
      return;
    }

    const newNotice: Notice = {
      id: "notice_" + Math.random().toString(36).substr(2, 9),
      title,
      content,
      priority: priority || "normal",
      status: status || "draft",
      is_pinned: !!is_pinned,
      published_date: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    const saved = await db.addNotice(newNotice);

    await db.addActivityLog({
      id: "log_" + Math.random().toString(36).substr(2, 9),
      user_id: req.user!.id,
      user_name: req.user!.name,
      action: `Created new notice board entry: ${title} (${status})`,
      created_at: new Date().toISOString()
    });

    // Notify if notice is published immediately
    if (saved && saved.status === "published") {
      const settings = db.getSettings();
      if (settings.notify_notice_published !== false) {
        sendNotificationEmail(
          `[Notice Published] ${saved.title}`,
          `<h2>New Notice Board Entry Published</h2>
           <p>An administrative user session has posted a new notice for public viewing.</p>
           <blockquote style="background: #f1f5f9; padding: 12px; border-left: 4px solid #183a72; margin: 15px 0;">
             <strong style="display: block; margin-bottom: 6px;">${saved.title}</strong>
             ${saved.content}
           </blockquote>
           <p>Priority level: <span style="text-transform: uppercase; font-weight: bold; color: ${saved.priority === "high" ? "#ef4444" : "#183a72"};">${saved.priority}</span></p>`
        );
      }
    }

    res.status(201).json({ success: true, notice: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to publish notice" });
  }
});

app.put("/api/notices/:id", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  const noticeId = req.params.id;
  const updates = req.body;

  const notice = db.getNoticeById(noticeId);
  if (!notice) {
    res.status(404).json({ error: "Notice entry not found" });
    return;
  }

  const formerStatus = notice.status;
  const updated = await db.updateNotice(noticeId, updates);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Edited Notice entry: ${notice.title}`,
    created_at: new Date().toISOString()
  });

  // Notify if status transitioned to published
  if (updated && updated.status === "published" && formerStatus !== "published") {
    const settings = db.getSettings();
    if (settings.notify_notice_published !== false) {
      sendNotificationEmail(
        `[Notice Published] ${updated.title}`,
        `<h2>Draft Notice Published</h2>
         <p>A previously saved notice has been reviewed and published live.</p>
         <blockquote style="background: #f1f5f9; padding: 12px; border-left: 4px solid #183a72; margin: 15px 0;">
           <strong style="display: block; margin-bottom: 6px;">${updated.title}</strong>
           ${updated.content}
         </blockquote>`
      );
    }
  }

  res.json({ success: true, notice: updated });
});

app.delete("/api/notices/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const notice = db.getNoticeById(req.params.id);
  if (!notice) {
    res.status(404).json({ error: "Notice entry not found" });
    return;
  }

  await db.deleteNotice(req.params.id);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `De-registered Notice entry: ${notice.title}`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true });
});

// 5. Audit Activity Logs Endpoint
app.get("/api/logs", authenticateToken, requireRole(["super_admin", "admin"]), (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getActivityLogs());
});

// 6. Config Settings PUT endpoint
app.put("/api/settings", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const updates = req.body;
  const updatedSettings = await db.updateSettings(updates);

  await db.addActivityLog({
    id: "log_" + Math.random().toString(36).substr(2, 9),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: "Updated system website, SMTP, SEO configuration, and metadata settings.",
    created_at: new Date().toISOString()
  });

  res.json({ success: true, settings: updatedSettings });
});

app.get("/api/settings", async (req, res) => {
  try {
    const settings = await db.getSettings();

    if (!settings) {
      return res.json({});
    }

    res.json(settings);
  } catch (error) {
    console.error("Get settings error:", error);
    res.status(500).json({
      error: "Failed to load settings"
    });
  }
});

// 7. Secure Admin Manual Candidate Enrollment Endpoint
app.post("/api/admin/applicants", authenticateToken, requireRole(["super_admin", "admin", "editor"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      full_name, father_name, mother_name, dob, nid, phone, email, address,
      category, experience, skills, photo, documents, status,
      helper_type, security_type, location,
      vehicle_type, vehicle_photo, route, capacity, schedule, area, description
    } = req.body;

    if (!full_name || !phone || !nid || !category) {
      res.status(400).json({ error: "Full Name, Phone Number, National ID, and Category are required." });
      return;
    }

    let ageComputed = 25;
    if (dob) {
      const birthDate = new Date(dob);
      const difference = Date.now() - birthDate.getTime();
      const ageDate = new Date(difference);
      ageComputed = Math.abs(ageDate.getUTCFullYear() - 1970);
    }

    const newApplicant: Applicant = {
      id: "app_" + Math.random().toString(36).substr(2, 9),
      full_name,
      father_name: father_name || "N/A",
      mother_name: mother_name || "N/A",
      dob: dob || "1995-01-01",
      age: ageComputed,
      nid,
      phone,
      email: email || "",
      address: address || "N/A",
      category,
      experience: experience || "Fresher",
      skills: skills || "",
      photo: photo || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=400",
      documents: documents || "NID Verification pending",
      status: status || "approved", // Directly approved if configured
      created_at: new Date().toISOString(),
      helper_type,
      security_type,
      location: location || "Dhaka",
      vehicle_type,
      vehicle_photo: vehicle_photo || "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=600",
      route,
      capacity: capacity ? Number(capacity) : undefined,
      schedule,
      area: area || location || "Dhaka",
      description: description || ""
    };

    const saved = await db.addApplicant(newApplicant);

    await db.addActivityLog({
      id: "log_" + Math.random().toString(36).substr(2, 9),
      user_id: req.user!.id,
      user_name: req.user!.name,
      action: `Admin manually added candidate: ${full_name} (${category}) with status ${newApplicant.status}`,
      created_at: new Date().toISOString()
    });

    res.status(201).json({ success: true, applicant: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to manually register applicant." });
  }
});

// 8. SMTP Connection Handshake Diagnostic Test Route
app.post("/api/admin/test-smtp", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_sender_name, smtp_sender_email, test_recipient } = req.body;
    
    if (!smtp_host || !smtp_user || !smtp_pass || !test_recipient) {
      res.status(400).json({ error: "Host, User, Password, and Test Recipient elements are required." });
      return;
    }
    
    const port = Number(smtp_port) || 587;
    const secure = smtp_secure ?? (port === 465);
    
    const testTransporter = nodemailer.createTransport({
      host: smtp_host,
      port,
      secure,
      auth: { user: smtp_user, pass: smtp_pass },
      tls: { rejectUnauthorized: false }
    });
    
    await testTransporter.verify();
    
    await testTransporter.sendMail({
      from: `"${smtp_sender_name || "Manpower Portal Test"}" <${smtp_sender_email || "noreply@exprogroupbd.com"}>`,
      to: test_recipient,
      subject: "🔔 Tranzo Admin Panel: Active SMTP Test Successful!",
      html: `
        <div style="font-family: Arial, sans-serif; border: 2px solid #10b981; border-radius: 8px; padding: 24px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10b981; margin-top: 0;">🎉 SMTP Handshake Succeeded!</h2>
          <p>Your mail delivery configuration was verified and accepted by the server successfully.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
          <ul style="padding-left: 20px; line-height: 1.8;">
            <li><strong>SMTP Server Host:</strong> ${smtp_host}</li>
            <li><strong>Port:</strong> ${port} (Secure: ${String(secure)})</li>
            <li><strong>Handshake User:</strong> ${smtp_user}</li>
            <li><strong>Handshake Timestamp:</strong> ${new Date().toLocaleString()}</li>
          </ul>
          <p style="font-size: 12px; color: #64748b; margin-top: 20px;">This verified handshake qualifies your server for delivering automated notifications upon registrations, settings edits, and security warning alerts.</p>
        </div>
      `
    });
    
    res.json({ success: true, message: "SMTP Server handshake verified and test notification broadcasted successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to establish secure TLS handshake to SMTP service." });
  }
});

// 9. Extra Admin Management (User CRUD)
app.post("/api/admin/users", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, role, password } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: "Name, email, role, and password are required" });
  }

  const existing = await db.getUserByEmailFresh(email);
  if (existing) return res.status(400).json({ error: "Email already exists" });

  const newUser: User = {
    id: "user_" + Date.now(),
    name,
    email: email.trim().toLowerCase(),
    role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await db.addUser(newUser, password);
  await db.addActivityLog({
    id: "log_" + Date.now(),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Created new admin user: ${name} (${role})`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true, user: newUser });
});

app.put("/api/admin/users/:id", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, role, password } = req.body;
  const user = await db.getUserByIdFresh(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const updates: Partial<User> & { password?: string } = { name, email, role };
  const updatedUser = await db.updateUser(req.params.id, updates, password);

  await db.addActivityLog({
    id: "log_" + Date.now(),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Updated admin user: ${updatedUser?.name || user.name}`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true, user: updatedUser });
});

app.delete("/api/admin/users/:id", authenticateToken, requireRole(["super_admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const user = await db.getUserByIdFresh(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === req.user!.id) return res.status(400).json({ error: "Cannot delete yourself" });

  // Prevent deleting last super admin
  if (user.role === "super_admin") {
    const superAdmins = (await db.getUsersFresh()).filter(u => u.role === "super_admin");
    if (superAdmins.length <= 1) {
      return res.status(400).json({ error: "Critical Safety: Cannot delete the final remaining Super Admin account." });
    }
  }

  await db.deleteUser(req.params.id);
  await db.addActivityLog({
    id: "log_" + Date.now(),
    user_id: req.user!.id,
    user_name: req.user!.name,
    action: `Deleted admin user: ${user.name}`,
    created_at: new Date().toISOString()
  });

  res.json({ success: true });
});

// Bulk Delete Routes
app.post("/api/admin/bulk-delete", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { type, ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "IDs must be a non-empty array" });
  }

  try {
    let deletedCount = 0;
    switch (type) {
      case "applicants":
        await Promise.all(ids.map((id: string) => db.deleteApplicant(id)));
        deletedCount = ids.length;
        break;
      case "requests":
        await Promise.all(ids.map((id: string) => db.deleteServiceRequest(id)));
        deletedCount = ids.length;
        break;
      case "notices":
        await Promise.all(ids.map((id: string) => db.deleteNotice(id)));
        deletedCount = ids.length;
        break;
      case "services":
        await Promise.all(ids.map((id: string) => db.deleteService(id)));
        deletedCount = ids.length;
        break;
      case "messages":
        await Promise.all(ids.map((id: string) => db.deleteMessage(id)));
        deletedCount = ids.length;
        break;
      case "reviews":
        await Promise.all(ids.map((id: string) => db.deleteReview(id)));
        deletedCount = ids.length;
        break;
      case "gallery":
        await Promise.all(ids.map((id: string) => db.deleteGalleryItem(id)));
        deletedCount = ids.length;
        break;
      case "posts":
        await Promise.all(ids.map((id: string) => db.deletePost(id)));
        deletedCount = ids.length;
        break;
      case "users":
        if (req.user!.role !== "super_admin") {
          return res.status(403).json({ error: "Only Super Admin can delete users" });
        }
        const users = await db.getUsersFresh();
        const superAdmins = users.filter(u => u.role === "super_admin");
        const idsToDelete = ids.filter(id => {
          const u = users.find(user => user.id === id);
          if (!u) return false;
          if (u.id === req.user!.id) return false; // self delete not allowed via bulk either
          if (u.role === "super_admin" && superAdmins.length <= 1) return false;
          return true;
        });
        await Promise.all(idsToDelete.map((id: string) => db.deleteUser(id)));
        deletedCount = idsToDelete.length;
        break;
      default:
        return res.status(400).json({ error: "Invalid type for bulk delete" });
    }

    await db.addActivityLog({
      id: "log_" + Date.now(),
      user_id: req.user!.id,
      user_name: req.user!.name,
      action: `Bulk deleted ${deletedCount} items from module: ${type}`,
      created_at: new Date().toISOString()
    });

    res.json({ success: true, count: deletedCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Bulk delete failed" });
  }
});

// 10. Service Management API
app.get("/api/admin/services", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getServices());
});

app.post("/api/admin/services", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  const { name, icon, description, display_order, enabled, image, category, price, featured, popular } = req.body;
  const newService = {
    id: "svc_" + Date.now(),
    name,
    icon: icon || "Settings",
    description: description || "",
    display_order: display_order || 0,
    enabled: enabled !== false,
    image: image || "",
    category: category || "general",
    price: price || "",
    featured: !!featured,
    popular: !!popular,
    created_at: new Date().toISOString()
  };
  const saved = await db.addService(newService);
  res.json(saved);
});

app.put("/api/admin/services/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await db.updateService(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update service" });
  }
});

app.delete("/api/admin/services/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  await db.deleteService(req.params.id);
  res.json({ success: true });
});

// New Modules API Routes
app.get("/api/admin/messages", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getMessages());
});
app.delete("/api/admin/messages/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  await db.deleteMessage(req.params.id);
  res.json({ success: true });
});

app.get("/api/admin/reviews", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getReviews());
});
app.delete("/api/admin/reviews/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  await db.deleteReview(req.params.id);
  res.json({ success: true });
});

app.get("/api/admin/gallery", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getGallery());
});
app.delete("/api/admin/gallery/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  await db.deleteGalleryItem(req.params.id);
  res.json({ success: true });
});

app.get("/api/admin/posts", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getPosts());
});
app.delete("/api/admin/posts/:id", authenticateToken, requireRole(["super_admin", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
  await db.deletePost(req.params.id);
  res.json({ success: true });
});

// 11. Initial Setup API
app.get("/api/public/setup-check", async (req, res) => {
  const users = await db.getUsersFresh();
  res.json({ needs_setup: users.length === 0 });
});

app.post("/api/public/setup-admin", async (req, res) => {
  const users = await db.getUsersFresh();
  if (users.length > 0) return res.status(403).json({ error: "Setup already completed" });
  
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Missing required fields" });
  
  const newUser: User = {
    id: "user_" + Date.now(),
    name,
    email: email.trim().toLowerCase(),
    role: "super_admin",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  await db.addUser(newUser, password);
  res.json({ success: true });
});

// 12. Persistent SMTP Testing API
app.post("/api/admin/test-smtp", authenticateToken, requireRole(["super_admin", "admin"]), async (req, res) => {
  const settings = db.getSettings();
  if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
    return res.status(400).json({ error: "SMTP settings are incomplete. Please configure and save first." });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: Number(settings.smtp_port),
      secure: settings.smtp_secure,
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    await transporter.sendMail({
      from: `"${settings.smtp_sender_name || "Manpower Portal"}" <${settings.smtp_sender_email || settings.smtp_user}>`,
      to: (req as any).user.email,
      subject: "SMTP Connection Test Success ✔",
      text: "This is a test email from your portal to confirm SMTP settings are functional.",
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a8a;">SMTP Test Successful</h2>
          <p>Your SMTP configuration for <strong>${settings.company_name}</strong> is functional.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="font-size: 12px; color: #64748b;">Requested by ${(req as any).user.name} on ${new Date().toLocaleString()}</p>
        </div>
      `,
    });

    await db.addActivityLog({
      id: "log_" + Date.now(),
      user_id: (req as any).user.id,
      user_name: (req as any).user.name,
      action: "SMTP system tested successfully",
      created_at: new Date().toISOString()
    });
    
    res.json({ message: "Test email sent successfully to your account email." });
  } catch (error: any) {
    console.error("SMTP Test Error:", error);
    res.status(500).json({ error: `Connection Failed: ${error.message}` });
  }
});

/* ==========================================================================
   DEVELOPMENT & PRODUCTION FRONTEND INTEGRATION (Vite Middleware Setup)
   ========================================================================== */

async function startServer() {
  await db.init();

  const distPath = path.join(process.cwd(), "dist");

  if (process.env.NODE_ENV === "production" && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Registered Prod Mode: serving static generated assets from 'dist'");
  } else {
    console.log("Registered API Mode: frontend middleware disabled.");
  }  
}

startServer()
  .then(() => {
    if (!process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`Tranzo backend listening on port ${PORT}`);
      });
    }
  })
  .catch((err) => {
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  

  console.error("Failed to start Tranzo backend.");
  console.error(`MongoDB URI: ${mongoUri}`);

  if (err?.name === "MongoServerSelectionError" || err?.cause?.code === "ECONNREFUSED") {
    console.error("MongoDB is not reachable. Start MongoDB first, then start the backend again.");
    console.error('Local Docker option: docker compose up -d mongodb');
    console.error("Atlas option: set MONGODB_URI in .env to your MongoDB Atlas connection string.");
  } else {
    console.error(err);
  }

  if (!process.env.VERCEL) {
    process.exit(1);
  }
});

export default app;
