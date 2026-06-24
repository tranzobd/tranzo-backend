import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { MongoClient, Db, Collection } from "mongodb";
import { User, Applicant, ServiceRequest, ServiceTracking, Notice, ActivityLog, SystemSettings, Service, Message, Review, GalleryItem, BlogPost } from "./types";

dotenv.config();

interface DatabaseSchema {
  users: User[];
  passwords: Record<string, string>;
  applicants: Applicant[];
  service_requests: ServiceRequest[];
  service_tracking: ServiceTracking[];
  services: Service[];
  notices: Notice[];
  messages: Message[];
  reviews: Review[];
  gallery: GalleryItem[];
  posts: BlogPost[];
  activity_logs: ActivityLog[];
  settings: SystemSettings;
}

interface PasswordResetToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

type CollectionKey =
  | "users"
  | "applicants"
  | "service_requests"
  | "service_tracking"
  | "services"
  | "notices"
  | "messages"
  | "reviews"
  | "gallery"
  | "posts"
  | "activity_logs";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "tranzo_backend";

const stripMongoId = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

const stripUndefined = <T extends Record<string, any>>(value: T): Partial<T> => {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)) as Partial<T>;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getInitialData = (): DatabaseSchema => {
  return {
    users: [],
    passwords: {},
    applicants: [],
    service_requests: [],
    service_tracking: [],
    services: [      
      {
        id: "svc_pickup",
        name: "Transport Services",
        icon: "Truck",
        description: "Safe and reliable vehicle dispatch services.",
        display_order: 3,
        enabled: true,
        created_at: new Date().toISOString()
      }
    ],
    notices: [],
    messages: [],
    reviews: [],
    gallery: [],
    posts: [],
    activity_logs: [
      {
        id: "log_01",
        user_id: "system",
        user_name: "System",
        action: "Environment Provisioned via MongoDB Backend",
        created_at: new Date().toISOString()
      }
    ],
    settings: {
      company_name: "Tranzo",
      logo: "Tranzo",
      contact_number: "+8801700000000",
      whatsapp_number: "+8801700000000",
      email: "info@exprogroupbd.com",
      office_address: "House 0, Road 0, Dhaka, Bangladesh",
      social_facebook: "https://facebook.com/tranzobd",
      social_twitter: "",
      social_linkedin: "",
      seo_title: "Tranzo Provider",
      seo_description: "Professional Manpower & Recruitment Services.",
      footer_text: "© 2026 Tranzo. All rights reserved.",
      float_contact_enabled: true,
      float_whatsapp_enabled: true,
      float_phone_enabled: true,
      float_messenger_enabled: false,
      float_email_enabled: true,      
      enable_pickup_services: true,
      home_banner: "https://i.postimg.cc/m2v2hyLK/43893507-bace-48fc-92b6-16d8dc983ffb.png",
      home_experience_title: "Why choose Tranzo for your staffing needs?",
      home_experience_description: "We have spent over a decade perfecting the art of screening, training, and deploying top personnel across Bangladesh.",
      home_experience_points: "Rigorous 5-step background vetting,Certified training programs,24/7 deployment support,Replacement guarantees",
      vehicle_data: {
        types: [
          { id: "1", name: "Private Car" },
          { id: "2", name: "Passenger Car" },
          { id: "3", name: "Van" },
          { id: "4", name: "Pickup" },
          { id: "5", name: "Truck" },
          { id: "6", name: "Motorcycle" },
          { id: "7", name: "Hiace" },
          { id: "8", name: "Others" }
        ],
        companies: [
          { id: "1", name: "Toyota" },
          { id: "2", name: "Honda" },
          { id: "3", name: "Nissan" },
          { id: "4", name: "Hyundai" },
          { id: "5", name: "Tata" },
          { id: "6", name: "Mahindra" },
          { id: "7", name: "Ashok Leyland" },
          { id: "8", name: "Yamaha" },
          { id: "9", name: "Suzuki" }
        ]
      },
      smtp_host: "smtp.gmail.com",
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: "",
      smtp_pass: "",
      smtp_sender_name: "NS Manpower System",
      smtp_sender_email: "noreply@tranzo.com",
      notify_new_candidate: true,
      notify_new_request: true,
      popup_enabled: false,
      popup_title: "Welcome Notice",
      popup_content: "Welcome to our staffing portal! We offer background-checked, vetted personnel for helpers, security, and dynamic vehicle logistics.",
      popup_cta_text: "Learn More",
      popup_cta_link: ""
    }
  };
};

