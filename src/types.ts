export type UserRole = "super_admin" | "admin" | "editor";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type ApplicantCategory = "helper" | "security" | "pickup";
export type ApplicantStatus = "pending" | "approved" | "rejected" | "suspended";

export interface Applicant {
  id: string;
  full_name: string;
  father_name: string;
  mother_name: string;
  dob: string;
  age?: number;
  nid: string;
  phone: string;
  email: string;
  address: string;
  category: ApplicantCategory;
  experience: string; // e.g., "5 years" or "5"
  skills: string; // comma-separated or text description
  photo: string; // base64 or URL
  documents: string; // comma-separated titles or URLs, e.g. "NID copy, Certificate"
  front_nid?: string; // Front Side NID Scanned Copy
  back_nid?: string; // Back Side NID Scanned Copy
  car_type?: string;
  car_number_plate?: string;
  license_number?: string;
  car_photo?: string;
  license_card_photo?: string;
  is_premium?: boolean;
  status: ApplicantStatus;
  gender?: string;
  created_at?: string;

  // Specific optional fields for detailed profiles
  helper_type?: "Housemaid" | "Babysitter" | "Caregiver" | "Cleaner";
  security_type?: "Residential Security" | "Commercial Security" | "Event Security";
  location?: string; // location or primary area of service
  training?: string; // security/helper training certifications

  // Pickup service specific
  vehicle_type?: string; // e.g., "Microbus", "Minivan", "Car"
  vehicle_company?: string;
  vehicle_model?: string;
  load_capacity?: string; // for trucks/pickups
  vehicle_photo?: string;
  route?: string; // e.g., "Mirpur to Gulshan"
  capacity?: number; // seating capacity
  schedule?: string; // e.g., "7:00 AM - 5:00 PM"
  area?: string; // e.g., "Dhaka"
  description?: string; // Driver background or intro
}

export type RequestStatus = "new" | "in_progress" | "completed" | "cancelled";
export type TrackingStatus = "pending" | "accepted" | "on_the_way" | "arrived" | "in_progress" | "completed";
export type TrackingMode = "active" | "paused" | "stopped";

export interface ServiceRequest {
  id: string;
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  service_type: "Domestic Helper" | "Security Guard" | "Pickup Service";
  duration: string; // e.g., "6 Months"
  budget: string; // budget details
  notes?: string;
  status: RequestStatus;
  created_at: string;
  assigned_worker_id?: string;
  assigned_worker_name?: string;
}

export interface ServiceTracking {
  id: string;
  booking_id: string;
  service_name: string;
  assigned_worker_id?: string;
  assigned_worker_name: string;
  status: TrackingStatus;
  eta: string;
  google_maps_link: string;
  embed_url: string;
  notes: string;
  mode: TrackingMode;
  last_updated: string;
  created_at: string;
  updated_by?: string;
}

export type NoticePriority = "high" | "normal" | "low";

export interface Notice {
  id: string;
  title: string;
  content: string;
  priority: NoticePriority;
  status: "draft" | "published";
  is_pinned: boolean;
  published_date: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  created_at: string;
}

export interface Service {
  id: string;
  name: string;
  icon: string; // lucide icon name
  description: string;
  display_order: number;
  enabled: boolean;
  image?: string;
  category?: string;
  price?: string | number;
  featured?: boolean;
  popular?: boolean;
  created_at: string;
}

export interface SystemSettings {
  company_name: string;
  logo: string; // text representation or data-url
  contact_number: string;
  whatsapp_number: string;
  email: string;
  office_address: string;
  social_facebook: string;
  social_twitter: string;
  social_linkedin: string;
  seo_title: string;
  seo_description: string;
  footer_text: string;

  // Floating Contact Button Config
  float_contact_enabled?: boolean;
  float_whatsapp_enabled?: boolean;
  float_phone_enabled?: boolean;
  float_messenger_enabled?: boolean;
  float_email_enabled?: boolean;
  float_messenger_link?: string;

  // SMTP Settings Config Area
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_sender_name?: string;
  smtp_sender_email?: string;
  smtp_recipient_emails?: string; // Comma separated notification list
  
  // SMTP Alert Preferences
  notify_new_candidate?: boolean;
  notify_new_request?: boolean;
  notify_candidate_status?: boolean;
  notify_notice_published?: boolean;
  notify_security_alerts?: boolean;

  // Service Visibility Toggles
  enable_domestic_helpers?: boolean;
  enable_security_guards?: boolean;
  enable_pickup_services?: boolean;

  // Home Page Editable Content
  home_banner?: string;
  home_experience_title?: string;
  home_experience_description?: string;
  home_experience_points?: string;

  // Custom Frontend Popup Settings
  popup_enabled?: boolean;
  popup_title?: string;
  popup_content?: string;
  popup_cta_text?: string;
  popup_cta_link?: string;

  // Vehicle Management JSON
  vehicle_data?: any;
}

export interface Message {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: "unread" | "read";
  created_at: string;
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  comment: string;
  approved: boolean;
  created_at: string;
}

export interface GalleryItem {
  id: string;
  title: string;
  image: string;
  category: string;
  created_at: string;
}

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  image: string;
  author: string;
  status: "draft" | "published";
  created_at: string;
}