const loadLegacyJsonData = (): DatabaseSchema | null => {
  const candidates = [
    path.join(__dirname, "data.json"),
    path.join(process.cwd(), "data.json")
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DatabaseSchema;
    } catch (err) {
      console.error(`Failed to parse legacy data file at ${filePath}`, err);
    }
  }

  return null;
};

class DBManager {
  private client: MongoClient | null = null;
  private mongo: Db | null = null;
  private initialized = false;
  private data: DatabaseSchema = getInitialData();
  private initPromise: Promise<void> | null = null;

  private collection<T extends { id: string }>(name: CollectionKey): Collection<T & { _id: string }> {
    if (!this.mongo) throw new Error("MongoDB is not initialized");
    return this.mongo.collection<T & { _id: string }>(name);
  }

  private passwordsCollection(): Collection<{ _id: string; password_hash: string }> {
    if (!this.mongo) throw new Error("MongoDB is not initialized");
    return this.mongo.collection<{ _id: string; password_hash: string }>("passwords");
  }

  private settingsCollection(): Collection<any> {
    if (!this.mongo) throw new Error("MongoDB is not initialized");
    return this.mongo.collection("settings");
  }

  private passwordResetTokensCollection(): Collection<PasswordResetToken & { _id: string }> {
    if (!this.mongo) throw new Error("MongoDB is not initialized");
    return this.mongo.collection<PasswordResetToken & { _id: string }>("password_reset_tokens");
  }

  public async init() {
    if (this.initialized) return;

    if (this.initPromise) {
        return this.initPromise;
    }

    this.initPromise = (async () => {
        this.client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000
        });

        await this.client.connect();

        this.mongo = this.client.db(MONGODB_DB_NAME);

        await this.ensureIndexes();
        await this.seedIfEmpty();
        await this.loadFromMongo();

        this.initialized = true;
    })().catch((error) => {
        this.initialized = false;
        this.initPromise = null;
        this.mongo = null;
        throw error;
    });

    return this.initPromise;
}

  private async ensureIndexes() {
    await Promise.all([
      this.collection<User>("users").createIndex({ email: 1 }, { unique: true, sparse: true }),
      this.collection<Applicant>("applicants").createIndex({ status: 1, category: 1 }),
      this.collection<ServiceRequest>("service_requests").createIndex({ status: 1 }),
      this.collection<ServiceTracking>("service_tracking").createIndex({ booking_id: 1 }, { unique: true }),
      this.collection<Notice>("notices").createIndex({ status: 1, is_pinned: 1 }),
      this.collection<ActivityLog>("activity_logs").createIndex({ created_at: -1 }),
      this.passwordResetTokensCollection().createIndex({ token: 1 }, { unique: true }),
      this.passwordResetTokensCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    ]);
  }

  private async ensureInitialized() {
    if (!this.initialized) {
        await this.init();
    }

    if (!this.mongo) {
        throw new Error("MongoDB initialization failed");
    }
}

  public async ready() {
    await this.ensureInitialized();
  }

  private async seedIfEmpty() {
    const settingsExists = await this.settingsCollection().findOne({ _id: "global" });
    if (settingsExists) return;

    const fallback = getInitialData();
    const legacy = loadLegacyJsonData();
    const initial: DatabaseSchema = {
      ...fallback,
      ...(legacy || {}),
      users: legacy?.users || fallback.users,
      passwords: legacy?.passwords || fallback.passwords,
      applicants: legacy?.applicants || fallback.applicants,
      service_requests: legacy?.service_requests || fallback.service_requests,
      service_tracking: legacy?.service_tracking || fallback.service_tracking,
      services: legacy?.services || fallback.services,
      notices: legacy?.notices || fallback.notices,
      messages: legacy?.messages || fallback.messages,
      reviews: legacy?.reviews || fallback.reviews,
      gallery: legacy?.gallery || fallback.gallery,
      posts: legacy?.posts || fallback.posts,
      activity_logs: legacy?.activity_logs || fallback.activity_logs,
      settings: {
        ...fallback.settings,
        ...(legacy?.settings || {}),
        vehicle_data: {
          ...fallback.settings.vehicle_data,
          ...(legacy?.settings?.vehicle_data || {})
        }
      }
    };

    await Promise.all([
      this.replaceCollection("users", initial.users),
      this.replaceCollection("applicants", initial.applicants),
      this.replaceCollection("service_requests", initial.service_requests),
      this.replaceCollection("service_tracking", initial.service_tracking),
      this.replaceCollection("services", initial.services),
      this.replaceCollection("notices", initial.notices),
      this.replaceCollection("messages", initial.messages),
      this.replaceCollection("reviews", initial.reviews),
      this.replaceCollection("gallery", initial.gallery),
      this.replaceCollection("posts", initial.posts),
      this.replaceCollection("activity_logs", initial.activity_logs),
      this.replacePasswords(initial.passwords || {}),
      this.settingsCollection().replaceOne({ _id: "global" }, { _id: "global", ...initial.settings }, { upsert: true })
    ]);
  }

  private async loadFromMongo() {
    const fallback = getInitialData();
    const [
      users,
      applicants,
      serviceRequests,
      serviceTracking,
      services,
      notices,
      messages,
      reviews,
      gallery,
      posts,
      activityLogs,
      passwordRows,
      settingsDoc
    ] = await Promise.all([
      this.loadCollection<User>("users"),
      this.loadCollection<Applicant>("applicants"),
      this.loadCollection<ServiceRequest>("service_requests"),
      this.loadCollection<ServiceTracking>("service_tracking"),
      this.loadCollection<Service>("services"),
      this.loadCollection<Notice>("notices"),
      this.loadCollection<Message>("messages"),
      this.loadCollection<Review>("reviews"),
      this.loadCollection<GalleryItem>("gallery"),
      this.loadCollection<BlogPost>("posts"),
      this.loadCollection<ActivityLog>("activity_logs"),
      this.passwordsCollection().find().toArray(),
      this.settingsCollection().findOne({ _id: "global" })
    ]);

    this.data = {
      users,
      passwords: Object.fromEntries(passwordRows.map((row) => [row._id, row.password_hash])),
      applicants,
      service_requests: serviceRequests,
      service_tracking: serviceTracking,
      services: services.length ? services : fallback.services,
      notices,
      messages,
      reviews,
      gallery,
      posts,
      activity_logs: activityLogs.length ? activityLogs : fallback.activity_logs,
      settings: {
        ...fallback.settings,
        ...stripMongoId<SystemSettings>(settingsDoc),
        vehicle_data: {
          ...fallback.settings.vehicle_data,
          ...(settingsDoc?.vehicle_data || {})
        }
      }
    };
  }

  private async loadCollection<T extends { id: string }>(name: CollectionKey): Promise<T[]> {
    const rows = await this.collection<T>(name).find().project({ _id: 0 }).toArray();
    return rows as T[];
  }

private async persist<T extends { id: string }>(
    name: CollectionKey,
    value: T
) {
    await this.ensureInitialized();

    await this.collection<T>(name).replaceOne(
        { _id: value.id } as any,
        { _id: value.id, ...value } as any,
        { upsert: true }
    );
}

  private async remove(name: CollectionKey, id: string) {
    await this.collection(name)
      .deleteOne({ _id: id })
      .catch((err) => console.error(`MongoDB delete failed for ${name}:${id}`, err));
  }

  private async replaceCollection<T extends { id: string }>(name: CollectionKey, values: T[] = []) {
    const collection = this.collection<T>(name);
    await collection.deleteMany({});
    if (!Array.isArray(values)) return;
    if (values.length === 0) return;
    await collection.insertMany(values.map((value) => ({ _id: value.id, ...value } as any)));
  }

  private async replacePasswords(passwords: Record<string, string> = {}) {
    const collection = this.passwordsCollection();
    await collection.deleteMany({});
    const rows = Object.entries(passwords).map(([userId, hash]) => ({ _id: userId, password_hash: hash }));
    if (rows.length > 0) await collection.insertMany(rows);
  }

  public save() {
    if (!this.mongo) return;
    this.saveAll().catch((err) => console.error("MongoDB save failed", err));
  }

  private async saveAll() {
    await this.ensureInitialized();

    await Promise.all([
      this.replaceCollection("users", this.data.users),
      this.replacePasswords(this.data.passwords),
      this.replaceCollection("applicants", this.data.applicants),
      this.replaceCollection("service_requests", this.data.service_requests),
      this.replaceCollection("service_tracking", this.data.service_tracking),
      this.replaceCollection("services", this.data.services),
      this.replaceCollection("notices", this.data.notices),
      this.replaceCollection("messages", this.data.messages),
      this.replaceCollection("reviews", this.data.reviews),
      this.replaceCollection("gallery", this.data.gallery),
      this.replaceCollection("posts", this.data.posts),
      this.replaceCollection("activity_logs", this.data.activity_logs),
      this.settingsCollection().replaceOne({ _id: "global" }, { _id: "global", ...this.data.settings }, { upsert: true })
    ]);
  }

  public getUsers() {
    return this.data.users;
  }

  public async getUsersFresh() {
    await this.ensureInitialized();
    return this.data.users;
  }

  public getUserById(id: string) {
    return this.data.users.find((u) => u.id === id);
  }

  public async getUserByIdFresh(id: string) {
    await this.ensureInitialized();

    const cached = this.getUserById(id);
    if (cached) return cached;

    const user = await this.collection<User>("users").findOne(
      { $or: [{ id }, { _id: id }] } as any,
      { projection: { _id: 0 } } as any
    );

    if (!user) return undefined;
    this.upsertCachedUser(user as User);
    return user as User;
  }

  public getUserByEmail(email: string) {
    const normalized = normalizeEmail(email);
    return this.data.users.find((u) => normalizeEmail(u.email) === normalized);
  }

  public async getUserByEmailFresh(email: string) {
    await this.ensureInitialized();

    const normalized = normalizeEmail(email);
    if (!normalized) return undefined;

    const cached = this.getUserByEmail(normalized);
    if (cached) return cached;

    const exactMatch = await this.collection<User>("users").findOne(
      { email: normalized } as any,
      { projection: { _id: 0 } } as any
    );

    if (exactMatch) {
      this.upsertCachedUser(exactMatch as User);
      return exactMatch as User;
    }

    const caseInsensitiveMatch = await this.collection<User>("users").findOne(
      { email: new RegExp(`^${escapeRegExp(normalized)}$`, "i") } as any,
      { projection: { _id: 0 } } as any
    );

    if (!caseInsensitiveMatch) return undefined;
    this.upsertCachedUser(caseInsensitiveMatch as User);
    return caseInsensitiveMatch as User;
  }

  public verifyPassword(userId: string, plainText: string): boolean {
    const hash = this.data.passwords[userId];
    if (!hash) return false;
    return bcrypt.compareSync(plainText, hash);
  }

  public async verifyPasswordFresh(userId: string, plainText: string): Promise<boolean> {
    await this.ensureInitialized();

    let hash = this.data.passwords[userId];
    if (!hash) {
      const row = await this.passwordsCollection().findOne({ _id: userId });
      hash = row?.password_hash;
      if (hash) this.data.passwords[userId] = hash;
    }

    if (!hash) return false;
    return bcrypt.compareSync(plainText, hash);
  }

  private upsertCachedUser(user: User) {
    const existingIndex = this.data.users.findIndex((item) => item.id === user.id);
    if (existingIndex >= 0) {
      this.data.users[existingIndex] = user;
    } else {
      this.data.users.push(user);
    }
  }

  public async addUser(
    user: User,
    plainTextPass: string
) {
    await this.ensureInitialized();

    const salt = bcrypt.genSaltSync(10);

    this.data.passwords[user.id] =
        bcrypt.hashSync(plainTextPass, salt);

    this.data.users.push(user);

    await this.persist("users", user);

    await this.updatePassword(
        user.id,
        this.data.passwords[user.id]
    );
}

  public async updateUser(id: string, updates: Partial<User>, plainTextPass?: string) {
    await this.ensureInitialized();

    const user = await this.getUserByIdFresh(id);
    if (!user) return null;
    Object.assign(user, stripUndefined({ ...updates, email: updates.email ? normalizeEmail(updates.email) : undefined }));
    user.updated_at = new Date().toISOString();
    if (plainTextPass) {
      const salt = bcrypt.genSaltSync(10);
      await this.updatePassword(id, bcrypt.hashSync(plainTextPass, salt));
    }
    await this.persist("users", user);
    return user;
  }

public async updatePassword(
    userId: string,
    hashedPass: string
) {
    await this.ensureInitialized();

    this.data.passwords[userId] = hashedPass;

    await this.passwordsCollection().replaceOne(
        { _id: userId },
        {
            _id: userId,
            password_hash: hashedPass
        } as any,
        {
            upsert: true
        }
    );
}

  public async createPasswordResetToken(token: string, userId: string, expiresAt: Date) {
    await this.ensureInitialized();

    await this.passwordResetTokensCollection().replaceOne(
      { _id: token } as any,
      { _id: token, token, userId, expiresAt } as any,
      { upsert: true }
    );
  }

  public async getPasswordResetToken(token: string): Promise<PasswordResetToken | null> {
    await this.ensureInitialized();

    const row = await this.passwordResetTokensCollection().findOne(
      { $or: [{ _id: token }, { token }] } as any,
      { projection: { _id: 0 } } as any
    );

    return row as PasswordResetToken | null;
  }

  public async deletePasswordResetToken(token: string) {
    await this.ensureInitialized();

    await this.passwordResetTokensCollection().deleteOne(
      { $or: [{ _id: token }, { token }] } as any
    );
  }

  public async deleteUser(id: string) {
    await this.ensureInitialized();

    this.data.users = this.data.users.filter((u) => u.id !== id);
    delete this.data.passwords[id];
    await Promise.all([
      this.remove("users", id),
      this.passwordsCollection().deleteOne({ _id: id }).catch((err) => console.error(`MongoDB password delete failed for ${id}`, err))
    ]);
  }

  public getApplicants() {
    return this.data.applicants;
  }

  public getApplicantById(id: string) {
    return this.data.applicants.find((a) => a.id === id);
  }

  public async addApplicant(applicant: Applicant) {
    await this.ensureInitialized();

    this.data.applicants.push(applicant);
    await this.persist("applicants", applicant);
    return applicant;
  }

  public async updateApplicant(id: string, updates: Partial<Applicant>) {
    await this.ensureInitialized();

    const applicant = this.getApplicantById(id);
    if (!applicant) return null;
    Object.assign(applicant, updates);
    if (updates.dob) {
      const birthDate = new Date(updates.dob);
      const difference = Date.now() - birthDate.getTime();
      const ageDate = new Date(difference);
      applicant.age = Math.abs(ageDate.getUTCFullYear() - 1970);
    }
    await this.persist("applicants", applicant);
    return applicant;
  }

  public async deleteApplicant(id: string) {
    await this.ensureInitialized();

    this.data.applicants = this.data.applicants.filter((a) => a.id !== id);
    await this.remove("applicants", id);
  }

  public getServiceRequests() {
    return this.data.service_requests;
  }

  public getServiceRequestById(id: string) {
    return this.data.service_requests.find((r) => r.id === id);
  }

  public async addServiceRequest(req: ServiceRequest) {
    await this.ensureInitialized();

    this.data.service_requests.push(req);
    await this.persist("service_requests", req);
    return req;
  }

  public async updateServiceRequest(id: string, updates: Partial<ServiceRequest>) {
    await this.ensureInitialized();

    const request = this.getServiceRequestById(id);
    if (!request) return null;
    Object.assign(request, updates);
    await this.persist("service_requests", request);
    return request;
  }

  public async deleteServiceRequest(id: string) {
    await this.ensureInitialized();

    this.data.service_requests = this.data.service_requests.filter((r) => r.id !== id);
    this.data.service_tracking = this.data.service_tracking.filter((tracking) => tracking.booking_id !== id);
    await Promise.all([
      this.remove("service_requests", id),
      this.collection<ServiceTracking>("service_tracking")
      .deleteOne({ booking_id: id } as any)
      .catch((err) => console.error(`MongoDB tracking delete failed for booking:${id}`, err))
    ]);
  }

  public getServiceTracking() {
    return this.data.service_tracking || [];
  }

  public getServiceTrackingByBookingId(bookingId: string) {
    return this.getServiceTracking().find((tracking) => tracking.booking_id === bookingId);
  }

  public async upsertServiceTracking(tracking: ServiceTracking) {
    await this.ensureInitialized();

    const index = this.getServiceTracking().findIndex((item) => item.booking_id === tracking.booking_id);
    if (index >= 0) {
      this.data.service_tracking[index] = tracking;
    } else {
      this.data.service_tracking.push(tracking);
    }
    await this.persist("service_tracking", tracking);
    return tracking;
  }

  public getNotices() {
    return this.data.notices;
  }

  public getNoticeById(id: string) {
    return this.data.notices.find((n) => n.id === id);
  }

  public async addNotice(notice: Notice) {
    await this.ensureInitialized();

    this.data.notices.push(notice);
    await this.persist("notices", notice);
    return notice;
  }

  public async updateNotice(id: string, updates: Partial<Notice>) {
    await this.ensureInitialized();

    const notice = this.getNoticeById(id);
    if (!notice) return null;
    Object.assign(notice, updates);
    await this.persist("notices", notice);
    return notice;
  }

  public async deleteNotice(id: string) {
    await this.ensureInitialized();

    this.data.notices = this.data.notices.filter((n) => n.id !== id);
    await this.remove("notices", id);
  }

  public getMessages() {
    return this.data.messages || [];
  }

  public async addMessage(msg: Message) {
    await this.ensureInitialized();

    this.data.messages.push(msg);
    await this.persist("messages", msg);
    return msg;
  }

  public async deleteMessage(id: string) {
    await this.ensureInitialized();

    this.data.messages = this.data.messages.filter((m) => m.id !== id);
    await this.remove("messages", id);
  }

  public getReviews() {
    return this.data.reviews || [];
  }

  public async addReview(review: Review) {
    await this.ensureInitialized();

    this.data.reviews.push(review);
    await this.persist("reviews", review);
    return review;
  }

  public async deleteReview(id: string) {
    await this.ensureInitialized();

    this.data.reviews = this.data.reviews.filter((r) => r.id !== id);
    await this.remove("reviews", id);
  }

  public getGallery() {
    return this.data.gallery || [];
  }

  public async addGalleryItem(item: GalleryItem) {
    await this.ensureInitialized();

    this.data.gallery.push(item);
    await this.persist("gallery", item);
    return item;
  }

  public async deleteGalleryItem(id: string) {
    await this.ensureInitialized();

    this.data.gallery = this.data.gallery.filter((g) => g.id !== id);
    await this.remove("gallery", id);
  }

  public getPosts() {
    return this.data.posts || [];
  }

  public async addPost(post: BlogPost) {
    await this.ensureInitialized();

    this.data.posts.push(post);
    await this.persist("posts", post);
    return post;
  }

  public async deletePost(id: string) {
    await this.ensureInitialized();

    this.data.posts = this.data.posts.filter((p) => p.id !== id);
    await this.remove("posts", id);
  }

  public getServices() {
    return this.data.services || [];
  }

  public getServiceById(id: string) {
    return this.data.services.find((s) => s.id === id);
  }

  public async addService(service: Service) {
    await this.ensureInitialized();

    this.data.services.push(service);
    await this.persist("services", service);
    return service;
  }

  public async updateService(id: string, updates: Partial<Service>) {
    await this.ensureInitialized();

    const service = this.getServiceById(id);
    if (!service) return null;
    Object.assign(service, updates);
    await this.persist("services", service);
    return service;
  }

  public async deleteService(id: string) {
    await this.ensureInitialized();

    this.data.services = this.data.services.filter((s) => s.id !== id);
    await this.remove("services", id);
  }

  public getActivityLogs() {
    return this.data.activity_logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public async addActivityLog(log: ActivityLog) {
    await this.ensureInitialized();

    this.data.activity_logs.unshift(log);
    if (this.data.activity_logs.length > 300) {
      const removed = this.data.activity_logs.splice(300);
      await Promise.all(removed.map((item) => this.remove("activity_logs", item.id)));
    }
    await this.persist("activity_logs", log);
    return log;
  }

  public getSettings() {
    return this.data.settings;
  }

  public async updateSettings(updates: Partial<SystemSettings>) {
    await this.ensureInitialized();

    this.data.settings = { ...this.data.settings, ...updates };
    await this.settingsCollection()
      .replaceOne({ _id: "global" }, { _id: "global", ...this.data.settings }, { upsert: true })
      .catch((err) => console.error("MongoDB settings update failed", err));
    return this.data.settings;
  }
}

export const db = new DBManager();
export default db;
